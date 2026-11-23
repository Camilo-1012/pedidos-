// Agrega al Supabase simulado de Ruta (tests/supabase-falso.js) lo de la bodega: bodega_miembros, bodega_eventos,
// bodega_vinculos y las funciones rpc de supabase/bodega.sql, con sus mismas reglas (RLS) para el repartidor.
// Los usuarios y las sesiones son los de Ruta (tok-<id>), como en la base real: una sola cuenta por persona.
const SB = "https://aptyzcodlubefqrscmvc.supabase.co";
function agregarBodega(sb){
  const db = sb.db;
  db.bod = { miembros: [{ user_id: "u-camilo", nombre: "Camilo", rol: "admin" }], eventos: [], seq: 0, vinculos: [], datos: new Map() };
  const B = db.bod;
  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: body === undefined ? "" : JSON.stringify(body) });
  const uidDe = req => { const m = /Bearer tok-(.+)$/.exec(req.headers()["authorization"] || ""); return m ? m[1] : null; };
  const miembro = uid => !db.miembros.some(m => m.user_id === uid && m.activo === false) && B.miembros.find(m => m.user_id === uid);
  const admin = uid => (miembro(uid) || {}).rol === "admin";
  const miRid = uid => db.miembros.some(m => m.user_id === uid && m.activo === false) ? null : (B.vinculos.find(v => v.user_id === uid) || {}).rid || null;
  // Igual a bodega_estado_guias(): último movimiento que cambia el estado, sin los anulados.
  function estado(){
    const anul = new Set(B.eventos.filter(e => e.tipo === "ANULAR").map(e => e.d.ref));
    const m = new Map();
    for (const e of B.eventos){
      if (!e.guia || anul.has(e.id) || !["RECIBIDO", "ASIGNADO", "DEVUELTO", "ENTREGADO", "FALTANTE"].includes(e.tipo)) continue;
      const p = m.get(e.guia);
      if (!p || e.at > p.at || (e.at === p.at && e.id > p.id)) m.set(e.guia, e);
    }
    return m;
  }
  const asignadaA = (g, r) => { const e = estado().get(g); return !!e && e.tipo === "ASIGNADO" && e.d.rid === r; };
  async function manejar(route){
    const req = route.request(), url = new URL(req.url()), path = url.pathname, p = url.searchParams, metodo = req.method();
    const uid = uidDe(req); if (!uid) return json(route, 401, { message: "JWT" });
    if (path === "/rest/v1/bodega_miembros"){
      const q = (p.get("user_id") || "").replace("eq.", "");
      return json(route, 200, miembro(uid) ? B.miembros.filter(m => !q || m.user_id === q).map(m => ({ nombre: m.nombre, rol: m.rol })) : []);
    }
    if (path === "/rest/v1/bodega_vinculos"){
      if (metodo === "GET") return json(route, 200, B.vinculos.filter(v => miembro(uid) || v.user_id === uid));
      if (!admin(uid)) return json(route, 403, { code: "42501", message: "row-level security" });
      if (metodo === "POST"){ for (const f of JSON.parse(req.postData())){ B.vinculos = B.vinculos.filter(v => v.rid !== f.rid); B.vinculos.push(f); } return json(route, 201); }
      if (metodo === "DELETE"){ const r = (p.get("rid") || "").replace("eq.", ""); B.vinculos = B.vinculos.filter(v => v.rid !== decodeURIComponent(r)); return json(route, 204); }
    }
    if (path === "/rest/v1/rpc/bodega_mi_rid") return json(route, 200, miRid(uid));
    // v2.41: datos de entrega (datos-entrega.sql). Solo la bodega sube/lee; el repartidor, solo lo asignado a él.
    if (path === "/rest/v1/bodega_datos_entrega"){
      if (!miembro(uid)) return json(route, 403, { code: "42501", message: "new row violates row-level security policy" });
      if (metodo === "POST"){ for (const f of JSON.parse(req.postData())) B.datos.set(f.guia, { ...(B.datos.get(f.guia) || {}), ...f }); return json(route, 201); }
      return json(route, 200, [...B.datos.values()]);
    }
    if (path === "/rest/v1/rpc/bodega_mis_datos"){
      const r = miRid(uid); if (!r) return json(route, 200, []);
      return json(route, 200, [...B.datos.values()].filter(d => asignadaA(d.guia, r)));
    }
    if (path === "/rest/v1/rpc/bodega_cuentas_ruta") return json(route, 200, admin(uid) ? db.miembros.map(m => ({ user_id: m.user_id, nombre: m.nombre })) : []);
    if (path === "/rest/v1/rpc/bodega_mis_asignados"){
      const r = miRid(uid); if (!r) return json(route, 200, []);
      const filas = [...estado().values()].filter(e => e.tipo === "ASIGNADO" && e.d.rid === r).sort((a, b) => a.at.localeCompare(b.at)).map(e => {
        const ult = tipos => B.eventos.filter(x => x.guia === e.guia && tipos.includes(x.tipo)).sort((a, b) => b.at.localeCompare(a.at));
        const rec = ult(["RECIBIDO", "ESPERADO"]).find(x => x.d.emp), ub = ult(["UBICACION"]).find(x => x.d.cl != null);
        return { guia: e.guia, emp: rec ? rec.d.emp : null, asignado: e.at, cl: ub ? ub.d.cl : null, kr: ub ? ub.d.kr : null, rid: r, zona: e.d.zona || null, zonas: e.d.zonas || null };
      });
      return json(route, 200, filas);
    }
    if (path === "/rest/v1/bodega_eventos"){
      if (metodo === "POST"){
        const filas = JSON.parse(req.postData()), r = miRid(uid);
        // Como en Supabase real: el upsert (on_conflict) también pide permiso de lectura; el repartidor no lo tiene.
        if (p.get("on_conflict") && !miembro(uid)) return json(route, 403, { code: "42501", message: "new row violates row-level security policy for table \"bodega_eventos\"" });
        // Sin on_conflict, un id repetido es error de llave duplicada.
        if (!p.get("on_conflict") && filas.some(f => B.eventos.some(e => e.id === f.id))) return json(route, 409, { code: "23505", message: "duplicate key value violates unique constraint \"bodega_eventos_pkey\"" });
        const permitido = f => {
          if (miembro(uid)) return !(["REP", "ZONA"].includes(f.tipo) && !admin(uid));
          // Repartidor: solo sus reportes de guías que hoy están en ruta con él, y deshacer sus propios reportes.
          if (["ENTREGADO", "NO_ENTREGADO"].includes(f.tipo)) return !!r && f.d.rid === r && asignadaA(f.guia, r);
          if (f.tipo === "ANULAR") return !!r && B.eventos.some(x => x.id === f.d.ref && x.user_id === uid && ["ENTREGADO", "NO_ENTREGADO"].includes(x.tipo));
          return false;
        };
        if (filas.some(f => !permitido(f))) return json(route, 403, { code: "42501", message: "new row violates row-level security policy" });
        for (const f of filas){ if (B.eventos.some(e => e.id === f.id)) continue; B.eventos.push({ ...f, seq: ++B.seq, user_id: uid, srv_at: new Date().toISOString() }); }
        return json(route, 201);
      }
      if (!miembro(uid)) return json(route, 200, []);   // el repartidor no lee la tabla
      let rows = B.eventos.slice();
      if (p.get("tipo")){ const t = p.get("tipo").replace(/^in\.\(|\)$/g, "").split(","); rows = rows.filter(e => t.includes(e.tipo)); }
      if (p.get("srv_at")) rows = rows.filter(e => e.srv_at >= p.get("srv_at").replace("gte.", ""));
      if (p.get("seq")) rows = rows.filter(e => e.seq > +p.get("seq").replace("gt.", ""));
      rows.sort((a, b) => a.seq - b.seq); if (p.get("order") === "seq.desc") rows.reverse();
      if (p.get("limit")) rows = rows.slice(0, +p.get("limit"));
      return json(route, 200, rows);
    }
    return route.fallback();
  }
  return { instalar: async ctx => { await sb.instalar(ctx); await ctx.route(SB + "/rest/v1/**", manejar); } };
}
module.exports = { agregarBodega };
