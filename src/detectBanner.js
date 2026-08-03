'use strict'
// Detección de notificación emergente (banner que se desliza en la franja
// superior). Como el color/forma exacto NO está calibrado, se detecta por
// CAMBIO DE PÍXELES en esa franja respecto del frame anterior: si una fracción
// de la franja cambia bruscamente, se considera un banner. Región y sensibilidad
// configurables. Deshabilitado por defecto (retrocompatible). Preparado para
// migrar a detección por color cuando se consiga una captura real del banner.

function resolveStrip(width, height, region) {
  const r = region || {}
  const top = Math.max(0, Math.min(height - 1, r.top || 0))
  const left = Math.max(0, Math.min(width - 1, r.left || 0))
  const w = r.width && r.width > 0 ? Math.min(width - left, r.width) : width - left
  const h = r.height && r.height > 0 ? Math.min(height - top, r.height) : Math.min(height - top, 110)
  return { top, left, w, h }
}

// Muestrea la luminancia de la franja (paso 2 en x/y para aligerar).
function muestraGris(frame, strip) {
  const { data, width } = frame
  const step = 2
  const cols = Math.ceil(strip.w / step)
  const rows = Math.ceil(strip.h / step)
  const out = new Uint8Array(cols * rows)
  let k = 0
  for (let y = 0; y < strip.h; y += step) {
    let o = ((strip.top + y) * width + strip.left) * 4
    for (let x = 0; x < strip.w; x += step, o += 4 * step) {
      const b = data[o]
      const g = data[o + 1]
      const r = data[o + 2]
      out[k++] = (r * 77 + g * 150 + b * 29) >> 8 // luminancia aprox
    }
  }
  return out
}

class BannerDetector {
  constructor() {
    this.prev = null
    this.lastAlert = 0
  }

  // Devuelve true si detecta un banner (respetando cooldown). Reusa el frame del
  // loop principal (no captura de nuevo).
  check(frame, cfg, now) {
    if (!cfg.banner_habilitado) {
      this.prev = null
      return false
    }
    const strip = resolveStrip(frame.width, frame.height, cfg.banner_region)
    const cur = muestraGris(frame, strip)
    const prev = this.prev
    this.prev = cur
    if (!prev || prev.length !== cur.length) return false

    const umbral = Number(cfg.banner_umbral_pixel) || 40
    let cambiados = 0
    for (let i = 0; i < cur.length; i++) {
      if (Math.abs(cur[i] - prev[i]) > umbral) cambiados++
    }
    const frac = cambiados / cur.length
    if (frac >= (Number(cfg.banner_sensibilidad) || 0.12)) {
      const cd = (Number(cfg.banner_cooldown_seg) || 6) * 1000
      if (now - this.lastAlert >= cd) {
        this.lastAlert = now
        return true
      }
    }
    return false
  }
}

module.exports = { BannerDetector }
