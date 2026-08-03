'use strict'
// Verificación de licencias (offline, ed25519). Decodifica el código, valida la
// firma con la clave pública embebida y evalúa vigencia + período de gracia.
const crypto = require('crypto')
const PUBLIC_KEY_PEM = require('../publicKey')

const GRACIA_DIAS = 3
const AVISO_DIAS = 7

// Decodifica y verifica firma. Devuelve el payload o lanza si es inválido.
function parseCode(code) {
  const [b, s] = String(code || '').trim().split('.')
  if (!b || !s) throw new Error('formato')
  const body = Buffer.from(b, 'base64url')
  const sig = Buffer.from(s, 'base64url')
  const ok = crypto.verify(null, body, crypto.createPublicKey(PUBLIC_KEY_PEM), sig)
  if (!ok) throw new Error('firma')
  return JSON.parse(body.toString('utf8'))
}

function diasEntre(a, b) {
  return Math.round((b - a) / 86400000)
}

// Evalúa un código. Devuelve:
//   { ok, funciona, estado, cliente, expira, dias, maxPCs, avisar, mensaje, payload }
// estado ∈ 'activa' | 'gracia' | 'vencida' | 'invalida'
// funciona = true si la app debe operar (activa o gracia)
function evaluar(code) {
  let p
  try {
    p = parseCode(code)
  } catch (_) {
    return { ok: false, funciona: false, estado: 'invalida', mensaje: 'Código de licencia inválido o alterado.' }
  }
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const exp = new Date(p.e + 'T00:00:00')
  const finGracia = new Date(exp)
  finGracia.setDate(finGracia.getDate() + GRACIA_DIAS)
  const base = { ok: true, cliente: p.c, expira: p.e, maxPCs: p.p || null, payload: p }

  if (hoy <= exp) {
    const dias = diasEntre(hoy, exp)
    return {
      ...base, funciona: true, estado: 'activa', dias,
      avisar: dias <= AVISO_DIAS,
      mensaje: dias <= AVISO_DIAS ? `La licencia vence en ${dias} día(s).` : 'Licencia activa.'
    }
  }
  if (hoy <= finGracia) {
    const dias = diasEntre(hoy, finGracia)
    return {
      ...base, funciona: true, estado: 'gracia', dias, avisar: true,
      mensaje: `Licencia vencida — período de gracia: quedan ${dias} día(s). Renová para no interrumpir el servicio.`
    }
  }
  return {
    ...base, funciona: false, estado: 'vencida', dias: 0, avisar: true,
    mensaje: 'Licencia vencida. Ingresá un código nuevo para renovar.'
  }
}

module.exports = { parseCode, evaluar, GRACIA_DIAS, AVISO_DIAS }
