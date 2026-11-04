// Utilidades comunes de las pruebas.
const fs = require("fs"), path = require("path");
const { expect } = require("@playwright/test");
const CAMARA = fs.existsSync(path.join(__dirname, ".tmp", "camara.y4m"));
const PIN = "2580";

// Bloquea los servicios externos (mapas, rutas, Waze, WhatsApp) para que nada dependa de internet.
async function sinInternetExterno(page){
  await page.context().route(/overpass|osrm|routing\.openstreetmap|openrouteservice|kumi|coffee|waze\.com|wa\.me|nominatim/, r => r.abort());
}
// Primera vez: crea el usuario administrador y entra.
async function entrar(page, nombre = "Camilo", pin = PIN){
  await sinInternetExterno(page);
  await page.goto("/");
  await expect(page.locator("#lkSetup")).toBeVisible();
  await page.fill("#suName", nombre); await page.fill("#suPin", pin); await page.fill("#suPin2", pin);
  await page.click("#lkSetup button[type=submit]");
  await expect(page.locator("#lock")).toBeHidden({ timeout: 15000 });
  await page.waitForFunction(() => typeof state !== "undefined" && typeof render === "function");
  await page.evaluate(() => { state.autoWaze = false; state.realRoads = false; save(); });
}
// Escribe un PIN en el teclado numérico de la pantalla de bloqueo.
async function teclear(page, pin){
  for (const d of pin) await page.click(`#lkPad button[aria-label="${d}"]`);
}
// Simula un celular que no deja abrir la cámara (para probar lo que se escribe a mano).
async function sinCamara(page){
  await page.addInitScript(() => { if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => Promise.reject(new Error("sin permiso")); });
}
// Carga paradas de prueba directamente (sin cámara).
async function cargar(page, lista){
  await page.evaluate(l => { state.stops = l.map(d => mkStop(d)); save(); render(); }, lista);
}
// Errores de JavaScript de la página: toda prueba termina verificando que no hubo ninguno.
function vigilarErrores(page){
  const errs = [];
  page.on("pageerror", e => errs.push(e.message));
  return errs;
}
module.exports = { sinCamara, CAMARA, PIN, entrar, teclear, cargar, vigilarErrores, sinInternetExterno };
