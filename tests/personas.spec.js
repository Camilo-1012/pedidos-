// Personas (v2.35): un administrador crea a la persona desde la app en un paso; la persona entra en SU celular con
// «Ya tengo usuario del equipo» y queda conectada (Ruta, y Bodega si es despachador). Supabase simulado.
const { test, expect, devices } = require("@playwright/test");
const A = require("./bodega/ayuda"), R = require("./ayuda");
const { crearSupabase } = require("./supabase-falso");
const { agregarBodega } = require("./bodega/supabase-bodega");

async function contexto(browser, nube){
  const ctx = await browser.newContext({ ...devices["Pixel 7"], baseURL: "http://localhost:8790" });
  await nube.instalar(ctx);
  const page = await ctx.newPage();
  return { ctx, page, errs: A.vigilarErrores(page) };
}
async function bodegaCamilo(browser, nube){
  const bo = await contexto(browser, nube);
  await A.entrar(bo.page, "Camilo", A.PIN, true);
  await A.menu(bo.page, "btnTeam");
  await bo.page.fill("#tmEmail", "camilo@equipo.co"); await bo.page.fill("#tmPass", "Clave-Camilo-1"); await bo.page.click("#tmConnect");
  await expect(bo.page.locator("#tmOn")).toBeVisible();
  await bo.page.locator("#dlgTeam .dlgHead button").click();
  return bo;
}
async function crearPersona(page, { nombre, usuario, rol = "repartidor", admin = false }){
  await page.click("#peAgregar");
  await page.fill("#peNombre", nombre); await page.fill("#peUsuario", usuario);
  await page.check(`input[name="peRol"][value="${rol}"]`);
  if(admin) await page.check("#peAdmin");
  const clave = await page.inputValue("#peClave");
  expect(clave).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{2}$/);
  await page.click("#peGuardar");
  await expect(page.locator("#peListo")).toBeVisible();
  await expect(page.locator("#peDU")).toHaveText(usuario.includes("@") ? usuario : usuario.toLowerCase());
  await expect(page.locator("#peDC")).toHaveText(clave);
  return clave;
}
// Celular nuevo: sin usuarios → «Ya tengo usuario del equipo».
async function entrarConCuenta(page, usuario, clave, pin = "2468"){
  await R.sinInternetExterno(page);
  await page.goto("/");
  await expect(page.locator("#lkSetup")).toBeVisible();
  await page.click("#suCuenta");
  await page.fill("#cuUsuario", usuario); await page.fill("#cuClave", clave); await page.fill("#cuPin", pin); await page.fill("#cuPin2", pin);
  await page.click("#cuGo");
}

test("el administrador crea un repartidor en un paso; el repartidor entra en su celular y le llega lo que le despachan", async ({ browser }) => {
  test.setTimeout(120000);
  const sb = crearSupabase(), nube = agregarBodega(sb);
  const bo = await bodegaCamilo(browser, nube);

  // ☰ → Personas (solo administradores).
  await A.menu(bo.page, "btnPersonas");
  await expect(bo.page.locator("#dlgPersonas")).toBeVisible();
  await expect(bo.page.locator(".peCard")).toHaveCount(2);                       // Camilo y Andrea
  await expect(bo.page.locator(".peCard", { hasText: "Camilo" })).toContainText("(tú)");
  // Validación del servidor (usuario con espacios): se muestra y no crea nada.
  await bo.page.click("#peAgregar");
  await bo.page.fill("#peNombre", "Luis"); await bo.page.fill("#peUsuario", "lu is");
  await bo.page.click("#peGuardar");
  await expect(bo.page.locator("#peErr")).toContainText("de 3 a 30");
  await bo.page.click("#peCancelar");
  const clave = await crearPersona(bo.page, { nombre: "Luis Pérez", usuario: "Luis" });
  await expect(bo.page.locator("#peListo")).toContainText("Ya quedó como repartidor de la bodega");
  await expect(bo.page.locator(".peCard", { hasText: "Luis Pérez" })).toContainText("luis · Repartidor · 📦 en la bodega");
  expect(sb.db.users.find(u => u.email === "luis@ruta.local").pass).toBe(clave);
  // Ya aparece como repartidor de la bodega, vinculado (📱), sin pasos aparte.
  await bo.page.locator("#peCerrar").click();
  await bo.page.click('nav.tabs button[data-v="vDespachar"]');
  await expect(bo.page.locator("#desReps button", { hasText: "Luis Pérez" })).toContainText("📱");

  // ---- Celular de Luis: entra con usuario y contraseña, elige su PIN ----
  const lu = await contexto(browser, nube);
  await entrarConCuenta(lu.page, "luis", "clave-equivocada");
  await expect(lu.page.locator("#cuMsg")).toHaveText("Usuario o contraseña incorrectos.");
  await lu.page.fill("#cuClave", clave); await lu.page.fill("#cuPin", "2468"); await lu.page.fill("#cuPin2", "2468");
  await lu.page.click("#cuGo");
  await expect(lu.page.locator("#lock")).toBeHidden({ timeout: 15000 });
  await lu.page.waitForFunction(() => window.RUTA_LISTA === true);
  expect(await lu.page.evaluate(() => [RUTA_USER.name, RUTA_USER.rol, RUTA_USER.admin, syncOn(), sync.nombre])).toEqual(["Luis Pérez", "repartidor", false, true, "Luis Pérez"]);
  expect(await lu.page.evaluate(() => JSON.stringify(localStorage))).not.toContain(clave);   // la contraseña no se guarda
  await expect(lu.page.locator("#btnPersonas")).toBeHidden();
  await expect(lu.page.locator("#mnApp")).toBeHidden();                           // repartidor: solo Ruta

  // Camilo le despacha un paquete → le aparece a Luis.
  await A.nuevoLote(bo.page, "Xcargo", "L1");
  await bo.page.click("#recScan"); await A.leer(bo.page, "PER0000001"); await bo.page.click("#scClose");
  await bo.page.click('nav.tabs button[data-v="vDespachar"]');
  await bo.page.locator("#desReps button", { hasText: "Luis Pérez" }).click();
  await bo.page.click("#desScan");
  expect((await A.leer(bo.page, "PER0000001")).txt).toBe("Para Luis Pérez · ya le sale en su app");
  await bo.page.click("#scClose");
  await bo.page.evaluate(() => syncNow(false));
  await lu.page.evaluate(async () => { state.stops = state.stops.filter(s => !s.example); await syncNow(true); });
  await expect.poll(() => lu.page.evaluate(() => state.stops.filter(s => !s.example).map(s => s.guia))).toEqual(["PER0000001"]);

  // Olvidó el PIN: lo cambia con su contraseña del equipo, sin borrar nada.
  await lu.page.evaluate(() => { document.getElementById("btnLock").click(); });
  await lu.page.click("#lkForgot");
  await lu.page.fill("#ak_c", clave); await lu.page.fill("#ak_p", "1357"); await lu.page.fill("#ak_p2", "1357");
  await lu.page.click("#akYes");
  await expect(lu.page.locator("#dlgAsk")).toBeHidden();
  for(const k of "1357") await lu.page.click(`#lkPad button[aria-label="${k}"]`);
  await expect(lu.page.locator("#lock")).toBeHidden();
  expect(await lu.page.evaluate(() => state.stops.filter(s => !s.example).length)).toBe(1);

  // Desactivar: ya no puede volver a entrar en otro celular; reactivar lo deja otra vez.
  await A.menu(bo.page, "btnPersonas");
  bo.page.once("dialog", d => d.accept());
  await bo.page.locator(".peCard", { hasText: "Luis Pérez" }).locator("button", { hasText: "Desactivar" }).click();
  await expect(bo.page.locator(".peCard", { hasText: "Luis Pérez" })).toContainText("DESACTIVADO");
  const otro = await contexto(browser, nube);
  await entrarConCuenta(otro.page, "luis", clave);
  await expect(otro.page.locator("#cuMsg")).toContainText("desactivada");
  await bo.page.locator(".peCard", { hasText: "Luis Pérez" }).locator("button", { hasText: "Activar" }).click();
  await expect(bo.page.locator(".peCard", { hasText: "Luis Pérez" })).not.toContainText("DESACTIVADO");
  // Contraseña nueva: se muestra una vez.
  bo.page.once("dialog", d => d.accept());
  await bo.page.locator(".peCard", { hasText: "Luis Pérez" }).locator("button", { hasText: "Contraseña" }).click();
  await expect(bo.page.locator("#peListo")).toContainText("Contraseña nueva para Luis Pérez");
  const nueva = await bo.page.locator("#peDC").textContent();
  expect(sb.db.users.find(u => u.email === "luis@ruta.local").pass).toBe(nueva);
  expect([...bo.errs, ...lu.errs, ...otro.errs]).toEqual([]);
});

test("un despachador administrador creado desde Ruta entra en su celular a la Bodega, conectado, y también puede crear personas", async ({ browser }) => {
  test.setTimeout(120000);
  const sb = crearSupabase(), nube = agregarBodega(sb);
  // Camilo crea desde la pantalla de Ruta.
  const ru = await contexto(browser, nube);
  await R.entrar(ru.page, "Camilo");
  await ru.page.click("text=Más opciones"); await ru.page.click("#btnTeamCfg");
  await ru.page.fill("#tmEmail", "camilo@equipo.co"); await ru.page.fill("#tmPass", "Clave-Camilo-1"); await ru.page.click("#tmGo");
  await expect(ru.page.locator("#tmState")).toContainText("Conectado como Camilo");
  await ru.page.keyboard.press("Escape");
  await R.menu(ru.page); await ru.page.click("#btnPersonas");
  const clave = await crearPersona(ru.page, { nombre: "Marta", usuario: "marta@gmail.com", rol: "despachador", admin: true });
  await expect(ru.page.locator(".peCard", { hasText: "Marta" })).toContainText("marta@gmail.com · Despachador · Administrador");
  expect(sb.db.bod.miembros.find(m => m.nombre === "Marta").rol).toBe("admin");

  const ma = await contexto(browser, nube);
  await entrarConCuenta(ma.page, "marta@gmail.com", clave);
  await expect(ma.page).toHaveURL(/bodega\.html/, { timeout: 15000 });
  await ma.page.waitForFunction(() => window.BODEGA_DATOS === true);
  expect(await ma.page.evaluate(() => [BODEGA_USER.name, BODEGA_USER.rol, BODEGA_USER.admin, syncOn(), sync.rol])).toEqual(["Marta", "despachador", true, true, "admin"]);
  // Marta (administradora) también crea personas.
  await A.menu(ma.page, "btnPersonas");
  await crearPersona(ma.page, { nombre: "Pedro", usuario: "pedro" });
  expect(sb.db.miembros.find(m => m.nombre === "Pedro").rol).toBe("repartidor");
  // Ya existe ese usuario: no se crea dos veces.
  await ma.page.click("#peOk");
  await ma.page.click("#peAgregar");
  await ma.page.fill("#peNombre", "Pedro 2"); await ma.page.fill("#peUsuario", "pedro");
  await ma.page.click("#peGuardar");
  await expect(ma.page.locator("#peErr")).toContainText("Ya existe una cuenta con pedro");
  expect([...ru.errs, ...ma.errs]).toEqual([]);
});

test("Personas: un no administrador no lo ve; sin conectar la nube explica qué falta", async ({ page }) => {
  // Usuario no administrador de este celular: no ve «Personas».
  await R.entrar(page, "Camilo");
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem("rutaEntregas.users.v1")); d.users[0].admin = false; d.users[0].rol = "repartidor"; localStorage.setItem("rutaEntregas.users.v1", JSON.stringify(d)); });
  await page.reload(); await page.waitForFunction(() => window.RUTA_LISTA === true);
  await expect(page.locator("#btnPersonas")).toBeHidden();
  // Administrador sin la nube conectada: abre y dice qué hacer (sin llamar a Supabase).
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem("rutaEntregas.users.v1")); d.users[0].admin = true; localStorage.setItem("rutaEntregas.users.v1", JSON.stringify(d)); });
  await page.reload(); await page.waitForFunction(() => window.RUTA_LISTA === true);
  await R.menu(page); await page.click("#btnPersonas");
  await expect(page.locator("#peEstado")).toContainText("Primero conecta este celular al equipo");
  await expect(page.locator("#peAgregar")).toBeHidden();
});
