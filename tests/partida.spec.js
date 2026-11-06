// Punto de partida: calle real según el mapa al usar el GPS, y dirección escrita validada y usada.
const { test, expect } = require("@playwright/test");
const { entrar, cargar, vigilarErrores } = require("./ayuda");

const LAT = 4.7405, LNG = -74.1160;   // punto de prueba
// Overpass simulado: Carrera 149C pasa a ~20 m (norte-sur), Calle 137 a ~40 m (oriente-occidente), Calle 138 más lejos.
const via = (name, pts) => ({ type: "way", tags: { highway: "residential", name }, geometry: pts.map(([lat, lon]) => ({ lat, lon })) });
const OVERPASS = { elements: [
  via("Carrera 149C", [[LAT - 0.003, LNG + 0.00018], [LAT + 0.003, LNG + 0.00018]]),
  via("Calle 137", [[LAT - 0.00036, LNG - 0.003], [LAT - 0.00036, LNG + 0.003]]),
  via("Calle 138", [[LAT + 0.0012, LNG - 0.003], [LAT + 0.0012, LNG + 0.003]]),
  via("Avenida Ciudad de Cali", [[LAT - 0.003, LNG + 0.0001], [LAT + 0.003, LNG + 0.0001]])
] };

test("GPS: muestra la calle y la carrera reales del mapa y las usa como punto de partida", async ({ page, context }) => {
  const errs = vigilarErrores(page);
  await entrar(page);
  await context.route(/overpass|osrm|routing\.openstreetmap|openrouteservice|waze\.com|wa\.me/, r =>
    /overpass/.test(r.request().url()) && /around/.test(decodeURIComponent(r.request().postData() || "")) ? r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(OVERPASS) }) : r.abort());
  await context.route(/nominatim/, r => r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ address: { neighbourhood: "Tibabuyes" } }) }));
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: LAT, longitude: LNG, accuracy: 12 });
  await cargar(page, [{ addr: "Calle 139 # 112-15" }, { addr: "Calle 145 # 106-20" }]);
  expect(await page.evaluate(() => ["Carrera 149C", "CALLE 136A BIS", "Avenida Calle 145", "Calle 23 Sur", "Avenida Ciudad de Cali"].map(n => (viaDeNombre(n) || {}).nombre || null)))
    .toEqual(["Carrera 149C", "Calle 136A Bis", "Avenida Calle 145", "Calle 23 Sur", null]);
  await page.click("#btnGps");
  await expect(page.locator("#startInfo")).toContainText("Estás en Carrera 149C con Calle 137 (según el mapa), barrio Tibabuyes");
  const g = await page.evaluate(() => state.startGPS);
  expect(g.x).toBeCloseTo(149.45, 1); expect(Math.floor(g.y)).toBe(137);
  expect(await page.evaluate(() => currentOrigin().label)).toBe("Mi ubicación");
  await expect(page.locator("#routeSum")).toContainText("Desde Carrera 149C con Calle 137");
  expect(errs).toEqual([]);
});

test("dirección escrita: se valida, se usa y manda sobre la última entrega si se escribe después", async ({ page }) => {
  const errs = vigilarErrores(page);
  await page.context().route(/overpass|osrm|routing\.openstreetmap|openrouteservice|kumi|coffee|waze\.com|wa\.me|nominatim/, r => r.abort());
  await entrar(page);
  await page.evaluate(() => { state.autoWaze = false; save(); });
  await cargar(page, [{ addr: "Calle 139 # 112-15" }, { addr: "Calle 145 # 106-20" }, { addr: "Calle 132 # 105-10" }]);
  await page.evaluate(() => toggleDone(state.stops[0]));
  // Tras entregar, la ruta sigue desde la última entrega
  expect(await page.evaluate(() => !!currentOrigin().id)).toBe(true);
  // Dirección que no se entiende: se avisa y no se usa
  await page.fill("#start", "por la panaderia"); await page.locator("#start").dispatchEvent("change");
  await expect(page.locator("#startInfo")).toContainText("No reconozco «por la panaderia»: no se está usando");
  // Dirección válida escrita después de la entrega: se usa
  await page.fill("#start", "kr 149c 137 20"); await page.locator("#start").dispatchEvent("change");
  await expect(page.locator("#startInfo")).toContainText("✓ Se usa como punto de partida: Carrera 149C # 137-20");
  const o = await page.evaluate(() => currentOrigin());
  expect(o.label).toBe("Carrera 149C # 137-20"); expect(o.id).toBeUndefined();
  // Una entrega posterior vuelve a mandar, y se avisa
  await page.evaluate(() => toggleDone(state.stops.find(s => s.status !== "done")));
  await expect(page.locator("#startInfo")).toContainText("la ruta sigue desde tu última entrega");
  expect(errs).toEqual([]);
});
