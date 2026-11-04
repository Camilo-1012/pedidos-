// Historial y Excel: la guía sale completa (como texto) y sin nombres ni teléfonos.
const { test, expect } = require("@playwright/test");
const { entrar, cargar } = require("./ayuda");
const fs = require("fs");

test("Excel por pedido con fecha, horas, guía y dirección", async ({ page }) => {
  await entrar(page);
  await cargar(page, [{ addr: "Calle 145 # 103B-90", guia: "2637905208923531", name: "Laura Gomez", phone: "3112223344" }, { addr: "Carrera 91 # 147-20" }]);
  await page.click("#list li.stop >> nth=0 >> button[data-act=done]");
  await page.click("#list li.stop >> nth=0 >> button[data-act=fail]");
  await page.click("text=Más opciones");
  await page.click("#btnHist");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#histCsvPed")]);
  const csv = fs.readFileSync(await dl.path(), "utf8");
  expect(csv.charCodeAt(0)).toBe(0xFEFF);                       // BOM para que Excel lea tildes
  expect(csv).toContain("Fecha;Primera entrega;Última entrega;Guía (código de barras);Dirección");
  expect(csv).toContain('="2637905208923531"');                 // 16 dígitos completos
  expect(csv).toContain("Calle 145 # 103B-90");
  expect(csv).not.toContain("Laura");
  expect(csv).not.toContain("3112223344");
});
