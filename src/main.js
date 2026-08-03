'use strict'
// AlertaPantalla (Electron) — vigila la pantalla y suena cuando aparece un
// círculo verde de mensaje nuevo. Corre en segundo plano (icono en la bandeja),
// sin ventana visible, con auto-update por GitHub Releases.
const path = require('path')
const { app, Tray, Menu, nativeImage, powerMonitor, shell, ipcMain, BrowserWindow, Notification } = require('electron')
const electronUpdater = require('electron-updater')
const { autoUpdater } = electronUpdater

const { createStore, readConfig, configPath, logPath, DEFAULTS } = require('./config')
const { log } = require('./logger')
const capture = require('./capture')
const { detect } = require('./detect')
const { AlertEngine } = require('./tracker')
const sounds = require('./sounds')
const player = require('./player')
const { BannerDetector } = require('./detectBanner')
const windowsWatch = require('./windowsWatch')
const { WindowsWatcher } = windowsWatch
const { getVolume } = require('./volume')
const visualAlert = require('./visualAlert')
const licVerify = require('./license/verify')
const { machineId, machineShort } = require('./license/machineId')
const licStore = require('./license/store')

let tray = null
let store = null
let cfg = null
let engine = null
let banner = null
let winWatcher = null
let windowsTimer = null
let loopTimer = null
let corriendo = false
let nextSlot = 0 // agenda global de reproducción (espaciado entre beeps)
let settingsWin = null
let activationWin = null
let licenseState = null
let avisoMostrado = false

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

// Punto único de alerta: suena y, si el sistema está muteado / con volumen bajo,
// muestra el respaldo visual. No bloquea el loop (el chequeo de volumen es async).
function dispararAlerta(mensaje, reps) {
  scheduleAlert(reps || 1)
  if (!cfg.respaldo_visual_habilitado) return
  getVolume()
    .then((v) => {
      const umbral = Number(cfg.volumen_umbral_pct) || 25
      if (v.muted || v.pct <= umbral) {
        visualAlert.show(mensaje, cfg.respaldo_visual_seg)
        log('[respaldo visual] ' + mensaje + ' (vol ' + (v.muted ? 'MUTE' : v.pct + '%') + ')')
      }
    })
    .catch(() => {})
}

// ── Zonas de exclusión ────────────────────────────────────────────────────────
// ¿Hace falta enumerar ventanas? (feature 6 o zonas de exclusión relativas)
function needWindows() {
  const feat6 = Array.isArray(cfg.ventanas_titulos) && cfg.ventanas_titulos.length > 0
  const exWin =
    cfg.exclusion_habilitado &&
    Array.isArray(cfg.exclusion_zonas_ventana) &&
    cfg.exclusion_zonas_ventana.length > 0 &&
    ((cfg.exclusion_procesos && cfg.exclusion_procesos.length) ||
      (cfg.exclusion_titulos && cfg.exclusion_titulos.length) ||
      (cfg.ventanas_titulos && cfg.ventanas_titulos.length))
  return feat6 || exWin
}

// Calcula las zonas de exclusión en coordenadas del FRAME capturado.
function computeExclusions() {
  if (!cfg.exclusion_habilitado) return []
  const out = []
  // Absolutas (px del frame)
  for (const z of cfg.exclusion_zonas_absolutas || []) {
    out.push({ x0: z.left | 0, y0: z.top | 0, x1: (z.left | 0) + (z.width | 0), y1: (z.top | 0) + (z.height | 0) })
  }
  // Relativas a cada ventana (siguen a las ventanas si se mueven/redimensionan)
  const zonas = cfg.exclusion_zonas_ventana || []
  if (zonas.length) {
    const titulos =
      cfg.exclusion_titulos && cfg.exclusion_titulos.length
        ? cfg.exclusion_titulos
        : cfg.ventanas_titulos || []
    const procesos = (cfg.exclusion_procesos || []).map((s) => String(s).toLowerCase())
    if (titulos.length || procesos.length) {
      const { offX, offY } = capture.captureOrigin(cfg.monitor)
      for (const w of windowsWatch.getCache()) {
        if (w.min || !w.rect) continue
        const t = w.title.toLowerCase()
        const pr = (w.proc || '').toLowerCase()
        const matchTitulo = titulos.some((x) => t.includes(String(x).toLowerCase()))
        const matchProceso = procesos.includes(pr)
        if (!matchTitulo && !matchProceso) continue
        const rw = w.rect.right - w.rect.left
        const rh = w.rect.bottom - w.rect.top
        if (rw <= 0 || rh <= 0) continue
        for (const z of zonas) {
          const zx0 = w.rect.left + z.left * rw
          const zy0 = w.rect.top + z.top * rh
          out.push({
            x0: Math.round(zx0 - offX),
            y0: Math.round(zy0 - offY),
            x1: Math.round(zx0 + z.width * rw - offX),
            y1: Math.round(zy0 + z.height * rh - offY)
          })
        }
      }
    }
  }
  return out
}

// ── Loop de detección ─────────────────────────────────────────────────────────
async function tick() {
  if (cfg.pausado || corriendo) return
  corriendo = true
  try {
    const frame = await capture.grab(cfg.monitor)
    if (frame) {
      const blobs = detect(frame, cfg, computeExclusions())
      const idle = powerMonitor.getSystemIdleTime()
      const fires = engine.update(blobs, Date.now(), idle, cfg)
      if (fires.length) {
        const total = fires.reduce((a, f) => a + f.reps, 0)
        for (const f of fires) dispararAlerta('Mensaje nuevo (círculo verde)', f.reps)
        log(`ALERTA verde: ${fires.length} tanda(s), ${total} repetición(es). círculos=${engine.activos} idle=${idle}s sonido=${cfg.sonido}`)
      }
      // (5) Banner emergente, sobre el mismo frame (no captura de nuevo)
      if (banner.check(frame, cfg, Date.now())) {
        dispararAlerta('Notificación emergente (banner)', 1)
        log('ALERTA banner: cambio brusco en la franja superior')
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
  // (6) Ventanas esperadas + refresco de bounds para zonas de exclusión.
  // Enumera (PowerShell) en un timer lento y cachea; el loop de 1 s usa la cache.
  if (windowsTimer) clearInterval(windowsTimer)
  const wms = Math.max(3000, (Number(cfg.ventanas_intervalo_seg) || 10) * 1000)
  const refrescarVentanas = async () => {
    if (!needWindows()) return
    try {
      await windowsWatch.refresh()
      winWatcher.check(cfg, (msg) => dispararAlerta(msg, 1))
    } catch (_) {
      /* noop */
    }
  }
  windowsTimer = setInterval(refrescarVentanas, wms)
  refrescarVentanas() // primer refresco inmediato (para tener bounds ya en el 1er tick)
  log(`Vigilancia iniciada. intervalo=${ms}ms monitor=${cfg.monitor} sonido=${cfg.sonido} pausado=${cfg.pausado}`)
}

function stopLoop() {
  if (loopTimer) {
    clearInterval(loopTimer)
    loopTimer = null
  }
  if (windowsTimer) {
    clearInterval(windowsTimer)
    windowsTimer = null
  }
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
    { label: `Delpa Alertas v${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    { label: '⚙ Opciones…', click: () => openSettings() },
    { label: '🔑 Licencia…', click: () => openActivation() },
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
  tray.setToolTip('Delpa Alertas')
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

// Editor visual de zonas de exclusión ABSOLUTAS: captura la pantalla y deja
// marcar rectángulos (para el caso de escritorio remoto, donde las ventanas de
// WhatsApp son una sola imagen y no se pueden aislar por programa/título).
function runZoneEditor() {
  return new Promise(async (resolve) => {
    let dataURL, w, h
    try {
      const shot = await capture.grabImage(cfg.monitor)
      if (!shot) return resolve(null)
      dataURL = shot.image.toDataURL()
      w = shot.width
      h = shot.height
    } catch (e) {
      log('Error abriendo editor de zonas: ' + (e && e.message))
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
    const finish = (zones) => {
      if (done) return
      done = true
      ipcMain.removeAllListeners('zones:save')
      ipcMain.removeAllListeners('zones:cancel')
      if (!win.isDestroyed()) win.close()
      resolve(zones)
    }
    ipcMain.once('zones:save', (_e, zones) => finish(zones))
    ipcMain.once('zones:cancel', () => finish(null))
    win.loadFile(path.join(__dirname, 'excludeZones.html'))
    win.webContents.once('did-finish-load', () => win.webContents.send('zones:image', { dataURL, w, h }))
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
  // Zonas de exclusión absolutas (editor visual)
  ipcMain.handle('ui:editZones', async () => {
    const zones = await runZoneEditor()
    if (!zones) return { ok: false, count: (cfg.exclusion_zonas_absolutas || []).length }
    store.set('exclusion_zonas_absolutas', zones)
    if (!cfg.exclusion_habilitado) store.set('exclusion_habilitado', true)
    applyRuntime()
    log('[exclusión] ' + zones.length + ' zona(s) absoluta(s) marcada(s)')
    return { ok: true, count: zones.length }
  })
  ipcMain.handle('ui:clearZones', () => {
    store.set('exclusion_zonas_absolutas', [])
    applyRuntime()
    return { ok: true, count: 0 }
  })
  // Licencia
  ipcMain.handle('license:status', () => ({ ...checkLicense(), machineShort: machineShort() }))
  ipcMain.handle('license:activate', (_e, code) => {
    const ev = licVerify.evaluar(code)
    if (!ev.ok) return { ok: false, mensaje: ev.mensaje }
    if (ev.estado === 'vencida') return { ok: false, mensaje: 'Ese código está vencido. Pedí uno nuevo para renovar.' }
    licStore.save(code, machineId())
    avisoMostrado = false
    applyLicense()
    return { ok: true, ...ev, machineShort: machineShort() }
  })
  ipcMain.on('ui:openConfigFile', () => shell.openPath(configPath()))
  ipcMain.on('ui:openLog', () => shell.openPath(logPath()))
  ipcMain.on('ui:quit', () => {
    app.isQuitting = true
    app.quit()
  })
}

// ── Licencia ──────────────────────────────────────────────────────────────────
function openActivation() {
  if (activationWin && !activationWin.isDestroyed()) {
    activationWin.show()
    activationWin.focus()
    return
  }
  activationWin = new BrowserWindow({
    width: 480,
    height: 580,
    title: 'Delpa Alertas — Licencia',
    icon: path.join(__dirname, '..', 'assets', 'tray.png'),
    autoHideMenuBar: true,
    resizable: false,
    backgroundColor: '#0b0f14',
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  })
  activationWin.loadFile(path.join(__dirname, 'activation.html'))
  activationWin.on('closed', () => {
    activationWin = null
  })
}

// Evalúa la licencia guardada (firma + vigencia + atadura a esta PC).
function checkLicense() {
  // Bypass SOLO para desarrollo (nunca en la app empaquetada).
  if (!app.isPackaged && process.env.DELPA_TEST_UNLOCK) {
    return { ok: true, funciona: true, estado: 'activa', cliente: 'DEV', expira: '2099-01-01', avisar: false, mensaje: 'DEV unlock' }
  }
  const st = licStore.get()
  if (!st.code) {
    return { ok: false, funciona: false, estado: 'sin_activar', mensaje: 'Activá tu licencia para empezar.' }
  }
  const ev = licVerify.evaluar(st.code)
  if (ev.ok && st.machineId && st.machineId !== machineId()) {
    return {
      ok: false, funciona: false, estado: 'otra_pc', cliente: ev.cliente,
      mensaje: 'Esta licencia fue activada en otra PC. Usá el código en la PC original o pedí uno nuevo.'
    }
  }
  return ev
}

// Aplica el estado de licencia: arranca o detiene la vigilancia y avisa.
function applyLicense() {
  licenseState = checkLicense()
  if (licenseState.funciona) {
    if (!loopTimer) startLoop()
    if (licenseState.avisar && !avisoMostrado) {
      avisoMostrado = true
      try {
        new Notification({ title: 'Delpa Alertas — Licencia', body: licenseState.mensaje }).show()
      } catch (_) {
        /* noop */
      }
    }
    log('[licencia] ' + (licenseState.mensaje || licenseState.estado))
  } else {
    stopLoop()
    log('[licencia] ' + licenseState.mensaje + ' → vigilancia detenida')
    openActivation()
  }
  refreshTray()
  if (tray) {
    tray.setToolTip('Delpa Alertas — ' + (licenseState.funciona ? 'vigilando' : 'sin licencia activa'))
  }
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
  banner = new BannerDetector()
  winWatcher = new WindowsWatcher()

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
  applyLicense() // arranca la vigilancia sólo si la licencia está vigente
  setInterval(applyLicense, 6 * 60 * 60 * 1000) // re-chequeo periódico (vencimiento/gracia)

  log('Delpa Alertas listo (v' + app.getVersion() + ')')
})
