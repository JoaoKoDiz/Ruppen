// =====================================================================
//  Gerador do relevo das ilhas (usado offline por tools/bake-terrain.js;
//  no navegador só como reserva se src/world/terrainData.js estiver
//  desatualizado). Determinístico (SEED).
//
//  Por ilha, numa grade N×N cobrindo ±boundRadius:
//   1. forma macro: costa/planície/praia/plataforma como antes (contorno
//      outlineRadius) + maciços arredondados (2–4 picos de cimo largo ligados
//      por espinhaços, perfil côncavo), alturas limitadas pela distância à costa,
//      esporões (ridged) e ondulação (fbm com domínio deformado);
//   2. incisão FLUVIAL (lei de potência do fluxo, implícita — Braun & Willett
//      2013) + difusão de encosta: rede de vales dendrítica até o nível do mar,
//      cristas arredondadas; a planície costeira é preservada (só os canais
//      grandes a cortam); erosão térmica (tálus);
//   3. erosão HIDRÁULICA por gotas (Beyer 2015 / Lague): inércia,
//      capacidade ∝ declive·velocidade·água, deposição, evaporação, raio de
//      erosão; gotas que chegam ao mar despejam o sedimento (leques submersos);
//      + erosão TÉRMICA (ângulo de repouso: cones de tálus);
//   4. costa recolocada no contorno (o mapa continua válido);
//   5. drenagem: preenchimento de depressões (priority-flood), D8 (rios) e
//      MFD (máscara de fluxo), rios principais (polilinhas até o mar) com o
//      leito escavado de forma monotônica.
//  Saída: alturas (m), fluxo (0..1, log), erosão/deposição das gotas e tálus (m), rios.
// =====================================================================
import { ISLANDS, SEED } from '../config.js';
import { createNoise } from '../util/noise.js';
import { createRng } from '../util/rng.js';

// Cada ilha: centro, raio base, harmônicas do contorno (formato único), altura dos picos e
// número de picos do maciço.
export const ISLAND_DEFS = [
  { cx: -18000, cz: -12000, R: 2700, maxH: 1600, peaks: 3, harmonics: [[0.26, 2, 0.4], [0.14, 3, 1.9], [0.07, 5, 0.3]], seedOff: 11 }, // alongada
  { cx: 14000, cz: -20000, R: 2300, maxH: 1350, peaks: 3, harmonics: [[0.30, 3, 2.2], [0.10, 4, 0.9], [0.06, 7, 1.1]], seedOff: 23 }, // trilobada
  { cx: 22000, cz: 10000, R: 3100, maxH: 1800, peaks: 4, harmonics: [[0.18, 1, 0.0], [0.22, 2, 2.6], [0.08, 6, 0.5]], seedOff: 37 }, // grande c/ baía
  { cx: -9000, cz: 19000, R: 2400, maxH: 1400, peaks: 3, harmonics: [[0.34, 1, 1.2], [0.12, 4, 2.4], [0.05, 9, 0.7]], seedOff: 41 }, // com "cauda"
  { cx: -3000, cz: 5500, R: 1900, maxH: 1200, peaks: 3, harmonics: [[0.12, 2, 0.8], [0.10, 5, 1.5], [0.05, 8, 2.2]], seedOff: 53 }, // redonda, perto do início
];

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// máximo suave polinomial (excede o máximo em no máximo k/4)
const smax = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; };
const softmin = (a, b, k) => { const m = Math.min(a, b); return m - k * Math.log(Math.exp((m - a) / k) + Math.exp((m - b) / k)); };

export function outlineRadiusOf(d, theta) {
  let f = 1;
  for (const [a, k, p] of d.harmonics) f += a * Math.sin(k * theta + p);
  return d.R * Math.max(0.35, f);
}

// assinatura dos parâmetros (o dado assado só vale se bater)
export function terrainSignature() {
  const s = JSON.stringify([ISLAND_DEFS, ISLANDS.TERRAIN, SEED, 4]);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

// grade da ilha (mesma no gerador e na leitura)
export function islandGrid(d) {
  const N = ISLANDS.TERRAIN.GRID, G = d.R * 1.75;
  return { N, G, cs: (2 * G) / (N - 1), x0: d.cx - G, z0: d.cz - G };
}

// ------------------- transformada de distância euclidiana -------------------
function edt1d(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -1e30; z[1] = 1e30;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = 1e30;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}
// distância (em células) de cada célula com mask=1 até a célula mais próxima com mask=0
function distanceField(mask, N) {
  const INF = 1e20, out = new Float32Array(N * N);
  const f = new Float64Array(N), dd = new Float64Array(N), v = new Int32Array(N), z = new Float64Array(N + 1);
  for (let i = 0; i < N * N; i++) out[i] = mask[i] ? INF : 0;
  for (let i = 0; i < N; i++) { // colunas
    for (let j = 0; j < N; j++) f[j] = out[j * N + i];
    edt1d(f, N, dd, v, z);
    for (let j = 0; j < N; j++) out[j * N + i] = dd[j];
  }
  for (let j = 0; j < N; j++) { // linhas
    for (let i = 0; i < N; i++) f[i] = out[j * N + i];
    edt1d(f, N, dd, v, z);
    for (let i = 0; i < N; i++) out[j * N + i] = Math.sqrt(dd[i]);
  }
  return out;
}

// ------------------------------ heap mínimo ------------------------------
function makeMinHeap(cap) {
  const key = new Float64Array(cap), val = new Int32Array(cap);
  let n = 0;
  return {
    get size() { return n; },
    push(k, v) {
      let i = n++;
      while (i > 0) { const p = (i - 1) >> 1; if (key[p] <= k) break; key[i] = key[p]; val[i] = val[p]; i = p; }
      key[i] = k; val[i] = v;
    },
    pop() { // devolve o valor; a chave fica em lastKey
      const top = val[0]; this.lastKey = key[0];
      const k = key[--n], v = val[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && key[c + 1] < key[c]) c++;
        if (key[c] >= k) break;
        key[i] = key[c]; val[i] = val[c]; i = c;
      }
      key[i] = k; val[i] = v;
      return top;
    },
    lastKey: 0,
  };
}

const NB8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];

// Erosão hidráulica por gotas (Beyer 2015 / Lague) numa grade n×n de alturas normalizadas H
// (passo = 1 célula). base (m) só escolhe onde as gotas nascem (terra). seaN: teto do leque
// submerso (gotas que chegam ao mar despejam o sedimento ali).
function erodeDroplets(H, n, base, dropsPerCell, R, LIFETIME, seaN, P, erng, ek = 1) {
  const { INERTIA, CAPACITY, MIN_CAPACITY, DEPOSIT, EVAPORATE, GRAVITY } = P;
  const ERODE = P.ERODE * ek, MAX_ERODE = P.MAX_ERODE * ek;
  const bOff = [], bW = [];
  { let ws = 0; for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) { const dd = Math.hypot(di, dj); if (dd < R) { bOff.push(dj * n + di); bW.push(R - dd); ws += R - dd; } } for (let q = 0; q < bW.length; q++) bW[q] /= ws; }
  const BO = Int32Array.from(bOff), BW = Float32Array.from(bW), BL = BO.length;
  const landIdx = [];
  for (let k = 0; k < n * n; k++) { const i = k % n, j = (k / n) | 0; if (base[k] > 3 && i > R + 2 && j > R + 2 && i < n - R - 3 && j < n - R - 3) landIdx.push(k); }
  if (!landIdx.length) return;
  const drops = Math.round(dropsPerCell * landIdx.length);
  for (let d = 0; d < drops; d++) {
    const k0 = landIdx[Math.floor(erng() * landIdx.length)];
    let x = (k0 % n) + erng(), y = ((k0 / n) | 0) + erng();
    let dx = 0, dy = 0, speed = 1, water = 1, sed = 0;
    for (let life = 0; life < LIFETIME; life++) {
      const ni = x | 0, nj = y | 0, u = x - ni, v = y - nj, k = nj * n + ni;
      const a = H[k], b = H[k + 1], c = H[k + n], e = H[k + n + 1];
      const gx = (b - a) * (1 - v) + (e - c) * v, gy = (c - a) * (1 - u) + (e - b) * u;
      const h = a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + e * u * v;
      dx = dx * INERTIA - gx * (1 - INERTIA); dy = dy * INERTIA - gy * (1 - INERTIA);
      const len = Math.hypot(dx, dy);
      if (len < 1e-12) break;
      dx /= len; dy /= len;
      x += dx; y += dy;
      if (x < R + 1 || y < R + 1 || x >= n - R - 2 || y >= n - R - 2) break;
      const mi = x | 0, mj = y | 0, mu = x - mi, mv = y - mj, mk = mj * n + mi;
      const nh = H[mk] * (1 - mu) * (1 - mv) + H[mk + 1] * mu * (1 - mv) + H[mk + n] * (1 - mu) * mv + H[mk + n + 1] * mu * mv;
      const dH = nh - h;
      if (nh < 0) { // chegou ao mar: o sedimento assenta espalhado (leque/delta submerso)
        if (sed > 0) for (let q = 0; q < BL; q++) { const kk = mk + BO[q]; H[kk] = Math.min(H[kk] + sed * BW[q], Math.max(H[kk], seaN)); }
        break;
      }
      const cap = Math.max(-dH * speed * water * CAPACITY, MIN_CAPACITY);
      if (sed > cap || dH > 0) {
        const amt = dH > 0 ? Math.min(dH, sed) : (sed - cap) * DEPOSIT;
        sed -= amt;
        H[k] += amt * (1 - u) * (1 - v); H[k + 1] += amt * u * (1 - v);
        H[k + n] += amt * (1 - u) * v; H[k + n + 1] += amt * u * v;
      } else {
        const amt = Math.min((cap - sed) * ERODE, -dH, MAX_ERODE);
        for (let q = 0; q < BL; q++) H[k + BO[q]] -= amt * BW[q];
        sed += amt;
      }
      speed = Math.sqrt(Math.max(0, speed * speed - dH * GRAVITY));
      water *= 1 - EVAPORATE;
    }
  }
}

// Drenagem: priority-flood (Barnes 2014) a partir do mar e da borda → superfície sem depressões F,
// ordem topológica (crescente em F), receptor D8 (descida mais íngreme em F) e área acumulada (células).
function drainage(h, N, ws) {
  const NN = N * N;
  ws = ws || { F: new Float32Array(NN), done: new Uint8Array(NN), order: new Int32Array(NN), rcv: new Int32Array(NN), acc: new Float32Array(NN), heap: makeMinHeap(NN) };
  const { F, done, order, rcv, acc, heap } = ws;
  done.fill(0);
  for (let k = 0; k < NN; k++) {
    const i = k % N, j = (k / N) | 0;
    if (h[k] < 0 || i === 0 || j === 0 || i === N - 1 || j === N - 1) { F[k] = h[k]; done[k] = 1; heap.push(h[k], k); }
  }
  let no = 0;
  while (heap.size) {
    const k = heap.pop(), fk = heap.lastKey;
    order[no++] = k;
    const i = k % N, j = (k / N) | 0;
    for (let q = 0; q < 8; q++) {
      const ii = i + NB8[q][0], jj = j + NB8[q][1];
      if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
      const kk = jj * N + ii;
      if (done[kk]) continue;
      done[kk] = 1;
      F[kk] = Math.max(h[kk], fk + 1e-3);
      heap.push(F[kk], kk);
    }
  }
  rcv.fill(-1);
  for (let k = 0; k < NN; k++) {
    if (h[k] < 0) continue;
    const i = k % N, j = (k / N) | 0;
    if (i === 0 || j === 0 || i === N - 1 || j === N - 1) continue;
    let best = 0, bk = -1;
    for (let q = 0; q < 8; q++) {
      const kk = (j + NB8[q][1]) * N + i + NB8[q][0];
      const s = (F[k] - F[kk]) / (q < 4 ? 1 : Math.SQRT2);
      if (s > best) { best = s; bk = kk; }
    }
    rcv[k] = bk;
  }
  acc.fill(1);
  for (let n = NN - 1; n >= 0; n--) { const k = order[n]; if (rcv[k] >= 0) acc[rcv[k]] += acc[k]; }
  return ws;
}

// Incisão fluvial (lei de potência do fluxo, E = K·A^m·S, implícita de Braun & Willett 2013):
// os canais se aprofundam a partir do nível do mar e a rede de vales cresce para montante,
// ramificando-se (dendrítica) — os divisores entre os vales viram cristas. h em metros.
function streamPower(h, N, cs, iters, K, m, Kd) {
  const ws = drainage(h, N, null);
  const cellA = cs * cs, lap = new Float32Array(N * N);
  for (let it = 0; it < iters; it++) {
    // difusão de encosta (rastejamento do solo): arredonda as cristas (convexas) entre os vales
    if (Kd > 0) {
      for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
        const k = j * N + i;
        lap[k] = h[k] > 0 ? h[k - 1] + h[k + 1] + h[k - N] + h[k + N] - 4 * h[k] : 0;
      }
      for (let k = 0; k < N * N; k++) if (lap[k] !== 0) h[k] = Math.max(h[k] + Kd * lap[k], Math.min(h[k], 0.4));
    }
    if (it % 2 === 0 && it) drainage(h, N, ws);
    const { order, rcv, acc } = ws;
    for (let n = 0; n < order.length; n++) { // receptores antes dos doadores
      const k = order[n], r = rcv[k];
      if (r < 0 || h[k] < 0) continue;
      const hr = Math.max(h[r], -0.5);
      if (h[k] <= hr) continue;
      const dist = ((k - r === 1 || r - k === 1 || k - r === N || r - k === N) ? 1 : Math.SQRT2) * cs;
      const f = K * (0.12 + 0.88 * Math.min(1, Math.max(0, (h[k] - 15) / 220))) * Math.pow(acc[k] * cellA, m) / dist; // planícies costeiras resistem
      h[k] = (h[k] + f * hr) / (1 + f);
    }
  }
}

// Erosão térmica: material acima do ângulo de repouso (T = desnível máx. por célula) escorrega para
// os vizinhos mais baixos (Jacobi, determinístico). Só terra (H > 0) cede material.
function thermal(H, N, T, iters, rate, talus = null, tScale = 1) {
  const NN = N * N, dlt = new Float32Array(NN), H0 = talus ? Float32Array.from(H) : null;
  for (let it = 0; it < iters; it++) {
    dlt.fill(0);
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      const k = j * N + i, h = H[k];
      if (h <= 0) continue;
      let tot = 0, mx = 0;
      for (let q = 0; q < 8; q++) {
        const ex = h - H[k + NB8[q][1] * N + NB8[q][0]] - T * (q < 4 ? 1 : Math.SQRT2);
        if (ex > 0) { tot += ex; if (ex > mx) mx = ex; }
      }
      if (tot <= 0) continue;
      const mv = rate * mx;
      dlt[k] -= mv;
      for (let q = 0; q < 8; q++) {
        const kk = k + NB8[q][1] * N + NB8[q][0];
        const ex = h - H[kk] - T * (q < 4 ? 1 : Math.SQRT2);
        if (ex > 0) dlt[kk] += mv * ex / tot;
      }
    }
    for (let k = 0; k < NN; k++) H[k] += dlt[k];
  }
  if (talus) for (let k = 0; k < NN; k++) talus[k] = Math.max(0, talus[k] + (H[k] - H0[k]) * tScale); // ganho líquido
}

// ============================ gerador principal ============================
export function generateIslandTerrain(d, id) {
  const P = (typeof process !== 'undefined' && process.env && process.env.TERRAIN_P) ? Object.assign({}, ISLANDS.TERRAIN, JSON.parse(process.env.TERRAIN_P)) : ISLANDS.TERRAIN;
  const { N, G, cs, x0, z0 } = islandGrid(d);
  const NN = N * N;
  const noise = createNoise(SEED);                     // mesmo ruído das colinas de antes
  const mn = createNoise(SEED + 1000 + id * 17);       // maciços
  const rng = createRng(SEED + 5000 + id * 31);
  const ox = (d.seedOff * 1000) | 0;

  // ---- 1. costa, planície e distância à costa ----
  const U = new Float32Array(NN), coastal = new Float32Array(NN);
  const land = new Uint8Array(NN);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, x = x0 + i * cs, z = z0 + j * cs;
    const dx = x - d.cx, dz = z - d.cz;
    const u = Math.hypot(dx, dz) / outlineRadiusOf(d, Math.atan2(dz, dx));
    U[k] = u;
    const s = 1 / 1400;
    const hills = noise.fbm2((x - ox) * s * 3.1, (z + ox) * s * 3.1, 3, 2, 0.5);
    const inland = smoothstep(1.0, 0.62, u);
    const lowland = P.LOWLAND * inland + 0.55 * P.LOWLAND * hills * inland;
    const beach = 14 * smoothstep(1.03, 0.9, u);
    const shelf = u > 1.0 ? -(u - 1.0) * 1600 : 0;
    coastal[k] = lowland + beach + shelf - 10 * (1 - inland);
    land[k] = coastal[k] > 0 ? 1 : 0;
  }
  const DC = distanceField(land, N); // células até o mar
  let dcMax = 0;
  for (let k = 0; k < NN; k++) if (DC[k] > dcMax) dcMax = DC[k];

  // ---- 2. picos (alturas limitadas pela distância à costa: encostas médias ≤ ~CAP_SLOPE) ----
  const peaks = [];
  const nPk = d.peaks;
  for (let p = 0; p < nPk; p++) {
    let best = -1e9, bi = 0, bj = 0;
    for (let t = 0; t < 600; t++) {
      const i = 1 + Math.floor(rng() * (N - 2)), j = 1 + Math.floor(rng() * (N - 2)), k = j * N + i;
      if (DC[k] < (p === 0 ? 0.65 : 0.5) * dcMax) continue;
      let sep = 1;
      for (const q of peaks) sep = Math.min(sep, Math.hypot(q.i - i, q.j - j) * cs / (0.55 * d.R));
      const sc = DC[k] / dcMax + (p ? 1.1 * sep : 0) + 0.25 * rng();
      if (sc > best) { best = sc; bi = i; bj = j; }
    }
    const lim = P.PEAK_DC * (DC[bj * N + bi] * cs - P.COAST_FLAT);
    const hk = p === 0 ? Math.min(lim, d.maxH) : Math.min(lim * 1.08, peaks[0].h * (0.8 + 0.15 * rng()));
    peaks.push({ i: bi, j: bj, h: hk, r: hk * P.PEAK_SPREAD * (0.9 + 0.3 * rng()) / cs });
  }

  const spines = [];
  for (let p = 1; p < peaks.length; p++) {
    let bq = 0, bd = Infinity;
    for (let q = 0; q < p; q++) { const dd = Math.hypot(peaks[p].i - peaks[q].i, peaks[p].j - peaks[q].j); if (dd < bd) { bd = dd; bq = q; } }
    spines.push([bq, p, 0.18 + 0.2 * rng()]); // [de, para, profundidade relativa do colo]
  }
  // ---- 3. maciço (perfil côncavo de topo suave) + esporões + limite pela costa ----
  const base = new Float32Array(NN);
  const A = 2.2;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i;
    if (U[k] > 1.3) { base[k] = coastal[k]; continue; }
    const x = x0 + i * cs, z = z0 + j * cs;
    const wx = x + 420 * mn.fbm2(x / 1700 + 3.1, z / 1700 - 1.7, 3, 2, 0.5);
    const wz = z + 420 * mn.fbm2(x / 1700 - 7.3, z / 1700 + 5.9, 3, 2, 0.5);
    let acc = 0;
    const pi = i + (wx - x) / cs * 0.6, pj = j + (wz - z) / cs * 0.6;
    for (const q of peaks) {
      const t = Math.max(0, Math.hypot(pi - q.i, pj - q.j) / q.r - P.SUMMIT);   // cimo largo (a erosão o recorta)
      const m = q.h * (1 + A * t) * Math.exp(-A * t);
      acc = smax(acc, m, 140);
    }
    // espinhaço: crista entre cada pico e o pico anterior mais próximo (maciço, não cones soltos)
    for (const sg of spines) {
      const a = peaks[sg[0]], b = peaks[sg[1]];
      const ex = b.i - a.i, ez = b.j - a.j, L2 = ex * ex + ez * ez;
      let u = ((pi - a.i) * ex + (pj - a.j) * ez) / L2;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const r = a.r + (b.r - a.r) * u, hh = (a.h + (b.h - a.h) * u) * (1 - sg[2] * Math.sin(Math.PI * u));
      const t = Math.max(0, Math.hypot(pi - a.i - ex * u, pj - a.j - ez * u) / (r * 0.85) - P.SUMMIT * 0.6);
      acc = smax(acc, hh * (1 + A * t) * Math.exp(-A * t), 140);
    }
    let m = acc;
    const und = 0.5 + 0.5 * mn.fbm2(wx / 2300, wz / 2300, 3, 2, 0.5);
    const rid = mn.ridged2(wx / 1250 + 11.1, wz / 1250 - 4.4, 4, 2.0, 0.5);
    m *= 0.8 + 0.32 * und;
    m += m * P.SPUR * (rid - 0.45);
    // relevo de média escala (quebra as encostas uniformes: a drenagem converge e ramifica)
    m += m * 0.16 * mn.fbm2(wx / 640 - 5.5, wz / 640 + 2.5, 4, 2.1, 0.55) + 30 * mn.fbm2(wx / 260, wz / 260, 3, 2, 0.5) * smoothstep(0, 250, m);
    // o maciço cai suavemente para a costa (multiplicativo: sem facetas planas) e um teto de declive
    // de segurança pela distância à costa (algumas costas mais íngremes)
    const steep = P.CAP_SLOPE * (0.82 + 0.3 * (0.5 + 0.5 * mn.fbm2(x / 1500 - 2.2, z / 1500 + 8.8, 2, 2, 0.5)));
    const dm = Math.max(0, DC[k] * cs - P.COAST_FLAT);
    const Lf = P.COAST_FALL * (0.75 + 0.5 * (0.5 + 0.5 * mn.fbm2(x / 1900 + 6.6, z / 1900 - 3.1, 2, 2, 0.5)));
    m *= 1 - Math.exp(-Math.pow(dm / Lf, 1.6));
    const cap = steep * dm * 1.25;
    base[k] = coastal[k] + Math.max(0, softmin(Math.max(0, m), cap, 60));
  }

  // ---- 3b. incisão fluvial (rede de vales dendrítica até o mar) + encostas no ângulo de repouso ----
  const spl = Float32Array.from(base);
  const talus = new Float32Array(NN);   // material acumulado pela erosão térmica (cones de tálus), m
  let dropD = null;                     // variação líquida causada pelas gotas (nível fino), m
  if (P.SPL_ITERS > 0) {
    streamPower(spl, N, cs, P.SPL_ITERS, P.SPL_K, P.SPL_M, P.DIFFUSION);
    // a planície costeira não é arrasada: só os canais com bacia grande descem até o mar
    const dr = drainage(spl, N, null), aCh = P.RIVER_AREA / (cs * cs);
    for (let k = 0; k < NN; k++) {
      if (coastal[k] <= 0) continue;
      const floor = coastal[k] * 0.85 * (1 - smoothstep(aCh * 0.3, aCh * 1.5, dr.acc[k]));
      if (spl[k] < floor) spl[k] = floor;
    }
    thermal(spl, N, Math.tan(P.TALUS_DEG * Math.PI / 180) * cs, P.THERMAL_ITERS, P.THERMAL_RATE, talus, 1);
  }

  // ---- 4. erosão hidráulica por gotas (ISLANDS.TERRAIN.LEVELS: um ou mais níveis, do grosso ao fino) ----
  // Cada nível: alturas normalizadas por maxH·(célula/célula fina) → o mesmo regime de declive
  // por passo; a diferença erodida é ampliada (bilinear) e somada ao relevo do nível seguinte.
  // (TERRAIN_P / TERRAIN_LEVELS no ambiente do Node sobrepõem parâmetros — só para experimentar com
  // tools/bake-terrain.js --only/--png; com sobreposições o bake não grava o módulo.)
  const hn = d.maxH;
  const erng = createRng(SEED + 7000 + id * 13);
  const down = (src, n, f) => { // média f×f
    const m = n / f, out = new Float32Array(m * m);
    for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
      let s = 0;
      for (let b = 0; b < f; b++) for (let a = 0; a < f; a++) s += src[(j * f + b) * n + i * f + a];
      out[j * m + i] = s / (f * f);
    }
    return out;
  };
  const up = (src, m, f) => { // bilinear ×f
    const n = m * f, out = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      const fy = Math.min(m - 1.0001, Math.max(0, (j + 0.5) / f - 0.5)), jy = fy | 0, v = fy - jy;
      for (let i = 0; i < n; i++) {
        const fx = Math.min(m - 1.0001, Math.max(0, (i + 0.5) / f - 0.5)), ix = fx | 0, u = fx - ix, k = jy * m + ix;
        out[j * n + i] = (src[k] * (1 - u) + src[k + 1] * u) * (1 - v) + (src[k + m] * (1 - u) + src[k + m + 1] * u) * v;
      }
    }
    return out;
  };
  let delta = null; // metros, na resolução do nível anterior
  let H = null;
  const LEVELS = (typeof process !== 'undefined' && process.env && process.env.TERRAIN_LEVELS) ? JSON.parse(process.env.TERRAIN_LEVELS) : P.LEVELS;
  for (let lv = 0; lv < LEVELS.length; lv++) {
    const [f, dpc, rad, life, ek = 1] = LEVELS[lv];
    const n = N / f;
    const bL = f > 1 ? down(spl, N, f) : spl;
    const cur = new Float32Array(n * n);
    const dUp = delta ? up(delta, delta.n, delta.n === n ? 1 : n / delta.n) : null;
    for (let k = 0; k < n * n; k++) cur[k] = bL[k] + (dUp ? dUp[k] : 0);
    const scale = hn * f;
    H = new Float32Array(n * n);
    for (let k = 0; k < n * n; k++) H[k] = cur[k] / scale;
    const H0 = lv === LEVELS.length - 1 ? Float32Array.from(H) : null;
    erodeDroplets(H, n, bL, dpc, rad, life, -0.5 / scale, P, erng, ek);
    if (H0) { dropD = new Float32Array(n * n); for (let k = 0; k < n * n; k++) dropD[k] = (H[k] - H0[k]) * scale; }
    if (lv === LEVELS.length - 1) break;
    delta = new Float32Array(n * n); delta.n = n;
    for (let k = 0; k < n * n; k++) delta[k] = H[k] * scale - bL[k];
  }

  // ---- 5. erosão térmica (tálus) ----
  thermal(H, N, Math.tan(P.TALUS_DEG * Math.PI / 180) * cs / hn, P.THERMAL_ITERS, P.THERMAL_RATE, talus, hn);

  // ---- 6. de volta a metros + costa recolocada no contorno ----
  const h = new Float32Array(NN);
  for (let k = 0; k < NN; k++) {
    let v = H[k] * hn;
    const b = base[k];
    if (b <= 0) v = Math.min(v, Math.min(-0.4, b + 30));               // mar continua mar (leques submersos rasos)
    else v = Math.max(v, Math.min(b, 0.4 + 0.1 * b));                   // terra continua terra
    h[k] = v;
  }

  // ---- 7. drenagem: priority-flood + D8 + acumulação ----
  const { F, order, rcv, acc } = drainage(h, N, null);

  // ---- 8. rios principais: cabeceiras → mar; leito monotônico escavado ----
  const cellA = cs * cs;
  const aMin = Math.round(P.RIVER_AREA / cellA), aMouth = Math.round(P.RIVER_MOUTH_AREA / cellA);
  const isRiv = new Uint8Array(NN);
  for (let k = 0; k < NN; k++) if (acc[k] >= aMin && h[k] >= 0) isRiv[k] = 1;
  // foz de cada célula de rio (para filtrar sistemas pequenos)
  const outlet = new Int32Array(NN).fill(-1);
  for (let n = 0; n < NN; n++) { // ordem crescente de F: o receptor já tem a foz
    const k = order[n];
    if (!isRiv[k]) continue;
    const r = rcv[k];
    outlet[k] = (r >= 0 && isRiv[r]) ? outlet[r] : (r >= 0 ? r : k);
  }
  const hasDonor = new Uint8Array(NN);
  for (let k = 0; k < NN; k++) if (isRiv[k] && rcv[k] >= 0 && isRiv[rcv[k]]) hasDonor[rcv[k]] = 1;
  // sistemas mantidos: foz ≥ RIVER_MOUTH_AREA, ou os RIVER_SYSTEMS maiores da ilha (ilhas pequenas também têm rios)
  const outs = [...new Set(Array.from(outlet).filter((o) => o >= 0))].map((o) => acc[o]).sort((a, b) => b - a);
  const nSys = Math.round(P.RIVER_SYSTEMS * d.R / 2500);
  const aKeep = Math.max(aMin * 1.5, Math.min(aMouth, outs[Math.min(outs.length - 1, nSys - 1)] || aMouth));
  const heads = [];
  for (let k = 0; k < NN; k++) if (isRiv[k] && !hasDonor[k] && acc[outlet[k]] >= aKeep) heads.push(k);
  heads.sort((a, b) => F[b] - F[a]); // os mais altos primeiro: o tronco principal é traçado inteiro
  const visited = new Int32Array(NN).fill(-1);
  const rivers = [];
  for (const hk of heads) {
    const path = [];
    let k = hk, join = -1;
    while (k >= 0) {
      if (visited[k] >= 0) { join = k; break; }
      path.push(k);
      if (h[k] < 0) break;
      k = rcv[k];
    }
    if (path.length < 3) continue;
    for (const pk of path) visited[pk] = rivers.length;
    if (join >= 0) path.push(join);
    // prolonga um pouco mar adentro (foz)
    if (join < 0 && path.length) {
      let kk = path[path.length - 1];
      const i0 = kk % N, j0 = (kk / N) | 0, pr = path[Math.max(0, path.length - 4)];
      const di = Math.sign(i0 - (pr % N)), dj = Math.sign(j0 - ((pr / N) | 0));
      for (let s = 1; s <= 3 && (di || dj); s++) {
        const ii = i0 + di * s, jj = j0 + dj * s;
        if (ii < 1 || jj < 1 || ii >= N - 1 || jj >= N - 1) break;
        path.push(jj * N + ii);
      }
    }
    if (path.length < 3) continue;
    rivers.push({ path, join: join >= 0 ? visited[join] : -1 });
  }
  // leito: monotônico (não sobe rio abaixo) e um pouco escavado (mais nos rios largos)
  const riverW = (a) => Math.min(P.RIVER_W[1], P.RIVER_W[0] + P.RIVER_W_K * Math.sqrt(a * cellA / 1e6));
  for (const r of rivers) {
    let prev = Infinity;
    for (let n = 0; n < r.path.length; n++) {
      const k = r.path[n];
      const w = riverW(acc[k]);
      const depth = 0.6 + 0.12 * w;
      let v = Math.min(h[k] - depth, prev - 0.02);
      if (h[k] >= 0 && n < r.path.length - 1) v = Math.max(v, Math.min(0.35, h[k]));
      if (v < h[k]) {
        h[k] = v;
        if (w > cs * 0.6) { // rios largos: margens rebaixadas junto
          const i = k % N, j = (k / N) | 0;
          for (let q = 0; q < 4; q++) { const kk = (j + NB8[q][1]) * N + i + NB8[q][0]; h[kk] = Math.min(h[kk], Math.max(v + 0.5 * depth, h[kk] - 0.5 * depth)); }
        }
      }
      prev = Math.min(prev, h[k]);
    }
  }

  // ---- 9. máscaras ----
  const flow = new Float32Array(NN), ero = new Float32Array(NN), dep = new Float32Array(NN), tal = new Float32Array(NN);
  // fluxo para as máscaras: acumulação MFD (Freeman: divide entre todos os vizinhos mais baixos ∝ declive^1,1)
  // — talvegues contínuos e suaves, sem os degraus do D8
  const mfd = new Float32Array(NN).fill(1), wq = new Float32Array(8);
  for (let n = NN - 1; n >= 0; n--) {
    const k = order[n], i = k % N, j = (k / N) | 0;
    if (h[k] < 0 || i === 0 || j === 0 || i === N - 1 || j === N - 1) continue;
    let tot = 0;
    for (let q = 0; q < 8; q++) {
      const s = (F[k] - F[k + NB8[q][1] * N + NB8[q][0]]) / (q < 4 ? 1 : Math.SQRT2);
      wq[q] = s > 0 ? Math.pow(s, 1.1) * (q < 4 ? 1 : 0.7071) : 0; tot += wq[q];
    }
    if (tot <= 0) continue;
    for (let q = 0; q < 8; q++) if (wq[q] > 0) mfd[k + NB8[q][1] * N + NB8[q][0]] += mfd[k] * wq[q] / tot;
  }
  const lmax = Math.log(1 + aMouth * 40);
  for (let k = 0; k < NN; k++) {
    flow[k] = h[k] < -3 ? 0 : Math.min(1, Math.log(mfd[k]) / lmax);
    const dd = dropD ? dropD[k] : 0;
    ero[k] = Math.max(0, -dd);              // ravinas abertas pelas gotas (encostas erodidas)
    dep[k] = Math.max(0, dd);               // deposição das gotas (leques aluviais, fundos de vale)
    tal[k] = h[k] > 0 ? talus[k] : 0;       // cones de tálus (erosão térmica)
  }
  const riverOut = rivers.map((r) => {
    const pts = [];
    for (const k of r.path) pts.push(x0 + (k % N) * cs, z0 + ((k / N) | 0) * cs, riverW(acc[k]));
    return { pts, join: r.join };
  });
  return { N, G, cs, x0, z0, h, flow, ero, dep, tal, rivers: riverOut, peaks: peaks.map((q) => ({ x: x0 + q.i * cs, z: z0 + q.j * cs, h: q.h })) };
}
