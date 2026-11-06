/* Buscar pedido por dirección (también por guía, nombre, teléfono, conjunto o barrio). */
"use strict";
/* ============ Buscar pedido ============ */
// Se escribe o se dicta lo que se recuerde: «150b 143 45», «carrera 150 b # 143-45», «los pinos», «Laura», «3344»…
// La búsqueda es local (paradas de la jornada en este celular, incluidas las entregadas); no usa internet.

const BQ_MAX = 20;
const BQ_VIA = [   // nombres de vía → código corto (igual que en js/01-direcciones.js)
  [/^(CALLE|CLL|CL|CLLE|CALL)$/, "CL"], [/^(CARRERA|CRA|KRA|KR|CR|CARR|K)$/, "KR"],
  [/^(DIAGONAL|DIAG|DG|DIG)$/, "DG"], [/^(TRANSVERSAL|TRANSV|TRANS|TV|TR|TRV)$/, "TV"],
  [/^(AC)$/, "AC"], [/^(AK)$/, "AK"]
];
const BQ_SOBRA = new Set(["NO", "NRO", "N", "NUMERO", "NUM", "#", "Y", "DE", "LA", "EL"]);
// Texto → fichas comparables: mayúsculas sin tildes, números y letras separados, vías con su código.
function bqFichas(txt){
  const t = String(txt||"").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\bAV(?:ENIDA)?\.?\s*(?:CALLE|CLL?|CL)\b/g, " AC ").replace(/\bAV(?:ENIDA)?\.?\s*(?:CARRERA|KRA|KR|CRA|CR)\b/g, " AK ")
    .replace(/N[º°]/g, " ").replace(/[#\-–—.,;:()/]/g, " ")
    .replace(/(\d)([A-Z])/g, "$1 $2").replace(/([A-Z])(\d)/g, "$1 $2");
  return t.split(/\s+/).filter(Boolean).map(f=>{ for(const [re, c] of BQ_VIA) if(re.test(f)) return c; return f; })
    .filter(f=>!BQ_SOBRA.has(f)).map(f=>/^\d+$/.test(f) ? String(+f) : f);   // «08» = «8»
}
// ¿Las fichas buscadas aparecen en ese orden dentro de las de la parada? Números exactos; palabras por el comienzo.
function bqEnOrden(q, en){
  let k = 0;
  for(const f of en){
    if(k >= q.length) break;
    const b = q[k];
    const ok = /^\d+$/.test(b) || b.length === 1 ? f === b : f.startsWith(b);
    if(ok) k++;
  }
  return k >= q.length;
}
// Variante para números juntos: «14345» → «143 45» (placa de 2 cifras), como en el dictado.
function bqVariantes(q){
  const out = [q];
  if(q.some(f=>/^\d{4,6}$/.test(f))) out.push(q.flatMap(f=>/^\d{4,6}$/.test(f) ? [String(+f.slice(0, -2)), String(+f.slice(-2))] : [f]));
  return out;
}
// Vía elegida con botón para buscar (Todas, Calle, Carrera…): así basta con escribir o dictar los números.
// Por defecto es la misma del dictado; si se cambia aquí, queda guardada para la búsqueda.
const BQ_COD = {Calle:"CL", Carrera:"KR", Diagonal:"DG", Transversal:"TV"};
function viaBuscar(){ return state.viaBuscar != null ? state.viaBuscar : (state.viaDictado || ""); }
// Busca en las paradas de la jornada. Devuelve [{st, g, por}] ordenado: dirección exacta, dirección, guía, otros datos.
function buscarPedidos(texto){
  const q = String(texto||"").trim();
  if(!q) return [];
  const fichas = bqFichas(q), digitos = q.replace(/\D/g, ""), soloNumeros = /^[\d\s-]+$/.test(q);
  // Con una vía elegida y la búsqueda empezando por un número, se busca solo en esa vía: «145 106» con Calle → Calle 145 # 106…
  const via = viaBuscar(), cod = BQ_COD[via];
  const conVia = !!cod && /^\d/.test(q) && !VIA_DICHA_RE.test(q.normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
  const exacta = parseAddress(spokenToAddress(conVia ? via + " " + q : q));
  const enLaVia = dir=>{ const t = bqFichas(dir); return t[0] === cod && bqVariantes(fichas).some(v=>v[0] === t[1] && bqEnOrden(v, t.slice(1))); };
  const porGuia = new Map(searchGuia(q).map(x=>[x.st, x.g]));
  const res = [];
  for(const st of state.stops){
    if(st.example) continue;
    const dir = st.label || st.addr || "";
    let puntos = 0, por = "";
    const pa = exacta && parseAddress(dir);
    if(pa && pa.label === exacta.label){ puntos = 100; por = "dirección"; }
    else if(conVia){ if(enLaVia(dir)){ puntos = 80; por = "dirección"; } else if(porGuia.has(st)){ puntos = 70; por = "guía"; } else if(digitos.length >= 4 && st.phone && String(st.phone).includes(digitos)){ puntos = 50; por = "teléfono"; } }
    else if(fichas.length && !soloNumeros && bqVariantes(fichas).some(v=>bqEnOrden(v, bqFichas(dir)))){ puntos = 80; por = "dirección"; }
    else if(porGuia.has(st)){ puntos = 70; por = "guía"; }
    else if(soloNumeros && fichas.length && bqVariantes(fichas).some(v=>bqEnOrden(v, bqFichas(dir)))){ puntos = 60; por = "dirección"; }
    else if(digitos.length >= 4 && st.phone && String(st.phone).includes(digitos)){ puntos = 50; por = "teléfono"; }
    else if(fichas.length && !soloNumeros && bqEnOrden(fichas, bqFichas([st.name, unitText(st), st.barrio, st.notes, st.addr].filter(Boolean).join(" ")))){ puntos = 40; por = "otros datos"; }
    if(puntos){
      if(st.status !== "done") puntos += 5;   // primero las pendientes
      res.push({st, g: porGuia.get(st) || "", por, puntos});
    }
  }
  return res.sort((a, b)=>b.puntos - a.puntos || (stopNum(a.st)||999) - (stopNum(b.st)||999)).slice(0, BQ_MAX);
}
function renderBuscar(){
  const q = $("bqIn").value, box = $("bqList"); box.innerHTML = "";
  $("bqIn").placeholder = viaBuscar() ? `${viaBuscar()} … ej.: 145 106 20` : "Ej.: 150b 143 45";
  if(!q.trim()){ $("bqInfo").textContent = viaBuscar()
    ? `Buscando en ${viaBuscar()}: escribe o dicta solo los números (por ejemplo «145 106 20» o solo «145»). También sirve la guía, el nombre, el teléfono o el conjunto.`
    : "Escribe o dicta la dirección (también sirve parte de ella: «150b 143 45»), la guía o sus últimos 4 números, el nombre, el teléfono o el conjunto."; return; }
  const r = buscarPedidos(q);
  const total = state.stops.filter(s=>!s.example).length;
  $("bqInfo").textContent = r.length
    ? `${r.length === BQ_MAX ? "Primeros " + BQ_MAX : r.length} resultado(s) de ${total} paradas. Toca uno para verlo.`
    : `No hay pedidos de la jornada que coincidan con «${q.trim()}». Revisa la dirección o busca solo una parte (por ejemplo, los números).`;
  for(const x of r){
    const c = stopCard(x.st, x.g);
    c.style.cursor = "pointer"; c.setAttribute("role", "button"); c.tabIndex = 0;
    const abrir = ()=>{ $("dlgBuscar").close(); showStopFound(x.st, x.g, ()=>abrirBuscar(q)); };
    c.onclick = abrir; c.onkeydown = e=>{ if(e.key === "Enter") abrir(); };
    box.appendChild(c);
  }
}
function pintarViaBuscar(){ for(const r of document.querySelectorAll("input[name=viaQ]")) r.checked = r.value === viaBuscar(); }
for(const r of document.querySelectorAll("input[name=viaQ]")) r.addEventListener("change", ()=>{
  if(!r.checked) return; state.viaBuscar = r.value; save(); renderBuscar(); $("bqIn").focus();
});
function abrirBuscar(texto){
  pintarViaBuscar();
  $("bqIn").value = texto || "";
  renderBuscar();
  $("dlgBuscar").showModal();
  if(!texto) setTimeout(()=>$("bqIn").focus(), 50);
}
// Dictar lo que se busca (necesita internet, como el resto del dictado).
let bqRec = null;
function bqDictar(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){ toast("Este navegador no permite dictar aquí. Usa el micrófono del teclado."); $("bqIn").focus(); return; }
  if(!navigator.onLine){ toast("El dictado necesita internet. Usa el micrófono del teclado o escribe."); return; }
  if(bqRec){ try{ bqRec.stop(); }catch(e){} return; }
  bqRec = new SR(); bqRec.lang = "es-CO"; bqRec.interimResults = true; bqRec.maxAlternatives = 3; bqRec.continuous = false;
  const btn = $("bqMic"); btn.classList.add("on"); btn.textContent = "Parar";
  bqRec.onresult = ev=>{
    let txt = "";
    for(let i = 0; i < ev.results.length; i++){
      const r = ev.results[i]; let best = r[0].transcript;
      if(r.isFinal) for(let k = 0; k < r.length; k++){ if(parseAddress(spokenToAddress(r[k].transcript))){ best = r[k].transcript; break; } }
      txt += " " + best;
    }
    // «calle ciento cuarenta y cinco…» → «calle 145 …»; si no es una dirección, queda lo dicho (nombre, conjunto…).
    const conv = spokenToAddress(txt.trim()), pa = parseAddress(conv);
    // Con vía elegida, lo dictado sin vía («ciento cuarenta y cinco ciento seis veinte») queda como números.
    $("bqIn").value = pa ? pa.label : conv;
    renderBuscar();
  };
  const fin = ()=>{ bqRec = null; btn.classList.remove("on"); btn.textContent = "Dictar"; };
  bqRec.onend = fin;
  bqRec.onerror = e=>{ fin(); if(e.error !== "aborted" && e.error !== "no-speech") toast("No se pudo dictar (" + e.error + ")."); };
  try{ bqRec.start(); }catch(e){ fin(); }
}
document.getElementById("bqIn").addEventListener("input", ()=>renderBuscar());
document.getElementById("bqMic").onclick = bqDictar;
document.getElementById("bqScan").onclick = ()=>{ $("dlgBuscar").close(); startScan("find"); };
document.getElementById("dlgBuscar").addEventListener("close", ()=>{ if(bqRec) try{ bqRec.abort(); }catch(e){} });
document.getElementById("btnFind").onclick = ()=>abrirBuscar();
document.getElementById("btnFind2").onclick = ()=>abrirBuscar();
