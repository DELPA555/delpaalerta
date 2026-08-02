'use strict'
// AlertaPantalla (Electron) — vigila la pantalla y suena cuando aparece un
// círculo verde de mensaje nuevo. Corre en segundo plano (icono en la bandeja),
// sin ventana visible, con auto-update por GitHub Releases.
const path = require('path')
const { app, Tray, Menu, nativeImage, powerMonitor, shell, ipcMain, BrowserWindow } = require('electron')
const electronUpdater = require('electron-updater')
const { autoUpdater } = electronUpdater

const { createStore, readConfig, configPath, logPath, DEFAULTS } = require('./config')
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
let settingsWin = null

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
    { label: '⚙ Opciones…', click: () => openSettings() },
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
      click: () => shell.openPath(configPath())
    },
    { label: 'Ver log', click: () => shell.openPath(logPath()) },
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

// ── Ventana de Opciones ───────────────────────────────────────────────────────
function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show()
    settingsWin.focus()
    return
  }
  settingsWin = new BrowserWindow({
    width: 640,
    height: 720,
    title: 'AlertaPantalla — Opciones',
    icon: path.join(__dirname, '..', 'assets', 'tray.png'),
    autoHideMenuBar: true,
    resizable: true,
    backgroundColor: '#0b0f14',
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  })
  settingsWin.loadFile(path.join(__dirname, 'settings.html'))
  settingsWin.on('closed', () => {
    settingsWin = null
  })
}

// Recalibra parámetros que afectan el runtime (ej. cambió el intervalo → reinicia el loop).
function applyRuntime() {
  cfg = readConfig(store)
  startLoop()
  refreshTray()
}

// Calibrador de color: captura la pantalla, la muestra a pantalla completa y
// devuelve el RGB del píxel donde el usuario hace click.
function runCalibrate() {
  return new Promise(async (resolve) => {
    let dataURL, w, h
    try {
      const shot = await capture.grabImage(cfg.monitor)
      if (!shot) return resolve(null)
      dataURL = shot.image.toDataURL()
      w = shot.width
      h = shot.height
    } catch (e) {
      log('Error calibrando: ' + (e && e.message))
      return resolve(null)
    }
    const win = new BrowserWindow({
      fullscreen: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      backgroundColor: '#000000',
      webPreferences: { nodeIntegration: true, contextIsolation: false }
    })
    let done = false
    const finish = (rgb) => {
      if (done) return
      done = true
      ipcMain.removeAllListeners('calibrate:pick')
      if (!win.isDestroyed()) win.close()
      resolve(rgb)
    }
    ipcMain.once('calibrate:pick', (_e, rgb) => finish(rgb))
    win.loadFile(path.join(__dirname, 'calibrate.html'))
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('calibrate:image', { dataURL, w, h })
    })
    win.on('closed', () => finish(null))
  })
}

// ── IPC de la UI ────────────────────────────────────────────────────────────
function registerIpc() {
  ipcMain.handle('ui:getState', () => ({
    cfg,
    version: app.getVersion(),
    activos: engine ? engine.activos : 0,
    catalog: sounds.getCatalog().map((s) => ({ key: s.key, name: s.name }))
  }))
  ipcMain.handle('ui:save', (_e, partial) => {
    if (partial && typeof partial === 'object') {
      for (const k of Object.keys(partial)) store.set(k, partial[k])
    }
    applyRuntime()
    log('Opciones guardadas: ' + Object.keys(partial || {}).join(', '))
    return cfg
  })
  ipcMain.handle('ui:reset', () => {
    for (const k of Object.keys(DEFAULTS)) store.set(k, DEFAULTS[k])
    applyRuntime()
    log('Opciones restauradas a valores de fábrica')
    return cfg
  })
  ipcMain.handle('ui:testSound', (_e, key) => {
    player.play(sounds.resolve(key || cfg.sonido))
  })
  ipcMain.handle('ui:setPaused', (_e, val) => {
    cfg.pausado = !!val
    store.set('pausado', cfg.pausado)
    refreshTray()
    return cfg.pausado
  })
  ipcMain.handle('ui:calibrate', () => runCalibrate())
  ipcMain.handle('ui:checkUpdates', () => checkUpdates(true))
  ipcMain.on('ui:openConfigFile', () => shell.openPath(configPath()))
  ipcMain.on('ui:openLog', () => shell.openPath(logPath()))
  ipcMain.on('ui:quit', () => {
    app.isQuitting = true
    app.quit()
  })
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
  registerIpc()
  createTray()
  setupUpdater()
  startLoop()

  log('AlertaPantalla listo (v' + app.getVersion() + ')')
})
