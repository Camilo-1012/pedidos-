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

// Pantalla dividida / ventana flotante / acostado: todo se puede tocar y el modo conducción cabe completo.
for (const [ancho, alto] of [[412, 360], [412, 300], [780, 360]]){
  test(`pantalla baja ${ancho}×${alto}: se puede usar y el modo conducción cabe`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: alto });
    await entrar(page);
    await cargar(page, [{ addr: "Calle 145 # 103B-90", guia: "2637905208923531", qty: 2, phone: "3112223344", type: "apto", unit: "Torre 2, apto 301" }, { addr: "Carrera 110 # 152-30" }]);
    // La cabecera no queda fija: no puede ocupar más de la mitad de la pantalla.
    const alturaCab = await page.evaluate(() => document.querySelector("header.top").getBoundingClientRect().height);
    expect(alturaCab).toBeLessThan(alto / 2);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("header.top")).position)).toBe("static");
    await page.click("#btnDrive");   // falla si algo lo tapa
    for (const id of ["#dvWaze", "#dvCall", "#dvFail", "#dvDone", "#dvExit"]){
      const r = await page.locator(id).boundingBox();
      expect(r.y + r.height).toBeLessThanOrEqual(alto + 1);
      expect(r.x + r.width).toBeLessThanOrEqual(ancho + 1);
    }
    await expect(page.locator("#dvAddr")).toBeInViewport();
  });
}
