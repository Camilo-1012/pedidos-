// En ruta: cada paquete conserva su número y el orden del vehículo no se revuelve solo
// (al tomar la ubicación GPS, al entregar, con «No estaba» ni al llegar pedidos nuevos).
const { test, expect } = require("@playwright/test");
const { entrar, cargar, vigilarErrores, sinInternetExterno } = require("./ayuda");

const PARADAS = [
  { addr: "Calle 139 # 112-15" }, { addr: "Calle 145 # 106-20" }, { addr: "Carrera 110 # 150-20" },
  { addr: "Calle 132 # 105-10" }, { addr: "Calle 153 # 115-40" }, { addr: "Calle 145 # 110-80" }
];
const pendientes = page => page.evaluate(() => state.stops.filter(s => s.status !== "done").map(s => s.addr + "=" + s.num));
const numsLista = page => page.$$eval("#list li.stop .num", e => e.map(x => x.firstChild.textContent));

test("números fijos en ruta y orden estable con GPS, entregas, No estaba y pedidos nuevos", async ({ page, context }) => {
  const errs = vigilarErrores(page);
  await sinInternetExterno(page);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 4.7280, longitude: -74.1030, accuracy: 15 });   // Suba, lejos de la entrada por la 145
  await entrar(page); await cargar(page, PARADAS);
  // Antes de salir: «Ordenar ruta» numera 1…6 en el orden de la ruta
  await page.click("#btnSort");
  await expect.poll(() => page.evaluate(() => !optimizing)).toBe(true);
  expect(await numsLista(page)).toEqual(["1", "2", "3", "4", "5", "6"]);
  const cargue = await pendientes(page);
  // Salida con GPS: no se revuelve el orden ni los números; muestra la dirección aproximada
  await page.click("#btnGps");
  await expect(page.locator("#startInfo")).toContainText(/Cerca de ≈ (Calle|Carrera) \d+ # \d+-\d\d/);
  await expect.poll(() => page.evaluate(() => !optimizing && !!state.startGPS)).toBe(true);
  expect(await pendientes(page)).toEqual(cargue);
  await expect(page.locator("#routeSum")).toContainText(/Desde ≈ (Calle|Carrera) /);
  // Entregar la 1: la siguiente sigue siendo la 2 (no pasa a ser «1»)
  await page.click("#list li.stop >> nth=0 >> button[data-act=done]");
  expect(await numsLista(page)).toEqual(["2", "3", "4", "5", "6"]);
  // «No estaba» en la 2: va al final y conserva su número
  await page.click("#list li.stop >> nth=0 >> button[data-act=fail]");
  expect(await numsLista(page)).toEqual(["3", "4", "5", "6", "2"]);
  // Pedido nuevo a mitad de ruta: toma el número 7 y las demás no cambian de orden
  const antes = await pendientes(page);
  await page.evaluate(() => { state.stops.splice(0, 0, mkStop({ addr: "Calle 146 # 106-30" })); save(); render(); return optimize(true, { estable: true }); });
  const despues = await pendientes(page);
  expect(despues.filter(x => !x.startsWith("Calle 146"))).toEqual(antes);
  expect(despues.find(x => x.startsWith("Calle 146"))).toBe("Calle 146 # 106-30=7");
  // En modo conducción el número grande es el del paquete
  await page.click("#btnDrive");
  await expect(page.locator("#dvGuia .orden")).toHaveText(despues[0].split("=")[1]);
  await page.click("#dvExit");
  // «Ordenar ruta» a mitad de ruta puede cambiar el orden, pero no los números
  await page.click("#btnSort");
  await expect.poll(() => page.evaluate(() => !optimizing)).toBe(true);
  expect((await numsLista(page)).slice().sort()).toEqual(["2", "3", "4", "5", "6", "7"]);
  expect(errs).toEqual([]);
});

test("aviso de orden más corto en ruta (sin reordenar solo) y numeración nueva en la jornada siguiente", async ({ page }) => {
  await sinInternetExterno(page);
  await entrar(page); await cargar(page, PARADAS);
  await page.click("#btnSort");
  await expect.poll(() => page.evaluate(() => !optimizing)).toBe(true);
  // Se sale y luego el repartidor deja el orden al revés: la app no lo cambia sola, pero avisa
  await page.evaluate(() => { state.salidaAt = Date.now(); const p = state.stops.filter(s => s.status !== "done").reverse(); state.stops = p; save(); render(); });
  const alReves = await pendientes(page);
  await page.evaluate(() => optimize(true, { estable: true }));
  expect(await pendientes(page)).toEqual(alReves);
  await expect(page.locator("#mejoraInfo")).toBeVisible();
  await expect(page.locator("#mejoraInfo")).toContainText(/Hay un orden \d+ % más corto/);
  // «Ordenar ruta» antes de la primera entrega: reordena y vuelve a numerar 1…6
  await page.click("#btnSort");
  await expect.poll(() => page.evaluate(() => !optimizing)).toBe(true);
  expect(await numsLista(page)).toEqual(["1", "2", "3", "4", "5", "6"]);
  await expect(page.locator("#mejoraInfo")).toBeHidden();
});
