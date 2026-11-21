/* Datos: registro de eventos (solo se agregan, nunca se cambian ni se borran) y estado calculado de cada paquete.
   Cada acción de la bodega es un evento: {id, at, tipo, guia, d:{…}, por, dev, sub}.
   El estado de un paquete se calcula con TODOS sus eventos ordenados por hora (at); así, lecturas hechas sin señal en
   otro celular se acomodan en su lugar cuando llegan, y no hay sobrescrituras que pierdan información.
   Se guarda en IndexedDB (aguanta decenas de miles de eventos; localStorage no). */
"use strict";
const TIPOS = ["REP","ZONA","LOTE","LOTE_CERRADO","ESPERADO","RECIBIDO","NOVEDAD","UBICACION","ASIGNADO","DEVUELTO","ENTREGADO","FALTANTE","ANULAR"];
const ESTADOS = {ESPERADO:"Esperado (sin recibir)", BODEGA:"En bodega", RUTA:"En ruta", ENTREGADO:"Entregado", FALTANTE:"Faltante"};
const RETENER_DIAS = 30;   // en el celular: paquetes cerrados (entregados/faltantes) hace más de 30 días se quitan

const EV = new Map();        // id → evento
const POR_GUIA = new Map();  // guía → [eventos]
const PAQ = new Map();       // guía → estado calculado
const REPS = new Map();      // rid → {rid, nombre, activo}
const ZONAS = new Map();     // zid → {zid, nombre, color, cl:[desde,hasta], kr:[desde,hasta], rid, activa} (ver js/10-zonas.js)
const LOTES = new Map();     // lid → {lid, nombre, emp, esperado, cerrado, at}
let idb = null, idbFalla = false;

/* ---- IndexedDB mínimo ---- */
function idbAbrir(){
  return new Promise((ok, mal) => {
    if(!("indexedDB" in window)) return mal(new Error("sin IndexedDB"));
    const r = indexedDB.open("bodega", 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      const ev = db.createObjectStore("ev", {keyPath: "id"}); ev.createIndex("sub", "sub");
      db.createObjectStore("kv");
    };
    r.onsuccess = () => ok(r.result); r.onerror = () => mal(r.error);
  });
}
function idbTx(store, modo, fn){
  return new Promise((ok, mal) => {
    if(!idb) return ok(null);
    const tx = idb.transaction(store, modo), st = tx.objectStore(store);
    let out = null; const r = fn(st); if(r) r.onsuccess = () => { out = r.result; };
    tx.oncomplete = () => ok(out); tx.onerror = () => mal(tx.error); tx.onabort = () => mal(tx.error);
  });
}
const idbPutMuchos = evs => idbTx("ev", "readwrite", st => { evs.forEach(e => st.put(e)); }).catch(e => { idbFalla = true; console.warn(e); });
const kvGet = k => idbTx("kv", "readonly", st => st.get(k)).catch(() => null);
const kvSet = (k, v) => idbTx("kv", "readwrite", st => st.put(v, k)).catch(() => null);

/* ---- Cálculo del estado de un paquete ---- */
const ordenEv = (a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
function calcPaq(guia){
  const evs = (POR_GUIA.get(guia) || []).slice().sort(ordenEv);
  const anulados = new Set(evs.filter(e => e.tipo === "ANULAR").map(e => e.d.ref));
  const p = {guia, emp:"", estado:"", espLote:"", recLote:"", rid:"", ultRid:"", recibido:"", asignado:"", cerrado:"",
    devs:0, motivo:"", nov:[], conflicto:"", sinRecibir:false, ult:"", cl:null, kr:null, zidManual:"", evs:[]};
  for(const e of evs){
    if(e.tipo === "ANULAR" || anulados.has(e.id)) continue;
    p.evs.push(e); p.ult = e.at;
    const d = e.d || {};
    if(d.emp && !p.emp) p.emp = d.emp;
    switch(e.tipo){
      case "ESPERADO": if(!p.estado) p.estado = "ESPERADO"; if(!p.espLote) p.espLote = d.lid || ""; break;
      case "RECIBIDO":
        if(p.estado === "BODEGA" && p.recibido) break;           // repetida: no cambia nada
        p.estado = "BODEGA"; if(!p.recibido){ p.recibido = e.at; p.recLote = d.lid || ""; }
        break;
      case "ASIGNADO":
        // Dos celulares asignaron la misma guía a repartidores distintos sin ver la otra lectura (sin señal).
        // Una reasignación confirmada o un cierre posterior lo resuelven.
        p.conflicto = p.estado === "RUTA" && p.rid && p.rid !== d.rid && !d.reasigna
          ? `Asignada a ${repNombre(p.rid)} y a ${repNombre(d.rid)} (lecturas de dos celulares, quizá sin señal).` : "";
        if(p.estado !== "BODEGA" && p.estado !== "RUTA") p.sinRecibir = true;
        p.estado = "RUTA"; p.rid = p.ultRid = d.rid; p.asignado = e.at; p.cerrado = "";
        break;
      case "DEVUELTO": p.conflicto = ""; p.estado = "BODEGA"; p.devs++; p.motivo = d.motivo || ""; p.ultRid = d.rid || p.rid; p.rid = ""; break;
      case "ENTREGADO": p.conflicto = ""; p.estado = "ENTREGADO"; p.cerrado = e.at; p.ultRid = d.rid || p.rid; break;
      case "FALTANTE": p.conflicto = ""; p.estado = "FALTANTE"; p.cerrado = e.at; p.ultRid = d.rid || p.rid; p.rid = ""; break;
      case "NOVEDAD": p.nov.push({at: e.at, nota: d.nota, por: e.por}); break;
      // Ubicación para la zona: solo número de calle y de carrera (sin placa, Ley 1581) o una zona elegida a mano.
      case "UBICACION":
        if(d.zid){ p.zidManual = d.zid; p.cl = p.kr = null; }
        else { p.cl = Number.isFinite(d.cl) ? d.cl : null; p.kr = Number.isFinite(d.kr) ? d.kr : null; p.zidManual = ""; }
        break;
    }
  }
  if(!p.evs.length) PAQ.delete(guia); else PAQ.set(guia, p);
  return p;
}
function aplicarCatalogo(e){
  const d = e.d || {};
  if(e.tipo === "REP"){
    const r = REPS.get(d.rid);
    if(!r || r.at <= e.at) REPS.set(d.rid, {rid: d.rid, nombre: d.nombre, activo: d.activo !== false, at: e.at});
  } else if(e.tipo === "ZONA"){
    const z = ZONAS.get(d.zid);
    if(!z || z.at <= e.at) ZONAS.set(d.zid, {zid: d.zid, nombre: d.nombre, color: d.color || "", cl: d.cl || [null, null], kr: d.kr || [null, null], rid: d.rid || "", activa: d.activa !== false, at: e.at});
  } else if(e.tipo === "LOTE" || e.tipo === "LOTE_CERRADO"){
    // Pueden llegar en desorden desde otros celulares: se decide por la hora de cada evento.
    const l = LOTES.get(d.lid) || {lid: d.lid, nombre: "Lote", emp: "", esperado: 0, at: e.at, datosAt: "", cerradoAt: "", abiertoAt: "", cerrado: ""};
    if(e.tipo === "LOTE"){
      if(e.at >= l.datosAt){ Object.assign(l, {nombre: d.nombre, emp: d.emp, esperado: d.esperado || 0}); l.datosAt = e.at; }
      if(e.at < l.at) l.at = e.at;
      if(d.reabrir && e.at > l.abiertoAt) l.abiertoAt = e.at;
    } else if(e.at > l.cerradoAt) l.cerradoAt = e.at;
    l.cerrado = l.cerradoAt && l.cerradoAt > l.abiertoAt ? l.cerradoAt : "";
    LOTES.set(d.lid, l);
  }
}
function indexar(e){
  if(EV.has(e.id)) return false;
  EV.set(e.id, e);
  if(e.guia){ const l = POR_GUIA.get(e.guia); l ? l.push(e) : POR_GUIA.set(e.guia, [e]); }
  else aplicarCatalogo(e);
  return true;
}
const repNombre = rid => (REPS.get(rid) || {}).nombre || (rid ? "repartidor borrado" : "—");

/* ---- Cambios ---- */
const oyentes = [];
const alCambiar = fn => oyentes.push(fn);
function avisar(origen){ oyentes.forEach(fn => { try{ fn(origen); }catch(e){ console.error(e); } }); }

// Registra una acción de este celular. Devuelve el evento.
function registrar(tipo, guia, d){
  if(!TIPOS.includes(tipo)) throw new Error("tipo " + tipo);
  let at = new Date().toISOString();
  // Dos lecturas en el mismo milisegundo: se separan para que el orden sea el de la lectura.
  const prev = guia && POR_GUIA.get(guia);
  if(prev && prev.length){ const max = prev.reduce((m, x) => x.at > m ? x.at : m, ""); if(at <= max) at = new Date(new Date(max).getTime() + 1).toISOString(); }
  const e = {id: uuid(), at, tipo, guia: guia || null, d: d || {}, por: USER.name, dev: DEV_ID, sub: 0};
  indexar(e);
  if(guia) calcPaq(guia);
  idbPutMuchos([e]);
  avisar("local");
  return e;
}
// Eventos que llegan de la nube (de otros celulares). Devuelve cuántos eran nuevos.
function aplicarRemotos(lista){
  const guardar = [], guias = new Set();
  let ajenos = 0;
  for(const r of lista){
    const e = {id: r.id, at: new Date(r.at).toISOString(), tipo: r.tipo, guia: r.guia || null, d: r.d || {}, por: r.por || "", dev: r.dev || "", sub: 1};
    if(!TIPOS.includes(e.tipo)) continue;
    if(EV.has(e.id)){ const loc = EV.get(e.id); if(!loc.sub){ loc.sub = 1; guardar.push(loc); } continue; }
    indexar(e); guardar.push(e); ajenos++; if(e.guia) guias.add(e.guia);
  }
  if(!guardar.length) return 0;
  guias.forEach(calcPaq);
  // Un cambio de nombre de repartidor cambia el texto de los conflictos: se recalculan los que tengan.
  if(lista.some(r => r.tipo === "REP" || r.tipo === "ZONA")) [...PAQ.values()].filter(p => p.conflicto).forEach(p => calcPaq(p.guia));
  idbPutMuchos(guardar);
  if(ajenos) avisar("nube");
  return ajenos;
}
const pendientesSubir = () => [...EV.values()].filter(e => !e.sub).sort(ordenEv);
function marcarSubidos(ids){
  const evs = ids.map(id => EV.get(id)).filter(Boolean);
  evs.forEach(e => { e.sub = 1; });
  return idbPutMuchos(evs);
}

/* ---- Limpieza local: paquetes cerrados hace más de RETENER_DIAS (en la nube siguen) ---- */
async function purgar(){
  const lim = Date.now() - RETENER_DIAS * 864e5, quitar = [];
  for(const p of PAQ.values()){
    if((p.estado === "ENTREGADO" || p.estado === "FALTANTE") && new Date(p.cerrado).getTime() < lim && (POR_GUIA.get(p.guia) || []).every(e => e.sub)) quitar.push(p.guia);
  }
  if(!quitar.length) return 0;
  const ids = [];
  quitar.forEach(g => { (POR_GUIA.get(g) || []).forEach(e => { EV.delete(e.id); ids.push(e.id); }); POR_GUIA.delete(g); PAQ.delete(g); });
  await idbTx("ev", "readwrite", st => { ids.forEach(id => st.delete(id)); }).catch(() => null);
  return quitar.length;
}

/* ---- Consultas ---- */
const paq = g => PAQ.get(g) || null;
const repsActivos = () => [...REPS.values()].filter(r => r.activo).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
const paquetes = filtro => [...PAQ.values()].filter(filtro || (() => true));
// Búsqueda: guía exacta, o que termine en los números escritos (4 o más).
function buscarGuias(txt){
  const g = normGuia(txt); if(g && PAQ.has(g)) return [PAQ.get(g)];
  const t = String(txt || "").replace(/\s+/g, "").toUpperCase(); if(t.length < 4) return [];
  return paquetes(p => p.guia.endsWith(t) || (t.length >= 6 && p.guia.includes(t))).slice(0, 30);
}
function statsLote(lid){
  let esp = 0, rec = 0, sobr = 0, recEsp = 0;
  for(const p of PAQ.values()){
    const e = p.espLote === lid, r = p.recLote === lid;
    if(e) esp++;
    if(r){ rec++; if(e) recEsp++; else if(!p.espLote) sobr++; }
  }
  const l = LOTES.get(lid) || {};
  const esperado = Math.max(esp, l.esperado || 0);
  return {esp, esperado, rec, faltan: esp ? esp - recEsp : Math.max(0, esperado - rec), sobr: esp ? sobr : 0};
}
// Lo que tiene un repartidor: en ruta (por liquidar) y lo de un día (asignados, devueltos, entregados, faltantes).
function delRepartidor(rid, dia){
  dia = dia || hoy();
  const r = {enRuta:[], asignadosDia:[], devueltosDia:[], entregadosDia:[], faltantesDia:[]};
  for(const p of PAQ.values()){
    if(p.estado === "RUTA" && p.rid === rid) r.enRuta.push(p);
    let asig = false, dev = false;
    for(const e of p.evs){
      if(diaDe(e.at) !== dia || (e.d || {}).rid !== rid) continue;
      if(e.tipo === "ASIGNADO") asig = true;
      if(e.tipo === "DEVUELTO") dev = true;
      if(e.tipo === "ENTREGADO") r.entregadosDia.push(p);
      if(e.tipo === "FALTANTE") r.faltantesDia.push(p);
    }
    if(asig) r.asignadosDia.push(p);
    if(dev) r.devueltosDia.push(p);
  }
  const porHora = k => (a, b) => (b[k] || "").localeCompare(a[k] || "");
  r.enRuta.sort(porHora("asignado")); r.asignadosDia.sort(porHora("asignado"));
  return r;
}
function resumenDia(dia){
  dia = dia || hoy();
  const filas = new Map();
  const fila = rid => filas.get(rid) || (filas.set(rid, {rid, nombre: repNombre(rid), asignados:0, devueltos:0, entregados:0, faltantes:0, enRuta:0}), filas.get(rid));
  let recibidos = 0;
  for(const p of PAQ.values()){
    if(p.estado === "RUTA") fila(p.rid).enRuta++;
    const vistos = new Set();
    for(const e of p.evs){
      if(diaDe(e.at) !== dia) continue;
      const rid = (e.d || {}).rid, k = e.tipo + "|" + rid;
      if(vistos.has(k)) continue; vistos.add(k);
      if(e.tipo === "RECIBIDO") recibidos++;
      else if(e.tipo === "ASIGNADO") fila(rid).asignados++;
      else if(e.tipo === "DEVUELTO") fila(rid).devueltos++;
      else if(e.tipo === "ENTREGADO") fila(rid).entregados++;
      else if(e.tipo === "FALTANTE") fila(rid).faltantes++;
    }
  }
  return {recibidos, filas: [...filas.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))};
}

/* ---- Arranque ---- */
async function datosIniciar(){
  try{ idb = await idbAbrir(); }
  catch(e){ idbFalla = true; console.warn("IndexedDB", e); return; }
  const todos = await idbTx("ev", "readonly", st => st.getAll()).catch(() => []) || [];
  todos.forEach(indexar);
  POR_GUIA.forEach((_, g) => calcPaq(g));
}
