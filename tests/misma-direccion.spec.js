// v2.48: los pedidos de la misma dirección quedan seguidos en la lista (antes uno podía quedar arriba y los otros abajo).
const { test, expect } = require("@playwright/test");
const { entrar, cargar, vigilarErrores, sinInternetExterno } = require("./ayuda");

const GEMELA = "Calle 145 # 110-20";
const PARADAS = [
  { addr: "Calle 140 # 100-10" }, { addr: "Calle 150 # 120-10" }, { addr: "Calle 133 # 104-10" },
  { addr: GEMELA, guia: "1000000000000001" }, { addr: "Calle 152 # 95-10" }, { addr: "Calle 138 # 125-10" }
];
// Posiciones (en la lista de pendientes) de los pedidos de la dirección repetida: deben ser consecutivas.
const posiciones = page => page.evaluate(a => state.stops.filter(s => s.status !== "done").map((s, i) => s.label === a ? i : -1).filter(i => i >= 0), GEMELA);
const seguidas = p => p.every((v, i) => i === 0 || v === p[i - 1] + 1);

for(const modo of ["auto", "direcciones"]){
  test(`misma dirección seguida (${modo}): al ordenar y al llegar pedidos nuevos a mitad de ruta`, async ({ page }) => {
    const errs = vigilarErrores(page);
    await sinInternetExterno(page);
    await entrar(page);
    await page.evaluate(m => { state.ordenModo = m === "direcciones" ? "direcciones" : "auto"; state.realRoads = false; save(); }, modo);
    await cargar(page, [...PARADAS, { addr: GEMELA, guia: "1000000000000002" }]);
    await page.evaluate(() => optimize(true));
    await expect.poll(() => page.evaluate(() => !optimizing)).toBe(true);
    let p = await posiciones(page);
    expect(p.length).toBe(2); expect(seguidas(p)).toBe(true);
    // Sale a la ruta (primera entrega, que no sea la gemela) y le llegan dos pedidos más a esa dirección.
    await page.evaluate(a => { const s = state.stops.find(x => x.status !== "done" && x.label !== a); s.status = "done"; s.doneAt = new Date().toISOString(); numerar(); save(); render(); }, GEMELA);
    const antes = await page.evaluate(a => state.stops.filter(s => s.status !== "done" && s.label !== a).map(s => s.id), GEMELA);
    await page.evaluate(a => { for(const g of ["1000000000000003", "1000000000000004"]) state.stops.splice(0, 0, mkStop({ addr: a, guia: g })); save(); render(); return optimize(true, { estable: true }); }, GEMELA);
    await expect.poll(() => page.evaluate(() => !optimizing)).toBe(true);
    p = await posiciones(page);
    expect(p.length).toBe(4); expect(seguidas(p)).toBe(true);
    // El orden de las demás no cambia y cada pedido sigue siendo una parada aparte con su número.
    expect(await page.evaluate(a => state.stops.filter(s => s.status !== "done" && s.label !== a).map(s => s.id), GEMELA)).toEqual(antes);
    expect(new Set(await page.evaluate(a => state.stops.filter(s => s.label === a).map(s => s.num), GEMELA)).size).toBe(4);
    await expect(page.locator("#list li.stop .chip", { hasText: "4 pedidos en esta dirección" })).toHaveCount(4);
    expect(errs).toEqual([]);
  });
}

// Caso que sí fallaba antes de v2.48 (3 de 99 grupos separados): rutas al azar (semilla fija) a mitad de ruta.
test("misma dirección seguida en 160 rutas al azar (al ordenar y al insertar a mitad de ruta)", async ({ page }) => {
  const errs = vigilarErrores(page);
  await sinInternetExterno(page); await entrar(page);
  const r = await page.evaluate(async () => {
    let rnd = 7; const R = n => { rnd = (rnd * 1103515245 + 12345) % 2147483648; return rnd % n; };
    let malos = 0, tot = 0;
    for(const modo of ["auto", "direcciones"]) for(const fase of ["inicial", "estable"]) for(let t = 0; t < 40; t++){
      state.ordenModo = modo; state.realRoads = false; state.stops = []; state.suggestedIds = null;
      const base = []; for(let i = 0; i < 25; i++) base.push(`Calle ${128 + R(30)} # ${95 + R(35)}-${10 + R(80)}`);
      for(const a of base) state.stops.push(mkStop({ addr: a }));
      if(fase === "inicial"){ for(let k = 0; k < 4; k++) state.stops.push(mkStop({ addr: base[R(25)] })); await optimize(true); }
      else {
        await optimize(true); state.stops[0].status = "done"; numerar();
        for(let k = 0; k < 4; k++) state.stops.splice(0, 0, mkStop({ addr: base[1 + R(24)] }));
        await optimize(true, { estable: true });
      }
      const pos = new Map();
      state.stops.filter(s => s.status !== "done").forEach((s, i) => { const k = stopKey(s); if(!pos.has(k)) pos.set(k, []); pos.get(k).push(i); });
      for(const p of pos.values()) if(p.length > 1){ tot++; if(!p.every((v, i) => !i || v === p[i - 1] + 1)) malos++; }
    }
    return { malos, tot };
  });
  expect(r.tot).toBeGreaterThan(400);
  expect(r.malos).toBe(0);
  expect(errs).toEqual([]);
});

// v2.52: misma cuadra (misma calle y misma carrera aunque cambie la placa) también queda seguida y se avisa.
test("misma cuadra: clave, aviso en la tarjeta y seguidos al ordenar", async ({ page }) => {
  const errs = vigilarErrores(page);
  await sinInternetExterno(page);
  await entrar(page);
  expect(await page.evaluate(() => ["Calle 145 # 103B-90", "Calle 145 # 103B-10", "Carrera 103B # 145-20", "Calle 145 # 104-10", "Calle 45 Sur # 10-20", "Diagonal 145 # 103B-40"].map(a => cuadraKey({ addr: a }))))
    .toEqual(["CL 145|KR 103B", "CL 145|KR 103B", "CL 145|KR 103B", "CL 145|KR 104", "CL 45 SUR|KR 10", "CL 145|KR 103B"]);
  expect(await page.evaluate(() => cuadraTxt("CL 145|KR 103B"))).toBe("Calle 145 con Carrera 103B");
  await page.evaluate(() => { state.ordenModo = "auto"; state.realRoads = false; save(); });
  await cargar(page, [
    { addr: "Calle 145 # 103B-90", guia: "1000000000000001" }, { addr: "Calle 150 # 120-10" }, { addr: "Calle 133 # 104-10" },
    { addr: "Calle 140 # 100-10" }, { addr: "Calle 145 # 103B-15", guia: "1000000000000002" }, { addr: "Calle 152 # 95-10" },
    { addr: "Calle 138 # 125-10" }, { addr: "Carrera 103B # 145-40", guia: "1000000000000003" }
  ]);
  await page.evaluate(() => optimize(true));
  await expect.poll(() => page.evaluate(() => !optimizing)).toBe(true);
  const pos = await page.evaluate(() => state.stops.filter(s => s.status !== "done").map((s, i) => cuadraKey(s) === "CL 145|KR 103B" ? i : -1).filter(i => i >= 0));
  expect(pos.length).toBe(3);
  expect(pos.every((v, i) => !i || v === pos[i - 1] + 1)).toBe(true);
  const chip = page.locator("#list li.stop .chip.cuadra");
  await expect(chip).toHaveCount(3);
  await expect(chip.first()).toContainText("3 pedidos en esta cuadra · Calle 145 con Carrera 103B");
  // Uno nuevo en la misma cuadra (a mitad de ruta) entra junto a ellos y avisa.
  await page.evaluate(() => { const s = state.stops.find(x => cuadraKey(x) !== "CL 145|KR 103B"); s.status = "done"; s.doneAt = new Date().toISOString(); numerar(); save(); render(); });
  await page.evaluate(() => { const r = addOrMerge({ addr: "Calle 145 # 103B-60", guia: "1000000000000004" }); save(); render(); window.__r = r; });
  expect(await page.evaluate(() => [window.__r.enCuadra, window.__r.cuadra])).toEqual([3, "Calle 145 con Carrera 103B"]);
  await page.evaluate(() => optimize(true, { estable: true }));
  await expect.poll(() => page.evaluate(() => !optimizing)).toBe(true);
  const pos2 = await page.evaluate(() => state.stops.filter(s => s.status !== "done").map((s, i) => cuadraKey(s) === "CL 145|KR 103B" ? i : -1).filter(i => i >= 0));
  expect(pos2.length).toBe(4);
  expect(pos2.every((v, i) => !i || v === pos2[i - 1] + 1)).toBe(true);
  expect(errs).toEqual([]);
});

test("misma cuadra seguida en 160 rutas al azar", async ({ page }) => {
  await sinInternetExterno(page); await entrar(page);
  const r = await page.evaluate(async () => {
    let rnd = 13; const R = n => { rnd = (rnd * 1103515245 + 12345) % 2147483648; return rnd % n; };
    let malosC = 0, malosD = 0, totC = 0;
    for(const modo of ["auto", "direcciones"]) for(const fase of ["inicial", "estable"]) for(let t = 0; t < 40; t++){
      state.ordenModo = modo; state.realRoads = false; state.stops = []; state.suggestedIds = null;
      const dirs = []; for(let i = 0; i < 28; i++) dirs.push(`Calle ${135 + R(10)} # ${100 + R(8)}-${10 + R(80)}`);
      for(const a of dirs) state.stops.push(mkStop({ addr: a }));
      if(fase === "estable"){ await optimize(true); state.stops[0].status = "done"; numerar(); for(let k = 0; k < 4; k++) state.stops.splice(0, 0, mkStop({ addr: dirs[1 + R(27)] })); await optimize(true, { estable: true }); }
      else await optimize(true);
      const pend = state.stops.filter(s => s.status !== "done");
      const cs = new Map(), ds = new Map();
      pend.forEach((s, i) => { const c = cuadraKey(s), d = stopKey(s); (cs.get(c) || cs.set(c, []).get(c)).push(i); (ds.get(d) || ds.set(d, []).get(d)).push(i); });
      const seguido = p => p.every((v, i) => !i || v === p[i - 1] + 1);
      for(const p of cs.values()) if(p.length > 1){ totC++; if(!seguido(p)) malosC++; }
      for(const p of ds.values()) if(p.length > 1 && !seguido(p)) malosD++;
    }
    return { malosC, malosD, totC };
  });
  expect(r.totC).toBeGreaterThan(300);
  expect(r.malosC).toBe(0);
  expect(r.malosD).toBe(0);
});
