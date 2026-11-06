/* Ubicación en el mapa, ubicaciones aprendidas, barrios, rutas con calles reales y zona de trabajo. */
"use strict";
/* ============ Ubicación en el mapa (OpenStreetMap) ============ */
// Cada dirección se ubica en la esquina de su calle con la vía generadora usando los datos de OpenStreetMap (Overpass).
// Los resultados se guardan en el celular, así cada dirección se busca una sola vez.
const GEO_KEY = "rutaEntregas.geo.v1";
let geoCache = store.get(GEO_KEY) || {};
function geoKey(pa){ return pa.label.toUpperCase(); }
function saveGeo(){ store.set(GEO_KEY, geoCache); }
/* ---- Ubicaciones aprendidas ----
   Al marcar Entregado se toma el GPS (si ya hay permiso) y se guarda como la posición real de esa dirección.
   Se comparte entre los usuarios del celular y solo guarda dirección → coordenadas (sin nombres ni teléfonos). */
const LEARN_KEY = "rutaEntregas.learn.v1", LEARN_MAX = 3000, LEARN_ACC = 50;
let learned = store.get(LEARN_KEY) || {};
function saveLearned(){
  const ks = Object.keys(learned);
  if(ks.length > LEARN_MAX){ ks.sort((a,b)=>learned[a].t-learned[b].t).slice(0, ks.length-LEARN_MAX).forEach(k=>delete learned[k]); }
  store.set(LEARN_KEY, learned);
}
async function geoPermission(){
  try{ const r = await navigator.permissions.query({name:"geolocation"}); return r.state; }catch(e){ return "unknown"; }
}
async function learnSpot(s){
  if(state.learnOn === false || s.example || !navigator.geolocation) return;
  const pa = parseAddress(s.label || s.addr); if(!pa) return;
  // Sin permiso ya concedido no se pregunta aquí: se abriría el aviso del navegador justo cuando sale Waze.
  if(await geoPermission() !== "granted") return;
  const doneAt = s.doneAt || Date.now();
  navigator.geolocation.getCurrentPosition(pos=>{
    const c = pos.coords, now = {lat:c.latitude, lng:c.longitude};
    // Lecturas viejas (la app quedó atrás por Waze) o imprecisas no sirven: ya podría ir lejos de la entrega.
    // Solo una lectura nueva, tomada después de tocar Entregado (no una guardada de la parada anterior).
    if(c.accuracy > LEARN_ACC || pos.timestamp < doneAt - 3000 || pos.timestamp - doneAt > 60000 || s.status !== "done") return;
    // Debe quedar cerca de donde la app creía la dirección: evita aprender si se marcó Entregado desde otro lado.
    const ref = s.lat!=null ? {lat:s.lat, lng:s.lng} : estimate(pa.x, pa.y);
    if(!ref) return;
    const maxM = (s.geo==="osm" || s.geo==="gps") ? 400 : 800;
    if(meters(now, ref) > maxM) return;
    const k = geoKey(pa), L = learned[k];
    if(L && meters(L, now) <= 150){
      // Promedio ponderado por precisión: cada entrega afina la posición.
      const w1 = (L.n||1) / (L.acc*L.acc), w2 = 1 / (c.accuracy*c.accuracy);
      learned[k] = {lat:(L.lat*w1 + now.lat*w2)/(w1+w2), lng:(L.lng*w1 + now.lng*w2)/(w1+w2), acc:Math.round(Math.min(L.acc, c.accuracy)), n:(L.n||1)+1, t:Date.now()};
    } else {
      learned[k] = {lat:now.lat, lng:now.lng, acc:Math.round(c.accuracy), n:1, t:Date.now()};
    }
    saveLearned();
    s.lat = learned[k].lat; s.lng = learned[k].lng; s.geo = "gps"; save();
  }, ()=>{}, {enableHighAccuracy:true, maximumAge:0, timeout:20000});
}
// Puntos de referencia conocidos (carrera, calle → lat, lng) para estimar la posición cuando no se encuentra la esquina.
const SEED = [
  [7.5,10.5,4.59806,-74.07583],   // Plaza de Bolívar (Cra 7 con Cl 10-11)
  [45,185,4.76194,-74.04639],     // C.C. Santafé (Cl 185 # 45-03)
  [71.6,-6.94,4.61806,-74.13503], // Plaza de las Américas (Cra 71D # 6-94 Sur)
  [35.1,-38.2,4.59167,-74.12389], // Centro Mayor (Cl 38A Sur # 34D-51)
  [62.5,26,4.64778,-74.10139],    // Gran Estación (Cl 26 # 62-47)
  [11,82.7,4.6668,-74.0531],      // Andino (Cra 11 # 82-71)
  [91,146.5,4.741,-74.084]        // Suba centro (Cra 91 con Cl 146)
];
function solve3(A,b){
  const M = A.map((r,i)=>[...r,b[i]]);
  for(let c=0;c<3;c++){
    let piv=c; for(let r=c+1;r<3;r++) if(Math.abs(M[r][c])>Math.abs(M[piv][c])) piv=r;
    [M[c],M[piv]]=[M[piv],M[c]]; if(Math.abs(M[c][c])<1e-12) return null;
    for(let r=0;r<3;r++){ if(r===c) continue; const f=M[r][c]/M[c][c]; for(let k=c;k<4;k++) M[r][k]-=f*M[c][k]; }
  }
  return [M[0][3]/M[0][0], M[1][3]/M[1][1], M[2][3]/M[2][2]];
}
// Ajuste afín ponderado: los puntos ya ubicados cerca pesan más, así la estimación mejora con el uso.
function estimate(x,y){
  const pts = SEED.map(r=>({x:r[0],y:r[1],lat:r[2],lng:r[3],w:0.3}));
  for(const k in geoCache){ const c = geoCache[k]; if(c.src==="osm" && c.x!=null) pts.push({x:c.x,y:c.y,lat:c.lat,lng:c.lng,w:1}); }
  const AtA=[[0,0,0],[0,0,0],[0,0,0]], b1=[0,0,0], b2=[0,0,0];
  for(const p of pts){
    const d = Math.hypot(p.x-x,p.y-y), w = p.w/(1+(d/15)*(d/15)), v=[1,p.x,p.y];
    for(let i=0;i<3;i++){ for(let j=0;j<3;j++) AtA[i][j]+=w*v[i]*v[j]; b1[i]+=w*v[i]*p.lat; b2[i]+=w*v[i]*p.lng; }
  }
  const a = solve3(AtA,b1), c = solve3(AtA,b2);
  if(!a||!c) return null;
  return {lat:a[0]+a[1]*x+a[2]*y, lng:c[0]+c[1]*x+c[2]*y};
}
function meters(a,b){
  const R=6371000, toR=Math.PI/180, dLat=(b.lat-a.lat)*toR, dLng=(b.lng-a.lng)*toR;
  const h = Math.sin(dLat/2)**2 + Math.cos(a.lat*toR)*Math.cos(b.lat*toR)*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}
// Expresión regular (POSIX, para Overpass) que reconoce el nombre de la vía en OpenStreetMap: "Calle 143", "Carrera 151B", "Avenida Calle 145", "Calle 40 Sur"...
function nameRe(axis, o, sur, este, strict){
  const t = axis==="calle" ? "(avenida calle|avenida diagonal|calle|diagonal|ac|cl|dg)" : "(avenida carrera|avenida transversal|carrera|transversal|ak|kr|tv)";
  let r = "^" + t + "[ .]*0*" + o.n;
  if(strict){ if(o.l1) r += " ?" + o.l1.toLowerCase(); if(o.bis) r += " ?bis"; if(o.l2) r += " ?" + o.l2.toLowerCase(); }
  else r += "( ?[a-h])?( ?bis)?( ?[a-h])?";
  const suf = axis==="calle" ? (sur ? " sur" : "") : (este ? " este" : "");
  return r + suf + "$";
}
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
async function fetchT(url, opts, ms){
  const ctl = new AbortController(); const t = setTimeout(()=>ctl.abort(), ms||20000);
  try{ return await fetch(url, {...(opts||{}), signal: ctl.signal}); } finally { clearTimeout(t); }
}
async function overpass(q){
  let lastErr;
  for(const ep of OVERPASS){
    try{
      const r = await fetchT(ep, {method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"}, body:"data="+encodeURIComponent(q)}, 25000);
      if(!r.ok) throw new Error("Overpass " + r.status);
      return await r.json();
    }catch(e){ lastErr = e; }
  }
  throw lastErr || new Error("Overpass sin respuesta");
}
async function cornerOSM(pa, strict){
  const P = pa.parts, other = P.axis==="calle" ? "carrera" : "calle";
  const re1 = nameRe(P.axis, P.p, P.sur, P.este, strict), re2 = nameRe(other, P.g, P.sur, P.este, strict);
  const keys = '~"^(name|alt_name|official_name|old_name|short_name)$"';
  const q = `[out:json][timeout:20];area["wikidata"="Q2841"]->.b;` +
    `way(area.b)["highway"][${keys}~"${re1}",i]->.a;` +
    `way(area.b)["highway"][${keys}~"${re2}",i]->.c;` +
    `node(w.a)(w.c);out;`;
  const j = await overpass(q);
  return (j.elements||[]).filter(e=>e.type==="node").map(e=>({lat:e.lat,lng:e.lon}));
}
// Ubica una dirección: esquina exacta si existe en el mapa; si no, estimación por los puntos de referencia.
const MISS_KEY = "rutaEntregas.geomiss.v1";
let geoMiss = store.get(MISS_KEY) || {};
let overpassDown = false;
async function geocode(pa){
  const k = geoKey(pa);
  if(learned[k]) return {lat:learned[k].lat, lng:learned[k].lng, src:"gps", x:pa.x, y:pa.y};
  if(geoCache[k]) return geoCache[k];
  const est = estimate(pa.x, pa.y);
  const estRes = est ? {...est, src:"est", x:pa.x, y:pa.y} : null;
  // Si esta esquina no apareció en el mapa en las últimas 24 h, o el servicio está caído, no se vuelve a preguntar.
  if(overpassDown || (geoMiss[k] && Date.now()-geoMiss[k] < 864e5)) return estRes;
  let hit = null;
  for(const strict of [true,false]){
    let nodes;
    try{ nodes = await cornerOSM(pa, strict); }
    catch(e){ overpassDown = true; console.warn("Overpass", e); return estRes; }
    if(nodes.length){
      const ref = est || nodes[0];
      nodes.sort((a,b)=>meters(a,ref)-meters(b,ref));
      const near = nodes.filter(n=>meters(n,nodes[0])<200);
      const c = {lat:near.reduce((s,n)=>s+n.lat,0)/near.length, lng:near.reduce((s,n)=>s+n.lng,0)/near.length};
      if(!est || meters(c,est) < 6000){ hit = c; break; }
    }
  }
  if(hit){ const res = {...hit, src:"osm", x:pa.x, y:pa.y, t:Date.now()}; geoCache[k] = res; saveGeo(); return res; }
  geoMiss[k] = Date.now(); store.set(MISS_KEY, geoMiss);   // las estimaciones no se guardan: mejoran con más esquinas ubicadas
  return estRes;
}
async function locateAll(list, onProgress){
  let i = 0;
  for(const s of list){
    i++;
    const pa = parseAddress(s.label || s.addr); if(!pa) continue;
    const had = !!geoCache[geoKey(pa)] || !!learned[geoKey(pa)];
    if(onProgress && !had) onProgress(i, list.length);
    const g = await geocode(pa);
    if(g){ s.lat = g.lat; s.lng = g.lng; s.geo = g.src; }
    if(!had) await new Promise(r=>setTimeout(r, 250)); // no saturar el servicio gratuito
  }
}

/* ============ Barrios: validar y aproximar ============ */
// Busca el barrio en OpenStreetMap. Sirve para (1) avisar si una dirección quedó lejos del barrio que dice la etiqueta
// (casi siempre es un error de lectura o de escritura) y (2) ubicar en el centro del barrio una dirección que no se entendió.
const BARRIO_KEY = "rutaEntregas.barrios.v1";
let barrioCache = store.get(BARRIO_KEY) || {};
const LOCALIDADES = new Set(["USAQUEN","CHAPINERO","SANTA FE","SAN CRISTOBAL","USME","TUNJUELITO","BOSA","KENNEDY","FONTIBON","ENGATIVA","SUBA",
  "BARRIOS UNIDOS","TEUSAQUILLO","LOS MARTIRES","ANTONIO NARINO","PUENTE ARANDA","LA CANDELARIA","RAFAEL URIBE URIBE","RAFAEL URIBE","CIUDAD BOLIVAR","SUMAPAZ","BOGOTA","BOGOTA DC","BOGOTA D C"]);
const BARRIO_MAX_M = 1500;   // más lejos que esto del barrio, la dirección se marca para revisar
function barrioRe(name){
  const base = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/^(barrio|urbanizacion|urb)\.?\s+/,"")
    .replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();
  const map = {a:"[aá]",e:"[eé]",i:"[ií]",o:"[oó]",u:"[uúü]",n:"[nñ]"," ":" +"};
  const body = [...base].map(ch=>map[ch]||ch).join("");
  return {key: base, re: "^((barrio|urbanizaci[oó]n|urb[.]?) +)?" + body + "( +(i|ii|iii|iv|v|vi|[0-9]+))?( +(sector|etapa)( +[ivx0-9]+)?)?$"};
}
async function findBarrio(name){
  if(!name) return null;
  const k0 = norm(name).replace(/[.,]/g,"").trim();
  if(LOCALIDADES.has(k0)) return {localidad:true};
  const {key, re} = barrioRe(name);
  if(key.length < 4) return null;
  const c = barrioCache[key];
  if(c && c.list) return c;
  if(c && c.miss && Date.now()-c.t < 7*864e5) return null;
  if(overpassDown) return null;
  const q = `[out:json][timeout:20];area["wikidata"="Q2841"]->.b;(` +
    `nwr(area.b)["place"~"^(neighbourhood|suburb|quarter|hamlet|village|locality)$"]["name"~"${re}",i];` +
    `nwr(area.b)["landuse"="residential"]["name"~"${re}",i];` +
    `nwr(area.b)["boundary"="administrative"]["name"~"${re}",i];);out center 10;`;
  let j;
  try{ j = await overpass(q); }catch(e){ overpassDown = true; return null; }
  const list = (j.elements||[]).map(e=>({lat: e.lat!=null ? e.lat : e.center && e.center.lat, lng: e.lon!=null ? e.lon : e.center && e.center.lon})).filter(x=>x.lat!=null);
  barrioCache[key] = list.length ? {list, t:Date.now()} : {miss:true, t:Date.now()};
  store.set(BARRIO_KEY, barrioCache);
  return list.length ? barrioCache[key] : null;
}
// Posición aproximada en la cuadrícula (calle/carrera) a partir de lat/lng, para que el orden aproximado también funcione.
// Sin internet: calle y carrera aproximadas del GPS, con los puntos conocidos más cercanos (esquinas del mapa ya
// ubicadas y direcciones aprendidas al entregar). Con internet se confirma con los nombres de las calles (cruceDeGps).
function inverseEstimate(lat, lng){
  const pts = SEED.map(r=>({x:r[0],y:r[1],lat:r[2],lng:r[3],w:0.3}));
  for(const k in geoCache){ const c = geoCache[k]; if(c.src==="osm" && c.x!=null) pts.push({x:c.x,y:c.y,lat:c.lat,lng:c.lng,w:1}); }
  for(const k in learned){ const pa = parseAddress(k), L = learned[k]; if(pa && L.acc <= LEARN_ACC) pts.push({x:pa.x,y:pa.y,lat:L.lat,lng:L.lng,w:2}); }
  const AtA=[[0,0,0],[0,0,0],[0,0,0]], bx=[0,0,0], by=[0,0,0];
  for(const p of pts){
    // Peso local: los puntos a menos de ~1 km mandan; los lejanos solo ayudan si no hay cercanos.
    const d = meters(p,{lat,lng})/1000, w = p.w/(1+(d/0.8)**4), v=[1,p.lat,p.lng];
    for(let i=0;i<3;i++){ for(let j=0;j<3;j++) AtA[i][j]+=w*v[i]*v[j]; bx[i]+=w*v[i]*p.x; by[i]+=w*v[i]*p.y; }
  }
  const a = solve3(AtA,bx), b = solve3(AtA,by);
  return a && b ? {x:a[0]+a[1]*lat+a[2]*lng, y:b[0]+b[1]*lat+b[2]*lng} : null;
}
// Dirección aproximada de un punto de la cuadrícula (x = carrera, y = calle), sobre la vía más cercana:
// {x:106.6, y:145.1} → «Calle 145 # 106-60». Sirve para mostrar dónde quedó la ubicación GPS.
function direccionAprox(p){
  if(!p || p.x==null || p.y==null || p.x < 1 || p.y < 1) return "";
  const cl = Math.round(p.y), kr = Math.round(p.x);
  const placa = v => String(Math.min(99, Math.max(1, Math.round((v - Math.floor(v)) * 100)))).padStart(2, "0");
  return Math.abs(p.y - cl) <= Math.abs(p.x - kr)
    ? `Calle ${cl} # ${Math.floor(p.x)}-${placa(p.x)}`
    : `Carrera ${kr} # ${Math.floor(p.y)}-${placa(p.y)}`;
}
// Con internet: la calle y la carrera más cercanas al GPS, por sus nombres en OpenStreetMap («Carrera 149C con Calle 137»).
// Devuelve también x, y en la cuadrícula de la app, para que el orden sin internet y los sectores partan del lugar correcto.
const VIA_NOMBRE = /^(AVENIDA CALLE|AVENIDA CARRERA|AV\.? CALLE|AV\.? CARRERA|CALLE|CARRERA|DIAGONAL|TRANSVERSAL|AC|AK|CL|CLL|KR|CRA|DG|TV)\.?\s+(\d{1,3}(?:\s?[A-H])?(?:\s?BIS)?(?:\s?[A-H])?)(?:\s+(SUR|ESTE))?(?![\dA-Z])/;
function viaDeNombre(n){
  const t = String(n||"").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ").trim();
  const m = VIA_NOMBRE.exec(t); if(!m) return null;
  const v = viaInfo(m[1]); if(!v) return null;
  // El nombre con el mismo formato que las direcciones de la app («Carrera 149C», «Calle 136A Bis»).
  const pa = parseAddress(`${m[1]} ${m[2]}${m[3] ? " " + m[3] : ""} # 1-01`);
  return pa ? {axis: v.axis, nombre: pa.label.split(" # ")[0], num: m[2] + (m[3] ? " " + m[3] : "")} : null;
}
function metrosAVia(p, geom){
  const kx = 111320*Math.cos(p.lat*Math.PI/180), ky = 110540;
  let best = Infinity;
  for(let i=1;i<geom.length;i++){
    const ax = (geom[i-1].lon-p.lng)*kx, ay = (geom[i-1].lat-p.lat)*ky, bx = (geom[i].lon-p.lng)*kx, by = (geom[i].lat-p.lat)*ky;
    const dx = bx-ax, dy = by-ay, L = dx*dx+dy*dy, u = L ? Math.max(0, Math.min(1, -(ax*dx+ay*dy)/L)) : 0;
    best = Math.min(best, Math.hypot(ax+u*dx, ay+u*dy));
  }
  return best;
}
async function cruceDeGps(lat, lng){
  const j = await overpass(`[out:json][timeout:12];way(around:180,${lat},${lng})["highway"]["name"];out tags geom;`);
  let calle = null, carrera = null;
  for(const w of j.elements||[]){
    if(!w.geometry || w.geometry.length < 2) continue;
    const tg = w.tags||{};
    const v = [tg.name, tg.alt_name, tg.official_name, tg.old_name].map(viaDeNombre).find(Boolean);
    if(!v) continue;
    const d = metrosAVia({lat,lng}, w.geometry);
    if(v.axis==="calle"){ if(!calle || d < calle.d) calle = {...v, d}; }
    else if(!carrera || d < carrera.d) carrera = {...v, d};
  }
  if(!calle && !carrera) return null;
  const pa = calle && carrera ? parseAddress(`${carrera.nombre} # ${calle.num}-01`) : null;
  const pri = !calle ? carrera : !carrera ? calle : (calle.d <= carrera.d ? calle : carrera), otro = pri===calle ? carrera : calle;
  return {texto: otro ? `${pri.nombre} con ${otro.nombre}` : pri.nombre, x: pa ? pa.x : null, y: pa ? pa.y : null};
}
// Con internet: barrio del punto, según OpenStreetMap. Una consulta por toque del botón.
async function lugarDeGps(lat, lng){
  const ctl = new AbortController(), to = setTimeout(()=>ctl.abort(), 7000);
  try{
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=es`, {signal: ctl.signal});
    if(!r.ok) return null;
    const a = (await r.json()).address || {};
    return {barrio: a.neighbourhood || a.quarter || a.suburb || ""};
  }catch(e){ return null; } finally { clearTimeout(to); }
}
async function checkBarrios(onProgress){
  const pend = state.stops.filter(s=>s.status!=="done");
  // 1) Direcciones que no se entendieron pero traen barrio: se ubican en el centro del barrio.
  const located = pend.filter(s=>s.lat!=null && s.geo==="osm");
  const cLat = located.length ? located.reduce((a,s)=>a+s.lat,0)/located.length : 4.70, cLng = located.length ? located.reduce((a,s)=>a+s.lng,0)/located.length : -74.07;
  // Si solo se escribió el barrio (p. ej. «Villa María»), ese texto se usa como barrio.
  for(const s of pend.filter(s=>(s.x===null || s.geo==="barrio") && (s.barrio || s.addr) && !parseAddress(s.label||s.addr))){
    if(!s.barrio) s.barrio = s.addr.replace(/^REVISAR:\s*/i,"").trim();
    if(onProgress) onProgress(s);
    const b = await findBarrio(s.barrio);
    if(!b || !b.list) continue;
    const best = b.list.slice().sort((p,q)=>meters(p,{lat:cLat,lng:cLng})-meters(q,{lat:cLat,lng:cLng}))[0];
    const inv = inverseEstimate(best.lat, best.lng);
    if(!inv) continue;
    s.lat = best.lat; s.lng = best.lng; s.geo = "barrio"; s.x = inv.x; s.y = inv.y; s.zoneCheck = null;
  }
  // 2) Direcciones ubicadas que dicen un barrio: se revisa que queden cerca de él.
  for(const s of pend.filter(s=>s.barrio && s.lat!=null && s.geo!=="barrio")){
    const b = await findBarrio(s.barrio);
    if(!b || !b.list){ s.zoneCheck = null; continue; }
    const d = Math.min(...b.list.map(p=>meters(p,{lat:s.lat,lng:s.lng})));
    s.zoneCheck = d > BARRIO_MAX_M ? {bad:true, km:d/1000} : {ok:true};
  }
}

/* ============ Rutas con calles reales ============ */
// Se prueban varios servidores en orden; si uno falla o está saturado se pasa al siguiente.
// Al final, si hay clave, openrouteservice. Si todo falla, la app usa el orden aproximado.
const OSRM_SERVERS = [
  {name:"OSRM (servidor de OpenStreetMap)", base:"https://routing.openstreetmap.de/routed-car"},
  {name:"OSRM (servidor de demostración)", base:"https://router.project-osrm.org"}
];
let ROUTE_GEOM = null;
const ll = c => c.lng.toFixed(6)+","+c.lat.toFixed(6);
const sleep = ms => new Promise(r=>setTimeout(r,ms));
async function getJSON(url, opts, ms){
  // Un reintento ante error de red, saturación (429) o falla del servidor (5xx).
  let last;
  for(let attempt=0; attempt<2; attempt++){
    try{
      const r = await fetchT(url, opts, ms);
      if(r.status===429 || r.status>=500){ last = new Error("HTTP "+r.status); await sleep(1200); continue; }
      if(!r.ok) throw new Error("HTTP "+r.status);
      return await r.json();
    }catch(e){ last = e; if(e.name==="AbortError") break; await sleep(800); }
  }
  throw last || new Error("sin respuesta");
}
async function matrix(coords){
  const errs = [];
  for(const sv of OSRM_SERVERS){
    try{
      const j = await getJSON(sv.base + "/table/v1/driving/" + coords.map(ll).join(";") + "?annotations=duration,distance", {}, 25000);
      if(j.code!=="Ok" || !j.durations) throw new Error(j.code||"respuesta inválida");
      return {durations:j.durations, distances:j.distances||null, provider:sv.name};
    }catch(e){ errs.push(sv.name+": "+e.message); }
  }
  const key = (state.orsKey||"").trim();
  if(key && coords.length <= 59){
    try{
      const j = await getJSON("https://api.openrouteservice.org/v2/matrix/driving-car", {method:"POST",
        headers:{"Authorization":key,"Content-Type":"application/json"},
        body:JSON.stringify({locations:coords.map(c=>[c.lng,c.lat]), metrics:["duration","distance"], units:"m"})}, 30000);
      if(!j.durations) throw new Error("respuesta inválida");
      return {durations:j.durations, distances:j.distances||null, provider:"openrouteservice"};
    }catch(e){ errs.push("openrouteservice: "+e.message); }
  }
  throw new Error(errs.join(" · ") || "sin servidores");
}
async function routeGeom(coords){
  for(const sv of OSRM_SERVERS){
    try{
      const parts = [];
      for(let i=0;i<coords.length-1;i+=49){
        const chunk = coords.slice(i, i+50);
        const j = await getJSON(sv.base + "/route/v1/driving/" + chunk.map(ll).join(";") + "?overview=full&geometries=geojson", {}, 25000);
        if(j.code!=="Ok" || !j.routes || !j.routes[0]) throw new Error(j.code);
        parts.push(...j.routes[0].geometry.coordinates.map(([lng,lat])=>[lat,lng]));
      }
      return parts;
    }catch(e){ console.warn("trazado", sv.name, e); }
  }
  return null;
}
const MOTO_TIEMPO = 0.85;
async function realOrder(silent){
  overpassDown = false;
  const sp = parseAddress(state.start);
  // Primero, las direcciones no entendidas que traen barrio se ubican por barrio (así entran en la ruta).
  await checkBarrios(s=>setRouteInfo(`Buscando el barrio ${s.barrio}…`)).catch(e=>console.warn("barrios", e));
  const pendNow = state.stops.filter(s=>s.status!=="done" && s.x!==null);
  // Ubicar paradas y punto de partida.
  const toLocate = pendNow.filter(s=>(s.lat==null || s.geo!=="osm") && s.geo!=="barrio");
  if(sp && !state.startGPS && !(state.startGeo && state.startGeo.label===sp.label && state.startGeo.geo==="osm")){
    const ps = {label:sp.label, addr:state.start}; await locateAll([ps]);
    if(ps.lat!=null) state.startGeo = {label:sp.label, lat:ps.lat, lng:ps.lng, geo:ps.geo};
  }
  await locateAll(toLocate, (i,n)=>setRouteInfo(`Ubicando direcciones en el mapa… ${i} de ${n}`));
  // Con las direcciones ya ubicadas, se valida cada una contra su barrio.
  await checkBarrios().catch(e=>console.warn("barrios", e));
  save();
  let origin = currentOrigin();
  // Ubicar la entrada a la zona (esquina de la Av. Cali con la calle elegida).
  if(origin && origin.entry && origin.lat==null){
    const pe = parseAddress(`Avenida Carrera ${zone().minCra} # ${origin.y}-00`);
    const g = pe ? await geocode(pe) : null;
    const e = g || estimate(origin.x, origin.y);
    if(e){ state.entryGeo = {calle:origin.y, lat:e.lat, lng:e.lng}; save(); origin = currentOrigin(); }
  }
  const back = !!state.roundTrip && !!sp;
  const geo = pendNow.filter(s=>s.lat!=null);
  if(geo.length < 1) throw new Error("ninguna dirección ubicada");
  if(geo.length + 1 > 100) throw new Error("más de 99 paradas");
  setRouteInfo("Calculando tiempos con las calles reales…");
  const hasO = origin && origin.lat!=null;
  const pts = hasO ? [origin, ...geo] : geo.slice();
  const j = await matrix(pts.map(p=>({lat:p.lat,lng:p.lng})));
  const n = pts.length, D = j.durations, KM = j.distances || null;
  // Celdas sin dato: se estiman con la cuadrícula (≈ 25 s por cuadra).
  for(let a=0;a<n;a++) for(let b=0;b<n;b++) if(D[a][b]==null) D[a][b] = gridDist(pts[a],pts[b])*25;
  const SYM = D.map((r,a)=>r.map((v,b)=>(v + D[b][a])/2));
  IDX.clear(); pts.forEach((p,i)=>IDX.set(p,i));
  const o = hasO ? origin : null;
  // El orden es el mismo para carro y moto: en el banco de pruebas (simulador de calles con sentidos y giros), el orden
  // con los tiempos del servidor resultó el mejor también para moto; la moto solo cambia el tiempo estimado (más abajo).
  const moto = esMoto();
  const COST = D;
  let ordered;
  try{
    MATRIX = SYM;  ordered = orderStops(o, geo, back);
    const blocks = lastBlocks;
    MATRIX = COST; ordered = refinarPorTramos(o, ordered, back, blocks);   // ajuste final con sentidos reales (ida ≠ vuelta), sin mezclar tramos
    if(optEstable && rutaEnCurso()) ordered = estabilizar(o, ordered, back); else state.mejoraRuta = null;
  } finally { MATRIX = null; }
  // Totales reales.
  let sec = 0, m = 0, prev = o || ordered[0];
  for(const s of ordered){ sec += COST[IDX.get(prev)][IDX.get(s)]; if(KM) m += KM[IDX.get(prev)][IDX.get(s)] || 0; prev = s; }
  if(back && o){ sec += COST[IDX.get(prev)][IDX.get(o)]; if(KM) m += KM[IDX.get(prev)][IDX.get(o)] || 0; }
  // En moto el tiempo de manejo se estima ≈ 15 % menor (avanza en el trancón y parquea en la puerta).
  if(moto) sec *= MOTO_TIEMPO;
  IDX.clear();
  LASTM = {idx: new Map(pts.map((p,i)=>[p===o ? "__o" : p.id, i])), D: moto ? COST.map(r=>r.map(v=>v*MOTO_TIEMPO)) : D, KM, okey: originKey(o)};
  applyOrder(ordered.map(s=>s.id));
  state.suggestedIds = ordered.map(s=>s.id);
  const est = geo.filter(s=>s.geo!=="osm").length;
  state.route = {mode:"real", km: KM ? m/1000 : null, min: sec/60};
  const outN = geo.filter(s=>zoneIssue(s)).length;
  setRouteInfo(`Ruta con calles reales: ${KM ? (m/1000).toFixed(1)+" km · " : ""}${Math.round(sec/60)} min en ${moto ? "moto" : "carro"} sin trancón, más el tiempo en cada entrega. Calculada con ${j.provider}. ` +
    `Orden ${lastStrategy}${o && o.entry ? ", entrando por " + o.label : ""}${outN && zone().outLast ? `; ${outN} fuera de zona al final` : ""}.` +
    (est ? ` ${est} dirección(es) ubicadas de forma aproximada (borde punteado en el mapa).` : "") +
    (geo.filter(s=>s.zoneCheck && s.zoneCheck.bad).length ? ` Atención: ${geo.filter(s=>s.zoneCheck && s.zoneCheck.bad).length} dirección(es) quedaron lejos del barrio que dice la etiqueta; revísalas.` : ""));
  save(); render();
  // Trazado para el mapa (no bloquea el orden si falla).
  try{
    const seq = (o ? [o] : []).concat(ordered).concat(back && o ? [o] : []);
    if(seq.length>1){ ROUTE_GEOM = await routeGeom(seq.map(p=>({lat:p.lat,lng:p.lng}))); drawMap(); }
  }catch(e){ console.warn("trazado", e); }
}

/* ============ Zona de trabajo ============ */
// Zona por defecto: Suba al occidente de la Av. Ciudad de Cali (que en Suba es la Av. Carrera 104, según el IDU),
// hasta el río Bogotá; al sur el río Juan Amarillo y al norte la Calle 175 aprox. Los límites se pueden ajustar.
const ZONE_DEFAULT = {on:true, minCra:104, maxCra:170, minCl:125, maxCl:175, name:"Suba occidental: de la Av. Ciudad de Cali hacia el río Bogotá",
  entry:145, sectors:true, outLast:true, cuts:[132,139,145,153]};
// Entradas a la zona sobre la Av. Ciudad de Cali (Av. Carrera 104).
const ZONE_ENTRIES = {132:"Av. Cali con Calle 132 (Av. El Tabor)", 139:"Av. Cali con Calle 139", 145:"Av. Cali con Calle 145 (Portal Suba)", 153:"Av. Cali con Calle 153 (Av. Las Mercedes)"};
// Barrios de la zona (UPZ 71 Tibabuyes, Decreto 430 de 2004, y barrios vecinos al occidente de la Av. Cali). Sirven para sugerir y unificar nombres.
const ZONE_BARRIOS = ["Tibabuyes","Tibabuyes Universal","Sabana de Tibabuyes","San Pedro de Tibabuyes","San Carlos de Tibabuyes","San Carlos de Suba",
  "Lisboa","Berlín","Bilbao","Santa Cecilia","Santa Rita","Villa Cindy","La Isabela","Verona","San Juan Bautista","Villa Nelly","Marichuela",
  "La Aurora","La Fortaleza","Toscana","La Gaitana","Nueva Gaitana","Fontanar del Río","Rincón de Santa Inés","Ciudadela Cafam II",
  "Nuevo Corinto","Las Flores","Villa María","Suba Compartir","Compartir","Rincón de Suba","La Frontera","Atenas","Puerta del Sol","Villa de las Flores"];
function zone(){ return Object.assign({}, ZONE_DEFAULT, state.zone||{}); }
// Devuelve el motivo si la parada queda fuera de la zona, o null.
function zoneIssue(s){
  const z = zone(); if(!z.on || s.x==null || s.y==null) return null;
  if(s.y < 0) return "es dirección Sur";
  if(s.x < 0) return "es dirección Este";
  if(s.x < z.minCra) return `queda al oriente (Carrera ${Math.floor(s.x)}; tu zona empieza en la ${z.minCra})`;
  if(z.maxCra > z.minCra && s.x > z.maxCra + 1) return `queda más al occidente (Carrera ${Math.floor(s.x)}; tu zona llega hasta la ${z.maxCra})`;
  if(s.y < z.minCl) return `queda al sur (Calle ${Math.floor(s.y)}; tu zona empieza en la ${z.minCl})`;
  if(z.maxCl > z.minCl && s.y > z.maxCl + 1) return `queda al norte (Calle ${Math.floor(s.y)}; tu zona llega hasta la ${z.maxCl})`;
  return null;
}
function canonBarrio(name){
  const k = norm(name||"").replace(/[.,]/g,"").trim();
  return ZONE_BARRIOS.find(b=>norm(b)===k) || (name||"").trim();
}
function renderZoneSettings(){
  const z = zone();
  $("zOn").checked = z.on; $("zName").textContent = z.name;
  $("zEntry").value = String(z.entry||0); $("zSectors").checked = !!z.sectors; $("zOutLast").checked = !!z.outLast;
  for(const [id,k] of [["zMinCra","minCra"],["zMaxCra","maxCra"],["zMinCl","minCl"],["zMaxCl","maxCl"]]) if(document.activeElement!==$(id)) $(id).value = z[k];
  const dl = $("barriosZona"); if(!dl.childElementCount) dl.innerHTML = ZONE_BARRIOS.map(b=>`<option value="${esc(b)}"></option>`).join("");
}
