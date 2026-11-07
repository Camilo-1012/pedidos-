// Ordenar «Por direcciones»: carreras de mayor a menor y, en cada carrera, las calles de mayor a menor (o al revés).
const { test, expect } = require("@playwright/test");
const { entrar, cargar, vigilarErrores, sinInternetExterno } = require("./ayuda");

const PARADAS = [
  { addr: "Calle 144 # 136A-45" }, { addr: "Carrera 141A # 144-58" }, { addr: "Carrera 141 Bis B # 143B-66" },
  { addr: "Carrera 141A Bis C # 143B-14" }, { addr: "Calle 139 # 112-15" }, { addr: "Carrera 145 # 139-10" },
  { addr: "Calle 145 # 106-20" }
];
const orden = page => page.evaluate(() => state.stops.filter(s => s.status !== "done").map(s => s.label));
const listo = page => expect.poll(() => page.evaluate(() => !optimizing)).toBe(true);

test("por direcciones: carreras y calles de mayor a menor, al revés, y calles primero", async ({ page }) => {
  const errs = vigilarErrores(page);
  await sinInternetExterno(page);
  await entrar(page); await cargar(page, PARADAS);
  await page.evaluate(() => { state.autoWaze = false; save(); render(); });
  await expect(page.locator("#ordAuto")).toBeChecked();
  await expect(page.locator("#ordDirBox")).toBeHidden();
  await page.click("label[for=ordDir]"); await listo(page);
  await expect(page.locator("#ordDirBox")).toBeVisible();
  // Carreras de mayor a menor; en la misma carrera (141, 141A, 141 Bis…), las calles de mayor a menor
  expect(await orden(page)).toEqual([
    "Carrera 145 # 139-10",
    "Carrera 141A # 144-58", "Carrera 141 Bis B # 143B-66", "Carrera 141A Bis C # 143B-14",
    "Calle 144 # 136A-45", "Calle 139 # 112-15", "Calle 145 # 106-20"
  ]);
  await expect(page.locator("#routeInfo")).toContainText("Por direcciones: carreras de mayor a menor");
  expect(await page.$$eval("#list li.stop .num", e => e.map(x => x.firstChild.textContent))).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
  // De menor a mayor
  await page.click("#ordAsc"); await listo(page);
  expect((await orden(page))[0]).toBe("Calle 145 # 106-20");
  // Calles primero (de menor a mayor): Calle 139 … Calle 145
  await page.click("label[for=ordPrimCl]"); await listo(page);
  const o = await orden(page);
  expect(o[0]).toBe("Calle 139 # 112-15");
  expect(o.slice(-2)).toEqual(["Carrera 141A # 144-58", "Calle 145 # 106-20"]);   // la 144-58 está a la altura de la calle 144
  // Un pedido nuevo entra en su lugar sin mover las demás; un «No estaba» va al final
  await page.click("#ordAsc"); await page.click("label[for=ordPrimKr]"); await listo(page);
  await page.evaluate(() => { state.stops.push(mkStop({ addr: "Carrera 143 # 140-20" })); save(); render(); return optimize(true, { estable: true }); });
  expect((await orden(page)).slice(0, 3)).toEqual(["Carrera 145 # 139-10", "Carrera 143 # 140-20", "Carrera 141A # 144-58"]);
  await page.evaluate(() => toggleFail(state.stops[0]));
  await listo(page);
  expect((await orden(page)).pop()).toBe("Carrera 145 # 139-10");
  // Volver al automático (mapa)
  await page.click("label[for=ordAuto]"); await listo(page);
  await expect(page.locator("#ordDirBox")).toBeHidden();
  expect(await page.evaluate(() => state.ordenModo)).toBe("auto");
  expect(errs).toEqual([]);
});
