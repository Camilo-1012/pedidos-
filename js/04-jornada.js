/* Comparación de órdenes, historial de jornadas y reporte del día. */
"use strict";
/* ============ Comparación de órdenes ============ */
// Se guarda la última matriz de tiempos reales para medir cualquier orden de las mismas paradas:
// el sugerido, el orden en que se cargaron y el que deje el repartidor si mueve paradas a mano.
let LASTM = null;
function originKey(o){ return o ? (o.id || o.label || "") + "@" + (o.lat!=null ? o.lat.toFixed(5)+","+o.lng.toFixed(5) : "") : "-"; }
function orderCost(origin, stops, back){
  if(LASTM && stops.length && stops.every(s=>LASTM.idx.has(s.id))){
    let oi = null;
    if(origin){
      if(origin.id && LASTM.idx.has(origin.id)) oi = LASTM.idx.get(origin.id);
      else if(LASTM.okey === originKey(origin)) oi = LASTM.idx.get("__o");
      else oi = undefined;
    }
    if(oi !== undefined){
      let sec = 0, m = 0, prev = oi;
      for(const s of stops){ const i = LASTM.idx.get(s.id); if(prev!=null){ sec += LASTM.D[prev][i]; if(LASTM.KM) m += LASTM.KM[prev][i]||0; } prev = i; }
      if(back && oi!=null){ sec += LASTM.D[prev][oi]; if(LASTM.KM) m += LASTM.KM[prev][oi]||0; }
      return {km: LASTM.KM ? m/1000 : null, min: sec/60, real: true};
    }
  }
  return {km: pathLen(origin, stops, back)*KM_PER_UNIT, min: null, real: false};
}
// Tiempo/distancia estimados de un tramo (para el registro del día).
function legCost(from, to){
  if(!LASTM || !to || !LASTM.idx.has(to.id)) return null;
  let fi = null;
  if(from && from.id && LASTM.idx.has(from.id)) fi = LASTM.idx.get(from.id);
  else if(from && LASTM.okey === originKey(from)) fi = LASTM.idx.get("__o");
  if(fi==null) return null;
  const ti = LASTM.idx.get(to.id);
  return {sec: LASTM.D[fi][ti], m: LASTM.KM ? LASTM.KM[fi][ti] : null};
}
const fmtKm = v => v==null ? "" : v.toFixed(1).replace(".",",") + " km";
const fmtMin = v => v==null ? "" : Math.round(v) + " min";
const fmtCost = c => [fmtKm(c.km), fmtMin(c.min)].filter(Boolean).join(" · ");
function diffTxt(a, b){ // a - b
  const parts = [];
  if(a.km!=null && b.km!=null) parts.push((a.km-b.km>=0?"+":"−") + fmtKm(Math.abs(a.km-b.km)));
  if(a.min!=null && b.min!=null) parts.push((a.min-b.min>=0?"+":"−") + fmtMin(Math.abs(a.min-b.min)));
  return parts.join(" · ");
}
function updateComparison(){
  const box = $("cmpBox"); if(!box) return;
  const origin = currentOrigin();
  const back = !!state.roundTrip && !!parseAddress(state.start);
  // Se comparan solo las paradas pendientes (las de «No estaba» quedan al final a propósito y no cuentan como cambio a mano).
  const pend = state.stops.filter(s=>s.status==="pend" && s.x!==null);
  if(pend.length < 2 || !state.suggestedIds){ box.hidden = true; return; }
  const byId = new Map(pend.map(s=>[s.id,s]));
  const sug = state.suggestedIds.map(id=>byId.get(id)).filter(Boolean);
  pend.forEach(s=>{ if(!sug.includes(s)) sug.push(s); });
  const load = pend.slice().sort((a,b)=>(a.created||0)-(b.created||0));
  const cCur = orderCost(origin, pend, back), cSug = orderCost(origin, sug, back), cLoad = orderCost(origin, load, back);
  const tag = cSug.real ? "con calles reales" : "aproximado";
  const same = pend.every((s,i)=>s===sug[i]);
  let html;
  if(same){
    const save = cLoad.km - cSug.km, pct = cLoad.km > 0 ? Math.round(100*save/cLoad.km) : 0;
    html = pct >= 3
      ? `<b>Ahorro del orden sugerido:</b> ${diffTxt(cLoad, cSug).replace(/\+/g,"")} (${pct} %) frente a repartir en el orden en que cargaste los paquetes.<br>Sugerido: ${fmtCost(cSug)} · Orden de carga: ${fmtCost(cLoad)} (${tag}).`
      : `El orden en que cargaste los paquetes ya era casi igual de bueno (${fmtCost(cLoad)} frente a ${fmtCost(cSug)}, ${tag}).`;
    state.cmpLast = {sugKm:cSug.km, sugMin:cSug.min, loadKm:cLoad.km, loadMin:cLoad.min, real:cSug.real};
    if(!state.stops.some(s=>s.status==="done")) state.cmpFirst = state.cmpLast;
  } else {
    const worse = (cCur.min!=null ? cCur.min - cSug.min : cCur.km - cSug.km) > 0.05;
    html = worse
      ? `<b>Moviste paradas a mano:</b> tu orden suma ${diffTxt(cCur, cSug)} frente al sugerido (${tag}).`
      : `<b>Moviste paradas a mano:</b> tu orden ahorra ${diffTxt(cSug, cCur).replace(/\+/g,"")} frente al sugerido (${tag}). Bien visto.`;
  }
  $("cmpInfo").innerHTML = html;
  $("btnRestore").hidden = same;
  box.hidden = false;
}

/* ============ Historial de jornadas (solo resumen) ============ */
// Por cada día se guarda un resumen y, por pedido, la guía y la dirección: sin nombres, teléfonos ni fotos.
// Ocupa unos pocos KB por día; se conservan los últimos 90 días.
const HIST_KEY = "rutaEntregas.u." + USER.id + ".hist.v1", HIST_DAYS = 90;
function histLoad(){ return store.get(HIST_KEY) || []; }
function ymd(t){ const d = new Date(t); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function pedidosDelDia(){
  const out = [];
  const rows = state.stops.filter(s=>!s.example && (s.status==="done" || s.status==="fail" || s.status==="pend"))
    .sort((a,b)=>(a.doneAt||a.failAt||9e15)-(b.doneAt||b.failAt||9e15));
  for(const s of rows){
    const est = s.status==="done" ? "Entregado" : s.status==="fail" ? "No entregado" : "Pendiente";
    const h = s.status==="done" ? s.doneAt : s.status==="fail" ? s.failAt : null;
    const gs = guias(s), q = s.qty||1;
    const d = s.label || s.addr || "", u = unitText(s, " ");
    if(!gs.length){ out.push({g:"", d, u, e:est, h, q}); continue; }
    // Varias guías en la misma parada: una fila por guía (los paquetes de más quedan en la última).
    gs.forEach((g,i)=>out.push({g, d, u, e:est, h, q: i===gs.length-1 ? Math.max(1, q-(gs.length-1)) : 1}));
  }
  return out;
}
function daySummary(){
  const done = state.stops.filter(s=>s.status==="done" && s.doneAt).sort((a,b)=>a.doneAt-b.doneAt);
  const fail = state.stops.filter(s=>s.status==="fail");
  const pend = state.stops.filter(s=>s.status==="pend" && !s.example);
  if(!done.length && !fail.length) return null;
  const q = arr => arr.reduce((a,s)=>a+(s.qty||1),0);
  const t0 = done.length ? done[0].doneAt : (fail[0].failAt||Date.now()), t1 = done.length ? done[done.length-1].doneAt : t0;
  const legs = done.slice(1).map((s,i)=>({real:(s.doneAt-done[i].doneAt)/60000, est:s.legEst!=null ? s.legEst/60 : null})).filter(x=>x.est!=null && x.real>0 && x.real<240);
  const sumR = legs.reduce((a,x)=>a+x.real,0), sumE = legs.reduce((a,x)=>a+x.est,0);
  const c = state.cmpFirst;
  return {
    id: state.dayId || ymd(t0), fecha: ymd(t0),
    entregas: done.length, paquetes: q(done), noEntregadas: fail.length, paqNoEntregados: q(fail), pendientes: pend.length,
    inicio: t0, fin: t1, minutos: Math.round((t1-t0)/60000),
    promEntreEntregas: done.length>1 ? Math.round((t1-t0)/60000/(done.length-1)) : null,
    kmEstimados: +(done.reduce((a,s)=>a+(s.legKm||0),0)/1000).toFixed(1) || null,
    manejoEstMin: legs.length ? Math.round(sumE) : null, realMin: legs.length ? Math.round(sumR) : null,
    minPorParada: legs.length ? Math.round((sumR-sumE)/legs.length) : null,
    ahorroKm: c && c.loadKm>c.sugKm ? +(c.loadKm-c.sugKm).toFixed(1) : null,
    ahorroMin: c && c.loadMin!=null && c.sugMin!=null && c.loadMin>c.sugMin ? Math.round(c.loadMin-c.sugMin) : null,
    callesReales: !!(c && c.real),
    // Por pedido: guía (código de barras), dirección, inmueble, estado, hora y paquetes. Sin nombres ni teléfonos.
    pedidos: pedidosDelDia()
  };
}
// Guarda (o actualiza) el resumen del día en curso. Se llama al entregar, al marcar «No estaba» y al empezar una jornada nueva.
function recordDay(){
  try{
    const sum = daySummary(); if(!sum) return;
    if(!state.dayId){ state.dayId = sum.id; }
    let h = histLoad().filter(x=>x.id!==sum.id);
    h.push(sum);
    const limit = Date.now() - HIST_DAYS*864e5;
    h = h.filter(x=>x.inicio >= limit).sort((a,b)=>a.inicio-b.inicio).slice(-150);
    store.set(HIST_KEY, h);
  }catch(e){ console.warn("historial", e); }
}
function fmtDate(t){ return new Date(t).toLocaleDateString("es-CO",{weekday:"short", day:"numeric", month:"short"}); }
function histTotals(h, days){
  const from = Date.now() - days*864e5, sel = h.filter(x=>x.inicio>=from);
  const e = sel.reduce((a,x)=>a+x.entregas,0), f = sel.reduce((a,x)=>a+x.noEntregadas,0), pq = sel.reduce((a,x)=>a+x.paquetes,0);
  const mins = sel.reduce((a,x)=>a+(x.minutos||0),0), ahorro = sel.reduce((a,x)=>a+(x.ahorroKm||0),0);
  return {n:sel.length, e, f, pq, efect: e+f ? Math.round(100*e/(e+f)) : null, porHora: mins>0 ? (e/(mins/60)).toFixed(1).replace(".",",") : null, ahorro};
}
function renderHist(){
  const h = histLoad().slice().reverse();
  const t7 = histTotals(h,7), t30 = histTotals(h,30);
  const line = (lbl,t) => t.n ? `<div><b>${lbl}:</b> ${t.n} jornada(s) · ${t.e} entregas (${t.pq} paquetes)${t.efect!=null?` · efectividad ${t.efect} %`:""}${t.porHora?` · ${t.porHora} entregas por hora`:""}${t.ahorro>0?` · ahorro estimado ${fmtKm(t.ahorro)}`:""}</div>` : `<div><b>${lbl}:</b> sin jornadas</div>`;
  $("histTotals").innerHTML = line("Últimos 7 días", t7) + line("Últimos 30 días", t30);
  $("histList").innerHTML = h.length ? h.map(x=>`<div class="hrow">
      <b>${esc(fmtDate(x.inicio))}</b>
      <span>${x.entregas} ${x.entregas===1?"entrega":"entregas"} (${x.paquetes} paq.)${x.noEntregadas?` · ${x.noEntregadas} no ${x.noEntregadas===1?"entregada":"entregadas"}`:""}${x.pendientes?` · ${x.pendientes} ${x.pendientes===1?"pendiente":"pendientes"}`:""}</span>
      <span>${hhmm(x.inicio)} a ${hhmm(x.fin)} · ${Math.floor(x.minutos/60)} h ${x.minutos%60} min${x.promEntreEntregas?` · ${x.promEntreEntregas} min entre entregas`:""}</span>
      ${x.kmEstimados||x.ahorroKm ? `<span>${x.kmEstimados?`≈ ${fmtKm(x.kmEstimados)} recorridos`:""}${x.ahorroKm?`${x.kmEstimados?" · ":""}ahorro ${fmtKm(x.ahorroKm)}${x.ahorroMin?" / "+x.ahorroMin+" min":""}`:""}</span>` : ""}
    </div>`).join("") : `<p class="hint">Aún no hay jornadas. El resumen se guarda solo al marcar entregas.</p>`;
  const kb = (new Blob([JSON.stringify(histLoad())]).size/1024).toFixed(1).replace(".",",");
  $("histInfo").textContent = `${h.length} día(s) guardados · ocupa ${kb} KB · por pedido se guarda la guía, la dirección, el estado y la hora (sin nombres ni teléfonos) · se conservan los últimos ${HIST_DAYS} días.`;
}
function downloadCsv(rows, name){
  const blob = new Blob(["\ufeff" + rows.join("\r\n")], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
}
// Texto que Excel no debe convertir en número (una guía de 16 dígitos se dañaría: Excel solo guarda 15).
const xText = v => v ? `="${String(v).replace(/"/g,"")}"` : "";
const fechaLarga = t => new Date(t).toLocaleDateString("es-CO",{year:"numeric", month:"2-digit", day:"2-digit"});
// Excel por pedido: Fecha, Primera entrega, Última entrega, Guía (código de barras), Dirección, Inmueble, Estado, Hora, Paquetes.
const csvCell = v => { v = String(v==null ? "" : v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g,'""') + '"' : v; };
function histCsvPedidos(){
  const h = histLoad();
  const rows = ["Fecha;Primera entrega;Última entrega;Guía (código de barras);Dirección;Inmueble;Estado;Hora;Paquetes"];
  for(const x of h){
    const base = [fechaLarga(x.inicio), hhmm(x.inicio), hhmm(x.fin)];
    const peds = x.pedidos && x.pedidos.length ? x.pedidos : null;
    if(!peds){ rows.push(base.concat(["(jornada sin detalle por pedido)","","","","",""]).join(";")); continue; }
    for(const pd of peds) rows.push(base.concat([pd.g ? xText(pd.g) : "(sin guía)", csvCell(pd.d||""), csvCell(pd.u||""), pd.e, pd.h ? hhmm(pd.h) : "", String(pd.q||1)]).join(";"));
  }
  downloadCsv(rows, "pedidos-por-jornada-" + ymd(Date.now()) + ".csv");
  toast("Excel por pedido descargado. Ábrelo con Excel o Google Sheets.");
}
function histCsv(){
  const h = histLoad();
  const cols = [["fecha","Fecha"],["entregas","Entregas"],["paquetes","Paquetes"],["noEntregadas","No entregadas"],["paqNoEntregados","Paquetes no entregados"],
    ["pendientes","Pendientes"],["inicio","Primera entrega"],["fin","Última entrega"],["minutos","Minutos"],["promEntreEntregas","Min. entre entregas"],
    ["kmEstimados","Km estimados"],["manejoEstMin","Manejo estimado (min)"],["realMin","Tiempo real (min)"],["minPorParada","Min. extra por parada"],
    ["ahorroKm","Ahorro km"],["ahorroMin","Ahorro min"],["callesReales","Calles reales"]];
  const cell = (k,v) => v==null ? "" : k==="fecha" ? v : (k==="inicio"||k==="fin") ? hhmm(v) : typeof v==="number" ? String(v).replace(".",",") : typeof v==="boolean" ? (v?"Sí":"No") : String(v);
  // Separador «;» y coma decimal: así lo abre bien Excel en español (Colombia).
  const rows = [cols.map(c=>c[1]).join(";")].concat(h.map(x=>cols.map(([k])=>k==="fecha" ? fechaLarga(x.inicio) : cell(k,x[k])).join(";")));
  downloadCsv(rows, "resumen-jornadas-" + ymd(Date.now()) + ".csv");
  toast("Resumen por día descargado. Ábrelo con Excel o Google Sheets.");
}

/* ============ Reporte del día ============ */
const hhmm = t => new Date(t).toLocaleTimeString("es-CO",{hour:"2-digit",minute:"2-digit"});
function dayReport(){
  const done = state.stops.filter(s=>s.status==="done" && s.doneAt).sort((a,b)=>a.doneAt-b.doneAt);
  const fail = state.stops.filter(s=>s.status==="fail");
  const pend = state.stops.filter(s=>s.status==="pend");
  const paq = arr => { const n = arr.reduce((a,s)=>a+(s.qty||1),0); return n + (n===1 ? " paquete" : " paquetes"); };
  const par = n => n + (n===1 ? " parada" : " paradas");
  const name = s => (s.label||s.addr) + " ["+unitText(s," ")+"]";
  const L = [];
  L.push("Reporte del día · " + new Date().toLocaleDateString("es-CO",{weekday:"long",day:"numeric",month:"long"}));
  L.push("");
  L.push(`Entregadas: ${par(done.length)} (${paq(done)})`);
  L.push(`No entregadas: ${fail.length}${fail.length?` (${paq(fail)})`:""}`);
  fail.forEach(s=>L.push("  - " + name(s) + (s.name?" · "+s.name:"")));
  if(pend.length) L.push(`Pendientes: ${pend.length} (${paq(pend)})`);
  if(done.length){
    const t0 = done[0].doneAt, t1 = done[done.length-1].doneAt, durMin = (t1-t0)/60000;
    L.push("");
    L.push(`Primera entrega: ${hhmm(t0)} · Última: ${hhmm(t1)}`);
    if(done.length>1){
      L.push(`Tiempo entre la primera y la última: ${Math.floor(durMin/60)} h ${Math.round(durMin%60)} min`);
      L.push(`Promedio entre entregas: ${Math.round(durMin/(done.length-1))} min`);
    }
    // Real contra estimado, solo en tramos con estimación del mapa.
    const legs = done.slice(1).map((s,i)=>({s, real:(s.doneAt-done[i].doneAt)/60000, est:s.legEst!=null ? s.legEst/60 : null, km:s.legKm}))
      .filter(x=>x.est!=null && x.real>0 && x.real<240);
    const kmEst = done.reduce((a,s)=>a+(s.legKm||0),0)/1000;
    if(kmEst>0) L.push(`Km estimados recorridos: ${fmtKm(kmEst)}`);
    if(legs.length){
      const sumR = legs.reduce((a,x)=>a+x.real,0), sumE = legs.reduce((a,x)=>a+x.est,0);
      L.push(`Manejo estimado por el mapa: ${Math.round(sumE)} min · tiempo real: ${Math.round(sumR)} min (${legs.length} tramos)`);
      L.push(`→ En promedio ${Math.round((sumR-sumE)/legs.length)} min por parada se van en estacionar, entregar y trancón.`);
      const worst = legs.filter(x=>x.real-x.est>10).sort((a,b)=>(b.real-b.est)-(a.real-a.est)).slice(0,3);
      if(worst.length){
        L.push("Tramos que más se demoraron frente a lo estimado:");
        worst.forEach(x=>L.push(`  - ${x.s.label||x.s.addr}: ${Math.round(x.real)} min reales vs ${Math.round(x.est)} estimados`));
      }
    } else L.push("Sin tiempos del mapa para comparar (la ruta se calculó sin internet o con orden aproximado).");
  }
  const c = state.cmpFirst;
  if(c && c.loadKm>c.sugKm){
    L.push("");
    L.push(`Ahorro estimado del orden sugerido al iniciar: ${fmtKm(c.loadKm-c.sugKm)}${c.loadMin!=null&&c.sugMin!=null?" · "+fmtMin(c.loadMin-c.sugMin):""} frente al orden de carga (${c.real?"calles reales":"aproximado"}).`);
  }
  return L.join("\n");
}
