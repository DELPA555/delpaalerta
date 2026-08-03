'use strict'
// Estado de activación local (cifrado ligeramente con electron-store para
// desalentar la edición manual). Guarda el código, la PC atada y la fecha.
const Store = require('electron-store')

let store = null
function s() {
  if (!store) store = new Store({ name: 'license', encryptionKey: 'delpa-alertas-lic-2026' })
  return store
}

function get() {
  return {
    code: s().get('code') || null,
    machineId: s().get('machineId') || null,
    activatedAt: s().get('activatedAt') || null
  }
}

function save(code, machineId) {
  s().set('code', String(code).trim())
  s().set('machineId', machineId)
  s().set('activatedAt', new Date().toISOString())
}

function clear() {
  s().clear()
}

module.exports = { get, save, clear }
