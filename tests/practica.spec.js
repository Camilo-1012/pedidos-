// Mejoras de practicidad: menú del encabezado, tarjeta «qué sigue», tarjetas compactas («⋯»),
// método de carga más usado y aviso de sincronización.
const { test, expect } = require("@playwright/test");
const { menu, entrar, cargar, vigilarErrores } = require("./ayuda");

const TRES = [
  { addr: "Calle 145 # 103B-90", guia: "A1" },
  { addr: "Carrera 110 # 152-30", guia: "A2" },
  { addr: "Calle 139 # 112-15", guia: "A3" },
];

test("encabezado: «Conducir» a la vista y usuario/bloquear dentro del menú", async ({ page }) => {
  const errs = vigilarErrores(page);
  await entrar(page);
  await expect(page.locator("#btnDriveTop")).toBeVisible();
  await expect(page.locator("#btnUser")).toBeHidden();
  await expect(page.locator("#btnLock")).toBeHidden();
  await menu(page);
  await expect(page.locator("#btnMenu")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#btnUserName")).toHaveText("Camilo");
  await expect(page.locator("#btnLock")).toBeVisible();
  // Tocar fuera lo cierra
  await page.click("header h1");
  await expect(page.locator("#hdrMenu")).toBeHidden();
  await expect(page.locator("#btnMenu")).toHaveAttribute("aria-expanded", "false");
  // «Jornada nueva» ya no está en el encabezado: está en Más opciones
  await expect(page.locator(".hdrBtns #btnNew")).toHaveCount(0);
  await expect(page.locator("details #btnNew")).toHaveCount(1);
  expect(errs).toEqual([]);
});

test("tarjeta «qué sigue»: ordenar, repasar «No estaba» y cierre del día", async ({ page }) => {
  const errs = vigilarErrores(page);
  await entrar(page);
  await expect(page.locator("#pasoCard")).toBeHidden();           // sin pedidos no estorba
  await cargar(page, TRES);
  await expect(page.locator("#pasoTxt")).toContainText("3 pedido(s) por entregar · 3 sin ordenar");
  const ordenar = page.locator('#pasoBtns button[data-go="btnSort"]');
  await expect(ordenar).toHaveClass(/primary/);
  await ordenar.click();
  await expect(page.locator("#pasoTxt")).not.toContainText("sin ordenar", { timeout: 15000 });
  await expect(page.locator('#pasoBtns button[data-go="btnDriveTop"]')).toHaveClass(/primary/);

  // Dos entregados y uno «No estaba»
  await page.evaluate(() => { state.stops[0].status = "done"; state.stops[0].doneAt = Date.now();
    state.stops[1].status = "done"; state.stops[1].doneAt = Date.now(); state.stops[2].status = "fail"; save(); render(); });
  await expect(page.locator("#pasoTxt")).toContainText("Te queda 1 «No estaba» por reintentar");
  await expect(page.locator('#pasoBtns button[data-go="btnDriveTop"]')).toHaveText("Repasar en el modo conducción");

  // Todo entregado: reporte, Excel, respaldo y jornada nueva
  await page.evaluate(() => { state.stops[2].status = "done"; state.stops[2].doneAt = Date.now(); save(); render(); });
  await expect(page.locator("#pasoTxt")).toContainText("¡Ruta terminada! 3 pedido(s) entregado(s)");
  await expect(page.locator("#pasoBtns button")).toHaveText(["Reporte del día", "Excel", "Guardar respaldo", "Jornada nueva"]);
  await page.click('#pasoBtns button[data-go="btnReport"]');
  await expect(page.locator("#dlgReport")).toBeVisible();
  expect(errs).toEqual([]);
});

test("tarjetas compactas: «⋯» muestra el resto y se mantiene abierto al repintar", async ({ page }) => {
  const errs = vigilarErrores(page);
  await entrar(page);
  await page.evaluate(() => { state.tarjetasCompletas = false; save(); });
  await cargar(page, TRES);
  const li = page.locator("#list li.stop").first();
  await expect(li).toHaveClass(/compacta/);
  await expect(li.locator("button[data-act=done]")).toBeVisible();
  await expect(li.locator("button[data-act=fail]")).toBeHidden();
  await li.locator("button[data-act=mas]").click();
  await expect(li.locator("button[data-act=fail]")).toBeVisible();
  await expect(li.locator("button[data-act=mas]")).toHaveAttribute("aria-expanded", "true");
  await page.evaluate(() => render());
  await expect(page.locator("#list li.stop").first().locator("button[data-act=fail]")).toBeVisible();
  await page.locator("#list li.stop").first().locator("button[data-act=mas]").click();
  await expect(page.locator("#list li.stop").first().locator("button[data-act=fail]")).toBeHidden();
  // La opción de Más opciones vuelve a mostrar todo
  await page.evaluate(() => { $("optCompletas").checked = true; $("optCompletas").dispatchEvent(new Event("change")); });
  await expect(page.locator("#list li.stop").first()).not.toHaveClass(/compacta/);
  await expect(page.locator("#list li.stop").first().locator("button[data-act=fail]")).toBeVisible();
  expect(await page.evaluate(() => state.tarjetasCompletas)).toBe(true);
  expect(errs).toEqual([]);
});

test("el método de carga más usado pasa a ser el botón grande", async ({ page }) => {
  const errs = vigilarErrores(page);
  await entrar(page);
  await expect(page.locator("#btnScan")).toHaveClass(/usoTop/);
  for (let i = 0; i < 4; i++) await page.evaluate(() => usoCarga("pegar"));
  await expect(page.locator("#btnScan")).toHaveClass(/usoTop/);       // con menos de 5 usos no cambia
  await page.evaluate(() => usoCarga("pegar"));
  await expect(page.locator("#btnPaste")).toHaveClass(/usoTop/);
  await expect(page.locator("#btnScan")).not.toHaveClass(/usoTop/);
  // Se recuerda al volver a abrir
  await page.reload();
  await page.waitForFunction(() => window.RUTA_LISTA === true);
  expect(await page.evaluate(() => state.usoCarga.pegar)).toBe(5);
  expect(errs).toEqual([]);
});

test("la sincronización del equipo corre cada 10 s", async ({ page }) => {
  await entrar(page);
  expect(await page.evaluate(() => SYNC_EVERY)).toBe(10000);
});
