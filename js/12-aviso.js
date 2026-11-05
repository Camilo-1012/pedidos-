/* Aviso al cliente con hora de llegada y «Parquea una vez» (entregas a pie agrupadas). */
"use strict";

/* ============ Aviso al cliente ============
   WhatsApp: se abre el chat directo con el número (wa.me), sin guardar el contacto; el mensaje va escrito y solo se
   toca Enviar. SMS como alternativa. La hora sale del ritmo real del día o, al inicio, del tiempo de manejo + 4 min. */
const AVISO_N = 3, SERVICIO_MIN = 4;
const r5 = t => { const d = new Date(t); d.setSeconds(0,0); d.setMinutes(Math.round(d.getMinutes()/5)*5); return d.getTime(); };
function etaProximos(n){
  const p = dayPace();
  const list = state.stops.filter(s=>s.status==="pend" && !s.example).slice(0, n);
  const out = []; let t = Date.now(), prev = currentOrigin();
  for(const s of list){
    let min;
    if(out.length && p.perStop != null) min = p.perStop;                       // ritmo real del día (manejo + entrega)
    else {
      const lc = prev ? legCost(prev, s) : null;
      const manejo = lc && lc.sec != null ? lc.sec/60 * (esMoto() ? MOTO_TIEMPO : 1) : (prev && prev.x != null && s.x != null ? gridDist(prev, s)*25/60 : 6);
      min = manejo + (out.length ? SERVICIO_MIN : 0);
    }
    t += min*60000;
    // Ventana para el cliente: desde 5 min antes hasta 10 min después, redondeada a 5 min.
    out.push({s, eta: t, desde: r5(t - 5*60000), hasta: r5(t + 10*60000)});
    prev = s;
  }
  return out;
}
const horaCorta = t => new Date(t).toLocaleTimeString("es-CO", {hour:"numeric", minute:"2-digit"}).replace(/\s?a\.?\s?m\.?/i," a. m.").replace(/\s?p\.?\s?m\.?/i," p. m.");
function avisoTexto(x){
  const s = x.s, nombre = s.name ? " " + titleCase(s.name.split(" ")[0]) : "";
  return `Hola${nombre}, le escribe el domiciliario. Voy en camino con su pedido para ${s.label || s.addr}${s.unit ? " (" + s.unit + ")" : ""}. ` +
    `Llego aproximadamente entre las ${horaCorta(x.desde)} y las ${horaCorta(x.hasta)}`.replace(/\.?$/, ".") + " ¿Hay alguien para recibir?";
}
function renderAviso(){
  const box = $("avList"), lista = etaProximos(AVISO_N);
  box.innerHTML = "";
  if(!lista.length){ box.innerHTML = '<p class="hint">No hay entregas pendientes.</p>'; return; }
  for(const x of lista){
    const s = x.s, tel = cleanPhone(s.phone), r = document.createElement("div");
    r.className = "found" + (s.avisadoAt ? " done" : "");
    r.innerHTML = `<div class="addr"></div><div class="hint" style="margin:0"></div><div class="row" style="gap:6px"></div>`;
    r.querySelector(".addr").textContent = `${stopNum(s)}. ${s.label || s.addr}`;
    r.querySelector(".hint").textContent = [s.name, `llega ≈ ${horaCorta(x.eta)}`, s.avisadoAt ? `✓ avisado ${horaCorta(s.avisadoAt)}` : "", !tel ? "sin teléfono" : ""].filter(Boolean).join(" · ");
    const acts = r.querySelector(".row");
    if(tel){
      const marcar = ()=>{ s.avisadoAt = Date.now(); save(); setTimeout(renderAviso, 300); render(); };
      const wa = document.createElement("a"); wa.className = "btn small dark"; wa.textContent = "WhatsApp";
      wa.href = "https://wa.me/57" + tel + "?text=" + encodeURIComponent(avisoTexto(x)); wa.target = "_blank"; wa.rel = "noopener"; wa.onclick = marcar;
      const sms = document.createElement("a"); sms.className = "btn small"; sms.textContent = "SMS";
      sms.href = "sms:+57" + tel + "?body=" + encodeURIComponent(avisoTexto(x)); sms.onclick = marcar;
      acts.append(wa, sms);
    } else {
      const ed = document.createElement("button"); ed.type = "button"; ed.className = "small"; ed.textContent = "Agregar teléfono";
      ed.onclick = ()=>{ $("dlgAviso").close(); openEdit(s); };
      acts.append(ed);
    }
    box.appendChild(r);
  }
  const p = dayPace();
  $("avInfo").textContent = (p.perStop != null ? `Horas calculadas con tu ritmo de hoy (${Math.round(p.perStop)} min por parada).` : `Horas calculadas con el tiempo de manejo + ${SERVICIO_MIN} min por entrega (cuando lleves 2 entregas se usa tu ritmo real).`) +
    " WhatsApp abre el chat directo con el número, sin guardar el contacto: solo tocas Enviar.";
}
function abrirAviso(){ renderAviso(); $("dlgAviso").showModal(); }
document.getElementById("btnAviso").onclick = abrirAviso;
document.getElementById("dvAviso").onclick = abrirAviso;

/* ============ Parquea una vez ============
   Paradas seguidas en la ruta que quedan a pie (≤ 130 m de la primera y de la anterior), o en el mismo conjunto:
   se parquea una sola vez y se entregan caminando. No cambia el orden (el optimizador ya las deja juntas). */
const PARQUEO_M = 130;
function metrosEntre(a, b){
  if(a.lat != null && b.lat != null && a.lng != null && b.lng != null) return meters(a, b);
  if(a.x != null && b.x != null) return (Math.abs(a.x-b.x) + Math.abs(a.y-b.y)) * 100;   // ≈ 100 m por cuadra
  return Infinity;
}
const conjuntoDe = s => { const m = (s.unit||"").match(/^([^,]+)/); return s.type === "conjunto" && m ? norm(m[1]) : ""; };
function gruposParqueo(){
  const pend = state.stops.filter(s=>s.status==="pend" && !s.example && s.x != null);
  const grupos = []; let g = null;
  for(const s of pend){
    const mismoConj = g && conjuntoDe(s) && conjuntoDe(s) === conjuntoDe(g.miembros[0]);
    if(g && (mismoConj || (metrosEntre(g.miembros[0], s) <= PARQUEO_M && metrosEntre(g.miembros[g.miembros.length-1], s) <= PARQUEO_M))){ g.miembros.push(s); continue; }
    if(g && g.miembros.length > 1) grupos.push(g);
    g = {miembros:[s]};
  }
  if(g && g.miembros.length > 1) grupos.push(g);
  for(const gr of grupos){
    gr.radio = Math.round(Math.max(...gr.miembros.map(m=>metrosEntre(gr.miembros[0], m))) / 10) * 10;
    gr.pedidos = gr.miembros.reduce((a,m)=>a+(m.qty||1), 0);
    gr.conjunto = conjuntoDe(gr.miembros[0]) && gr.miembros.every(m=>conjuntoDe(m)===conjuntoDe(gr.miembros[0])) ? gr.miembros[0].unit.split(",")[0].trim() : "";
  }
  return grupos;
}
function textoParqueo(gr){
  return gr.conjunto
    ? `Parquea una vez en ${gr.conjunto}: ${gr.miembros.length} entregas (${gr.pedidos} pedidos)`
    : `Parquea una vez: ${gr.miembros.length} entregas a pie (${gr.pedidos} pedidos, en ≈ ${Math.max(gr.radio, 50)} m)`;
}
