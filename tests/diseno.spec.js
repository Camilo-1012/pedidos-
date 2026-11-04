// Diseño en celulares pequeños: nada se sale de la pantalla a lo ancho.
const { test, expect } = require("@playwright/test");
const { entrar, cargar } = require("./ayuda");

for (const ancho of [320, 360, 412]){
  test(`sin desborde horizontal a ${ancho}px`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: 800 });
    await entrar(page);
    await cargar(page, [{ addr: "Calle 145 # 103B-90", guia: "2637905208923531, 1111222233334444", qty: 2, type: "conjunto", unit: "Conjunto Los Pinos, torre 2, apto 301", name: "Laura Gomez", phone: "3112223344", barrio: "Villa María" }]);
    await page.click("text=Más opciones");
    const ancho2 = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(ancho2).toBeLessThanOrEqual(ancho);
    await page.click("#btnLoad");
    expect(await page.evaluate(() => document.querySelector("#dlgLoad").scrollWidth <= document.querySelector("#dlgLoad").clientWidth)).toBe(true);
  });
}
