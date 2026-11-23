// Supabase simulado en memoria para las pruebas: autenticación, tablas y reglas RLS equivalentes a supabase/equipo.sql.
const SB = "https://aptyzcodlubefqrscmvc.supabase.co";
function crearSupabase(){
  const db = {
    users: [
      { id: "u-camilo", email: "camilo@equipo.co", pass: "Clave-Camilo-1" },
      { id: "u-andrea", email: "andrea@equipo.co", pass: "Clave-Andrea-1" },
      { id: "u-extrano", email: "extrano@otro.co", pass: "Clave-Extrano-1" }
    ],
    miembros: [ { user_id: "u-camilo", nombre: "Camilo", admin: true }, { user_id: "u-andrea", nombre: "Andrea", admin: false } ],
    paradas: new Map(), logouts: [], reloj: Date.now(), llamadas: 0
  };
  const ahora = () => new Date(++db.reloj).toISOString();
  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: body === undefined ? "" : JSON.stringify(body) });
  const uidDe = req => { const m = /Bearer tok-(.+)$/.exec(req.headers()["authorization"] || ""); return m ? m[1] : null; };
  const miembro = uid => db.miembros.find(m => m.user_id === uid && m.activo !== false);
  const puedeVer = (uid, row) => miembro(uid) && (row.owner === uid || miembro(uid).admin);
  function filtrar(rows, params){
    for (const [k, v] of params){
      if (["select", "order", "on_conflict", "limit", "offset"].includes(k)) continue;
      const [op, ...rest] = v.split("."); const val = rest.join(".");
      rows = rows.filter(r => {
        const x = r[k];
        if (op === "eq") return String(x) === val;
        if (op === "neq") return String(x) !== val;
        if (op === "gte") return x >= val;
        if (op === "is") return String(x) === val;
        if (op === "in") return val.replace(/^\(|\)$/g, "").split(",").map(s => s.replace(/^"|"$/g, "")).includes(String(x));
        throw new Error("operador no simulado: " + op);
      });
    }
    return rows;
  }
  async function manejar(route){
    db.llamadas++;
    const req = route.request(), url = new URL(req.url()), path = url.pathname, params = [...url.searchParams];
    if (path === "/auth/v1/token"){
      const b = JSON.parse(req.postData() || "{}"), g = url.searchParams.get("grant_type");
      const u = g === "password" ? db.users.find(x => x.email === b.email && x.pass === b.password) : db.users.find(x => "ref-" + x.id === b.refresh_token);
      if (!u) return json(route, 400, { error: "invalid_grant", error_description: "Invalid login credentials" });
      if (u.banned) return json(route, 400, { error: "user_banned", error_description: "User is banned" });
      return json(route, 200, { access_token: "tok-" + u.id, refresh_token: "ref-" + u.id, expires_in: 3600, user: { id: u.id, email: u.email } });
    }
    if (path === "/auth/v1/logout"){ db.logouts.push(url.searchParams.get("scope") || "global"); return json(route, 204); }
    const uid = uidDe(req); if (!uid) return json(route, 401, { message: "JWT requerido" });
    if (path === "/functions/v1/equipo-usuarios") return funcionUsuarios(route, req, uid);
    if (path === "/rest/v1/equipo_miembros"){
      if (!miembro(uid)) return json(route, 200, []);
      return json(route, 200, filtrar(db.miembros.slice(), params));
    }
    if (path === "/rest/v1/paradas"){
      const m = req.method();
      if (m === "GET"){
        let rows = [...db.paradas.values()].filter(r => puedeVer(uid, r));
        rows = filtrar(rows, params).sort((a, b) => a.updated_at < b.updated_at ? -1 : 1);
        return json(route, 200, rows.map(r => JSON.parse(JSON.stringify(r))));
      }
      if (m === "POST"){
        for (const row of JSON.parse(req.postData())){
          const prev = db.paradas.get(row.id);
          if (!miembro(uid) || !(row.owner === uid || miembro(uid).admin) || (prev && !puedeVer(uid, prev))) return json(route, 403, { message: "new row violates row-level security policy" });
          db.paradas.set(row.id, { ...prev, ...row, updated_at: ahora(), updated_by: uid });
        }
        return json(route, 201);
      }
      if (m === "PATCH"){
        const cambio = JSON.parse(req.postData());
        const rows = filtrar([...db.paradas.values()].filter(r => puedeVer(uid, r)), params);
        for (const r of rows){
          const nuevo = { ...r, ...cambio };
          if (!(nuevo.owner === uid || miembro(uid).admin)) return json(route, 403, { message: "row-level security" });
          db.paradas.set(r.id, { ...nuevo, updated_at: ahora(), updated_by: uid });
        }
        return json(route, 204);
      }
    }
    return json(route, 404, { message: "no simulado: " + path });
  }
  // Función «equipo-usuarios» (supabase/functions/equipo-usuarios/index.ts), simplificada: la real se prueba aparte
  // en tests/funcion-usuarios.spec.js. Aquí basta lo que la app ve: permisos, respuestas y efectos en las tablas.
  function funcionUsuarios(route, req, uid){
    const b = JSON.parse(req.postData() || "{}"), yo = db.miembros.find(m => m.user_id === uid);
    (db.funcion = db.funcion || []).push(b.accion);
    const err = (st, msg) => json(route, st, { error: msg });
    if (!yo || !yo.admin || yo.activo === false) return err(403, "Solo un administrador del equipo puede crear o cambiar personas.");
    const usuarioDe = e => e.endsWith("@ruta.local") ? e.slice(0, -11) : e;
    const B = db.bod, rolDe = m => m.rol || (m.admin ? "despachador" : "repartidor");
    const bodegaRol = (m) => { if (!B) return; B.miembros = B.miembros.filter(x => x.user_id !== m.user_id); if (m.admin || rolDe(m) === "despachador") B.miembros.push({ user_id: m.user_id, nombre: m.nombre, rol: m.admin ? "admin" : "bodega" }); };
    if (b.accion === "listar") return json(route, 200, db.miembros.map(m => ({ user_id: m.user_id, nombre: m.nombre, usuario: usuarioDe((db.users.find(u => u.id === m.user_id) || {}).email || ""), rol: rolDe(m), admin: !!m.admin, activo: m.activo !== false, rid: B ? ((B.vinculos.find(v => v.user_id === m.user_id) || {}).rid || null) : null })));
    if (b.accion === "crear"){
      const t = String(b.usuario || "").trim().toLowerCase(), email = t.includes("@") ? t : t + "@ruta.local";
      if (!t.includes("@") && !/^[a-z0-9][a-z0-9._-]{2,29}$/.test(t)) return err(400, "El usuario debe tener de 3 a 30 letras o números, sin espacios ni tildes (ej.: luis, luis.p).");
      if (String(b.clave || "").length < 8) return err(400, "La contraseña debe tener de 8 a 72 caracteres.");
      if (db.users.some(u => u.email === email)) return err(409, `Ya existe una cuenta con ${usuarioDe(email)}. Usa otro usuario.`);
      const id = "u-" + usuarioDe(email).replace(/[^a-z0-9]/g, "");
      db.users.push({ id, email, pass: b.clave });
      const m = { user_id: id, nombre: String(b.nombre).trim(), admin: !!b.admin, rol: b.rol === "despachador" ? "despachador" : "repartidor", activo: true };
      db.miembros.push(m); bodegaRol(m);
      let rid = null;
      if (m.rol === "repartidor" && B){
        rid = b.rid || ("r" + Math.random().toString(36).slice(2, 10));
        if (!b.rid) B.eventos.push({ id: "ev-" + rid, at: new Date().toISOString(), tipo: "REP", guia: null, d: { rid, nombre: m.nombre, activo: true }, por: yo.nombre, dev: "personas", seq: ++B.seq, user_id: uid, srv_at: new Date().toISOString() });
        B.vinculos.push({ rid, user_id: id, nombre: m.nombre });
      }
      return json(route, 200, { user_id: id, usuario: usuarioDe(email), rid, aviso: "" });
    }
    const m = db.miembros.find(x => x.user_id === b.user_id); if (!m) return err(404, "Esa persona no está en el equipo.");
    if (b.accion === "editar"){
      if (b.admin === false && m.admin && m.user_id === uid) return err(400, "No puedes quitarte a ti mismo como administrador: pídeselo a otro administrador.");
      Object.assign(m, { nombre: b.nombre ?? m.nombre, rol: b.rol ?? m.rol, admin: b.admin ?? m.admin }); bodegaRol(m);
      return json(route, 200, { ok: true });
    }
    if (b.accion === "activo"){
      if (!b.activo && m.user_id === uid) return err(400, "No puedes desactivarte a ti mismo.");
      m.activo = !!b.activo; db.users.find(u => u.id === m.user_id).banned = !b.activo;
      return json(route, 200, { ok: true });
    }
    if (b.accion === "clave"){ if (String(b.clave || "").length < 8) return err(400, "La contraseña debe tener de 8 a 72 caracteres."); db.users.find(u => u.id === m.user_id).pass = b.clave; return json(route, 200, { ok: true }); }
    return err(400, "Acción no válida.");
  }
  return { db, instalar: ctx => ctx.route(SB + "/**", manejar) };
}
module.exports = { crearSupabase };
