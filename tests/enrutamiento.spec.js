// Calidad y comportamiento del enrutamiento (regresión): óptimo exacto, velocidad y casos de una jornada real.
const { test, expect } = require("@playwright/test");
const { entrar, vigilarErrores } = require("./ayuda");

// Carga paradas en coordenadas de cuadrícula (calle, carrera) sin geocodificar.
async function paradas(page, lista, extra){
  await page.evaluate(([l, extra]) => {
    state.realRoads = false; state.startGPS = null; state.start = "Calle 145 # 104-10"; state.lastDoneId = null; state.salidaAt = null; state.suggestedIds = null;
    Object.assign(state, extra || {});
    state.stops = l.map(([y, x, z]) => mkStop({ addr: `Calle ${y} # ${x}-10`, zone: z || "" }));
    save(); render();
  }, [lista, extra]);
}
const orden = page => page.evaluate(() => state.stops.filter(s => s.status !== "done").map(s => s.label));

test("calidad: sin internet queda cerca del óptimo exacto (40 rutas de 9 paradas)", async ({ page }) => {
  await entrar(page);
  const r = await page.evaluate(() => {
    let s = 12345; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    const gaps = [];
    state.zone = { ...zone(), sectors: false, outLast: false };   // se mide el orden libre
    for (let t = 0; t < 40; t++){
      const start = { x: 104, y: 145 };
      const pts = Array.from({ length: 9 }, () => ({ x: 105 + Math.floor(rnd() * 55), y: 126 + Math.floor(rnd() * 49) }));
      const app = pathLen(start, solve(start, pts, false), false);
      // Óptimo exacto (Held-Karp)
      const n = pts.length, FULL = 1 << n, dp = new Float64Array(FULL * n).fill(Infinity);
      for (let j = 0; j < n; j++) dp[(1 << j) * n + j] = gridDist(start, pts[j]);
      for (let S = 1; S < FULL; S++) for (let j = 0; j < n; j++){ const v = dp[S * n + j]; if (!(S & (1 << j)) || v === Infinity) continue;
        for (let k = 0; k < n; k++){ if (S & (1 << k)) continue; const T = S | (1 << k), c = v + gridDist(pts[j], pts[k]); if (c < dp[T * n + k]) dp[T * n + k] = c; } }
      let opt = Infinity; for (let j = 0; j < n; j++) opt = Math.min(opt, dp[(FULL - 1) * n + j]);
      gaps.push(app / opt - 1);
    }
    return { prom: gaps.reduce((a, b) => a + b, 0) / gaps.length, max: Math.max(...gaps) };
  });
  expect(r.prom).toBeLessThan(0.01);    // en promedio, menos de 1 % sobre el óptimo
  expect(r.max).toBeLessThan(0.06);
});

test("velocidad: 99 paradas se ordenan en menos de 1,5 s en un celular de gama media (CPU ×4 más lenta)", async ({ page }) => {
  await entrar(page);
  const cdp = await page.context().newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const ms = await page.evaluate(() => {
    let s = 7; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    state.stops = Array.from({ length: 99 }, () => mkStop({ addr: `Calle ${126 + Math.floor(rnd() * 49)} # ${105 + Math.floor(rnd() * 55)}-10` }));
    state.realRoads = false; save();
    const t0 = performance.now(); quickOrder(); return performance.now() - t0;
  });
  expect(ms).toBeLessThan(1500);
});

test("«No estaba» sigue al final aunque se reordene al agregar un pedido", async ({ page }) => {
  const errs = vigilarErrores(page);
  await entrar(page);
  await paradas(page, [[145, 106], [146, 108], [150, 120], [139, 115], [147, 107]]);
  await page.evaluate(() => optimize(true));
  const primera = (await orden(page))[0];
  await page.click(`#list li.stop:has-text("${primera}") button[data-act=fail]`);
  expect((await orden(page)).slice(-1)[0]).toBe(primera);
  // Llega un pedido nuevo y se reordena: la fallida sigue de última
  await page.evaluate(() => { state.stops.push(mkStop({ addr: "Calle 145 # 106-50" })); save(); return optimize(true, { estable: true }); });
  expect((await orden(page)).slice(-1)[0]).toBe(primera);
  await page.evaluate(() => optimize(true));     // «Ordenar ruta» completo
  expect((await orden(page)).slice(-1)[0]).toBe(primera);
  expect(errs).toEqual([]);
});

// Servidor de rutas simulado: tiempos por distancia (para probar el ajuste final con calles reales).
async function osrmFalso(ctx){
  await ctx.route(/routing\.openstreetmap\.de|router\.project-osrm\.org/, async route => {
    const u = new URL(route.request().url()); if (!u.pathname.includes("/table/")) return route.abort();
    const pts = u.pathname.split("/").pop().split(";").map(p => p.split(",").map(Number));
    const m = (a, b) => Math.hypot((a[0] - b[0]) * 110000, (a[1] - b[1]) * 110000);
    route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ code: "Ok", durations: pts.map(a => pts.map(b => m(a, b) / 6)), distances: pts.map(a => pts.map(b => m(a, b))) }) });
  });
}
test("«Terminar una zona antes de pasar a otra» mantiene las zonas juntas, también con calles reales", async ({ page }) => {
  await entrar(page);
  await osrmFalso(page.context());
  // Zonas intercaladas sobre la misma calle: el orden más corto las mezclaría; la opción obliga a terminar una antes.
  await paradas(page, [[145, 106, "18"], [145, 108, "49"], [145, 110, "18"], [145, 112, "49"], [145, 114, "18"], [145, 116, "49"], [145, 118, "18"]], { byZone: true });
  await page.evaluate(() => { state.realRoads = true; state.stops.forEach(s => { const e = estimate(s.x, s.y); s.lat = e.lat; s.lng = e.lng; s.geo = "osm"; }); save(); });
  await page.evaluate(() => optimize(true));
  await expect(page.locator("#routeInfo")).toContainText("calles reales");
  const zonas = await page.evaluate(() => state.stops.filter(s => s.status !== "done").map(s => s.zone));
  const cambios = zonas.filter((z, i) => i > 0 && z !== zonas[i - 1]).length;
  expect(cambios).toBe(1);                       // 18,18,18,49,49,49 (o al revés): una sola transición
});

test("ruta en curso: un pedido nuevo se inserta sin revolver el orden", async ({ page }) => {
  await entrar(page);
  await paradas(page, [[145, 106], [146, 108], [147, 110], [148, 112], [149, 114], [150, 116], [151, 118], [152, 120]]);
  await page.evaluate(() => optimize(true));
  const antes = await orden(page);
  // Ya salió (entregó la primera) y llega un pedido en el camino
  await page.click(`#list li.stop:has-text("${antes[0]}") button[data-act=done]`);
  await page.evaluate(() => { state.stops.push(mkStop({ addr: "Calle 149 # 115-10" })); save(); return optimize(true, { estable: true }); });
  const despues = await orden(page);
  expect(despues.filter(l => l !== "Calle 149 # 115-10")).toEqual(antes.slice(1));    // el resto queda igual
  expect(despues.indexOf("Calle 149 # 115-10")).toBeGreaterThan(0);                    // y la nueva entra en su hueco
});

test("antes de salir, un pedido nuevo sí puede reordenar todo", async ({ page }) => {
  await entrar(page);
  await paradas(page, [[145, 106], [150, 120], [139, 115]]);
  await page.evaluate(() => optimize(true));
  expect(await page.evaluate(() => rutaEnCurso())).toBe(false);
  await page.evaluate(() => { state.stops.push(mkStop({ addr: "Calle 140 # 116-10" })); save(); return optimize(true, { estable: true }); });
  const o = await orden(page);
  const iA = o.indexOf("Calle 139 # 115-10"), iB = o.indexOf("Calle 140 # 116-10");
  expect(Math.abs(iA - iB)).toBe(1);             // la nueva queda junto a su vecina
});

test("las direcciones sin ubicar quedan al final, después de los reintentos", async ({ page }) => {
  await entrar(page);
  await page.evaluate(() => {
    state.realRoads = false; state.start = "Calle 145 # 104-10";
    state.stops = [mkStop({ addr: "Avenida Suba frente al parque" }), mkStop({ addr: "Calle 146 # 108-10" }), mkStop({ addr: "Calle 150 # 120-10" })];
    state.stops[2].status = "fail"; save();
    return optimize(true);
  });
  const o = await page.evaluate(() => state.stops.map(s => s.addr));
  expect(o).toEqual(["Calle 146 # 108-10", "Calle 150 # 120-10", "Avenida Suba frente al parque"]);
});
