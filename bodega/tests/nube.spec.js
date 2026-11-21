// Sincronización entre dos celulares (Supabase simulado): lecturas compartidas, trabajo sin señal, conflictos y permisos.
const { test, expect, devices } = require("@playwright/test");
const A = require("./ayuda"), N = require("./nube");

async function celular(browser, nube, usuario){
  const context = await browser.newContext({ ...devices["Pixel 7"], baseURL: "http://localhost:8791" });
  await N.conectarNube(context, nube);
  const page = await context.newPage();
  const errs = A.vigilarErrores(page);
  await A.entrar(page, usuario, A.PIN, true);
  return { context, page, errs };
}
async function conectar(page, email, pass){
  await A.menu(page, "btnTeam");
  await page.fill("#tmEmail", email); await page.fill("#tmPass", pass); await page.click("#tmConnect");
  await expect(page.locator("#tmOn")).toBeVisible();
  await page.locator("#dlgTeam .dlgHead button").click();
}
const sincronizar = page => page.evaluate(() => syncNow(false));

test("dos celulares: lo que lee uno lo ve el otro, y un conflicto sin señal se detecta y se resuelve", async ({ browser }) => {
  const nube = N.crearNube();
  const a = await celular(browser, nube, "Camilo"), b = await celular(browser, nube, "Ana");
  await conectar(a.page, "admin@b.co", "clave1");
  await A.agregarRep(a.page, "Jairo"); await A.agregarRep(a.page, "Pedro");
  await A.nuevoLote(a.page, "Xcargo", "Lote 1");
  await a.page.click("#recScan");
  for(const g of ["NUBE000001", "NUBE000002"]) expect((await A.leer(a.page, g)).tipo).toBe("ok");
  await a.page.click("#scClose");
  await sincronizar(a.page);
  expect(nube.eventos.length).toBe(5);   // 2 repartidores + lote + 2 recibidos

  // El celular B se conecta y baja todo.
  await conectar(b.page, "despacho@b.co", "clave2");
  await expect(b.page.locator("#stBodega")).toHaveText("2");
  await b.page.click('nav.tabs button[data-v="vDespachar"]');
  await expect(b.page.locator("#desReps button")).toHaveCount(2);

  // Sin señal en los dos: A le da NUBE000002 a Jairo y B se la da a Pedro.
  nube.caida = true;
  await a.page.click('nav.tabs button[data-v="vDespachar"]');
  await a.page.locator("#desReps button", { hasText: "Jairo" }).click();
  await a.page.click("#desScan"); expect((await A.leer(a.page, "NUBE000002")).txt).toBe("Para Jairo"); await a.page.click("#scClose");
  await b.page.locator("#desReps button", { hasText: "Pedro" }).click();
  await b.page.click("#desScan"); expect((await A.leer(b.page, "NUBE000002")).txt).toBe("Para Pedro"); await b.page.click("#scClose");
  await sincronizar(a.page);
  await expect(a.page.locator("#syncChip")).toContainText("1 sin subir");
  nube.caida = false;
  await sincronizar(a.page); await sincronizar(b.page); await sincronizar(a.page);
  for(const c of [a, b]){
    await c.page.click('nav.tabs button[data-v="vConsultar"]');
    await expect(c.page.locator("#conNConf")).toHaveText("1");
  }
  // Se resuelve en A: la tiene Pedro. B se entera al sincronizar.
  await a.page.click("#conConflictos");
  await a.page.locator("#conLista li[data-guia]").first().click();
  await a.page.locator("#conResolver button", { hasText: "Pedro" }).click();
  await expect(a.page.locator("#conNConf")).toBeHidden();
  await sincronizar(a.page); await sincronizar(b.page);
  await expect(b.page.locator("#conNConf")).toBeHidden();
  const p = await b.page.evaluate(() => ({ e: paq("NUBE000002").estado, r: repNombre(paq("NUBE000002").rid) }));
  expect(p).toEqual({ e: "RUTA", r: "Pedro" });
  expect(a.errs).toEqual([]); expect(b.errs).toEqual([]);
  await a.context.close(); await b.context.close();
});

test("una cuenta sin rol de administrador no puede crear repartidores ni zonas en la nube (el resto sí sube)", async ({ browser }) => {
  const nube = N.crearNube();
  const b = await celular(browser, nube, "Ana");
  await conectar(b.page, "despacho@b.co", "clave2");
  await A.agregarRep(b.page, "Intruso");
  await A.nuevoLote(b.page);
  await b.page.click("#recEscribir"); await A.responder(b.page, { g: "PERM000001" });
  await b.page.evaluate(() => registrar("ZONA", null, {zid: "zx", nombre: "Zx", color: "", cl: [1, 2], kr: [null, null], activa: true}));
  await sincronizar(b.page);
  expect(nube.eventos.map(e => e.tipo).sort()).toEqual(["LOTE", "RECIBIDO"]);
  await expect(b.page.locator("#syncChip")).toContainText("Nube: revisar");
  await expect(b.page.locator("#syncChip")).not.toContainText("sin subir");   // el rechazado no se reintenta sin fin
  expect(b.errs).toEqual([]);
  await b.context.close();
});

test("contraseña incorrecta o cuenta no autorizada: no queda conectada", async ({ browser }) => {
  const nube = N.crearNube();
  nube.cuentas["otro@b.co"] = { uid: "u-otro", pass: "x", nombre: "", rol: "" };
  const b = await celular(browser, nube, "Ana");
  await A.menu(b.page, "btnTeam");
  await b.page.fill("#tmEmail", "despacho@b.co"); await b.page.fill("#tmPass", "mala"); await b.page.click("#tmConnect");
  await expect(b.page.locator("#tmErr")).toHaveText("Correo o contraseña incorrectos.");
  await b.page.route(/bodega_miembros/, r => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await b.page.fill("#tmPass", "clave2"); await b.page.click("#tmConnect");
  await expect(b.page.locator("#tmErr")).toContainText("no está autorizada");
  await expect(b.page.locator("#tmOff")).toBeVisible();
  expect(b.errs).toEqual([]);
  await b.context.close();
});

test("histórico: una guía de hace 3 meses (que ya no está en el celular) se consulta y sale en el Excel por fechas", async ({ browser }) => {
  const nube = N.crearNube();
  const viejo = new Date(new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10) + "T13:00:00Z"), iso = m => new Date(viejo.getTime() + m * 60000).toISOString();
  const ev = (tipo, guia, d, m, por) => nube.eventos.push({ id: "00000000-0000-4000-8000-" + String(nube.seq + 1).padStart(12, "0"), at: iso(m), tipo, guia, d, por, dev: "dVIEJO", seq: ++nube.seq, user_id: "u-desp", srv_at: iso(m + 1) });
  ev("REP", null, { rid: "rj", nombre: "Jairo", activo: true }, 0, "Camilo");
  ev("LOTE", null, { lid: "l1", nombre: "Camión agosto", emp: "iMile" }, 1, "Ana");
  ev("RECIBIDO", "HIST000001", { lid: "l1", emp: "iMile" }, 2, "Ana");
  ev("ASIGNADO", "HIST000001", { rid: "rj" }, 30, "Luis");
  ev("ENTREGADO", "HIST000001", { rid: "rj" }, 300, "Ana");
  const b = await celular(browser, nube, "Ana");
  await conectar(b.page, "despacho@b.co", "clave2");
  expect(await b.page.evaluate(() => paq("HIST000001"))).toBeNull();          // el celular nuevo solo baja 30 días
  await b.page.click('nav.tabs button[data-v="vConsultar"]');
  await b.page.click("#hisGuia"); await A.responder(b.page, { g: "0001" });
  const linea = b.page.locator("#ltBody .linea li");
  await expect(linea).toHaveCount(3);
  await expect(linea.nth(0)).toContainText("Recibida en bodega Camión agosto · Ana · celular dVIEJO");
  await expect(linea.nth(1)).toContainText("Despachada a Jairo · Luis");
  await b.page.locator("#dlgLista .dlgHead button").click();
  const dia = viejo.toISOString().slice(0, 10);
  await b.page.click("#hisExcel");
  const [dl] = await Promise.all([b.page.waitForEvent("download"), A.responder(b.page, { de: dia, a: dia })]);
  const x = A.leerXlsx(await dl.path());
  expect(x["Movimientos"].slice(1).map(f => [f[1], f[2], f[4], f[5]])).toEqual([
    ["HIST000001", "Recibida en bodega", "", "Ana"], ["HIST000001", "Despachada", "Jairo", "Luis"], ["HIST000001", "Entregada (liquidación)", "Jairo", "Ana"]]);
  expect(x["Resumen por día"][2]).toEqual([dia, "Jairo", "", 1, "", 1]);
  expect(x["Recepción por lote"][1].slice(0, 2)).toEqual(["Camión agosto", "iMile"]);
  expect(b.errs).toEqual([]);
  await b.context.close();
});
