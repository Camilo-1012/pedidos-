// Abrir Xcargo / iMile desde el modo conducción (Android, enlace «intent:» con el paquete de Play Store).
const { test, expect } = require("@playwright/test");
const { entrar, cargar, vigilarErrores } = require("./ayuda");

test.use({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36" });

test("apps de entrega: configurar con el enlace de Play Store y abrir con la guía copiada", async ({ page, context }) => {
  const errs = vigilarErrores(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await entrar(page);
  await cargar(page, [{ addr: "Calle 145 # 106-20", guia: "TEMU123456789" }, { addr: "Calle 139 # 112-15" }]);
  expect(await page.evaluate(() => [
    paqueteDe("https://play.google.com/store/apps/details?id=com.imile.driver&hl=es_419"),
    paqueteDe("com.xcargo.driver"), paqueteDe("hola mundo"), paqueteDe("")
  ])).toEqual(["com.imile.driver", "com.xcargo.driver", null, ""]);
  // Registrar los intent que se abren
  await page.evaluate(() => { window.__abiertos = []; const c = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function(){ if(this.href.startsWith("intent:")) window.__abiertos.push(this.href); else c.call(this); }; });
  await page.click("#btnDrive");
  await expect(page.locator("#dvXcargo")).toBeVisible();
  // Sin configurar: abre la configuración
  await page.click("#dvXcargo");
  await expect(page.locator("#dlgApps")).toHaveAttribute("open", "");
  await expect(page.locator("#apXcargo")).toBeFocused();
  await page.fill("#apXcargo", "esto no es un enlace"); await page.locator("#apXcargo").dispatchEvent("change");
  await expect(page.locator("#apXcargoOk")).toContainText("No entendí ese enlace");
  await page.fill("#apXcargo", "https://play.google.com/store/apps/details?id=co.xcargo.driver"); await page.locator("#apXcargo").dispatchEvent("change");
  await expect(page.locator("#apXcargoOk")).toContainText("✓ Lista (co.xcargo.driver)");
  await page.click("#dlgApps button[type=submit]");
  // Abrir: intent con el paquete y la tienda como respaldo; la guía queda copiada
  await page.click("#dvXcargo");
  const abiertos = await page.evaluate(() => window.__abiertos);
  expect(abiertos[0]).toContain("package=co.xcargo.driver;");
  expect(abiertos[0]).toContain("category=android.intent.category.LAUNCHER");
  expect(decodeURIComponent(abiertos[0])).toContain("S.browser_fallback_url=https://play.google.com/store/apps/details?id=co.xcargo.driver");
  await expect(page.locator("#toast")).toContainText("Guía TEMU123456789 copiada");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("TEMU123456789");
  // Queda guardado
  expect(await page.evaluate(() => state.appsExt)).toEqual({ xcargo: "co.xcargo.driver" });
  expect(errs).toEqual([]);
});
