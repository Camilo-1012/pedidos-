/* Almacenamiento, lectura de direcciones de Bogotá y de etiquetas. */
"use strict";
/* ============ Almacenamiento (solo en este navegador) ============ */
// Cada usuario tiene sus propios pedidos e historial (ver «Usuarios y PIN»).
const USER = window.RUTA_USER || {id:"local", name:"", admin:true};
const KEY = "rutaEntregas.u." + USER.id + ".v1";
const mem = {};
const store = {
  get(k){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; }catch(e){ return mem[k] ?? null; } },
  set(k,v){ mem[k] = v; try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};

/* ============ Parser de direcciones de Bogotá ============ */
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

/* ============ Extraer datos del texto de la etiqueta ============ */
function extractLabel(text){
  const lines = (text||"").split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const all = lines.join("\n");
  const out = {addr:"",phone:"",name:"",zone:"",barrio:"",guia:"",notes:"",raw:text||""};
  // Dirección: preferir la línea de "Destino"
  let addrLineIdx = lines.findIndex(l=>/DESTINO/i.test(l));
  let cand = [];
  if(addrLineIdx>=0) cand.push(lines[addrLineIdx].replace(/.*DESTINO\s*[:.]?\s*/i,""));
  lines.forEach((l,i)=>{ if(i!==addrLineIdx) cand.push(l); });
  for(const c of cand){
    const pa = parseAddress(c);
    if(pa){
      const n = norm(c); const mm = n.match(ADDR_RE);
      out.addr = pa.label;
      const after = n.slice(mm.index + mm[0].length).replace(/^[\s,.-]+/,"");
      const bar = after.split(/\b(BOGOTA|COLOMBIA|CP|TEL)\b/)[0].trim();
      if(bar && bar.length<40) out.barrio = bar.charAt(0)+bar.slice(1).toLowerCase();
      if(addrLineIdx<0) addrLineIdx = lines.indexOf(c);
      break;
    }
  }
  if(!out.addr && addrLineIdx>=0) out.addr = cand[0];
  // Teléfonos celulares colombianos (10 dígitos que empiezan por 3)
  const phones = [...new Set([...all.matchAll(/(?<![\d-])(?:\+?57[\s.-]?)?(3\d{2})[\s.-]?(\d{3})[\s.-]?(\d{4})(?!\d)/g)].map(m=>m[1]+m[2]+m[3]))];
  if(phones.length){ out.phone = phones[0]; if(phones.length>1) out.notes = "Otro tel: " + phones.slice(1).join(", "); }
  // Zona / sector
  const st = all.match(/\bST\s*[:.]?\s*(\d{1,4})/i); if(st) out.zone = st[1];
  else { const z = all.match(/ZONA\s*(\d{1,4})/i); if(z) out.zone = "Z" + z[1]; }
  // Guía
  const tn = all.match(/\bTN\s*[:.]?\s*(\d{10,})/i); if(tn) out.guia = tn[1];
  // Nombre: línea en mayúsculas antes de "Destino"
  if(addrLineIdx>0){
    for(let i=addrLineIdx-1;i>=Math.max(0,addrLineIdx-2);i--){
      const l = lines[i];
      if(/^[A-ZÁÉÍÓÚÑ ]{5,40}$/.test(l) && l.trim().split(/\s+/).length>=2 && !/OPERADO|ADMITIDO|COURIER|S\.?A\.?S/i.test(l)){ out.name = titleCase(l); break; }
    }
  }
  // Tipo de inmueble (casa, apto, local, conjunto) si la etiqueta lo menciona.
  const u = detectUnit(lines.filter((l,i)=>i>=Math.max(0,addrLineIdx)).join(" ") || all);
  if(u){ out.type = u.type; out.unit = u.detail; }
  // Si lo que quedó como barrio es en realidad el apto/local/conjunto, no se repite como barrio.
  if(out.barrio && detectUnit(out.barrio)) out.barrio = "";
  return out;
}
// Reconoce "Conjunto Los Pinos torre 2 apto 301", "Apto 502 Int 3", "Local 12", "Casa 14"...
function detectUnit(text){
  const t = " " + (text||"").replace(/\s+/g," ") + " ";
  const pick = re => { const m = t.match(re); return m ? m[0].trim().replace(/\s+/g," ") : ""; };
  // Torre/bloque/interior y apto/local solo cuentan con número (o una letra sola: «Torre B»); así «Tren» o «Apoyo» no se confunden.
  const torre = pick(/\b(?:torre|tr|bloque|blq|bl|interior|int|edificio|edif)\.?\s*(?:no\.?\s*)?(?:\d{1,3}[a-h]?|[a-h])\b/i);
  const apto  = pick(/\b(?:apto|apartamento|apart|apt|ap)\.?\s*(?:no\.?\s*)?\d{1,5}[a-h]?\b/i);
  const conj  = t.match(/\b(?:conjunto|conj|cjto|condominio|urbanizaci[oó]n|agrupaci[oó]n)\.?\s+(?:residencial\s+)?([a-záéíóúñ0-9 ]{2,30}?)(?=\s+(?:torre|tr|bloque|blq|bl|interior|int|apto|apartamento|apt|ap|casa|local|tel|st|bogota|colombia)\b|[,;]|\s*$)/i);
  const local = pick(/\b(?:local|loc|lc)\.?\s*(?:no\.?\s*)?\d{1,5}[a-h]?\b/i);
  const casa  = pick(/\bcasa\s*(?:no\.?\s*)?[a-z0-9]{0,5}\b/i);
  const cap = x => x ? x.charAt(0).toUpperCase() + x.slice(1) : x;
  if(conj) return {type:"conjunto", detail:[titleCase(conj[1].trim()), cap(torre), cap(apto), cap(casa)].filter(Boolean).join(", ")};
  if(apto) return {type:"apto", detail:[cap(torre), cap(apto)].filter(Boolean).join(", ")};
  if(local) return {type:"local", detail:cap(local)};
  if(casa) return {type:"casa", detail:/\d/.test(casa) ? cap(casa) : ""};
  if(torre) return {type:"apto", detail:cap(torre)};
  return null;
}
const UNIT_NAME = {casa:"Casa", apto:"Apto", local:"Local", conjunto:"Conjunto"};
// Texto del tipo + detalle sin repetir la palabra ("Local 5" y no "Local · Local 5").
function unitText(s, sep){
  const t = UNIT_NAME[s.type||"casa"], u = (s.unit||"").trim();
  if(!u) return t;
  return norm(u).startsWith(norm(t)) ? u : t + (sep||" · ") + u;
}
const UNIT_HINT = {casa:"Ej: Casa 14, puerta verde", apto:"Ej: Torre 2, apto 301", local:"Ej: Local 5, Droguería La 80", conjunto:"Ej: Conjunto Los Pinos, torre 3, apto 502", "":"Torre, apto, local o casa"};
function titleCase(s){ return s.toLowerCase().replace(/\b\p{L}/gu,c=>c.toUpperCase()); }
