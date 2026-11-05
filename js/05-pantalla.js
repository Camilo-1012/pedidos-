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
  $("stPendLbl").textContent = paq !== pend.length ? `paradas · ${paq} paq.` : "pendientes";
  $("stDone").textContent = state.stops.filter(s=>s.status==="done").length;
  const sp = parseAddress(state.start);
  const geo = pend.filter(s=>s.x!==null);
  const real = state.route && state.route.mode==="real" && state.route.km!=null;
  $("stKm").textContent = geo.length ? (real ? state.route.km : pathLen(currentOrigin(),geo,!!state.roundTrip && !!sp)*KM_PER_UNIT).toFixed(1) : "0";
  $("stKmLbl").textContent = real ? "km reales" : "km aprox.";
  $("realRoads").checked = state.realRoads !== false;
  // Resumen de las opciones cuando el bloque está oculto.
  const parts = [];
  parts.push(state.startGPS ? "Desde tu ubicación" : state.start ? "Desde " + state.start : (zone().on && zone().entry ? "Entrada por " + (ZONE_ENTRIES[zone().entry]||"la zona").replace(/ \(.*\)$/,"") : "Sin punto de partida"));
  if(state.byZone) parts.push("por zona ST");
  if(state.roundTrip) parts.push("con regreso");
  parts.push(state.realRoads !== false ? "calles reales" : "orden aproximado");
  if(state.autoWaze !== false) parts.push("Waze automático");
  $("optsSum").textContent = parts.join(" · ");
  if($("routeOpts").open !== !!state.optsOpen) $("routeOpts").open = !!state.optsOpen;
  $("autoWaze").checked = state.autoWaze !== false;
  if(document.activeElement !== $("orsKey")) $("orsKey").value = state.orsKey || "";
  $("routeInfo").textContent = state.routeNote || "";
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
  if(g){
    const near = g.x!=null ? ` Aproximadamente por la Calle ${Math.round(g.y)} con Carrera ${Math.round(g.x)}.` : "";
    $("startInfo").textContent = `Arrancas desde tu ubicación (precisión ±${g.acc} m, tomada a las ${hhmm(g.t)}).${near}` + (g.acc>300 ? " La precisión es baja: activa el GPS del celular y vuelve a tocar el botón." : "");
  } else {
    const z = zone();
    $("startInfo").textContent = state.start ? (sp ? "Ubicado: " + sp.label : "No reconozco esa dirección; se ordenará sin punto de partida.")
      : (z.on && z.entry ? `Sin punto de partida: se arranca por ${ZONE_ENTRIES[z.entry]}. Mejor usa «Usar mi ubicación actual» al salir.` : "Opcional. Sin punto de partida, la app elige el recorrido más corto.");
  }

  if(state.stops.length===0){
    list.innerHTML = '<li class="empty">Sin paquetes. Toma una foto de la etiqueta para empezar.</li>';
    return;
  }
  let n = 0;
  list.innerHTML = state.stops.map((s,idx)=>{
    const isDone = s.status==="done", isFail = s.status==="fail", unk = s.x===null;
    const numTxt = isDone ? "✓" : String(++n);
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
  }).join("");
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
      if(s.status==="done"){ state.stops.splice(i,1); state.stops.push(s); if(s.x!==null) state.lastDoneId = s.id; toast((s.qty||1)>1 ? `Entregados ${s.qty} paquetes. Sigue con la parada 1.` : "Entregado. Sigue con la parada 1.");
        recordDay();
        if(state.autoWaze !== false){ const nx = nextStop(); if(nx){ save(); render(); openExternal(wazeUrl(nx)); return; } else toast("¡Terminaste! No quedan entregas pendientes."); } }
      else if(state.lastDoneId===s.id){ state.lastDoneId = null; }
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
$("list").addEventListener("click", e=>{
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
});

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
}
function updParsed(){
  const p = parseAddress($("fAddr").value);
  const zi = p ? zoneIssue(p) : null;
  $("fParsed").innerHTML = p ? `<span class="chip ok">Reconocida</span> ${esc(p.label)}` + (zi ? ` <span class="chip warn">Fuera de tu zona: ${esc(zi)}</span>` : "") :
    `<span class="chip warn">No reconocida</span> Escríbela así: Calle 143 # 151B-23 (o Cra, Dg, Tv; agrega Sur o Este si aplica).`;
}
$("fAddr").addEventListener("input", updParsed);
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
function stopNum(st){ if(st.status==="done") return 0; let n = 0; for(const x of state.stops){ if(x.status!=="done") n++; if(x===st) return n; } return 0; }
function placeName(st){ const n = stopNum(st); return (n ? "la parada " + n : "una parada ya entregada") + " (" + (st.label||st.addr) + ")"; }
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
    else toast(p ? "Paquete agregado y ruta reordenada." : "Agregado, pero la dirección quedó para revisar.");
  } else {
    const dup = guias(d).find(g=>findGuia(g, editing.s));
    if(dup){ toast(`La guía ${dup} ya está en ${placeName(findGuia(dup, editing.s))}. Revísala.`); return; }
    const changed = (p?p.label:"") !== editing.s.label;
    Object.assign(editing.s, d, {x:p?p.x:null, y:p?p.y:null, label:p?p.label:"", example:false});
    if(changed || editing.s.geo==="barrio"){ editing.s.lat = null; editing.s.lng = null; editing.s.geo = null; }
    editing.s.zoneCheck = null;
  }
  $("dlgEdit").close();
  save(); render();   // se ve de inmediato aunque haya un cálculo de ruta en curso
  optimize(true);
  if(fromScan && state.scanLoop && editing.isNew) setTimeout(()=>startScan("label"), 600);
  fromScan = false;
});

let textMode = "one";
function openText(mode){
  textMode = mode; $("txtArea").value = "";
  $("txtTitle").textContent = mode==="one" ? "Pegar texto de la etiqueta" : "Pegar varias direcciones";
  $("txtHint").textContent = mode==="one" ? "En la galería o Google Lens toca «Copiar texto» sobre la etiqueta y pégalo aquí." :
    "Una dirección por línea. Puedes agregar al final el teléfono, la zona y la cantidad, por ejemplo: Calle 143 # 151B-23 3001234567 ST 49 x3. Si una dirección se repite, se suma a la misma parada.";
  $("micBulk").hidden = mode!=="bulk"; $("micBulkMsg").hidden = true;
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
      const q = line.match(/(?:^|\s)[x×]\s*(\d{1,2})\b|\b(\d{1,2})\s*(?:paq|paquetes|unid|und)\b|\b(?:por|cantidad)\s+(\d{1,2})\b/i);
      if(q) d.qty = +(q[1]||q[2]||q[3]);
      if(d.barrio) d.barrio = d.barrio.replace(/\b(?:por|cantidad)\s+\d{1,2}\b|(?:^|\s)[x×]\s*\d{1,2}\b|\b\d{1,2}\s*(?:paq\w*|unid\w*|und)\b|\b(?:\+?57)?3\d{9}\b|\bST\s*\d+\b/gi,"").trim();
      const r = addOrMerge(d);
      if(r.merged) merged++; else if(r.stop.x===null) bad++; else ok++;
      ids.push(r.stop.id);
    });
    save(); render(); optimize(true);
    toast(`${ok} ubicadas${bad?`, ${bad} para revisar`:""}${merged?`, ${merged} sumadas a una dirección repetida`:""}. Ruta ordenada.`);
    // Lo dictado o pegado no trae guía: se ofrece escanear el código de cada paquete ya mismo.
    const falt = guiasFaltantes([...new Set(ids)]);
    if(falt.length) setTimeout(()=>confirmBox("Escanear las guías",
      `${falt.length} paquete(s) quedaron sin guía. ¿Escaneas ahora el código de barras o QR de cada uno? La app te dice a qué dirección corresponde, y si tienes otro paquete en la mano eliges su dirección en la lista.`,
      ()=>startAssign([...new Set(ids)])), 400);
  }
});

let cfCb = null;
function confirmBox(title,msg,cb){ $("cfTitle").textContent=title; $("cfMsg").textContent=msg; cfCb=cb; $("dlgConfirm").showModal(); }
$("cfNo").onclick = ()=>$("dlgConfirm").close();
$("frmConfirm").addEventListener("submit", e=>{ e.preventDefault(); $("dlgConfirm").close(); if(cfCb) cfCb(); cfCb=null; });

let tt; function toast(m){ const t=$("toast"); t.textContent=m; t.classList.add("show"); clearTimeout(tt); tt=setTimeout(()=>t.classList.remove("show"),3200); }
