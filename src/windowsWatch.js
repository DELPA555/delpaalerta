'use strict'
// Monitoreo de ventanas esperadas (ej. "cargas 1".."cargas 4", "Retiros").
// Para cada título: verifica si existe, si está minimizada y si está en primer
// plano, enumerando las ventanas de nivel superior vía PowerShell/Win32 (sin
// dependencias nativas). Si una ventana falta o queda minimizada más de
// `ventanas_umbral_seg`, dispara una alerta distinta que se repite mientras
// persista. Al restaurarse, se resetea y se loguea la recuperación.
const { execFile } = require('child_process')

const PS = `
$ErrorActionPreference='Stop'
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinEnum {
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  delegate bool EnumProc(IntPtr h, IntPtr l);
  public static string List() {
    IntPtr fg = GetForegroundWindow();
    StringBuilder outp = new StringBuilder();
    EnumWindows((h,l)=>{
      if(!IsWindowVisible(h)) return true;
      int len=GetWindowTextLength(h); if(len==0) return true;
      StringBuilder t=new StringBuilder(len+1); GetWindowText(h,t,t.Capacity);
      string title=t.ToString().Replace("\t"," ").Replace("\n"," ");
      outp.Append(title).Append("\t").Append(IsIconic(h)?"1":"0").Append("\t").Append(h==fg?"1":"0").Append("\n");
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
      { windowsHide: true, timeout: 12000, maxBuffer: 1 << 20 },
      (err, stdout) => {
        if (err) return resolve(null) // no se pudo enumerar
        const rows = String(stdout)
          .split('\n')
          .map((l) => l.split('\t'))
          .filter((p) => p[0] && p[0].trim())
          .map((p) => ({ title: p[0], min: p[1] === '1', fg: p[2] === '1' }))
        resolve(rows)
      }
    )
  })
}

class WindowsWatcher {
  constructor() {
    this.problemSince = {}
    this.lastAlert = {}
  }

  // cfg + fire(mensaje). No hace nada si no hay títulos configurados.
  async check(cfg, fire) {
    const titulos = Array.isArray(cfg.ventanas_titulos) ? cfg.ventanas_titulos.filter(Boolean) : []
    if (!titulos.length) return
    const wins = await enumWindows()
    if (!wins) return // sin acceso → no molestamos
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

module.exports = { WindowsWatcher, enumWindows }
