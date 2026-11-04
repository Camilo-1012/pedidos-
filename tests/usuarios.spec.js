// Usuarios y PIN: creación, PIN débil, bloqueo, intentos fallidos y datos separados por usuario.
const { test, expect } = require("@playwright/test");
const { entrar, teclear, cargar, vigilarErrores, PIN } = require("./ayuda");

test("migra los datos viejos al primer usuario y no guarda el PIN", async ({ page }) => {
  const errs = vigilarErrores(page);
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("rutaEntregas.v1", JSON.stringify({ stops: [{ id: "a", addr: "Calle 145 # 103B-90", x: 103.9, y: 145, label: "Calle 145 # 103B-90", status: "pend", qty: 1, type: "casa", guia: "123456789012" }], seeded: true }));
  });
  await page.reload();
  await expect(page.locator("#suNote")).toContainText("pasan a este usuario");
  await page.fill("#suName", "Camilo"); await page.fill("#suPin", "1234"); await page.fill("#suPin2", "1234");
  await page.click("#lkSetup button[type=submit]");
  await expect(page.locator("#suMsg")).toContainText("seguidos");
  await page.fill("#suPin", PIN); await page.fill("#suPin2", PIN);
  await page.click("#lkSetup button[type=submit]");
  await expect(page.locator("#lock")).toBeHidden({ timeout: 15000 });
  await expect(page.locator("#list")).toContainText("123456789012");
  const almacen = await page.evaluate(() => JSON.stringify(localStorage));
  expect(almacen).not.toContain('"2580"');
  expect(await page.evaluate(() => localStorage.getItem("rutaEntregas.v1"))).toBeNull();
  expect(errs).toEqual([]);
});

test("bloquear, PIN errado con espera y PIN correcto", async ({ page }) => {
  const errs = vigilarErrores(page);
  await entrar(page);
  await page.click("#btnLock");
  await expect(page.locator("#lkLogin")).toBeVisible();
  await page.reload();
  await expect(page.locator("#lkLogin")).toBeVisible();          // recargar no desbloquea
  for (let i = 0; i < 5; i++){ await teclear(page, "1119"); await expect(page.locator("#lkMsg")).not.toHaveText("Verificando…"); }
  await expect(page.locator("#lkMsg")).toContainText("Espera");
  await expect(page.locator("#lkPad button").first()).toBeDisabled();
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("rutaEntregas.auth.")) localStorage.removeItem(k); });
  await page.reload();
  await teclear(page, PIN);
  await expect(page.locator("#lock")).toBeHidden({ timeout: 15000 });
  expect(errs).toEqual([]);
});

test("cada usuario ve solo sus pedidos; el admin restablece PIN", async ({ page }) => {
  const errs = vigilarErrores(page);
  await entrar(page);
  await cargar(page, [{ addr: "Calle 145 # 103B-90", guia: "9990001112223334" }]);
  await page.click("#btnUser"); await page.click("#usAdd");
  await page.fill("#ak_n", "Andrea"); await page.fill("#ak_p", "4711"); await page.fill("#ak_p2", "4711");
  await page.click("#akYes"); await expect(page.locator("#dlgAsk")).not.toHaveAttribute("open", "");
  await page.click('#usList button:has-text("Nuevo PIN")');
  await page.fill("#ak_p", "8642"); await page.fill("#ak_p2", "8642"); await page.click("#akYes");
  await expect(page.locator("#dlgAsk")).not.toHaveAttribute("open", "");
  await page.click("#usSwitch");
  await page.click('#lkUsers button:has-text("Andrea")');
  await teclear(page, "8642");
  await expect(page.locator("#lock")).toBeHidden({ timeout: 15000 });
  await expect(page.locator("#btnUser")).toHaveText("Andrea");
  await expect(page.locator("#list")).not.toContainText("9990001112223334");
  expect(await page.evaluate(() => RUTA_USER.admin)).toBe(false);
  expect(errs).toEqual([]);
});

test("al volver de Waze después del tiempo configurado pide el PIN", async ({ page }) => {
  await entrar(page);
  await page.evaluate(() => {
    const s = JSON.parse(sessionStorage.getItem("rutaEntregas.session.v1"));
    s.away = Date.now() - 16 * 60000; sessionStorage.setItem("rutaEntregas.session.v1", JSON.stringify(s));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("#lkLogin")).toBeVisible();
});
