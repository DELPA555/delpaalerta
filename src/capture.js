'use strict'
// Captura de pantalla usando el desktopCapturer nativo de Electron (sin binarios
// externos). Devuelve el frame en crudo (BGRA) a resolución física para que la
// calibración de tamaño (~23x23 px) coincida con la captura real del usuario.
const { desktopCapturer, screen } = require('electron')

// Elige la pantalla a capturar según config.monitor (0 = principal).
function pickDisplay(monitorIdx) {
  const displays = screen.getAllDisplays()
  const primary = screen.getPrimaryDisplay()
  if (!monitorIdx || monitorIdx <= 0) return primary
  const i = monitorIdx - 1
  return displays[i] || primary
}

// Captura la pantalla elegida. Devuelve { data: Buffer(BGRA), width, height } o null.
async function grab(monitorIdx) {
  const display = pickDisplay(monitorIdx)
  const scale = display.scaleFactor || 1
  const width = Math.round(display.size.width * scale)
  const height = Math.round(display.size.height * scale)

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height }
  })
  if (!sources.length) return null

  // Machea la fuente con el display elegido (por display_id); si no, la primera.
  let src = sources.find((s) => String(s.display_id) === String(display.id))
  if (!src) src = sources[0]

  const img = src.thumbnail
  if (!img || img.isEmpty()) return null
  const size = img.getSize()
  return { data: img.toBitmap(), width: size.width, height: size.height }
}

// Igual que grab() pero devuelve el nativeImage completo (para el calibrador:
// dataURL para mostrar + tamaño). Devuelve { image, width, height } o null.
async function grabImage(monitorIdx) {
  const display = pickDisplay(monitorIdx)
  const scale = display.scaleFactor || 1
  const width = Math.round(display.size.width * scale)
  const height = Math.round(display.size.height * scale)
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height }
  })
  if (!sources.length) return null
  let src = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0]
  const img = src.thumbnail
  if (!img || img.isEmpty()) return null
  const size = img.getSize()
  return { image: img, width: size.width, height: size.height }
}

// Origen (en píxeles físicos) del display capturado + su factor de escala.
// Sirve para pasar coordenadas de pantalla (GetWindowRect) a coordenadas del
// frame capturado: frameX = screenX - offX.
function captureOrigin(monitorIdx) {
  const d = pickDisplay(monitorIdx)
  const s = d.scaleFactor || 1
  return { offX: Math.round(d.bounds.x * s), offY: Math.round(d.bounds.y * s), scale: s }
}

module.exports = { grab, grabImage, captureOrigin }
