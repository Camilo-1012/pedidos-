// Tiempo de ordenar en un celular simulado (CPU ×4 más lenta): sin internet y con calles reales (matriz simulada).
const { chromium, devices } = require("playwright");
const S = require("./simulador.js");
const net = S.buildNet(7);
const ll = p => ({lat: 4.70 + (p.y-125)*0.0009, lng: -74.08 - (p.x-104)*0.0009});
const key = p => ll(p).lng.toFixed(6)+","+ll(p).lat.toFixed(6);
(async()=>{
  const b = await chromium.launch(); const ctx = await b.newContext({...devices["Pixel 7"]});
  let D = null, byKey = null;
  await ctx.route(/overpass|kumi|coffee|nominatim|openrouteservice|waze/, r=>r.abort());
  await ctx.route(/routing\.openstreetmap\.de|router\.project-osrm\.org/, async route=>{
    const u = new URL(route.request().url()); if(!u.pathname.includes("/table/")) return route.abort();
    const idx = u.pathname.split("/").pop().split(";").map(c=>byKey.get(c));
    route.fulfill({status:200, contentType:"application/json", headers:{"access-control-allow-origin":"*"}, body:JSON.stringify({code:"Ok", durations: idx.map(i=>idx.map(j=>D[i][j])), distances: idx.map(i=>idx.map(j=>D[i][j]*6))})});
  });
  const p = await ctx.newPage(); await p.goto(process.env.RUTA_URL || "http://localhost:8767/"); await p.waitForTimeout(300);
  await p.fill("#suName","Vel"); await p.fill("#suPin","2580"); await p.fill("#suPin2","2580"); await p.click("#lkSetup button[type=submit]");
  await p.waitForFunction(()=>window.RUTA_LISTA===true);
  const cdp = await ctx.newCDPSession(p); await cdp.send("Emulation.setCPUThrottlingRate", {rate: 4});
  for(const n of (process.argv[2]||"30,60,99").split(",").map(Number)){
    const r = S.rnd(n), pts = [{x:104,y:145}], seen = new Set();
    while(pts.length < n+1){ const q = {x:105+Math.floor(r()*55), y:126+Math.floor(r()*49)}; if(!seen.has(q.x+","+q.y)){ seen.add(q.x+","+q.y); pts.push(q); } }
    D = S.matriz(net, pts, "carro"); byKey = new Map(pts.map((q,i)=>[key(q), i]));
    for(const real of [false, true]){
      const ms = await p.evaluate(async ([pts, lls, real])=>{
        state.stops = pts.slice(1).map((q,i)=>{ const s = mkStop({addr:`Calle ${q.y} # ${q.x}-10`}); s.x=q.x; s.y=q.y; s.label=s.addr; s.lat=lls[i+1].lat; s.lng=lls[i+1].lng; s.geo="osm"; return s; });
        state.startGPS = {x:pts[0].x, y:pts[0].y, lat:lls[0].lat, lng:lls[0].lng, acc:10, t:Date.now()}; state.realRoads = real; save();
        const t0 = performance.now(); quickOrder(); const tq = performance.now() - t0;
        const t1 = performance.now(); await optimize(true); const tr = performance.now() - t1;
        return {tq: Math.round(tq), total: Math.round(tr), info: state.routeNote};
      }, [pts, pts.map(ll), real]);
      console.log(`n=${n} ${real ? "calles reales" : "sin internet "} | orden inmediato ${ms.tq} ms | cálculo completo ${ms.total} ms | ${ms.info.slice(0,60)}`);
    }
  }
  await b.close();
})();
