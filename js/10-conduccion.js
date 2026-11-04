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
  state.driveOn = true; save();
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
  const list = drivePend();
  if(dvIdx >= list.length) dvIdx = Math.max(0, list.length-1);
  const s = list[dvIdx];
  const off = !s;
  for(const id of ["dvFail","dvDone","dvPrev","dvNextBtn"]) $(id).disabled = off;
  if(off){
    $("dvPos").textContent = "Sin pendientes";
    $("dvQty").textContent = ""; $("dvAddr").textContent = "¡Terminaste!"; $("dvUnit").textContent = "No quedan entregas pendientes.";
    $("dvGuia").textContent = $("dvWho").textContent = $("dvNext").textContent = "";
    $("dvWaze").setAttribute("aria-disabled","true"); $("dvCall").setAttribute("aria-disabled","true");
    $("dvPace").textContent = paceText();
    return;
  }
  const n = stopNum(s), total = list.length;
  $("dvPos").textContent = `Parada ${n} · quedan ${total}`;
  $("dvQty").textContent = [(s.qty||1)>1 ? `×${s.qty} paquetes` : "", s.status==="fail" ? "Ya tuvo un intento fallido" : "", s.zone ? "ST " + s.zone : ""].filter(Boolean).join(" · ");
  $("dvAddr").textContent = s.label || s.addr;
  $("dvUnit").textContent = [unitText(s), s.barrio].filter(Boolean).join(" · ");
  $("dvGuia").textContent = guias(s).join("  ");
  $("dvWho").textContent = [s.name, s.phone && s.phone.replace(/(\d{3})(\d{3})(\d{4})/,"$1 $2 $3"), s.notes].filter(Boolean).join(" · ");
  const nx = list[dvIdx+1];
  $("dvNext").textContent = nx ? "Después: " + (nx.label || nx.addr) : "Es la última parada.";
  $("dvWaze").href = wazeUrl(s); $("dvWaze").removeAttribute("aria-disabled");
  if(s.phone){ $("dvCall").href = "tel:" + cleanPhone(s.phone); $("dvCall").removeAttribute("aria-disabled"); }
  else { $("dvCall").removeAttribute("href"); $("dvCall").setAttribute("aria-disabled","true"); }
  $("dvPrev").disabled = dvIdx === 0; $("dvNextBtn").disabled = dvIdx >= total-1;
  $("dvPace").textContent = paceText();
}
const driveStop = ()=>drivePend()[dvIdx];
$("btnDrive").onclick = openDrive;
$("dvExit").onclick = ()=>closeDrive(false);
$("dvDone").onclick = ()=>{ const s = driveStop(); if(!s) return; if(navigator.vibrate) navigator.vibrate(60); toggleDone(s); renderDrive(); };
$("dvFail").onclick = ()=>{ const s = driveStop(); if(!s) return; confirmBox("No estaba", `¿Marcar ${s.label||s.addr} como no entregada? Pasa al final de los pendientes.`, ()=>{ toggleFail(s); renderDrive(); }); };
$("dvPrev").onclick = ()=>{ if(dvIdx>0){ dvIdx--; renderDrive(); } };
$("dvNextBtn").onclick = ()=>{ if(dvIdx < drivePend().length-1){ dvIdx++; renderDrive(); } };
addEventListener("popstate", ()=>{ if(!$("drive").hidden) closeDrive(true); });
document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="visible" && !$("drive").hidden){ keepAwake(true); renderDrive(); } });
// Si se cerró la app estando en modo conducción, vuelve a abrir en ese modo.
if(state.driveOn) setTimeout(openDrive, 0);
