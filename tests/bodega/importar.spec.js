// Importar listados (v2.33): Excel .xlsx, ODS y CSV con detección de columnas, resumen antes de importar y zona
// a partir de la dirección. Los archivos de tests/bodega/archivos son EJEMPLOS INVENTADOS (no el formato real de Xcargo).
const { test, expect } = require("@playwright/test");
const path = require("path");
const A = require("./ayuda");
const ARCH = n => path.join(__dirname, "archivos", n);
async function abrir(page){ await page.click("#recManifiesto"); await expect(page.locator("#imFile")).toBeVisible(); }
const kpiImp = (page, i) => page.locator("#imPaso2 .kpi b").nth(i);

test("Excel .xlsx: encuentra la fila de encabezados, detecta columnas, avisa repetidas y sin guía, y guarda solo guía y zona", async ({ page }) => {
  const errs = A.vigilarErrores(page);
  await A.entrar(page);
  await page.evaluate(() => registrar("ZONA", null, {zid: "z1", nombre: "Z1 Tibabuyes", color: "#2f6fdf", cl: [132, 160], kr: [100, 140], activa: true}));
  await abrir(page);                                          // sin lote abierto: se puede importar igual
  await page.setInputFiles("#imFile", ARCH("listado-ejemplo.xlsx"));
  await expect(page.locator("#imPaso2")).toBeVisible();
  await expect(page.locator('#imPaso2 select[data-campo="guia"] option:checked')).toContainText("No. Guía");
  await expect(page.locator('#imPaso2 select[data-campo="dir"] option:checked')).toContainText("Dirección de entrega");
  await expect(page.locator('#imPaso2 select[data-campo="emp"] option:checked')).toContainText("Operador");
  await expect(kpiImp(page, 0)).toHaveText("4");             // 4 guías distintas (una numérica)
  await expect(kpiImp(page, 1)).toHaveText("1");             // repetida
  await expect(kpiImp(page, 2)).toHaveText("1");             // fila sin guía
  await expect(kpiImp(page, 3)).toHaveText("3");             // con dirección reconocible
  await page.click("#imOk");
  await expect(page.locator("#dlgLista")).toBeHidden();
  expect(await A.kpi(page, "recKpis", 0)).toBe("4");          // esperados en el lote nuevo
  const r = await page.evaluate(() => ["XC1000000001", "XC1000000002", "XC1000000003", "12345678901234"].map(g => { const p = paq(g); return [p.estado, p.emp, p.cl, p.kr, (zonaDe(p) || {}).nombre || ""]; }));
  expect(r).toEqual([["ESPERADO", "Xcargo", 145, 103, "Z1 Tibabuyes"], ["ESPERADO", "Xcargo", 152, 104, "Z1 Tibabuyes"], ["ESPERADO", "Xcargo", null, null, ""], ["ESPERADO", "iMile", 146, 135, "Z1 Tibabuyes"]]);
  // Ley 1581: nada del cliente queda guardado (ni nombre, ni teléfono, ni la dirección completa).
  const guardado = await page.evaluate(() => JSON.stringify([...EV.values()]));
  for(const dato of ["Cliente Uno", "3001112233", "103B-90", "Lisboa", "apto 301"]) expect(guardado).not.toContain(dato);
  // Al recibir, ya tienen zona: no pide calle y carrera.
  await page.click("#recScan");
  expect((await A.leer(page, "XC1000000001")).txt).toBe("Recibida · en el listado → Z1 Tibabuyes");
  await page.click("#scClose");
  expect(errs).toEqual([]);
});

test("CSV de Excel en Windows (; y tildes) al lote abierto, ODS, y archivo sin encabezado", async ({ page }) => {
  const errs = A.vigilarErrores(page);
  await A.entrar(page);
  await A.nuevoLote(page, "iMile", "Camión tarde");
  await abrir(page);
  await page.setInputFiles("#imFile", ARCH("listado-ejemplo.csv"));
  await expect(page.locator('#imPaso2 select[data-campo="guia"] option:checked')).toContainText("Número de guía");   // tilde leída bien
  await expect(kpiImp(page, 3)).toHaveText("2");
  await expect(page.locator("#imDest")).toHaveValue("actual");
  await page.click("#imOk");
  expect(await A.kpi(page, "recKpis", 0)).toBe("2");
  expect(await page.evaluate(() => [paq("IM2000000001").cl, paq("IM2000000001").kr, paq("IM2000000001").emp])).toEqual([138, 100, "iMile"]);

  await abrir(page);
  await page.setInputFiles("#imFile", ARCH("listado-ejemplo.ods"));
  await expect(page.locator('#imPaso2 select[data-campo="guia"] option:checked')).toContainText("Tracking");
  await expect(kpiImp(page, 0)).toHaveText("1");
  await page.click("#imOk");
  expect(await A.kpi(page, "recKpis", 0)).toBe("3");

  await abrir(page);
  await page.setInputFiles("#imFile", ARCH("sin-encabezado.csv"));
  await expect(kpiImp(page, 0)).toHaveText("3");             // reconoce la columna de guías por su contenido
  await page.click("#imOk");
  expect(await A.kpi(page, "recKpis", 0)).toBe("6");
  expect(errs).toEqual([]);
});

test("columna elegida a mano se recuerda; archivos que no son listados se explican (.xls, .exe)", async ({ page }) => {
  await A.entrar(page);
  await abrir(page);
  await page.setInputFiles("#imFile", ARCH("listado-ejemplo.xlsx"));
  await page.selectOption('#imPaso2 select[data-campo="dir"]', "");          // «no usar» la dirección
  await expect(kpiImp(page, 3)).toHaveText("—");
  await page.click("#imOk");
  expect(await page.evaluate(() => paq("XC1000000001").cl)).toBeNull();
  await abrir(page);
  await page.setInputFiles("#imFile", ARCH("listado-ejemplo.xlsx"));
  await expect(page.locator('#imPaso2 select[data-campo="dir"]')).toHaveValue("");   // recordó la elección
  await page.setInputFiles("#imFile", ARCH("excel-antiguo.xls"));
  await expect(page.locator("#imErr")).toContainText("Excel antiguo (.xls)");
  await page.setInputFiles("#imFile", ARCH("programa.exe"));
  await expect(page.locator("#imErr")).toContainText("es un programa (.exe)");
  await expect(page.locator("#imPaso2")).toBeHidden();
});
