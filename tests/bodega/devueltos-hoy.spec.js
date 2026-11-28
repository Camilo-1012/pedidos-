// v2.57: en Devolver se ve CUÁLES paquetes devolvió hoy el repartidor (guía, hora, motivo, dónde está ahora),
// no solo la cantidad; tocar «devueltos hoy» lleva a la lista. Deshacer quita la devolución de la lista.
const { test, expect } = require("@playwright/test");
const A = require("./ayuda");

test("Devolver: lista de devueltos hoy con motivo; deshacer la quita; reasignado muestra dónde está", async ({ page }) => {
  const errs = A.vigilarErrores(page);
  await A.entrar(page);
  await A.agregarRep(page, "Jairo"); await A.agregarRep(page, "John");
  await A.nuevoLote(page, "Xcargo", "L1");
  await page.click("#recScan");
  for(const g of ["DV00000001", "DV00000002", "DV00000003", "DV00000004"]) await A.leer(page, g);
  await page.click("#scClose");
  await page.click('nav.tabs button[data-v="vDespachar"]');
  await page.locator("#desReps button", { hasText: "Jairo" }).click();
  await page.click("#desScan");
  for(const g of ["DV00000001", "DV00000002", "DV00000003", "DV00000004"]) await A.leer(page, g);
  await page.click("#scClose");

  await page.click('nav.tabs button[data-v="vDevolver"]');
  await expect(page.locator("#devHoy li")).toHaveText(["Hoy no ha devuelto paquetes."]);
  await page.selectOption("#devMotivo", "Dirección errada");
  await page.click("#devScan");
  await A.leer(page, "DV00000001");
  await page.click("#scClose");
  await page.selectOption("#devMotivo", "Rechazado por el cliente");
  await page.click("#devScan");
  await A.leer(page, "DV00000002");
  await A.leer(page, "DV00000003");
  await page.click("#scUndo");                       // DV00000003 no se devolvió
  await page.click("#scClose");

  await expect(page.locator("#devKpis .kpi").nth(2)).toHaveText("2devueltos hoy");
  await expect(page.locator("#hDevHoy")).toHaveText("Devueltos hoy · 2");
  const filas = page.locator("#devHoy li");
  await expect(filas).toHaveCount(2);
  await expect(filas.nth(0)).toContainText("DV00000002");
  await expect(filas.nth(0)).toContainText(/Devuelto \d{1,2}:\d{2}.* · Rechazado por el cliente · recibió /);
  await expect(filas.nth(1)).toContainText("DV00000001");
  await expect(filas.nth(1)).toContainText("Dirección errada");
  await expect(page.locator("#devLista")).toContainText("DV00000003");    // sigue por liquidar

  // Se vuelve a despachar a John: sigue en la lista de hoy de Jairo, con dónde está ahora.
  await page.click('nav.tabs button[data-v="vDespachar"]');
  await page.locator("#desReps button", { hasText: "John" }).click();
  await page.click("#desScan"); await A.leer(page, "DV00000001"); await page.click("#scClose");
  await page.click('nav.tabs button[data-v="vDevolver"]');
  await page.locator("#devReps button", { hasText: "Jairo" }).click();
  await expect(page.locator("#devHoy li", { hasText: "DV00000001" })).toContainText("ahora: En ruta con John");

  // Tocar el indicador lleva a la lista.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator("#devKpis .kpi").nth(2).click();
  await expect(page.locator("#hDevHoy")).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath("devueltos-hoy.png") });
  expect(errs).toEqual([]);
});
