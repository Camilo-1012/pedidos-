/* ============ Usuarios y PIN (solo en este celular) ============
   Una sola app con dos pantallas: Ruta (repartidor, index.html) y Bodega (despachador, bodega.html, <body data-app="bodega">).
   Cada usuario tiene un rol: repartidor (solo Ruta) o despachador (Ruta y Bodega). El administrador y los despachadores
   eligen en la pantalla del PIN a cuál entrar («Ruta» o «Bodega») y cambian desde el menú (☰ → Ir a Bodega / Ir a Ruta)
   sin volver a pedir el PIN (la sesión es de la pestaña). Los repartidores no ven esa opción y entran siempre a Ruta.
   La app (archivos js/01…09) no se carga hasta que alguien entra con su PIN.
   Cada usuario guarda sus pedidos e historial en claves propias: rutaEntregas.u.<id>.v1 / .hist.v1.
   El PIN nunca se guarda: se guarda PBKDF2-SHA256 (150 000 vueltas, sal aleatoria de 16 bytes). */
(function(){
"use strict";
const DB_KEY = "rutaEntregas.users.v1", SES_KEY = "rutaEntregas.session.v1";
const LEGACY = {state:"rutaEntregas.v1", hist:"rutaEntregas.hist.v1"};
const ITER = 150000, MAX_USERS = 6, FREE_TRIES = 5;
// Archivos de la app, en el orden en que deben ejecutarse (ver LEEME.md → «Estructura del código»).
const PAGE = document.body.dataset.app === "bodega" ? "bodega" : "ruta";
const APP_FILES = PAGE === "bodega"
  ? ["js/15-excel.js","bodega/js/01-base.js","bodega/js/02-datos.js","bodega/js/03-escaner.js","bodega/js/04-recepcion.js","bodega/js/05-despacho.js","bodega/js/06-devolucion.js","bodega/js/07-consulta.js","bodega/js/08-excel.js","bodega/js/09-sync.js","bodega/js/10-zonas.js","bodega/js/12-importar.js","bodega/js/13-pagos.js","js/17-personas.js","bodega/js/11-arranque.js"]
  : ["js/01-direcciones.js","js/02-ruta.js","js/03-mapas.js","js/04-jornada.js","js/05-pantalla.js","js/06-escaner.js","js/07-cargue.js","js/08-voz.js","js/09-arranque.js","js/10-conduccion.js","js/11-equipo.js","js/12-aviso.js","js/13-buscar.js","js/14-apps.js","js/15-excel.js","js/16-bodega.js","js/17-personas.js"];
/* ---- Roles ---- */
const ROLES = {repartidor:"Repartidor (solo Ruta)", despachador:"Despachador (Ruta y Bodega)"};
const PAGINA = {ruta:"./", bodega:"bodega.html"};
const APP_KEY = id => "rutaEntregas.app." + id;   // última pantalla elegida por cada usuario (en este celular)
// Usuarios de antes de los roles: el administrador queda como despachador; los demás, repartidores (como venían usando la app).
const rolDe = u => ROLES[u.rol] ? u.rol : (u.admin ? "despachador" : "repartidor");
// Eligen pantalla: el administrador (siempre) y los despachadores. Los repartidores solo entran a Ruta.
const eligeApp = u => !!u.admin || rolDe(u) === "despachador";
const puede = (u, page) => page === "ruta" || eligeApp(u);
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
function setInert(on){ document.querySelectorAll("body > header, body > main, body > .toolbar, body > .drive, body > nav.tabs").forEach(e => { e.inert = on; }); }
function enter(u, destino){
  ss.set({id:u.id, away:null});
  // Pantalla elegida al entrar, o la que no es de su rol: se abre la otra (la sesión sigue, no pide el PIN otra vez).
  if(destino && destino !== PAGE && puede(u, destino)){ location.replace(PAGINA[destino]); return; }
  if(!puede(u, PAGE)){ location.replace(PAGINA.ruta); return; }
  if(started && started !== u.id){ location.reload(); return; }
  locked = false; q("lock").hidden = true; setInert(false); pinBuf = "";
  if(started) return;
  started = u.id;
  window.RUTA_USER = window.BODEGA_USER = {id:u.id, name:u.name, admin:!!u.admin, rol:rolDe(u)};
  q("btnUserName").textContent = u.name;
  const rolTxt = q("btnUserRol"); if(rolTxt) rolTxt.textContent = (u.admin ? "Administrador · " : "") + (rolDe(u) === "despachador" ? "Despachador" : "Repartidor");
  // Menú «Trabajar como: Repartidor (Ruta) | Despachador (Bodega)»: solo administrador y despachadores.
  const mn = q("mnApp"), otra = q("btnOtraApp"), otraPag = PAGE === "ruta" ? "bodega" : "ruta";
  if(mn) mn.hidden = !eligeApp(u);
  if(otra){ otra.hidden = !eligeApp(u); otra.onclick = () => { ls.set(APP_KEY(u.id), otraPag); location.href = PAGINA[otraPag]; }; }
  // Los archivos de la app se cargan en orden y solo después de entrar con el PIN.
  // Cuando carga el último, la app está completa: se vuelve a pintar (lo de los archivos finales, como «Parquea una vez»)
  // y se marca RUTA_LISTA (la usan las pruebas automáticas).
  APP_FILES.forEach((f, i)=>{
    const s = document.createElement("script"); s.src = f; s.async = false;
    if(i === APP_FILES.length - 1) s.onload = ()=>{
      if(PAGE === "bodega"){ window.BODEGA_LISTA = true; window.dispatchEvent(new Event("bodega-lista")); }
      else { window.RUTA_LISTA = true; window.dispatchEvent(new Event("ruta-lista")); }
    };
    document.body.appendChild(s);
  });
}
function lock(){
  for(const f of [window.RUTA_onLock, window.BODEGA_onLock]) if(typeof f === "function"){ try{ f(); }catch(e){} }
  document.querySelectorAll("dialog[open]").forEach(d => d.close());
  locked = true; setInert(true); ss.set({id:started, away:null, locked:true}); showLogin(started);
}

/* ---- Pantalla de bloqueo ---- */
let sel = null, pinBuf = "", busy = false;
function showSetup(){
  const d = loadDb();
  q("lock").hidden = false; q("lkLogin").hidden = true; q("lkSetup").hidden = false; setInert(true);
  if(q("lkCuenta")) q("lkCuenta").hidden = true;
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
  if(q("lkCuenta")) q("lkCuenta").hidden = true;
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
  pintarApp();
  pinBuf = ""; drawDots(); tick();
}
// Selector «Entrar a: Ruta | Bodega»: solo para el administrador y los despachadores. Recuerda la última elección.
let appSel = PAGE;
function pintarApp(){
  const box = q("lkApp"); if(!box) return;
  const ve = !!sel && eligeApp(sel);
  box.hidden = !ve;
  appSel = ve ? (ls.get(APP_KEY(sel.id)) || PAGE) : "ruta";
  box.querySelectorAll("button[data-app]").forEach(b => {
    b.setAttribute("aria-pressed", String(b.dataset.app === appSel));
    b.onclick = () => { appSel = b.dataset.app; ls.set(APP_KEY(sel.id), appSel); pintarApp(); };
  });
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
  if(ok){ q("lkMsg").textContent = ""; ls.set("rutaEntregas.lastUser", u.id); enter(u, eligeApp(u) ? appSel : "ruta"); return; }
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
  // El primer usuario es administrador (elige Ruta o Bodega); los demás los agrega él con su rol.
  const u = {id: "u" + Date.now().toString(36) + Math.random().toString(36).slice(2,6), name, admin: !d.users.length, rol: d.users.length && PAGE !== "bodega" ? "repartidor" : "despachador", created: Date.now(), ...(await makeCred(p1))};
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
  // Con usuario del equipo: se pone un PIN nuevo con la contraseña del equipo (sin borrar nada).
  if(u.cuenta){
    ask({title:"PIN nuevo para " + u.name, msg:"Escribe tu contraseña del equipo (" + u.cuenta.replace(/@ruta\.local$/, "") + ") y tu PIN nuevo. Necesita internet.",
      fields:[{id:"c", label:"Contraseña del equipo", type:"text"}, {id:"p", label:"PIN nuevo", type:"pin"}, {id:"p2", label:"Repite el PIN", type:"pin"}], yes:"Cambiar PIN",
      onOk: async v => {
        const e = pinProblem(v.p) || (v.p !== v.p2 ? "Los dos PIN no coinciden." : ""); if(e) return e;
        try{ await sesionNube(u.cuenta, v.c); }catch(x){ return x.message; }
        const dd = loadDb(), x = dd.users.find(y => y.id === u.id); if(!x) return "Ese usuario ya no existe.";
        Object.assign(x, await makeCred(v.p)); saveDb(dd); ls.del(authKey(u.id)); return "";
      }, after: () => showLogin(u.id)});
    const c = q("ak_c"); if(c){ c.type = "password"; c.maxLength = 72; }
    return;
  }
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
    t.querySelector("div").textContent = (u.admin ? "Administrador · " : "") + ROLES[rolDe(u)];
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
      const br = document.createElement("button"); br.type = "button"; br.className = "small"; br.textContent = "Cambiar rol";
      br.onclick = () => { const dd = loadDb(), x = dd.users.find(y => y.id === u.id); if(!x) return; x.rol = rolDe(x) === "repartidor" ? "despachador" : "repartidor"; if(x.rol === "repartidor") ls.del(APP_KEY(x.id)); saveDb(dd); renderUsers(); };
      acts.append(br, bp, ba, bd); row.appendChild(acts);
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
q("usAdd").onclick = () => ask({title:"Agregar usuario", msg:"La otra persona entra con su nombre y su PIN, y ve solo sus propios pedidos. Queda como " + (PAGE === "bodega" ? "despachador" : "repartidor") + ": cámbialo con «Cambiar rol».", fields:[{id:"n",label:"Nombre",type:"text"},{id:"p",label:"PIN de 4 a 6 números",type:"pin"},{id:"p2",label:"Repite el PIN",type:"pin"}],
  onOk: async v => {
    const name = v.n.trim().replace(/\s+/g," "), d = loadDb();
    if(!name) return "Escribe el nombre.";
    if(d.users.some(u => u.name.toLowerCase() === name.toLowerCase())) return "Ya hay un usuario con ese nombre.";
    if(d.users.length >= MAX_USERS) return "Máximo " + MAX_USERS + " usuarios por celular.";
    const e = pinProblem(v.p) || (v.p !== v.p2 ? "Los dos PIN no coinciden." : ""); if(e) return e;
    d.users.push({id:"u" + Date.now().toString(36) + Math.random().toString(36).slice(2,6), name, admin:false, rol: PAGE === "bodega" ? "despachador" : "repartidor", created:Date.now(), ...(await makeCred(v.p))});
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

/* ---- «Ya tengo usuario del equipo» (v2.35) ----
   La persona que un administrador creó en ☰ → Personas entra en SU celular con usuario (o correo) y contraseña:
   se crea su usuario de este celular (nombre, rol y administrador vienen de la nube), elige su PIN y queda
   conectada al equipo (Ruta y, si es despachador, Bodega). La contraseña no se guarda: solo las sesiones. */
const SB_URL_ACC = "https://aptyzcodlubefqrscmvc.supabase.co", SB_KEY_ACC = "sb_publishable_dNrUbYZmql3Qei4-peiJNQ_4waYeXkx";
const correoDe = t => { t = String(t || "").trim().toLowerCase(); return t.includes("@") ? t : t + "@ruta.local"; };
async function sesionNube(email, clave){
  let r;
  try{ r = await fetch(`${SB_URL_ACC}/auth/v1/token?grant_type=password`, {method:"POST", headers:{apikey:SB_KEY_ACC, "Content-Type":"application/json"}, body:JSON.stringify({email, password:clave})}); }
  catch(e){ throw new Error("Sin internet: la primera vez se necesita señal para entrar con tu usuario."); }
  const j = await r.json().catch(() => ({}));
  if(!r.ok) throw new Error(/invalid|credentials|grant/i.test(j.error_description || j.msg || j.error || "") ? "Usuario o contraseña incorrectos." : /banned/i.test(JSON.stringify(j)) ? "Tu cuenta está desactivada. Habla con el administrador." : (j.error_description || j.msg || "No se pudo entrar (" + r.status + ")."));
  return j;
}
async function leerNube(tabla, tok){
  const r = await fetch(`${SB_URL_ACC}/rest/v1/${tabla}`, {headers:{apikey:SB_KEY_ACC, Authorization:"Bearer " + tok}});
  if(!r.ok) return null;
  return r.json().catch(() => null);
}
function panelCuenta(){
  let f = q("lkCuenta"); if(f) return f;
  f = document.createElement("form"); f.id = "lkCuenta"; f.className = "lkPane"; f.hidden = true;
  f.innerHTML = `<p style="margin:0"><b>Entrar con mi usuario del equipo</b><br>El que te dio el administrador. Después eliges tu PIN para este celular.</p>
    <label for="cuUsuario">Usuario o correo<input id="cuUsuario" class="name" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="120" required></label>
    <label for="cuClave">Contraseña<input id="cuClave" type="password" autocomplete="current-password" maxlength="72" required></label>
    <label for="cuPin">Tu PIN de 4 a 6 números<input id="cuPin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="new-password" required></label>
    <label for="cuPin2">Repite el PIN<input id="cuPin2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="new-password" required></label>
    <p class="lkMsg" id="cuMsg" role="alert"></p>
    <button type="submit" class="primary" id="cuGo">Entrar</button>
    <button type="button" class="linkish" id="cuVolver">Volver</button>`;
  q("lkSetup").parentNode.insertBefore(f, q("lkSetup"));
  q("cuVolver").onclick = () => { f.hidden = true; const d = loadDb(); d.users.length ? showLogin() : showSetup(); };
  f.addEventListener("submit", async e => {
    e.preventDefault();
    if(!CRYPTO_OK) return;
    const msg = q("cuMsg"), email = correoDe(q("cuUsuario").value), clave = q("cuClave").value, p1 = q("cuPin").value, p2 = q("cuPin2").value;
    const err = !q("cuUsuario").value.trim() || !clave ? "Escribe tu usuario y tu contraseña." : pinProblem(p1) || (p1 !== p2 ? "Los dos PIN no coinciden." : "");
    if(err){ msg.textContent = err; return; }
    const d = loadDb();
    const ya = d.users.find(u => u.cuenta === email);
    if(ya){ msg.textContent = `${ya.name} ya está en este celular: entra con tu PIN.`; return; }
    if(d.users.length >= MAX_USERS){ msg.textContent = `Este celular ya tiene ${MAX_USERS} usuarios.`; return; }
    q("cuGo").disabled = true; msg.textContent = "Entrando…";
    try{
      const s1 = await sesionNube(email, clave), uid = s1.user && s1.user.id;
      const fila = ((await leerNube(`equipo_miembros?select=nombre,admin,rol,activo&user_id=eq.${uid}`, s1.access_token)) || [])[0];
      if(!fila) throw new Error("Tu cuenta existe pero no está en el equipo. Pídele al administrador que te agregue en ☰ → Personas.");
      if(fila.activo === false) throw new Error("Tu cuenta está desactivada. Habla con el administrador.");
      const rol = ROLES[fila.rol] ? fila.rol : (fila.admin ? "despachador" : "repartidor");
      const u = {id: "u" + Date.now().toString(36) + Math.random().toString(36).slice(2,6), name: String(fila.nombre || "").slice(0, 24) || email.split("@")[0], admin: !!fila.admin, rol, cuenta: email, created: Date.now(), ...(await makeCred(p1))};
      const exp = j => Date.now() + (j.expires_in || 3600) * 1000;
      // Ruta: su propia sesión (cada usuario sincroniza SU ruta).
      ls.set("rutaEntregas.u." + u.id + ".sync.v1", {email, uid, nombre: fila.nombre, admin: !!fila.admin, access: s1.access_token, refresh: s1.refresh_token, exp: exp(s1), known:{}, since:null});
      // Bodega (despachador o administrador): sesión aparte (las sesiones de Supabase no se comparten), si el celular aún no tiene una.
      const bod = ls.get("bodega.sync.v1");
      if(eligeApp(u) && !(bod && bod.refresh)){
        const s2 = await sesionNube(email, clave).catch(() => null);
        const bm = s2 && ((await leerNube(`bodega_miembros?select=nombre,rol&user_id=eq.${uid}`, s2.access_token)) || [])[0];
        if(bm) ls.set("bodega.sync.v1", {email, uid, nombre: bm.nombre, rol: bm.rol, access: s2.access_token, refresh: s2.refresh_token, exp: exp(s2), seq: 0, catalogo: false});
      }
      d.users.push(u); saveDb(d);
      ["cuClave","cuPin","cuPin2"].forEach(id => { q(id).value = ""; });
      ls.set("rutaEntregas.lastUser", u.id);
      f.hidden = true; msg.textContent = "";
      enter(u, eligeApp(u) ? (ls.get(APP_KEY(u.id)) || "bodega") : "ruta");
    }catch(x){ msg.textContent = x.message || String(x); }
    finally{ q("cuGo").disabled = false; }
  });
  return f;
}
function abrirCuenta(){
  const f = panelCuenta();
  q("lock").hidden = false; q("lkSetup").hidden = true; q("lkLogin").hidden = true; f.hidden = false; setInert(true);
  q("cuMsg").textContent = "";
  setTimeout(() => q("cuUsuario").focus(), 50);
}
for(const [ancla, id] of [["lkSetup", "suCuenta"], ["lkLogin", "lkCuentaBtn"]]){
  const b = document.createElement("button"); b.type = "button"; b.className = "linkish"; b.id = id; b.textContent = "Ya tengo usuario del equipo";
  b.onclick = abrirCuenta; q(ancla).appendChild(b);
}

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
