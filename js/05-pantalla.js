/* Mapa del recorrido, navegación (Waze/Maps), lista de paradas y diálogos. */
"use strict";
/* ============ Mapa esquemático del recorrido ============ */
// Dibuja las paradas en la cuadrícula de Bogotá (norte arriba, occidente a la izquierda) para ver si la ruta da vueltas.
let LMAP = null, LLAYER = null;
function drawMap(){
  if($("mapWrap").hidden) return;
  const pend = state.stops.filter(s=>s.status!=="done" && s.lat!=null);
  // Sin señal se usa el mapa real si ya hay calles guardadas (las que no se han visto salen en gris).
  if(navigator.onLine && typeof L !== "undefined" && pend.length && !store.get("rutaEntregas.tilesSeen")) store.set("rutaEntregas.tilesSeen", true);
  const useReal = typeof L !== "undefined" && (navigator.onLine || !!store.get("rutaEntregas.tilesSeen")) && pend.length > 0;
  $("lmap").hidden = !useReal; $("map").hidden = useReal;
  $("mapHint").textContent = useReal ? "Mapa de OpenStreetMap. El cuadro verde es desde donde arrancas; los números son el orden de entrega. Las calles que ya viste quedan guardadas para verlas sin señal." :
    "Esquema por números de calle y carrera (norte arriba, occidente a la izquierda). Con internet se muestra el mapa real.";
  if(useReal) return drawLeaflet(pend);
  drawSchematic();
}
function drawLeaflet(pend){
  if(!LMAP){
    LMAP = L.map("lmap", {zoomControl:true, attributionControl:true});
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {maxZoom:19, crossOrigin:true, attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(LMAP);
    LLAYER = L.layerGroup().addTo(LMAP);
  }
  setTimeout(()=>LMAP.invalidateSize(), 50);
  LLAYER.clearLayers();
  const o = currentOrigin(), bounds = [];
  if(ROUTE_GEOM && ROUTE_GEOM.length){
    L.polyline(ROUTE_GEOM, {color:getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()||"#f2b705", weight:5, opacity:.9}).addTo(LLAYER);
    ROUTE_GEOM.forEach(p=>bounds.push(p));
  }
  if(!(ROUTE_GEOM && ROUTE_GEOM.length)){
    const seq = (o && o.lat!=null ? [[o.lat,o.lng]] : []).concat(pend.map(s=>[s.lat,s.lng]));
    if(seq.length>1) L.polyline(seq, {color:"#888", weight:3, dashArray:"6 8"}).addTo(LLAYER);
  }
  if(o && o.lat!=null){
    L.marker([o.lat,o.lng], {icon:L.divIcon({className:"", html:'<div class="pin start"></div>', iconSize:[26,26]})}).addTo(LLAYER);
    bounds.push([o.lat,o.lng]);
  }
  pend.forEach((s,i)=>{
    const m = L.marker([s.lat,s.lng], {icon:L.divIcon({className:"", html:`<div class="pin${s.geo!=="osm"?" est":""}">${i+1}</div>`, iconSize:[26,26]})}).addTo(LLAYER);
    m.bindPopup(`<b>${i+1}. ${esc(s.label||s.addr)}</b>${s.name?"<br>"+esc(s.name):""}${s.geo!=="osm"?"<br><i>Ubicación aproximada</i>":""}`);
    bounds.push([s.lat,s.lng]);
  });
  if(bounds.length) LMAP.fitBounds(bounds, {padding:[24,24], maxZoom:16});
}
function drawSchematic(){
  const cv = $("map"); if(!cv) return;
  const css = getComputedStyle(document.documentElement);
  const C = k => css.getPropertyValue(k).trim();
  const W = cv.clientWidth || 320, H = Math.round(W*0.85), dpr = window.devicePixelRatio || 1;
  cv.width = W*dpr; cv.height = H*dpr; cv.style.height = H+"px";
  const g = cv.getContext("2d"); g.setTransform(dpr,0,0,dpr,0,0); g.clearRect(0,0,W,H);
  const origin = currentOrigin();
  const pend = state.stops.filter(s=>s.status!=="done" && s.x!==null);
  const pts = origin ? [origin, ...pend] : pend;
  if(!pend.length){ g.fillStyle=C("--muted"); g.font="14px "+C("--body"); g.fillText("Sin paradas ubicadas para dibujar.",12,24); return; }
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(const p of pts){ minX=Math.min(minX,p.x); maxX=Math.max(maxX,p.x); minY=Math.min(minY,p.y); maxY=Math.max(maxY,p.y); }
  const pad = 28, spanX = Math.max(2,maxX-minX), spanY = Math.max(2,maxY-minY);
  const sc = Math.min((W-2*pad)/spanX, (H-2*pad)/spanY);
  const ox = (W - spanX*sc)/2, oy = (H - spanY*sc)/2;
  // Carrera crece hacia el occidente (izquierda); calle crece hacia el norte (arriba).
  const X = p => ox + (maxX - p.x)*sc, Y = p => oy + (maxY - p.y)*sc;
  // Cuadrícula de referencia cada 5 calles/carreras.
  g.strokeStyle = C("--line"); g.lineWidth = 1; g.fillStyle = C("--muted"); g.font = "10px "+C("--body");
  const step = spanX+spanY > 80 ? 10 : 5;
  for(let v=Math.ceil(minX/step)*step; v<=maxX; v+=step){ const xx=X({x:v}); g.beginPath(); g.moveTo(xx,0); g.lineTo(xx,H); g.stroke(); g.fillText("Kr "+v, xx+2, H-4); }
  for(let v=Math.ceil(minY/step)*step; v<=maxY; v+=step){ const yy=Y({y:v}); g.beginPath(); g.moveTo(0,yy); g.lineTo(W,yy); g.stroke(); g.fillText("Cl "+v, 2, yy-2); }
  // Recorrido en escalera (como se anda por cuadras).
  g.strokeStyle = C("--accent"); g.lineWidth = 3; g.lineJoin = "round"; g.beginPath();
  g.moveTo(X(pts[0]),Y(pts[0]));
  for(let i=1;i<pts.length;i++){ g.lineTo(X(pts[i]),Y(pts[i-1])); g.lineTo(X(pts[i]),Y(pts[i])); }
  if(state.roundTrip && origin && parseAddress(state.start)){ const o=pts[0], l=pts[pts.length-1]; g.lineTo(X(o),Y(l)); g.lineTo(X(o),Y(o)); }
  g.stroke();
  // Paradas numeradas.
  g.textAlign="center"; g.textBaseline="middle"; g.font = "600 11px "+C("--body");
  pend.forEach((p,i)=>{ g.fillStyle=C("--ink"); g.beginPath(); g.arc(X(p),Y(p),10,0,7); g.fill(); g.fillStyle=C("--bg"); g.fillText(String(i+1),X(p),Y(p)+.5); });
  if(origin){ g.fillStyle=C("--ok"); g.fillRect(X(origin)-7,Y(origin)-7,14,14); }
  g.textAlign="start"; g.textBaseline="alphabetic";
}

/* ============ Navegación ============ */
function navQuery(s){ return (s.label || s.addr) + ", Bogotá, Colombia"; }
// Si la dirección quedó ubicada en su esquina exacta, Waze recibe las coordenadas (no se confunde con direcciones parecidas).
function wazeUrl(s){
  if((s.geo==="osm" || s.geo==="barrio" || s.geo==="gps") && s.lat!=null) return `https://waze.com/ul?ll=${s.lat.toFixed(6)},${s.lng.toFixed(6)}&navigate=yes`;
  return "https://waze.com/ul?q=" + encodeURIComponent(navQuery(s)) + "&navigate=yes";
}
function openExternal(url){ const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove(); }
function nextStop(){ return state.stops.find(q=>q.status==="pend" && q.x!==null) || state.stops.find(q=>q.status==="pend") || state.stops.find(q=>q.status==="fail"); }
function mapsUrl(s){ return "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(navQuery(s)) + "&travelmode=driving"; }
function mapsMultiUrl(stops){
  return "https://www.google.com/maps/dir/" + stops.map(s=>encodeURIComponent(navQuery(s))).join("/") ;
}

/* ============ Render ============ */
const $ = id => document.getElementById(id);
function esc(s){ return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

function render(){
  const list = $("list");
  const pend = state.stops.filter(s=>s.status!=="done");
  $("stPend").textContent = pend.length;
  const paq = pend.reduce((a,st)=>a+(st.qty||1),0);
  $("stPendLbl").textContent = paq !== pend.length ? `direcciones · ${paq} pedidos` : "pendientes";
  $("stDone").textContent = state.stops.filter(s=>s.status==="done").length;
  const sp = parseAddress(state.start);
  const geo = pend.filter(s=>s.x!==null);
  const real = state.route && state.route.mode==="real" && state.route.km!=null;
  $("stKm").textContent = geo.length ? (real ? state.route.km : pathLen(currentOrigin(),geo,!!state.roundTrip && !!sp)*KM_PER_UNIT).toFixed(1) : "0";
  $("stKmLbl").textContent = real ? "km reales" : "km aprox.";
  $("realRoads").checked = state.realRoads !== false;
  // Resumen de las opciones cuando el bloque está oculto.
  // Cómo ordenar
  $("ordAuto").checked = !modoDirecciones(); $("ordDir").checked = modoDirecciones();
  $("ordPrimKr").checked = !state.ordenPrimero || state.ordenPrimero === "carreras"; $("ordPrimCl").checked = state.ordenPrimero === "calles"; $("ordPrimAm").checked = state.ordenPrimero === "ambas";
  $("ordAsc").checked = !!state.ordenAsc;
  $("ordDirBox").hidden = !modoDirecciones();
  $("ordInfo").textContent = modoDirecciones() ? "Los pedidos nuevos entran en su lugar. Puedes mover a mano con ▲▼; para volver a este orden, toca «Ordenar ruta»." :
    "La app calcula el recorrido más corto con el mapa. Waze solo navega a cada parada: no recibe la lista completa.";
  const parts = [];
  parts.push(currentOrigin() && currentOrigin().id ? "Desde tu última entrega" : state.startGPS ? "Desde " + (state.startGPS.dirMapa || state.startGPS.cruce || (state.startGPS.dir ? "≈ " + state.startGPS.dir : "tu ubicación")) : state.start ? "Desde " + state.start : (zone().on && zone().entry ? "Entrada por " + (ZONE_ENTRIES[zone().entry]||"la zona").replace(/ \(.*\)$/,"") : "Sin punto de partida"));
  parts.push(esMoto() ? "en moto" : "en carro");
  if(state.byZone) parts.push("por zona ST");
  if(state.roundTrip) parts.push("con regreso");
  parts.push(modoDirecciones() ? "por direcciones" : state.realRoads !== false ? "calles reales" : "orden aproximado");
  if(state.autoWaze !== false) parts.push("Waze automático");
  $("optsSum").textContent = parts.join(" · ");
  // Ruta desplegable: cerrada muestra paradas, km y desde dónde arranca. Abierta por defecto la primera vez.
  const kmTxt = $("stKm").textContent + (real ? " km reales" : " km aprox.");
  $("routeSum").textContent = pend.length ? `${pend.length} ${pend.length===1?"parada":"paradas"} · ${kmTxt} · ${parts[0]}` : `Sin paradas pendientes · ${parts[0]}`;
  const rOpen = state.rutaOpen !== false;
  if($("routeCard").open !== rOpen) $("routeCard").open = rOpen;
  if($("routeOpts").open !== !!state.optsOpen) $("routeOpts").open = !!state.optsOpen;
  $("autoWaze").checked = state.autoWaze !== false;
  $(esMoto() ? "vehMoto" : "vehCarro").checked = true;
  $("vehInfo").textContent = (esMoto() ? "Moto: tiempos de manejo ≈ 15 % menores (avanza en el trancón y parquea en la puerta). " : "Carro: tiempos de manejo del servidor de rutas. ")
    + "El orden de las paradas es el mismo para los dos: en las pruebas, el orden más corto en carro también fue el mejor en moto.";
  if(document.activeElement !== $("orsKey")) $("orsKey").value = state.orsKey || "";
  $("routeInfo").textContent = state.routeNote || "";
  const mj = state.mejoraRuta && state.stops.some(s=>s.status!=="done") ? state.mejoraRuta : null;
  $("mejoraInfo").hidden = !mj;
  $("mejoraInfo").textContent = mj ? `Hay un orden ${mj.pct} % más corto${mj.min ? ` (≈ ${mj.min} min menos)` : ""}. No se cambió solo para no desordenar tu ruta; si quieres usarlo, toca «Ordenar ruta».${rutaEnCurso() ? " Cada paquete conserva su número." : ""}` : "";
  $("roundTrip").checked = !!state.roundTrip;
  drawMap();
  updateComparison();
  renderZoneSettings();
  renderLearn();
  renderPace();
  if(typeof renderDrive === "function") renderDrive();
  const outZ = state.stops.filter(s=>s.status!=="done" && zoneIssue(s)).length;
  $("zoneInfo").hidden = !outZ;
  $("zoneInfo").textContent = outZ ? `${outZ} parada(s) fuera de tu zona de trabajo (${zone().name}). Revisa si la dirección está bien escrita.` : "";
  $("start").value = state.start;
  $("byZone").checked = !!state.byZone;
  const g = state.startGPS;
  $("btnGpsClear").hidden = !g;
  // Punto de partida: qué se está usando de verdad para calcular la ruta.
  const o = currentOrigin();
  const sigue = o && o.id ? ` Ojo: la ruta sigue desde tu última entrega (${o.label}), que es más reciente. Si ya no estás ahí, toca «Actualizar mi ubicación».` : "";
  let info = "", mal = false;
  if(g){
    const lugar = g.dirMapa ? `Estás en ${g.dirMapa} (según el mapa${g.placaExacta ? "" : "; la placa es aproximada"})${g.cruce && !g.cruce.startsWith(g.dirMapa) ? ", " + g.cruce.replace(/^.* con /, "cerca de la esquina con ") : ""}`
      : g.cruce ? `Estás en ${g.cruce} (según el mapa)` : g.dir ? `Cerca de ≈ ${g.dir} (aproximado${navigator.onLine ? ", confirmando en el mapa…" : ", sin internet"})` : "Sin dirección aproximada";
    info = `${lugar}${g.barrio ? ", barrio " + g.barrio : ""}. Precisión ±${g.acc} m, tomada a las ${hhmm(g.t)}`.replace(/\.?$/, ".") + (g.acc>300 ? " La precisión es baja: activa el GPS y vuelve a tocar el botón." : "");
  } else if(state.start){
    if(sp) info = `✓ Se usa como punto de partida: ${sp.label}.`;
    else { info = `✗ No reconozco «${state.start}»: no se está usando. Escríbela así: Carrera 149C # 137-20.`; mal = true; }
  } else {
    const z = zone();
    info = z.on && z.entry ? `Sin punto de partida: se arranca por ${ZONE_ENTRIES[z.entry]}. Mejor usa «Usar mi ubicación actual» al salir.` : "Opcional. Sin punto de partida, la app elige el recorrido más corto.";
  }
  $("startInfo").textContent = info + sigue;
  $("startInfo").style.color = mal || sigue ? "var(--warn)" : "";
  $("startInfo").style.fontWeight = mal || sigue ? "600" : "";

  // Pendientes en la lista principal; las entregadas, en «Pedidos entregados» (desplegable, recogida por defecto).
  const doneStops = state.stops.filter(s=>s.status==="done");
  $("doneWrap").hidden = !doneStops.length;
  if(doneStops.length){
    const pq = doneStops.reduce((a,s)=>a+(s.qty||1),0), ult = doneStops.filter(s=>s.doneAt).sort((a,b)=>b.doneAt-a.doneAt)[0];
    $("doneTitle").textContent = `Pedidos entregados (${pq})`;
    $("doneSum").textContent = `${doneStops.length} ${doneStops.length===1?"dirección":"direcciones"}${ult?` · última a las ${hhmm(ult.doneAt)}`:""} · toca para ver o deshacer`;
    const dOpen = !!state.doneOpen; if($("doneCard").open !== dOpen) $("doneCard").open = dOpen;
  }
  if(state.stops.length===0){
    list.innerHTML = '<li class="empty">Sin paquetes. Toma una foto de la etiqueta para empezar.</li>';
    $("listDone").innerHTML = "";
    return;
  }
  numerar();
  const html = state.stops.map((s,idx)=>{
    const isDone = s.status==="done", isFail = s.status==="fail", unk = s.x===null;
    const numTxt = isDone ? "✓" : String(s.num);
    const cls = "stop" + (isDone?" done":"") + (isFail?" fail":"") + (unk&&!isDone?" unk":"");
    return `<li class="${cls}" data-id="${s.id}">
      <div class="num" aria-label="Parada ${numTxt}${(s.qty||1)>1?", "+s.qty+" paquetes":""}">${numTxt}${(s.qty||1)>1?`<span class="qty">×${s.qty}</span>`:""}</div>
      <div>
        <div class="addr">${esc(s.label || s.addr)}</div>
        ${s.guia ? `<div class="guiaLine">${guias(s).map(g=>`<span>${esc(g)}</span>`).join("")}</div>` : ""}
        <div class="meta">
          ${s.zone?`<span class="chip zone">ST ${esc(s.zone)}</span>`:""}
          <span class="chip unit">${esc(unitText(s))}</span>
          ${s.barrio?`<span class="chip">${esc(s.barrio)}</span>`:""}
          ${unk?'<span class="chip warn">Revisar dirección</span>':""}
          ${s.geo==="barrio"?`<span class="chip warn">Ubicada por barrio (aprox.)</span>`:""}
          ${s.geo==="gps" && !isDone?`<span class="chip ok">Ubicación exacta</span>`:""}
          ${!isDone && zoneIssue(s)?`<span class="chip warn">Fuera de tu zona: ${esc(zoneIssue(s))}</span>`:""}
          ${s.zoneCheck && s.zoneCheck.bad?`<span class="chip warn">No coincide con ${esc(s.barrio)}: queda a ${s.zoneCheck.km.toFixed(1).replace(".",",")} km</span>`:""}
          ${isFail?'<span class="chip warn">Intento fallido</span>':""}
          ${s.avisadoAt && !isDone ? `<span class="chip ok">Avisado ${hhmm(s.avisadoAt)}</span>` : ""}
          ${state.loadOn && !isDone ? (loadedOf(s) >= (s.qty||1) ? '<span class="chip ok">Cargado ✓</span>' : `<span class="chip warn">Sin verificar${(s.qty||1)>1?" "+((s.qty||1)-loadedOf(s))+" de "+s.qty:""}</span>`) : ""}
          ${s.example?'<span class="chip ex">Ejemplo</span>':""}
        </div>
        ${(s.name||s.phone)?`<div class="who">${esc(s.name)}${s.name&&s.phone?" · ":""}${s.phone?esc(s.phone.replace(/(\d{3})(\d{3})(\d{4})/,"$1 $2 $3")):""}</div>`:""}
        ${s.notes?`<div class="who">${esc(s.notes)}</div>`:""}
      </div>
      <div class="actions">
        <a class="btn small waze" href="${wazeUrl(s)}" target="_blank" rel="noopener">Waze</a>
        <a class="btn small" href="${mapsUrl(s)}" target="_blank" rel="noopener">Maps</a>
        ${s.phone && dialNumber(s.phone)?`<a class="btn small" href="tel:${dialNumber(s.phone)}">Llamar</a>`:`<button class="small" data-act="edit">Tel.</button>`}
        <button class="small ${isDone?"":"primary"}" data-act="done">${isDone?"Deshacer":"Entregado"}</button>
      </div>
      <div class="actions2">
        <button class="small" data-act="up" aria-label="Subir" ${idx===0?"disabled":""}>▲</button>
        <button class="small" data-act="down" aria-label="Bajar" ${idx===state.stops.length-1?"disabled":""}>▼</button>
        ${s.phone && cleanPhone(s.phone).startsWith("3") ? `<a class="btn small" href="${waUrl(cleanPhone(s.phone), s)}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
        ${!isDone && !s.example && guias(s).length < (s.qty||1) ? `<button class="small" data-act="guia">+ Guía</button>` : ""}
        <button class="small" data-act="fail">${isFail?"Quitar fallido":"No estaba"}</button>
        <button class="small" data-act="edit">Editar</button>
        <button class="small danger" data-act="del">Borrar</button>
      </div>
    </li>`;
  });
  // «Parquea una vez»: encabezado antes del primer miembro de cada grupo y sangría en sus paradas.
  const grupos = typeof gruposParqueo === "function" ? gruposParqueo() : [];
  const inicioGrupo = new Map(grupos.map(g=>[g.miembros[0].id, g])), enGrupo = new Set(grupos.flatMap(g=>g.miembros.map(m=>m.id)));
  list.innerHTML = state.stops.map((s,i)=>{
    if(s.status==="done") return "";
    const g = inicioGrupo.get(s.id);
    const head = g ? `<li class="parkHead"><span class="pk">P</span><span>${esc(textoParqueo(g))}</span></li>` : "";
    return head + (enGrupo.has(s.id) ? html[i].replace('<li class="stop', '<li class="stop inPark') : html[i]);
  }).join("") ||
    `<li class="empty">${doneStops.length ? "¡No quedan pendientes! Las entregadas están abajo, en «Pedidos entregados»." : "Sin paquetes."}</li>`;
  $("listDone").innerHTML = state.stops.map((s,i)=>s.status==="done" ? html[i] : "").join("");
}

function toggleDone(s){
  const i = state.stops.indexOf(s); if(i<0) return;
  {
      const from = currentOrigin();
      s.status = s.status==="done" ? "pend" : "done";
      if(s.status==="done"){
        s.doneAt = Date.now();
        learnSpot(s);
        const lc = legCost(from, s); s.legEst = lc ? lc.sec : null; s.legKm = lc ? lc.m : null;
      } else { delete s.doneAt; delete s.legEst; delete s.legKm; }
    }
      if(s.status==="done"){ state.stops.splice(i,1); state.stops.push(s); if(s.x!==null) state.lastDoneId = s.id; { const nx = nextStop(); toast(((s.qty||1)>1 ? `Entregados ${s.qty} paquetes.` : "Entregado.") + (nx ? ` Sigue con la parada ${stopNum(nx)}.` : "")); }
        recordDay();
        if(state.autoWaze !== false){ const nx = nextStop(); if(nx){ save(); render(); openExternal(wazeUrl(nx)); return; } else toast("¡Terminaste! No quedan entregas pendientes."); } }
      else { if(state.lastDoneId===s.id) state.lastDoneId = null; recordDay(); }   // al deshacer, baja el acumulado
        save(); render();
}
// «No estaba»: queda como intento fallido al final de los pendientes (o se quita la marca).
function toggleFail(s){
  const i = state.stops.indexOf(s); if(i<0) return;
  s.status = s.status==="fail" ? "pend" : "fail";
  if(s.status==="fail"){
    s.failAt = Date.now(); s.failCount = (s.failCount||0)+1;
    recordDay(); state.stops.splice(i,1);
    const firstDone = state.stops.findIndex(q=>q.status==="done");
    state.stops.splice(firstDone<0?state.stops.length:firstDone,0,s);
    toast("Marcado como no estaba. Se movió al final de los pendientes.");
  }
  save(); render();
}
function onListClick(e){
  const b = e.target.closest("button[data-act]"); if(!b) return;
  const id = b.closest("li").dataset.id;
  const i = state.stops.findIndex(s=>s.id===id); if(i<0) return;
  const s = state.stops[i];
  switch(b.dataset.act){
    case "done": toggleDone(s); return;
    case "fail": toggleFail(s); return;
    case "guia": startAssign([s.id]); return;
    case "up": if(i>0){ [state.stops[i-1],state.stops[i]]=[state.stops[i],state.stops[i-1]]; } break;
    case "down": if(i<state.stops.length-1){ [state.stops[i+1],state.stops[i]]=[state.stops[i],state.stops[i+1]]; } break;
    case "edit": openEdit(s); return;
    case "del": confirmBox("Borrar paquete", `¿Borrar ${s.label||s.addr}?`, ()=>{ state.stops.splice(i,1); save(); render(); }); return;
  }
  save(); render();
}
$("list").addEventListener("click", onListClick);
$("listDone").addEventListener("click", onListClick);
$("doneCard").addEventListener("toggle", e=>{ if(!!state.doneOpen !== e.target.open){ state.doneOpen = e.target.open; save(); } });

/* ============ Diálogos ============ */
let editing = null;
function openEdit(s, isNew){
  editing = {s, isNew};
  $("dlgTitle").textContent = isNew ? "Revisa y guarda" : "Editar paquete";
  $("fAddr").value = s.addr||""; $("fZone").value = s.zone||""; $("fPhone").value = s.phone||"";
  setType(s.type||"casa"); $("fUnit").value = s.unit||"";   // por defecto Casa; se cambia si es otro tipo
  setTimeout(updPhone, 0);
  $("fQty").value = s.qty||1; $("fName").value = s.name||""; $("fBarrio").value = s.barrio||""; $("fGuia").value = s.guia||""; $("fNotes").value = s.notes||"";
  $("fRaw").textContent = s.raw||""; $("rawWrap").hidden = !s.raw;
  updParsed();
  $("dlgEdit").showModal();
  if(isNew && !s.addr) setTimeout(()=>$("pN1").focus(), 60);   // «Escribir»: se empieza por el número de la vía
}
// Dirección por partes ⇄ dirección completa. Al escribir en las partes se arma la completa; al pegar, dictar,
// escanear o abrir una parada, la completa se reparte en las partes. Lo que va después de la placa (Sur, apto…) se conserva.
let partesCola = "";
function partesDe(txt){
  const p = parseAddress(txt);
  if(!p) return null;
  const m = /^(\D+?) (\d.*?) # (.+?)-(\d+)(.*)$/.exec(p.label);
  if(!m) return null;
  return {via: m[1], n1: m[2], n2: m[3], n3: m[4], cola: m[5] + (typeof rest === "function" ? rest(txt) : "")};
}
function llenarPartes(){
  const t = $("fAddr").value.trim(), d = partesDe(t);
  if(d){
    if(![...$("pVia").options].some(o=>o.value===d.via)) $("pVia").add(new Option(d.via));
    $("pVia").value = d.via; $("pN1").value = d.n1; $("pN2").value = d.n2; $("pN3").value = d.n3; partesCola = d.cola;
  } else if(!t){
    $("pN1").value = $("pN2").value = $("pN3").value = ""; partesCola = "";
    $("pVia").value = state.viaParte || state.viaDictado || "Calle";
  }
}
function armarDesdePartes(){
  const via = $("pVia").value, n1 = $("pN1").value.trim(), n2 = $("pN2").value.trim(), n3 = $("pN3").value.replace(/\D/g,"");
  if(!n1 && !n2 && !n3) return;
  $("fAddr").value = `${via} ${n1}` + (n2 || n3 ? ` # ${n2}` + (n3 ? `-${n3}` : "") : "") + partesCola;
  updParsed(true); if(typeof updPhone === "function") updPhone();
}
for(const id of ["pN1","pN2","pN3"]) $(id).addEventListener("input", armarDesdePartes);
$("pVia").addEventListener("change", ()=>{ state.viaParte = $("pVia").value; save(); armarDesdePartes(); $("pN1").focus(); });
// «#» en el primer número salta al segundo; «-» en el segundo salta a la placa; Enter pasa al siguiente campo.
const sigParte = {pN1:"pN2", pN2:"pN3", pN3:"fQty"};
for(const id of ["pN1","pN2","pN3"]) $(id).addEventListener("keydown", e=>{
  if(e.key==="Enter" || (id==="pN1" && e.key==="#") || (id==="pN2" && e.key==="-")){ e.preventDefault(); $(sigParte[id]).focus(); }
});
for(const id of ["pN1","pN2"]) $(id).addEventListener("input", e=>{   // si pegan o el teclado mete el símbolo igual
  const el = e.target, ch = id==="pN1" ? "#" : "-";
  if(el.value.includes(ch)){ const [a, b] = el.value.split(ch); el.value = a.trim(); const sig = $(sigParte[id]); if(b && !sig.value) sig.value = b.trim(); armarDesdePartes(); sig.focus(); }
});
function updParsed(desdePartes){
  if(desdePartes !== true) llenarPartes();
  const p = parseAddress($("fAddr").value);
  const zi = p ? zoneIssue(p) : null;
  $("fParsed").innerHTML = p ? `<span class="chip ok">Reconocida</span> ${esc(p.label)}` + (zi ? ` <span class="chip warn">Fuera de tu zona: ${esc(zi)}</span>` : "") :
    `<span class="chip warn">No reconocida</span> Escríbela así: Calle 143 # 151B-23 (o Cra, Dg, Tv; agrega Sur o Este si aplica).`;
}
$("fAddr").addEventListener("input", ()=>updParsed());
// Llamar o escribir por WhatsApp al cliente desde el formulario (apenas se escanea la etiqueta).
// Número para marcar: celular (10 dígitos), fijo con indicativo (601…) o fijo de 7 dígitos. Si trae +57 se quita.
function dialNumber(v){
  let d = String(v||"").replace(/\D/g,"");
  if(d.length===12 && d.startsWith("57")) d = d.slice(2);
  return d.length >= 7 && d.length <= 10 ? d : "";
}
function cleanPhone(v){ const d = String(v||"").replace(/\D/g,""); const t = d.length===12 && d.startsWith("57") ? d.slice(2) : d; return /^3\d{9}$/.test(t) || /^60\d{8}$/.test(t) ? t : ""; }
function waText(s){ return `Hola${s.name ? " " + s.name.split(" ")[0] : ""}, le escribe el domiciliario. Voy en camino con su paquete a ${s.label || s.addr || "su dirección"}${s.unit ? " (" + s.unit + ")" : ""}. ¿Me confirma si hay alguien para recibir?`; }
function waUrl(phone, s){ return "https://wa.me/57" + phone + "?text=" + encodeURIComponent(waText(s)); }
function updPhone(){
  const ph = cleanPhone($("fPhone").value);
  const pa = parseAddress($("fAddr").value);
  const s = {name:$("fName").value.trim(), label: pa ? pa.label : $("fAddr").value.trim(), unit:$("fUnit").value.trim()};
  $("fCall").setAttribute("aria-disabled", ph ? "false" : "true");
  $("fWa").setAttribute("aria-disabled", ph && ph.startsWith("3") ? "false" : "true");
  $("fCall").href = ph ? "tel:" + ph : "#";
  $("fWa").href = ph ? waUrl(ph, s) : "#";
  const raw = $("fPhone").value.trim();
  $("fPhoneHint").hidden = !raw || !!ph;
  $("fPhoneHint").textContent = raw && !ph ? "Revisa el teléfono: un celular en Colombia tiene 10 dígitos y empieza por 3." : "";
}
for(const id of ["fPhone","fName","fAddr","fUnit"]) $(id).addEventListener("input", updPhone);
$("qtyMinus").onclick = ()=>{ $("fQty").value = Math.max(1,(parseInt($("fQty").value,10)||1)-1); };
function setType(t){
  document.querySelectorAll('input[name="fType"]').forEach(r=>{ r.checked = r.value===t; });
  $("fUnit").placeholder = UNIT_HINT[t||""];
  $("fUnitLbl").firstChild.textContent = t ? ({casa:"Detalle de la casa", apto:"Detalle del apartamento", local:"Detalle del local", conjunto:"Detalle del conjunto"}[t]) : "Detalle";
}
document.querySelectorAll('input[name="fType"]').forEach(r=>r.addEventListener("change", ()=>setType(r.value)));
// Al escribir el detalle, se sugiere el tipo si aún no se eligió.
$("fUnit").addEventListener("change", ()=>{
  const cur = (document.querySelector('input[name="fType"]:checked')||{}).value;
  if(cur && cur!=="casa") return;   // si ya eligió otro tipo, se respeta
  const u = detectUnit($("fUnit").value); if(u && u.type!=="casa") setType(u.type);
});
$("qtyPlus").onclick  = ()=>{ $("fQty").value = Math.min(99,(parseInt($("fQty").value,10)||1)+1); };
// Varios paquetes a la misma dirección van en una sola parada con su cantidad.
function stopKey(x){ const p = parseAddress(x.label || x.addr); return p ? p.label.toUpperCase() : norm(x.addr); }
function guias(st){ return (st.guia||"").split(/[,\s]+/).filter(Boolean); }
function hasGuia(g){ return !!findGuia(g); }
// Busca la parada que tiene esa guía (exacta). «except» deja por fuera la parada que se está editando.
function findGuia(g, except){ g = String(g||"").trim(); if(!g) return null; return state.stops.find(st=>st!==except && guias(st).includes(g)) || null; }
// Número de parada como se ve en la lista (solo cuentan las pendientes).
// Número de la parada: fijo en ruta (ver numerar() en js/02-ruta.js).
function stopNum(st){ if(!st.num) numerar(); return st.num || 0; }
function placeName(st){ const n = stopNum(st); return (st.status!=="done" && n ? "la parada " + n : "una parada ya entregada") + " (" + (st.label||st.addr) + ")"; }
function addOrMerge(d){
  const k = stopKey(d);
  const same = state.stops.find(st=>st.status!=="done" && stopKey(st)===k);
  if(same){
    // La parada ya estaba (p. ej. dictada) y le faltan guías: esta etiqueta es uno de sus paquetes, no uno más.
    if(d.guia && !guias(same).includes(d.guia) && guias(same).length < (same.qty||1) && (parseInt(d.qty,10)||1) === 1){
      same.guia = guias(same).concat(d.guia).join(", ");
      for(const k of ["phone","name","zone","barrio","unit"]) if(!same[k] && d[k]) same[k] = d[k];
      if((!same.type || same.type==="casa") && d.type && d.type!=="casa") same.type = d.type;
      return {merged:true, filled:true, stop:same};
    }
    same.qty = Math.min(99,(same.qty||1) + Math.max(1,parseInt(d.qty,10)||1));
    if(d.guia && !guias(same).includes(d.guia)) same.guia = guias(same).concat(d.guia).join(", ");
    if(d.name && !(same.name||"").toLowerCase().includes(d.name.toLowerCase())) same.name = same.name ? same.name + " / " + d.name : d.name;
    if(d.phone && d.phone!==same.phone){ if(!same.phone) same.phone = d.phone; else if(!(same.notes||"").includes(d.phone)) same.notes = (same.notes? same.notes+" · " : "") + "Otro tel: " + d.phone; }
    if(d.unit && !(same.unit||"").toLowerCase().includes(d.unit.toLowerCase())) same.unit = same.unit ? same.unit + " / " + d.unit : d.unit;
    if((!same.type || same.type==="casa") && d.type && d.type!=="casa") same.type = d.type;
    if(d.notes && !(same.notes||"").includes(d.notes)) same.notes = (same.notes? same.notes+" · " : "") + d.notes;
    if(!same.zone && d.zone) same.zone = d.zone;
    return {merged:true, stop:same};
  }
  const ns = mkStop(d); const firstDone = state.stops.findIndex(q=>q.status==="done");
  state.stops.splice(firstDone<0?state.stops.length:firstDone,0,ns);
  return {merged:false, stop:ns};
}
$("dlgCancel").onclick = ()=>{ fromScan = false; $("dlgEdit").close(); };
$("frmEdit").addEventListener("submit", e=>{
  e.preventDefault();
  const d = {addr:$("fAddr").value.trim(), zone:$("fZone").value.trim(), phone:$("fPhone").value.replace(/\D/g,"").slice(-10),
    name:$("fName").value.trim(), barrio:canonBarrio($("fBarrio").value), guia:$("fGuia").value.trim(), notes:$("fNotes").value.trim(), raw:editing.s.raw,
    qty:Math.max(1,Math.min(99,parseInt($("fQty").value,10)||1)),
    type:(document.querySelector('input[name="fType"]:checked')||{}).value||"casa", unit:$("fUnit").value.trim()};
  if(!d.addr) return;
  const p = parseAddress(d.addr);
  if(editing.isNew){
    if(d.guia){ const dup = guias(d).find(hasGuia); if(dup){ $("dlgEdit").close(); dupAlert(dup); return; } }
    state.stops = state.stops.filter(s=>!s.example);
    const r = addOrMerge(d);
    if(r.filled) toast(`Guía agregada a la parada que ya tenías: ${r.stop.label||r.stop.addr}.`);
    else if(r.merged) toast(`Misma dirección que otra parada: ahora son ${r.stop.qty} paquetes en ${r.stop.label||r.stop.addr}.`);
    else toast(p ? "Paquete agregado en su lugar de la ruta." : "Agregado, pero la dirección quedó para revisar.");
  } else {
    const dup = guias(d).find(g=>findGuia(g, editing.s));
    if(dup){ toast(`La guía ${dup} ya está en ${placeName(findGuia(dup, editing.s))}. Revísala.`); return; }
    const changed = (p?p.label:"") !== editing.s.label;
    Object.assign(editing.s, d, {x:p?p.x:null, y:p?p.y:null, label:p?p.label:"", example:false});
    if(changed || editing.s.geo==="barrio"){ editing.s.lat = null; editing.s.lng = null; editing.s.geo = null; }
    // Si cambió la dirección, la parada se vuelve a ubicar en la ruta (las demás no se mueven).
    if(changed && state.suggestedIds) state.suggestedIds = state.suggestedIds.filter(id=>id!==editing.s.id);
    editing.s.zoneCheck = null;
  }
  $("dlgEdit").close();
  save(); render();   // se ve de inmediato aunque haya un cálculo de ruta en curso
  optimize(true, {estable: true});
  if(fromScan && state.scanLoop && editing.isNew) setTimeout(()=>startScan("label"), 600);
  fromScan = false;
});

let textMode = "one";
function openText(mode){
  textMode = mode; $("txtArea").value = "";
  $("txtTitle").textContent = mode==="one" ? "Pegar texto de la etiqueta" : "Pegar varias direcciones";
  $("txtHint").textContent = mode==="one" ? "En la galería o Google Lens toca «Copiar texto» sobre la etiqueta y pégalo aquí." :
    "Una dirección por línea. Puedes agregar al final el teléfono, la zona y la cantidad, por ejemplo: Calle 143 # 151B-23 3001234567 ST 49 x3. Si una dirección se repite, se suma a la misma parada.";
  $("micBulk").hidden = mode!=="bulk"; $("micBulkMsg").hidden = true; $("viaBulkBox").hidden = mode!=="bulk";
  $("dlgText").showModal(); if(mode!=="bulk") setTimeout(()=>$("txtArea").focus(),50);
}
$("txtCancel").onclick = ()=>$("dlgText").close();
$("frmText").addEventListener("submit", e=>{
  e.preventDefault();
  const t = $("txtArea").value; $("dlgText").close();
  if(!t.trim()) return;
  if(textMode==="one"){ const d = extractLabel(t); openEdit(d, true); }
  else {
    state.stops = state.stops.filter(s=>!s.example);
    let ok=0, bad=0, merged=0; const ids = [];
    t.split(/\r?\n/).map(l=>l.trim()).filter(Boolean).forEach(line=>{
      const d = extractLabel(line); if(!d.addr) d.addr = line;
      const tl = line.match(/\bTel[:.]?\s*((?:\+?57)?\d{7,10})\b/i); if(tl && !d.phone) d.phone = tl[1].replace(/^\+?57(?=\d{10}$)/,"");
      const q = line.match(/(?:^|\s)[x×]\s*(\d{1,2})\b|\b(\d{1,2})\s*(?:paq|paquetes|unid|und)\b|\b(?:por|cantidad)\s+(\d{1,2})\b/i);
      if(q) d.qty = +(q[1]||q[2]||q[3]);
      if(d.barrio) d.barrio = d.barrio.replace(/\bTel[:.]?\s*\d{7,12}\b/gi,"").replace(/\b(?:por|cantidad)\s+\d{1,2}\b|(?:^|\s)[x×]\s*\d{1,2}\b|\b\d{1,2}\s*(?:paq\w*|unid\w*|und)\b|\b(?:\+?57)?3\d{9}\b|\bST\s*\d+\b/gi,"").trim();
      const r = addOrMerge(d);
      if(r.merged) merged++; else if(r.stop.x===null) bad++; else ok++;
      ids.push(r.stop.id);
    });
    save(); render(); optimize(true, {estable:true});
    toast(`${ok} ubicadas${bad?`, ${bad} para revisar`:""}${merged?`, ${merged} sumadas a una dirección repetida`:""}. Agregadas en su lugar de la ruta.`);
    // Lo dictado o pegado suele venir sin teléfono ni guía: primero se ofrece escribir los teléfonos y luego escanear las guías.
    const unicos = [...new Set(ids)];
    const sinTel = unicos.filter(id=>{ const s = state.stops.find(x=>x.id===id); return s && !s.phone; });
    const falt = guiasFaltantes(unicos);
    const guiasLuego = falt.length ? ()=>setTimeout(()=>confirmBox("Escanear las guías",
      `${falt.length} paquete(s) quedaron sin guía. ¿Escaneas ahora el código de barras o QR de cada uno? La app te dice a qué dirección corresponde, y si tienes otro paquete en la mano eliges su dirección en la lista.`,
      ()=>startAssign(unicos)), 300) : null;
    if(sinTel.length) setTimeout(()=>confirmBox("Escribir los teléfonos",
      `${sinTel.length} parada(s) quedaron sin teléfono. ¿Los escribes ahora? Sale una lista con un campo por dirección.`,
      ()=>abrirTelefonos(sinTel, guiasLuego), guiasLuego), 400);
    else if(guiasLuego) setTimeout(guiasLuego, 100);
  }
});

let cfCb = null, cfNoCb = null;
// noCb (opcional): qué hacer si responde que no.
function confirmBox(title,msg,cb,noCb){ $("cfTitle").textContent=title; $("cfMsg").textContent=msg; cfCb=cb; cfNoCb=noCb||null; $("dlgConfirm").showModal(); }
$("cfNo").onclick = ()=>{ $("dlgConfirm").close(); const f = cfNoCb; cfNoCb = null; if(f) f(); };
$("frmConfirm").addEventListener("submit", e=>{ e.preventDefault(); $("dlgConfirm").close(); cfNoCb = null; if(cfCb) cfCb(); cfCb=null; });

let tt; function toast(m){ const t=$("toast"); t.textContent=m; t.classList.add("show"); clearTimeout(tt); tt=setTimeout(()=>t.classList.remove("show"),3200); }
