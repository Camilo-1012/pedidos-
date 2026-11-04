/* Lector de etiquetas (OCR) y escáner de código de barras / QR. */
"use strict";
/* ============ OCR en el dispositivo ============ */
let workerP = null;
function getWorker(){
  if(workerP) return workerP;
  const base = new URL("ocr/", location.href).href;
  // El modelo de español (comprimido) viaja con la app; se pasa al lector ya descargado.
  workerP = fetch(base + "spa-traineddata.wasm").then(r=>{ if(!r.ok) throw new Error("modelo"); return r.arrayBuffer(); })
   .then(buf => Tesseract.createWorker([{code:"spa", data:new Uint8Array(buf)}], 1, {
    workerPath: base + "worker.min.js",
    corePath: base,
    logger: m => {
      if(m.status==="recognizing text"){ $("ocrMsg").textContent = "Leyendo texto…"; $("ocrBar").style.width = Math.round(m.progress*100)+"%"; }
      else if(/loading|initializ/.test(m.status)){ $("ocrMsg").textContent = "Preparando lector (solo la primera vez tarda)…"; $("ocrBar").style.width = Math.round((m.progress||0)*100)+"%"; }
    }
  })).catch(err=>{ workerP=null; throw err; });
  return workerP;
}
async function prepImage(file, opt){
  opt = opt || {};
  // Reduce tamaño y pasa a escala de grises con más contraste: mejora la lectura y la velocidad.
  const bmp = file instanceof ImageBitmap ? file : await createImageBitmap(file);
  // Las etiquetas necesitan letras de ~30 px: se amplían fotos pequeñas y se reducen las enormes.
  const target = 2400, sc = Math.min(3, target/Math.max(bmp.width,bmp.height));
  const rot = opt.rotate || 0, sw = Math.round(bmp.width*sc), sh = Math.round(bmp.height*sc);
  const c = document.createElement("canvas");
  c.width = rot % 180 ? sh : sw; c.height = rot % 180 ? sw : sh;
  const g = c.getContext("2d");
  // Desenfoque leve: borra las rayas (moiré) de las fotos tomadas a otra pantalla y el grano de fotos comprimidas.
  if(opt.blur) g.filter = "blur(" + opt.blur + "px)";
  if(rot){ g.translate(c.width/2, c.height/2); g.rotate(rot*Math.PI/180); g.drawImage(bmp, -sw/2, -sh/2, sw, sh); g.setTransform(1,0,0,1,0,0); }
  else g.drawImage(bmp,0,0,c.width,c.height);
  g.filter = "none";
  const im = g.getImageData(0,0,c.width,c.height), d = im.data;
  for(let i=0;i<d.length;i+=4){ let v = 0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]; v = Math.max(0,Math.min(255,(v-128)*1.5+128)); d[i]=d[i+1]=d[i+2]=v; }
  g.putImageData(im,0,0);
  return c;
}
// Lee el texto de una imagen (archivo o cuadro de la cámara) y extrae dirección, teléfono, zona y guía.
// Para fotos (galería, WhatsApp, captura de pantalla) se hacen varios intentos hasta encontrar la dirección:
// normal, texto disperso, con desenfoque (fotos de una pantalla) y girada (foto tomada de lado).
async function ocrSource(src, thorough){
  const bmp = src instanceof ImageBitmap ? src : await createImageBitmap(src);
  const w = await getWorker();
  const tries = [
    {psm:"3", msg:"Leyendo la etiqueta…"},
    {psm:"11", msg:"Segundo intento (texto disperso)…"},
    {psm:"6", blur:1.2, msg:"Tercer intento (quitando rayas y grano)…"}
  ];
  if(thorough) tries.push({psm:"3", rotate:90, msg:"Probando la foto girada…"}, {psm:"3", rotate:270, msg:"Probando la foto girada…"});
  let d = null;
  for(const t of tries){
    $("ocrMsg").textContent = t.msg;
    await w.setParameters({tessedit_pageseg_mode:t.psm});
    const { data } = await w.recognize(await prepImage(bmp, t));
    const di = extractLabel(data.text);
    if(!d) d = di;
    else for(const k of ["phone","name","zone","barrio","guia","type","unit"]) if(!d[k] && di[k]) d[k] = di[k];
    if(parseAddress(di.addr)){ d.addr = di.addr; if(!d.raw || !parseAddress(d.addr)) d.raw = di.raw; break; }
  }
  return d;
}
// Busca códigos (barras/QR) en una imagen fija y devuelve la mejor guía o una dirección si el código la trae.
async function codesFromImage(src){
  try{
    scanDet = scanDet || await makeDetector();
    if(!scanDet) return {};
    const bmp = src instanceof ImageBitmap ? src : await createImageBitmap(src);
    let codes = await detectCodes(bmp, true);
    if(!codes.some(c=>/^\d{8,}$/.test(String(c).trim()))){
      // Foto tomada de lado: el código de barras queda vertical y no se lee; se prueba girándola.
      const c = document.createElement("canvas"); c.width = bmp.height; c.height = bmp.width;
      const g = c.getContext("2d"); g.translate(c.width/2, c.height/2); g.rotate(Math.PI/2); g.drawImage(bmp, -bmp.width/2, -bmp.height/2);
      codes = codes.concat(await detectCodes(c, true));
    }
    let guia = "", addr = null;
    for(const c of codes){
      const raw = String(c), dd = extractLabel(raw.replace(/[|;]/g,"\n"));
      if(parseAddress(dd.addr)){ addr = dd; continue; }
      const g = guiaFromCode(raw);
      if(!g || g.length < 6 || !/\d{3,}/.test(g)) continue;
      if(!guia || codeScore(g) > codeScore(guia)) guia = g;
    }
    return {guia, addr};
  }catch(e){ return {}; }
}

/* ============ Escáner de código de barras / QR ============ */
// Con la cámara en vivo se lee el código de la guía (Chrome Android trae lector propio; si no, se usa ZXing).
// Del mismo cuadro se lee el texto de la etiqueta para sacar la dirección.
let scanStream = null, scanTimer = null, scanBusy = false, scanDet = null, fromScan = false, torchOn = false;
const ZX_FORMATS = () => [ZXing.BarcodeFormat.QR_CODE, ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.CODE_39, ZXing.BarcodeFormat.CODE_93,
  ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.ITF, ZXing.BarcodeFormat.DATA_MATRIX, ZXing.BarcodeFormat.PDF_417, ZXing.BarcodeFormat.CODABAR];
async function makeDetector(){
  if("BarcodeDetector" in window){
    try{
      const want = ["qr_code","code_128","code_39","code_93","ean_13","ean_8","itf","data_matrix","pdf417","codabar","upc_a"];
      const sup = (await BarcodeDetector.getSupportedFormats()).filter(f=>want.includes(f));
      if(sup.length) return {kind:"nativo", d:new BarcodeDetector({formats:sup})};
    }catch(e){}
  }
  if(window.ZXing){
    const r = new ZXing.MultiFormatReader(), h = new Map();
    h.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, ZX_FORMATS()); h.set(ZXing.DecodeHintType.TRY_HARDER, true);
    r.setHints(h);
    return {kind:"zxing", r, c:document.createElement("canvas")};
  }
  return null;
}
// Busca códigos en un cuadro de video o en una imagen. Con ZXing se prueban varias zonas en alta resolución,
// porque un código de barras pequeño dentro de la etiqueta completa no se lee si se reduce toda la imagen.
let zxTry = 0;
async function detectCodes(src, thorough){
  if(!scanDet) return [];
  const W = src.videoWidth || src.width, H = src.videoHeight || src.height;
  if(!W || !H) return [];
  if(scanDet.kind==="nativo"){
    try{ const res = await scanDet.d.detect(src); return res.map(x=>x.rawValue).filter(Boolean); }catch(e){ return []; }
  }
  const regions = [
    [0,0,W,H, Math.min(1,1280/W)],          // completa, reducida
    [0,H*0.35,W,H*0.45, Math.min(1,1920/W)], // franja central
    [0,H*0.5,W,H*0.5, Math.min(1,1920/W)],   // mitad de abajo
    [0,0,W,H*0.5, Math.min(1,1920/W)]        // mitad de arriba
  ];
  // En vivo se prueba una zona por vez (rotando) para no quitarle procesador a la lectura del texto.
  const list = thorough ? regions : [regions[zxTry++ % 4]];
  const c = scanDet.c, out = [];
  for(const [x,y,w,h,sc] of list){
    c.width = Math.round(w*sc); c.height = Math.round(h*sc);
    c.getContext("2d", {willReadFrequently:true}).drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
    try{
      const r = scanDet.r.decodeWithState(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.HTMLCanvasElementLuminanceSource(c))));
      if(r && r.getText() && !out.includes(r.getText())) out.push(r.getText());
    }catch(e){}
    // Se sigue con las demás zonas: la etiqueta puede tener un QR (enlace) y además el código de barras de la guía.
    if(out.some(t=>/^\d{8,}$/.test(t.trim()))) break;
  }
  return out;
}
// De varios códigos leídos (QR con enlace, código de barras numérico…) se elige el que mejor parece número de guía.
function codeScore(g){ return /^\d{8,}$/.test(g) ? 3 : /^[A-Za-z0-9-]{6,}$/.test(g) ? 2 : 1; }
function takeCodes(codes){
  for(const c of codes){
    const raw = String(c);
    const dd = extractLabel(raw.replace(/[|;]/g,"\n"));
    if(parseAddress(dd.addr)){ live.codeAddr = {...dd, raw:"Código: "+raw}; continue; }
    const g = guiaFromCode(raw);
    // Filtro contra lecturas falsas (texto o ruido confundido con código): una guía tiene 6+ caracteres y al menos 3 dígitos.
    if(!g || g.length < 6 || !/\d{3,}/.test(g.replace(/\D+/g, m=>m.length>2?"|":""))) continue;
    if(!live.codeGuia || codeScore(g) > codeScore(live.codeGuia)) live.codeGuia = g;
  }
}
function grabFrame(v){
  const c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext("2d").drawImage(v,0,0); return c;
}
// Lectura en vivo: mientras la cámara está abierta se busca el código de barras/QR (cada 0,25 s) y se lee el texto
// de la etiqueta (cada vez que el lector queda libre). Los datos se van acumulando entre cuadros; cuando la dirección
// se lee igual en dos cuadros (o una vez junto con el teléfono), se guarda sola.
let live = null, scanMode = "label";
function liveReset(){
  live = {mode: scanMode, codeGuia:"", ocrGuia:"", guia:"", codeAddr:null, hits:{}, best:null, phone:"", name:"", zone:"", barrio:"", type:"", unit:"", raw:"", t0:Date.now(), busy:false, done:false, frames:0};
  setStat("stCode", null, "Código: buscando…"); setStat("stAddr", null, "Dirección: buscando…"); setStat("stTel", null, "Teléfono: buscando…");
}
function setStat(id, ok, txt){ const el = $(id); el.textContent = txt; el.className = "chip" + (ok ? " ok" : ""); }
function stopScan(){
  clearInterval(scanTimer); scanTimer = null; torchOn = false;
  if(live) live.done = true;
  if(scanStream){ scanStream.getTracks().forEach(t=>t.stop()); scanStream = null; }
  const v = $("scanVideo"); v.srcObject = null;
  if($("dlgScan").open) $("dlgScan").close();
}
async function startScan(mode){
  scanMode = ["code","find","verify"].includes(mode) ? mode : "label";
  const codeOnly = scanMode !== "label";
  if(!SERVED || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    if(scanMode==="find" || scanMode==="verify"){ askGuiaTyped(); return; }
    if(scanMode==="code"){ toast("La cámara en vivo no está disponible aquí. Escribe la guía."); return; }
    toast("La cámara en vivo no está disponible aquí. Usa «Foto»."); $("photo").click(); return;
  }
  $("scanLoop").checked = !!state.scanLoop;
  $("scanTitle").textContent = {code:"Escanear código de la guía", find:"Buscar paquete", verify:"Verificar cargue", label:"Escanear etiqueta"}[scanMode];
  $("stAddr").hidden = $("stTel").hidden = $("scanShot").hidden = codeOnly;
  $("scanLoop").closest("label").hidden = codeOnly;
  $("scanFind").hidden = !(scanMode==="find" || scanMode==="verify"); $("scanFindIn").value = "";
  $("scanMsg").textContent = "Abriendo cámara…"; $("scanTorch").hidden = true;
  liveReset();
  $("dlgScan").showModal();
  try{
    scanStream = await navigator.mediaDevices.getUserMedia({audio:false, video:{facingMode:{ideal:"environment"}, width:{ideal:1920}, height:{ideal:1080}}});
  }catch(e){
    // Buscar o verificar: se puede seguir escribiendo la guía aunque la cámara no abra.
    if(scanMode==="find" || scanMode==="verify"){ scanStream = null; $("scanMsg").textContent = "No se pudo abrir la cámara (revisa el permiso de cámara). Escribe la guía o sus últimos 4 números."; $("scanFindIn").focus(); return; }
    $("dlgScan").close();
    toast("No se pudo abrir la cámara. Revisa que la app tenga permiso de cámara en los ajustes del celular.");
    return;
  }
  const v = $("scanVideo"); v.srcObject = scanStream;
  try{ await v.play(); }catch(e){}
  if(!scanStream) return;   // se cerró mientras abría (p. ej. ya encontró la guía)
  const track = scanStream.getVideoTracks()[0];
  const caps = track && track.getCapabilities ? track.getCapabilities() : {};
  $("scanTorch").hidden = !caps.torch;
  // Enfoque continuo si la cámara lo permite (mejora mucho la lectura de texto).
  if(caps.focusMode && caps.focusMode.includes("continuous")){ try{ await track.applyConstraints({advanced:[{focusMode:"continuous"}]}); }catch(e){} }
  scanDet = scanDet || await makeDetector();
  if(codeOnly){
    $("scanMsg").textContent = !scanDet ? "Este celular no puede leer códigos de barras. Escribe la guía a mano."
      : scanMode==="verify" ? verifyMsg() : "Apunta al código de barras o QR de la guía, de cerca y centrado.";
    if(!scanDet) return;
    scanTimer = setInterval(scanTick, 200);
    return;
  }
  $("scanMsg").textContent = "Apunta a la etiqueta de cerca, con buena luz y que se vea completa. Se guarda sola cuando lee la dirección; si tarda, toca «Capturar».";
  if(!scanDet) setStat("stCode", null, "Código: este celular no lee códigos");
  scanTimer = setInterval(scanTick, scanDet && scanDet.kind==="nativo" ? 250 : 400);
  getWorker().catch(()=>{});   // prepara el lector de texto mientras tanto
  liveLoop();
}
async function scanTick(){
  const v = $("scanVideo");
  // Se sigue buscando hasta tener un código numérico de guía (un QR con enlace no basta si también hay código de barras).
  if(scanBusy || !v.videoWidth || !scanStream || !scanDet || live.done || live.codeAddr || codeScore(live.codeGuia||"") >= 3) return;
  scanBusy = true;
  try{
    const before = live.codeGuia;
    takeCodes(await detectCodes(v));
    if(live.codeAddr) return finishScan();
    // Verificando: un código ya leído en esta pasada de cámara no se vuelve a anunciar.
    if(live.mode==="verify" && live.codeGuia && (live.seen||(live.seen=new Set())).has(live.codeGuia)){ live.codeGuia = ""; return; }
    if(live.codeGuia && live.codeGuia !== before){
      if(navigator.vibrate) navigator.vibrate(60);
      setStat("stCode", true, "Código: " + live.codeGuia);
      if(live.mode==="code") return finishCode();
      if(live.mode==="find"){ const g = live.codeGuia; live.done = true; stopScan(); return showFind(g); }
      if(live.mode==="verify"){ (live.seen||(live.seen=new Set())).add(live.codeGuia); verifyGuia(live.codeGuia); live.codeGuia = ""; return; }
      if(hasGuia(live.codeGuia)){ const g = live.codeGuia; stopScan(); dupAlert(g); return; }
    }
  }catch(e){ console.warn(e); }
  finally{ scanBusy = false; }
}
// Modo «solo código» (botón Código del formulario): pone la guía leída en el campo y vuelve al formulario.
function finishCode(){
  const g = live.codeGuia; live.done = true; stopScan();
  if(!g) return;
  const o = findGuia(g, editing && !editing.isNew ? editing.s : null);
  if(o && !guias({guia:$("fGuia").value}).includes(g)) toast(`Ojo: esa guía ya está en ${placeName(o)}.`);
  $("fGuia").value = g; toast("Guía leída: " + g);
}
// Recorte central del cuadro de video, ampliado y en grises: lo que necesita el lector de texto.
function liveCrop(v){
  const W = v.videoWidth, H = v.videoHeight, cw = Math.round(W*0.92), ch = Math.round(H*0.84);
  const sc = Math.min(2, 1700/cw), c = document.createElement("canvas");
  c.width = Math.round(cw*sc); c.height = Math.round(ch*sc);
  const g = c.getContext("2d", {willReadFrequently:true});
  g.drawImage(v, (W-cw)/2, (H-ch)/2, cw, ch, 0, 0, c.width, c.height);
  const im = g.getImageData(0,0,c.width,c.height), d = im.data;
  for(let i=0;i<d.length;i+=4){ let y = 0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]; y = Math.max(0,Math.min(255,(y-128)*1.6+128)); d[i]=d[i+1]=d[i+2]=y; }
  g.putImageData(im,0,0);
  return c;
}
function absorb(d){
  // Junta lo leído en cada cuadro: la dirección por mayoría y el resto con el primer dato que aparezca.
  for(const k of ["phone","name","zone","barrio","type","unit"]) if(!live[k] && d[k]) live[k] = d[k];
  if(d.guia && !live.ocrGuia) live.ocrGuia = d.guia;
  if(!live.raw && d.raw) live.raw = d.raw;
  const pa = parseAddress(d.addr);
  if(pa){ live.hits[pa.label] = (live.hits[pa.label]||0) + 1; if(!live.best || live.hits[pa.label] >= live.hits[live.best]) live.best = pa.label; }
}
async function liveLoop(){
  let w;
  try{ w = await getWorker(); }catch(e){ $("scanMsg").textContent = "El lector de texto no está disponible: usa el código o «Capturar»."; return; }
  while(live && !live.done && scanStream){
    const v = $("scanVideo");
    if(!v.videoWidth){ await new Promise(r=>setTimeout(r,200)); continue; }
    live.busy = true;
    try{
      await w.setParameters({tessedit_pageseg_mode:"6"});
      const { data } = await w.recognize(liveCrop(v));
      if(live.done) break;
      live.frames++;
      absorb(extractLabel(data.text));
      if(live.best) setStat("stAddr", true, "Dirección: " + live.best);
      if(live.phone) setStat("stTel", true, "Teléfono: " + live.phone.replace(/(\d{3})(\d{3})(\d{4})/,"$1 $2 $3"));
      if(!live.codeGuia && live.ocrGuia && !$("stCode").classList.contains("ok")) setStat("stCode", null, "Guía leída del texto: " + live.ocrGuia + " (buscando código…)");
      const hits = live.best ? live.hits[live.best] : 0;
      // Se acepta con 2 lecturas iguales de la dirección, o 1 si también salió el teléfono, o tras 3 cuadros más esperando el teléfono.
      if(hits >= 2 || (hits >= 1 && live.phone)){ live.busy = false; return finishScan(); }
      if(Date.now() - live.t0 > 20000 && !live.best) $("scanMsg").textContent = "No logro leer la dirección: acerca más la cámara, usa la linterna o toca «Capturar».";
    }catch(e){ console.warn("lectura en vivo", e); await new Promise(r=>setTimeout(r,400)); }
    live.busy = false;
  }
}
async function finishScan(extra){
  if(!live || live.done || live.finishing) return;
  live.finishing = true;
  // Dirección lista pero aún sin código de barras: se insiste hasta 2,5 s más (en alta resolución) antes de cerrar.
  if(scanDet && codeScore(live.codeGuia||"") < 3 && !live.codeAddr && scanStream){
    $("scanMsg").textContent = "Dirección lista. Buscando el código de barras un momento… mantén la cámara quieta.";
    const v = $("scanVideo"), t = Date.now();
    // Con el lector propio del celular (rápido) se insiste 2 s; con ZXing, 1,5 s y por zonas, para no demorar etiquetas sin código.
    const limit = scanDet.kind==="nativo" ? 2000 : 1500;
    while(Date.now() - t < limit && codeScore(live.codeGuia||"") < 3 && scanStream){
      if(!scanBusy){ scanBusy = true; try{ takeCodes(await detectCodes(v, scanDet.kind==="nativo")); }catch(e){} scanBusy = false; }
      await new Promise(r=>setTimeout(r,100));
    }
    setStat("stCode", !!live.codeGuia, live.codeGuia ? "Código: " + live.codeGuia : "Código: no se encontró");
  }
  live.done = true;
  live.guia = live.codeGuia || live.ocrGuia;
  if(navigator.vibrate) navigator.vibrate([60,40,60]);
  const d = live.codeAddr ? {...live.codeAddr} : {addr: live.best || "", raw: live.raw};
  for(const k of ["phone","name","zone","barrio","type","unit"]) if(!d[k] && live[k]) d[k] = live[k];
  if(extra) for(const k in extra) if(extra[k] && !d[k]) d[k] = extra[k];
  if(live.guia) d.guia = live.guia;
  stopScan();
  if(d.guia && hasGuia(d.guia)){ dupAlert(d.guia); return; }
  fromScan = true;
  openEdit(d, true);
  if(!parseAddress(d.addr)) toast("No pude leer bien la dirección. Corrígela a mano o dicta con «Dictar».");
}
// Convierte el contenido del código en número de guía (si es una URL de rastreo, se toma el código que trae).
function guiaFromCode(t){
  t = t.trim();
  if(/^https?:\/\//i.test(t)){
    try{
      const u = new URL(t);
      // Del enlace solo sirve un código con números (p. ej. …/rastreo/2637905208923531); palabras como «rastreo» no son guía.
      const cands = [...u.searchParams.values(), ...u.pathname.split("/")].map(x=>x.trim()).filter(x=>/^[A-Za-z0-9-]{6,}$/.test(x) && /\d{4,}/.test(x));
      return cands.length ? cands[cands.length-1] : "";
    }catch(e){ return t; }
  }
  return t.replace(/\s+/g,"");
}
// «Capturar»: foto de máxima resolución (si la cámara lo permite) y lectura completa en dos pasadas.
async function captureStill(){
  const v = $("scanVideo"); if(!v.videoWidth || !scanStream) return null;
  const track = scanStream.getVideoTracks()[0];
  if(window.ImageCapture && track){
    try{ const blob = await new ImageCapture(track).takePhoto(); if(blob && blob.size) return blob; }catch(e){}
  }
  return grabFrame(v);
}
$("btnScan").onclick = ()=>startScan("label");
$("btnScan2").onclick = ()=>startScan("label");
$("btnGuiaScan").onclick = ()=>startScan("code");
$("scanClose").onclick = ()=>{ stopScan(); };
$("dlgScan").addEventListener("cancel", ()=>stopScan());
$("scanLoop").addEventListener("change", e=>{ state.scanLoop = e.target.checked; save(); });
$("scanTorch").onclick = async ()=>{
  const t = scanStream && scanStream.getVideoTracks()[0]; if(!t) return;
  torchOn = !torchOn;
  try{ await t.applyConstraints({advanced:[{torch:torchOn}]}); $("scanTorch").textContent = torchOn ? "Apagar linterna" : "Linterna"; }catch(e){ torchOn = false; }
};
$("scanShot").onclick = async ()=>{
  if(!live || live.done) return;
  $("scanShot").disabled = true; $("scanMsg").textContent = "Tomando foto…";
  const still = await captureStill();
  live.done = true;
  // Espera a que el lector termine el cuadro en curso.
  for(let i=0;i<40 && live.busy;i++) await new Promise(r=>setTimeout(r,100));
  // Si aún no hay código, se busca también en la foto de alta resolución.
  if(scanDet && codeScore(live.codeGuia||"") < 3 && still){
    try{ const bmp = still instanceof Blob ? await createImageBitmap(still) : still; takeCodes(await detectCodes(bmp, true)); }catch(e){}
  }
  live.guia = live.codeGuia || live.ocrGuia;
  const keep = {...live}; stopScan(); $("scanShot").disabled = false;
  $("ocrBox").hidden = false; $("ocrBar").style.width = "0%"; $("ocrMsg").textContent = "Leyendo la etiqueta…";
  let d; try{ d = still ? await ocrSource(still) : {addr:"",raw:""}; }catch(e){ d = {addr:"", raw:""}; }
  $("ocrBox").hidden = true;
  // Si la foto no sacó la dirección pero la lectura en vivo sí, se usa la de en vivo.
  if(!parseAddress(d.addr) && keep.best) d.addr = keep.best;
  for(const k of ["phone","name","zone","barrio","type","unit"]) if(!d[k] && keep[k]) d[k] = keep[k];
  if(keep.guia) d.guia = keep.guia;
  if(d.guia && hasGuia(d.guia)){ dupAlert(d.guia); return; }
  fromScan = true; openEdit(d, true);
  if(!parseAddress(d.addr)) toast("No pude leer la dirección. Corrígela a mano o dicta con «Dictar».");
};

const SERVED = /^https?:$/.test(location.protocol);
if(!SERVED){
  $("net").hidden = false;
  $("net").textContent = "Abriste el archivo directamente. Para leer fotos y funcionar sin internet, la app debe abrirse desde su dirección https:// (ver LEEME.md).";
}
$("photo").addEventListener("change", async e=>{
  const f = e.target.files && e.target.files[0]; e.target.value = "";
  if(!f) return;
  if(!SERVED || typeof Tesseract==="undefined"){
    toast("La lectura de fotos no funciona abriendo el archivo directo. Abre la app desde su dirección https://.");
    return;
  }
  $("ocrBox").hidden = false; $("ocrBar").style.width="0%"; $("ocrMsg").textContent = "Preparando lector…";
  try{
    const bmp = await createImageBitmap(f);
    $("ocrMsg").textContent = "Buscando el código de barras…";
    const codes = await codesFromImage(bmp);
    const d = codes.addr ? {...codes.addr} : await ocrSource(bmp, true);
    if(codes.guia) d.guia = codes.guia;
    $("ocrBox").hidden = true;
    if(d.guia && hasGuia(d.guia)){ dupAlert(d.guia); return; }
    openEdit(d, true);
    if(!parseAddress(d.addr)) toast("No pude leer bien la dirección. Corrígela a mano.");
  }catch(err){
    console.error(err);
    $("ocrBox").hidden = true;
    toast("No se pudo leer la foto aquí. Usa «Pegar texto» con Google Lens o escribe la dirección.");
    openEdit({addr:"",raw:""}, true);
  }
});
