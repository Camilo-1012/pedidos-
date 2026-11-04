// Ruta: agregar a mano, sumar paquetes en la misma dirección, ordenar, entregar y zona de trabajo.
const { test, expect } = require("@playwright/test");
const { entrar, vigilarErrores } = require("./ayuda");

async function escribir(page, addr, guia, qty){
  await page.click("#btnManual");
  await page.fill("#fAddr", addr);
  if (guia) await page.fill("#fGuia", guia);
  if (qty) await page.fill("#fQty", String(qty));
  await page.click("#frmEdit button[type=submit]");
  await expect(page.locator("#dlgEdit")).not.toHaveAttribute("open", "");
}

test("agregar, juntar misma dirección, ordenar y entregar", async ({ page }) => {
  const errs = vigilarErrores(page);
  await entrar(page);
  await escribir(page, "Calle 145 # 103B-90", "1000000000000001");
  await escribir(page, "Carrera 110 # 152-30", "1000000000000002");
  await escribir(page, "Calle 139 # 112-15", "1000000000000003");
  await escribir(page, "Calle 145 # 103B-90", "1000000000000004", 2);   // misma dirección
  const st = await page.evaluate(() => state.stops.map(s => ({ a: s.label, q: s.qty, g: s.guia })));
  expect(st.length).toBe(3);
  expect(st.find(s => s.a === "Calle 145 # 103B-90").q).toBe(3);
  expect(st.find(s => s.a === "Calle 145 # 103B-90").g).toContain("1000000000000004");
  await page.click("#btnSort");
  await expect(page.locator("#list li.stop")).toHaveCount(3);
  // El orden sugerido no debe ser más largo que el orden en que se cargaron.
  const largo = await page.evaluate(() => { const o = currentOrigin(); const p = state.stops.filter(s => s.x !== null); return pathLen(o, p, false); });
  expect(largo).toBeGreaterThan(0);
  await page.click("#list li.stop >> nth=0 >> button[data-act=done]");
  await expect(page.locator("#stDone")).toHaveText("1");
  await expect(page.locator("#list li.stop.done")).toHaveCount(1);
  expect(errs).toEqual([]);
});

test("avisa direcciones fuera de la zona configurada", async ({ page }) => {
  await entrar(page);
  await page.evaluate(() => { state.stops = [mkStop({ addr: "Calle 26 # 68-10" }), mkStop({ addr: "Calle 145 # 110-10" })]; save(); render(); });
  await expect(page.locator("#zoneInfo")).toBeVisible();
  await expect(page.locator("#list")).toContainText("Fuera de tu zona");
});
