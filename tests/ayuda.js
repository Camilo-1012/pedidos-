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
  await page.waitForFunction(() => window.RUTA_LISTA === true);
  // Las pruebas de siempre usan las tarjetas con todos los botones; las compactas («⋯») tienen su propia prueba.
  await page.evaluate(() => { state.autoWaze = false; state.realRoads = false; state.tarjetasCompletas = true; save(); render(); });
}
// Abre el menú del encabezado (usuario, equipo, bloquear).
async function menu(page){
  if (await page.locator("#hdrMenu").isHidden()) await page.click("#btnMenu");
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
// Lee un .xlsx generado por la app (ZIP sin compresión) y devuelve {nombreHoja: [[celda…]…]} en el orden del libro.
function leerXlsx(ruta){
  const buf = require("fs").readFileSync(ruta), arch = {};
  let i = 0;
  while(buf.readUInt32LE(i) === 0x04034b50){
    const tam = buf.readUInt32LE(i + 18), ln = buf.readUInt16LE(i + 26), le = buf.readUInt16LE(i + 28);
    const nom = buf.slice(i + 30, i + 30 + ln).toString("utf8");
    arch[nom] = buf.slice(i + 30 + ln + le, i + 30 + ln + le + tam).toString("utf8");
    i += 30 + ln + le + tam;
  }
  const des = t => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  const nombres = [...arch["xl/workbook.xml"].matchAll(/<sheet name="([^"]*)"/g)].map(m => des(m[1]));
  const out = {};
  nombres.forEach((n, k) => {
    out[n] = [...arch[`xl/worksheets/sheet${k + 1}.xml`].matchAll(/<row r="(\d+)">(.*?)<\/row>/g)].map(([, , fila]) => {
      const celdas = [];
      for(const c of fila.matchAll(/<c r="([A-Z]+)\d+"[^>]*?(?:\/>|>(.*?)<\/c>)/g)){
        let col = 0; for(const ch of c[1]) col = col * 26 + ch.charCodeAt(0) - 64;
        const t = /<t[^>]*>(.*?)<\/t>/.exec(c[2] || ""), v = /<v>(.*?)<\/v>/.exec(c[2] || "");
        celdas[col - 1] = t ? des(t[1]) : v ? Number(v[1]) : "";
      }
      return Array.from(celdas, x => x === undefined ? "" : x);
    });
  });
  return out;
}
module.exports = { menu, sinCamara, CAMARA, PIN, entrar, teclear, cargar, vigilarErrores, sinInternetExterno, leerXlsx };
