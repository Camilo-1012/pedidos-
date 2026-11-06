/* Dictado de direcciones por voz. */
"use strict";
/* ============ Dictado por voz ============ */
// Usa el reconocimiento de voz del navegador (en Chrome Android lo procesa Google: necesita internet).
// Convierte lo dictado al formato de dirección: "calle ciento cuarenta y tres número ciento cincuenta y uno be guion veintitrés" → "calle 143 # 151 B - 23".
const NUM_UNI = {cero:0,un:1,uno:1,una:1,dos:2,tres:3,cuatro:4,cinco:5,seis:6,siete:7,ocho:8,nueve:9,diez:10,once:11,doce:12,trece:13,catorce:14,quince:15,
  dieciseis:16,diecisiete:17,dieciocho:18,diecinueve:19,veinte:20,veintiun:21,veintiuno:21,veintidos:22,veintitres:23,veinticuatro:24,veinticinco:25,
  veintiseis:26,veintisiete:27,veintiocho:28,veintinueve:29};
const NUM_DEC = {treinta:30,cuarenta:40,cincuenta:50,sesenta:60,setenta:70,ochenta:80,noventa:90};
const NUM_CEN = {cien:100,ciento:100,doscientos:200,doscientas:200,trescientos:300,cuatrocientos:400,quinientos:500,seiscientos:600,setecientos:700,ochocientos:800,novecientos:900};
// «Bis» dictado suele llegar mal escrito por el reconocimiento: «Avis», «vis», «biz»… Solo se corrige justo después
// de un número o de su letra («141 Avis B» → «141 Bis B»).
const BIS_OIDO = new Set(["bis","vis","avis","abis","biss","bisz","biz","bix","vix","beis","bies","viz","visa"]);
const SPOKEN_LETTER = {a:"A",be:"B",b:"B",ce:"C",c:"C",de:"D",d:"D",e:"E",efe:"F",f:"F",ge:"G",g:"G",hache:"H",h:"H"};
function spokenToAddress(text){
  const toks = (text||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/(\d)([a-h])\b/g,"$1 $2").replace(/[#]/g," # ").replace(/[-–—]/g," - ").replace(/[,.;:]/g," ")
    .split(/\s+/).filter(Boolean);
  const out = []; let cur = null, last = "";
  const flush = ()=>{ if(cur!==null){ out.push(String(cur)); cur = null; last = ""; } };
  for(let i=0;i<toks.length;i++){
    const t = toks[i];
    if(/^\d+$/.test(t)){ flush(); out.push(t); continue; }
    if(t in NUM_CEN){ if(cur!==null && last!=="") flush(); cur = (cur||0) + NUM_CEN[t]; last = "cen"; continue; }
    if(t in NUM_DEC){ if(cur!==null && (last==="dec"||last==="uni")) flush(); cur = (cur||0) + NUM_DEC[t]; last = "dec"; continue; }
    if(t in NUM_UNI){ if(cur!==null && (last==="uni" || (last==="dec" && toks[i-1]!=="y") || (last==="cen" && cur%100!==0))) flush(); cur = (cur||0) + NUM_UNI[t]; last = "uni"; continue; }
    if(t==="y" && cur!==null && last==="dec" && (toks[i+1] in NUM_UNI)) continue;
    flush();
    if(["numero","numeral","no","nro","n","con","#"].includes(t)){ out.push("#"); continue; }
    if(["guion","raya","menos","-"].includes(t)){ out.push("-"); continue; }
    if(t==="letra" && SPOKEN_LETTER[toks[i+1]]){ out.push(SPOKEN_LETTER[toks[++i]]); continue; }
    if(BIS_OIDO.has(t) && out.length && (/^\d+$/.test(out[out.length-1]) || (/^([a-h]|be|ce|de|ge)$/.test(out[out.length-1]) && /^\d+$/.test(out[out.length-2]||"")))){ out.push("bis"); continue; }
    out.push(t);
  }
  flush();
  // Letras habladas ("be", "a") solo cuentan como letra si van justo después de un número (o de «número bis»: «141 bis be»).
  for(let i=1;i<out.length;i++){
    const L = SPOKEN_LETTER[out[i]];
    const nxt = out[i+1];
    const trasNumero = /^\d+$/.test(out[i-1]) || (out[i-1]==="bis" && /^\d+$/.test(out[i-2]||""));
    if(L && trasNumero && (nxt===undefined || /^\d+$/.test(nxt) || ["#","-","bis","sur","este"].includes(nxt))) out[i] = L;
  }
  // "guion cero ocho" → "-08"
  return repararPlaca(out.join(" ").replace(/- 0 (\d)\b/g,"- 0$1").replace(/\s+/g," ").trim());
}
/* El reconocimiento de voz de Google suele omitir «número» y «guion» y juntar las cifras:
   «carrera 150 B 14345» en vez de «carrera 150 B # 143 - 45». Si así no se entiende como dirección,
   se separa ese número en calle/carrera + placa: la placa son los 2 últimos dígitos (o 3, o 1, si con 2
   la calle o carrera quedaría mayor que 250). Solo se usa el arreglo si el resultado sí es una dirección. */
const PLACA_MAX_VIA = 250;
function repararPlaca(conv){
  if(!conv || parseAddress(conv)) return conv;
  const t = conv.split(" ");
  const i1 = t.findIndex(x=>/^\d+$/.test(x));          // número de la vía principal
  if(i1 < 1) return conv;
  let j = i1 + 1;
  while(j < t.length && (/^[a-h]$/i.test(t[j]) || /^(bis|sur|este)$/i.test(t[j]))) j++;
  const conNum = t[j] === "#";
  if(conNum) j++;
  const d = t[j];
  if(!d || !/^\d{3,6}$/.test(d) || t[j+1] === "-") return conv;
  for(const largo of [2, 3, 1]){
    const cruce = d.slice(0, -largo), placa = d.slice(-largo);
    if(!cruce || cruce[0] === "0" || +cruce > PLACA_MAX_VIA) continue;
    const arreglo = [...t.slice(0, conNum ? j-1 : j), "#", cruce, "-", placa, ...t.slice(j+1)].join(" ");
    if(parseAddress(arreglo)) return arreglo;
  }
  return conv;
}
/* Teléfono dictado (opcional): «…teléfono 311 222 3344» (también celular, cel, tel, WhatsApp, contacto).
   Sin la palabra, se toma como teléfono un número del final que forme un celular (3 + 9 dígitos) o un fijo (601…),
   siempre que lo anterior siga siendo una dirección válida. Devuelve la dirección ya convertida y el teléfono. */
function telDeDigitos(d){
  d = String(d||"").replace(/\D/g,"");
  if(d.length===12 && d.startsWith("57")) d = d.slice(2);
  return /^3\d{9}$/.test(d) || /^60\d{8}$/.test(d) ? d : "";
}
function splitPhone(text){
  const t = String(text||"");
  const m = t.match(/\b(tel[eé]fono|tel|celular|cel|whatsapp|contacto)\b/i);
  if(m){
    const digits = spokenToAddress(t.slice(m.index + m[0].length)).replace(/\D/g,"");
    const tel = telDeDigitos(digits);
    return {addrConv: spokenToAddress(t.slice(0, m.index)), tel, telMal: !tel && digits.length > 0 ? digits : ""};
  }
  const conv = spokenToAddress(t), toks = conv.split(" ");
  // Del final hacia atrás: el grupo de números más corto que forme un teléfono válido.
  for(let k = toks.length-1; k > 0 && /^\d+$/.test(toks[k]); k--){
    const acc = toks.slice(k).join("");
    if(acc.length > 12) break;
    const tel = telDeDigitos(acc), antes = toks.slice(0,k).join(" ");
    if(tel && parseAddress(antes)) return {addrConv: antes, tel, telMal: ""};
  }
  return {addrConv: conv, tel: "", telMal: ""};
}
/* Vía elegida con botón (Calle, Carrera, Diagonal, Transversal): así no hay que decirla en cada dirección.
   Si en lo dictado sí se dice una vía («calle…», «avenida…»), manda lo dicho. «Dicha» = sin vía elegida. */
const VIA_DICHA_RE = /^\s*(calle|cll?|carrera|carerra|cra|kra|kr|k|diagonal|diag|dg|transversal|transv|tv|avenida|av|ac|ak|autopista)\b/i;
function viaElegida(){ return state.viaDictado || ""; }
function conViaElegida(t){
  const v = viaElegida(), x = String(t||"").trim();
  if(!v || !x || VIA_DICHA_RE.test(x.normalize("NFD").replace(/[\u0300-\u036f]/g,""))) return x;
  return v + " " + x;
}
function pintarVia(){
  for(const nm of ["viaB", "viaS"]) for(const r of document.querySelectorAll(`input[name=${nm}]`)) r.checked = r.value === viaElegida();
}
for(const r of document.querySelectorAll("input[name=viaB], input[name=viaS]")){
  r.addEventListener("change", ()=>{ if(!r.checked) return; state.viaDictado = r.value; save(); pintarVia();
    toast(r.value ? `Dicta sin decir «${r.value.toLowerCase()}»: solo el número y el resto de la dirección.` : "Di la vía en cada dirección (calle, carrera…)."); });
}
pintarVia();
let rec = null, recOn = false;
function micUI(on, msg){
  recOn = on;
  $("micAddr").classList.toggle("on", on);
  $("micAddr").textContent = on ? "Parar" : "Dictar";
  $("micMsg").hidden = !msg; $("micMsg").textContent = msg || "";
}
function startDictation(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){ micUI(false, "Este navegador no permite dictar aquí. Usa el micrófono del teclado del celular."); $("fAddr").focus(); return; }
  if(!navigator.onLine){ micUI(false, "El dictado necesita internet. Usa el micrófono del teclado o escribe la dirección."); return; }
  if(recOn){ try{ rec.stop(); }catch(e){} return; }
  rec = new SR();
  rec.lang = "es-CO"; rec.interimResults = true; rec.maxAlternatives = 3; rec.continuous = false;
  let finalTxt = "";
  rec.onstart = ()=>micUI(true, viaElegida()
    ? `Escuchando… vía: ${viaElegida()}. Di solo el resto, por ejemplo: «ciento cuarenta y tres número ciento cincuenta y uno be guion veintitrés». Si quieres, al final di «teléfono» y el número.`
    : "Escuchando… di la dirección, por ejemplo: «calle ciento cuarenta y tres número ciento cincuenta y uno be guion veintitrés». Si quieres, al final di «teléfono» y el número.");
  rec.onresult = ev=>{
    let interim = "";
    for(let i=ev.resultIndex;i<ev.results.length;i++){
      const r = ev.results[i];
      if(r.isFinal){
        // De las alternativas, se prefiere la que se entiende como dirección válida.
        let best = r[0].transcript;
        for(let k=0;k<r.length;k++){ if(parseAddress(spokenToAddress(conViaElegida(r[k].transcript)))){ best = r[k].transcript; break; } }
        finalTxt += " " + best;
      } else interim += r[0].transcript;
    }
    const sp = splitPhone(conViaElegida((finalTxt + " " + interim).trim()));
    const conv = sp.addrConv;
    const pa = parseAddress(conv);
    if(sp.tel){ $("fPhone").value = sp.tel; if(typeof updPhone === "function") updPhone(); }
    // La dirección va al campo Dirección; lo que se dijo después (apto, torre…) va a Notas.
    $("fAddr").value = pa ? pa.label : conv;
    const tail = pa ? rest(conv).trim() : "";
    if(tail){
      const u = detectUnit(tail);
      if(u){ setType(u.type); $("fUnit").value = u.detail || $("fUnit").value; }
      else $("fNotes").value = tail.charAt(0).toUpperCase() + tail.slice(1);
    }
    updParsed();
  };
  rec.onerror = ev=>{
    const m = {"not-allowed":"No hay permiso de micrófono. Actívalo en los ajustes del celular para esta app.",
      "no-speech":"No se escuchó nada. Toca «Dictar» e intenta de nuevo.", "network":"El dictado necesita internet.",
      "audio-capture":"No se encontró micrófono."}[ev.error] || ("No se pudo dictar ("+ev.error+").");
    micUI(false, m);
  };
  rec.onend = ()=>{
    const ok = !!parseAddress($("fAddr").value);
    micUI(false, ok ? "" : ($("fAddr").value ? "No entendí la dirección completa. Corrígela o dicta de nuevo." : $("micMsg").textContent));
    if(ok && navigator.vibrate) navigator.vibrate(40);
  };
  try{ rec.start(); }catch(e){ micUI(false, "No se pudo iniciar el dictado."); }
}
// Lo que se dice después de la placa (apto, torre, barrio) se conserva al final.
function rest(conv){
  const n = norm(conv), m = n.match(ADDR_RE);
  if(!m) return "";
  const tail = conv.slice(Math.min(conv.length, m.index + m[0].length)).trim();
  return tail ? " " + tail : "";
}
$("micAddr").onclick = startDictation;

// Dictado de varias direcciones seguidas: cada frase (o cada «siguiente») queda en una línea.
let recBulk = null, bulkOn = false, bulkOk = 0, bulkBad = 0, bulkTel = 0, bulkTelMal = 0;
function bulkUI(on, msg){
  bulkOn = on;
  $("micBulk").classList.toggle("on", on);
  $("micBulk").textContent = on ? "Parar dictado" : "Dictar direcciones";
  $("micBulkMsg").hidden = !msg; $("micBulkMsg").textContent = msg || "";
}
function addDictatedLines(text){
  const parts = text.split(/\b(?:siguiente|otra direcci[oó]n|nueva l[ií]nea|punto y aparte)\b/i).map(x=>x.trim()).filter(Boolean);
  for(const raw of parts){
    const part = conViaElegida(raw);
    const sp = splitPhone(part), conv = sp.addrConv;
    const pa = parseAddress(conv);
    // Lo no entendido queda tal cual se dijo, para corregirlo. El teléfono va al final como «Tel 3112223344».
    const line = (pa ? (pa.label + rest(conv)) : "REVISAR: " + part) + (sp.tel ? " Tel " + sp.tel : sp.telMal ? " (revisar teléfono " + sp.telMal + ")" : "");
    if(pa) bulkOk++; else bulkBad++;
    if(sp.tel) bulkTel++; else if(sp.telMal) bulkTelMal++;
    const ta = $("txtArea");
    ta.value = (ta.value.trim() ? ta.value.replace(/\s+$/,"") + "\n" : "") + line;
    ta.scrollTop = ta.scrollHeight;
  }
  bulkUI(true, `Escuchando… ${bulkOk} dirección(es) entendida(s)${bulkTel?`, ${bulkTel} con teléfono`:""}${bulkBad?`, ${bulkBad} por revisar`:""}${bulkTelMal?`, ${bulkTelMal} teléfono(s) por revisar`:""}. Di la siguiente o toca «Parar dictado».`);
}
function startBulkDictation(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){ bulkUI(false, "Este navegador no permite dictar aquí. Usa el micrófono del teclado (una dirección por línea)."); $("txtArea").focus(); return; }
  if(!navigator.onLine){ bulkUI(false, "El dictado necesita internet."); return; }
  if(bulkOn){ bulkOn = false; try{ recBulk.stop(); }catch(e){} return; }
  bulkOk = 0; bulkBad = 0; bulkTel = 0; bulkTelMal = 0;
  recBulk = new SR();
  recBulk.lang = "es-CO"; recBulk.interimResults = false; recBulk.continuous = true; recBulk.maxAlternatives = 3;
  recBulk.onresult = ev=>{
    for(let i=ev.resultIndex;i<ev.results.length;i++){
      const r = ev.results[i]; if(!r.isFinal) continue;
      let best = r[0].transcript;
      for(let k=0;k<r.length;k++){ if(parseAddress(spokenToAddress(conViaElegida(r[k].transcript)))){ best = r[k].transcript; break; } }
      addDictatedLines(best);
    }
  };
  recBulk.onerror = ev=>{
    if(ev.error==="no-speech" || ev.error==="aborted") return;   // pausas largas: se sigue escuchando
    const m = {"not-allowed":"No hay permiso de micrófono. Actívalo en los ajustes del celular.","network":"El dictado necesita internet.","audio-capture":"No se encontró micrófono."}[ev.error] || ("No se pudo dictar ("+ev.error+").");
    bulkOn = false; bulkUI(false, m);
  };
  // Chrome corta el dictado tras un silencio: si no se ha pedido parar, se reinicia solo.
  recBulk.onend = ()=>{
    if(bulkOn && $("dlgText").open){ try{ recBulk.start(); return; }catch(e){} }
    bulkUI(false, bulkOk||bulkBad ? `Listo: ${bulkOk} dirección(es) entendida(s)${bulkBad?`, ${bulkBad} por revisar (corrígelas en el texto)`:""}. Revisa y toca «Continuar».` : "");
  };
  bulkUI(true, "Escuchando… di una dirección, haz una pausa o di «siguiente», y di la otra. Opcional al final de cada una: «teléfono» y el número, o la cantidad («por tres»).");
  try{ recBulk.start(); }catch(e){ bulkUI(false, "No se pudo iniciar el dictado."); }
}
$("micBulk").onclick = startBulkDictation;
$("dlgText").addEventListener("close", ()=>{ if(bulkOn){ bulkOn = false; try{ recBulk.abort(); }catch(e){} } bulkUI(false, ""); });
$("dlgEdit").addEventListener("close", ()=>{ if(recOn){ try{ rec.abort(); }catch(e){} micUI(false,""); } });
