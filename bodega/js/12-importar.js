/* Importar listados (Excel .xlsx, .ods, CSV, TXT) a un lote de Bodega: cada guía queda «esperada» y, si el archivo
   trae la dirección, se guarda solo el número de calle y de carrera (para la zona). Nombre, teléfono y dirección
   completa del cliente NO se guardan (Ley 1581): esa decisión (llevarlos a la Ruta del repartidor) está pendiente.
   - .xlsx/.ods son ZIP: se leen con DecompressionStream («deflate-raw»), que ya trae el navegador (sin librerías).
   - .xls (Excel 97-2003) es binario: hay que guardarlo como .xlsx. Un .exe es un programa: nunca se abre.
   - Las columnas se detectan por el encabezado; si no se puede, se elige a mano y se recuerda para el próximo archivo.
   El formato exacto de Xcargo/iMile aún no se conoce: no se supone ninguna columna fija. */
"use strict";
// Dirección → calle y carrera. Copia aislada de parseAddress() de js/01-direcciones.js (no se puede cargar ese
// archivo aquí porque comparte nombres globales con Bodega). Si se corrige allá, traerlo aquí.
const leerDireccion = (() => {
  const VIA = [
    [/^(AVENIDA\s+CALLE|AV\.?\s*CALLE|AV\.?\s*CLL?|AC)$/,"AC","Avenida Calle","calle"],
    [/^(AVENIDA\s+CARRERA|AV\.?\s*CARRERA|AV\.?\s*(KR|CRA|CR|KRA)|AK)$/,"AK","Avenida Carrera","carrera"],
    [/^(CALLE|CLL|CL|CLLE|CALL)$/,"CL","Calle","calle"],
    [/^(CARRERA|CRA|KRA|KR|CR|CARR|K)$/,"KR","Carrera","carrera"],
    [/^(DIAGONAL|DIAG|DG|DIG)$/,"DG","Diagonal","calle"],
    [/^(TRANSVERSAL|TRANSV|TRANS|TV|TR|TRV)$/,"TV","Transversal","carrera"]
  ];
  const VIA_RE = "(AVENIDA\\s+CALLE|AVENIDA\\s+CARRERA|AV\\.?\\s*CALLE|AV\\.?\\s*CARRERA|AV\\.?\\s*CLL?|AV\\.?\\s*(?:KRA|KR|CRA|CR)|AC|AK|CALLE|CLLE|CALL|CLL|CL|CARRERA|CARR|CRA|KRA|KR|CR|K|DIAGONAL|DIAG|DG|DIG|TRANSVERSAL|TRANSV|TRANS|TRV|TV|TR)";
  const NUM_RE = "(\\d{1,3})\\s*([A-H])?\\s*(BIS)?\\s*([A-H])?";
  const ADDR_RE = new RegExp("\\b" + VIA_RE + "\\.?\\s*" + NUM_RE + "\\s*(SUR|ESTE)?\\s*(?:#|NO\\.?|N°|NRO\\.?|NUMERO|N\\.)?\\s*" + NUM_RE + "\\s*(?:[-–—]\\s*|(?<=[A-H])|\\s+)(\\d{1,3})\\b");

  function norm(s){
    return (s||"").toUpperCase()
      .normalize("NFD").replace(/[̀-ͯ]/g,"")
      .replace(/N[º°o]\.?/g," # ")
      .replace(/[,;]/g," ")
      // El OCR suele leer "#" como 4, H, % o ff: "143 4 151B-23" -> "143 # 151B-23"
      .replace(/(\d[A-H]?)\s+(?:4|H|%|FF|F|\*|\+)\s+(\d{1,3}\s*[A-H]?\s*(?:BIS)?\s*[A-H]?\s*-\s*\d)/g,"$1 # $2")
      .replace(/\s+/g," ").trim();
  }
  function letterVal(l){ return l ? Math.min(0.9,(l.charCodeAt(0)-64)*0.15) : 0; }
  function viaInfo(raw){
    const t = raw.replace(/\./g,"").replace(/\s+/g," ").trim();
    for(const [re,code,name,axis] of VIA) if(re.test(t)) return {code,name,axis};
    return null;
  }
  function parseAddress(text){
    const s = norm(text);
    const m = s.match(ADDR_RE);
    if(!m) return null;
    const v = viaInfo(m[1]); if(!v) return null;
    const p = {n:+m[2], l1:m[3]||"", bis:!!m[4], l2:m[5]||""};
    const g = {n:+m[7], l1:m[8]||"", bis:!!m[9], l2:m[10]||""};
    const placa = +m[11];
    const rest = s.slice(m.index);
    const sur = /\bSUR\b/.test(rest) || m[6]==="SUR";
    const este = /\bESTE\b/.test(rest) || m[6]==="ESTE";
    const val = o => o.n + letterVal(o.l1) + (o.bis?0.08:0) + letterVal(o.l2)*0.3;
    let x,y;
    if(v.axis==="calle"){ y = val(p); x = val(g) + placa/100; }
    else { x = val(p); y = val(g) + placa/100; }
    if(sur) y = -y;
    if(este) x = -x;
    const fmtN = o => o.n + (o.l1||"") + (o.bis?" Bis":"") + (o.l2?" "+o.l2:"");
    const label = `${v.name} ${fmtN(p)}${m[6]?" "+m[6][0]+m[6].slice(1).toLowerCase():""} # ${fmtN(g)}-${m[11].padStart(2,"0")}${sur&&m[6]!=="SUR"?" Sur":""}${este&&m[6]!=="ESTE"?" Este":""}`;
    return {x,y,label,via:v.code,parts:{axis:v.axis,p,g,placa,sur,este}};
  }
  return parseAddress;
})();
function calleCarrera(txt){
  const p = leerDireccion(txt); if(!p) return null;
  const a = p.parts, s = n => n;   // solo el número (las letras y el «bis» no cambian la zona)
  let cl, kr;
  if(a.axis === "calle"){ cl = a.p.n; kr = a.g.n; } else { kr = a.p.n; cl = a.g.n; }
  if(a.sur) cl = -cl; if(a.este) kr = -kr;
  return {cl: s(cl), kr: s(kr)};
}

/* ============ Lectores de archivos → tabla (lista de filas, cada fila lista de textos) ============ */
// ZIP mínimo (xlsx/ods): directorio central → archivos; «stored» (0) o «deflate» (8).
async function leerZip(buf){
  const dv = new DataView(buf), u8 = new Uint8Array(buf), dec = new TextDecoder();
  let fin = -1;
  for(let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) if(dv.getUint32(i, true) === 0x06054b50){ fin = i; break; }
  if(fin < 0) throw new Error("no es un archivo .xlsx/.ods válido");
  const n = dv.getUint16(fin + 10, true); let p = dv.getUint32(fin + 16, true);
  const archivos = new Map();
  for(let k = 0; k < n; k++){
    if(dv.getUint32(p, true) !== 0x02014b50) break;
    const metodo = dv.getUint16(p + 10, true), tam = dv.getUint32(p + 20, true);
    const ln = dv.getUint16(p + 28, true), le = dv.getUint16(p + 30, true), lc = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const nombre = dec.decode(u8.subarray(p + 46, p + 46 + ln));
    archivos.set(nombre, {metodo, tam, off});
    p += 46 + ln + le + lc;
  }
  return async nombre => {
    const a = archivos.get(nombre); if(!a) return null;
    const ini = a.off + 30 + dv.getUint16(a.off + 26, true) + dv.getUint16(a.off + 28, true);
    const datos = u8.subarray(ini, ini + a.tam);
    if(a.metodo === 0) return dec.decode(datos);
    if(a.metodo !== 8) throw new Error("compresión no soportada");
    if(!("DecompressionStream" in window)) throw new Error("este navegador no abre Excel: guárdalo como CSV");
    const s = new Blob([datos]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return await new Response(s).text();
  };
}
const xmlDoc = t => new DOMParser().parseFromString(t, "application/xml");
const colNum = ref => { let n = 0; for(const ch of ref.replace(/\d+/g, "")) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
async function tablaXlsx(buf){
  const leer = await leerZip(buf);
  const wb = xmlDoc(await leer("xl/workbook.xml") || ""), rels = xmlDoc(await leer("xl/_rels/workbook.xml.rels") || "<r/>");
  const hoja = wb.getElementsByTagName("sheet")[0]; if(!hoja) throw new Error("el Excel no tiene hojas");
  const rid = hoja.getAttribute("r:id") || hoja.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
  const rel = [...rels.getElementsByTagName("Relationship")].find(r => r.getAttribute("Id") === rid);
  let ruta = rel ? rel.getAttribute("Target") : "worksheets/sheet1.xml";
  ruta = ruta.startsWith("/") ? ruta.slice(1) : "xl/" + ruta.replace(/^\.\//, "");
  const ss = xmlDoc(await leer("xl/sharedStrings.xml") || "<sst/>");
  const compartidos = [...ss.getElementsByTagName("si")].map(si => [...si.getElementsByTagName("t")].map(t => t.textContent).join(""));
  const sh = xmlDoc(await leer(ruta) || await leer("xl/worksheets/sheet1.xml") || "");
  return [...sh.getElementsByTagName("row")].map(row => {
    const fila = [];
    for(const c of row.getElementsByTagName("c")){
      const t = c.getAttribute("t"), v = c.getElementsByTagName("v")[0];
      let val = "";
      if(t === "s") val = compartidos[+(v && v.textContent)] ?? "";
      else if(t === "inlineStr") val = [...c.getElementsByTagName("t")].map(x => x.textContent).join("");
      else val = v ? v.textContent : "";
      fila[colNum(c.getAttribute("r") || "")] = String(val).trim();
    }
    return Array.from(fila, x => x ?? "");
  });
}
async function tablaOds(buf){
  const leer = await leerZip(buf);
  const doc = xmlDoc(await leer("content.xml") || ""), NS = "urn:oasis:names:tc:opendocument:xmlns:table:1.0";
  const tabla = doc.getElementsByTagNameNS(NS, "table")[0]; if(!tabla) throw new Error("el archivo no tiene hojas");
  const filas = [];
  for(const row of tabla.getElementsByTagNameNS(NS, "table-row")){
    const fila = [];
    for(const c of row.getElementsByTagNameNS(NS, "table-cell")){
      const rep = Math.min(+(c.getAttributeNS(NS, "number-columns-repeated") || 1), 50);
      const txt = [...c.getElementsByTagNameNS("urn:oasis:names:tc:opendocument:xmlns:text:1.0", "p")].map(p => p.textContent).join(" ").trim();
      for(let i = 0; i < rep; i++) fila.push(txt);
    }
    while(fila.length && !fila[fila.length - 1]) fila.pop();
    const rep = Math.min(+(row.getAttributeNS(NS, "number-rows-repeated") || 1), 5);
    if(fila.length) for(let i = 0; i < rep; i++) filas.push(fila);
  }
  return filas;
}
// CSV / TXT: UTF-8 o, si trae caracteres inválidos, Windows-1252 (CSV de Excel en Windows en español).
function textoDe(buf){
  let t = new TextDecoder("utf-8").decode(buf);
  if(t.includes("�")) t = new TextDecoder("windows-1252").decode(buf);
  return t.replace(/^﻿/, "");
}
function tablaCsv(texto){
  const linea1 = texto.split(/\r?\n/).find(l => l.trim()) || "";
  const sep = [";", ",", "\t", "|"].map(s => [s, linea1.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const filas = []; let fila = [], campo = "", comillas = false;
  for(let i = 0; i < texto.length; i++){
    const ch = texto[i];
    if(comillas){ if(ch === '"'){ if(texto[i + 1] === '"'){ campo += '"'; i++; } else comillas = false; } else campo += ch; }
    else if(ch === '"') comillas = true;
    else if(ch === sep){ fila.push(campo.trim()); campo = ""; }
    else if(ch === "\n" || ch === "\r"){ if(ch === "\r" && texto[i + 1] === "\n") i++; fila.push(campo.trim()); campo = ""; if(fila.some(x => x)) filas.push(fila); fila = []; }
    else campo += ch;
  }
  fila.push(campo.trim()); if(fila.some(x => x)) filas.push(fila);
  return filas;
}
const TIPOS_ARCHIVO = "XLSX (Excel), ODS, CSV o TXT";
async function leerTabla(archivo){
  const nombre = (archivo.name || "").toLowerCase(), ext = nombre.split(".").pop();
  if(archivo.size > 15e6) throw new Error("el archivo pesa más de 15 MB");
  const buf = await archivo.arrayBuffer(), u8 = new Uint8Array(buf.slice(0, 8));
  const esZip = u8[0] === 0x50 && u8[1] === 0x4b, esOle = u8[0] === 0xd0 && u8[1] === 0xcf;
  if(u8[0] === 0x4d && u8[1] === 0x5a) throw new Error("es un programa (.exe), no un listado. Descarga el listado en Excel o CSV");
  if(esOle || ext === "xls") throw new Error("es un Excel antiguo (.xls). Ábrelo y guárdalo como «Libro de Excel (.xlsx)» o como CSV");
  if(ext === "pdf" || (u8[0] === 0x25 && u8[1] === 0x50)) throw new Error("es un PDF: no trae la tabla como datos. Descarga el listado en Excel o CSV");
  if(esZip){
    const leer = await leerZip(buf);
    if(await leer("xl/workbook.xml")) return tablaXlsx(buf);
    if(await leer("content.xml")) return tablaOds(buf);
    throw new Error("el archivo comprimido no es un Excel ni una hoja ODS");
  }
  return tablaCsv(textoDe(buf));
}

/* ============ Columnas: detección por encabezado, por contenido o a mano ============ */
const sinTilde = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const CAMPOS = {
  guia: {txt:"Guía (obligatoria)", claves:["guia","numero de guia","no guia","n guia","nro guia","tracking","tracking number","numero de seguimiento","waybill","awb","codigo de envio","id envio","envio","orden","order","pedido","numero de orden","shipment"]},
  dir:  {txt:"Dirección (para la zona)", claves:["direccion","direccion destino","direccion de entrega","address","shipping address","dir","domicilio"]},
  emp:  {txt:"Empresa", claves:["empresa","operador","transportadora","carrier","courier","aliado"]}
};
function puntaje(enc, claves){ const e = sinTilde(enc); if(!e) return 0; let p = 0; for(const c of claves){ if(e === c) p = Math.max(p, 3); else if(e.startsWith(c) || e.endsWith(c)) p = Math.max(p, 2); else if(e.includes(c)) p = Math.max(p, 1); } return p; }
// Busca la fila de encabezados en las 10 primeras y propone la columna de cada campo.
function detectarColumnas(tabla){
  let mejor = {fila: -1, total: 0, map: {}};
  for(let r = 0; r < Math.min(10, tabla.length); r++){
    const map = {}; let total = 0;
    for(const [k, def] of Object.entries(CAMPOS)){
      let best = -1, bp = 0;
      tabla[r].forEach((enc, c) => { const p = puntaje(enc, def.claves); if(p > bp){ bp = p; best = c; } });
      if(best >= 0){ map[k] = best; total += bp + (k === "guia" ? 3 : 0); }
    }
    if(total > mejor.total && map.guia !== undefined) mejor = {fila: r, total, map};
  }
  if(mejor.fila < 0){
    // Sin encabezado reconocible: la columna donde casi todo parece guía.
    const ncol = Math.max(...tabla.slice(0, 50).map(f => f.length), 0);
    let best = -1, bp = 0;
    for(let c = 0; c < ncol; c++){ const vals = tabla.slice(0, 50).map(f => f[c]).filter(Boolean); const ok = vals.filter(v => normGuia(v)).length; if(vals.length && ok / vals.length > bp){ bp = ok / vals.length; best = c; } }
    const conEnc = tabla[0] && !normGuia(tabla[0][best]);
    mejor = {fila: conEnc ? 0 : -1, total: 0, map: best >= 0 && bp >= 0.6 ? {guia: best} : {}};
  }
  return mejor;
}
const firmaEnc = fila => (fila || []).map(sinTilde).join("|");
const MAPAS_KEY = "bodega.importar.mapas.v1";

/* ============ Pantalla: elegir archivo → revisar columnas → importar ============ */
let imp = null;   // {nombre, tabla, filaEnc, map, emp, destino}
function abrirImportar(){
  mostrarListado("Importar listado",
    `<p class="hint">Archivo del listado de paquetes (por ejemplo, el que descargas de Xcargo o iMile): ${TIPOS_ARCHIVO}. Un Excel antiguo (.xls) hay que guardarlo antes como .xlsx.</p>
     <label>Archivo<input type="file" id="imFile" accept=".xlsx,.ods,.csv,.txt,.tsv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.oasis.opendocument.spreadsheet,text/csv,text/plain"></label>
     <p class="uerr" id="imErr" role="alert"></p>
     <div id="imPaso2" hidden></div>
     <details><summary>O pega las guías</summary><textarea id="mfTxt" rows="6" aria-label="Guías esperadas"></textarea><p class="hint" id="mfInfo" role="status"></p></details>`,
    [["Cancelar", () => $("dlgLista").close()], ["Importar", importarAhora, "primary"]]);
  imp = null;
  $("ltActs").querySelector("button.primary").id = "imOk";
  $("mfTxt").oninput = () => { const n = guiasDeTexto($("mfTxt").value).length; $("mfInfo").textContent = n ? n + " guía(s) encontradas." : ""; };
  $("imFile").onchange = async e => {
    const f = e.target.files[0]; if(!f) return;
    $("imErr").textContent = "Leyendo…"; $("imPaso2").hidden = true;
    try{
      const tabla = await leerTabla(f);
      if(!tabla.length) throw new Error("el archivo está vacío");
      const det = detectarColumnas(tabla), mapas = store.get(MAPAS_KEY) || {};
      const guardado = det.fila >= 0 ? mapas[firmaEnc(tabla[det.fila])] : null;
      imp = {nombre: f.name, tabla, filaEnc: det.fila, map: guardado ? {...guardado} : det.map};
      $("imErr").textContent = "";
      pintarPaso2();
    }catch(x){ imp = null; $("imErr").textContent = "No se pudo leer «" + f.name + "»: " + (x.message || x) + "."; }
  };
}
function filasDatos(){ return imp.tabla.slice(imp.filaEnc + 1); }
function resumenImport(){
  const vistos = new Set(); let validas = 0, rep = 0, sinGuia = 0, conDir = 0, yaEst = 0;
  for(const f of filasDatos()){
    const g = imp.map.guia !== undefined ? normGuia(f[imp.map.guia]) : "";
    if(!g){ if(f.some(x => x)) sinGuia++; continue; }
    if(vistos.has(g)){ rep++; continue; } vistos.add(g); validas++;
    if(imp.map.dir !== undefined && calleCarrera(f[imp.map.dir])) conDir++;
    const p = paq(g); if(p && p.espLote) yaEst++;
  }
  return {validas, rep, sinGuia, conDir, yaEst};
}
function pintarPaso2(){
  const enc = imp.filaEnc >= 0 ? imp.tabla[imp.filaEnc] : [];
  const ncol = Math.max(...imp.tabla.slice(0, 30).map(f => f.length), 0);
  const ej = c => (filasDatos().find(f => f[c]) || [])[c] || "";
  const opciones = (k) => `<option value="">— ${k === "guia" ? "elige la columna" : "no usar"}</option>` + Array.from({length: ncol}, (_, c) =>
    `<option value="${c}"${imp.map[k] === c ? " selected" : ""}>${esc((enc[c] || "Columna " + (c + 1)) + (ej(c) ? " · ej.: " + String(ej(c)).slice(0, 28) : ""))}</option>`).join("");
  const r = resumenImport(), l = loteActual();
  const box = $("imPaso2"); box.hidden = false;
  box.innerHTML = `<p class="ok"><b>${esc(imp.nombre)}</b>: ${filasDatos().length} fila(s).</p>
    ${Object.entries(CAMPOS).map(([k, d]) => `<label>${esc(d.txt)}<select data-campo="${k}">${opciones(k)}</select></label>`).join("")}
    <label>Empresa de todo el listado (si no viene en una columna)<select id="imEmp">${EMPRESAS.map(e => `<option${(l && l.emp) === e ? " selected" : ""}>${e}</option>`).join("")}</select></label>
    <label>Guardar en<select id="imDest">${l && !l.cerrado ? `<option value="actual">El lote abierto: ${esc(l.nombre)}</option>` : ""}<option value="nuevo">Un lote nuevo: ${esc(imp.nombre.replace(/\.[^.]+$/, "").slice(0, 30))}</option></select></label>
    <div class="kpis"><div class="kpi ok"><b>${r.validas}</b><span>guías a importar</span></div><div class="kpi${r.rep ? " warn" : ""}"><b>${r.rep}</b><span>repetidas en el archivo</span></div><div class="kpi${r.sinGuia ? " warn" : ""}"><b>${r.sinGuia}</b><span>filas sin guía válida</span></div><div class="kpi"><b>${imp.map.dir !== undefined ? r.conDir : "—"}</b><span>con dirección (zona)</span></div></div>
    ${r.yaEst ? `<p class="hint">${r.yaEst} guía(s) ya estaban en el listado de otro lote: se dejan donde están.</p>` : ""}
    <p class="hint">Se guarda la guía y, de la dirección, solo el número de calle y de carrera (para la zona). Nombre, teléfono y dirección completa no se guardan.</p>`;
  box.querySelectorAll("select[data-campo]").forEach(s => s.onchange = () => { imp.map[s.dataset.campo] = s.value === "" ? undefined : +s.value; pintarPaso2(); });
  $("imOk").disabled = !r.validas;
}
function importarAhora(){
  // Pegado (sin archivo): como antes, solo guías.
  if(!imp){
    const l = loteActual(); if(!l){ $("imErr").textContent = "Crea primero un lote."; return; }
    if(!guiasDeTexto($("mfTxt").value).length){ $("imErr").textContent = "Elige un archivo o pega las guías."; return; }
    return guardarManifiesto(l.lid);
  }
  if(imp.map.guia === undefined){ $("imErr").textContent = "Elige la columna de la guía."; return; }
  const empFija = $("imEmp").value;
  let l = loteActual();
  if($("imDest").value === "nuevo" || !l || l.cerrado){
    const lid = uuid(); registrar("LOTE", null, {lid, nombre: imp.nombre.replace(/\.[^.]+$/, "").slice(0, 40), emp: empFija, esperado: 0});
    prefs.lote = lid; savePrefs(); l = LOTES.get(lid);
  }
  if(imp.filaEnc >= 0){ const m = store.get(MAPAS_KEY) || {}; m[firmaEnc(imp.tabla[imp.filaEnc])] = imp.map; store.set(MAPAS_KEY, m); }
  const vistos = new Set(); let nuevas = 0, zonas = 0, otras = 0;
  for(const f of filasDatos()){
    const g = normGuia(f[imp.map.guia]); if(!g || vistos.has(g)) continue; vistos.add(g);
    const p = paq(g);
    if(p && p.espLote && p.espLote !== l.lid){ otras++; continue; }
    const emp = (imp.map.emp !== undefined && EMPRESAS.find(e => sinTilde(f[imp.map.emp]).includes(sinTilde(e)))) || empFija;
    if(!p || !p.espLote){ registrar("ESPERADO", g, {lid: l.lid, emp}); nuevas++; }
    const cc = imp.map.dir !== undefined ? calleCarrera(f[imp.map.dir]) : null;
    if(cc && !tieneUbic(paq(g))){ registrar("UBICACION", g, cc); zonas++; }
  }
  $("dlgLista").close(); mostrarVista("vRecibir"); pintarTodo();
  toast(`Importadas ${nuevas} guía(s) en «${l.nombre}»` + (zonas ? ` · ${zonas} con zona` : "") + (otras ? ` · ${otras} ya estaban en otro lote` : "") + ".");
}
$("recManifiesto").onclick = abrirImportar;
