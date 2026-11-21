/* Service worker: guarda la app en el celular para que abra y funcione sin internet.
   Al publicar cambios, sube el número de CACHE (igual a APP_VERSION en js/11-arranque.js).
   Los archivos nuevos se agregan a CORE (y a APP_FILES en js/00-acceso.js si son de js/): una prueba lo verifica. */
const CACHE = "bodega-v1.2";
const CORE = [
  "./", "index.html", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png",
  "fonts/barlow-latin-400-normal.woff2", "fonts/barlow-latin-500-normal.woff2", "fonts/barlow-latin-600-normal.woff2",
  "fonts/barlow-condensed-latin-600-normal.woff2", "fonts/barlow-condensed-latin-700-normal.woff2",
  "css/app.css", "scan/zxing.min.js",
  "js/00-acceso.js", "js/01-base.js", "js/02-datos.js", "js/03-escaner.js", "js/04-recepcion.js", "js/05-despacho.js",
  "js/06-devolucion.js", "js/07-consulta.js", "js/08-excel.js", "js/09-sync.js", "js/10-zonas.js", "js/11-arranque.js"
];
self.addEventListener("install", e => {
  // cache:"reload" evita guardar copias viejas de la caché HTTP. No se activa sola: espera «Actualizar» (skipWaiting).
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE.map(u => new Request(u, { cache: "reload" })))));
});
self.addEventListener("message", e => {
  const t = e.data && e.data.type;
  if (t === "skipWaiting") self.skipWaiting();
  else if (t === "version" && e.source) e.source.postMessage({ type: "version", version: CACHE.replace(/^bodega-v/, "") });
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  // Supabase y cualquier otro origen: directo a la red (nunca se guardan datos de la nube en la caché).
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    e.respondWith(caches.open(CACHE).then(c => c.match("index.html")).then(hit => hit || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return r;
  })));
});
