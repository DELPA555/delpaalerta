'use strict'
// Detección de círculos verdes en un frame BGRA.
//   1) Máscara por rango de color RGB (con tolerancia via config).
//   2) Componentes conexos (flood fill 8-vecinos sobre la máscara).
//   3) Filtro por área (px²) y "redondez" = min(w,h)/max(w,h). Se usa el aspecto
//      del bounding box porque es robusto: el número blanco adentro del círculo
//      recorta el disco verde y bajaría una circularidad por perímetro, pero el
//      recuadro sigue siendo ~1:1.
// Devuelve una lista de centroides { x, y } en coordenadas del frame.

function resolveRegion(cfg, width, height) {
  const r = cfg && cfg.region
  if (r && typeof r === 'object') {
    const x0 = Math.max(0, Math.min(width - 1, r.left | 0))
    const y0 = Math.max(0, Math.min(height - 1, r.top | 0))
    const x1 = Math.max(x0 + 1, Math.min(width, x0 + (r.width | 0)))
    const y1 = Math.max(y0 + 1, Math.min(height, y0 + (r.height | 0)))
    return { x0, y0, x1, y1 }
  }
  return { x0: 0, y0: 0, x1: width, y1: height }
}

// ¿El píxel (x,y) del frame cae dentro de alguna zona de exclusión?
function enExclusion(x, y, ex) {
  for (let i = 0; i < ex.length; i++) {
    const r = ex[i]
    if (x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1) return true
  }
  return false
}

// exclusions: lista de rectángulos { x0, y0, x1, y1 } en coordenadas del FRAME.
// Los píxeles verdes dentro de esas zonas se ignoran (no forman blobs) → filtro
// previo para eliminar falsos positivos (ej. badges fijos de la barra inferior
// de WhatsApp). Es un extra opcional: sin exclusiones, la detección es idéntica.
//
// analisis: lista de rectángulos { x0, y0, x1, y1 } en coordenadas del FRAME.
// Si trae al menos uno, SÓLO se escanean esos rectángulos (inclusión): todo lo
// de afuera se ignora por completo y además baja el costo de CPU (menos píxeles
// recorridos). Las coordenadas de los blobs siguen siendo ABSOLUTAS del frame,
// así que el tracker y la persistencia no cambian. Vacío = escanear toda la
// región (comportamiento histórico). La exclusión se aplica igual, por dentro.
function detect(frame, cfg, exclusions, analisis) {
  const { data, width, height } = frame
  const [rMin, gMin, bMin] = cfg.color_rgb_min
  const [rMax, gMax, bMax] = cfg.color_rgb_max
  const areaMin = cfg.area_min
  const areaMax = cfg.area_max
  const redondezMin = cfg.redondez_min
  const ex = Array.isArray(exclusions) ? exclusions : []
  const hayEx = ex.length > 0

  const { x0, y0, x1, y1 } = resolveRegion(cfg, width, height)
  const rw = x1 - x0
  const rh = y1 - y0
  const mask = new Uint8Array(rw * rh)

  // Franjas verticales a escanear dentro de la región. Sin zonas de análisis es
  // la región entera; con zonas, cada rectángulo recortado a la región (si se
  // solapan, la máscara deduplica sola: marcar dos veces el mismo píxel es inocuo).
  const bandas = []
  const an = Array.isArray(analisis) ? analisis : []
  if (an.length) {
    for (const z of an) {
      const bx0 = Math.max(x0, z.x0 | 0)
      const by0 = Math.max(y0, z.y0 | 0)
      const bx1 = Math.min(x1, z.x1 | 0)
      const by1 = Math.min(y1, z.y1 | 0)
      if (bx1 > bx0 && by1 > by0) bandas.push({ bx0, by0, bx1, by1 })
    }
    if (!bandas.length) return [] // hay zonas pero ninguna cae en la región → nada que analizar
  } else {
    bandas.push({ bx0: x0, by0: y0, bx1: x1, by1: y1 })
  }

  // 1) Máscara (coordenadas locales a la región). La comprobación de exclusión
  //    sólo se hace para píxeles ya verdes (que son pocos), así que es barata.
  for (const band of bandas) {
    for (let y = band.by0; y < band.by1; y++) {
      let o = (y * width + band.bx0) * 4
      let mi = (y - y0) * rw + (band.bx0 - x0)
      for (let x = band.bx0; x < band.bx1; x++, o += 4, mi++) {
        const b = data[o]
        const g = data[o + 1]
        const r = data[o + 2]
        if (r >= rMin && r <= rMax && g >= gMin && g <= gMax && b >= bMin && b <= bMax) {
          if (!hayEx || !enExclusion(x, y, ex)) mask[mi] = 1
        }
      }
    }
  }

  // 2) Componentes conexos por flood fill (8-vecinos). Sólo se visitan píxeles
  //    verdes (que son pocos), así que es rápido.
  const blobs = []
  const stack = new Int32Array(Math.min(rw * rh, 1 << 20))
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== 1) continue
    let sp = 0
    stack[sp++] = start
    mask[start] = 2 // visitado
    let count = 0
    let sumx = 0
    let sumy = 0
    let minx = rw
    let maxx = -1
    let miny = rh
    let maxy = -1
    while (sp > 0) {
      const idx = stack[--sp]
      const lx = idx % rw
      const ly = (idx - lx) / rw
      count++
      sumx += lx
      sumy += ly
      if (lx < minx) minx = lx
      if (lx > maxx) maxx = lx
      if (ly < miny) miny = ly
      if (ly > maxy) maxy = ly
      for (let dy = -1; dy <= 1; dy++) {
        const ny = ly + dy
        if (ny < 0 || ny >= rh) continue
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = lx + dx
          if (nx < 0 || nx >= rw) continue
          const nIdx = ny * rw + nx
          if (mask[nIdx] === 1) {
            mask[nIdx] = 2
            if (sp < stack.length) stack[sp++] = nIdx
          }
        }
      }
    }

    // 3) Filtros
    if (count < areaMin || count > areaMax) continue
    const w = maxx - minx + 1
    const h = maxy - miny + 1
    if (w <= 0 || h <= 0) continue
    const aspecto = Math.min(w, h) / Math.max(w, h)
    if (aspecto < redondezMin) continue

    blobs.push({ x: x0 + sumx / count, y: y0 + sumy / count, area: count, aspect: aspecto })
  }

  return blobs
}

module.exports = { detect }
