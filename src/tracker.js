'use strict'
// Motor de alertas: sigue cada círculo verde por posición entre frames y decide
// cuándo y con cuántas repeticiones alertar.
//
//  - Cada círculo tiene su propio contador desde que apareció ininterrumpidamente.
//  - La escala es una lista de reglas { segundos, repeticiones }. Cada vez que el
//    tiempo cruza el umbral de una regla, se dispara UNA tanda con esa cantidad de
//    repeticiones. Pasado el último escalón, se suma 1 repetición cada 120 s.
//  - La escalada (más allá de la 1ª alerta base) sólo aplica si la PC está inactiva
//    (idle >= segundos_inactividad_para_escalar). Con actividad reciente → sólo la
//    alerta base.
//  - Al desaparecer el círculo (atendido), su contador se resetea (se descarta el
//    tracker; si reaparece, vuelve a empezar).
//  - Círculos simultáneos escalan de forma independiente.

const EXTRA_STEP_SEG = 120 // tras el último escalón, +1 repetición cada 2 min

function normalizeRules(escalada) {
  if (Array.isArray(escalada) && escalada.length > 0) {
    return escalada
      .map((r) => ({ segundos: Number(r.segundos) || 0, repeticiones: Math.max(1, Number(r.repeticiones) || 1) }))
      .sort((a, b) => a.segundos - b.segundos)
  }
  // Retrocompatible: sin config de escalada, una sola alerta base.
  return [{ segundos: 0, repeticiones: 1 }]
}

function timeAt(i, rules) {
  if (i < rules.length) return rules[i].segundos
  const last = rules[rules.length - 1]
  return last.segundos + (i - (rules.length - 1)) * EXTRA_STEP_SEG
}

function repsAt(i, rules) {
  if (i < rules.length) return rules[i].repeticiones
  const last = rules[rules.length - 1]
  return last.repeticiones + (i - (rules.length - 1))
}

function batchesDue(elapsedSeg, rules, idleOk) {
  let count = 0
  let i = 0
  // Como los tiempos son crecientes, contamos hasta superar el elapsed.
  while (timeAt(i, rules) <= elapsedSeg && i < 100000) {
    count++
    i++
  }
  if (!idleOk) count = Math.min(count, 1) // sin escalada: sólo alerta base
  return count
}

class AlertEngine {
  constructor() {
    this.trackers = [] // { x, y, firstSeen, fired }
  }

  // blobs: [{x,y}] · now: ms · idleSeconds · cfg
  // Devuelve las tandas a disparar en este tick: [{ reps }]
  update(blobs, now, idleSeconds, cfg) {
    const tol = Number(cfg.tolerancia_posicion_px) || 12
    const tol2 = tol * tol
    const rules = normalizeRules(cfg.escalada)
    const umbralIdle = cfg.segundos_inactividad_para_escalar != null
      ? Number(cfg.segundos_inactividad_para_escalar)
      : 20
    const idleOk = idleSeconds >= umbralIdle

    const usados = new Set()
    const fires = []
    const next = []

    for (let bi = 0; bi < blobs.length; bi++) {
      // Machea el blob con el tracker más cercano no usado dentro de tolerancia
      let best = -1
      let bestd = tol2 + 1
      for (let ti = 0; ti < this.trackers.length; ti++) {
        if (usados.has(ti)) continue
        const t = this.trackers[ti]
        const dx = blobs[bi].x - t.x
        const dy = blobs[bi].y - t.y
        const d = dx * dx + dy * dy
        if (d <= tol2 && d < bestd) {
          bestd = d
          best = ti
        }
      }

      let t
      if (best >= 0) {
        usados.add(best)
        t = this.trackers[best]
        t.x = blobs[bi].x
        t.y = blobs[bi].y
      } else {
        t = { x: blobs[bi].x, y: blobs[bi].y, firstSeen: now, fired: 0 }
      }

      const elapsed = (now - t.firstSeen) / 1000
      const due = batchesDue(elapsed, rules, idleOk)
      if (due > t.fired) {
        const reps = repsAt(t.fired, rules) // dispara la siguiente tanda pendiente
        t.fired += 1
        fires.push({ reps })
      }
      next.push(t)
    }

    // Los trackers no macheados desaparecieron → se descartan (reset del contador)
    this.trackers = next
    return fires
  }

  get activos() {
    return this.trackers.length
  }
}

module.exports = { AlertEngine }
