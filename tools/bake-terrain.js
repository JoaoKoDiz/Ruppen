// Assa o relevo erodido das ilhas em src/world/terrainData.js (base64 de deflate-raw).
//   node tools/bake-terrain.js                 → gera todas as ilhas e grava o módulo
//   node tools/bake-terrain.js --only 4 --png .shots/terrain   → só a ilha 4, sem gravar (prévia PNG)
//   --png <dir>  grava um relevo sombreado (hillshade + rios + fluxo) por ilha
// O jogo lê o módulo em src/world/worldData.js; se a assinatura dos parâmetros não bater
// (ISLAND_DEFS / ISLANDS.TERRAIN mudaram sem re-assar), o navegador gera de novo (lento).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { ISLAND_DEFS, generateIslandTerrain, terrainSignature } from '../src/world/terrainGen.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = {};
for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith('--')) { const v = process.argv[i + 1]; if (v === undefined || v.startsWith('--')) args[a.slice(2)] = true; else { args[a.slice(2)] = v; i++; } } }
const only = args.only !== undefined ? String(args.only).split(',').map(Number) : null;

export const H_MIN = -400, H_STEP = 1 / 25; // m (u16: −400 … +2221 m)
const EMAX = 160, DMAX = 40, TMAX = 80;     // m — escalas (raiz) das máscaras de erosão/deposição/tálus

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function writePNG(file, W, H, rgb) {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; rgb.copy ? rgb.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3) : raw.set(rgb.subarray(y * W * 3, (y + 1) * W * 3), y * (W * 3 + 1) + 1); }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]));
}
function preview(file, t, d) {
  const { N, h, flow, ero, dep, cs } = t;
  const rgb = new Uint8Array(N * N * 3);
  const L = [-0.6, 0.35, -0.6]; const ll = Math.hypot(...L);
  let maxH = 0; for (let k = 0; k < N * N; k++) maxH = Math.max(maxH, h[k]);
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
    const k = j * N + i;
    const nx = -(h[k + 1] - h[k - 1]) / (2 * cs), nz = -(h[k + N] - h[k - N]) / (2 * cs);
    const nl = Math.hypot(nx, 1, nz);
    const sh = Math.max(0, (nx * L[0] + L[1] + nz * L[2]) / (nl * ll));
    let r, g, b;
    if (h[k] < 0) { const dd = Math.min(1, -h[k] / 60); r = 40 + 60 * (1 - dd); g = 90 + 80 * (1 - dd); b = 140 + 60 * (1 - dd); }
    else {
      const e = h[k] / maxH;
      r = 120 + 90 * e; g = 140 + 50 * e; b = 90 + 100 * e;
      if (args.masks) { const de = Math.min(1, dep[k] / 6); r += 80 * de; g += 60 * de; b += 10 * de;
        const er = Math.min(1, ero[k] / 15); r -= 40 * er; g -= 60 * er; b -= 40 * er;
        const ta = Math.min(1, t.tal[k] / 10); r += 50 * ta; g -= 20 * ta; b -= 40 * ta; }
      r *= 0.25 + 0.95 * sh; g *= 0.25 + 0.95 * sh; b *= 0.25 + 0.95 * sh;
      const f = Math.max(0, (flow[k] - 0.55) / 0.45); b += 200 * f; r *= 1 - 0.6 * f; g *= 1 - 0.3 * f;
    }
    rgb[k * 3] = Math.max(0, Math.min(255, r)); rgb[k * 3 + 1] = Math.max(0, Math.min(255, g)); rgb[k * 3 + 2] = Math.max(0, Math.min(255, b));
  }
  for (const r of t.rivers) for (let n = 0; n < r.pts.length; n += 3) {
    const i = Math.round((r.pts[n] - t.x0) / cs), j = Math.round((r.pts[n + 1] - t.z0) / cs), k = j * N + i;
    rgb[k * 3] = 255; rgb[k * 3 + 1] = 30; rgb[k * 3 + 2] = 30;
  }
  writePNG(file, N, N, Buffer.from(rgb.buffer));
}

const b64 = (u8) => Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');
const deflate = (u8) => zlib.deflateRawSync(Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength), { level: 9 });

const out = [];
const tAll = Date.now();
for (let id = 0; id < ISLAND_DEFS.length; id++) {
  if (only && !only.includes(id)) continue;
  const d = ISLAND_DEFS[id];
  const t0 = Date.now();
  const t = generateIslandTerrain(d, id);
  const dt = Date.now() - t0;
  const { N, h } = t;
  let hMax = -1e9, slopeMax = 0, sAvg = 0, nl = 0;
  for (let k = 0; k < N * N; k++) hMax = Math.max(hMax, h[k]);
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
    const k = j * N + i; if (h[k] < 5) continue;
    const s = Math.hypot(h[k + 1] - h[k - 1], h[k + N] - h[k - N]) / (2 * t.cs);
    slopeMax = Math.max(slopeMax, s); sAvg += s; nl++;
  }
  let p95 = 0; {
    const arr = []; for (let j = 1; j < N - 1; j += 2) for (let i = 1; i < N - 1; i += 2) { const k = j * N + i; if (h[k] > 5) arr.push(Math.hypot(h[k + 1] - h[k - 1], h[k + N] - h[k - N]) / (2 * t.cs)); }
    arr.sort((a, b) => a - b); p95 = arr[Math.floor(arr.length * 0.95)];
  }
  const pct = (A) => { const a = []; for (let k = 0; k < N * N; k += 3) if (h[k] > 5) a.push(A[k]); a.sort((x, y) => x - y); return [0.5, 0.9, 0.99].map((p) => a[Math.floor(a.length * p)].toFixed(1)).join('/'); };
  { let lo = 0, la = 0; for (let k = 0; k < N * N; k++) if (h[k] > 0) { la++; if (h[k] < 8) lo++; } console.log(`  terra < 8 m: ${(100 * lo / la).toFixed(1)}% de ${(la * t.cs * t.cs / 1e6).toFixed(1)} km²`); }
  console.log(`  p50/p90/p99 — erosão gotas ${pct(t.ero)} m, deposição ${pct(t.dep)} m, tálus ${pct(t.tal)} m, fluxo ${pct(t.flow)}`);
  console.log(`ilha ${id}: ${dt} ms, grade ${N}² (${t.cs.toFixed(1)} m), hMax ${hMax.toFixed(0)} m, declive médio ${(Math.atan(sAvg / nl) * 57.3).toFixed(1)}°, p95 ${(Math.atan(p95) * 57.3).toFixed(1)}°, máx ${(Math.atan(slopeMax) * 57.3).toFixed(1)}°, rios ${t.rivers.length}, picos ${t.peaks.map((p) => p.h.toFixed(0)).join('/')}`);
  if (args.png) { fs.mkdirSync(args.png, { recursive: true }); preview(path.join(args.png, `terrain_${id}.png`), t, d); }
  // alturas u16 com predição (delta em relação ao vizinho da esquerda / de cima na 1ª coluna)
  const q = new Uint16Array(N * N);
  for (let k = 0; k < N * N; k++) q[k] = Math.max(0, Math.min(65535, Math.round((h[k] - H_MIN) / H_STEP)));
  const dq = new Uint16Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i;
    const pred = i > 0 ? (2 * q[k - 1] - (i > 1 ? q[k - 2] : q[k - 1])) : (j > 0 ? q[k - N] : 0);
    dq[k] = (q[k] - pred) & 0xffff;
  }
  // máscaras u8 planares: fluxo, erosão, deposição (raiz para resolução nos valores pequenos)
  const m = new Uint8Array(N * N * 4);
  for (let k = 0; k < N * N; k++) {
    m[k] = Math.round(t.flow[k] * 255);
    m[N * N + k] = Math.round(Math.sqrt(Math.min(1, t.ero[k] / EMAX)) * 255);
    m[2 * N * N + k] = Math.round(Math.sqrt(Math.min(1, t.dep[k] / DMAX)) * 255);
    m[3 * N * N + k] = Math.round(Math.sqrt(Math.min(1, t.tal[k] / TMAX)) * 255);
  }
  const hz = deflate(dq), mz = deflate(m);
  const rivers = t.rivers.map((r) => ({ j: r.join, p: Array.from(r.pts, (v, n) => (n % 3 === 2 ? Math.round(v * 10) / 10 : Math.round(v - (n % 3 === 0 ? d.cx : d.cz)))) }));
  console.log(`  dados: alturas ${(hz.length / 1024).toFixed(0)} KB, máscaras ${(mz.length / 1024).toFixed(0)} KB, rios ${(JSON.stringify(rivers).length / 1024).toFixed(1)} KB`);
  out.push({ id, N, h: b64(hz), m: b64(mz), rivers });
}
console.log(`total ${((Date.now() - tAll) / 1000).toFixed(1)} s`);
if (process.env.TERRAIN_P || process.env.TERRAIN_LEVELS) console.log('(sobreposições TERRAIN_P/TERRAIN_LEVELS ativas: src/world/terrainData.js NÃO foi gravado)');
else if (!only) {
  const file = path.join(root, 'src/world/terrainData.js');
  const body = `// GERADO por tools/bake-terrain.js — não edite. Relevo erodido das ilhas (deflate-raw + base64):\n` +
    `//   h: alturas u16 com predição linear por linha (m = ${H_MIN} + q/${1 / H_STEP}); m: máscaras u8 planares (fluxo, erosão, deposição, tálus)\n` +
    `//   rivers: polilinhas [x, z, largura, ...] relativas ao centro da ilha (j = índice do rio em que deságua, -1 = mar)\n` +
    `export const TERRAIN_DATA = ${JSON.stringify({ signature: terrainSignature(), hMin: H_MIN, hStep: H_STEP, eMax: EMAX, dMax: DMAX, tMax: TMAX, islands: out })};\n`;
  fs.writeFileSync(file, body);
  console.log(`${path.relative(root, file)} gravado (${(body.length / 1024).toFixed(0)} KB)`);
}
