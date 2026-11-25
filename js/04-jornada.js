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
  // En «Por direcciones» el orden lo decide el repartidor: no se compara con el cargue.
  if(pend.length < 2 || !state.suggestedIds || modoDirecciones()){ box.hidden = true; return; }
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
function pedidosDelDia(){ return pedidosDe(state.stops); }
function pedidosDe(lista){
  const out = [];
  const rows = lista.filter(s=>!s.example && (s.status==="done" || s.status==="fail" || s.status==="pend"))
    .sort((a,b)=>(a.doneAt||a.failAt||9e15)-(b.doneAt||b.failAt||9e15));
  for(const s of rows){
    const est = s.status==="done" ? "Entregado" : s.status==="fail" ? "No entregado" : "Pendiente";
    // v2.50: motivo del no entregado («No estaba» o «Devolución: …»).
    const m = s.status==="fail" ? (s.devol ? "Devolución: " + s.devol.m : "No estaba") : "";
    const h = s.status==="done" ? s.doneAt : s.status==="fail" ? s.failAt : null;
    const gs = guias(s), q = s.qty||1;
    const d = s.label || s.addr || "", u = unitText(s, " ");
    // i = id de la parada: sirve para no perder pedidos de la jornada si la parada se borra de la lista (ver recordDay).
    if(!gs.length){ out.push({i:s.id, g:"", d, u, e:est, h, q, ...(m ? {m} : {})}); continue; }
    // Varias guías en la misma parada: una fila por guía (los paquetes de más quedan en la última).
    gs.forEach((g,k)=>out.push({i:s.id, g, d, u, e:est, h, q: k===gs.length-1 ? Math.max(1, q-(gs.length-1)) : 1, ...(m ? {m} : {})}));
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
  // Salida a ruta: al abrir el modo conducción o tomar la ubicación de arranque. Solo cuenta si fue antes de la
  // primera entrega y el mismo turno (máx. 8 h antes); si no, la ruta se mide desde la primera entrega.
  const salida = state.salidaAt && state.salidaAt <= t0 && t0 - state.salidaAt < 8*3600000 ? state.salidaAt : null;
  return {
    id: state.dayId || nuevaJornadaId(t0), fecha: ymd(t0), salida,
    duracionRutaMin: Math.round((t1 - (salida || t0))/60000),
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
/* ---- Ritmo del día ----
   Con 2 o más entregas: minutos por parada (de la primera a la última entrega), paquetes por hora y hora estimada
   de terminar = última entrega + paradas que faltan × minutos por parada. Antes de la segunda entrega, si la ruta
   se calculó con calles reales, se estima con el tiempo de manejo + 5 min por parada. */
const SERVICE_MIN = 5;
function dayPace(){
  const done = state.stops.filter(s=>s.status==="done" && s.doneAt).sort((a,b)=>a.doneAt-b.doneAt);
  const rem = state.stops.filter(s=>s.status!=="done" && !s.example).length;
  const out = {done: done.length, rem, paq: done.reduce((a,s)=>a+(s.qty||1),0), perStop:null, perHour:null, eta:null, aprox:false};
  if(done.length >= 2){
    const t0 = done[0].doneAt, t1 = done[done.length-1].doneAt, h = (t1-t0)/3600000;
    if(h >= 5/60){
      out.perStop = (t1-t0)/60000/(done.length-1);
      out.perHour = (out.paq - (done[0].qty||1)) / h;
      if(rem) out.eta = Math.max(Date.now(), t1) + rem*out.perStop*60000;
    }
  } else if(rem && state.route && state.route.mode==="real" && state.route.min){
    out.eta = Date.now() + (state.route.min + rem*SERVICE_MIN)*60000; out.aprox = true;
  }
  return out;
}
const num1 = v => v.toFixed(1).replace(".",",");
function paceText(){
  const p = dayPace();
  if(!p.done && !p.eta) return "";
  const parts = [];
  if(p.paq) parts.push(`hoy ${p.paq} ${p.paq===1?"pedido":"pedidos"} = ${cop(p.paq*tarifa())}`);
  if(p.perHour!=null) parts.push(`${num1(p.perHour)} pedidos/hora`);
  if(p.perStop!=null) parts.push(`${Math.round(p.perStop)} min por parada`);
  if(p.eta) parts.push(`terminas ≈ ${hhmm(p.eta)}${p.aprox ? " (estimado inicial)" : ""}`);
  else if(p.done && !p.rem) parts.push("jornada terminada");
  else if(p.done === 1) parts.push("el ritmo aparece desde la 2.ª entrega");
  return parts.join(" · ");
}
function renderPace(){ const t = paceText(); $("pace").hidden = !t; $("pace").textContent = t ? t.charAt(0).toUpperCase() + t.slice(1) + " ›" : ""; $("pace").title = "Ver acumulado y pagos"; }
setInterval(()=>{ if(document.visibilityState==="visible") renderPace(); }, 60000);
// Paquetes por hora de una jornada del historial (null si fue muy corta para medir).
const dayRate = x => x.minutos >= 20 && x.paquetes > 1 ? x.paquetes / (x.minutos/60) : null;
// Id de una jornada: fecha + hora de la primera entrega. Así dos jornadas del mismo día no se pisan.
const nuevaJornadaId = t0 => ymd(t0) + "-" + Math.round(t0);
// Une el resumen nuevo con lo que ya estaba guardado de esa jornada: los pedidos de paradas que ya no están en la
// lista (se borraron, o se quitaron desde el otro celular) se conservan; los demás se toman como están ahora.
// Así el historial nunca pierde entregas que sí se hicieron.
function unirJornada(prev, sum){
  const hoy = new Set(state.stops.map(s=>s.id)), dirsHoy = new Set(state.stops.map(s=>s.label || s.addr));
  const nuevos = sum ? sum.pedidos : [];
  const clave = p => p.g + "|" + p.d;
  const yaEsta = new Set(nuevos.map(clave));
  // Filas viejas sin id de parada (versiones anteriores): se conservan si esa dirección ya no está en la lista.
  const guardar = (prev && prev.pedidos || []).filter(p=>p.i ? !hoy.has(p.i) : !yaEsta.has(clave(p)) && !dirsHoy.has(p.d));
  if(!guardar.length) return sum;
  return armarJornada({...(sum || prev), id: prev.id}, [...guardar, ...nuevos], prev);
}
// Rehace los totales de una jornada a partir de sus pedidos (al unir o al recuperar desde la nube).
function armarJornada(base, pedidos, prev){
  const ped = pedidos.slice().sort((a,b)=>(a.h||9e15)-(b.h||9e15));
  const ent = ped.filter(p=>p.e==="Entregado"), no = ped.filter(p=>p.e==="No entregado");
  if(!ent.length && !no.length) return null;
  const q = arr => arr.reduce((a,p)=>a+(p.q||1),0), dirs = arr => new Set(arr.map(p=>p.d)).size;
  const horas = [...ent, ...no].map(p=>p.h).filter(Boolean);
  const inicio = Math.min(prev && prev.inicio || 9e15, base.inicio || 9e15, ...horas), fin = Math.max(prev && prev.fin || 0, base.fin || 0, ...horas);
  return {...base, fecha: ymd(inicio), inicio, fin, minutos: Math.round((fin-inicio)/60000),
    duracionRutaMin: Math.round((fin - (base.salida && base.salida <= inicio ? base.salida : inicio))/60000),
    entregas: dirs(ent), paquetes: q(ent), noEntregadas: dirs(no), paqNoEntregados: q(no), pendientes: base.pendientes || 0,
    promEntreEntregas: ent.length > 1 ? Math.round((fin-inicio)/60000/(ent.length-1)) : null, pedidos: ped};
}
// Agrega al historial pedidos entregados (o no entregados) que no estén en él, agrupados por fecha. Devuelve cuántos agregó.
// Se usa para recuperar desde la nube lo que se perdió del historial de este celular (ver js/11-equipo.js).
function agregarAlHistorial(paradas){
  let h = histLoad(), n = 0;
  const porFecha = new Map();
  for(const p of pedidosDe(paradas)){ if(!p.h) continue; const f = ymd(p.h); if(!porFecha.has(f)) porFecha.set(f, []); porFecha.get(f).push(p); }
  for(const [f, filas] of porFecha){
    const delDia = h.filter(x=>(x.fecha || ymd(x.inicio)) === f);
    const ids = new Set(delDia.flatMap(x=>(x.pedidos||[]).map(p=>p.i).filter(Boolean)));
    const claves = new Set(delDia.flatMap(x=>(x.pedidos||[]).map(p=>p.g + "|" + p.d)));
    const faltan = filas.filter(p=>!ids.has(p.i) && !claves.has(p.g + "|" + p.d));
    if(!faltan.length) continue;
    const dest = delDia.sort((a,b)=>b.inicio-a.inicio)[0];
    const x = dest ? armarJornada(dest, [...(dest.pedidos||[]), ...faltan], dest)
                   : armarJornada({id: f + "-nube", fecha: f, salida: null, recuperada: true}, faltan, null);
    if(!x) continue;
    h = h.filter(y=>y.id!==x.id); h.push(x); acumPut(x); n += faltan.length;
  }
  if(n){ h.sort((a,b)=>a.inicio-b.inicio); store.set(HIST_KEY, h); }
  return n;
}
// Guarda (o actualiza) el resumen del día en curso. Se llama al entregar, al marcar «No estaba» y al empezar una jornada nueva.
function recordDay(){
  try{
    let sum = daySummary();
    let h = histLoad();
    // Jornada vieja que quedó abierta (p. ej. se vació la lista desde el otro celular y no se tocó «Jornada nueva»):
    // si nada de lo que hay ahora está en ella y su última entrega fue hace más de 8 h, se empieza otra.
    if(state.dayId && sum){
      const prev = h.find(x=>x.id===state.dayId);
      const ids = new Set(sum.pedidos.map(p=>p.i));
      if(prev && !(prev.pedidos||[]).some(p=>ids.has(p.i)) && sum.inicio - (prev.fin||0) > 8*3600000){
        state.dayId = null; sum = daySummary();
      }
    }
    const id = state.dayId || (sum && sum.id);
    if(!id) return;
    const prev = h.find(x=>x.id===id);
    if(prev) sum = unirJornada(prev, sum);
    if(!sum){
      // Se deshicieron todas las entregas del día: el acumulado de hoy vuelve a cero (y el historial no lo guarda).
      const a = acumLoad(); if(a[id]){ delete a[id]; store.set(ACUM_KEY, a); }
      store.set(HIST_KEY, h.filter(x=>x.id!==id));
      return;
    }
    if(!state.dayId) state.dayId = sum.id;
    h = h.filter(x=>x.id!==sum.id);
    h.push(sum);
    const limit = Date.now() - HIST_DAYS*864e5;
    h = h.filter(x=>x.inicio >= limit).sort((a,b)=>a.inicio-b.inicio).slice(-150);
    store.set(HIST_KEY, h);
    acumPut(sum);
  }catch(e){ console.warn("historial", e); }
}
function fmtDate(t){ return new Date(t).toLocaleDateString("es-CO",{weekday:"short", day:"numeric", month:"short"}); }
function histTotals(h, days){
  const from = Date.now() - days*864e5, sel = h.filter(x=>x.inicio>=from);
  const e = sel.reduce((a,x)=>a+x.entregas,0), f = sel.reduce((a,x)=>a+x.noEntregadas,0), pq = sel.reduce((a,x)=>a+x.paquetes,0);
  const mins = sel.reduce((a,x)=>a+(x.minutos||0),0), ahorro = sel.reduce((a,x)=>a+(x.ahorroKm||0),0);
  const pf = sel.reduce((a,x)=>a+(x.paqNoEntregados||0),0);
  return {n:sel.length, e, f, pq, efect: pq+pf ? Math.round(100*pq/(pq+pf)) : null, porHora: mins>0 ? (pq/(mins/60)).toFixed(1).replace(".",",") : null, ahorro};
}
function renderHist(){
  const nube = document.getElementById("histNube"); if(nube) nube.hidden = !(typeof syncOn === "function" && syncOn());
  const h = histLoad().slice().reverse();
  const t7 = histTotals(h,7), t30 = histTotals(h,30);
  const line = (lbl,t) => t.n ? `<div><b>${lbl}:</b> ${t.n} jornada(s) · ${t.pq} pedidos entregados${t.efect!=null?` · efectividad ${t.efect} %`:""}${t.porHora?` · ${t.porHora} pedidos por hora`:""}${t.ahorro>0?` · ahorro estimado ${fmtKm(t.ahorro)}`:""}</div>` : `<div><b>${lbl}:</b> sin jornadas</div>`;
  $("histTotals").innerHTML = line("Últimos 7 días", t7) + line("Últimos 30 días", t30);
  // Comparar días: barras de paquetes por hora de las últimas 14 jornadas, con el mejor día y el promedio.
  const rated = h.slice(0,14).reverse().filter(x=>dayRate(x)!=null);
  if(rated.length >= 2){
    const max = Math.max(...rated.map(dayRate)), avg = rated.reduce((a,x)=>a+dayRate(x),0)/rated.length;
    const best = rated.find(x=>dayRate(x)===max);
    $("histChart").innerHTML = rated.map(x=>`<div title="${esc(fmtDate(x.inicio))}: ${num1(dayRate(x))} pedidos/hora"><b>${num1(dayRate(x))}</b><i style="height:${Math.round(70*dayRate(x)/max)}%"></i><span>${new Date(x.inicio).getDate()}/${new Date(x.inicio).getMonth()+1}</span></div>`).join("");
    $("histTotals").innerHTML += `<div><b>Pedidos por hora:</b> promedio ${num1(avg)} · mejor día ${esc(fmtDate(best.inicio))} (${num1(max)})</div>`;
  } else $("histChart").innerHTML = "";
  $("histList").innerHTML = h.length ? h.map(x=>`<div class="hrow">
      <b>${esc(fmtDate(x.inicio))}</b>
      <span>${x.paquetes} ${x.paquetes===1?"pedido entregado":"pedidos entregados"}${x.paqNoEntregados?` · ${x.paqNoEntregados} no ${x.paqNoEntregados===1?"entregado":"entregados"}`:""}${x.pendientes?` · ${x.pendientes} ${x.pendientes===1?"dirección pendiente":"direcciones pendientes"}`:""}</span>
      <span>${hhmm(x.inicio)} a ${hhmm(x.fin)} · ${Math.floor(x.minutos/60)} h ${x.minutos%60} min${x.promEntreEntregas?` · ${x.promEntreEntregas} min entre entregas`:""}${dayRate(x)!=null?` · ${num1(dayRate(x))} pedidos/hora`:""}</span>
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
const fechaLarga = t => new Date(t).toLocaleDateString("es-CO",{year:"numeric", month:"2-digit", day:"2-digit"});
// Duración en formato h:mm (para Excel).
const hmm = min => min==null || isNaN(min) ? "" : `${Math.floor(min/60)}:${String(Math.round(min%60)).padStart(2,"0")}`;
const rutaMin = x => x.duracionRutaMin != null ? x.duracionRutaMin : x.minutos;   // jornadas viejas: primera → última entrega
// Nombre de hoja por jornada: la fecha (si hay dos jornadas el mismo día, la segunda queda «(2)»).
const hojaFecha = t => fechaLarga(t).replace(/\//g, "-");
/* ---- Excel de jornadas (v2.49: presentación de empresa y división por quincena) ----
   Quincenas de pago: del 2 al 16 se paga el 17; del 17 al 1 del mes siguiente se paga el 2.
   Todo en pesos con formato «$ 1.600»; cada día conserva el valor por pedido que tenía. */
const DIAS_SEM = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];
const MES_CORTO = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
const fechaDe = f => new Date(f + "T12:00:00");                          // "AAAA-MM-DD" → fecha (mediodía, sin líos de zona)
const dmy = f => f.slice(8,10) + "/" + f.slice(5,7) + "/" + f.slice(0,4);
// Quincenas (decisión de Camilo): del 2 al 16 (se paga el 17) y del 17 al 1 del mes siguiente (se paga el 2).
// Clave «AAAA-MM-1» = 2 al 16 de ese mes; «AAAA-MM-2» = 17 de ese mes al 1 del siguiente. El día 1 es del mes anterior.
function quincenaDe(f){                                               // f: "AAAA-MM-DD"
  let y = +f.slice(0,4), m = +f.slice(5,7);
  const d = +f.slice(8,10);
  if(d === 1){ m--; if(m === 0){ m = 12; y--; } }
  const q = d >= 2 && d <= 16 ? 1 : 2, mm = String(m).padStart(2,"0");
  const sig = new Date(y, m, 1);                                       // primer día del mes siguiente
  const ini = `${y}-${mm}-${q === 1 ? "02" : "17"}`, fin = q === 1 ? `${y}-${mm}-16` : ymd(sig);
  const pago = q === 1 ? `${y}-${mm}-17` : ymd(new Date(y, m, 2));
  const cruza = sig.getFullYear() !== y;
  const nombre = q === 1 ? `2–16 ${MES_CORTO[m-1]} ${y}`
    : cruza ? `17 ${MES_CORTO[m-1]} ${y} – 1 ${MES_CORTO[sig.getMonth()]} ${sig.getFullYear()}` : `17 ${MES_CORTO[m-1]} – 1 ${MES_CORTO[sig.getMonth()]} ${y}`;
  return {k: `${y}-${mm}-${q}`, q, ini, fin, pago, nombre};
}
const quincenaTxt = qz => `${qz.nombre} · se paga el ${dmy(qz.pago)}`;
const repartidor = () => (window.RUTA_USER && window.RUTA_USER.name) || (typeof USER !== "undefined" && USER.name) || "";
const generado = () => { const d = new Date(); return `${dmy(ymd(d))} ${hhmm(d.getTime())}`; };
// Hoja con encabezado + tabla (js/15-excel.js).
const hojaPro = (...a) => xlHojaPro(...a);   // 15-excel.js carga después
const efect = (e, n) => e + n ? Math.round(100 * e / (e + n)) / 100 : "";
const tot = v => ({v, s: typeof v === "number" ? "totnum" : "tot"}), totCop = v => ({v: Math.round(v||0), s:"totcop"});
const cop$ = v => ({v: Math.round(v||0), s:"cop"}), pct = v => v === "" ? "" : {v, s:"pct"}, centro = v => v === "" || v == null ? "" : {v, s:"centro"};
const subTxt = v => ({v, s:"sec"}), subNum = v => ({v, s:"secnum"}), subCop = v => ({v: Math.round(v||0), s:"seccop"});
const diaSem = f => DIAS_SEM[fechaDe(f).getDay()];
// Datos de una jornada para las tablas.
function datosJornada(x){
  const f = ymd(x.inicio), vp = valorDia(x.id);
  const peds = x.pedidos && x.pedidos.length ? x.pedidos : null;
  let ent = 0, no = 0, pend = 0, dev = 0;
  if(peds) for(const pd of peds){ const q = pd.q||1; if(pd.e === "Entregado") ent += q; else if(pd.e === "No entregado"){ no += q; if(estadoPed(pd) === "Devolución") dev += q; } else pend += q; }
  else ent = x.paquetes||0;
  const min = rutaMin(x)||0;
  return {x, f, vp, peds, ent, no, dev, pend, min, val: ent*vp, porHora: min > 0 ? Math.round(10*ent/(min/60))/10 : ""};
}

// Hoja «Resumen» (y la de cada mes): una fila por jornada, con subtotal de cada quincena y total.
const RES_TIT = ["Fecha","Día","Salida a ruta","Primera entrega","Última entrega","Duración (h:mm)","Pedidos entregados","No entregados","Pendientes","Efectividad","Pedidos por hora","Valor por pedido","Valor del día"];
const RES_ANCHOS = [12,11,11,11,11,11,11,11,10,11,10,12,14];
function filasResumen(js){
  const cuerpo = []; let grupo = null, acc = null;
  const cerrar = ()=>{ if(!grupo) return;
    cuerpo.push([subTxt("Subtotal quincena " + quincenaTxt(grupo)), subTxt(""), subTxt(""), subTxt(""), subTxt(""), subTxt(acc.dias + " día(s)"),
      subNum(acc.ent), subNum(acc.no), subNum(acc.pend), {v: efect(acc.ent, acc.no), s:"secpct"}, subTxt(""), subTxt(""), subCop(acc.val)]); };
  for(const d of js){
    const qz = quincenaDe(d.f);
    if(!grupo || grupo.k !== qz.k){ cerrar(); grupo = qz; acc = {dias:0, ent:0, no:0, pend:0, val:0}; }
    acc.dias++; acc.ent += d.ent; acc.no += d.no; acc.pend += d.pend; acc.val += d.val;
    cuerpo.push([centro(dmy(d.f)), diaSem(d.f), centro(d.x.salida ? hhmm(d.x.salida) : ""), centro(hhmm(d.x.inicio)), centro(hhmm(d.x.fin)), centro(hmm(d.min)),
      d.ent, d.no, d.pend, pct(efect(d.ent, d.no)), d.porHora, cop$(d.vp), cop$(d.val)]);
  }
  cerrar();
  const s = k => js.reduce((a, d)=>a + d[k], 0), e = s("ent"), n = s("no");
  const total = [tot("TOTAL"), tot(js.length + " jornada(s)"), tot(""), tot(""), tot(""), tot(hmm(s("min"))), tot(e), tot(n), tot(s("pend")),
    {v: efect(e, n), s:"totpct"}, tot(""), tot(""), totCop(s("val"))];
  return {cuerpo, total};
}
function hojaResumen(nombre, titulo, js, extra){
  const r = filasResumen(js);
  const desde = js.length ? dmy(js[0].f) : "", hasta = js.length ? dmy(js[js.length-1].f) : "";
  return hojaPro(nombre, titulo, [repartidor() && "Repartidor: " + repartidor(), `Periodo: ${desde} a ${hasta} · ${js.length} jornada(s)`,
    "Valor = pedidos entregados × valor por pedido del día. Los no entregados no se pagan. Quincenas: del 2 al 16 se paga el 17; del 17 al 1 se paga el 2.",
    extra, "Generado: " + generado()], RES_TIT, r.cuerpo, r.total, RES_ANCHOS);
}

// Hoja «Quincenas»: lo que se lleva en cada quincena de pago. Sirve con el historial (js) o con el acumulado (dias).
const QZ_TIT = ["Quincena","Desde","Hasta","Fecha de pago","Estado","Días trabajados","Pedidos entregados","No entregados","Efectividad","Valor a pagar"];
const QZ_ANCHOS = [26,11,11,13,12,11,12,11,11,15];
function hojaQuincenas(dias){                                           // dias: [{f, ent, no, val}]
  const hoy = ymd(Date.now()), g = new Map();
  for(const d of dias){ const qz = quincenaDe(d.f); if(!g.has(qz.k)) g.set(qz.k, {qz, dias:0, ent:0, no:0, val:0}); const a = g.get(qz.k); if(d.ent > 0 || d.no > 0) a.dias++; a.ent += d.ent; a.no += d.no; a.val += d.val; }
  const lista = [...g.values()].sort((a, b)=>a.qz.k < b.qz.k ? 1 : -1);   // la más reciente primero
  const estado = qz => hoy <= qz.fin ? "En curso" : hoy < qz.pago ? "Por pagar" : "Cumplida";
  const cuerpo = lista.map(a=>[a.qz.nombre, centro(dmy(a.qz.ini)), centro(dmy(a.qz.fin)), centro(dmy(a.qz.pago)), centro(estado(a.qz)), a.dias, a.ent, a.no, pct(efect(a.ent, a.no)), cop$(a.val)]);
  const s = k => lista.reduce((x, a)=>x + a[k], 0);
  const total = [tot("TOTAL"), tot(""), tot(""), tot(""), tot(lista.length + " quincena(s)"), tot(s("dias")), tot(s("ent")), tot(s("no")),
    {v: efect(s("ent"), s("no")), s:"totpct"}, totCop(s("val"))];
  const actual = quincenaDe(hoy);
  return hojaPro("Quincenas", "Pedidos por quincena de pago", [repartidor() && "Repartidor: " + repartidor(),
    "Del 2 al 16 se paga el 17 · del 17 al 1 del mes siguiente se paga el 2.",
    `Quincena actual: ${quincenaTxt(actual)}.`, "«Estado»: en curso (aún se trabaja), por pagar (cerrada, falta la fecha de pago) o cumplida (ya pasó la fecha de pago).",
    "Generado: " + generado()], QZ_TIT, cuerpo, total, QZ_ANCHOS);
}

// Hoja de una jornada: pedido por pedido en el orden en que se entregó, con acumulado y total del día.
const PED_TIT = ["#","Hora","Guía (número de pedido)","Dirección","Inmueble","Estado","Motivo","Paquetes","Acumulado entregados","Tiempo desde la salida (h:mm)","Valor ($)","Valor acumulado ($)"];
const PED_ANCHOS = [5,9,22,30,18,13,26,9,11,12,12,13];
function hojaJornada(d){
  const x = d.x, ini = x.salida || x.inicio, qz = quincenaDe(d.f);
  const cuerpo = []; let acum = 0;
  if(d.peds) d.peds.forEach((pd, i)=>{
    const q = pd.q||1, ok = pd.e === "Entregado"; if(ok) acum += q;
    cuerpo.push([centro(i+1), centro(pd.h ? hhmm(pd.h) : ""), pd.g || "(sin guía)", pd.d||"", pd.u||"", centro(estadoPed(pd)), pd.m||"", q,
      ok ? acum : "", centro(pd.h ? hmm((pd.h - ini)/60000) : ""), ok ? cop$(q*d.vp) : "", ok ? cop$(acum*d.vp) : ""]);
  });
  else cuerpo.push(["", "", "(jornada sin detalle por pedido)", "", "", "", "", d.ent, d.ent, "", cop$(d.val), cop$(d.val)]);
  const total = [tot(""), tot(""), tot("TOTAL DEL DÍA"), tot(`${d.ent} entregado(s) de ${d.ent + d.no + d.pend}${d.no ? ` · ${d.no} no entregado(s)` : ""}${d.pend ? ` · ${d.pend} pendiente(s)` : ""}`),
    tot(""), tot(""), tot(""), tot(d.ent + d.no + d.pend), tot(d.ent), tot(hmm(d.min)), totCop(d.val), totCop(d.val)];
  const fl = diaSem(d.f); 
  return hojaPro(hojaFecha(x.inicio), `Jornada del ${fl} ${dmy(d.f)}`, [repartidor() && "Repartidor: " + repartidor(),
    `Salida a ruta ${x.salida ? hhmm(x.salida) : "—"} · primera entrega ${hhmm(x.inicio)} · última entrega ${hhmm(x.fin)} · duración ${hmm(d.min) || "—"}`,
    `Pedidos entregados ${d.ent} · no entregados ${d.no}${d.dev ? ` (${d.dev} devolución(es))` : ""}${d.pend ? ` · pendientes ${d.pend}` : ""} · efectividad ${d.ent + d.no ? Math.round(100*d.ent/(d.ent+d.no)) + " %" : "—"} · valor del día ${cop(d.val)} (${cop(d.vp)} por pedido)`,
    "Quincena " + quincenaTxt(qz)], PED_TIT, cuerpo, total, PED_ANCHOS);
}
// Hoja «Todos los pedidos»: una fila por pedido, con fecha y quincena para filtrar.
const TODOS_TIT = ["Fecha","Quincena","Hora","Guía (número de pedido)","Dirección","Inmueble","Estado","Motivo","Paquetes","Valor ($)"];
// «Devolución» se muestra aparte de «No entregado» (las dos cuentan como no entregadas y no se pagan).
const estadoPed = pd => pd.e === "No entregado" && pd.m && pd.m.startsWith("Devolución") ? "Devolución" : pd.e;
function hojaTodos(js){
  const cuerpo = []; let e = 0, n = 0, v = 0;
  for(const d of js){
    const qz = quincenaDe(d.f).nombre;
    if(d.peds) for(const pd of d.peds){ const q = pd.q||1, ok = pd.e === "Entregado"; if(ok){ e += q; v += q*d.vp; } else if(pd.e === "No entregado") n += q;
      cuerpo.push([centro(dmy(d.f)), qz, centro(pd.h ? hhmm(pd.h) : ""), pd.g || "(sin guía)", pd.d||"", pd.u||"", centro(estadoPed(pd)), pd.m||"", q, ok ? cop$(q*d.vp) : ""]); }
    else { e += d.ent; v += d.val; cuerpo.push([centro(dmy(d.f)), qz, "", "(jornada sin detalle por pedido)", "", "", centro("Entregado"), "", d.ent, cop$(d.val)]); }
  }
  const total = [tot("TOTAL"), tot(js.length + " jornada(s)"), tot(""), tot(`${e} entregado(s)${n ? ` · ${n} no entregado(s)` : ""}`), tot(""), tot(""), tot(""), tot(""), tot(e + n), totCop(v)];
  return hojaPro("Todos los pedidos", "Todos los pedidos", [repartidor() && "Repartidor: " + repartidor(),
    "Use los filtros del encabezado para ver una fecha, una quincena o un estado.", "Generado: " + generado()], TODOS_TIT, cuerpo, total, [12,20,9,22,30,18,13,26,9,12]);
}
// Hoja «Datos de la ruta»: las cifras técnicas de cada jornada (antes estaban mezcladas con el resumen).
const TEC_COLS = [["entregas","Direcciones entregadas"],["noEntregadas","Direcciones no entregadas"],["minutos","Minutos (1.ª a última entrega)"],["promEntreEntregas","Min. entre entregas"],
  ["kmEstimados","Km estimados"],["manejoEstMin","Manejo estimado (min)"],["realMin","Tiempo real (min)"],["minPorParada","Min. extra por parada"],["ahorroKm","Ahorro km"],["ahorroMin","Ahorro min"],["callesReales","Calles reales"]];
function hojaTecnica(js){
  const cuerpo = js.map(d=>[centro(dmy(d.f)), ...TEC_COLS.map(([k])=>{ const v = d.x[k]; if(v == null) return ""; if(typeof v === "boolean") return centro(v ? "Sí" : "No"); return typeof v === "number" ? Math.round(v*100)/100 : String(v); })]);
  return hojaPro("Datos de la ruta", "Datos de la ruta por jornada", ["Cifras de apoyo del cálculo de la ruta (distancias y tiempos estimados). No afectan el pago.", "Generado: " + generado()],
    ["Fecha", ...TEC_COLS.map(c=>c[1])], cuerpo, null, [12, ...TEC_COLS.map(()=>12)]);
}
const jornadasDatos = () => histLoad().slice().sort((a, b)=>a.inicio - b.inicio).map(datosJornada);
// Excel por pedido: Resumen (con quincenas), Quincenas, Todos los pedidos y una hoja por jornada.
function excelPedidos(){
  const js = jornadasDatos();
  descargarXlsx([hojaResumen("Resumen", "Resumen de jornadas", js), hojaQuincenas(js.map(d=>({f: d.f, ent: d.ent, no: d.no, val: d.val}))), hojaTodos(js), ...js.map(hojaJornada)],
    "pedidos-por-jornada-" + ymd(Date.now()) + ".xlsx");
  toast(`Excel descargado: Resumen, Quincenas, Todos los pedidos y ${js.length} hoja(s), una por día.`);
}
// Excel resumen: Resumen (con quincenas), Quincenas, una hoja por mes y Datos de la ruta.
function excelResumen(){
  const js = jornadasDatos();
  const meses = [...new Set(js.map(d=>d.f.slice(0,7)))].sort();
  const hojasMes = meses.map(m=>hojaResumen(nombreMes(m), "Jornadas de " + nombreMes(m), js.filter(d=>d.f.startsWith(m))));
  descargarXlsx([hojaResumen("Resumen", "Resumen de jornadas", js), hojaQuincenas(js.map(d=>({f: d.f, ent: d.ent, no: d.no, val: d.val}))), ...hojasMes, hojaTecnica(js)],
    "resumen-jornadas-" + ymd(Date.now()) + ".xlsx");
  toast(`Excel resumen descargado: Resumen, Quincenas, ${hojasMes.length} hoja(s) por mes y Datos de la ruta.`);
}

/* ---- Acumulado general y pagos ----
   Valor = paquetes entregados × valor por paquete (por defecto $1.600). Los no entregados no suman.
   Se guarda un resumen por día que NO se borra con el historial (90 días): {fecha: {p paquetes, e paradas, n no entregados, t valor por paquete}}.
   Cada día conserva el valor por paquete que tenía; si se cambia, aplica desde hoy. */
const ACUM_KEY = "rutaEntregas.u." + USER.id + ".acum.v1", TARIFA_DEF = 1600;
const tarifa = ()=>{ const v = Number(state.tarifa); return Number.isFinite(v) && v >= 0 && state.tarifa !== "" && state.tarifa != null ? v : TARIFA_DEF; };
const cop = v => "$ " + Math.round(v||0).toLocaleString("es-CO");
const acumLoad = ()=>store.get(ACUM_KEY) || {};
function acumPut(x){
  const a = acumLoad(), prev = a[x.id];
  a[x.id] = {f: ymd(x.inicio), p: x.paquetes||0, e: x.entregas||0, n: x.paqNoEntregados||0, t: prev && prev.t != null ? prev.t : tarifa()};
  store.set(ACUM_KEY, a);
}
const valorDia = id => { const d = acumLoad()[id]; return d && d.t != null ? d.t : tarifa(); };
// Primera vez: se pasan al acumulado las jornadas que ya estaban en el historial.
(function(){ const a = acumLoad(); let n = 0; for(const x of histLoad()) if(!a[x.id] && x.inicio){ a[x.id] = {f: ymd(x.inicio), p: x.paquetes||0, e: x.entregas||0, n: x.paqNoEntregados||0, t: tarifa()}; n++; } if(n) store.set(ACUM_KEY, a); })();
function acumSum(filter){
  return Object.values(acumLoad()).filter(filter).reduce((s,d)=>({p: s.p+d.p, e: s.e+d.e, n: s.n+(d.n||0), v: s.v + d.p*(d.t ?? tarifa()), dias: s.dias + (d.p>0 ? 1 : 0)}), {p:0, e:0, n:0, v:0, dias:0});
}
function acumPeriodos(){
  const now = new Date(), hoy = ymd(now);
  const lunes = new Date(now); lunes.setHours(0,0,0,0); lunes.setDate(lunes.getDate() - ((lunes.getDay()+6)%7));
  const semana = ymd(lunes), mes = hoy.slice(0,7), mesAnt = ymd(new Date(now.getFullYear(), now.getMonth()-1, 1)).slice(0,7);
  // v2.49: quincenas de pago (2–16 se paga el 17; 17–1 se paga el 2).
  const qa = quincenaDe(hoy), qp = quincenaDe(ymd(fechaDe(qa.ini).getTime() - 864e5));
  return [["Hoy", acumSum(d=>d.f===hoy)], ["Esta semana", acumSum(d=>d.f>=semana)],
          ["Esta quincena", acumSum(d=>d.f>=qa.ini && d.f<=qa.fin), `${qa.nombre} · pago ${dmy(qa.pago)}`],
          ["Quincena anterior", acumSum(d=>d.f>=qp.ini && d.f<=qp.fin), `${qp.nombre} · pago ${dmy(qp.pago)}`],
          ["Este mes", acumSum(d=>d.f.startsWith(mes))],
          ["Mes anterior", acumSum(d=>d.f.startsWith(mesAnt))], ["Total general", acumSum(()=>true)]];
}
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const nombreMes = ym => MESES[+ym.slice(5,7)-1] + " " + ym.slice(0,4);
function acumMeses(){
  const ms = [...new Set(Object.values(acumLoad()).map(d=>d.f.slice(0,7)))].sort().reverse();
  return ms.map(m=>[m, acumSum(d=>d.f.startsWith(m))]);
}
// Quincenas con entregas (la más reciente primero): [quincena, suma].
function acumQuincenas(){
  const ks = new Map(); for(const d of Object.values(acumLoad())){ const qz = quincenaDe(d.f); ks.set(qz.k, qz); }
  return [...ks.values()].sort((a, b)=>a.k < b.k ? 1 : -1).map(qz=>[qz, acumSum(d=>d.f>=qz.ini && d.f<=qz.fin)]);
}
function renderPay(){
  if(document.activeElement !== $("pyRate")) $("pyRate").value = tarifa();
  $("pyFormula").textContent = `Valor = pedidos entregados × ${cop(tarifa())}. Cada pedido cuenta por separado, aunque vayan varios a la misma dirección. Los no entregados no suman. Cada día guarda el valor por pedido que tenía ese día.`;
  const head = `<div class="pr" role="row"><span>Periodo</span><span>Entregados</span><span>No entreg.</span><span>Valor</span></div>`;
  const row = (lbl, s, tot, sub) => `<div class="pr${tot ? " tot" : ""}" role="row"><span>${esc(lbl)}${sub ? `<small>${esc(sub)}</small>` : ""}</span><span>${s.p}</span><span>${s.n}</span><span><b>${cop(s.v)}</b></span></div>`;
  const per = acumPeriodos();
  $("pyTable").innerHTML = head + per.map(([l,s,sub],i)=>row(l, s, i===per.length-1, sub)).join("");
  const qs = acumQuincenas().slice(0, 8);
  $("pyQuin").innerHTML = qs.length ? head.replace("Periodo","Quincena") + qs.map(([qz,s])=>row(qz.nombre, s, false, `pago ${dmy(qz.pago)} · ${s.dias} día(s)`)).join("") : `<div class="pr"><span>Aún no hay entregas.</span></div>`;
  const ms = acumMeses();
  $("pyMonths").innerHTML = ms.length ? head.replace("Periodo","Mes") + ms.map(([m,s])=>row(nombreMes(m) + ` · ${s.dias} día(s)`, s)).join("") : `<div class="pr"><span>Aún no hay entregas.</span></div>`;
  const dias = Object.values(acumLoad()).map(d=>d.f).sort();
  $("pyInfo").textContent = dias.length ? `Acumulado desde el ${fechaLarga(new Date(dias[0]+"T12:00:00").getTime())}. Cuenta pedidos (cada guía o paquete), no direcciones. Este resumen no se borra con el historial y va en el respaldo.` : "";
}
document.getElementById("pyRate").addEventListener("change", e=>{
  const v = Math.round(Number(e.target.value));
  if(!Number.isFinite(v) || v < 0){ e.target.value = tarifa(); return; }
  state.tarifa = v; save();
  // Aplica desde hoy: se actualiza el valor del día en curso (los días anteriores conservan el suyo).
  const a = acumLoad(), hoy = ymd(Date.now()); for(const k in a) if(a[k].f === hoy) a[k].t = v; store.set(ACUM_KEY, a);
  renderPay(); renderPace(); toast(`Valor por paquete: ${cop(v)}. Aplica desde hoy.`);
});
// Excel de pagos (v2.49): hoja «Quincenas» (lo que se paga el 17 y el 2), «Por mes» y una hoja por mes con sus días
// separados por quincena. Sale del acumulado, que no se borra con el historial de 90 días.
document.getElementById("pyCsv").onclick = ()=>{
  const a = Object.values(acumLoad()).sort((x, y)=>x.f < y.f ? -1 : 1);
  const vd = d => d.p * (d.t ?? tarifa());
  const quin = hojaQuincenas(a.map(d=>({f: d.f, ent: d.p, no: d.n||0, val: vd(d)})));
  const meses = acumMeses().reverse();
  const t = acumSum(()=>true);
  const porMes = hojaPro("Por mes", "Pedidos y pagos por mes", [repartidor() && "Repartidor: " + repartidor(), "Generado: " + generado()],
    ["Mes","Días trabajados","Pedidos entregados","Pedidos no entregados","Valor ($)"],
    meses.map(([m,s])=>[nombreMes(m), s.dias, s.p, s.n, cop$(s.v)]),
    [tot("TOTAL"), tot(t.dias), tot(t.p), tot(t.n), totCop(t.v)], [22,12,13,13,15]);
  const hojas = meses.map(([m])=>{
    const dias = a.filter(d=>d.f.startsWith(m)), cuerpo = [];
    for(const k of [...new Set(dias.map(d=>quincenaDe(d.f).k))]){
      const dq = dias.filter(d=>quincenaDe(d.f).k === k);
      const qz = quincenaDe(dq[0].f), parcial = !(qz.ini.startsWith(m) && qz.fin.startsWith(m)) ? " (días de este mes)" : "";
      for(const d of dq) cuerpo.push([centro(dmy(d.f)), diaSem(d.f), d.p, d.n||0, cop$(d.t ?? tarifa()), cop$(vd(d))]);
      cuerpo.push([subTxt("Subtotal quincena " + qz.nombre + parcial), subTxt("Pago " + dmy(qz.pago)), subNum(dq.reduce((x,d)=>x+d.p,0)), subNum(dq.reduce((x,d)=>x+(d.n||0),0)), subTxt(""), subCop(dq.reduce((x,d)=>x+vd(d),0))]);
    }
    const s = acumSum(d=>d.f.startsWith(m));
    return hojaPro(nombreMes(m), "Pagos de " + nombreMes(m), [repartidor() && "Repartidor: " + repartidor(),
      "Del 2 al 16 se paga el 17 · del 17 al 1 del mes siguiente se paga el 2. El día 1 cuenta en la quincena del mes anterior."],
      ["Fecha","Día","Pedidos entregados","Pedidos no entregados","Valor por pedido","Valor"], cuerpo,
      [tot("TOTAL DEL MES"), tot(s.dias + " día(s)"), tot(s.p), tot(s.n), tot(""), totCop(s.v)], [44,15,13,13,14,15]);
  });
  descargarXlsx([quin, porMes, ...hojas], "pagos-quincenas-" + ymd(Date.now()) + ".xlsx");
  toast("Excel de pagos descargado: Quincenas, Por mes y una hoja por cada mes.");
};
const openPay = ()=>{ renderPay(); $("dlgPay").showModal(); };
document.getElementById("btnPay").onclick = openPay;
document.getElementById("pace").onclick = openPay;

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
