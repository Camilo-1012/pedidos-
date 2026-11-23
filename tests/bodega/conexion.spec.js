// Conexión Bodega ↔ Ruta (v2.31), con Supabase simulado: el despachador asigna y al repartidor le aparece en su Ruta;
// el repartidor completa la dirección (escaneando la etiqueta) y sus «Entregado» / «No estaba» llegan a la bodega.
const { test, expect, devices } = require("@playwright/test");
const A = require("./ayuda"), R = require("../ayuda");
const { crearSupabase } = require("../supabase-falso");
const { agregarBodega } = require("./supabase-bodega");

async function contexto(browser, nube){
  const ctx = await browser.newContext({ ...devices["Pixel 7"], baseURL: "http://localhost:8790" });
  await nube.instalar(ctx);
  const page = await ctx.newPage();
  return { ctx, page, errs: A.vigilarErrores(page) };
}
const syncBodega = page => page.evaluate(() => syncNow(false));
const syncRuta = page => page.evaluate(async () => { await syncNow(true); await subirCola(); });
const paradas = page => page.evaluate(() => state.stops.filter(s => !s.example).map(s => ({ guia: s.guia, addr: s.addr, status: s.status, fuera: !!s.bodegaFuera })));

test("el despachador asigna, al repartidor le aparece, completa la dirección y sus entregas llegan a la bodega", async ({ browser }) => {
  test.setTimeout(120000);
  const sb = crearSupabase(), nube = agregarBodega(sb);
  sb.db.users.push({ id: "u-pedro", email: "pedro@equipo.co", pass: "Clave-Pedro-1" });
  sb.db.miembros.push({ user_id: "u-pedro", nombre: "Pedro", admin: false });

  // ---- Bodega (Camilo, administrador) ----
  const bo = await contexto(browser, nube);
  await A.entrar(bo.page, "Camilo", A.PIN, true);
  await A.menu(bo.page, "btnTeam");
  await bo.page.fill("#tmEmail", "camilo@equipo.co"); await bo.page.fill("#tmPass", "Clave-Camilo-1"); await bo.page.click("#tmConnect");
  await expect(bo.page.locator("#tmOn")).toBeVisible();
  await bo.page.locator("#dlgTeam .dlgHead button").click();
  await A.agregarRep(bo.page, "Andrea"); await A.agregarRep(bo.page, "Pedro");
  // Vincular a Andrea con su cuenta de Ruta.
  await A.menu(bo.page, "btnReps");
  await bo.page.locator("#rpList .urow", { hasText: "Andrea" }).locator("button", { hasText: "Vincular app" }).click();
  await A.responder(bo.page, { u: "u-andrea" });
  await expect(bo.page.locator("#rpList .urow", { hasText: "Andrea" })).toContainText("App de Ruta: Andrea");
  await bo.page.locator("#dlgReps .dlgHead button").click();
  // Recibe y despacha 3 paquetes a Andrea.
  await A.nuevoLote(bo.page, "Xcargo", "L1");
  await bo.page.click("#recScan");
  for (const g of ["CON0000001", "CON0000002", "CON0000003"]) expect((await A.leer(bo.page, g)).tipo).toBe("ok");
  await bo.page.click("#scClose");
  await bo.page.click('nav.tabs button[data-v="vDespachar"]');
  await bo.page.locator("#desReps button", { hasText: "Andrea" }).click();
  await expect(bo.page.locator("#desReps button", { hasText: "Andrea" })).toContainText("📱");
  await bo.page.click("#desScan");
  for (const g of ["CON0000001", "CON0000002", "CON0000003"]) expect((await A.leer(bo.page, g)).txt).toBe("Para Andrea · ya le sale en su app");
  await bo.page.click("#scClose");
  await syncBodega(bo.page);

  // ---- Ruta (Andrea, repartidora) ----
  const ru = await contexto(browser, nube);
  await R.entrar(ru.page, "Andrea");
  await ru.page.evaluate(() => { state.stops = []; state.seeded = true; save(); render(); });
  await ru.page.click("text=Más opciones"); await ru.page.click("#btnTeamCfg");
  await ru.page.fill("#tmEmail", "andrea@equipo.co"); await ru.page.fill("#tmPass", "Clave-Andrea-1"); await ru.page.click("#tmGo");
  await expect(ru.page.locator("#tmState")).toContainText("Conectado como Andrea");
  await ru.page.keyboard.press("Escape");
  await syncRuta(ru.page);
  // Le aparecen los 3, sin dirección, con su guía y la empresa.
  expect((await paradas(ru.page)).map(p => [p.guia, p.addr])).toEqual([["CON0000001", ""], ["CON0000002", ""], ["CON0000003", ""]]);
  await expect(ru.page.locator("#pasoCard")).toContainText("3 sin dirección");
  await expect(ru.page.locator("#pasoBtns button", { hasText: "Escanear y completar" })).toBeVisible();
  const tarjeta = ru.page.locator("#list li.stop", { hasText: "CON0000001" });
  await expect(tarjeta).toContainText("Falta la dirección");
  await expect(tarjeta.locator(".chip.bod")).toHaveText("Bodega · Xcargo");
  await expect(tarjeta.locator("button", { hasText: "Completar" })).toBeVisible();

  // Escanea la etiqueta de CON0000001 (lo que devuelve el lector): abre ESA parada con la dirección leída, no «repetido».
  await ru.page.evaluate(() => completarBodega({ guia: "CON0000001", addr: "Calle 145 # 103B-90", phone: "3001234567" }));
  await expect(ru.page.locator("#dlgEdit")).toBeVisible();
  await expect(ru.page.locator("#dlgTitle")).toContainText("asignado por la bodega");
  await expect(ru.page.locator("#fGuia")).toHaveValue("CON0000001");
  await ru.page.click("#saveTop");
  // La segunda la completa a mano con «Completar».
  await ru.page.locator("#list li.stop", { hasText: "CON0000002" }).locator("button", { hasText: "Completar" }).click();
  await ru.page.fill("#fAddr", "Carrera 104 # 152-30"); await ru.page.locator("#fAddr").dispatchEvent("input");
  await ru.page.click("#saveTop");
  let ps = await paradas(ru.page);
  expect(ps.filter(p => p.addr).length).toBe(2);
  expect(ps.length).toBe(3);                                                    // no se duplicó nada
  await expect(ru.page.locator("#pasoCard")).toContainText("1 sin dirección");

  // Entrega CON0000001 y CON0000002 «No estaba».
  await ru.page.evaluate(() => { toggleDone(state.stops.find(s => s.guia === "CON0000001")); toggleFail(state.stops.find(s => s.guia === "CON0000002")); });
  await syncRuta(ru.page);

  // ---- La bodega lo ve ----
  await syncBodega(bo.page);
  expect(await bo.page.evaluate(() => [paq("CON0000001").estado, paq("CON0000001").porRep, paq("CON0000002").estado, !!paq("CON0000002").noEstaba])).toEqual(["ENTREGADO", true, "RUTA", true]);
  await bo.page.click('nav.tabs button[data-v="vDevolver"]');
  await bo.page.locator("#devReps button", { hasText: "Andrea" }).click();
  expect(await A.kpi(bo.page, "devKpis", 0)).toBe("2");   // por liquidar: 2 y 3
  expect(await A.kpi(bo.page, "devKpis", 1)).toBe("1");   // «no estaba»: debe volver
  await expect(bo.page.locator("#devLista li").first()).toContainText("No estaba");
  // Liquidación con app: lo no reportado sigue con ella por defecto (no se da por entregado).
  await bo.page.click("#devCerrar");
  await expect(bo.page.locator('#ltBody select[data-guia="CON0000003"]')).toHaveValue("SIGUE");
  await expect(bo.page.locator("#ltBody")).toContainText("usa la app");
  await bo.page.locator("#dlgLista .dlgHead button").click();
  // El recorrido lo dice.
  await bo.page.click('nav.tabs button[data-v="vConsultar"]');
  await bo.page.fill("#conGuia", "CON0000001"); await bo.page.click("#conForm button[type=submit]");
  await expect(bo.page.locator("#conRes .linea")).toContainText("Entregada reportó Andrea desde su app");

  // Andrea se equivocó y deshace CON0000001: en la bodega vuelve a estar en ruta.
  await ru.page.evaluate(() => toggleDone(state.stops.find(s => s.guia === "CON0000001")));
  await syncRuta(ru.page); await syncBodega(bo.page);
  expect(await bo.page.evaluate(() => paq("CON0000001").estado)).toBe("RUTA");

  // La bodega pasa CON0000003 (sin dirección) a Pedro y recibe CON0000002 como devuelta.
  await bo.page.click('nav.tabs button[data-v="vDespachar"]');
  await bo.page.locator("#desReps button", { hasText: "Pedro" }).click();
  await bo.page.click("#desScan");
  expect((await A.leerConRespuesta(bo.page, "CON0000003", "si")).txt).toBe("Pasada de Andrea a Pedro");
  await bo.page.click("#scClose");
  await bo.page.click('nav.tabs button[data-v="vDevolver"]');
  await bo.page.locator("#devReps button", { hasText: "Andrea" }).click();
  await bo.page.click("#devScan");
  expect((await A.leer(bo.page, "CON0000002")).tipo).toBe("ok");
  await bo.page.click("#scClose");
  await syncBodega(bo.page);
  await ru.page.evaluate(() => { bod.ult = 0; }); await syncRuta(ru.page);
  ps = await paradas(ru.page);
  expect(ps.map(p => p.guia).sort()).toEqual(["CON0000001", "CON0000002"]);     // CON0000003 (sin dirección) se quitó
  expect(ps.find(p => p.guia === "CON0000002").fuera).toBe(true);               // tenía dirección: se avisa, no se borra
  await expect(ru.page.locator("#list li.stop", { hasText: "CON0000002" })).toContainText("La bodega ya no te lo tiene asignado");

  // Seguridad: Andrea no puede reportar una guía que no está a su nombre (la rechaza la base).
  const r = await ru.page.evaluate(async () => {
    try{ await sbBod("bodega_eventos", { method: "POST", body: JSON.stringify([{ id: crypto.randomUUID(), at: new Date().toISOString(), tipo: "ENTREGADO", guia: "CON0000003", d: { rid: bod.rid, por_rep: true }, por: "x", dev: "x" }]) }); return "aceptado"; }
    catch(e){ return e.status; }
  });
  expect(r).toBe(403);
  // Y no puede leer la tabla de eventos de la bodega.
  expect(await ru.page.evaluate(() => sbBod("bodega_eventos?select=guia"))).toEqual([]);
  expect(bo.errs).toEqual([]); expect(ru.errs).toEqual([]);
  await bo.ctx.close(); await ru.ctx.close();
});

test("un repartidor sin vincular no recibe nada de la bodega y su Ruta sigue igual", async ({ browser }) => {
  const sb = crearSupabase(), nube = agregarBodega(sb);
  sb.db.bod.eventos.push({ id: "00000000-0000-4000-8000-000000000001", at: new Date().toISOString(), tipo: "ASIGNADO", guia: "SOLO000001", d: { rid: "rX" }, seq: 1, user_id: "u-camilo", srv_at: new Date().toISOString() });
  const ru = await contexto(browser, nube);
  await R.entrar(ru.page, "Andrea");
  await ru.page.evaluate(() => { state.stops = [mkStop({ addr: "Calle 145 # 103B-90", guia: "PROPIA0001" })]; state.seeded = true; save(); render(); });
  await ru.page.click("text=Más opciones"); await ru.page.click("#btnTeamCfg");
  await ru.page.fill("#tmEmail", "andrea@equipo.co"); await ru.page.fill("#tmPass", "Clave-Andrea-1"); await ru.page.click("#tmGo");
  await expect(ru.page.locator("#tmState")).toContainText("Conectado como Andrea");
  await ru.page.keyboard.press("Escape");
  await syncRuta(ru.page);
  expect((await paradas(ru.page)).map(p => p.guia)).toEqual(["PROPIA0001"]);
  await ru.page.evaluate(() => toggleDone(state.stops[0]));
  await syncRuta(ru.page);
  expect(sb.db.bod.eventos.length).toBe(1);                                    // no se reportó nada (no es de la bodega)
  expect(ru.errs).toEqual([]);
  await ru.ctx.close();
});

test("cámara: al escanear la etiqueta de un paquete de la bodega, completa ESA parada con la dirección leída (no «repetido»)", async ({ page }) => {
  test.skip(!R.CAMARA, "sin ffmpeg no hay cámara simulada");
  test.setTimeout(150000);
  const errs = A.vigilarErrores(page);
  await page.context().grantPermissions(["camera"]);
  await R.entrar(page);
  // Paquete que asignó la bodega (la guía es la del código de barras de la etiqueta de prueba), aún sin dirección.
  await page.evaluate(() => {
    const s = mkStop({ addr: "", guia: "7788990011223344" }); s.id = "b-7788990011223344"; s.bodega = { emp: "iMile" };
    state.stops = [s]; state.seeded = true; save(); render();
  });
  await expect(page.locator("#pasoCard")).toContainText("1 sin dirección");
  await page.locator("#pasoBtns button", { hasText: "Escanear y completar" }).click();
  await expect(page.locator("#dlgEdit")).toHaveAttribute("open", "", { timeout: 120000 });
  await expect(page.locator("#dlgTitle")).toContainText("asignado por la bodega");
  await expect(page.locator("#fAddr")).toHaveValue(/Calle 143 # 118-20/);
  await expect(page.locator("#fPhone")).toHaveValue(/3112223344/);
  await page.click("#saveTop");
  const st = await page.evaluate(() => state.stops.map(s => ({ id: s.id, label: s.label, phone: s.phone, bodega: !!s.bodega })));
  expect(st).toEqual([{ id: "b-7788990011223344", label: "Calle 143 # 118-20", phone: "3112223344", bodega: true }]);
  await expect(page.locator("#fdTitle")).not.toHaveText("Paquete repetido");
  expect(errs).toEqual([]);
});

test("la zona del paquete y las zonas del repartidor le llegan a su Ruta (v2.36); la empresa sale del código", async ({ browser }) => {
  test.setTimeout(120000);
  const sb = crearSupabase(), nube = agregarBodega(sb);
  const bo = await contexto(browser, nube);
  await A.entrar(bo.page, "Camilo", A.PIN, true);
  await A.menu(bo.page, "btnTeam");
  await bo.page.fill("#tmEmail", "camilo@equipo.co"); await bo.page.fill("#tmPass", "Clave-Camilo-1"); await bo.page.click("#tmConnect");
  await expect(bo.page.locator("#tmOn")).toBeVisible();
  await bo.page.locator("#dlgTeam .dlgHead button").click();
  await A.agregarRep(bo.page, "Andrea");
  await A.menu(bo.page, "btnReps");
  await bo.page.locator("#rpList .urow", { hasText: "Andrea" }).locator("button", { hasText: "Vincular app" }).click();
  await A.responder(bo.page, { u: "u-andrea" });
  await bo.page.locator("#dlgReps .dlgHead button").click();
  await bo.page.evaluate(() => {
    registrar("ZONA", null, {zid: "za", nombre: "Alcaparros", color: "#1f8a4c", cl: [130, 139], kr: [null, null], activa: true});
    registrar("ZONA", null, {zid: "zb", nombre: "Bilbao", color: "#d0421b", cl: [140, 149], kr: [null, null], activa: true});
  });
  await A.nuevoLote(bo.page, "Otra", "L1");
  await bo.page.click("#recScan");
  for (const [g, cl] of [["2696271051298372", "135"], ["6110586210761", "145"]]){
    const p = A.leer(bo.page, g); await bo.page.fill("#ubCl", cl); await bo.page.fill("#ubKr", "100"); await bo.page.click("#ubOk"); await p;
  }
  await bo.page.click("#scClose");
  await bo.page.click('nav.tabs button[data-v="vDespachar"]');
  await bo.page.locator("#desReps button", { hasText: "Andrea" }).click();
  await bo.page.locator('#desZonasRep button[data-zid="za"]').click();
  await bo.page.locator('#desZonasRep button[data-zid="zb"]').click();
  await bo.page.click("#desScan");
  await A.leer(bo.page, "2696271051298372"); await A.leer(bo.page, "6110586210761");
  await bo.page.click("#scClose");
  await bo.page.evaluate(() => syncNow(false));

  const ru = await contexto(browser, nube);
  await R.entrar(ru.page, "Andrea");
  await ru.page.evaluate(() => { state.stops = []; state.seeded = true; save(); render(); });
  await ru.page.click("text=Más opciones"); await ru.page.click("#btnTeamCfg");
  await ru.page.fill("#tmEmail", "andrea@equipo.co"); await ru.page.fill("#tmPass", "Clave-Andrea-1"); await ru.page.click("#tmGo");
  await expect(ru.page.locator("#tmState")).toContainText("Conectado como Andrea");
  await ru.page.keyboard.press("Escape");
  await syncRuta(ru.page);
  await expect(ru.page.locator("#pasoTxt .zonasHoy")).toHaveText("Tu zona: Alcaparros, Bilbao");
  const t1 = ru.page.locator("#list li.stop", { hasText: "2696271051298372" });
  await expect(t1.locator(".chip.zona")).toHaveText("Zona Alcaparros");
  await expect(t1.locator(".chip.bod")).toHaveText("Bodega · Xcargo");
  const t2 = ru.page.locator("#list li.stop", { hasText: "6110586210761" });
  await expect(t2.locator(".chip.zona")).toHaveText("Zona Bilbao");
  await expect(t2.locator(".chip.bod")).toHaveText("Bodega · iMile");
  expect([...bo.errs, ...ru.errs]).toEqual([]);
});
