// Historial y Excel: la guía sale completa (como texto) y sin nombres ni teléfonos.
const { test, expect } = require("@playwright/test");
const { entrar, cargar } = require("./ayuda");
const fs = require("fs");

test("Excel por pedido con fecha, horas, guía y dirección", async ({ page }) => {
  await entrar(page);
  await cargar(page, [{ addr: "Calle 145 # 103B-90", guia: "2637905208923531", name: "Laura Gomez", phone: "3112223344" }, { addr: "Carrera 91 # 147-20" }]);
  await page.click("#list li.stop >> nth=0 >> button[data-act=done]");
  await page.click("#list li.stop >> nth=0 >> button[data-act=fail]");
  await page.click("text=Más opciones");
  await page.click("#btnHist");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#histCsvPed")]);
  const csv = fs.readFileSync(await dl.path(), "utf8");
  expect(csv.charCodeAt(0)).toBe(0xFEFF);                       // BOM para que Excel lea tildes
  expect(csv).toContain("Fecha;Salida a ruta;Primera entrega;Última entrega;Duración de la ruta (h:mm);Guía (número de pedido);Dirección");
  expect(csv).toContain("TOTAL DEL DÍA");
  expect(csv).toContain('="2637905208923531"');                 // 16 dígitos completos
  expect(csv).toContain("Calle 145 # 103B-90");
  expect(csv).not.toContain("Laura");
  expect(csv).not.toContain("3112223344");
});

test("Excel: acumulado de entregados, duración de la ruta y totales", async ({ page }) => {
  await entrar(page);
  // Jornada simulada: salida 8:00, entregas 8:30 (2 paquetes), 9:00 y una no entregada a las 9:15.
  await page.evaluate(() => {
    const base = new Date(); base.setHours(8, 0, 0, 0); const t = m => base.getTime() + m * 60000;
    state.stops = [mkStop({ addr: "Calle 145 # 103B-90", guia: "1001", qty: 2 }), mkStop({ addr: "Carrera 110 # 152-30", guia: "1002" }), mkStop({ addr: "Calle 139 # 112-15", guia: "1003" })];
    state.salidaAt = t(0);
    Object.assign(state.stops[0], { status: "done", doneAt: t(30) });
    Object.assign(state.stops[1], { status: "done", doneAt: t(60) });
    Object.assign(state.stops[2], { status: "fail", failAt: t(75) });
    save(); recordDay(); render();
  });
  await page.click("text=Más opciones"); await page.click("#btnHist");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#histCsvPed")]);
  const filas = fs.readFileSync(await dl.path(), "utf8").replace(/^\ufeff/, "").split(/\r?\n/).map(l => l.split(";"));
  const col = n => filas[0].indexOf(n);
  const g = id => filas.find(f => f[col("Guía (número de pedido)")] === `="${id}"`);
  expect(g("1001")[col("Acumulado entregados")]).toBe("2");
  expect(g("1002")[col("Acumulado entregados")]).toBe("3");
  expect(g("1003")[col("Acumulado entregados")]).toBe("");               // no entregado: no suma
  expect(g("1002")[col("Tiempo desde la salida (h:mm)")]).toBe("1:00");
  expect(g("1001")[col("Salida a ruta")]).toMatch(/08:00/);
  expect(g("1001")[col("Duración de la ruta (h:mm)")]).toBe("1:00");    // salida 8:00 → última entrega 9:00
  const tot = filas.find(f => f[col("Guía (número de pedido)")] === "TOTAL DEL DÍA");
  expect(tot[col("Dirección")]).toBe("3 pedido(s) entregado(s) de 4 · 1 no entregado(s)");
  expect(tot[col("Acumulado entregados")]).toBe("3");
  // Excel resumen: salida y duración
  const [dl2] = await Promise.all([page.waitForEvent("download"), page.click("#histCsv")]);
  const res = fs.readFileSync(await dl2.path(), "utf8");
  expect(res).toContain("Salida a ruta");
  expect(res).toContain("Duración de la ruta (h:mm)");
  expect(res).toMatch(/;1:00;/);
});
