/* Modo conducción: la parada actual en letra grande y botones enormes (Waze, Llamar, No estaba, Entregado).
   La pantalla no se apaga mientras está abierto (Wake Lock) y el botón Atrás de Android lo cierra. */
"use strict";
let dvIdx = 0, wakeLock = null;
const drivePend = ()=>state.stops.filter(s=>s.status!=="done" && !s.example);
async function keepAwake(on){
  try{
    if(on && "wakeLock" in navigator && !wakeLock){ wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", ()=>{ wakeLock = null; }); }
    if(!on && wakeLock){ await wakeLock.release(); wakeLock = null; }
  }catch(e){ wakeLock = null; }   // sin batería suficiente o sin soporte: no pasa nada
}
function openDrive(){
  state.driveOn = true;
  // Hora de salida a ruta (para el Excel): la primera vez que se abre el modo conducción en la jornada.
  if(!state.salidaAt) state.salidaAt = Date.now();
  save();
  dvIdx = 0; $("drive").hidden = false; document.body.style.overflow = "hidden";
  try{ history.pushState({drive:1}, ""); }catch(e){}
  keepAwake(true); renderDrive();
}
function closeDrive(fromBack){
  state.driveOn = false; save();
  $("drive").hidden = true; document.body.style.overflow = "";
  keepAwake(false);
  if(!fromBack && history.state && history.state.drive){ try{ history.back(); }catch(e){} }
  render();
}
function renderDrive(){
  if($("drive").hidden) return;
  if(typeof pintarApps === "function") pintarApps();   // botones de Xcargo / iMile (js/14-apps.js)
  const list = drivePend();
  if(dvIdx >= list.length) dvIdx = Math.max(0, list.length-1);
  const s = list[dvIdx];
  const off = !s;
  for(const id of ["dvFail","dvDone","dvPrev","dvNextBtn"]) $(id).disabled = off;
  if(off){
    $("dvPos").textContent = "Sin pendientes";
    $("dvQty").textContent = ""; $("dvAddr").textContent = "¡Terminaste!"; $("dvUnit").textContent = "No quedan entregas pendientes.";
    $("dvGuia").textContent = $("dvWho").textContent = $("dvNext").textContent = "";
    $("dvGuiaBtn").hidden = true;
    $("dvWaze").setAttribute("aria-disabled","true"); $("dvCall").disabled = true;
    $("dvPace").textContent = paceText();
    return;
  }
  const n = stopNum(s), total = list.length;
  // Parquea una vez: si esta parada es parte de un grupo a pie, se avisa y se listan las demás del grupo.
  const gr = typeof gruposParqueo === "function" ? gruposParqueo().find(g=>g.miembros.some(m=>m.id===s.id)) : null;
  // ¿Acaba de entregar muy cerca? Entonces ya está parqueado: sigue a pie.
  const ld = state.lastDoneId ? state.stops.find(x=>x.id===state.lastDoneId && x.status==="done") : null;
  const aPie = typeof metrosEntre === "function" && ld && ld.doneAt && Date.now() - ld.doneAt < 20*60000 && metrosEntre(ld, s) <= PARQUEO_M;
  $("dvPark").hidden = !gr && !aPie;
  if(aPie){
    const resto = gr ? gr.miembros.filter(m=>m.id!==s.id) : [];
    $("dvPark").innerHTML = `<span>A pie · queda a ≈ ${Math.max(20, Math.round(metrosEntre(ld, s)/10)*10)} m de la entrega anterior: no muevas el vehículo</span>` +
      (resto.length ? `<small>Después, también a pie: ${resto.map(m=>esc((m.label||m.addr) + (m.unit ? " · " + m.unit : ""))).join(" — ")}</small>` : "");
  } else if(gr){
    const resto = gr.miembros.filter(m=>m.id!==s.id);
    $("dvPark").innerHTML = `<span>P · ${esc(textoParqueo(gr))}</span><small>Después, a pie: ${resto.map(m=>esc((m.label||m.addr) + (m.unit ? " · " + m.unit : ""))).join(" — ")}</small>`;
  }
  // El número grande es el del paquete (fijo en ruta); arriba, cuántas entregas faltan.
  const faltan = state.stops.filter(x=>x.status!=="done").length;
  $("dvPos").textContent = faltan === 1 ? "Última entrega" : `Faltan ${faltan} entregas`;
  $("dvQty").textContent = [(s.qty||1)>1 ? `${s.qty} pedidos en esta dirección` : "", s.status==="fail" ? "Ya tuvo un intento fallido" : "", s.zone ? "ST " + s.zone : ""].filter(Boolean).join(" · ");
  $("dvAddr").textContent = s.label || s.addr;
  $("dvUnit").textContent = [unitText(s), s.barrio].filter(Boolean).join(" · ");
  // Número de orden en la ruta (el mismo de la lista): grande, para ubicar el paquete en el vehículo.
  // Si el paquete tiene guía escaneada, se muestra debajo como dato secundario.
  const gs = guias(s);
  $("dvGuia").innerHTML = `<span class="lbl">Pedido n.º</span><span class="orden">${n}</span>` +
    (gs.length ? `<span class="gs">Guía${gs.length > 1 ? "s" : ""}: ${gs.map(esc).join(" · ")}</span>` : "");
  $("dvGuiaBtn").hidden = gs.length >= (s.qty||1);
  $("dvGuiaBtn").textContent = gs.length ? `+ Escanear guía ${gs.length+1} de ${s.qty||1}` : "+ Escanear guía";
  $("dvWho").textContent = [s.name, s.phone && s.phone.replace(/(\d{3})(\d{3})(\d{4})/,"$1 $2 $3"), s.notes].filter(Boolean).join(" · ");
  const nx = list[dvIdx+1];
  $("dvNext").textContent = nx ? "Después: " + (nx.label || nx.addr) : "Es la última parada.";
  $("dvWaze").href = wazeUrl(s); $("dvWaze").removeAttribute("aria-disabled");
  $("dvCall").disabled = false;
  $("dvCall").textContent = dialNumber(s.phone) ? "Llamar" : "Marcar";
  $("dvPrev").disabled = dvIdx === 0; $("dvNextBtn").disabled = dvIdx >= total-1;
  $("dvPace").textContent = paceText();
}
const driveStop = ()=>drivePend()[dvIdx];
// Abre el marcador del teléfono con el número listo (el usuario solo toca llamar).
function dial(num){
  const a = document.createElement("a"); a.href = "tel:" + num;
  document.body.appendChild(a); a.click(); a.remove();
}
$("dvCall").onclick = ()=>{
  const s = driveStop(); if(!s) return;
  // Con número: el marcador se abre con el número listo (solo se toca llamar).
  // Sin número: se abre el marcador vacío para escribir el que aparece en la etiqueta.
  dial(dialNumber(s.phone));
};
$("dvGuiaBtn").onclick = ()=>{ const s = driveStop(); if(s) startAssign([s.id]); };
// Al terminar de escanear la guía desde el modo conducción, se actualiza la pantalla.
$("dlgScan").addEventListener("close", ()=>renderDrive());
$("btnDrive").onclick = openDrive;
$("btnDriveTop").onclick = openDrive;
$("dvExit").onclick = ()=>closeDrive(false);
$("dvDone").onclick = ()=>{ const s = driveStop(); if(!s) return; if(navigator.vibrate) navigator.vibrate(60); toggleDone(s); renderDrive(); };
$("dvFail").onclick = ()=>{ const s = driveStop(); if(!s) return; confirmBox("No estaba", `¿Marcar ${s.label||s.addr} como no entregada? Pasa al final de los pendientes.`, ()=>{ toggleFail(s); renderDrive(); }); };
$("dvPrev").onclick = ()=>{ if(dvIdx>0){ dvIdx--; renderDrive(); } };
$("dvNextBtn").onclick = ()=>{ if(dvIdx < drivePend().length-1){ dvIdx++; renderDrive(); } };
addEventListener("popstate", ()=>{ if(!$("drive").hidden) closeDrive(true); });
document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="visible" && !$("drive").hidden){ keepAwake(true); renderDrive(); } });
// Si se cerró la app estando en modo conducción, vuelve a abrir en ese modo.
if(state.driveOn) setTimeout(openDrive, 0);
