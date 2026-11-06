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
  // Sobre la Carrera 149C (la más cercana), a ~40 m de la Calle 137 hacia el norte: placa 137-40
  await expect(page.locator("#startInfo")).toContainText("Estás en Carrera 149C # 137-40 (según el mapa; la placa es aproximada), cerca de la esquina con Calle 137, barrio Tibabuyes");
  await expect(page.locator("#toast")).toContainText("Estás en Carrera 149C # 137-40.");
  const g = await page.evaluate(() => state.startGPS);
  expect(g.x).toBeCloseTo(149.45, 2); expect(g.y).toBeCloseTo(137.40, 2);
  expect(await page.evaluate(() => currentOrigin().label)).toBe("Mi ubicación");
  await expect(page.locator("#routeSum")).toContainText("Desde Carrera 149C # 137-40");
  // Si el mapa tiene la placa exacta en ese punto, se usa esa
  await context.unroute(/nominatim/);
  await context.route(/nominatim/, r => r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify({ address: { road: "Carrera 149C", house_number: "137-22", neighbourhood: "Tibabuyes" } }) }));
  await page.click("#btnGps");
  await expect(page.locator("#startInfo")).toContainText("Estás en Carrera 149C # 137-22 (según el mapa), cerca de la esquina con Calle 137");
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

test("GPS sobre una calle: placa desde la carrera de atrás (las carreras crecen hacia el occidente)", async ({ page, context }) => {
  await entrar(page);
  const lat = 4.7420, lng = -74.0950;
  const els = { elements: [
    via("Calle 145", [[lat - 0.00015, lng - 0.003], [lat - 0.00015, lng + 0.003]]),        // ~17 m al sur: sobre esta
    via("Carrera 106", [[lat - 0.003, lng + 0.00055], [lat + 0.003, lng + 0.00055]]),      // ~60 m al oriente (atrás)
    via("Carrera 107", [[lat - 0.003, lng - 0.0006], [lat + 0.003, lng - 0.0006]])         // ~66 m al occidente (adelante)
  ] };
  await context.route(/overpass/, r => r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(els) }));
  const c = await page.evaluate(([a, b]) => cruceDeGps(a, b), [lat, lng]);
  expect(c.dir).toBe("Calle 145 # 106-61");
  expect(c.texto).toBe("Calle 145 con Carrera 106");
});
