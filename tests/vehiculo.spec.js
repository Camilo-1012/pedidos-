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

test("elegir Moto reordena con el costo de moto", async ({ page }) => {
  test.setTimeout(120000);
  const errs = vigilarErrores(page);
  await entrar(page);
  await osrmFalso(page.context());   // después de entrar: las rutas registradas al final tienen prioridad
  await page.evaluate(l => { state.realRoads = true; state.stops = l.map(a => mkStop({ addr: a })); state.stops.forEach(s => { const e = estimate(s.x, s.y); s.lat = e.lat; s.lng = e.lng; s.geo = "osm"; }); state.start = "Calle 145 # 104-10"; save(); render(); }, PARADAS);
  await expect(page.locator("#vehCarro")).toBeChecked();
  await page.evaluate(() => optimize(false));
  await expect(page.locator("#routeInfo")).toContainText("min en carro");
  const carro = await page.evaluate(() => state.stops.filter(s => s.status !== "done").map(s => s.id));
  // Cambiar a moto desde la opción
  await page.click("#routeOpts > summary");
  await page.click('label[for="vehMoto"]');
  await expect(page.locator("#routeInfo")).toContainText("min en moto", { timeout: 20000 });
  await expect(page.locator("#optsSum")).toContainText("en moto");
  await expect(page.locator("#vehInfo")).toContainText("devolverse");
  const moto = await page.evaluate(() => state.stops.filter(s => s.status !== "done").map(s => s.id));
  // Costo en moto (75 % promedio de ida y vuelta + 25 % sentido real) de cada orden, con la matriz que devolvió el servidor.
  const costos = await page.evaluate(([carro, moto]) => {
    const M = LASTM, D = M.D;   // en moto, LASTM.D ya es la matriz de moto × 0,85
    const c = ids => { let s = 0, prev = "__o"; for(const id of ids){ s += D[M.idx.get(prev)][M.idx.get(id)]; prev = id; } return s; };
    return { carro: c(carro), moto: c(moto) };
  }, [carro, moto]);
  expect(moto.join()).not.toBe(carro.join());          // el orden cambia
  expect(costos.moto).toBeLessThanOrEqual(costos.carro + 1);
  // Volver a carro
  await page.click('label[for="vehCarro"]');
  await expect(page.locator("#routeInfo")).toContainText("min en carro", { timeout: 20000 });
  expect(await page.evaluate(() => state.vehiculo)).toBe("carro");
  expect(errs).toEqual([]);
});

test("sin internet, en moto cruzar las avenidas cuesta menos", async ({ page }) => {
  await entrar(page);
  const r = await page.evaluate(() => {
    const a = parseAddress("Calle 140 # 110-10"), b = parseAddress("Calle 150 # 110-10");   // cruza Calle 145
    state.vehiculo = "carro"; const carro = gridDist(a, b);
    state.vehiculo = "moto";  const moto = gridDist(a, b);
    return { carro, moto };
  });
  expect(r.carro - r.moto).toBeCloseTo(1, 5);
});
