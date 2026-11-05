// =====================================================================
//  Ilhas — terreno por vértice (areia, grama, floresta, rocha), árvores e
//  pedras instanciadas. Tudo procedural, estático e determinístico (SEED).
//  Contrato (ARCHITECTURE.md 4.3):
//    createIslands(scene, worldData, { quality }) -> { group, update(camera, time) }
//  Por ilha: 1 malha de terreno (grade ~170×170 amostrando island.heightAt,
//  cores por altura + inclinação com ruído), 1 InstancedMesh de árvores
//  (copa dupla em cone + tronco, cor por instância) e 1 InstancedMesh de
//  pedras (dodecaedro irregular). ~125k triângulos por ilha, 3 draw calls.
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
    sandLight: mix(COLORS.sand, 0xfff7dd, 0.6),       // faixa clara (espuma/areia molhada seca) na linha d'água
    sandWet: mix(COLORS.sand, 0x5a7470, 0.45),        // areia submersa rasa
    seabed: c(0x2f4f55),                              // fundo mais profundo
    grass: c(COLORS.grass),
    grassLight: mix(COLORS.grass, 0xc4cf6c, 0.45),
    grassDark: mix(COLORS.grass, COLORS.forest, 0.5),
    forest: c(COLORS.forest),
    forestDark: mix(COLORS.forest, 0x1c3a22, 0.55),
    rock: c(COLORS.rock),
    rockDark: c(COLORS.rockDark),
    rockLight: mix(COLORS.rock, 0xdcd7cd, 0.65),      // picos mais claros
    wood: c(COLORS.wood),
  };
})();

// ---------------------- classificação da cobertura --------------------
// Pesos (0..1) das faixas num ponto do terreno. y em metros, ny = componente Y da
// normal (1 = plano, 0 = vertical), n1 = ruído de manchas (~420 m), n2 = ruído
// fino (~70 m). As bordas das faixas são "tremidas" pelo ruído para parecerem
// naturais. Usada tanto para colorir os vértices quanto para posicionar
// árvores e pedras (assim as árvores ficam onde o terreno é verde).
function coverAt(y, ny, n1, n2, maxH, out) {
  const yD = y + 26 * n1 + 9 * n2;
  const sD = ny + 0.08 * n1 + 0.05 * n2;
  const sand = (1 - smoothstep(9, 19, yD)) * smoothstep(0.78, 0.9, sD) * smoothstep(-6, -1, y);
  const high = 1 - smoothstep(540, 700, yD);
  let forest = smoothstep(60, 150, yD) * high;
  // bosques espalhados nas baixadas (manchas do ruído grande)
  forest = Math.max(forest, smoothstep(0.2, 0.5, n1) * smoothstep(14, 32, yD) * high);
  const rock = Math.max(smoothstep(0.70, 0.52, sD), smoothstep(700, 880, yD));
  const peak = smoothstep(maxH * 0.62, maxH * 0.92, yD);
  out.sand = sand;
  out.forest = forest * (1 - sand);
  out.rock = rock;
  out.peak = peak;
  out.grass = clamp(1 - sand - out.forest, 0, 1) * (1 - rock);
  return out;
}

const _tmpA = new THREE.Color(), _tmpB = new THREE.Color();
// Cor final do vértice (linear) a partir dos pesos de cobertura.
function terrainColor(y, ny, n1, n2, n3, cov, out) {
  // grama com variação de tom
  out.copy(PAL.grassDark).lerp(PAL.grassLight, clamp(0.5 + 0.45 * n1 + 0.2 * n2, 0, 1));
  // floresta escura
  _tmpA.copy(PAL.forest).lerp(PAL.forestDark, clamp(0.5 + 0.5 * n2, 0, 1));
  out.lerp(_tmpA, cov.forest);
  // areia
  out.lerp(PAL.sand, cov.sand);
  // rocha (escura/clara por ruído, mais clara nos picos)
  _tmpB.copy(PAL.rockDark).lerp(PAL.rock, clamp(0.5 + 0.35 * n2 + 0.25 * n1, 0, 1)).lerp(PAL.rockLight, cov.peak);
  out.lerp(_tmpB, cov.rock);
  // faixa clara estreita na linha d'água (só onde é plano)
  const foam = (1 - smoothstep(1.2, 3.4, Math.abs(y - 0.8))) * smoothstep(0.75, 0.9, ny);
  out.lerp(PAL.sandLight, foam * 0.85);
  // submerso: areia molhada -> fundo escuro
  if (y < 0.5) {
    _tmpA.copy(PAL.sandWet).lerp(PAL.seabed, smoothstep(0, -45, y));
    out.lerp(_tmpA, smoothstep(0.5, -1.5, y));
  }
  // variação fina de brilho
  out.multiplyScalar(1 + 0.07 * n3);
  return out;
}

// --------------------------- geometrias base --------------------------
// Árvore unitária (altura 1): tronco curto + duas copas em cone, facetada.
// Cor por vértice: copas brancas (recebem a cor verde da instância), tronco
// marrom "pré-dividido" pela cor média das instâncias (vColor = cor*instância).
function makeTreeGeometry() {
  const avgGreen = PAL.forest.clone().lerp(PAL.grass, 0.4);
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
  const lower = new THREE.ConeGeometry(0.34, 0.56, 6, 1, true); lower.translate(0, 0.14 + 0.28, 0);
  const upper = new THREE.ConeGeometry(0.24, 0.55, 6, 1, true); upper.translate(0, 0.45 + 0.275, 0); upper.rotateY(Math.PI / 6);
  const trunk = new THREE.CylinderGeometry(0.045, 0.07, 0.3, 4, 1, true); trunk.translate(0, 0.08, 0);
  setColor(lower, white, 0.12); setColor(upper, white, 0.12); setColor(trunk, trunkCol, 0);
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

// ------------------------------ uma ilha ------------------------------
function buildIsland(island, opts) {
  const { quality, materials, treeGeo, rockGeo } = opts;
  const low = quality === 'low';
  const N = low ? ISLANDS.GRID_LOW : ISLANDS.GRID_HIGH;
  const B = island.boundRadius;
  const step = (2 * B) / (N - 1);
  const cx = island.cx, cz = island.cz, maxH = island.maxH;
  const noise = createNoise(SEED + 7001 + island.id * 13);
  const rng = createRng(SEED + 9100 + island.id * 17);
  const n1At = (x, z) => noise.fbm2(x / 420, z / 420, 3, 2, 0.5);
  const n2At = (x, z) => noise.fbm2(x / 70 + 31.7, z / 70 - 11.3, 2, 2, 0.5);
  const n3At = (x, z) => noise.noise2(x / 23 - 8.1, z / 23 + 4.4);

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

  // ---- cores por vértice (altura + inclinação + ruído) ----
  const colors = new Float32Array(N * N * 3);
  const cov = { sand: 0, grass: 0, forest: 0, rock: 0, peak: 0 };
  const col = new THREE.Color();
  for (let j = 0; j < N; j++) {
    const z = cz - B + j * step;
    for (let i = 0; i < N; i++) {
      const x = cx - B + i * step;
      const k = j * N + i;
      const y = H[k], ny = normals[k * 3 + 1];
      const n1 = n1At(x, z), n2 = n2At(x, z), n3 = n3At(x, z);
      coverAt(y, ny, n1, n2, maxH, cov);
      terrainColor(y, ny, n1, n2, n3, cov, col);
      colors[k * 3] = col.r; colors[k * 3 + 1] = col.g; colors[k * 3 + 2] = col.b;
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
  const s = { y: 0, ny: 1 };
  function sampleSurface(lx, lz) {
    const fx = (lx + B) / step, fz = (lz + B) / step;
    const i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= N - 1 || j >= N - 1) return false;
    const u = fx - i, v = fz - j;
    const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
    s.y = u > v ? H[a] + u * (H[b] - H[a]) + v * (H[d] - H[b]) : H[a] + v * (H[c] - H[a]) + u * (H[d] - H[c]);
    s.ny = (normals[a * 3 + 1] * (1 - u) + normals[b * 3 + 1] * u) * (1 - v) + (normals[c * 3 + 1] * (1 - u) + normals[d * 3 + 1] * u) * v;
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
  for (let tries = 0; placed < treeCount && tries < treeCount * 60; tries++) {
    const lx = rng.range(-rMax, rMax), lz = rng.range(-rMax, rMax);
    if (lx * lx + lz * lz > rMax * rMax) continue;
    if (!sampleSurface(lx, lz) || s.y < 3) continue;
    const x = cx + lx, z = cz + lz;
    const n1 = n1At(x, z), n2 = n2At(x, z);
    coverAt(s.y, s.ny, n1, n2, maxH, cov);
    const slopeOK = smoothstep(0.5, 0.72, s.ny);
    const density = 0.15 + 0.85 * smoothstep(-0.3, 0.35, noise.fbm2(x / 260 + 77.3, z / 260 - 41.9, 2, 2, 0.5));
    const prob = (cov.forest + 0.14 * cov.grass + 0.02 * cov.sand) * (1 - cov.rock) * slopeOK * density;
    if (rng() > prob) continue;
    // tamanho (exagerado de propósito), maior dentro da floresta
    const h = lerp(ISLANDS.TREE_HEIGHT_MIN, ISLANDS.TREE_HEIGHT_MAX, Math.pow(rng(), 1.4)) * (1 + 0.12 * cov.forest);
    const w = rng.range(0.8, 1.2);
    pos3.set(lx, s.y - (1 - s.ny) * 0.3 * h - 0.3, lz);
    quat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rng() * Math.PI * 2);
    scl.set(h * w, h, h * w);
    mat4.compose(pos3, quat, scl);
    trees.setMatrixAt(placed, mat4);
    // cor: entre floresta escura e grama clara, mais escura dentro da floresta
    icol.copy(PAL.forestDark).lerp(PAL.forest, rng());
    const t = cov.forest * rng.range(0, 0.35) + (1 - cov.forest) * rng.range(0.3, 0.8);
    icol.lerp(PAL.grass, t).multiplyScalar(rng.range(0.85, 1.12));
    icol.r *= rng.range(0.95, 1.15);
    trees.setColorAt(placed, icol);
    placed++;
  }
  trees.count = placed;
  trees.instanceMatrix.needsUpdate = true;
  if (trees.instanceColor) trees.instanceColor.needsUpdate = true;
  trees.position.set(cx, 0, cz);
  trees.matrixAutoUpdate = false; trees.updateMatrix();
  trees.computeBoundingSphere();

  // ---- pedras ----
  const rockCount = low ? ISLANDS.ROCKS_LOW : ISLANDS.ROCKS_HIGH;
  const rocks = new THREE.InstancedMesh(rockGeo, materials.rock, rockCount);
  rocks.name = 'pedras:' + island.name;
  let placedR = 0;
  for (let tries = 0; placedR < rockCount && tries < rockCount * 200; tries++) {
    const lx = rng.range(-rMax, rMax), lz = rng.range(-rMax, rMax);
    if (lx * lx + lz * lz > rMax * rMax) continue;
    if (!sampleSurface(lx, lz) || s.y < -1) continue;
    const x = cx + lx, z = cz + lz;
    const n1 = n1At(x, z), n2 = n2At(x, z);
    coverAt(s.y, s.ny, n1, n2, maxH, cov);
    let prob;
    if (cov.rock > 0.35 && s.ny > 0.3) prob = 0.9;              // encostas íngremes e sopé de falésias
    else if (cov.sand > 0.5) prob = 0.1;                         // algumas na praia
    else prob = 0.04 * (1 - cov.forest);                         // raras na grama
    if (rng() > prob) continue;
    const sz = 5 + 22 * rng() * rng();
    scl.set(sz * rng.range(0.8, 1.5), sz * rng.range(0.6, 1.0), sz * rng.range(0.8, 1.5));
    eul.set(rng.range(-0.5, 0.5), rng() * Math.PI * 2, rng.range(-0.5, 0.5));
    quat.setFromEuler(eul);
    pos3.set(lx, s.y - scl.y * 0.25, lz);
    mat4.compose(pos3, quat, scl);
    rocks.setMatrixAt(placedR, mat4);
    icol.copy(PAL.rockDark).lerp(PAL.rock, rng()).lerp(PAL.rockLight, 0.35 * rng() * cov.peak + 0.1 * rng());
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

  return { island, cx, cz, terrain, trees, rocks, sampleSurface };
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
  };
  const treeGeo = makeTreeGeometry();
  const rockGeo = makeRockGeometry(createRng(SEED + 4242));

  const built = [];
  for (const island of worldData.islands) {
    const it = buildIsland(island, { quality, materials, treeGeo, rockGeo });
    group.add(it.terrain, it.trees, it.rocks);
    built.push(it);
  }
  scene.add(group);

  return {
    group,
    islands: built,
    // Esconde vegetação/pedras de ilhas muito distantes (seriam sub-pixel) para
    // poupar triângulos; o terreno fica sempre visível (frustum culling cuida do resto).
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
