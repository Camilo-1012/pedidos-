/* Consulta: buscar una guía y ver su recorrido completo; listados de lo que está en bodega, en ruta, con conflicto o
   con novedad; resumen del día por repartidor. */
"use strict";
const TXT_EV = {ESPERADO:"En listado esperado", RECIBIDO:"Recibida en bodega", NOVEDAD:"Novedad", UBICACION:"Ubicación", ASIGNADO:"Despachada", DEVUELTO:"Devuelta",
  ENTREGADO:"Entregada (liquidación)", FALTANTE:"Marcada faltante", ANULAR:"Lectura deshecha"};
function detalleEv(e){
  const d = e.d || {};
  switch(e.tipo){
    case "ESPERADO": case "RECIBIDO": return (LOTES.get(d.lid) || {}).nombre || (d.lid ? "" : "sin lote");
    case "ASIGNADO": return "a " + repNombre(d.rid) + (d.reasigna && d.de ? " (antes la tenía " + repNombre(d.de) + ")" : "");
    case "DEVUELTO": return "por " + repNombre(d.rid) + (d.motivo ? " · " + d.motivo : "");
    case "ENTREGADO": case "FALTANTE": return repNombre(d.rid);
    case "NOVEDAD": return d.nota || "";
    case "UBICACION": return d.zid ? "zona elegida: " + ((ZONAS.get(d.zid) || {}).nombre || "zona borrada") : `Calle ${txtVia(d.cl) || "?"} · Carrera ${txtViaKr(d.kr) || "?"}`;
    default: return "";
  }
}
function verPaquete(g){
  const p = paq(g); if(!p){ $("conRes").innerHTML = `<p class="hint">No hay registro de ${esc(g)} en este celular.</p>`; return; }
  const todos = (POR_GUIA.get(g) || []).slice().sort(ordenEv), anul = new Set(todos.filter(e => e.tipo === "ANULAR").map(e => e.d.ref));
  $("conRes").innerHTML = `<div class="ficha"><div><b class="guiaG">${esc(p.guia)}</b> ${chipEstado(p)} ${p.emp ? `<span class="chip">${esc(p.emp)}</span>` : ""}</div>
    ${ZONAS.size ? `<div class="row" style="align-items:center">${chipZona(zonaDe(p))}<span class="hint">${esc(ubicTxt(p))}</span><button type="button" class="small" id="conUbic">Ubicación</button></div>` : ""}
    ${p.conflicto ? `<p class="alerta">${esc(p.conflicto)}</p><div class="row" id="conResolver"></div>` : ""}
    ${p.estado === "BODEGA" ? `<p class="hint">En bodega hace ${diasDesde(p.recibido)} día(s)${p.motivo ? " · última devolución: " + esc(p.motivo) : ""}.</p>` : ""}
    <button type="button" class="small" id="conNube">Historial completo (nube)</button>
    <ol class="linea">${todos.filter(e => e.tipo !== "ANULAR").map(e => `<li class="${anul.has(e.id) ? "anulado" : ""}"><time>${esc(fechaHora(e.at))}</time> <b>${esc(TXT_EV[e.tipo] || e.tipo)}</b> ${esc(detalleEv(e))}<span class="hint"> · ${esc(e.por || "")}${e.sub ? "" : " · sin subir"}${anul.has(e.id) ? " · deshecha" : ""}</span></li>`).join("")}</ol></div>`;
  $("conNube").onclick = () => historialNube(g);
  if($("conUbic")) $("conUbic").onclick = async () => { const u = guardarUbicacion(g, await pedirUbicacion(g)); if(u){ verPaquete(g); pintarTodo(); } };
  if(p.conflicto){
    // Resolver: confirmar quién la tiene de verdad (queda como reasignación explícita).
    const cand = [...new Set(p.evs.filter(e => e.tipo === "ASIGNADO").map(e => e.d.rid))].slice(-3);
    const box = $("conResolver");
    cand.forEach(rid => { const b = document.createElement("button"); b.type = "button"; b.className = "small"; b.textContent = "La tiene " + repNombre(rid);
      b.onclick = () => { registrar("ASIGNADO", g, {rid, reasigna: true, resuelve: true}); verPaquete(g); pintarTodo(); toast("Conflicto resuelto: la tiene " + repNombre(rid) + "."); }; box.appendChild(b); });
  }
}
function buscar(txt){
  const res = buscarGuias(txt);
  if(!res.length){ $("conRes").innerHTML = `<p class="hint">Sin resultados para «${esc(txt)}». Escribe la guía completa o sus últimos 4+ números.</p>`; return; }
  if(res.length === 1){ verPaquete(res[0].guia); return; }
  $("conRes").innerHTML = `<ul class="lista">${res.map(p => liPaq(p)).join("")}</ul>`;
  $("conRes").querySelectorAll("li[data-guia]").forEach(li => li.onclick = () => verPaquete(li.dataset.guia));
}
$("conForm").addEventListener("submit", e => { e.preventDefault(); const t = $("conGuia").value.trim(); if(t) buscar(t); });
$("conScan").onclick = () => abrirEscaner({titulo:"Consultar guía", contador: () => "consultadas",
  alLeer: async g => { setTimeout(() => { cerrarEscaner(); $("conGuia").value = g; buscar(g); }, 0); const p = paq(g); return p ? {tipo:"ok", txt: ESTADOS[p.estado] || ""} : {tipo:"mal", txt:"Sin registro"}; }});
// Clic en cualquier paquete de una lista de Consulta: abre su recorrido.
document.addEventListener("click", e => {
  const li = e.target.closest("#conListaBox li[data-guia], #dlgLista li[data-guia]");
  if(!li || e.target.closest("select,button")) return;
  if($("dlgLista").open) $("dlgLista").close();
  mostrarVista("vConsultar"); $("conGuia").value = li.dataset.guia; verPaquete(li.dataset.guia); $("conRes").scrollIntoView({block:"nearest"});
});
let conFiltro = "";
function listaConsulta(f){
  conFiltro = f;
  const def = {
    bodega: ["En bodega", p => p.estado === "BODEGA", p => `Hace ${diasDesde(p.recibido)} día(s)` + (p.motivo ? " · devuelta: " + esc(p.motivo) : ""), (a, b) => a.recibido.localeCompare(b.recibido)],
    ruta: ["En ruta", p => p.estado === "RUTA", p => "Con " + esc(repNombre(p.rid)) + " desde " + fechaHora(p.asignado), (a, b) => repNombre(a.rid).localeCompare(repNombre(b.rid), "es")],
    conf: ["Conflictos", p => !!p.conflicto, p => esc(p.conflicto), null],
    nov: ["Con novedad", p => p.nov.length && p.estado !== "ENTREGADO", p => esc(p.nov.map(n => n.nota).join("; ")), null]
  }[f];
  const items = paquetes(def[1]); if(def[3]) items.sort(def[3]);
  $("conListaBox").innerHTML = `<h3>${def[0]} (${items.length})</h3><ul class="lista" id="conLista"></ul>`;
  pintarLista($("conLista"), items.map(p => liPaq(p, def[2](p))), 50, "Ninguno.");
}
$("conBodega").onclick = () => listaConsulta("bodega");
$("conRuta").onclick = () => listaConsulta("ruta");
$("conConflictos").onclick = () => listaConsulta("conf");
$("conNovedades").onclick = () => listaConsulta("nov");
$("conZonas").onclick = () => {
  conFiltro = "";
  const b = conteoZonas(p => p.estado === "BODEGA"), r = conteoZonas(p => p.estado === "RUTA");
  const fila = (zid, nom, color, extra) => `<tr data-zid="${esc(zid)}"><td>${color ? `<span class="zdot" style="--zc:${esc(color)}"></span>` : ""}${esc(nom)}<div class="hint">${esc(extra)}</div></td><td>${zid ? b.m.get(zid) || 0 : b.sin}</td><td>${zid ? r.m.get(zid) || 0 : r.sin}</td></tr>`;
  $("conListaBox").innerHTML = `<h3>Por zona</h3>` + (zonasActivas().length ? `<table class="tb zt"><thead><tr><th>Zona</th><th>En bodega</th><th>En ruta</th></tr></thead><tbody>` +
    zonasActivas().map(z => fila(z.zid, z.nombre, z.color, rangoTxt(z) + (z.rid ? " · " + repNombre(z.rid) : ""))).join("") + fila("", "Sin zona", "", "Sin ubicación o fuera de todas las zonas") + `</tbody></table><p class="hint">Toca una zona para ver los paquetes en bodega.</p>` : `<p class="hint">No hay zonas. Créalas en el menú ☰ → Zonas.</p>`);
  $("conListaBox").querySelectorAll("tr[data-zid]").forEach(tr => tr.onclick = () => listaZona(tr.dataset.zid, p => p.estado === "BODEGA"));
};
function pintarConsultar(){
  const nConf = paquetes(p => !!p.conflicto).length;
  $("conNConf").hidden = !nConf; $("conNConf").textContent = nConf;
  const r = resumenDia();
  $("conResumen").innerHTML = `<p class="hint">Recibidos hoy: <b>${r.recibidos}</b></p>` + (r.filas.length ? `<table class="tb"><thead><tr><th>Repartidor</th><th>Asig.</th><th>Dev.</th><th>Entr.</th><th>Falt.</th><th>En ruta</th></tr></thead><tbody>` +
    r.filas.map(f => `<tr><td>${esc(f.nombre)}</td><td>${f.asignados}</td><td>${f.devueltos}</td><td>${f.entregados}</td><td>${f.faltantes}</td><td>${f.enRuta}</td></tr>`).join("") + `</tbody></table>` : `<p class="hint">Sin movimientos de repartidores hoy.</p>`);
  if(conFiltro) listaConsulta(conFiltro);
}

/* ============ Histórico en la nube ============
   El celular guarda 30 días; la nube guarda TODO (no se borra nada: ver supabase/bodega.sql).
   Sirve para auditar: quién recibió, quién despachó y a qué repartidor, quién liquidó, desde qué celular y cuándo subió. */
const filaHist = e => ({...e, at: new Date(e.at).toISOString()});
async function historialNube(txt){
  if(!syncOn()){ toast("Conecta la nube (☰ → Equipo) para ver el histórico completo."); return; }
  if(!navigator.onLine){ toast("Sin internet: el histórico completo necesita señal."); return; }
  mostrarListado("Historial en la nube", `<p class="hint">Buscando ${esc(txt)}…</p>`);
  try{
    const rows = (await nubeGuia(txt)).map(filaHist);
    if(!rows.length){ $("ltBody").innerHTML = `<p class="hint">No hay registros de «${esc(txt)}» en la nube.</p>`; return; }
    const porGuia = new Map(); rows.forEach(e => { const l = porGuia.get(e.guia); l ? l.push(e) : porGuia.set(e.guia, [e]); });
    $("ltBody").innerHTML = [...porGuia].map(([g, evs]) => {
      const anul = new Set(evs.filter(e => e.tipo === "ANULAR").map(e => e.d.ref));
      return `<div class="ficha"><b class="guiaG">${esc(g)}</b><ol class="linea">${evs.filter(e => e.tipo !== "ANULAR").sort(ordenEv).map(e =>
        `<li class="${anul.has(e.id) ? "anulado" : ""}"><time>${esc(fechaHora(e.at))}</time> <b>${esc(TXT_EV[e.tipo] || e.tipo)}</b> ${esc(detalleEv(e))}<span class="hint"> · ${esc(e.por || "")} · celular ${esc(e.dev || "?")}${e.srv_at ? " · subido " + esc(fechaHora(e.srv_at)) : ""}${anul.has(e.id) ? " · deshecha" : ""}</span></li>`).join("")}</ol></div>`;
    }).join("") + (rows.length >= 500 ? `<p class="hint">Se muestran los primeros 500 movimientos: escribe la guía completa.</p>` : "");
  }catch(e){ $("ltBody").innerHTML = `<p class="uerr">No se pudo consultar la nube (${esc(e.message || e)}).</p>`; }
}
$("hisGuia").onclick = async () => {
  const v = await pedir({title:"Historial de una guía", msg:"Guía completa o sus últimos 4+ números. Se busca en todo el histórico de la nube.", fields:[{id:"g", label:"Guía", type:"text", max:40}],
    yes:"Buscar", check: v => v.g.replace(/\s+/g, "").length >= 4 ? "" : "Escribe al menos 4 caracteres."});
  if(v) historialNube(v.g.replace(/\s+/g, "").toUpperCase());
};
$("hisExcel").onclick = async () => {
  const d = hoy(), reps = [...REPS.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const v = await pedir({title:"Excel del histórico", msg: syncOn() ? "Movimientos de la nube entre las dos fechas (incluidas)." : "⚠ La nube no está conectada: solo saldrá lo que tiene este celular (últimos 30 días).",
    fields:[{id:"de", label:"Desde", type:"date", value: d.slice(0, 8) + "01"}, {id:"a", label:"Hasta", type:"date", value: d},
      {id:"r", label:"Repartidor", type:"select", options:[["", "Todos (incluye recepción)"], ...reps.map(r => [r.rid, r.nombre + (r.activo ? "" : " (inactivo)")])]}],
    yes:"Descargar", check: v => !v.de || !v.a ? "Elige las dos fechas." : v.de > v.a ? "«Desde» debe ser antes de «Hasta»." : ""});
  if(!v) return;
  const desde = new Date(v.de + "T00:00:00"), hasta = new Date(v.a + "T00:00:00"); hasta.setDate(hasta.getDate() + 1);
  let evs;
  try{
    if(syncOn()){
      if(!navigator.onLine){ toast("Sin internet: el histórico necesita señal."); return; }
      toast("Descargando el histórico…");
      evs = (await nubeRango(desde.toISOString(), hasta.toISOString(), n => toast(`Descargando… ${n} movimientos`))).map(filaHist);
    } else evs = [...EV.values()].filter(e => e.at >= desde.toISOString() && e.at < hasta.toISOString());
  }catch(e){ toast("No se pudo descargar (" + (e.message || e) + ")."); return; }
  excelHistorico(evs, v.de, v.a, v.r);
};
