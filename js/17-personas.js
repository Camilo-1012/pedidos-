/* ============ Personas del equipo (v2.35): crear y administrar cuentas DESDE LA APP ============
   Lo usa cualquier ADMINISTRADOR del equipo (no solo Camilo), en Ruta y en Bodega: ☰ → Personas.
   La app no crea cuentas por sí misma: le pide a la función de Supabase «equipo-usuarios» (ver
   supabase/functions/equipo-usuarios/index.ts), que verifica que quien pide sea administrador y es la única que
   tiene la llave de servicio. Aquí solo va la clave pública, como en el resto de la app.
   En un paso: cuenta (usuario o correo + contraseña), equipo de Ruta, bodega (despachador) o repartidor de la
   bodega ya vinculado a su Ruta (repartidor). La persona entra en su celular con «Ya tengo usuario del equipo».
   Usa SB_URL, SB_KEY, sbToken(), syncOn() y toast() de la pantalla donde se carga (Ruta o Bodega). */
"use strict";
(function(){
const YO = window.RUTA_USER || window.BODEGA_USER || {};
const EN_BODEGA = document.body.dataset.app === "bodega";
const FN = () => SB_URL + "/functions/v1/equipo-usuarios";
const $p = id => document.getElementById(id);
const escP = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const ROL_TXT = {repartidor:"Repartidor", despachador:"Despachador"};

// Contraseña inicial legible (sin letras que se confunden: l/1, o/0): «kp7r-4m2x-9c», ~49 bits.
function claveNueva(){
  const A = "abcdefghjkmnpqrstuvwxyz23456789", n = new Uint32Array(10); crypto.getRandomValues(n);
  const s = [...n].map(x => A[x % A.length]).join("");
  return s.slice(0, 4) + "-" + s.slice(4, 8) + "-" + s.slice(8);
}

async function llamar(accion, datos){
  if(typeof syncOn !== "function" || !syncOn()) throw new Error("Primero conecta este celular al equipo en la nube (☰ → Equipo) con tu cuenta de administrador.");
  if(!navigator.onLine) throw new Error("Crear o cambiar personas necesita internet.");
  const t = await sbToken();
  let r;
  try{ r = await fetch(FN(), {method:"POST", headers:{apikey:SB_KEY, Authorization:"Bearer " + t, "Content-Type":"application/json"}, body:JSON.stringify({accion, ...(datos || {})})}); }
  catch(e){ throw new Error("No se pudo llegar a la función de Supabase. ¿Ya se desplegó «equipo-usuarios»? (ver supabase/LEEME-usuarios.md)"); }
  const j = await r.json().catch(() => ({}));
  if(r.status === 404) throw new Error("Falta desplegar la función «equipo-usuarios» en Supabase (ver supabase/LEEME-usuarios.md).");
  if(!r.ok) throw new Error(j.error || j.message || ("Error " + r.status));
  return j;
}

/* ---- Ventana ---- */
function crearVentana(){
  if($p("dlgPersonas")) return $p("dlgPersonas");
  const d = document.createElement("dialog"); d.id = "dlgPersonas"; d.setAttribute("aria-labelledby", "peTitle");
  d.innerHTML = `<div class="peBox">
    <div class="dlgHead"><h2 id="peTitle">Personas</h2><button type="button" class="small" id="peCerrar">Cerrar</button></div>
    <p class="hint" id="peEstado" style="margin:0" aria-live="polite"></p>
    <div id="peListo" class="peListo" hidden role="status"></div>
    <button type="button" class="primary" id="peAgregar">Agregar persona</button>
    <form id="peForm" class="peForm" hidden>
      <h3 id="peFormT">Nueva persona</h3>
      <label for="peNombre">Nombre<input id="peNombre" maxlength="40" autocomplete="off" required></label>
      <label for="peUsuario" id="peUsuarioL">Usuario o correo<input id="peUsuario" maxlength="120" autocomplete="off" autocapitalize="none" spellcheck="false" required>
        <small class="hint">Ej.: <b>luis</b> (no necesita correo) o su correo real.</small></label>
      <fieldset class="peRol"><legend>Rol</legend>
        <label><input type="radio" name="peRol" value="repartidor" checked> Repartidor <small>(solo Ruta: le salen los paquetes que le despachen)</small></label>
        <label><input type="radio" name="peRol" value="despachador"> Despachador <small>(Ruta y Bodega)</small></label>
      </fieldset>
      <label class="peCheck"><input type="checkbox" id="peAdmin"> Administrador <small>(puede crear y cambiar personas)</small></label>
      <label for="peRep" id="peRepL" hidden>Repartidor de la bodega<select id="peRep"></select></label>
      <label for="peClave" id="peClaveL">Contraseña inicial<span class="row" style="flex-wrap:nowrap"><input id="peClave" maxlength="72" autocomplete="off" spellcheck="false" style="flex:1"><button type="button" class="small" id="peOtra">Otra</button></span></label>
      <p class="uerr" id="peErr" role="alert"></p>
      <div class="row"><button type="button" id="peCancelar">Cancelar</button><button type="submit" class="primary" id="peGuardar" style="flex:1">Crear</button></div>
    </form>
    <div id="peLista" class="peLista"></div>
  </div>`;
  document.body.appendChild(d);
  $p("peCerrar").onclick = () => d.close();
  $p("peAgregar").onclick = () => abrirForm(null);
  $p("peCancelar").onclick = cerrarForm;
  $p("peOtra").onclick = () => { $p("peClave").value = claveNueva(); };
  d.querySelectorAll('input[name="peRol"]').forEach(r => r.onchange = pintarRep);
  $p("peForm").onsubmit = e => { e.preventDefault(); guardar(); };
  return d;
}

let gente = [], editando = null;
function pintarRep(){
  // En Bodega, un repartidor nuevo puede quedar como uno que ya existe en la bodega (sin cuenta vinculada).
  const l = $p("peRepL"), s = $p("peRep");
  const rol = (document.querySelector('input[name="peRol"]:checked') || {}).value;
  const libres = EN_BODEGA && typeof repsActivos === "function" && typeof VINC !== "undefined" ? repsActivos().filter(r => !VINC.has(r.rid)) : [];
  l.hidden = !!editando || rol !== "repartidor" || !libres.length;
  if(!l.hidden) s.innerHTML = `<option value="">Nuevo (se crea con su nombre)</option>` + libres.map(r => `<option value="${escP(r.rid)}">Es ${escP(r.nombre)} (ya está en la bodega)</option>`).join("");
}
function abrirForm(p){
  editando = p;
  $p("peListo").hidden = true;
  $p("peForm").hidden = false; $p("peAgregar").hidden = true;
  $p("peFormT").textContent = p ? "Editar a " + p.nombre : "Nueva persona";
  $p("peGuardar").textContent = p ? "Guardar" : "Crear";
  $p("peNombre").value = p ? p.nombre : "";
  $p("peUsuarioL").hidden = $p("peClaveL").hidden = !!p;
  $p("peUsuario").required = !p;
  $p("peUsuario").value = ""; $p("peClave").value = p ? "" : claveNueva();
  document.querySelectorAll('input[name="peRol"]').forEach(r => { r.checked = r.value === (p ? p.rol : "repartidor"); });
  $p("peAdmin").checked = !!(p && p.admin);
  $p("peErr").textContent = "";
  pintarRep();
  setTimeout(() => { const a = document.activeElement; if(!(a && a.closest && a.closest("#peForm") && a.id !== "peNombre")) $p("peNombre").focus(); }, 30);
}
function cerrarForm(){ editando = null; $p("peForm").hidden = true; $p("peAgregar").hidden = false; }

async function guardar(){
  const nombre = $p("peNombre").value.trim(), rol = (document.querySelector('input[name="peRol"]:checked') || {}).value || "repartidor", admin = $p("peAdmin").checked;
  if(!nombre){ $p("peErr").textContent = "Escribe el nombre."; return; }
  $p("peGuardar").disabled = true; $p("peErr").textContent = editando ? "Guardando…" : "Creando la cuenta…";
  try{
    if(editando){
      await llamar("editar", {user_id: editando.user_id, nombre, rol, admin});
      toast("Cambios guardados: " + nombre + ".");
      cerrarForm();
    }else{
      const usuario = $p("peUsuario").value.trim(), clave = $p("peClave").value;
      const r = await llamar("crear", {nombre, usuario, clave, rol, admin, rid: $p("peRepL").hidden ? undefined : ($p("peRep").value || undefined)});
      cerrarForm();
      mostrarDatos(nombre, r.usuario, clave, rol, r.aviso);
      refrescarBodega();
    }
    await cargar();
  }catch(e){ $p("peErr").textContent = e.message || String(e); }
  finally{ $p("peGuardar").disabled = false; }
}
// Los datos para entrar se muestran UNA vez (la contraseña no se guarda en este celular).
function mostrarDatos(nombre, usuario, clave, rol, aviso){
  const box = $p("peListo");
  box.innerHTML = `<b>Listo: ${escP(nombre)} ya puede entrar.</b>
    <p style="margin:6px 0">Dale estos datos. En su celular abre la app y toca <b>«Ya tengo usuario del equipo»</b>:</p>
    <div class="peDatos"><span>Usuario</span><b id="peDU">${escP(usuario)}</b><span>Contraseña</span><b id="peDC">${escP(clave)}</b></div>
    ${rol === "repartidor" ? `<p class="hint" style="margin:6px 0 0">Ya quedó como repartidor de la bodega: lo que le despachen le sale en su Ruta.</p>` : ""}
    ${aviso ? `<p class="uerr" style="margin:6px 0 0">${escP(aviso)}</p>` : ""}
    <p class="hint" style="margin:6px 0 0">La contraseña no queda guardada en la app: cópiala ahora.</p>
    <div class="row"><button type="button" class="small" id="peCopiar">Copiar datos</button><button type="button" class="small" id="peOk">Ya los di</button></div>`;
  box.hidden = false;
  $p("peCopiar").onclick = async () => {
    const txt = `Ruta de Entregas\n${location.origin + location.pathname.replace(/[^/]*$/, "")}\nUsuario: ${usuario}\nContraseña: ${clave}`;
    try{ await navigator.clipboard.writeText(txt); toast("Datos copiados: pégalos en un mensaje para " + nombre + "."); }catch(e){ toast("No se pudo copiar: anótalos."); }
  };
  $p("peOk").onclick = () => { box.hidden = true; box.innerHTML = ""; };
}
function refrescarBodega(){
  if(!EN_BODEGA) return;
  Promise.resolve(typeof syncNow === "function" ? syncNow(true) : null)
    .then(() => typeof traerVinculos === "function" ? traerVinculos() : null)
    .then(() => { if(typeof pintarReps === "function") pintarReps(); if(typeof pintarTodo === "function") pintarTodo(); })
    .catch(() => {});
}

async function cargar(){
  const est = $p("peEstado"), lista = $p("peLista");
  est.textContent = "Cargando…";
  try{ gente = await llamar("listar"); }
  catch(e){ est.textContent = e.message || String(e); lista.innerHTML = ""; $p("peAgregar").hidden = true; return; }
  if($p("peForm").hidden) $p("peAgregar").hidden = false;
  const act = gente.filter(p => p.activo).length;
  est.textContent = `${act} persona(s) activa(s)` + (gente.length > act ? ` · ${gente.length - act} desactivada(s)` : "") + ". Desactivar no borra su historial.";
  lista.innerHTML = gente.slice().sort((a, b) => (b.activo - a.activo) || a.nombre.localeCompare(b.nombre, "es")).map(p => `
    <div class="peCard${p.activo ? "" : " off"}" data-id="${escP(p.user_id)}">
      <div><b>${escP(p.nombre)}</b>${p.user_id === ((typeof sync !== "undefined" && sync && sync.uid) || "") ? ` <small>(tú)</small>` : ""}
        <div class="hint">${escP(p.usuario)} · ${ROL_TXT[p.rol] || p.rol}${p.admin ? " · Administrador" : ""}${p.rol === "repartidor" ? (p.rid ? " · 📦 en la bodega" : " · sin vincular a la bodega") : ""}${p.activo ? "" : " · DESACTIVADO"}</div></div>
      <div class="row">
        ${p.activo ? `<button type="button" class="small" data-a="editar">Editar</button><button type="button" class="small" data-a="clave">Contraseña</button>` : ""}
        ${p.user_id === ((typeof sync !== "undefined" && sync && sync.uid) || "") ? "" : `<button type="button" class="small${p.activo ? " danger" : ""}" data-a="activo">${p.activo ? "Desactivar" : "Activar"}</button>`}
      </div></div>`).join("");
  lista.querySelectorAll("button[data-a]").forEach(b => b.onclick = () => accion(b.dataset.a, gente.find(p => p.user_id === b.closest(".peCard").dataset.id)));
}
async function accion(a, p){
  if(!p) return;
  if(a === "editar") return abrirForm(p);
  try{
    if(a === "clave"){
      if(!confirm(`¿Darle una contraseña nueva a ${p.nombre}? La de ahora deja de servir.`)) return;
      const clave = claveNueva();
      await llamar("clave", {user_id: p.user_id, clave});
      mostrarDatos(p.nombre, p.usuario, clave, "", "");
      $p("peListo").querySelector("b").textContent = "Contraseña nueva para " + p.nombre + ".";
    }else if(a === "activo"){
      if(p.activo && !confirm(`¿Desactivar a ${p.nombre}? No podrá entrar ni sincronizar. Su historial y sus entregas se conservan.`)) return;
      await llamar("activo", {user_id: p.user_id, activo: !p.activo});
      toast(p.activo ? `${p.nombre} quedó desactivado.` : `${p.nombre} quedó activo otra vez.`);
    }
    await cargar();
  }catch(e){ $p("peEstado").textContent = e.message || String(e); }
}

/* ---- Menú ☰ → Personas (solo administradores; el servidor lo vuelve a verificar) ---- */
const btn = $p("btnPersonas");
if(btn){
  btn.hidden = !YO.admin;
  btn.onclick = () => {
    const d = crearVentana();
    cerrarForm(); $p("peListo").hidden = true;
    d.showModal(); cargar();
  };
}
window.PERSONAS = {claveNueva, cargar};
})();
