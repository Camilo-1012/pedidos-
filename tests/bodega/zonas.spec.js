// Zonificación (v1.1): zonas por rangos de calles y carreras, ubicación al recibir, aviso en el despacho y reportes.
const { test, expect } = require("@playwright/test");
const A = require("./ayuda");

async function crearZona(page, v){
  await A.menu(page, "btnZonas");
  await page.click("#znAdd");
  const d = page.locator("#dlgPedir");
  await d.locator("#pd_n").fill(v.n);
  for(const k of ["cd", "ch", "kd", "kh"]) await d.locator("#pd_" + k).fill(v[k] || "");
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
  expect(celdas).toEqual(["1Z1 Tibabuyes", "2Z2 Lisboa", "0Z3 Rincón", "1Sin zona"]);

  // Sin «pedir ubicación», recibe sin preguntar.
  await page.uncheck("#recUbic");
  await page.click("#recScan");
  expect((await A.leer(page, "ZON0000005")).txt).toBe("Recibida → sin zona");
  await page.click("#scClose");

  // Despacho: las zonas de Jairo primero; un paquete de la zona de Pedro se entrega con aviso, sin bloquear.
  await page.click('nav.tabs button[data-v="vDespachar"]');
  await page.locator("#desReps button", { hasText: "Jairo" }).click();
  await expect(page.locator("#desZonas .zcell").first()).toHaveText("1Z1 Tibabuyes");
  await expect(page.locator("#desZonas .zcell.suya")).toHaveCount(1);
  await page.click("#desScan");
  expect((await A.leer(page, "ZON0000001")).txt).toBe("Para Jairo · Z1 Tibabuyes");
  const r2 = await A.leer(page, "ZON0000002");
  expect(r2.txt).toBe("Para Jairo · Z2 Lisboa · ⚠ zona de Pedro"); expect(r2.cls).toBe("aviso");
  expect((await A.leer(page, "ZON0000004")).txt).toBe("Para Jairo");
  await page.click("#scClose");
  await page.click("#desPlanilla");
  const zonasPlanilla = await page.locator("#planilla tbody tr td:nth-child(3)").allTextContents();
  expect(zonasPlanilla).toEqual(["Sin zona", "Z1 Tibabuyes", "Z2 Lisboa"]);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#ltActs button.primary")]);
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
