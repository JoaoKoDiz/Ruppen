// =====================================================================
//  Ilhas — terreno por vértice (praias, prados, pasto seco, matagal, mata
//  fechada, rocha), florestas e pedras instanciadas e um anel de água rasa
//  turquesa com linha de espuma na costa. Tudo procedural, estático e
//  determinístico (SEED).
//  Contrato (ARCHITECTURE.md 4.3):
//    createIslands(scene, worldData, { quality }) -> { group, update(camera, time) }
//  Por ilha (4 draw calls, ~145k triângulos em quality=high):
//    1. malha de terreno (grade ~170×170 amostrando island.heightAt; ~57k tris)
//       com cores por vértice: areia (y < ~8 m e encosta suave, faixa molhada
//       0–1.5 m, gradiente de brilho), vegetação por ruído de 500–900 m
//       (prado nos vales, pasto seco nas cristas, matagal na altitude, "tapete"
//       escuro sob as matas), rocha nas encostas íngremes/altas, picos claros;
//    2. InstancedMesh de árvores (12 tris cada: dois cones + tronco) agrupadas
//       pelo mesmo ruído das matas — bosques densos, prados abertos (~72k tris);
//    3. InstancedMesh de pedras (dodecaedro irregular) nas encostas rochosas,
//       mais alguns matacões grandes no sopé das falésias (~14k tris);
//    4. anel de água rasa (MeshBasicMaterial transparente, cor+alfa por vértice)
//       seguindo a linha de costa real: espuma clara junto à praia, turquesa
//       que se desvanece até ~1.27·R (~1,3k tris).
// =====================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLORS, SEED, ISLANDS } from '../config.js';
import { createRng } from '../util/rng.js';
import { createNoise } from '../util/noise.js';

// ------------------------------ utilidades ----------------------------
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;

// Paleta (THREE.Color já converte sRGB -> linear; os atributos de cor usam linear)
const PAL = (() => {
  const c = (hex) => new THREE.Color(hex);
  const mix = (a, b, t) => c(a).lerp(c(b), t);
  return {
    sand: c(COLORS.sand),
    sandLight: mix(COLORS.sand, 0xfff7dd, 0.55),      // topo da praia (seca, mais clara)
    sandWet: c(COLORS.sandWet),                        // faixa molhada 0–1.5 m
    sandSub: mix(COLORS.sandWet, 0x5a7470, 0.5),       // areia submersa rasa
    seabed: c(0x2f4f55),                               // fundo mais profundo
    grassDry: c(COLORS.grassDry),
    meadow: c(COLORS.meadow),
    meadowDark: mix(COLORS.meadow, COLORS.forestDark, 0.45), // vales úmidos
    scrub: c(COLORS.scrub),
    forest: c(COLORS.forest),
    forestDark: c(COLORS.forestDark),
    carpet: mix(COLORS.forestDark, 0x1a3520, 0.7),     // "tapete" do terreno sob a mata
    rock: c(COLORS.rock),
    rockDark: c(COLORS.rockDark),
    rockLight: mix(COLORS.rock, 0xdcd7cd, 0.65),       // picos mais claros
    rockWarm: mix(COLORS.rock, 0xa08a6a, 0.4),         // rocha com tom quente (falésias baixas)
    wood: c(COLORS.wood),
    foam: c(COLORS.foam),
    shallows: c(COLORS.shallows),
    shallowsNear: mix(COLORS.shallows, 0x9fe6d6, 0.5),      // turquesa clara junto à praia
    shallowsFar: mix(COLORS.shallows, COLORS.oceanShallow, 0.6),
  };
})();

// ---------------------- classificação da cobertura --------------------
// Pesos (0..1) das faixas num ponto do terreno.
//   y      altura (m); ny = componente Y da normal (1 = plano, 0 = vertical)
//   relief altura relativa à média local (-1 vale … +1 crista)
//   vegN   ruído ~700 m: prado (−) vs pasto seco (+)
//   forN   ruído ~520 m: manchas de floresta
//   bchN   ruído ~900 m: costas com praia (+) ou sem (−)
//   fineN  ruído ~70 m para tremer as bordas
function coverAt(y, ny, relief, vegN, forN, bchN, fineN, maxH, out) {
  // praia: só até SAND_MAX_Y (mais larga onde bchN é alto, quase nula onde é baixo) e em encosta suave
  const sandTop = ISLANDS.SAND_MAX_Y * (0.35 + 1.0 * smoothstep(-0.45, 0.45, bchN));
  const yS = y + 1.6 * fineN;
  const sand = (1 - smoothstep(sandTop - 1.5, sandTop + 2.5, yS)) * smoothstep(0.78, 0.9, ny + 0.03 * fineN) * smoothstep(-5, -2, y);
  // rocha: encostas íngremes e a zona alta das montanhas
  const sD = ny + 0.06 * fineN;
  const rock = Math.max(smoothstep(0.72, 0.55, sD), smoothstep(0.52 * maxH, 0.70 * maxH, y + 45 * fineN + 30 * vegN));
  const peak = smoothstep(0.68 * maxH, 0.95 * maxH, y);
  // floresta: manchas do ruído, favorecidas nos vales, abaixo da linha das árvores
  const treeline = 1 - smoothstep(ISLANDS.TREELINE * maxH * 0.8, ISLANDS.TREELINE * maxH, y + 40 * fineN);
  const f = forN - 0.35 * relief + 0.08 * fineN;
  const forest = smoothstep(0.12, 0.4, f) * treeline * smoothstep(4, 12, y) * smoothstep(0.5, 0.7, ny) * (1 - sand) * (1 - rock);
  // matagal: altitude média-alta e cristas expostas
  const scrub = clamp(smoothstep(0.2 * maxH, 0.42 * maxH, y + 30 * vegN) + 0.45 * smoothstep(0.25, 0.9, relief), 0, 1);
  // seco (pasto) vs úmido (prado): ruído grande + cristas secas / vales verdes
  const dry = smoothstep(-0.45, 0.5, 1.3 * vegN + 0.6 * relief + 0.12 * fineN);
  out.sand = sand; out.rock = rock; out.peak = peak; out.forest = forest; out.scrub = scrub; out.dry = dry;
  out.grass = clamp(1 - sand - forest, 0, 1) * (1 - rock);
  return out;
}

const _tmpA = new THREE.Color(), _tmpB = new THREE.Color();
// Cor final do vértice (linear) a partir dos pesos de cobertura.
function terrainColor(y, ny, relief, fineN, microN, cov, out) {
  // vegetação rasteira: prado (vales) -> pasto seco (cristas), matagal na altitude
  out.copy(PAL.meadowDark).lerp(PAL.meadow, clamp(0.55 + 0.6 * relief + 0.15 * fineN, 0, 1));
  out.lerp(PAL.grassDry, cov.dry);
  out.lerp(PAL.scrub, cov.scrub * 0.85);
  out.multiplyScalar(0.92); // sol forte + ACES: vegetação um pouco menos saturada
  // tapete escuro sob a mata (a copa lê-se como massa de longe)
  _tmpA.copy(PAL.carpet).lerp(PAL.forestDark, clamp(0.5 + 0.5 * fineN, 0, 1));
  out.lerp(_tmpA, Math.min(1, cov.forest * 1.15));
  // areia: molhada junto à água, cada vez mais clara subindo a praia
  if (cov.sand > 0.001) {
    _tmpB.copy(PAL.sandWet).lerp(PAL.sand, smoothstep(0, ISLANDS.SAND_WET_Y, y));
    _tmpB.lerp(PAL.sandLight, 0.75 * smoothstep(ISLANDS.SAND_WET_Y, ISLANDS.SAND_MAX_Y + 2, y));
    out.lerp(_tmpB, cov.sand);
  }
  // rocha (escura/clara por ruído, mais quente nas falésias baixas, mais clara nos picos)
  _tmpB.copy(PAL.rockDark).lerp(PAL.rock, clamp(0.5 + 0.4 * fineN + 0.2 * microN, 0, 1));
  _tmpB.lerp(PAL.rockWarm, 0.5 * (1 - smoothstep(150, 400, y)));
  _tmpB.lerp(PAL.rockLight, cov.peak * clamp(0.6 + 0.4 * fineN, 0, 1));
  out.lerp(_tmpB, cov.rock);
  // submerso: areia molhada -> fundo escuro
  if (y < 0.5) {
    _tmpA.copy(PAL.sandSub).lerp(PAL.seabed, smoothstep(0, -45, y));
    out.lerp(_tmpA, smoothstep(0.5, -1.5, y));
  }
  // variação fina de brilho (mais forte na rocha: estratos)
  out.multiplyScalar(1 + (0.06 + 0.08 * cov.rock) * microN + 0.07 * fineN * cov.grass);
  return out;
}

// --------------------------- geometrias base --------------------------
// Árvore unitária (altura 1), 12 triângulos: copa inferior em cone de 5 lados,
// copa superior em cone de 4 lados e tronco em cone invertido de 3 lados.
// Cor por vértice: copas brancas (recebem a cor verde da instância), tronco
// marrom "pré-dividido" pela cor média das instâncias (vColor = cor*instância).
function makeTreeGeometry() {
  const avgGreen = PAL.forestDark.clone().lerp(PAL.meadow, 0.35);
  const trunkCol = new THREE.Color(
    clamp(PAL.wood.r / avgGreen.r, 0, 4), clamp(PAL.wood.g / avgGreen.g, 0, 4), clamp(PAL.wood.b / avgGreen.b, 0, 4));
  const setColor = (geo, col, topBoost) => {
    const n = geo.attributes.position.count, pos = geo.attributes.position;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const b = 1 + topBoost * clamp(pos.getY(i), 0, 1); // topo ligeiramente mais claro
      arr[i * 3] = col.r * b; arr[i * 3 + 1] = col.g * b; arr[i * 3 + 2] = col.b * b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  };
  const white = new THREE.Color(1, 1, 1);
  const lower = new THREE.ConeGeometry(0.38, 0.58, 5, 1, true); lower.translate(0, 0.22 + 0.29, 0);
  const upper = new THREE.ConeGeometry(0.24, 0.5, 4, 1, true); upper.translate(0, 0.5 + 0.25, 0); upper.rotateY(Math.PI / 5);
  const trunk = new THREE.ConeGeometry(0.07, 0.36, 3, 1, true); trunk.rotateX(Math.PI); trunk.translate(0, 0.18, 0);
  setColor(lower, white, 0.15); setColor(upper, white, 0.15); setColor(trunk, trunkCol, 0);
  const merged = mergeGeometries([lower, upper, trunk], false).toNonIndexed();
  merged.deleteAttribute('uv');
  merged.computeVertexNormals(); // facetas planas (estilo low-poly)
  for (const g of [lower, upper, trunk]) g.dispose();
  return merged;
}

// Pedra: dodecaedro com vértices deslocados (mesmo deslocamento para vértices
// coincidentes, para as faces continuarem fechadas), achatado em Y.
function makeRockGeometry(rng) {
  const geo = new THREE.DodecahedronGeometry(1, 0); // não indexado -> facetado
  const pos = geo.attributes.position;
  const offs = new Map();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = x.toFixed(3) + ',' + y.toFixed(3) + ',' + z.toFixed(3);
    let o = offs.get(key);
    if (!o) { o = [rng.range(-0.22, 0.22), rng.range(-0.22, 0.22), rng.range(-0.22, 0.22)]; offs.set(key, o); }
    pos.setXYZ(i, x + o[0], (y + o[1]) * 0.72, z + o[2]);
  }
  geo.deleteAttribute('uv');
  geo.computeVertexNormals();
  return geo;
}

// Material da água rasa: MeshBasicMaterial transparente com cor por vértice e
// um atributo extra de alfa (injetado via onBeforeCompile).
function makeShallowsMaterial() {
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, depthTest: true, fog: true, side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aAlpha;\nvarying float vAlpha;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = aAlpha;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAlpha;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vAlpha;');
  };
  mat.customProgramCacheKey = () => 'ruppen-shallows';
  return mat;
}

// --------------------- média local das alturas (vale/crista) ----------
// Caixa separável de raio r células; devolve a média (em metros).
function boxBlur(H, N, r) {
  const tmp = new Float32Array(N * N), out = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    let acc = 0, cnt = 0;
    for (let i = -r; i <= r; i++) { const ii = clamp(i, 0, N - 1); acc += H[j * N + ii]; cnt++; }
    for (let i = 0; i < N; i++) {
      tmp[j * N + i] = acc / cnt;
      const add = clamp(i + r + 1, 0, N - 1), rem = clamp(i - r, 0, N - 1);
      acc += H[j * N + add] - H[j * N + rem];
    }
  }
  for (let i = 0; i < N; i++) {
    let acc = 0, cnt = 0;
    for (let j = -r; j <= r; j++) { const jj = clamp(j, 0, N - 1); acc += tmp[jj * N + i]; cnt++; }
    for (let j = 0; j < N; j++) {
      out[j * N + i] = acc / cnt;
      const add = clamp(j + r + 1, 0, N - 1), rem = clamp(j - r, 0, N - 1);
      acc += tmp[add * N + i] - tmp[rem * N + i];
    }
  }
  return out;
}

// ------------------------------ uma ilha ------------------------------
function buildIsland(island, opts) {
  const { quality, materials, treeGeo, rockGeo } = opts;
  const low = quality === 'low';
  const N = low ? ISLANDS.GRID_LOW : ISLANDS.GRID_HIGH;
  const B = island.boundRadius;
  const step = (2 * B) / (N - 1);
  const cx = island.cx, cz = island.cz, maxH = island.maxH, R = island.R;
  const noise = createNoise(SEED + 7001 + island.id * 13);
  const rng = createRng(SEED + 9100 + island.id * 17);
  const vegAt = (x, z) => noise.fbm2(x / ISLANDS.VEG_NOISE_M, z / ISLANDS.VEG_NOISE_M, 3, 2, 0.5);
  const forAt = (x, z) => noise.fbm2(x / ISLANDS.FOREST_NOISE_M + 53.1, z / ISLANDS.FOREST_NOISE_M - 17.7, 3, 2, 0.55);
  const bchAt = (x, z) => noise.fbm2(x / ISLANDS.BEACH_NOISE_M - 9.3, z / ISLANDS.BEACH_NOISE_M + 27.1, 2, 2, 0.5);
  const fineAt = (x, z) => noise.fbm2(x / 70 + 31.7, z / 70 - 11.3, 2, 2, 0.5);
  const microAt = (x, z) => noise.noise2(x / 23 - 8.1, z / 23 + 4.4);

  // ---- alturas (coordenadas locais ao centro da ilha para precisão) ----
  const H = new Float32Array(N * N);
  const positions = new Float32Array(N * N * 3);
  for (let j = 0; j < N; j++) {
    const z = cz - B + j * step;
    for (let i = 0; i < N; i++) {
      const x = cx - B + i * step;
      const h = island.heightAt(x, z); // -Infinity fora da ilha -> saia submersa
      const y = h > ISLANDS.SKIRT_Y ? h : ISLANDS.SKIRT_Y;
      const k = j * N + i;
      H[k] = y;
      positions[k * 3] = x - cx; positions[k * 3 + 1] = y; positions[k * 3 + 2] = z - cz;
    }
  }
  // ---- índices (triângulos com a face para cima) ----
  const index = new Uint32Array((N - 1) * (N - 1) * 6);
  let p = 0;
  for (let j = 0; j < N - 1; j++) {
    for (let i = 0; i < N - 1; i++) {
      const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
      index[p++] = a; index[p++] = d; index[p++] = b;
      index[p++] = a; index[p++] = c; index[p++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();
  const normals = geo.attributes.normal.array;

  // ---- relevo relativo (vale/crista): altura menos a média local (~300 m) ----
  const blurR = Math.max(2, Math.round(300 / step));
  const Hb = boxBlur(H, N, blurR);
  const REL = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) REL[k] = clamp((H[k] - Hb[k]) / 70, -1, 1);

  // ---- cores por vértice + máscaras de cobertura (reutilizadas para a vegetação) ----
  const colors = new Float32Array(N * N * 3);
  const FOREST = new Float32Array(N * N), SAND = new Float32Array(N * N), ROCK = new Float32Array(N * N), GRASS = new Float32Array(N * N);
  const cov = { sand: 0, grass: 0, forest: 0, rock: 0, peak: 0, scrub: 0, dry: 0 };
  const col = new THREE.Color();
  for (let j = 0; j < N; j++) {
    const z = cz - B + j * step;
    for (let i = 0; i < N; i++) {
      const x = cx - B + i * step;
      const k = j * N + i;
      const y = H[k], ny = normals[k * 3 + 1];
      if (y <= ISLANDS.SKIRT_Y + 1) { // saia submersa: fundo escuro, sem cálculo de ruído
        colors[k * 3] = PAL.seabed.r; colors[k * 3 + 1] = PAL.seabed.g; colors[k * 3 + 2] = PAL.seabed.b;
        continue;
      }
      const fineN = fineAt(x, z), microN = microAt(x, z);
      const vegN = vegAt(x, z), forN = forAt(x, z), bchN = bchAt(x, z);
      coverAt(y, ny, REL[k], vegN, forN, bchN, fineN, maxH, cov);
      terrainColor(y, ny, REL[k], fineN, microN, cov, col);
      colors[k * 3] = col.r; colors[k * 3 + 1] = col.g; colors[k * 3 + 2] = col.b;
      FOREST[k] = cov.forest; SAND[k] = cov.sand; ROCK[k] = cov.rock; GRASS[k] = cov.grass;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();

  const terrain = new THREE.Mesh(geo, materials.terrain);
  terrain.name = 'terreno:' + island.name;
  terrain.position.set(cx, 0, cz);
  terrain.matrixAutoUpdate = false; terrain.updateMatrix();

  // ---- amostragem da superfície da MALHA (triângulo exato) para posicionar objetos ----
  const s = { y: 0, ny: 1, forest: 0, sand: 0, rock: 0, grass: 0 };
  const bilerp = (A, a, b, c, d, u, v) => (A[a] * (1 - u) + A[b] * u) * (1 - v) + (A[c] * (1 - u) + A[d] * u) * v;
  function sampleSurface(lx, lz) {
    const fx = (lx + B) / step, fz = (lz + B) / step;
    const i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= N - 1 || j >= N - 1) return false;
    const u = fx - i, v = fz - j;
    const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
    s.y = u > v ? H[a] + u * (H[b] - H[a]) + v * (H[d] - H[b]) : H[a] + v * (H[c] - H[a]) + u * (H[d] - H[c]);
    s.ny = (normals[a * 3 + 1] * (1 - u) + normals[b * 3 + 1] * u) * (1 - v) + (normals[c * 3 + 1] * (1 - u) + normals[d * 3 + 1] * u) * v;
    s.forest = bilerp(FOREST, a, b, c, d, u, v);
    s.sand = bilerp(SAND, a, b, c, d, u, v);
    s.rock = bilerp(ROCK, a, b, c, d, u, v);
    s.grass = bilerp(GRASS, a, b, c, d, u, v);
    return true;
  }
  // raio máximo do contorno (para amostrar só onde pode haver terra)
  let rMax = 0;
  for (let k = 0; k < 64; k++) rMax = Math.max(rMax, island.outlineRadius((k / 64) * Math.PI * 2));
  rMax = Math.min(B, rMax * 1.02);

  const mat4 = new THREE.Matrix4(), pos3 = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3(), eul = new THREE.Euler();
  const icol = new THREE.Color();

  // ---- árvores ----
  const treeCount = low ? ISLANDS.TREES_LOW : ISLANDS.TREES_HIGH;
  const trees = new THREE.InstancedMesh(treeGeo, materials.tree, treeCount);
  trees.name = 'arvores:' + island.name;
  let placed = 0;
  for (let tries = 0; placed < treeCount && tries < treeCount * 80; tries++) {
    const lx = rng.range(-rMax, rMax), lz = rng.range(-rMax, rMax);
    if (lx * lx + lz * lz > rMax * rMax) continue;
    if (!sampleSurface(lx, lz) || s.y < 3) continue;
    const slopeOK = smoothstep(0.45, 0.7, s.ny);
    // bosques densos (máscara ao quadrado) + árvores soltas nos prados
    const f = s.forest;
    const prob = (f * f * 1.0 + 0.02 * s.grass * (1 - f)) * (1 - s.rock) * slopeOK;
    if (rng() > prob) continue;
    const inWood = f > 0.45;
    // conífera alta e estreita na mata; árvore baixa e larga (copa redonda) nos prados
    let h, w;
    if (inWood) { h = lerp(ISLANDS.TREE_HEIGHT_MIN + 6, ISLANDS.TREE_HEIGHT_MAX, Math.pow(rng(), 0.9)); w = rng.range(0.7, 0.95); }
    else { h = lerp(ISLANDS.TREE_HEIGHT_MIN, ISLANDS.TREE_HEIGHT_MIN + 10, rng()); w = rng.range(1.0, 1.45); }
    pos3.set(lx, s.y - (1 - s.ny) * 0.3 * h - 0.3, lz);
    quat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rng() * Math.PI * 2);
    scl.set(h * w, h, h * w);
    mat4.compose(pos3, quat, scl);
    trees.setMatrixAt(placed, mat4);
    // cor: mata escura (ligeira variação) ou verde de prado/matagal fora dela
    if (inWood) icol.copy(PAL.forestDark).lerp(PAL.forest, rng() * 0.7);
    else icol.copy(PAL.forest).lerp(PAL.meadow, rng() * 0.6).lerp(PAL.scrub, rng() * 0.4);
    icol.multiplyScalar(rng.range(0.82, 1.1));
    icol.r *= rng.range(0.95, 1.12);
    trees.setColorAt(placed, icol);
    placed++;
  }
  trees.count = placed;
  trees.instanceMatrix.needsUpdate = true;
  if (trees.instanceColor) trees.instanceColor.needsUpdate = true;
  trees.position.set(cx, 0, cz);
  trees.matrixAutoUpdate = false; trees.updateMatrix();
  trees.computeBoundingSphere();

  // ---- pedras e matacões ----
  const rockCount = low ? ISLANDS.ROCKS_LOW : ISLANDS.ROCKS_HIGH;
  const boulderCount = Math.min(rockCount, low ? ISLANDS.BOULDERS_LOW : ISLANDS.BOULDERS_HIGH);
  const rocks = new THREE.InstancedMesh(rockGeo, materials.rock, rockCount);
  rocks.name = 'pedras:' + island.name;
  let placedR = 0;
  // rocha íngreme perto (sopé de falésia): o ponto é suave mas há encosta a ~45 m
  const steepNear = (lx, lz) => {
    let worst = 1;
    for (let q = 0; q < 4; q++) {
      const ang = q * Math.PI / 2;
      if (sampleSurface(lx + Math.cos(ang) * 45, lz + Math.sin(ang) * 45)) worst = Math.min(worst, s.ny);
    }
    return worst;
  };
  for (let tries = 0; placedR < rockCount && tries < rockCount * 300; tries++) {
    const lx = rng.range(-rMax, rMax), lz = rng.range(-rMax, rMax);
    if (lx * lx + lz * lz > rMax * rMax) continue;
    if (!sampleSurface(lx, lz) || s.y < -1) continue;
    const y = s.y, ny = s.ny, rockW = s.rock, sandW = s.sand, forestW = s.forest;
    const wantBoulder = placedR < boulderCount;
    let prob, sz;
    if (wantBoulder) {
      // matacão: terreno quase plano e pouco rochoso, com falésia a poucas dezenas de metros
      if (ny < 0.8 || rockW > 0.4 || y < 1) continue;
      const near = steepNear(lx, lz);
      if (near > 0.6) continue;
      prob = 0.9; sz = rng.range(16, 34);
    } else {
      if (rockW > 0.35 && ny > 0.3) prob = 0.9;              // encostas íngremes
      else if (sandW > 0.5) prob = 0.08;                       // algumas na praia
      else prob = 0.03 * (1 - forestW);                        // raras na grama
      sz = 5 + 20 * rng() * rng();
      if (rng() > prob) continue;
    }
    scl.set(sz * rng.range(0.8, 1.5), sz * rng.range(0.6, 1.0), sz * rng.range(0.8, 1.5));
    eul.set(rng.range(-0.5, 0.5), rng() * Math.PI * 2, rng.range(-0.5, 0.5));
    quat.setFromEuler(eul);
    pos3.set(lx, y - scl.y * 0.25, lz);
    mat4.compose(pos3, quat, scl);
    rocks.setMatrixAt(placedR, mat4);
    const peakW = smoothstep(0.68 * maxH, 0.95 * maxH, y);
    icol.copy(PAL.rockDark).lerp(PAL.rock, rng()).lerp(PAL.rockLight, 0.35 * rng() * peakW + 0.1 * rng());
    if (wantBoulder) icol.lerp(PAL.rockLight, 0.2);
    icol.multiplyScalar(rng.range(0.85, 1.1));
    rocks.setColorAt(placedR, icol);
    placedR++;
  }
  rocks.count = placedR;
  rocks.instanceMatrix.needsUpdate = true;
  if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
  rocks.position.set(cx, 0, cz);
  rocks.matrixAutoUpdate = false; rocks.updateMatrix();
  rocks.computeBoundingSphere();

  // ---- anel de água rasa + espuma na costa ----
  const shallows = buildShallows(island, materials.shallows);

  return { island, cx, cz, terrain, trees, rocks, shallows, sampleSurface };
}

// Anel plano ao redor da linha de costa REAL (raio onde heightAt cruza y=0 em
// cada ângulo): bandas radiais com cor/alfa por vértice — espuma clara na
// costa, turquesa que se desvanece para o azul do oceano.
function buildShallows(island, material) {
  const S = ISLANDS.SHALLOWS_SEGMENTS, R = island.R;
  // raio da costa por ângulo (varredura + bissecção sobre heightAt)
  const shore = new Float32Array(S);
  for (let k = 0; k < S; k++) {
    const th = (k / S) * Math.PI * 2, ct = Math.cos(th), st = Math.sin(th);
    const r0 = island.outlineRadius(th);
    const hAt = (r) => island.heightAt(island.cx + ct * r, island.cz + st * r);
    let lo = r0 * 0.8, hi = r0 * 1.08;
    // garante lo em terra: se não, procura para dentro
    for (let t = 0; t < 6 && hAt(lo) <= 0; t++) lo *= 0.93;
    // primeiro ponto submerso de lo para hi
    const n = 24; let found = hi;
    for (let t = 1; t <= n; t++) { const r = lo + (hi - lo) * (t / n); if (hAt(r) <= 0) { found = r; lo = lo + (hi - lo) * ((t - 1) / n); break; } }
    hi = found;
    for (let t = 0; t < 10; t++) { const m = 0.5 * (lo + hi); if (hAt(m) <= 0) hi = m; else lo = m; }
    shore[k] = 0.5 * (lo + hi);
  }
  // leve suavização angular (vizinhos) para a linha não serrilhar
  const sm = new Float32Array(S);
  for (let k = 0; k < S; k++) sm[k] = 0.25 * shore[(k + S - 1) % S] + 0.5 * shore[k] + 0.25 * shore[(k + 1) % S];

  // bandas: [offset em metros + fração de R, cor, alfa]
  const op = ISLANDS.SHALLOWS_OPACITY;
  const bands = [
    { m: -6, f: 0, color: PAL.foam, alpha: op * 1.25 },
    { m: 8, f: 0, color: PAL.foam, alpha: op * 1.0 },
    { m: 28, f: 0, color: PAL.shallowsNear, alpha: op * 1.4 },
    { m: 0, f: 0.11, color: PAL.shallows, alpha: op * 1.2 },
    { m: 0, f: 0.2, color: PAL.shallowsFar, alpha: op * 0.5 },
    { m: 0, f: ISLANDS.SHALLOWS_OUTER, color: PAL.shallowsFar, alpha: 0 },
  ];
  const NB = bands.length;
  const pos = new Float32Array(S * NB * 3), colr = new Float32Array(S * NB * 3), alpha = new Float32Array(S * NB);
  for (let k = 0; k < S; k++) {
    const th = (k / S) * Math.PI * 2, ct = Math.cos(th), st = Math.sin(th);
    for (let b = 0; b < NB; b++) {
      const bd = bands[b];
      const r = sm[k] + bd.m + bd.f * R;
      const v = k * NB + b;
      pos[v * 3] = ct * r; pos[v * 3 + 1] = ISLANDS.SHALLOWS_Y; pos[v * 3 + 2] = st * r;
      colr[v * 3] = bd.color.r; colr[v * 3 + 1] = bd.color.g; colr[v * 3 + 2] = bd.color.b;
      alpha[v] = bd.alpha;
    }
  }
  const idx = new Uint32Array(S * (NB - 1) * 6);
  let p = 0;
  for (let k = 0; k < S; k++) {
    const k1 = (k + 1) % S;
    for (let b = 0; b < NB - 1; b++) {
      const a = k * NB + b, bb = a + 1, c = k1 * NB + b, d = c + 1;
      idx[p++] = a; idx[p++] = bb; idx[p++] = d;
      idx[p++] = a; idx[p++] = d; idx[p++] = c;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colr, 3));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'raso:' + island.name;
  mesh.position.set(island.cx, 0, island.cz);
  mesh.matrixAutoUpdate = false; mesh.updateMatrix();
  mesh.renderOrder = 1;
  return mesh;
}

// ------------------------------ API pública ---------------------------
export function createIslands(scene, worldData, opts = {}) {
  const quality = opts.quality || 'high';
  const group = new THREE.Group();
  group.name = 'ilhas';

  const materials = {
    terrain: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }),
    tree: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }),
    rock: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 }),
    shallows: makeShallowsMaterial(),
  };
  const treeGeo = makeTreeGeometry();
  const rockGeo = makeRockGeometry(createRng(SEED + 4242));

  const built = [];
  for (const island of worldData.islands) {
    const it = buildIsland(island, { quality, materials, treeGeo, rockGeo });
    group.add(it.terrain, it.trees, it.rocks, it.shallows);
    built.push(it);
  }
  scene.add(group);

  return {
    group,
    islands: built,
    // Esconde vegetação/pedras de ilhas muito distantes (seriam sub-pixel) para
    // poupar triângulos; o terreno e a água rasa ficam sempre visíveis
    // (frustum culling cuida do resto).
    update(camera, time) {
      const cp = camera.position;
      for (const it of built) {
        const d = Math.hypot(cp.x - it.cx, cp.z - it.cz);
        it.trees.visible = d < ISLANDS.TREE_VIS_DIST;
        it.rocks.visible = d < ISLANDS.ROCK_VIS_DIST;
      }
    },
  };
}
