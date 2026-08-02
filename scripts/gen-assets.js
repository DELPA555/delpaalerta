'use strict'
// Genera los assets del proyecto (sin dependencias externas):
//   - assets/sounds/{clasico,doble,campana}.wav  (tonos royalty-free propios)
//   - assets/tray.png                             (icono de la bandeja)
//   - build/icon.ico                              (icono del instalador)
// Ejecutar: node scripts/gen-assets.js
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const ROOT = path.join(__dirname, '..')
const SOUNDS = path.join(ROOT, 'assets', 'sounds')
const BUILD = path.join(ROOT, 'build')
fs.mkdirSync(SOUNDS, { recursive: true })
fs.mkdirSync(BUILD, { recursive: true })

// ── WAV (PCM 16-bit mono 44100) ───────────────────────────────────────────────
const SR = 44100
function makeWav(samples) {
  const n = samples.length
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(SR, 24)
  buf.writeUInt32LE(SR * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]))
    buf.writeInt16LE((s * 32767) | 0, 44 + i * 2)
  }
  return buf
}
const fade = (arr, ms) => {
  const f = Math.floor((ms / 1000) * SR)
  for (let i = 0; i < f && i < arr.length; i++) {
    arr[i] *= i / f
    arr[arr.length - 1 - i] *= i / f
  }
  return arr
}
function tono(freq, ms, amp = 0.6) {
  const n = Math.floor((ms / 1000) * SR)
  const a = new Float32Array(n)
  for (let i = 0; i < n; i++) a[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR)
  return fade(a, 8)
}
function silencio(ms) {
  return new Float32Array(Math.floor((ms / 1000) * SR))
}
function concat(...arrs) {
  const total = arrs.reduce((s, a) => s + a.length, 0)
  const out = new Float32Array(total)
  let o = 0
  for (const a of arrs) {
    out.set(a, o)
    o += a.length
  }
  return out
}
function campana(freq, ms, amp = 0.7) {
  const n = Math.floor((ms / 1000) * SR)
  const a = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const env = Math.exp(-4 * t)
    a[i] = amp * env * (Math.sin(2 * Math.PI * freq * t) + 0.5 * Math.sin(2 * Math.PI * freq * 2 * t))
  }
  return fade(a, 5)
}

fs.writeFileSync(path.join(SOUNDS, 'clasico.wav'), makeWav(tono(1000, 320)))
fs.writeFileSync(
  path.join(SOUNDS, 'doble.wav'),
  makeWav(concat(tono(1000, 120), silencio(80), tono(1000, 120)))
)
fs.writeFileSync(path.join(SOUNDS, 'campana.wav'), makeWav(campana(820, 650)))

// ── PNG (RGBA) ────────────────────────────────────────────────────────────────
function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return (~c) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
  return Buffer.concat([len, t, data, crc])
}
function makePNG(size) {
  const w = size
  const h = size
  const rgba = Buffer.alloc(w * h * 4)
  const cx = (w - 1) / 2
  const cy = (h - 1) / 2
  const R = w * 0.46 // radio del círculo
  const borde = Math.max(1.5, w * 0.05)
  const [gr, gg, gb] = [121, 228, 170] // verde calibrado
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - cx, y - cy)
      const o = (y * w + x) * 4
      let r = 0, g = 0, b = 0, a = 0
      if (d <= R) {
        const enBorde = d > R - borde
        r = enBorde ? 70 : gr
        g = enBorde ? 150 : gg
        b = enBorde ? 110 : gb
        a = 255
        // antialias del borde exterior (~1px)
        if (d > R - 1) a = Math.round(255 * (R - d + 1))
      }
      rgba[o] = r
      rgba[o + 1] = g
      rgba[o + 2] = b
      rgba[o + 3] = Math.max(0, Math.min(255, a))
    }
  }
  // scanlines con filtro 0
  const raw = Buffer.alloc(h * (1 + w * 4))
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0
    rgba.copy(raw, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const trayPng = makePNG(32)
fs.writeFileSync(path.join(ROOT, 'assets', 'tray.png'), trayPng)

// ── ICO (envuelve un PNG de 256, soportado por Windows Vista+) ────────────────
const iconPng = makePNG(256)
const icoHeader = Buffer.alloc(6)
icoHeader.writeUInt16LE(0, 0)
icoHeader.writeUInt16LE(1, 2) // tipo icono
icoHeader.writeUInt16LE(1, 4) // 1 imagen
const entry = Buffer.alloc(16)
entry[0] = 0 // width 256 → 0
entry[1] = 0 // height 256 → 0
entry[2] = 0
entry[3] = 0
entry.writeUInt16LE(1, 4) // planes
entry.writeUInt16LE(32, 6) // bpp
entry.writeUInt32LE(iconPng.length, 8)
entry.writeUInt32LE(6 + 16, 12)
fs.writeFileSync(path.join(BUILD, 'icon.ico'), Buffer.concat([icoHeader, entry, iconPng]))

console.log('Assets generados:')
console.log('  assets/sounds/clasico.wav, doble.wav, campana.wav')
console.log('  assets/tray.png (32x32)')
console.log('  build/icon.ico (256x256)')
