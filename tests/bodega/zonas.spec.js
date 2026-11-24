// Zonificación (v1.1): zonas por rangos de calles y carreras, ubicación al recibir, aviso en el despacho y reportes.
const { test, expect } = require("@playwright/test");
const A = require("./ayuda");

async function crearZona(page, v){
  await A.menu(page, "btnZonas");
  await page.click("#znAdd");
  const d = page.locator("#dlgPedir");
  await expect(d.locator("#pd_n")).toBeFocused();            // el diálogo terminó de abrir (en GitHub, más lento)
  // Se llena y se verifica cada campo (en GitHub falló una vez quedando «Z2 Lisboa160»: lo escrito cayó en otro campo).
  const llenar = async (k, val) => { const el = d.locator("#pd_" + k); await expect(async () => { await el.fill(val); await expect(el).toHaveValue(val, { timeout: 300 }); }).toPass({ timeout: 5000 }); };
  await llenar("n", v.n);
  for(const k of ["cd", "ch", "kd", "kh"]) await llenar(k, v[k] || "");
  for(const k of ["n", "cd", "ch", "kd", "kh"]) await expect(d.locator("#pd_" + k)).toHaveValue(k === "n" ? v.n : v[k] || "");
  if(v.r) await d.locator("#pd_r").selectOption({ label: v.r });
  await d.locator("#pdYes").click();
  if(v.cruce){ await expect(d.locator("#pdMsg")).toContainText(v.cruce); await d.locator("#pdYes").click(); }
  await expect(page.locator("#znList")).toContainText(v.n);
  await page.locator("#dlgZonas .dlgHead button").click();
}
// Contesta el panel de ubicación dentro del escáner.
async function leerConUbic(page, g, cl, kr, zona){
  const p = A.leer(page, g);
  await expect(page.locator("#scUbic")).toBeVisible();
  if(zona) await page.locator("#ubZonas button", { hasText: zona }).click();
  else if(cl === null) await page.click("#ubSaltar");
  else { await page.fill("#ubCl", cl); await page.fill("#ubKr", kr); await page.press("#ubKr", "Enter"); }
  await expect(page.locator("#scUbic")).toBeHidden();
  return p;
}

test("números de vía y pertenencia a zonas (rangos abiertos, invertidos, sur y cruces)", async ({ page }) => {
  await A.entrar(page);
  const r = await page.evaluate(() => {
    registrar("ZONA", null, {zid:"z1", nombre:"Z1 Tibabuyes", color:"#2f6fdf", cl:[132, 145], kr:[104, 130], activa:true});
    registrar("ZONA", null, {zid:"z2", nombre:"Z2 Lisboa", color:"#d0421b", cl:[160, 140], kr:[null, null], activa:true});   // invertido y sin carreras
    registrar("ZONA", null, {zid:"z3", nombre:"Z3 Sur", color:"#1f8a4c", cl:[-30, -1], kr:[null, null], activa:true});
    const z = (cl, kr) => (zonaPorUbic(cl, kr) || {nombre:"—"}).nombre;
    return {
      nums: ["145", "145B", "10 Sur", "10S", "5 Este", "5E", "", "abc"].map(n => String(numVia(n))),
      a: z(140, 110), b: z(145, 130), c: z(150, 110), d: z(150, 200), e: z(120, 110), f: z(-12, 50), g: z(140, null),
      cruce: cruce({cl:[132, 145], kr:[104, 130]}, {cl:[140, 160], kr:[null, null]}),
      rango: rangoTxt({cl:[132, 145], kr:[null, 130]})
    };
  });
  expect(r.nums).toEqual(["145", "145", "-10", "-10", "-5", "5", "null", "NaN"]);   // «5E» es la letra E
  expect([r.a, r.b, r.c, r.d, r.e, r.f]).toEqual(["Z1 Tibabuyes", "Z1 Tibabuyes", "Z2 Lisboa", "Z2 Lisboa", "—", "Z3 Sur"]);
  expect(r.g).toBe("Z2 Lisboa");                // sin carrera: solo cae en una zona que no limita carreras
  expect(r.cruce).toBe("Calle 140–145 × Carrera 104–130");
  expect(r.rango).toBe("Calle 132–145 · Carrera …–130");
});

test("zonas: crear con aviso de cruce, ubicar al recibir, despachar con aviso de zona ajena y reportes", async ({ page }) => {
  const errs = A.vigilarErrores(page);
  await A.entrar(page);
  await A.agregarRep(page, "Jairo"); await A.agregarRep(page, "Pedro");
  await crearZona(page, { n: "Z1 Tibabuyes", cd: "132", ch: "145", kd: "104", kh: "130", r: "Jairo" });
  await crearZona(page, { n: "Z2 Lisboa", cd: "140", ch: "160", kd: "131", kh: "150", r: "Pedro" });
  await crearZona(page, { n: "Z3 Rincón", cd: "125", ch: "135", kd: "", kh: "", cruce: "Z1 Tibabuyes: Calle 132–135" });

  await A.nuevoLote(page, "Xcargo", "L1");
  await expect(page.locator("#recUbicLbl")).toBeVisible();
  await page.click("#recScan");
  expect((await leerConUbic(page, "ZON0000001", "140", "110")).txt).toBe("Recibida → Z1 Tibabuyes");
  expect((await leerConUbic(page, "ZON0000002", "150", "140")).txt).toBe("Recibida → Z2 Lisboa");
  expect((await leerConUbic(page, "ZON0000003", "", "", "Z2 Lisboa")).txt).toBe("Recibida → Z2 Lisboa");
  expect((await leerConUbic(page, "ZON0000004", null)).txt).toBe("Recibida → sin zona");
  await expect(page.locator("#ubPrev")).toBeEmpty();
  // Deshacer quita la recepción y la ubicación juntas.
  await page.click("#scUndo");
  expect((await leerConUbic(page, "ZON0000004", "300", "300")).txt).toBe("Recibida → sin zona");
  await page.click("#scClose");
  const celdas = await page.locator("#recZonas .zcell").allTextContents();
  expect(celdas).toEqual(["1Z1 TibabuyesXC 1", "2Z2 LisboaXC 2", "0Z3 Rincón", "1Sin zonaXC 1"]);   // v2.45: con el desglose por empresa

  // Sin «pedir ubicación», recibe sin preguntar.
  await page.uncheck("#recUbic");
  await page.click("#recScan");
  expect((await A.leer(page, "ZON0000005")).txt).toBe("Recibida → sin zona");
  await page.click("#scClose");

  // Despacho: las zonas de Jairo primero; un paquete de la zona de Pedro se entrega con aviso, sin bloquear.
  await page.click('nav.tabs button[data-v="vDespachar"]');
  await page.locator("#desReps button", { hasText: "Jairo" }).click();
  await expect(page.locator("#desZonas .zcell").first()).toHaveText("1Z1 TibabuyesXC 1");
  await expect(page.locator("#desZonas .zcell.suya")).toHaveCount(1);
  await page.click("#desScan");
  expect((await A.leer(page, "ZON0000001")).txt).toBe("Para Jairo · Z1 Tibabuyes");
  const r2 = await A.leer(page, "ZON0000002");
  expect(r2.txt).toBe("Para Jairo · Z2 Lisboa · ⚠ no es de sus zonas (es de Pedro)"); expect(r2.cls).toBe("aviso");
  expect((await A.leer(page, "ZON0000004")).txt).toBe("Para Jairo");
  await page.click("#scClose");
  await page.click("#desPlanilla");
  const zonasPlanilla = await page.locator("#planilla tbody tr:not(.plZona) td:nth-child(5)").allTextContents();
  expect(zonasPlanilla).toEqual(["Sin zona", "Z1 Tibabuyes", "Z2 Lisboa"]);
  await expect(page.locator("#planilla .plZona")).toHaveText(["Sin zona · 1 paquete(s)", "Z1 Tibabuyes · 1 paquete(s)", "Z2 Lisboa · 1 paquete(s)"]);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("#ltActs button", { hasText: "Excel" }).click()]);
  const pl = Object.values(A.leerXlsx(await dl.path()))[0];
  expect(pl[0].slice(0, 5)).toEqual(["#", "Guía", "Zona", "Calle", "Carrera"]);
  expect(pl[2].slice(1, 5)).toEqual(["ZON0000001", "Z1 Tibabuyes", "140", "110"]);
  await page.locator("#dlgLista .dlgHead button").click();

  // Consulta: ubicar a mano un paquete sin zona y ver el resumen por zona.
  await page.click('nav.tabs button[data-v="vConsultar"]');
  await page.fill("#conGuia", "ZON0000005"); await page.click("#conForm button[type=submit]");
  await expect(page.locator("#conRes .chip.zsin")).toBeVisible();
  await page.click("#conUbic");
  await A.responder(page, { cl: "130", kr: "" });
  await expect(page.locator("#conRes")).toContainText("Z3 Rincón");
  await expect(page.locator("#conRes .linea")).toContainText("Ubicación Calle 130 · Carrera ?");
  await page.click("#conZonas");
  const filas = await page.locator("#conListaBox tbody tr").evaluateAll(trs => trs.map(t => [...t.children].slice(1).map(c => c.textContent).join("/")));
  expect(filas).toEqual(["0/1", "1/1", "1/0", "0/1"]);   // Z1, Z2, Z3, Sin zona (bodega/ruta)

  // Cambiar el rango rezonifica sin tocar los paquetes: Z1 ampliada hasta la Calle 160 y la Carrera 150 absorbe ZON0000002 (gana por nombre).
  await page.evaluate(() => { const z = [...ZONAS.values()].find(x => x.nombre.startsWith("Z1")); registrar("ZONA", null, {...datosZona(z), cl:[132, 160], kr:[104, 150]}); });
  expect(await page.evaluate(() => zonaDe(paq("ZON0000002")).nombre)).toBe("Z1 Tibabuyes");

  const [dl2] = await Promise.all([page.waitForEvent("download"), A.menu(page, "btnExcel")]);
  const x2 = A.leerXlsx(await dl2.path());
  expect(x2["Por zona"].map(f => f[0])).toEqual(["Zona", "Z1 Tibabuyes", "Z2 Lisboa", "Z3 Rincón", "Sin zona"]);
  expect(x2["Paquetes del día"][0].slice(4, 7)).toEqual(["Zona", "Calle", "Carrera"]);
  expect(errs).toEqual([]);
});

test("solo un administrador maneja zonas (en el celular y en la nube)", async ({ page }) => {
  await A.entrar(page);
  await page.evaluate(() => { USER.admin = false; });
  await A.menu(page, "btnZonas");
  await expect(page.locator("#znAdd")).toBeHidden();
  await expect(page.locator("#znNota")).toContainText("Solo un administrador");
});

test("Despachar: marcar las zonas de cada repartidor (una zona puede tener varios) y aviso al escanear de otra zona", async ({ page }) => {
  const errs = A.vigilarErrores(page);
  await A.entrar(page);
  await A.agregarRep(page, "Jairo"); await A.agregarRep(page, "John");
  await page.evaluate(() => {
    registrar("ZONA", null, {zid: "za", nombre: "Alcaparros", color: "#1f8a4c", cl: [130, 139], kr: [null, null], activa: true});
    registrar("ZONA", null, {zid: "zb", nombre: "Bilbao", color: "#d0421b", cl: [140, 149], kr: [null, null], activa: true});
    registrar("ZONA", null, {zid: "zc", nombre: "Lombardia", color: "#2f6fdf", cl: [150, 160], kr: [null, null], activa: true});
  });
  await A.nuevoLote(page, "Xcargo", "L1");
  await page.click("#recScan");
  for(const [g, cl] of [["ZR00000001", "135"], ["ZR00000002", "145"], ["ZR00000003", "155"]]){
    const p = A.leer(page, g); await expect(page.locator("#scUbic")).toBeVisible(); await page.fill("#ubCl", cl); await page.fill("#ubKr", "100"); await page.click("#ubOk"); await p;
  }
  await page.click("#scClose");
  await page.click('nav.tabs button[data-v="vDespachar"]');
  await page.locator("#desReps button", { hasText: "Jairo" }).click();
  await expect(page.locator("#desZonasRep h3")).toHaveText("Zonas de Jairo");
  await page.locator('#desZonasRep button[data-zid="za"]').click();
  await page.locator('#desZonasRep button[data-zid="zb"]').click();
  await expect(page.locator('#desZonasRep button[aria-pressed="true"]')).toHaveCount(2);
  await expect(page.locator("#desReps button", { hasText: "Jairo" })).toContainText("Alcaparros, Bilbao");
  // John también lleva Bilbao (una zona, dos repartidores).
  await page.locator("#desReps button", { hasText: "John" }).click();
  await page.locator('#desZonasRep button[data-zid="zb"]').click();
  await page.locator('#desZonasRep button[data-zid="zc"]').click();
  await expect(page.locator('#desZonasRep button[data-zid="zb"]')).toContainText("Jairo");      // muestra quién más la lleva
  await page.locator("#desReps button", { hasText: "Jairo" }).click();
  await page.click("#desScan");
  await expect(page.locator("#scTarget")).toContainText("Para: Jairo · Alcaparros, Bilbao");
  expect((await A.leer(page, "ZR00000001")).txt).toBe("Para Jairo · Alcaparros");
  const r = await A.leer(page, "ZR00000003");
  expect(r.txt).toBe("Para Jairo · Lombardia · ⚠ no es de sus zonas (es de John)"); expect(r.cls).toBe("aviso");
  await page.click("#scClose");
  await page.click("#desPlanilla");
  await expect(page.locator("#planilla .plInfo")).toContainText("Zonas asignadasAlcaparros, Bilbao");
  await page.locator("#dlgLista .dlgHead button").click();
  // Quitar una zona con otro toque; se guarda como evento (queda en el histórico y se sincroniza).
  await page.locator('#desZonasRep button[data-zid="zb"]').click();
  await expect(page.locator("#desReps button", { hasText: "Jairo" })).toContainText("Alcaparros");
  expect(await page.evaluate(() => zonasDeRep(repsActivos().find(r => r.nombre === "Jairo").rid).map(z => z.nombre))).toEqual(["Alcaparros"]);
  expect(errs).toEqual([]);
});

test("corregir una asignación equivocada: pasar a otro sin escanear, o quitarla (vuelve a bodega o al anterior); queda en el histórico", async ({ page }) => {
  const errs = A.vigilarErrores(page);
  await A.entrar(page);
  await A.agregarRep(page, "Jairo"); await A.agregarRep(page, "John");
  await A.nuevoLote(page, "Xcargo", "L1");
  await page.click("#recScan");
  for(const g of ["CA00000001", "CA00000002"]) await A.leer(page, g);
  await page.click("#scClose");
  await page.click('nav.tabs button[data-v="vDespachar"]');
  await page.locator("#desReps button", { hasText: "Jairo" }).click();
  await page.click("#desScan");
  for(const g of ["CA00000001", "CA00000002"]) await A.leer(page, g);
  await page.click("#scClose");
  // Tocar el paquete en «Lleva» → pasarlo a John (sin escanear).
  await page.locator("#desLista li", { hasText: "CA00000001" }).click();
  await expect(page.locator("#ltTitle")).toHaveText("Corregir CA00000001");
  await page.locator("#ccReps button", { hasText: "John" }).click();
  await expect(page.locator("#dlgLista")).toBeHidden();
  expect(await page.evaluate(() => repNombre(paq("CA00000001").rid))).toBe("John");
  await expect(page.locator("#desLista li", { hasText: "CA00000001" })).toHaveCount(0);
  // Quitar la asignación de la otra: vuelve a bodega.
  await page.locator("#desLista li", { hasText: "CA00000002" }).click();
  await expect(page.locator("#ltBody")).toContainText("vuelve a en bodega");
  await page.locator("#ltActs button", { hasText: "Quitar asignación" }).click();
  expect(await page.evaluate(() => paq("CA00000002").estado)).toBe("BODEGA");
  // En Consultar, la de John: quitarla la devuelve a Jairo (la tenía antes).
  await page.click('nav.tabs button[data-v="vConsultar"]');
  await page.evaluate(() => verPaquete("CA00000001"));
  await page.click("#conCorregir");
  await expect(page.locator("#ltBody")).toContainText("vuelve a Jairo");
  await page.locator("#ltActs button", { hasText: "Quitar asignación" }).click();
  expect(await page.evaluate(() => [paq("CA00000001").estado, repNombre(paq("CA00000001").rid)])).toEqual(["RUTA", "Jairo"]);
  await expect(page.locator("#conRes")).toContainText("corregida: asignación equivocada");
  await expect(page.locator("#conRes")).toContainText("a John (antes la tenía Jairo) · corrección");
  // Un paquete en bodega no se «corrige» (no tiene botón).
  await page.evaluate(() => verPaquete("CA00000002"));
  await expect(page.locator("#conCorregir")).toHaveCount(0);
  expect(errs).toEqual([]);
});

test("con zonas creadas, despachar exige marcarle zona al repartidor (sin zonas creadas no se exige)", async ({ page }) => {
  const errs = A.vigilarErrores(page);
  await A.entrar(page);
  await A.agregarRep(page, "Jairo");
  await A.nuevoLote(page, "Xcargo", "L1");
  await page.click("#recScan"); await A.leer(page, "ZO00000001"); await page.click("#scClose");
  await page.click('nav.tabs button[data-v="vDespachar"]');
  await page.locator("#desReps button", { hasText: "Jairo" }).click();
  await expect(page.locator("#desScan")).not.toHaveClass(/bloq/);        // sin zonas creadas: libre
  await page.evaluate(() => { registrar("ZONA", null, {zid: "za", nombre: "Alcaparros", color: "#1f8a4c", cl: [130, 139], kr: [null, null], activa: true}); pintarTodo(); });
  await expect(page.locator("#desScan")).toHaveClass(/bloq/);
  await expect(page.locator("#desZonasRep .uerr")).toContainText("Obligatorio");
  await page.click("#desScan", { force: true });       // aria-disabled: igual se puede tocar y avisa
  await expect(page.locator("#dlgScan")).toBeHidden();
  await expect(page.locator("#toast")).toContainText("Primero marca la zona de Jairo");
  expect(await page.evaluate(() => asignarGuia("ZO00000001").then(r => r.txt))).toBe("Marca primero la zona de Jairo.");
  await page.locator('#desZonasRep button[data-zid="za"]').click();
  await expect(page.locator("#desScan")).not.toHaveClass(/bloq/);
  await page.click("#desScan");
  expect((await A.leer(page, "ZO00000001")).txt).toBe("Para Jairo");
  await page.click("#scClose");
  expect(errs).toEqual([]);
});

test("v2.45: Recibir separa por zona y por empresa (Xcargo/iMile): desglose en cada zona, filtro y vista «Por zona»", async ({ page }) => {
  const errs = A.vigilarErrores(page);
  await A.entrar(page);
  await page.evaluate(() => {
    registrar("ZONA", null, {zid: "za", nombre: "Alcaparros", color: "#1f8a4c", cl: [130, 139], kr: [null, null], activa: true});
    registrar("ZONA", null, {zid: "zb", nombre: "Bilbao", color: "#d0421b", cl: [140, 149], kr: [null, null], activa: true});
  });
  await A.nuevoLote(page, "Xcargo", "L1");
  await page.click("#recScan");
  for(const [g, cl] of [["2600000000000001", "135"], ["2600000000000002", "145"], ["6100000000003", "145"], ["6100000000004", "146"], ["2600000000000005", null]])
    await leerConUbic(page, g, cl, "100");
  await page.click("#scClose");
  // Cuadro de zonas: debajo del número, cuántos de cada empresa.
  await expect(page.locator('#recZonas .zcell[data-zid="zb"] .zemp')).toHaveText("XC 1iM 2");
  await expect(page.locator('#recZonas .zcell[data-zid=""] .zemp')).toHaveText("XC 1");
  // Filtro por empresa.
  await expect(page.locator("#recEmpF button")).toHaveText(["Todas 5", "Xcargo 3", "iMile 2"]);
  await page.locator("#recEmpF button", { hasText: "iMile" }).click();
  await expect(page.locator("#recLista li")).toHaveCount(2);
  await page.locator("#recEmpF button", { hasText: "Todas" }).click();
  // Vista por zona: un bloque por zona con su desglose; adentro, separado por empresa.
  await page.locator(".recVer button", { hasText: "Por zona" }).click();
  await expect(page.locator("#recLista")).toBeHidden();
  await expect(page.locator("#recGrupos summary")).toHaveText(["Alcaparros1XC 1", "Bilbao3XC 1iM 2", "Sin zona1XC 1"]);
  await page.locator('#recGrupos details[data-zid="zb"] summary').click();
  await expect(page.locator('#recGrupos details[data-zid="zb"] .grpEmp')).toHaveText(["Xcargo · 1", "iMile · 2"]);
  // Se recuerda la vista y lo abierto.
  await page.reload(); await page.waitForFunction(() => window.BODEGA_DATOS === true);
  await expect(page.locator('#recGrupos details[data-zid="zb"]')).toHaveAttribute("open", "");
  expect(errs).toEqual([]);
});

test("v2.46: planilla de salida: presentación de empresa, imprime arriba de la hoja y se comparte como imagen (WhatsApp)", async ({ page }) => {
  const errs = A.vigilarErrores(page);
  await A.entrar(page);
  await A.agregarRep(page, "Jairo Cárdenas");
  await A.nuevoLote(page, "Xcargo", "L1");
  await page.click("#recScan");
  for(const g of ["2600000000000001", "6100000000002"]) await A.leer(page, g);
  await page.click("#scClose");
  await page.click('nav.tabs button[data-v="vDespachar"]');
  await page.locator("#desReps button", { hasText: "Jairo" }).click();
  await page.click("#desScan");
  for(const g of ["2600000000000001", "6100000000002"]) await A.leer(page, g);
  await page.click("#scClose");
  await page.click("#desPlanilla");
  await expect(page.locator("#planilla .plNum b")).toHaveText(/^PS-\d{6}-\d{4}-JC$/);
  await expect(page.locator("#planilla .plRes")).toContainText("2paquetes en total1Xcargo1iMile");
  await expect(page.locator("#planilla .plFirmas")).toContainText("Recibí conforme (repartidor)");
  // Compartir: con «compartir» del celular se manda la imagen PNG.
  await page.evaluate(() => { window.__comp = null; navigator.canShare = () => true; navigator.share = async o => { window.__comp = {n: o.files.length, tipo: o.files[0].type, tam: o.files[0].size, nombre: o.files[0].name, texto: o.text}; }; });
  await page.locator("#ltActs button", { hasText: "Compartir (WhatsApp)" }).click();
  await expect.poll(() => page.evaluate(() => window.__comp && window.__comp.tipo)).toBe("image/png");
  const c = await page.evaluate(() => window.__comp);
  expect(c.tam).toBeGreaterThan(10000);
  expect(c.nombre).toMatch(/^planilla-jairo-cárdenas-PS-.*\.png$/);
  expect(c.texto).toContain("Paquetes: 2 (Xcargo 1, iMile 1)");
  // Impresión: solo la planilla, desde arriba de la hoja.
  await page.emulateMedia({ media: "print" });
  expect(await page.evaluate(() => [getComputedStyle(document.querySelector("#ltActs")).display, Math.round(document.querySelector("#planilla").getBoundingClientRect().top)])).toEqual(["none", expect.any(Number)]);
  expect(await page.evaluate(() => document.querySelector("#planilla").getBoundingClientRect().top)).toBeLessThan(60);
  await page.emulateMedia({ media: "screen" });
  expect(errs).toEqual([]);
});
