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
  const miembro = uid => db.miembros.find(m => m.user_id === uid);
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
      return json(route, 200, { access_token: "tok-" + u.id, refresh_token: "ref-" + u.id, expires_in: 3600, user: { id: u.id, email: u.email } });
    }
    if (path === "/auth/v1/logout"){ db.logouts.push(url.searchParams.get("scope") || "global"); return json(route, 204); }
    const uid = uidDe(req); if (!uid) return json(route, 401, { message: "JWT requerido" });
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
  return { db, instalar: ctx => ctx.route(SB + "/**", manejar) };
}
module.exports = { crearSupabase };
