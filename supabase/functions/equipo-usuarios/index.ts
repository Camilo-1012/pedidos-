// @ts-nocheck  (JavaScript simple dentro de .ts: así lo despliega Supabase y lo prueban las pruebas en Node)
// =====================================================================================
// Función de Supabase «equipo-usuarios» (v2.35): crear y administrar personas DESDE LA APP.
// Corre en Supabase (Edge Functions) con la llave de servicio, que Supabase le entrega sola
// (SUPABASE_SERVICE_ROLE_KEY): esa llave NUNCA va en la app ni en el repositorio.
// Solo la puede usar un ADMINISTRADOR activo del equipo (equipo_miembros.admin y activo). Lo verifica aquí,
// con su sesión, aunque alguien modifique la app.
//
// Acciones (POST, cuerpo JSON {accion, ...}):
//   listar                                       → personas con usuario, rol, administrador, activo y repartidor de bodega
//   crear   {nombre, usuario, clave, rol, admin, rid?} → crea la cuenta (ya confirmada), la agrega al equipo y, según
//            el rol, a la bodega (despachador) o como repartidor de la bodega vinculado a su Ruta (repartidor)
//   editar  {user_id, nombre?, rol?, admin?}     → cambia nombre, rol o administrador
//   activo  {user_id, activo}                    → desactiva (bloquea la cuenta, no borra nada) o reactiva
//   clave   {user_id, clave}                     → contraseña nueva
// Cada cambio queda en equipo_auditoria (quién, a quién, qué y cuándo).
//
// Sin librerías: llama la API de Supabase con fetch. Escrito en JavaScript compatible con TypeScript para que
// también lo puedan probar las pruebas automáticas (tests/funcion-usuarios.spec.js).
// Desplegar: ver supabase/LEEME-usuarios.md.
// =====================================================================================

const DOMINIO = "ruta.local";            // «luis» → luis@ruta.local (no necesita correo real)
const ROLES = ["repartidor", "despachador"];
const MIN_CLAVE = 8;

function crearManejador(env, fetchFn) {
  const URL_SB = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const KEY = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const ORIGENES = String(env.ORIGENES || "https://camilo-1012.github.io").split(",").map(s => s.trim()).filter(Boolean);
  const f = fetchFn;

  const cors = origen => ({
    "Access-Control-Allow-Origin": ORIGENES.includes(origen) || /^http:\/\/localhost(:\d+)?$/.test(origen) ? origen : ORIGENES[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  });
  const resp = (origen, status, body) => new Response(JSON.stringify(body), { status, headers: { ...cors(origen), "Content-Type": "application/json" } });
  class Falla extends Error { constructor(status, msg) { super(msg); this.status = status; } }

  // ---- API de Supabase con la llave de servicio ----
  const hdr = extra => ({ apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json", ...(extra || {}) });
  async function api(path, opt) {
    const r = await f(URL_SB + path, { ...opt, headers: hdr(opt && opt.headers) });
    const txt = await r.text();
    let j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) { j = { message: txt }; }
    if (!r.ok) { const e = new Falla(r.status, (j && (j.msg || j.message || j.error_description || j.error)) || ("HTTP " + r.status)); e.code = j && (j.code || j.error_code); throw e; }
    return j;
  }
  const rest = (tabla, opt) => api("/rest/v1/" + tabla, opt);
  const auditar = (por, sobre, accion, detalle) => rest("equipo_auditoria", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ por, sobre, accion, detalle: detalle || {} }]) });

  // ---- Validaciones ----
  const limpiarNombre = s => String(s || "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim();
  function nombreOk(s) { const n = limpiarNombre(s); if (!n || n.length > 40) throw new Falla(400, "Escribe un nombre de 1 a 40 letras."); return n; }
  function usuarioACorreo(u) {
    const t = String(u || "").trim().toLowerCase();
    if (t.includes("@")) { if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(t) || t.length > 120) throw new Falla(400, "El correo no es válido."); return t; }
    if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(t)) throw new Falla(400, "El usuario debe tener de 3 a 30 letras o números, sin espacios ni tildes (ej.: luis, luis.p).");
    return t + "@" + DOMINIO;
  }
  const correoAUsuario = c => String(c || "").endsWith("@" + DOMINIO) ? String(c).slice(0, -DOMINIO.length - 1) : String(c || "");
  function claveOk(c) { const s = String(c || ""); if (s.length < MIN_CLAVE || s.length > 72) throw new Falla(400, `La contraseña debe tener de ${MIN_CLAVE} a 72 caracteres.`); return s; }
  const uuidOk = s => { if (!/^[0-9a-f-]{36}$/i.test(String(s || ""))) throw new Falla(400, "Persona no válida."); return String(s); };

  // ---- Quién llama: su sesión debe ser de un administrador activo ----
  async function quienLlama(req) {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") || "");
    if (!m) throw new Falla(401, "Falta la sesión: conecta el equipo en la app.");
    const r = await f(URL_SB + "/auth/v1/user", { headers: { apikey: KEY, Authorization: "Bearer " + m[1] } });
    if (!r.ok) throw new Falla(401, "La sesión venció: vuelve a conectar el equipo.");
    const u = await r.json();
    const fila = (await rest(`equipo_miembros?select=user_id,nombre,admin,activo&user_id=eq.${encodeURIComponent(u.id)}`)) || [];
    if (!fila.length || !fila[0].admin || fila[0].activo === false) throw new Falla(403, "Solo un administrador del equipo puede crear o cambiar personas.");
    return { id: u.id, nombre: fila[0].nombre };
  }
  async function miembros() { return (await rest("equipo_miembros?select=user_id,nombre,admin,rol,activo&order=nombre.asc")) || []; }
  async function adminsActivos() { return (await miembros()).filter(m => m.admin && m.activo !== false); }
  // Bodega opcional: si aún no se corrió bodega.sql, lo de Ruta igual funciona.
  async function bodega(fn) { try { return await fn(); } catch (e) { if (e.status === 404 || e.code === "42P01" || e.code === "PGRST205") return null; throw e; } }
  async function ponerEnBodega(user_id, nombre, rol, admin) {
    return bodega(async () => {
      if (admin || rol === "despachador") await rest("bodega_miembros?on_conflict=user_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify([{ user_id, nombre, rol: admin ? "admin" : "bodega" }]) });
      else await rest(`bodega_miembros?user_id=eq.${user_id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      return true;
    });
  }
  const nuevoId = () => crypto.randomUUID();

  // ---- Acciones ----
  async function listar() {
    const [ms, us, vs] = await Promise.all([
      miembros(),
      api("/auth/v1/admin/users?per_page=1000"),
      bodega(() => rest("bodega_vinculos?select=rid,user_id"))
    ]);
    const lista = (us && (us.users || us)) || [];
    const correo = new Map(lista.map(u => [u.id, u.email]));
    const rid = new Map((vs || []).map(v => [v.user_id, v.rid]));
    return ms.map(m => ({ user_id: m.user_id, nombre: m.nombre, usuario: correoAUsuario(correo.get(m.user_id)), rol: m.rol || "repartidor", admin: !!m.admin, activo: m.activo !== false, rid: rid.get(m.user_id) || null }));
  }

  async function crear(yo, b) {
    const nombre = nombreOk(b.nombre), email = usuarioACorreo(b.usuario), clave = claveOk(b.clave);
    const rol = ROLES.includes(b.rol) ? b.rol : "repartidor", admin = !!b.admin;
    let u;
    try { u = await api("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password: clave, email_confirm: true, user_metadata: { nombre } }) }); }
    catch (e) {
      if (e.status === 422 || /already|registered|exists/i.test(e.message)) throw new Falla(409, `Ya existe una cuenta con ${correoAUsuario(email)}. Usa otro usuario.`);
      if (/password/i.test(e.message)) throw new Falla(400, "Supabase no aceptó la contraseña: usa una más larga, con letras y números.");
      throw e;
    }
    const id = u.id || (u.user && u.user.id);
    try {
      await rest("equipo_miembros", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ user_id: id, nombre, admin, rol, activo: true }]) });
    } catch (e) {
      await api("/auth/v1/admin/users/" + id, { method: "DELETE" }).catch(() => {});   // no dejar cuentas a medias
      throw e;
    }
    const aviso = [];
    if ((await ponerEnBodega(id, nombre, rol, admin)) === null && (admin || rol === "despachador")) aviso.push("La bodega aún no está creada en Supabase (falta bodega.sql).");
    // Repartidor: queda como repartidor de la bodega y vinculado a su Ruta (lo que le despachen le aparece solo).
    let rid = null;
    if (rol === "repartidor") {
      const ok = await bodega(async () => {
        const existente = typeof b.rid === "string" && /^r[0-9a-z]{4,20}$/i.test(b.rid) ? b.rid : null;
        if (existente) {
          const ya = (await rest(`bodega_vinculos?select=user_id&rid=eq.${encodeURIComponent(existente)}`)) || [];
          if (ya.length) throw new Falla(409, "Ese repartidor de la bodega ya tiene otra cuenta vinculada.");
          rid = existente;
        } else {
          rid = "r" + nuevoId().replace(/-/g, "").slice(0, 8);
          await rest("bodega_eventos", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ id: nuevoId(), at: new Date().toISOString(), tipo: "REP", guia: null, d: { rid, nombre, activo: true }, por: String(yo.nombre).slice(0, 40), dev: "personas", user_id: yo.id }]) });
        }
        await rest("bodega_vinculos?on_conflict=rid", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify([{ rid, user_id: id, nombre }]) });
        return true;
      });
      if (ok === null) { rid = null; aviso.push("La bodega aún no está creada en Supabase: vincúlalo después en Bodega → Repartidores."); }
    }
    await auditar(yo.id, id, "crear", { nombre, usuario: correoAUsuario(email), rol, admin, rid });
    return { user_id: id, usuario: correoAUsuario(email), rid, aviso: aviso.join(" ") };
  }

  async function editar(yo, b) {
    const id = uuidOk(b.user_id);
    const ms = await miembros(), m = ms.find(x => x.user_id === id);
    if (!m) throw new Falla(404, "Esa persona no está en el equipo.");
    const cambios = {};
    if (b.nombre !== undefined) cambios.nombre = nombreOk(b.nombre);
    if (b.rol !== undefined) { if (!ROLES.includes(b.rol)) throw new Falla(400, "Rol no válido."); cambios.rol = b.rol; }
    if (b.admin !== undefined) {
      cambios.admin = !!b.admin;
      if (!cambios.admin && m.admin) {
        if (id === yo.id) throw new Falla(400, "No puedes quitarte a ti mismo como administrador: pídeselo a otro administrador.");
        if ((await adminsActivos()).filter(x => x.user_id !== id).length < 1) throw new Falla(400, "Debe quedar al menos un administrador activo.");
      }
    }
    if (!Object.keys(cambios).length) return { ok: true };
    await rest(`equipo_miembros?user_id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(cambios) });
    const n = { ...m, ...cambios };
    await ponerEnBodega(id, n.nombre, n.rol, n.admin);
    if (cambios.nombre) await bodega(() => rest(`bodega_vinculos?user_id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ nombre: n.nombre }) }));
    await auditar(yo.id, id, "editar", cambios);
    return { ok: true };
  }

  async function activo(yo, b) {
    const id = uuidOk(b.user_id), on = !!b.activo;
    const ms = await miembros(), m = ms.find(x => x.user_id === id);
    if (!m) throw new Falla(404, "Esa persona no está en el equipo.");
    if (!on) {
      if (id === yo.id) throw new Falla(400, "No puedes desactivarte a ti mismo.");
      if (m.admin && (await adminsActivos()).filter(x => x.user_id !== id).length < 1) throw new Falla(400, "Debe quedar al menos un administrador activo.");
    }
    // Bloquea la cuenta (no puede volver a entrar ni renovar la sesión) y la marca inactiva (pierde el acceso ya).
    await api("/auth/v1/admin/users/" + id, { method: "PUT", body: JSON.stringify({ ban_duration: on ? "none" : "876000h" }) });
    await rest(`equipo_miembros?user_id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ activo: on }) });
    await auditar(yo.id, id, on ? "activar" : "desactivar", {});
    return { ok: true };
  }

  async function clave(yo, b) {
    const id = uuidOk(b.user_id), c = claveOk(b.clave);
    const ms = await miembros(); if (!ms.some(x => x.user_id === id)) throw new Falla(404, "Esa persona no está en el equipo.");
    await api("/auth/v1/admin/users/" + id, { method: "PUT", body: JSON.stringify({ password: c }) });
    await auditar(yo.id, id, "clave", {});   // la contraseña no se guarda en la auditoría
    return { ok: true };
  }

  return async function manejar(req) {
    const origen = req.headers.get("origin") || "";
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origen) });
    if (req.method !== "POST") return resp(origen, 405, { error: "Método no permitido." });
    try {
      if (!URL_SB || !KEY) throw new Falla(500, "La función no tiene la llave de servicio configurada.");
      const b = await req.json().catch(() => ({}));
      const yo = await quienLlama(req);
      let r;
      switch (b.accion) {
        case "listar": r = await listar(); break;
        case "crear": r = await crear(yo, b); break;
        case "editar": r = await editar(yo, b); break;
        case "activo": r = await activo(yo, b); break;
        case "clave": r = await clave(yo, b); break;
        default: throw new Falla(400, "Acción no válida.");
      }
      return resp(origen, 200, r);
    } catch (e) {
      const st = e && e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
      return resp(origen, st, { error: st === 500 ? "Error en el servidor: " + (e && e.message || e) : e.message });
    }
  };
}

// En Supabase (Deno). En las pruebas automáticas (Node) se usa crearManejador directamente.
const g = globalThis;
if (typeof g.Deno !== "undefined" && g.Deno.serve) {
  g.Deno.serve(crearManejador({ SUPABASE_URL: g.Deno.env.get("SUPABASE_URL"), SUPABASE_SERVICE_ROLE_KEY: g.Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), ORIGENES: g.Deno.env.get("ORIGENES") }, fetch));
} else {
  g.crearManejadorEquipo = crearManejador;
}
