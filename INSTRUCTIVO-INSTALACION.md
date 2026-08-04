# Delpa Alertas — Instructivo de instalación en la PC del cliente

Guía rápida para dejar **Delpa Alertas** andando en una PC nueva (o al conectarte
por escritorio remoto a una ya instalada). Pensado para el caso típico: la persona
mira los WhatsApp por **Google Escritorio Remoto** y no configura nada.

> Tiempo estimado: ~5 minutos. Hacé estos pasos **en una sola sesión de remoto**.

---

## 0. Instalar / actualizar

- **PC nueva:** descargá `Delpa-Alertas-Setup-<versión>.exe` desde
  https://github.com/DELPA555/delpaalerta/releases y ejecutalo. Queda en la
  bandeja y arranca solo al iniciar sesión.
- **PC que ya lo tenía:** se **actualiza sola**. Para forzar la última versión:
  ícono de la bandeja → **Buscar actualizaciones** (esperá unos segundos y se
  reinicia solo).

Verificá la versión en el ícono de la bandeja → arriba dice `Delpa Alertas vX.Y.Z`.

---

## 1. Activar la licencia

1. Generá el código en **tu** PC (si todavía no lo tenés):
   ```
   node licencias/generar-licencia.js --cliente "Nombre del negocio" --meses 12
   ```
   (queda registrado en `licencias/registro.json`).
2. En la PC del cliente: ícono de la bandeja → **🔑 Licencia…**
3. **Pegá el código** y clic en **Activar**.
4. Debe quedar **"Activa"** con el nombre del cliente y la fecha de vencimiento.

> La licencia queda atada a esa PC. Si no la activás, la app **no vigila**.

---

## 2. Marcar las zonas a ignorar (falsos positivos)

La barra inferior de WhatsApp (Chats/Llamadas/Novedades) tiene puntos verdes fijos
del mismo color que un mensaje nuevo. Hay que excluirlos:

1. Ícono de la bandeja → **⚙ Opciones** → abajo, **"🖊 Marcar zonas en pantalla"**.
2. Se abre una captura de la pantalla. **Arrastrá un recuadro sobre cada barrita
   verde** a ignorar (una por cada WhatsApp).
3. **Guardar**. Debe decir **"Guardado ✓ (N)"**.

> Como el acomodo de las ventanas es fijo, se marca **una sola vez**. Si algún día
> se reacomodan, volvés a "Marcar zonas".

---

## 3. (Opcional) Afinar con el modo diagnóstico

Si seguís viendo alertas sin mensaje real:

1. Opciones → tildá **"Modo diagnóstico"** → **Guardar cambios**.
2. Opciones → **Ver log** (o `%APPDATA%\Delpa Alertas\alerta.log`).
3. Mirá las líneas `[diag] blob nuevo …`:
   - Coordenadas en la **franja inferior** con `enZonaExclusion=false` → la zona no
     está bien puesta ahí → re-marcala (paso 2).
   - Si sigue alertando con `enZonaExclusion=true` → avisame, es otra cosa.
4. Cuando quede fino, **destildá** el diagnóstico (para no llenar el log).

---

## 4. Probar

- Mandá un mensaje real a uno de los WhatsApp y confirmá que **suena**.
- Si el sonido no se escucha, en Opciones probá otro **sonido** y revisá que el
  **volumen** de la PC no esté muteado (si lo está, aparece un aviso visual rojo).

---

## Ajustes útiles (Opciones o `%APPDATA%\Delpa Alertas\config.json`)

| Qué | Dónde |
|-----|-------|
| Sonido de alerta | Opciones → Sonido |
| Color del círculo (si el remoto lo altera) | Opciones → "Elegir color de la pantalla" |
| Escalada / repeticiones por tiempo sin atender | Opciones → Alertas y escalada |
| Sensibilidad a falsos positivos | `persistencia_seg` (2.5) y `tolerancia_posicion_px` (16) |
| Zonas a ignorar | Opciones → "Marcar zonas en pantalla" |

**Log:** `%APPDATA%\Delpa Alertas\alerta.log` · **Config:** `…\config.json`

---

## Problemas frecuentes

- **"No vigila / no suena nada"** → ¿licencia activada? (paso 1). ¿Está en pausa?
  (bandeja → Reanudar).
- **"Suena de la nada"** → marcar/re-marcar zonas (paso 2) y usar el diagnóstico
  (paso 3). Desde v1.7.0 el parpadeo por compresión ya no dispara falsas.
- **"No detecta los mensajes reales"** → recalibrar el color (el remoto puede
  cambiarlo un poco): Opciones → "Elegir color de la pantalla".
- **Renovar licencia** → sólo pegar el código nuevo en 🔑 Licencia. No reinstalar.
