// Flujo completo de un día: recepción con listado esperado, despacho, devoluciones, liquidación, consulta y Excel.
const { test, expect } = require("@playwright/test");
const fs = require("fs"), path = require("path");
const A = require("./ayuda");

test("archivos de la app: versión, caché y lista de carga coinciden", async () => {
  const raiz = path.join(__dirname, "..");
  const sw = fs.readFileSync(path.join(raiz, "sw.js"), "utf8"), acc = fs.readFileSync(path.join(raiz, "js/00-acceso.js"), "utf8");
  const arr = fs.readFileSync(path.join(raiz, "js/11-arranque.js"), "utf8");
  const ver = /APP_VERSION = "([^"]+)"/.exec(arr)[1];
  expect(/CACHE = "bodega-v([^"]+)"/.exec(sw)[1]).toBe(ver);
  const core = JSON.parse("[" + /const CORE = \[([\s\S]*?)\];/.exec(sw)[1] + "]");
  const appFiles = JSON.parse(/const APP_FILES = (\[[^\]]*\])/.exec(acc)[1]);
  const js = fs.readdirSync(path.join(raiz, "js")).map(f => "js/" + f);
  js.forEach(f => expect(core, f + " en CORE").toContain(f));
  js.filter(f => !f.endsWith("00-acceso.js")).forEach(f => expect(appFiles, f + " en APP_FILES").toContain(f));
  core.filter(f => f !== "./").forEach(f => expect(fs.existsSync(path.join(raiz, f)), f + " existe").toBe(true));
});

test("recepción con listado: recibidos, repetidos, fuera del listado, deshacer y faltantes", async ({ page }) => {
  const errs = A.vigilarErrores(page);
  await A.entrar(page);
  await A.nuevoLote(page, "Xcargo", "Camión mañana");
  await page.click("#recManifiesto");
  await page.fill("#mfTxt", "GUIA100001\nGUIA100002, GUIA100003 ruido 12\n\"GUIA100004\"");
  await expect(page.locator("#mfInfo")).toHaveText("4 guía(s) encontradas.");
  await page.click("#ltActs button.primary");
  expect(await A.kpi(page, "recKpis", 0)).toBe("4");

  await page.click("#recScan");
  await expect(page.locator("#dlgScan")).toBeVisible();
  expect((await A.leer(page, "guia100001")).txt).toBe("Recibida · en el listado");
  expect((await A.leer(page, "GUIA100002")).tipo).toBe("ok");
  expect((await A.leer(page, "GUIA100002")).tipo).toBe("rep");               // repetida: no cuenta dos veces
  expect((await A.leer(page, "OTRA555555")).txt).toBe("Recibida · NO está en el listado");
  expect((await A.leer(page, "abc")).tipo).toBe("mal");                       // no parece guía
  await expect(page.locator("#scN")).toHaveText("3");
  await page.click("#scUndo");                                                // deshace OTRA555555
  await expect(page.locator("#scN")).toHaveText("2");
  await page.click("#scClose");

  expect(await A.kpi(page, "recKpis", 1)).toBe("2");   // recibidos
  expect(await A.kpi(page, "recKpis", 2)).toBe("2");   // faltan
  expect(await A.kpi(page, "recKpis", 3)).toBe("0");   // fuera del listado (se deshizo)
  await page.click("#recFaltan");
  await expect(page.locator("#ltBody")).toContainText("GUIA100003");
  await expect(page.locator("#ltBody")).toContainText("GUIA100004");
  await expect(page.locator("#ltBody")).not.toContainText("GUIA100001");
  await page.locator("#dlgLista .dlgHead button").click();
  await expect(page.locator("#stBodega")).toHaveText("2");
  expect(errs).toEqual([]);
});

test("despacho, reasignación, devolución con motivo, liquidación y Excel", async ({ page }) => {
  const errs = A.vigilarErrores(page);
  await A.entrar(page);
  await A.agregarRep(page, "Jairo");
  await A.agregarRep(page, "Pedro");
  await A.nuevoLote(page, "iMile");
  await page.click("#recScan");
  for(const g of ["G0000001", "G0000002", "G0000003", "G0000004"]) expect((await A.leer(page, g)).tipo).toBe("ok");
  await page.click("#scClose");

  // Despachar a Jairo: 3 guías.
  await page.click('nav.tabs button[data-v="vDespachar"]');
  await page.locator("#desReps button", { hasText: "Jairo" }).click();
  await page.click("#desScan");
  for(const g of ["G0000001", "G0000002", "G0000003"]) expect((await A.leer(page, g)).txt).toBe("Para Jairo");
  expect((await A.leer(page, "G0000001")).txt).toBe("Ya la lleva Jairo");
  // Una guía que no llegó a la bodega: pregunta antes de recibirla y entregarla.
  expect((await A.leerConRespuesta(page, "G0000009", "no")).tipo).toBe("mal");
  await page.click("#scClose");
  expect(await A.kpi(page, "desKpis", 1)).toBe("3");

  // Pedro: una de Jairo pasa a Pedro solo si se confirma.
  await page.locator("#desReps button", { hasText: "Pedro" }).click();
  await page.click("#desScan");
  expect((await A.leerConRespuesta(page, "G0000003", "si")).txt).toBe("Pasada de Jairo a Pedro");
  expect((await A.leer(page, "G0000004")).tipo).toBe("ok");
  await page.click("#scClose");
  await page.click("#desPlanilla");
  await expect(page.locator("#planilla")).toContainText("Total: 2 paquete(s)");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#ltActs button.primary")]);
  const xl = A.leerXlsx(await dl.path());
  const hoja = Object.values(xl)[0];
  expect(hoja.slice(1, 3).map(f => f[1]).sort()).toEqual(["G0000003", "G0000004"]);
  await page.locator("#dlgLista .dlgHead button").click();
  await expect(page.locator("#stRuta")).toHaveText("4");

  // Jairo vuelve: devuelve G0000002 («Dirección errada»); G0000001 queda entregada al liquidar.
  await page.click('nav.tabs button[data-v="vDevolver"]');
  await page.locator("#devReps button", { hasText: "Jairo" }).click();
  expect(await A.kpi(page, "devKpis", 0)).toBe("2");
  await page.selectOption("#devMotivo", "Dirección errada");
  await page.click("#devScan");
  expect((await A.leer(page, "G0000002")).txt).toBe("Devuelta · Dirección errada");
  expect((await A.leer(page, "G0000002")).tipo).toBe("rep");
  await page.click("#scClose");
  await page.click("#devCerrar");
  await expect(page.locator("#lqRes")).toContainText("Entregados 1 · Faltantes 0");
  await page.click("#ltActs button.primary");
  await expect(page.locator("#dlgLista")).toBeHidden();
  expect(await A.kpi(page, "devKpis", 0)).toBe("0");

  // Pedro: G0000004 faltante, G0000003 sigue con él.
  await page.locator("#devReps button", { hasText: "Pedro" }).click();
  await page.click("#devCerrar");
  await page.selectOption('#ltBody select[data-guia="G0000004"]', "FALTANTE");
  await page.selectOption('#ltBody select[data-guia="G0000003"]', "SIGUE");
  await page.click("#ltActs button.primary");
  await A.responder(page, {});                                     // confirma faltantes
  expect(await A.kpi(page, "devKpis", 0)).toBe("1");

  // Resumen del día y recorrido de una guía (búsqueda por los últimos números).
  await page.click('nav.tabs button[data-v="vConsultar"]');
  const filas = await page.locator("#conResumen tbody tr").allTextContents();
  expect(filas).toEqual(["Jairo31100", "Pedro20011"]);
  await page.fill("#conGuia", "0002"); await page.click("#conForm button[type=submit]");
  await expect(page.locator("#conRes .linea li")).toHaveCount(3);
  await expect(page.locator("#conRes")).toContainText("Dirección errada");
  await expect(page.locator("#conRes")).toContainText("En bodega");
  await expect(page.locator("#stEntHoy")).toHaveText("1");

  // Excel del día.
  const [dl2] = await Promise.all([page.waitForEvent("download"), A.menu(page, "btnExcel")]);
  const x2 = A.leerXlsx(await dl2.path());
  const nombres = Object.keys(x2);
  expect(nombres[0]).toMatch(/^Resumen /);
  expect(x2[nombres[0]][1]).toEqual(["Jairo", 3, 1, 1, 0, 0]);
  expect(x2["Paquetes del día"].length).toBe(5);
  expect(errs).toEqual([]);
});

test("los datos quedan guardados al recargar y la app abre sin internet", async ({ page, context }) => {
  const errs = A.vigilarErrores(page);
  await A.entrar(page);
  await A.nuevoLote(page);
  await page.click("#recEscribir");
  await A.responder(page, { g: "SINRED12345" });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(async () => (await caches.keys()).some(k => k.startsWith("bodega-v")));
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.BODEGA_DATOS === true);
  await expect(page.locator("#net")).toBeVisible();
  await expect(page.locator("#stBodega")).toHaveText("1");
  await expect(page.locator("#recLista")).toContainText("SINRED12345");
  await context.setOffline(false);
  expect(errs).toEqual([]);
});
