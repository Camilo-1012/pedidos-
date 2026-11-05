// Acumulado general y pagos: valor = paquetes entregados × $1.600 (configurable), por periodo y en los Excel.
const { test, expect } = require("@playwright/test");
const { entrar, cargar, vigilarErrores } = require("./ayuda");
const fs = require("fs");

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
  // Deshacer una entrega baja el acumulado
  await page.click('#list li.stop:has-text("Carrera 110") button[data-act=done]');
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
  // Excel por mes
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#pyCsv")]);
  const mes = fs.readFileSync(await dl.path(), "utf8");
  expect(mes).toContain("Mes;Días trabajados;Pedidos entregados;Pedidos no entregados;Valor ($)");
  expect(mes).toMatch(/TOTAL;2;34;3;52200/);
  // Excel por pedido: valor por fila, acumulado y total del día
  await page.click("#dlgPay .dlgHead button");
  await page.click("text=Más opciones"); await page.click("#btnHist");
  const [dl2] = await Promise.all([page.waitForEvent("download"), page.click("#histCsvPed")]);
  const filas = fs.readFileSync(await dl2.path(), "utf8").replace(/^﻿/, "").split(/\r?\n/).map(l => l.split(";"));
  const c = n => filas[0].indexOf(n);
  const tot = filas.find(f => f[c("Guía (número de pedido)")] === "TOTAL DEL DÍA");
  expect(tot[c("Valor ($)")]).toBe("7200");
  expect(filas.filter(f => f[c("Estado")] === "Entregado").map(f => f[c("Valor ($)")])).toEqual(["5400", "1800"]);
  expect(filas.filter(f => f[c("Estado")] === "Entregado").map(f => f[c("Valor acumulado ($)")])).toEqual(["5400", "7200"]);
  // Excel resumen
  const [dl3] = await Promise.all([page.waitForEvent("download"), page.click("#histCsv")]);
  expect(fs.readFileSync(await dl3.path(), "utf8")).toMatch(/;1800;7200/);
  expect(errs).toEqual([]);
});

test("el acumulado sobrevive a Nueva jornada y va en el respaldo", async ({ page }) => {
  await entrar(page);
  await cargar(page, [{ addr: "Calle 145 # 103B-90" }]);
  await page.click("#list li.stop >> nth=0 >> button[data-act=done]");
  await page.click("#btnNew"); await page.click("#cfYes");
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
