// =====================================================================
//  Dados FIXOS do mundo: ilhas (forma + altura) e rotas dos elefantes.
//  Fonte única de verdade para o mundo 3D, o mapa 2D e a jogabilidade.
// =====================================================================
import * as THREE from 'three';
import { ELEPHANT, CITY_NAMES, ISLAND_NAMES, SEED, WORLD } from '../config.js';
import { createNoise } from '../util/noise.js';
import { createRng } from '../util/rng.js';

const noise = createNoise(SEED);

// ------------------------------ ILHAS --------------------------------
// Cada ilha: centro, raio base, harmônicas do contorno (formato único) e
// parâmetros de relevo. Todas têm a mesma "composição" (montanhas altas,
// pedras, grama, florestas e pequenas praias) — diferem pelo formato.
const ISLAND_DEFS = [
  { cx: -18000, cz: -12000, R: 2700, maxH: 1600, harmonics: [[0.26, 2, 0.4], [0.14, 3, 1.9], [0.07, 5, 0.3]], seedOff: 11 }, // alongada
  { cx: 14000, cz: -20000, R: 2300, maxH: 1350, harmonics: [[0.30, 3, 2.2], [0.10, 4, 0.9], [0.06, 7, 1.1]], seedOff: 23 }, // trilobada
  { cx: 22000, cz: 10000, R: 3100, maxH: 1800, harmonics: [[0.18, 1, 0.0], [0.22, 2, 2.6], [0.08, 6, 0.5]], seedOff: 37 }, // grande c/ baía
  { cx: -9000, cz: 19000, R: 2400, maxH: 1400, harmonics: [[0.34, 1, 1.2], [0.12, 4, 2.4], [0.05, 9, 0.7]], seedOff: 41 }, // com "cauda"
  { cx: -3000, cz: 5500, R: 1900, maxH: 1200, harmonics: [[0.12, 2, 0.8], [0.10, 5, 1.5], [0.05, 8, 2.2]], seedOff: 53 }, // redonda, perto do início
];

function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

export const islands = ISLAND_DEFS.map((d, i) => {
  const island = {
    id: i,
    name: ISLAND_NAMES[i],
    cx: d.cx, cz: d.cz, R: d.R, maxH: d.maxH,
    boundRadius: d.R * 1.75, // círculo que certamente contém a ilha (para rejeição rápida)
    // raio do contorno (linha da costa) numa direção (ângulo em rad, medido de +X para +Z)
    outlineRadius(theta) {
      let f = 1;
      for (const [a, k, p] of d.harmonics) f += a * Math.sin(k * theta + p);
      return d.R * Math.max(0.35, f);
    },
    // Altura do terreno (m) no ponto (x,z) do mundo. Abaixo de 0 = submerso.
    // Retorna -Infinity fora da área da ilha.
    heightAt(x, z) {
      const dx = x - d.cx, dz = z - d.cz;
      const dist = Math.hypot(dx, dz);
      if (dist > island.boundRadius) return -Infinity;
      const theta = Math.atan2(dz, dx);
      const rr = island.outlineRadius(theta);
      const u = dist / rr;                 // 0 no centro, 1 na costa
      if (u > 1.25) return -Infinity;
      const s = 1 / 1400;                  // escala do ruído das montanhas
      const ox = (d.seedOff * 1000) | 0;
      const ridge = noise.ridged2((x + ox) * s, (z - ox) * s, 5, 2.1, 0.5);        // [0,1]
      const hills = noise.fbm2((x - ox) * s * 3.1, (z + ox) * s * 3.1, 3, 2, 0.5);  // [-1,1]
      const inland = smoothstep(1.0, 0.62, u);     // 1 no interior, 0 na costa
      const core = smoothstep(0.95, 0.25, u);      // montanhas concentradas no centro
      const mountain = d.maxH * Math.pow(ridge, 1.7) * core * (0.75 + 0.25 * hills);
      const lowland = 60 * inland + 35 * hills * inland;
      const beach = 14 * smoothstep(1.03, 0.9, u); // faixa de praia suave ~ +14 m
      // abaixo da costa o fundo desce rápido para esconder a borda da malha
      const shelf = u > 1.0 ? -(u - 1.0) * 1600 : 0;
      return mountain + lowland + beach + shelf - 10 * (1 - inland);
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
      const position = curve.getPointAt(uu);
      const tangent = curve.getTangentAt(uu).normalize();
      // o elefante tem +X local = frente; rotation.y leva +X local para (cos, 0, -sin)
      const heading = Math.atan2(-tangent.z, tangent.x);
      return { position, tangent, heading };
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
};
export default WORLD_DATA;
