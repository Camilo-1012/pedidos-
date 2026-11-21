/* Devoluciones y liquidación: el repartidor vuelve, se escanean los que no entregó (con motivo) y al cerrar se
   decide el resto: entregado, faltante o «sigue con él» (lo lleva otra vez mañana).
   Cuadre: asignados = entregados + devueltos + faltantes + siguen en ruta. */
"use strict";
function pintarDevolver(){
  const r = repActual();
  botonesReps($("devReps"), r && r.rid, elegirRep);
  $("devInfo").hidden = !r; if(!r) return;
  const x = delRepartidor(r.rid);
  kpis($("devKpis"), [[x.enRuta.length, "por liquidar", "zone"], [x.asignadosDia.length, "asignados hoy"], [x.devueltosDia.length, "devueltos hoy", "warn"], [x.entregadosDia.length, "entregados hoy", "ok"]]);
  $("devCerrar").disabled = !x.enRuta.length;
  pintarLista($("devLista"), x.enRuta.map(p => liPaq(p, "Salió " + fechaHora(p.asignado))), 40, "No tiene paquetes por liquidar.");
}
async function devolverGuia(g){
  const r = repActual(); if(!r) return {tipo:"mal", txt:"Elige primero el repartidor."};
  const p = paq(g), motivo = $("devMotivo").value;
  if(!p || p.estado === "ESPERADO") return {tipo:"mal", txt:"No figura despachada. Si llegó a la bodega, recíbela en «Recibir»."};
  if(p.estado === "BODEGA") return {tipo:"rep", txt:"Ya está en bodega" + (p.motivo ? " (devuelta: " + p.motivo + ")" : "")};
  if(p.estado === "RUTA" && p.rid !== r.rid){
    if(!await preguntarEnEscaner(`${g} figura con ${repNombre(p.rid)}, no con ${r.nombre}. ¿Registrar la devolución a nombre de ${repNombre(p.rid)}?`, "Registrar")) return {tipo:"mal", txt:"Omitida: figura con " + repNombre(p.rid)};
    const e = registrar("DEVUELTO", g, {rid: p.rid, motivo});
    return {tipo:"ok", txt:`Devuelta (era de ${repNombre(p.rid)}) · ${motivo}`, evs:[e.id], cls:"aviso"};
  }
  if(p.estado === "ENTREGADO" || p.estado === "FALTANTE"){
    if(!await preguntarEnEscaner(`${g} figura como ${ESTADOS[p.estado].toLowerCase()}. ¿Registrarla como devuelta a la bodega?`, "Registrar devuelta")) return {tipo:"mal", txt:"Omitida: figura como " + ESTADOS[p.estado].toLowerCase()};
    const e = registrar("DEVUELTO", g, {rid: p.ultRid || r.rid, motivo});
    return {tipo:"ok", txt:"Devuelta · " + motivo, evs:[e.id], cls:"aviso"};
  }
  const e = registrar("DEVUELTO", g, {rid: r.rid, motivo});
  return {tipo:"ok", txt:"Devuelta · " + motivo, evs:[e.id]};
}
const cfgDevolver = () => ({
  titulo:"Devoluciones", alLeer: devolverGuia,
  objetivo: () => { const r = repActual(); return r ? `De: ${r.nombre} · motivo: ${$("devMotivo").value} · por liquidar ${delRepartidor(r.rid).enRuta.length}` : ""; },
  contador: () => "devueltas en esta pasada", alCerrar: pintarTodo
});
$("devScan").onclick = () => repActual() && abrirEscaner(cfgDevolver());
$("devEscribir").onclick = () => repActual() && escribirGuia(cfgDevolver());

/* ---- Cerrar liquidación ---- */
$("devCerrar").onclick = () => {
  const r = repActual(); if(!r) return;
  const x = delRepartidor(r.rid); if(!x.enRuta.length) return;
  mostrarListado("Liquidar a " + r.nombre,
    `<p class="hint">Estos paquetes no se devolvieron. Por defecto quedan como <b>entregados</b>. Cambia los que no aparecen (faltante) o los que el repartidor sigue llevando.</p>
     <div class="row"><button type="button" class="small" id="lqTodos">Todos entregados</button></div>
     <ul class="lista">${x.enRuta.map(p => `<li class="paq"><div><b>${esc(p.guia)}</b> ${p.emp ? `<span class="chip">${esc(p.emp)}</span>` : ""}<div class="hint">Salió ${esc(fechaHora(p.asignado))}</div></div>
       <select data-guia="${esc(p.guia)}" aria-label="Resultado de ${esc(p.guia)}"><option value="ENTREGADO">Entregado</option><option value="FALTANTE">Faltante</option><option value="SIGUE">Sigue con él</option></select></li>`).join("")}</ul>
     <p class="hint" id="lqRes" role="status"></p>`,
    [["Cancelar", () => $("dlgLista").close()], ["Confirmar liquidación", () => confirmarLiquidacion(r), "primary"]]);
  const res = () => {
    const c = {ENTREGADO:0, FALTANTE:0, SIGUE:0}; $("ltBody").querySelectorAll("select[data-guia]").forEach(s => c[s.value]++);
    $("lqRes").textContent = `Entregados ${c.ENTREGADO} · Faltantes ${c.FALTANTE} · Siguen con él ${c.SIGUE} · Devueltos hoy ${x.devueltosDia.length}`;
  };
  $("ltBody").querySelectorAll("select[data-guia]").forEach(s => s.onchange = res);
  $("lqTodos").onclick = () => { $("ltBody").querySelectorAll("select[data-guia]").forEach(s => { s.value = "ENTREGADO"; }); res(); };
  res();
};
async function confirmarLiquidacion(r){
  const sel = [...$("ltBody").querySelectorAll("select[data-guia]")];
  const falt = sel.filter(s => s.value === "FALTANTE").length;
  if(falt && !await confirmar("Faltantes", `Vas a marcar ${falt} paquete(s) como faltantes de ${r.nombre}. Queda registrado con tu nombre y la hora.`, "Marcar y cerrar", true)) return;
  let ent = 0, fal = 0;
  sel.forEach(s => {
    const p = paq(s.dataset.guia); if(!p || p.estado !== "RUTA" || p.rid !== r.rid) return;   // cambió mientras tanto (otro celular)
    if(s.value === "ENTREGADO"){ registrar("ENTREGADO", p.guia, {rid: r.rid}); ent++; }
    else if(s.value === "FALTANTE"){ registrar("FALTANTE", p.guia, {rid: r.rid}); fal++; }
  });
  $("dlgLista").close(); pintarTodo();
  toast(`Liquidación de ${r.nombre}: ${ent} entregados` + (fal ? `, ${fal} faltantes` : "") + ".");
}
