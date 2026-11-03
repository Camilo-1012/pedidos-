# Ruta de Entregas Bogotá: app instalable (PWA)

Es una app web estática: no tiene backend ni base de datos y no envía datos a ningún servidor. Todo se guarda en el navegador del celular.

## Requisitos

- **HTTPS obligatorio.** Sin HTTPS el navegador no permite instalarla ni usarla sin internet. `localhost` es la única excepción y solo sirve para pruebas.
- **Primera apertura con internet.** La primera vez descarga unos 10 MB: la app y el lector de etiquetas. Después abre sin señal.

## Opción A: GitHub Pages (gratis, recomendada)

1. Crea un repositorio, por ejemplo `ruta-entregas`.
2. Sube el **contenido** de esta carpeta a la raíz del repositorio: `index.html`, `sw.js`, `manifest.webmanifest`, `.htaccess` y las carpetas `fonts/`, `icons/` y `ocr/`.
3. Entra a Settings → Pages → Source: *Deploy from a branch* → `main` / `(root)` → Save.
4. En uno o dos minutos queda publicada en `https://TU-USUARIO.github.io/ruta-entregas/`.

El repositorio es público, pero solo contiene el código. Los datos de clientes nunca salen del celular.

## Opción B: hosting propio (cPanel, Apache)

1. Sube la carpeta con el Administrador de archivos o por FTP, por ejemplo a `public_html/ruta/`.
2. Activa el SSL (AutoSSL o Let's Encrypt) y fuerza HTTPS.
3. El archivo `.htaccess` incluido ya configura los tipos MIME y evita que el navegador guarde una copia vieja de `sw.js`.
   - En Nginx, agrega `application/manifest+json webmanifest;` a `mime.types` y configura `Cache-Control: no-cache` para `sw.js`.

## Instalar en el celular

### Android (Chrome)
1. Abre la URL.
2. Toca el botón **Instalar** de la app, o en el menú ⋮ elige **Instalar app**.
3. Ábrela desde el ícono «Ruta».

### iPhone (Safari)
1. Abre la URL.
2. Toca Compartir → **Agregar a pantalla de inicio**.

## Publicar cambios

1. Edita los archivos.
2. En `sw.js` sube el número de `CACHE` (por ejemplo `ruta-v1.0.1`), y en `index.html` el de `APP_VERSION`.
3. Sube los archivos de nuevo.

Al abrir la app, el celular detecta la versión nueva y avisa que hay que cerrarla y volver a abrirla. Si no subes `CACHE`, los celulares siguen usando la versión vieja.

## Datos y privacidad (Ley 1581 de 2012)

- La lista vive en el almacenamiento local del navegador (`localStorage`). La app pide almacenamiento persistente para que Android no la borre cuando falte espacio.
- Si borras los datos del navegador o desinstalas la app, la lista se pierde. Usa **Guardar respaldo** si necesitas conservarla.
- El respaldo `.json` contiene nombres, teléfonos y direcciones de clientes. No lo compartas, y bórralo de Descargas cuando ya no lo necesites.
- Usa **Nueva jornada** al terminar cada día.

## Limitaciones conocidas

- **El orden es aproximado.** Se calcula con la cuadrícula de calles y carreras, no con el mapa vial: no tiene en cuenta sentidos de las vías, humedales ni cierres.
- **Algunas direcciones no se ubican.** Las de nombre de avenida (por ejemplo «Av. Boyacá») o rurales quedan al final marcadas como «Revisar».
- **La lectura de fotos tiene sus límites.** Funciona en el celular con Tesseract 5. Si la foto es borrosa, la etiqueta está arrugada o hay poca luz, puede fallar; en ese caso usa Google Lens → Copiar texto → «Pegar texto».
- **Archivo del lector modificado.** `ocr/worker.min.js` es tesseract.js 5.1.1 con un cambio de una línea, que corrige el bug que impedía cargar el idioma desde memoria (`t.data` → `t.code` en `initialize`). Si actualizas tesseract.js, revisa si sigue haciendo falta.
- **Waze y Maps necesitan señal**, aunque la app funcione sin ella.

## Licencias

- tesseract.js: Apache-2.0.
- Modelo de español `tessdata`: Apache-2.0.
- Fuentes Barlow: SIL OFL 1.1 (ver `fonts/OFL-Barlow.txt`).
