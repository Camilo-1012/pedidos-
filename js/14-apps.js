/* Abrir las apps de entrega (Xcargo, iMile) desde el modo conducción. */
"use strict";
/* ============ Apps de entrega ============ */
// Android abre una app instalada con un enlace «intent:» que lleva el nombre del paquete (com.empresa.app).
// El paquete se toma del enlace de Play Store que el repartidor pega una vez (…details?id=PAQUETE), así no depende
// de nombres adivinados. Si la app no está instalada, Android abre su página de Play Store.
const APPS_EXT = {xcargo: "Xcargo", imile: "iMile"};
const PKG_RE = /^[a-zA-Z][\w]*(\.[a-zA-Z0-9_]+)+$/;
function paqueteDe(texto){
  const t = String(texto||"").trim();
  if(!t) return "";
  const m = /[?&]id=([a-zA-Z][\w.]+)/.exec(t);
  if(m && PKG_RE.test(m[1])) return m[1];
  return PKG_RE.test(t) ? t : null;   // null = no se entendió
}
const appsExt = ()=>state.appsExt || (state.appsExt = {});
const esAndroid = ()=>/Android/i.test(navigator.userAgent);
function intentDe(pkg){
  const tienda = "https://play.google.com/store/apps/details?id=" + pkg;
  return `intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=${pkg};S.browser_fallback_url=${encodeURIComponent(tienda)};end`;
}
async function abrirApp(id){
  const pkg = appsExt()[id];
  if(!pkg){ toast(`Primero dile a la app cuál es ${APPS_EXT[id]} (una sola vez).`); configurarApps(id); return; }
  if(!esAndroid()){ toast(`Abrir ${APPS_EXT[id]} desde aquí solo funciona en Android.`); return; }
  // Copia la guía de la parada que se está viendo, para pegarla en el buscador de la otra app.
  const s = typeof drivePend === "function" && state.driveOn ? drivePend()[dvIdx] : null;
  const g = s ? guias(s)[0] : "";
  if(g){ try{ await navigator.clipboard.writeText(g); toast(`Guía ${g} copiada. Pégala en ${APPS_EXT[id]}.`); }catch(e){} }
  const a = document.createElement("a"); a.href = intentDe(pkg); a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
}
function pintarApps(){
  for(const [id, campo] of [["xcargo", "apXcargo"], ["imile", "apImile"]]){
    const pkg = appsExt()[id] || "";
    const el = document.getElementById(campo), ok = document.getElementById(campo + "Ok");
    if(document.activeElement !== el) el.value = pkg;
    ok.textContent = pkg ? `✓ Lista (${pkg}).` : "Sin configurar.";
    ok.style.color = pkg ? "" : "var(--warn)";
    const b = document.getElementById(id === "xcargo" ? "dvXcargo" : "dvImile");
    if(b) b.classList.toggle("off", !pkg);
  }
}
function configurarApps(foco){
  pintarApps();
  document.getElementById("dlgApps").showModal();
  if(foco) setTimeout(()=>document.getElementById(foco === "xcargo" ? "apXcargo" : "apImile").focus(), 60);
}
for(const [id, campo] of [["xcargo", "apXcargo"], ["imile", "apImile"]]){
  document.getElementById(campo).addEventListener("change", e=>{
    const p = paqueteDe(e.target.value);
    const ok = document.getElementById(campo + "Ok");
    if(p === null){ ok.textContent = "No entendí ese enlace. Cópialo desde Play Store: ⋮ → Compartir → Copiar."; ok.style.color = "var(--warn)"; return; }
    if(p) appsExt()[id] = p; else delete appsExt()[id];
    save(); pintarApps();
    if(p) toast(`${APPS_EXT[id]} lista. Ya la puedes abrir desde el modo conducción.`);
  });
}
document.getElementById("dvXcargo").onclick = ()=>abrirApp("xcargo");
document.getElementById("dvImile").onclick = ()=>abrirApp("imile");
document.getElementById("dvAppsCfg").onclick = ()=>configurarApps();
document.getElementById("btnAppsCfg").onclick = ()=>configurarApps();
pintarApps();
