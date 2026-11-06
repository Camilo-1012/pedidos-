// Aviso al cliente por WhatsApp/SMS con hora de llegada, y «Parquea una vez» (entregas a pie agrupadas).
const { test, expect } = require("@playwright/test");
const { entrar, cargar, vigilarErrores } = require("./ayuda");

const PARADAS = [
  { addr: "Calle 145 # 106-20", name: "laura gomez", phone: "311 222 3344" },
  { addr: "Calle 145 # 106-60", name: "Pedro Ruiz", phone: "3205556677" },
  { addr: "Calle 146 # 106-30", name: "Ana Torres" },
  { addr: "Calle 139 # 112-15", phone: "3001112233" }
];

test("avisar: 3 próximos, WhatsApp directo sin guardar contacto, mensaje con hora y marca de avisado", async ({ page }) => {
  const errs = vigilarErrores(page);
  await entrar(page);
  await cargar(page, PARADAS);
  await page.click("#btnAviso");
  await expect(page.locator("#dlgAviso")).toBeVisible();
  const filas = page.locator("#avList .found");
  await expect(filas).toHaveCount(3);
  await expect(filas.nth(0)).toContainText("1. Calle 145 # 106-20");
  // Sin teléfono: ofrece agregarlo en vez de WhatsApp
  await expect(filas.nth(2).getByRole("button", { name: "Agregar teléfono" })).toBeVisible();
  await expect(filas.nth(2).getByRole("link", { name: "WhatsApp" })).toHaveCount(0);
  // Enlace wa.me con indicativo 57 y el mensaje escrito
  const wa = filas.nth(0).getByRole("link", { name: "WhatsApp" });
  const href = await wa.getAttribute("href");
  expect(href).toMatch(/^https:\/\/wa\.me\/573112223344\?text=/);
  const msg = decodeURIComponent(href.split("?text=")[1]);
  expect(msg).toMatch(/^Hola Laura, le escribe el domiciliario de Temu\. Voy en camino con su pedido para Calle 145 # 106-20\./);
  expect(msg).toMatch(/Llego aproximadamente entre las \d{1,2}:\d{2} [ap]\. m\. y las \d{1,2}:\d{2} [ap]\. m\. ¿Hay alguien para recibir\?$/);
  expect(msg).not.toContain("..");
  await expect(filas.nth(0).getByRole("link", { name: "SMS" })).toHaveAttribute("href", /^sms:\+573112223344\?body=/);
  // Al tocar WhatsApp queda marcado como avisado (la pestaña externa se bloquea en las pruebas)
  await page.evaluate(() => { const a = document.querySelector("#avList .found a"); a.removeAttribute("target"); a.addEventListener("click", e => e.preventDefault()); a.click(); });
  await expect(filas.nth(0)).toContainText("avisado");
  expect(await page.evaluate(() => !!state.stops[0].avisadoAt)).toBe(true);
  await expect(page.locator("#avInfo")).toContainText("no existe en WhatsApp");
  // La empresa se puede cambiar y queda guardada
  await page.fill("#avEmpresa", "Otra Tienda"); await page.locator("#avEmpresa").dispatchEvent("change");
  const msg2 = decodeURIComponent((await filas.nth(1).getByRole("link", { name: "WhatsApp" }).getAttribute("href")).split("?text=")[1]);
  expect(msg2).toContain("le escribe el domiciliario de Otra Tienda.");
  expect(await page.evaluate(() => state.empresa)).toBe("Otra Tienda");
  await page.click("#dlgAviso button:has-text('Cerrar')");
  await expect(page.locator("#list .chip", { hasText: "Avisado" })).toHaveCount(1);
  // También desde el modo conducción
  await page.click("#btnDrive");
  await page.click("#dvAviso");
  await expect(page.locator("#dlgAviso")).toBeVisible();
  expect(errs).toEqual([]);
});

test("parquea una vez: agrupa las cercanas, avisa en conducción y sigue a pie tras entregar", async ({ page }) => {
  const errs = vigilarErrores(page);
  await entrar(page);
  await cargar(page, PARADAS);
  const grupos = await page.evaluate(() => gruposParqueo().map(g => g.miembros.map(m => m.addr)));
  expect(grupos).toEqual([["Calle 145 # 106-20", "Calle 145 # 106-60", "Calle 146 # 106-30"]]);
  // En la lista: encabezado P y paradas agrupadas
  await expect(page.locator("#list .parkHead")).toHaveCount(1);
  await expect(page.locator("#list .parkHead")).toContainText("Parquea una vez: 3 entregas a pie");
  await expect(page.locator("#list .stop.inPark")).toHaveCount(3);
  // Conducción: aviso de parqueo en la primera; la lejana no lo tiene
  await page.click("#btnDrive");
  await expect(page.locator("#dvPark")).toBeVisible();
  await expect(page.locator("#dvPark")).toContainText("Después, a pie: Calle 145 # 106-60");
  await page.click("#dvNextBtn"); await page.click("#dvNextBtn"); await page.click("#dvNextBtn");
  await expect(page.locator("#dvAddr")).toHaveText("Calle 139 # 112-15");
  await expect(page.locator("#dvPark")).toBeHidden();
  // Entrega la primera: la siguiente dice «A pie… no muevas el vehículo»
  await page.click("#dvPrev"); await page.click("#dvPrev"); await page.click("#dvPrev");
  await page.click("#dvDone");
  await expect(page.locator("#dvAddr")).toHaveText("Calle 145 # 106-60");
  await expect(page.locator("#dvPark")).toContainText("A pie");
  await expect(page.locator("#dvPark")).toContainText("no muevas el vehículo");
  // El número del paquete no se corre al entregar la anterior
  await expect(page.locator("#dvGuia .orden")).toHaveText("2");
  await expect(page.locator("#dvPos")).toHaveText("Faltan 3 entregas");
  expect(errs).toEqual([]);
});

test("parquea una vez: el mismo conjunto se agrupa aunque estén a más de 130 m", async ({ page }) => {
  await entrar(page);
  await cargar(page, [
    { addr: "Carrera 110 # 150-20", type: "conjunto", unit: "Los Pinos, Torre 1, Apto 302" },
    { addr: "Carrera 110 # 152-80", type: "conjunto", unit: "Los Pinos, Torre 6, Apto 101" },
    { addr: "Calle 139 # 112-15" }
  ]);
  const g = await page.evaluate(() => gruposParqueo().map(x => ({ n: x.miembros.length, txt: textoParqueo(x) })));
  expect(g).toEqual([{ n: 2, txt: "Parquea una vez en Los Pinos: 2 entregas (2 pedidos)" }]);
});
