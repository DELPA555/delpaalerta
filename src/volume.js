'use strict'
// Lee el volumen maestro y el estado de mute del sistema (Windows Core Audio)
// vía PowerShell, sin dependencias nativas. Si no se puede leer, se comporta
// como si NO estuviera muteado (retrocompatible).
const { execFile } = require('child_process')

const PS = `
$ErrorActionPreference='Stop'
$src=@"
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr n);
  int UnregisterControlChangeNotify(IntPtr n);
  int GetChannelCount(out int c);
  int SetMasterVolumeLevel(float l, Guid g);
  int SetMasterVolumeLevelScalar(float l, Guid g);
  int GetMasterVolumeLevel(out float l);
  int GetMasterVolumeLevelScalar(out float l);
  int SetChannelVolumeLevel(uint i, float l, Guid g);
  int SetChannelVolumeLevelScalar(uint i, float l, Guid g);
  int GetChannelVolumeLevel(uint i, out float l);
  int GetChannelVolumeLevelScalar(uint i, out float l);
  int SetMute(bool m, Guid g);
  int GetMute(out bool m);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int EnumAudioEndpoints(int f, int m, out IntPtr d);
  int GetDefaultAudioEndpoint(int f, int role, out IMMDevice ep);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject {}
public class Audio {
  public static string Read() {
    IMMDeviceEnumerator en=(IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
    IMMDevice dev; en.GetDefaultAudioEndpoint(0,1,out dev);
    Guid iid=typeof(IAudioEndpointVolume).GUID;
    object o; dev.Activate(ref iid,1,IntPtr.Zero,out o);
    IAudioEndpointVolume vol=(IAudioEndpointVolume)o;
    float lvl; vol.GetMasterVolumeLevelScalar(out lvl);
    bool mute; vol.GetMute(out mute);
    return ((int)Math.Round(lvl*100)).ToString()+":"+(mute?"1":"0");
  }
}
"@
Add-Type -TypeDefinition $src
[Audio]::Read()
`

function getVolume() {
  return new Promise((resolve) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', PS],
      { windowsHide: true, timeout: 15000 },
      (err, stdout) => {
        if (err) return resolve({ muted: false, pct: 100, error: true })
        const m = String(stdout).trim().match(/(\d+):([01])/)
        if (!m) return resolve({ muted: false, pct: 100, error: true })
        resolve({ pct: parseInt(m[1], 10), muted: m[2] === '1' })
      }
    )
  })
}

module.exports = { getVolume }
