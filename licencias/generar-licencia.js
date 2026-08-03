'use strict'
// ─────────────────────────────────────────────────────────────────────────────
// Generador de licencias de "Delpa Alertas" — SOLO PARA EL DUEÑO (no se empaqueta
// con la app). Firma con ed25519 (clave privada local, nunca se distribuye).
// La app trae solo la clave PÚBLICA embebida para verificar.
//
//   node generar-licencia.js --cliente "Nombre del Negocio" --meses 6 [--pcs 3]
//
// - Genera el par de claves la 1ª vez (keys/private.pem + keys/public.pem).
// - Imprime el código de licencia y la clave pública a embeber en la app.
// - Registra la emisión en registro.json.
// ─────────────────────────────────────────────────────────────────────────────
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const KEYS = path.join(__dirname, 'keys')
const PRIV = path.join(KEYS, 'private.pem')
const PUB = path.join(KEYS, 'public.pem')
const REGISTRO = path.join(__dirname, 'registro.json')

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function parseArgs(argv) {
  const a = {}
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2)
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true
      a[k] = v
    }
  }
  return a
}

function ensureKeys() {
  fs.mkdirSync(KEYS, { recursive: true })
  if (!fs.existsSync(PRIV)) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
    fs.writeFileSync(PRIV, privateKey.export({ type: 'pkcs8', format: 'pem' }))
    fs.writeFileSync(PUB, publicKey.export({ type: 'spki', format: 'pem' }))
    console.log('→ Par de claves generado en keys/ (private.pem NUNCA se distribuye).\n')
  }
}

function addMonths(date, months) {
  const d = new Date(date)
  const day = d.getDate()
  d.setMonth(d.getMonth() + months)
  if (d.getDate() < day) d.setDate(0) // clamp fin de mes
  return d
}

function main() {
  const args = parseArgs(process.argv)
  const cliente = args.cliente
  const meses = parseInt(args.meses, 10) || 1
  const pcs = args.pcs ? parseInt(args.pcs, 10) : null
  if (!cliente || cliente === true) {
    console.error('Uso: node generar-licencia.js --cliente "Nombre" --meses 6 [--pcs 3]')
    process.exit(1)
  }

  ensureKeys()
  const priv = crypto.createPrivateKey(fs.readFileSync(PRIV))

  const emitido = new Date()
  const expira = addMonths(emitido, meses)
  // Payload compacto (claves cortas para acortar el código):
  //   c=cliente  i=emitido  e=expira  m=meses  p=maxPCs  n=nonce
  const payload = {
    c: cliente,
    i: emitido.toISOString().slice(0, 10),
    e: expira.toISOString().slice(0, 10),
    m: meses,
    n: crypto.randomBytes(6).toString('hex')
  }
  if (pcs) payload.p = pcs

  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  const sig = crypto.sign(null, body, priv) // ed25519
  const code = `${b64url(body)}.${b64url(sig)}`

  // Registro de emisión
  let reg = []
  try {
    reg = JSON.parse(fs.readFileSync(REGISTRO, 'utf8'))
  } catch (_) {
    reg = []
  }
  reg.push({ cliente, emitido: payload.i, expira: payload.e, meses, maxPCs: pcs || null, nonce: payload.n, code })
  fs.writeFileSync(REGISTRO, JSON.stringify(reg, null, 2))

  console.log('════════════ LICENCIA GENERADA ════════════')
  console.log('Cliente :', cliente)
  console.log('Emitida :', payload.i)
  console.log('Expira  :', payload.e, `(${meses} mes/es)`)
  console.log('Máx PCs :', pcs || 'sin límite')
  console.log('\nCÓDIGO DE LICENCIA (dárselo al cliente):\n')
  console.log(code)
  console.log('\nClave pública a embeber en la app (src/publicKey.js):\n')
  console.log(fs.readFileSync(PUB, 'utf8').trim())
  console.log('\nRegistrado en registro.json (' + reg.length + ' licencia/s).')
}

main()
