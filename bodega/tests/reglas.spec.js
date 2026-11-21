// Reglas de control: lote cerrado, guía en ruta que llega a recepción, orden por hora real y volumen.
const { test, expect } = require("@playwright/test");
const A = require("./ayuda");

test("lote cerrado no recibe; una guía en ruta que llega a bodega queda como devuelta solo si se confirma", async ({ page }) => {
  const errs = A.vigilarErrores(page);
  await A.entrar(page);
  await A.agregarRep(page, "Jairo");
  await A.nuevoLote(page, "Xcargo", "L1", "3");
  await page.click("#recEscribir"); await A.responder(page, { g: "REGLA00001" });
  expect(await A.kpi(page, "recKpis", 2)).toBe("2");          // sin listado: faltan = cantidad escrita − recibidos
  await page.click('nav.tabs button[data-v="vDespachar"]');
  await page.locator("#desReps button", { hasText: "Jairo" }).click();
  await page.click("#desEscribir"); await A.responder(page, { g: "REGLA00001" });
  await page.click('nav.tabs button[data-v="vRecibir"]');
  await page.click("#recScan");
  expect((await A.leerConRespuesta(page, "REGLA00001", "no")).txt).toContain("sigue en ruta con Jairo");
  expect((await A.leerConRespuesta(page, "REGLA00001", "si")).txt).toBe("Devuelta por Jairo");
  await page.click("#scClose");
  await page.click("#recCerrar"); await A.responder(page, {});
  await expect(page.locator("#recInfo")).toBeHidden();       // no quedan lotes abiertos
  const r = await page.evaluate(() => { prefs.lote = [...LOTES.keys()][0]; pintarRecibir(); return recibirGuia("REGLA00002"); });
  expect(r.tipo).toBe("mal");
  await expect(page.locator("#recScan")).toBeDisabled();
  expect(errs).toEqual([]);
});

test("una lectura hecha antes sin señal se ordena por su hora real al llegar", async ({ page }) => {
  await A.entrar(page);
  const estado = await page.evaluate(() => {
    registrar("REP", null, {rid: "r1", nombre: "Jairo", activo: true});
    registrar("RECIBIDO", "ORDEN00001", {lid: ""});
    registrar("ENTREGADO", "ORDEN00001", {rid: "r1"});
    // Llega de otro celular la asignación, hecha ANTES de la entrega pero subida después.
    const antes = new Date(Date.now() - 60000).toISOString();
    aplicarRemotos([{id: uuid(), at: antes, tipo: "ASIGNADO", guia: "ORDEN00001", d: {rid: "r1"}, por: "Otro", dev: "dX"}]);
    const p = paq("ORDEN00001"); return [p.estado, p.evs.map(e => e.tipo).join(",")];
  });
  // El recibido es de hace un instante y la asignación de hace 1 minuto: queda ASIGNADO, RECIBIDO, ENTREGADO.
  expect(estado).toEqual(["ENTREGADO", "ASIGNADO,RECIBIDO,ENTREGADO"]);
});

test("volumen: 20 000 paquetes (80 000 lecturas) se calculan y pintan rápido", async ({ page }) => {
  await A.entrar(page);
  const t = await page.evaluate(() => {
    for(let i = 0; i < 12; i++) registrar("REP", null, {rid: "r" + i, nombre: "Rep " + i, activo: true});
    const base = Date.now() - 20 * 864e5, evs = [];
    for(let i = 0; i < 20000; i++){
      const g = "VOL" + String(i).padStart(7, "0"), t0 = base + i * 80000, rid = "r" + (i % 12);
      evs.push({id: uuid(), at: new Date(t0).toISOString(), tipo: "RECIBIDO", guia: g, d: {lid: "L"}, por: "x"});
      evs.push({id: uuid(), at: new Date(t0 + 1000).toISOString(), tipo: "ASIGNADO", guia: g, d: {rid}, por: "x"});
      if(i % 7) evs.push({id: uuid(), at: new Date(t0 + 2000).toISOString(), tipo: "ENTREGADO", guia: g, d: {rid}, por: "x"});
      else evs.push({id: uuid(), at: new Date(t0 + 2000).toISOString(), tipo: "DEVUELTO", guia: g, d: {rid, motivo: "No estaba"}, por: "x"});
      evs.push({id: uuid(), at: new Date(t0 + 3000).toISOString(), tipo: "NOVEDAD", guia: g, d: {nota: "n"}, por: "x"});
    }
    let t1 = performance.now(); aplicarRemotos(evs); const aplicar = performance.now() - t1;
    t1 = performance.now(); POR_GUIA.forEach((_, g) => calcPaq(g)); const recalcular = performance.now() - t1;
    t1 = performance.now(); prefs.rep = "r1"; mostrarVista("vDespachar"); const despachar = performance.now() - t1;
    t1 = performance.now(); mostrarVista("vConsultar"); const consultar = performance.now() - t1;
    return {aplicar, recalcular, despachar, consultar, paquetes: PAQ.size};
  });
  console.log("Volumen (ms):", JSON.stringify(t));
  expect(t.paquetes).toBe(20000);
  // Escritorio de CI; un celular de gama media es ~4-6 veces más lento.
  expect(t.recalcular).toBeLessThan(1500);
  expect(t.despachar).toBeLessThan(500);
  expect(t.consultar).toBeLessThan(500);
});
