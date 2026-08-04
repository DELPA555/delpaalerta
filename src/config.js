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
  // Dos blobs se consideran "el mismo" entre frames si están a esta distancia.
  // 16px cubre el jitter de compresión de video del escritorio remoto.
  tolerancia_posicion_px: 16,
  // Un tracker sobrevive sin detección estos segundos (el parpadeo por compresión
  // no lo resetea → no re-dispara la alerta base sobre un punto fijo).
  persistencia_seg: 2.5,
  // Modo diagnóstico: loguea cada blob NUEVO (x,y,área,aspecto,en zona de exclusión).
  diagnostico: false,

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

  // (5) Banner emergente en la franja superior (por cambio de píxeles).
  // Detector COARSE (sin color calibrado) → apagado por defecto y conservador:
  // hasta que se calibre por color, prioriza no meter ruido.
  banner_habilitado: false,
  banner_region: { top: 0, left: 0, width: 0, height: 110 }, // width 0 = todo el ancho
  banner_umbral_pixel: 40, // delta de luminancia por píxel para contarlo "cambiado"
  banner_sensibilidad: 0.25, // fracción de la franja que debe cambiar (piso 0.25 en código)
  banner_cooldown_seg: 60, // máx 1 alerta/min (piso 60s en código)

  // (6) Ventanas esperadas a monitorear (vacío = no monitorear)
  ventanas_titulos: [], // ej. ["cargas 1","cargas 2","cargas 3","cargas 4","Retiros"]
  ventanas_intervalo_seg: 10,
  ventanas_umbral_seg: 15, // cuánto tiempo perdida/minimizada antes de alertar
  ventanas_cooldown_seg: 30,

  // (7) Respaldo visual si el sistema está muteado o con volumen bajo
  respaldo_visual_habilitado: true,
  volumen_umbral_pct: 25,
  respaldo_visual_seg: 6,

  // Zonas de exclusión de la detección de círculo verde (elimina falsos
  // positivos, ej. la barra inferior de WhatsApp con badges verdes fijos).
  // Es un filtro previo: los píxeles verdes dentro de estas zonas se ignoran.
  // ACTIVADA por defecto: excluye la franja inferior de las ventanas espejadas,
  // detectándolas SOLAS por su programa (scrcpy/WhatsApp) → funciona al actualizar
  // sin configurar nada por PC.
  exclusion_habilitado: true,
  // Zonas relativas a CADA ventana (fracciones 0..1 del ancho/alto de la ventana).
  // Por defecto, la franja inferior (barra Chats/Llamadas/Novedades/Herramientas):
  exclusion_zonas_ventana: [{ top: 0.9, left: 0, width: 1, height: 0.1 }],
  // A qué ventanas aplicar: por PROGRAMA (nombre de proceso, sin .exe) y/o por título.
  exclusion_procesos: ['scrcpy', 'whatsapp'],
  // Por título (por si las ventanas no son de esos programas; vacío = usa ventanas_titulos):
  exclusion_titulos: [],
  // Zonas absolutas en píxeles del frame capturado (opcional): { top,left,width,height }
  exclusion_zonas_absolutas: [],

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
