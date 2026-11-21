/* Sincronización con Supabase (mismo proyecto que Ruta de Entregas, tablas bodega_*; ver supabase/bodega.sql).
   Solo se AGREGAN eventos: cada celular sube los suyos y baja los de los demás por número de orden (seq).
   Sin señal, los eventos quedan en IndexedDB y suben cuando vuelve. La clave pública es segura de publicar:
   lo que protege los datos son las reglas RLS. Sesión de Supabase: una por celular (la cuenta de la bodega). */
"use strict";
const SB_URL = "https://aptyzcodlubefqrscmvc.supabase.co";
const SB_KEY = "sb_publishable_dNrUbYZmql3Qei4-peiJNQ_4waYeXkx";
const SYNC_KEY = "bodega.sync.v1";
const SYNC_EVERY = 15000, LOTE_SUBIR = 500, LOTE_BAJAR = 1000, SOLAPE_SEQ = 500, DIAS_INICIALES = 30;
// sync = {email, uid, nombre, rol, access, refresh, exp, seq, last, err, catalogo}
let sync = store.get(SYNC_KEY) || null;
const saveSync = () => store.set(SYNC_KEY, sync);
const syncOn = () => !!(sync && sync.refresh);

/* ---- Sesión (igual que pedidos-/js/11-equipo.js) ---- */
async function sbAuth(grant, body){
  const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=${grant}`, {method:"POST", headers:{apikey:SB_KEY, "Content-Type":"application/json"}, body:JSON.stringify(body)});
  const j = await r.json().catch(() => ({}));
  if(!r.ok){ const e = new Error(j.error_description || j.msg || j.message || ("HTTP " + r.status)); e.status = r.status; throw e; }
  return j;
}
function setTokens(j){ sync.access = j.access_token; sync.refresh = j.refresh_token; sync.exp = Date.now() + (j.expires_in || 3600) * 1000; if(j.user && j.user.id) sync.uid = j.user.id; }
async function sbToken(){
  if(!syncOn()) throw new Error("No has conectado la nube.");
  if(!sync.access || Date.now() > sync.exp - 60000){
    try{ setTokens(await sbAuth("refresh_token", {refresh_token: sync.refresh})); saveSync(); }
    catch(e){
      if(e.status === 400 || e.status === 401){ sync.access = sync.refresh = null; sync.err = "La sesión venció: vuelve a conectar la nube."; saveSync(); pintarSync(); }
      throw e;
    }
  }
  return sync.access;
}
async function sb(path, opt = {}){
  const t = await sbToken();
  const r = await fetch(SB_URL + "/rest/v1/" + path, {...opt, headers:{apikey:SB_KEY, Authorization:"Bearer " + t, "Content-Type":"application/json", ...(opt.headers || {})}});
  if(!r.ok){ const j = await r.json().catch(() => ({})); const e = new Error(j.message || ("HTTP " + r.status)); e.status = r.status; e.code = j.code; throw e; }
  if(r.status === 204 || r.status === 201) { const txt = await r.text(); return txt ? JSON.parse(txt) : null; }
  const txt = await r.text(); return txt ? JSON.parse(txt) : null;
}
const filaNube = e => ({id: e.id, at: e.at, tipo: e.tipo, guia: e.guia, d: e.d, por: e.por, dev: e.dev});
const COLS = "seq,id,at,tipo,guia,d,por,dev";

/* ---- Sincronizar: 1) subir lo pendiente, 2) bajar lo nuevo de los demás ---- */
let syncing = null, syncTimer = null, rechazados = 0;
function syncNow(manual){
  if(!syncOn()) return Promise.resolve();
  if(syncing) return syncing;
  if(!navigator.onLine){ if(manual) toast("Sin internet: se sincroniza cuando vuelva la señal."); return Promise.resolve(); }
  syncing = doSync(manual).finally(() => { syncing = null; saveSync(); pintarSync(); });
  return syncing;
}
async function subir(lista){
  try{ await sb("bodega_eventos?on_conflict=id", {method:"POST", headers:{Prefer:"resolution=ignore-duplicates,return=minimal"}, body:JSON.stringify(lista.map(filaNube))}); await marcarSubidos(lista.map(e => e.id)); return; }
  catch(e){ if(e.status !== 403 && e.status !== 400 && e.code !== "42501" && e.code !== "23514") throw e; }
  // Algún evento no lo acepta el servidor (permiso o dato inválido): se suben uno por uno y se apartan los rechazados.
  for(const ev of lista){
    try{ await sb("bodega_eventos?on_conflict=id", {method:"POST", headers:{Prefer:"resolution=ignore-duplicates,return=minimal"}, body:JSON.stringify([filaNube(ev)])}); await marcarSubidos([ev.id]); }
    catch(e){ if(e.status === 403 || e.status === 400 || e.code === "42501" || e.code === "23514"){ ev.sub = 2; await idbPutMuchos([ev]); rechazados++; } else throw e; }
  }
}
async function doSync(manual){
  pintarSync("Sincronizando…");
  let llegaron = 0;
  try{
    const pend = pendientesSubir();
    for(let i = 0; i < pend.length; i += LOTE_SUBIR) await subir(pend.slice(i, i + LOTE_SUBIR));
    // Primera vez en este celular: todo el catálogo (repartidores y lotes) y los últimos 30 días de paquetes.
    if(!sync.catalogo){
      const cat = await sb(`bodega_eventos?select=${COLS}&tipo=in.(REP,ZONA,LOTE,LOTE_CERRADO)&order=seq.asc`) || [];
      llegaron += aplicarRemotos(cat);
      const desde = new Date(Date.now() - DIAS_INICIALES * 864e5).toISOString();
      let seq = 0;
      for(;;){
        const rows = await sb(`bodega_eventos?select=${COLS}&srv_at=gte.${encodeURIComponent(desde)}&seq=gt.${seq}&order=seq.asc&limit=${LOTE_BAJAR}`) || [];
        llegaron += aplicarRemotos(rows);
        if(rows.length) seq = rows[rows.length - 1].seq;
        if(rows.length < LOTE_BAJAR) break;
      }
      if(!seq){ const u = await sb(`bodega_eventos?select=seq&order=seq.desc&limit=1`) || []; seq = u.length ? u[0].seq : 0; }
      sync.seq = seq; sync.catalogo = true;
    } else {
      // Se repasan los últimos SOLAPE_SEQ números: un evento que se guardó en el servidor un instante después de otro
      // con número mayor no se pierde (los repetidos se ignoran por su id).
      let desde = Math.max(0, (sync.seq || 0) - SOLAPE_SEQ);
      for(;;){
        const rows = await sb(`bodega_eventos?select=${COLS}&seq=gt.${desde}&order=seq.asc&limit=${LOTE_BAJAR}`) || [];
        llegaron += aplicarRemotos(rows);
        if(rows.length){ desde = rows[rows.length - 1].seq; if(desde > (sync.seq || 0)) sync.seq = desde; }
        if(rows.length < LOTE_BAJAR) break;
      }
    }
    sync.last = Date.now(); sync.err = rechazados ? `${rechazados} lectura(s) no las aceptó el servidor (permiso). Revisa el rol de esta cuenta.` : "";
    if(llegaron && !manual) toast(`Llegaron ${llegaron} lectura(s) de otros celulares.`);
    if(manual) toast(llegaron ? `Sincronizado: llegaron ${llegaron} lectura(s).` : "Sincronizado.");
  }catch(e){
    sync.err = "No se pudo sincronizar (" + (e.message || e) + "). Se reintenta solo.";
    if(manual) toast(sync.err);
  }
}
// Después de cada lectura se sube a los pocos segundos (agrupa varias seguidas).
alCambiar(origen => { if(origen === "local" && syncOn()){ clearTimeout(syncTimer); syncTimer = setTimeout(() => syncNow(false), 3000); } pintarSync(); });
setInterval(() => { if(document.visibilityState === "visible") syncNow(false); }, SYNC_EVERY);
document.addEventListener("visibilitychange", () => { if(document.visibilityState === "visible") syncNow(false); });
addEventListener("online", () => syncNow(false));

/* ---- Conectar / desconectar ---- */
async function conectarNube(email, pass){
  sync = {email: email.trim().toLowerCase(), seq: 0, catalogo: false};
  try{
    setTokens(await sbAuth("password", {email: sync.email, password: pass}));
    const m = await sb(`bodega_miembros?select=nombre,rol&user_id=eq.${sync.uid}`) || [];
    if(!m.length) throw new Error("Esta cuenta no está autorizada en la bodega (pídele al administrador que la agregue en Supabase).");
    sync.nombre = m[0].nombre; sync.rol = m[0].rol; saveSync();
  }catch(e){ sync = null; store.del(SYNC_KEY); throw e; }
  await syncNow(true);
}
function desconectarNube(){
  const pend = pendientesSubir().length;
  sync = null; store.del(SYNC_KEY); pintarSync();
  if(pend) toast(`Desconectado. Quedan ${pend} lectura(s) sin subir: suben cuando vuelvas a conectar.`);
}

/* ---- Indicador y diálogo ---- */
function pintarSync(msg){
  const chip = $("syncChip"), pend = pendientesSubir().length;
  chip.hidden = false;
  if(!syncOn()){ chip.textContent = "⚠ Solo en este celular" + (pend ? ` · ${pend} sin subir` : ""); chip.className = "small hbtn syncChip warn"; }
  else if(msg){ chip.textContent = msg; chip.className = "small hbtn syncChip"; }
  else {
    const min = sync.last ? Math.floor((Date.now() - sync.last) / 60000) : null;
    const mal = sync.err || min == null || min >= 5;
    chip.textContent = (mal ? "⚠ " : "✓ ") + (sync.err ? "Nube: revisar" : min == null ? "Sin sincronizar" : min < 1 ? "Sinc. ahora" : `Sinc. hace ${min} min`) + (pend ? ` · ${pend} sin subir` : "");
    chip.className = "small hbtn syncChip" + (mal ? " warn" : " ok");
  }
  if($("dlgTeam").open) pintarEquipo();
}
setInterval(() => pintarSync(), 30000);
function pintarEquipo(){
  const on = syncOn();
  $("tmOff").hidden = on; $("tmOn").hidden = !on;
  if(on){
    $("tmWho").textContent = `Conectado como ${sync.nombre || sync.email} (${sync.rol || "bodega"}) · ${sync.email}`;
    const pend = pendientesSubir().length;
    $("tmStat").textContent = (sync.last ? "Última sincronización: " + fechaHora(new Date(sync.last).toISOString()) : "Aún no sincroniza.") + (pend ? ` · ${pend} lectura(s) por subir.` : " · Todo subido.");
  }
  $("tmErr").textContent = (sync && sync.err) || "";
}
$("btnTeam").onclick = () => { $("hdrMenu").hidden = true; pintarEquipo(); $("dlgTeam").showModal(); };
$("syncChip").onclick = () => { pintarEquipo(); $("dlgTeam").showModal(); };
$("tmConnect").onclick = async () => {
  const e = $("tmEmail").value, p = $("tmPass").value;
  if(!e.trim() || !p){ $("tmErr").textContent = "Escribe el correo y la contraseña."; return; }
  $("tmConnect").disabled = true; $("tmErr").textContent = "Conectando…";
  try{ await conectarNube(e, p); $("tmPass").value = ""; pintarEquipo(); }
  catch(x){ $("tmErr").textContent = /invalid/i.test(x.message) ? "Correo o contraseña incorrectos." : x.message; }
  finally{ $("tmConnect").disabled = false; }
};
$("tmSync").onclick = () => syncNow(true).then(pintarEquipo);
$("tmDisc").onclick = async () => { if(await confirmar("Desconectar la nube", "Este celular deja de compartir lecturas. Lo que ya tiene se queda aquí.", "Desconectar", true)) desconectarNube(); pintarEquipo(); };

/* ---- Histórico (consultas directas a la nube, sin mezclarlas con los datos del celular) ---- */
const COLS_HIST = COLS + ",srv_at";
// Una guía: exacta, o que termine en lo escrito (4+ caracteres). Máximo 500 movimientos.
async function nubeGuia(txt){
  const t = String(txt).replace(/[^A-Za-z0-9-]/g, "").toUpperCase(); if(t.length < 4) return [];
  const exacta = await sb(`bodega_eventos?select=${COLS_HIST}&guia=eq.${encodeURIComponent(t)}&order=at.asc&limit=500`) || [];
  if(exacta.length) return exacta;
  return await sb(`bodega_eventos?select=${COLS_HIST}&guia=like.*${encodeURIComponent(t)}&order=guia.asc,at.asc&limit=500`) || [];
}
// Todos los movimientos con hora de lectura (at) en [desde, hasta), por páginas de 1 000 (orden seq).
async function nubeRango(desde, hasta, progreso){
  const out = []; let seq = 0;
  for(;;){
    const rows = await sb(`bodega_eventos?select=${COLS_HIST}&at=gte.${encodeURIComponent(desde)}&at=lt.${encodeURIComponent(hasta)}&seq=gt.${seq}&order=seq.asc&limit=${LOTE_BAJAR}`) || [];
    out.push(...rows);
    if(rows.length) seq = rows[rows.length - 1].seq;
    if(progreso && rows.length) progreso(out.length);
    if(rows.length < LOTE_BAJAR || out.length > 300000) break;
  }
  return out;
}
