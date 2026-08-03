'use strict'
// Enumeración de ventanas top-level (título, minimizada, primer plano y BOUNDS)
// vía PowerShell + Win32, sin dependencias nativas. Se usa para:
//   - Feature 6: avisar si una ventana esperada falta o queda minimizada.
//   - Zonas de exclusión: ubicar cada ventana de WhatsApp para excluir su barra
//     inferior de la detección de círculo verde (relativo a cada ventana).
// La enumeración se cachea (refresh() en un timer lento) para no llamar a
// PowerShell en el loop de detección de 1 s.
const { execFile } = require('child_process')

const PS = `
$ErrorActionPreference='Stop'
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinEnum {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr c);
  delegate bool EnumProc(IntPtr h, IntPtr l);
  public static string List() {
    try { SetProcessDpiAwarenessContext((IntPtr)(-4)); } catch {} // per-monitor v2 → coords físicas
    IntPtr fg = GetForegroundWindow();
    StringBuilder outp = new StringBuilder();
    EnumWindows((h,l)=>{
      if(!IsWindowVisible(h)) return true;
      int len=GetWindowTextLength(h); if(len==0) return true;
      StringBuilder t=new StringBuilder(len+1); GetWindowText(h,t,t.Capacity);
      string title=t.ToString().Replace("\t"," ").Replace("\n"," ");
      RECT r; GetWindowRect(h, out r);
      outp.Append(title).Append("\t").Append(IsIconic(h)?"1":"0").Append("\t").Append(h==fg?"1":"0")
          .Append("\t").Append(r.L).Append("\t").Append(r.T).Append("\t").Append(r.R).Append("\t").Append(r.B).Append("\n");
      return true;
    }, IntPtr.Zero);
    return outp.ToString();
  }
}
"@
[WinEnum]::List()
`

function enumWindows() {
  return new Promise((resolve) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', PS],
      { windowsHide: true, timeout: 20000, maxBuffer: 1 << 20 },
      (err, stdout) => {
        if (err) return resolve(null)
        const rows = String(stdout)
          .split('\n')
          .map((l) => l.split('\t'))
          .filter((p) => p[0] && p[0].trim())
          .map((p) => ({
            title: p[0],
            min: p[1] === '1',
            fg: p[2] === '1',
            rect: { left: +p[3] || 0, top: +p[4] || 0, right: +p[5] || 0, bottom: +p[6] || 0 }
          }))
        resolve(rows)
      }
    )
  })
}

// Cache compartida (feature 6 + zonas de exclusión)
let _cache = []
async function refresh() {
  const w = await enumWindows()
  if (w) _cache = w
  return _cache
}
function getCache() {
  return _cache
}

class WindowsWatcher {
  constructor() {
    this.problemSince = {}
    this.lastAlert = {}
  }

  // Usa la cache (no enumera). cfg + fire(mensaje). No hace nada sin títulos.
  check(cfg, fire) {
    const titulos = Array.isArray(cfg.ventanas_titulos) ? cfg.ventanas_titulos.filter(Boolean) : []
    if (!titulos.length) return
    const wins = _cache
    if (!wins || !wins.length) return
    const now = Date.now()
    const umbralMs = (Number(cfg.ventanas_umbral_seg) || 15) * 1000
    const cooldownMs = (Number(cfg.ventanas_cooldown_seg) || 30) * 1000

    for (const esperado of titulos) {
      const needle = String(esperado).toLowerCase()
      const match = wins.find((w) => w.title.toLowerCase().includes(needle))
      const problema = !match || match.min
      if (problema) {
        if (!this.problemSince[esperado]) this.problemSince[esperado] = now
        const dur = now - this.problemSince[esperado]
        if (dur >= umbralMs) {
          const last = this.lastAlert[esperado] || 0
          if (now - last >= cooldownMs) {
            this.lastAlert[esperado] = now
            const motivo = !match ? 'no está abierta' : 'está minimizada'
            fire(`Se perdió de vista: ${esperado} (${motivo})`)
          }
        }
      } else if (this.problemSince[esperado]) {
        require('./logger').log(`[ventanas] Recuperada: ${esperado}`)
        delete this.problemSince[esperado]
        delete this.lastAlert[esperado]
      }
    }
  }
}

module.exports = { WindowsWatcher, enumWindows, refresh, getCache }
