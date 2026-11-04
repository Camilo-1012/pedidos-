// Guías para paradas dictadas o pegadas: escanear (o escribir) el código de cada paquete después de cargar.
const { test, expect } = require("@playwright/test");
const { entrar, cargar, vigilarErrores, sinCamara, CAMARA } = require("./ayuda");

async function pegarVarias(page, texto){
  await page.click("text=Más opciones"); await page.click("#btnBulk");
  await page.fill("#txtArea", texto); await page.click("#frmText button[type=submit]");
}
const guiaDe = (page, addr) => page.evaluate(a => (state.stops.find(s => s.label === a) || {}).guia || "", addr);

test("después de pegar varias, asocia la guía de cada paquete", async ({ page }) => {
  const errs = vigilarErrores(page);
  await sinCamara(page);
  await entrar(page);
  await page.evaluate(() => { state.stops = []; save(); render(); });
  await pegarVarias(page, "Calle 145 # 103B-90\nCarrera 110 # 152-30 x2\nCalle 139 # 112-15");
  await expect(page.locator("#cfTitle")).toHaveText("Escanear las guías");
  await expect(page.locator("#cfMsg")).toContainText("4 paquete(s) quedaron sin guía");
  await page.click("#cfYes");
  await expect(page.locator("#scanTitle")).toHaveText("Escanear guías");
  await expect(page.locator("#scanAssign")).toBeVisible();
  const primera = await page.evaluate(() => assignTarget().st.label);
  await expect(page.locator("#scanTargetTxt")).toContainText(primera);
  // Escribir la guía de la primera
  await page.fill("#scanFindIn", "1000000000000001"); await page.click("#scanFindBtn");
  expect(await guiaDe(page, primera)).toBe("1000000000000001");
  await expect(page.locator("#stCode")).toContainText("✓ 1000000000000001");
  // Repetida: se rechaza
  await page.fill("#scanFindIn", "1000000000000001"); await page.click("#scanFindBtn");
  await expect(page.locator("#stCode")).toContainText("ya está en");
  // Elegir otra dirección (la de 2 paquetes) y darle sus dos guías
  const idCra = await page.evaluate(() => state.stops.find(s => s.label === "Carrera 110 # 152-30").id);
  await page.selectOption("#scanTarget", idCra);
  await expect(page.locator("#scanTargetTxt")).toContainText("Paquete 1 de 2");
  await page.fill("#scanFindIn", "2000000000000001"); await page.click("#scanFindBtn");
  await expect(page.locator("#scanTargetTxt")).toContainText("Paquete 2 de 2");
  await page.fill("#scanFindIn", "2000000000000002"); await page.click("#scanFindBtn");
  expect(await guiaDe(page, "Carrera 110 # 152-30")).toBe("2000000000000001, 2000000000000002");
  // Saltar la que queda y cerrar: avisa cuántas faltan
  await page.click("#scanSkip");
  await page.click("#scanClose");
  await expect(page.locator("#toast")).toContainText("Quedan 1 paquete(s) sin guía");
  // La que falta tiene el botón «+ Guía» y en Revisar cargue el botón de guías faltantes
  await expect(page.locator('#list li.stop:has-text("Calle 139") button[data-act=guia]')).toBeVisible();
  await expect(page.locator('#list li.stop:has-text("Carrera 110") button[data-act=guia]')).toHaveCount(0);
  await page.click("#btnLoad");
  await expect(page.locator("#ldGuias")).toHaveText("Escanear guías faltantes (1)");
  await page.click("#ldGuias");
  await page.fill("#scanFindIn", "3000000000000001"); await page.click("#scanFindBtn");
  await expect(page.locator("#dlgScan")).not.toHaveAttribute("open", "");     // completó todo: se cierra sola
  await expect(page.locator("#toast")).toContainText("todas las paradas tienen su guía");
  expect(errs).toEqual([]);
});

test("cámara: la guía se asocia sola a la parada propuesta", async ({ page }) => {
  test.skip(!CAMARA, "sin ffmpeg no hay cámara simulada");
  await page.context().grantPermissions(["camera"]);
  await entrar(page);
  await cargar(page, [{ addr: "Calle 145 # 103B-90" }, { addr: "Carrera 110 # 152-30" }]);
  await page.click('#list li.stop >> nth=0 >> button[data-act=guia]');
  await expect(page.locator("#stCode")).toContainText("✓", { timeout: 30000 });
  const g = await page.evaluate(() => state.stops.map(s => s.guia).filter(Boolean));
  expect(g.length).toBe(1);
  expect(g[0].length).toBeGreaterThanOrEqual(6);
});

test("cámara: escanear la etiqueta completa llena la guía de la parada dictada (no suma un paquete)", async ({ page }) => {
  test.skip(!CAMARA, "sin ffmpeg no hay cámara simulada");
  test.setTimeout(150000);
  await page.context().grantPermissions(["camera"]);
  await entrar(page);
  await cargar(page, [{ addr: "Calle 143 # 118-20" }]);    // la dirección de la etiqueta de prueba, sin guía
  await page.click("#btnScan");
  await expect(page.locator("#dlgEdit")).toHaveAttribute("open", "", { timeout: 120000 });
  await page.click("#frmEdit button[type=submit]");
  await expect(page.locator("#toast")).toContainText("Guía agregada a la parada que ya tenías");
  const st = await page.evaluate(() => state.stops.map(s => ({ q: s.qty, g: s.guia, tel: s.phone })));
  expect(st.length).toBe(1);
  expect(st[0].q).toBe(1);
  expect(st[0].g).not.toBe("");
  expect(st[0].tel).toBe("3112223344");
});
