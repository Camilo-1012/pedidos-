// v2.54: paquetes sin datos (no vinieron en un listado con dirección): se reciben solo con la guía, sin pedir calle
// ni carrera, y al despacharlos toman la zona del repartidor (así los organiza el despachador). El repartidor completa
// la dirección en su Ruta escaneando la etiqueta (eso ya lo cubre conexion.spec.js).
const { test, expect } = require("@playwright/test");
const A = require("./ayuda");

async function preparar(page){
  await A.entrar(page);
  await A.agregarRep(page, "Jairo"); await A.agregarRep(page, "John");
  await page.evaluate(() => {
    registrar("ZONA", null, {zid: "za", nombre: "Alcaparros", color: "#1f8a4c", cl: [130, 139], kr: [null, null], activa: true});
    registrar("ZONA", null, {zid: "zb", nombre: "Bilbao", color: "#d0421b", cl: [140, 149], kr: [null, null], activa: true});
    registrar("ZONA", null, {zid: "zc", nombre: "Lombardia", color: "#2f6fdf", cl: [150, 160], kr: [null, null], activa: true});
    pintarTodo();
  });
}
const zonaYUbic = (page, g) => page.evaluate(x => { const p = paq(x); const z = zonaDe(p); return {zona: z ? z.nombre : "", ubic: ubicTxt(p), auto: !!p.zonaAuto, estado: p.estado}; }, g);

test("recibir sin datos no pide calle ni carrera; al despachar toma la zona elegida del repartidor y Deshacer la quita", async ({ page }) => {
  const errs = A.vigilarErrores(page);
  await preparar(page);
  await A.nuevoLote(page, "Xcargo", "Sin listado");
  await expect(page.locator("#recUbicLbl")).toBeVisible();
  await expect(page.locator("#recUbic")).not.toBeChecked();
  await page.click("#recScan");
  for(const g of ["SD00000001", "SD00000002", "SD00000003"]){
    const r = await A.leer(page, g);
    expect(r.txt).toBe("Recibida → sin zona");
    await expect(page.locator("#scUbic")).toBeHidden();
  }
  await page.click("#scClose");
  await expect(page.locator("#recZonas .zcell", { hasText: "Sin zona" })).toHaveText("3Sin zonaXC 3");

  // Jairo lleva dos zonas: aparece «Paquetes sin datos van a la zona», por defecto la primera.
  await page.click('nav.tabs button[data-v="vDespachar"]');
  await page.locator("#desReps button", { hasText: "Jairo" }).click();
  await page.locator('#desZonasRep button[data-zid="za"]').click();
  await expect(page.locator("#desZonaSin")).toHaveCount(0);                // con una sola zona no hace falta elegir
  await page.locator('#desZonasRep button[data-zid="zb"]').click();
  await expect(page.locator("#desZonaSin button")).toHaveText(["Alcaparros", "Bilbao"]);
  await expect(page.locator('#desZonaSin button[aria-pressed="true"]')).toHaveText("Alcaparros");
  await page.locator('#desZonaSin button[data-zsin="zb"]').click();
  await expect(page.locator('#desZonaSin button[aria-pressed="true"]')).toHaveText("Bilbao");

  await page.click("#desScan");
  expect((await A.leer(page, "SD00000001")).txt).toBe("Para Jairo · Bilbao (sin datos: su zona)");
  expect((await A.leer(page, "SD00000002")).txt).toBe("Para Jairo · Bilbao (sin datos: su zona)");
  expect(await zonaYUbic(page, "SD00000001")).toEqual({zona: "Bilbao", ubic: "Sin datos · zona del repartidor al despachar", auto: true, estado: "RUTA"});
  // La zona viaja con la asignación (le llega al repartidor en su Ruta).
  expect(await page.evaluate(() => (POR_GUIA.get("SD00000001") || []).filter(e => e.tipo === "ASIGNADO").pop().d.zona)).toBe("Bilbao");
  // Deshacer quita la asignación y la zona puesta al despachar.
  await page.click("#scUndo");
  expect(await zonaYUbic(page, "SD00000002")).toEqual({zona: "", ubic: "Sin ubicación", auto: false, estado: "BODEGA"});
  await page.click("#scClose");
  expect(errs).toEqual([]);
});

test("pasar a otro repartidor cambia la zona puesta al despachar; una zona escrita a mano o por calle no se toca", async ({ page }) => {
  const errs = A.vigilarErrores(page);
  await preparar(page);
  await A.nuevoLote(page, "Xcargo", "Mixto");
  await page.check("#recUbic");
  await page.click("#recScan");
  const p = A.leer(page, "SD00000010"); await expect(page.locator("#scUbic")).toBeVisible();
  await page.fill("#ubCl", "155"); await page.fill("#ubKr", "100"); await page.click("#ubOk"); await p;      // Lombardia por calle
  const q = A.leer(page, "SD00000011"); await expect(page.locator("#scUbic")).toBeVisible(); await page.click("#ubSaltar"); await q;   // sin datos
  await page.click("#scClose");
  await page.uncheck("#recUbic");

  await page.click('nav.tabs button[data-v="vDespachar"]');
  await page.locator("#desReps button", { hasText: "John" }).click();
  await page.locator('#desZonasRep button[data-zid="zc"]').click();
  await page.locator("#desReps button", { hasText: "Jairo" }).click();
  await page.locator('#desZonasRep button[data-zid="za"]').click();
  await page.click("#desScan");
  const r = await A.leer(page, "SD00000010");
  expect(r.txt).toBe("Para Jairo · Lombardia · ⚠ no es de sus zonas (es de John)");   // tenía calle: conserva su zona
  expect((await A.leer(page, "SD00000011")).txt).toBe("Para Jairo · Alcaparros (sin datos: su zona)");
  await page.click("#scClose");

  // Corregir: pasar el paquete sin datos a John → toma la zona de John.
  await page.locator('#desLista li[data-guia="SD00000011"]').click();
  await page.locator("#ccReps button", { hasText: "John" }).click();
  expect(await zonaYUbic(page, "SD00000011")).toEqual({zona: "Lombardia", ubic: "Sin datos · zona del repartidor al despachar", auto: true, estado: "RUTA"});
  expect(await zonaYUbic(page, "SD00000010")).toMatchObject({zona: "Lombardia", auto: false});
  expect(errs).toEqual([]);
});
