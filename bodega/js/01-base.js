/* Utilidades comunes: atajos del DOM, almacenamiento pequeño, avisos, sonido, fechas y formato de guías.
   Todos los archivos js/ son scripts clásicos que comparten estas variables globales y se cargan en orden. */
"use strict";
const USER = window.BODEGA_USER;
const $ = id => document.getElementById(id);
const store = {
  get(k){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; }catch(e){ return null; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); return true; }catch(e){ return false; } },
  del(k){ try{ localStorage.removeItem(k); }catch(e){} }
};
function esc(s){ return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
let toastT = null;
function toast(m){ const t = $("toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 3200); }

/* ---- Preferencias de este celular ---- */
const PREF_KEY = "bodega.prefs.v1";
const prefs = Object.assign({sonido:true, vista:"vRecibir", lote:null, rep:null}, store.get(PREF_KEY) || {});
const savePrefs = () => store.set(PREF_KEY, prefs);

/* ---- Identificador del celular (para saber de dónde vino cada lectura) ---- */
const DEV_ID = store.get("bodega.dev") || (() => { const d = "d" + Math.random().toString(36).slice(2, 10); store.set("bodega.dev", d); return d; })();
function uuid(){
  if(crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

/* ---- Fechas (hora de Bogotá del celular) ---- */
const pad2 = n => String(n).padStart(2, "0");
function diaDe(iso){ const d = new Date(iso); return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
const hoy = () => diaDe(new Date().toISOString());
function horaDe(iso){ const d = new Date(iso); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function fechaHora(iso){ if(!iso) return ""; const d = new Date(iso); return `${pad2(d.getDate())}/${pad2(d.getMonth()+1)} ${horaDe(iso)}`; }
function diasDesde(iso){ return iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 864e5) : 0; }

/* ---- Guías ----
   Se normaliza lo leído: sin espacios, en mayúsculas. Un enlace (QR) se reduce a su parte con números.
   Filtro contra lecturas falsas: 6+ caracteres, letras/números/guion, y al menos 4 dígitos. */
function normGuia(t){
  t = String(t || "").trim();
  if(/^https?:\/\//i.test(t)){
    try{
      const u = new URL(t);
      const c = [...u.searchParams.values(), ...u.pathname.split("/")].map(x => x.trim()).filter(x => /^[A-Za-z0-9-]{6,}$/.test(x) && /\d{4,}/.test(x));
      t = c.length ? c[c.length - 1] : "";
    }catch(e){ t = ""; }
  }
  t = t.replace(/\s+/g, "").toUpperCase();
  return /^[A-Z0-9-]{6,40}$/.test(t) && /\d{4,}/.test(t) ? t : "";
}
// Saca las guías de un texto pegado o de un archivo (listado esperado): cualquier palabra que parezca guía.
function guiasDeTexto(txt){
  const out = new Set();
  String(txt || "").split(/[\s,;|"'\t]+/).forEach(p => { const g = normGuia(p); if(g) out.add(g); });
  return [...out];
}
const EMPRESAS = ["Xcargo", "iMile", "Otra"];

/* ---- Sonido y vibración al leer: tono alto = bien, doble tono bajo = revisar ---- */
let audioCtx = null;
function pitar(tipo){
  if(navigator.vibrate) navigator.vibrate(tipo === "ok" ? 60 : tipo === "rep" ? 30 : [120, 60, 120]);
  if(!prefs.sonido) return;
  try{
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const tonos = tipo === "ok" ? [[1200, 0, .09]] : tipo === "rep" ? [[700, 0, .05]] : [[330, 0, .14], [260, .18, .14]];
    tonos.forEach(([f, t0, dur]) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = f; o.type = "square"; g.gain.value = .06;
      o.connect(g); g.connect(audioCtx.destination);
      o.start(audioCtx.currentTime + t0); o.stop(audioCtx.currentTime + t0 + dur);
    });
  }catch(e){}
}

/* ---- Formulario genérico (promesa): devuelve los valores o null si se cancela ----
   campos: {id, label, type: text | textarea | select | check, options, value} */
function pedir(o){
  return new Promise(res => {
    let d = $("dlgPedir");
    if(!d){
      d = document.createElement("dialog"); d.id = "dlgPedir";
      d.innerHTML = `<form><h2 id="pdTitle"></h2><p class="hint" id="pdMsg" style="margin:0;white-space:pre-line"></p><div id="pdFields" style="display:flex;flex-direction:column;gap:10px"></div><p class="uerr" id="pdErr" role="alert"></p><div class="row"><button type="button" id="pdNo">Cancelar</button><button type="submit" class="primary" id="pdYes"></button></div></form>`;
      document.body.appendChild(d);
    }
    $("pdTitle").textContent = o.title; $("pdMsg").textContent = o.msg || ""; $("pdErr").textContent = "";
    const box = $("pdFields"); box.innerHTML = "";
    (o.fields || []).forEach(f => {
      const l = document.createElement("label");
      let i;
      if(f.type === "select"){ i = document.createElement("select"); (f.options || []).forEach(op => { const x = document.createElement("option"); const [val, txt] = Array.isArray(op) ? op : [op, op]; x.value = val; x.textContent = txt; i.appendChild(x); }); }
      else if(f.type === "textarea"){ i = document.createElement("textarea"); i.rows = 6; }
      else { i = document.createElement("input"); i.type = f.type === "check" ? "checkbox" : f.type === "date" ? "date" : "text"; i.autocomplete = "off"; if(f.max) i.maxLength = f.max; if(f.num) i.inputMode = "numeric"; if(f.ph) i.placeholder = f.ph; }
      i.id = "pd_" + f.id;
      if(f.type === "check"){ i.checked = !!f.value; l.className = "chk"; l.append(i, document.createTextNode(" " + f.label)); }
      else { if(f.value != null) i.value = f.value; l.append(document.createTextNode(f.label), i); }
      box.appendChild(l);
    });
    $("pdYes").textContent = o.yes || "Aceptar"; $("pdYes").className = o.danger ? "danger" : "primary";
    $("pdNo").hidden = o.noCancel === true;
    const form = d.querySelector("form");
    // Se cierra con «cancel» (tecla Atrás/Esc) y no con «close»: ese evento llega después y podría cancelar el formulario siguiente.
    const fin = v => { form.onsubmit = null; $("pdNo").onclick = null; d.oncancel = null; if(d.open) d.close(); res(v); };
    form.onsubmit = e => {
      e.preventDefault();
      const v = {}; (o.fields || []).forEach(f => { const el = $("pd_" + f.id); v[f.id] = f.type === "check" ? el.checked : el.value; });
      const err = o.check ? o.check(v) : "";
      if(err){ $("pdErr").textContent = err; return; }
      fin(v);
    };
    $("pdNo").onclick = () => fin(null);
    d.oncancel = e => { e.preventDefault(); fin(null); };
    d.showModal();
    const first = box.querySelector("input,select,textarea"); if(first) setTimeout(() => first.focus(), 50);
  });
}
const confirmar = (title, msg, yes, danger) => pedir({title, msg, yes: yes || "Sí", danger}).then(v => !!v);
