// Utilidades comunes de las pruebas.
const { expect } = require("@playwright/test");
const PIN = "2580";
// Errores de JavaScript de la página: toda prueba termina verificando que no hubo ninguno.
function vigilarErrores(page){ const errs = []; page.on("pageerror", e => errs.push(e.message)); return errs; }
// Bloquea Supabase real (las pruebas de la nube usan tests/nube.js).
async function sinNube(page){ await page.context().route(/supabase\.co/, r => r.abort()); }
// Primera vez: crea el usuario administrador y entra; espera a que carguen los datos.
async function entrar(page, nombre = "Camilo", pin = PIN, nube){
  if(!nube) await sinNube(page);
  await page.goto("/");
  await expect(page.locator("#lkSetup")).toBeVisible();
  await page.fill("#suName", nombre); await page.fill("#suPin", pin); await page.fill("#suPin2", pin);
  await page.click("#lkSetup button[type=submit]");
  await expect(page.locator("#lock")).toBeHidden({ timeout: 15000 });
  await page.waitForFunction(() => window.BODEGA_DATOS === true);
  await page.evaluate(() => { prefs.sonido = false; savePrefs(); });
}
async function menu(page, id){
  if(await page.locator("#hdrMenu").isHidden()) await page.click("#btnMenu");
  await page.click("#" + id);
}
// Responde el formulario genérico (pedir): {campo: valor}.
async function responder(page, valores, boton){
  const d = page.locator("#dlgPedir"); await expect(d).toBeVisible();
  for(const [k, v] of Object.entries(valores || {})){
    const el = d.locator("#pd_" + k);
    if(await el.evaluate(e => e.tagName) === "SELECT") await el.selectOption(v); else await el.fill(String(v));
  }
  await d.locator(boton === "no" ? "#pdNo" : "#pdYes").click();
  await expect(d).toBeHidden();
}
async function agregarRep(page, nombre){
  await menu(page, "btnReps");
  await page.click("#rpAdd"); await responder(page, { n: nombre });
  await expect(page.locator("#rpList")).toContainText(nombre);
  await page.locator("#dlgReps .dlgHead button").click();
}
async function nuevoLote(page, emp = "Xcargo", nombre = "", n = ""){
  await page.click('nav.tabs button[data-v="vRecibir"]');
  await page.click("#recNuevo"); await responder(page, { emp, nom: nombre, n });
  await expect(page.locator("#recInfo")).toBeVisible();
}
// Lectura simulada (como si la cámara leyera el código). Devuelve {tipo, txt}.
const leer = (page, g) => page.evaluate(x => window.__leer(x), g);
// Lee varias seguidas; si aparece una pregunta en el escáner, la contesta («si» o «no»).
async function leerConRespuesta(page, g, resp){
  const p = leer(page, g);
  await expect(page.locator("#scAsk")).toBeVisible();
  await page.click(resp === "no" ? "#scAskNo" : "#scAskYes");
  return p;
}
async function kpi(page, id, i){ return (await page.locator(`#${id} .kpi b`).nth(i).textContent()).trim(); }
// Lee un .xlsx generado por la app (ZIP sin compresión) → {hoja: [[celda…]]}. Copiado de pedidos-/tests/ayuda.js.
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
module.exports = { PIN, vigilarErrores, sinNube, entrar, menu, responder, agregarRep, nuevoLote, leer, leerConRespuesta, kpi, leerXlsx };
