/* Recepción en bodega: lotes (cada llegada de mercancía), listado esperado, escaneo en ráfaga, faltantes y sobrantes. */
"use strict";
/* ---- Piezas de interfaz que usan varias pantallas ---- */
function chipEstado(p){
  const cls = {ESPERADO:"warn", BODEGA:"", RUTA:"zone", ENTREGADO:"ok", FALTANTE:"bad"}[p.estado] || "";
  return `<span class="chip ${cls}">${esc(ESTADOS[p.estado] || "—")}${p.estado === "RUTA" ? " · " + esc(repNombre(p.rid)) : ""}</span>`;
}
function liPaq(p, extra){
  const z = ZONAS.size ? zonaDe(p) : null;
  const pv = provDe(p);
  const marcas = [ZONAS.size ? chipZona(z) : "", pv ? `<span class="chip prov">${esc(pv)}</span>` : "", p.emp ? `<span class="chip em-${esc(p.emp.toLowerCase())}">${esc(p.emp)}</span>` : "", p.nov.length ? `<span class="chip warn">Novedad</span>` : "",
    p.conflicto ? `<span class="chip bad">Conflicto</span>` : "",
    p.estado === "RUTA" && p.noEstaba ? `<span class="chip warn">No estaba ${esc(horaDe(p.noEstaba))} · debe volver</span>` : "",
    p.estado === "ENTREGADO" && p.porRep ? `<span class="chip ok">Reportado por el repartidor</span>` : "", p.devs ? `<span class="chip">Devuelto ${p.devs}×</span>` : ""].join("");
  return `<li class="paq" data-guia="${esc(p.guia)}"><div><b>${esc(p.guia)}</b> ${chipEstado(p)}${marcas}</div>${extra ? `<div class="hint">${extra}</div>` : ""}</li>`;
}
function kpis(el, lista){ el.innerHTML = lista.map(([n, t, cls]) => `<div class="kpi ${cls || ""}"><b>${n}</b><span>${esc(t)}</span></div>`).join(""); }
// Lista larga: se muestran las primeras N y un botón para ver todas (evita pintar miles de filas en un celular de gama media).
function pintarLista(ul, items, tope, vacio){
  tope = tope || 60;
  if(!items.length){ ul.innerHTML = `<li class="vacio">${esc(vacio || "Nada por ahora.")}</li>`; return; }
  ul.innerHTML = items.slice(0, tope).join("") + (items.length > tope ? `<li class="vacio"><button type="button" class="small" data-mas>Ver las ${items.length}</button></li>` : "");
  const b = ul.querySelector("[data-mas]"); if(b) b.onclick = () => pintarLista(ul, items, items.length);
}
function mostrarListado(titulo, html, acciones){
  $("ltTitle").textContent = titulo; $("ltBody").innerHTML = html;
  const box = $("ltActs"); box.innerHTML = "";
  (acciones || []).forEach(([txt, fn, cls]) => { const b = document.createElement("button"); b.type = "button"; b.textContent = txt; if(cls) b.className = cls; b.onclick = fn; box.appendChild(b); });
  if(!$("dlgLista").open) $("dlgLista").showModal();
}

/* ---- Lotes ---- */
const lotesAbiertos = () => [...LOTES.values()].filter(l => !l.cerrado).sort((a, b) => b.at.localeCompare(a.at));
const loteActual = () => LOTES.get(prefs.lote) || null;
function pintarSelectLotes(){
  const sel = $("recLote"), abiertos = lotesAbiertos(), act = loteActual();
  const lista = act && act.cerrado ? [act, ...abiertos] : abiertos;
  sel.innerHTML = (lista.length ? "" : `<option value="">No hay lotes abiertos</option>`) +
    lista.map(l => `<option value="${esc(l.lid)}">${esc(l.nombre)}${l.cerrado ? " (cerrado)" : ""}</option>`).join("");
  if(!act && lista.length){ prefs.lote = lista[0].lid; savePrefs(); }
  sel.value = prefs.lote || "";
}
/* v2.44: acumulado general de todas las cargas abiertas (cada proveedor tiene su lote), por empresa. */
function pintarAcumulado(){
  const box = $("recAcum"); if(!box) return;
  const abiertos = new Set(lotesAbiertos().map(l => l.lid));
  const ps = paquetes(p => abiertos.has(p.espLote) || abiertos.has(p.recLote));
  if(!ps.length || abiertos.size < 1){ box.innerHTML = ""; return; }
  const fila = (nombre, l) => {
    const c = est => l.filter(p => p.estado === est).length;
    return `<b>${esc(nombre)}</b><span>${l.length}</span><span>${c("BODEGA")}</span><span>${c("RUTA")}</span><span>${c("ENTREGADO")}</span><span>${c("ESPERADO")}</span>`;
  };
  // Por proveedor (Daniel, Javier…); debajo de cada uno, cuántos de cada empresa.
  const porProv = conteoProv(ps).map(([pv]) => [pv || "Sin proveedor", ps.filter(p => provDe(p) === pv)]);
  box.innerHTML = `<h3 style="margin:0 0 6px">Acumulado general · ${abiertos.size} carga(s) abierta(s)</h3>
    <div class="acum"><span></span><span class="h">Total</span><span class="h">En bodega</span><span class="h">En ruta</span><span class="h">Entregados</span><span class="h">Por recibir</span>
    ${porProv.map(([pv, l]) => fila(pv, l)).join("")}${porProv.length > 1 ? fila("Total", ps) : ""}</div>
    <p class="hint" style="margin:4px 0 0">${esc(txtEmp(ps))}</p>`;
}
function pintarRecibir(){
  pintarSelectLotes();
  pintarAcumulado();
  const l = loteActual();
  $("recInfo").hidden = !l;
  if(!l) return;
  $("recUbicLbl").hidden = !zonasActivas().length; $("recUbic").checked = prefs.pedirUbic !== false;
  pintarZonasRecibir();
  const s = statsLote(l.lid);
  kpis($("recKpis"), [[s.esperado || "—", "esperados"], [s.rec, "recibidos", "ok"], [s.esperado ? s.faltan : "—", "faltan", s.faltan ? "warn" : ""], [s.sobr, "fuera del listado", s.sobr ? "warn" : ""]]);
  const cerrado = !!l.cerrado;
  $("recScan").disabled = $("recEscribir").disabled = cerrado;
  $("recCerrar").textContent = cerrado ? "Reabrir lote" : "Cerrar lote";
  $("recNota").textContent = (l.emp ? l.emp + " · " : "") + "Creado " + fechaHora(l.at) + (cerrado ? " · Cerrado " + fechaHora(l.cerrado) : "") +
    (s.esp ? "" : " · Sin listado esperado: los faltantes se calculan con la cantidad que escribiste.");
  const todos = paquetes(p => p.recLote === l.lid);
  // v2.45: filtro por empresa (Todas · Xcargo · iMile) y dos vistas: «Últimas» (en orden de lectura) y «Por zona».
  const empresas = conteoEmp(todos);
  if(prefs.recEmp && !empresas.some(([e]) => e === prefs.recEmp)) prefs.recEmp = "";
  const fEmp = prefs.recEmp || "";
  $("recEmpF").hidden = empresas.length < 2;
  $("recEmpF").innerHTML = [["", "Todas", todos.length], ...empresas.map(([e, n]) => [e, e || "Sin empresa", n])]
    .map(([e, t, n]) => `<button type="button" class="chip fchip em-${esc((e || "todas").toLowerCase())}" data-emp="${esc(e)}" aria-pressed="${e === fEmp}">${esc(t)} ${n}</button>`).join("");
  $("recEmpF").querySelectorAll("button").forEach(b => b.onclick = () => { prefs.recEmp = b.dataset.emp; savePrefs(); pintarRecibir(); });
  const lista = todos.filter(p => !fEmp || (p.emp || "") === fEmp);
  const ver = prefs.recVer === "zona" && zonasActivas().length ? "zona" : "ultimas";
  document.querySelectorAll(".recVer button").forEach(b => { b.setAttribute("aria-pressed", b.dataset.ver === ver); b.onclick = () => { prefs.recVer = b.dataset.ver; savePrefs(); pintarRecibir(); }; });
  document.querySelector(".recVer").hidden = !zonasActivas().length;
  $("recListaT").textContent = ver === "zona" ? "Paquetes por zona" : "Últimas lecturas";
  $("recLista").hidden = ver === "zona"; $("recGrupos").hidden = ver !== "zona";
  const linea = p => liPaq(p, (ver === "zona" ? ubicTxt(p) + " · " : "") + "Recibido " + fechaHora(p.recibido) + (p.espLote === l.lid || !s.esp ? "" : " · fuera del listado"));
  if(ver === "ultimas"){
    pintarLista($("recLista"), lista.sort((a, b) => b.recibido.localeCompare(a.recibido)).map(linea), 30, "Aún no hay paquetes recibidos en este lote.");
    return;
  }
  // Por zona: un bloque plegable por zona (color de la zona), con el número por empresa; adentro, separados por empresa.
  const grupos = new Map();
  lista.forEach(p => { const z = zonaDe(p), k = z ? z.zid : ""; if(!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(p); });
  const orden = [...zonasActivas().map(z => z.zid), ""].filter(k => grupos.has(k));
  const abiertos = new Set(prefs.recAbiertos || []);
  $("recGrupos").innerHTML = orden.map(k => {
    const z = k ? ZONAS.get(k) : null, ps = grupos.get(k);
    const ce = Object.fromEntries(conteoEmp(ps).map(([e, n]) => [e || "—", n]));
    return `<details class="zgrp" style="--zc:${esc(z ? z.color : "#777")}" data-zid="${esc(k)}"${abiertos.has(k) ? " open" : ""}>
      <summary><b>${esc(z ? z.nombre : "Sin zona")}</b><span class="zgN">${ps.length}</span><small class="zemp">${desgloseEmp(ce)}</small></summary>
      <div class="zgBody"></div></details>`;
  }).join("") || `<p class="hint">Aún no hay paquetes recibidos en este lote.</p>`;
  // Se pinta adentro solo al abrir (un lote de 600 no pinta 600 filas de una).
  const llenar = d => {
    const ps = grupos.get(d.dataset.zid) || [];
    d.querySelector(".zgBody").innerHTML = conteoEmp(ps).map(([emp, n]) => `<h4 class="grpEmp em-${esc((emp || "x").toLowerCase())}">${esc(emp || "Sin empresa")} · ${n}</h4><ul class="lista">${ps.filter(p => (p.emp || "") === emp).sort((a, b) => (a.cl ?? 999) - (b.cl ?? 999) || (a.kr ?? 999) - (b.kr ?? 999)).map(linea).join("")}</ul>`).join("");
  };
  $("recGrupos").querySelectorAll("details").forEach(d => {
    if(d.open) llenar(d);
    d.ontoggle = () => {
      const a = new Set(prefs.recAbiertos || []); d.open ? a.add(d.dataset.zid) : a.delete(d.dataset.zid);
      prefs.recAbiertos = [...a]; savePrefs(); if(d.open) llenar(d);
    };
  });
}
$("recUbic").onchange = e => { prefs.pedirUbic = e.target.checked; savePrefs(); };
$("recLote").onchange = e => { prefs.lote = e.target.value || null; savePrefs(); pintarRecibir(); };
$("recNuevo").onclick = async () => {
  const v = await pedir({title:"Nuevo lote de recepción", msg:"Un lote es cada llegada de paquetes (un camión, un corte del día). Sirve para cuadrar lo esperado contra lo recibido.",
    fields:[{id:"prov", label:"Proveedor (quién trae la mercancía)", type:"select", options:[...proveedores(), ["", "Otro…"]]}, {id:"provN", label:"Si es otro proveedor, su nombre", type:"text", max:30},
      {id:"emp", label:"Empresa", type:"select", options:EMPRESAS}, {id:"nom", label:"Nombre (opcional)", type:"text", max:40}, {id:"n", label:"Cantidad esperada (opcional)", type:"text", max:5}],
    yes:"Crear", check: v => !v.prov && !v.provN.trim() ? "Elige el proveedor o escribe su nombre." : v.n.trim() && !/^\d{1,5}$/.test(v.n.trim()) ? "La cantidad debe ser un número." : ""});
  if(!v) return;
  const d = new Date(), lid = uuid(), prov = (v.provN.trim() || v.prov).slice(0, 30);
  const nombre = v.nom.trim() || `${prov} · ${v.emp} ${pad2(d.getDate())}/${pad2(d.getMonth()+1)} ${horaDe(d.toISOString())}`;
  registrar("LOTE", null, {lid, nombre, emp: v.emp, esperado: +v.n || 0, prov});
  prefs.lote = lid; savePrefs(); pintarRecibir();
  toast("Lote «" + nombre + "» creado. Ya puedes escanear.");
};

/* ---- Recibir una guía ---- */
async function recibirGuia(g){
  const l = loteActual(); if(!l || l.cerrado) return {tipo:"mal", txt:"No hay un lote abierto."};
  const p = paq(g), s = statsLote(l.lid);
  if(p && p.estado === "BODEGA") return {tipo:"rep", txt:"Ya estaba en bodega" + (p.recLote && p.recLote !== l.lid ? " (de otro lote)" : "")};
  if(p && p.estado === "RUTA"){
    if(!await preguntarEnEscaner(`${g} figura en ruta con ${repNombre(p.rid)}. ¿Recibirla en bodega como devuelta?`, "Recibir como devuelta")) return {tipo:"mal", txt:"Omitida: sigue en ruta con " + repNombre(p.rid)};
    const e = registrar("DEVUELTO", g, {rid: p.rid, motivo: "Recibida en bodega"});
    return {tipo:"ok", txt:"Devuelta por " + repNombre(e.d.rid), evs:[e.id]};
  }
  if(p && (p.estado === "ENTREGADO" || p.estado === "FALTANTE")){
    if(!await preguntarEnEscaner(`${g} figura como ${ESTADOS[p.estado].toLowerCase()}. ¿Volver a ingresarla a la bodega?`, "Ingresar")) return {tipo:"mal", txt:"Omitida: figura como " + ESTADOS[p.estado].toLowerCase()};
  }
  const e = registrar("RECIBIDO", g, {lid: l.lid, emp: l.emp}), evs = [e.id];
  const enListado = p && p.espLote === l.lid;
  let txt = enListado ? "Recibida · en el listado" : p && p.espLote ? "Recibida · estaba en el listado de otro lote" : s.esp ? "Recibida · NO está en el listado" : "Recibida";
  // Zonificación: si hay zonas y el paquete no tiene ubicación, se pide calle y carrera (o la zona) en el mismo paso.
  if(zonasActivas().length){
    if(prefs.pedirUbic !== false && !tieneUbic(paq(g))){ const u = guardarUbicacion(g, await pedirUbicacion(g)); if(u) evs.push(u.id); }
    const z = zonaDe(paq(g)); txt += " → " + (z ? z.nombre : "sin zona");
  }
  return {tipo:"ok", txt, evs, cls: s.esp && !enListado ? "aviso" : ""};
}
const cfgRecibir = () => ({
  titulo:"Recibir en bodega", alLeer: recibirGuia,
  objetivo: () => { const l = loteActual(); if(!l) return ""; const s = statsLote(l.lid); return `Lote ${l.nombre} · ${s.rec} recibidos` + (s.esperado ? ` de ${s.esperado} · faltan ${s.faltan}` : ""); },
  contador: () => "recibidas en esta pasada", alCerrar: pintarTodo
});
$("recScan").onclick = () => abrirEscaner(cfgRecibir());
$("recEscribir").onclick = () => escribirGuia(cfgRecibir());

/* ---- Listado esperado (manifiesto) ----
   Formato del listado de Xcargo / iMile aún sin confirmar: se acepta texto pegado o un archivo .csv/.txt y se toma
   toda palabra que parezca guía. Un .xlsx se debe guardar antes como CSV. */
function guardarManifiesto(lid){
  const l = LOTES.get(lid), gs = guiasDeTexto($("mfTxt").value);
  if(!gs.length){ $("mfInfo").textContent = "No se encontró ninguna guía en el texto."; return; }
  let nuevas = 0, otras = 0;
  gs.forEach(g => {
    const p = paq(g);
    if(p && p.espLote){ if(p.espLote !== lid) otras++; return; }
    registrar("ESPERADO", g, {lid, emp: l.emp}); nuevas++;
  });
  $("dlgLista").close(); pintarTodo();
  toast(`${nuevas} guía(s) agregadas al listado` + (otras ? ` · ${otras} ya estaban en el listado de otro lote` : "") + ".");
}
$("recFaltan").onclick = () => {
  const l = loteActual(); if(!l) return;
  const falt = paquetes(p => p.espLote === l.lid && p.estado === "ESPERADO").sort((a, b) => a.guia.localeCompare(b.guia));
  const sobr = statsLote(l.lid).esp ? paquetes(p => p.recLote === l.lid && !p.espLote) : [];
  mostrarListado("Faltantes y sobrantes · " + l.nombre,
    `<h3>Faltan (${falt.length})</h3><ul class="lista">${falt.map(p => liPaq(p)).join("") || "<li class='vacio'>Ninguno.</li>"}</ul>
     <h3>Recibidos fuera del listado (${sobr.length})</h3><ul class="lista">${sobr.map(p => liPaq(p)).join("") || "<li class='vacio'>Ninguno.</li>"}</ul>`,
    [["Excel", () => excelLote(l.lid)]]);
};
$("recCerrar").onclick = async () => {
  const l = loteActual(); if(!l) return;
  if(l.cerrado){ registrar("LOTE", null, {lid: l.lid, nombre: l.nombre, emp: l.emp, esperado: l.esperado, reabrir: true}); pintarTodo(); return; }
  const s = statsLote(l.lid);
  const msg = s.esperado ? `Recibidos ${s.rec} de ${s.esperado}.` + (s.faltan ? ` Faltan ${s.faltan}: quedan como «esperados sin recibir» para reclamarlos.` : " No falta ninguno.") : `Recibidos ${s.rec}.`;
  if(!await confirmar("Cerrar " + l.nombre, msg + " Un lote cerrado no recibe más lecturas (se puede reabrir).", "Cerrar lote")) return;
  registrar("LOTE_CERRADO", null, {lid: l.lid});
  prefs.lote = null; savePrefs(); pintarTodo();
};
