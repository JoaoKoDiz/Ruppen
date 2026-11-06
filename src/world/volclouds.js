// =====================================================================
//  Nuvens VOLUMÉTRICAS (quality high/ultra): densidade marchada por raio
//  dentro de volumes-proxy (caixas instanciadas) desenhados na própria cena.
//
//  * Forma de cada nuvem = união suave ("metaballs") de até 16 lóbulos
//    elipsoidais (semente), guardados numa DataTexture float (1 linha por nuvem):
//    xyz = centro local, w = raio inteiro + achatamento vertical na fração.
//  * Erosão por ruído 3D tileável gerado no carregamento: Data3DTexture 64³
//    "perlin-worley" (R) + worley mais fino (G), e 32³ de detalhe (R = worley
//    em bolhas → couve-flor nos topos, G = perlin → fiapos nas bases).
//  * Gradiente de altura: base plana (cúmulo), topos em couve-flor.
//  * Luz: Beer–Lambert + espalhamento múltiplo aproximado (3 oitavas de
//    Wrenninge) + "powder" + marcha de 3–5 passos em direção ao sol +
//    Henyey–Greenstein duplo (g≈0,6 + retroespalhamento) + ambiente do céu
//    (azul-cinza embaixo, branco em cima) + sombra analítica do corpo do
//    elefante sobre o banco das patas.
//  * Passo adaptativo (cresce com a distância), salto do espaço vazio pela
//    distância conservadora aos lóbulos, início do raio deslocado por ruído de
//    gradiente intercalado (estável no tempo: depende só do pixel), saída
//    antecipada com opacidade > 0,98.
//  * Bancos das patas: seguem os elefantes (posição + rumo), têm densidade
//    reduzida num cilindro em torno de cada pata e o raio PARA ao atingir o
//    cilindro (inclinado pelo osso da pata) → as pernas ficam à frente da nuvem
//    que está atrás delas sem precisar da profundidade da cena. Mergulham no mar
//    (o raio pára em y = 0).
//  * Ordenação de trás para frente por quadro, corte por frustum e > CULL_DIST,
//    desvanecimento com a distância, névoa aplicada na profundidade média do
//    espalhamento. Saída em alfa PRÉ-MULTIPLICADO, depthWrite = false.
//  * Câmera FORA da caixa → FrontSide (o teste de profundidade da face da frente
//    esconde a nuvem atrás de objetos opacos); DENTRO → BackSide (2º draw call).
//  * Opcional: setSceneDepth(tex) — profundidade da cena (log depth ou
//    reversed-Z) para parar o raio em geometria opaca DENTRO do volume. Só pode
//    ser usada se as nuvens forem desenhadas num passe que NÃO escreve nessa
//    textura (senão é um laço de realimentação no WebGL).
// =====================================================================
import * as THREE from 'three';
import { WORLD, COLORS, SEED, CLOUDS, ELEPHANT, ELEPHANT_MODEL } from '../config.js';
import { createRng } from '../util/rng.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const V = CLOUDS.VOL;
const MAX_LOBES = 16;
const S = ELEPHANT.SCALE || 1;
const LEG_PIVOT_X = ELEPHANT.LEG.offsetX * S, LEG_PIVOT_Z = ELEPHANT.LEG.offsetZ * S;
const LEG_PIVOT_Y = ELEPHANT.LEG.topY * S;
const LEG_RADIUS = ((ELEPHANT_MODEL && ELEPHANT_MODEL.LEG_HIP_RADIUS) || ELEPHANT.LEG.radius * 1.5) * S; // raio real da pata (quadril)
const BODY = { cy: ELEPHANT.BODY.cy * S, rx: ELEPHANT.BODY.rx * S, ry: ELEPHANT.BODY.ry * S, rz: ELEPHANT.BODY.rz * S };
const LEG_NAMES = ['legFL', 'legFR', 'legBL', 'legBR']; // (+X,−Z) (+X,+Z) (−X,−Z) (−X,+Z) — ver elephant.js
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// ---------------------------------------------------------------------
//  Ruído 3D tileável (gerado uma vez no carregamento)
// ---------------------------------------------------------------------
function makePerlin(rng) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const G = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;
  // ruído de gradiente periódico (período P em células)
  return function perlin(x, y, z, P) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = fade(xf), v = fade(yf), w = fade(zf);
    const h = (i, j, k) => perm[perm[perm[((i % P) + P) % P] + ((j % P) + P) % P] + ((k % P) + P) % P] % 12;
    const g = (i, j, k, dx, dy, dz) => { const gg = G[h(i, j, k)]; return gg[0] * dx + gg[1] * dy + gg[2] * dz; };
    const x0 = lerp(g(xi, yi, zi, xf, yf, zf), g(xi + 1, yi, zi, xf - 1, yf, zf), u);
    const x1 = lerp(g(xi, yi + 1, zi, xf, yf - 1, zf), g(xi + 1, yi + 1, zi, xf - 1, yf - 1, zf), u);
    const x2 = lerp(g(xi, yi, zi + 1, xf, yf, zf - 1), g(xi + 1, yi, zi + 1, xf - 1, yf, zf - 1), u);
    const x3 = lerp(g(xi, yi + 1, zi + 1, xf, yf - 1, zf - 1), g(xi + 1, yi + 1, zi + 1, xf - 1, yf - 1, zf - 1), u);
    return lerp(lerp(x0, x1, v), lerp(x2, x3, v), w);
  };
}

// worley "em bolhas" (1 − F1, periódico) numa grade N³ de amostras, C células por lado
function worleyGrid(N, C, rng) {
  const pts = new Float32Array(C * C * C * 3);
  for (let i = 0; i < pts.length; i++) pts[i] = rng();
  const out = new Float32Array(N * N * N);
  const inv = C / N;
  for (let z = 0; z < N; z++) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const px = (x + 0.5) * inv, py = (y + 0.5) * inv, pz = (z + 0.5) * inv;
        const cx = Math.floor(px), cy = Math.floor(py), cz = Math.floor(pz);
        let f1 = 9;
        for (let oz = -1; oz <= 1; oz++) {
          const kz = cz + oz, wz = ((kz % C) + C) % C;
          for (let oy = -1; oy <= 1; oy++) {
            const ky = cy + oy, wy = ((ky % C) + C) % C;
            for (let ox = -1; ox <= 1; ox++) {
              const kx = cx + ox, wx = ((kx % C) + C) % C;
              const o = ((wz * C + wy) * C + wx) * 3;
              const dx = kx + pts[o] - px, dy = ky + pts[o + 1] - py, dz = kz + pts[o + 2] - pz;
              const d = dx * dx + dy * dy + dz * dz;
              if (d < f1) f1 = d;
            }
          }
        }
        out[(z * N + y) * N + x] = 1 - Math.min(1, Math.sqrt(f1) / 0.9);
      }
    }
  }
  return out;
}

function perlinGrid(N, P0, octaves, perlin) {
  const out = new Float32Array(N * N * N);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let s = 0, a = 1, n = 0, P = P0;
    for (let o = 0; o < octaves; o++) {
      const k = P / N;
      s += a * perlin((x + 0.5) * k, (y + 0.5) * k, (z + 0.5) * k, P);
      n += a; a *= 0.5; P *= 2;
    }
    out[(z * N + y) * N + x] = clamp01(0.5 + 0.75 * s / n);
  }
  return out;
}

// estica um canal para o intervalo [0,1] pelos percentis 1%–99% (contraste total na erosão)
function normalize(arr) {
  const sorted = Float32Array.from(arr).sort();
  const lo = sorted[Math.floor(sorted.length * 0.01)], hi = sorted[Math.floor(sorted.length * 0.99)];
  const k = 1 / Math.max(1e-4, hi - lo);
  for (let i = 0; i < arr.length; i++) arr[i] = clamp01((arr[i] - lo) * k);
  return arr;
}

function make3D(data, N) {
  const tex = new THREE.Data3DTexture(data, N, N, N);
  tex.format = THREE.RGFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.generateMipmaps = false;
  tex.unpackAlignment = 1;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function makeNoiseTextures() {
  const rng = createRng(SEED + 7701);
  const perlin = makePerlin(rng);
  // --- base 64³: R = perlin-worley (bolhas grandes moduladas por perlin), G = worley fbm mais fino
  const N = 64;
  const w4 = worleyGrid(N, 4, rng), w8 = worleyGrid(N, 8, rng), w16 = worleyGrid(N, 16, rng);
  const pl = perlinGrid(N, 4, 4, perlin);
  const R = new Float32Array(N * N * N), Gc = new Float32Array(N * N * N);
  for (let i = 0; i < N * N * N; i++) {
    const wf = w4[i] * 0.625 + w8[i] * 0.25 + w16[i] * 0.125;
    // perlin-worley: massas contínuas (perlin) com contorno em bolhas (worley)
    R[i] = wf * 0.7 + pl[i] * 0.45 - 0.15 + 0.35 * wf * pl[i];
    Gc[i] = w8[i] * 0.625 + w16[i] * 0.375;
  }
  normalize(R); normalize(Gc);
  const base = new Uint8Array(N * N * N * 2);
  for (let i = 0; i < N * N * N; i++) { base[i * 2] = Math.round(255 * R[i]); base[i * 2 + 1] = Math.round(255 * Gc[i]); }
  // --- detalhe 32³: R = worley fbm (bolhas), G = perlin fbm (fiapos)
  const M = 32;
  const d4 = worleyGrid(M, 4, rng), d8 = worleyGrid(M, 8, rng), d16 = worleyGrid(M, 16, rng);
  const dp = normalize(perlinGrid(M, 4, 3, perlin));
  const dw = new Float32Array(M * M * M);
  for (let i = 0; i < M * M * M; i++) dw[i] = d4[i] * 0.625 + d8[i] * 0.25 + d16[i] * 0.125;
  normalize(dw);
  const det = new Uint8Array(M * M * M * 2);
  for (let i = 0; i < M * M * M; i++) { det[i * 2] = Math.round(255 * dw[i]); det[i * 2 + 1] = Math.round(255 * dp[i]); }
  return { base: make3D(base, N), detail: make3D(det, M) };
}

// ---------------------------------------------------------------------
//  Shaders
// ---------------------------------------------------------------------
const VOL_VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
#include <fog_pars_vertex>
attribute vec4 aPose;   // x, z (mundo) da origem local (nível do mar), rumo (rad), linha na textura de lóbulos
attribute vec4 aBMin;   // caixa local mín. (xyz) + nº de lóbulos
attribute vec4 aBMax;   // caixa local máx. (xyz) + desvanecimento (0..1)
attribute vec4 aShape;  // y da base, y do topo, multiplicador de densidade, tipo (0 mar, 1 banco das patas)
attribute vec4 aLegs;   // inclinação (rotation.z) das 4 patas
uniform vec3 uSunDir;
varying vec3 vLocal;
flat varying vec3 vRo;
flat varying vec3 vSunL;
flat varying vec4 vPose;
flat varying vec4 vBMin;
flat varying vec4 vBMax;
flat varying vec4 vShape;
flat varying vec4 vLegs;
void main() {
  vec3 local = mix(aBMin.xyz, aBMax.xyz, position + 0.5);
  float c = cos(aPose.z), s = sin(aPose.z);
  // mundo = R_y(rumo) · local + origem
  vec3 world = vec3(aPose.x + local.x * c + local.z * s, local.y, aPose.y - local.x * s + local.z * c);
  vec3 rc = cameraPosition - vec3(aPose.x, 0.0, aPose.y);
  vRo = vec3(rc.x * c - rc.z * s, rc.y, rc.x * s + rc.z * c);           // R_y(−rumo)
  vSunL = vec3(uSunDir.x * c - uSunDir.z * s, uSunDir.y, uSunDir.x * s + uSunDir.z * c);
  vLocal = local;
  vPose = aPose; vBMin = aBMin; vBMax = aBMax; vShape = aShape; vLegs = aLegs;
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}`;

const VOL_FRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
#include <fog_pars_fragment>
precision highp sampler3D;
uniform sampler2D uLobes;
uniform sampler3D uNoiseBase;
uniform sampler3D uNoiseDetail;
uniform float uTime;
uniform vec3 uSunColor;
uniform vec3 uAmbTop;
uniform vec3 uAmbBottom;
uniform float uDensity;
uniform vec3 uChurn;
#ifdef USE_SCENE_DEPTH
uniform sampler2D uSceneDepth;
uniform vec2 uResolution;
uniform float uCamNear;
uniform float uCamFar;
#endif
#ifdef CLOUD_PASS
uniform float uExposure;
// mesmo ACES do three.js (o passe desenha num render target comum: sem tone mapping automático)
vec3 cloudACES(vec3 color) {
  const mat3 ACESInputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 ACESOutputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color *= uExposure / 0.6;
  color = ACESInputMat * color;
  vec3 a = color * (color + 0.0245786) - 0.000090537;
  vec3 b = color * (0.983729 * color + 0.4329510) + 0.238081;
  color = ACESOutputMat * (a / b);
  return clamp(color, 0.0, 1.0);
}
#endif
varying vec3 vLocal;
flat varying vec3 vRo;
flat varying vec3 vSunL;
flat varying vec4 vPose;
flat varying vec4 vBMin;
flat varying vec4 vBMax;
flat varying vec4 vShape;
flat varying vec4 vLegs;

vec4 L[MAX_LOBES];
int nL;
float gBase, gInvH, gDens;
bool gFoot;
vec3 gNoiseOff;
vec3 gLegP[4];
vec3 gLegD[4];

// forma: soma de metaballs dos lóbulos; sdf = distância conservadora ao lóbulo mais próximo
float shapeAt(vec3 p, out float sdf) {
  float b = 0.0;
  sdf = 1e9;
  for (int i = 0; i < MAX_LOBES; i++) {
    if (i >= nL) break;
    vec4 l = L[i];
    float r = floor(l.w);
    float sq = fract(l.w);
    vec3 d = p - l.xyz;
    d.y /= sq;
    float d2 = dot(d, d);
    sdf = min(sdf, (sqrt(d2) - r) * sq);
    float x = 1.0 - d2 / (r * r);
    if (x > 0.0) b += x * x;
  }
  return b;
}

// densidade normalizada (0..1); full = inclui o ruído de detalhe
float densityAt(vec3 p, float b, bool full) {
  float h = (p.y - gBase) * gInvH;                  // 0 base .. 1 topo
  float s = clamp(b * (gFoot ? FOOT_COVER : 1.15), 0.0, 1.0);
  s *= smoothstep(0.0, 0.12, h);                    // base plana (um pouco esfiapada)
  s *= 1.0 - smoothstep(0.92, 1.0, h);
  if (gFoot) {
    // as pernas "abrem" o banco: menos nuvem dentro de um cilindro em volta de cada pata
    for (int k = 0; k < 4; k++) {
      vec3 q = p - gLegP[k];
      vec3 r = q - gLegD[k] * dot(q, gLegD[k]);
      s *= mix(0.12, 1.0, smoothstep(LEG_R * LEG_CLEAR0, LEG_R * LEG_CLEAR1, length(r)));
    }
  }
  if (s <= 0.0) return 0.0;
  vec3 q = p * (1.0 / BASE_SCALE) + gNoiseOff;
  vec2 nb = texture(uNoiseBase, q).rg;
  float n = nb.r * 0.55 + nb.g * 0.45;
  float er = (1.0 - n) * EROSION;
  float d = clamp((s - er) / max(1.0 - er, 1e-3), 0.0, 1.0);
  if (full && d > 0.0) {
    vec2 nd = texture(uNoiseDetail, p * (1.0 / DETAIL_SCALE) + gNoiseOff * 3.1).rg;
    // couve-flor (bolhas) em cima, fiapos (perlin) embaixo
    float det = mix(nd.g, nd.r, clamp(h * 2.5 + 0.15, 0.0, 1.0));
    float de = (1.0 - det) * DETAIL_EROSION;
    d = clamp((d - de) / max(1.0 - de, 1e-3), 0.0, 1.0);
  }
  // cúmulo: densidade quase uniforme por dentro, borda nítida (couve-flor recortada)
  return smoothstep(0.0, EDGE_SHARP, d);
}

float hg(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5);   // ×4π: isotrópico = 1
}
float phase2(float c, float k) {
  return mix(hg(c, PHASE_G * k), hg(c, PHASE_BACK * k), PHASE_BACK_W);
}

// interseção raio–cilindro infinito (eixo P + D·s, D unitário); devolve o 1º t > 0 ou 1e9
float hitCylinder(vec3 ro, vec3 rd, vec3 P, vec3 D, float R) {
  vec3 q = ro - P;
  vec3 a = rd - D * dot(rd, D);
  vec3 b = q - D * dot(q, D);
  float A = dot(a, a), B = dot(a, b), C = dot(b, b) - R * R;
  float disc = B * B - A * C;
  if (disc < 0.0 || A < 1e-8) return 1e9;
  float sq = sqrt(disc);
  float t0 = (-B - sq) / A;
  if (t0 > 0.0) {
    float ax = dot(q + rd * t0, D);
    return ax > 0.0 ? t0 : 1e9;                     // só abaixo do quadril
  }
  return 1e9;
}

// sombra analítica do corpo (elipsoide) do elefante sobre o banco
float bodyShadow(vec3 p) {
  vec3 o = (p - vec3(0.0, BODY_CY, 0.0)) / vec3(BODY_RX, BODY_RY, BODY_RZ);
  vec3 d = vSunL / vec3(BODY_RX, BODY_RY, BODY_RZ);
  float A = dot(d, d), B = dot(o, d), C = dot(o, o) - 1.0;
  float disc = B * B - A * C;
  if (disc <= 0.0) return 1.0;
  float t = (-B + sqrt(disc)) / A;
  if (t <= 0.0) return 1.0;
  // penumbra: quão "central" é o raio na elipsoide
  float pen = smoothstep(0.0, 0.25, disc / (A * max(dot(o, o), 1.0)));
  return mix(1.0, BODY_SHADOW, pen);
}

void main() {
  #include <logdepthbuf_fragment>
  nL = int(vBMin.w + 0.5);
  int row = int(vPose.w + 0.5);
  for (int i = 0; i < MAX_LOBES; i++) {
    if (i >= nL) break;
    L[i] = texelFetch(uLobes, ivec2(i, row), 0);
  }
  gBase = vShape.x;
  gInvH = 1.0 / max(vShape.y - vShape.x, 1.0);
  gDens = uDensity * vShape.z;
  gFoot = vShape.w > 0.5;
  gNoiseOff = vec3(float(row) * 0.1373, float(row) * 0.2917, float(row) * 0.0711) + uChurn * uTime;

  vec3 ro = vRo;
  vec3 rd = normalize(vLocal - vRo);
  // ---- interseção com a caixa
  vec3 inv = 1.0 / rd;
  vec3 ta = (vBMin.xyz - ro) * inv, tb = (vBMax.xyz - ro) * inv;
  vec3 tmn = min(ta, tb), tmx = max(ta, tb);
  float tEnter = max(max(max(tmn.x, tmn.y), tmn.z), 0.0);
  float tExit = min(min(tmx.x, tmx.y), tmx.z);
  // o mar é opaco: o raio pára em y = 0
  if (rd.y < 0.0) tExit = min(tExit, -ro.y / rd.y);
  // rd no mundo (para a profundidade de vista)
  float cy = cos(vPose.z), sy = sin(vPose.z);
  vec3 rdW = vec3(rd.x * cy + rd.z * sy, rd.y, -rd.x * sy + rd.z * cy);
  vec3 camFwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  float viewK = max(dot(rdW, camFwd), 1e-3);
  if (gFoot) {
    // pernas: cilindros inclinados pelo osso (densidade menor em volta); sem a profundidade da
    // cena, o raio pára na superfície da pata (as pernas ficam à frente da nuvem de trás)
    for (int k = 0; k < 4; k++) {
      float sx = (k < 2) ? 1.0 : -1.0;
      float sz = (k == 0 || k == 2) ? -1.0 : 1.0;
      float a = vLegs[k];
      gLegP[k] = vec3(sx * LEG_PX, LEG_PY, sz * LEG_PZ);
      gLegD[k] = vec3(sin(a), -cos(a), 0.0);
      #ifndef USE_SCENE_DEPTH
      tExit = min(tExit, hitCylinder(ro, rd, gLegP[k], gLegD[k], LEG_R * 0.93));
      #endif
    }
  }
  #ifdef USE_SCENE_DEPTH
  {
    float dz = texture2D(uSceneDepth, gl_FragCoord.xy / uResolution).r;
    float vz = 1e9;
    if (dz < 0.99995) {
    #if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
      vz = exp2(dz * 2.0 / logDepthBufFC) - 1.0;
    #elif defined( USE_REVERSED_DEPTH_BUFFER )
      vz = uCamNear * uCamFar / (dz * (uCamFar - uCamNear) + uCamNear);
    #else
      vz = uCamNear * uCamFar / (uCamFar - dz * (uCamFar - uCamNear));
    #endif
    }
    tExit = min(tExit, vz / viewK);
  }
  #endif
  if (tExit <= tEnter) discard;

  // ---- fase (constante por pixel)
  float cosT = dot(rd, vSunL);
  float ph0 = phase2(cosT, 1.0), ph1 = phase2(cosT, 0.5), ph2 = phase2(cosT, 0.25);
  float powderW = POWDER * (0.65 - 0.35 * cosT);    // vincos escuros quando o sol está atrás da câmera
  int lSteps = tEnter > 14000.0 ? 3 : LIGHT_STEPS;

  // ---- marcha
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float t = tEnter + jitter * clamp(tEnter * STEP_K, STEP_MIN, STEP_MAX);
  float T = 1.0;
  vec3 col = vec3(0.0);
  float tW = 0.0, wSum = 0.0;
  float lastSun = 1.0;
  float run = 0.0, lastStep = 0.0;   // passos vazios seguidos (dentro dos lóbulos mas sem densidade): o passo cresce
  for (int i = 0; i < MAX_STEPS; i++) {
    if (t >= tExit || T < 0.02) break;
    float dtF = clamp(t * STEP_K, STEP_MIN, STEP_MAX);
    // passos finos na entrada da nuvem (superfície nítida, pouco pontilhado); normais por dentro
    float dt = dtF * mix(0.3, 1.0, smoothstep(0.25, 0.75, 1.0 - T));
    vec3 p = ro + rd * t;
    float sdf;
    float b = shapeAt(p, sdf);
    if (sdf > dtF) { t += sdf + dtF * 0.3 * jitter; run = 0.0; lastStep = 0.0; continue; }    // vazio: salta até o lóbulo mais próximo
    float d = b > 0.0 ? densityAt(p, b, true) : 0.0;
    if (d <= 0.002) {
      run += 1.0;
      lastStep = dtF * (1.0 + min(run, 8.0) * 0.5);
      t += lastStep;
      continue;
    }
    // achou nuvem depois de passos longos: recua para pegar a superfície com o passo fino
    if (run > 1.5) { t -= lastStep * 0.6; run = 0.0; lastStep = 0.0; continue; }
    run = 0.0;
    {
      {
        float sigma = d * gDens * smoothstep(NEAR_FADE0, NEAR_FADE1, t);  // some perto da câmera (voando dentro da nuvem: interior limpo em volta)
        // luz em direção ao sol (pulada nas partes já muito escondidas: reaproveita a última)
        float sunE = lastSun;
        if (T > 0.22) {
          float tau = 0.0, ls = LIGHT_STEP0, acc = 0.0;
          for (int j = 0; j < LIGHT_STEPS; j++) {
            if (j >= lSteps) break;
            vec3 q = p + vSunL * (acc + ls * 0.5);
            float sd2;
            float b2 = shapeAt(q, sd2);
            if (b2 > 0.0) tau += densityAt(q, b2, j < 2) * ls;   // 2 primeiros passos com detalhe: os lóbulos se sombreiam
            acc += ls; ls *= 2.0;
          }
          tau *= gDens;
          sunE = exp(-tau) * ph0 + 0.5 * exp(-tau * 0.5) * ph1 + 0.22 * exp(-tau * 0.25) * ph2;
          if (gFoot) sunE *= bodyShadow(p);
          lastSun = sunE;
        }
        float h = clamp((p.y - gBase) * gInvH, 0.0, 1.0);
        float powder = mix(1.0, 1.0 - exp(-sigma * 260.0), powderW);
        // céu: sonda de oclusão para cima (vincos e bases mais escuros que os topos expostos)
        float occ = 1.0;
        if (T > 0.3) {
          vec3 qa = p + vec3(0.0, AMB_PROBE, 0.0);
          float sda;
          float ba = shapeAt(qa, sda);
          if (ba > 0.0) occ = exp(-densityAt(qa, ba, false) * gDens * AMB_PROBE * 0.6);
        }
        vec3 amb = mix(uAmbBottom, uAmbTop, pow(h, 0.65)) * mix(0.45, 1.0, occ) * mix(1.0, 0.7, clamp(b * 0.6, 0.0, 1.0));
        vec3 Lin = uSunColor * sunE * powder + amb;
        float a = 1.0 - exp(-sigma * dt);
        col += T * a * Lin;
        tW += T * a * t; wSum += T * a;
        T *= 1.0 - a;
      }
    }
    t += dt; lastStep = dt;
  }
  float alpha = clamp((1.0 - T) / 0.98, 0.0, 1.0) * vBMax.w;
  if (alpha < 0.004) discard;
  vec3 c = col / max(1.0 - T, 1e-4);                // cor não multiplicada
  gl_FragColor = vec4(c, alpha);
  #ifdef CLOUD_PASS
    gl_FragColor.rgb = sRGBTransferOETF(vec4(cloudACES(gl_FragColor.rgb), 1.0)).rgb;
  #else
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  #endif
  #ifdef USE_FOG
  {
    // névoa / perspectiva aérea na profundidade MÉDIA do espalhamento (mesma ordem do fog_fragment)
    float tF = wSum > 0.0 ? tW / wSum : tEnter;
    float fz = tF * viewK;
    #ifdef FOG_EXP2
      float ff = 1.0 - exp(-fogDensity * fogDensity * fz * fz);
    #else
      float ff = smoothstep(fogNear, fogFar, fz);
    #endif
    #ifdef RUPPEN_AERIAL
      gl_FragColor.rgb = ruppenApplyAerial(gl_FragColor.rgb, rdW * tF, cameraPosition.y, fogColor);
    #endif
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, ff);
  }
  #endif
  gl_FragColor.rgb *= gl_FragColor.a;               // alfa pré-multiplicado
}`;

// ---------------------------------------------------------------------
//  Geração determinística das nuvens (lóbulos em coordenadas locais)
// ---------------------------------------------------------------------
// lóbulo: { x, y, z, r, sq } — elipsoide de raio horizontal r e vertical r·sq
function packLobe(l) { return [l.x, l.y, l.z, Math.floor(l.r) + Math.min(0.995, Math.max(0.2, l.sq))]; }

function boundsOf(lobes, base, top) {
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const l of lobes) {
    mn[0] = Math.min(mn[0], l.x - l.r); mx[0] = Math.max(mx[0], l.x + l.r);
    mn[2] = Math.min(mn[2], l.z - l.r); mx[2] = Math.max(mx[2], l.z + l.r);
    mn[1] = Math.min(mn[1], l.y - l.r * l.sq); mx[1] = Math.max(mx[1], l.y + l.r * l.sq);
  }
  mn[1] = Math.max(mn[1], base - 5); mx[1] = Math.min(mx[1], top + 5);
  return { min: mn, max: mx };
}

function genSeaCloud(rng, big) {
  const W = big ? rng.range(V.BIG_WIDTH.min, V.BIG_WIDTH.max) : rng.range(V.SMALL_WIDTH.min, V.SMALL_WIDTH.max);
  const wf = big ? (W - V.BIG_WIDTH.min) / (V.BIG_WIDTH.max - V.BIG_WIDTH.min) : (W - V.SMALL_WIDTH.min) / (V.SMALL_WIDTH.max - V.SMALL_WIDTH.min);
  const H = big ? rng.range(V.BIG_HEIGHT.min, V.BIG_HEIGHT.max) * (0.8 + 0.3 * wf) : rng.range(V.SMALL_HEIGHT.min, V.SMALL_HEIGHT.max) * (0.75 + 0.4 * wf);
  const base = rng.range(V.BASE_MIN, V.BASE_MAX);
  const top = base + H;
  const lobes = [];
  const aspect = rng.range(0.45, 0.85);   // nuvem alongada num eixo
  // camada da base: lóbulos achatados ao longo do eixo maior
  const nBase = big ? rng.int(3, 5) : rng.int(1, 3);
  for (let i = 0; i < nBase; i++) {
    const u = nBase === 1 ? 0 : (i / (nBase - 1) - 0.5);
    const r = W * (big ? rng.range(0.2, 0.3) : rng.range(0.3, 0.42));
    const sq = rng.range(0.5, 0.7);
    lobes.push({ x: u * W * 0.62 + rng.range(-0.05, 0.05) * W, y: base + r * sq * 0.35, z: rng.range(-0.12, 0.12) * W * aspect, r, sq });
  }
  // torres: lóbulos mais redondos subindo do miolo
  const nTow = big ? rng.int(3, 6) : rng.int(1, 2);
  for (let i = 0; i < nTow; i++) {
    const r = W * (big ? rng.range(0.13, 0.22) : rng.range(0.2, 0.3));
    const sq = rng.range(0.75, 0.95);
    const yT = big ? rng.range(0.35, 0.72) : rng.range(0.4, 0.6);
    const y = Math.min(top - r * sq * 0.95, base + H * yT);
    lobes.push({ x: rng.range(-0.3, 0.3) * W, y, z: rng.range(-0.18, 0.18) * W * aspect, r, sq });
  }
  // couve-flor no topo
  const nTop = big ? rng.int(2, 4) : rng.int(0, 2);
  for (let i = 0; i < nTop; i++) {
    const r = W * (big ? rng.range(0.08, 0.13) : rng.range(0.12, 0.18));
    const sq = rng.range(0.85, 0.99);
    lobes.push({ x: rng.range(-0.22, 0.22) * W, y: top - r * sq * rng.range(1.0, 1.4), z: rng.range(-0.12, 0.12) * W * aspect, r, sq });
  }
  const ls = lobes.slice(0, MAX_LOBES);
  // o topo do gradiente de altura cobre todos os lóbulos (sem "tampa" plana cortando a couve-flor)
  const topAll = Math.max(top, ...ls.map((l) => l.y + l.r * l.sq));
  return { lobes: ls, base, top: topAll, dens: rng.range(0.85, 1.15), kind: 0 };
}

function genFootBank(rng) {
  const lobes = [];
  const R = V.FOOT_RING;
  const top = V.FOOT_TOP;
  // manta contínua (mar de nuvens) sob o elefante e em volta: elipsoide largo e baixo
  lobes.push({ x: rng.range(-150, 150), y: 0, z: rng.range(-150, 150), r: R * 1.22, sq: 0.22 });
  // 4 lóbulos nas patas (a nuvem "abraça" os pés)
  for (const [sx, sz] of [[1, -1], [1, 1], [-1, -1], [-1, 1]]) {
    const r = rng.range(950, 1150), sq = rng.range(0.62, 0.75);
    lobes.push({ x: sx * LEG_PIVOT_X * rng.range(1.05, 1.35), y: 150, z: sz * LEG_PIVOT_Z * rng.range(1.05, 1.35), r, sq });
  }
  // anel de 8 montes ao redor
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + rng.range(-0.25, 0.25);
    const rad = R * rng.range(0.85, 1.15);
    const r = rng.range(1000, 1350), sq = rng.range(0.6, 0.75);
    lobes.push({ x: Math.cos(a) * rad, y: 120, z: Math.sin(a) * rad, r, sq });
  }
  // 4 montes altos em couve-flor
  for (let k = 0; k < 4; k++) {
    const a = rng.range(0, Math.PI * 2);
    const rad = R * rng.range(0.6, 1.1);
    const r = rng.range(650, 900), sq = rng.range(0.85, 0.97);
    lobes.push({ x: Math.cos(a) * rad, y: Math.min(top - r * sq * 0.85, rng.range(850, 1150)), z: Math.sin(a) * rad, r, sq });
  }
  return { lobes, base: -140, top, dens: 1.1, kind: 1 };
}

// ---------------------------------------------------------------------
export function createVolumetricClouds(group, worldData, opts = {}) {
  const rng = createRng(SEED + 7702);
  const islands = worldData.islands || [];
  const nearIsland = (x, z, m) => islands.some((isl) => Math.hypot(x - isl.cx, z - isl.cz) < isl.boundRadius + m);
  const half = WORLD.HALF + 6000;
  const clouds = []; // { lobes, base, top, dens, kind, x, z, yaw, drift, anchor, bmin, bmax, row }

  const nAnchors = opts.anchorCount || ELEPHANT.COUNT;
  for (let e = 0; e < nAnchors; e++) {
    const c = genFootBank(rng);
    c.anchor = e; c.x = 0; c.z = 0; c.yaw = 0; c.drift = false;
    clouds.push(c);
  }
  const place = (c, margin) => {
    for (let tries = 0; tries < 80; tries++) {
      c.x = rng.range(-half, half); c.z = rng.range(-half, half);
      if (!nearIsland(c.x, c.z, margin) && Math.hypot(c.x, c.z) > 2600) break;
    }
    c.yaw = rng.range(0, Math.PI * 2);
    c.drift = true; c.anchor = -1;
  };
  for (let i = 0; i < V.BIG_COUNT; i++) { const c = genSeaCloud(rng, true); place(c, 1800); clouds.push(c); }
  for (let i = 0; i < V.SMALL_COUNT; i++) { const c = genSeaCloud(rng, false); place(c, 900); clouds.push(c); }

  // textura de lóbulos (1 linha por nuvem)
  const rows = clouds.length;
  const lobeData = new Float32Array(MAX_LOBES * rows * 4);
  clouds.forEach((c, row) => {
    c.row = row;
    c.lobes.forEach((l, i) => lobeData.set(packLobe(l), (row * MAX_LOBES + i) * 4));
    const bb = boundsOf(c.lobes, c.base, c.top);
    c.bmin = bb.min; c.bmax = bb.max;
    if (c.kind === 1) c.bmin[1] = -60; // o banco mergulha no mar
    const cx = (c.bmin[0] + c.bmax[0]) / 2, cyy = (c.bmin[1] + c.bmax[1]) / 2, cz = (c.bmin[2] + c.bmax[2]) / 2;
    c.lc = [cx, cyy, cz];
    c.radius = Math.hypot(c.bmax[0] - c.bmin[0], c.bmax[1] - c.bmin[1], c.bmax[2] - c.bmin[2]) / 2;
  });
  const lobeTex = new THREE.DataTexture(lobeData, MAX_LOBES, rows, THREE.RGBAFormat, THREE.FloatType);
  lobeTex.minFilter = lobeTex.magFilter = THREE.NearestFilter;
  lobeTex.generateMipmaps = false;
  lobeTex.needsUpdate = true;

  const noise = makeNoiseTextures();

  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uLobes: { value: null }, uNoiseBase: { value: null }, uNoiseDetail: { value: null },
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3() },
      uSunColor: { value: new THREE.Color(COLORS.sunLight).multiplyScalar(V.SUN) },
      uAmbTop: { value: new THREE.Color(COLORS.cloudLit).multiplyScalar(V.AMB_TOP) },
      uAmbBottom: { value: new THREE.Color(COLORS.cloudShade).multiplyScalar(V.AMB_BOTTOM) },
      uDensity: { value: V.DENSITY },
      uChurn: { value: new THREE.Vector3(0.3, -1.0, 0.2).multiplyScalar(V.CHURN / V.BASE_NOISE_SCALE) },
      uSceneDepth: { value: null }, uResolution: { value: new THREE.Vector2(1, 1) }, uCamNear: { value: 0.5 }, uCamFar: { value: 1e5 },
      uExposure: { value: 1 },
    },
  ]);
  uniforms.uLobes.value = lobeTex;
  uniforms.uNoiseBase.value = noise.base;
  uniforms.uNoiseDetail.value = noise.detail;
  if (opts.sunDirection) uniforms.uSunDir.value.copy(opts.sunDirection);

  const f = (v) => Number(v).toFixed(4);
  const defines = {
    MAX_LOBES, MAX_STEPS: V.MAX_STEPS, LIGHT_STEPS: V.LIGHT_STEPS,
    LIGHT_STEP0: f(V.LIGHT_STEP0), STEP_MIN: f(V.STEP_MIN), STEP_K: f(V.STEP_K), STEP_MAX: f(V.STEP_MAX),
    BASE_SCALE: f(V.BASE_NOISE_SCALE), DETAIL_SCALE: f(V.DETAIL_NOISE_SCALE), EROSION: f(V.EROSION), DETAIL_EROSION: f(V.DETAIL_EROSION),
    PHASE_G: f(V.PHASE_G), PHASE_BACK: f(V.PHASE_BACK), PHASE_BACK_W: f(V.PHASE_BACK_W), POWDER: f(V.POWDER),
    LEG_R: f(LEG_RADIUS), LEG_PX: f(LEG_PIVOT_X), LEG_PY: f(LEG_PIVOT_Y), LEG_PZ: f(LEG_PIVOT_Z),
    LEG_CLEAR0: f(V.LEG_CLEAR[0]), LEG_CLEAR1: f(V.LEG_CLEAR[1]),
    EDGE_SHARP: f(V.EDGE_SHARP), FOOT_COVER: f(V.FOOT_COVER), NEAR_FADE0: f(V.NEAR_FADE[0]), NEAR_FADE1: f(V.NEAR_FADE[1]), AMB_PROBE: f(V.AMB_PROBE), BODY_CY: f(BODY.cy), BODY_RX: f(BODY.rx), BODY_RY: f(BODY.ry), BODY_RZ: f(BODY.rz), BODY_SHADOW: f(V.BODY_SHADOW),
  };
  const makeMat = (side) => {
    const m = new THREE.ShaderMaterial({
      uniforms, vertexShader: VOL_VERT, fragmentShader: VOL_FRAG, defines: { ...defines },
      transparent: true, premultipliedAlpha: true, depthWrite: false, depthTest: true, side, fog: true,
      blending: THREE.NormalBlending,
    });
    m.uniforms = uniforms; // compartilhados entre os dois materiais
    return m;
  };
  const matFront = makeMat(THREE.FrontSide);
  const matBack = makeMat(THREE.BackSide);

  // geometria instanciada (caixa unitária) — uma para "câmera fora", outra para "câmera dentro"
  const box = new THREE.BoxGeometry(1, 1, 1);
  const N = clouds.length;
  const makeGeo = () => {
    const g = new THREE.InstancedBufferGeometry();
    g.index = box.index;
    g.setAttribute('position', box.getAttribute('position'));
    for (const name of ['aPose', 'aBMin', 'aBMax', 'aShape', 'aLegs']) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, a);
    }
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    return g;
  };
  const geoFront = makeGeo(), geoBack = makeGeo();
  const meshFront = new THREE.Mesh(geoFront, matFront);
  const meshBack = new THREE.Mesh(geoBack, matBack);
  for (const [m, ro, name] of [[meshFront, 20, 'volCloudsFront'], [meshBack, 21, 'volCloudsInside']]) {
    m.frustumCulled = false; m.renderOrder = ro; m.name = name; m.userData.noShadow = true;
    group.add(m);
  }

  // ------------------------------------------------------------------
  const frustum = new THREE.Frustum();
  const projView = new THREE.Matrix4();
  const sphere = new THREE.Sphere();
  const list = [];
  const wind = new THREE.Vector2(V.WIND.x, V.WIND.z);
  let legBones = []; // por âncora: [4 ossos] ou null
  const stats = { visible: 0, inside: 0, mode: 'scene' };
  let passMode = false;   // true: desenhadas por um passe do pós (post.addPass), com a profundidade da cena
  let cloudPass = null;

  function writeInstance(geo, k, c, fade, legs) {
    const A = geo.attributes;
    A.aPose.array.set([c.wx, c.wz, c.wyaw, c.row], k * 4);
    A.aBMin.array.set([c.bmin[0], c.bmin[1], c.bmin[2], c.lobes.length], k * 4);
    A.aBMax.array.set([c.bmax[0], c.bmax[1], c.bmax[2], fade], k * 4);
    A.aShape.array.set([c.base, c.top, c.dens, c.kind], k * 4);
    A.aLegs.array.set(legs, k * 4);
  }

  // ---------- passe do pós: nuvens depois da AO, oclusão exata pela profundidade da cena ----------
  class CloudPass extends Pass {
    constructor(sceneFog, scale) {
      super();
      this.needsSwap = false;
      this.scale = scale;
      this.scene = new THREE.Scene();
      this.scene.fog = sceneFog;
      this.scene.matrixWorldAutoUpdate = true;
      this.camera = null;
      if (scale < 1) {
        this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
        this.rt.texture.name = 'volclouds.lowres';
        this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
          uniforms: { tClouds: { value: this.rt.texture } },
          vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
          fragmentShader: 'uniform sampler2D tClouds; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tClouds, vUv); }',
          transparent: true, premultipliedAlpha: true, blending: THREE.NormalBlending, depthTest: false, depthWrite: false,
        }));
      }
    }
    setSize(w, h) {
      if (this.rt) this.rt.setSize(Math.max(1, Math.round(w * this.scale)), Math.max(1, Math.round(h * this.scale)));
      this.fullW = w; this.fullH = h;
    }
    render(renderer, writeBuffer, readBuffer) {
      if (!this.camera || !meshBack.visible) return;
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      if (this.rt) {
        uniforms.uResolution.value.set(this.rt.width, this.rt.height);
        renderer.setRenderTarget(this.rt);
        renderer.setClearColor(0x000000, 0); renderer.clear(true, false, false);
        renderer.render(this.scene, this.camera);
        renderer.setRenderTarget(readBuffer);
        this.quad.render(renderer);
      } else {
        uniforms.uResolution.value.set(readBuffer.width, readBuffer.height);
        renderer.setRenderTarget(readBuffer);
        renderer.render(this.scene, this.camera);
      }
      renderer.autoClear = auto;
    }
    dispose() { this.rt?.dispose(); this.quad?.dispose(); }
  }

  const api = {
    enabled: true,            // depuração/medição: false esconde as nuvens volumétricas
    meshes: [meshFront, meshBack],
    stats,
    clouds,
    setLegBones(bones) { legBones = bones || []; },
    // Liga o modo "passe": post = createPost(...) com addPass/depthTexture (src/world/post.js).
    attachPost(post, scene, o = {}) {
      if (passMode || !post || typeof post.addPass !== 'function' || !post.depthTexture) return false;
      cloudPass = new CloudPass(scene ? scene.fog : null, o.scale || V.PASS_SCALE || 1);
      if (post.addPass(cloudPass, 'beforeGrade') !== cloudPass) { cloudPass = null; return false; }
      const res = post.depthUniforms && post.depthUniforms.uResolution && post.depthUniforms.uResolution.value;
      if (res) cloudPass.setSize(res.x, res.y);
      passMode = true;
      stats.mode = 'pass';
      uniforms.uSceneDepth.value = post.depthTexture;
      matBack.defines.USE_SCENE_DEPTH = '';
      matBack.defines.CLOUD_PASS = '';
      matBack.depthTest = false;
      matBack.needsUpdate = true;
      meshFront.visible = false;
      group.remove(meshBack);
      cloudPass.scene.add(meshBack);
      return true;
    },
    setSceneDepth(texture, o = {}) {
      const use = !!texture;
      uniforms.uSceneDepth.value = texture || null;
      for (const m of [matFront, matBack]) {
        const had = 'USE_SCENE_DEPTH' in m.defines;
        if (use && !had) { m.defines.USE_SCENE_DEPTH = ''; m.needsUpdate = true; }
        if (!use && had) { delete m.defines.USE_SCENE_DEPTH; m.needsUpdate = true; }
      }
      if (o.width && o.height) uniforms.uResolution.value.set(o.width, o.height);
    },
    update(camera, time, anchors, headings, sunDir, renderer) {
      uniforms.uTime.value = time;
      if (cloudPass) { cloudPass.camera = camera; if (cloudPass.scene.fog !== undefined && opts.scene) cloudPass.scene.fog = opts.scene.fog; }
      if (renderer) uniforms.uExposure.value = renderer.toneMappingExposure;
      if (sunDir) uniforms.uSunDir.value.copy(sunDir);
      if (uniforms.uSceneDepth.value) {
        const img = uniforms.uSceneDepth.value.image;
        if (!passMode && img && img.width) uniforms.uResolution.value.set(img.width, img.height);
        uniforms.uCamNear.value = camera.near; uniforms.uCamFar.value = camera.far;
      }
      camera.updateMatrixWorld();
      projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projView);
      const cp = camera.position;
      list.length = 0;
      const wx = wind.x * time, wz = wind.y * time;
      for (const c of clouds) {
        if (c.anchor >= 0) {
          const a = anchors[c.anchor];
          c.wx = a.x; c.wz = a.z; c.wyaw = headings[c.anchor] || 0;
        } else {
          c.wx = ((c.x + wx + half) % (2 * half) + 2 * half) % (2 * half) - half;
          c.wz = ((c.z + wz + half) % (2 * half) + 2 * half) % (2 * half) - half;
          c.wyaw = c.yaw;
        }
        const co = Math.cos(c.wyaw), si = Math.sin(c.wyaw);
        const lx = c.lc[0], lz = c.lc[2];
        sphere.center.set(c.wx + lx * co + lz * si, c.lc[1], c.wz - lx * si + lz * co);
        sphere.radius = c.radius;
        const dist = sphere.center.distanceTo(cp);
        const near = Math.max(0, dist - c.radius);
        if (near > V.CULL_DIST) continue;
        if (!frustum.intersectsSphere(sphere)) continue;
        // câmera dentro da caixa (com folga do plano near)?
        const rx = cp.x - c.wx, rz = cp.z - c.wz;
        const qx = rx * co - rz * si, qz = rx * si + rz * co, qy = cp.y;
        const m = camera.near * 4 + 2;
        const inside = qx > c.bmin[0] - m && qx < c.bmax[0] + m && qy > c.bmin[1] - m && qy < c.bmax[1] + m && qz > c.bmin[2] - m && qz < c.bmax[2] + m;
        const fade = 1 - THREE.MathUtils.smoothstep(near, V.FADE_START, V.CULL_DIST);
        list.push({ c, dist, inside, fade });
      }
      list.sort((a, b) => b.dist - a.dist); // de trás para frente
      let nf = 0, nb = 0;
      const legs = [0, 0, 0, 0];
      for (const it of list) {
        const c = it.c;
        legs[0] = legs[1] = legs[2] = legs[3] = 0;
        if (c.anchor >= 0) {
          const bones = legBones[c.anchor];
          if (bones) for (let k = 0; k < 4; k++) legs[k] = bones[k] ? bones[k].rotation.z : 0;
        }
        if (it.inside || passMode) writeInstance(geoBack, nb++, c, it.fade, legs);
        else writeInstance(geoFront, nf++, c, it.fade, legs);
      }
      for (const [g, n] of [[geoFront, nf], [geoBack, nb]]) {
        g.instanceCount = n;
        for (const name of ['aPose', 'aBMin', 'aBMax', 'aShape', 'aLegs']) {
          const a = g.attributes[name];
          a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(1, n) * 4); a.needsUpdate = true;
        }
      }
      meshFront.visible = nf > 0 && !passMode && api.enabled; meshBack.visible = nb > 0 && api.enabled;
      stats.visible = nf + nb; stats.inside = nb;
    },
  };
  return api;
}

export { LEG_NAMES };
