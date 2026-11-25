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
  // v2.50: apps por APK: paquete + pantalla de inicio (tal como lo muestra «Package Name Viewer», en dos líneas o con «/»).
  expect(await page.evaluate(() => [
    paqueteDe("com.imile.redelivery\ncom.imile.redelivery.MainActivity"), paqueteDe("com.imile.redelivery/.MainActivity"),
    paqueteDe("Rider Delivery\ncom.imile.redelivery\ncom.imile.redelivery.MainActivity"), paqueteDe("com.imile.redelivery")
  ])).toEqual(["com.imile.redelivery/com.imile.redelivery.MainActivity", "com.imile.redelivery/com.imile.redelivery.MainActivity",
    "com.imile.redelivery/com.imile.redelivery.MainActivity", "com.imile.redelivery"]);
  // Registrar los intent que se abren
  await page.evaluate(() => { window.__abiertos = []; const c = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function(){ if(this.href.startsWith("intent:")) window.__abiertos.push(this.href); else c.call(this); }; });
  await page.click("#btnDrive");
  await expect(page.locator("#dvXcargo")).toBeVisible();
  // Sin configurar: usa el paquete predeterminado de Play Store
  await page.click("#dvImile");
  await expect.poll(() => page.evaluate(() => window.__abiertos.length)).toBe(1);   // abre después de copiar la guía
  // iMile (Rider Delivery, por APK): abre su pantalla de inicio directamente y, si falta, vuelve a la Ruta (no a Play Store).
  const im = (await page.evaluate(() => window.__abiertos))[0];
  expect(im).toContain("package=com.imile.redelivery;component=com.imile.redelivery/com.imile.redelivery.MainActivity;");
  expect(decodeURIComponent(im)).toContain("#app-no-encontrada=imile");
  expect(decodeURIComponent(im)).not.toContain("play.google.com");
  await page.click("#dvXcargo");
  await expect.poll(() => page.evaluate(() => window.__abiertos.length)).toBe(2);
  expect((await page.evaluate(() => window.__abiertos))[1]).toContain("package=com.bigsmart.xcargo;");
  await page.evaluate(() => { window.__abiertos = []; });
  // Cambiarlo por el enlace de la app que tiene el celular
  await page.click("#dvAppsCfg");
  await expect(page.locator("#apXcargoOk")).toContainText("Predeterminada (com.bigsmart.xcargo)");
  await page.fill("#apXcargo", "esto no es un enlace"); await page.locator("#apXcargo").dispatchEvent("change");
  await expect(page.locator("#apXcargoOk")).toContainText("No entendí ese enlace");
  await page.fill("#apXcargo", "https://play.google.com/store/apps/details?id=co.xcargo.driver"); await page.locator("#apXcargo").dispatchEvent("change");
  await expect(page.locator("#apXcargoOk")).toContainText("✓ Lista (co.xcargo.driver)");
  await page.click("#dlgApps button[type=submit]");
  // Abrir: intent con el paquete y la tienda como respaldo; la guía queda copiada
  await page.click("#dvXcargo");
  await expect.poll(() => page.evaluate(() => window.__abiertos.length)).toBe(1);
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

test("v2.50: si la app no está instalada, vuelve a la Ruta con un aviso claro", async ({ page }) => {
  const errs = vigilarErrores(page);
  await entrar(page);
  // Chrome abre la dirección de respaldo: la app carga de nuevo con ese marcador.
  await page.evaluate(() => { history.replaceState(null, "", location.pathname + "#app-no-encontrada=imile"); location.reload(); });
  await page.waitForFunction(() => window.RUTA_LISTA === true);
  await expect(page.locator("#toast")).toContainText("No encontré iMile en este celular");
  expect(await page.evaluate(() => location.hash)).toBe("");
  expect(errs).toEqual([]);
});
