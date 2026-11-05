// Indicadores del día: ritmo, minutos por parada, hora estimada de terminar y comparación de días en el historial.
const { test, expect } = require("@playwright/test");
const { entrar, cargar } = require("./ayuda");

test("ritmo y hora estimada de terminar", async ({ page }) => {
  await entrar(page);
  await cargar(page, [{ addr: "Calle 145 # 103B-90", qty: 2 }, { addr: "Carrera 110 # 152-30" }, { addr: "Calle 139 # 112-15" }, { addr: "Calle 150 # 104-20" }]);
  await expect(page.locator("#pace")).toBeHidden();
  // Dos entregas con 10 minutos de diferencia (se simula la hora)
  const t = await page.evaluate(() => {
    const t1 = Date.now() - 10 * 60000;
    const [a, b] = state.stops;
    a.status = "done"; a.doneAt = t1 - 10 * 60000; b.status = "done"; b.doneAt = t1;
    save(); render(); return t1;
  });
  await expect(page.locator("#pace")).toContainText("10 min por parada");
  await expect(page.locator("#pace")).toContainText("terminas ≈");
  const p = await page.evaluate(() => dayPace());
  expect(Math.round(p.perStop)).toBe(10);
  expect(p.rem).toBe(2);
  expect(Math.abs(p.eta - (Date.now() + 2 * 10 * 60000))).toBeLessThan(5000);  // ahora + 2 paradas × 10 min
  expect(p.perHour).toBeCloseTo(6, 1);                                          // 1 paquete en 10 min (el primero no cuenta)
});

test("historial compara días con paquetes por hora", async ({ page }) => {
  await entrar(page);
  await page.evaluate(() => {
    const d = n => Date.now() - n * 864e5;
    store.set(HIST_KEY, [1, 2, 3].map(n => ({ id: "d" + n, fecha: "", inicio: d(n), fin: d(n) + 4 * 3600000, minutos: 240, entregas: 20 + n, paquetes: 24 + n * 4, noEntregadas: 1, paqNoEntregados: 1, pendientes: 0 })));
  });
  await page.click("text=Más opciones"); await page.click("#btnHist");
  await expect(page.locator("#histChart > div")).toHaveCount(3);
  await expect(page.locator("#histTotals")).toContainText("Pedidos por hora: promedio 8,0");
  await expect(page.locator("#histList")).toContainText("pedidos/hora");
});
