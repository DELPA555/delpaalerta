'use strict'
// Configuración persistente (electron-store) en la carpeta de datos del usuario
// (%APPDATA%\AlertaPantalla), siempre escribible. Editable sin recompilar:
//   config.json  y  alerta.log
const path = require('path')
const fs = require('fs')
const { app } = require('electron')
const Store = require('electron-store')

// Valores de fábrica (calibrado real: círculo verde RGB (121,228,170), ~23x23 px).
const DEFAULTS = {
  monitor: 0, // 0/1 = principal; 2 = segundo monitor…
  region: 'pantalla_completa', // o { top, left, width, height } en px físicos
  color_rgb_min: [90, 200, 140],
  color_rgb_max: [150, 255, 200],
  area_min: 300,
  area_max: 560,
  redondez_min: 0.75,
  intervalo_scan_seg: 1.0,
  tolerancia_posicion_px: 12,

  // Sonido: clave del catálogo (bundled 'clasico'/'doble'/'campana' o 'win:archivo.wav')
  sonido: 'clasico',
  espaciado_repeticiones_ms: 300,

  // Alerta escalonada por tiempo sin atender (ver tracker.js)
  escalada: [
    { segundos: 0, repeticiones: 1 },
    { segundos: 60, repeticiones: 2 },
    { segundos: 180, repeticiones: 3 },
    { segundos: 300, repeticiones: 4 }
  ],
  // La escalada sólo aplica si la PC estuvo inactiva al menos estos segundos
  segundos_inactividad_para_escalar: 20,

  pausado: false
}

function dataDir() {
  return app.getPath('userData')
}
function configPath() {
  return path.join(dataDir(), 'config.json')
}
function logPath() {
  return path.join(dataDir(), 'alerta.log')
}
function ensureDataDir() {
  try {
    fs.mkdirSync(dataDir(), { recursive: true })
  } catch (_) {
    /* noop */
  }
}

function createStore() {
  // Sin cwd: electron-store usa app.getPath('userData') → userData/config.json
  return new Store({ name: 'config', defaults: DEFAULTS })
}

// Devuelve la config como objeto plano, completando claves faltantes con el
// default (retrocompatible con configs viejas).
function readConfig(store) {
  return Object.assign({}, DEFAULTS, store.store)
}

module.exports = { DEFAULTS, dataDir, configPath, logPath, ensureDataDir, createStore, readConfig }
