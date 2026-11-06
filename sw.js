/* Service worker: guarda la app en el celular para que abra sin internet.
   Al publicar cambios, sube el número de CACHE para que los celulares descarguen la versión nueva. */
const CACHE = "ruta-v2.15";
const CORE = [
  "./", "index.html", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png",
  "fonts/barlow-latin-400-normal.woff2", "fonts/barlow-latin-500-normal.woff2", "fonts/barlow-latin-600-normal.woff2",
  "fonts/barlow-condensed-latin-600-normal.woff2", "fonts/barlow-condensed-latin-700-normal.woff2",
  "ocr/tesseract.min.js", "ocr/worker.min.js", "ocr/spa-traineddata.wasm",
  "ocr/tesseract-core-simd-lstm.wasm.js", "ocr/tesseract-core-lstm.wasm.js",
  "css/app.css", "js/00-acceso.js", "js/01-direcciones.js", "js/02-ruta.js", "js/03-mapas.js", "js/04-jornada.js",
  "js/05-pantalla.js", "js/06-escaner.js", "js/07-cargue.js", "js/08-voz.js", "js/09-arranque.js", "js/10-conduccion.js", "js/11-equipo.js", "js/12-aviso.js", "js/13-buscar.js",
  "scan/zxing.min.js", "map/leaflet.js", "map/leaflet.css", "map/images/marker-icon.png", "map/images/marker-shadow.png"
];
self.addEventListener("install", e => {
  // cache:"reload" evita guardar copias viejas que el navegador tenga en su caché HTTP.
  // No se activa sola: espera a que la persona toque «Actualizar» (mensaje skipWaiting).
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE.map(u => new Request(u, { cache: "reload" })))));
});
self.addEventListener("message", e => {
  const t = e.data && e.data.type;
  if (t === "skipWaiting") self.skipWaiting();
  else if (t === "version" && e.source) e.source.postMessage({ type: "version", version: CACHE.replace(/^ruta-v/, "") });
});
/* Mapas sin señal: se guardan las teselas de OpenStreetMap que ya se vieron (la política de OSM prohíbe descargar
   zonas completas por adelantado, pero permite guardar lo visto). Se usan sin pedirlas otra vez durante 7 días y,
   sin señal, aunque sean más viejas. Máximo ~2 000 teselas (≈ 40 MB); las más antiguas salen primero. */
const TILES = "ruta-tiles-v1", TILE_MAX = 2000, TILE_FRESH = 7 * 864e5;
let tilePuts = 0;
async function trimTiles() {
  const c = await caches.open(TILES), keys = await c.keys();
  if (keys.length > TILE_MAX) await Promise.all(keys.slice(0, keys.length - TILE_MAX).map(k => c.delete(k)));
}
async function tileFetch(req) {
  const c = await caches.open(TILES);
  const hit = await c.match(req.url);
  const age = hit ? Date.now() - (+hit.headers.get("x-saved") || 0) : Infinity;
  if (hit && age < TILE_FRESH) return hit;
  try {
    const r = await fetch(req.url, { mode: "cors", credentials: "omit" });
    if (r.ok) {
      const h = new Headers(r.headers); h.set("x-saved", String(Date.now()));
      const body = await r.blob();
      await c.put(req.url, new Response(body, { status: 200, headers: h }));
      if (++tilePuts % 50 === 0) trimTiles();
      return new Response(body, { status: 200, headers: h });
    }
    return hit || r;
  } catch (err) {
    if (hit) return hit;
    throw err;
  }
}
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== TILES).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method === "GET" && new URL(req.url).hostname === "tile.openstreetmap.org") { e.respondWith(tileFetch(req)); return; }
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  // Página: sale de la versión instalada, junto con sus archivos js/ y css/, para que nunca se mezcle una página
  // nueva con código viejo. Las versiones nuevas llegan por la actualización del service worker (botón «Actualizar»).
  if (req.mode === "navigate") {
    e.respondWith(
      caches.open(CACHE).then(c => c.match("index.html")).then(hit => hit || fetch(req))
    );
    return;
  }
  // Recursos estáticos: caché primero.
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return r;
  })));
});
