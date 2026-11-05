// Carro / Moto: con un servidor de rutas simulado donde ida y vuelta cuestan distinto (calles de una vía, rodear la
// manzana), en moto el orden cambia y su costo «en moto» no es peor que el del orden de carro.
const { test, expect } = require("@playwright/test");
const { entrar, vigilarErrores } = require("./ayuda");

// Tiempos simulados: distancia / 6 m/s, y +240 s si el tramo va hacia el oriente (vías de un solo sentido que obligan a rodear).
async function osrmFalso(ctx){
  await ctx.route(/routing\.openstreetmap\.de|router\.project-osrm\.org/, async route => {
    const url = new URL(route.request().url());
    if(!url.pathname.includes("/table/")) return route.abort();
    const pts = url.pathname.split("/").pop().split(";").map(p => p.split(",").map(Number));   // lng,lat
    const m = (a, b) => { const R = 6371000, toR = x => x*Math.PI/180; const dLa = toR(b[1]-a[1]), dLo = toR(b[0]-a[0]);
      return 2*R*Math.asin(Math.sqrt(Math.sin(dLa/2)**2 + Math.cos(toR(a[1]))*Math.cos(toR(b[1]))*Math.sin(dLo/2)**2)); };
    const durations = pts.map(a => pts.map(b => a === b ? 0 : m(a,b)/6 + (b[0] > a[0] + 0.0005 ? 240 : 0)));
    const distances = pts.map(a => pts.map(b => m(a,b)));
    route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ code: "Ok", durations, distances }) });
  });
}
const PARADAS = ["Calle 145 # 103B-90", "Carrera 110 # 152-30", "Calle 139 # 112-15", "Calle 150 # 104-20", "Carrera 105 # 148-11",
  "Calle 142 # 108-40", "Carrera 112 # 140-05", "Calle 147 # 115-30", "Carrera 107 # 135-60", "Calle 153 # 110-12"];

test("Moto: mismo orden (el mejor en las pruebas) y tiempo de manejo ≈ 15 % menor", async ({ page }) => {
  test.setTimeout(120000);
  const errs = vigilarErrores(page);
  await entrar(page);
  await osrmFalso(page.context());   // después de entrar: las rutas registradas al final tienen prioridad
  await page.evaluate(l => { state.realRoads = true; state.stops = l.map(a => mkStop({ addr: a })); state.stops.forEach(s => { const e = estimate(s.x, s.y); s.lat = e.lat; s.lng = e.lng; s.geo = "osm"; }); state.start = "Calle 145 # 104-10"; save(); render(); }, PARADAS);
  await expect(page.locator("#vehCarro")).toBeChecked();
  await page.evaluate(() => optimize(false));
  await expect(page.locator("#routeInfo")).toContainText("min en carro");
  const carro = await page.evaluate(() => ({ ids: state.stops.filter(s => s.status !== "done").map(s => s.id).join(), min: state.route.min }));
  await page.click("#routeOpts > summary");
  await page.click('label[for="vehMoto"]');
  await expect(page.locator("#routeInfo")).toContainText("min en moto", { timeout: 20000 });
  await expect(page.locator("#optsSum")).toContainText("en moto");
  await expect(page.locator("#vehInfo")).toContainText("mismo para los dos");
  const moto = await page.evaluate(() => ({ ids: state.stops.filter(s => s.status !== "done").map(s => s.id).join(), min: state.route.min }));
  expect(moto.ids).toBe(carro.ids);
  expect(moto.min / carro.min).toBeCloseTo(0.85, 2);
  await page.click('label[for="vehCarro"]');
  await expect(page.locator("#routeInfo")).toContainText("min en carro", { timeout: 20000 });
  expect(errs).toEqual([]);
});
