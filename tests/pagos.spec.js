// Acumulado general y pagos: valor = paquetes entregados × $1.600 (configurable), por periodo y en los Excel.
const { test, expect } = require("@playwright/test");
const { leerXlsx, entrar, cargar, vigilarErrores } = require("./ayuda");
const fs = require("fs");
// Desde v2.49 cada hoja tiene título y datos arriba: la tabla empieza en la fila cuyo primer título es «primera».
const tabla = (filas, primera) => filas.slice(filas.findIndex(f => f[0] === primera));

test("acumulado del día, deshacer, días anteriores, cambio de valor y Excel", async ({ page }) => {
  const errs = vigilarErrores(page);
  await entrar(page);
  // Días anteriores ya guardados: uno de este mes y uno de hace ~40 días (mes anterior o antes), con otros valores.
  await page.evaluate(() => {
    const d = n => ymd(Date.now() - n * 864e5);
    store.set(ACUM_KEY, { a: { f: d(40), p: 30, e: 25, n: 2, t: 1500 } });
  });
  await cargar(page, [{ addr: "Calle 145 # 103B-90", qty: 3 }, { addr: "Carrera 110 # 152-30" }, { addr: "Calle 139 # 112-15" }]);
  // Entregas de hoy: 3 + 1 paquetes = 4 × 1.600 = 6.400; uno no entregado
  await page.click('#list li.stop:has-text("Calle 145") button[data-act=done]');
  await page.click('#list li.stop:has-text("Carrera 110") button[data-act=done]');
  await page.click('#list li.stop:has-text("Calle 139") button[data-act=fail]');
  await expect(page.locator("#pace")).toContainText("Hoy 4 pedidos = $ 6.400");
  // Deshacer una entrega baja el acumulado (las entregadas están en su sección)
  await page.click("#doneCard > summary");
  await page.click('#listDone li.stop:has-text("Carrera 110") button[data-act=done]');
  await expect(page.locator("#pace")).toContainText("Hoy 3 pedidos = $ 4.800");
  await page.click('#list li.stop:has-text("Carrera 110") button[data-act=done]');
  // Pantalla de acumulado
  await page.click("#pace");
  await expect(page.locator("#dlgPay")).toHaveAttribute("open", "");
  await expect(page.locator("#pyFormula")).toContainText("Valor = pedidos entregados × $ 1.600");
  const fila = n => page.locator(`#pyTable .pr:has-text("${n}")`);
  await expect(fila("Hoy")).toContainText("$ 6.400");
  await expect(fila("Hoy")).toHaveText(/Hoy\s*4\s*1\s*\$ 6\.400/);   // 4 pedidos entregados (3 en la misma dirección), 1 no entregado
  await expect(fila("Total general")).toContainText("34");           // 30 + 4 paquetes
  await expect(fila("Total general")).toContainText("$ 51.400");     // 30×1.500 + 4×1.600
  // Cambiar el valor: aplica desde hoy; el día viejo conserva su valor
  await page.fill("#pyRate", "1800"); await page.locator("#pyRate").dispatchEvent("change");
  await expect(fila("Hoy")).toContainText("$ 7.200");
  await expect(fila("Total general")).toContainText("$ 52.200");
  // Excel de pagos (v2.49): Quincenas, Por mes y una hoja por mes (con presentación: título arriba, tabla debajo)
  await expect(fila("Esta quincena")).toContainText("$ 7.200");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#pyCsv")]);
  expect(dl.suggestedFilename()).toMatch(/\.xlsx$/);
  const libroMes = leerXlsx(await dl.path());
  expect(Object.keys(libroMes).slice(0, 2)).toEqual(["Quincenas", "Por mes"]);
  const pm = tabla(libroMes["Por mes"], "Mes");
  expect(pm[0]).toEqual(["Mes", "Días trabajados", "Pedidos entregados", "Pedidos no entregados", "Valor ($)"]);
  expect(pm[pm.length - 1]).toEqual(["TOTAL", 2, 34, 3, 52200]);
  expect(Object.keys(libroMes).length).toBeGreaterThanOrEqual(3);      // + una hoja por mes
  const qz = tabla(libroMes.Quincenas, "Quincena");
  expect(qz[qz.length - 1][0]).toBe("TOTAL");
  expect(qz[qz.length - 1][6]).toBe(34); expect(qz[qz.length - 1][9]).toBe(52200);
  // Excel por pedido: Resumen, Quincenas, Todos los pedidos y una hoja por jornada
  await page.click("#dlgPay .dlgHead button");
  await page.click("text=Más opciones"); await page.click("#btnHist");
  const [dl2] = await Promise.all([page.waitForEvent("download"), page.click("#histCsvPed")]);
  const libro = leerXlsx(await dl2.path());
  const hojas = Object.keys(libro);
  expect(hojas.slice(0, 3)).toEqual(["Resumen", "Quincenas", "Todos los pedidos"]);
  expect(hojas.length).toBe(3 + await page.evaluate(() => histLoad().length));   // una hoja por jornada
  const dia = tabla(libro[hojas[hojas.length - 1]], "#");
  const c = n => dia[0].indexOf(n);
  expect(dia.find(f => f[c("Guía (número de pedido)")] === "TOTAL DEL DÍA" && f[c("Valor ($)")] === 7200)).toBeTruthy();
  const ent = dia.filter(f => f[c("Estado")] === "Entregado");
  expect(ent.map(f => f[c("Valor ($)")])).toEqual([5400, 1800]);
  expect(ent.map(f => f[c("Valor acumulado ($)")])).toEqual([5400, 7200]);
  expect(libro[hojas[hojas.length - 1]][0][0]).toMatch(/^Jornada del \S+ \d\d\/\d\d\/\d{4}$/);
  const todos = tabla(libro["Todos los pedidos"], "Fecha");
  const t = n => todos[0].indexOf(n);
  expect(todos.filter(f => f[t("Estado")] === "Entregado").map(f => f[t("Valor ($)")])).toEqual([5400, 1800]);
  // Excel resumen: Resumen (con subtotal por quincena), Quincenas, una por mes y Datos de la ruta
  const [dl3] = await Promise.all([page.waitForEvent("download"), page.click("#histCsv")]);
  const res = leerXlsx(await dl3.path());
  expect(Object.keys(res)[0]).toBe("Resumen");
  expect(Object.keys(res)[1]).toBe("Quincenas");
  expect(Object.keys(res).pop()).toBe("Datos de la ruta");
  expect(res.Resumen.some(f => f.includes(1800) && f.includes(7200))).toBe(true);
  expect(res.Resumen.some(f => String(f[0]).startsWith("Subtotal quincena ") && f.includes(7200))).toBe(true);
  expect(errs).toEqual([]);
});

test("el acumulado sobrevive a Nueva jornada y va en el respaldo", async ({ page }) => {
  await entrar(page);
  await cargar(page, [{ addr: "Calle 145 # 103B-90" }]);
  await page.click("#list li.stop >> nth=0 >> button[data-act=done]");
  await page.evaluate(() => $("btnNew").click()); await page.click("#cfYes");
  await page.click("text=Más opciones"); await page.click("#btnPay");
  await expect(page.locator('#pyTable .pr:has-text("Total general")')).toContainText("$ 1.600");
  await page.click("#dlgPay .dlgHead button");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#btnBackup")]);
  const data = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
  expect(Object.values(data.acum)[0].p).toBe(1);
  // Restaurar en un «celular nuevo» (acumulado vacío) lo trae
  await page.evaluate(() => store.set(ACUM_KEY, {}));
  await page.setInputFiles("#restoreFile", await dl.path()); await page.click("#cfYes");
  expect(await page.evaluate(() => Object.keys(acumLoad()).length)).toBe(1);
});

test("v2.49: quincenas de pago (2–16 se paga el 17; 17–1 se paga el 2) en pantalla y en Excel", async ({ page }) => {
  const errs = vigilarErrores(page);
  await entrar(page);
  const q = await page.evaluate(() => ["2026-10-02", "2026-10-16", "2026-10-17", "2026-11-01", "2026-11-02", "2026-12-20", "2027-01-01", "2028-02-29"].map(f => { const x = quincenaDe(f); return [x.nombre, x.ini, x.fin, x.pago]; }));
  expect(q).toEqual([
    ["2–16 oct 2026", "2026-10-02", "2026-10-16", "2026-10-17"], ["2–16 oct 2026", "2026-10-02", "2026-10-16", "2026-10-17"],
    ["17 oct – 1 nov 2026", "2026-10-17", "2026-11-01", "2026-11-02"], ["17 oct – 1 nov 2026", "2026-10-17", "2026-11-01", "2026-11-02"],
    ["2–16 nov 2026", "2026-11-02", "2026-11-16", "2026-11-17"], ["17 dic 2026 – 1 ene 2027", "2026-12-17", "2027-01-01", "2027-01-02"],
    ["17 dic 2026 – 1 ene 2027", "2026-12-17", "2027-01-01", "2027-01-02"], ["17 feb – 1 mar 2028", "2028-02-17", "2028-03-01", "2028-03-02"]]);
  await page.evaluate(() => store.set(ACUM_KEY, {
    a: { f: "2026-10-10", p: 10, e: 8, n: 1, t: 1600 }, b: { f: "2026-10-14", p: 5, e: 5, n: 0, t: 1600 },
    c: { f: "2026-10-20", p: 7, e: 6, n: 2, t: 1600 }, x: { f: "2026-11-01", p: 3, e: 3, n: 0, t: 1600 }, d: { f: "2026-11-03", p: 4, e: 4, n: 0, t: 1500 } }));
  await page.click("text=Más opciones"); await page.click("#btnPay");
  const qf = n => page.locator(`#pyQuin .pr:has-text("${n}")`);
  await expect(qf("2–16 oct 2026")).toHaveText(/pago 17\/10\/2026 · 2 día\(s\)\s*15\s*1\s*\$ 24\.000/);
  await expect(qf("17 oct – 1 nov 2026")).toHaveText(/pago 02\/11\/2026 · 2 día\(s\)\s*10\s*2\s*\$ 16\.000/);
  await expect(qf("2–16 nov 2026")).toHaveText(/pago 17\/11\/2026 · 1 día\(s\)\s*4\s*0\s*\$ 6\.000/);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#pyCsv")]);
  const libro = leerXlsx(await dl.path());
  const qz = tabla(libro.Quincenas, "Quincena");
  expect(qz.slice(1, 4).map(f => [f[0], f[3], f[4], f[5], f[6], f[7], f[9]])).toEqual([
    ["2–16 nov 2026", "17/11/2026", "Cumplida", 1, 4, 0, 6000],
    ["17 oct – 1 nov 2026", "02/11/2026", "Cumplida", 2, 10, 2, 16000],
    ["2–16 oct 2026", "17/10/2026", "Cumplida", 2, 15, 1, 24000]]);
  expect(qz[4].slice(0, 1).concat(qz[4].slice(5, 8), [qz[4][9]])).toEqual(["TOTAL", 5, 29, 3, 46000]);
  const oct = tabla(libro["octubre 2026"], "Fecha");
  const subt = oct.filter(f => String(f[0]).startsWith("Subtotal quincena"));
  expect(subt.map(f => [f[0], f[1], f[2], f[5]])).toEqual([["Subtotal quincena 2–16 oct 2026", "Pago 17/10/2026", 15, 24000], ["Subtotal quincena 17 oct – 1 nov 2026 (días de este mes)", "Pago 02/11/2026", 7, 11200]]);
  expect(oct[oct.length - 1].slice(0, 3)).toEqual(["TOTAL DEL MES", "3 día(s)", 22]);
  // En noviembre, el día 1 va con la quincena de octubre y los demás con la de noviembre.
  const nov = tabla(libro["noviembre 2026"], "Fecha").filter(f => String(f[0]).startsWith("Subtotal quincena"));
  expect(nov.map(f => [f[0], f[2]])).toEqual([["Subtotal quincena 17 oct – 1 nov 2026 (días de este mes)", 3], ["Subtotal quincena 2–16 nov 2026", 4]]);
  expect(errs).toEqual([]);
});
