// Escribir teléfonos a mano después de dictar o pegar varias direcciones (y desde «Revisar cargue»).
const { test, expect } = require("@playwright/test");
const { entrar, vigilarErrores, sinCamara } = require("./ayuda");

async function pegarVarias(page, texto){
  await page.click("text=Más opciones"); await page.click("#btnBulk");
  await page.fill("#txtArea", texto); await page.click("#frmText button[type=submit]");
}
const tel = (page, addr) => page.evaluate(a => (state.stops.find(s => s.label === a) || {}).phone || "", addr);

test("después de pegar varias: escribir teléfonos uno por uno y seguir con las guías", async ({ page }) => {
  const errs = vigilarErrores(page);
  await sinCamara(page);
  await entrar(page);
  await page.evaluate(() => { state.stops = []; save(); render(); });
  await pegarVarias(page, "Calle 145 # 103B-90\nCarrera 110 # 152-30 3112223344\nCalle 139 # 112-15");
  await expect(page.locator("#cfTitle")).toHaveText("Escribir los teléfonos");
  await expect(page.locator("#cfMsg")).toContainText("2 parada(s) quedaron sin teléfono");
  await page.click("#cfYes");
  await expect(page.locator("#dlgTel")).toHaveAttribute("open", "");
  const inputs = page.locator("#telList input");
  await expect(inputs).toHaveCount(2);                          // solo las que no tenían
  await expect(page.locator("#telInfo")).toContainText("0 de 2 con teléfono");
  await expect(inputs.nth(0)).toBeFocused();
  // Con espacios y +57: se limpia y se guarda al pasar al siguiente (Enter)
  await inputs.nth(0).fill("+57 320 555 6677"); await inputs.nth(0).press("Enter");
  await expect(inputs.nth(1)).toBeFocused();
  await expect(inputs.nth(0)).toHaveValue("320 555 6677");
  await expect(page.locator("#telList .telOk").nth(0)).toHaveText("✓");
  // Número incompleto: avisa y no se guarda
  await inputs.nth(1).fill("31122"); await inputs.nth(1).press("Enter");
  await expect(page.locator("#telList .telOk").nth(1)).toContainText("Revisa");
  const labels = await page.$$eval("#telList b", e => e.map(x => x.textContent.replace(/^\d+\. /, "")));
  expect(await tel(page, labels[1])).toBe("");
  // Fijo de 7 dígitos: válido
  await inputs.nth(1).fill("6123456"); await inputs.nth(1).press("Enter");
  expect(await tel(page, labels[0])).toBe("3205556677");
  expect(await tel(page, labels[1])).toBe("6123456");
  expect(await tel(page, "Carrera 110 # 152-30")).toBe("3112223344");   // el que venía en la línea no se tocó
  await expect(page.locator("#telInfo")).toContainText("2 de 2 con teléfono");
  // Seguir con las guías
  await page.click("#telGuias");
  await expect(page.locator("#cfTitle")).toHaveText("Escanear las guías");
  await page.click("#cfNo");
  // Desde «Revisar cargue»: el botón aparece solo si falta alguno
  await page.evaluate(() => { state.stops[0].phone = ""; save(); render(); });
  await page.evaluate(() => { renderLoad(); $("dlgLoad").showModal(); });
  await expect(page.locator("#ldTel")).toHaveText("Escribir teléfonos faltantes (1)");
  await page.click("#ldTel");
  await expect(page.locator("#telList input")).toHaveCount(1);
  await expect(page.locator("#telGuias")).toBeHidden();
  await page.locator("#telList input").fill("3001112233");
  await page.click("#frmTel button[type=submit]");     // «Listo» guarda lo escrito en el campo activo
  expect(await page.evaluate(() => state.stops[0].phone)).toBe("3001112233");
  expect(errs).toEqual([]);
});
