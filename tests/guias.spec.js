// Buscar por guía, aviso de repetidos, revisión y orden de cargue.
const { test, expect } = require("@playwright/test");
const { entrar, cargar, vigilarErrores, sinCamara, CAMARA } = require("./ayuda");

const PARADAS = [
  { addr: "Calle 145 # 103B-90", guia: "7788990011223344" },
  { addr: "Carrera 91 # 147-20", guia: "1111222233334444, 5555666677778888", qty: 3 },
  { addr: "Calle 138 # 104-15" },
  { addr: "Calle Falsa sin numero", guia: "9999000011112222" }
];

test("buscar escribiendo los últimos números y entregar desde el resultado", async ({ page }) => {
  const errs = vigilarErrores(page);
  await sinCamara(page);
  await entrar(page); await cargar(page, PARADAS);
  await page.click("#btnFind2"); await page.click("#bqScan");
  await expect(page.locator("#scanMsg")).toContainText("No se pudo abrir la cámara");
  await expect(page.locator("#dlgScan")).toHaveAttribute("open", "");
  await page.fill("#scanFindIn", "8888"); await page.click("#scanFindBtn");
  await expect(page.locator("#fdTitle")).toHaveText("Paquete encontrado");
  await expect(page.locator("#fdBody")).toContainText("Parada 2 · 3 paquetes");
  await page.click('#fdActs button:has-text("Entregado")');
  expect(await page.evaluate(() => state.stops.find(s => s.guia.includes("5555")).status)).toBe("done");
  await page.click("#btnFind"); await page.click("#bqScan");
  await page.fill("#scanFindIn", "4321"); await page.click("#scanFindBtn");
  await expect(page.locator("#fdTitle")).toHaveText("No está en tu ruta");
  expect(errs).toEqual([]);
});

test("guía repetida no se agrega otra vez", async ({ page }) => {
  await entrar(page); await cargar(page, PARADAS);
  await page.click("#btnManual"); await page.fill("#fAddr", "Calle 150 # 100-10"); await page.fill("#fGuia", "9999000011112222");
  await page.click("#frmEdit button[type=submit]");
  await expect(page.locator("#fdTitle")).toHaveText("Paquete repetido");
  expect(await page.evaluate(() => state.stops.length)).toBe(4);
});

test("revisar cargue: verificar, sobrantes, Lo tengo y orden de cargue", async ({ page }) => {
  const errs = vigilarErrores(page);
  await sinCamara(page);
  await entrar(page); await cargar(page, PARADAS);
  await page.click("#btnLoad");
  await expect(page.locator("#ldList")).toContainText("Dirección sin reconocer");
  await expect(page.locator("#ldList")).toContainText("Sin guía");
  await page.click("#ldScan");
  for (const g of ["3344", "4444", "5555666677778888", "2222", "777777"]){ await page.fill("#scanFindIn", g); await page.click("#scanFindBtn"); }
  await expect(page.locator("#stCode")).toContainText("no está en la ruta");
  await page.click("#scanClose");
  await expect(page.locator("#dlgLoad")).toHaveAttribute("open", "");
  await expect(page.locator("#ldList")).toContainText("777777");
  await page.click('#ldList .lrow:has-text("Calle 138") button:has-text("Lo tengo")');
  await expect(page.locator("#ldSum")).toHaveText("4paradas6paquetes5verificados");
  await page.click("#ldOrder > summary");
  const orden = await page.$$eval("#ldOrderList li b", e => e.map(x => x.textContent));
  expect(orden).toEqual(["4", "3", "2", "1"]);
  expect(errs).toEqual([]);
});

test("cámara: encuentra el paquete por el código de barras", async ({ page }) => {
  test.skip(!CAMARA, "sin ffmpeg no hay cámara simulada");
  await page.context().grantPermissions(["camera"]);
  await entrar(page); await cargar(page, PARADAS);
  await page.click("#btnFind"); await page.click("#bqScan");
  await expect(page.locator("#fdTitle")).toHaveText("Paquete encontrado", { timeout: 30000 });
  await expect(page.locator("#fdBody")).toContainText("Parada 1");
});

test("cámara: escanear la etiqueta llena dirección, teléfono y guía", async ({ page }) => {
  test.skip(!CAMARA, "sin ffmpeg no hay cámara simulada");
  test.setTimeout(150000);
  await page.context().grantPermissions(["camera"]);
  await entrar(page);
  await page.click("#btnScan");
  await expect(page.locator("#dlgEdit")).toHaveAttribute("open", "", { timeout: 120000 });
  await expect(page.locator("#fAddr")).toHaveValue(/Calle 143 # 118-20/);
  await expect(page.locator("#fPhone")).toHaveValue(/3112223344/);
  await expect(page.locator("#fGuia")).not.toHaveValue("");
});
