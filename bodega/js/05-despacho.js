/* Despacho: elegir repartidor y escanear lo que se lleva. Avisa si la guía ya la tiene otro, si no se recibió
   o si figura como entregada, y pide confirmar antes de cambiar nada. Planilla de salida por repartidor. */
"use strict";
function botonesReps(box, sel, alElegir){
  const reps = repsActivos();
  if(!reps.length){ box.innerHTML = `<p class="hint">No hay repartidores. Agrégalos en el menú ☰ → Repartidores.</p>`; return; }
  const enRuta = new Map(); for(const p of PAQ.values()) if(p.estado === "RUTA"){ if(!enRuta.has(p.rid)) enRuta.set(p.rid, []); enRuta.get(p.rid).push(p); }
  const lleva = rid => { const l = enRuta.get(rid) || []; return l.length + " en ruta" + (l.length ? " (" + txtEmp(l) + ")" : ""); };
  box.innerHTML = reps.map(r => `<button type="button" data-rid="${esc(r.rid)}" aria-pressed="${r.rid === sel}">${esc(r.nombre)}<small>${esc(lleva(r.rid))}${VINC.has(r.rid) ? " · 📱" : ""}</small>${zonasDeRep(r.rid).length ? `<small class="zs">${esc(zonasDeRep(r.rid).map(z => z.nombre).join(", "))}</small>` : ""}</button>`).join("");
  box.querySelectorAll("button").forEach(b => b.onclick = () => alElegir(b.dataset.rid));
}
const repActual = () => { const r = REPS.get(prefs.rep); return r && r.activo ? r : null; };
function elegirRep(rid){ prefs.rep = rid; savePrefs(); pintarDespachar(); pintarDevolver(); }

function pintarDespachar(){
  const r = repActual();
  botonesReps($("desReps"), r && r.rid, elegirRep);
  $("desInfo").hidden = !r; if(!r) return;
  const x = delRepartidor(r.rid);
  pintarZonasRep(r);
  pintarZonasDespacho(r.rid);
  const sinZona = faltaZona(r);
  ["desScan", "desEscribir"].forEach(id => { $(id).classList.toggle("bloq", sinZona); $(id).setAttribute("aria-disabled", String(sinZona)); });
  kpis($("desKpis"), [[x.asignadosDia.length, "asignados hoy"], [x.enRuta.length, "en ruta (por liquidar)", "zone"], [x.devueltosDia.length, "devueltos hoy"], [x.entregadosDia.length, "entregados hoy", "ok"]]);
  // Lo que lleva, por empresa (Xcargo / iMile), para cuadrar con cada operador.
  const ce = conteoEmp(x.enRuta);
  $("desEmp").hidden = !ce.length;
  // v2.44: también por proveedor (Daniel, Javier…), para saber de quién es la mercancía que lleva.
  const cp = conteoProv(x.enRuta).filter(([pv]) => pv);
  if(ce.length) kpis($("desEmp"), [...ce.map(([e, n]) => [n, "lleva de " + (e || "sin empresa")]), ...cp.map(([pv, n]) => [n, "de " + pv, "prov"])]);
  pintarLista($("desLista"), x.enRuta.map(p => liPaq(p, "Asignado " + fechaHora(p.asignado) + (diaDe(p.asignado) !== hoy() ? " · de otro día" : "") + " · toca para corregir")), 40, "Todavía no lleva paquetes.");
}

async function asignarGuia(g){
  const r = repActual(); if(!r) return {tipo:"mal", txt:"Elige primero el repartidor."};
  if(faltaZona(r)) return {tipo:"mal", txt:"Marca primero la zona de " + r.nombre + "."};
  const p = paq(g), evs = [];
  if(p && p.estado === "RUTA"){
    if(p.rid === r.rid) return {tipo:"rep", txt:"Ya la lleva " + r.nombre};
    if(!await preguntarEnEscaner(`${g} la tiene ${repNombre(p.rid)}. ¿Pasársela a ${r.nombre}?`, "Pasar a " + r.nombre)) return {tipo:"mal", txt:"Omitida: la sigue teniendo " + repNombre(p.rid)};
    const u = zonaAlDespachar(g, r.rid); if(u) evs.push(u.id);
    evs.push(registrar("ASIGNADO", g, {rid: r.rid, reasigna: true, de: p.rid, ...zonaParaRuta(paq(g), r.rid)}).id);
    return {tipo:"ok", txt:`Pasada de ${repNombre(p.rid)} a ${r.nombre}`, evs};
  }
  let recibida = false;
  if(p && p.estado === "ESPERADO"){
    // Está en el listado importado: despacharla cuenta también como recibida (en su lote), sin preguntar ni escanear dos veces.
    evs.push(registrar("RECIBIDO", g, {lid: p.espLote, emp: p.emp || (LOTES.get(p.espLote) || {}).emp || "", al_despachar: true}).id);
    recibida = true;
  } else if(!p || p.estado === "ENTREGADO" || p.estado === "FALTANTE"){
    // Fuera de todo listado, o ya cerrada: se confirma, porque puede ser un error de lectura o de otra bodega.
    const por = !p ? "no está en ningún listado ni se ha recibido" : "figura como " + ESTADOS[p.estado].toLowerCase();
    if(!await preguntarEnEscaner(`${g} ${por}. ¿Recibirla y entregarla a ${r.nombre}?`, "Recibir y entregar")) return {tipo:"mal", txt:"Omitida: " + por};
    const l = loteActual(), lid = l && !l.cerrado ? l.lid : "";
    evs.push(registrar("RECIBIDO", g, {lid, emp: (p && p.emp) || (l && l.emp) || "", al_despachar: true}).id);
    recibida = true;
  }
  // v2.54: sin datos (solo la guía): toma la zona del repartidor, que es como el despachador organizó los paquetes.
  const u = zonaAlDespachar(g, r.rid); if(u) evs.push(u.id);
  evs.push(registrar("ASIGNADO", g, {rid: r.rid, ...zonaParaRuta(paq(g), r.rid)}).id);
  const q = paq(g), z = zonaDe(q);
  // Paquete de una zona que no es de este repartidor: solo se avisa (puede ser un apoyo), no se bloquea.
  const mias = zonasDeRep(r.rid), otraZona = z && mias.length && !mias.some(m => m.zid === z.zid);
  const deQuien = otraZona ? repsDeZona(z.zid).map(x => x.nombre).join(", ") : "";
  return {tipo:"ok", txt:(recibida ? "Recibida y para " : "Para ") + r.nombre + (VINC.has(r.rid) ? " · ya le sale en su app" : "") + (z ? " · " + z.nombre + (u ? " (sin datos: su zona)" : "") : "") + (otraZona ? " · ⚠ no es de sus zonas" + (deQuien ? " (es de " + deQuien + ")" : "") : "") + (q.nov.length ? " · tiene novedad: " + q.nov[q.nov.length - 1].nota : ""), evs, cls: q.nov.length || otraZona ? "aviso" : ""};
}
/* ---- Corregir una asignación equivocada (v2.37) ----
   Desde Despachar → «Lleva» (tocar el paquete) o desde Consultar. Nada se borra: queda en el histórico que se asignó
   y que se corrigió (quién y cuándo).
   - Pasar a otro repartidor: nueva asignación (reasigna), sin escanear.
   - Quitar la asignación: ANULAR de la última asignación → el paquete vuelve a como estaba antes (en bodega, o con
     el repartidor anterior si fue una reasignación). Al repartidor le sale de su Ruta al sincronizar. */
function ultimaAsignacion(g){
  const evs = POR_GUIA.get(g) || [], anul = new Set(evs.filter(e => e.tipo === "ANULAR").map(e => e.d.ref));
  return evs.filter(e => e.tipo === "ASIGNADO" && !anul.has(e.id)).sort(ordenEv).pop() || null;
}
function corregirAsignacion(g, alTerminar){
  const p = paq(g);
  if(!p || p.estado !== "RUTA"){ toast(p ? "Solo se corrige un paquete que está en ruta (ahora: " + (ESTADOS[p.estado] || p.estado).toLowerCase() + ")." : "No hay registro de esa guía."); return; }
  const ult = ultimaAsignacion(g), quien = repNombre(p.rid);
  const antes = ult && ult.d && ult.d.reasigna && ult.d.de ? repNombre(ult.d.de) : "";
  const fin = msg => { $("dlgLista").close(); pintarTodo(); toast(msg); if(alTerminar) alTerminar(); };
  const otros = repsActivos().filter(r => r.rid !== p.rid);
  mostrarListado("Corregir " + g,
    `<p style="margin:0">La tiene <b>${esc(quien)}</b> desde ${esc(fechaHora(p.asignado))}.${VINC.has(p.rid) ? " Al corregir, le sale de su app al sincronizar." : ""}</p>
     ${p.noEstaba || p.porRep ? `<p class="alerta">${esc(quien)} ya reportó este paquete desde su app; revisa con él antes de cambiarlo.</p>` : ""}
     <h3 style="margin:12px 0 6px">Pasar a otro repartidor</h3>
     <div class="reps" id="ccReps">${otros.map(r => `<button type="button" data-rid="${esc(r.rid)}">${esc(r.nombre)}${zonasDeRep(r.rid).length ? `<small class="zs">${esc(zonasDeRep(r.rid).map(z => z.nombre).join(", "))}</small>` : ""}</button>`).join("") || `<p class="hint">No hay otros repartidores activos.</p>`}</div>
     <h3 style="margin:12px 0 6px">O quitar la asignación</h3>
     <p class="hint" style="margin:0">Si fue un error: ${antes ? `vuelve a <b>${esc(antes)}</b> (la tenía antes)` : "el paquete vuelve a <b>en bodega</b>"}. Queda en el histórico como corregida.</p>`,
    [["Quitar asignación", () => {
      if(!ult){ toast("No se encontró la asignación."); return; }
      registrar("ANULAR", g, {ref: ult.id, motivo: "Asignación equivocada"});
      fin(antes ? `${g}: vuelve a ${antes}.` : `${g}: quitada a ${quien}, vuelve a bodega.`);
    }, "danger"], ["Cancelar", () => $("dlgLista").close()]]);
  $("ccReps").querySelectorAll("button[data-rid]").forEach(b => b.onclick = () => {
    const r = REPS.get(b.dataset.rid); if(!r) return;
    if(faltaZona(r)){ toast(`${r.nombre} no tiene zona: márcasela primero en Despachar.`); return; }
    zonaAlDespachar(g, r.rid);
    registrar("ASIGNADO", g, {rid: r.rid, reasigna: true, de: p.rid, motivo: "Corrección", ...zonaParaRuta(paq(g), r.rid)});
    fin(`${g}: pasada de ${quien} a ${r.nombre}.`);
  });
}
$("desLista").addEventListener("click", e => {
  const li = e.target.closest("li[data-guia]"); if(!li || e.target.closest("button")) return;
  corregirAsignacion(li.dataset.guia);
});

// La zona viaja con la asignación: así le aparece al repartidor en su Ruta (su app no conoce las zonas de la bodega).
// zona = la del paquete; zonas = las que tiene marcadas el repartidor en este momento.
function zonaParaRuta(p, rid){
  const z = p && zonaDe(p), mias = zonasDeRep(rid).map(x => x.nombre);
  return {...(z ? {zona: z.nombre} : {}), ...(mias.length ? {zonas: mias.slice(0, 10)} : {})};
}
const cfgDespacho = () => ({
  titulo:"Despachar", alLeer: asignarGuia,
  objetivo: () => { const r = repActual(); if(!r) return ""; const zs = zonasDeRep(r.rid).map(z => z.nombre); const l = delRepartidor(r.rid).enRuta; return `Para: ${r.nombre}${zs.length ? " · " + zs.join(", ") : ""} · lleva ${l.length}${l.length ? " (" + txtEmp(l) + ")" : ""}`; },
  contador: () => "asignadas en esta pasada", alCerrar: pintarTodo
});
// v2.37: con zonas creadas, es obligatorio marcarle al repartidor su(s) zona(s) antes de despachar (para que no se olvide).
const faltaZona = r => !!r && zonasActivas().length > 0 && !zonasDeRep(r.rid).length;
function exigirZona(){
  const r = repActual(); if(!r) return false;
  if(!faltaZona(r)) return true;
  toast(`Primero marca la zona de ${r.nombre}.`);
  const box = $("desZonasRep");
  if(box){ box.scrollIntoView({behavior: "smooth", block: "center"}); box.classList.remove("falta"); void box.offsetWidth; box.classList.add("falta"); }
  return false;
}
$("desScan").onclick = () => exigirZona() && abrirEscaner(cfgDespacho());
$("desEscribir").onclick = () => exigirZona() && escribirGuia(cfgDespacho());

/* ---- Planilla de salida ---- */
// Planilla agrupada por zona (y dentro, por calle y carrera): así el repartidor carga en orden.
const nomZona = p => (zonaDe(p) || {nombre: ZONAS.size ? "Sin zona" : ""}).nombre;
function ordenPlanilla(lista){ return lista.slice().sort((a, b) => nomZona(a).localeCompare(nomZona(b), "es", {numeric:true}) || (a.cl ?? 999) - (b.cl ?? 999) || (a.kr ?? 999) - (b.kr ?? 999) || a.guia.localeCompare(b.guia)); }
function textoPlanilla(r, x){
  const porEmp = Object.fromEntries(conteoEmp(x.enRuta).map(([e, n]) => [e || "Sin empresa", n]));
  const zs = zonasDeRep(r.rid).map(z => z.nombre);
  return `Planilla de salida · ${r.nombre}${zs.length ? " · Zonas: " + zs.join(", ") : ""} · ${fechaHora(new Date().toISOString())}\nTotal: ${x.enRuta.length} (${Object.entries(porEmp).map(([k, v]) => k + " " + v).join(", ")})${conteoProv(x.enRuta).some(([pv]) => pv) ? " · Proveedor: " + txtProv(x.enRuta) : ""}\n` +
    ordenPlanilla(x.enRuta).map((p, i) => `${i + 1}. ${p.guia}${p.emp ? " · " + p.emp : ""}${nomZona(p) ? " · " + nomZona(p) : ""}`).join("\n");
}
/* v2.46: planilla con presentación de empresa (impresión / PDF) y para compartir por WhatsApp como imagen. */
function datosPlanilla(r){
  const x = delRepartidor(r.rid), ps = ordenPlanilla(x.enRuta), ahora = new Date();
  const ini = r.nombre.split(/\s+/).map(w => w[0] || "").join("").slice(0, 3).toUpperCase();
  return {r, ps, ahora, num: `PS-${String(ahora.getFullYear()).slice(2)}${pad2(ahora.getMonth()+1)}${pad2(ahora.getDate())}-${pad2(ahora.getHours())}${pad2(ahora.getMinutes())}-${ini}`,
    fecha: fechaHora(ahora.toISOString()), zonas: zonasDeRep(r.rid).map(z => z.nombre), emp: conteoEmp(ps), prov: conteoProv(ps).filter(([pv]) => pv),
    porZona: (() => { const m = new Map(); ps.forEach(p => { const z = nomZona(p) || "—"; m.set(z, (m.get(z) || 0) + 1); }); return m; })()};
}
const ubicCorta = p => p.cl != null || p.kr != null ? `Cl ${txtVia(p.cl) || "?"} · Kr ${txtViaKr(p.kr) || "?"}` : "";
function htmlPlanilla(d){
  const caja = (n, t, cls) => `<div class="plBox ${cls || ""}"><b>${n}</b><span>${esc(t)}</span></div>`;
  let zAnt = null, filas = "";
  d.ps.forEach((p, i) => {
    const z = nomZona(p) || "—";
    if(ZONAS.size && z !== zAnt){ filas += `<tr class="plZona"><td colspan="7">${esc(z)} · ${d.porZona.get(z)} paquete(s)</td></tr>`; zAnt = z; }
    filas += `<tr><td class="c">${i + 1}</td><td class="g">${esc(p.guia)}</td><td>${esc(p.emp || "")}</td><td>${esc(provDe(p) || "")}</td><td>${esc(ZONAS.size ? z : "")}</td><td>${esc(ubicCorta(p))}${p.nov.length ? `<div class="plNov">Novedad: ${esc(p.nov.map(n => n.nota).join("; "))}</div>` : ""}</td><td class="c"><span class="plChk"></span></td></tr>`;
  });
  return `<div class="pl" id="planilla">
    <header class="plHead"><div><div class="plMarca">RUTA DE ENTREGAS · BODEGA</div><h1>Planilla de salida</h1></div>
      <div class="plNum"><span>N.º</span><b>${esc(d.num)}</b><span>${esc(d.fecha)}</span></div></header>
    <section class="plInfo">
      <div><span>Repartidor</span><b>${esc(d.r.nombre)}</b></div>
      <div><span>Zonas asignadas</span><b>${esc(d.zonas.join(", ") || "—")}</b></div>
      <div><span>Despachó</span><b>${esc(USER.name)}</b></div>
      <div><span>Fecha y hora</span><b>${esc(d.fecha)}</b></div>
    </section>
    <section class="plRes">${caja(d.ps.length, "paquetes en total", "tot")}${d.emp.map(([e, n]) => caja(n, e || "Sin empresa", "em-" + (e || "x").toLowerCase())).join("")}${d.prov.map(([pv, n]) => caja(n, "de " + pv)).join("")}</section>
    <table class="plTb"><thead><tr><th class="c">#</th><th>Guía</th><th>Empresa</th><th>Proveedor</th><th>Zona</th><th>Ubicación</th><th class="c">✓</th></tr></thead>
      <tbody>${filas || `<tr><td colspan="7" class="plVacio">Sin paquetes asignados en este momento.</td></tr>`}</tbody></table>
    <section class="plFirmas">
      <div><span>Entregó (bodega)</span><div class="plLinea"></div><small>Nombre: ${esc(USER.name)}</small><small>Firma</small></div>
      <div><span>Recibí conforme (repartidor)</span><div class="plLinea"></div><small>Nombre: ${esc(d.r.nombre)} · C.C. ______________</small><small>Firma</small></div>
    </section>
    <footer class="plPie">Recibo los paquetes relacionados en buen estado y me comprometo a entregarlos o devolverlos a la bodega. Documento de control interno · Ruta de Entregas · ${esc(d.fecha)}</footer>
  </div>`;
}
// Imagen PNG de la planilla (para WhatsApp): se dibuja en un canvas, sin librerías.
function imagenPlanilla(d){
  const W = 1080, P = 48, RH = 46, esc2 = 1;
  const filasZ = ZONAS.size ? d.porZona.size : 0;
  const H = 362 + 120 + (d.ps.length + filasZ + 1) * RH + 260;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d"), F = (w, s) => `${w} ${s}px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
  const txt = (t, x, y, f, col, al) => { g.font = f; g.fillStyle = col || "#111"; g.textAlign = al || "left"; g.fillText(String(t), x, y); };
  const corta = (t, max, f) => { g.font = f; t = String(t); while(t.length > 1 && g.measureText(t).width > max) t = t.slice(0, -2) + "…"; return t; };
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
  // Encabezado
  g.fillStyle = "#1f2a2a"; g.fillRect(0, 0, W, 150);
  g.fillStyle = "#f5c22d"; g.fillRect(0, 150, W, 8);
  txt("RUTA DE ENTREGAS · BODEGA", P, 58, F("700", 22), "#f5c22d");
  txt("Planilla de salida", P, 112, F("800", 46), "#fff");
  txt("N.º " + d.num, W - P, 70, F("700", 24), "#fff", "right");
  txt(d.fecha, W - P, 108, F("500", 22), "#cfd8d8", "right");
  // Datos
  const info = [["Repartidor", d.r.nombre], ["Zonas asignadas", d.zonas.join(", ") || "—"], ["Despachó", USER.name], ["Fecha y hora", d.fecha]];
  info.forEach(([k, v], i) => { const x = P + (i % 2) * ((W - 2 * P) / 2), y = 205 + Math.floor(i / 2) * 64; txt(k.toUpperCase(), x, y, F("600", 17), "#6b7676"); txt(corta(v, (W - 2 * P) / 2 - 20, F("700", 26)), x, y + 32, F("700", 26)); });
  // Resumen
  let y = 350; const cajas = [[d.ps.length, "paquetes"], ...d.emp.map(([e, n]) => [n, e || "Sin empresa"]), ...d.prov.map(([pv, n]) => [n, "de " + pv])];
  const cw = Math.min(220, (W - 2 * P - (cajas.length - 1) * 12) / cajas.length);
  cajas.forEach(([n, t], i) => {
    const x = P + i * (cw + 12), col = t === "Xcargo" ? "#e8a317" : t === "iMile" ? "#1fa5c4" : i === 0 ? "#1f2a2a" : "#7b5cd6";
    g.fillStyle = "#f4f6f6"; g.fillRect(x, y, cw, 90); g.fillStyle = col; g.fillRect(x, y, 8, 90);
    txt(n, x + 24, y + 50, F("800", 38), col); txt(corta(t, cw - 30, F("600", 18)), x + 24, y + 78, F("600", 18), "#444");
  });
  // Tabla
  y = 512; const cols = [[P, 50, "#"], [P + 52, 278, "GUÍA"], [P + 332, 122, "EMPRESA"], [P + 456, 132, "PROVEEDOR"], [P + 590, 150, "ZONA"], [P + 742, 242, "UBICACIÓN"]];
  g.fillStyle = "#1f2a2a"; g.fillRect(P - 10, y - 32, W - 2 * P + 20, RH);
  cols.forEach(([x, , t]) => txt(t, x, y, F("700", 18), "#fff"));
  y += RH; let zAnt = null, n = 0;
  if(!d.ps.length){ txt("Sin paquetes asignados en este momento.", P, y, F("500", 22), "#666"); y += RH; }
  d.ps.forEach((p, i) => {
    const z = nomZona(p) || "—";
    if(ZONAS.size && z !== zAnt){ g.fillStyle = "#e9eeee"; g.fillRect(P - 10, y - 32, W - 2 * P + 20, RH); txt(`${z} · ${d.porZona.get(z)} paquete(s)`, P, y, F("700", 20), "#1f2a2a"); y += RH; zAnt = z; n = 0; }
    if(n++ % 2){ g.fillStyle = "#f8f9f9"; g.fillRect(P - 10, y - 32, W - 2 * P + 20, RH); }
    const f = F("500", 21), vals = [i + 1, p.guia, p.emp || "", provDe(p) || "", ZONAS.size ? z : "", ubicCorta(p)];
    cols.forEach(([x, w], k) => txt(corta(vals[k], w - 8, k === 1 ? F("700", 22) : f), x, y, k === 1 ? F("700", 22) : f, k === 2 ? (p.emp === "Xcargo" ? "#b77d00" : p.emp === "iMile" ? "#0e7f99" : "#222") : "#222"));
    g.strokeStyle = "#e3e7e7"; g.beginPath(); g.moveTo(P - 10, y + 14); g.lineTo(W - P + 10, y + 14); g.stroke();
    y += RH;
  });
  // Firmas
  y += 70; g.strokeStyle = "#333"; g.lineWidth = 2;
  [[P, "Entregó (bodega)", USER.name], [W / 2 + 20, "Recibí conforme (repartidor)", d.r.nombre]].forEach(([x, t, nom]) => {
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + W / 2 - P - 30, y); g.stroke();
    txt(t, x, y + 32, F("700", 20)); txt(nom, x, y + 60, F("500", 19), "#555");
  });
  txt("Documento de control interno · Ruta de Entregas", W / 2, H - 28, F("500", 17), "#8a9494", "center");
  return new Promise(ok => c.toBlob(ok, "image/png"));
}
async function compartirPlanilla(d){
  const nombre = `planilla-${d.r.nombre.replace(/\s+/g, "-").toLowerCase()}-${d.num}.png`;
  const texto = `Planilla de salida ${d.num}\nRepartidor: ${d.r.nombre}\nPaquetes: ${d.ps.length}` + (d.emp.length ? ` (${d.emp.map(([e, n]) => (e || "Sin empresa") + " " + n).join(", ")})` : "") + (d.zonas.length ? `\nZonas: ${d.zonas.join(", ")}` : "");
  try{
    const blob = await imagenPlanilla(d), file = new File([blob], nombre, {type: "image/png"});
    if(navigator.canShare && navigator.canShare({files: [file]})){ await navigator.share({files: [file], title: "Planilla de salida", text: texto}); return; }
    // Sin «compartir» (computador): se descarga la imagen y se abre WhatsApp con el resumen para adjuntarla.
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nombre; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    window.open("https://wa.me/?text=" + encodeURIComponent(texto), "_blank", "noopener");
    toast("Imagen descargada: adjúntala en el chat de WhatsApp que se abrió.");
  }catch(e){ if(e && e.name === "AbortError") return; toast("No se pudo compartir: " + (e.message || e)); }
}
$("desPlanilla").onclick = () => {
  const r = repActual(); if(!r) return;
  const d = datosPlanilla(r);
  mostrarListado("Planilla · " + r.nombre, htmlPlanilla(d),
    [["Compartir (WhatsApp)", () => compartirPlanilla(d), "primary"],
     ["Imprimir / PDF", () => window.print()],
     ["Copiar texto", async () => { try{ await navigator.clipboard.writeText(textoPlanilla(r, delRepartidor(r.rid))); toast("Planilla copiada."); }catch(e){ toast("No se pudo copiar."); } }],
     ["Excel", () => excelPlanilla(r.rid)]]);
  $("dlgLista").classList.add("conPlanilla");
  $("dlgLista").addEventListener("close", () => $("dlgLista").classList.remove("conPlanilla"), {once: true});
};
