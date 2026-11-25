// Modo conducción: parada actual en grande, entregar, no estaba, saltar y salir con Atrás.
const { test, expect } = require("@playwright/test");
const { entrar, cargar, vigilarErrores, leerXlsx } = require("./ayuda");

test("modo conducción de punta a punta", async ({ page }) => {
  const errs = vigilarErrores(page);
  await entrar(page);
  await cargar(page, [
    { addr: "Calle 145 # 103B-90", guia: "1111222233334444", qty: 2, phone: "3112223344", name: "Laura Gomez" },
    { addr: "Carrera 110 # 152-30", guia: "5555666677778888" },
    { addr: "Calle 139 # 112-15" }
  ]);
  await page.click("#btnDrive");
  await expect(page.locator("#drive")).toBeVisible();
  await expect(page.locator("#dvAddr")).toHaveText("Calle 145 # 103B-90");
  await expect(page.locator("#dvQty")).toContainText("2 pedidos en esta dirección");
  // Número de orden en la ruta (el mismo de la lista) y la guía debajo
  await expect(page.locator("#dvGuia .orden")).toHaveText("1");
  await expect(page.locator("#dvGuia .gs")).toContainText("1111222233334444");
  await expect(page.locator("#dvGuiaBtn")).toContainText("Escanear guía 2 de 2");   // 2 paquetes y 1 guía
  // Llamar abre el marcador con el número
  await page.evaluate(() => { window._marcado = null; window.dial = n => { window._marcado = n; }; });
  await page.click("#dvCall");
  expect(await page.evaluate(() => window._marcado)).toBe("3112223344");
  await expect(page.locator("#dvWaze")).toHaveAttribute("href", /waze\.com/);
  await expect(page.locator("#dvNext")).toContainText("Carrera 110 # 152-30");
  // Saltar y volver
  await page.click("#dvNextBtn"); await expect(page.locator("#dvAddr")).toHaveText("Carrera 110 # 152-30");
  await expect(page.locator("#dvGuia .orden")).toHaveText("2");
  await expect(page.locator("#dvPos")).toHaveText("Faltan 3 entregas");   // no cambia al avanzar con «Siguiente»
  await expect(page.locator("#dvGuia")).toContainText("1111222233334444".replace(/./g, "") + "5555666677778888");
  // Sin teléfono: el botón dice «Marcar» y abre el marcador vacío
  await expect(page.locator("#dvCall")).toHaveText("Marcar");
  await page.click("#dvCall");
  expect(await page.evaluate(() => window._marcado)).toBe("");
  await page.click("#dvPrev"); await expect(page.locator("#dvAddr")).toHaveText("Calle 145 # 103B-90");
  // Entregar → pasa a la siguiente
  await page.click("#dvDone");
  await expect(page.locator("#dvAddr")).toHaveText("Carrera 110 # 152-30");
  // No estaba → confirmación → pasa al final
  await page.click("#dvFail"); await page.click("#cfYes");
  await expect(page.locator("#dvAddr")).toHaveText("Calle 139 # 112-15");
  await expect(page.locator("#dvNext")).toContainText("Carrera 110 # 152-30");
  // Sigue abierto al recargar
  await page.reload(); await page.waitForFunction(() => window.RUTA_LISTA === true);
  await expect(page.locator("#drive")).toBeVisible();
  // Atrás de Android lo cierra
  await page.goBack();
  await expect(page.locator("#drive")).toBeHidden();
  expect(await page.evaluate(() => state.driveOn)).toBe(false);
  expect(errs).toEqual([]);
});

test("al terminar todas, muestra ¡Terminaste!", async ({ page }) => {
  await entrar(page);
  await cargar(page, [{ addr: "Calle 145 # 103B-90" }]);
  await page.click("#btnDrive"); await page.click("#dvDone");
  await expect(page.locator("#dvAddr")).toHaveText("¡Terminaste!");
  await expect(page.locator("#dvDone")).toBeDisabled();
});

test("v2.50: botón Devolución con motivo: sale de los pendientes, no se paga y queda en el Excel", async ({ page }) => {
  const errs = vigilarErrores(page);
  await entrar(page);
  await cargar(page, [
    { addr: "Calle 145 # 103B-90", guia: "1111222233334444" },
    { addr: "Carrera 110 # 152-30", guia: "5555666677778888" },
    { addr: "Calle 139 # 112-15", guia: "9999000011112222" }
  ]);
  await page.click("#btnDrive");
  await expect(page.locator("#dvDevol")).toBeVisible();
  await page.click("#dvDone");                                            // entrega la primera
  await expect(page.locator("#dvAddr")).toHaveText("Carrera 110 # 152-30");
  // Devolución: pide el motivo; «Otro» exige escribirlo.
  await page.click("#dvDevol");
  await expect(page.locator("#dlgDevol")).toBeVisible();
  await expect(page.locator("#dvlMsg")).toContainText("5555666677778888");
  await page.locator("#dvlOps label", { hasText: "Otro" }).click();
  await expect(page.locator("#dvlOtro")).toBeVisible();
  await page.click("#dvlOk");
  await expect(page.locator("#dlgDevol")).toBeVisible();                  // sin texto no deja seguir
  await page.locator("#dvlOps label", { hasText: "Dirección errada" }).click();
  await page.click("#dvlOk");
  await expect(page.locator("#dlgDevol")).toBeHidden();
  // Sale del modo conducción (no se reintenta) y la siguiente es la tercera.
  await expect(page.locator("#dvAddr")).toHaveText("Calle 139 # 112-15");
  await expect(page.locator("#dvPos")).toHaveText("Última entrega");
  await expect(page.locator("#dvNext")).toHaveText("Es la última parada.");
  await page.click("#dvDone");
  await expect(page.locator("#dvAddr")).toHaveText("¡Terminaste!");
  await page.click("#dvExit");
  // En la lista: chip de devolución; el día queda terminado y avisa llevarla a la bodega.
  const tarjeta = page.locator("#list li.stop", { hasText: "Carrera 110 # 152-30" });
  await expect(tarjeta.locator(".chip.devol")).toHaveText("Devolución · Dirección errada o no existe · vuelve a la bodega");
  await expect(page.locator("#pasoTxt")).toContainText("¡Ruta terminada! 2 pedido(s) entregado(s)");
  await expect(page.locator("#pasoTxt")).toContainText("1 devolución(es): llévalas a la bodega");
  // Historial: no se paga y lleva el motivo.
  const ped = await page.evaluate(() => histLoad().slice(-1)[0].pedidos.find(p => p.g === "5555666677778888"));
  expect([ped.e, ped.m]).toEqual(["No entregado", "Devolución: Dirección errada o no existe"]);
  expect(await page.evaluate(() => histLoad().slice(-1)[0].paquetes)).toBe(2);
  // Excel por pedido: Estado «Devolución» y su motivo en la hoja del día.
  await page.evaluate(() => $("btnHist").click());
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#histCsvPed")]);
  const libro = leerXlsx(await dl.path());
  const dia = libro[Object.keys(libro).pop()];
  const t = dia.slice(dia.findIndex(f => f[0] === "#"));
  const c = n => t[0].indexOf(n), fila = t.find(f => f[c("Guía (número de pedido)")] === "5555666677778888");
  expect([fila[c("Estado")], fila[c("Motivo")], fila[c("Valor ($)")]]).toEqual(["Devolución", "Devolución: Dirección errada o no existe", ""]);
  expect(dia.some(f => String(f[0]).includes("(1 devolución(es))"))).toBe(true);
  await page.evaluate(() => document.querySelectorAll("dialog[open]").forEach(d => d.close()));
  // Quitar la devolución la devuelve a los pendientes.
  await expect(tarjeta.locator("button[data-act=fail]")).toHaveText("Quitar devolución");
  await tarjeta.locator("button[data-act=fail]").evaluate(b => b.click());
  await expect(tarjeta.locator(".chip.devol")).toHaveCount(0);
  expect(await page.evaluate(() => { const s = state.stops.find(x => x.guia === "5555666677778888"); return [s.status, !!s.devol]; })).toEqual(["pend", false]);
  expect(errs).toEqual([]);
});
