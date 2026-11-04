# Ruta de Entregas Bogotá: app instalable (PWA)

Es una app web estática: no tiene backend ni base de datos y no envía datos a ningún servidor. Todo se guarda en el navegador del celular.

## Requisitos

- **HTTPS obligatorio.** Sin HTTPS el navegador no permite instalarla ni usarla sin internet. `localhost` es la única excepción y solo sirve para pruebas.
- **Primera apertura con internet.** La primera vez descarga unos 10 MB: la app y el lector de etiquetas. Después abre sin señal.

## Opción A: GitHub Pages (gratis, recomendada)

1. Crea un repositorio, por ejemplo `ruta-entregas`.
2. Sube el **contenido** de esta carpeta a la raíz del repositorio, incluida la carpeta oculta `.github/`.
3. Entra a Settings → Pages → Build and deployment → Source: **GitHub Actions**.
4. Con cada cambio, GitHub corre las pruebas automáticas y, solo si todas pasan, publica la app en `https://TU-USUARIO.github.io/ruta-entregas/`. El avance se ve en la pestaña **Actions**.

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
2. Sube el mismo número en dos sitios: `CACHE` en `sw.js` (por ejemplo `ruta-v2.0.1`) y `APP_VERSION` en `js/09-arranque.js` (`2.0.1`). Una prueba automática falla si no coinciden.
3. Si agregas un archivo en `js/` o `css/`, inclúyelo en la lista `CORE` de `sw.js`. Si es de `js/`, inclúyelo también en `APP_FILES` de `js/00-acceso.js`. Una prueba revisa ambas listas.
4. Sube los cambios a `main`. GitHub corre las pruebas y publica solo si pasan.

Los celulares descargan la versión nueva en segundo plano y muestran «Hay una versión nueva — Actualizar». Si no subes `CACHE`, siguen con la versión vieja.

## Estructura del código

| Archivo | Qué hace |
|---|---|
| `index.html` | Estructura de las pantallas y ventanas. |
| `css/app.css` | Estilos (tema claro/oscuro, diseño para celular). |
| `js/00-acceso.js` | Usuarios y PIN. Carga el resto de la app solo después de entrar. |
| `js/01-direcciones.js` | Almacenamiento y lectura de direcciones de Bogotá y de etiquetas. |
| `js/02-ruta.js` | Estado de la jornada y optimización del orden. |
| `js/03-mapas.js` | Ubicación en el mapa, ubicaciones aprendidas, barrios, calles reales y zona de trabajo. |
| `js/04-jornada.js` | Comparación de órdenes, historial y reporte del día. |
| `js/05-pantalla.js` | Mapa, Waze/Maps, lista de paradas y ventanas de edición. |
| `js/06-escaner.js` | Lector de texto (OCR) y escáner de códigos. |
| `js/07-cargue.js` | Buscar por guía, repetidos, revisión y orden de cargue. |
| `js/08-voz.js` | Dictado por voz. |
| `js/09-arranque.js` | Botones generales, respaldo, actualizaciones y arranque. |
| `js/10-conduccion.js` | Modo conducción. |
| `js/11-equipo.js` | Equipo en la nube (Supabase). |
| `supabase/equipo.sql` | Tablas y reglas de seguridad de Supabase. |
| `sw.js` | Service worker: uso sin señal, actualizaciones y mapas guardados. |
| `tests/` | Pruebas automáticas (no se publican). |

Los archivos de `js/` se cargan en ese orden y comparten variables globales: son scripts clásicos, no módulos ES. Así la app abre sin herramientas de compilación.

## Pruebas automáticas

Simulan un Pixel 7 con Chromium. Los servicios de mapas y rutas se simulan, así que no dependen de internet. Cubren:

- PIN, usuarios y bloqueo;
- lectura de direcciones y etiquetas;
- ruta, zona y entregas;
- buscar por guía, guías repetidas y revisión del cargue;
- escáner con cámara simulada;
- ubicaciones aprendidas;
- Excel del historial;
- diseño a 320, 360 y 412 px;
- uso sin señal;
- coincidencia de versiones.

Para correrlas en un computador:

```
npm ci
npx playwright install chromium
npx playwright test
```

La prueba de mapas sin señal necesita la variable `PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1`. Las pruebas de cámara necesitan `ffmpeg`.

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
- Al publicar cambios: subir `CACHE` en `sw.js` y `APP_VERSION` en `js/09-arranque.js` con el mismo número.

## Buscar por guía, repetidos y revisión del cargue (v1.21)

- **Buscar guía** (barra de abajo o sección Ruta): escaneas el código, o escribes los últimos 4 números, y aparece la parada con los botones Entregado, Waze y Ver en la lista. Si la guía no está en la ruta, la app lo avisa.
- **Paquete repetido**: si se escanea, fotografía o escribe una guía que ya está cargada, la app vibra, muestra en qué parada está y no la agrega otra vez.
- **Revisar cargue**:
  - Muestra el total de paradas y paquetes, y las novedades: dirección sin reconocer, ubicada solo por barrio, fuera de zona, sin guía, o más paquetes que guías.
  - «Verificar paquetes escaneando la guía» deja la cámara abierta: pasas cada paquete al subirlo y la app cuenta los verificados. Los que no tienen guía se confirman con «Lo tengo», y las guías que no están en la ruta quedan listadas aparte.

## Ubicaciones aprendidas (v1.22)

- Al marcar «Entregado», la app toma una lectura GPS nueva y la guarda como la ubicación real de esa dirección, si se cumple todo esto:
  - el permiso de ubicación ya está concedido (no lo pide en ese momento);
  - la precisión es de ±50 m o mejor;
  - la lectura es posterior al toque;
  - queda a menos de 400 m de donde la app ubicaba la dirección, u 800 m si solo era estimada.
- Cuando esa dirección vuelve a llegar, se ubica exacta, sin consultar el mapa. Waze recibe las coordenadas y la tarjeta muestra «Ubicación exacta». Cada entrega nueva en el mismo sitio afina el punto con un promedio ponderado por precisión.
- Los usuarios del celular comparten estas ubicaciones. Se guardan solo la dirección y las coordenadas, hasta 3.000 direcciones; las más viejas salen primero.
- Se apaga o se borra en «Más opciones» → «Ubicaciones aprendidas».

## Orden de cargue y mapas sin señal (v1.23)

- **Revisar cargue → Orden para acomodar en el vehículo**: la lista va al revés de la ruta. Lo último en entregarse va al fondo y la parada 1 queda a la mano. Muestra el número grande de parada para escribirlo en cada paquete.
- **Mapas sin señal**:
  - El mapa guarda los cuadros de calles que ya se vieron, hasta unos 2.000 (≈ 40 MB). Se reusan durante 7 días; sin señal se usan aunque sean más viejos.
  - Las condiciones de uso de OpenStreetMap prohíben descargar zonas completas por adelantado, por eso solo se guarda lo visto.
  - Se borran en «Más opciones».

## Versión 2.0

- El código quedó dividido en archivos por tema (ver «Estructura del código»).
- Hay pruebas automáticas que corren en GitHub antes de publicar.
- La página y sus archivos salen siempre de la versión instalada, así que nunca se mezcla una página nueva con código viejo. Lo nuevo llega con el botón «Actualizar».
- «Buscar guía» deja escribir el número aunque el celular no dé permiso de cámara.

## Versión 2.1

- **Modo conducción** (botón en la sección Ruta):
  - Muestra la parada actual en letra grande y cuatro botones grandes: Waze, Llamar, No estaba y Entregado. Al entregar pasa sola a la siguiente.
  - Con «Anterior» y «Siguiente» se revisan otras paradas sin cambiar el orden.
  - La pantalla no se apaga mientras está abierto. El botón Atrás de Android lo cierra, y si se cierra la app estando en este modo, vuelve a abrir en él.
- **Ritmo del día**, bajo los totales:
  - Paquetes por hora, minutos por parada y hora estimada de terminar.
  - La hora estimada se calcula como: última entrega + paradas que faltan × minutos por parada. Antes de la segunda entrega usa el tiempo de manejo de la ruta más 5 minutos por parada.
  - En el historial: paquetes por hora de cada día, barras de las últimas 14 jornadas, promedio y mejor día.
- **El respaldo incluye el historial.**
  - El archivo nuevo lleva la jornada, los ajustes y el historial.
  - Al restaurar, el historial se junta con el que ya hay sin duplicar días; si un día está en ambos, queda la versión más completa.
  - Los respaldos viejos se siguen pudiendo restaurar.

## Equipo en la nube con Supabase (v2.2)

Cada persona sincroniza **su** ruta. El administrador ve la ruta y el avance de las demás y puede reasignar paradas.

**Configuración, una sola vez, en Supabase:**
1. Authentication → Users → Add user: crear un usuario por persona, con «Auto confirm».
2. Authentication → Sign In / Providers (o Settings): **desactivar «Allow new users to sign up»**, para que nadie más cree cuentas.
3. SQL Editor → pegar `supabase/equipo.sql`, cambiar los correos y nombres del final y correrlo (**Run**). Crea las tablas, las reglas de seguridad (RLS) y el equipo.

**En cada celular:** Más opciones → «Equipo en la nube» → correo y contraseña de esa persona.

**Cómo funciona:**
- Sincroniza cada 30 s mientras la app está abierta, al volver a ella, 4 s después de cada cambio y al volver la señal. Sin señal, los cambios esperan.
- Sube dirección, guía, apto, nombre, teléfono, notas y estado. **No sube** el texto completo leído de la etiqueta.
- **Reglas RLS:**
  - cada persona ve y cambia solo sus paradas;
  - el administrador ve las de todos y reasigna;
  - una cuenta que no esté en `equipo_miembros` no ve nada, aunque tenga la clave pública.
- La clave pública (`sb_publishable_…`) va en `js/11-equipo.js` y está hecha para ser pública. La clave **secret** o **service_role** nunca debe ir en la app.
- Si dos celulares cambian la misma parada a la vez, gana el último en sincronizar.
- Las paradas borradas se marcan como `deleted` para que el otro celular se entere. El script trae una consulta opcional para limpiarlas después de 30 días.
- **Ley 1581:** son datos personales de clientes guardados por un tercero (Supabase, servidores en EE. UU.). Úsalos solo para la entrega y confirma que la empresa o plataforma lo permite.

## Supabase siempre activo (v2.2)

El plan gratis de Supabase pausa el proyecto tras unos 7 días sin uso. Para evitarlo, GitHub corre cada 3 días la tarea **«Supabase activo»** (`.github/workflows/supabase-activo.yml`), que llama a la función `ping()`. Esa función solo devuelve la hora del servidor y no toca datos.

- **Una vez:** pegar `supabase/ping.sql` en Supabase → SQL Editor → Run.
- Si la tarea sale en rojo en **Actions**, el proyecto probablemente está pausado: en supabase.com toca **Restore project**.
- GitHub desactiva las tareas programadas si el repositorio pasa 60 días sin cambios. Avisa por correo; se reactiva en Actions → «Supabase activo» → **Enable workflow**.
