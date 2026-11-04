// Equipo en la nube (con Supabase simulado): conectar, sincronizar, ver avance, reasignar, varios celulares y sin señal.
const { test, expect } = require("@playwright/test");
const { entrar, vigilarErrores } = require("./ayuda");
const { crearSupabase } = require("./supabase-falso");

async function celular(browser, sb, nombre){
  const ctx = await browser.newContext({ ...require("@playwright/test").devices["Pixel 7"] });
  await sb.instalar(ctx);
  const page = await ctx.newPage(); const errs = vigilarErrores(page);
  await entrar(page, nombre);
  await page.evaluate(() => { state.stops = []; state.seeded = true; save(); render(); });
  return { ctx, page, errs };
}
async function conectar(page, email, pass){
  await page.click("text=Más opciones"); await page.click("#btnTeamCfg");
  await page.fill("#tmEmail", email); await page.fill("#tmPass", pass); await page.click("#tmGo");
}
const agregar = (page, lista) => page.evaluate(l => { for (const d of l) state.stops.push(mkStop(d)); save(); render(); }, lista);
const sincronizar = page => page.evaluate(() => syncNow(true));
const direcciones = page => page.evaluate(() => state.stops.map(s => s.label || s.addr).sort());

test("equipo: conectar, sincronizar, avance y reasignar entre dos personas", async ({ browser }) => {
  test.setTimeout(120000);
  const sb = crearSupabase();
  const cam = await celular(browser, sb, "Camilo"), and = await celular(browser, sb, "Andrea");

  // Contraseña errada y cuenta que no es del equipo
  await conectar(cam.page, "camilo@equipo.co", "mala");
  await expect(cam.page.locator("#tmErr")).toHaveText("Correo o contraseña incorrectos.");
  await cam.page.fill("#tmEmail", "extrano@otro.co"); await cam.page.fill("#tmPass", "Clave-Extrano-1"); await cam.page.click("#tmGo");
  await expect(cam.page.locator("#tmErr")).toContainText("no está en el equipo");
  // Conectar bien
  await cam.page.fill("#tmEmail", "camilo@equipo.co"); await cam.page.fill("#tmPass", "Clave-Camilo-1"); await cam.page.click("#tmGo");
  await expect(cam.page.locator("#tmState")).toContainText("Conectado como Camilo");
  await expect(cam.page.locator("#btnTeam")).toBeVisible();
  await conectar(and.page, "andrea@equipo.co", "Clave-Andrea-1");
  await expect(and.page.locator("#tmState")).toContainText("Conectado como Andrea");
  await expect(and.page.locator("#tmAdminBtn")).toBeHidden();
  await cam.page.keyboard.press("Escape"); await and.page.keyboard.press("Escape");

  // Cada uno carga lo suyo y sincroniza
  await agregar(cam.page, [{ addr: "Calle 145 # 103B-90", guia: "1001", name: "Laura", phone: "3112223344", raw: "TEXTO COMPLETO DE LA ETIQUETA" }, { addr: "Carrera 110 # 152-30", guia: "1002" }]);
  await agregar(and.page, [{ addr: "Calle 139 # 112-15", guia: "2001" }, { addr: "Calle 150 # 104-20", guia: "2002" }]);
  await sincronizar(cam.page); await sincronizar(and.page);
  const filas = [...sb.db.paradas.values()];
  expect(filas.length).toBe(4);
  expect(filas.filter(f => f.owner === "u-camilo").length).toBe(2);
  expect(JSON.stringify(filas)).not.toContain("TEXTO COMPLETO");          // el texto leído no sube
  expect(filas.find(f => f.data.guia === "1001").data.phone).toBe("3112223344");

  // Andrea no ve las de Camilo
  expect(await direcciones(and.page)).toEqual(["Calle 139 # 112-15", "Calle 150 # 104-20"]);

  // Andrea entrega una; Camilo ve su avance
  await and.page.click('#list li.stop:has-text("Calle 139") button[data-act=done]');
  await sincronizar(and.page);
  await cam.page.click("#btnTeam");
  await expect(cam.page.locator("#tmList")).toContainText("1 de 2 paradas entregadas");
  await expect(cam.page.locator("#tmList")).toContainText("sigue: Calle 150 # 104-20");

  // Camilo se pasa la pendiente de Andrea
  await cam.page.click('#tmList .lrow:has-text("Calle 150") button:has-text("Pasármela")');
  await expect(cam.page.locator("#tmList")).toContainText("1 de 1 paradas entregadas");
  expect(await direcciones(cam.page)).toContain("Calle 150 # 104-20");
  await sincronizar(and.page);
  expect(await direcciones(and.page)).toEqual(["Calle 139 # 112-15"]);

  // Camilo le pasa una suya a Andrea
  await cam.page.click('#tmList .lrow:has-text("Carrera 110") button:has-text("A Andrea")'); await cam.page.click("#cfYes");
  await expect.poll(() => direcciones(cam.page)).not.toContain("Carrera 110 # 152-30");
  await sincronizar(and.page);
  expect(await direcciones(and.page)).toContain("Carrera 110 # 152-30");
  expect(cam.errs).toEqual([]); expect(and.errs).toEqual([]);
});

test("equipo: el mismo usuario en dos celulares, borrar y trabajar sin señal", async ({ browser }) => {
  test.setTimeout(120000);
  const sb = crearSupabase();
  const a = await celular(browser, sb, "Camilo"), b = await celular(browser, sb, "Camilo");
  await conectar(a.page, "camilo@equipo.co", "Clave-Camilo-1"); await expect(a.page.locator("#tmState")).toContainText("Conectado");
  await conectar(b.page, "camilo@equipo.co", "Clave-Camilo-1"); await expect(b.page.locator("#tmState")).toContainText("Conectado");
  await a.page.keyboard.press("Escape"); await b.page.keyboard.press("Escape");
  await agregar(a.page, [{ addr: "Calle 145 # 103B-90", guia: "1001" }, { addr: "Carrera 110 # 152-30", guia: "1002" }]);
  await sincronizar(a.page); await sincronizar(b.page);
  expect(await direcciones(b.page)).toEqual(["Calle 145 # 103B-90", "Carrera 110 # 152-30"]);
  // Borrar en A → desaparece en B
  await a.page.evaluate(() => { state.stops = state.stops.filter(s => s.guia !== "1002"); save(); render(); });
  await sincronizar(a.page); await sincronizar(b.page);
  expect(await direcciones(b.page)).toEqual(["Calle 145 # 103B-90"]);
  // Entregar en B → queda entregada en A
  await b.page.click('#list li.stop button[data-act=done]'); await sincronizar(b.page); await sincronizar(a.page);
  expect(await a.page.evaluate(() => state.stops[0].status)).toBe("done");
  // Sin señal: el cambio espera y sube al volver
  await a.ctx.setOffline(true);
  await agregar(a.page, [{ addr: "Calle 139 # 112-15", guia: "1003" }]);
  await sincronizar(a.page);
  expect([...sb.db.paradas.values()].some(f => f.data.guia === "1003")).toBe(false);
  await a.ctx.setOffline(false);
  await a.page.evaluate(() => syncNow(true));
  expect([...sb.db.paradas.values()].some(f => f.data.guia === "1003")).toBe(true);
  expect(a.errs).toEqual([]); expect(b.errs).toEqual([]);
});

test("sin conectar, la app no llama a Supabase", async ({ page }) => {
  const sb = crearSupabase(); await sb.instalar(page.context());
  await entrar(page);
  await page.evaluate(() => { state.stops.push(mkStop({ addr: "Calle 145 # 103B-90" })); save(); });
  await page.waitForTimeout(5000);
  expect(sb.db.llamadas).toBe(0);
  await expect(page.locator("#btnTeam")).toBeHidden();
});
