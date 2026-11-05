/* Equipo en la nube (Supabase): cada persona sincroniza SU ruta; el administrador ve la de todos y reasigna paradas.
   Se usa la API REST directamente (sin librerías). La clave pública es segura de publicar: lo que protege los datos
   son las reglas RLS de la base de datos (ver supabase/equipo.sql). El texto completo leído de la etiqueta no se sube. */
"use strict";
const SB_URL = "https://aptyzcodlubefqrscmvc.supabase.co";
const SB_KEY = "sb_publishable_dNrUbYZmql3Qei4-peiJNQ_4waYeXkx";
const SYNC_KEY = "rutaEntregas.u." + USER.id + ".sync.v1";
const SYNC_EVERY = 30000;
// sync = {email, uid, nombre, admin, access, refresh, exp, since, known:{id:huella}, last, err}
let sync = store.get(SYNC_KEY) || null;
const saveSync = ()=>store.set(SYNC_KEY, sync);
const syncOn = ()=>!!(sync && sync.refresh);

/* ---- Sesión ---- */
async function sbAuth(grant, body){
  const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=${grant}`, {method:"POST", headers:{apikey:SB_KEY, "Content-Type":"application/json"}, body:JSON.stringify(body)});
  const j = await r.json().catch(()=>({}));
  if(!r.ok){ const e = new Error(j.error_description || j.msg || j.message || ("HTTP " + r.status)); e.status = r.status; throw e; }
  return j;
}
function setTokens(j){ sync.access = j.access_token; sync.refresh = j.refresh_token; sync.exp = Date.now() + (j.expires_in||3600)*1000; if(j.user && j.user.id) sync.uid = j.user.id; }
async function sbToken(){
  if(!syncOn()) throw new Error("No has conectado el equipo.");
  if(!sync.access || Date.now() > sync.exp - 60000){
    try{ setTokens(await sbAuth("refresh_token", {refresh_token: sync.refresh})); saveSync(); }
    catch(e){
      if(e.status === 400 || e.status === 401){ sync.access = sync.refresh = null; sync.err = "La sesión venció: vuelve a conectar el equipo."; saveSync(); renderSync(); }
      throw e;
    }
  }
  return sync.access;
}
async function sb(path, opt = {}){
  const t = await sbToken();
  const r = await fetch(SB_URL + "/rest/v1/" + path, {...opt, headers:{apikey:SB_KEY, Authorization:"Bearer " + t, "Content-Type":"application/json", ...(opt.headers||{})}});
  if(!r.ok){ const j = await r.json().catch(()=>({})); throw new Error(j.message || ("HTTP " + r.status)); }
  if(r.status === 204) return null;
  const txt = await r.text(); return txt ? JSON.parse(txt) : null;
}

/* ---- Huella de cada parada: detecta qué cambió sin depender del orden de las claves (jsonb las reordena) ---- */
function stable(v){
  if(Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  if(v && typeof v === "object") return "{" + Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
  return JSON.stringify(v);
}
function huella(o){ const t = stable(o); let h = 0; for(let i=0;i<t.length;i++) h = (h*31 + t.charCodeAt(i))|0; return h.toString(36) + "." + t.length; }
// Lo que se sube: la parada sin el texto completo leído de la etiqueta, más su posición en la ruta (para que el administrador vea el orden).
function stopData(s, i){ const {raw, _ord, ...d} = s; d._ord = i; return d; }
const stopHash = (s, i)=>huella(stopData(s, i));

/* ---- Sincronizar: 1) traer cambios del servidor, 2) quitar las reasignadas a otro, 3) subir lo local ---- */
let syncing = null, syncTimer = null;
// Si ya hay una sincronización en curso, se espera esa misma (no se lanzan dos a la vez).
function syncNow(manual){
  if(!syncOn()) return Promise.resolve();
  if(syncing) return syncing;
  if(!navigator.onLine){ if(manual) toast("Sin internet: se sincroniza cuando vuelva la señal."); return Promise.resolve(); }
  syncing = doSync(manual).finally(()=>{ syncing = null; saveSync(); renderSync(); });
  return syncing;
}
async function doSync(manual){
  renderSync("Sincronizando…");
  const known = sync.known || (sync.known = {});
  const me = sync.uid;
  let added = 0, removed = 0, updated = 0;
  try{
    const ordOf = s=>state.stops.indexOf(s);
    // 1) Cambios del servidor desde la última vez (con 2 s de margen; las repetidas se ignoran por la huella).
    const since = sync.since ? new Date(new Date(sync.since).getTime() - 2000).toISOString() : "1970-01-01T00:00:00Z";
    const rows = await sb(`paradas?select=id,data,deleted,updated_at&owner=eq.${me}&updated_at=gte.${encodeURIComponent(since)}&order=updated_at.asc`) || [];
    for(const r of rows){
      const local = state.stops.find(s=>s.id===r.id);
      const tocadaAqui = local ? stopHash(local, ordOf(local)) !== known[r.id] : (r.id in known);
      if(r.deleted){
        if(local && !tocadaAqui){ state.stops.splice(state.stops.indexOf(local), 1); removed++; }
        if(!local || !tocadaAqui) delete known[r.id];
      } else if(!local){
        if(!(r.id in known)){   // nueva (la subió otro celular o el administrador te la pasó)
          const ns = {...r.data, raw:""}; delete ns._ord;
          const firstDone = state.stops.findIndex(q=>q.status==="done");
          state.stops.splice(firstDone<0 ? state.stops.length : firstDone, 0, ns);
          known[r.id] = stopHash(ns, ordOf(ns)); added++;
        } // si estaba en «known» y no está aquí, se borró en este celular: abajo se marca como borrada
      } else if(!tocadaAqui && huella(r.data) !== known[r.id]){
        const ord = ordOf(local); Object.assign(local, r.data); delete local._ord;
        known[r.id] = stopHash(local, ord); updated++;
      }
      if(!sync.since || r.updated_at > sync.since) sync.since = r.updated_at;
    }
    // 2) Paradas que ya no son tuyas (el administrador se las pasó a otra persona).
    const vivas = new Set((await sb(`paradas?select=id&owner=eq.${me}&deleted=is.false`) || []).map(x=>x.id));
    for(const id of Object.keys(known)){
      if(vivas.has(id)) continue;
      const local = state.stops.find(s=>s.id===id);
      if(local){ state.stops.splice(state.stops.indexOf(local), 1); removed++; }
      delete known[id];
    }
    // 3) Subir lo nuevo o cambiado aquí, y marcar como borradas las que ya no están.
    const up = [];
    state.stops.forEach((s, i)=>{ if(s.example) return; const h = stopHash(s, i); if(known[s.id] !== h) up.push({row:{id:s.id, owner:me, data:stopData(s, i), deleted:false}, h}); });
    if(up.length){
      await sb("paradas?on_conflict=id", {method:"POST", headers:{Prefer:"resolution=merge-duplicates,return=minimal"}, body:JSON.stringify(up.map(x=>x.row))});
      up.forEach(x=>{ known[x.row.id] = x.h; });
    }
    const aqui = new Set(state.stops.map(s=>s.id));
    const borrar = Object.keys(known).filter(id=>!aqui.has(id));
    if(borrar.length){
      await sb(`paradas?owner=eq.${me}&id=in.(${borrar.map(id=>'"' + id.replace(/"/g,"") + '"').join(",")})`, {method:"PATCH", headers:{Prefer:"return=minimal"}, body:JSON.stringify({deleted:true})});
      borrar.forEach(id=>delete known[id]);
    }
    sync.last = Date.now(); sync.err = "";
    if(added || removed || updated){
      saveSilently(); render();
      if(added) optimize(true, {estable:true});
      const msg = [added ? `${added} parada(s) nueva(s)` : "", removed ? `${removed} quitada(s)` : "", updated ? `${updated} actualizada(s)` : ""].filter(Boolean).join(" · ");
      toast("Equipo: " + msg + ".");
    }
  }catch(e){
    sync.err = "No se pudo sincronizar (" + (e.message || e) + "). Se reintenta solo.";
    if(manual) toast(sync.err);
  }
}
// Guardar sin volver a programar otra sincronización (evita un ciclo).
function saveSilently(){ syncMute = true; save(); syncMute = false; }
let syncMute = false;
// Se llama desde save(): sube los cambios unos segundos después (agrupa varios toques seguidos).
function onStateSaved(){
  if(syncMute || !syncOn()) return;
  clearTimeout(syncTimer); syncTimer = setTimeout(()=>syncNow(false), 4000);
}
setInterval(()=>{ if(document.visibilityState==="visible") syncNow(false); }, SYNC_EVERY);
document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="visible") syncNow(false); });
addEventListener("online", ()=>syncNow(false));

/* ---- Conectar / desconectar ---- */
async function connectTeam(email, pass){
  sync = {email: email.trim().toLowerCase(), known:{}, since:null};
  try{
    setTokens(await sbAuth("password", {email: sync.email, password: pass}));
    const m = await sb(`equipo_miembros?select=nombre,admin&user_id=eq.${sync.uid}`);
    if(!m || !m.length) throw new Error("Tu cuenta existe, pero no está en el equipo. Agrégala con el script supabase/equipo.sql.");
    sync.nombre = m[0].nombre; sync.admin = !!m[0].admin;
    saveSync(); renderSync();
    await syncNow(true);
    return "";
  }catch(e){
    sync = null; store.set(SYNC_KEY, null); renderSync();
    return /invalid login|invalid_grant|credentials/i.test(e.message) ? "Correo o contraseña incorrectos." : e.message;
  }
}
function disconnectTeam(){
  if(sync && sync.access) fetch(`${SB_URL}/auth/v1/logout?scope=local`,   // solo este celular: el otro con la misma cuenta sigue conectado
     {method:"POST", headers:{apikey:SB_KEY, Authorization:"Bearer " + sync.access}}).catch(()=>{});
  sync = null; store.set(SYNC_KEY, null); renderSync(); toast("Equipo desconectado. Tus paradas siguen en este celular.");
}

/* ---- Pantallas ---- */
function renderSync(busyMsg){
  const on = syncOn();
  $("btnTeam").hidden = !on;
  $("tmConnect").hidden = on; $("tmOn").hidden = !on;
  if(!on){ $("tmState").textContent = sync && sync.err ? sync.err : "Sin conectar. Cada persona conecta su app con su correo del equipo."; return; }
  const pend = Object.keys(sync.known||{}).length;
  $("tmState").textContent = busyMsg || (sync.err ? sync.err : `Conectado como ${sync.nombre} (${sync.email})${sync.admin ? " · administrador" : ""}. ` + (sync.last ? `Última sincronización: ${hhmm(sync.last)} · ${pend} parada(s) en la nube.` : ""));
  $("btnTeamTxt").textContent = sync.err ? "Equipo ⚠" : "Equipo";
  $("tmAdminBtn").hidden = !sync.admin;
}
$("tmConnect").addEventListener("submit", async e=>{
  e.preventDefault();
  const email = $("tmEmail").value, pass = $("tmPass").value;
  if(!email || !pass) return;
  $("tmGo").disabled = true; $("tmErr").textContent = "Conectando…";
  const err = await connectTeam(email, pass);
  $("tmGo").disabled = false; $("tmErr").textContent = err; $("tmPass").value = "";
  if(!err) toast(`Equipo conectado: ${sync.nombre}.`);
});
$("tmSync").onclick = ()=>syncNow(true);
$("tmOff").onclick = ()=>confirmBox("Desconectar el equipo", "Este celular deja de sincronizar. Tus paradas se quedan aquí y en la nube.", disconnectTeam);

/* ---- Vista del administrador: avance de cada persona y reasignar paradas ---- */
let teamCache = null;
async function loadTeam(){
  const [miembros, filas] = await Promise.all([
    sb("equipo_miembros?select=user_id,nombre,admin&order=nombre.asc"),
    sb(`paradas?select=id,owner,data,updated_at&deleted=is.false&owner=neq.${sync.uid}`)
  ]);
  teamCache = {miembros: miembros||[], filas: filas||[], t: Date.now()};
  return teamCache;
}
function teamRow(d, actions){
  const r = document.createElement("div"); r.className = "lrow";
  r.innerHTML = `<div><b></b><span class="hint"></span></div><div class="row" style="flex:0 0 auto;gap:6px"></div>`;
  r.querySelector("b").textContent = d.label || d.addr;
  r.querySelector(".hint").textContent = [unitText(d), guias(d).map(g=>"…" + g.slice(-4)).join(" "), d.status==="done" ? "Entregada " + (d.doneAt ? hhmm(d.doneAt) : "") : d.status==="fail" ? "No estaba" : ""].filter(Boolean).join(" · ");
  for(const [txt, fn] of actions){ const b = document.createElement("button"); b.type = "button"; b.className = "small"; b.textContent = txt; b.onclick = fn; r.querySelector(".row").appendChild(b); }
  return r;
}
async function reassign(id, owner, nombre){
  await sb(`paradas?id=eq.${encodeURIComponent(id)}`, {method:"PATCH", headers:{Prefer:"return=minimal"}, body:JSON.stringify({owner})});
  if(owner !== sync.uid){   // se la pasé a otro: sale de mi lista
    const local = state.stops.find(s=>s.id===id);
    if(local){ state.stops.splice(state.stops.indexOf(local), 1); }
    delete sync.known[id]; saveSync(); saveSilently(); render();
  }
  toast(owner === sync.uid ? "Parada pasada a tu ruta." : `Parada pasada a ${nombre}.`);
  await syncNow(false);
  renderTeam(true);
}
async function renderTeam(reload){
  const box = $("tmList");
  if(reload || !teamCache){ box.innerHTML = '<p class="hint">Cargando el equipo…</p>'; try{ await loadTeam(); }catch(e){ box.innerHTML = ""; const p = document.createElement("p"); p.className = "uerr"; p.textContent = "No se pudo cargar: " + e.message; box.appendChild(p); return; } }
  const {miembros, filas} = teamCache;
  box.innerHTML = "";
  const otros = miembros.filter(m=>m.user_id !== sync.uid);
  for(const m of otros){
    const suyas = filas.filter(f=>f.owner===m.user_id).map(f=>f.data).sort((a,b)=>(a._ord??0)-(b._ord??0));
    const pend = suyas.filter(d=>d.status!=="done"), done = suyas.filter(d=>d.status==="done");
    const paq = arr=>arr.reduce((a,d)=>a+(d.qty||1),0);
    const ult = done.filter(d=>d.doneAt).sort((a,b)=>b.doneAt-a.doneAt)[0];
    const card = document.createElement("div"); card.className = "found";
    card.innerHTML = `<div class="addr"></div><div class="hint" style="margin:0"></div><div class="progress"><i></i></div>`;
    card.querySelector(".addr").textContent = m.nombre;
    card.querySelector(".hint").textContent = suyas.length ? `${done.length} de ${suyas.length} paradas entregadas (${paq(done)} de ${paq(suyas)} paquetes)` + (ult ? ` · última ${hhmm(ult.doneAt)}` : "") + (pend[0] ? ` · sigue: ${pend[0].label || pend[0].addr}` : " · terminó") : "Sin paradas cargadas.";
    card.querySelector(".progress i").style.width = suyas.length ? Math.round(100*done.length/suyas.length) + "%" : "0";
    box.appendChild(card);
    for(const d of pend) box.appendChild(teamRow(d, [["Pasármela", ()=>reassign(d.id, sync.uid, sync.nombre)]]));
  }
  if(!otros.length){ const p = document.createElement("p"); p.className = "hint"; p.textContent = "Aún no hay otras personas en el equipo."; box.appendChild(p); }
  // Mis paradas pendientes: pasarlas a otra persona.
  const mias = state.stops.filter(s=>s.status!=="done" && !s.example);
  if(otros.length && mias.length){
    const h = document.createElement("h3"); h.textContent = "Pasar de mis paradas"; h.style.margin = "8px 0 0"; box.appendChild(h);
    for(const s of mias){
      if(!(s.id in (sync.known||{}))) continue;   // aún no sube a la nube
      box.appendChild(teamRow(s, otros.map(o=>["A " + o.nombre, ()=>confirmBox("Pasar parada", `¿Pasar ${s.label||s.addr} a ${o.nombre}? Sale de tu ruta.`, ()=>reassign(s.id, o.user_id, o.nombre))])));
    }
  }
  $("tmWhen").textContent = "Actualizado a las " + hhmm(teamCache.t);
}
$("btnTeam").onclick = ()=>{ renderSync(); $("dlgTeam").showModal(); if(sync && sync.admin) renderTeam(true); };
$("tmAdminBtn").onclick = ()=>renderTeam(true);
$("btnTeamCfg").onclick = ()=>{ renderSync(); $("dlgTeam").showModal(); if(sync && sync.admin) renderTeam(true); };
renderSync();
if(syncOn()) setTimeout(()=>syncNow(false), 1500);
