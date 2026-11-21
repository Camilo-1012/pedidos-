/* Escáner continuo: la cámara queda abierta y cada guía leída se procesa sin cerrar (recepción, despacho, devolución).
   Lee con el lector nativo del celular (BarcodeDetector) si existe; si no, con ZXing (scan/zxing.min.js, viaja con la app).
   Adaptado del escáner de Ruta de Entregas (pedidos-/js/06-escaner.js), sin la lectura de texto (OCR): aquí solo hace falta la guía. */
"use strict";
const SC = {
  stream:null, timer:null, busy:false, det:null, cfg:null, n:0, log:[], ultimo:new Map(), preguntando:null, zx:0
};
const REPETIR_MS = 2500;   // el mismo código visto de nuevo antes de 2,5 s es la misma etiqueta frente a la cámara
const SERVIDA = /^https?:$/.test(location.protocol);

async function crearDetector(){
  if("BarcodeDetector" in window){
    try{
      const want = ["code_128","code_39","code_93","qr_code","ean_13","itf","data_matrix","pdf417","codabar"];
      const sup = (await BarcodeDetector.getSupportedFormats()).filter(f => want.includes(f));
      if(sup.length) return {kind:"nativo", d:new BarcodeDetector({formats:sup})};
    }catch(e){}
  }
  if(window.ZXing){
    const r = new ZXing.MultiFormatReader(), h = new Map();
    h.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.CODE_39, ZXing.BarcodeFormat.CODE_93,
      ZXing.BarcodeFormat.QR_CODE, ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.ITF, ZXing.BarcodeFormat.DATA_MATRIX, ZXing.BarcodeFormat.PDF_417, ZXing.BarcodeFormat.CODABAR]);
    h.set(ZXing.DecodeHintType.TRY_HARDER, true); r.setHints(h);
    return {kind:"zxing", r, c:document.createElement("canvas")};
  }
  return null;
}
// ZXing: se prueba una zona por cuadro (rotando) en buena resolución; un código pequeño no se lee si se reduce todo el cuadro.
async function detectar(v){
  const W = v.videoWidth, H = v.videoHeight; if(!W || !H || !SC.det) return [];
  if(SC.det.kind === "nativo"){ try{ return (await SC.det.d.detect(v)).map(x => x.rawValue).filter(Boolean); }catch(e){ return []; } }
  const zonas = [[0, 0, W, H, Math.min(1, 1280/W)], [0, H*.3, W, H*.4, Math.min(1, 1920/W)], [0, H*.5, W, H*.5, Math.min(1, 1920/W)], [0, 0, W, H*.5, Math.min(1, 1920/W)]];
  const [x, y, w, h, sc] = zonas[SC.zx++ % zonas.length], c = SC.det.c;
  c.width = Math.round(w*sc); c.height = Math.round(h*sc);
  c.getContext("2d", {willReadFrequently:true}).drawImage(v, x, y, w, h, 0, 0, c.width, c.height);
  try{
    const r = SC.det.r.decodeWithState(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.HTMLCanvasElementLuminanceSource(c))));
    return r && r.getText() ? [r.getText()] : [];
  }catch(e){ return []; }
}

/* ---- Abrir / cerrar ----
   cfg = {titulo, objetivo(): texto, contador(): texto, alLeer(guia): Promise<{tipo:'ok'|'rep'|'mal', txt, evs:[ids]}>} */
async function abrirEscaner(cfg){
  SC.cfg = cfg; SC.n = 0; SC.log = []; SC.ultimo.clear(); SC.preguntando = null;
  $("scTitle").textContent = cfg.titulo; $("scAsk").hidden = true; $("scIn").value = "";
  pintarEscaner();
  $("dlgScan").showModal();
  if(!SERVIDA || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ $("scMsg").textContent = "La cámara no está disponible aquí: escribe las guías."; return; }
  $("scMsg").textContent = "Abriendo cámara…";
  try{
    SC.stream = await navigator.mediaDevices.getUserMedia({audio:false, video:{facingMode:{ideal:"environment"}, width:{ideal:1920}, height:{ideal:1080}}});
  }catch(e){ SC.stream = null; $("scMsg").textContent = "No se pudo abrir la cámara (revisa el permiso). Puedes escribir las guías."; return; }
  if(!$("dlgScan").open){ pararCamara(); return; }
  const v = $("scVideo"); v.srcObject = SC.stream; try{ await v.play(); }catch(e){}
  const track = SC.stream.getVideoTracks()[0], caps = track && track.getCapabilities ? track.getCapabilities() : {};
  $("scTorch").hidden = !caps.torch;
  if(caps.focusMode && caps.focusMode.includes("continuous")){ try{ await track.applyConstraints({advanced:[{focusMode:"continuous"}]}); }catch(e){} }
  SC.det = SC.det || await crearDetector();
  if(!SC.det){ $("scMsg").textContent = "Este celular no lee códigos de barras: escribe las guías."; return; }
  $("scMsg").textContent = "Apunta al código de barras de la guía. Lee una tras otra sin cerrar.";
  SC.timer = setInterval(tickEscaner, SC.det.kind === "nativo" ? 150 : 250);
}
function pararCamara(){
  clearInterval(SC.timer); SC.timer = null;
  if(SC.stream){ SC.stream.getTracks().forEach(t => t.stop()); SC.stream = null; }
  $("scVideo").srcObject = null;
}
function cerrarEscaner(){
  pararCamara();
  if(SC.preguntando){ SC.preguntando(false); SC.preguntando = null; }
  if($("dlgScan").open) $("dlgScan").close();
  const cb = SC.cfg && SC.cfg.alCerrar; SC.cfg = null;
  if(cb) cb();
}
async function tickEscaner(){
  const v = $("scVideo");
  if(SC.busy || SC.preguntando || !SC.stream || !v.videoWidth) return;
  SC.busy = true;
  try{
    for(const raw of await detectar(v)){
      const g = normGuia(raw); if(!g) continue;
      const t = SC.ultimo.get(g); SC.ultimo.set(g, Date.now());
      if(t && Date.now() - t < REPETIR_MS) continue;
      await procesarLectura(g);
      break;
    }
  }catch(e){ console.warn(e); }
  finally{ SC.busy = false; }
}
// Punto único de entrada de una guía (cámara, escrita o pruebas automáticas).
async function procesarLectura(texto){
  if(!SC.cfg) return null;
  const g = normGuia(texto);
  if(!g){ const r = {tipo:"mal", txt:"No parece una guía (6+ letras o números, con 4+ números)."}; pitar("mal"); anotar({guia: String(texto).slice(0, 30), ...r}); return r; }
  const r = await SC.cfg.alLeer(g) || {tipo:"mal", txt:"Sin respuesta"};
  pitar(r.tipo);
  if(r.tipo === "ok") SC.n++;
  anotar({guia: g, ...r});
  return r;
}
window.__leer = procesarLectura;   // lo usan las pruebas automáticas (simulan la lectura de la cámara)
function anotar(x){
  SC.log.unshift({...x, at: new Date().toISOString()}); SC.log.length = Math.min(SC.log.length, 40);
  pintarEscaner();
}
function pintarEscaner(){
  if(!SC.cfg) return;
  $("scTarget").textContent = SC.cfg.objetivo ? SC.cfg.objetivo() : "";
  $("scN").textContent = SC.n;
  $("scNLbl").textContent = SC.cfg.contador ? SC.cfg.contador() : "leídas en esta pasada";
  $("scLista").innerHTML = SC.log.map(x => `<li class="lec ${x.tipo} ${x.cls || ""}"><b>${esc(x.guia)}</b><span>${esc(x.txt || "")}</span><time>${horaDe(x.at)}</time></li>`).join("");
  const ult = SC.log.find(x => x.tipo === "ok" && x.evs && x.evs.length && !x.anulada);
  $("scUndo").disabled = $("scNov").disabled = !ult;
}
// Pregunta dentro del escáner (la cámara sigue abierta pero no procesa más lecturas hasta responder).
function preguntarEnEscaner(txt, si){
  if(!$("dlgScan").open) return confirmar("Revisar", txt, si);
  return new Promise(res => {
    $("scAskTxt").textContent = txt; $("scAskYes").textContent = si || "Sí"; $("scAsk").hidden = false;
    pitar("mal");
    SC.preguntando = v => { $("scAsk").hidden = true; SC.preguntando = null; res(v); };
    setTimeout(() => $("scAskYes").focus(), 30);
  });
}
$("scAskYes").onclick = () => SC.preguntando && SC.preguntando(true);
$("scAskNo").onclick = () => SC.preguntando && SC.preguntando(false);
$("scClose").onclick = cerrarEscaner;
$("dlgScan").addEventListener("cancel", e => { e.preventDefault(); cerrarEscaner(); });
$("frmScan").addEventListener("submit", e => e.preventDefault());
const usarEscrita = () => { const t = $("scIn").value; $("scIn").value = ""; if(t.trim()) procesarLectura(t); $("scIn").focus(); };
$("scInBtn").onclick = usarEscrita;
$("scIn").addEventListener("keydown", e => { if(e.key === "Enter"){ e.preventDefault(); usarEscrita(); } });
$("scUndo").onclick = () => {
  const x = SC.log.find(y => y.tipo === "ok" && y.evs && y.evs.length && !y.anulada); if(!x) return;
  x.evs.forEach(id => registrar("ANULAR", x.guia, {ref: id}));
  x.anulada = true; x.tipo = "rep"; x.txt = "Deshecha"; SC.n = Math.max(0, SC.n - 1);
  pintarEscaner(); toast("Se deshizo la lectura de " + x.guia + ".");
};
$("scNov").onclick = async () => {
  const x = SC.log.find(y => y.tipo === "ok" && !y.anulada); if(!x) return;
  pararPausa(true);
  const v = await pedir({title:"Novedad de " + x.guia, fields:[{id:"n", label:"Qué pasa", type:"select", options:["Caja dañada","Abierto o violado","Etiqueta ilegible","Mojado","Peso o tamaño distinto","Otra"]}, {id:"o", label:"Detalle (opcional)", type:"text", max:80}], yes:"Guardar"});
  pararPausa(false);
  if(!v) return;
  registrar("NOVEDAD", x.guia, {nota: v.n + (v.o.trim() ? ": " + v.o.trim() : "")});
  x.txt += " · Novedad: " + v.n; pintarEscaner();
};
// Mientras se responde un formulario encima del escáner, no se leen guías.
function pararPausa(on){ SC.preguntando = on ? (() => {}) : null; }
$("scTorch").onclick = async () => {
  const t = SC.stream && SC.stream.getVideoTracks()[0]; if(!t) return;
  SC.torch = !SC.torch; try{ await t.applyConstraints({advanced:[{torch:SC.torch}]}); }catch(e){ SC.torch = false; }
};
window.BODEGA_onLock = () => pararCamara();

// Escribir una guía sin abrir la cámara (mismo proceso que la lectura).
async function escribirGuia(cfg){
  const v = await pedir({title: cfg.titulo, msg: cfg.objetivo ? cfg.objetivo() : "", fields:[{id:"g", label:"Número de guía", type:"text", max:40}], yes:"Guardar",
    check: v => normGuia(v.g) ? "" : "Revisa la guía: 6+ letras o números, con al menos 4 números."});
  if(!v) return;
  const r = await cfg.alLeer(normGuia(v.g));
  if(r){ pitar(r.tipo); toast(normGuia(v.g) + ": " + r.txt); }
}
