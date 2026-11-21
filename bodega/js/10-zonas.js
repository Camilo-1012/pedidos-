/* Zonificación: zonas por rangos de calles y carreras («desde–hasta»), como la zona de trabajo de Ruta de Entregas
   (pedidos-/js/03-mapas.js → zoneIssue), pero varias y con repartidor habitual.
   La zona de un paquete NO se guarda: se calcula con su ubicación (número de calle y de carrera) y las zonas vigentes,
   así que cambiar un rango rezonifica todo sin migrar datos. Se puede elegir la zona a mano (queda fija).
   Para minimizar datos (Ley 1581) solo se guardan los números de calle y carrera, sin placa ni nada del cliente. */
"use strict";
const COLORES_ZONA = [["#2f6fdf","Azul"],["#d0421b","Rojo"],["#1f8a4c","Verde"],["#c98a00","Amarillo"],["#7b3fbf","Morado"],["#0f8b8d","Turquesa"],["#c2185b","Fucsia"],["#6d4c41","Café"],["#455a64","Gris"]];

/* ---- Números de vía: «145», «145B» (cuenta como 145), «10 Sur» / «10S» (negativo), «5 Este» (negativo).
   «5E» es la letra E (Carrera 5E), no Este: por eso Este va escrito completo. ---- */
function numVia(t){
  t = String(t ?? "").trim().toUpperCase();
  if(!t) return null;
  const m = /^(\d{1,3})\s*(?:[A-H])?\s*(?:BIS)?\s*(?:[A-H])?\s*(SUR|S|ESTE|E)?$/.exec(t);
  if(!m) return NaN;
  return m[2] ? -(+m[1]) : +m[1];
}
const txtVia = n => n == null ? "" : n < 0 ? Math.abs(n) + " Sur" : String(n);
const txtViaKr = n => n == null ? "" : n < 0 ? Math.abs(n) + " Este" : String(n);
function rangoTxt(z){
  const r = (a, nom, f) => a[0] == null && a[1] == null ? "" : `${nom} ${a[0] == null ? "…" : f(a[0])}–${a[1] == null ? "…" : f(a[1])}`;
  return [r(z.cl, "Calle", txtVia), r(z.kr, "Carrera", txtViaKr)].filter(Boolean).join(" · ") || "Sin rango";
}
const dentro = (v, a) => {
  if(a[0] == null && a[1] == null) return true;
  if(v == null) return false;
  const lo = a[0] == null ? -Infinity : a[1] == null ? a[0] : Math.min(a[0], a[1]);
  const hi = a[1] == null ? Infinity : a[0] == null ? a[1] : Math.max(a[0], a[1]);
  return v >= lo && v <= hi;
};
// Zonas activas en orden de nombre: si dos se cruzan, gana la primera (por eso conviene llamarlas Z1, Z2…).
const zonasActivas = () => [...ZONAS.values()].filter(z => z.activa).sort((a, b) => a.nombre.localeCompare(b.nombre, "es", {numeric:true}));
function zonaPorUbic(cl, kr){
  if(cl == null && kr == null) return null;
  return zonasActivas().find(z => (z.cl[0] != null || z.cl[1] != null || z.kr[0] != null || z.kr[1] != null) && dentro(cl, z.cl) && dentro(kr, z.kr)) || null;
}
function zonaDe(p){
  if(!p) return null;
  if(p.zidManual){ const z = ZONAS.get(p.zidManual); return z && z.activa ? z : null; }
  return zonaPorUbic(p.cl, p.kr);
}
const tieneUbic = p => !!(p.zidManual || p.cl != null || p.kr != null);
function chipZona(z, extra){
  if(!z) return `<span class="chip zsin">Sin zona${extra ? " " + extra : ""}</span>`;
  return `<span class="chip zona" style="--zc:${esc(z.color || "#455a64")}">${esc(z.nombre)}${extra ? " " + extra : ""}</span>`;
}
// Cruce de dos rectángulos (ejes abiertos = sin límite). Devuelve el texto del cruce o "".
function cruce(a, b){
  const eje = (x, y) => {
    const lo = Math.max(x[0] == null ? -Infinity : Math.min(x[0], x[1] ?? x[0]), y[0] == null ? -Infinity : Math.min(y[0], y[1] ?? y[0]));
    const hi = Math.min(x[1] == null ? Infinity : Math.max(x[1], x[0] ?? x[1]), y[1] == null ? Infinity : Math.max(y[1], y[0] ?? y[1]));
    return lo <= hi ? [lo, hi] : null;
  };
  const c = eje(a.cl, b.cl), k = eje(a.kr, b.kr);
  if(!c || !k) return "";
  const f = (r, g) => `${isFinite(r[0]) ? g(r[0]) : "…"}–${isFinite(r[1]) ? g(r[1]) : "…"}`;
  return `Calle ${f(c, txtVia)} × Carrera ${f(k, txtViaKr)}`;
}

/* ---- Pedir la ubicación de un paquete ----
   En el escáner: panel con calle y carrera (teclado numérico) y botones de zona; la cámara no lee mientras tanto.
   Fuera del escáner: formulario. Devuelve {cl, kr} | {zid} | null (saltar). */
function pedirUbicacion(g){
  if($("dlgScan").open) return new Promise(res => {
    const zs = zonasActivas();
    $("ubGuia").textContent = g; $("ubCl").value = ""; $("ubKr").value = ""; $("ubErr").textContent = "";
    $("ubZonas").innerHTML = zs.map(z => `<button type="button" class="small zbtn" style="--zc:${esc(z.color || "#455a64")}" data-zid="${esc(z.zid)}">${esc(z.nombre)}</button>`).join("");
    const vista = () => { const cl = numVia($("ubCl").value), kr = numVia($("ubKr").value);
      const z = Number.isNaN(cl) || Number.isNaN(kr) ? null : zonaPorUbic(cl, kr);
      $("ubPrev").innerHTML = cl == null && kr == null ? "" : Number.isNaN(cl) || Number.isNaN(kr) ? "Revisa los números." : "Queda en " + chipZona(z); };
    const fin = v => { $("scUbic").hidden = true; SC.preguntando = null; res(v); };
    $("ubCl").oninput = $("ubKr").oninput = vista; vista();
    $("ubZonas").querySelectorAll("button").forEach(b => b.onclick = () => fin({zid: b.dataset.zid}));
    $("ubSaltar").onclick = () => fin(null);
    $("ubOk").onclick = () => {
      const cl = numVia($("ubCl").value), kr = numVia($("ubKr").value);
      if(cl == null && kr == null){ $("ubErr").textContent = "Escribe la calle y la carrera, o toca una zona."; return; }
      if(Number.isNaN(cl) || Number.isNaN(kr)){ $("ubErr").textContent = "Solo el número de la vía (ej. 145 o 145B)."; return; }
      fin({cl, kr});
    };
    $("ubCl").onkeydown = e => { if(e.key === "Enter"){ e.preventDefault(); $("ubKr").focus(); } };
    $("ubKr").onkeydown = e => { if(e.key === "Enter"){ e.preventDefault(); $("ubOk").click(); } };
    SC.preguntando = () => fin(null);   // al cerrar el escáner se salta
    $("scUbic").hidden = false; setTimeout(() => $("ubCl").focus(), 30);
  });
  return pedir({title:"Ubicación de " + g, msg:"Número de la calle y de la carrera (sin placa). O elige la zona directamente.",
    fields:[{id:"cl", label:"Calle (ej. 145, 145B o 10 Sur)", type:"text", max:12}, {id:"kr", label:"Carrera (ej. 104, 104B o 5 Este)", type:"text", max:12},
      {id:"zid", label:"Zona", type:"select", options:[["", "Según la calle y la carrera"], ...zonasActivas().map(z => [z.zid, z.nombre])]}],
    yes:"Guardar", check: v => v.zid ? "" : (Number.isNaN(numVia(v.cl)) || Number.isNaN(numVia(v.kr))) ? "Revisa los números de calle y carrera." : numVia(v.cl) == null && numVia(v.kr) == null ? "Escribe la calle y la carrera, o elige la zona." : ""
  }).then(v => !v ? null : v.zid ? {zid: v.zid} : {cl: numVia(v.cl), kr: numVia(v.kr)});
}
function guardarUbicacion(g, v){
  if(!v) return null;
  return registrar("UBICACION", g, v.zid ? {zid: v.zid} : {cl: v.cl, kr: v.kr});
}

/* ---- Resumen por zona ---- */
function conteoZonas(filtro){
  const m = new Map(); let sin = 0;
  for(const p of PAQ.values()){ if(!filtro(p)) continue; const z = zonaDe(p); if(z) m.set(z.zid, (m.get(z.zid) || 0) + 1); else sin++; }
  return {m, sin};
}
function pintarZonasRecibir(){
  const box = $("recZonas"), l = loteActual();
  if(!box) return;
  if(!zonasActivas().length || !l){ box.innerHTML = ""; return; }
  const {m, sin} = conteoZonas(p => p.recLote === l.lid && p.estado === "BODEGA");
  box.innerHTML = `<h3>En bodega de este lote, por zona</h3><div class="zgrid">${zonasActivas().map(z => `<button type="button" class="zcell" style="--zc:${esc(z.color)}" data-zid="${esc(z.zid)}"><b>${m.get(z.zid) || 0}</b><span>${esc(z.nombre)}</span></button>`).join("")}<button type="button" class="zcell sin" data-zid=""><b>${sin}</b><span>Sin zona</span></button></div>`;
  box.querySelectorAll("button").forEach(b => b.onclick = () => listaZona(b.dataset.zid, p => p.recLote === l.lid && p.estado === "BODEGA"));
}
// Despachar: zonas del repartidor elegido primero, con lo que hay en bodega de cada una.
function pintarZonasDespacho(rid){
  const box = $("desZonas"); if(!box) return;
  const zs = zonasActivas(); if(!zs.length){ box.innerHTML = ""; return; }
  const {m, sin} = conteoZonas(p => p.estado === "BODEGA");
  const suyas = zs.filter(z => z.rid === rid), otras = zs.filter(z => z.rid !== rid);
  const celda = z => `<button type="button" class="zcell${z.rid === rid ? " suya" : ""}" style="--zc:${esc(z.color)}" data-zid="${esc(z.zid)}"><b>${m.get(z.zid) || 0}</b><span>${esc(z.nombre)}${z.rid && z.rid !== rid ? " · " + esc(repNombre(z.rid)) : ""}</span></button>`;
  box.innerHTML = `<h3>En bodega por zona${suyas.length ? "" : " (este repartidor no tiene zona habitual)"}</h3><div class="zgrid">${suyas.map(celda).join("")}${otras.map(celda).join("")}<button type="button" class="zcell sin" data-zid=""><b>${sin}</b><span>Sin zona</span></button></div>`;
  box.querySelectorAll("button").forEach(b => b.onclick = () => listaZona(b.dataset.zid, p => p.estado === "BODEGA"));
}
function listaZona(zid, filtro){
  const z = zid ? ZONAS.get(zid) : null;
  const items = paquetes(p => filtro(p) && ((zonaDe(p) || {}).zid || "") === zid).sort((a, b) => (a.cl ?? 0) - (b.cl ?? 0) || (a.kr ?? 0) - (b.kr ?? 0) || a.guia.localeCompare(b.guia));
  mostrarListado((z ? z.nombre : "Sin zona") + ` (${items.length})`, (z ? `<p class="hint">${esc(rangoTxt(z))}${z.rid ? " · " + esc(repNombre(z.rid)) : ""}</p>` : `<p class="hint">Toca un paquete para ver su recorrido y ponerle ubicación.</p>`) +
    `<ul class="lista">${items.map(p => liPaq(p, ubicTxt(p))).join("") || "<li class='vacio'>Ninguno.</li>"}</ul>`);
}
const ubicTxt = p => p.zidManual ? "Zona elegida a mano" : p.cl != null || p.kr != null ? `Calle ${txtVia(p.cl) || "?"} · Carrera ${txtViaKr(p.kr) || "?"}` : "Sin ubicación";

/* ---- Administrar zonas (solo administrador; el servidor también lo exige) ---- */
function pintarZonasAdmin(){
  const todos = [...ZONAS.values()].sort((a, b) => (b.activa - a.activa) || a.nombre.localeCompare(b.nombre, "es", {numeric:true}));
  const admin = USER.admin, {m} = conteoZonas(p => p.estado === "BODEGA" || p.estado === "RUTA");
  $("znNota").textContent = (admin ? "Cada zona es un rango de calles y de carreras (desde–hasta). Deja vacío un eje si no lo limita. Si dos zonas se cruzan, en el cruce gana la primera por nombre: llámalas Z1, Z2…" : "Solo un administrador crea o cambia zonas.");
  $("znAdd").hidden = !admin;
  $("znList").innerHTML = todos.length ? "" : `<p class="hint">Aún no hay zonas.</p>`;
  todos.forEach(z => {
    const row = document.createElement("div"); row.className = "urow" + (z.activa ? "" : " inactivo");
    row.innerHTML = `<div><span class="zdot" style="--zc:${esc(z.color)}"></span><b></b><div class="hint" style="margin:0"></div></div>`;
    row.querySelector("b").textContent = z.nombre;
    row.querySelector(".hint").textContent = rangoTxt(z) + (z.rid ? " · " + repNombre(z.rid) : "") + ` · ${m.get(z.zid) || 0} en bodega o ruta` + (z.activa ? "" : " · Inactiva");
    if(admin){
      const acts = document.createElement("div"); acts.className = "row";
      const be = document.createElement("button"); be.type = "button"; be.className = "small"; be.textContent = "Editar"; be.onclick = () => editarZona(z);
      const ba = document.createElement("button"); ba.type = "button"; ba.className = "small" + (z.activa ? " danger" : ""); ba.textContent = z.activa ? "Desactivar" : "Activar";
      ba.onclick = () => { registrar("ZONA", null, {...datosZona(z), activa: !z.activa}); pintarZonasAdmin(); pintarTodo(); };
      acts.append(be, ba); row.appendChild(acts);
    }
    $("znList").appendChild(row);
  });
}
const datosZona = z => ({zid: z.zid, nombre: z.nombre, color: z.color, cl: z.cl, kr: z.kr, rid: z.rid || "", activa: z.activa});
async function editarZona(z){
  const nueva = !z, usados = new Set([...ZONAS.values()].map(x => x.color));
  z = z || {zid: "z" + uuid().slice(0, 8), nombre: "Z" + (ZONAS.size + 1) + " ", color: (COLORES_ZONA.find(([c]) => !usados.has(c)) || COLORES_ZONA[0])[0], cl:[null, null], kr:[null, null], rid: "", activa: true};
  const v = await pedir({title: nueva ? "Nueva zona" : "Editar " + z.nombre, msg:"Rango de la zona: «desde» y «hasta». Ej.: Calle 132 a 145 y Carrera 104 a 130. Sur: 10S o 10 Sur · Este: 5 Este.",
    fields:[{id:"n", label:"Nombre (ej. Z1 Tibabuyes)", type:"text", value:z.nombre.trim(), max:30},
      {id:"cd", label:"Calle desde", type:"text", value:txtVia(z.cl[0]), max:8, ph:"vacío = sin límite"}, {id:"ch", label:"Calle hasta", type:"text", value:txtVia(z.cl[1]), max:8, ph:"vacío = sin límite"},
      {id:"kd", label:"Carrera desde", type:"text", value:txtViaKr(z.kr[0]), max:8, ph:"vacío = sin límite"}, {id:"kh", label:"Carrera hasta", type:"text", value:txtViaKr(z.kr[1]), max:8, ph:"vacío = sin límite"},
      {id:"c", label:"Color", type:"select", options:COLORES_ZONA, value:z.color},
      {id:"r", label:"Repartidor habitual (opcional)", type:"select", options:[["", "—"], ...repsActivos().map(r => [r.rid, r.nombre])], value:z.rid || ""}],
    yes:"Guardar", check: v => {
      const nom = v.n.trim().replace(/\s+/g, " ");
      if(!nom) return "Escribe el nombre.";
      if([...ZONAS.values()].some(x => x.zid !== z.zid && x.nombre.toLowerCase() === nom.toLowerCase())) return "Ya hay una zona con ese nombre.";
      const nums = [v.cd, v.ch, v.kd, v.kh].map(numVia);
      if(nums.some(Number.isNaN)) return "Los límites son números de vía (ej. 132, 145B, 10S).";
      if(nums.every(n => n == null)) return "Pon al menos un límite de calle o de carrera.";
      return "";
    }});
  if(!v) return;
  const n = numVia;
  const d = {zid: z.zid, nombre: v.n.trim().replace(/\s+/g, " "), color: v.c, cl:[n(v.cd), n(v.ch)], kr:[n(v.kd), n(v.kh)], rid: v.r, activa: z.activa};
  const cruces = zonasActivas().filter(x => x.zid !== d.zid).map(x => [x, cruce(d, x)]).filter(([, c]) => c);
  if(cruces.length && !await confirmar("La zona se cruza con otras", cruces.map(([x, c]) => `${x.nombre}: ${c}`).join("\n") + "\nEn el cruce gana la primera por nombre.", "Guardar igual")) return;
  registrar("ZONA", null, d);
  pintarZonasAdmin(); pintarTodo();
}
$("btnZonas").onclick = () => { pintarZonasAdmin(); $("dlgZonas").showModal(); };
$("znAdd").onclick = () => editarZona(null);
