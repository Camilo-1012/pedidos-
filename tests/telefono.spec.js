// Teléfono por voz (opcional) y lectura del teléfono al escanear la guía.
const { test, expect } = require("@playwright/test");
const { entrar, cargar, vigilarErrores, CAMARA } = require("./ayuda");

test("separa dirección y teléfono dictados, con o sin la palabra «teléfono»", async ({ page }) => {
  await entrar(page);
  const r = await page.evaluate(() => [
    "calle ciento cuarenta y cinco numero ciento tres be guion noventa telefono trescientos once doscientos veintidos treinta y tres cuarenta y cuatro",
    "calle 145 # 103B-90 celular 311 222 3344",
    "carrera ciento diez numero ciento cincuenta y dos guion treinta 3 1 1 2 2 2 3 3 4 4",       // sin la palabra
    "calle 139 # 112-15 tel 601 234 5678",
    "calle 139 # 112-15",                                                                          // solo dirección
    "calle 139 # 112-15 telefono tres once"                                                        // número incompleto
  ].map(t => { const s = splitPhone(t); const pa = parseAddress(s.addrConv); return [pa ? pa.label : null, s.tel, s.telMal]; }));
  expect(r[0]).toEqual(["Calle 145 # 103B-90", "3112223344", ""]);
  expect(r[1]).toEqual(["Calle 145 # 103B-90", "3112223344", ""]);
  expect(r[2]).toEqual(["Carrera 110 # 152-30", "3112223344", ""]);
  expect(r[3]).toEqual(["Calle 139 # 112-15", "6012345678", ""]);
  expect(r[4]).toEqual(["Calle 139 # 112-15", "", ""]);
  expect(r[5][0]).toBe("Calle 139 # 112-15");
  expect(r[5][1]).toBe("");
  expect(r[5][2]).toBe("311");
});

test("dictado de varias: cada una con o sin teléfono, y llega a la parada", async ({ page }) => {
  const errs = vigilarErrores(page);
  await entrar(page);
  await page.evaluate(() => { state.stops = []; save(); render(); });
  await page.click("text=Más opciones"); await page.click("#btnBulk");
  await page.evaluate(() => addDictatedLines("calle ciento cuarenta y cinco numero ciento tres be guion noventa telefono trescientos once doscientos veintidos treinta y tres cuarenta y cuatro siguiente carrera ciento diez numero ciento cincuenta y dos guion treinta siguiente calle ciento treinta y nueve numero ciento doce guion quince celular seis cero uno dos tres cuatro cinco seis siete ocho"));
  await expect(page.locator("#micBulkMsg")).toContainText("3 dirección(es) entendida(s), 2 con teléfono");
  await page.click("#frmText button[type=submit]");
  await page.click("#cfNo").catch(() => {});        // no escanear guías ahora
  const st = await page.evaluate(() => Object.fromEntries(state.stops.map(s => [s.label, s.phone])));
  expect(st).toEqual({ "Calle 145 # 103B-90": "3112223344", "Carrera 110 # 152-30": "", "Calle 139 # 112-15": "6012345678" });
  expect(await page.evaluate(() => state.stops.map(s => s.barrio).join(""))).toBe("");   // «Tel …» no queda como barrio
  expect(errs).toEqual([]);
});

test("cámara: al escanear la guía también lee el teléfono de la etiqueta", async ({ page }) => {
  test.skip(!CAMARA, "sin ffmpeg no hay cámara simulada");
  test.setTimeout(120000);
  await page.context().grantPermissions(["camera"]);
  const errs = vigilarErrores(page);
  await entrar(page);
  await cargar(page, [{ addr: "Calle 143 # 118-20" }, { addr: "Carrera 110 # 152-30" }]);
  await page.click('#list li.stop:has-text("Calle 143") button[data-act=guia]');
  await expect(page.locator("#stTel")).toContainText("✓ Teléfono: 311 222 3344", { timeout: 60000 });
  const s = await page.evaluate(() => state.stops.find(x => x.label === "Calle 143 # 118-20"));
  expect(s.phone).toBe("3112223344");
  expect(s.guia.length).toBeGreaterThanOrEqual(6);
  expect(errs).toEqual([]);
});

test("cámara: con la casilla apagada no lee el teléfono", async ({ page }) => {
  test.skip(!CAMARA, "sin ffmpeg no hay cámara simulada");
  await page.context().grantPermissions(["camera"]);
  await entrar(page);
  await page.evaluate(() => { state.assignTel = false; save(); });
  await cargar(page, [{ addr: "Calle 143 # 118-20" }, { addr: "Carrera 110 # 152-30" }]);
  await page.click('#list li.stop:has-text("Calle 143") button[data-act=guia]');
  await expect(page.locator("#stCode")).toContainText("✓", { timeout: 30000 });
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => state.stops.find(x => x.label === "Calle 143 # 118-20").phone)).toBe("");
  await expect(page.locator("#stTel")).toBeHidden();
});

test("«Varias direcciones» también está en Agregar paquete", async ({ page }) => {
  await entrar(page);
  await page.click("#btnBulk2");
  await expect(page.locator("#dlgText")).toHaveAttribute("open", "");
  await expect(page.locator("#txtTitle")).toHaveText("Pegar varias direcciones");
  await expect(page.locator("#micBulk")).toBeVisible();
});
