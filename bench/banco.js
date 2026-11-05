// Banco de pruebas del enrutamiento: la app ordena con los tiempos «tipo servidor» y se mide el costo VERDADERO
// (con rumbo de llegada) contra el óptimo exacto (n ≤ 10) o una referencia fuerte (n grande).
const { chromium, devices } = require("playwright");
const S = require("./simulador.js");
const URL = process.env.RUTA_URL || "http://localhost:8767/";
const net = S.buildNet(7);
const args = process.argv.slice(2);
const SIZES = (args[0]||"8,10").split(",").map(Number), INST = +(args[1]||20), MODOS = (args[2]||"carro,moto,sinred").split(",");

function genera(n, seed){
  const r = S.rnd(seed), pts = [{x:104, y:[132,139,145,153][Math.floor(r()*4)]}], seen = new Set();
  while(pts.length < n+1){ const p = {x:105+Math.floor(r()*55), y:126+Math.floor(r()*49)}; const k = p.x+","+p.y; if(!seen.has(k)){ seen.add(k); pts.push(p); } }
  return pts;
}
const ll = p => ({lat: 4.70 + (p.y-125)*0.0009, lng: -74.08 - (p.x-104)*0.0009});
const key = p => ll(p).lng.toFixed(6)+","+ll(p).lat.toFixed(6);

(async()=>{
  const b = await chromium.launch();
  const ctx = await b.newContext({...devices["Pixel 7"]});
  let D = null, byKey = null;
  await ctx.route(/overpass|kumi|coffee|nominatim|openrouteservice|waze/, r=>r.abort());
  await ctx.route(/routing\.openstreetmap\.de|router\.project-osrm\.org/, async route=>{
    const u = new globalThis.URL(route.request().url());
    if(!u.pathname.includes("/table/")) return route.abort();
    const idx = u.pathname.split("/").pop().split(";").map(c=>byKey.get(c));
    if(idx.some(i=>i===undefined)) return route.abort();
    const durations = idx.map(i=>idx.map(j=>D[i][j])), distances = idx.map(i=>idx.map(j=>D[i][j]*6));
    route.fulfill({status:200, contentType:"application/json", headers:{"access-control-allow-origin":"*"}, body:JSON.stringify({code:"Ok", durations, distances})});
  });
  const p = await ctx.newPage();
  await p.goto(URL); await p.waitForTimeout(300);
  await p.fill("#suName","Bench"); await p.fill("#suPin","2580"); await p.fill("#suPin2","2580"); await p.click("#lkSetup button[type=submit]");
  await p.waitForFunction(()=>window.RUTA_LISTA===true, null, {timeout:30000});
  const res = {};
  for(const n of SIZES){
    for(let s=0;s<INST;s++){
      const pts = genera(n, 1000*n + s);
      D = S.matriz(net, pts, "carro");                       // lo que entrega el servidor (sin rumbo, perfil carro)
      byKey = new Map(pts.map((q,i)=>[key(q), i]));
      const Tc = S.tablaRumbos(net, pts, "carro"), Tm = S.tablaRumbos(net, pts, "moto");
      const exact = n <= 11;
      const optC = exact ? S.optimoRumbos(Tc) : null, optM = exact ? S.optimoRumbos(Tm) : null;
      for(const modo of MODOS){
        const ord = await p.evaluate(async ([pts, modo, lls])=>{
          state.stops = pts.slice(1).map((q,i)=>{ const s = mkStop({addr:`Calle ${q.y} # ${q.x}-10`}); s.x=q.x; s.y=q.y; s.label=s.addr; s.lat=lls[i+1].lat; s.lng=lls[i+1].lng; s.geo="osm"; s.idx=i+1; return s; });
          state.startGPS = {x:pts[0].x, y:pts[0].y, lat:lls[0].lat, lng:lls[0].lng, acc:10, t:Date.now()};
          state.lastDoneId = null; state.start = ""; state.roundTrip = false; state.byZone = false;
          state.vehiculo = /moto/.test(modo) ? "moto" : "carro"; state.realRoads = !/sinred/.test(modo);
          state.zone = {...(state.zone||{}), sectors: !/nosect/.test(modo)};
          save();
          await optimize(true);
          return state.stops.filter(s=>s.status!=="done").map(s=>s.idx);
        }, [pts, modo, pts.map(ll)]);
        const verdadC = S.costoReal(Tc, ord), verdadM = S.costoReal(Tm, ord);
        const r = (res[n+"|"+modo] ||= {gapC:[], gapM:[], n:0, info:new Set()});
        r.n++;
        if(exact){ r.gapC.push(verdadC/optC-1); r.gapM.push(verdadM/optM-1); }
        else {
          // Referencia: lo mejor entre la búsqueda local exhaustiva desde el orden de la app y desde 3 órdenes aleatorios.
          const rr = S.rnd(n*7+s); let refC = S.mejorarReal(Tc, ord), refM = S.mejorarReal(Tm, ord);
          for(let t=0;t<3;t++){ const o = ord.slice().sort(()=>rr()-0.5); refC = Math.min(refC, S.mejorarReal(Tc,o)); refM = Math.min(refM, S.mejorarReal(Tm,o)); }
          r.gapC.push(verdadC/refC-1); r.gapM.push(verdadM/refM-1);
        }
      }
      if(!exact){ // referencia: el mejor de los modos medidos + búsqueda local sobre el costo verdadero
        // (se calcula afuera para no alargar; ver reporte)
      }
      process.stdout.write(".");
    }
  }
  console.log("");
  const pct = a => (100*a.reduce((x,y)=>x+y,0)/a.length).toFixed(2)+" %";
  const mx = a => (100*Math.max(...a)).toFixed(1)+" %";
  for(const [k,r] of Object.entries(res)){
    const [n, modo] = k.split("|");
    if(+n <= 11) console.log(`n=${n} ${modo.padEnd(6)} | sobre el óptimo en CARRO: prom ${pct(r.gapC)} máx ${mx(r.gapC)} | en MOTO: prom ${pct(r.gapM)} máx ${mx(r.gapM)}`);
    else console.log(`n=${n} ${modo.padEnd(6)} | sobre la REFERENCIA en CARRO: prom ${pct(r.gapC)} máx ${mx(r.gapC)} | en MOTO: prom ${pct(r.gapM)} máx ${mx(r.gapM)}`);
  }
  await b.close();
})();
