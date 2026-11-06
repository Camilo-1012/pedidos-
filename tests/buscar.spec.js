// Buscar pedido por dirección (completa o parcial), guía, nombre, teléfono o conjunto.
const { test, expect } = require("@playwright/test");
const { entrar, cargar, vigilarErrores } = require("./ayuda");

const PARADAS = [
  { addr: "Carrera 150B # 143-45", name: "Laura Gomez", phone: "3112223344", guia: "PO123456789" },
  { addr: "Calle 145 # 106-20", name: "Pedro Ruiz", phone: "3205556677" },
  { addr: "Calle 145 # 106-60", name: "Ana Torres" },
  { addr: "Carrera 110 # 150-20", type: "conjunto", unit: "Los Pinos, Torre 1, Apto 302" },
  { addr: "Calle 139 # 112-15" }
];
const dirs = page => page.$$eval("#bqList .found .addr", e => e.map(x => x.textContent.split(" · ")[0]));

test("buscar pedido: por dirección completa, parcial, con cifras juntas, y por otros datos", async ({ page }) => {
  const errs = vigilarErrores(page);
  await entrar(page); await cargar(page, PARADAS);
  await page.click("#btnFind2");
  await expect(page.locator("#dlgBuscar")).toHaveAttribute("open", "");
  await expect(page.locator("#bqIn")).toBeFocused();
  const buscar = async (q) => { await page.fill("#bqIn", q); return dirs(page); };
  // Dirección completa escrita de varias formas
  expect(await buscar("carrera 150 b # 143-45")).toEqual(["Carrera 150B # 143-45"]);
  expect(await buscar("KR 150B 143 45")).toEqual(["Carrera 150B # 143-45"]);
  expect(await buscar("cra 150b 14345")).toEqual(["Carrera 150B # 143-45"]);
  // Parte de la dirección
  expect(await buscar("150b 143 45")).toEqual(["Carrera 150B # 143-45"]);
  expect(await buscar("calle 145")).toEqual(["Calle 145 # 106-20", "Calle 145 # 106-60"]);
  expect(await buscar("106 60")).toEqual(["Calle 145 # 106-60"]);
  // Otros datos
  expect(await buscar("pinos")).toEqual(["Carrera 110 # 150-20"]);
  expect(await buscar("pedro")).toEqual(["Calle 145 # 106-20"]);
  expect(await buscar("6677")).toEqual(["Calle 145 # 106-20"]);
  expect(await buscar("PO123456789")).toEqual(["Carrera 150B # 143-45"]);
  // Nada
  expect(await buscar("calle 170 # 50-10")).toEqual([]);
  await expect(page.locator("#bqInfo")).toContainText("No hay pedidos");
  // Abrir un resultado: entregar, y «Buscar otro» vuelve con la misma búsqueda
  await buscar("calle 145 106 20");
  await page.click("#bqList .found");
  await expect(page.locator("#fdTitle")).toHaveText("Paquete encontrado");
  await page.click('#fdActs button:has-text("Entregado")');
  expect(await page.evaluate(() => state.stops.find(s => s.name === "Pedro Ruiz").status)).toBe("done");
  await page.click("#btnFind");
  await page.fill("#bqIn", "calle 145");
  // Las entregadas también se encuentran, pero después de las pendientes
  expect(await dirs(page)).toEqual(["Calle 145 # 106-60", "Calle 145 # 106-20"]);
  await expect(page.locator("#bqList .found").nth(1)).toContainText("Ya entregado");
  await page.click("#bqList .found >> nth=0");
  await page.click('#fdActs button:has-text("Buscar otro")');
  await expect(page.locator("#bqIn")).toHaveValue("calle 145");
  expect(errs).toEqual([]);
});

test("buscar pedido: vía elegida con botón (por defecto la del dictado) y solo los números", async ({ page }) => {
  const errs = vigilarErrores(page);
  await entrar(page); await cargar(page, [...PARADAS, { addr: "Carrera 145 # 139-10", guia: "PO5550145" }]);
  await page.evaluate(() => { state.viaDictado = "Calle"; save(); });
  await page.click("#btnFind2");
  await expect(page.locator("#viaQCalle")).toBeChecked();          // toma la del dictado
  const buscar = async (q) => { await page.fill("#bqIn", q); return dirs(page); };
  // Con Calle: «145» son las de la Calle 145, no la Carrera 145
  expect(await buscar("145")).toEqual(["Calle 145 # 106-20", "Calle 145 # 106-60"]);
  expect(await buscar("145 106 60")).toEqual(["Calle 145 # 106-60"]);
  expect(await buscar("pinos")).toEqual(["Carrera 110 # 150-20"]);     // texto: busca como siempre
  expect(await buscar("carrera 145")).toEqual(["Carrera 145 # 139-10"]); // si se escribe la vía, manda lo escrito
  expect(await buscar("5550145")).toEqual(["Carrera 145 # 139-10"]);  // la guía también se encuentra
  // Cambiar a Carrera: queda guardada para la búsqueda
  await page.click("label[for=viaQCarrera]");
  expect(await buscar("150b 14345")).toEqual(["Carrera 150B # 143-45"]);
  expect(await buscar("145")).toEqual(["Carrera 145 # 139-10"]);
  expect(await page.evaluate(() => [state.viaBuscar, state.viaDictado])).toEqual(["Carrera", "Calle"]);
  // Todas: como antes
  await page.click("label[for=viaQTodas]");
  expect((await buscar("145")).length).toBeGreaterThanOrEqual(2);
  expect(errs).toEqual([]);
});
