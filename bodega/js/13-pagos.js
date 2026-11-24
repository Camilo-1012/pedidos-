/* ============ Pagos a repartidores por QUINCENA (v2.44) ============
   Se paga cada paquete ENTREGADO a la tarifa (por defecto $1.600). Devoluciones, faltantes y lo que sigue en ruta
   no se cuentan ni se pagan. La fecha que cuenta es la de la entrega (reportada por el repartidor desde su Ruta o
   liquidada en Devolver). Quincenas: del 1 al 15 y del 16 al último día del mes.
   - TARIFA {valor}: la cambia el administrador; cada pago guarda la tarifa con la que se liquidó.
   - PAGO {rid, q, n, valor, tarifa}: «Marcar pagado» de un repartidor en una quincena. Si después llegan más
     entregados de esa quincena, aparece la diferencia pendiente. Deshacer = PAGO con n y valor negativos.
   Datos en este celular: los paquetes cerrados se purgan a los 30 días; quincenas más viejas, en el histórico. */
"use strict";
const TARIFA_DEF = 1600;
const tarifaActual = () => (TARIFA.v != null && TARIFA.v >= 0 ? TARIFA.v : TARIFA_DEF);
const pesos = n => "$" + Math.round(n || 0).toLocaleString("es-CO");
const MESES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];

// «2026-11-2» = 16 al 30 de noviembre de 2026.
function quincenaDe(iso){ const d = new Date(iso); return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${d.getDate() <= 15 ? 1 : 2}`; }
function rangoQuincena(q){
  const [y, m, h] = q.split("-").map(Number);
  const ini = new Date(y, m - 1, h === 1 ? 1 : 16), fin = h === 1 ? new Date(y, m - 1, 16) : new Date(y, m, 1);
  return [ini, fin];
}
function nombreQuincena(q){
  const [y, m, h] = q.split("-").map(Number), ult = new Date(y, m, 0).getDate();
  return `${h === 1 ? "1" : "16"}–${h === 1 ? "15" : ult} ${MESES[m - 1]} ${y}`;
}
function quincenasRecientes(n){
  const out = []; let d = new Date();
  for(let i = 0; i < n; i++){
    const q = quincenaDe(d.toISOString()); out.push(q);
    const [ini] = rangoQuincena(q); d = new Date(ini.getTime() - 86400000);
  }
  return out;
}

// Entregados de un repartidor (uno por guía, con la fecha de entrega final).
function entregadosDe(rid, q){
  return paquetes(p => p.estado === "ENTREGADO" && (p.ultRid || p.rid) === rid && (!q || quincenaDe(p.cerrado) === q))
    .sort((a, b) => a.cerrado.localeCompare(b.cerrado));
}
function devueltosDe(rid, q){
  let n = 0;
  for(const e of EV.values()) if(e.tipo === "DEVUELTO" && e.d.rid === rid && quincenaDe(e.at) === q && !anuladoEv(e.id)) n++;
  return n;
}
const anuladoEv = (() => { let cache = null, tam = -1; return id => { if(tam !== EV.size){ cache = new Set([...EV.values()].filter(e => e.tipo === "ANULAR").map(e => e.d.ref)); tam = EV.size; } return cache.has(id); }; })();
const pagosDe = (rid, q) => PAGOS.filter(p => p.rid === rid && p.q === q);
function resumenQuincena(rid, q){
  const ent = entregadosDe(rid, q), pg = pagosDe(rid, q);
  const pagN = pg.reduce((a, p) => a + (+p.n || 0), 0), pagV = pg.reduce((a, p) => a + (+p.valor || 0), 0);
  const pendN = Math.max(0, ent.length - pagN), tarifa = tarifaActual();
  return {q, ent, n: ent.length, valor: ent.length * tarifa, pagN, pagV, pendN, pendV: pendN * tarifa, dev: devueltosDe(rid, q), enRuta: paquetes(p => p.estado === "RUTA" && p.rid === rid).length, pagos: pg};
}
// Acumulado pendiente de todas las quincenas con datos en este celular.
function pendienteTotal(rid){
  const qs = new Set(entregadosDe(rid).map(p => quincenaDe(p.cerrado)));
  let n = 0; qs.forEach(q => { n += resumenQuincena(rid, q).pendN; });
  return {n, valor: n * tarifaActual()};
}

let qSel = quincenaDe(new Date().toISOString());
function abrirPagos(){
  const qs = quincenasRecientes(6); if(!qs.includes(qSel)) qSel = qs[0];
  const reps = [...REPS.values()].filter(r => r.activo || entregadosDe(r.rid, qSel).length || pagosDe(r.rid, qSel).length).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const filas = reps.map(r => ({r, s: resumenQuincena(r.rid, qSel), t: pendienteTotal(r.rid)}));
  const tot = filas.reduce((a, f) => ({n: a.n + f.s.n, valor: a.valor + f.s.valor, pend: a.pend + f.s.pendV, pag: a.pag + f.s.pagV}), {n: 0, valor: 0, pend: 0, pag: 0});
  mostrarListado("Pagos a repartidores", `
    <label>Quincena<select id="pgQ">${qs.map(q => `<option value="${q}"${q === qSel ? " selected" : ""}>${nombreQuincena(q)}${q === qs[0] ? " (actual)" : ""}</option>`).join("")}</select></label>
    <div class="row" style="align-items:center"><span class="hint">Tarifa: <b id="pgTarifa">${pesos(tarifaActual())}</b> por entregado</span>${USER.admin ? `<button type="button" class="small" id="pgCambiar">Cambiar tarifa</button>` : ""}</div>
    <div class="kpis pgKpis" id="pgTot">
      <div class="kpi"><b>${tot.n}</b><span>entregados</span></div>
      <div class="kpi zone"><b>${pesos(tot.valor)}</b><span>valor quincena</span></div>
      <div class="kpi ok"><b>${pesos(tot.pag)}</b><span>pagado</span></div>
      <div class="kpi"><b>${pesos(tot.pend)}</b><span>por pagar</span></div>
    </div>
    <p class="hint" style="margin:0">Solo se pagan los entregados. Devoluciones, faltantes y lo que sigue en ruta no se cuentan.</p>
    <div class="pgLista">${filas.map(({r, s, t}) => `
      <div class="pgCard" data-rid="${esc(r.rid)}">
        <div class="pgHead"><b>${esc(r.nombre)}</b><span class="pgValor">${pesos(s.valor)}</span></div>
        <div class="hint">${s.n} entregado(s) × ${pesos(tarifaActual())}${s.dev ? ` · ${s.dev} devuelto(s), no se pagan` : ""}${s.enRuta ? ` · ${s.enRuta} en ruta` : ""}</div>
        <div class="hint">${s.pagN ? `Pagado: ${s.pagN} = ${pesos(s.pagV)}` : "Sin pagos en esta quincena"}${s.pendN ? ` · <b class="pgPend">Pendiente: ${s.pendN} = ${pesos(s.pendV)}</b>` : s.n ? " · ✓ al día" : ""}</div>
        ${t.n > s.pendN ? `<div class="hint">Acumulado pendiente (todas las quincenas): <b>${t.n} = ${pesos(t.valor)}</b></div>` : ""}
        <div class="row">
          ${s.pendN ? `<button type="button" class="small primary" data-a="pagar">Marcar pagado ${pesos(s.pendV)}</button>` : ""}
          ${s.pagN ? `<button type="button" class="small" data-a="deshacer">Deshacer último pago</button>` : ""}
          ${s.n ? `<button type="button" class="small" data-a="ver">Ver guías</button>` : ""}
        </div>
      </div>`).join("") || `<p class="hint">No hay repartidores.</p>`}</div>`,
    [["Excel de la quincena", () => excelQuincena(qSel)], ["Cerrar", () => $("dlgLista").close()]]);
  $("pgQ").onchange = e => { qSel = e.target.value; abrirPagos(); };
  if($("pgCambiar")) $("pgCambiar").onclick = cambiarTarifa;
  $("ltBody").querySelectorAll(".pgCard button[data-a]").forEach(b => b.onclick = () => accionPago(b.dataset.a, b.closest(".pgCard").dataset.rid));
}
function accionPago(a, rid){
  const r = REPS.get(rid), s = resumenQuincena(rid, qSel);
  if(a === "pagar"){
    if(!confirm(`¿Registrar el pago a ${r.nombre}?\n${s.pendN} entregado(s) × ${pesos(tarifaActual())} = ${pesos(s.pendV)}\nQuincena ${nombreQuincena(qSel)}.`)) return;
    registrar("PAGO", null, {rid, q: qSel, n: s.pendN, valor: s.pendV, tarifa: tarifaActual()});
    toast(`Pago registrado: ${r.nombre} · ${pesos(s.pendV)}.`);
  } else if(a === "deshacer"){
    const ult = s.pagos.filter(p => p.n > 0 && !s.pagos.some(x => x.anula === p.id)).pop();
    if(!ult){ toast("No hay pagos para deshacer."); return; }
    if(!confirm(`¿Deshacer el pago de ${pesos(ult.valor)} a ${r.nombre}? Queda registrado que se deshizo.`)) return;
    registrar("PAGO", null, {rid, q: qSel, n: -ult.n, valor: -ult.valor, tarifa: ult.tarifa, anula: ult.id});
    toast("Pago deshecho.");
  } else if(a === "ver"){
    mostrarListado(`${r.nombre} · ${nombreQuincena(qSel)}`, `<p class="hint" style="margin:0">${s.n} entregado(s) = ${pesos(s.valor)}</p>
      <ol class="pgGuias">${s.ent.map(p => `<li><b>${esc(p.guia)}</b> <span class="hint">${esc(p.emp || "")} · ${esc(fechaHora(p.cerrado))}${p.porRep ? " · reportado por él" : ""}</span></li>`).join("")}</ol>`,
      [["Volver", abrirPagos]]);
    return;
  }
  abrirPagos();
}
function cambiarTarifa(){
  if(!USER.admin){ toast("Solo el administrador cambia la tarifa."); return; }
  const v = prompt("Valor por paquete entregado (en pesos, sin puntos):", String(tarifaActual()));
  if(v == null) return;
  const n = Math.round(Number(String(v).replace(/[^\d]/g, "")));
  if(!Number.isFinite(n) || n <= 0 || n > 100000){ toast("Valor no válido."); return; }
  registrar("TARIFA", null, {valor: n});
  toast("Tarifa: " + pesos(n) + " por entregado.");
  abrirPagos();
}
function excelQuincena(q){
  const reps = [...REPS.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const res = reps.map(r => ({r, s: resumenQuincena(r.rid, q)})).filter(x => x.s.n || x.s.pagN || x.s.dev);
  const hojas = [{nombre: "Resumen", anchos: [24, 12, 12, 14, 12, 14, 12, 14], filas: [
    [{v: "Pagos a repartidores · quincena " + nombreQuincena(q), b: true}], ["Tarifa por entregado", tarifaActual()], [],
    ["Repartidor", "Entregados", "Devueltos", "Valor", "Pagados", "Pagado", "Pendientes", "Por pagar"].map(v => ({v, b: true})),
    ...res.map(({r, s}) => [r.nombre, s.n, s.dev, s.valor, s.pagN, s.pagV, s.pendN, s.pendV]),
    [{v: "Total", b: true}, ...[1, 2, 3, 4, 5, 6, 7].map(i => ({v: res.reduce((a, {s}) => a + [0, s.n, s.dev, s.valor, s.pagN, s.pagV, s.pendN, s.pendV][i], 0), b: true}))]
  ]}];
  for(const {r, s} of res){
    if(!s.n) continue;
    const dias = new Map(); s.ent.forEach(p => { const d = diaDe(p.cerrado); dias.set(d, (dias.get(d) || 0) + 1); });
    hojas.push({nombre: r.nombre.slice(0, 28), anchos: [14, 22, 10, 20, 18], filas: [
      [{v: r.nombre + " · " + nombreQuincena(q), b: true}], [],
      ["Día", "Entregados", "Valor"].map(v => ({v, b: true})), ...[...dias].map(([d, n]) => [d, n, n * tarifaActual()]), [],
      ["#", "Guía", "Empresa", "Entregado", "Cómo"].map(v => ({v, b: true})),
      ...s.ent.map((p, i) => [i + 1, p.guia, p.emp || "", fechaHora(p.cerrado), p.porRep ? "Reportado en su app" : "Liquidado en bodega"])
    ]});
  }
  descargarXlsx(hojas, `pagos-${q}.xlsx`);
}
if($("btnPagos")) $("btnPagos").onclick = abrirPagos;
