/* Arranque: versión, navegación entre secciones, menú, repartidores, actualizaciones y carga inicial de datos.
   Al publicar: subir el mismo número aquí (APP_VERSION) y en sw.js (CACHE). */
"use strict";
const APP_VERSION = "1.2";

/* ---- Secciones ---- */
const VISTAS = ["vRecibir", "vDespachar", "vDevolver", "vConsultar"];
function mostrarVista(v){
  if(!VISTAS.includes(v)) v = "vRecibir";
  VISTAS.forEach(x => { $(x).hidden = x !== v; });
  document.querySelectorAll("nav.tabs button").forEach(b => { if(b.dataset.v === v) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
  prefs.vista = v; savePrefs(); pintarVista();
}
document.querySelectorAll("nav.tabs button").forEach(b => b.onclick = () => { mostrarVista(b.dataset.v); scrollTo(0, 0); });
function pintarVista(){
  ({vRecibir: pintarRecibir, vDespachar: pintarDespachar, vDevolver: pintarDevolver, vConsultar: pintarConsultar})[prefs.vista]();
}
function pintarCabecera(){
  let b = 0, r = 0, e = 0; const d = hoy();
  for(const p of PAQ.values()){ if(p.estado === "BODEGA") b++; else if(p.estado === "RUTA") r++; else if(p.estado === "ENTREGADO" && diaDe(p.cerrado) === d) e++; }
  $("stBodega").textContent = b; $("stRuta").textContent = r; $("stEntHoy").textContent = e;
}
function pintarTodo(){ pintarCabecera(); pintarVista(); if(SC.cfg) pintarEscaner(); }
// Lo que llega de otros celulares se pinta, salvo que haya un formulario abierto (no se le mueve la pantalla a nadie).
let pintarT = null;
alCambiar(origen => {
  clearTimeout(pintarT);
  pintarT = setTimeout(() => { pintarCabecera(); if(SC.cfg) pintarEscaner(); if(origen === "local" || !document.querySelector("dialog[open]:not(#dlgScan)")) pintarVista(); }, origen === "local" ? 0 : 150);
});

/* ---- Menú ---- */
$("btnMenu").onclick = e => { e.stopPropagation(); const m = $("hdrMenu"); m.hidden = !m.hidden; $("btnMenu").setAttribute("aria-expanded", String(!m.hidden)); };
document.addEventListener("click", e => { if(!$("hdrMenu").hidden && !e.target.closest("#hdrMenu, #btnMenu")){ $("hdrMenu").hidden = true; $("btnMenu").setAttribute("aria-expanded", "false"); } });
$("hdrMenu").addEventListener("click", e => { if(e.target.closest("button")) $("hdrMenu").hidden = true; });
$("btnExcel").onclick = () => excelDia();
$("btnMore").onclick = () => { $("moSonido").checked = !!prefs.sonido; $("moVer").textContent = "Versión " + APP_VERSION + " · " + EV.size + " lecturas guardadas en este celular" + (idbFalla ? " · ⚠ no se pudo guardar en el celular (modo privado o sin espacio)" : "") + "."; $("dlgMore").showModal(); };
$("moSonido").onchange = e => { prefs.sonido = e.target.checked; savePrefs(); };
$("moBorrar").onclick = async () => {
  const pend = pendientesSubir().length;
  const v = await pedir({title:"Borrar los datos de este celular", msg:(pend ? `⚠ Hay ${pend} lectura(s) que NO se han subido a la nube y se perderán.\n` : "Todo está subido a la nube; se puede volver a bajar.\n") + "Escribe BORRAR para confirmar.",
    fields:[{id:"c", label:"Confirmación", type:"text"}], yes:"Borrar", danger:true, check: v => v.c.trim().toUpperCase() === "BORRAR" ? "" : "Escribe BORRAR."});
  if(!v) return;
  if(idb) idb.close();
  await new Promise(r => { const q = indexedDB.deleteDatabase("bodega"); q.onsuccess = q.onerror = q.onblocked = r; });
  store.del(SYNC_KEY); store.del(PREF_KEY); location.reload();
};

/* ---- Repartidores (los maneja un administrador; el servidor también lo exige) ---- */
function pintarReps(){
  const todos = [...REPS.values()].sort((a, b) => (b.activo - a.activo) || a.nombre.localeCompare(b.nombre, "es"));
  const admin = USER.admin;
  $("rpNota").textContent = admin ? "Los repartidores no necesitan usuario ni celular en esta app. Desactivar no borra su historial." : "Solo un administrador agrega o cambia repartidores.";
  $("rpAdd").hidden = !admin;
  $("rpList").innerHTML = todos.length ? "" : `<p class="hint">Aún no hay repartidores.</p>`;
  todos.forEach(r => {
    const enRuta = delRepartidor(r.rid).enRuta.length;
    const row = document.createElement("div"); row.className = "urow" + (r.activo ? "" : " inactivo");
    row.innerHTML = `<div><b></b><div class="hint" style="margin:0"></div></div>`;
    row.querySelector("b").textContent = r.nombre;
    row.querySelector(".hint").textContent = (r.activo ? "Activo" : "Inactivo") + (enRuta ? ` · ${enRuta} en ruta` : "");
    if(admin){
      const acts = document.createElement("div"); acts.className = "row";
      const bn = document.createElement("button"); bn.type = "button"; bn.className = "small"; bn.textContent = "Cambiar nombre";
      bn.onclick = async () => { const v = await pedir({title:"Nombre de " + r.nombre, fields:[{id:"n", label:"Nombre", type:"text", value:r.nombre, max:30}], check: v => validarNombreRep(v.n, r.rid)}); if(v){ registrar("REP", null, {rid: r.rid, nombre: limpiarNombre(v.n), activo: r.activo}); pintarReps(); pintarTodo(); } };
      const ba = document.createElement("button"); ba.type = "button"; ba.className = "small" + (r.activo ? " danger" : ""); ba.textContent = r.activo ? "Desactivar" : "Activar";
      ba.onclick = async () => {
        if(r.activo && enRuta && !await confirmar("Desactivar a " + r.nombre, `Tiene ${enRuta} paquete(s) en ruta. Liquídalo antes, o quedarán pendientes a su nombre.`, "Desactivar igual", true)) return;
        registrar("REP", null, {rid: r.rid, nombre: r.nombre, activo: !r.activo}); pintarReps(); pintarTodo();
      };
      acts.append(bn, ba); row.appendChild(acts);
    }
    $("rpList").appendChild(row);
  });
}
const limpiarNombre = n => n.trim().replace(/\s+/g, " ");
function validarNombreRep(n, rid){
  n = limpiarNombre(n);
  if(!n) return "Escribe el nombre.";
  if([...REPS.values()].some(r => r.rid !== rid && r.nombre.toLowerCase() === n.toLowerCase())) return "Ya hay un repartidor con ese nombre.";
  return "";
}
$("btnReps").onclick = () => { pintarReps(); $("dlgReps").showModal(); };
$("rpAdd").onclick = async () => {
  const v = await pedir({title:"Agregar repartidor", fields:[{id:"n", label:"Nombre (como lo conocen en la bodega)", type:"text", max:30}], yes:"Agregar", check: v => validarNombreRep(v.n)});
  if(!v) return;
  registrar("REP", null, {rid: "r" + uuid().slice(0, 8), nombre: limpiarNombre(v.n), activo: true});
  pintarReps(); pintarTodo();
};

/* ---- Sin señal ---- */
const pintarRed = () => { $("net").hidden = navigator.onLine; };
addEventListener("online", pintarRed); addEventListener("offline", pintarRed);

/* ---- Instalar ---- */
let deferredInstall = null;
addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredInstall = e; $("btnInstall").hidden = false; });
$("btnInstall").onclick = async () => { if(!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice.catch(() => {}); deferredInstall = null; $("btnInstall").hidden = true; };

/* ---- Actualizaciones (como en Ruta de Entregas: la versión nueva espera a que se toque «Actualizar») ---- */
let swReg = null, wantReload = false;
function showUpdate(w){
  if(!w || !navigator.serviceWorker.controller) return;
  $("upd").hidden = false; $("updBtn").disabled = false; $("updBtn").textContent = "Actualizar";
  $("updBtn").onclick = () => { wantReload = true; $("updBtn").disabled = true; $("updBtn").textContent = "Actualizando…"; w.postMessage({type:"skipWaiting"}); setTimeout(() => location.reload(), 5000); };
  try{ w.postMessage({type:"version"}); }catch(e){}
}
function watchInstall(nw){ if(nw) nw.addEventListener("statechange", () => { if(nw.state === "installed") showUpdate(nw); }); }
async function checkUpdate(manual){
  if(!swReg){ if(manual) toast("Las actualizaciones necesitan abrir la app desde su dirección https."); return; }
  if(!navigator.onLine){ if(manual) toast("Sin internet: busca la actualización cuando tengas señal."); return; }
  try{ await swReg.update(); }catch(e){ if(manual) toast("No se pudo revisar. Intenta de nuevo con buena señal."); return; }
  if(!manual) return;
  if(swReg.waiting) showUpdate(swReg.waiting);
  else if(swReg.installing) toast("Descargando la versión nueva… en un momento aparece el botón Actualizar.");
  else toast("Ya tienes la última versión (" + APP_VERSION + ").");
}
$("moUpd").onclick = () => checkUpdate(true);
if("serviceWorker" in navigator && location.protocol !== "file:"){
  navigator.serviceWorker.addEventListener("message", e => { if(e.data && e.data.type === "version" && e.data.version !== APP_VERSION) $("updTxt").textContent = "Hay una versión nueva (" + e.data.version + ")."; });
  navigator.serviceWorker.addEventListener("controllerchange", () => { if(wantReload){ wantReload = false; location.reload(); } });
  navigator.serviceWorker.register("sw.js").then(reg => {
    swReg = reg;
    if(reg.waiting) showUpdate(reg.waiting);
    watchInstall(reg.installing);
    reg.addEventListener("updatefound", () => watchInstall(reg.installing));
    document.addEventListener("visibilitychange", () => { if(document.visibilityState === "visible") checkUpdate(false); });
    setInterval(() => checkUpdate(false), 30 * 60000);
  }).catch(err => console.warn("SW", err));
}

/* ---- Inicio ---- */
(async () => {
  await datosIniciar();
  pintarRed();
  mostrarVista(prefs.vista);
  pintarCabecera(); pintarSync();
  window.BODEGA_DATOS = true;   // lo usan las pruebas automáticas
  purgar().then(n => { if(n) pintarTodo(); });
  syncNow(false);
})();
