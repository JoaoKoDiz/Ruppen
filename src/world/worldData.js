// =====================================================================
//  Dados FIXOS do mundo: ilhas (forma + altura) e rotas dos elefantes.
//  Fonte única de verdade para o mundo 3D, o mapa 2D e a jogabilidade.
// =====================================================================
import * as THREE from 'three';
import { ELEPHANT, CITY_NAMES, ISLAND_NAMES, SEED, WORLD } from '../config.js';
import { createRng } from '../util/rng.js';
import { ISLAND_DEFS, outlineRadiusOf, islandGrid, generateIslandTerrain, terrainSignature } from './terrainGen.js';
import { TERRAIN_DATA } from './terrainData.js';

// ------------------------------ ILHAS --------------------------------
// Contorno (harmônicas) e maciços em src/world/terrainGen.js (ISLAND_DEFS). O relevo é uma grade
// N×N (≈13–21 m por célula) já ERODIDA (gotas + tálus), assada offline por tools/bake-terrain.js em
// src/world/terrainData.js; heightAt amostra a grade (bilinear). Se o dado assado estiver
// desatualizado (assinatura ≠), o relevo é gerado aqui mesmo (lento: re-asse com `node tools/bake-terrain.js`).
async function inflateRaw(b64) {
  const bin = atob(b64), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function loadIslandTerrain(d, id) {
  const T = TERRAIN_DATA, rec = T && T.islands.find((r) => r.id === id);
  const grid = islandGrid(d);
  if (rec && T.signature === terrainSignature() && rec.N === grid.N && typeof DecompressionStream !== 'undefined') {
    const { N } = grid, NN = N * N;
    const [hb, mb] = await Promise.all([inflateRaw(rec.h), inflateRaw(rec.m)]);
    const dq = new Uint16Array(hb.buffer, hb.byteOffset, NN), q = new Uint16Array(NN), h = new Float32Array(NN);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const pred = i > 0 ? (2 * q[k - 1] - (i > 1 ? q[k - 2] : q[k - 1])) : (j > 0 ? q[k - N] : 0);
      q[k] = (dq[k] + pred) & 0xffff;
      h[k] = T.hMin + q[k] * T.hStep;
    }
    const flow = new Float32Array(NN), ero = new Float32Array(NN), dep = new Float32Array(NN), tal = new Float32Array(NN);
    for (let k = 0; k < NN; k++) {
      flow[k] = mb[k] / 255;
      const e = mb[NN + k] / 255, p = mb[2 * NN + k] / 255, t = mb[3 * NN + k] / 255;
      ero[k] = e * e * T.eMax; dep[k] = p * p * T.dMax; tal[k] = t * t * T.tMax;
    }
    const rivers = rec.rivers.map((r) => ({ join: r.j, pts: r.p.map((v, n) => (n % 3 === 0 ? v + d.cx : n % 3 === 1 ? v + d.cz : v)) }));
    return { ...grid, h, flow, ero, dep, tal, rivers, baked: true };
  }
  console.warn(`[worldData] relevo da ilha ${id} gerado em tempo de carga (terrainData.js desatualizado: rode node tools/bake-terrain.js)`);
  const t = generateIslandTerrain(d, id);
  return { ...grid, h: t.h, flow: t.flow, ero: t.ero, dep: t.dep, tal: t.tal, rivers: t.rivers, baked: false };
}
const _t0 = performance.now();
const TERRAINS = await Promise.all(ISLAND_DEFS.map(loadIslandTerrain));
const TERRAIN_LOAD_MS = performance.now() - _t0; // decodificação do relevo assado (diagnóstico)

export const islands = ISLAND_DEFS.map((d, i) => {
  const T = TERRAINS[i];
  const { N, cs, x0, z0, h: HG } = T;
  const inv = 1 / cs;
  let peak = 0;
  for (let k = 0; k < HG.length; k++) if (HG[k] > peak) peak = HG[k];
  const B = d.R * 1.75, B2 = B * B;
  const island = {
    id: i,
    name: ISLAND_NAMES[i],
    cx: d.cx, cz: d.cz, R: d.R,
    maxH: peak,             // altura real do pico mais alto (após a erosão)
    boundRadius: B,         // círculo que certamente contém a ilha (para rejeição rápida)
    terrain: T,             // grade erodida: { N, G, cs, x0, z0, h, flow, ero, dep, tal, rivers } (para o renderizador)
    // raio do contorno (linha da costa) numa direção (ângulo em rad, medido de +X para +Z)
    outlineRadius(theta) { return outlineRadiusOf(d, theta); },
    // Altura do terreno (m) no ponto (x,z) do mundo: bilinear na grade erodida. Abaixo de 0 = submerso.
    // Retorna -Infinity fora da área da ilha.
    heightAt(x, z) {
      const dx = x - d.cx, dz = z - d.cz, r2 = dx * dx + dz * dz;
      if (r2 > B2) return -Infinity;
      if (r2 > 1.5 * d.R * d.R && Math.sqrt(r2) > 1.25 * outlineRadiusOf(d, Math.atan2(dz, dx))) return -Infinity;
      let fx = (x - x0) * inv, fz = (z - z0) * inv;
      fx = fx < 0 ? 0 : fx > N - 1.001 ? N - 1.001 : fx;
      fz = fz < 0 ? 0 : fz > N - 1.001 ? N - 1.001 : fz;
      const ix = fx | 0, iz = fz | 0, u = fx - ix, v = fz - iz, k = iz * N + ix;
      return (HG[k] * (1 - u) + HG[k + 1] * u) * (1 - v) + (HG[k + N] * (1 - u) + HG[k + N + 1] * u) * v;
    },
    // polígono da costa para o mapa (N pontos em coordenadas do mundo)
    outlinePolygon(n = 72) {
      const pts = [];
      for (let k = 0; k < n; k++) {
        const th = (k / n) * Math.PI * 2;
        const r = island.outlineRadius(th);
        pts.push({ x: d.cx + Math.cos(th) * r, z: d.cz + Math.sin(th) * r });
      }
      return pts;
    },
  };
  return island;
});

// Altura máxima do terreno de qualquer ilha no ponto; -Infinity em mar aberto.
export function islandHeightAt(x, z) {
  let best = -Infinity;
  for (const isl of islands) {
    const h = isl.heightAt(x, z);
    if (h > best) best = h;
  }
  return best;
}
export function islandAt(x, z) {
  for (const isl of islands) if (isl.heightAt(x, z) > -Infinity) return isl;
  return null;
}

// --------------------------- ROTAS DOS ELEFANTES ---------------------
// Cada elefante anda em um laço fechado (spline) sobre o oceano, longe das ilhas.
// Posição ao longo da rota: u em [0,1) (parametrizado por comprimento de arco).
const ROUTE_DEFS = [
  { cx: 7000, cz: -4000, r: 4500, w1: 0.22, w2: 0.10, dir: 1, u0: 0.37 },
  { cx: -16000, cz: 4000, r: 5000, w1: 0.18, w2: 0.14, dir: -1, u0: 0.63 },
  { cx: 10000, cz: 16000, r: 5500, w1: 0.25, w2: 0.08, dir: 1, u0: 0.41 },
  { cx: -21000, cz: -23000, r: 3800, w1: 0.20, w2: 0.12, dir: -1, u0: 0.80 },
  { cx: 24000, cz: -6000, r: 4500, w1: 0.16, w2: 0.16, dir: 1, u0: 0.27 },
  { cx: -6000, cz: -20000, r: 4500, w1: 0.24, w2: 0.09, dir: -1, u0: 0.55 },
  { cx: 23500, cz: 26000, r: 3200, w1: 0.19, w2: 0.13, dir: 1, u0: 0.05 },
];

export const routes = ROUTE_DEFS.map((d, i) => {
  const _pose = { position: new THREE.Vector3(), tangent: new THREE.Vector3(), heading: 0 };
  const rng = createRng(SEED + 101 * (i + 1));
  const p1 = rng.range(0, Math.PI * 2), p2 = rng.range(0, Math.PI * 2);
  const N = 14;
  const pts = [];
  for (let k = 0; k < N; k++) {
    const th = (k / N) * Math.PI * 2;
    const rr = d.r * (1 + d.w1 * Math.sin(2 * th + p1) + d.w2 * Math.sin(3 * th + p2));
    pts.push(new THREE.Vector3(d.cx + Math.cos(th) * rr, 0, d.cz + Math.sin(th) * rr));
  }
  if (d.dir < 0) pts.reverse();
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  curve.arcLengthDivisions = 600;
  const length = curve.getLength();
  return {
    id: i,
    cityName: CITY_NAMES[i],
    curve,
    length,
    u0: d.u0,              // posição inicial (fração do laço)
    speed: ELEPHANT.SPEED, // m/s
    center: { x: d.cx, z: d.cz },
    radius: d.r,
    // posição/orientação para um u qualquer (u é normalizado por comprimento de arco)
    poseAt(u) {
      const uu = ((u % 1) + 1) % 1;
      // objetos reutilizados (chamado a cada quadro por elefante — sem alocação)
      curve.getPointAt(uu, _pose.position);
      curve.getTangentAt(uu, _pose.tangent).normalize();
      // o elefante tem +X local = frente; rotation.y leva +X local para (cos, 0, -sin)
      _pose.heading = Math.atan2(-_pose.tangent.z, _pose.tangent.x);
      return _pose;
    },
    // pontos do trecho à frente (para o tracejado no mapa): de u até u + metros/length
    aheadPoints(u, meters = 2500, n = 10) {
      const out = [];
      for (let k = 0; k <= n; k++) out.push(curve.getPointAt((((u + (meters / length) * (k / n)) % 1) + 1) % 1));
      return out;
    },
  };
});

export const WORLD_DATA = {
  islands,
  routes,
  islandHeightAt,
  islandAt,
  bounds: { min: -WORLD.HALF, max: WORLD.HALF },
  terrainLoadMs: TERRAIN_LOAD_MS,
};
export default WORLD_DATA;
