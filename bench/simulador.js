// Simulador de calles tipo Suba: cuadrícula carreras 104..160 × calles 125..175.
// Avenidas de doble vía (rápidas); calles locales: ~50 % doble vía, el resto de un solo sentido alternando.
// Dijkstra con estado (nodo, rumbo) y penalidades de giro; la vuelta en U es cara en carro y barata en moto.
const X0 = 104, X1 = 160, Y0 = 125, Y1 = 175;
const AV_Y = new Set([127,132,139,145,153,160,170]), AV_X = new Set([104,110,119,136]);
function rnd(seed){ let s = seed >>> 0; return () => (s = (s*1664525 + 1013904223) >>> 0) / 4294967296; }
function buildNet(seed=7){
  const r = rnd(seed), oneY = new Map(), oneX = new Map();
  for(let y=Y0;y<=Y1;y++) if(!AV_Y.has(y)) oneY.set(y, r() < 0.5 ? 0 : (y%2 ? 1 : -1));   // 0 = doble vía; ±1 = sentido en x
  for(let x=X0;x<=X1;x++) if(!AV_X.has(x)) oneX.set(x, r() < 0.5 ? 0 : (x%2 ? 1 : -1));
  return {oneY, oneX};
}
// Rumbos: 0:+x 1:+y 2:-x 3:-y
const DX = [1,0,-1,0], DY = [0,1,0,-1];
function canMove(net, x, y, h){
  const nx = x+DX[h], ny = y+DY[h];
  if(nx<X0||nx>X1||ny<Y0||ny>Y1) return false;
  if(h===0||h===2){ if(AV_Y.has(y)) return true; const o = net.oneY.get(y); return o===0 || (h===0 ? o===1 : o===-1); }
  if(AV_X.has(x)) return true; const o = net.oneX.get(x); return o===0 || (h===1 ? o===1 : o===-1);
}
function edgeTime(x, y, h){ const av = (h===0||h===2) ? AV_Y.has(y) : AV_X.has(x); return av ? 10 : 22; }
function turnCost(h0, h1, veh){
  if(h0<0 || h0===h1) return 0;
  const d = (h1 - h0 + 4) % 4;
  if(d===2) return veh==="moto" ? 8 : 90;   // vuelta en U
  return d===1 ? 12 : 6;                    // izquierda / derecha (aprox.)
}
// Tiempos desde un nodo a todos (mínimo sobre rumbo de llegada).
function dijkstra(net, sx, sy, veh){
  const W = X1-X0+1, H = Y1-Y0+1, N = W*H*4, dist = new Float64Array(N).fill(Infinity);
  const id = (x,y,h)=>(((y-Y0)*W + (x-X0))*4 + h);
  // Montículo binario simple
  const heap = []; const push = (d,i)=>{ heap.push([d,i]); let k=heap.length-1; while(k>0){ const p=(k-1)>>1; if(heap[p][0]<=heap[k][0]) break; [heap[p],heap[k]]=[heap[k],heap[p]]; k=p; } };
  const pop = ()=>{ const top=heap[0], last=heap.pop(); if(heap.length){ heap[0]=last; let k=0; for(;;){ const l=2*k+1, r=l+1; let m=k; if(l<heap.length&&heap[l][0]<heap[m][0]) m=l; if(r<heap.length&&heap[r][0]<heap[m][0]) m=r; if(m===k) break; [heap[m],heap[k]]=[heap[k],heap[m]]; k=m; } } return top; };
  // Arranque: se puede salir en cualquier rumbo permitido sin costo de giro (se parte detenido).
  for(let h=0;h<4;h++){ const i=id(sx,sy,h); dist[i]=0; push(0,i); }
  while(heap.length){
    const [d,i] = pop(); if(d>dist[i]) continue;
    const h = i%4, n = (i-h)/4, x = X0 + n%W, y = Y0 + Math.floor(n/W);
    for(let h1=0;h1<4;h1++){
      if(!canMove(net,x,y,h1)) continue;
      const nd = d + turnCost(h, h1, veh) + edgeTime(x,y,h1), j = id(x+DX[h1], y+DY[h1], h1);
      if(nd < dist[j]){ dist[j]=nd; push(nd,j); }
    }
  }
  return (x,y)=>Math.min(dist[id(x,y,0)],dist[id(x,y,1)],dist[id(x,y,2)],dist[id(x,y,3)]);
}
function matriz(net, pts, veh){
  return pts.map(a=>{ const f = dijkstra(net, a.x, a.y, veh); return pts.map(b=> a===b ? 0 : f(b.x,b.y)); });
}
// Óptimo exacto (Held-Karp) de un camino abierto que sale del nodo 0 y visita todos.
function optimoExacto(M){
  const n = M.length - 1, FULL = 1<<n, dp = new Float64Array(FULL*n).fill(Infinity);
  for(let j=0;j<n;j++) dp[(1<<j)*n + j] = M[0][j+1];
  for(let S=1;S<FULL;S++) for(let j=0;j<n;j++){
    const v = dp[S*n+j]; if(!(S&(1<<j)) || v===Infinity) continue;
    for(let k=0;k<n;k++){ if(S&(1<<k)) continue; const T=S|(1<<k), c=v+M[j+1][k+1]; if(c<dp[T*n+k]) dp[T*n+k]=c; }
  }
  let best = Infinity; for(let j=0;j<n;j++) best = Math.min(best, dp[(FULL-1)*n+j]);
  return best;
}
// Referencia fuerte para rutas grandes: muchos arranques aleatorios + or-opt/2-opt asimétrico sobre la matriz verdadera.
function costo(M, ord){ let c=0, p=0; for(const i of ord){ c+=M[p][i]; p=i; } return c; }
function busquedaLocal(M, ord){
  let P = ord.slice(), best = costo(M,P), mejoro = true;
  while(mejoro){
    mejoro = false;
    for(let len=1; len<=3; len++) for(let i=0;i+len<=P.length;i++){
      const seg = P.slice(i,i+len), rest = P.slice(0,i).concat(P.slice(i+len));
      for(let j=0;j<=rest.length;j++){ for(const sg of len>1?[seg,seg.slice().reverse()]:[seg]){ const c = rest.slice(0,j).concat(sg,rest.slice(j)); const L = costo(M,c); if(L<best-1e-9){ P=c; best=L; mejoro=true; } } }
    }
    for(let i=0;i<P.length-1;i++) for(let k=i+1;k<P.length;k++){ const c = P.slice(0,i).concat(P.slice(i,k+1).reverse(), P.slice(k+1)); const L = costo(M,c); if(L<best-1e-9){ P=c; best=L; mejoro=true; } }
  }
  return {P, best};
}
function referencia(M, arranques, seed=1){
  const r = rnd(seed), n = M.length-1; let best = Infinity;
  for(let t=0;t<arranques;t++){
    const ord = [...Array(n)].map((_,i)=>i+1).sort(()=>r()-0.5);
    best = Math.min(best, busquedaLocal(M, ord).best);
  }
  return best;
}
module.exports = { buildNet, matriz, optimoExacto, referencia, costo, rnd, X0, X1, Y0, Y1 };
// ---- Costo verdadero con rumbo: el vehículo sale de cada parada mirando hacia donde llegó ----
// Dijkstra desde (nodo, rumbo de llegada): devuelve, para cada destino, el costo por rumbo de llegada.
function dijkstraDesde(net, sx, sy, h0, veh){
  const W = X1-X0+1, H = Y1-Y0+1, N = W*H*4, dist = new Float64Array(N).fill(Infinity);
  const id = (x,y,h)=>(((y-Y0)*W + (x-X0))*4 + h);
  const heap = []; const push = (d,i)=>{ heap.push([d,i]); let k=heap.length-1; while(k>0){ const p=(k-1)>>1; if(heap[p][0]<=heap[k][0]) break; [heap[p],heap[k]]=[heap[k],heap[p]]; k=p; } };
  const pop = ()=>{ const top=heap[0], last=heap.pop(); if(heap.length){ heap[0]=last; let k=0; for(;;){ const l=2*k+1, r=l+1; let m=k; if(l<heap.length&&heap[l][0]<heap[m][0]) m=l; if(r<heap.length&&heap[r][0]<heap[m][0]) m=r; if(m===k) break; [heap[m],heap[k]]=[heap[k],heap[m]]; k=m; } } return top; };
  if(h0 < 0){ for(let h=0;h<4;h++){ const i=id(sx,sy,h); dist[i]=0; push(0,i); } }
  else { const i=id(sx,sy,h0); dist[i]=0; push(0,i); }
  while(heap.length){
    const [d,i] = pop(); if(d>dist[i]) continue;
    const h = i%4, n = (i-h)/4, x = X0 + n%W, y = Y0 + Math.floor(n/W);
    for(let h1=0;h1<4;h1++){
      if(!canMove(net,x,y,h1)) continue;
      const nd = d + turnCost(h, h1, veh) + edgeTime(x,y,h1), j = id(x+DX[h1], y+DY[h1], h1);
      if(nd < dist[j]){ dist[j]=nd; push(nd,j); }
    }
  }
  return (x,y,h)=>dist[id(x,y,h)];
}
// Tabla de tramos: T[i][h][k][h2] = costo de ir de la parada i (llegó con rumbo h; h=-1 para el inicio) a k llegando con rumbo h2.
function tablaRumbos(net, pts, veh){
  return pts.map((a,i)=>{
    const hs = i===0 ? [-1] : [0,1,2,3];
    const porH = {};
    for(const h of hs){ const f = dijkstraDesde(net, a.x, a.y, h, veh); porH[h] = pts.map(b=>[0,1,2,3].map(h2=> a===b ? Infinity : f(b.x,b.y,h2))); }
    return porH;
  });
}
// Costo verdadero de un orden (índices 1..n), siguiendo el rumbo real de llegada.
function costoReal(T, ord){
  let cur = {0:{[-1]:0}}; // posición previa → {rumbo: costo}
  let prev = 0, estados = {[-1]:0};
  for(const k of ord){
    const nuevo = {0:Infinity,1:Infinity,2:Infinity,3:Infinity};
    for(const [h, c] of Object.entries(estados)){ const row = T[prev][h][k]; for(let h2=0;h2<4;h2++) nuevo[h2] = Math.min(nuevo[h2], c + row[h2]); }
    estados = nuevo; prev = k;
  }
  return Math.min(...Object.values(estados));
}
// Óptimo exacto con rumbo (DP sobre conjunto, última parada y rumbo de llegada).
function optimoRumbos(T){
  const n = T.length - 1, FULL = 1<<n, dp = new Float64Array(FULL*n*4).fill(Infinity), ix = (S,j,h)=>((S*n + j)*4 + h);
  for(let j=0;j<n;j++) for(let h=0;h<4;h++) dp[ix(1<<j,j,h)] = T[0][-1][j+1][h];
  for(let S=1;S<FULL;S++) for(let j=0;j<n;j++){ if(!(S&(1<<j))) continue; for(let h=0;h<4;h++){
    const v = dp[ix(S,j,h)]; if(v===Infinity) continue;
    for(let k=0;k<n;k++){ if(S&(1<<k)) continue; const row = T[j+1][h][k+1], T2 = S|(1<<k); for(let h2=0;h2<4;h2++){ const c = v + row[h2]; if(c < dp[ix(T2,k,h2)]) dp[ix(T2,k,h2)] = c; } }
  } }
  let best = Infinity; for(let j=0;j<n;j++) for(let h=0;h<4;h++) best = Math.min(best, dp[ix(FULL-1,j,h)]);
  return best;
}
module.exports.tablaRumbos = tablaRumbos; module.exports.costoReal = costoReal; module.exports.optimoRumbos = optimoRumbos;
// Búsqueda local exhaustiva sobre el costo VERDADERO con rumbo (or-opt 1..3 + 2-opt), para estimar cuánto se podría mejorar.
function mejorarReal(T, ord, maxPasadas=50){
  let P = ord.slice(), best = costoReal(T,P), mejoro = true, pas = 0;
  while(mejoro && pas++ < maxPasadas){
    mejoro = false;
    for(let len=1; len<=3; len++) for(let i=0;i+len<=P.length;i++){
      const seg = P.slice(i,i+len), rest = P.slice(0,i).concat(P.slice(i+len));
      for(let j=0;j<=rest.length;j++){ if(j===i) continue; for(const sg of len>1?[seg,seg.slice().reverse()]:[seg]){ const c = rest.slice(0,j).concat(sg,rest.slice(j)); const L = costoReal(T,c); if(L<best-1e-9){ P=c; best=L; mejoro=true; } } }
    }
    for(let i=0;i<P.length-1;i++) for(let k=i+1;k<P.length;k++){ const c = P.slice(0,i).concat(P.slice(i,k+1).reverse(), P.slice(k+1)); const L = costoReal(T,c); if(L<best-1e-9){ P=c; best=L; mejoro=true; } }
  }
  return best;
}
module.exports.mejorarReal = mejorarReal;
