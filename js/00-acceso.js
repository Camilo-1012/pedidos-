/* ============ Usuarios y PIN (solo en este celular) ============
   La app (archivos js/01…09) no se carga hasta que alguien entra con su PIN.
   Cada usuario guarda sus pedidos e historial en claves propias: rutaEntregas.u.<id>.v1 / .hist.v1.
   El PIN nunca se guarda: se guarda PBKDF2-SHA256 (150 000 vueltas, sal aleatoria de 16 bytes). */
(function(){
"use strict";
const DB_KEY = "rutaEntregas.users.v1", SES_KEY = "rutaEntregas.session.v1";
const LEGACY = {state:"rutaEntregas.v1", hist:"rutaEntregas.hist.v1"};
const ITER = 150000, MAX_USERS = 6, FREE_TRIES = 5;
// Archivos de la app, en el orden en que deben ejecutarse (ver LEEME.md → «Estructura del código»).
const APP_FILES = ["js/01-direcciones.js","js/02-ruta.js","js/03-mapas.js","js/04-jornada.js","js/05-pantalla.js","js/06-escaner.js","js/07-cargue.js","js/08-voz.js","js/09-arranque.js","js/10-conduccion.js","js/11-equipo.js","js/12-aviso.js","js/13-buscar.js","js/14-apps.js"];
const q = id => document.getElementById(id);
const ls = {
  get(k){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; }catch(e){ return null; } },
  set(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); return true; }catch(e){ return false; } },
  del(k){ try{ localStorage.removeItem(k); }catch(e){} }
};
const ss = {
  get(){ try{ return JSON.parse(sessionStorage.getItem(SES_KEY)||"null"); }catch(e){ return null; } },
  set(v){ try{ sessionStorage.setItem(SES_KEY, JSON.stringify(v)); }catch(e){} },
  del(){ try{ sessionStorage.removeItem(SES_KEY); }catch(e){} }
};
const loadDb = () => { const d = ls.get(DB_KEY); return d && Array.isArray(d.users) ? d : {users:[], lockMin:15}; };
const saveDb = d => ls.set(DB_KEY, d);
const dataKeys = id => ["rutaEntregas.u."+id+".v1", "rutaEntregas.u."+id+".hist.v1"];
const authKey = id => "rutaEntregas.auth."+id;

/* ---- Cifrado del PIN ---- */
const enc = new TextEncoder();
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const CRYPTO_OK = !!(window.crypto && crypto.subtle && window.isSecureContext !== false);
async function pinHash(pin, salt, iter){
  const k = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  return b64(await crypto.subtle.deriveBits({name:"PBKDF2", hash:"SHA-256", salt:unb64(salt), iterations:iter}, k, 256));
}
async function makeCred(pin){
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  return {salt, iter:ITER, hash: await pinHash(pin, salt, ITER), pinLen: pin.length};
}
function sameStr(a,b){ if(a.length!==b.length) return false; let r = 0; for(let i=0;i<a.length;i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r===0; }
function pinProblem(pin){
  if(!/^\d{4,6}$/.test(pin)) return "El PIN debe tener de 4 a 6 números.";
  if(/^(\d)\1+$/.test(pin)) return "No uses el mismo número repetido (1111).";
  if("0123456789".includes(pin) || "9876543210".includes(pin)) return "No uses números seguidos (1234 o 4321).";
  return "";
}

/* ---- Intentos fallidos: tras 5, espera 30 s y se duplica (máx. 15 min). Sobrevive a recargar. ---- */
function waitLeft(id){ const a = ls.get(authKey(id)); return a && a.until > Date.now() ? Math.ceil((a.until-Date.now())/1000) : 0; }
function failed(id){
  const a = ls.get(authKey(id)) || {fails:0, until:0};
  a.fails++;
  if(a.fails >= FREE_TRIES) a.until = Date.now() + Math.min(900, 30 * 2 ** (a.fails - FREE_TRIES)) * 1000;
  ls.set(authKey(id), a); return a;
}
async function checkPin(u, pin){
  if(waitLeft(u.id)) return false;
  const ok = sameStr(await pinHash(pin, u.salt, u.iter), u.hash);
  if(ok) ls.del(authKey(u.id)); else failed(u.id);
  return ok;
}

/* ---- Arranque de la app para un usuario ---- */
let started = null, locked = true;
function fmtWait(s){ return s >= 60 ? Math.ceil(s/60) + " min" : s + " s"; }
function setInert(on){ document.querySelectorAll("body > header, body > main, body > .toolbar, body > .drive").forEach(e => { e.inert = on; }); }
function enter(u){
  ss.set({id:u.id, away:null});
  if(started && started !== u.id){ location.reload(); return; }
  locked = false; q("lock").hidden = true; setInert(false); pinBuf = "";
  if(started) return;
  started = u.id;
  window.RUTA_USER = {id:u.id, name:u.name, admin:!!u.admin};
  q("btnUserName").textContent = u.name;
  // Los archivos de la app se cargan en orden y solo después de entrar con el PIN.
  // Cuando carga el último, la app está completa: se vuelve a pintar (lo de los archivos finales, como «Parquea una vez»)
  // y se marca RUTA_LISTA (la usan las pruebas automáticas).
  APP_FILES.forEach((f, i)=>{
    const s = document.createElement("script"); s.src = f; s.async = false;
    if(i === APP_FILES.length - 1) s.onload = ()=>{ window.RUTA_LISTA = true; window.dispatchEvent(new Event("ruta-lista")); };
    document.body.appendChild(s);
  });
}
function lock(){
  if(typeof window.RUTA_onLock === "function"){ try{ window.RUTA_onLock(); }catch(e){} }
  document.querySelectorAll("dialog[open]").forEach(d => d.close());
  locked = true; setInert(true); ss.set({id:started, away:null, locked:true}); showLogin(started);
}

/* ---- Pantalla de bloqueo ---- */
let sel = null, pinBuf = "", busy = false;
function showSetup(){
  const d = loadDb();
  q("lock").hidden = false; q("lkLogin").hidden = true; q("lkSetup").hidden = false; setInert(true);
  q("suMsg").textContent = "";
  const legacy = !d.users.length && (ls.get(LEGACY.state) || ls.get(LEGACY.hist));
  q("suNote").textContent = legacy ? "Los pedidos e historial que ya tienes en este celular pasan a este usuario." : "Si olvidas el PIN, otro administrador te lo restablece. Si eres el único, tocará borrar tu usuario y sus datos.";
  if(!CRYPTO_OK) q("suMsg").textContent = "Abre la app desde su dirección https para poder usar PIN.";
  setTimeout(()=>q("suName").focus(), 50);
}
function showLogin(id){
  const d = loadDb();
  if(!d.users.length){ showSetup(); return; }
  q("lock").hidden = false; q("lkSetup").hidden = true; q("lkLogin").hidden = false;
  sel = d.users.find(u => u.id === id) || d.users.find(u => u.id === (ls.get("rutaEntregas.lastUser")||"")) || d.users[0];
  const box = q("lkUsers"); box.innerHTML = "";
  box.hidden = d.users.length < 2;
  d.users.forEach(u => {
    const b = document.createElement("button"); b.type = "button"; b.textContent = u.name;
    b.setAttribute("aria-pressed", u.id === sel.id ? "true" : "false");
    b.onclick = () => { sel = u; pinBuf = ""; showLogin(u.id); };
    box.appendChild(b);
  });
  q("lkWho").textContent = (d.users.length < 2 ? "Hola, " + sel.name + ". " : "") + "Escribe tu PIN";
  pinBuf = ""; drawDots(); tick();
}
function drawDots(){
  const n = sel ? sel.pinLen || 4 : 4, el = q("lkDots"); el.innerHTML = "";
  for(let i=0;i<n;i++){ const d = document.createElement("i"); if(i < pinBuf.length) d.className = "on"; el.appendChild(d); }
}
let tickT = null;
function tick(){
  clearTimeout(tickT);
  const w = sel ? waitLeft(sel.id) : 0;
  q("lkPad").querySelectorAll("button").forEach(b => b.disabled = !!w || busy);
  if(w){ q("lkMsg").textContent = "Demasiados intentos. Espera " + fmtWait(w) + "."; tickT = setTimeout(tick, 1000); }
  else if(/Espera/.test(q("lkMsg").textContent)) q("lkMsg").textContent = "";
}
async function tryPin(){
  if(busy || !sel || !pinBuf) return;
  busy = true; tick(); q("lkMsg").textContent = "Verificando…";
  const u = sel, ok = await checkPin(u, pinBuf).catch(() => false);
  busy = false; pinBuf = ""; drawDots();
  if(ok){ q("lkMsg").textContent = ""; ls.set("rutaEntregas.lastUser", u.id); enter(u); return; }
  const a = ls.get(authKey(u.id)) || {fails:0};
  q("lkMsg").textContent = a.fails >= FREE_TRIES ? "" : "PIN incorrecto. Te quedan " + (FREE_TRIES - a.fails) + " intento(s) antes de esperar.";
  if(navigator.vibrate) navigator.vibrate(120);
  tick();
}
function press(k){
  if(locked !== true || q("lkLogin").hidden || busy || (sel && waitLeft(sel.id))) return;
  if(k === "del"){ pinBuf = pinBuf.slice(0,-1); }
  else if(k === "ok"){ tryPin(); return; }
  else if(pinBuf.length < 6){ pinBuf += k; if(q("lkMsg").textContent && !/Espera/.test(q("lkMsg").textContent)) q("lkMsg").textContent = ""; }
  drawDots();
  if(sel && pinBuf.length === (sel.pinLen||0)) tryPin();
}
(function buildPad(){
  const pad = q("lkPad");
  ["1","2","3","4","5","6","7","8","9","del","0","ok"].forEach(k => {
    const b = document.createElement("button"); b.type = "button";
    b.textContent = k === "del" ? "Borrar" : k === "ok" ? "Entrar" : k;
    if(k === "del") b.className = "k-del"; if(k === "ok") b.className = "k-ok";
    b.setAttribute("aria-label", k === "del" ? "Borrar último número" : k === "ok" ? "Entrar" : k);
    b.onclick = () => press(k);
    pad.appendChild(b);
  });
})();
addEventListener("keydown", e => {
  if(q("lock").hidden || q("lkLogin").hidden || document.querySelector("dialog[open]")) return;
  if(/^\d$/.test(e.key)) press(e.key); else if(e.key === "Backspace") press("del"); else if(e.key === "Enter") press("ok");
});

q("lkSetup").addEventListener("submit", async e => {
  e.preventDefault();
  if(!CRYPTO_OK) return;
  const name = q("suName").value.trim().replace(/\s+/g," "), p1 = q("suPin").value, p2 = q("suPin2").value;
  const err = !name ? "Escribe tu nombre." : pinProblem(p1) || (p1 !== p2 ? "Los dos PIN no coinciden." : "");
  if(err){ q("suMsg").textContent = err; return; }
  q("suMsg").textContent = "Creando…";
  const d = loadDb();
  const u = {id: "u" + Date.now().toString(36) + Math.random().toString(36).slice(2,6), name, admin: !d.users.length, created: Date.now(), ...(await makeCred(p1))};
  // Primer usuario: hereda los pedidos e historial que ya había en el celular.
  if(!d.users.length){
    const [kS, kH] = dataKeys(u.id), st = ls.get(LEGACY.state), hi = ls.get(LEGACY.hist);
    if(st) ls.set(kS, st); if(hi) ls.set(kH, hi);
    if((!st || ls.get(kS)) && (!hi || ls.get(kH))){ ls.del(LEGACY.state); ls.del(LEGACY.hist); }
  }
  d.users.push(u); saveDb(d);
  q("suPin").value = q("suPin2").value = "";
  ls.set("rutaEntregas.lastUser", u.id);
  enter(u);
});

/* ---- Olvidé el PIN ---- */
q("lkForgot").onclick = () => {
  const d = loadDb(), u = sel; if(!u) return;
  const admins = d.users.filter(x => x.admin && x.id !== u.id);
  if(admins.length){
    ask({title:"¿Olvidaste tu PIN?", msg:"Pídele a " + admins.map(a => a.name).join(" o ") + " que entre y te ponga un PIN nuevo en Usuarios. Tus pedidos se conservan.", fields:[], yes:"Entendido", onOk: async () => ""});
    return;
  }
  ask({title:"Borrar " + u.name, msg:"Eres administrador y no hay otro que te restablezca el PIN. La única salida es borrar tu usuario y sus pedidos e historial de este celular (nadie puede verlos sin el PIN). Escribe BORRAR para confirmar.",
    fields:[{id:"c", label:"Confirmación", type:"text"}], yes:"Borrar", danger:true,
    onOk: async v => { if(v.c.trim().toUpperCase() !== "BORRAR") return "Escribe BORRAR para confirmar."; removeUser(u.id); started && started === u.id ? location.reload() : showLogin(); return ""; }});
};
function removeUser(id){
  const d = loadDb(), was = d.users.find(u => u.id === id);
  d.users = d.users.filter(u => u.id !== id);
  if(was && was.admin && d.users.length && !d.users.some(u => u.admin)) d.users.sort((a,b) => a.created - b.created)[0].admin = true;
  saveDb(d); dataKeys(id).forEach(ls.del); ls.del(authKey(id));
  const s = ss.get(); if(s && s.id === id) ss.del();
}

/* ---- Formulario genérico ---- */
let askCb = null;
function ask(o){
  q("akTitle").textContent = o.title; q("akMsg").textContent = o.msg || ""; q("akErr").textContent = "";
  const box = q("akFields"); box.innerHTML = "";
  (o.fields||[]).forEach(f => {
    const l = document.createElement("label"); l.textContent = f.label;
    const i = document.createElement("input"); i.id = "ak_" + f.id;
    if(f.type === "pin"){ i.type = "password"; i.inputMode = "numeric"; i.pattern = "[0-9]*"; i.maxLength = 6; i.autocomplete = "off"; i.style.letterSpacing = ".3em"; }
    else { i.type = "text"; i.autocomplete = "off"; i.maxLength = 24; }
    l.appendChild(i); box.appendChild(l);
  });
  q("akYes").textContent = o.yes || "Guardar"; q("akYes").className = o.danger ? "danger" : "primary";
  q("akNo").hidden = !(o.fields||[]).length;
  askCb = async () => {
    const v = {}; (o.fields||[]).forEach(f => v[f.id] = q("ak_" + f.id).value);
    q("akYes").disabled = true; q("akErr").textContent = (o.fields||[]).length ? "Guardando…" : "";
    const err = await o.onOk(v).catch(x => "No se pudo: " + (x && x.message || x));
    q("akYes").disabled = false; q("akErr").textContent = err || "";
    if(!err){ q("dlgAsk").close(); if(o.after) o.after(); }
  };
  q("dlgAsk").showModal();
  const first = box.querySelector("input"); if(first) setTimeout(() => first.focus(), 50);
}
q("frmAsk").addEventListener("submit", e => { e.preventDefault(); if(askCb) askCb(); });
q("akNo").onclick = () => q("dlgAsk").close();

/* ---- Diálogo Usuarios (dentro de la app) ---- */
const me = () => loadDb().users.find(u => u.id === started);
function renderUsers(){
  const d = loadDb(), m = me(); if(!m) return;
  q("usWho").textContent = "Sesión de " + m.name + (m.admin ? " (administrador)." : ".") + (m.admin ? "" : " Solo un administrador agrega usuarios o restablece PIN.");
  const list = q("usList"); list.innerHTML = "";
  d.users.forEach(u => {
    const row = document.createElement("div"); row.className = "urow";
    const t = document.createElement("div");
    t.innerHTML = "<b></b><div class='hint' style='margin:0'></div>";
    t.querySelector("b").textContent = u.name + (u.id === m.id ? " (tú)" : "");
    t.querySelector("div").textContent = u.admin ? "Administrador" : "Usuario";
    row.appendChild(t);
    if(m.admin && u.id !== m.id){
      const acts = document.createElement("div"); acts.className = "row";
      const bp = document.createElement("button"); bp.type = "button"; bp.className = "small"; bp.textContent = "Nuevo PIN";
      bp.onclick = () => ask({title:"Nuevo PIN para " + u.name, msg:"Dale el PIN nuevo a " + u.name + "; podrá cambiarlo luego en Usuarios.", fields:[{id:"p",label:"PIN nuevo",type:"pin"},{id:"p2",label:"Repite el PIN",type:"pin"}],
        onOk: async v => { const e = pinProblem(v.p) || (v.p !== v.p2 ? "Los dos PIN no coinciden." : ""); if(e) return e; const dd = loadDb(), x = dd.users.find(y => y.id === u.id); if(!x) return "Ese usuario ya no existe."; Object.assign(x, await makeCred(v.p)); saveDb(dd); ls.del(authKey(u.id)); return ""; }, after: renderUsers});
      const ba = document.createElement("button"); ba.type = "button"; ba.className = "small"; ba.textContent = "Hacer admin";
      ba.hidden = !!u.admin;
      ba.onclick = () => { const dd = loadDb(), x = dd.users.find(y => y.id === u.id); if(x){ x.admin = true; saveDb(dd); renderUsers(); } };
      const bd = document.createElement("button"); bd.type = "button"; bd.className = "small danger"; bd.textContent = "Eliminar";
      bd.onclick = () => ask({title:"Eliminar a " + u.name, msg:"Se borran su usuario, sus pedidos y su historial de este celular. Escribe BORRAR para confirmar.", fields:[{id:"c",label:"Confirmación",type:"text"}], yes:"Eliminar", danger:true,
        onOk: async v => v.c.trim().toUpperCase() === "BORRAR" ? (removeUser(u.id), "") : "Escribe BORRAR para confirmar.", after: renderUsers});
      acts.append(bp, ba, bd); row.appendChild(acts);
    }
    list.appendChild(row);
  });
  q("usAdd").hidden = !m.admin || d.users.length >= MAX_USERS;
  q("usLock").value = String(d.lockMin ?? 15);
}
q("btnUser").onclick = () => { renderUsers(); q("dlgUsers").showModal(); };
q("btnLock").onclick = () => lock();
q("usSwitch").onclick = () => { q("dlgUsers").close(); lock(); };
q("usLock").onchange = e => { const d = loadDb(); d.lockMin = +e.target.value; saveDb(d); };
q("usAdd").onclick = () => ask({title:"Agregar usuario", msg:"La otra persona entra con su nombre y su PIN, y ve solo sus propios pedidos.", fields:[{id:"n",label:"Nombre",type:"text"},{id:"p",label:"PIN de 4 a 6 números",type:"pin"},{id:"p2",label:"Repite el PIN",type:"pin"}],
  onOk: async v => {
    const name = v.n.trim().replace(/\s+/g," "), d = loadDb();
    if(!name) return "Escribe el nombre.";
    if(d.users.some(u => u.name.toLowerCase() === name.toLowerCase())) return "Ya hay un usuario con ese nombre.";
    if(d.users.length >= MAX_USERS) return "Máximo " + MAX_USERS + " usuarios por celular.";
    const e = pinProblem(v.p) || (v.p !== v.p2 ? "Los dos PIN no coinciden." : ""); if(e) return e;
    d.users.push({id:"u" + Date.now().toString(36) + Math.random().toString(36).slice(2,6), name, admin:false, created:Date.now(), ...(await makeCred(v.p))});
    saveDb(d); return "";
  }, after: renderUsers});
q("usMyPin").onclick = () => ask({title:"Cambiar mi PIN", fields:[{id:"o",label:"PIN actual",type:"pin"},{id:"p",label:"PIN nuevo",type:"pin"},{id:"p2",label:"Repite el PIN nuevo",type:"pin"}],
  onOk: async v => {
    const m = me(); if(!m) return "Sesión no válida.";
    const w = waitLeft(m.id); if(w) return "Demasiados intentos. Espera " + fmtWait(w) + ".";
    if(!(await checkPin(m, v.o))) return "El PIN actual no es correcto.";
    const e = pinProblem(v.p) || (v.p !== v.p2 ? "Los dos PIN no coinciden." : ""); if(e) return e;
    const d = loadDb(), x = d.users.find(u => u.id === m.id); Object.assign(x, await makeCred(v.p)); saveDb(d); return "";
  }});

/* ---- Bloqueo al volver a la app ---- */
document.addEventListener("visibilitychange", () => {
  if(!started || locked) return;
  const s = ss.get() || {id:started};
  if(document.visibilityState === "hidden"){ s.away = Date.now(); ss.set(s); return; }
  const min = loadDb().lockMin ?? 15, away = s.away ? Date.now() - s.away : 0;
  s.away = null; ss.set(s);
  if(min >= 0 && away > 0 && away >= min * 60000) lock();
});

/* ---- Inicio ---- */
function boot(){
  const d = loadDb();
  setInert(true);
  if(!d.users.length){ showSetup(); return; }
  // Si la app se recargó en la misma sesión (actualización, cambio de usuario) no vuelve a pedir el PIN,
  // salvo que haya estado fuera más del tiempo configurado.
  const s = ss.get(), u = s && d.users.find(x => x.id === s.id), min = d.lockMin ?? 15;
  const away = s && s.away ? Date.now() - s.away : 0;
  if(u && !s.locked && (min < 0 || !away || away < min * 60000)){ enter(u); return; }
  showLogin(s && s.id);
}
// Se espera a que la página termine de cargar antes de arrancar.
if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
