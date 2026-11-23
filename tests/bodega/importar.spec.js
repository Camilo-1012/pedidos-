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
  await page.uncheck("#imRecibir");                          // modo «solo esperados»
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

test("Despachar un paquete del listado importado lo cuenta como recibido en su lote, sin preguntar; uno fuera de listado sí pregunta", async ({ page }) => {
  const errs = A.vigilarErrores(page);
  await A.entrar(page);
  await A.agregarRep(page, "Jairo");
  await A.nuevoLote(page, "Xcargo", "Camión");
  await abrir(page);
  await page.setInputFiles("#imFile", ARCH("listado-ejemplo.xlsx"));
  await page.uncheck("#imRecibir");                          // modo «solo esperados»
  await page.click("#imOk");
  expect(await A.kpi(page, "recKpis", 0)).toBe("4");          // esperados
  expect(await A.kpi(page, "recKpis", 1)).toBe("0");          // recibidos
  await page.click('nav.tabs button[data-v="vDespachar"]');
  await page.locator("#desReps button", { hasText: "Jairo" }).click();
  await page.click("#desScan");
  expect((await A.leer(page, "XC1000000001")).txt).toBe("Recibida y para Jairo");
  expect((await A.leer(page, "XC1000000002")).txt).toBe("Recibida y para Jairo");
  // Fuera de todo listado: pregunta antes (puede ser un error de lectura).
  const p = A.leer(page, "ZZ99999999");
  await expect(page.locator("#scAsk")).toContainText("no está en ningún listado");
  await page.click("#scAskYes"); await p;
  await page.click("#scClose");
  await page.click('nav.tabs button[data-v="vRecibir"]');
  expect(await A.kpi(page, "recKpis", 1)).toBe("3");          // recibidos: los 2 del listado + el de fuera (entró al lote abierto)
  expect(await A.kpi(page, "recKpis", 2)).toBe("2");          // faltan
  expect(await A.kpi(page, "recKpis", 3)).toBe("1");          // fuera del listado
  const h = await page.evaluate(() => paq("XC1000000001"));
  expect([h.estado, h.recLote === h.espLote]).toEqual(["RUTA", true]);
  expect(await page.evaluate(() => detalleEv([...EV.values()].find(e => e.tipo === "RECIBIDO" && e.guia === "XC1000000001")))).toContain("al despacharla");
  expect(errs).toEqual([]);
});

test("Listado de 100 (Xcargo + iMile): despachar sin recibir antes descuenta de faltantes y separa por empresa según el código", async ({ page }) => {
  const errs = A.vigilarErrores(page);
  await A.entrar(page);
  await A.agregarRep(page, "Jairo"); await A.agregarRep(page, "Pedro");
  await A.nuevoLote(page, "Otra", "Mixto");                   // lote sin empresa definida: la da el código
  await abrir(page);
  await page.setInputFiles("#imFile", ARCH("prueba-100-paquetes.xlsx"));
  await expect(kpiImp(page, 0)).toHaveText("100");
  await page.uncheck("#imRecibir");                          // modo «solo esperados»
  await page.click("#imOk");
  const [xc, im] = await page.evaluate(() => { const ps = paquetes(() => true); return [ps.filter(p => p.emp === "Xcargo").map(p => p.guia), ps.filter(p => p.emp === "iMile").map(p => p.guia)]; });
  expect([xc.length, im.length]).toEqual([60, 40]);
  expect(xc.every(g => g.length === 16) && im.every(g => g.length === 13)).toBe(true);
  await page.click('nav.tabs button[data-v="vDespachar"]');
  await page.locator("#desReps button", { hasText: "Jairo" }).click();
  await page.click("#desScan");
  for(const g of [...xc.slice(0, 3), ...im.slice(0, 2)]) expect((await A.leer(page, g)).txt).toBe("Recibida y para Jairo");
  await expect(page.locator("#scTarget")).toContainText("lleva 5 (3 Xcargo · 2 iMile)");
  await page.click("#scClose");
  await expect(page.locator("#desReps button", { hasText: "Jairo" })).toContainText("5 en ruta (3 Xcargo · 2 iMile)");
  await expect(page.locator("#desEmp .kpi")).toHaveText(["3lleva de Xcargo", "2lleva de iMile"]);
  await page.click("#desPlanilla");
  await expect(page.locator("#planilla")).toContainText("Xcargo: 3 · iMile: 2");
  await page.locator("#dlgLista .dlgHead button").click();
  // Un código suelto (fuera del listado) también se clasifica por su formato.
  await page.locator("#desReps button", { hasText: "Pedro" }).click();
  await expect(page.locator("#desEmp")).toBeHidden();
  await page.click("#desScan");
  const p = A.leer(page, "6110599999999"); await page.click("#scAskYes"); await p;
  await page.click("#scClose");
  expect(await page.evaluate(() => paq("6110599999999").emp)).toBe("iMile");
  // Recibir: los despachados cuentan como recibidos del lote, sin escanear dos veces.
  await page.click('nav.tabs button[data-v="vRecibir"]');
  expect(await A.kpi(page, "recKpis", 0)).toBe("100");
  expect(await A.kpi(page, "recKpis", 1)).toBe("6");          // 5 del listado + el suelto (entró al lote abierto)
  expect(await A.kpi(page, "recKpis", 2)).toBe("95");         // faltan: solo descuentan los del listado
  expect(await A.kpi(page, "recKpis", 3)).toBe("1");          // fuera del listado
  expect(errs).toEqual([]);
});

test("v2.40: por defecto, importar = ya llegaron: quedan «en bodega» y el control es la asignación", async ({ page }) => {
  const errs = A.vigilarErrores(page);
  await A.entrar(page);
  await A.agregarRep(page, "Jairo");
  await abrir(page);
  await page.setInputFiles("#imFile", ARCH("prueba-100-paquetes.xlsx"));
  await expect(page.locator("#imRecibir")).toBeChecked();
  await page.click("#imOk");
  await expect(page.locator("#toast")).toContainText("100 en bodega");
  expect(await A.kpi(page, "recKpis", 0)).toBe("100");          // esperados
  expect(await A.kpi(page, "recKpis", 1)).toBe("100");          // recibidos
  expect(await A.kpi(page, "recKpis", 2)).toBe("0");            // faltan
  expect(await page.evaluate(() => paquetes(p => p.estado === "BODEGA").length)).toBe(100);
  const g = await page.evaluate(() => paquetes(() => true)[0].guia);
  // Despachar baja «en bodega»; escanear en Recibir dice que ya estaba.
  await page.click('nav.tabs button[data-v="vDespachar"]');
  await page.locator("#desReps button", { hasText: "Jairo" }).click();
  await page.click("#desScan");
  expect((await A.leer(page, g)).txt).toBe("Para Jairo");
  await page.click("#scClose");
  expect(await page.evaluate(() => paquetes(p => p.estado === "BODEGA").length)).toBe(99);
  await page.click('nav.tabs button[data-v="vConsultar"]');
  await page.evaluate(g => verPaquete(g), g);
  await expect(page.locator("#conRes")).toContainText("al importar el listado");
  // Volver a importar el mismo archivo no duplica nada.
  await page.click('nav.tabs button[data-v="vRecibir"]');
  await abrir(page);
  await page.setInputFiles("#imFile", ARCH("prueba-100-paquetes.xlsx"));
  await page.click("#imOk");
  expect(await page.evaluate(() => [...EV.values()].filter(e => e.tipo === "RECIBIDO").length)).toBe(100);
  expect(errs).toEqual([]);
});

test("v2.42: formato real de Xcargo (cargue_pedidos.xlsx): columna «Calle[*]» y direcciones mal escritas", async ({ page }) => {
  const errs = A.vigilarErrores(page);
  await A.entrar(page);
  await abrir(page);
  await page.setInputFiles("#imFile", ARCH("formato-xcargo-real.xlsx"));
  for (const [k, txt] of [["guia", "Tracking number"], ["dir", "Calle[*]"], ["tel", "Celular"], ["nom", "Nombre(s) del cliente"]])
    await expect(page.locator(`#imPaso2 select[data-campo="${k}"] option:checked`)).toContainText(txt);
  await expect(kpiImp(page, 0)).toHaveText("8");
  await expect(kpiImp(page, 3)).toHaveText("7");                 // con dirección (zona): todas menos el centro comercial
  await page.click("#imOk");
  const r = await page.evaluate(() => ["2690000000000002", "2690000000000003", "2690000000000004", "2690000000000005", "2690000000000006", "6110000000008"].map(g => [paq(g).cl, paq(g).kr, paq(g).emp]));
  expect(r).toEqual([[133, 152, "Xcargo"], [131, 123, "Xcargo"], [143, 140, "Xcargo"], [130, 126, "Xcargo"], [133, 124, "Xcargo"], [141, 109, "iMile"]]);
  // Al repartidor le llega la dirección ya legible (la original si se entendía; si no, la arreglada).
  expect(await page.evaluate(() => ["calle150b#120c64", "crr 123#131c-56", "Centro comercial de prueba"].map(direccionLegible))).toEqual(["calle150b#120c64", "CARRERA 123#131C-56", "Centro comercial de prueba"]);
  expect(errs).toEqual([]);
});
