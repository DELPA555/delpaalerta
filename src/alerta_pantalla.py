"""AlertaPantalla — vigila la pantalla y avisa con un beep cuando aparece un
círculo verde de "no leídos" nuevo (que antes no estaba).

Un solo ejecutable, con modos:
  (sin args)      Si está instalado (corre desde ProgramData) → vigila.
                  Si no → ofrece instalarse en esta PC.
  --vigilar       Fuerza el modo vigilancia.
  --instalar      Se copia a ProgramData + inicio para todos + arranca (pide UAC).
  --desinstalar   Limpieza total (pide UAC).
  --calibrar      Herramienta de color/región para recalibrar.
"""
import ctypes
import os
import shutil
import subprocess
import sys
import time
import winsound

import numpy as np
import mss

from config import (
    CONFIG_PATH, DATA_DIR, EXE_NAME, EXE_PATH, SHORTCUT_PATH,
    ensure_data_dir, is_frozen, is_installed_location, load_config, running_exe_path,
)
from logger import get_logger
from deteccion import Detector, bgra_a_rgb

DETACHED = 0x00000008 | 0x08000000  # DETACHED_PROCESS | CREATE_NO_WINDOW
_mutex_handle = None  # se mantiene vivo mientras corre el vigilante


# ── Utilidades Windows ────────────────────────────────────────────────────────
def set_dpi_aware() -> None:
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)  # per-monitor v2
    except Exception:
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass


def es_admin() -> bool:
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def reejecutar_como_admin(extra_args) -> None:
    params = " ".join(extra_args)
    ctypes.windll.shell32.ShellExecuteW(None, "runas", running_exe_path(), params, None, 1)


def _msg(texto: str, titulo: str = "AlertaPantalla", icon: int = 0x40) -> None:
    ctypes.windll.user32.MessageBoxW(0, texto, titulo, icon)


def _preguntar_instalar() -> bool:
    MB_YESNO, MB_ICONQUESTION, IDYES = 0x4, 0x20, 6
    r = ctypes.windll.user32.MessageBoxW(
        0,
        "¿Instalar AlertaPantalla en esta PC?\n\n"
        "Se copia a ProgramData y arranca automáticamente para todos los "
        "usuarios cada vez que inician sesión.",
        "AlertaPantalla", MB_YESNO | MB_ICONQUESTION,
    )
    return r == IDYES


def _ya_corriendo() -> bool:
    """Evita dos vigilantes a la vez (mutex global)."""
    global _mutex_handle
    _mutex_handle = ctypes.windll.kernel32.CreateMutexW(None, False, "Global\\AlertaPantalla_Watch")
    return ctypes.windll.kernel32.GetLastError() == 183  # ERROR_ALREADY_EXISTS


# ── Instalación / desinstalación ──────────────────────────────────────────────
def _crear_acceso_inicio() -> None:
    ps = (
        "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%s');"
        "$s.TargetPath='%s';$s.WorkingDirectory='%s';$s.Description='AlertaPantalla';$s.Save()"
        % (SHORTCUT_PATH, EXE_PATH, DATA_DIR)
    )
    subprocess.run(
        ["powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", ps],
        creationflags=DETACHED, check=False,
    )


def instalar() -> None:
    if not is_frozen():
        _msg("Compilá el .exe primero (build.bat) e instalá ejecutando el .exe.")
        return
    ensure_data_dir()
    src = running_exe_path()
    try:
        if os.path.normcase(os.path.abspath(src)) != os.path.normcase(os.path.abspath(EXE_PATH)):
            shutil.copy2(src, EXE_PATH)
    except Exception as e:
        _msg("No se pudo copiar el ejecutable:\n%s" % e, icon=0x10)
        return
    load_config()  # crea config.json de fábrica si no existe
    _crear_acceso_inicio()
    try:
        subprocess.Popen([EXE_PATH, "--vigilar"], creationflags=DETACHED, close_fds=True)
    except Exception:
        pass
    get_logger().info("Instalado en %s (inicio para todos los usuarios)" % DATA_DIR)
    _msg(
        "AlertaPantalla quedó instalado y funcionando.\n\n"
        "• Arranca solo al iniciar sesión (todos los usuarios).\n"
        "• Configuración editable en:\n  %s\n"
        "• Para recalibrar el color:  AlertaPantalla.exe --calibrar" % CONFIG_PATH
    )


def desinstalar() -> None:
    try:
        if os.path.isfile(SHORTCUT_PATH):
            os.remove(SHORTCUT_PATH)
    except Exception:
        pass
    # Baja las otras instancias (no la actual, para poder terminar la limpieza)
    selfpid = os.getpid()
    os.system('taskkill /f /im "%s" /fi "PID ne %d" >nul 2>&1' % (EXE_NAME, selfpid))
    # Borra la carpeta cuando este proceso termine (no se puede borrar el .exe en uso)
    try:
        subprocess.Popen(
            'cmd /c ping 127.0.0.1 -n 3 >nul & rmdir /s /q "%s"' % DATA_DIR,
            shell=True, creationflags=DETACHED,
        )
    except Exception:
        pass
    _msg("AlertaPantalla se desinstaló de esta PC.")
    sys.exit(0)


# ── Vigilancia ────────────────────────────────────────────────────────────────
def _resolver_region(cfg: dict, sct) -> dict:
    region = cfg.get("region", "pantalla_completa")
    if isinstance(region, dict):
        return {
            "top": int(region["top"]), "left": int(region["left"]),
            "width": int(region["width"]), "height": int(region["height"]),
        }
    idx = int(cfg.get("monitor", 0))
    if idx < 0 or idx >= len(sct.monitors):
        idx = 0
    return sct.monitors[idx]


def vigilar() -> None:
    if _ya_corriendo():
        return
    set_dpi_aware()
    cfg = load_config()
    log = get_logger()
    det = Detector(cfg)
    intervalo = float(cfg["intervalo_scan_seg"])
    cooldown = float(cfg["cooldown_alerta_seg"])
    freq = int(cfg["beep_frecuencia_hz"])
    dur = int(cfg["beep_duracion_ms"])

    prev = []
    ultima_alerta = 0.0
    with mss.mss() as sct:
        region = _resolver_region(cfg, sct)
        log.info("Iniciado. region=%s monitor=%s color=%s..%s area=%s..%s"
                 % (region, cfg["monitor"], cfg["color_rgb_min"], cfg["color_rgb_max"],
                    cfg["area_min"], cfg["area_max"]))
        while True:
            t0 = time.time()
            try:
                frame = np.array(sct.grab(region))
                cur = det.blobs(bgra_a_rgb(frame))
                nuevos = det.nuevos(prev, cur)
                if nuevos and (time.time() - ultima_alerta) >= cooldown:
                    try:
                        winsound.Beep(freq, dur)
                    except Exception:
                        pass
                    ultima_alerta = time.time()
                    log.info("ALERTA: %d círculo(s) verde(s) nuevo(s) en %s"
                             % (len(nuevos), [(int(x), int(y)) for x, y in nuevos]))
                prev = cur
            except Exception as e:
                log.info("Error en el ciclo: %s" % e)
                time.sleep(1.0)
            dt = time.time() - t0
            time.sleep(max(0.05, intervalo - dt))


# ── Entrada ───────────────────────────────────────────────────────────────────
def main() -> None:
    set_dpi_aware()
    args = [a.lower() for a in sys.argv[1:]]

    if "--calibrar" in args:
        from calibrador import run_calibrador
        run_calibrador()
        return
    if "--desinstalar" in args:
        if not es_admin():
            reejecutar_como_admin(["--desinstalar"])
            return
        desinstalar()
        return
    if "--instalar" in args:
        if not es_admin():
            reejecutar_como_admin(["--instalar"])
            return
        instalar()
        return
    if "--vigilar" in args:
        vigilar()
        return

    # Sin argumentos:
    if is_installed_location():
        vigilar()  # lo lanzó el inicio de sesión desde ProgramData
    elif _preguntar_instalar():
        if not es_admin():
            reejecutar_como_admin(["--instalar"])
            return
        instalar()
    else:
        vigilar()  # permite correr "en el lugar" para probar sin instalar


if __name__ == "__main__":
    main()
