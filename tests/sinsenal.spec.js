// Funciona sin señal: la app abre desde el celular y el mapa muestra las calles ya vistas.
const { test, expect } = require("@playwright/test");
const { entrar, cargar } = require("./ayuda");
const fs = require("fs"), path = require("path");
const PNG = fs.readFileSync(path.join(__dirname, "..", "icons", "icon-192.png"));

test("la app y el mapa abren sin señal", async ({ page, context }) => {
  test.skip(!process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS, "requiere PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1");
  let online = true, pedidas = 0;
  await context.route(/tile\.openstreetmap\.org/, r => { if (!online) return r.abort(); pedidas++; r.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG }); });
  await entrar(page);
  await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 30000 });
  await cargar(page, [{ addr: "Calle 145 # 103B-90" }, { addr: "Carrera 91 # 147-20" }]);
  await page.evaluate(() => { state.stops.forEach(s => { const e = estimate(s.x, s.y); s.lat = e.lat; s.lng = e.lng; s.geo = "osm"; }); save(); render(); });
  await page.click("#btnMap");
  await expect.poll(() => page.$$eval("#lmap img.leaflet-tile", e => e.filter(i => i.complete && i.naturalWidth > 0).length)).toBeGreaterThan(0);
  online = false; await context.setOffline(true); pedidas = 0;
  await page.reload();
  await expect(page.locator("#lock")).toBeHidden();
  await page.click("#btnMap");
  await expect.poll(() => page.$$eval("#lmap img.leaflet-tile", e => e.filter(i => i.complete && i.naturalWidth > 0).length)).toBeGreaterThan(0);
  expect(pedidas).toBe(0);
});
