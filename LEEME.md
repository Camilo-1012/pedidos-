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
| `js/12-aviso.js` | Aviso a los próximos clientes (WhatsApp/SMS con hora) y «Parquea una vez». |
| `js/13-buscar.js` | Buscar pedido por dirección (completa o parcial), guía, nombre, teléfono o conjunto. |
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

## Guías para paradas dictadas o pegadas (v2.3)

- Al terminar de **dictar o pegar varias direcciones**, la app pregunta si quieres escanear las guías. Muestra arriba, en grande, la parada que sigue («Parada 1: Calle 145 # 103B-90 · Paquete 1 de 2»), y al escanear el código de barras o QR de ese paquete pasa sola a la siguiente.
  - **«Paquete que tienes en la mano»:** si tienes otro paquete, eliges su dirección en la lista.
  - **Foto del código**, si no lo lee en vivo; **escribir la guía**; o **Saltar este**.
  - Rechaza una guía que ya esté en otra parada. Una parada con 2 paquetes pide 2 guías.
- También se llega desde el botón **+ Guía** de cada parada que le falte y desde **Revisar cargue → Escanear guías faltantes**.
- Si escaneas la **etiqueta completa** de un paquete cuya dirección ya está dictada y sin guía, la guía se **agrega a esa parada**, en vez de sumar un paquete más.

## Versión 2.4

- **Modo conducción:**
  - Muestra el **número de pedido** (guía) en grande con la etiqueta «Pedido», o «Pedidos» si son varios paquetes. Si a la parada le falta, el botón «+ Escanear número de pedido» lo escanea ahí mismo.
  - Arriba dice «Parada N de total».
  - **Llamar** abre el marcador del teléfono con el número listo. Acepta celular, fijo con indicativo (601…) y fijo de 7 dígitos. Si la parada no tiene teléfono, lo pide, lo guarda y marca.
- **Salida a ruta:** se registra la primera vez que se abre el modo conducción o se toca «Usar mi ubicación actual».
- **Excel por pedido:**
  - Columnas nuevas: Salida a ruta, Duración de la ruta (h:mm), Acumulado entregados y Tiempo desde la salida.
  - Al final de cada jornada, una fila **TOTAL DEL DÍA** con entregados, no entregados, pendientes y duración. Al final del archivo, **TOTAL GENERAL**.
  - La duración se mide desde la salida hasta la última entrega. Si no hubo salida registrada, desde la primera entrega.
- **Excel resumen:** columnas de salida y duración, y fila TOTAL.

## Acumulado y pagos (v2.5)

- **Fórmula: Valor = paquetes entregados × valor por paquete.** Por defecto es **$1.600**. Los no entregados no suman.
- Se abre con **Más opciones → Acumulado y pagos** o tocando la línea de ritmo bajo los totales, que ahora empieza con «Hoy N paq = $ …».
- Muestra domicilios (paradas), paquetes y valor de **hoy, esta semana (lunes a domingo), este mes, el mes anterior y el total general**, y una tabla por mes con los días trabajados.
- **Excel por mes:** mes, días trabajados, domicilios, paquetes entregados y no entregados, valor y una fila TOTAL.
- **Excel por pedido:** columnas «Valor ($)» y «Valor acumulado ($)», y el valor en TOTAL DEL DÍA y TOTAL GENERAL. El **Excel resumen** agrega el valor por paquete y el valor del día.
- **El valor por paquete se puede cambiar** y aplica desde hoy: cada día guarda el valor que tenía.
- **El acumulado no se borra** con los 90 días del historial. Se guarda un resumen por día (fecha, paquetes, paradas, no entregados y valor) que va en el respaldo. Es por usuario de la app.
- Si se toca «Deshacer» en una entrega, el acumulado baja.

### Ajuste v2.5.1: todo se cuenta por pedido

Cada pedido (guía o paquete) cuenta por separado, aunque vayan varios a la misma dirección.
- **Acumulado y pagos:** muestra pedidos entregados, no entregados y valor (pedidos entregados × valor por pedido).
- **Historial:** pedidos entregados, pedidos por hora, y la efectividad sobre pedidos.
- **Excel resumen:** los pedidos van primero y las direcciones aparte.
- **Modo conducción:** dice «3 pedidos en esta dirección».

### Ajuste v2.5.2: pantalla dividida

Con alto de 600 px o menos (pantalla dividida con Waze, ventana flotante o celular acostado):
- la cabecera se compacta y deja de estar fija, así que se va al bajar por la lista;
- los botones y la barra inferior se achican;
- el modo conducción pone los cuatro botones en una fila;
- el teclado del PIN se reduce.

Hay pruebas a 412×360, 412×300 y 780×360.

## Teléfono más rápido (v2.6)

- **Por voz, opcional:** al dictar una o varias direcciones, después de la dirección se puede decir «teléfono» (o «celular», «tel», «WhatsApp») y el número.
  - Sin la palabra también funciona si el número del final forma un celular (3 + 9 dígitos) o un fijo (601…); conviene hacer una pausa.
  - Si no se dice ningún número, la parada queda sin teléfono, como antes.
  - Un número incompleto queda marcado como «(revisar teléfono …)».
- **Al escanear la guía** (Escanear guías): si a la parada le falta el teléfono, la app lee solo los números de la misma etiqueta, hasta 5 s, antes de pasar a la siguiente.
  - Acepta celulares y fijos, y descarta los números que sean parte de la guía.
  - Casilla «Leer también el teléfono si a la parada le falta» para apagarlo; «Saltar este» deja el teléfono y sigue.
- **Llamar en modo conducción:**
  - con teléfono, abre el marcador con el número listo;
  - sin teléfono, el botón dice «Marcar» y abre el marcador vacío, y el número no se guarda en la app.
  - Ninguna app web puede llamar sola: siempre hay que tocar el botón de llamar del celular.

## Cabecera y Ruta desplegable (v2.7)

- **Cabecera:**
  - usuario con ícono, Equipo (si está conectado) y **Bloquear como botón con candado**;
  - **Conducir** destacado en amarillo, que abre el modo conducción;
  - **Nueva jornada** como botón secundario, con borde, para no tocarlo por error.
- **Ruta** es desplegable, como «Más opciones». Cerrada muestra paradas, km y punto de partida. La app recuerda si la dejaste abierta o cerrada.

### Ajuste v2.7.1

«Varias direcciones (pegar o dictar)» también está en **Agregar paquete**, además de «Más opciones».

## Pedidos entregados (v2.8)

Las paradas entregadas salen de la lista principal y pasan a la sección desplegable **«Pedidos entregados (N)»**, que va recogida por defecto. Cerrada muestra cuántas direcciones son y la hora de la última entrega. Abierta deja ver, editar o **Deshacer** cada entrega; al deshacer, la parada vuelve a la lista principal. La app recuerda si la dejaste abierta o cerrada.

## Carro o moto (v2.9)

En **Ruta → Opciones de la ruta → Vehículo** se elige Carro o Moto. Al cambiar, la ruta se reordena.

- **Carro:** el orden evita devolverse y dar vueltas a la manzana. Usa los tiempos de ida y vuelta reales del perfil de carro.
- **Moto:**
  - El servidor gratuito de rutas solo tiene perfil de carro. En moto, devolverse o dar la vuelta en U cuesta poco, así que la diferencia entre ida y vuelta pesa menos: el costo es 25 % el sentido real y 75 % el promedio de ida y vuelta.
  - Cruzar las avenidas grandes cuesta 1 cuadra en vez de 2, también en el orden sin internet.
  - El tiempo de manejo se estima un 15 % menor.
  - Los sentidos de las calles se siguen respetando en Waze; esto solo cambia el orden.
- Es una aproximación, no un perfil oficial de moto. Con el servidor simulado de las pruebas, el orden en moto cambia y su costo en moto queda igual o menor que el del orden de carro.

## Validación del enrutamiento (v2.10)

Medido con el banco de pruebas (`bench/`): un simulador de calles tipo Suba, con sentidos, giros y el rumbo del vehículo en cada parada. Los porcentajes son tiempo adicional sobre la mejor ruta posible.

| Paradas | Con calles reales | Sin internet | Comparado contra |
|---|---|---|---|
| 8 | 0,43 % (máx. 3,3 %) | 1,2 % (máx. 7,8 %) | óptimo exacto |
| 10 | 0,50 % (máx. 3,0 %) | 1,5 % (máx. 5,4 %) | óptimo exacto |
| 25 | 0,41 % (máx. 2,1 %) | 2,6 % (máx. 5,3 %) | referencia de búsqueda exhaustiva |
| 40 | 1,3 % (máx. 2,1 %) | 4,0 % (máx. 4,9 %) | referencia de búsqueda exhaustiva |

**Velocidad** (celular de gama media simulado, CPU ×4 más lenta):

| Paradas | Antes | Ahora |
|---|---|---|
| 30 | 0,4 s | 0,02–0,14 s |
| 60 | 5 s | 0,05 s |
| 99 | 10 s | 0,1 s |

El optimizador ahora arma una tabla de costos una sola vez y calcula cada intento de mejora de forma incremental. Los movimientos son los mismos: vecino más cercano, barridos por franjas, 2-opt y or-opt, y se agregó un 2-opt para ida ≠ vuelta.

**Cambios por la validación:**
- **«No estaba»** se ordena siempre después de las pendientes. Antes, al reordenar podía volver a quedar de siguiente.
- **«Terminar una zona antes de pasar a otra»** se respeta también en el ajuste con calles reales. Antes se podían mezclar zonas.
- **Ruta en curso:** con entregas hechas o salida registrada, un pedido nuevo se inserta en el mejor hueco sin revolver el resto, salvo que reordenar todo ahorre más de 3 %. «Ordenar ruta» y los cambios de opciones sí reordenan todo.
- **Carro / Moto:** el orden es el mismo para los dos. En las pruebas, el ajuste para moto (promediar ida y vuelta, cruzar avenidas más barato) daba rutas igual o peores, porque la moto también respeta los sentidos de las calles y el servidor no informa hacia dónde queda mirando el vehículo. La moto solo cambia el tiempo estimado (≈ 15 % menos).
- Los **sectores entre avenidas** no se fuerzan en el ajuste final: mantenerlos separados costaba ≈ 0,25 % más de tiempo.

**Límites:**
- Es un simulador, no las calles reales de Suba.
- Sin internet el orden es aproximado (2–4 % más).
- El tiempo de entrega en cada puerta, el trancón y los semáforos no se modelan.

## Avisar a los clientes y «Parquea una vez» (v2.11)
- **Avisar** (en la lista y en modo conducción): muestra las 3 próximas entregas con la hora estimada y un botón de **WhatsApp** que abre el chat directo con el número (`wa.me/57…`), **sin guardar el contacto**; el mensaje va escrito, solo se toca Enviar. **SMS** como alternativa. Si no hay teléfono, sale «Agregar teléfono».
- La hora sale del tiempo de manejo + 4 min por entrega; desde la 2.ª entrega del día usa el ritmo real. Al cliente se le da una franja (5 min antes a 10 después, redondeada a 5 min).
- Quien ya fue avisado queda con la marca «Avisado HH:MM» en la lista.
- **Parquea una vez**: entregas seguidas a ≤ 130 m entre sí (o en el mismo conjunto) se agrupan con un encabezado «P» en la lista y un aviso en modo conducción. Tras entregar una, si la siguiente queda cerca, dice «A pie · no muevas el vehículo». No cambia el orden de la ruta.
- **Modo conducción**: el número grande es el **orden de la parada en la ruta** (el mismo de la lista); la guía, si la hay, va debajo. Se corrigió el contador «Parada X de Y», que crecía al avanzar con «Siguiente».
- Limitaciones: el envío por WhatsApp no es automático (exigiría la API de WhatsApp Business, de pago y con servidor); la hora es aproximada; los 130 m son en línea recta. Los teléfonos de los clientes se usan solo para avisar de la entrega (Ley 1581).

### Ajuste v2.11.1
- El mensaje dice «le escribe el domiciliario de Temu». La empresa se cambia en la ventana de Avisar y queda guardada.
- Cada cliente muestra la franja de llegada («llega entre 3:10 y 3:25») y la ventana explica de dónde sale la hora.
- Si WhatsApp responde que el número «no existe en WhatsApp», ese cliente no tiene WhatsApp con ese número: usar SMS.

### Ajuste v2.11.2: dos celulares con la misma cuenta
- Se puede cargar con dos celulares a la vez: los dos se conectan al Equipo con el mismo correo y contraseña de Supabase y las paradas quedan unificadas (se sincroniza cada 30 s, al volver a la app o con «Sincronizar ahora»).
- Desconectar un celular cierra solo su sesión (`logout?scope=local`); antes cerraba la sesión en todos.
- «Empezar jornada nueva» y «Borrar toda la jornada» avisan que también se quitan del otro celular conectado.

### Ajuste v2.11.3: dictado con cifras juntas
- El reconocimiento de voz a veces omite «número» y «guion» y junta las cifras («carrera 150 B 14345»). Ahora se separa solo en «Carrera 150B # 143-45» (placa de 2 cifras; 3 si la vía quedaría mayor que 250). Si aun así no es una dirección, queda en REVISAR como antes.

## Buscar pedido por dirección (v2.12)
- El botón **Buscar** (barra de abajo) y **Buscar pedido** (en Ruta) abren una búsqueda que filtra mientras se escribe o se dicta.
- Sirve la dirección completa en cualquier forma («cra 150b 14345», «KR 150B 143 45») o una parte («calle 145», «106 60»), la guía o sus últimos 4 números, el nombre, el teléfono o el conjunto.
- Muestra primero las pendientes y luego las ya entregadas; al tocar una se puede marcar Entregado, abrir Waze o verla en la lista. «Escanear la guía con la cámara» sigue disponible ahí.
- Solo busca en los pedidos de la jornada de este celular (no en el historial de días anteriores) y no usa internet, salvo para dictar.

## Números fijos y orden estable en ruta (v2.13)
- **Números de parada:** antes de salir siguen el orden de la lista (1, 2, 3…). Desde que se sale (ubicación GPS de salida, modo conducción, primera entrega o «No estaba») cada paquete **conserva su número**: al entregar la 1, la siguiente sigue siendo la 2. Los pedidos nuevos toman el siguiente número libre. «Ordenar ruta» antes de la primera entrega vuelve a numerar todo.
- **Orden del vehículo:** en ruta nada se reordena solo. Al tomar la ubicación GPS, al llegar pedidos nuevos (también desde el otro celular) o con «No estaba», se respeta el orden actual de la lista y lo nuevo se inserta en el mejor hueco. Si reordenar todo ahorra 5 % o más, la app lo avisa en Ruta y el repartidor decide con «Ordenar ruta».
- Antes, tocar «Usar mi ubicación actual» al salir reordenaba toda la ruta desde ese punto y cambiaba el orden con que se había cargado el vehículo.
- **Ubicación actual:** muestra la dirección aproximada («Cerca de Calle 145 # 106-60») y, con internet, el barrio según OpenStreetMap.
- El número de parada es de cada celular (no se sincroniza): escribe los números en los paquetes con el celular con el que vas a conducir.

## El historial no pierde entregas (v2.14)
- **Error corregido:** el resumen de la jornada se rehacía solo con las paradas que había en la lista. Si se quitaban los entregados («Quitar los entregados»), se borraba la jornada, o el otro celular vaciaba la lista (jornada nueva allá), la siguiente entrega reescribía el día y desaparecían del historial, del Excel y del acumulado los pedidos ya entregados. Además, dos jornadas el mismo día usaban el mismo id y la segunda pisaba a la primera.
- Ahora cada pedido del historial guarda el id de su parada: los de paradas que ya no están en la lista se conservan. Cada jornada tiene id propio (fecha + hora de la primera entrega). Si la lista se vació desde otro celular y pasan más de 8 h, lo nuevo va en otra jornada. Deshacer una entrega sí la quita.
- **Recuperar entregas guardadas en la nube** (Historial, con el equipo conectado): reconstruye en el historial y el acumulado los pedidos entregados que estén en Supabase y falten en el celular (desde que se conectó el equipo). No duplica.

## Punto de partida: calle real y dirección escrita (v2.15)
- **Usar mi ubicación actual:** con internet, la app busca en OpenStreetMap la calle y la carrera más cercanas al GPS y muestra «Estás en Carrera 149C con Calle 137 (según el mapa)», con el barrio. Esa calle y carrera se usan como punto de partida en la cuadrícula (orden sin internet y sectores). Antes solo se estimaba con puntos de referencia lejanos y podía quedar a más de 1 km.
- Sin internet se muestra la estimación marcada como «aproximado»; ahora usa también las esquinas ya ubicadas y las direcciones aprendidas cercanas.
- **Dirección escrita:** se valida al escribirla. Si se entiende: «✓ Se usa como punto de partida: …». Si no: «✗ No reconozco…: no se está usando», en rojo.
- Si se escribe (o se toma el GPS) **después** de la última entrega, manda sobre ella. Si la ruta está saliendo de la última entrega, se avisa debajo del punto de partida.

### Ajuste v2.16: dirección completa de la ubicación
- Al tomar la ubicación muestra la dirección según el mapa, con placa: «Estás en Carrera 149C # 137-40». La vía es la más cercana; el número es la vía cruzada de atrás y la placa, los metros desde esa esquina (como se numera en Bogotá), por eso se marca «placa aproximada». Si el mapa (Nominatim) tiene la placa exacta en ese punto sobre la misma vía, se usa esa.
- Esa dirección se usa como punto de partida en la cuadrícula.
