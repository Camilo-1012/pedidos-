# Bodega · Recepción, despacho y devoluciones

App web instalable (PWA) para controlar los paquetes de la bodega: qué llegó, qué se lleva cada repartidor, qué devolvió y qué entregó. App hermana de **Ruta de Entregas** (`Camilo-1012/pedidos-`): mismas reglas técnicas (JavaScript vanilla, scripts clásicos, funciona sin señal, PIN con PBKDF2) y mismo proyecto de Supabase, con tablas aparte (`bodega_*`).

## Flujo del día
1. **Recibir** – Se crea un *lote* por cada llegada (empresa, nombre, cantidad esperada opcional). Opcional: se carga el *listado esperado* (pegar o archivo CSV/TXT). Se escanea en ráfaga: la cámara no se cierra, pita y vibra en cada lectura. Las repetidas no cuentan. Indicadores: esperados, recibidos, faltan, fuera del listado.
2. **Despachar** – Se elige el repartidor y se escanea lo que lleva. Antes de cambiar algo, la app pregunta si la guía la tiene otro, si no se recibió o si figura entregada. *Planilla de salida*: en pantalla, impresa, copiada para WhatsApp o en Excel.
3. **Devolver** – El repartidor vuelve, se escanean los no entregados con su motivo y se *cierra la liquidación*: el resto queda **entregado**, **faltante** o **sigue con él**.
4. **Zonas** (v1.1) – El administrador define zonas (☰ → Zonas) con rangos «desde–hasta» de calles y de carreras y un repartidor habitual. Al recibir, la app pide el número de calle y de carrera (sin placa) o se toca la zona; la zona se calcula sola. Se ve en bodega por zona, en el despacho (avisa si el paquete es de la zona de otro repartidor, sin bloquear), en la planilla (agrupada por zona) y en el Excel. Cambiar un rango rezonifica todo.
5. **Consultar** – El recorrido completo de una guía (quién, cuándo, en qué celular), lo que está en bodega y desde cuándo, lo que está en ruta, los conflictos y las novedades, y el resumen del día por repartidor. **Excel del día** en el menú.

Cuadre por repartidor: `asignados = entregados + devueltos + faltantes + siguen en ruta`.

## Cómo guarda los datos
- Cada acción es un **evento** que solo se agrega (`RECIBIDO`, `ASIGNADO`, `DEVUELTO`…). El estado de cada guía se calcula con todos sus eventos, ordenados por la hora real de la lectura. Así, lo leído sin señal en otro celular se acomoda en su lugar al llegar y nada se sobrescribe.
- Para corregir se agrega un `ANULAR` («Deshacer la última»): queda constancia de todo.
- En el celular: IndexedDB. Los paquetes cerrados hace más de 30 días se quitan del celular, pero siguen en la nube.
- Nube: tabla `bodega_eventos` (solo SELECT e INSERT por RLS). Solo un administrador crea o cambia repartidores. Ver `supabase/bodega.sql`.
- **Ley 1581:** solo se guardan guía, empresa, estado, repartidor, fechas y novedades. Nada del cliente.

## Puesta en marcha (una vez)
1. En el repositorio `Camilo-1012/Bodega`: Settings → Pages → Source, elegir «GitHub Actions».
2. En Supabase (proyecto de Ruta de Entregas): crear la cuenta del despacho en Authentication → Users. Cambiar los correos al final de `supabase/bodega.sql` y correrlo en SQL Editor.
3. En cada celular: abrir `https://camilo-1012.github.io/Bodega/`, crear el usuario con PIN, conectar la nube en ☰ → Equipo (nube) y agregar los repartidores en ☰ → Repartidores (con una cuenta de rol `admin`).

## Estructura del código
- `js/00-acceso.js`: PIN y usuarios (adaptado de pedidos-). Carga el resto después de entrar.
- `js/01-base.js`: utilidades, guías, sonido y formulario genérico `pedir()`.
- `js/02-datos.js`: eventos, IndexedDB y cálculo del estado (`calcPaq`, `statsLote`, `delRepartidor`, `resumenDia`).
- `js/03-escaner.js`: escáner continuo (BarcodeDetector o ZXing), preguntas dentro del escáner, deshacer y novedad.
- `js/04-recepcion.js`, `js/05-despacho.js`, `js/06-devolucion.js`, `js/07-consulta.js`: una sección cada uno.
- `js/08-excel.js`: generador .xlsx (copiado de pedidos-) y reportes.
- `js/09-sync.js`: Supabase (sube lo pendiente y baja por `seq`).
- `js/10-zonas.js`: zonas por rangos de calles y carreras, ubicación de cada paquete y resúmenes por zona.
- `js/11-arranque.js`: navegación, repartidores, actualizaciones y `APP_VERSION`.
- `tests/`: Playwright. `tests/nube.js` simula Supabase y prueba dos celulares, trabajo sin señal y conflictos.

**Al publicar:** subir el mismo número en `APP_VERSION` (`js/11-arranque.js`) y `CACHE` (`sw.js`). Los archivos nuevos van en `CORE` (sw.js) y `APP_FILES` (00-acceso.js); una prueba lo verifica.

**Código compartido con pedidos-** (PIN, escáner, Excel, sesión de Supabase): si allá se corrige algo de seguridad, hay que traerlo aquí.

## Pruebas
`npm ci && npx playwright install chromium && npx playwright test`. Para las capturas: `CAPTURAS=1 npx playwright test tests/capturas.spec.js`.
