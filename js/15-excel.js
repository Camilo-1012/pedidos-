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
function xlHoja(h){
  const filas = h.filas.map((fila, r)=>{
    const celdas = fila.map((c, i)=>{
      if(c == null || c === "") return "";
      const ref = xlCol(i) + (r+1), o = typeof c === "object" ? c : {v: c};
      const s = o.b || r === 0 ? ' s="1"' : "";
      if(typeof o.v === "number" && isFinite(o.v)) return `<c r="${ref}"${s}><v>${o.v}</v></c>`;
      return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xlEsc(o.v)}</t></is></c>`;
    }).join("");
    return `<row r="${r+1}">${celdas}</row>`;
  }).join("");
  const ncol = Math.max(1, ...h.filas.map(f=>f.length));
  const cols = Array.from({length: ncol}, (_, i)=>`<col min="${i+1}" max="${i+1}" width="${(h.anchos && h.anchos[i]) || 14}" customWidth="1"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${filas}</sheetData></worksheet>`;
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
    {nombre: "xl/styles.xml", texto: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`},
    ...hojas.map((h, i)=>({nombre: `xl/worksheets/sheet${i+1}.xml`, texto: xlHoja(h)}))
  ];
  return xlZip(archivos);
}
function descargarXlsx(hojas, nombre){
  const a = document.createElement("a"); a.href = URL.createObjectURL(xlsxBlob(hojas)); a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
}
