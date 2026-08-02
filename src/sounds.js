'use strict'
// Catálogo de sonidos de alerta:
//   - 3 tonos genéricos royalty-free empaquetados (generados por nosotros).
//   - Sonidos nativos de Windows leídos en runtime desde C:\Windows\Media.
// No se usan tonos de marcas (WhatsApp/iPhone/Samsung) por derechos de autor.
const path = require('path')
const fs = require('fs')
const { app } = require('electron')

// Tonos empaquetados (assets/sounds → resources/sounds en la app instalada)
const BUNDLED = [
  { key: 'clasico', name: 'Clásico (beep)', file: 'clasico.wav' },
  { key: 'doble', name: 'Doble beep', file: 'doble.wav' },
  { key: 'campana', name: 'Campana suave', file: 'campana.wav' }
]

// Sonidos de Windows que solemos encontrar (se listan sólo los que existen)
const WINDOWS_MEDIA = [
  ['Windows Notify.wav', 'Windows · Notificación'],
  ['Windows Notify System Generic.wav', 'Windows · Notificación genérica'],
  ['Windows Ding.wav', 'Windows · Ding'],
  ['Windows Background.wav', 'Windows · Background'],
  ['chimes.wav', 'Windows · Chimes'],
  ['chord.wav', 'Windows · Chord'],
  ['ding.wav', 'Windows · Ding (clásico)'],
  ['notify.wav', 'Windows · Notify'],
  ['tada.wav', 'Windows · Tada'],
  ['Alarm01.wav', 'Windows · Alarma 1'],
  ['Ring01.wav', 'Windows · Ring 1']
]

function bundledDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'sounds')
    : path.join(__dirname, '..', 'assets', 'sounds')
}

function winMediaDir() {
  return path.join(process.env.WINDIR || 'C:\\Windows', 'Media')
}

// Devuelve [{ key, name, path }] con todos los sonidos disponibles.
function getCatalog() {
  const out = []
  const bdir = bundledDir()
  for (const s of BUNDLED) {
    const p = path.join(bdir, s.file)
    if (fs.existsSync(p)) out.push({ key: s.key, name: s.name, path: p })
  }
  const wdir = winMediaDir()
  for (const [file, name] of WINDOWS_MEDIA) {
    const p = path.join(wdir, file)
    if (fs.existsSync(p)) out.push({ key: 'win:' + file, name, path: p })
  }
  return out
}

// Resuelve la ruta del sonido elegido; si no existe, cae al 'clasico' bundled.
function resolve(sonidoKey) {
  const cat = getCatalog()
  const found = cat.find((s) => s.key === sonidoKey)
  if (found) return found.path
  const fallback = cat.find((s) => s.key === 'clasico') || cat[0]
  return fallback ? fallback.path : null
}

module.exports = { getCatalog, resolve, BUNDLED }
