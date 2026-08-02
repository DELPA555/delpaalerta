'use strict'
// Log simple a C:\ProgramData\AlertaPantalla\alerta.log con rotación básica (~1 MB).
const fs = require('fs')
const { LOG_PATH, ensureDataDir } = require('./config')

const MAX_BYTES = 1_000_000

function rotarSiHaceFalta() {
  try {
    const st = fs.statSync(LOG_PATH)
    if (st.size > MAX_BYTES) {
      try {
        fs.renameSync(LOG_PATH, LOG_PATH + '.1')
      } catch (_) {
        fs.truncateSync(LOG_PATH, 0)
      }
    }
  } catch (_) {
    /* no existe todavía */
  }
}

function log(msg) {
  ensureDataDir()
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const linea = `${ts}  ${msg}\n`
  try {
    rotarSiHaceFalta()
    fs.appendFileSync(LOG_PATH, linea)
  } catch (_) {
    /* si falla el log no rompemos la app */
  }
}

module.exports = { log }
