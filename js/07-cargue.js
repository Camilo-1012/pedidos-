/* Buscar paquete por guía, repetidos y revisión del cargue. */
"use strict";
/* ============ Buscar paquete por guía, repetidos y revisión del cargue ============ */
// Busca por guía completa o, si se escribe a mano, por los últimos números (mínimo 4).
function searchGuia(q){
  q = String(q||"").replace(/\s+/g,"");
  if(!q) return [];
  const exact = state.stops.filter(st=>guias(st).includes(q));
  if(exact.length) return exact.map(st=>({st, g:q}));
  const out = [];
  for(const st of state.stops) for(const g of guias(st)){
    // Escrito a mano: últimos 4 a 7 números. Leído con prefijos o sufijos de control: una guía contiene a la otra (8+ caracteres).
    const tail = /^\d{4,7}$/.test(q) && g.endsWith(q);
    const inside = q.length >= 8 && g.length >= 8 && (g.includes(q) || q.includes(g));
    if(tail || inside) out.push({st, g});
  }
  return out;
}
function stopCard(st, g){
  const n = stopNum(st), done = st.status==="done";
  const wrap = document.createElement("div"); wrap.className = "found" + (done ? " done" : "");
  wrap.innerHTML = `<div class="big"></div><div class="addr"></div><div class="guiaLine"></div><div class="hint" style="margin:0"></div>`;
  wrap.querySelector(".big").textContent = done ? "Ya entregado" : "Parada " + n + ((st.qty||1)>1 ? " · " + st.qty + " paquetes" : "");
  wrap.querySelector(".addr").textContent = (st.label || st.addr) + " · " + unitText(st);
  wrap.querySelector(".guiaLine").innerHTML = guias(st).map(x=>`<span${x===g?' style="text-decoration:underline"':''}>${esc(x)}</span>`).join("");
  wrap.querySelector(".hint").textContent = [st.barrio, st.name, st.phone && st.phone.replace(/(\d{3})(\d{3})(\d{4})/,"$1 $2 $3"), st.status==="fail" ? "Ya tuvo un intento fallido" : ""].filter(Boolean).join(" · ");
  return wrap;
}
function foundButtons(list){
  const box = $("fdActs"); box.innerHTML = "";
  for(const [txt, cls, fn] of list){
    const b = document.createElement("button"); b.type = "button"; b.textContent = txt; if(cls) b.className = cls;
    b.onclick = ()=>{ $("dlgFound").close(); if(fn) fn(); };
    box.appendChild(b);
  }
}
function flashStop(st){
  render();
  const li = document.querySelector(`#list li[data-id="${st.id}"]`); if(!li) return;
  li.scrollIntoView({behavior:"smooth", block:"center"});
  li.classList.remove("flash"); void li.offsetWidth; li.classList.add("flash");
  setTimeout(()=>li.classList.remove("flash"), 3400);
}
// Resultado de «Buscar paquete»: la parada con botones para entregar, abrir Waze o verla en la lista.
function showFind(q){
  const r = searchGuia(q), body = $("fdBody"); body.innerHTML = "";
  if(r.length && r.every(x=>x.st===r[0].st)){
    const {st, g} = r[0], done = st.status==="done";
    $("fdTitle").textContent = "Paquete encontrado";
    body.appendChild(stopCard(st, g));
    if(navigator.vibrate) navigator.vibrate(60);
    foundButtons([
      [done ? "Deshacer entregado" : "Entregado", done ? "" : "primary", ()=>toggleDone(st)],
      ...(done ? [] : [["Waze", "dark", ()=>openExternal(wazeUrl(st))]]),
      ["Ver en la lista", "", ()=>flashStop(st)],
      ["Buscar otro", "", ()=>startScan("find")]
    ]);
  } else if(r.length){
    $("fdTitle").textContent = "Varias guías terminan así";
    const p = document.createElement("p"); p.className = "hint"; p.textContent = "Toca el paquete que buscas:"; body.appendChild(p);
    for(const {st, g} of r){ const c = stopCard(st, g); c.style.cursor = "pointer"; c.onclick = ()=>{ $("dlgFound").close(); showFind(g); }; body.appendChild(c); }
    foundButtons([["Cerrar", "", null]]);
  } else {
    $("fdTitle").textContent = "No está en tu ruta";
    const w = document.createElement("div"); w.className = "found bad";
    w.innerHTML = `<div class="addr"></div><div class="hint" style="margin:0">Esa guía no está en los paquetes de hoy. Si es un paquete nuevo, agrégalo escaneando la etiqueta.</div>`;
    w.querySelector(".addr").textContent = "Guía " + q;
    body.appendChild(w);
    if(navigator.vibrate) navigator.vibrate([200,100,200]);
    foundButtons([["Agregar paquete", "primary", ()=>startScan("label")], ["Buscar otro", "", ()=>startScan("find")], ["Cerrar", "", null]]);
  }
  $("dlgFound").showModal();
}
// Aviso fuerte cuando se intenta cargar una guía que ya está en la lista.
function dupAlert(g){
  const st = findGuia(g); if(!st){ toast("Esa guía ya está cargada."); return; }
  if(navigator.vibrate) navigator.vibrate([250,100,250]);
  $("fdTitle").textContent = "Paquete repetido";
  const body = $("fdBody"); body.innerHTML = "";
  const p = document.createElement("p"); p.style.margin = "0"; p.textContent = "Esta guía ya está cargada; no se agregó otra vez:"; body.appendChild(p);
  body.appendChild(stopCard(st, g));
  foundButtons([
    ...(state.scanLoop ? [["Seguir escaneando", "primary", ()=>startScan("label")]] : []),
    ["Ver la parada", state.scanLoop ? "" : "primary", ()=>flashStop(st)],
    ["Cerrar", "", null]
  ]);
  $("dlgFound").showModal();
}
// Sin cámara en vivo: se pide la guía escrita.
function askGuiaTyped(){
  if(scanMode==="assign"){
    // Sin cámara en vivo: se pide la guía de cada parada, una por una.
    while(assignTarget()){
      const t = assignTarget();
      const v = prompt(`Guía para ${t.st.label||t.st.addr}${t.of>1?` (paquete ${t.k} de ${t.of})`:""}.\nDeja vacío para terminar.`);
      if(!v || !v.trim()) break;
      assignGuia(v.trim());
    }
    return;
  }
  const v = prompt("Escribe la guía o sus últimos 4 números:"); if(!v) return;
  if(scanMode==="verify") verifyGuia(v.trim()); else showFind(v.trim());
}
$("scanFindBtn").onclick = ()=>{
  const v = $("scanFindIn").value.trim(); if(!v) return;
  if(scanMode==="verify"){ verifyGuia(v); $("scanFindIn").value = ""; return; }
  if(scanMode==="assign"){ $("scanFindIn").value = ""; assignGuia(v.replace(/\s+/g,"")); return; }
  if(live) live.done = true;
  stopScan(); showFind(v);
};
$("scanFindIn").addEventListener("keydown", e=>{ if(e.key==="Enter"){ e.preventDefault(); $("scanFindBtn").click(); } });
$("btnFind").onclick = ()=>startScan("find");
$("btnFind2").onclick = ()=>startScan("find");

/* ---- Escanear guías de paradas que quedaron sin código (dictadas, pegadas o escritas) ----
   La app propone la parada (en el orden de la ruta) y se escanea el código de ese paquete; si se tiene otro paquete
   en la mano, se elige su dirección en la lista. Cada parada pide tantas guías como paquetes tenga. */
let assignQ = [];   // [{id, k, of}] k = número de paquete dentro de la parada
function guiasFaltantes(ids){
  const out = [];
  for(const st of state.stops){
    if(st.status==="done" || st.example || (ids && !ids.includes(st.id))) continue;
    const tiene = guias(st).length, qty = st.qty||1;
    for(let k=tiene+1; k<=qty; k++) out.push({id:st.id, k, of:qty});
  }
  return out;
}
function startAssign(ids){
  assignQ = guiasFaltantes(ids);
  if(!assignQ.length){ toast("Todas esas paradas ya tienen su guía."); return; }
  startScan("assign");
}
// Quita de la cola las paradas que ya completaron sus guías (o se entregaron/borraron) y devuelve la actual.
function assignTarget(){
  assignQ = assignQ.filter(q=>{ const st = state.stops.find(s=>s.id===q.id); return st && st.status!=="done" && guias(st).length < (st.qty||1); });
  // Renumera los paquetes de cada parada según las guías que ya tiene.
  const seen = {};
  assignQ.forEach(q=>{ const st = state.stops.find(s=>s.id===q.id); seen[q.id] = (seen[q.id]||0) + 1; q.k = guias(st).length + seen[q.id]; q.of = st.qty||1; });
  const q = assignQ[0]; if(!q) return null;
  return {...q, st: state.stops.find(s=>s.id===q.id)};
}
function assignMsg(){
  const t = assignTarget();
  if(!t) return "Listo: todas tienen su guía.";
  const paqTxt = t.of > 1 ? ` · paquete ${t.k} de ${t.of}` : "";
  return `Guía para la parada ${stopNum(t.st)}: ${t.st.label||t.st.addr}${paqTxt}. Escanea el código de barras o QR de ese paquete. Faltan ${assignQ.length}.`;
}
function assignShow(){
  const t = assignTarget(), sel = $("scanTarget");
  // Lista: una opción por parada que aún le falten guías (la actual primero).
  const ids = [...new Set(assignQ.map(q=>q.id))];
  sel.innerHTML = ids.map(id=>{ const st = state.stops.find(s=>s.id===id); const falta = (st.qty||1) - guias(st).length;
    return `<option value="${esc(id)}">${stopNum(st)}. ${esc(st.label||st.addr)}${falta>1?` (faltan ${falta})`:""}</option>`; }).join("");
  if(t) sel.value = t.id;
  $("scanTargetTxt").innerHTML = t ? `Parada ${stopNum(t.st)}: ${esc(t.st.label||t.st.addr)}<small>${t.of>1?`Paquete ${t.k} de ${t.of} · `:""}${esc(unitText(t.st))}${t.st.barrio?" · "+esc(t.st.barrio):""} · faltan ${assignQ.length}</small>` : "Listo: todas tienen su guía.";
  $("scanMsg").textContent = t ? "Escanea el código de barras o QR de ese paquete. Si tienes otro en la mano, elige su dirección abajo." : "";
  setStat("stCode", null, t ? "Código: esperando…" : "Código: listo");
}
// Elegir otra dirección: esa parada pasa a ser la actual.
$("scanTarget").addEventListener("change", e=>{
  const id = e.target.value, i = assignQ.findIndex(q=>q.id===id);
  if(i > 0){ const [q] = assignQ.splice(i,1); assignQ.unshift(q); }
  if(live) live.seen = new Set();   // permite leer de nuevo un código que se acababa de rechazar
  assignShow();
});
$("scanSkip").onclick = ()=>{
  if(live && live.phoneFor){ live.phoneFor = null; return; }   // se deja el teléfono y se sigue con la siguiente parada
  const t = assignTarget(); if(!t) return;
  assignQ.push(assignQ.shift());     // va al final
  assignShow();
};
async function assignGuia(g){
  const t = assignTarget(); if(!t) return;
  g = guiaFromCode(String(g));
  if(!g || g.length < 4){ setStat("stCode", false, "Ese código no parece una guía."); return; }
  const otra = findGuia(g);
  if(otra && otra !== t.st){ if(navigator.vibrate) navigator.vibrate([250,100,250]); setStat("stCode", false, `✗ ${g} ya está en ${placeName(otra)}`); return; }
  if(guias(t.st).includes(g)){ setStat("stCode", false, "Esa guía ya estaba en esta parada."); return; }
  t.st.guia = guias(t.st).concat(g).join(", ");
  save(); render();
  if(navigator.vibrate) navigator.vibrate(60);
  setStat("stCode", true, `✓ ${g} → ${t.st.label||t.st.addr}`);
  // Si a esta parada le falta el teléfono, se lee de la misma etiqueta antes de pasar a la siguiente.
  if(!t.st.phone && state.assignTel !== false && live && !live.done && scanStream){
    const tel = await leerTelefono(t.st);
    setStat("stTel", !!tel, tel ? "✓ Teléfono: " + tel.replace(/(\d{3})(\d{3})(\d{4})/,"$1 $2 $3") : "Teléfono: no se leyó (puedes seguir)");
  } else if(t.st.phone) setStat("stTel", true, "Teléfono: ya lo tenía");
  if(!assignTarget()){
    if(live) live.done = true;
    stopScan(); toast("Listo: todas las paradas tienen su guía.");
    return;
  }
  // Muestra la siguiente sin borrar el mensaje de confirmación.
  const ok = $("stCode").textContent; assignShow(); setStat("stCode", true, ok);
}
/* ---- Teléfono de la etiqueta en la misma pasada: lector de texto solo con números (más rápido que leer todo) ---- */
// Celular (3 + 9 dígitos) o fijo (601…), con o sin espacios, puntos o guiones. Se descartan números que sean parte de una guía.
function telDeTexto(text, excluir){
  const t = String(text||"");
  const cands = [...t.matchAll(/(?<![\d])(?:\+?57[\s.-]?)?((?:3\d{2}|60\d)[\s.-]?\d{3}[\s.-]?\d{4})(?![\d])/g)].map(m=>m[1].replace(/\D/g,""));
  const dentro = (excluir||[]).join(" ");
  return cands.find(c=>!dentro.includes(c)) || "";
}
async function leerTelefono(st){
  let w; try{ w = await getWorker(); }catch(e){ return ""; }
  live.phoneFor = st.id;
  setStat("stTel", null, "Teléfono: leyendo…");
  $("scanMsg").textContent = "Guía guardada. Leyendo el teléfono de la etiqueta… toca «Saltar este» si no lo tiene.";
  const t0 = Date.now(); let tel = "";
  while(live && !live.done && scanStream && live.phoneFor === st.id && Date.now() - t0 < 5000){
    const v = $("scanVideo"); if(!v.videoWidth){ await new Promise(r=>setTimeout(r,150)); continue; }
    try{
      await w.setParameters({tessedit_pageseg_mode:"11", tessedit_char_whitelist:"0123456789+-.() "});
      const { data } = await w.recognize(liveCrop(v));
      tel = telDeTexto(data.text, guias(st));
    }catch(e){ console.warn("teléfono", e); }
    finally{ try{ await w.setParameters({tessedit_char_whitelist:""}); }catch(e){} }
    if(tel) break;
  }
  if(live) live.phoneFor = null;
  if(tel && !st.phone){ st.phone = tel; save(); render(); if(navigator.vibrate) navigator.vibrate(40); }
  return tel;
}
$("scanTelOn").addEventListener("change", e=>{ state.assignTel = e.target.checked; save(); $("stTel").hidden = !e.target.checked; if(e.target.checked) getWorker().catch(()=>{}); });
// Foto del código (si la lectura en vivo no lo toma): se busca el código en la imagen.
$("scanPhotoIn").addEventListener("change", async e=>{
  const f = e.target.files && e.target.files[0]; e.target.value = ""; if(!f) return;
  $("scanMsg").textContent = "Buscando el código en la foto…";
  try{
    const bmp = await createImageBitmap(f);
    const codes = await codesFromImage(bmp);
    const g = codes.guia || (codes.addr && codes.addr.guia);
    if(g) assignGuia(g); else { $("scanMsg").textContent = assignMsg(); setStat("stCode", false, "No encontré un código en la foto. Acércate más o escribe la guía."); }
  }catch(err){ $("scanMsg").textContent = assignMsg(); setStat("stCode", false, "No se pudo leer la foto."); }
});
// Al cerrar la cámara: cuántas quedaron sin guía.
$("dlgScan").addEventListener("close", ()=>{
  if(scanMode!=="assign") return;
  scanMode = "label";
  const n = guiasFaltantes().length;
  if(n) toast(`Quedan ${n} paquete(s) sin guía. Puedes seguir desde «Revisar cargue» o el botón «+ Guía» de cada parada.`);
});

// ---- Verificación del cargue ----
// Cada parada guarda qué guías ya se escanearon (chk) y cuántos paquetes sin guía se confirmaron a mano (chkMan).
const pendStops = ()=>state.stops.filter(st=>st.status!=="done" && !st.example);
function loadedOf(st){ return Math.min(st.qty||1, (st.chk||[]).length + (st.chkMan||0)); }
function loadTotals(){
  const ps = pendStops();
  return {paradas: ps.length, paq: ps.reduce((a,st)=>a+(st.qty||1),0), ok: ps.reduce((a,st)=>a+loadedOf(st),0)};
}
function verifyMsg(){ const t = loadTotals(); return `Verificados ${t.ok} de ${t.paq} paquetes. Pasa la cámara por cada guía; la cámara sigue abierta.`; }
function verifyGuia(q){
  const r = searchGuia(q).filter(x=>x.st.status!=="done");
  let msg, ok = false;
  if(r.length && r.every(x=>x.st===r[0].st)){
    const {st, g} = r[0]; st.chk = st.chk || [];
    if(st.chk.includes(g)) msg = `Ya estaba verificado: parada ${stopNum(st)}.`;
    else { st.chk.push(g); ok = true; msg = `✓ Parada ${stopNum(st)} · ${st.label||st.addr}` + ((st.qty||1)>1 ? ` (${loadedOf(st)} de ${st.qty})` : ""); }
    if(navigator.vibrate) navigator.vibrate(ok ? 60 : [60,60,60]);
  } else if(r.length){ msg = "Varias guías terminan así: escribe más números."; }
  else {
    state.loadExtra = [...new Set([...(state.loadExtra||[]), q])].slice(-30);
    msg = `✗ ${q} no está en la ruta de hoy.`;
    if(navigator.vibrate) navigator.vibrate([250,100,250]);
  }
  state.loadOn = true; save();
  if(live && !live.done && $("dlgScan").open){ setStat("stCode", ok, msg); $("scanMsg").textContent = verifyMsg(); }
  else toast(msg);
  if($("dlgLoad").open) renderLoad();
}
// «Revisar cargue»: totales, lo que falta verificar y las paradas con problemas, antes de salir.
function renderLoad(){
  const t = loadTotals(), ps = pendStops();
  const sinGuia = ps.reduce((a,st)=>a + Math.max(0,(st.qty||1) - guias(st).length), 0);
  $("ldSum").innerHTML = `<div><b>${t.paradas}</b><span>paradas</span></div><div><b>${t.paq}</b><span>paquetes</span></div><div><b>${state.loadOn ? t.ok : "–"}</b><span>verificados</span></div>`;
  $("ldHint").textContent = !t.paq ? "No hay paquetes pendientes." :
    (state.loadOn ? (t.ok >= t.paq ? "Todo el cargue está verificado." : (t.paq - t.ok === 1 ? "Falta 1 paquete por verificar." : `Faltan ${t.paq - t.ok} paquetes por verificar.`)) : "Escanea la guía de cada paquete al subirlo al vehículo: así confirmas que no falta ni sobra ninguno.")
    + (sinGuia ? (sinGuia === 1 ? " 1 paquete no tiene guía registrada: confírmalo con «Lo tengo»." : ` ${sinGuia} paquetes no tienen guía registrada: confírmalos con «Lo tengo».`) : "");
  $("ldReset").hidden = !state.loadOn;
  const faltG = guiasFaltantes().length;
  $("ldGuias").hidden = !faltG; $("ldGuias").textContent = `Escanear guías faltantes (${faltG})`;
  // Orden de cargue: el inverso de la ruta (la última parada entra primero, al fondo).
  $("ldOrderList").innerHTML = ps.slice().reverse().map((st,i)=>`<li class="corder"><b>${stopNum(st)}</b><div>${esc(st.label||st.addr)}${(st.qty||1)>1?` <strong>×${st.qty}</strong>`:""}<span>${i===0?"Entra primero (al fondo) · ":i===ps.length-1?"Entra de último (a la mano) · ":""}${guias(st).map(g=>"…"+esc(g.slice(-4))).join(" ") || "Sin guía"}</span></div></li>`).join("");
  const box = $("ldList"); box.innerHTML = "";
  const issues = [];
  for(const st of ps){
    const why = [];
    if(st.x===null) why.push("Dirección sin reconocer");
    else if(st.geo==="barrio") why.push("Ubicada solo por barrio");
    if(zoneIssue(st)) why.push("Fuera de tu zona");
    if(st.zoneCheck && st.zoneCheck.bad) why.push("No coincide con el barrio");
    if(!guias(st).length) why.push("Sin guía");
    else if((st.qty||1) > guias(st).length) why.push(`${st.qty} paquetes y ${guias(st).length} guía(s)`);
    const falta = state.loadOn ? (st.qty||1) - loadedOf(st) : 0;
    if(falta > 0) why.push(`Falta verificar ${falta}`);
    if(why.length) issues.push({st, why, falta});
  }
  const extra = state.loadExtra || [];
  if(!issues.length && !extra.length){
    if(t.paq){ const p = document.createElement("p"); p.className = "hint"; p.style.margin = "0"; p.textContent = "Sin novedades: todas las paradas tienen dirección reconocida y guía."; box.appendChild(p); }
    return;
  }
  for(const {st, why, falta} of issues){
    const r = document.createElement("div"); r.className = "lrow";
    r.innerHTML = `<div><b></b><span class="hint"></span></div><div class="row" style="flex:0 0 auto;gap:6px"></div>`;
    r.querySelector("b").textContent = `${stopNum(st)}. ${st.label||st.addr}`;
    r.querySelector(".hint").textContent = why.join(" · ");
    const acts = r.querySelector(".row");
    if(falta > 0){
      const b = document.createElement("button"); b.type = "button"; b.className = "small"; b.textContent = "Lo tengo";
      b.onclick = ()=>{ st.chkMan = (st.qty||1) - (st.chk||[]).length; save(); renderLoad(); render(); };
      acts.appendChild(b);
    }
    if(guias(st).length < (st.qty||1)){
      const g = document.createElement("button"); g.type = "button"; g.className = "small"; g.textContent = "+ Guía";
      g.onclick = ()=>{ $("dlgLoad").close(); startAssign([st.id]); };
      acts.appendChild(g);
    }
    const e = document.createElement("button"); e.type = "button"; e.className = "small"; e.textContent = "Editar";
    e.onclick = ()=>{ $("dlgLoad").close(); openEdit(st); };
    acts.appendChild(e);
    box.appendChild(r);
  }
  if(extra.length){
    const r = document.createElement("div"); r.className = "lrow";
    r.innerHTML = `<div><b>Escaneados que no están en la ruta</b><span class="hint"></span></div>`;
    r.querySelector(".hint").textContent = extra.join(", ") + ". Agrégalos escaneando la etiqueta o devuélvelos.";
    box.appendChild(r);
  }
}
$("btnLoad").onclick = ()=>{ renderLoad(); $("dlgLoad").showModal(); };
$("ldGuias").onclick = ()=>{ $("dlgLoad").close(); startAssign(); };
$("ldScan").onclick = ()=>{ $("dlgLoad").close(); state.loadOn = true; save(); startScan("verify"); };
$("ldReset").onclick = ()=>{ $("dlgLoad").close(); confirmBox("Verificar de nuevo", "Se borran las marcas de paquetes verificados de esta jornada.", ()=>{
  for(const st of state.stops){ delete st.chk; delete st.chkMan; } state.loadOn = false; state.loadExtra = []; save(); render(); toast("Verificación reiniciada.");
}); };
// Al cerrar la cámara en modo verificación se vuelve a «Revisar cargue» con el resultado.
$("dlgScan").addEventListener("close", ()=>{ if(scanMode==="verify"){ scanMode = "label"; render(); renderLoad(); $("dlgLoad").showModal(); } });
