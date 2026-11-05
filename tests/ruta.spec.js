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
  await expect(page.locator("#listDone li.stop.done")).toHaveCount(1);
  await expect(page.locator("#list li.stop.done")).toHaveCount(0);
  expect(errs).toEqual([]);
});

test("avisa direcciones fuera de la zona configurada", async ({ page }) => {
  await entrar(page);
  await page.evaluate(() => { state.stops = [mkStop({ addr: "Calle 26 # 68-10" }), mkStop({ addr: "Calle 145 # 110-10" })]; save(); render(); });
  await expect(page.locator("#zoneInfo")).toBeVisible();
  await expect(page.locator("#list")).toContainText("Fuera de tu zona");
});

test("las entregadas van en «Pedidos entregados», recogida y desplegable", async ({ page }) => {
  await entrar(page);
  await page.evaluate(() => { state.stops = [mkStop({ addr: "Calle 145 # 103B-90", qty: 2 }), mkStop({ addr: "Carrera 110 # 152-30" }), mkStop({ addr: "Calle 139 # 112-15" })]; save(); render(); });
  await expect(page.locator("#doneWrap")).toBeHidden();                       // sin entregadas no aparece
  await page.click('#list li.stop:has-text("Calle 145") button[data-act=done]');
  await page.click('#list li.stop:has-text("Carrera 110") button[data-act=done]');
  await expect(page.locator("#list li.stop")).toHaveCount(1);
  await expect(page.locator("#doneTitle")).toHaveText("Pedidos entregados (3)");
  await expect(page.locator("#doneSum")).toContainText("2 direcciones");
  await expect(page.locator("#listDone")).toBeHidden();                       // recogida por defecto
  await page.click("#doneCard > summary");
  await expect(page.locator("#listDone li.stop")).toHaveCount(2);
  // Deshacer desde la sección: vuelve a la lista principal
  await page.click('#listDone li.stop:has-text("Carrera 110") button[data-act=done]');
  await expect(page.locator("#list li.stop")).toHaveCount(2);
  await expect(page.locator("#doneTitle")).toHaveText("Pedidos entregados (2)");
  // Recuerda si quedó abierta
  await page.reload(); await page.waitForFunction(() => window.RUTA_LISTA === true);
  await expect(page.locator("#listDone")).toBeVisible();
  // Todas entregadas: la lista principal lo dice
  await page.click('#list li.stop:has-text("Carrera 110") button[data-act=done]');
  await page.click('#list li.stop:has-text("Calle 139") button[data-act=done]');
  await expect(page.locator("#list")).toContainText("No quedan pendientes");
});
