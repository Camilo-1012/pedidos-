/* Excel (.xlsx) con varias hojas, armado en el celular sin librerías: un .xlsx es un ZIP con archivos XML. */
"use strict";
/* ============ Generador de .xlsx ============ */
// hojas: [{nombre, filas: [[celda…]…], anchos: [n…]}]. Celda: texto, número, null/"" (vacía) o {v, b:true} (negrita).
// Las guías van como texto: así Excel no las daña (solo guarda 15 dígitos en un número).
const XL_ENC = new TextEncoder();
const xlEsc = v => String(v).replace(/[<>&"]/g, c=>({"<":"&lt;", ">":"&gt;", "&":"&amp;", '"':"&quot;"}[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
const xlCol = i => { let s = ""; i++; while(i){ const m = (i-1) % 26; s = String.fromCharCode(65+m) + s; i = Math.floor((i-1)/26); } return s; };
// Nombre de hoja válido: máx. 31 caracteres, sin : \ / ? * [ ], y sin repetir.
function xlNombres(hojas){
  const usados = new Set();
  return hojas.map(h=>{
    const base = (String(h.nombre||"Hoja").replace(/[:\\/?*[\]]/g, "-").trim() || "Hoja").slice(0, 31);
    let n = base, k = 2;
    while(usados.has(n.toLowerCase())) n = base.slice(0, 31 - String(k).length - 3) + ` (${k++})`;
    usados.add(n.toLowerCase());
    return n;
  });
}
/* v2.49: hojas con presentación de empresa (h.pro = true): título, subtítulos, encabezado de tabla en color, bordes,
   pesos con formato «$ 1.600», totales resaltados, filtros, impresión horizontal ajustada al ancho.
   h.cab = fila (desde 0) del encabezado de la tabla; h.filtro = última fila (desde 0) del filtro; h.unir = ["A1:F1", …].
   Celda: {v, s} con s = "titulo" | "sub" | "cab" | "txt" | "centro" | "num" | "cop" | "pct" | "sec" | "seccop" | "secnum"
   | "tot" | "totnum" | "totcop" | "nota". Sin s: dentro de la tabla, número → "num" y texto → "txt".
   Las hojas sin «pro» (Bodega) quedan igual que antes: primera fila en negrita. */
const XL_EST = {normal:0, b:1, titulo:2, sub:3, cab:4, txt:5, num:6, cop:7, tot:8, totnum:9, totcop:10, sec:11, seccop:12, pct:13, centro:14, nota:15, secnum:16, totpct:17, secpct:18};
function xlHoja(h){
  const pro = !!h.pro, cab = pro ? (h.cab ?? -1) : 0;
  const filas = h.filas.map((fila, r)=>{
    const celdas = fila.map((c, i)=>{
      if(c == null || c === "") return pro && cab >= 0 && r > cab && i < h.filas[cab].length ? `<c r="${xlCol(i)}${r+1}" s="5"/>` : "";   // tabla: casilla vacía con borde
      const ref = xlCol(i) + (r+1), o = typeof c === "object" ? c : {v: c};
      if(pro && o.s && (o.v == null || o.v === "")) return XL_EST[o.s] ? `<c r="${ref}" s="${XL_EST[o.s]}"/>` : "";   // celda vacía con fondo/borde
      let st;
      if(pro){
        const nombre = o.s || (o.b ? "tot" : r > cab && cab >= 0 ? (typeof o.v === "number" ? "num" : "txt") : "");
        st = XL_EST[nombre] || 0;
      } else st = o.b || r === 0 ? 1 : 0;
      const s = st ? ` s="${st}"` : "";
      if(typeof o.v === "number" && isFinite(o.v)) return `<c r="${ref}"${s}><v>${o.v}</v></c>`;
      return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xlEsc(o.v)}</t></is></c>`;
    }).join("");
    return `<row r="${r+1}">${celdas}</row>`;
  }).join("");
  const ncol = Math.max(1, ...h.filas.map(f=>f.length));
  const cols = Array.from({length: ncol}, (_, i)=>`<col min="${i+1}" max="${i+1}" width="${(h.anchos && h.anchos[i]) || 14}" customWidth="1"/>`).join("");
  const fz = pro ? cab + 1 : 1;
  const pane = fz > 0 ? `<pane ySplit="${fz}" topLeftCell="A${fz+1}" activePane="bottomLeft" state="frozen"/>` : "";
  const vista = `<sheetViews><sheetView workbookViewId="0"${pro ? ' showGridLines="0"' : ""}>${pane}</sheetView></sheetViews>`;
  if(!pro) return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${vista}<cols>${cols}</cols><sheetData>${filas}</sheetData></worksheet>`;
  const filtro = cab >= 0 && h.filtro > cab ? `<autoFilter ref="A${cab+1}:${xlCol(ncol-1)}${h.filtro+1}"/>` : "";
  const unir = h.unir && h.unir.length ? `<mergeCells count="${h.unir.length}">${h.unir.map(u=>`<mergeCell ref="${u}"/>`).join("")}</mergeCells>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>${vista}<sheetFormatPr defaultRowHeight="16"/><cols>${cols}</cols><sheetData>${filas}</sheetData>${filtro}${unir}<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}
// ZIP sin compresión (método «store»): suficiente para Excel, Google Sheets y LibreOffice.
const XL_CRC = (()=>{ const t = new Uint32Array(256); for(let n=0;n<256;n++){ let c = n; for(let k=0;k<8;k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function xlCrc(u){ let c = 0xFFFFFFFF; for(let i=0;i<u.length;i++) c = XL_CRC[(c ^ u[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function xlZip(archivos){
  const partes = [], central = []; let off = 0;
  const d = new Date(), dosT = (d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()>>1), dosD = ((d.getFullYear()-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate();
  for(const f of archivos){
    const nom = XL_ENC.encode(f.nombre), dat = XL_ENC.encode(f.texto), crc = xlCrc(dat);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, dosT, true); h.setUint16(12, dosD, true); h.setUint32(14, crc, true);
    h.setUint32(18, dat.length, true); h.setUint32(22, dat.length, true); h.setUint16(26, nom.length, true); h.setUint16(28, 0, true);
    partes.push(new Uint8Array(h.buffer), nom, dat);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, dosT, true); c.setUint16(14, dosD, true); c.setUint32(16, crc, true); c.setUint32(20, dat.length, true); c.setUint32(24, dat.length, true);
    c.setUint16(28, nom.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), nom);
    off += 30 + nom.length + dat.length;
  }
  const tam = central.reduce((a, u)=>a + u.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, archivos.length, true); fin.setUint16(10, archivos.length, true);
  fin.setUint32(12, tam, true); fin.setUint32(16, off, true);
  return new Blob([...partes, ...central, new Uint8Array(fin.buffer)], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
}
/* Ayudas para armar hojas «de empresa» (las usan la Ruta y la Bodega). */
const xlC = {
  tot: v => ({v, s: typeof v === "number" ? "totnum" : "tot"}),          // fila de total (amarillo)
  totCop: v => ({v: Math.round(v || 0), s: "totcop"}),
  totPct: v => ({v, s: "totpct"}),
  cop: v => ({v: Math.round(v || 0), s: "cop"}),                         // pesos «$ 1.600»
  pct: v => v === "" || v == null ? "" : {v, s: "pct"},                  // fracción → «86 %»
  centro: v => v === "" || v == null ? "" : {v, s: "centro"},
  sec: v => ({v, s: typeof v === "number" ? "secnum" : "sec"}),          // subtotal (gris claro)
  secCop: v => ({v: Math.round(v || 0), s: "seccop"}),
  secPct: v => ({v, s: "secpct"})
};
const xlEfect = (ok, no) => ok + no ? Math.round(100 * ok / (ok + no)) / 100 : "";
// Hoja con título, líneas de contexto, tabla (cols + cuerpo) y fila de total opcional.
function xlHojaPro(nombre, titulo, lineas, cols, cuerpo, total, anchos){
  const sup = [[{v: titulo, s: "titulo"}], ...lineas.filter(Boolean).map(l => [{v: l, s: "sub"}]), []];
  const unir = sup.slice(0, -1).map((_, i) => `A${i+1}:${xlCol(Math.max(0, cols.length - 1))}${i+1}`);
  const cab = sup.length, filas = [...sup, cols.map(c => ({v: c, s: "cab"})), ...cuerpo];
  const filtro = filas.length - 1;
  if(total) filas.push(total);
  return {nombre: String(nombre).replace(/[\\/?*[\]:]/g, "-").slice(0, 31), pro: true, cab, filtro, unir, filas, anchos};
}
// Estilos: 0 normal · 1 negrita (hojas viejas) · 2… presentación de empresa (ver XL_EST).
// Colores de la app: gris carbón #263238 (encabezados) y amarillo #F5C518 (acento).
const XL_ESTILOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\
<numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;$&quot;\\ #,##0"/><numFmt numFmtId="165" formatCode="#,##0"/></numFmts>\
<fonts count="7"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font>\
<font><b/><sz val="16"/><color rgb="FF263238"/><name val="Calibri"/></font><font><sz val="10"/><color rgb="FF546E7A"/><name val="Calibri"/></font>\
<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="10"/><name val="Calibri"/></font></fonts>\
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>\
<fill><patternFill patternType="solid"><fgColor rgb="FF263238"/><bgColor indexed="64"/></patternFill></fill>\
<fill><patternFill patternType="solid"><fgColor rgb="FFFFE9A6"/><bgColor indexed="64"/></patternFill></fill>\
<fill><patternFill patternType="solid"><fgColor rgb="FFF1F4F6"/><bgColor indexed="64"/></patternFill></fill></fills>\
<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border>\
<border><left style="thin"><color rgb="FFCFD8DC"/></left><right style="thin"><color rgb="FFCFD8DC"/></right><top style="thin"><color rgb="FFCFD8DC"/></top><bottom style="thin"><color rgb="FFCFD8DC"/></bottom><diagonal/></border>\
<border><left style="thin"><color rgb="FFCFD8DC"/></left><right style="thin"><color rgb="FFCFD8DC"/></right><top style="medium"><color rgb="FF263238"/></top><bottom style="medium"><color rgb="FF263238"/></bottom><diagonal/></border></borders>\
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>\
<cellXfs count="19">\
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>\
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>\
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>\
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>\
<xf numFmtId="0" fontId="4" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>\
<xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>\
<xf numFmtId="165" fontId="5" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>\
<xf numFmtId="164" fontId="5" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>\
<xf numFmtId="0" fontId="6" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>\
<xf numFmtId="165" fontId="6" fillId="3" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>\
<xf numFmtId="164" fontId="6" fillId="3" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>\
<xf numFmtId="0" fontId="6" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>\
<xf numFmtId="164" fontId="6" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>\
<xf numFmtId="9" fontId="5" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>\
<xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>\
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>\
<xf numFmtId="165" fontId="6" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>\
<xf numFmtId="9" fontId="6" fillId="3" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>\
<xf numFmtId="9" fontId="6" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>\
</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
function xlsxBlob(hojas){
  const nombres = xlNombres(hojas);
  const archivos = [
    {nombre: "[Content_Types].xml", texto: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${hojas.map((_, i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`},
    {nombre: "_rels/.rels", texto: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`},
    {nombre: "xl/workbook.xml", texto: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${nombres.map((n, i)=>`<sheet name="${xlEsc(n)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join("")}</sheets></workbook>`},
    {nombre: "xl/_rels/workbook.xml.rels", texto: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hojas.map((_, i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join("")}<Relationship Id="rId${hojas.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`},
    {nombre: "xl/styles.xml", texto: XL_ESTILOS},
    ...hojas.map((h, i)=>({nombre: `xl/worksheets/sheet${i+1}.xml`, texto: xlHoja(h)}))
  ];
  return xlZip(archivos);
}
function descargarXlsx(hojas, nombre){
  const a = document.createElement("a"); a.href = URL.createObjectURL(xlsxBlob(hojas)); a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
}
