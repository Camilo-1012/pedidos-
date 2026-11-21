/* Despacho: elegir repartidor y escanear lo que se lleva. Avisa si la guía ya la tiene otro, si no se recibió
   o si figura como entregada, y pide confirmar antes de cambiar nada. Planilla de salida por repartidor. */
"use strict";
function botonesReps(box, sel, alElegir){
  const reps = repsActivos();
  if(!reps.length){ box.innerHTML = `<p class="hint">No hay repartidores. Agrégalos en el menú ☰ → Repartidores.</p>`; return; }
  const enRuta = new Map(); for(const p of PAQ.values()) if(p.estado === "RUTA") enRuta.set(p.rid, (enRuta.get(p.rid) || 0) + 1);
  box.innerHTML = reps.map(r => `<button type="button" data-rid="${esc(r.rid)}" aria-pressed="${r.rid === sel}">${esc(r.nombre)}<small>${enRuta.get(r.rid) || 0} en ruta</small></button>`).join("");
  box.querySelectorAll("button").forEach(b => b.onclick = () => alElegir(b.dataset.rid));
}
const repActual = () => { const r = REPS.get(prefs.rep); return r && r.activo ? r : null; };
function elegirRep(rid){ prefs.rep = rid; savePrefs(); pintarDespachar(); pintarDevolver(); }

function pintarDespachar(){
  const r = repActual();
  botonesReps($("desReps"), r && r.rid, elegirRep);
  $("desInfo").hidden = !r; if(!r) return;
  const x = delRepartidor(r.rid);
  pintarZonasDespacho(r.rid);
  kpis($("desKpis"), [[x.asignadosDia.length, "asignados hoy"], [x.enRuta.length, "en ruta (por liquidar)", "zone"], [x.devueltosDia.length, "devueltos hoy"], [x.entregadosDia.length, "entregados hoy", "ok"]]);
  pintarLista($("desLista"), x.enRuta.map(p => liPaq(p, "Asignado " + fechaHora(p.asignado) + (diaDe(p.asignado) !== hoy() ? " · de otro día" : ""))), 40, "Todavía no lleva paquetes.");
}

async function asignarGuia(g){
  const r = repActual(); if(!r) return {tipo:"mal", txt:"Elige primero el repartidor."};
  const p = paq(g), evs = [];
  if(p && p.estado === "RUTA"){
    if(p.rid === r.rid) return {tipo:"rep", txt:"Ya la lleva " + r.nombre};
    if(!await preguntarEnEscaner(`${g} la tiene ${repNombre(p.rid)}. ¿Pasársela a ${r.nombre}?`, "Pasar a " + r.nombre)) return {tipo:"mal", txt:"Omitida: la sigue teniendo " + repNombre(p.rid)};
    evs.push(registrar("ASIGNADO", g, {rid: r.rid, reasigna: true, de: p.rid}).id);
    return {tipo:"ok", txt:`Pasada de ${repNombre(p.rid)} a ${r.nombre}`, evs};
  }
  if(!p || p.estado === "ESPERADO" || p.estado === "ENTREGADO" || p.estado === "FALTANTE"){
    const por = !p || p.estado === "ESPERADO" ? "no se ha recibido en bodega" : "figura como " + ESTADOS[p.estado].toLowerCase();
    if(!await preguntarEnEscaner(`${g} ${por}. ¿Recibirla y entregarla a ${r.nombre}?`, "Recibir y entregar")) return {tipo:"mal", txt:"Omitida: " + por};
    const l = loteActual(), lid = l && !l.cerrado ? l.lid : "";
    evs.push(registrar("RECIBIDO", g, {lid, emp: (p && p.emp) || (l && l.emp) || ""}).id);
  }
  evs.push(registrar("ASIGNADO", g, {rid: r.rid}).id);
  const q = paq(g), z = zonaDe(q);
  // Zona de otro repartidor: solo se avisa (puede ser un apoyo), no se bloquea.
  const otraZona = z && z.rid && z.rid !== r.rid;
  return {tipo:"ok", txt:"Para " + r.nombre + (z ? " · " + z.nombre : "") + (otraZona ? " · ⚠ zona de " + repNombre(z.rid) : "") + (q.nov.length ? " · tiene novedad: " + q.nov[q.nov.length - 1].nota : ""), evs, cls: q.nov.length || otraZona ? "aviso" : ""};
}
const cfgDespacho = () => ({
  titulo:"Despachar", alLeer: asignarGuia,
  objetivo: () => { const r = repActual(); return r ? `Para: ${r.nombre} · lleva ${delRepartidor(r.rid).enRuta.length}` : ""; },
  contador: () => "asignadas en esta pasada", alCerrar: pintarTodo
});
$("desScan").onclick = () => repActual() && abrirEscaner(cfgDespacho());
$("desEscribir").onclick = () => repActual() && escribirGuia(cfgDespacho());

/* ---- Planilla de salida ---- */
// Planilla agrupada por zona (y dentro, por calle y carrera): así el repartidor carga en orden.
const nomZona = p => (zonaDe(p) || {nombre: ZONAS.size ? "Sin zona" : ""}).nombre;
function ordenPlanilla(lista){ return lista.slice().sort((a, b) => nomZona(a).localeCompare(nomZona(b), "es", {numeric:true}) || (a.cl ?? 999) - (b.cl ?? 999) || (a.kr ?? 999) - (b.kr ?? 999) || a.guia.localeCompare(b.guia)); }
function textoPlanilla(r, x){
  const porEmp = {}; x.enRuta.forEach(p => { porEmp[p.emp || "Sin empresa"] = (porEmp[p.emp || "Sin empresa"] || 0) + 1; });
  return `Planilla de salida · ${r.nombre} · ${fechaHora(new Date().toISOString())}\nTotal: ${x.enRuta.length} (${Object.entries(porEmp).map(([k, v]) => k + " " + v).join(", ")})\n` +
    ordenPlanilla(x.enRuta).map((p, i) => `${i + 1}. ${p.guia}${p.emp ? " · " + p.emp : ""}${nomZona(p) ? " · " + nomZona(p) : ""}`).join("\n");
}
$("desPlanilla").onclick = () => {
  const r = repActual(); if(!r) return;
  const x = delRepartidor(r.rid);
  const porEmp = {}; x.enRuta.forEach(p => { porEmp[p.emp || "Sin empresa"] = (porEmp[p.emp || "Sin empresa"] || 0) + 1; });
  mostrarListado("Planilla · " + r.nombre,
    `<div class="planilla" id="planilla">
      <p><b>Bodega · Planilla de salida</b><br>Repartidor: <b>${esc(r.nombre)}</b><br>Fecha: ${esc(fechaHora(new Date().toISOString()))} · Despachó: ${esc(USER.name)}</p>
      <p>Total: <b>${x.enRuta.length}</b> paquete(s) · ${Object.entries(porEmp).map(([k, v]) => esc(k) + ": " + v).join(" · ") || "—"}</p>
      <table class="tb"><thead><tr><th>#</th><th>Guía</th><th>Zona</th><th>Empresa</th><th>Novedad</th></tr></thead><tbody>
      ${ordenPlanilla(x.enRuta).map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.guia)}</td><td>${esc(nomZona(p))}</td><td>${esc(p.emp)}</td><td>${esc(p.nov.map(n => n.nota).join("; "))}</td></tr>`).join("")}
      </tbody></table>
      <p class="firma">Recibí conforme: ______________________ &nbsp; C.C. ______________</p>
    </div>`,
    [["Copiar texto", async () => { try{ await navigator.clipboard.writeText(textoPlanilla(r, x)); toast("Planilla copiada: pégala en WhatsApp o en un correo."); }catch(e){ toast("No se pudo copiar."); } }],
     ["Imprimir", () => window.print()],
     ["Excel", () => excelPlanilla(r.rid), "primary"]]);
};
