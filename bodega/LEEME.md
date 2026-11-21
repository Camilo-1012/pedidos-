# Bodega · Recepción, despacho, devoluciones y zonas (pantalla del despachador)

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

## Dónde vive (desde la v2.30 de Ruta de Entregas)
Bodega es la **pantalla del despachador de la misma app** Ruta de Entregas (repo `Camilo-1012/pedidos-`), no una app aparte:
- `bodega.html` (raíz) + `bodega/js/*` + `bodega/bodega.css`. Usa `css/app.css`, `js/00-acceso.js` (PIN y roles), `js/15-excel.js` (generador .xlsx), `scan/zxing.min.js`, `sw.js` y el manifiesto de Ruta.
- **Roles por usuario** (☰ → Usuario → «Cambiar rol»): **Repartidor** → solo Ruta, sin opción de elegir; **Despachador** → Ruta y Bodega. El administrador y los despachadores eligen en la pantalla del PIN «Entrar a: Ruta | Bodega» (se recuerda la última elección) y cambian con «Ir a Bodega / Ir a Ruta» en el menú, sin volver a pedir el PIN. El primer usuario del celular es administrador.
- Una sola versión: `APP_VERSION` en `js/09-arranque.js` y `bodega/js/11-arranque.js`, y `CACHE` en `sw.js` (una prueba lo verifica). Los archivos nuevos de `bodega/js/` van en `CORE` (sw.js) y en la lista de Bodega de `APP_FILES` (js/00-acceso.js).
- Pruebas: `tests/bodega/` (corren con todas las demás; Supabase simulado en `tests/bodega/nube.js`). Capturas: `CAPTURAS=1 npx playwright test tests/bodega/capturas.spec.js`.
- El repo `Camilo-1012/Bodega` (v1.0–v1.2) quedó importado aquí con su historial (`git subtree`) y se archiva en solo lectura.

## Histórico (auditoría)
Todo movimiento queda en Supabase (`bodega_eventos`) y **no se borra**: quién recibió, quién despachó a qué repartidor, quién liquidó, desde qué celular y a qué hora subió. En Consultar → «Histórico (nube)»: historial completo de una guía y Excel por fechas y repartidor (resumen por día, movimientos y recepción por lote). El celular guarda 30 días; la nube, todo.

## Puesta en marcha (una vez)
1. En Supabase (proyecto de Ruta de Entregas): crear la cuenta del despacho en Authentication → Users, cambiar los correos al final de `supabase/bodega.sql` y correrlo en SQL Editor.
2. En cada celular de bodega: abrir la app, entrar con un usuario despachador (o el administrador) eligiendo «Bodega» en la pantalla del PIN, conectar la nube en ☰ → Equipo (nube), y con una cuenta `admin` agregar repartidores (☰ → Repartidores) y zonas (☰ → Zonas).
