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
    const p = A.leer(bo.page, g); await expect(bo.page.locator("#scUbic")).toBeVisible(); await bo.page.fill("#ubCl", cl); await bo.page.fill("#ubKr", "100"); await bo.page.click("#ubOk"); await p;
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
  // v2.37: la bodega corrige (quita) una asignación equivocada → a Andrea le sale de su Ruta.
  await bo.page.locator("#desLista li", { hasText: "6110586210761" }).click();
  await bo.page.locator("#ltActs button", { hasText: "Quitar asignación" }).click();
  await bo.page.evaluate(() => syncNow(false));
  await ru.page.evaluate(() => { bod.ult = 0; });
  await syncRuta(ru.page);
  await expect.poll(() => paradas(ru.page).then(l => l.map(p => p.guia))).toEqual(["2696271051298372"]);
  expect([...bo.errs, ...ru.errs]).toEqual([]);
});

test("v2.38: «Entregado» llega a la bodega aunque la app abra Waze sola; un entregado que no salió se reenvía", async ({ browser }) => {
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
  await A.nuevoLote(bo.page, "Xcargo", "L1");
  await bo.page.click("#recScan");
  for (const g of ["WZ00000001", "WZ00000002", "WZ00000003"]) await A.leer(bo.page, g);
  await bo.page.click("#scClose");
  await bo.page.click('nav.tabs button[data-v="vDespachar"]');
  await bo.page.locator("#desReps button", { hasText: "Andrea" }).click();
  await bo.page.click("#desScan");
  for (const g of ["WZ00000001", "WZ00000002", "WZ00000003"]) await A.leer(bo.page, g);
  await bo.page.click("#scClose");
  await bo.page.evaluate(() => syncNow(false));

  const ru = await contexto(browser, nube);
  await R.entrar(ru.page, "Andrea");
  // Como en el celular real: Waze se abre solo al marcar entregado (se intercepta la apertura).
  await ru.page.evaluate(() => { state.stops = []; state.seeded = true; state.autoWaze = true; save(); render(); window.__waze = []; window.openExternal = u => window.__waze.push(u); });
  await ru.page.click("text=Más opciones"); await ru.page.click("#btnTeamCfg");
  await ru.page.fill("#tmEmail", "andrea@equipo.co"); await ru.page.fill("#tmPass", "Clave-Andrea-1"); await ru.page.click("#tmGo");
  await expect(ru.page.locator("#tmState")).toContainText("Conectado como Andrea");
  await ru.page.keyboard.press("Escape");
  await syncRuta(ru.page);
  await expect.poll(() => paradas(ru.page).then(l => l.length)).toBe(3);
  // Le pone dirección a las dos primeras (para que haya «siguiente» y Waze se abra) y marca entregada la 1.
  await ru.page.evaluate(() => { for (const g of ["WZ00000001", "WZ00000002"]){ const s = state.stops.find(x => x.guia === g); s.addr = s.label = "Calle 145 # 103B-90"; s.x = 4.74; s.y = -74.09; } save(); render(); });
  await ru.page.evaluate(() => toggleDone(state.stops.find(x => x.guia === "WZ00000001")));
  expect(await ru.page.evaluate(() => window.__waze.length)).toBe(1);      // sí abrió Waze…
  await ru.page.evaluate(() => subirCola());
  expect(sb.db.bod.eventos.filter(e => e.tipo === "ENTREGADO").map(e => e.guia)).toEqual(["WZ00000001"]);   // …y avisó a la bodega
  // Un entregado que no salió (como pasaba antes): se marca sin avisar y al sincronizar se reenvía solo.
  await ru.page.evaluate(() => { const s = state.stops.find(x => x.guia === "WZ00000002"); s.status = "done"; s.doneAt = Date.now(); save(); render(); bod.ult = 0; });
  await syncRuta(ru.page);
  await ru.page.evaluate(async () => { bod.ult = 0; await bodegaSync(true); });
  await expect.poll(() => sb.db.bod.eventos.filter(e => e.tipo === "ENTREGADO").map(e => e.guia).sort()).toEqual(["WZ00000001", "WZ00000002"]);
  // No se repite en las siguientes sincronizaciones.
  await ru.page.evaluate(async () => { bod.ult = 0; await bodegaSync(true); bod.ult = 0; await bodegaSync(true); });
  expect(sb.db.bod.eventos.filter(e => e.tipo === "ENTREGADO")).toHaveLength(2);
  // En la bodega: 2 entregados hoy.
  await bo.page.evaluate(() => syncNow(true));
  await expect.poll(() => bo.page.evaluate(() => paquetes(p => p.estado === "ENTREGADO").length)).toBe(2);
  expect([...bo.errs, ...ru.errs]).toEqual([]);
});

test("v2.41: el listado importado trae dirección, teléfono, nombre, barrio y apto; al repartidor le llega todo al asignarle el paquete", async ({ browser }) => {
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
  await bo.page.click("#recManifiesto");
  await bo.page.setInputFiles("#imFile", require("path").join(__dirname, "archivos", "listado-datos.xlsx"));
  // Detecta cada columna (una columna por campo).
  for (const [k, txt] of [["guia", "Tracking"], ["dir", "Dirección"], ["tel", "Teléfono"], ["nom", "Destinatario"], ["bar", "Barrio"], ["uni", "Referencia"]])
    await expect(bo.page.locator(`#imPaso2 select[data-campo="${k}"] option:checked`)).toContainText(txt);
  await bo.page.click("#imOk");
  await bo.page.evaluate(() => syncNow(true));
  await expect.poll(() => sb.db.bod.datos.size).toBe(2);                         // la fila sin datos no sube nada
  expect(sb.db.bod.datos.get("6110000000012")).toEqual({ guia: "6110000000012", direccion: "Carrera 104 # 148-20", telefono: "3109998877", nombre: "Beto Prueba", barrio: "Lisboa", unidad: "Casa esquinera" });
  // Ley 1581: en el histórico (eventos) no quedan nombre, teléfono ni dirección completa; en este celular tampoco quedan pendientes.
  const hist = JSON.stringify(sb.db.bod.eventos) + await bo.page.evaluate(() => JSON.stringify([...EV.values()]));
  for (const x of ["Ana Prueba", "300 111", "103B-90", "Apto 301"]) expect(hist).not.toContain(x);
  expect(await bo.page.evaluate(() => localStorage.getItem("bodega.datos.pend.v1"))).toBeNull();
  // Despacha 2 a Andrea (el de Ana y el que no traía datos).
  await bo.page.click('nav.tabs button[data-v="vDespachar"]');
  await bo.page.locator("#desReps button", { hasText: "Andrea" }).click();
  await bo.page.click("#desScan");
  for (const g of ["2696000000000011", "2696000000000033"]) await A.leer(bo.page, g);
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
  await expect.poll(() => ru.page.evaluate(() => state.stops.filter(s => !s.example).length)).toBe(2);
  const st = await ru.page.evaluate(() => { const s = state.stops.find(x => x.guia === "2696000000000011"); return [s.addr, s.phone, s.name, s.barrio, s.unit, s.x !== null]; });
  expect(st).toEqual(["Calle 145 # 103B-90", "3001112233", "Ana Prueba", "Suba Compartir", "Apto 301 torre 2", true]);
  // Andrea no recibe los datos de Beto (no se lo asignaron).
  expect(await ru.page.evaluate(() => JSON.stringify(state))).not.toContain("Beto Prueba");
  // Solo queda 1 sin dirección (el que no traía datos).
  await expect(ru.page.locator("#pasoCard")).toContainText("1 sin dirección");
  expect([...bo.errs, ...ru.errs]).toEqual([]);
});
