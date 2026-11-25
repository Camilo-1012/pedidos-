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
