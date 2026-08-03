'use strict'
// Identificador estable de la PC (hash del MachineGuid de Windows, con fallback
// a hostname+CPU). Se usa para atar la activación a esta máquina.
const crypto = require('crypto')
const os = require('os')
const { execSync } = require('child_process')

let cached = null

function raw() {
  try {
    const out = execSync(
      'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
      { windowsHide: true, timeout: 4000 }
    ).toString()
    const m = out.match(/MachineGuid\s+REG_SZ\s+([\w-]+)/i)
    if (m) return m[1]
  } catch (_) {
    /* sin acceso al registro */
  }
  const cpu = os.cpus()[0] ? os.cpus()[0].model : ''
  return os.hostname() + '|' + cpu + '|' + os.arch()
}

function machineId() {
  if (cached) return cached
  cached = crypto.createHash('sha256').update(raw()).digest('hex')
  return cached
}

function machineShort() {
  return machineId().slice(0, 12)
}

module.exports = { machineId, machineShort }
