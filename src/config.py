"""Configuración y rutas de AlertaPantalla.

El archivo de configuración vive FUERA del ejecutable, en
C:\\ProgramData\\AlertaPantalla\\config.json, para poder ajustarlo sin recompilar.
Si no existe, se crea con los valores de fábrica (DEFAULTS).
"""
import json
import os
import sys

# Carpeta de datos común a todos los usuarios de la PC
DATA_DIR = os.path.join(os.environ.get("ProgramData", r"C:\ProgramData"), "AlertaPantalla")
CONFIG_PATH = os.path.join(DATA_DIR, "config.json")
LOG_PATH = os.path.join(DATA_DIR, "alerta.log")
EXE_NAME = "AlertaPantalla.exe"
EXE_PATH = os.path.join(DATA_DIR, EXE_NAME)

# Carpeta de inicio COMÚN (arranca para cualquier usuario que inicie sesión)
STARTUP_DIR = os.path.join(
    os.environ.get("ProgramData", r"C:\ProgramData"),
    r"Microsoft\Windows\Start Menu\Programs\StartUp",
)
SHORTCUT_PATH = os.path.join(STARTUP_DIR, "AlertaPantalla.lnk")

# ── Valores de fábrica (calibrados sobre una captura real) ────────────────────
# Círculo verde de no leídos: RGB (121, 228, 170), ~23x23 px, aspecto 1:1.
DEFAULTS = {
    "region": "pantalla_completa",     # o {"top":0,"left":0,"width":1920,"height":1080}
    "monitor": 0,                       # 0 = todos los monitores; 1 = principal; 2 = segundo...
    "color_rgb_min": [90, 200, 140],    # (121,228,170) - tolerancia
    "color_rgb_max": [150, 255, 200],   # (121,228,170) + tolerancia
    "area_min": 300,                    # 23x23 disco ≈ 415 px²
    "area_max": 560,
    "redondez_min": 0.75,               # min(w,h)/max(w,h); 1.0 = círculo perfecto
    "intervalo_scan_seg": 1.0,
    "cooldown_alerta_seg": 3.0,
    "beep_frecuencia_hz": 1000,
    "beep_duracion_ms": 400,
    "tolerancia_posicion_px": 12,       # dos blobs se consideran "el mismo" entre frames
}


def ensure_data_dir() -> None:
    os.makedirs(DATA_DIR, exist_ok=True)


def load_config() -> dict:
    """Devuelve la config, creando el archivo con los defaults si no existe.

    Cualquier clave faltante se completa con el default (config a prueba de
    versiones viejas)."""
    ensure_data_dir()
    cfg = dict(DEFAULTS)
    if os.path.isfile(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                user = json.load(f)
            if isinstance(user, dict):
                cfg.update({k: user[k] for k in user})
        except Exception:
            # Config corrupta → se usa la de fábrica sin pisar el archivo del usuario
            pass
    else:
        save_config(cfg)
    return cfg


def save_config(cfg: dict) -> None:
    ensure_data_dir()
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)


def running_exe_path() -> str:
    """Ruta del ejecutable en ejecución (el .exe si está compilado con PyInstaller,
    o el intérprete de Python en desarrollo)."""
    return sys.executable if getattr(sys, "frozen", False) else os.path.abspath(sys.argv[0])


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def is_installed_location() -> bool:
    """True si el proceso actual se está ejecutando desde la carpeta de instalación."""
    try:
        return os.path.normcase(os.path.abspath(running_exe_path())) == os.path.normcase(
            os.path.abspath(EXE_PATH)
        )
    except Exception:
        return False
