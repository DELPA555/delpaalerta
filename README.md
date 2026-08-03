# Delpa Alertas

App de **Windows en segundo plano** que vigila la pantalla y **suena cuando
aparece un mensaje nuevo** (círculo verde de "no leídos" al lado de un contacto,
y —próximamente— banner emergente). Pensada para PCs donde se comparten varias
ventanas de WhatsApp por escritorio remoto sin audio. Se distribuye como
**producto con licencia** (ver más abajo).

Reescrita en **Electron** (antes Python/PyInstaller) para tener
**auto-actualización** por GitHub Releases, igual que el resto de los proyectos.

- Corre oculta, con **ícono en la bandeja** (pausar / elegir sonido / salir).
- Arranca sola al iniciar sesión.
- Se **actualiza sola** desde GitHub (chequea al abrir y cada 6 h, descarga e
  instala sin intervención).

---

## Cómo funciona

1. Captura la pantalla ~1 vez por segundo (`desktopCapturer` de Electron).
2. Detecta el círculo verde por **color + área + redondez** (máscara RGB con
   tolerancia → componentes conexos → filtro por área px² y aspecto 1:1).
   Calibrado: RGB **(121, 228, 170)**, ~**23×23 px**.
3. Sigue cada círculo por **posición** entre frames: si aparece uno **nuevo**,
   alerta.

### Alerta escalonada por tiempo sin atender
Cada círculo mantiene su propio contador desde que apareció. La escala
(`escalada` en el config) es una lista `{segundos, repeticiones}`; al cruzar
cada umbral dispara una tanda con esa cantidad de beeps. Pasado el último
escalón, suma 1 repetición cada 2 minutos. Al atender (desaparece el círculo)
se resetea. Círculos simultáneos escalan independientes.

### Banner emergente (franja superior)
Además del círculo verde, detecta un **banner** que aparece arriba, por **cambio
de píxeles** en esa franja (sin color calibrado aún). Región y sensibilidad
configurables; desactivado por defecto.

### Ventanas perdidas o minimizadas
Vigila una lista de títulos esperados (ej. "cargas 1".."cargas 4", "Retiros"):
si una **falta o queda minimizada** más de X segundos, alerta distinto ("Se
perdió de vista: …") y avisa la recuperación. Configurable; sin títulos = no vigila.

### Respaldo visual si está muteado
Al disparar cualquier alerta, si el **volumen está muteado o por debajo del
umbral**, muestra una ventana roja **always-on-top** (sin robar el foco) + hace
**parpadear la barra de tareas**. Umbral y duración configurables.

### Sólo escala si la PC está inactiva
La escalada extra aplica sólo si no hubo actividad de mouse/teclado por al menos
`segundos_inactividad_para_escalar` (default 20), usando
`powerMonitor.getSystemIdleTime()`. Con actividad reciente → sólo 1 alerta base.

### Sonidos seleccionables
Catálogo con 3 tonos propios royalty-free (`clasico`, `doble`, `campana`) + los
sonidos nativos de Windows presentes en `C:\Windows\Media`. Se elige desde el
menú de la bandeja (**Sonido de alerta**, con previsualización al seleccionar).
No se usan tonos de marcas por derechos de autor.

---

## Configuración

`%APPDATA%\Delpa Alertas\config.json` (se crea solo; editable sin recompilar,
los cambios se toman al reiniciar la app). Lo más cómodo es editarlo desde la
ventana **Opciones** (ícono de la bandeja → ⚙ Opciones…):

| Clave | Qué es |
|-------|--------|
| `monitor` | `0/1` = principal, `2` = segundo… |
| `region` | `"pantalla_completa"` o `{top,left,width,height}` (px físicos) |
| `color_rgb_min` / `color_rgb_max` | Rango de verde a detectar |
| `area_min` / `area_max` | Tamaño del círculo en px² |
| `redondez_min` | Aspecto mínimo `min(w,h)/max(w,h)` |
| `intervalo_scan_seg` | Cada cuánto escanea |
| `tolerancia_posicion_px` | Cuánto se puede mover y seguir siendo "el mismo" |
| `sonido` | `"clasico"` / `"doble"` / `"campana"` / `"win:archivo.wav"` |
| `espaciado_repeticiones_ms` | Separación entre beeps (default 300) |
| `escalada` | Lista `[{segundos,repeticiones}, …]` |
| `segundos_inactividad_para_escalar` | Idle mínimo para escalar (default 20) |
| `pausado` | `true` para no alertar |

**Log:** `%APPDATA%\Delpa Alertas\alerta.log` (inicio, alertas, updates y licencia).

### Zonas de exclusión (evitar falsos positivos)

La barra inferior de WhatsApp (íconos Chats/Llamadas/Novedades/Herramientas)
tiene puntos verdes fijos del **mismo color** que el círculo de mensaje nuevo.
**Viene activado por defecto**: excluye la **franja inferior** de cada ventana
espejada, detectándola **sola por su programa** (`scrcpy`/`whatsapp`) — funciona
al actualizar sin configurar nada por PC. Se ajusta desde la ventana **Opciones**
(sección "Detección avanzada") o en `config.json`:

```json
"exclusion_habilitado": true,
"exclusion_procesos": ["scrcpy", "whatsapp"],
"exclusion_zonas_ventana": [ { "top": 0.9, "left": 0, "width": 1, "height": 0.1 } ],
"exclusion_titulos": ["cargas 1", "Retiros"]
```

- `exclusion_procesos`: nombres de programa (sin `.exe`) cuyas ventanas se
  excluyen automáticamente, sin importar el título. Si espejás con otro programa,
  agregá su nombre acá.
- `exclusion_zonas_ventana`: zonas como **fracción del ancho/alto de CADA ventana**
  (0..1); el default excluye la **franja inferior (10%)**. Como es relativo a la
  ventana, **sigue funcionando aunque las ventanas se muevan o cambien de tamaño**.
- `exclusion_titulos`: alternativa por título (si las ventanas no coinciden por
  programa). Vacío = usa `ventanas_titulos`.
- `exclusion_zonas_absolutas`: opcional, zonas fijas en píxeles del frame.
- Los píxeles verdes dentro de estas zonas **no se analizan** → no generan alerta.

## Licencias (producto)

Delpa Alertas se activa con un **código de licencia firmado (ed25519)**. La app
trae solo la clave pública; la privada vive solo en tu máquina
(`licencias/keys/`, gitignored). Al primer uso pide activar; valida firma +
vencimiento y ata la licencia a esa PC. Avisa 7 días antes de vencer, da 3 días
de gracia, y pasada la gracia **detiene la vigilancia** hasta renovar (el cliente
solo pega un código nuevo). Generar una licencia:

```bash
node licencias/generar-licencia.js --cliente "Nombre del Negocio" --meses 6
```

---

## Desarrollo

```bash
npm install
npm run gen-assets   # regenera iconos y wavs (ya vienen commiteados)
npm start            # corre en dev (sin auto-update)
```

## Publicar una versión (auto-update)

Igual que LG Prop:

1. Subí `version` en `package.json`.
2. `set GH_TOKEN=<token con permiso repo>` y `npm run publish:win`.

Publica el instalador + `latest.yml` en **GitHub Releases**
(`DELPA555/delpaalerta`). Las PCs con la app instalada se actualizan solas.

## Instalar en una PC

Descargá `Delpa-Alertas-Setup-<version>.exe` del release y ejecutalo. Queda en
la bandeja y arranca solo al iniciar sesión.
