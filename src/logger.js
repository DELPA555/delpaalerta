'use strict'
// Log simple a %APPDATA%\AlertaPantalla\alerta.log con rotación básica (~1 MB).
const fs = require('fs')
const { logPath, ensureDataDir } = require('./config')

const MAX_BYTES = 1_000_000

function rotarSiHaceFalta(p) {
  try {
    const st = fs.statSync(p)
    if (st.size > MAX_BYTES) {
      try {
        fs.renameSync(p, p + '.1')
      } catch (_) {
        fs.truncateSync(p, 0)
      }
    }
  } catch (_) {
    /* no existe todavía */
  }
}

function log(msg) {
  ensureDataDir()
  const p = logPath()
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const linea = `${ts}  ${msg}\n`
  try {
    rotarSiHaceFalta(p)
    fs.appendFileSync(p, linea)
  } catch (_) {
    /* si falla el log no rompemos la app */
  }
}

module.exports = { log }
