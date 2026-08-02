'use strict'
// AlertaPantalla (Electron) — vigila la pantalla y suena cuando aparece un
// círculo verde de mensaje nuevo. Corre en segundo plano (icono en la bandeja),
// sin ventana visible, con auto-update por GitHub Releases.
const path = require('path')
const { app, Tray, Menu, nativeImage, powerMonitor, shell } = require('electron')
const electronUpdater = require('electron-updater')
const { autoUpdater } = electronUpdater

const { createStore, readConfig, DATA_DIR } = require('./config')
const { log } = require('./logger')
const capture = require('./capture')
const { detect } = require('./detect')
const { AlertEngine } = require('./tracker')
const sounds = require('./sounds')
const player = require('./player')

let tray = null
let store = null
let cfg = null
let engine = null
let loopTimer = null
let corriendo = false
let nextSlot = 0 // agenda global de reproducción (espaciado entre beeps)

// ── Instancia única ───────────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

// ── Reproducción escalonada / espaciada, sin bloquear el loop ────────────────
function scheduleAlert(reps) {
  const gap = Number(cfg.espaciado_repeticiones_ms) || 300
  const sonPath = sounds.resolve(cfg.sonido)
  if (!sonPath) return
  for (let k = 0; k < reps; k++) {
    const now = Date.now()
    if (nextSlot < now) nextSlot = now
    const delay = nextSlot - now
    setTimeout(() => player.play(sonPath), delay)
    nextSlot += gap
  }
}

// ── Loop de detección ─────────────────────────────────────────────────────────
async function tick() {
  if (cfg.pausado || corriendo) return
  corriendo = true
  try {
    const frame = await capture.grab(cfg.monitor)
    if (frame) {
      const blobs = detect(frame, cfg)
      const idle = powerMonitor.getSystemIdleTime()
      const fires = engine.update(blobs, Date.now(), idle, cfg)
      if (fires.length) {
        const total = fires.reduce((a, f) => a + f.reps, 0)
        for (const f of fires) scheduleAlert(f.reps)
        log(`ALERTA: ${fires.length} tanda(s), ${total} repetición(es). círculos=${engine.activos} idle=${idle}s sonido=${cfg.sonido}`)
      }
    }
  } catch (e) {
    log('Error en el ciclo: ' + (e && e.message))
  } finally {
    corriendo = false
  }
}

function startLoop() {
  if (loopTimer) clearInterval(loopTimer)
  const ms = Math.max(200, Number(cfg.intervalo_scan_seg) * 1000 || 1000)
  loopTimer = setInterval(tick, ms)
  log(`Vigilancia iniciada. intervalo=${ms}ms monitor=${cfg.monitor} sonido=${cfg.sonido} pausado=${cfg.pausado}`)
}

// ── Bandeja del sistema ───────────────────────────────────────────────────────
function trayIcon() {
  const p = path.join(__dirname, '..', 'assets', 'tray.png')
  const img = nativeImage.createFromPath(p)
  return img.isEmpty() ? nativeImage.createEmpty() : img
}

function buildMenu() {
  const catalogo = sounds.getCatalog()
  const sonidoItems = catalogo.map((s) => ({
    label: s.name,
    type: 'radio',
    checked: cfg.sonido === s.key,
    click: () => {
      cfg.sonido = s.key
      store.set('sonido', s.key)
      player.play(s.path) // previsualización
      log('Sonido seleccionado: ' + s.key)
      refreshTray()
    }
  }))

  return Menu.buildFromTemplate([
    { label: `AlertaPantalla v${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    {
      label: cfg.pausado ? '▶ Reanudar vigilancia' : '⏸ Pausar vigilancia',
      click: () => {
        cfg.pausado = !cfg.pausado
        store.set('pausado', cfg.pausado)
        log(cfg.pausado ? 'Pausado' : 'Reanudado')
        refreshTray()
      }
    },
    {
      label: 'Sonido de alerta',
      submenu: sonidoItems.length ? sonidoItems : [{ label: '(sin sonidos)', enabled: false }]
    },
    {
      label: 'Probar el sonido actual',
      click: () => player.play(sounds.resolve(cfg.sonido))
    },
    { type: 'separator' },
    {
      label: 'Abrir configuración (config.json)',
      click: () => shell.openPath(path.join(DATA_DIR, 'config.json'))
    },
    { label: 'Ver log', click: () => shell.openPath(path.join(DATA_DIR, 'alerta.log')) },
    { label: 'Buscar actualizaciones', click: () => checkUpdates(true) },
    { type: 'separator' },
    {
      label: 'Salir',
      click: () => {
        app.isQuitting = true
        app.quit()
      }
    }
  ])
}

function refreshTray() {
  if (tray) tray.setContextMenu(buildMenu())
}

function createTray() {
  tray = new Tray(trayIcon())
  tray.setToolTip('AlertaPantalla — vigilando')
  refreshTray()
  tray.on('double-click', () => player.play(sounds.resolve(cfg.sonido)))
}

// ── Auto-update (GitHub Releases, igual patrón que LG Prop) ──────────────────
function checkUpdates(manual) {
  if (!app.isPackaged) {
    if (manual) log('[update] deshabilitado en modo dev')
    return
  }
  autoUpdater.checkForUpdates().catch((e) => log('[update] error de chequeo: ' + (e && e.message)))
}

function setupUpdater() {
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = {
    info: (m) => log('[update] ' + m),
    warn: (m) => log('[update] ' + m),
    error: (m) => log('[update] ' + m),
    debug: () => {}
  }
  autoUpdater.on('checking-for-update', () => log('[update] buscando actualizaciones…'))
  autoUpdater.on('update-available', (i) => log('[update] disponible: v' + i.version))
  autoUpdater.on('update-not-available', () => log('[update] la app está al día'))
  autoUpdater.on('update-downloaded', (i) => {
    log('[update] descargada v' + i.version + ' → instalando y reiniciando')
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 1500) // silencioso + relanzar
  })
  autoUpdater.on('error', (e) => log('[update] error: ' + (e && e.message)))

  checkUpdates(false)
  setInterval(() => checkUpdates(false), 6 * 60 * 60 * 1000) // cada 6 h
}

// ── Arranque ──────────────────────────────────────────────────────────────────
app.on('second-instance', () => {
  /* ya hay una instancia corriendo; no hacemos nada */
})

// No cerrar la app cuando se cierran ventanas (corre en segundo plano)
app.on('window-all-closed', () => {})

app.whenReady().then(() => {
  store = createStore()
  cfg = readConfig(store)
  engine = new AlertEngine()

  // Arranque automático al iniciar sesión (por usuario). Sólo en la app
  // instalada; en dev no queremos registrar un login item de electron.exe.
  if (app.isPackaged) {
    try {
      app.setLoginItemSettings({ openAtLogin: true, args: [] })
    } catch (_) {
      /* noop */
    }
  }

  player.createPlayer()
  createTray()
  setupUpdater()
  startLoop()

  log('AlertaPantalla listo (v' + app.getVersion() + ')')
})
