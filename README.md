# AlertaPantalla

Vigila la pantalla y **suena un beep cuando aparece un círculo verde de "no
leídos" nuevo** (el que muestra la app de escritorio remoto / WhatsApp Web al
lado de un contacto). Pensado para PCs de casino online donde la app espejada
no tiene aviso de sonido.

Es **un solo `.exe`** que hace todo: se instala, se autoarranca para todos los
usuarios, vigila, y se puede recalibrar y desinstalar.

---

## 1. Compilar el ejecutable (una sola vez, en tu PC de desarrollo)

Necesitás Python instalado **solo en la máquina donde compilás** (no en las PCs
destino). Doble click en:

```
build.bat
```

Genera **`dist\AlertaPantalla.exe`** (standalone, sin ventana de consola).

## 2. Instalar en cada PC (una por turno/puesto)

Copiá `AlertaPantalla.exe` a la PC y **hacé doble click**. Va a preguntar si
querés instalarlo; aceptá el aviso de administrador (UAC). Eso:

- Copia el `.exe` a `C:\ProgramData\AlertaPantalla\`
- Crea el arranque automático para **todos los usuarios**
  (`...\Start Menu\Programs\StartUp\AlertaPantalla.lnk`)
- Deja el programa **corriendo ya mismo**
- Crea la config de fábrica en `C:\ProgramData\AlertaPantalla\config.json`

Desde ese momento arranca solo cada vez que alguien inicia sesión, sin abrir nada.

> También podés instalar sin doble click con:  `AlertaPantalla.exe --instalar`

## 3. Recalibrar el color (si cambia el diseño)

```
AlertaPantalla.exe --calibrar
```

Saca una captura real; **hacé click** sobre el círculo verde para ver su RGB
exacto (te sugiere el rango para el config), o **arrastrá** para marcar una
región a vigilar. `Esc` para salir. Después pegá los valores en `config.json`.

## 4. Ajustar sin recompilar

Editá `C:\ProgramData\AlertaPantalla\config.json`:

| Clave | Qué es |
|-------|--------|
| `region` | `"pantalla_completa"` o `{"top":..,"left":..,"width":..,"height":..}` |
| `monitor` | `0` = todos, `1` = principal, `2` = segundo… |
| `color_rgb_min` / `color_rgb_max` | Rango de verde a detectar (calibrado: 121,228,170) |
| `area_min` / `area_max` | Tamaño del círculo en px² (23×23 ≈ 415) |
| `redondez_min` | Aspecto mínimo `min(w,h)/max(w,h)` (1.0 = círculo perfecto) |
| `intervalo_scan_seg` | Cada cuánto escanea (~1 s) |
| `cooldown_alerta_seg` | Mínimo entre alertas (anti-loop) |
| `beep_frecuencia_hz` / `beep_duracion_ms` | Tono y duración del beep |
| `tolerancia_posicion_px` | Cuánto se puede mover un círculo y seguir siendo "el mismo" |

Los cambios se toman al reiniciar el programa (o la sesión).

## 5. Log

`C:\ProgramData\AlertaPantalla\alerta.log` — fecha/hora de inicio y de cada alerta.

## 6. Desinstalar

```
AlertaPantalla.exe --desinstalar
```

Quita el arranque automático, corta el proceso y borra `C:\ProgramData\AlertaPantalla`.

---

## Notas técnicas

- Captura con **mss**, detección con **OpenCV** (máscara por color →
  componentes conexos → filtro por área y aspecto 1:1) y **numpy**.
- Un círculo se considera **nuevo** si su centro no coincide (dentro de
  `tolerancia_posicion_px`) con ninguno del frame anterior. Si a un contador
  existente solo le sube el número (mismo lugar), no vuelve a sonar.
- Beep con **winsound** (estándar de Windows, sin dependencias).
- El `.exe` guarda una sola instancia activa (mutex) para no duplicar el beep.
