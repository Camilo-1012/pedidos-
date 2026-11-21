// Supabase simulado para las pruebas: autenticación, bodega_miembros y bodega_eventos (solo agregar, con seq).
// Reproduce lo esencial de supabase/bodega.sql: ignora ids repetidos, REP solo para admin, filtros que usa la app.
function crearNube(){
  return {
    cuentas: { "admin@b.co": { uid: "u-admin", pass: "clave1", nombre: "Camilo", rol: "admin" }, "despacho@b.co": { uid: "u-desp", pass: "clave2", nombre: "Despacho", rol: "bodega" } },
    eventos: [], seq: 0, caida: false
  };
}
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: body === undefined ? "" : JSON.stringify(body) });
async function conectarNube(context, nube){
  await context.route(/supabase\.co/, async route => {
    if(nube.caida) return route.abort();
    const req = route.request(), url = new URL(req.url());
    const cuenta = uid => Object.values(nube.cuentas).find(c => c.uid === uid);
    if(url.pathname === "/auth/v1/token"){
      const b = JSON.parse(req.postData() || "{}");
      let c = null;
      if(url.searchParams.get("grant_type") === "password"){ c = nube.cuentas[b.email]; if(!c || c.pass !== b.password) return json(route, 400, { error_description: "Invalid login credentials" }); }
      else c = cuenta(String(b.refresh_token).slice(2));
      if(!c) return json(route, 400, { error_description: "bad refresh" });
      return json(route, 200, { access_token: "t:" + c.uid, refresh_token: "r:" + c.uid, expires_in: 3600, user: { id: c.uid } });
    }
    const uid = String(req.headers()["authorization"] || "").replace("Bearer t:", ""), yo = cuenta(uid);
    if(!yo) return json(route, 401, { message: "JWT" });
    if(url.pathname === "/rest/v1/bodega_miembros"){
      const q = (url.searchParams.get("user_id") || "").replace("eq.", "");
      const c = cuenta(q); return json(route, 200, c ? [{ nombre: c.nombre, rol: c.rol }] : []);
    }
    if(url.pathname === "/rest/v1/bodega_eventos"){
      if(req.method() === "POST"){
        const filas = JSON.parse(req.postData());
        if(filas.some(f => f.tipo === "REP" || f.tipo === "ZONA") && yo.rol !== "admin") return json(route, 403, { code: "42501", message: "new row violates row-level security policy" });
        for(const f of filas){ if(nube.eventos.some(e => e.id === f.id)) continue; nube.eventos.push({ ...f, seq: ++nube.seq, user_id: uid, srv_at: new Date().toISOString() }); }
        return json(route, 201);
      }
      let rows = nube.eventos.slice();
      const p = url.searchParams;
      if(p.get("tipo")){ const t = p.get("tipo").replace(/^in\.\(|\)$/g, "").split(","); rows = rows.filter(e => t.includes(e.tipo)); }
      if(p.get("srv_at")) rows = rows.filter(e => e.srv_at >= p.get("srv_at").replace("gte.", ""));
      if(p.get("seq")) rows = rows.filter(e => e.seq > +p.get("seq").replace("gt.", ""));
      if(p.get("guia")){ const g = p.get("guia"); rows = g.startsWith("eq.") ? rows.filter(e => e.guia === g.slice(3)) : rows.filter(e => e.guia && e.guia.endsWith(g.replace("like.*", ""))); }
      for(const f of p.getAll("at")){ const v = f.replace(/^(gte|lt)\./, ""); rows = rows.filter(e => f.startsWith("gte.") ? e.at >= v : e.at < v); }
      rows.sort((a, b) => a.seq - b.seq); if(p.get("order") === "seq.desc") rows.reverse();
      if(/^(guia\.asc,)?at\.asc$/.test(p.get("order") || "")) rows.sort((a, b) => (a.guia || "").localeCompare(b.guia || "") || a.at.localeCompare(b.at));
      if(p.get("limit")) rows = rows.slice(0, +p.get("limit"));
      return json(route, 200, rows);
    }
    return json(route, 404, { message: "no simulado: " + url.pathname });
  });
}
module.exports = { crearNube, conectarNube };
