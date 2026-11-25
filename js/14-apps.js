/* Abrir las apps de entrega (Xcargo, iMile) desde el modo conducción. */
"use strict";
/* ============ Apps de entrega ============ */
// Android abre una app instalada con un enlace «intent:» que lleva el nombre del paquete (com.empresa.app).
// El paquete se toma del enlace de Play Store que el repartidor pega una vez (…details?id=PAQUETE), así no depende
// de nombres adivinados. Si la app no está instalada, Android abre su página de Play Store.
const APPS_EXT = {xcargo: "Xcargo", imile: "iMile"};
// Paquetes conocidos en Play Store (nov. 2026): X-cargo para conductores (BIG SMART, Colombia) e Imile Delivery para
// conductores (la versión Android de «iMile Driver»). Si en el celular la app es otra, se cambia pegando su enlace.
// v2.50: iMile se abre directo en su pantalla de inicio (paquete/actividad): la app «Rider Delivery» de iMile se instala
// por APK (no está en Play Store) y en algunos celulares la búsqueda general por paquete no la encontraba.
const APPS_PREDET = {xcargo: "com.bigsmart.xcargo", imile: "com.imile.redelivery/com.imile.redelivery.MainActivity"};
const PKG_RE = /^[a-zA-Z][\w]*(\.[a-zA-Z0-9_]+)+$/;
// Acepta: enlace de Play Store, nombre de paquete (com.empresa.app) o paquete + pantalla de inicio para apps
// instaladas por APK: «com.empresa.app/com.empresa.app.MainActivity», «com.empresa.app/.MainActivity» o las dos
// líneas que muestra una app como Package Name Viewer (paquete y actividad). Devuelve "paquete" o "paquete/actividad".
function paqueteDe(texto){
  const t = String(texto||"").trim();
  if(!t) return "";
  const m = /[?&]id=([a-zA-Z][\w.]+)/.exec(t);
  if(m && PKG_RE.test(m[1])) return m[1];
  const partes = t.split(/[\s\/]+/).filter(x=>x && (PKG_RE.test(x) || /^\.[A-Za-z][\w.]*$/.test(x)));
  if(partes.length >= 2 && PKG_RE.test(partes[0])){
    const pkg = partes[0], act = partes.find((x, i)=>i > 0 && (x.startsWith(".") || x.startsWith(pkg + ".")));
    if(act) return pkg + "/" + (act.startsWith(".") ? pkg + act : act);
  }
  return PKG_RE.test(t) ? t : null;   // null = no se entendió
}
const pkgDe = v=>String(v||"").split("/")[0];
const appsExt = ()=>state.appsExt || (state.appsExt = {});
const paqueteApp = id=>appsExt()[id] || APPS_PREDET[id] || "";
const esAndroid = ()=>/Android/i.test(navigator.userAgent);
// Con actividad (app por APK): se abre esa pantalla directamente y, si no está instalada, se vuelve a la Ruta con un
// aviso (no a Play Store, donde no existe). Solo paquete: búsqueda general y, si falta, su página de Play Store.
function intentDe(val, id){
  const [pkg, act] = String(val).split("/");
  const respaldo = act ? location.origin + location.pathname + "#app-no-encontrada=" + (id || "")
    : "https://play.google.com/store/apps/details?id=" + pkg;
  return `intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=${pkg};${act ? `component=${pkg}/${act};` : ""}S.browser_fallback_url=${encodeURIComponent(respaldo)};end`;
}
// Volvió del respaldo: la app no está instalada en este celular (o está en un segundo espacio / perfil de trabajo).
if(/^#app-no-encontrada=/.test(location.hash)){
  const id = location.hash.split("=")[1];
  try{ history.replaceState(null, "", location.pathname + location.search); }catch(e){}
  setTimeout(()=>toast(`No encontré ${APPS_EXT[id] || "la app"} en este celular. Si la instalaste en «Segundo espacio» o «App doble», instálala en el espacio normal; si es otra versión, cambia el paquete en ⚙.`), 800);
}
async function abrirApp(id){
  const pkg = paqueteApp(id);
  if(!pkg){ toast(`Primero dile a la app cuál es ${APPS_EXT[id]} (una sola vez).`); configurarApps(id); return; }
  if(!esAndroid()){ toast(`Abrir ${APPS_EXT[id]} desde aquí solo funciona en Android.`); return; }
  // Copia la guía de la parada que se está viendo, para pegarla en el buscador de la otra app.
  const s = typeof drivePend === "function" && state.driveOn ? drivePend()[dvIdx] : null;
  const g = s ? guias(s)[0] : "";
  if(g){ try{ await navigator.clipboard.writeText(g); toast(`Guía ${g} copiada. Pégala en ${APPS_EXT[id]}.`); }catch(e){} }
  const a = document.createElement("a"); a.href = intentDe(pkg, id); a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
}
function pintarApps(){
  for(const [id, campo] of [["xcargo", "apXcargo"], ["imile", "apImile"]]){
    const propio = appsExt()[id] || "", pkg = paqueteApp(id);
    const el = document.getElementById(campo), ok = document.getElementById(campo + "Ok");
    if(document.activeElement !== el) el.value = propio;
    el.placeholder = APPS_PREDET[id] ? `Predeterminado: ${pkgDe(APPS_PREDET[id])}` : "Enlace de Play Store o paquete";
    ok.textContent = propio ? `✓ Lista (${pkgDe(propio)}).` : pkg ? `✓ Predeterminada (${pkgDe(pkg)}). Si el botón no abre tu app, pega aquí el enlace de Play Store o el nombre del paquete.` : "Sin configurar.";
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
    if(p === null){ ok.textContent = "No entendí ese enlace. Cópialo desde Play Store (⋮ → Compartir → Copiar) o escribe el paquete (com.empresa.app)."; ok.style.color = "var(--warn)"; return; }
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
