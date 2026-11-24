// Pagos a repartidores por quincena (v2.44): entregados × tarifa; devoluciones no se pagan.
const { test, expect } = require("@playwright/test");
const A = require("./ayuda");

test("pagos por quincena: entregados × $1.600, devueltos no se pagan, marcar pagado, diferencia pendiente, deshacer, tarifa y Excel", async ({ page }) => {
  const errs = A.vigilarErrores(page);
  await A.entrar(page);
  await A.agregarRep(page, "Jairo"); await A.agregarRep(page, "John");
  await A.nuevoLote(page, "Xcargo", "L1");
  await page.click("#recScan");
  for (let i = 1; i <= 6; i++) await A.leer(page, "PG0000000" + i);
  await page.click("#scClose");
  // Jairo: 4 asignados → 3 entregados, 1 devuelto. John: 2 asignados → 1 entregado.
  await page.evaluate(() => {
    const j = repsActivos().find(r => r.nombre === "Jairo").rid, h = repsActivos().find(r => r.nombre === "John").rid;
    ["PG00000001", "PG00000002", "PG00000003", "PG00000004"].forEach(g => registrar("ASIGNADO", g, {rid: j}));
    ["PG00000005", "PG00000006"].forEach(g => registrar("ASIGNADO", g, {rid: h}));
    ["PG00000001", "PG00000002", "PG00000003"].forEach(g => registrar("ENTREGADO", g, {rid: j, por_rep: true}));
    registrar("DEVUELTO", "PG00000004", {rid: j, motivo: "No estaba"});
    registrar("ENTREGADO", "PG00000005", {rid: h});
    pintarTodo();
  });
  await A.menu(page, "btnPagos");
  await expect(page.locator("#ltTitle")).toHaveText("Pagos a repartidores");
  await expect(page.locator("#pgQ option", { hasText: "(la que toca)" })).toHaveCount(1);
  // Los datos de la prueba son de hoy: se elige la quincena actual (la que toca pagar puede ser la anterior, p. ej. el 16 o el 2).
  await page.locator("#pgQ").selectOption(await page.evaluate(() => quincenaDe(new Date().toISOString())));
  const jairo = page.locator(".pgCard", { hasText: "Jairo" });
  await expect(jairo.locator(".pgValor")).toHaveText("$4.800");
  await expect(jairo).toContainText("3 entregado(s) × $1.600 · 1 devuelto(s), no se pagan");
  await expect(page.locator(".pgCard", { hasText: "John" }).locator(".pgValor")).toHaveText("$1.600");
  await expect(page.locator("#pgTot .kpi").first()).toContainText("4");
  // Marcar pagado a Jairo.
  page.once("dialog", d => d.accept());
  await jairo.locator("button", { hasText: "Marcar pagado $4.800" }).click();
  await expect(page.locator(".pgCard", { hasText: "Jairo" })).toContainText("Pagado: 3 = $4.800 · ✓ al día");
  // Llega otro entregado de Jairo en la misma quincena: aparece la diferencia.
  await page.evaluate(() => { const j = repsActivos().find(r => r.nombre === "Jairo").rid; registrar("ASIGNADO", "PG00000006", {rid: j, reasigna: true}); registrar("ENTREGADO", "PG00000006", {rid: j}); });
  await page.evaluate(() => abrirPagos());                     // vuelve a pintar la quincena
  await expect(page.locator(".pgCard", { hasText: "Jairo" })).toContainText("Pendiente: 1 = $1.600");
  // Deshacer el último pago (queda registrado como pago negativo).
  page.once("dialog", d => d.accept());
  await page.locator(".pgCard", { hasText: "Jairo" }).locator("button", { hasText: "Deshacer último pago" }).click();
  await expect(page.locator(".pgCard", { hasText: "Jairo" })).toContainText("Pendiente: 4 = $6.400");
  expect(await page.evaluate(() => PAGOS.map(p => p.n))).toEqual([3, -3]);
  // Tarifa (administrador).
  page.once("dialog", d => d.accept("2000"));
  await page.click("#pgCambiar");
  await expect(page.locator("#pgTarifa")).toHaveText("$2.000");
  await expect(page.locator(".pgCard", { hasText: "Jairo" }).locator(".pgValor")).toHaveText("$8.000");
  // Ver guías y Excel.
  await page.locator(".pgCard", { hasText: "Jairo" }).locator("button", { hasText: "Ver guías" }).click();
  await expect(page.locator(".pgGuias li")).toHaveCount(4);
  await page.locator("#ltActs button", { hasText: "Volver" }).click();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("#ltActs button", { hasText: "Excel de la quincena" }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^pagos-\d{4}-\d{2}-[12]\.xlsx$/);
  expect(errs).toEqual([]);
});

test("quincenas: 1–15 y 16–fin de mes", async ({ page }) => {
  await A.entrar(page);
  expect(await page.evaluate(() => [quincenaDe("2026-11-15T15:00:00"), quincenaDe("2026-11-16T09:00:00"), nombreQuincena("2026-11-2"), nombreQuincena("2026-02-2"), nombreQuincena("2026-12-1")]))
    .toEqual(["2026-11-1", "2026-11-2", "16–30 nov 2026", "16–28 feb 2026", "1–15 dic 2026"]);
  // Pagos el 17 (quincena 1–15) y el 2 (quincena 16–fin del mes anterior).
  expect(await page.evaluate(() => [textoFecha(fechaPago("2026-11-1")), textoFecha(fechaPago("2026-11-2")), textoFecha(fechaPago("2026-12-2")),
    quincenaAPagar(new Date(2026, 11, 2)), quincenaAPagar(new Date(2026, 11, 3)), quincenaAPagar(new Date(2026, 10, 17)), quincenaAPagar(new Date(2026, 10, 18))]))
    .toEqual(["17 nov", "2 dic", "2 ene", "2026-11-2", "2026-12-1", "2026-11-1", "2026-11-2"]);
});
