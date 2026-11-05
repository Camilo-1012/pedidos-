// La app abre sin errores de JavaScript (un archivo que usa algo de otro que carga después rompería todo lo que sigue).
const { test, expect } = require("@playwright/test");
const { entrar, cargar, vigilarErrores } = require("./ayuda");

test("abre sin errores, también con datos y al recargar", async ({ page }) => {
  const errs = vigilarErrores(page);
  await entrar(page);
  await cargar(page, [{ addr: "Calle 145 # 103B-90", guia: "1001", phone: "3112223344", qty: 2 }, { addr: "Carrera 110 # 152-30" }]);
  await page.click("#list li.stop >> nth=0 >> button[data-act=done]");
  await page.reload();
  await page.waitForFunction(() => window.RUTA_LISTA === true);
  await page.waitForTimeout(500);
  expect(errs).toEqual([]);
});
