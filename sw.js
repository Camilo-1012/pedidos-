/* Service worker: guarda la app en el celular para que abra sin internet.
   Al publicar cambios, sube el número de CACHE para que los celulares descarguen la versión nueva. */
const CACHE = "ruta-v1.20";
const CORE = [
  "./", "index.html", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png",
  "fonts/barlow-latin-400-normal.woff2", "fonts/barlow-latin-500-normal.woff2", "fonts/barlow-latin-600-normal.woff2",
  "fonts/barlow-condensed-latin-600-normal.woff2", "fonts/barlow-condensed-latin-700-normal.woff2",
  "ocr/tesseract.min.js", "ocr/worker.min.js", "ocr/spa-traineddata.wasm",
  "ocr/tesseract-core-simd-lstm.wasm.js", "ocr/tesseract-core-lstm.wasm.js",
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
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  // Página: red primero (para recibir cambios), caché si no hay señal.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put("index.html", copy)); return r; })
        .catch(() => caches.match("index.html"))
    );
    return;
  }
  // Recursos estáticos: caché primero.
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return r;
  })));
});
