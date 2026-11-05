// Modo conducción: parada actual en grande, entregar, no estaba, saltar y salir con Atrás.
const { test, expect } = require("@playwright/test");
const { entrar, cargar, vigilarErrores } = require("./ayuda");

test("modo conducción de punta a punta", async ({ page }) => {
  const errs = vigilarErrores(page);
  await entrar(page);
  await cargar(page, [
    { addr: "Calle 145 # 103B-90", guia: "1111222233334444", qty: 2, phone: "3112223344", name: "Laura Gomez" },
    { addr: "Carrera 110 # 152-30", guia: "5555666677778888" },
    { addr: "Calle 139 # 112-15" }
  ]);
  await page.click("#btnDrive");
  await expect(page.locator("#drive")).toBeVisible();
  await expect(page.locator("#dvAddr")).toHaveText("Calle 145 # 103B-90");
  await expect(page.locator("#dvQty")).toContainText("2 pedidos en esta dirección");
  // Número de orden en la ruta (el mismo de la lista) y la guía debajo
  await expect(page.locator("#dvGuia .orden")).toHaveText("1");
  await expect(page.locator("#dvGuia .gs")).toContainText("1111222233334444");
  await expect(page.locator("#dvGuiaBtn")).toContainText("Escanear guía 2 de 2");   // 2 paquetes y 1 guía
  // Llamar abre el marcador con el número
  await page.evaluate(() => { window._marcado = null; window.dial = n => { window._marcado = n; }; });
  await page.click("#dvCall");
  expect(await page.evaluate(() => window._marcado)).toBe("3112223344");
  await expect(page.locator("#dvWaze")).toHaveAttribute("href", /waze\.com/);
  await expect(page.locator("#dvNext")).toContainText("Carrera 110 # 152-30");
  // Saltar y volver
  await page.click("#dvNextBtn"); await expect(page.locator("#dvAddr")).toHaveText("Carrera 110 # 152-30");
  await expect(page.locator("#dvGuia .orden")).toHaveText("2");
  await expect(page.locator("#dvPos")).toHaveText("Parada 2 de 3");   // el total no cambia al avanzar
  await expect(page.locator("#dvGuia")).toContainText("1111222233334444".replace(/./g, "") + "5555666677778888");
  // Sin teléfono: el botón dice «Marcar» y abre el marcador vacío
  await expect(page.locator("#dvCall")).toHaveText("Marcar");
  await page.click("#dvCall");
  expect(await page.evaluate(() => window._marcado)).toBe("");
  await page.click("#dvPrev"); await expect(page.locator("#dvAddr")).toHaveText("Calle 145 # 103B-90");
  // Entregar → pasa a la siguiente
  await page.click("#dvDone");
  await expect(page.locator("#dvAddr")).toHaveText("Carrera 110 # 152-30");
  // No estaba → confirmación → pasa al final
  await page.click("#dvFail"); await page.click("#cfYes");
  await expect(page.locator("#dvAddr")).toHaveText("Calle 139 # 112-15");
  await expect(page.locator("#dvNext")).toContainText("Carrera 110 # 152-30");
  // Sigue abierto al recargar
  await page.reload(); await page.waitForFunction(() => window.RUTA_LISTA === true);
  await expect(page.locator("#drive")).toBeVisible();
  // Atrás de Android lo cierra
  await page.goBack();
  await expect(page.locator("#drive")).toBeHidden();
  expect(await page.evaluate(() => state.driveOn)).toBe(false);
  expect(errs).toEqual([]);
});

test("al terminar todas, muestra ¡Terminaste!", async ({ page }) => {
  await entrar(page);
  await cargar(page, [{ addr: "Calle 145 # 103B-90" }]);
  await page.click("#btnDrive"); await page.click("#dvDone");
  await expect(page.locator("#dvAddr")).toHaveText("¡Terminaste!");
  await expect(page.locator("#dvDone")).toBeDisabled();
});
