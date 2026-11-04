// Respaldo: incluye el historial y al restaurar lo junta sin duplicar días.
const { test, expect } = require("@playwright/test");
const { entrar, cargar } = require("./ayuda");
const fs = require("fs");

test("respaldo con historial y restauración que junta días", async ({ page }) => {
  await entrar(page);
  await cargar(page, [{ addr: "Calle 145 # 103B-90", guia: "1111222233334444" }]);
  await page.evaluate(() => { const d = n => Date.now() - n * 864e5; store.set(HIST_KEY, [{ id: "a", inicio: d(2), fin: d(2) + 3600000, minutos: 60, entregas: 5, paquetes: 6 }, { id: "b", inicio: d(1), fin: d(1) + 3600000, minutos: 60, entregas: 7, paquetes: 8 }]); });
  await page.click("text=Más opciones");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#btnBackup")]);
  const data = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
  expect(data.v).toBe(2);
  expect(data.hist.length).toBe(2);
  expect(data.state.stops[0].guia).toBe("1111222233334444");
  // En «otro celular»: otro historial con un día repetido (b) y uno distinto (c)
  await page.evaluate(() => { const d = n => Date.now() - n * 864e5; state.stops = []; save(); store.set(HIST_KEY, [{ id: "b", inicio: d(1), fin: d(1) + 1800000, minutos: 30, entregas: 3, paquetes: 3 }, { id: "c", inicio: d(0.5), fin: d(0.5) + 3600000, minutos: 60, entregas: 2, paquetes: 2 }]); render(); });
  const archivo = await dl.path();
  await page.setInputFiles("#restoreFile", archivo);
  await expect(page.locator("#cfMsg")).toContainText("se juntan 2 día(s) de historial");
  await page.click("#cfYes");
  const h = await page.evaluate(() => histLoad().map(x => x.id + ":" + x.entregas));
  expect(h).toEqual(["a:5", "b:7", "c:2"]);           // b queda con la versión que terminó más tarde
  expect(await page.evaluate(() => state.stops.length)).toBe(1);
});

test("restaura respaldos viejos (sin historial)", async ({ page }) => {
  await entrar(page);
  const viejo = JSON.stringify({ stops: [{ addr: "Calle 145 # 103B-90", guia: "9" }], start: "", seeded: true });
  await page.setInputFiles("#restoreFile", { name: "viejo.json", mimeType: "application/json", buffer: Buffer.from(viejo) });
  await expect(page.locator("#cfMsg")).toContainText("no trae historial");
  await page.click("#cfYes");
  expect(await page.evaluate(() => state.stops.length)).toBe(1);
});
