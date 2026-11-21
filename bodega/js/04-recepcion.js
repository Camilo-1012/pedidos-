/* Recepción en bodega: lotes (cada llegada de mercancía), listado esperado, escaneo en ráfaga, faltantes y sobrantes. */
"use strict";
/* ---- Piezas de interfaz que usan varias pantallas ---- */
function chipEstado(p){
  const cls = {ESPERADO:"warn", BODEGA:"", RUTA:"zone", ENTREGADO:"ok", FALTANTE:"bad"}[p.estado] || "";
  return `<span class="chip ${cls}">${esc(ESTADOS[p.estado] || "—")}${p.estado === "RUTA" ? " · " + esc(repNombre(p.rid)) : ""}</span>`;
}
function liPaq(p, extra){
  const z = ZONAS.size ? zonaDe(p) : null;
  const marcas = [ZONAS.size ? chipZona(z) : "", p.emp ? `<span class="chip">${esc(p.emp)}</span>` : "", p.nov.length ? `<span class="chip warn">Novedad</span>` : "",
    p.conflicto ? `<span class="chip bad">Conflicto</span>` : "", p.devs ? `<span class="chip">Devuelto ${p.devs}×</span>` : ""].join("");
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
function pintarRecibir(){
  pintarSelectLotes();
  const l = loteActual();
  $("recInfo").hidden = !l;
  if(!l) return;
  $("recUbicLbl").hidden = !zonasActivas().length; $("recUbic").checked = prefs.pedirUbic !== false;
  pintarZonasRecibir();
  const s = statsLote(l.lid);
  kpis($("recKpis"), [[s.esperado || "—", "esperados"], [s.rec, "recibidos", "ok"], [s.esperado ? s.faltan : "—", "faltan", s.faltan ? "warn" : ""], [s.sobr, "fuera del listado", s.sobr ? "warn" : ""]]);
  const cerrado = !!l.cerrado;
  $("recScan").disabled = $("recEscribir").disabled = $("recManifiesto").disabled = cerrado;
  $("recCerrar").textContent = cerrado ? "Reabrir lote" : "Cerrar lote";
  $("recNota").textContent = (l.emp ? l.emp + " · " : "") + "Creado " + fechaHora(l.at) + (cerrado ? " · Cerrado " + fechaHora(l.cerrado) : "") +
    (s.esp ? "" : " · Sin listado esperado: los faltantes se calculan con la cantidad que escribiste.");
  const recientes = paquetes(p => p.recLote === l.lid).sort((a, b) => b.recibido.localeCompare(a.recibido));
  pintarLista($("recLista"), recientes.map(p => liPaq(p, "Recibido " + fechaHora(p.recibido) + (p.espLote === l.lid || !s.esp ? "" : " · fuera del listado"))), 30, "Aún no hay paquetes recibidos en este lote.");
}
$("recUbic").onchange = e => { prefs.pedirUbic = e.target.checked; savePrefs(); };
$("recLote").onchange = e => { prefs.lote = e.target.value || null; savePrefs(); pintarRecibir(); };
$("recNuevo").onclick = async () => {
  const v = await pedir({title:"Nuevo lote de recepción", msg:"Un lote es cada llegada de paquetes (un camión, un corte del día). Sirve para cuadrar lo esperado contra lo recibido.",
    fields:[{id:"emp", label:"Empresa", type:"select", options:EMPRESAS}, {id:"nom", label:"Nombre (opcional)", type:"text", max:40}, {id:"n", label:"Cantidad esperada (opcional)", type:"text", max:5}],
    yes:"Crear", check: v => v.n.trim() && !/^\d{1,5}$/.test(v.n.trim()) ? "La cantidad debe ser un número." : ""});
  if(!v) return;
  const d = new Date(), lid = uuid();
  const nombre = v.nom.trim() || `${v.emp} ${pad2(d.getDate())}/${pad2(d.getMonth()+1)} ${horaDe(d.toISOString())}`;
  registrar("LOTE", null, {lid, nombre, emp: v.emp, esperado: +v.n || 0});
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
$("recManifiesto").onclick = () => {
  const l = loteActual(); if(!l) return;
  mostrarListado("Listado esperado · " + l.nombre,
    `<p class="hint">Pega las guías (una por línea, o separadas por comas o espacios) o elige un archivo CSV o de texto. Si el listado está en Excel, guárdalo antes como CSV.</p>
     <textarea id="mfTxt" rows="8" aria-label="Guías esperadas"></textarea>
     <label>Archivo<input type="file" id="mfFile" accept=".csv,.txt,text/csv,text/plain"></label>
     <p class="hint" id="mfInfo" role="status"></p>`,
    [["Cancelar", () => $("dlgLista").close()], ["Guardar listado", () => guardarManifiesto(l.lid), "primary"]]);
  const contar = () => { const n = guiasDeTexto($("mfTxt").value).length; $("mfInfo").textContent = n ? n + " guía(s) encontradas." : ""; };
  $("mfTxt").oninput = contar;
  $("mfFile").onchange = async e => { const f = e.target.files[0]; if(!f) return; if(f.size > 5e6){ toast("Archivo muy grande (máx. 5 MB)."); return; } $("mfTxt").value = await f.text(); contar(); };
};
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
