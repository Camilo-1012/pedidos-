// El historial (y el Excel) nunca pierde entregas hechas: ni al quitar entregados, ni al borrar la jornada,
// ni con dos jornadas el mismo día, ni cuando el otro celular vacía la lista. Y se puede recuperar desde la nube.
const { test, expect } = require("@playwright/test");
const { entrar, cargar, vigilarErrores } = require("./ayuda");
const { crearSupabase } = require("./supabase-falso");

const entregar = (page, addr) => page.evaluate(a => toggleDone(state.stops.find(s => s.addr === a)), addr);
const hist = page => page.evaluate(() => histLoad().map(x => ({ paquetes: x.paquetes, guias: x.pedidos.filter(p => p.e === "Entregado").map(p => p.g).sort() })));
const confirmar = page => page.click("#frmConfirm button[type=submit]");

test("historial: quitar entregados, borrar la jornada y dos jornadas el mismo día no borran entregas", async ({ page }) => {
  const errs = vigilarErrores(page);
  await entrar(page);
  await page.evaluate(() => { state.autoWaze = false; save(); });
  await cargar(page, [{ addr: "Calle 145 # 106-20", guia: "A1" }, { addr: "Calle 139 # 112-15", guia: "A2" }, { addr: "Calle 132 # 105-10", guia: "A3" }]);
  await entregar(page, "Calle 145 # 106-20"); await entregar(page, "Calle 139 # 112-15");
  expect(await hist(page)).toEqual([{ paquetes: 2, guias: ["A1", "A2"] }]);
  // «Quitar entregados» y luego otra entrega: las dos primeras siguen en el historial
  await page.evaluate(() => $("btnClearDone").click());
  await entregar(page, "Calle 132 # 105-10");
  expect(await hist(page)).toEqual([{ paquetes: 3, guias: ["A1", "A2", "A3"] }]);
  // Jornada nueva el mismo día: es otra jornada, la primera no se pisa
  await page.evaluate(() => $("btnNew").click()); await confirmar(page);
  await cargar(page, [{ addr: "Calle 153 # 115-40", guia: "B1" }, { addr: "Calle 146 # 106-30", guia: "B2" }]);
  await entregar(page, "Calle 153 # 115-40");
  expect(await hist(page)).toEqual([{ paquetes: 3, guias: ["A1", "A2", "A3"] }, { paquetes: 1, guias: ["B1"] }]);
  // «Borrar toda la jornada» y entregas después: lo entregado antes se conserva y lo nuevo va aparte
  await page.evaluate(() => $("btnClearAll").click()); await confirmar(page);
  await cargar(page, [{ addr: "Carrera 110 # 150-20", guia: "C1" }]);
  await entregar(page, "Carrera 110 # 150-20");
  expect(await hist(page)).toEqual([{ paquetes: 3, guias: ["A1", "A2", "A3"] }, { paquetes: 1, guias: ["B1"] }, { paquetes: 1, guias: ["C1"] }]);
  // Deshacer la única entrega de una jornada sí la quita (no se hizo)
  await page.evaluate(() => toggleDone(state.stops.find(s => s.guia === "C1")));
  expect(await hist(page)).toEqual([{ paquetes: 3, guias: ["A1", "A2", "A3"] }, { paquetes: 1, guias: ["B1"] }]);
  // El acumulado de pagos cuenta las 4
  expect(await page.evaluate(() => acumSum(() => true).p)).toBe(4);
  expect(errs).toEqual([]);
});

async function celular(browser, sb){
  const ctx = await browser.newContext({ ...require("@playwright/test").devices["Pixel 7"] });
  await sb.instalar(ctx);
  const page = await ctx.newPage(); const errs = vigilarErrores(page);
  await entrar(page, "Camilo");
  await page.evaluate(() => { state.stops = []; state.seeded = true; state.autoWaze = false; save(); render(); });
  await page.click("text=Más opciones"); await page.click("#btnTeamCfg");
  await page.fill("#tmEmail", "camilo@equipo.co"); await page.fill("#tmPass", "Clave-Camilo-1"); await page.click("#tmGo");
  await expect(page.locator("#tmState")).toContainText("Conectado");
  await page.keyboard.press("Escape");
  return { ctx, page, errs };
}

test("historial: si el otro celular empieza jornada nueva no se pierde nada, y se recupera desde la nube", async ({ browser }) => {
  const sb = crearSupabase();
  test.setTimeout(120000);
  const a = await celular(browser, sb), b = await celular(browser, sb);
  await cargar(a.page, [{ addr: "Calle 145 # 106-20", guia: "D1" }, { addr: "Calle 139 # 112-15", guia: "D2" }, { addr: "Calle 132 # 105-10", guia: "D3" }]);
  await entregar(a.page, "Calle 145 # 106-20"); await entregar(a.page, "Calle 139 # 112-15");
  await a.page.evaluate(() => syncNow(true)); await b.page.evaluate(() => syncNow(true));
  // B toca «Jornada nueva»: a A se le vacía la lista
  await b.page.click("#btnNew"); await confirmar(b.page);
  await b.page.evaluate(() => syncNow(true)); await a.page.evaluate(() => syncNow(true));
  expect(await a.page.evaluate(() => state.stops.length)).toBe(0);
  // A sigue con pedidos nuevos (más de 8 h después): queda como otra jornada y la anterior sigue completa
  await cargar(a.page, [{ addr: "Calle 153 # 115-40", guia: "E1" }]);
  await a.page.evaluate(() => { const s = state.stops[0]; s.status = "done"; s.doneAt = Date.now() + 9 * 3600000; recordDay(); });
  expect(await hist(a.page)).toEqual([{ paquetes: 2, guias: ["D1", "D2"] }, { paquetes: 1, guias: ["E1"] }]);
  // Historial perdido en el celular: «Recuperar entregas guardadas en la nube» lo reconstruye
  await a.page.evaluate(() => { store.set(HIST_KEY, []); store.set(ACUM_KEY, {}); syncNow(true); });
  await a.page.evaluate(() => syncNow(true));
  await a.page.evaluate(() => { renderHist(); document.getElementById("dlgHist").showModal(); });
  await expect(a.page.locator("#histNube")).toBeVisible();
  await a.page.click("#histNube");
  await expect(a.page.locator("#toast")).toContainText("Se recuperaron 3 pedido(s)");
  const h = await hist(a.page);
  expect(h.flatMap(x => x.guias).sort()).toEqual(["D1", "D2", "E1"]);
  expect(await a.page.evaluate(() => acumSum(() => true).p)).toBe(3);
  // Otra vez: no duplica
  await a.page.click("#histNube");
  await expect(a.page.locator("#toast")).toContainText("ya tenía todo");
  expect(a.errs).toEqual([]); expect(b.errs).toEqual([]);
  await a.ctx.close(); await b.ctx.close();
});
