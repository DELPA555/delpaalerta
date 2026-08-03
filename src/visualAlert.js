'use strict'
// Aviso visual imposible de ignorar cuando el sistema está muteado / con volumen
// bajo: una ventana chica always-on-top SIN robar el foco, arriba a la derecha,
// que se cierra sola a los pocos segundos o con click, + parpadeo de la barra de
// tareas (flashFrame).
const path = require('path')
const { BrowserWindow, screen, ipcMain } = require('electron')

let win = null
let hideTimer = null
let ipcListo = false

function ensureWin() {
  if (win && !win.isDestroyed()) return win
  const wa = screen.getPrimaryDisplay().workAreaSize
  win = new BrowserWindow({
    width: 380,
    height: 120,
    x: wa.width - 400,
    y: 24,
    frame: false,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: false, // que tenga botón en la barra para poder parpadear
    resizable: false,
    show: false,
    backgroundColor: '#7a1220',
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.loadFile(path.join(__dirname, 'alert.html'))
  win.on('closed', () => {
    win = null
  })
  if (!ipcListo) {
    ipcListo = true
    ipcMain.on('visual:close', () => ocultar())
  }
  return win
}

function ocultar() {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  if (win && !win.isDestroyed()) {
    try { win.flashFrame(false) } catch (_) { /* noop */ }
    win.hide()
  }
}

function show(mensaje, seg) {
  const dur = (Number(seg) || 6) * 1000
  const w = ensureWin()
  const mostrar = () => {
    w.webContents.send('msg', mensaje)
    w.showInactive() // aparece sin robar el foco
    try { w.flashFrame(true) } catch (_) { /* noop */ }
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = setTimeout(ocultar, dur)
  }
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', mostrar)
  else mostrar()
}

module.exports = { show }
