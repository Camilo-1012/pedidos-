/* Estado de la jornada y optimización del orden de entrega. */
"use strict";
/* ============ Estado ============ */
let state = store.get(KEY) || {stops:[], start:"", byZone:false, seeded:false};
if(!state.seeded && state.stops.length===0){
  // Ejemplos visibles al abrir por primera vez (se pueden borrar)
  const ex = [
    ["Calle 145 # 103B-90","Zona 49"],["Carrera 91 # 147-20","Zona 49"],["Calle 138 # 100-15","Zona 18"],
    ["Calle 143 # 151B-23","Zona 18"],["Carrera 104 # 152-30","Zona 49"],["Calle 132 # 111A-40","Zona 18"]
  ];
  state.stops = ex.map(([a,z],i)=>mkStop({addr:a,zone:z.replace("Zona ",""),name:"Ejemplo "+(i+1),example:true}));
  state.seeded = true;
}
function mkStop(d){
  const p = parseAddress(d.addr);
  return {id:Date.now().toString(36)+Math.random().toString(36).slice(2,7), addr:d.addr||"", name:d.name||"", phone:d.phone||"",
    zone:d.zone||"", barrio:d.barrio||"", guia:d.guia||"", qty:Math.max(1,Math.min(99,parseInt(d.qty,10)||1)), type:d.type||"casa", unit:d.unit||"", notes:d.notes||"", raw:d.raw||"", example:!!d.example,
    x:p?p.x:null, y:p?p.y:null, label:p?p.label:"", status:"pend", created: Date.now() + (mkStop.seq = (mkStop.seq||0)+1)/1000};
}
function save(){
  numerar();
  store.set(KEY,state);
  // Equipo en la nube: programa la subida de los cambios (ver js/11-equipo.js).
  if(typeof onStateSaved === "function") onStateSaved();
}

/* ============ Optimización de ruta ============ */
// Distancia en "cuadras": la ciudad es una cuadrícula, así que se suma lo recorrido en calles y en carreras
// (distancia Manhattan), que se parece más a lo que anda un carro o una moto que la línea recta.
// Sin calles reales, cruzar una avenida principal de la zona (Calle 132, 139, 145, 153) se penaliza con ≈ 2 cuadras:
// hay que buscar el semáforo o el puente, no se cruza por cualquier cuadra.
// (Se probó una penalidad menor para moto y daba rutas peores en el banco de pruebas: se usa la misma para ambos.)
const CROSS_PENALTY = 2;
const esMoto = ()=>typeof state !== "undefined" && state && state.vehiculo === "moto";
function gridDist(a,b){
  let d = Math.abs(a.x-b.x) + Math.abs(a.y-b.y);
  const st = typeof state !== "undefined" ? state : null;
  if(!st || !st.zone || st.zone.on !== false){
    const cuts = (st && st.zone && st.zone.cuts) || [132,139,145,153];
    const lo = Math.min(a.y,b.y), hi = Math.max(a.y,b.y);
    for(const c of cuts) if(lo < c && hi >= c) d += CROSS_PENALTY;
  }
  return d;
}
// Cuando hay internet se usa una matriz de tiempos reales en carro (segundos); IDX dice qué fila corresponde a cada punto.
let MATRIX = null; const IDX = new Map();
const dist = (a,b) => (MATRIX && IDX.has(a) && IDX.has(b)) ? MATRIX[IDX.get(a)][IDX.get(b)] : gridDist(a,b);
const KM_PER_UNIT = 0.1; // ~100 m por número de calle/carrera (aproximado)

// Costo total de un recorrido: desde el inicio (si hay), por todas las paradas y, si se pide, de vuelta al inicio.
function pathLen(start, path, back){
  if(!path.length) return 0;
  let L = 0, prev = start || path[0];
  for(const p of path){ L += dist(prev,p); prev = p; }
  if(back && start) L += dist(prev,start);
  return L;
}

/* ---- Núcleo del optimizador (por índices, con cálculo incremental) ----
   Se arma una sola vez la tabla de costos entre todos los puntos (C[i*N+j]); el inicio, si hay, es el índice 0.
   Los movimientos de mejora (2-opt, or-opt) calculan solo lo que cambia: cada intento cuesta O(1) en vez de recorrer
   toda la ruta. Así 99 paradas se ordenan en una fracción de segundo también en un celular. */
function tabla(start, pts){
  const all = start ? [start, ...pts] : pts.slice(), N = all.length, C = new Float64Array(N*N);
  for(let i=0;i<N;i++) for(let j=0;j<N;j++) C[i*N+j] = i===j ? 0 : dist(all[i], all[j]);
  return {all, N, C, s: start ? 0 : -1};
}
// Costo de un camino de índices P (sin el inicio), saliendo de s y, si back, volviendo a s.
function largo(T, P, back){
  const {C, N, s} = T; if(!P.length) return 0;
  let L = 0, prev = s >= 0 ? s : P[0];
  for(const i of P){ L += C[prev*N+i]; prev = i; }
  if(back && s >= 0) L += C[prev*N+s];
  return L;
}
function vecinoI(T, P0, first){
  const {C, N, s} = T, rest = new Set(P0), path = [];
  let cur = s;
  if(first != null){ path.push(first); rest.delete(first); cur = first; }
  else if(cur < 0){ cur = P0[0]; path.push(cur); rest.delete(cur); }
  while(rest.size){
    let bi = -1, bd = Infinity;
    for(const i of rest){ const d = C[cur*N+i]; if(d < bd){ bd = d; bi = i; } }
    path.push(bi); rest.delete(bi); cur = bi;
  }
  return path;
}
// 2-opt (para costos simétricos): invierte tramos cuando eso elimina un cruce o una vuelta innecesaria.
function twoOptI(T, P, back){
  const {C, N, s} = T, A = s >= 0 ? [s, ...P] : P.slice(), n = A.length;
  if(n < 4) return P;
  const end = back && s >= 0 ? s : -1;
  let improved = true, guard = 0;
  while(improved && guard++ < 500){
    improved = false;
    for(let i=1;i<n-1;i++){
      for(let k=i+1;k<n;k++){
        const a = A[i-1], b = A[i], c = A[k], d = k+1<n ? A[k+1] : end;
        const before = C[a*N+b] + (d>=0 ? C[c*N+d] : 0), after = C[a*N+c] + (d>=0 ? C[b*N+d] : 0);
        if(after < before - 1e-9){ for(let l=i,r=k;l<r;l++,r--){ const t=A[l]; A[l]=A[r]; A[r]=t; } improved = true; }
      }
    }
  }
  return s >= 0 ? A.slice(1) : A;
}
// 2-opt para costos asimétricos (ida ≠ vuelta): al invertir un tramo se recalcula su costo interno con sumas acumuladas.
function twoOptAsymI(T, P, back){
  const {C, N, s} = T, A = s >= 0 ? [s, ...P] : P.slice(), n = A.length;
  if(n < 4) return P;
  const end = back && s >= 0 ? s : -1;
  let improved = true, guard = 0;
  while(improved && guard++ < 200){
    improved = false;
    const fw = new Float64Array(n), bw = new Float64Array(n);   // fw[t] = Σ C[A[u],A[u+1]] u<t ; bw igual en reversa
    for(let t=1;t<n;t++){ fw[t] = fw[t-1] + C[A[t-1]*N+A[t]]; bw[t] = bw[t-1] + C[A[t]*N+A[t-1]]; }
    for(let i=1;i<n-1 && !improved;i++){
      for(let k=i+1;k<n;k++){
        const a = A[i-1], b = A[i], c = A[k], d = k+1<n ? A[k+1] : end;
        const before = C[a*N+b] + (fw[k]-fw[i]) + (d>=0 ? C[c*N+d] : 0);
        const after  = C[a*N+c] + (bw[k]-bw[i]) + (d>=0 ? C[b*N+d] : 0);
        if(after < before - 1e-9){ for(let l=i,r=k;l<r;l++,r--){ const t=A[l]; A[l]=A[r]; A[r]=t; } improved = true; break; }
      }
    }
  }
  return s >= 0 ? A.slice(1) : A;
}
// Or-opt: saca tramos de 1 a 3 paradas y los reubica donde menos desvío causen (también al revés). Vale con costos asimétricos.
function orOptI(T, P0, back){
  const {C, N, s} = T, P = P0.slice(), n = P.length;
  if(n < 2) return P;
  const end = back && s >= 0 ? s : -1;
  const c = (a,b)=> (a < 0 || b < 0) ? 0 : C[a*N+b];
  let improved = true, guard = 0;
  while(improved && guard++ < 2000){
    improved = false;
    for(let len=1; len<=3 && !improved; len++){
      for(let i=0; i+len<=n && !improved; i++){
        const f = P[i], l = P[i+len-1];
        const prev = i>0 ? P[i-1] : s, next = i+len<n ? P[i+len] : end;
        let inF = 0, inR = 0; for(let t=i;t<i+len-1;t++){ inF += C[P[t]*N+P[t+1]]; inR += C[P[t+1]*N+P[t]]; }
        const quitar = c(prev,f) + inF + c(l,next) - c(prev,next);   // lo que se ahorra al sacar el tramo
        // Posiciones de inserción: entre R[j-1] y R[j] del camino sin el tramo (R virtual: P sin i..i+len-1).
        const m = n - len;
        for(let j=0; j<=m && !improved; j++){
          if(j === i) continue;   // misma posición
          const ra = j===0 ? s : (j-1 < i ? P[j-1] : P[j-1+len]);
          const rb = j===m ? end : (j < i ? P[j] : P[j+len]);
          const base = c(ra,rb);
          const poner = c(ra,f) + inF + c(l,rb) - base;
          if(poner - quitar < -1e-9){
            const seg = P.splice(i, len); P.splice(j, 0, ...seg); improved = true; break;
          }
          if(len > 1){
            const ponerR = c(ra,l) + inR + c(f,rb) - base;
            if(ponerR - quitar < -1e-9){
              const seg = P.splice(i, len).reverse(); P.splice(j, 0, ...seg); improved = true; break;
            }
          }
        }
      }
    }
  }
  return P;
}
function polishI(T, P, back){
  let Q = twoOptI(T, P, back);
  for(let r=0;r<4;r++){
    const before = largo(T, Q, back);
    Q = twoOptI(T, orOptI(T, Q, back), back);
    if(largo(T, Q, back) >= before - 1e-9) break;
  }
  return Q;
}
// Barrido por franjas: recorre la zona en franjas de calles (o de carreras) yendo y viniendo, como se reparte a mano.
function sweepsI(T, idx){
  const out = [], all = T.all;
  for(const axis of ["y","x"]){
    const other = axis==="y" ? "x" : "y";
    for(const w of [2,3,4,6,8,12]){
      for(const dir of [1,-1]){
        const bands = new Map();
        for(const i of idx){ const k = Math.floor(all[i][axis]/w); if(!bands.has(k)) bands.set(k,[]); bands.get(k).push(i); }
        const keys = [...bands.keys()].sort((a,b)=>(a-b)*dir);
        for(const firstAsc of [true,false]){
          const path = []; let asc = firstAsc;
          for(const k of keys){ path.push(...bands.get(k).slice().sort((a,b)=> asc ? all[a][other]-all[b][other] : all[b][other]-all[a][other])); asc = !asc; }
          out.push(path);
        }
      }
    }
  }
  return out;
}
function solve(start, pts, back){
  if(pts.length===0) return [];
  if(pts.length===1) return pts.slice();
  const T = tabla(start, pts), idx = pts.map((_,i)=>i + (start ? 1 : 0));
  const cands = [];
  // Vecino más cercano desde el inicio o, sin inicio, desde varias paradas posibles.
  if(start) cands.push(vecinoI(T, idx));
  else { const tries = idx.length > 60 ? idx.filter((_,i)=>i % Math.ceil(idx.length/60)===0) : idx; for(const i0 of tries) cands.push(vecinoI(T, idx, i0)); }
  cands.push(...sweepsI(T, idx));
  // Se pulen los mejores candidatos y se queda el más corto.
  cands.sort((a,b)=>largo(T,a,back)-largo(T,b,back));
  let best = null, bl = Infinity;
  for(const c of cands.slice(0, 10)){
    const P = polishI(T, c, back), L = largo(T, P, back);
    if(L < bl){ bl = L; best = P; }
  }
  return best.map(i=>T.all[i]);
}
// Ajuste con los costos reales (ida ≠ vuelta): or-opt y 2-opt asimétrico hasta que ya no mejore.
function orOpt(start, path, back){
  if(path.length < 2) return path.slice();
  const T = tabla(start, path), off = start ? 1 : 0;
  let P = path.map((_,i)=>i+off), L = largo(T, P, back);
  for(let r=0;r<20;r++){
    P = twoOptAsymI(T, orOptI(T, P, back), back);
    const L2 = largo(T, P, back); if(L2 >= L - 1e-9) break; L = L2;
  }
  return P.map(i=>T.all[i]);
}
// Punto desde donde se calcula: si ya hay entregas hechas, la última entregada (ahí está el repartidor); si no, el punto de partida.
function currentOrigin(){
  const g = state.startGPS && state.startGPS.x!=null ? state.startGPS : null;
  const gpsOrigin = g ? {x:g.x, y:g.y, lat:g.lat, lng:g.lng, label:"Mi ubicación", gps:true, t:g.t} : null;
  const sp = parseAddress(state.start);
  const done = state.stops.filter(s=>s.status==="done" && s.x!==null);
  if(done.length && state.lastDoneId){
    const ld = done.find(s=>s.id===state.lastDoneId);
    // La ubicación GPS o la dirección escrita mandan si se pusieron después de la última entrega
    // (p. ej. el repartidor se desvió o empieza otra vuelta desde otro lado).
    const t = ld ? (ld.doneAt||0) : 0;
    if(ld && !(gpsOrigin && g.t > t) && !(sp && (state.startAt||0) > t)) return {x:ld.x,y:ld.y,label:ld.label,lat:ld.lat,lng:ld.lng,id:ld.id};
  }
  if(gpsOrigin) return gpsOrigin;
  if(!sp){
    // Sin punto de partida: se arranca por la entrada a la zona de trabajo (si está activa).
    const z = zone();
    if(z.on && z.entry){
      const e = {x:z.minCra, y:z.entry, label:ZONE_ENTRIES[z.entry] || ("Av. Cali con Calle "+z.entry), entry:true};
      const g = state.entryGeo && state.entryGeo.calle===z.entry ? state.entryGeo : null;
      return g ? {...e, lat:g.lat, lng:g.lng} : e;
    }
    return null;
  }
  const c = geoCache[geoKey(sp)] || (state.startGeo && state.startGeo.label===sp.label ? state.startGeo : null);
  return c ? {...sp, lat:c.lat, lng:c.lng} : sp;
}
// Sector de la zona según las avenidas que la cortan (calles 132, 139, 145, 153 por defecto).
function sectorOf(s){ const cuts = zone().cuts||[]; let k = 0; for(const c of cuts) if(s.y >= c) k++; return k; }
// lastBlocks: tamaños de los tramos que deben quedar juntos y en ese orden (zona ST, sector, fuera de zona, reintentos).
// El ajuste final con calles reales mejora dentro de cada tramo sin mezclarlos.
let lastBlocks = null;
function groupedOrder(origin, geo, back, keyFn){
  const groups = {};
  geo.forEach(s=>{ (groups[keyFn(s)] ||= []).push(s); });
  const zs = Object.entries(groups).map(([z,arr])=>({z,arr,x:arr.reduce((a,s)=>a+s.x,0)/arr.length,y:arr.reduce((a,s)=>a+s.y,0)/arr.length}));
  const zOrder = solve(origin, zs, false);
  const ordered = [], blocks = []; let cur = origin;
  zOrder.forEach((zg,i)=>{ const last = i===zOrder.length-1; const part = solve(cur, zg.arr, last && back); ordered.push(...part); blocks.push(part.length); cur = part[part.length-1]; });
  lastBlocks = blocks;
  return ordered;
}
let lastStrategy = "";
function orderStops(origin, geo, back){
  // «No estaba» (intento fallido) va al final: se reintenta después de las pendientes, no vuelve a ser la siguiente.
  const reint = geo.filter(s=>s.status==="fail"), prim = geo.filter(s=>s.status!=="fail");
  if(reint.length && prim.length){
    const a = orderMain(origin, prim, false), bA = lastBlocks;
    const b = solve(a[a.length-1], reint, back);
    lastBlocks = bA.concat([b.length]);
    return a.concat(b);
  }
  return orderMain(origin, geo, back);
}
function orderMain(origin, geo, back){
  const z = zone();
  // Las paradas fuera de la zona (casi siempre errores o paquetes de otra ruta) van al final para no desviar el recorrido.
  if(z.on && z.outLast){
    const inZ = geo.filter(s=>!zoneIssue(s)), outZ = geo.filter(s=>zoneIssue(s));
    if(outZ.length && inZ.length){
      const a = orderCore(origin, inZ, false), bA = lastBlocks;
      const b = solve(a[a.length-1], outZ, back);
      lastBlocks = bA.concat([b.length]);
      return a.concat(b);
    }
  }
  return orderCore(origin, geo, back);
}
function orderCore(origin, geo, back){
  if(state.byZone){ lastStrategy = "por zona ST"; return groupedOrder(origin, geo, back, s=>s.zone||"—"); }
  const z = zone();
  const free = solve(origin, geo, back);
  if(z.on && z.sectors && geo.length >= 4){
    const sect = groupedOrder(origin, geo, back, sectorOf);
    const cf = pathLen(origin, free, back), cs = pathLen(origin, sect, back);
    // Por sectores es más fácil de seguir en la calle: se prefiere si cuesta como máximo 3 % más que el orden libre.
    // El ajuste final con calles reales puede mover paradas entre sectores si ahorra tiempo (un solo tramo):
    // en el banco de pruebas, mantener los sectores separados costaba ≈ 0,25 % más de tiempo.
    if(cs <= cf * 1.03){ lastStrategy = "por sectores entre avenidas"; lastBlocks = [sect.length]; return sect; }
  }
  lastStrategy = "libre (el más corto)";
  lastBlocks = [free.length];
  return free;
}
// Ajuste final por tramos (con la matriz que esté activa): mejora dentro de cada tramo sin mezclar tramos.
function refinarPorTramos(origin, ordered, back, blocks){
  const out = []; let k = 0, prev = origin;
  (blocks && blocks.reduce((a,b)=>a+b,0)===ordered.length ? blocks : [ordered.length]).forEach((len, bi, arr)=>{
    const seg = ordered.slice(k, k+len); k += len;
    const r = orOpt(prev, seg, bi===arr.length-1 && back);
    out.push(...r); if(r.length) prev = r[r.length-1];
  });
  return out;
}
/* Ruta en curso: desde la primera entrega o «No estaba».
   - Antes de eso, la lista es el orden de entrega y se numera 1, 2, 3… (se reordena todo al cargar o al tomar el GPS).
   - Después, el orden del vehículo se respeta: las paradas nuevas se insertan en el mejor hueco del orden actual (el de
     la lista, incluidos los cambios a mano) y nada se reordena solo. Si reordenar todo ahorra 5 % o más, se avisa y el
     repartidor decide con «Ordenar ruta».
   - Cada paquete conserva su número; las paradas nuevas toman el siguiente número libre. */
const MEJORA_AVISO = 0.05;
function rutaEnCurso(){ return state.stops.some(s=>s.status==="done" || s.status==="fail"); }
function estabilizar(origin, ordered, back){
  const conocidas = new Set(state.suggestedIds || []);
  if(!conocidas.size || ordered.length < 2) return ordered;
  const enOrden = new Set(ordered.map(s=>s.id));
  const actual = state.stops.filter(s=>enOrden.has(s.id) && conocidas.has(s.id));
  if(!actual.length) return ordered;
  // Orden actual de la lista, con los «No estaba» al final (en el orden en que se marcaron).
  const P = [...actual.filter(s=>s.status!=="fail"), ...actual.filter(s=>s.status==="fail")];
  const nuevos = ordered.filter(s=>!conocidas.has(s.id));
  // Inserción más barata de cada nueva, antes de los reintentos.
  for(const s of nuevos){
    const lim = s.status==="fail" ? P.length : (P.findIndex(q=>q.status==="fail")+1 || P.length+1) - 1;
    let bj = lim, bc = Infinity;
    for(let j=0;j<=lim;j++){ const c = pathLen(origin, [...P.slice(0,j), s, ...P.slice(j)], back); if(c < bc){ bc = c; bj = j; } }
    P.splice(bj, 0, s);
  }
  if(P.length !== enOrden.size) return ordered;
  const cP = pathLen(origin, P, back), cN = pathLen(origin, ordered, back);
  state.mejoraRuta = cP > 0 && cN < cP * (1 - MEJORA_AVISO)
    ? {pct: Math.round((1 - cN/cP) * 100), min: MATRIX ? Math.round((cP - cN) / 60) : null} : null;
  return P;
}
// Números de las paradas. Hasta la primera entrega siguen el orden de la lista (1, 2, 3…), que es el orden de entrega.
// Después quedan fijos: entregar una no corre los números de las demás, y las nuevas toman el siguiente libre.
function numerar(){
  if(!state || !state.stops) return;
  const fijos = rutaEnCurso();
  if(!fijos){ let n = 0; for(const s of state.stops) if(s.status!=="done") s.num = ++n; return; }
  let max = 0; for(const s of state.stops) if(s.num > max) max = s.num;
  const vistos = new Set();
  for(const s of state.stops){
    if(!s.num || vistos.has(s.num)) s.num = ++max;   // sin número o repetido (p. ej. llegó de otro celular)
    vistos.add(s.num);
  }
}
// Aplica un orden calculado sobre el estado actual (por si el repartidor marcó entregas mientras se calculaba).
function applyOrder(orderIds){
  const byId = new Map(state.stops.map(s=>[s.id,s]));
  const seen = new Set(), out = [];
  for(const id of orderIds){ const s = byId.get(id); if(s && s.status!=="done" && s.x!==null){ out.push(s); seen.add(id); } }
  const restGeo = state.stops.filter(s=>s.status!=="done" && s.x!==null && !seen.has(s.id));
  const unk = state.stops.filter(s=>s.status!=="done" && s.x===null);
  const done = state.stops.filter(s=>s.status==="done");
  state.stops = [...out, ...restGeo, ...unk, ...done];
}
let optimizing = null, pendingOpt = false, optEstable = false;
// optimize(silent, {estable:true}): para paradas nuevas a mitad de ruta (no revuelve el orden por poco ahorro).
// Sin «estable» (Ordenar ruta, cambio de opciones) se reordena todo.
function optimize(silent, opts){
  const estable = !!(opts && opts.estable);
  if(optimizing){ pendingOpt = true; optEstable = optEstable && estable; return optimizing; }
  optEstable = estable;
  optimizing = optimizeNow(silent).catch(err=>console.error(err)).finally(()=>{
    optimizing = null;
    if(pendingOpt){ pendingOpt = false; optimize(true, {estable: optEstable}); }
  });
  return optimizing;
}
// Orden inmediato con la cuadrícula (funciona sin internet). Se puede llamar aunque haya un cálculo con calles reales en curso.
function quickOrder(){
  const origin = currentOrigin();
  const back = !!state.roundTrip && !!parseAddress(state.start);
  const geo = state.stops.filter(s=>s.status!=="done" && s.x!==null);
  if(MATRIX) return;   // no interferir si justo se está usando la matriz real
  let quick = orderStops(origin, geo, back);
  if(optEstable && rutaEnCurso()) quick = estabilizar(origin, quick, back); else state.mejoraRuta = null;
  applyOrder(quick.map(s=>s.id));
  state.suggestedIds = quick.map(s=>s.id);
  LASTM = null;
  state.route = {mode:"aprox", km: pathLen(origin, quick, back)*KM_PER_UNIT};
  ROUTE_GEOM = null;
  save(); render();
}
async function optimizeNow(silent){
  const pend = state.stops.filter(s=>s.status!=="done");
  const geo = pend.filter(s=>s.x!==null), unk = pend.filter(s=>s.x===null);
  // 1) Orden inmediato con la cuadrícula.
  quickOrder();
  // 2) Con internet: ubicar en el mapa y ordenar con tiempos reales en carro.
  if(state.realRoads !== false && navigator.onLine && geo.length >= 1){
    try{
      await realOrder(silent);
      if(!silent) toast(unk.length ? `Ruta ordenada con calles reales. ${unk.length} dirección(es) para revisar al final.` : "Ruta ordenada con calles reales.");
      return;
    }catch(err){
      console.warn("Calles reales no disponibles:", err);
      setRouteInfo("No se pudo calcular con calles reales (" + (err && err.message || "sin respuesta") + "). Se usó el orden aproximado.");
      if(!silent) toast("Sin conexión con el servicio de mapas: se usó el orden aproximado.");
      return;
    }
  }
  setRouteInfo(!geo.length ? "" : state.realRoads === false ? "Orden aproximado por números de calle y carrera." : "Sin internet: orden aproximado por números de calle y carrera.");
  if(!silent) toast(unk.length ? `Ruta ordenada. ${unk.length} dirección(es) para revisar al final.` : "Ruta ordenada.");
}
function setRouteInfo(t){ state.routeNote = t; const el = $("routeInfo"); if(el) el.textContent = t; }
