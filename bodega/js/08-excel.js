/* Reportes de la bodega en Excel. El generador .xlsx es el de Ruta de Entregas (js/15-excel.js, se carga antes). */
"use strict";
/* ============ Reportes de la bodega ============ */
const filaPaq = p => [p.guia, p.emp, ESTADOS[p.estado] || "", p.rid ? repNombre(p.rid) : p.ultRid ? repNombre(p.ultRid) : "",
  (zonaDe(p) || {}).nombre || "", p.cl == null ? "" : txtVia(p.cl), p.kr == null ? "" : txtViaKr(p.kr), (LOTES.get(p.recLote || p.espLote) || {}).nombre || "", provDe(p), fechaHora(p.recibido), fechaHora(p.asignado), fechaHora(p.cerrado), p.devs || 0, p.motivo, p.nov.map(n => n.nota).join("; "), p.conflicto];
// Nombre de archivo sin tildes ni símbolos (v2.51): con tildes, algunos navegadores lo cambian por «download».
const nombreArchivo = (t, def) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "") || def || "archivo";
const CAB_PAQ = ["Guía","Empresa","Estado","Repartidor","Zona","Calle","Carrera","Lote","Proveedor","Recibido","Asignado","Cerrado","Devoluciones","Último motivo","Novedades","Conflicto"];
const ANCHOS_PAQ = [22,10,20,18,18,9,9,22,12,13,13,13,12,20,30,30];
const DIAS_SEM_B = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];
const dmyB = dia => `${dia.slice(8,10)}/${dia.slice(5,7)}/${dia.slice(0,4)}`;
// Fila de paquete con presentación (fechas centradas, devoluciones como número).
const filaPaqPro = p => filaPaq(p).map((v, i) => [9,10,11].includes(i) ? xlC.centro(v) : i === 12 ? (v || 0) : v);
/* Excel del día (v2.50): presentación de empresa igual a los Excel de pagos — título, datos del día, encabezados en
   color, bordes, totales resaltados, filtros e impresión horizontal ajustada al ancho. */
function excelDia(dia){
  dia = dia || hoy();
  const r = resumenDia(dia);
  const tocadosHoy = paquetes(p => p.evs.some(e => diaDe(e.at) === dia)).sort((a, b) => a.guia.localeCompare(b.guia));
  const evHoy = [...EV.values()].filter(e => e.guia && e.tipo !== "ANULAR" && diaDe(e.at) === dia).sort(ordenEv);
  const t = r.filas.reduce((t, f) => { ["asignados","devueltos","entregados","faltantes","enRuta"].forEach(k => t[k] += f[k]); return t; }, {asignados:0, devueltos:0, entregados:0, faltantes:0, enRuta:0});
  const enBodega = paquetes(p => p.estado === "BODEGA").sort((a, b) => a.recibido.localeCompare(b.recibido));
  const fecha = `${DIAS_SEM_B[new Date(dia + "T12:00:00").getDay()]} ${dmyB(dia)}`;
  const gen = `Generado: ${fechaHora(new Date().toISOString())} por ${USER.name}`;
  // Recibidos hoy por proveedor y por empresa (una vez por guía).
  const recHoy = paquetes(p => p.evs.some(e => e.tipo === "RECIBIDO" && diaDe(e.at) === dia));
  const cuenta = (lista, f) => { const m = new Map(); lista.forEach(p => { const k = f(p) || "Sin dato"; m.set(k, (m.get(k) || 0) + 1); }); return [...m].map(([k, n]) => `${k} ${n}`).join(" · "); };
  const C = xlC;
  const resumen = xlHojaPro("Resumen", "Reporte diario de bodega", [
    "Fecha: " + fecha,
    `Recibidos hoy: ${r.recibidos}${recHoy.length ? ` (por proveedor: ${cuenta(recHoy, provDe)} · por empresa: ${cuenta(recHoy, p => p.emp)})` : ""}`,
    `Despachados hoy: ${t.asignados} · Entregados hoy: ${t.entregados} · Devueltos hoy: ${t.devueltos} · Faltantes hoy: ${t.faltantes}`,
    `En bodega ahora: ${enBodega.length} · En ruta ahora: ${t.enRuta}`, gen],
    ["Repartidor","Despachados hoy","Entregados hoy","Devueltos hoy","Faltantes hoy","En ruta ahora","Efectividad"],
    r.filas.map(f => [f.nombre, f.asignados, f.entregados, f.devueltos, f.faltantes, f.enRuta, C.pct(xlEfect(f.entregados, f.devueltos + f.faltantes))]),
    [C.tot("TOTAL"), C.tot(t.asignados), C.tot(t.entregados), C.tot(t.devueltos), C.tot(t.faltantes), C.tot(t.enRuta), C.totPct(xlEfect(t.entregados, t.devueltos + t.faltantes))],
    [24,13,13,13,13,13,12]);
  const paqHoy = xlHojaPro("Paquetes del día", "Paquetes con movimiento el " + fecha, ["Un paquete por fila con su estado actual. Use los filtros del encabezado.", gen],
    CAB_PAQ, tocadosHoy.map(filaPaqPro), [C.tot("TOTAL"), C.tot(tocadosHoy.length + " paquete(s)"), ...CAB_PAQ.slice(2).map(() => C.tot(""))], ANCHOS_PAQ);
  const zonas = [...zonasActivas().map(z => [z.zid, z.nombre, rangoTxt(z), repNombre(z.rid)]), ["", "Sin zona", "", ""]].map(([zid, n, rg, rp]) => {
    const de = p => ((zonaDe(p) || {}).zid || "") === zid;
    return [n, rg, zid && rp !== "—" ? rp : "", paquetes(p => p.estado === "BODEGA" && de(p)).length, paquetes(p => p.estado === "RUTA" && de(p)).length, paquetes(p => p.estado === "ENTREGADO" && diaDe(p.cerrado) === dia && de(p)).length];
  });
  const sz = k => zonas.reduce((a, f) => a + f[k], 0);
  const porZona = xlHojaPro("Por zona", "Paquetes por zona", ["Fecha: " + fecha, gen],
    ["Zona","Rango","Repartidor habitual","En bodega","En ruta","Entregados hoy"], zonas,
    [C.tot("TOTAL"), C.tot(""), C.tot(""), C.tot(sz(3)), C.tot(sz(4)), C.tot(sz(5))], [24,32,18,11,11,14]);
  const hojaBod = xlHojaPro("En bodega", "Paquetes en bodega ahora", ["Ordenados por fecha de recepción (los más antiguos primero).", gen],
    CAB_PAQ, enBodega.map(filaPaqPro), [C.tot("TOTAL"), C.tot(enBodega.length + " paquete(s)"), ...CAB_PAQ.slice(2).map(() => C.tot(""))], ANCHOS_PAQ);
  const movs = xlHojaPro("Movimientos", "Movimientos del día", ["Fecha: " + fecha + " · en el orden en que pasaron.", gen],
    ["Hora","Guía","Movimiento","Detalle","Usuario"], evHoy.map(e => [C.centro(horaDe(e.at)), e.guia, TXT_EV[e.tipo] || e.tipo, detalleEv(e), e.por]),
    [C.tot("TOTAL"), C.tot(evHoy.length + " movimiento(s)"), C.tot(""), C.tot(""), C.tot("")], [10,22,24,40,16]);
  descargarXlsx([resumen, paqHoy, porZona, hojaBod, movs], `bodega-${dia}.xlsx`);
}
function excelPlanilla(rid){
  const x = delRepartidor(rid), n = repNombre(rid);
  descargarXlsx([{nombre:"Planilla " + n, anchos:[6,22,18,9,9,12,30,13], filas:[["#","Guía","Zona","Calle","Carrera","Empresa","Novedad","Asignado"],
    ...ordenPlanilla(x.enRuta).map((p, i) => [i + 1, p.guia, nomZona(p), txtVia(p.cl), txtViaKr(p.kr), p.emp, p.nov.map(v => v.nota).join("; "), fechaHora(p.asignado)]),
    [], [{v:"Total", b:true}, {v:x.enRuta.length, b:true}], ["Repartidor", n], ["Zonas", zonasDeRep(rid).map(z => z.nombre).join(", ")], ["Despachó", USER.name], ["Fecha", fechaHora(new Date().toISOString())]]}],
    `planilla-${nombreArchivo(n, "repartidor")}-${hoy()}.xlsx`);
}
/* Excel de la recepción de un lote (v2.51): lo que llegó a la bodega en ese cargue, con formato de empresa.
   Hojas: Resumen (conteos por empresa y zona), Recibidos (en el orden en que se leyeron), Faltan y Fuera del listado. */
function excelLote(lid){
  const l = LOTES.get(lid) || {nombre:"lote"}, s = statsLote(lid), C = xlC;
  const delLote = paquetes(p => p.espLote === lid || p.recLote === lid);
  const evRec = p => p.evs.filter(e => e.tipo === "RECIBIDO" && (e.d || {}).lid === lid).pop() || {};
  const rec = delLote.filter(p => p.recLote === lid).sort((a, b) => String(a.recibido).localeCompare(String(b.recibido)) || a.guia.localeCompare(b.guia));
  const falt = delLote.filter(p => p.espLote === lid && p.estado === "ESPERADO").sort((a, b) => a.guia.localeCompare(b.guia));
  const sobr = s.esp ? rec.filter(p => !p.espLote) : [];
  const gen = `Generado: ${fechaHora(new Date().toISOString())} por ${USER.name}`;
  const datos = [l.prov && "Proveedor: " + l.prov, l.emp && "Empresa del lote: " + l.emp, l.at && "Creado: " + fechaHora(l.at),
    l.cerrado ? "Estado: cerrado " + fechaHora(l.cerrado) : "Estado: abierto (aún recibe paquetes)", gen];
  const cuenta = f => { const m = new Map(); rec.forEach(p => { const k = f(p) || "Sin dato"; m.set(k, (m.get(k) || 0) + 1); }); return [...m].sort((a, b) => b[1] - a[1]); };
  const cuerpoRes = [
    ["Esperados (listado o cantidad escrita)", s.esperado], ["Recibidos en bodega", s.rec], ["Faltan por llegar", s.faltan], ["Recibidos fuera del listado", s.sobr],
    [C.sec("Recibidos por empresa"), C.sec("")], ...cuenta(p => p.emp),
    [C.sec("Recibidos por zona"), C.sec("")], ...cuenta(p => (zonaDe(p) || {}).nombre || "Sin zona"),
    [C.sec("Estado actual de lo recibido"), C.sec("")], ...cuenta(p => ESTADOS[p.estado])];
  const resumen = xlHojaPro("Resumen", "Recepción · " + l.nombre, datos, ["Concepto", "Cantidad"], cuerpoRes, null, [40, 14]);
  const cabRec = ["#","Recibido","Guía","Empresa","Zona","Calle","Carrera","Proveedor","Recibió","Estado actual","Repartidor","Novedades"];
  const recibidos = xlHojaPro("Recibidos", "Paquetes recibidos · " + l.nombre, [`${rec.length} paquete(s), en el orden en que se recibieron.`, gen], cabRec,
    rec.map((p, i) => [C.centro(i + 1), C.centro(fechaHora(p.recibido)), p.guia, p.emp, (zonaDe(p) || {}).nombre || "", p.cl == null ? "" : txtVia(p.cl), p.kr == null ? "" : txtViaKr(p.kr),
      provDe(p), evRec(p).por || "", ESTADOS[p.estado] || "", p.rid ? repNombre(p.rid) : p.ultRid ? repNombre(p.ultRid) : "", p.nov.map(n => n.nota).join("; ")]),
    [C.tot("TOTAL"), C.tot(""), C.tot(rec.length + " paquete(s)"), ...cabRec.slice(3).map(() => C.tot(""))], [5,12,22,10,18,9,9,12,14,18,16,30]);
  const hojaLista = (nombre, titulo, lista, nota) => xlHojaPro(nombre, titulo + " · " + l.nombre, [nota, gen], CAB_PAQ, lista.map(filaPaqPro),
    [C.tot("TOTAL"), C.tot(lista.length + " paquete(s)"), ...CAB_PAQ.slice(2).map(() => C.tot(""))], ANCHOS_PAQ);
  const hojas = [resumen, recibidos, hojaLista("Faltan", "Faltan por llegar", falt, s.esp ? "Están en el listado del lote y no se han recibido." : "El lote no tiene listado de guías: solo se conoce la cantidad que falta.")];
  if(s.esp) hojas.push(hojaLista("Fuera del listado", "Recibidos fuera del listado", sobr, "Se recibieron en este lote pero no venían en su listado."));
  descargarXlsx(hojas, `recepcion-${nombreArchivo(l.nombre, "lote")}-${hoy()}.xlsx`);
  toast(`Excel de la recepción descargado: ${rec.length} recibido(s), ${falt.length} faltante(s).`);
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
  ], `historico-${de}_a_${a}${rid ? "-" + nombreArchivo(nom) : ""}.xlsx`);
}
