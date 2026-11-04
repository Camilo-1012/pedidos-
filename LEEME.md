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

## Ruta con calles reales (v1.2)

Con internet, la app hace tres cosas:

1. **Ubica cada dirección** en la esquina de su calle con la vía generadora. Usa los datos de OpenStreetMap a través del servicio Overpass, y guarda el resultado en el celular para no volver a buscar la misma dirección.
2. **Calcula los tiempos reales en carro** entre todas las paradas con OSRM, el servidor público de demostración (`router.project-osrm.org`). Con eso ordena la ruta respetando los sentidos de las vías.
3. **Dibuja el recorrido** en un mapa de OpenStreetMap.

**Riesgos a tener en cuenta:**
- Los servicios de Overpass y OSRM son gratuitos, sin garantía de que estén disponibles, y con límites de uso razonable. Si fallan o no hay señal, la app usa sola el orden aproximado.
- Para un uso intensivo o de varias personas, conviene montar un OSRM propio o cambiar a un servicio pago (Google Routes, Mapbox u openrouteservice).
- Si una dirección no aparece en el mapa, su ubicación se estima a partir de puntos de referencia y se marca con borde punteado.
- OSRM no tiene un perfil especial para moto: los tiempos son de carro y no incluyen el trancón.

## Escáner y Waze (v1.4)

- **Escanear:** abre la cámara en vivo y lee el código de barras o el QR de la guía. En Chrome Android usa el lector propio del sistema; si no está, usa ZXing, incluido en la app. Del mismo cuadro lee el texto de la etiqueta para sacar la dirección. Tiene linterna y la opción «Seguir escaneando» para cargar varios paquetes seguidos.
- **Waze:** al marcar **Entregado** se abre Waze con la siguiente parada (se puede apagar). Si la dirección quedó ubicada en su esquina, Waze recibe las coordenadas exactas.
- **Rutas:** se prueba primero el servidor OSRM de FOSSGIS (`routing.openstreetmap.de`) y después el de demostración. Si hay clave, al final se usa openrouteservice (gratis, 59 puntos como máximo). Cada servidor tiene un reintento.

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

## Usuarios y PIN (v1.19)

- Al abrir por primera vez se crea un usuario con nombre y PIN de 4 a 6 números. Ese primer usuario es **administrador** y hereda los pedidos e historial que ya había en el celular.
- El administrador agrega usuarios, les pone un PIN nuevo si lo olvidan, los vuelve administradores o los elimina (botón con el nombre, arriba).
- Cada usuario ve solo sus pedidos, su historial y sus respaldos. La caché de ubicaciones de direcciones se comparte para que la ruta salga más rápido.
- **Bloquear** cierra la cámara y las ventanas abiertas. Al volver a la app se pide el PIN según lo configurado (por defecto, si estuvo fuera más de 15 minutos).
- El PIN no se guarda: se guarda PBKDF2-SHA256 con 150 000 vueltas y sal aleatoria. Tras 5 fallos la app espera 30 s, y la espera se duplica hasta 15 minutos.
- Limitaciones:
  - Los usuarios existen solo en ese celular, porque no hay servidor.
  - El PIN bloquea la app, pero los datos guardados no van cifrados. Alguien con el celular desbloqueado y herramientas de desarrollador podría leerlos. Por eso conviene que el celular tenga su propio bloqueo de pantalla.

## Actualizaciones (v1.20)

- La app revisa si hay versión nueva al volver a ella y cada 30 minutos. También se puede revisar a mano en «Más opciones» → «Buscar actualización».
- Si hay versión nueva, se descarga sola y aparece arriba «Hay una versión nueva (x.y) — Actualizar».
- La app nunca se recarga sola, así que no se pierde una edición a medias. Al tocar «Actualizar» se recarga sin pedir el PIN y conserva la ruta.
- Al publicar cambios: subir `CACHE` en `sw.js` y `APP_VERSION` en `index.html` con el mismo número.

## Buscar por guía, repetidos y revisión del cargue (v1.21)

- **Buscar guía** (barra de abajo o sección Ruta): escaneas el código, o escribes los últimos 4 números, y aparece la parada con los botones Entregado, Waze y Ver en la lista. Si la guía no está en la ruta, la app lo avisa.
- **Paquete repetido**: si se escanea, fotografía o escribe una guía que ya está cargada, la app vibra, muestra en qué parada está y no la agrega otra vez.
- **Revisar cargue**:
  - Muestra el total de paradas y paquetes, y las novedades: dirección sin reconocer, ubicada solo por barrio, fuera de zona, sin guía, o más paquetes que guías.
  - «Verificar paquetes escaneando la guía» deja la cámara abierta: pasas cada paquete al subirlo y la app cuenta los verificados. Los que no tienen guía se confirman con «Lo tengo», y las guías que no están en la ruta quedan listadas aparte.
