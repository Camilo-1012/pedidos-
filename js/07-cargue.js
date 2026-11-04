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
  const v = prompt("Escribe la guía o sus últimos 4 números:"); if(!v) return;
  if(scanMode==="verify") verifyGuia(v.trim()); else showFind(v.trim());
}
$("scanFindBtn").onclick = ()=>{
  const v = $("scanFindIn").value.trim(); if(!v) return;
  if(scanMode==="verify"){ verifyGuia(v); $("scanFindIn").value = ""; return; }
  if(live) live.done = true;
  stopScan(); showFind(v);
};
$("scanFindIn").addEventListener("keydown", e=>{ if(e.key==="Enter"){ e.preventDefault(); $("scanFindBtn").click(); } });
$("btnFind").onclick = ()=>startScan("find");
$("btnFind2").onclick = ()=>startScan("find");

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
$("ldScan").onclick = ()=>{ $("dlgLoad").close(); state.loadOn = true; save(); startScan("verify"); };
$("ldReset").onclick = ()=>{ $("dlgLoad").close(); confirmBox("Verificar de nuevo", "Se borran las marcas de paquetes verificados de esta jornada.", ()=>{
  for(const st of state.stops){ delete st.chk; delete st.chkMan; } state.loadOn = false; state.loadExtra = []; save(); render(); toast("Verificación reiniciada.");
}); };
// Al cerrar la cámara en modo verificación se vuelve a «Revisar cargue» con el resultado.
$("dlgScan").addEventListener("close", ()=>{ if(scanMode==="verify"){ scanMode = "label"; render(); renderLoad(); $("dlgLoad").showModal(); } });
