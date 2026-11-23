// Prueba la función de Supabase «equipo-usuarios» (supabase/functions/equipo-usuarios/index.ts) en Node, contra una
// copia en memoria de la API de Supabase (cuentas, tablas y llave de servicio). Es el mismo código que se despliega.
const { test, expect } = require("@playwright/test");
const vm = require("vm"), fs = require("fs"), path = require("path");

const SB = "https://falso.supabase.co", LLAVE = "llave-de-servicio";
function cargarFuncion(){
  const ctx = { Response, Request, Headers, URL, console, crypto: require("crypto").webcrypto };
  ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../supabase/functions/equipo-usuarios/index.ts"), "utf8"), ctx);
  return ctx.crearManejadorEquipo;
}
// Supabase en memoria: lo justo que usa la función, con sus mismas respuestas (códigos y formas).
function nube({ sinBodega = false } = {}){
  const db = {
    users: [{ id: "00000000-0000-4000-8000-000000000001", email: "camilo@equipo.co", password: "x", banned: false },
            { id: "00000000-0000-4000-8000-000000000002", email: "jairo@ruta.local", password: "x", banned: false }],
    miembros: [{ user_id: "00000000-0000-4000-8000-000000000001", nombre: "Camilo", admin: true, rol: "despachador", activo: true },
               { user_id: "00000000-0000-4000-8000-000000000002", nombre: "Jairo", admin: false, rol: "repartidor", activo: true }],
    bodMiembros: [{ user_id: "00000000-0000-4000-8000-000000000001", nombre: "Camilo", rol: "admin" }],
    eventos: [], vinculos: [], auditoria: [], llamadas: []
  };
  const CAMILO = db.users[0].id, JAIRO = db.users[1].id;
  const res = (status, body) => new Response(status === 204 ? null : body === undefined ? "" : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const filtro = (rows, sp) => { for (const [k, v] of sp){ if (["select", "order", "on_conflict", "per_page"].includes(k)) continue; const val = v.replace(/^eq\./, ""); rows = rows.filter(r => String(r[k]) === decodeURIComponent(val)); } return rows; };
  async function fetchFalso(url, opt = {}){
    const u = new URL(url), p = u.pathname, metodo = opt.method || "GET", h = opt.headers || {}, body = opt.body ? JSON.parse(opt.body) : null;
    db.llamadas.push(metodo + " " + p);
    if (p === "/auth/v1/user"){
      const m = /Bearer tok-(.+)$/.exec(h.Authorization || ""); const us = m && db.users.find(x => x.id === m[1]);
      return us && !us.banned ? res(200, { id: us.id, email: us.email }) : res(401, { msg: "invalid JWT" });
    }
    if (h.Authorization !== "Bearer " + LLAVE || h.apikey !== LLAVE) return res(401, { message: "sin llave de servicio" });
    if (p === "/auth/v1/admin/users"){
      if (metodo === "GET") return res(200, { users: db.users.map(x => ({ id: x.id, email: x.email })) });
      if (db.users.some(x => x.email === body.email)) return res(422, { code: "email_exists", msg: "A user with this email address has already been registered" });
      const n = { id: "00000000-0000-4000-8000-" + String(db.users.length + 1).padStart(12, "0"), email: body.email, password: body.password, confirmado: body.email_confirm, banned: false };
      db.users.push(n); return res(200, { id: n.id, email: n.email });
    }
    const mu = /^\/auth\/v1\/admin\/users\/(.+)$/.exec(p);
    if (mu){
      const us = db.users.find(x => x.id === mu[1]); if (!us) return res(404, { msg: "User not found" });
      if (metodo === "DELETE"){ db.users = db.users.filter(x => x !== us); return res(200, {}); }
      if (body.password) us.password = body.password;
      if (body.ban_duration) us.banned = body.ban_duration !== "none";
      return res(200, { id: us.id });
    }
    const tabla = p.replace("/rest/v1/", ""), sp = u.searchParams;
    const mapa = { equipo_miembros: "miembros", bodega_miembros: "bodMiembros", bodega_vinculos: "vinculos", bodega_eventos: "eventos", equipo_auditoria: "auditoria" };
    const k = mapa[tabla]; if (!k) return res(404, { code: "PGRST205", message: "tabla no existe" });
    if (sinBodega && tabla.startsWith("bodega_")) return res(404, { code: "PGRST205", message: `Could not find the table 'public.${tabla}' in the schema cache` });
    if (metodo === "GET") return res(200, filtro(db[k], sp).map(r => ({ ...r })));
    if (metodo === "POST"){
      const clave = sp.get("on_conflict");
      for (const f of body){ if (clave) db[k] = db[k].filter(r => r[clave] !== f[clave]); else if (k === "miembros" && db.miembros.some(r => r.user_id === f.user_id)) return res(409, { code: "23505" }); db[k].push({ ...f }); }
      return res(201);
    }
    if (metodo === "PATCH"){ filtro(db[k], sp).forEach(r => Object.assign(r, body)); return res(204); }
    if (metodo === "DELETE"){ const quitar = new Set(filtro(db[k], sp)); db[k] = db[k].filter(r => !quitar.has(r)); return res(204); }
    return res(405, {});
  }
  return { db, fetchFalso, CAMILO, JAIRO };
}
async function llamar(fn, token, body, metodo = "POST"){
  const r = await fn(new Request("https://falso.supabase.co/functions/v1/equipo-usuarios", { method: metodo, headers: { "Content-Type": "application/json", Origin: "https://camilo-1012.github.io", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: metodo === "POST" ? JSON.stringify(body) : undefined }));
  const txt = await r.text();
  return { status: r.status, body: txt ? JSON.parse(txt) : null, cors: r.headers.get("access-control-allow-origin") };
}
const crearManejador = cargarFuncion();
const preparar = op => { const n = nube(op); return { ...n, fn: crearManejador({ SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: LLAVE }, n.fetchFalso) }; };

test("función equipo-usuarios: solo un administrador activo; crea repartidor en un paso (cuenta, equipo, bodega y vínculo)", async () => {
  const { db, fn, CAMILO, JAIRO } = preparar();
  expect((await llamar(fn, null, { accion: "listar" })).status).toBe(401);
  expect((await llamar(fn, "tok-" + JAIRO, { accion: "listar" })).status).toBe(403);
  const pre = await llamar(fn, null, {}, "OPTIONS");
  expect([pre.status, pre.cors]).toEqual([204, "https://camilo-1012.github.io"]);

  const r = await llamar(fn, "tok-" + CAMILO, { accion: "crear", nombre: "  Luis   Pérez ", usuario: "Luis", clave: "Ruta-4821-kp", rol: "repartidor", admin: false });
  expect(r.status).toBe(200);
  expect(r.body.usuario).toBe("luis");
  const cuenta = db.users.find(u => u.email === "luis@ruta.local");
  expect([cuenta.confirmado, cuenta.password]).toEqual([true, "Ruta-4821-kp"]);
  expect(db.miembros.find(m => m.user_id === cuenta.id)).toEqual({ user_id: cuenta.id, nombre: "Luis Pérez", admin: false, rol: "repartidor", activo: true });
  const rep = db.eventos.find(e => e.tipo === "REP");
  expect([rep.d.nombre, rep.d.activo, rep.user_id, rep.guia]).toEqual(["Luis Pérez", true, CAMILO, null]);
  expect(db.vinculos).toEqual([{ rid: rep.d.rid, user_id: cuenta.id, nombre: "Luis Pérez" }]);
  expect(r.body.rid).toBe(rep.d.rid);
  expect(db.bodMiembros.some(m => m.user_id === cuenta.id)).toBe(false);          // el repartidor no entra a la bodega
  expect(db.auditoria).toHaveLength(1);
  expect(JSON.stringify(db.auditoria)).not.toContain("Ruta-4821-kp");            // la contraseña nunca queda guardada

  // Repetido, usuario o contraseña no válidos: no crea nada.
  expect((await llamar(fn, "tok-" + CAMILO, { accion: "crear", nombre: "Otro", usuario: "luis", clave: "Ruta-4821-kp", rol: "repartidor" })).status).toBe(409);
  expect((await llamar(fn, "tok-" + CAMILO, { accion: "crear", nombre: "Otro", usuario: "lu is", clave: "Ruta-4821-kp" })).body.error).toContain("de 3 a 30");
  expect((await llamar(fn, "tok-" + CAMILO, { accion: "crear", nombre: "Otro", usuario: "otro", clave: "123" })).body.error).toContain("contraseña");
  expect(db.users).toHaveLength(3);

  // Con correo real también sirve; despachador administrador → bodega como admin.
  const d = await llamar(fn, "tok-" + CAMILO, { accion: "crear", nombre: "Luisa", usuario: "luisa@gmail.com", clave: "Clave-Luisa-9", rol: "despachador", admin: true });
  expect([d.status, d.body.usuario, d.body.rid]).toEqual([200, "luisa@gmail.com", null]);
  expect(db.bodMiembros.find(m => m.user_id === d.body.user_id).rol).toBe("admin");

  // Vincular a un repartidor que ya existía en la bodega (sin crear otro).
  const v = await llamar(fn, "tok-" + CAMILO, { accion: "crear", nombre: "John", usuario: "john", clave: "Clave-John-77", rol: "repartidor", rid: "rabc12345" });
  expect(v.body.rid).toBe("rabc12345");
  expect(db.eventos.filter(e => e.tipo === "REP")).toHaveLength(1);

  const l = await llamar(fn, "tok-" + CAMILO, { accion: "listar" });
  expect(l.body.map(p => [p.nombre, p.usuario, p.rol, p.admin, p.activo, !!p.rid])).toEqual([
    ["Camilo", "camilo@equipo.co", "despachador", true, true, false], ["Jairo", "jairo", "repartidor", false, true, false],
    ["Luis Pérez", "luis", "repartidor", false, true, true], ["Luisa", "luisa@gmail.com", "despachador", true, true, false], ["John", "john", "repartidor", false, true, true]]);
});

test("función equipo-usuarios: desactivar, contraseña, editar y protecciones del último administrador", async () => {
  const { db, fn, CAMILO, JAIRO } = preparar();
  expect((await llamar(fn, "tok-" + CAMILO, { accion: "activo", user_id: CAMILO, activo: false })).body.error).toContain("a ti mismo");
  expect((await llamar(fn, "tok-" + CAMILO, { accion: "editar", user_id: CAMILO, admin: false })).body.error).toContain("a ti mismo");

  expect((await llamar(fn, "tok-" + CAMILO, { accion: "activo", user_id: JAIRO, activo: false })).status).toBe(200);
  expect([db.users[1].banned, db.miembros[1].activo]).toEqual([true, false]);
  expect((await llamar(fn, "tok-" + JAIRO, { accion: "listar" })).status).toBe(401);      // bloqueado: ya no entra
  expect((await llamar(fn, "tok-" + CAMILO, { accion: "activo", user_id: JAIRO, activo: true })).status).toBe(200);
  expect([db.users[1].banned, db.miembros[1].activo]).toEqual([false, true]);

  expect((await llamar(fn, "tok-" + CAMILO, { accion: "clave", user_id: JAIRO, clave: "Nueva-Clave-55" })).status).toBe(200);
  expect(db.users[1].password).toBe("Nueva-Clave-55");
  expect(JSON.stringify(db.auditoria)).not.toContain("Nueva-Clave-55");

  // Jairo pasa a despachador administrador: entra a la bodega como admin. Después Camilo ya puede dejar de serlo… por otro.
  expect((await llamar(fn, "tok-" + CAMILO, { accion: "editar", user_id: JAIRO, rol: "despachador", admin: true, nombre: "Jairo C" })).status).toBe(200);
  expect(db.bodMiembros.find(m => m.user_id === JAIRO)).toEqual({ user_id: JAIRO, nombre: "Jairo C", rol: "admin" });
  expect((await llamar(fn, "tok-" + JAIRO, { accion: "editar", user_id: CAMILO, admin: false })).status).toBe(200);
  expect(db.bodMiembros.find(m => m.user_id === CAMILO).rol).toBe("bodega");
  // Jairo es ahora el único administrador: nadie puede quitárselo ni desactivarlo.
  expect((await llamar(fn, "tok-" + CAMILO, { accion: "listar" })).status).toBe(403);
  // Vuelve a repartidor sin admin → sale de la bodega.
  expect((await llamar(fn, "tok-" + JAIRO, { accion: "editar", user_id: CAMILO, rol: "repartidor" })).status).toBe(200);
  expect(db.bodMiembros.some(m => m.user_id === CAMILO)).toBe(false);
  expect(db.auditoria.map(a => a.accion)).toEqual(["desactivar", "activar", "clave", "editar", "editar", "editar"]);
  expect((await llamar(fn, "tok-" + JAIRO, { accion: "otra" })).status).toBe(400);
});

test("función equipo-usuarios: sin las tablas de la bodega, igual crea la persona en el equipo y avisa", async () => {
  const { db, fn, CAMILO } = preparar({ sinBodega: true });
  const r = await llamar(fn, "tok-" + CAMILO, { accion: "crear", nombre: "Pedro", usuario: "pedro", clave: "Clave-Pedro-1", rol: "repartidor" });
  expect(r.status).toBe(200);
  expect(r.body.rid).toBeNull();
  expect(r.body.aviso).toContain("vincúlalo después");
  expect(db.miembros.some(m => m.nombre === "Pedro")).toBe(true);
  // Sin llave de servicio configurada: error claro.
  const sinLlave = crearManejador({ SUPABASE_URL: SB }, nube().fetchFalso);
  expect((await llamar(sinLlave, "tok-x", { accion: "listar" })).body.error).toContain("llave de servicio");
});
