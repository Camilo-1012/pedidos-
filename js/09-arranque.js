/* Botones generales, respaldo, actualizaciones, app instalable y arranque. */
"use strict";
/* ============ Botones generales ============ */
$("btnPaste").onclick = ()=>openText("one");
$("btnBulk").onclick = ()=>openText("bulk");
$("btnBulk2").onclick = ()=>openText("bulk");
$("btnManual").onclick = ()=>openEdit({addr:""}, true);
$("btnVoice").onclick = ()=>{ openEdit({addr:""}, true); startDictation(); };
$("btnSort").onclick = optimize;
$("start").addEventListener("change", e=>{ state.start = e.target.value.trim(); if(state.start) state.startGPS = null; save(); optimize(true); });
// Punto de partida por GPS: la posición exacta del celular. Se puede volver a tocar a mitad de ruta para recalcular desde donde se está.
$("btnGps").onclick = ()=>{
  if(!navigator.geolocation){ toast("Este celular no permite usar la ubicación aquí."); return; }
  const btn = $("btnGps"); btn.disabled = true; btn.textContent = "Buscando tu ubicación…";
  navigator.geolocation.getCurrentPosition(pos=>{
    btn.disabled = false; btn.textContent = "Actualizar mi ubicación";
    const {latitude:lat, longitude:lng, accuracy} = pos.coords;
    if(meters({lat,lng},{lat:4.65,lng:-74.1}) > 45000){ toast("Tu ubicación está fuera de Bogotá; no se usó como punto de partida."); return; }
    const gxy = inverseEstimate(lat, lng);
    state.startGPS = {lat, lng, acc:Math.round(accuracy), t:Date.now(), x:gxy?gxy.x:null, y:gxy?gxy.y:null};
    if(!state.salidaAt) state.salidaAt = Date.now();   // salida a ruta (para el Excel)
    state.start = ""; $("start").value = "";
    save(); render();
    toast(accuracy>300 ? "Ubicación tomada, pero poco precisa. Activa el GPS para mejorarla." : "Ubicación tomada. Reordenando la ruta desde aquí…");
    quickOrder();      // se ve de inmediato
    optimize(true);    // y luego se afina con las calles reales
  }, err=>{
    btn.disabled = false; btn.textContent = state.startGPS ? "Actualizar mi ubicación" : "Usar mi ubicación actual";
    toast({1:"No hay permiso de ubicación. Actívalo para esta app en los ajustes del celular.",2:"No se pudo obtener la ubicación. Activa el GPS e intenta de nuevo.",3:"La ubicación tardó demasiado. Intenta de nuevo al aire libre."}[err.code] || "No se pudo obtener la ubicación.");
  }, {enableHighAccuracy:true, timeout:20000, maximumAge:0});
};
$("btnGpsClear").onclick = ()=>{ state.startGPS = null; save(); $("btnGps").textContent = "Usar mi ubicación actual"; quickOrder(); optimize(true); };
$("byZone").addEventListener("change", e=>{ state.byZone = e.target.checked; save(); optimize(true); });
$("roundTrip").addEventListener("change", e=>{ state.roundTrip = e.target.checked; save(); optimize(true); });
$("routeOpts").addEventListener("toggle", ()=>{ if(!!state.optsOpen !== $("routeOpts").open){ state.optsOpen = $("routeOpts").open; save(); } });
$("realRoads").addEventListener("change", e=>{ state.realRoads = e.target.checked; save(); optimize(); });
$("btnMap").onclick = ()=>{ const w=$("mapWrap"); w.hidden=!w.hidden; $("btnMap").textContent = w.hidden?"Ver":"Ocultar"; drawMap(); };
addEventListener("resize", ()=>drawMap());
$("btnNext").onclick = ()=>{
  const s = nextStop();
  if(!s){ toast("No quedan entregas pendientes."); return; }
  const li = document.querySelector(`li[data-id="${s.id}"]`); if(li) li.scrollIntoView({behavior:"smooth",block:"center"});
  openExternal(wazeUrl(s));
};
$("zOn").addEventListener("change", e=>{ state.zone = {...zone(), on:e.target.checked}; save(); render(); optimize(true); });
$("zEntry").addEventListener("change", e=>{ state.zone = {...zone(), entry:parseInt(e.target.value,10)||0}; save(); optimize(true); });
$("zSectors").addEventListener("change", e=>{ state.zone = {...zone(), sectors:e.target.checked}; save(); optimize(true); });
$("zOutLast").addEventListener("change", e=>{ state.zone = {...zone(), outLast:e.target.checked}; save(); optimize(true); });
for(const [id,k] of [["zMinCra","minCra"],["zMaxCra","maxCra"],["zMinCl","minCl"],["zMaxCl","maxCl"]]){
  $(id).addEventListener("change", e=>{ const v = parseInt(e.target.value,10); if(!isNaN(v)){ state.zone = {...zone(), [k]:v, name:"Zona personalizada"}; save(); render(); } });
}
$("btnRestore").onclick = ()=>{ if(state.suggestedIds){ applyOrder(state.suggestedIds); save(); render(); toast("Se restauró el orden sugerido."); } };
$("btnHist").onclick = ()=>{ recordDay(); renderHist(); $("dlgHist").showModal(); };
$("frmHist").addEventListener("submit", e=>{ e.preventDefault(); $("dlgHist").close(); });
$("histCsvPed").onclick = ()=>{ if(!histLoad().length){ toast("Aún no hay jornadas para exportar."); return; } histCsvPedidos(); };
$("histCsv").onclick = ()=>{ if(!histLoad().length){ toast("Aún no hay jornadas para exportar."); return; } histCsv(); };
$("histClear").onclick = ()=>{ $("dlgHist").close(); confirmBox("Borrar historial", "Se borran los resúmenes de todas las jornadas guardadas en este celular.", ()=>{ store.set(HIST_KEY, []); toast("Historial borrado."); }); };
$("btnReport").onclick = ()=>{ $("repText").textContent = dayReport(); $("dlgReport").showModal(); };
$("frmReport").addEventListener("submit", e=>{ e.preventDefault(); $("dlgReport").close(); });
$("repCopy").onclick = async ()=>{ try{ await navigator.clipboard.writeText($("repText").textContent); toast("Reporte copiado."); }catch(e){ toast("No se pudo copiar: mantén presionado el texto para copiarlo."); } };
$("repShare").onclick = async ()=>{
  const text = $("repText").textContent;
  if(navigator.share){ try{ await navigator.share({title:"Reporte del día", text}); return; }catch(e){ if(e.name==="AbortError") return; } }
  openExternal("https://wa.me/?text=" + encodeURIComponent(text));
};
$("autoWaze").addEventListener("change", e=>{ state.autoWaze = e.target.checked; save(); });
function renderLearn(){
  const n = Object.keys(learned).length;
  $("learnOn").checked = state.learnOn !== false;
  geoPermission().then(st=>{
    $("learnInfo").textContent = (n ? (n===1 ? "1 dirección" : `${n} direcciones`) + " con ubicación exacta en este celular. " : "Aún no hay direcciones aprendidas. ")
      + (st === "granted" ? "La próxima vez que llegue una de esas direcciones se ubica exacta, sin depender del mapa."
         : "Para aprender, primero toca «Usar mi ubicación actual» y permite la ubicación.")
      + " Solo se guarda si el GPS tiene buena precisión (±50 m) y estás cerca de la dirección.";
  });
  $("learnClear").hidden = !n;
}
async function renderTiles(){
  if(!window.caches) return;
  try{
    const has = (await caches.keys()).includes("ruta-tiles-v1");
    const n = has ? (await (await caches.open("ruta-tiles-v1")).keys()).length : 0;
    $("tileInfo").textContent = n ? `Mapas guardados para usar sin señal: ${n} cuadros (≈ ${Math.max(1,Math.round(n*20/1024))} MB).` : "El mapa guarda las calles que vas viendo para mostrarlas sin señal.";
    $("tileClear").hidden = !n;
  }catch(e){}
}
$("tileClear").onclick = ()=>confirmBox("Borrar mapas guardados", "El mapa volverá a descargar las calles cuando lo abras con señal.", async ()=>{ await caches.delete("ruta-tiles-v1"); store.set("rutaEntregas.tilesSeen", false); renderTiles(); toast("Mapas guardados borrados."); });
document.querySelector("#learnOn").closest("details").addEventListener("toggle", e=>{ if(e.target.open) renderTiles(); });
$("learnOn").addEventListener("change", e=>{ state.learnOn = e.target.checked; save(); renderLearn(); });
$("learnClear").onclick = ()=>confirmBox("Borrar ubicaciones aprendidas", "Las direcciones se volverán a ubicar con el mapa, como al principio.", ()=>{
  learned = {}; store.set(LEARN_KEY, learned);
  for(const st of state.stops) if(st.geo==="gps"){ st.lat = null; st.lng = null; st.geo = null; }
  save(); render(); renderLearn(); toast("Ubicaciones aprendidas borradas.");
});
$("orsKey").addEventListener("change", e=>{ state.orsKey = e.target.value.trim(); save(); toast(state.orsKey ? "Clave guardada en este celular." : "Clave borrada."); });
$("btnMaps").onclick = ()=>{
  const next = state.stops.filter(s=>s.status!=="done" && s.x!==null).slice(0,9);
  if(!next.length){ toast("No hay paradas ubicadas."); return; }
  const a = document.createElement("a"); a.href = mapsMultiUrl(next); a.target="_blank"; a.rel="noopener"; document.body.appendChild(a); a.click(); a.remove();
};
for(const id of ["vehCarro","vehMoto"]) $(id).addEventListener("change", e=>{
  if(!e.target.checked) return;
  state.vehiculo = e.target.value; save(); render();
  toast(`Tiempos estimados para ${e.target.value === "moto" ? "moto" : "carro"}.`);
  optimize(false);
});
$("routeCard").addEventListener("toggle", e=>{ if(state.rutaOpen !== e.target.open){ state.rutaOpen = e.target.open; save(); } });
$("btnCopy").onclick = async ()=>{
  let n=0;
  const txt = state.stops.filter(s=>s.status!=="done").map(s=>`${++n}. ${s.label||s.addr}${(s.qty||1)>1?" x"+s.qty:""}${" ["+unitText(s," ")+"]"}${s.zone?" (ST "+s.zone+")":""}${s.name?" - "+s.name:""}${s.phone?" - "+s.phone:""}`).join("\n");
  try{ await navigator.clipboard.writeText(txt); toast("Lista copiada."); }
  catch(e){ openText("bulk"); $("txtTitle").textContent="Copia esta lista"; $("txtHint").textContent="Mantén presionado para seleccionar y copiar."; $("txtArea").value=txt; }
};
$("btnClearDone").onclick = ()=>{ state.stops = state.stops.filter(s=>s.status!=="done"); save(); render(); };
$("btnNew").onclick = ()=>{
  if(state.stops.length===0){ toast("Ya estás en una jornada limpia. Toma la primera foto."); return; }
  const pend = state.stops.filter(s=>s.status!=="done").length;
  confirmBox("Empezar jornada nueva",
    (pend ? `Quedan ${pend} paquete(s) sin entregar. ` : "") + "Se guarda el resumen del día en el historial y se borran todos los paquetes de este celular. El punto de partida se conserva." + otroCel(),
    ()=>{ recordDay(); state.dayId=null; state.stops=[]; state.seeded=true; state.lastDoneId=null; state.cmpFirst=null; state.cmpLast=null; state.suggestedIds=null; LASTM=null; state.startGPS=null; state.salidaAt=null; state.loadOn=false; state.loadExtra=[]; save(); render(); window.scrollTo(0,0); toast("Jornada nueva lista. Toma la primera foto."); });
};
// Con el equipo conectado, borrar aquí también borra en el otro celular de la misma cuenta.
const otroCel = ()=> typeof syncOn === "function" && syncOn() ? " Como estás conectado al equipo, también se quitan del otro celular con tu misma cuenta." : "";
$("btnClearAll").onclick = ()=>confirmBox("Borrar toda la jornada","Se eliminan todos los paquetes y sus datos de este celular." + otroCel(),()=>{ state.stops=[]; state.lastDoneId=null; save(); render(); toast("Jornada borrada."); });

/* ============ Respaldo (archivo en el celular) ============ */
// Formato 2: {app, v:2, fecha, state, hist}. Lleva la jornada, los ajustes y el historial (resúmenes por pedido, sin nombres).
// Los respaldos viejos (solo la jornada) se siguen pudiendo restaurar.
$("btnBackup").onclick = ()=>{
  const data = {app:"ruta-entregas", v:2, fecha:new Date().toISOString(), state, hist: histLoad(), acum: acumLoad()};
  const blob = new Blob([JSON.stringify(data,null,1)],{type:"application/json"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = "ruta-" + new Date().toISOString().slice(0,10) + ".json";
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  toast(`Respaldo guardado en Descargas (jornada + ${data.hist.length} día(s) de historial). Contiene datos de clientes: bórralo cuando no lo necesites.`);
};
// Junta dos historiales sin duplicar días: si un día está en ambos, queda el que tenga la última entrega más tarde.
function mergeHist(cur, inc){
  const m = new Map(cur.map(x=>[x.id, x]));
  for(const x of inc){
    if(!x || !x.id || typeof x.inicio !== "number") continue;
    const y = m.get(x.id);
    if(!y || (x.fin||0) > (y.fin||0)) m.set(x.id, x);
  }
  const limit = Date.now() - HIST_DAYS*864e5;
  return [...m.values()].filter(x=>x.inicio >= limit).sort((a,b)=>a.inicio-b.inicio).slice(-150);
}
$("restoreFile").addEventListener("change", async e=>{
  const f = e.target.files && e.target.files[0]; e.target.value=""; if(!f) return;
  try{
    const d = JSON.parse(await f.text());
    const st = d && d.v === 2 ? d.state : d;
    if(!st || !Array.isArray(st.stops)) throw new Error("formato");
    const stops = st.stops.filter(s=>s && typeof s.addr==="string").map(s=>({...mkStop(s), ...s}));
    const hist = d && d.v === 2 && Array.isArray(d.hist) ? d.hist : [];
    const cur = histLoad(), merged = mergeHist(cur, hist), nuevos = merged.length - cur.length;
    confirmBox("Restaurar respaldo",
      `Se reemplaza la lista actual por ${stops.length} parada(s) del archivo` + (hist.length ? ` y se juntan ${hist.length} día(s) de historial con los que ya tienes (${Math.max(0,nuevos)} nuevo(s); los de más de ${HIST_DAYS} días no se guardan).` : ". Este respaldo no trae historial."),
      ()=>{
        state = {...st, stops, seeded:true, driveOn:false};
        save();
        if(hist.length) store.set(HIST_KEY, merged);
        // Acumulado general: se agregan los días que no estén (los que ya están se conservan).
        if(d && d.acum && typeof d.acum === "object"){ const a = acumLoad(); for(const k in d.acum){ const x = d.acum[k]; if(!a[k] && x && typeof x.f === "string") a[k] = x; } store.set(ACUM_KEY, a); }
        render(); toast("Respaldo restaurado.");
      });
  }catch(err){ toast("Ese archivo no es un respaldo válido de la app."); }
});

/* ============ App instalable y sin conexión ============ */
// Al bloquear: apaga la cámara y cierra ventanas abiertas para que no queden datos a la vista.
window.RUTA_onLock = ()=>{ try{ stopScan(); }catch(e){} };
const APP_VERSION = "2.11.3";
$("ver").textContent = "Versión " + APP_VERSION + ". Funciona sin internet una vez abierta la primera vez.";
if(navigator.storage && navigator.storage.estimate){
  navigator.storage.estimate().then(e=>{ if(e && e.usage) $("ver").textContent += ` Espacio usado en este celular: ${(e.usage/1048576).toFixed(1).replace(".",",")} MB (la mayor parte es el lector de etiquetas).`; }).catch(()=>{});
}
function netState(){ if(SERVED) $("net").hidden = navigator.onLine; }
addEventListener("online", ()=>{ netState(); if(state.stops.some(s=>s.status!=="done")) optimize(true, {estable:true}); }); addEventListener("offline", netState); netState();
// Pide al navegador no borrar los datos de la app cuando falte espacio.
if(navigator.storage && navigator.storage.persist){ navigator.storage.persist().catch(()=>{}); }
let deferredInstall = null;
addEventListener("beforeinstallprompt", e=>{ e.preventDefault(); deferredInstall = e; $("btnInstall").hidden = false; });
$("btnInstall").onclick = async ()=>{
  if(!deferredInstall) return;
  deferredInstall.prompt(); await deferredInstall.userChoice.catch(()=>{}); deferredInstall = null; $("btnInstall").hidden = true;
};
addEventListener("appinstalled", ()=>{ $("btnInstall").hidden = true; toast("App instalada. Búscala en tu pantalla de inicio como «Ruta»."); });
/* ---- Actualizaciones ----
   La versión nueva se descarga sola, pero no reemplaza a la actual hasta que se toca «Actualizar»:
   así nunca se recarga en medio de una edición. Al recargar no se pide el PIN (la sesión sigue). */
let swReg = null, wantReload = false;
function showUpdate(w){
  if(!w || !navigator.serviceWorker.controller) return;
  $("upd").hidden = false; $("updBtn").disabled = false; $("updBtn").textContent = "Actualizar";
  $("updBtn").onclick = ()=>{
    save(); wantReload = true;
    $("updBtn").disabled = true; $("updBtn").textContent = "Actualizando…";
    w.postMessage({type:"skipWaiting"});
    setTimeout(()=>location.reload(), 5000); // por si el navegador no avisa el cambio
  };
  try{ w.postMessage({type:"version"}); }catch(e){}
}
function watchInstall(nw){
  if(!nw) return;
  nw.addEventListener("statechange", ()=>{ if(nw.state==="installed") showUpdate(nw); });
}
async function checkUpdate(manual){
  if(!swReg){ if(manual) toast("Las actualizaciones necesitan abrir la app desde su dirección https."); return; }
  if(!navigator.onLine){ if(manual) toast("Sin internet: busca la actualización cuando tengas señal."); return; }
  try{ await swReg.update(); }catch(e){ if(manual) toast("No se pudo revisar. Intenta de nuevo con buena señal."); return; }
  if(!manual) return;
  if(swReg.waiting) showUpdate(swReg.waiting);
  else if(swReg.installing) toast("Descargando la versión nueva… en un momento aparece el botón Actualizar.");
  else toast("Ya tienes la última versión (" + APP_VERSION + ").");
}
if("serviceWorker" in navigator && location.protocol !== "file:"){
  navigator.serviceWorker.addEventListener("message", e=>{
    if(e.data && e.data.type==="version" && e.data.version !== APP_VERSION) $("updTxt").textContent = "Hay una versión nueva (" + e.data.version + ").";
  });
  navigator.serviceWorker.addEventListener("controllerchange", ()=>{ if(wantReload){ wantReload = false; location.reload(); } });
  navigator.serviceWorker.register("sw.js").then(reg=>{
    swReg = reg;
    if(reg.waiting) showUpdate(reg.waiting);
    watchInstall(reg.installing);
    reg.addEventListener("updatefound", ()=>watchInstall(reg.installing));
    // Revisa al volver a la app y cada 30 minutos.
    document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="visible") checkUpdate(false); });
    setInterval(()=>checkUpdate(false), 30*60000);
  }).catch(err=>console.warn("SW", err));
}
$("btnUpdCheck").onclick = ()=>checkUpdate(true);
// Precarga el lector de etiquetas en segundo plano para que la primera foto sea rápida y funcione sin señal.
if("requestIdleCallback" in window){ requestIdleCallback(()=>{ if(navigator.onLine) getWorker().catch(()=>{}); }, {timeout:8000}); }

render();
// Señal de que todos los archivos cargaron (la usan las pruebas automáticas).
window.RUTA_LISTA = true;
