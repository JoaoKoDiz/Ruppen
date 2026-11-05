// =====================================================================
//  Nuvens-cúmulo em billboards instanciados (UM draw call) + anéis de nuvem
//  ao redor das patas de cada elefante + espuma/ondulações na água (UM
//  draw call instanciado). Textura dos "puffs" procedural (canvas: queda
//  radial × ruído, com iluminação assada do topo), claridade por altura
//  dentro da nuvem, ordenação de trás para frente a cada ~0,5 s, deriva
//  lenta, desvanecimento perto da câmera, névoa e profundidade logarítmica.
//  Contrato: createClouds(scene, worldData, {quality})
//            -> { object, update(camera, time, dt), attachTo(elephants) }
// =====================================================================
import * as THREE from 'three';
import { WORLD, COLORS, SEED, CLOUDS, ELEPHANT } from '../config.js';
import { sunDirection } from './lighting.js';
import { createNoise } from '../util/noise.js';
import { createRng } from '../util/rng.js';

const NUM_ANCHORS = ELEPHANT.COUNT;
const FOOT_PUFFS = 96;              // puffs por elefante (quality=high)
const FOOT_Y_MIN = 15, FOOT_Y_MAX = 250;
const WIND = new THREE.Vector3(1.1, 0, 0.45); // deriva das nuvens do mundo (m/s)
const RING_SPIN = 0.0045;            // rad/s de rotação lenta dos anéis das patas
const SORT_INTERVAL = 0.5;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------------
//  Atlas 2×2 de puffs: A = densidade (queda radial deformada por ruído),
//  R = iluminação assada (luz vinda de cima-esquerda sobre a "cúpula").
// ---------------------------------------------------------------------
function makePuffAtlas(cell) {
  const noise = createNoise(SEED + 5501);
  const size = cell * 2;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const dens = new Float32Array(size * size);
  for (let v = 0; v < 4; v++) {
    const ox = (v % 2) * cell, oy = Math.floor(v / 2) * cell;
    const sx = v * 17.3 + 3.1, sy = v * 9.7 + 5.4;
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        const dx = (x + 0.5 - cell / 2) / (cell / 2), dy = (y + 0.5 - cell / 2) / (cell / 2);
        const r = Math.hypot(dx, dy);
        const n1 = noise.fbm2(dx * 1.25 + sx, dy * 1.25 + sy, 3, 2.0, 0.5);      // lóbulos grandes do contorno
        const n2 = noise.fbm2(dx * 3.1 + sx * 2, dy * 3.1 + sy * 2, 3, 2.1, 0.5); // lóbulos médios
        const edge = 0.70 + 0.17 * n1 + 0.06 * n2;  // raio da borda ∈ ~[0.47, 0.93]
        let d = smooth(edge, edge * 0.38, r);
        d *= clamp01(0.92 + 0.16 * n2);
        d *= smooth(0.95, 0.80, r); // margem transparente larga (mips grosseiros não "vazam")
        dens[(oy + y) * size + ox + x] = clamp01(d);
      }
    }
  }
  // iluminação assada: gradiente da densidade como relevo de cúpula
  const L = new THREE.Vector3(-0.35, -0.75, 0.56).normalize(); // y do canvas cresce para baixo → luz de cima
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const xm = Math.max(0, x - 2), xp = Math.min(size - 1, x + 2), ym = Math.max(0, y - 2), yp = Math.min(size - 1, y + 2);
      const gx = (dens[y * size + xp] - dens[y * size + xm]) * 3.2;
      const gy = (dens[yp * size + x] - dens[ym * size + x]) * 3.2;
      const nx = -gx, ny = -gy, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const lit = clamp01(0.5 + 0.5 * ((nx * L.x + ny * L.y + nz * L.z) / len));
      const a = Math.pow(dens[i], 0.85);
      const o = i * 4;
      img.data[o] = Math.round(255 * lit);
      img.data[o + 1] = Math.round(255 * dens[i]);
      img.data[o + 2] = 255;
      img.data[o + 3] = Math.round(255 * a);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.NoColorSpace;
  tex.premultiplyAlpha = false;
  tex.needsUpdate = true;
  return tex;
}

// Ruído tileável (mistura de 4 cópias) para a espuma.
function makeNoiseTexture(size) {
  const noise = createNoise(SEED + 5502);
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const f = 4.0 / size;
  const nz = (x, y) => noise.fbm2(x * f, y * f, 4, 2, 0.5);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const wx = x / size, wy = y / size;
      const n = nz(x, y) * (1 - wx) * (1 - wy) + nz(x - size, y) * wx * (1 - wy) + nz(x - size, y - size) * wx * wy + nz(x, y - size) * (1 - wx) * wy;
      const v = Math.max(0, Math.min(255, Math.round(127.5 + 127.5 * n)));
      const o = (y * size + x) * 4;
      img.data[o] = v; img.data[o + 1] = v; img.data[o + 2] = v; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------
//  Shaders dos puffs
// ---------------------------------------------------------------------
const PUFF_VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
#include <fog_pars_vertex>
attribute vec3 aOffset;   // posição no mundo (grupo -1) ou deslocamento local ao elefante
attribute vec4 aParams;   // tamanho, claridade (0 base .. 1 topo), rotação, grupo (-1 | 0..N-1)
attribute float aVar;     // célula do atlas (0..3) + 4 × espelhar
uniform vec3 uAnchors[NUM_ANCHORS];
uniform vec3 uWind;
uniform float uTime;
uniform float uRingSpin;
uniform vec3 uSunDir;
varying vec2 vUv;
varying float vShade;
varying float vFade;
varying float vSunSide;
varying float vVar;

void main() {
  float size = aParams.x;
  float grp = aParams.w;
  vec3 center;
  if (grp < -0.5) {
    // deriva com o vento, enrolando nos limites do mundo (nunca esvazia um lado do mapa)
    vec2 w = mod(aOffset.xz + uWind.xz * uTime + 30000.0, 60000.0) - 30000.0;
    center = vec3(w.x, aOffset.y, w.y);
  } else {
    int gi = int(grp + 0.5);
    float a = uTime * uRingSpin;
    float ca = cos(a), sa = sin(a);
    center = uAnchors[gi] + vec3(aOffset.x * ca - aOffset.z * sa, aOffset.y, aOffset.x * sa + aOffset.z * ca);
  }
  center.y += sin(uTime * 0.15 + aParams.z * 9.0) * 3.0;

  // billboard esférico sem rolagem: as bases das nuvens ficam niveladas mesmo com a câmera inclinada
  vec3 vd = normalize(center - cameraPosition);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), vd));
  vec3 up = cross(vd, right);
  float mirror = aVar >= 4.0 ? -1.0 : 1.0;
  float cr = cos(aParams.z), sr = sin(aParams.z);
  vec2 q = vec2(position.x * mirror, position.y);
  q = vec2(q.x * cr - q.y * sr, q.x * sr + q.y * cr);
  vec3 world = center + (right * q.x + up * q.y) * size;

  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>

  float depth = -(viewMatrix * vec4(center, 1.0)).z;
  vFade = smoothstep(max(size * 0.22, 18.0), max(size * 0.75, 60.0), depth);
  vUv = uv;
  vShade = aParams.y;
  vSunSide = dot(uSunDir, right) * mirror;
  vVar = aVar;
}`;

const PUFF_FRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
#include <fog_pars_fragment>
uniform sampler2D uMap;
uniform vec3 uLit;
uniform vec3 uShade;
varying vec2 vUv;
varying float vShade;
varying float vFade;
varying float vSunSide;
varying float vVar;

void main() {
  #include <logdepthbuf_fragment>
  float cellIdx = mod(vVar, 4.0);
  vec2 cell = vec2(mod(cellIdx, 2.0), floor(cellIdx / 2.0));
  vec2 uv = (vUv + cell) * 0.5;
  vec4 tx = texture2D(uMap, uv);
  float alpha = tx.a * vFade * smoothstep(0.5, 0.40, length(vUv - 0.5));
  if (alpha < 0.003) discard;
  float lit = tx.r;
  float light = vShade * 0.65 + (lit - 0.5) * 0.55 + 0.30 + (vUv.y - 0.5) * 0.25 + (vUv.x - 0.5) * vSunSide * 0.28;
  // as partes densas do miolo ficam um pouco mais sombreadas (volume)
  light -= tx.g * 0.10 * (1.0 - vShade);
  vec3 col = mix(uShade, uLit, clamp(light, 0.0, 1.0));
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

// ---------------------------------------------------------------------
//  Shaders da espuma/ondulações (anel instanciado por elefante)
// ---------------------------------------------------------------------
const FOAM_VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
#include <fog_pars_vertex>
attribute float aIndex;
uniform vec3 uAnchors[NUM_ANCHORS];
varying vec2 vLocal;
void main() {
  vLocal = position.xz;
  vec3 world = uAnchors[int(aIndex + 0.5)] + vec3(position.x, 0.4, position.z);
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}`;

const FOAM_FRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
#include <fog_pars_fragment>
uniform sampler2D uNoise;
uniform vec3 uFoam;
uniform float uTime;
uniform float uFoamRadius;
varying vec2 vLocal;
void main() {
  #include <logdepthbuf_fragment>
  float r = length(vLocal);
  float th = atan(vLocal.y, vLocal.x) / PI2;
  float R = uFoamRadius;
  vec2 uvA = vec2(th * 16.0 + uTime * 0.003, r / 150.0 - uTime * 0.010);
  vec2 uvB = vec2(th * 6.0 - uTime * 0.0015, r / 480.0 + uTime * 0.003);
  float nA = texture2D(uNoise, uvA).r;
  float nB = texture2D(uNoise, uvB).r;
  // espuma: faixa ao redor das patas, rasgada por ruído
  float band = smoothstep(R * 0.30, R * 0.55, r) * (1.0 - smoothstep(R * 1.15, R * 1.6, r));
  float foam = band * smoothstep(0.40, 0.80, nA * 0.62 + nB * 0.48);
  // ondulações concêntricas que se afastam, esmaecendo
  float rip = 0.5 + 0.5 * sin(r * (PI2 / 120.0) - uTime * 0.8 + nB * 2.5);
  float ripBand = smoothstep(R * 0.7, R * 1.1, r) * (1.0 - smoothstep(R * 1.9, R * 2.7, r));
  float ripple = ripBand * pow(rip, 6.0) * (0.25 + 0.5 * nA) * 0.26;
  float alpha = saturate(foam * 0.92 + ripple);
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(uFoam, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

// ---------------------------------------------------------------------
//  Geração determinística dos puffs
// ---------------------------------------------------------------------
function generatePuffs(worldData, scale, clusters) {
  const rng = createRng(SEED + 5503);
  const out = []; // { x, y, z, size, shade, rot, variant, group }
  const islands = worldData.islands || [];
  const nearIsland = (x, z) => islands.some((isl) => Math.hypot(x - isl.cx, z - isl.cz) < isl.boundRadius + 600);
  const half = WORLD.HALF + 6000;

  // --- nuvens do mundo: aglomerados achatados com base plana e topo em couve-flor
  for (let c = 0; c < CLOUDS.COUNT; c++) {
    let cx = 0, cz = 0;
    for (let tries = 0; tries < 60; tries++) {
      cx = rng.range(-half, half); cz = rng.range(-half, half);
      if (!nearIsland(cx, cz) && Math.hypot(cx, cz) > 2600) break;
    }
    const base = rng.range(CLOUDS.BASE_MIN, CLOUDS.BASE_MAX);
    const width = rng.range(400, 1400);
    const wf = width / 1400;
    const height = rng.range(150, 350) * (0.75 + 0.25 * wf);
    const count = Math.max(4, Math.round(rng.int(CLOUDS.PUFFS_MIN, CLOUDS.PUFFS_MAX) * scale));
    const dirA = rng.range(0, Math.PI * 2);
    const aspect = rng.range(0.45, 1.0);
    const ca = Math.cos(dirA), sa = Math.sin(dirA);
    const nLobes = 1 + Math.floor(rng() * 3);
    const lobes = [];
    clusters.push({ x: cx, y: base, z: cz, width, height });
    for (let l = 0; l < nLobes; l++) {
      const lr = width * (nLobes === 1 ? 0.5 : rng.range(0.25, 0.45));
      lobes.push({
        x: nLobes === 1 ? 0 : rng.range(-0.5, 0.5) * width * 0.6,
        z: nLobes === 1 ? 0 : rng.range(-0.5, 0.5) * width * 0.6 * aspect,
        r: lr, h: height * rng.range(0.6, 1.0),
      });
    }
    // núcleos: 2 puffs grandes por lóbulo dão corpo; os demais fazem a "couve-flor"
    for (const lobe of lobes) {
      for (let k = 0; k < 2; k++) {
        const size = Math.min(320, lobe.r * rng.range(0.95, 1.25));
        const lx = lobe.x + rng.range(-0.25, 0.25) * lobe.r, lz = lobe.z + rng.range(-0.25, 0.25) * lobe.r * aspect;
        const x = cx + lx * ca - lz * sa, z = cz + lx * sa + lz * ca;
        const y = base + size * 0.38 + lobe.h * rng.range(0.05, 0.3);
        out.push({ x, y, z, size, shade: clamp01((y - base) / Math.max(1, height)) * 0.8 + 0.1, rot: rng.range(-0.3, 0.3), variant: Math.floor(rng() * 8), group: -1 });
      }
    }
    for (let i = 0; i < count; i++) {
      const lobe = lobes[Math.floor(rng() * nLobes)];
      const ang = rng.range(0, Math.PI * 2), rad = Math.pow(rng(), 0.65) * lobe.r;
      const edgeT = rad / lobe.r;
      let lx = lobe.x + Math.cos(ang) * rad, lz = lobe.z + Math.sin(ang) * rad * aspect;
      const x = cx + lx * ca - lz * sa, z = cz + lx * sa + lz * ca;
      const hmax = lobe.h * (1 - edgeT * edgeT * 0.75);
      const yrel = hmax * Math.pow(rng(), 0.75);
      const size = (80 + 210 * wf * rng.range(0.5, 1.0)) * (0.8 + 0.5 * (1 - edgeT));
      const y = base + size * 0.36 + yrel;
      const shade = clamp01((y - base) / Math.max(1, height));
      out.push({ x, y, z, size, shade, rot: rng.range(-0.45, 0.45), variant: Math.floor(rng() * 8), group: -1 });
    }
  }

  // --- anéis ao redor das patas (deslocamentos LOCAIS ao elefante)
  const nFoot = Math.round(FOOT_PUFFS * scale);
  const FS = ELEPHANT.SCALE || 1; // as nuvens das patas acompanham a escala do elefante
  for (let e = 0; e < NUM_ANCHORS; e++) {
    const nBig = Math.round(12 * scale); // base sólida: puffs grandes em anel regular
    for (let i = 0; i < nBig; i++) {
      const ang = (i / nBig) * Math.PI * 2 + rng.range(-0.15, 0.15);
      const rad = ELEPHANT.FOOT_CLOUD_RADIUS * rng.range(0.8, 1.05);
      const size = rng.range(360, 440) * FS;
      out.push({ x: Math.cos(ang) * rad, y: FOOT_Y_MIN * FS + size * 0.22, z: Math.sin(ang) * rad, size, shade: 0.5, rot: rng.range(-0.3, 0.3), variant: Math.floor(rng() * 8), group: e });
    }
    for (let i = 0; i < nFoot; i++) {
      const ang = rng.range(0, Math.PI * 2);
      const rad = Math.max(230 * FS, Math.min(1150 * FS, ELEPHANT.FOOT_CLOUD_RADIUS + rng.gauss() * 230 * FS));
      const yt = Math.pow(rng(), 1.3);
      const y = (FOOT_Y_MIN + yt * (FOOT_Y_MAX - FOOT_Y_MIN)) * FS;
      const size = rng.range(170, 400) * FS * (1.0 - 0.3 * yt);
      const shade = 0.45 + 0.55 * yt;
      out.push({ x: Math.cos(ang) * rad, y, z: Math.sin(ang) * rad, size, shade, rot: rng.range(-0.4, 0.4), variant: Math.floor(rng() * 8), group: e });
    }
  }
  return out;
}

export function createClouds(scene, worldData, opts = {}) {
  const quality = opts.quality || 'high';
  const scale = quality === 'low' ? 0.55 : 1.0;
  const group = new THREE.Group();
  group.name = 'clouds';

  // âncoras (posição de cada elefante); sem attachTo usa a pose inicial das rotas
  const routes = worldData.routes || [];
  let anchors = [];
  for (let i = 0; i < NUM_ANCHORS; i++) {
    const r = routes[i % Math.max(1, routes.length)];
    anchors.push(r ? { position: r.poseAt(r.u0).position.clone(), heading: 0 } : { position: new THREE.Vector3(1e7, 0, 1e7), heading: 0 });
  }
  const anchorVals = anchors.map((a) => a.position.clone());

  // ------------------------------- puffs ---------------------------------
  const clusters = [];
  const puffs = generatePuffs(worldData, scale, clusters);
  const N = puffs.length;
  const srcOffset = new Float32Array(N * 3), srcParams = new Float32Array(N * 4), srcVar = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const p = puffs[i];
    srcOffset[i * 3] = p.x; srcOffset[i * 3 + 1] = p.y; srcOffset[i * 3 + 2] = p.z;
    srcParams[i * 4] = p.size; srcParams[i * 4 + 1] = p.shade; srcParams[i * 4 + 2] = p.rot; srcParams[i * 4 + 3] = p.group;
    srcVar[i] = p.variant;
  }
  const offAttr = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
  const parAttr = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
  const varAttr = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
  offAttr.setUsage(THREE.DynamicDrawUsage); parAttr.setUsage(THREE.DynamicDrawUsage); varAttr.setUsage(THREE.DynamicDrawUsage);

  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  geo.setAttribute('uv', quad.getAttribute('uv'));
  geo.setAttribute('aOffset', offAttr);
  geo.setAttribute('aParams', parAttr);
  geo.setAttribute('aVar', varAttr);
  geo.instanceCount = N;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);

  const puffUniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uMap: { value: null },
      uLit: { value: new THREE.Color(COLORS.cloudLit).multiplyScalar(1.35) },
      uShade: { value: new THREE.Color(COLORS.cloudShade).multiplyScalar(1.05) },
      uAnchors: { value: anchorVals },
      uWind: { value: WIND.clone() },
      uTime: { value: 0 },
      uRingSpin: { value: RING_SPIN },
      uSunDir: { value: sunDirection.clone() },
    },
  ]);
  puffUniforms.uAnchors.value = anchorVals; // merge clona; mantém a referência viva
  puffUniforms.uMap.value = makePuffAtlas(quality === 'low' ? 128 : 256);
  const puffMat = new THREE.ShaderMaterial({
    uniforms: puffUniforms, vertexShader: PUFF_VERT, fragmentShader: PUFF_FRAG,
    defines: { NUM_ANCHORS },
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.NormalBlending, side: THREE.DoubleSide, fog: true,
  });
  const puffMesh = new THREE.Mesh(geo, puffMat);
  puffMesh.frustumCulled = false;
  puffMesh.renderOrder = 20;
  puffMesh.name = 'cloudPuffs';
  group.add(puffMesh);

  // ------------------------------ espuma ---------------------------------
  const R = ELEPHANT.FOOT_CLOUD_RADIUS;
  const ring = new THREE.RingGeometry(R * 0.25, R * 2.75, 96, 10);
  ring.rotateX(-Math.PI / 2);
  const foamGeo = new THREE.InstancedBufferGeometry();
  foamGeo.index = ring.index;
  foamGeo.setAttribute('position', ring.getAttribute('position'));
  const idxArr = new Float32Array(NUM_ANCHORS);
  for (let i = 0; i < NUM_ANCHORS; i++) idxArr[i] = i;
  foamGeo.setAttribute('aIndex', new THREE.InstancedBufferAttribute(idxArr, 1));
  foamGeo.instanceCount = NUM_ANCHORS;
  foamGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  const foamUniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uNoise: { value: null },
      uFoam: { value: new THREE.Color(COLORS.foam).multiplyScalar(1.2) },
      uAnchors: { value: anchorVals },
      uTime: { value: 0 },
      uFoamRadius: { value: R },
    },
  ]);
  foamUniforms.uAnchors.value = anchorVals;
  foamUniforms.uNoise.value = makeNoiseTexture(256);
  const foamMat = new THREE.ShaderMaterial({
    uniforms: foamUniforms, vertexShader: FOAM_VERT, fragmentShader: FOAM_FRAG,
    defines: { NUM_ANCHORS },
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.NormalBlending, side: THREE.DoubleSide, fog: true,
  });
  const foamMesh = new THREE.Mesh(foamGeo, foamMat);
  foamMesh.frustumCulled = false;
  foamMesh.renderOrder = 10;
  foamMesh.name = 'footFoam';
  group.add(foamMesh);

  scene.add(group);

  // ----------------------------- ordenação -------------------------------
  const keys = new Float32Array(N);
  const order = new Uint32Array(N);
  const packed = new Float64Array(N);
  for (let i = 0; i < N; i++) order[i] = i;
  const tmp = new THREE.Vector3();
  function resort(camera, time) {
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    const a = time * RING_SPIN, ca = Math.cos(a), sa = Math.sin(a);
    const wx = WIND.x * time, wz = WIND.z * time;
    for (let i = 0; i < N; i++) {
      const g = srcParams[i * 4 + 3];
      let x = srcOffset[i * 3], y = srcOffset[i * 3 + 1], z = srcOffset[i * 3 + 2];
      if (g < 0) { x = ((x + wx + 30000) % 60000 + 60000) % 60000 - 30000; z = ((z + wz + 30000) % 60000 + 60000) % 60000 - 30000; }
      else {
        const an = anchorVals[g | 0];
        const rx = x * ca - z * sa, rz = x * sa + z * ca;
        x = an.x + rx; y = an.y + y; z = an.z + rz;
      }
      const dx = x - cx, dy = y - cy, dz = z - cz;
      keys[i] = dx * dx + dy * dy + dz * dz;
    }
    // ordenação sem comparador (bem mais rápida): chave e índice empacotados num Float64
    for (let i = 0; i < N; i++) packed[i] = -(Math.min(keys[i], 1e13) * 1048576 + i);
    packed.sort();
    for (let k = 0; k < N; k++) order[k] = (-packed[k]) % 1048576;
    const oA = offAttr.array, pA = parAttr.array, vA = varAttr.array;
    for (let k = 0; k < N; k++) {
      const i = order[k];
      oA[k * 3] = srcOffset[i * 3]; oA[k * 3 + 1] = srcOffset[i * 3 + 1]; oA[k * 3 + 2] = srcOffset[i * 3 + 2];
      pA[k * 4] = srcParams[i * 4]; pA[k * 4 + 1] = srcParams[i * 4 + 1]; pA[k * 4 + 2] = srcParams[i * 4 + 2]; pA[k * 4 + 3] = srcParams[i * 4 + 3];
      vA[k] = srcVar[i];
    }
    offAttr.needsUpdate = true; parAttr.needsUpdate = true; varAttr.needsUpdate = true;
  }

  let sortTimer = Infinity; // força ordenação no primeiro update
  let lastSortX = 1e9, lastSortY = 1e9, lastSortZ = 1e9;

  return {
    object: group,
    puffCount: N,
    clusters,
    attachTo(elephants) {
      if (!elephants || !elephants.length) return;
      anchors = [];
      for (let i = 0; i < NUM_ANCHORS; i++) anchors.push(elephants[i % elephants.length]);
      sortTimer = Infinity;
    },
    update(camera, time, dt = 0) {
      for (let i = 0; i < NUM_ANCHORS; i++) {
        const a = anchors[i];
        if (a && a.position) anchorVals[i].copy(a.position);
      }
      puffUniforms.uTime.value = time;
      foamUniforms.uTime.value = time;
      sortTimer += dt;
      // reordena a cada ~0,5 s, ou imediatamente se a câmera saltou (teleporte)
      tmp.set(camera.position.x - lastSortX, camera.position.y - lastSortY, camera.position.z - lastSortZ);
      if (sortTimer >= SORT_INTERVAL || tmp.lengthSq() > 250 * 250) {
        resort(camera, time);
        sortTimer = 0;
        lastSortX = camera.position.x; lastSortY = camera.position.y; lastSortZ = camera.position.z;
      }
    },
  };
}
