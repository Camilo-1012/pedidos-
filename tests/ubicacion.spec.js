// Ubicaciones aprendidas al entregar: aprende con buen GPS cerca de la dirección y descarta lecturas malas.
const { test, expect } = require("@playwright/test");
const { entrar, vigilarErrores } = require("./ayuda");

async function agregar(page, addr){
  return page.evaluate(async a => { const s = mkStop({ addr: a, guia: String(Math.random()).slice(2, 14) }); state.stops = state.stops.filter(x => !x.example); state.stops.unshift(s); await locateAll([s]); save(); render(); return s.id; }, addr);
}
async function entregar(page, id, metros, precision){
  const st = await page.evaluate(i => state.stops.find(s => s.id === i), id);
  await page.context().setGeolocation({ latitude: st.lat + metros / 111320, longitude: st.lng, accuracy: precision });
  await page.click(`#list li[data-id="${id}"] button[data-act="done"]`);
  await page.waitForTimeout(800);
  return page.evaluate(() => Object.keys(learned).length);
}

test("aprende solo con GPS preciso y cerca, y lo usa al día siguiente", async ({ page }) => {
  const errs = vigilarErrores(page);
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({ latitude: 4.7, longitude: -74.1, accuracy: 15 });
  await entrar(page);
  expect(await entregar(page, await agregar(page, "Calle 145 # 103B-90"), 60, 12)).toBe(1);
  expect(await entregar(page, await agregar(page, "Carrera 91 # 147-20"), 30, 200)).toBe(1);    // impreciso
  expect(await entregar(page, await agregar(page, "Calle 138 # 100-15"), 5000, 10)).toBe(1);   // lejos
  await page.click("#btnNew"); await page.click("#cfYes");
  await agregar(page, "Calle 145 # 103B-90");
  expect(await page.evaluate(() => state.stops[0].geo)).toBe("gps");
  expect(await page.evaluate(() => wazeUrl(state.stops[0]))).toContain("ll=");
  await expect(page.locator("#list .chip.ok", { hasText: "Ubicación exacta" })).toBeVisible();
  expect(errs).toEqual([]);
});

test("sin permiso de ubicación no aprende ni pregunta", async ({ page }) => {
  await entrar(page);
  const id = await agregar(page, "Calle 145 # 103B-90");
  await page.click(`#list li[data-id="${id}"] button[data-act="done"]`);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => Object.keys(learned).length)).toBe(0);
});
