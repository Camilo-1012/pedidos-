/* Conexión con la Bodega (v2.31): lo que el despachador le asigna a este repartidor aparece en su ruta con la guía,
   y el repartidor solo completa la dirección y lo que falte. «Entregado» y «No estaba» vuelven a la bodega.
   - Usa la misma sesión del equipo (js/11-equipo.js): la cuenta de Ruta del repartidor, vinculada en Bodega → Repartidores.
   - Bodega → Ruta: función bodega_mis_asignados() de Supabase (solo guía, empresa, hora y calle/carrera; nada del cliente).
   - Ruta → Bodega: eventos ENTREGADO / NO_ENTREGADO / ANULAR en bodega_eventos (las reglas RLS solo aceptan guías que
     hoy están en ruta con este repartidor). Sin señal se guardan en una cola y suben al volver.
   - Cada paquete de la bodega es una parada con id «b-<guía>»: si el repartidor usa dos celulares, no se duplica. */
"use strict";
const BOD_KEY = "rutaEntregas.u." + USER.id + ".bodega.v1";
const BOD_CADA = 20000;   // cada cuánto se pregunta a la bodega qué hay asignado (va con la sincronización del equipo)
// bod = {rid, nombre, ult, cola:[eventos], asignados:[guías], sinFuncion}
const bod = Object.assign({rid:null, ult:0, cola:[], asignados:[], sinFuncion:false}, store.get(BOD_KEY) || {});
const guardarBod = ()=>store.set(BOD_KEY, bod);
const gNorm = g=>String(g||"").trim().toUpperCase();
const esDeBodega = s=>!!(s && s.bodega);
// Parada de la bodega a la que le falta la dirección (no se puede ubicar en el mapa).
const sinDireccion = s=>esDeBodega(s) && s.status!=="done" && !parseAddress(s.label || s.addr);
function paradaDeGuia(g){ g = gNorm(g); return state.stops.find(st=>guias(st).some(x=>gNorm(x)===g)) || null; }
function porCompletar(g){ const st = paradaDeGuia(g); return st && sinDireccion(st) ? st : null; }

/* ---- Llamadas directas a Supabase con la sesión del equipo (para leer el estado HTTP) ---- */
async function sbBod(path, opt = {}){
  const t = await sbToken();
  const r = await fetch(SB_URL + "/rest/v1/" + path, {...opt, headers:{apikey:SB_KEY, Authorization:"Bearer " + t, "Content-Type":"application/json", ...(opt.headers||{})}});
  const txt = await r.text(); let j = null; try{ j = txt ? JSON.parse(txt) : null; }catch(e){}
  if(!r.ok){ const e = new Error((j && j.message) || ("HTTP " + r.status)); e.status = r.status; e.code = j && j.code; throw e; }
  return j;
}

/* ---- Bodega → Ruta ---- */
async function traerAsignados(){
  // Se pregunta siempre: el administrador puede vincular, cambiar o quitar el vínculo en cualquier momento.
  const rid = await sbBod("rpc/bodega_mi_rid", {method:"POST", body:"{}"});
  bod.rid = typeof rid === "string" && rid ? rid : null;
  if(!bod.rid){ bod.asignados = []; return reconciliar([]); }   // sin vínculo: se quitan los pendientes sin dirección
  const rows = await sbBod("rpc/bodega_mis_asignados", {method:"POST", body:"{}"}) || [];
  bod.asignados = rows.map(r=>gNorm(r.guia));
  return reconciliar(rows);
}
// Pone en la ruta lo nuevo, quita lo que la bodega ya no le tiene asignado (si aún no tiene dirección) y marca lo demás.
function reconciliar(rows){
  const asign = new Map(rows.map(r=>[gNorm(r.guia), r]));
  let nuevas = 0, quitadas = 0, cambios = 0;
  for(const [g, r] of asign){
    const st = paradaDeGuia(g);
    const info = {emp: r.emp || "", at: r.asignado || "", cl: r.cl ?? null, kr: r.kr ?? null};
    if(st){
      if(!st.bodega || st.bodegaFuera){ st.bodega = {...(st.bodega||{}), ...info}; delete st.bodegaFuera; cambios++; }
      continue;
    }
    const ns = mkStop({addr:"", guia:g});
    ns.id = "b-" + g.replace(/[^A-Z0-9-]/g, ""); ns.bodega = info;
    state.stops = state.stops.filter(s=>!s.example);
    const firstDone = state.stops.findIndex(q=>q.status==="done");
    state.stops.splice(firstDone<0 ? state.stops.length : firstDone, 0, ns);
    nuevas++;
  }
  for(const st of state.stops.slice()){
    if(!esDeBodega(st) || st.status==="done") continue;
    const suya = guias(st).some(x=>asign.has(gNorm(x)));
    if(suya) continue;
    // Reportada aquí como «No estaba» o ya con dirección: no se borra (se avisa); sin dirección y pendiente: se quita.
    if(st.status==="pend" && sinDireccion(st)){ state.stops.splice(state.stops.indexOf(st), 1); quitadas++; }
    else if(!st.bodegaFuera){ st.bodegaFuera = true; cambios++; }
  }
  if(nuevas || quitadas || cambios){
    save(); render();
    const msg = [nuevas ? `${nuevas} paquete(s) nuevo(s): completa la dirección` : "", quitadas ? `${quitadas} ya no son tuyos (los movió la bodega)` : ""].filter(Boolean).join(" · ");
    if(msg) toast("Bodega: " + msg + ".");
  }
  return nuevas;
}

/* ---- Ruta → Bodega ---- */
function nuevoEvento(tipo, guia, d){
  return {id: (crypto.randomUUID ? crypto.randomUUID() : uuidRuta()), at: new Date().toISOString(), tipo, guia: gNorm(guia), d, por: USER.name, dev: "ruta-" + USER.id.slice(-8)};
}
function uuidRuta(){
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map(x=>x.toString(16).padStart(2,"0")).join("");
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
// Se llama desde toggleDone / toggleFail (js/05-pantalla.js) con el estado anterior de la parada.
function bodegaReportar(s, antes){
  if(!esDeBodega(s) || !bod.rid || s.status === antes) return;
  s.bev = s.bev || {};
  for(const g0 of guias(s)){
    const g = gNorm(g0), r = s.bev[g] || (s.bev[g] = {});
    if(s.status==="done" && antes!=="done"){ const e = nuevoEvento("ENTREGADO", g, {rid: bod.rid, por_rep: true}); r.ENT = e.id; delete r.ENTanul; bod.cola.push(e); }
    if(antes==="done" && s.status!=="done" && r.ENT && !r.ENTanul){ bod.cola.push(nuevoEvento("ANULAR", g, {ref: r.ENT})); r.ENTanul = true; }
    if(s.status==="fail" && antes!=="fail"){ const e = nuevoEvento("NO_ENTREGADO", g, {rid: bod.rid, motivo: "No estaba"}); r.NO = e.id; delete r.NOanul; bod.cola.push(e); }
    if(antes==="fail" && s.status!=="fail" && r.NO && !r.NOanul){ bod.cola.push(nuevoEvento("ANULAR", g, {ref: r.NO})); r.NOanul = true; }
  }
  guardarBod();
  clearTimeout(bodegaReportar.t); bodegaReportar.t = setTimeout(()=>subirCola().catch(()=>{}), 1500);
}
let subiendo = null;
function subirCola(){
  if(subiendo) return subiendo;
  subiendo = (async ()=>{
    if(!bod.cola.length || typeof syncOn !== "function" || !syncOn() || !navigator.onLine) return;
    const lote = bod.cola.slice(0, 100);
    const enviar = l=>sbBod("bodega_eventos?on_conflict=id", {method:"POST", headers:{Prefer:"resolution=ignore-duplicates,return=minimal"}, body:JSON.stringify(l)});
    const rechazo = e=>e.status===403 || e.status===400 || e.code==="42501" || e.code==="23514";
    try{ await enviar(lote); quitarDeCola(lote); }
    catch(e){
      if(!rechazo(e)) throw e;
      // Alguno no lo aceptó la bodega (p. ej. ya no está asignado a ti): se suben uno por uno y se apartan los rechazados.
      const malos = [];
      for(const ev of lote){ try{ await enviar([ev]); }catch(x){ if(rechazo(x)) malos.push(ev); else throw x; } }
      quitarDeCola(lote);
      if(malos.length) toast(`La bodega no aceptó ${malos.length} reporte(s): ${[...new Set(malos.map(m=>m.guia))].join(", ")} ya no está(n) a tu nombre.`);
    }
  })().finally(()=>{ subiendo = null; guardarBod(); });
  return subiendo;
}
function quitarDeCola(l){ const ids = new Set(l.map(e=>e.id)); bod.cola = bod.cola.filter(e=>!ids.has(e.id)); guardarBod(); }

/* ---- Se engancha a la sincronización del equipo ---- */
async function bodegaSync(forzar){
  if(bod.sinFuncion && !forzar) return;
  try{
    await subirCola();
    if(!forzar && Date.now() - bod.ult < BOD_CADA) return;
    bod.ult = Date.now();
    await traerAsignados();
    bod.sinFuncion = false;
  }catch(e){
    // La base aún no tiene la conexión con la bodega (no se ha corrido supabase/bodega.sql): no se insiste hasta reabrir.
    if(e.status === 404 || e.code === "PGRST202") bod.sinFuncion = true;
    else console.warn("bodega", e);
  }finally{ guardarBod(); }
}
// Al escanear una etiqueta cuya guía ya asignó la bodega: abre ESA parada con lo leído en lo que falta.
// Devuelve true si se encargó (así no se muestra «Paquete repetido»).
function completarBodega(d){
  const st = d && d.guia && porCompletar(d.guia);
  if(!st) return false;
  openEdit(st);
  const poner = (id, v)=>{ if(v && !$(id).value.trim()) $(id).value = v; };
  poner("fAddr", d.addr); poner("fPhone", (d.phone||"").replace(/\D/g,"").slice(-10)); poner("fName", d.name);
  poner("fZone", d.zone); poner("fBarrio", d.barrio); poner("fUnit", d.unit);
  if(d.type && d.type!=="casa") setType(d.type);
  updParsed(); updPhone();
  $("dlgTitle").textContent = "Completa los datos · asignado por la bodega";
  toast(parseAddress(d.addr) ? "Paquete de la bodega: revisa y guarda." : "Paquete de la bodega: escribe la dirección y guarda.");
  return true;
}
// Paquete nuevo escaneado que la bodega no le asignó: solo se avisa (no se bloquea).
function bodegaAvisoNuevo(st){
  if(!bod.rid || !st || esDeBodega(st)) return;
  const fuera = guias(st).filter(g=>!bod.asignados.includes(gNorm(g)));
  if(fuera.length === guias(st).length && fuera.length) setTimeout(()=>toast(`Ojo: la bodega no te asignó ${fuera.join(", ")}. Avísale al despachador.`), 3400);
}
addEventListener("online", ()=>subirCola().catch(()=>{}));
