/* Reportes de la bodega en Excel. El generador .xlsx es el de Ruta de Entregas (js/15-excel.js, se carga antes). */
"use strict";
/* ============ Reportes de la bodega ============ */
const filaPaq = p => [p.guia, p.emp, ESTADOS[p.estado] || "", p.rid ? repNombre(p.rid) : p.ultRid ? repNombre(p.ultRid) : "",
  (zonaDe(p) || {}).nombre || "", p.cl == null ? "" : txtVia(p.cl), p.kr == null ? "" : txtViaKr(p.kr), (LOTES.get(p.recLote || p.espLote) || {}).nombre || "", fechaHora(p.recibido), fechaHora(p.asignado), fechaHora(p.cerrado), p.devs || 0, p.motivo, p.nov.map(n => n.nota).join("; "), p.conflicto];
const CAB_PAQ = ["Guía","Empresa","Estado","Repartidor","Zona","Calle","Carrera","Lote","Recibido","Asignado","Cerrado","Devoluciones","Último motivo","Novedades","Conflicto"];
const ANCHOS_PAQ = [22,10,20,18,18,9,9,22,13,13,13,12,20,30,30];
function excelDia(dia){
  dia = dia || hoy();
  const r = resumenDia(dia);
  const tocadosHoy = paquetes(p => p.evs.some(e => diaDe(e.at) === dia)).sort((a, b) => a.guia.localeCompare(b.guia));
  const evHoy = [...EV.values()].filter(e => e.guia && e.tipo !== "ANULAR" && diaDe(e.at) === dia).sort(ordenEv);
  const tot = r.filas.reduce((t, f) => { ["asignados","devueltos","entregados","faltantes","enRuta"].forEach(k => t[k] += f[k]); return t; }, {asignados:0, devueltos:0, entregados:0, faltantes:0, enRuta:0});
  descargarXlsx([
    {nombre:"Resumen " + dia, anchos:[22,11,11,11,11,11], filas:[["Repartidor","Asignados","Devueltos","Entregados","Faltantes","En ruta ahora"],
      ...r.filas.map(f => [f.nombre, f.asignados, f.devueltos, f.entregados, f.faltantes, f.enRuta]),
      [{v:"Total", b:true}, {v:tot.asignados, b:true}, {v:tot.devueltos, b:true}, {v:tot.entregados, b:true}, {v:tot.faltantes, b:true}, {v:tot.enRuta, b:true}],
      [], ["Recibidos en bodega", r.recibidos], ["En bodega ahora", paquetes(p => p.estado === "BODEGA").length]]},
    {nombre:"Paquetes del día", anchos:ANCHOS_PAQ, filas:[CAB_PAQ, ...tocadosHoy.map(filaPaq)]},
    {nombre:"Por zona", anchos:[24,32,18,11,11,14], filas:[["Zona","Rango","Repartidor habitual","En bodega","En ruta","Entregados hoy"],
      ...[...zonasActivas().map(z => [z.zid, z.nombre, rangoTxt(z), repNombre(z.rid)]), ["", "Sin zona", "", ""]].map(([zid, n, rg, rp]) => {
        const de = p => ((zonaDe(p) || {}).zid || "") === zid;
        return [n, rg, zid && rp !== "—" ? rp : "", paquetes(p => p.estado === "BODEGA" && de(p)).length, paquetes(p => p.estado === "RUTA" && de(p)).length, paquetes(p => p.estado === "ENTREGADO" && diaDe(p.cerrado) === dia && de(p)).length];
      })]},
    {nombre:"En bodega", anchos:ANCHOS_PAQ, filas:[CAB_PAQ, ...paquetes(p => p.estado === "BODEGA").sort((a, b) => a.recibido.localeCompare(b.recibido)).map(filaPaq)]},
    {nombre:"Movimientos", anchos:[13,22,22,30,16], filas:[["Hora","Guía","Movimiento","Detalle","Usuario"], ...evHoy.map(e => [fechaHora(e.at), e.guia, TXT_EV[e.tipo] || e.tipo, detalleEv(e), e.por])]}
  ], `bodega-${dia}.xlsx`);
}
function excelPlanilla(rid){
  const x = delRepartidor(rid), n = repNombre(rid);
  descargarXlsx([{nombre:"Planilla " + n, anchos:[6,22,18,9,9,12,30,13], filas:[["#","Guía","Zona","Calle","Carrera","Empresa","Novedad","Asignado"],
    ...ordenPlanilla(x.enRuta).map((p, i) => [i + 1, p.guia, nomZona(p), txtVia(p.cl), txtViaKr(p.kr), p.emp, p.nov.map(v => v.nota).join("; "), fechaHora(p.asignado)]),
    [], [{v:"Total", b:true}, {v:x.enRuta.length, b:true}], ["Repartidor", n], ["Despachó", USER.name], ["Fecha", fechaHora(new Date().toISOString())]]}],
    `planilla-${n.replace(/[^\wáéíóúñÁÉÍÓÚÑ-]+/g, "_")}-${hoy()}.xlsx`);
}
function excelLote(lid){
  const l = LOTES.get(lid) || {nombre:"lote"}, s = statsLote(lid);
  const delLote = paquetes(p => p.espLote === lid || p.recLote === lid).sort((a, b) => a.guia.localeCompare(b.guia));
  descargarXlsx([
    {nombre:"Resumen", anchos:[24,14], filas:[["Lote", l.nombre], ["Empresa", l.emp || ""], ["Esperados", s.esperado], ["Recibidos", s.rec], ["Faltan", s.faltan], ["Fuera del listado", s.sobr]]},
    {nombre:"Faltan", anchos:ANCHOS_PAQ, filas:[CAB_PAQ, ...delLote.filter(p => p.espLote === lid && p.estado === "ESPERADO").map(filaPaq)]},
    {nombre:"Recibidos", anchos:ANCHOS_PAQ, filas:[CAB_PAQ, ...delLote.filter(p => p.recLote === lid).map(filaPaq)]}
  ], `lote-${String(l.nombre).replace(/[^\w-]+/g, "_")}.xlsx`);
}
/* Histórico por fechas (desde la nube): auditoría de recepción, despachos, devoluciones y liquidaciones. */
function excelHistorico(evs, de, a, rid){
  const anul = new Set(evs.filter(e => e.tipo === "ANULAR").map(e => e.d && e.d.ref));
  let lista = evs.filter(e => e.guia && e.tipo !== "ANULAR" && !anul.has(e.id)).sort(ordenEv);
  if(rid) lista = lista.filter(e => (e.d || {}).rid === rid || (e.tipo === "ASIGNADO" && (e.d || {}).de === rid));
  const res = new Map(), clave = (dia, r) => dia + "|" + r;
  const fila = (dia, r) => res.get(clave(dia, r)) || (res.set(clave(dia, r), {dia, r, rec:new Set(), asig:new Set(), dev:new Set(), ent:new Set(), fal:new Set()}), res.get(clave(dia, r)));
  lista.forEach(e => {
    const dia = diaDe(e.at), r = (e.d || {}).rid || "";
    const k = {RECIBIDO:"rec", ASIGNADO:"asig", DEVUELTO:"dev", ENTREGADO:"ent", FALTANTE:"fal"}[e.tipo];
    if(k) fila(dia, k === "rec" ? "" : r)[k].add(e.guia);
  });
  const filasRes = [...res.values()].sort((x, y) => x.dia.localeCompare(y.dia) || repNombre(x.r).localeCompare(repNombre(y.r), "es"));
  const porLote = new Map();
  lista.filter(e => e.tipo === "RECIBIDO").forEach(e => { const l = (e.d || {}).lid || ""; const s = porLote.get(l) || new Set(); s.add(e.guia); porLote.set(l, s); });
  const nom = rid ? repNombre(rid) : "todos";
  descargarXlsx([
    {nombre:"Resumen por día", anchos:[12,22,11,11,11,11,11], filas:[["Fecha","Repartidor","Recibidos","Asignados","Devueltos","Entregados","Faltantes"],
      ...filasRes.map(f => [f.dia, f.r ? repNombre(f.r) : "Bodega (recepción)", f.rec.size || "", f.asig.size || "", f.dev.size || "", f.ent.size || "", f.fal.size || ""]),
      [], ["Periodo", `${de} a ${a}`], ["Repartidor", nom], ["Generado", fechaHora(new Date().toISOString()) + " por " + USER.name], ["Origen", syncOn() ? "Nube (todo el histórico)" : "Solo este celular"]]},
    {nombre:"Movimientos", anchos:[15,22,22,34,18,16,11,15], filas:[["Fecha y hora","Guía","Movimiento","Detalle","Repartidor","Usuario","Celular","Subido a la nube"],
      ...lista.map(e => [fechaHora(e.at), e.guia, TXT_EV[e.tipo] || e.tipo, detalleEv(e), (e.d || {}).rid ? repNombre(e.d.rid) : "", e.por || "", e.dev || "", e.srv_at ? fechaHora(new Date(e.srv_at).toISOString()) : ""])]},
    {nombre:"Recepción por lote", anchos:[28,10,16,11], filas:[["Lote","Empresa","Creado","Recibidos"],
      ...[...porLote].map(([lid, s]) => { const l = LOTES.get(lid) || {}; return [l.nombre || (lid ? "Lote " + lid.slice(0, 6) : "Sin lote"), l.emp || "", fechaHora(l.at), s.size]; })]}
  ], `historico-${de}_a_${a}${rid ? "-" + nom.replace(/[^\wáéíóúñÁÉÍÓÚÑ-]+/g, "_") : ""}.xlsx`);
}
