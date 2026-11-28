// v2.58: quitar de la bodega un paquete cargado por error (desde Consultar o la lista «Sin zona»). Nada se borra:
// se anulan sus lecturas y queda en el histórico; no se puede si ya salió de la bodega.
const { test, expect } = require("@playwright/test");
const A = require("./ayuda");

test("quitar un paquete recibido por error: sale de la bodega y de la lista Sin zona; si ya salió no se ofrece", async ({ page }) => {
  const errs = A.vigilarErrores(page);
  await A.entrar(page);
  await A.agregarRep(page, "Jairo");
  await page.evaluate(() => { registrar("ZONA", null, {zid: "za", nombre: "Alcaparros", color: "#1f8a4c", cl: [130, 139], kr: [null, null], activa: true}); pintarTodo(); });
  await A.nuevoLote(page, "Xcargo", "L1");
  await page.click("#recScan");
  for(const g of ["QT00000001", "QT00000002", "QT00000003"]) await A.leer(page, g);
  await page.click("#scClose");
  await expect(page.locator("#recZonas .zcell", { hasText: "Sin zona" })).toHaveText("3Sin zonaXC 3");

  // Desde la lista «Sin zona»: tocar el paquete → Consultar → Quitar.
  await page.locator("#recZonas .zcell", { hasText: "Sin zona" }).click();
  await expect(page.locator("#dlgLista .hint").first()).toContainText("quitarlo si se cargó por error");
  await page.locator('#dlgLista li[data-guia="QT00000002"]').click();
  await expect(page.locator("#conQuitar")).toBeVisible();
  await page.click("#conQuitar");
  await A.responder(page, {});
  await expect(page.locator("#conRes")).toContainText("Quitado de la bodega");
  expect(await page.evaluate(() => [paq("QT00000002") || null, [...new Set((POR_GUIA.get("QT00000002") || []).filter(e => e.tipo === "ANULAR").map(e => e.d.motivo))]])).toEqual([null, ["Cargado por error"]]);
  await page.click('nav.tabs button[data-v="vRecibir"]');
  await expect(page.locator("#recZonas .zcell", { hasText: "Sin zona" })).toHaveText("2Sin zonaXC 2");

  // Si vuelve a llegar, se recibe de nuevo.
  await page.click("#recScan");
  expect((await A.leer(page, "QT00000002")).txt).toBe("Recibida → sin zona");
  await page.click("#scClose");

  // Uno que ya salió (despachado) no ofrece «Quitar».
  await page.click('nav.tabs button[data-v="vDespachar"]');
  await page.locator("#desReps button", { hasText: "Jairo" }).click();
  await page.locator('#desZonasRep button[data-zid="za"]').click();
  await page.click("#desScan"); await A.leer(page, "QT00000003"); await page.click("#scClose");
  await page.click('nav.tabs button[data-v="vConsultar"]');
  await page.fill("#conGuia", "QT00000003"); await page.click("#conForm button[type=submit]");
  await expect(page.locator("#conRes .guiaG")).toHaveText("QT00000003");
  await expect(page.locator("#conQuitar")).toHaveCount(0);
  // Cancelar no quita nada.
  await page.fill("#conGuia", "QT00000001"); await page.click("#conForm button[type=submit]");
  await page.click("#conQuitar"); await A.responder(page, {}, "no");
  expect(await page.evaluate(() => paq("QT00000001").estado)).toBe("BODEGA");
  await page.screenshot({ path: test.info().outputPath("quitar.png") });
  expect(errs).toEqual([]);
});
