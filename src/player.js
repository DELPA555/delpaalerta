'use strict'
// Reproductor de sonidos: una ventana oculta con <audio> que reproduce los .wav
// sin bloquear el loop de detección del proceso principal.
const path = require('path')
const url = require('url')
const { BrowserWindow } = require('electron')

let win = null

function createPlayer() {
  win = new BrowserWindow({
    width: 200,
    height: 120,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false // que siga sonando aunque esté oculta/minimizada
    }
  })
  win.loadFile(path.join(__dirname, 'player.html'))
  return win
}

// Reproduce el archivo (ruta absoluta) en la ventana oculta.
function play(filePath) {
  if (!win || win.isDestroyed() || !filePath) return
  const href = url.pathToFileURL(filePath).href
  win.webContents.send('play', href)
}

module.exports = { createPlayer, play }
