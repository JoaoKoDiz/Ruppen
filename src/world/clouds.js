// =====================================================================
//  Nuvens-cúmulo em billboards instanciados (UM draw call) + bancos de nuvem
//  ao redor das patas de cada elefante + espuma/ondulações/esteira na água
//  (UM draw call instanciado).
//  Atlas de puffs 4×2 (8 variantes) gerado em código (DataTexture — sem a
//  quantização de alfa pré-multiplicado do canvas): RG = normal da "cúpula"
//  do puff, B = densidade (espessura), A = cobertura com bordas esgarçadas.
//  Iluminação por puff no fragment: difusa envolvente do sol pela normal do
//  atlas, termo "powder" (miolo denso um pouco mais escuro, bordas claras),
//  silver lining (bordas viradas para o sol quando o puff está em contraluz),
//  ambiente azul-cinza do céu nas bases, altura dentro da nuvem.
//  Ordenação de trás para frente a cada ~0,5 s, deriva lenta, desvanecimento
//  perto da câmera e junto ao mar, névoa e profundidade logarítmica.
//  Contrato: createClouds(scene, worldData, {quality})
//            -> { object, update(camera, time, dt), attachTo(elephants) }
// =====================================================================
import * as THREE from 'three';
import { WORLD, COLORS, SEED, CLOUDS, ELEPHANT } from '../config.js';
import { sunDirection } from './lighting.js';
import { createNoise } from '../util/noise.js';
import { createRng } from '../util/rng.js';

const NUM_ANCHORS = ELEPHANT.COUNT;
const FOOT_PUFFS = CLOUDS.FOOT_PUFFS; // puffs do banco por elefante (quality=high)
const LEG_HEIGHT = (ELEPHANT.LEG.topY - ELEPHANT.LEG.bottomY) * (ELEPHANT.SCALE || 1); // m (mundo)
const FOOT_X = ELEPHANT.LEG.offsetX * (ELEPHANT.SCALE || 1); // posição das patas (local, m)
const FOOT_Z = ELEPHANT.LEG.offsetZ * (ELEPHANT.SCALE || 1);
const LEG_R = ELEPHANT.LEG.radius * (ELEPHANT.SCALE || 1);     // raio da pata (m, mundo)
const WIND = new THREE.Vector3(1.1, 0, 0.45); // deriva das nuvens do mundo (m/s)
const RING_SPIN = 0.0045;            // rad/s de rotação lenta dos anéis das patas
const SORT_INTERVAL = 0.5;
const ATLAS_COLS = 4, ATLAS_ROWS = 2, ATLAS_VARIANTS = ATLAS_COLS * ATLAS_ROWS;
const RIPPLE_PERIOD = 20;            // s — um anel novo parte de cada pata a cada ~20 s
const RIPPLE_RINGS = 3;              // anéis vivos por pata (vida = PERIOD × RINGS)

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

function makeTexture(data, w, h, repeat) {
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------
//  Atlas 4×2 de puffs: A = cobertura (queda radial deformada por ruído, com
//  esgarçamento de alta frequência nas bordas), B = densidade, RG = normal
//  (cúpula + relevo dos lóbulos), para a iluminação por puff no shader.
// ---------------------------------------------------------------------
function makePuffAtlas(cell) {
  const noise = createNoise(SEED + 5501);
  const W = cell * ATLAS_COLS, Hh = cell * ATLAS_ROWS;
  const data = new Uint8Array(W * Hh * 4);
  const dens = new Float32Array(W * Hh);
  const edgeR = new Float32Array(W * Hh);
  for (let v = 0; v < ATLAS_VARIANTS; v++) {
    const ox = (v % ATLAS_COLS) * cell, oy = Math.floor(v / ATLAS_COLS) * cell;
    const sx = v * 17.3 + 3.1, sy = v * 9.7 + 5.4;
    const aspectY = [1.0, 1.15, 0.9, 1.25, 1.0, 1.1, 0.95, 1.2][v];   // alguns puffs mais achatados
    const flatBase = [0.3, 0.0, 0.25, 0.35, 0.0, 0.2, 0.0, 0.3][v];   // base achatada (cúmulo)
    const wispy = [0.35, 0.6, 0.45, 0.3, 0.7, 0.5, 0.4, 0.55][v];     // quanto a borda esgarça
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        const dx = (x + 0.5 - cell / 2) / (cell / 2), dy = (y + 0.5 - cell / 2) / (cell / 2);
        const r = Math.hypot(dx, dy * aspectY);
        const n1 = noise.fbm2(dx * 1.25 + sx, dy * 1.25 + sy, 3, 2.0, 0.5);      // lóbulos grandes do contorno
        const n2 = noise.fbm2(dx * 3.1 + sx * 2, dy * 3.1 + sy * 2, 3, 2.1, 0.5); // lóbulos médios
        const n3 = noise.fbm2(dx * 7.5 + sx * 3, dy * 7.5 + sy * 3, 3, 2.2, 0.55); // fiapos
        let edge = 0.70 + 0.16 * n1 + 0.06 * n2;  // raio da borda ∈ ~[0.48, 0.92]
        edge *= 1 - flatBase * smooth(0.25, 0.85, dy);       // base achatada (y do canvas cresce para baixo)
        let d = smooth(edge, edge * 0.45, r);                 // lóbulos definidos (couve-flor)
        d *= clamp01(0.92 + 0.16 * n2);
        // esgarçamento: a faixa externa é corroída por ruído fino (bordas em fiapos)
        const outer = Math.pow(1 - d, 1.6);
        d = clamp01(d - outer * wispy * clamp01(0.55 + 0.7 * n3));
        d *= smooth(0.97, 0.82, r); // margem transparente (mips grosseiros não "vazam")
        const i = (oy + y) * W + ox + x;
        dens[i] = clamp01(d);
        edgeR[i] = edge;
      }
    }
  }
  for (let v = 0; v < ATLAS_VARIANTS; v++) {
    const ox = (v % ATLAS_COLS) * cell, oy = Math.floor(v / ATLAS_COLS) * cell;
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        const i = (oy + y) * W + ox + x;
        const dx = (x + 0.5 - cell / 2) / (cell / 2), dy = (y + 0.5 - cell / 2) / (cell / 2);
        // normal: cúpula (aponta para fora nas bordas) + relevo dos lóbulos (gradiente da densidade)
        const xm = Math.max(ox, ox + x - 2), xp = Math.min(ox + cell - 1, ox + x + 2);
        const ym = Math.max(oy, oy + y - 2), yp = Math.min(oy + cell - 1, oy + y + 2);
        const gx = (dens[(oy + y) * W + xp] - dens[(oy + y) * W + xm]) * 2.2;
        const gy = (dens[yp * W + ox + x] - dens[ym * W + ox + x]) * 2.2;
        const rr = Math.min(1, Math.hypot(dx, dy) / Math.max(0.3, edgeR[i]));
        const domeZ = Math.sqrt(Math.max(0.04, 1 - rr * rr));
        let nx = dx * 0.9 - gx, ny = -dy * 0.9 + gy, nz = domeZ * 1.1 + 0.35;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len;
        const dd = dens[i];
        const a = Math.pow(dd, 0.62); // miolo opaco: puffs sobrepostos formam massa sólida
        const o = i * 4;
        data[o] = Math.round(127.5 + 127.5 * nx);
        data[o + 1] = Math.round(127.5 + 127.5 * ny);
        data[o + 2] = Math.round(255 * dd);
        data[o + 3] = Math.round(255 * a);
      }
    }
  }
  return makeTexture(data, W, Hh, false);
}

// Ruído tileável (R = fbm, G = fbm mais fino, B = "bolhas" — distância ao ponto
// mais próximo de uma nuvem de pontos, periódica) para a espuma.
function makeFoamTexture(size) {
  const noise = createNoise(SEED + 5502);
  const rng = createRng(SEED + 5504);
  const pts = [];
  for (let i = 0; i < 180; i++) pts.push([rng() * size, rng() * size, rng.range(0.6, 1.3)]);
  const data = new Uint8Array(size * size * 4);
  const f = 4.0 / size, f2 = 11.0 / size;
  const nz = (x, y) => noise.fbm2(x * f, y * f, 4, 2, 0.5);
  const nz2 = (x, y) => noise.fbm2(x * f2 + 9, y * f2 + 4, 3, 2.2, 0.55);
  const tile = (fn, x, y) => {
    const wx = x / size, wy = y / size;
    return fn(x, y) * (1 - wx) * (1 - wy) + fn(x - size, y) * wx * (1 - wy) + fn(x - size, y - size) * wx * wy + fn(x, y - size) * (1 - wx) * wy;
  };
  const cellR = size / Math.sqrt(180) * 0.9;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let f1 = 1e9;
      for (const [px, py, pr] of pts) {
        let ddx = Math.abs(x - px), ddy = Math.abs(y - py);
        if (ddx > size / 2) ddx = size - ddx;
        if (ddy > size / 2) ddy = size - ddy;
        f1 = Math.min(f1, Math.hypot(ddx, ddy) / (cellR * pr));
      }
      const o = (y * size + x) * 4;
      data[o] = Math.max(0, Math.min(255, Math.round(127.5 + 127.5 * tile(nz, x, y))));
      data[o + 1] = Math.max(0, Math.min(255, Math.round(127.5 + 127.5 * tile(nz2, x, y))));
      data[o + 2] = Math.round(255 * clamp01(f1)); // 0 no centro de cada bolha, 1 entre bolhas
      data[o + 3] = 255;
    }
  }
  return makeTexture(data, size, size, true);
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
attribute float aVar;     // célula do atlas (0..7) + 8 × espelhar
uniform vec3 uAnchors[NUM_ANCHORS];
uniform vec3 uWind;
uniform float uTime;
uniform float uRingSpin;
uniform vec3 uSunDir;
varying vec2 vUv;
varying float vShade;
varying float vFade;
varying vec3 vSunB;       // direção do sol no espaço do atlas (x direita, y cima, z para a câmera)
varying float vBacklit;   // 0..1: o puff está entre a câmera e o sol (contraluz)
varying float vVar;
varying float vWorldY;
varying float vSize;

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
  float mirror = aVar >= 8.0 ? -1.0 : 1.0;
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
  // o desvanecimento junto ao mar é feito POR PIXEL no fragment (vWorldY/vSize)
  vWorldY = world.y;
  vSize = size;
  vUv = uv;
  vShade = aParams.y;
  // sol no espaço do atlas: base (right, up, -vd), desfaz a rotação do quad e o espelho
  vec2 sxy = vec2(dot(uSunDir, right), dot(uSunDir, up));
  sxy = vec2(sxy.x * cr + sxy.y * sr, -sxy.x * sr + sxy.y * cr);
  sxy.x *= mirror;
  vSunB = vec3(sxy, dot(uSunDir, -vd));
  vBacklit = smoothstep(-0.2, 0.9, dot(uSunDir, vd));
  vVar = aVar;
}`;

const PUFF_FRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
#include <fog_pars_fragment>
uniform sampler2D uMap;
uniform vec3 uSunColor;
uniform vec3 uAmbTop;     // luz do céu vindo de cima (branco-azulado)
uniform vec3 uShade;      // ambiente azul-cinza das bases
varying vec2 vUv;
varying float vShade;
varying float vFade;
varying vec3 vSunB;
varying float vBacklit;
varying float vVar;
varying float vWorldY;
varying float vSize;

void main() {
  #include <logdepthbuf_fragment>
  // vVar é interpolado: arredonda (senão 7,99999 ≠ 8 escolhe outra célula por pixel → pontilhado)
  float cellIdx = mod(floor(vVar + 0.5), 8.0);
  vec2 cell = vec2(mod(cellIdx, 4.0), floor(cellIdx / 4.0));
  vec2 uv = (vUv + cell) * vec2(0.25, 0.5);
  vec4 tx = texture2D(uMap, uv);
  float alpha = tx.a * vFade * smoothstep(0.5, 0.36, length(vUv - 0.5));
  // some suavemente perto do nível do mar (sem corte reto do quad na água)
  // (faixa curta: o banco das patas encosta na água, como nas referências)
  alpha *= smoothstep(0.0, min(vSize * 0.07, 45.0), vWorldY);
  if (alpha < 0.006) discard;

  vec3 N = vec3(tx.rg * 2.0 - 1.0, 0.0);
  N.z = sqrt(saturate(1.0 - dot(N.xy, N.xy)));
  float dens = tx.b;
  // difusa envolvente pelo relevo do puff (lado do sol claro, lado oposto na sombra)
  float ndl = dot(N, vSunB);
  // contraluz: o relevo de CADA puff quase não conta (senão o banco vira "escamas"
  // com miolo escuro e borda clara em cada puff); a variação vem da altura na nuvem
  float relief = 1.0 - 0.75 * vBacklit;
  float wrapL = mix(0.62, saturate(ndl * 0.65 + 0.35), relief);
  // "powder"/espalhamento múltiplo: miolo denso um pouco mais escuro, bordas finas claras
  float powder = 1.0 - (0.40 - 0.22 * vBacklit) * dens * dens;
  // auto-sombra da massa acima: base da nuvem escura, topo claro
  float heightLit = mix(0.16, 1.0, pow(vShade, 0.8));
  // silver lining: borda fina (baixa densidade) dos puffs do contorno superior, em contraluz
  float edge = pow(1.0 - dens, 3.0) * smoothstep(0.02, 0.35, tx.a);
  vec2 sd = vSunB.xy / max(length(vSunB.xy), 1e-3);
  float rim = edge * saturate(dot(N.xy, sd) * 1.5) * vBacklit * smoothstep(0.45, 0.95, vShade);
  // retroespalhamento: visto com o sol atrás da câmera, a nuvem fica uniformemente clara
  float frontLit = saturate(vSunB.z) * 0.35;
  vec3 sun = uSunColor * (wrapL * powder * heightLit + frontLit * heightLit + rim * 1.3);
  // ambiente do céu: topo/lados virados para cima recebem branco-azulado, bases azul-cinza
  float up = saturate(N.y * 0.5 + 0.5);
  vec3 amb = mix(uShade, uAmbTop, mix(0.5, up, relief) * (0.35 + 0.65 * vShade));
  amb *= (1.0 - 0.22 * dens * relief) * mix(0.62, 1.0, vShade);
  vec3 col = amb + sun;
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

// ---------------------------------------------------------------------
//  Shaders da espuma / anéis / esteira (anel instanciado por elefante)
// ---------------------------------------------------------------------
const FOAM_VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
#include <fog_pars_vertex>
attribute float aIndex;
uniform vec3 uAnchors[NUM_ANCHORS];
uniform float uHeadings[NUM_ANCHORS];
varying vec2 vLocal;   // no referencial do elefante (x = frente, y = lado direito)
varying vec2 vWorldXZ;
varying float vSeed;
void main() {
  int i = int(aIndex + 0.5);
  float h = uHeadings[i];
  float ch = cos(h), sh = sin(h);
  // mundo = R_y(heading) · local  ⇒  local = R_y(-heading) · mundo
  vLocal = vec2(position.x * ch - position.z * sh, position.x * sh + position.z * ch);
  vec3 world = uAnchors[i] + vec3(position.x, 0.4, position.z);
  vWorldXZ = world.xz;
  vSeed = aIndex;
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
uniform vec3 uRipple;
uniform float uTime;
uniform float uFoamRadius;
varying vec2 vLocal;
varying vec2 vWorldXZ;
varying float vSeed;

// anel fino com antisserrilhado: alarga a gaussiana pela pegada do pixel e
// conserva a energia (longe vira um traço fraco e largo, nunca cintila)
float thinRing(float x, float w, float fw) {
  float ew = sqrt(w * w + fw * fw * 2.25);
  return exp(-x * x / (ew * ew)) * (w / ew);
}

void main() {
  #include <logdepthbuf_fragment>
  float r = length(vLocal);
  float R = uFoamRadius;
  vec2 pw = vWorldXZ;
  // ruídos em coordenadas de MUNDO (a espuma não gira com o elefante; deriva devagar)
  vec3 nA = texture2D(uNoise, pw * (1.0 / 1300.0) + uTime * vec2(0.003, 0.0015)).rgb;
  vec3 nB = texture2D(uNoise, pw * (1.0 / 260.0) - uTime * vec2(0.006, 0.009)).rgb;
  vec3 nC = texture2D(uNoise, pw * (1.0 / 240.0) + uTime * vec2(0.02, -0.015)).rgb;
  vec3 nD = texture2D(uNoise, pw * (1.0 / 60.0) - uTime * vec2(0.03, 0.02)).rgb;
  // bolhas: buracos redondos (Worley; células ≈ tile/13) em duas escalas. Quando a
  // célula fica menor que ~3 pixels a máscara vira a sua média (sem padrão serrilhado)
  float fpx = length(fwidth(pw)) + 1e-3;
  float bC = mix(smoothstep(0.22, 0.62, nC.b), 0.62, smoothstep(2.0, 7.0, fpx));
  float bD = mix(smoothstep(0.18, 0.60, nD.b), 0.66, smoothstep(0.6, 2.0, fpx));
  float bubbles = bC * mix(1.0, bD, 0.8);
  float lace = nA.r * 0.45 + nB.g * 0.35 + nC.r * 0.2;                   // rendilhado rasgado

  // ---- espuma ao redor de cada pata: colar denso e borbulhante colado à pata,
  //      franjas rasgadas e manchas que se soltam e se espalham com a deriva
  vec2 feet[4];
  feet[0] = vec2( FOOT_X,  FOOT_Z); feet[1] = vec2(-FOOT_X, -FOOT_Z);
  feet[2] = vec2( FOOT_X, -FOOT_Z); feet[3] = vec2(-FOOT_X,  FOOT_Z);
  float foam = 0.0;
  float ring = 0.0;
  float fwr = fwidth(r) + 1e-3;
  for (int j = 0; j < 4; j++) {
    float fr = length(vLocal - feet[j]);
    float x = fr - LEG_R;                                  // distância da superfície da pata
    float reach = 50.0 + 300.0 * nA.g * nA.g + 160.0 * nB.r;              // largura irregular do colar
    float collar = 1.0 - smoothstep(10.0, reach, x);
    collar *= smoothstep(0.38, 0.72, lace + 0.16 * (1.0 - smoothstep(0.0, 120.0, x)));
    float fringe = (1.0 - smoothstep(100.0, 420.0 + 380.0 * nA.b, x)) * smoothstep(0.55, 0.75, lace + 0.1 * nC.g);
    foam = max(foam, max(collar, fringe * 0.7) * step(-20.0, x));
    // anéis que se expandem de cada pata a cada ~RIPPLE_PERIOD s: crista fina e clara,
    // quebrada em arcos pelo ruído, mais fraca e mais larga ao se expandir
    float ph0 = float(j) * 0.29 + vSeed * 0.37;
    for (int k = 0; k < RIPPLE_RINGS; k++) {
      float life = fract(uTime / (RIPPLE_PERIOD * float(RIPPLE_RINGS)) + ph0 + float(k) / float(RIPPLE_RINGS));
      float rad = LEG_R + 120.0 + life * 1.25 * R;
      float w = 9.0 + 34.0 * life;
      float arcs = smoothstep(0.30, 0.62, nA.g * 0.7 + nB.b * 0.3);
      float g = thinRing(fr - rad, w, fwr) + 0.35 * thinRing(fr - rad + 2.6 * w + 30.0, w * 1.6, fwr);
      ring = max(ring, g * pow(1.0 - life, 1.6) * smoothstep(0.0, 0.06, life) * arcs);
    }
  }
  // espuma remexida sob o banco de nuvens (entre as patas): manchas esparsas e fracas
  float under = (1.0 - smoothstep(R * 0.45, R * 0.95, r)) * smoothstep(0.60, 0.78, lace) * 0.35;
  foam = max(foam, under) * bubbles;

  // ---- esteira atrás (x < 0 no referencial do elefante): duas linhas a partir das
  //      patas externas abrindo devagar + rastro turbulento central
  float back = -vLocal.x;
  float wake = 0.0;
  if (back > 0.0) {
    float spread = FOOT_Z + LEG_R * 0.6 + back * 0.08;
    float w = 70.0 + back * 0.05;
    float lines = exp(-pow((abs(vLocal.y) - spread) / w, 2.0));
    float streak = smoothstep(0.35, 0.8, texture2D(uNoise, vec2(vLocal.x / 2600.0, vLocal.y / 420.0) + vec2(uTime * 0.0015, 0.0)).r);
    float trail = (1.0 - smoothstep(0.0, FOOT_Z * 1.1, abs(vLocal.y))) * smoothstep(0.55, 0.85, nB.r);
    float along = smoothstep(0.0, 700.0, back) * exp(-back / 2600.0);
    wake = (lines * (0.4 + 0.6 * streak) * 0.45 + trail * 0.2) * along * (0.5 + 0.5 * bubbles);
  }
  float alpha = saturate(foam * 0.92);
  float ripA = saturate(ring * 0.38 + wake * 0.45);
  vec3 col = mix(uRipple, uFoam, saturate(alpha / max(alpha + ripA, 1e-3)));
  float a = saturate(alpha + ripA * (1.0 - alpha));
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
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
  const variant = () => Math.floor(rng() * ATLAS_VARIANTS * 2); // 8 células × espelho

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
        out.push({ x, y, z, size, shade: clamp01((y - base) / Math.max(1, height)) * 0.8 + 0.1, rot: rng.range(-0.3, 0.3), variant: variant(), group: -1 });
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
      out.push({ x, y, z, size, shade, rot: rng.range(-0.45, 0.45), variant: variant(), group: -1 });
    }
  }

  // --- montes de cúmulo GRANDES sobre o mar (refs 2 e 4): base plana, muitos puffs sobrepostos
  for (let c = 0; c < CLOUDS.BIG_COUNT; c++) {
    let cx = 0, cz = 0;
    for (let tries = 0; tries < 60; tries++) {
      cx = rng.range(-half, half); cz = rng.range(-half, half);
      if (!nearIsland(cx, cz) && Math.hypot(cx, cz) > 2600) break;
    }
    const base = rng.range(CLOUDS.BIG_BASE_MIN, CLOUDS.BIG_BASE_MAX);
    const width = rng.range(CLOUDS.BIG_WIDTH.min, CLOUDS.BIG_WIDTH.max);
    const height = rng.range(CLOUDS.BIG_HEIGHT.min, CLOUDS.BIG_HEIGHT.max);
    const count = Math.max(10, Math.round(rng.int(CLOUDS.BIG_PUFFS_MIN, CLOUDS.BIG_PUFFS_MAX) * scale));
    const dirA = rng.range(0, Math.PI * 2);
    const aspect = rng.range(0.5, 1.0);
    const ca = Math.cos(dirA), sa = Math.sin(dirA);
    const nLobes = 2 + Math.floor(rng() * 3);
    const lobes = [];
    clusters.push({ x: cx, y: base, z: cz, width, height, big: true });
    for (let l = 0; l < nLobes; l++) {
      lobes.push({
        x: rng.range(-0.5, 0.5) * width * 0.55, z: rng.range(-0.5, 0.5) * width * 0.55 * aspect,
        r: width * rng.range(0.22, 0.42), h: height * rng.range(0.55, 1.0),
      });
    }
    // uma torre mais alta num dos lóbulos (monte "em couve-flor")
    lobes[0].h = height;
    for (let i = 0; i < count; i++) {
      const lobe = lobes[Math.floor(rng() * nLobes)];
      const ang = rng.range(0, Math.PI * 2), rad = Math.pow(rng(), 0.6) * lobe.r;
      const edgeT = rad / lobe.r;
      const lx = lobe.x + Math.cos(ang) * rad, lz = lobe.z + Math.sin(ang) * rad * aspect;
      const x = cx + lx * ca - lz * sa, z = cz + lx * sa + lz * ca;
      const hmax = lobe.h * (1 - edgeT * edgeT * 0.8);
      const yrel = hmax * Math.pow(rng(), 0.7);
      const size = Math.min(720, (260 + 420 * rng.range(0.4, 1.0)) * (0.75 + 0.5 * (1 - edgeT)) * (1 - 0.25 * yrel / height));
      const y = base + size * 0.35 + yrel;
      const shade = clamp01((y - base) / Math.max(1, height));
      out.push({ x, y, z, size, shade, rot: rng.range(-0.4, 0.4), variant: variant(), group: -1 });
    }
  }

  // --- bancos de nuvem ao redor das patas (deslocamentos LOCAIS ao elefante): anel denso de
  //     puffs sobrepostos subindo até ~o joelho, mais denso junto à água (espuma por baixo),
  //     com alguns montes mais altos (refs 1–3)
  const nFoot = Math.round(FOOT_PUFFS * scale);
  const R = ELEPHANT.FOOT_CLOUD_RADIUS;
  const bankTop = LEG_HEIGHT * CLOUDS.FOOT_TOP_FRACTION;    // ~780 m
  const heapTop = LEG_HEIGHT * CLOUDS.FOOT_HEAP_FRACTION;   // ~1200 m
  for (let e = 0; e < NUM_ANCHORS; e++) {
    const nBig = Math.round(14 * scale); // base sólida: puffs grandes em anel regular, nivelados no mar
    for (let i = 0; i < nBig; i++) {
      const ang = (i / nBig) * Math.PI * 2 + rng.range(-0.15, 0.15);
      const rad = R * rng.range(0.78, 1.08);
      const size = rng.range(850, 1050);
      out.push({ x: Math.cos(ang) * rad, y: size * 0.38, z: Math.sin(ang) * rad, size, shade: 0.45, rot: rng.range(-0.3, 0.3), variant: variant(), group: e });
    }
    for (let i = 0; i < nFoot; i++) {
      const ang = rng.range(0, Math.PI * 2);
      // mar de nuvens: denso perto das patas (0,6–1,2 R), estendendo-se até ~1,7 R e baixando para fora
      // (concentrado: puffs vizinhos sempre se sobrepõem — massa contínua, sem bolas soltas)
      const rad = Math.min(1.7 * R, Math.max(0.3 * R, R * (0.92 + rng.gauss() * 0.30)));
      const outer = clamp01((rad / R - 1.15) / 0.55);            // 0 dentro do anel, 1 na borda externa
      const yt = Math.pow(rng(), 2.0) * (1 - 0.6 * outer);       // a maioria fica baixa, junto à água
      const size = (380 + 420 * rng()) * (1 - 0.15 * yt);        // puffs grandes e sobrepostos (massa contínua)
      const y = Math.max(size * 0.36, yt * bankTop);
      const shade = 0.30 + 0.70 * clamp01(y / bankTop);
      out.push({ x: Math.cos(ang) * rad, y, z: Math.sin(ang) * rad, size, shade, rot: rng.range(-0.4, 0.4), variant: variant(), group: e });
    }
    const nHeaps = Math.round(CLOUDS.FOOT_HEAPS * scale);
    for (let hI = 0; hI < nHeaps; hI++) {
      const hAng = rng.range(0, Math.PI * 2), hRad = R * rng.range(0.6, 1.1);
      const hx = Math.cos(hAng) * hRad, hz = Math.sin(hAng) * hRad;
      const top = heapTop * rng.range(0.8, 1.15), hr = rng.range(550, 800);
      for (let i = 0; i < CLOUDS.FOOT_HEAP_PUFFS; i++) {
        // torre em couve-flor: base larga, estreitando para o topo; os puffs se
        // sobrepõem (tamanho ≥ ~espaçamento) — nunca bolas soltas no ar
        const yT = Math.pow(rng(), 0.85);
        const ang = rng.range(0, Math.PI * 2), rr = Math.sqrt(rng()) * hr * (1 - 0.7 * yT);
        const yrel = top * yT;
        const size = (380 + 300 * rng()) * (1 - 0.25 * yT);
        const y = Math.max(size * 0.4, yrel);
        const shade = 0.35 + 0.65 * clamp01(y / top);
        out.push({ x: hx + Math.cos(ang) * rr, y, z: hz + Math.sin(ang) * rr, size, shade, rot: rng.range(-0.4, 0.4), variant: variant(), group: e });
      }
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
    anchors.push(r ? { position: r.poseAt(r.u0).position.clone(), heading: r.poseAt(r.u0).heading || 0 } : { position: new THREE.Vector3(1e7, 0, 1e7), heading: 0 });
  }
  const anchorVals = anchors.map((a) => a.position.clone());
  const headingVals = new Float32Array(NUM_ANCHORS);

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

  // Intensidades em espaço LINEAR antes do ACES (exposição 0,9): topos ao sol ≈ 2,5
  // viram branco quase puro; bases ≈ 0,5 viram azul-cinza.
  const puffUniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uMap: { value: null },
      uSunColor: { value: new THREE.Color(COLORS.sunLight).multiplyScalar(1.85) },
      uAmbTop: { value: new THREE.Color(COLORS.cloudLit).multiplyScalar(0.78) },
      uShade: { value: new THREE.Color(COLORS.cloudShade).multiplyScalar(1.0) },
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
  const ring = new THREE.RingGeometry(R * 0.03, R * 2.75, 96, 14);
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
      uFoam: { value: new THREE.Color(COLORS.foam).multiplyScalar(1.6) },
      uRipple: { value: new THREE.Color(COLORS.foam).multiplyScalar(1.1) },
      uAnchors: { value: anchorVals },
      uHeadings: { value: headingVals },
      uTime: { value: 0 },
      uFoamRadius: { value: R },
    },
  ]);
  foamUniforms.uAnchors.value = anchorVals;
  foamUniforms.uHeadings.value = headingVals;
  foamUniforms.uNoise.value = makeFoamTexture(256);
  const foamMat = new THREE.ShaderMaterial({
    uniforms: foamUniforms, vertexShader: FOAM_VERT, fragmentShader: FOAM_FRAG,
    defines: { NUM_ANCHORS, FOOT_X: FOOT_X.toFixed(1), FOOT_Z: FOOT_Z.toFixed(1), LEG_R: LEG_R.toFixed(1), RIPPLE_PERIOD: RIPPLE_PERIOD.toFixed(1), RIPPLE_RINGS },
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
        if (a && typeof a.heading === 'number') headingVals[i] = a.heading;
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
