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
// Los paquetes de la bodega que aún no tienen dirección no cuentan como «siguiente» (no hay a dónde ir).
const sinDirBod = q=>typeof sinDireccion === "function" && sinDireccion(q);
function nextStop(){ return state.stops.find(q=>q.status==="pend" && q.x!==null) || state.stops.find(q=>q.status==="pend" && !sinDirBod(q)) || state.stops.find(q=>q.status==="fail" && !sinDirBod(q)); }
function mapsUrl(s){ return "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(navQuery(s)) + "&travelmode=" + (esPie() ? "walking" : "driving"); }
function mapsMultiUrl(stops){
  return "https://www.google.com/maps/dir/" + stops.map(s=>encodeURIComponent(navQuery(s))).join("/") ;
}

/* ============ Render ============ */
const $ = id => document.getElementById(id);
function esc(s){ return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

/* Tarjeta «Siguiente paso»: lo que toca ahora, con un toque.
   - Hay pendientes: «Ordenar ruta» y «Conducir» siempre a la vista (sin abrir la sección Ruta).
   - Solo quedan «No estaba»: repasarlos o cerrar el día.
   - Todo entregado: reporte, Excel, respaldo y jornada nueva.
   Cada botón hace lo mismo que su botón original (data-go = id del original). */
function renderPaso(){
  const box = $("pasoCard"), reales = state.stops.filter(s=>!s.example);
  const pend = reales.filter(s=>s.status!=="done"), fall = pend.filter(s=>s.status==="fail"), hechos = reales.filter(s=>s.status==="done");
  if(!reales.length){ box.hidden = true; return; }
  const q = l=>l.reduce((a,s)=>a+(s.qty||1),0);
  // Zonas que la bodega le asignó hoy a este repartidor (v2.36).
  const zonasBod = typeof bod !== "undefined" && bod.rid && Array.isArray(bod.zonas) && bod.zonas.length && pend.some(s=>s.bodega) ? bod.zonas : null;
  let txt, sub, btns;
  const sinDir = pend.filter(sinDirBod);
  if(sinDir.length){
    // Paquetes que asignó la bodega y aún no tienen dirección: primero se completan (escaneando cada etiqueta).
    txt = `${q(pend)} pedido(s) por entregar · ${sinDir.length} sin dirección`;
    sub = "La bodega te asignó paquetes: escanea cada etiqueta (la app la reconoce) o toca «Completar» y pon la dirección.";
    btns = [["Escanear y completar", "primary", "btnScan"], ["Ordenar ruta", "", "btnSort"]];
  } else if(pend.length > fall.length){
    const conocidas = new Set(state.suggestedIds||[]);
    const sinOrden = pend.filter(s=>!conocidas.has(s.id)).length;
    txt = `${q(pend)} pedido(s) por entregar` + (sinOrden ? ` · ${sinOrden} sin ordenar` : "");
    sub = sinOrden ? "Toca «Ordenar ruta» antes de salir." : rutaEnCurso() ? "Sigue la ruta en el modo conducción." : "Ruta ordenada. Cuando cargues el vehículo, toca «Conducir».";
    btns = [["Ordenar ruta", sinOrden ? "primary" : "", "btnSort"], ["Conducir", sinOrden ? "dark" : "primary", "btnDriveTop"]];
  } else if(pend.length){
    txt = `Te ${fall.length===1 ? "queda 1 «No estaba»" : `quedan ${fall.length} «No estaba»`} por reintentar`;
    sub = "Repásalos antes de terminar, o cierra el día.";
    btns = [["Repasar en el modo conducción", "primary ancho", "btnDriveTop"], ["Reporte del día", "", "btnReport"], ["Jornada nueva", "", "btnNew"]];
  } else {
    txt = `¡Ruta terminada! ${q(hechos)} pedido(s) entregado(s) · ${cop(q(hechos)*tarifa())}`;
    sub = "Revisa el reporte, descarga el Excel y guarda el respaldo. Mañana empieza con «Jornada nueva».";
    btns = [["Reporte del día", "primary", "btnReport"], ["Excel", "", "histCsvPed"], ["Guardar respaldo", "", "btnBackup"], ["Jornada nueva", "dark", "btnNew"]];
  }
  box.hidden = false;
  $("pasoTxt").innerHTML = `${zonasBod ? `<span class="zonasHoy">Tu zona: ${esc(zonasBod.join(", "))}</span>` : ""}${esc(txt)}<small>${esc(sub)}</small>`;
  $("pasoBtns").innerHTML = btns.map(([t, c, go])=>`<button type="button" class="${c}" data-go="${go}">${esc(t)}</button>`).join("");
}
document.getElementById("pasoBtns").addEventListener("click", e=>{ const b = e.target.closest("button[data-go]"); if(b) $(b.dataset.go).click(); });
// Pedidos con «⋯» abierto (se conserva al repintar la lista).
const abiertas = new Set();
function render(){
  const list = $("list");
  const pend = state.stops.filter(s=>s.status!=="done");
  const dirs = new Set(pend.map(stopKey)).size;
  $("stPend").textContent = dirs;
  const paq = pend.reduce((a,st)=>a+(st.qty||1),0);
  $("stPendLbl").textContent = paq !== dirs ? `direcciones · ${paq} pedidos` : "pendientes";
  $("stDone").textContent = state.stops.filter(s=>s.status==="done").length;
  renderPaso();
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
  parts.push(vehTxt());
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
  $(esPie() ? "vehPie" : esMoto() ? "vehMoto" : "vehCarro").checked = true;
  $("vehInfo").textContent = esPie()
    ? "A pie: el orden se calcula con caminos peatonales (sin sentidos de las vías) y tiempos de caminar. Úsalo solo si haces el recorrido caminando: en moto o carro ese orden sale más largo, porque igual hay que respetar los sentidos."
    : (esMoto() ? "Moto: tiempos de manejo ≈ 15 % menores (avanza en el trancón y parquea en la puerta). " : "Carro: tiempos de manejo del servidor de rutas. ")
      + "El orden de las paradas es el mismo en carro y moto: en las pruebas, el orden más corto en carro también fue el mejor en moto.";
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
  // Pedidos pendientes agrupados por dirección, para avisar cuando hay varios en la misma.
  const mismas = new Map();
  for(const st of state.stops) if(!st.example && st.status!=="done"){ const k = stopKey(st); if(!mismas.has(k)) mismas.set(k, []); mismas.get(k).push(st); }
  // Tarjetas compactas (por defecto): Waze, Llamar, Entregado y «⋯»; el resto aparece al tocar «⋯».
  const compactas = !state.tarjetasCompletas;
  const html = state.stops.map((s,idx)=>{
    const isDone = s.status==="done", isFail = s.status==="fail", unk = s.x===null, sinDir = sinDirBod(s);
    const numTxt = isDone ? "✓" : String(s.num);
    const cls = "stop" + (isDone?" done":"") + (isFail?" fail":"") + (unk&&!isDone?" unk":"") + (compactas?" compacta":"") + (compactas && abiertas.has(s.id)?" abierta":"");
    return `<li class="${cls}" data-id="${s.id}">
      <div class="num" aria-label="Parada ${numTxt}${(s.qty||1)>1?", "+s.qty+" paquetes":""}">${numTxt}${(s.qty||1)>1?`<span class="qty">×${s.qty}</span>`:""}</div>
      <div>
        <div class="addr">${sinDir ? "Falta la dirección" : esc(s.label || s.addr)}</div>
        ${s.guia ? `<div class="guiaLine">${guias(s).map(g=>`<span>${esc(g)}</span>`).join("")}</div>` : ""}
        <div class="meta">
          ${s.zone?`<span class="chip zone">ST ${esc(s.zone)}</span>`:""}
          <span class="chip unit">${esc(unitText(s))}</span>
          ${s.barrio?`<span class="chip">${esc(s.barrio)}</span>`:""}
          ${s.bodega?`<span class="chip bod">Bodega${s.bodega.emp ? " · " + esc(s.bodega.emp) : ""}</span>`:""}
          ${s.bodega && s.bodega.zona?`<span class="chip zona">Zona ${esc(s.bodega.zona)}</span>`:""}
          ${s.bodegaFuera && !isDone?'<span class="chip warn">La bodega ya no te lo tiene asignado</span>':""}
          ${unk && !sinDir?'<span class="chip warn">Revisar dirección</span>':""}
          ${s.geo==="barrio"?`<span class="chip warn">Ubicada por barrio (aprox.)</span>`:""}
          ${s.geo==="gps" && !isDone?`<span class="chip ok">Ubicación exacta</span>`:""}
          ${!isDone && zoneIssue(s)?`<span class="chip warn">Fuera de tu zona: ${esc(zoneIssue(s))}</span>`:""}
          ${s.zoneCheck && s.zoneCheck.bad?`<span class="chip warn">No coincide con ${esc(s.barrio)}: queda a ${s.zoneCheck.km.toFixed(1).replace(".",",")} km</span>`:""}
          ${isFail?'<span class="chip warn">Intento fallido</span>':""}
          ${!isDone && (mismas.get(stopKey(s))||[]).length > 1 ? `<span class="chip warn">${mismas.get(stopKey(s)).length} pedidos en esta dirección (n.º ${mismas.get(stopKey(s)).map(x=>stopNum(x)).sort((a,b)=>a-b).join(", ")})</span>` : ""}
          ${s.avisadoAt && !isDone ? `<span class="chip ok">Avisado ${hhmm(s.avisadoAt)}</span>` : ""}
          ${state.loadOn && !isDone ? (loadedOf(s) >= (s.qty||1) ? '<span class="chip ok">Cargado ✓</span>' : `<span class="chip warn">Sin verificar${(s.qty||1)>1?" "+((s.qty||1)-loadedOf(s))+" de "+s.qty:""}</span>`) : ""}
          ${s.example?'<span class="chip ex">Ejemplo</span>':""}
        </div>
        ${(s.name||s.phone)?`<div class="who">${esc(s.name)}${s.name&&s.phone?" · ":""}${s.phone?esc(s.phone.replace(/(\d{3})(\d{3})(\d{4})/,"$1 $2 $3")):""}</div>`:""}
        ${s.notes?`<div class="who">${esc(s.notes)}</div>`:""}
      </div>
      <div class="actions">
        ${sinDir ? `<button class="small primary" data-act="edit">Completar</button>` : `<a class="btn small waze" href="${wazeUrl(s)}" target="_blank" rel="noopener">Waze</a>`}
        ${compactas ? "" : `<a class="btn small" href="${mapsUrl(s)}" target="_blank" rel="noopener">Maps</a>`}
        ${s.phone && dialNumber(s.phone)?`<a class="btn small" href="tel:${dialNumber(s.phone)}">Llamar</a>`:`<button class="small" data-act="edit">Tel.</button>`}
        <button class="small ${isDone?"":"primary"}" data-act="done">${isDone?"Deshacer":"Entregado"}</button>
        ${compactas ? `<button class="small masBtn" data-act="mas" aria-label="Más acciones" aria-expanded="${abiertas.has(s.id)}">⋯</button>` : ""}
      </div>
      <div class="actions2">
        ${compactas ? `<a class="btn small" href="${mapsUrl(s)}" target="_blank" rel="noopener">Maps</a>` : ""}
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
    // Con todo entregado lo dice la tarjeta «¡Ruta terminada!» (arriba); aquí no se repite.
    (doneStops.some(s=>!s.example) ? "" : `<li class="empty">${doneStops.length ? "¡No quedan pendientes! Las entregadas están abajo, en «Pedidos entregados»." : "Sin paquetes."}</li>`);
  $("listDone").innerHTML = state.stops.map((s,i)=>s.status==="done" ? html[i] : "").join("");
}

function toggleDone(s){
  const i = state.stops.indexOf(s); if(i<0) return;
  const antes = s.status;
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
        if(typeof bodegaReportar === "function") bodegaReportar(s, antes);   // paquetes de la bodega: avisa a la bodega
        save(); render();
}
// «No estaba»: queda como intento fallido al final de los pendientes (o se quita la marca).
function toggleFail(s){
  const i = state.stops.indexOf(s); if(i<0) return;
  const antes = s.status;
  s.status = s.status==="fail" ? "pend" : "fail";
  if(s.status==="fail"){
    s.failAt = Date.now(); s.failCount = (s.failCount||0)+1;
    recordDay(); state.stops.splice(i,1);
    const firstDone = state.stops.findIndex(q=>q.status==="done");
    state.stops.splice(firstDone<0?state.stops.length:firstDone,0,s);
    toast("Marcado como no estaba. Se movió al final de los pendientes.");
  }
  if(typeof bodegaReportar === "function") bodegaReportar(s, antes);
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
    case "mas": if(abiertas.has(s.id)) abiertas.delete(s.id); else abiertas.add(s.id); render(); return;
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
/* Teclado numérico (el mismo de la placa) en los números de la dirección. Las letras y «Bis» van en una fila de
   botones que aparece al tocar el campo; «ABC» abre el teclado normal en ese campo hasta salir de él. */
const LETRAS_DIR = ["A","B","C","D","E","F","Bis"];
function filaLetras(filaId, ids){
  const fila = $(filaId);
  fila.innerHTML = LETRAS_DIR.map(l=>`<button type="button" data-l="${l}">${l}</button>`).join("")
    + `<button type="button" class="abc" data-l="abc" aria-label="Abrir el teclado con letras en este campo">ABC</button>`;
  let ultimo = null, ocultar = 0;
  const numerico = el=>el.inputMode === "numeric" || el.dataset.abc;
  // Sin perder el foco: el campo sigue activo y el teclado no se cierra al tocar una letra.
  fila.addEventListener("pointerdown", e=>{ if(e.target.closest("button")) e.preventDefault(); });
  fila.addEventListener("mousedown", e=>{ if(e.target.closest("button")) e.preventDefault(); });
  fila.addEventListener("click", e=>{
    const b = e.target.closest("button"), el = ultimo && $(ultimo);
    if(!b || !el) return;
    clearTimeout(ocultar);
    if(b.dataset.l === "abc"){ el.dataset.abc = "pend"; el.inputMode = "text"; el.blur(); setTimeout(()=>el.focus(), 30); return; }
    const v = el.value.replace(/\s+$/, ""), l = b.dataset.l;
    if(!v){ el.focus(); return; }   // la letra va después del número
    el.value = l === "Bis" ? v + " Bis" : /\d$/.test(v) ? v + l : v + " " + l;
    el.dispatchEvent(new Event("input", {bubbles:true}));
    el.focus();
  });
  for(const id of ids){
    const el = $(id);
    el.addEventListener("focus", ()=>{ clearTimeout(ocultar); ultimo = id; fila.hidden = !numerico(el); });
    el.addEventListener("blur", ()=>{
      if(el.dataset.abc === "pend") el.dataset.abc = "on";                         // cambio a «ABC»: vuelve enseguida
      else if(el.dataset.abc === "on"){ delete el.dataset.abc; el.inputMode = "numeric"; }   // salió del campo
      ocultar = setTimeout(()=>{ if(!ids.includes((document.activeElement || {}).id)) fila.hidden = true; }, 200);
    });
  }
}
filaLetras("pLetras", ["pN1","pN2"]);
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
function stopKey(x){ const p = parseAddress(x.label || x.addr); if(!p && !String(x.addr||"").trim()) return "#" + (x.id || Math.random()); return p ? p.label.toUpperCase() : norm(x.addr); }
function guias(st){ return (st.guia||"").split(/[,\s]+/).filter(Boolean); }
function hasGuia(g){ return !!findGuia(g); }
// Busca la parada que tiene esa guía (exacta). «except» deja por fuera la parada que se está editando.
function findGuia(g, except){ g = String(g||"").trim(); if(!g) return null; return state.stops.find(st=>st!==except && guias(st).includes(g)) || null; }
// Número de parada como se ve en la lista (solo cuentan las pendientes).
// Número de la parada: fijo en ruta (ver numerar() en js/02-ruta.js).
function stopNum(st){ if(!st.num) numerar(); return st.num || 0; }
function placeName(st){ const n = stopNum(st); return (st.status!=="done" && n ? "la parada " + n : "una parada ya entregada") + " (" + (st.label||st.addr) + ")"; }
// Pedidos de la misma dirección: cada uno queda como parada aparte (su guía, su número), pero se avisa.
// Excepción: si la parada ya estaba sin guía (p. ej. dictada) y llega su etiqueta, la guía se le pone a esa parada.
function mismaDireccion(st){ const k = stopKey(st); return state.stops.filter(x=>x!==st && !x.example && x.status!=="done" && stopKey(x)===k); }
function addOrMerge(d){
  const k = stopKey(d);
  const same = state.stops.find(st=>st.status!=="done" && stopKey(st)===k && d.guia && !guias(st).includes(d.guia) && guias(st).length < (st.qty||1) && (parseInt(d.qty,10)||1) === 1);
  if(same){
    same.guia = guias(same).concat(d.guia).join(", ");
    for(const f of ["phone","name","zone","barrio","unit"]) if(!same[f] && d[f]) same[f] = d[f];
    if((!same.type || same.type==="casa") && d.type && d.type!=="casa") same.type = d.type;
    return {merged:true, filled:true, stop:same};
  }
  const ns = mkStop(d); const firstDone = state.stops.findIndex(q=>q.status==="done");
  // Junto a los otros pedidos de la misma dirección (si los hay), para que queden seguidos en la lista.
  const otros = mismaDireccion(ns);
  const despues = otros.length ? state.stops.lastIndexOf(otros[otros.length-1]) + 1 : -1;
  state.stops.splice(despues > 0 ? despues : firstDone<0?state.stops.length:firstDone, 0, ns);
  return {merged:false, stop:ns, mismos: otros.length};
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
    if(typeof bodegaAvisoNuevo === "function") bodegaAvisoNuevo(r.stop);
    if(r.filled) toast(`Guía agregada a la parada que ya tenías: ${r.stop.label||r.stop.addr}.`);
    else if(r.mismos) toast(`Agregado aparte. Ojo: ahora hay ${r.mismos+1} pedidos para ${r.stop.label||r.stop.addr}.`);
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
    "Una dirección por línea. Puedes agregar al final el teléfono, la zona y la cantidad, por ejemplo: Calle 143 # 151B-23 3001234567 ST 49 x3. Si una dirección se repite, cada pedido queda aparte y la app avisa que hay varios para esa dirección.";
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
      if(r.mismos) merged++;
      if(r.filled){ ids.push(r.stop.id); return; }
      if(r.stop.x===null) bad++; else ok++;
      ids.push(r.stop.id);
    });
    save(); render(); optimize(true, {estable:true});
    toast(`${ok} ubicadas${bad?`, ${bad} para revisar`:""}${merged?`. Ojo: ${merged} con dirección repetida (cada pedido quedó aparte)`:""}. Agregadas en su lugar de la ruta.`);
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
