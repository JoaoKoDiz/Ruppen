// =====================================================================
//  Oceano infinito: disco radial que segue a câmera (anéis ×1,0245 com 256
//  segmentos até ~4,6 km — células ≈ 2,5 % da distância — e anéis largos até
//  além do far plane), ShaderMaterial em coordenadas de MUNDO.
//   • PERTO: ondas de Gerstner reais (8 trens, 27–262 m, cristas até ~2,8 m,
//     agudeza Q·k·A = 0,085) deslocando os vértices; cada trem some quando a
//     malha fica grossa demais para ele e todo o deslocamento some de 2,4 a
//     4,2 km (o mar longe é o mesmo de antes). A normal de Gerstner é avaliada
//     por fragmento no ponto de PARÂMETRO (sem deslocamento horizontal), junto
//     com o jacobiano → carneirinhos (espuma) esparsos nas cristas comprimidas.
//     Câmera muito baixa: as ondas sob a lente são achatadas (nunca a cortam).
//   • mapa de NORMAIS tileável (512², soma de ondas com cristas afiadas + ruído)
//     em 4 oitavas com rolagem + 2 vagas analíticas longas; detalhe fino some
//     com a pegada do pixel (mar longe liso, rugosidade Toksvig no brilho);
//   • reflexo do céu pelo MESMO modelo analítico do céu (skyRadiance de sky.js)
//     + Fresnel de Schlick; cor de profundidade azul-marinho com verde-azulado
//     nas cristas contra o sol; brilho do sol GGX;
//   • ÁGUA RASA junto às ilhas (campo da costa de islands.js: fundo e distância
//     à linha d'água numa textura polar): transmissão de Beer-Lambert pela
//     profundidade (o fundo desenhado pelo terreno aparece através da água —
//     areia turquesa no raso, azul no fundo), halo turquesa da plataforma,
//     ondas e marola amortecidas no raso, linhas de arrebentação animadas e
//     quebradas que chegam à praia, espraiamento na linha d'água.
//     Mistura: o material é opaco na lista (renderOrder 2, depois do terreno),
//     com blending próprio (alfa = 1 no mar aberto).
//   • névoa FogExp2, depth logarítmico/reverso (chunks logdepthbuf), tone mapping, colorspace.
//  Contrato: createOcean(scene, {quality}) -> { object, update(camera, time) }
// =====================================================================
import * as THREE from 'three';
import { WORLD, COLORS, SEED, OCEAN, ISLANDS } from '../config.js';
import { sunDirection } from './lighting.js';
import { SKY_GLSL } from './sky.js';
import { WORLD_DATA } from './worldData.js';
import { getShoreField, makeTileNoise } from './islands.js';
import { createNoise } from '../util/noise.js';
import { createRng } from '../util/rng.js';

// Mapa de normais tileável (RGB = normal·0.5+0.5, A = ruído tileável para a
// variação de cor). Altura = soma de ondas com números de onda inteiros (tile
// perfeitamente periódico) com cristas afiadas (perfil tipo Gerstner) + fbm.
function makeNormalMap(size) {
  const rng = createRng(SEED + 7303);
  const noise = createNoise(SEED + 7304);
  const waves = [];
  const mainDir = rng.range(0, Math.PI * 2);
  for (let i = 0; i < 48; i++) {
    const kmag = 2 + Math.floor(Math.pow(rng(), 1.4) * 34); // 2..35 ciclos por tile
    const ang = i % 3 !== 2 ? mainDir + rng.gauss() * 0.7 : rng.range(0, Math.PI * 2);
    let nx = Math.round(Math.cos(ang) * kmag), nz = Math.round(Math.sin(ang) * kmag);
    if (nx === 0 && nz === 0) nx = 1;
    const k = Math.hypot(nx, nz);
    waves.push({ nx, nz, amp: Math.pow(k, -1.7) * rng.range(0.55, 1.0), phase: rng.range(0, Math.PI * 2), sharp: rng.range(1.2, 2.6) });
  }
  const H = new Float32Array(size * size);
  const fN = 5.0 / size;
  const nN = (x, y) => noise.fbm2(x * fN + 40, y * fN - 40, 5, 2.1, 0.52);
  const tileNoise = (x, y) => {
    const wx = ((x % size) + size) % size / size, wy = ((y % size) + size) % size / size;
    return nN(x, y) * (1 - wx) * (1 - wy) + nN(x - size, y) * wx * (1 - wy) + nN(x - size, y - size) * wx * wy + nN(x, y - size) * (1 - wx) * wy;
  };
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      let h = 0;
      for (const w of waves) {
        const ph = Math.PI * 2 * (w.nx * u + w.nz * v) + w.phase;
        h += w.amp * (2 * Math.pow(0.5 + 0.5 * Math.sin(ph), w.sharp) - 1);
      }
      H[y * size + x] = h + tileNoise(x, y) * 0.035;
    }
  }
  let maxG = 1e-6;
  const G = new Float32Array(size * size * 2);
  for (let y = 0; y < size; y++) {
    const ym = (y - 1 + size) % size, yp = (y + 1) % size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size, xp = (x + 1) % size;
      const gx = (H[y * size + xp] - H[y * size + xm]) * 0.5;
      const gz = (H[yp * size + x] - H[ym * size + x]) * 0.5;
      G[(y * size + x) * 2] = gx; G[(y * size + x) * 2 + 1] = gz;
      maxG = Math.max(maxG, Math.abs(gx), Math.abs(gz));
    }
  }
  const data = new Uint8Array(size * size * 4);
  const f2 = 2.0 / size;
  const nz2 = (x, y) => noise.fbm2(x * f2 + 7, y * f2 + 3, 4, 2, 0.5);
  const slope = 0.70 / maxG; // tan(35°)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x, o = i * 4;
      const sx = G[i * 2] * slope, sz = G[i * 2 + 1] * slope;
      const len = Math.hypot(sx, 1, sz);
      data[o] = Math.round(127.5 + 127.5 * (-sx / len));
      data[o + 1] = Math.round(127.5 + 127.5 * (1 / len));
      data[o + 2] = Math.round(127.5 + 127.5 * (-sz / len));
      const wx = x / size, wy = y / size;
      const n = nz2(x, y) * (1 - wx) * (1 - wy) + nz2(x - size, y) * wx * (1 - wy)
        + nz2(x - size, y - size) * wx * wy + nz2(x, y - size) * (1 - wx) * wy;
      data[o + 3] = Math.max(0, Math.min(255, Math.round(127.5 + 127.5 * n)));
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// Textura de espuma tileável: R = renda de bolhas (bordas de células em duas escalas
// + ruído), G = ruído suave (quebra/variação), B = manchas grandes (onde há carneirinhos).
function makeFoamTexture(S) {
  const T = makeTileNoise(SEED + 8181);
  const C1 = T.cells(9, 9, 1), C2 = T.cells(23, 23, 2);
  const vo = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  const data = new Uint8Array(S * S * 4);
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S, o = (y * S + x) * 4;
      const w = T.fbm(u, v, 4, 3);
      T.voronoi(C1, u + 0.03 * w, v - 0.03 * w, vo);
      const l1 = 1 - ss(0, 0.2, vo.f2 - vo.f1);
      T.voronoi(C2, u, v, vo);
      const l2 = 1 - ss(0, 0.26, vo.f2 - vo.f1);
      const n = 0.5 + 0.5 * w, nf = T.fbm(u, v, 32, 3);
      const r = Math.min(1, Math.max(0, Math.max(l1, l2 * 0.75) * (0.55 + 0.6 * n) + 0.22 * nf));
      data[o] = r * 255;
      data[o + 1] = Math.min(255, Math.max(0, (0.5 + 0.6 * T.fbm(u + 0.37, v + 0.11, 3, 4)) * 255));
      data[o + 2] = Math.min(255, Math.max(0, (0.5 + 0.65 * T.fbm(u + 0.73, v + 0.29, 2, 3)) * 255));
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true; tex.anisotropy = 8; tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// Disco radial: anéis densos (razão `ratio`, células ~quadradas com `segments`) até
// nearR, depois anéis ×1,19 até outerRadius. Vértice 0 = centro (sob a câmera).
function makeRadialGeometry(segments, ratio, nearR, outerRadius) {
  const radii = [];
  for (let r = 1.5; r < nearR; r *= ratio) radii.push(r);
  for (let r = nearR; r < outerRadius; r *= 1.19) radii.push(r);
  radii.push(outerRadius);
  const rings = radii.length;
  const verts = new Float32Array((1 + rings * segments) * 3);
  let p = 3;
  for (let i = 0; i < rings; i++) {
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      verts[p++] = Math.cos(a) * radii[i]; verts[p++] = 0; verts[p++] = Math.sin(a) * radii[i];
    }
  }
  const idx = new Uint32Array(segments * 3 + (rings - 1) * segments * 6);
  let q = 0;
  for (let s = 0; s < segments; s++) { idx[q++] = 0; idx[q++] = 1 + ((s + 1) % segments); idx[q++] = 1 + s; }
  for (let i = 0; i < rings - 1; i++) {
    const a0 = 1 + i * segments, b0 = 1 + (i + 1) * segments;
    for (let s = 0; s < segments; s++) {
      const s1 = (s + 1) % segments;
      idx[q++] = a0 + s; idx[q++] = b0 + s1; idx[q++] = b0 + s;
      idx[q++] = a0 + s; idx[q++] = a0 + s1; idx[q++] = b0 + s1;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), outerRadius);
  return geo;
}

const NW = OCEAN.WAVES.length;
const commonGLSL = (nIsl) => /* glsl */`
#define NW ${NW}
#define NISL ${nIsl}
uniform float uTime;
uniform vec4 uGA[NW];   // direção.xz, k, amplitude
uniform vec4 uGB[NW];   // ω, fase, amplitude horizontal (Q·A), Q·k·A
uniform sampler2D uShore;
uniform vec4 uIsl[NISL]; // cx, cz, R, raio máximo do campo
uniform vec3 uShoreP;   // U0, U1, linhas por ilha
// campo da costa — x: altura do fundo (m; > 0 = terra), y: distância à linha d'água (m, + mar adentro),
// z: 1 perto de uma ilha (dentro do campo), 0 em mar aberto
vec3 shoreAt(vec2 p) {
  for (int i = 0; i < NISL; i++) {
    vec2 d = p - uIsl[i].xy;
    float r2 = dot(d, d);
    if (r2 < uIsl[i].w * uIsl[i].w) {
      float r = sqrt(r2);
      float tx = atan(d.y, d.x) * (0.5 / PI) + 0.5;
      float rows = uShoreP.z, tot = rows * float(NISL), blk = float(i) * rows;
      float ro = textureLod(uShore, vec2(tx, (blk + 0.5) / tot), 0.0).b * uIsl[i].z;
      float v = (r / max(ro, 1.0) - uShoreP.x) / (uShoreP.y - uShoreP.x);
      if (v <= 1.0) {
        vec2 s = textureLod(uShore, vec2(tx, (blk + 0.5 + clamp(v, 0.0, 1.0) * (rows - 1.0)) / tot), 0.0).rg;
        return vec3(s, 1.0);
      }
    }
  }
  return vec3(-1000.0, 1.0e5, 0.0);
}
`;

const VERT = (nIsl) => /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
#include <fog_pars_vertex>
${commonGLSL(nIsl)}
uniform vec4 uGeo;     // x: espaçamento relativo da malha, y: espaçamento mínimo, z/w: raio de fade do deslocamento
uniform float uCamHeight;
varying vec3 vWorldPos;
varying vec2 vParam;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec2 p0 = wp.xz;
  float rr = length(position.xz);
  float amp = 1.0 - smoothstep(uGeo.z, uGeo.w, rr);
  // câmera rente à água: as ondas logo abaixo dela ficam baixas (a crista nunca corta a lente)
  amp *= mix(clamp((uCamHeight - 0.8) / 3.0, 0.15, 1.0), 1.0, smoothstep(40.0, 160.0, rr));
  vec3 disp = vec3(0.0);
  if (amp > 0.0) {
    vec3 sh = shoreAt(p0);
    amp *= mix(1.0, smoothstep(0.4, 10.0, -sh.x), sh.z);   // amortecidas no raso
    float spacing = max(rr * uGeo.x, uGeo.y);
    for (int i = 0; i < NW; i++) {
      vec4 a = uGA[i], b = uGB[i];
      float lam = 6.2831853 / a.z;
      float f = amp * (1.0 - smoothstep(lam * 0.12, lam * 0.2, spacing)); // malha grossa demais → sem este trem
      float th = a.z * dot(a.xy, p0) - b.x * uTime + b.y;
      disp.xz += a.xy * (b.z * cos(th) * f);
      disp.y += a.w * sin(th) * f;
    }
  }
  wp.xyz += disp;
  vWorldPos = wp.xyz;
  vParam = p0;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}`;

const FRAG = (nIsl) => /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
#include <fog_pars_fragment>
${SKY_GLSL}
${commonGLSL(nIsl)}
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uShallow;
uniform vec3 uShallowBody;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSigma;
uniform float uCamHeight;
uniform vec2 uNF;       // fade da normal de Gerstner (m)
uniform vec2 uWC;       // limiares do jacobiano para os carneirinhos
uniform float uFoamL;   // espaçamento das linhas de arrebentação (m)
uniform sampler2D uNormals;
uniform sampler2D uFoam;
varying vec3 vWorldPos;
varying vec2 vParam;

vec2 slopeAt(vec2 uv) {
  vec3 n = texture2D(uNormals, uv).rgb * 2.0 - 1.0;
  return n.xz / max(n.y, 0.2);
}
float D_GGX(float ndh, float a) {
  float a2 = a * a;
  float d = ndh * ndh * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d);
}
float V_Smith(float ndl, float ndv, float a) {
  float k = a * 0.5;
  return 0.25 / ((ndl * (1.0 - k) + k) * (ndv * (1.0 - k) + k) + 1e-4);
}
// Gerstner no ponto de parâmetro p0: inclinação (dh/dx, dh/dz), jacobiano, altura.
// Cada trem some quando a pegada do pixel passa de uma fração do seu comprimento (sem aliasing).
vec4 gerstner(vec2 p0, float t, float fp, float amp) {
  float Sx = 0.0, Sz = 0.0, Sy = 0.0, Jxx = 1.0, Jzz = 1.0, Jxz = 0.0, h = 0.0;
  for (int i = 0; i < NW; i++) {
    vec4 a = uGA[i], b = uGB[i];
    float lam = 6.2831853 / a.z;
    float f = amp * (1.0 - smoothstep(0.06, 0.25, fp / lam));
    float th = a.z * dot(a.xy, p0) - b.x * t + b.y;
    float s = sin(th), c = cos(th);
    float wa = a.z * a.w * f;
    Sx += a.x * wa * c; Sz += a.y * wa * c;
    float q = b.w * f * s;
    Sy += q;
    Jxx -= q * a.x * a.x; Jzz -= q * a.y * a.y; Jxz -= q * a.x * a.y;
    h += a.w * s * f;
  }
  float inv = 1.0 / max(1.0 - Sy, 0.2);
  return vec4(Sx * inv, Sz * inv, Jxx * Jzz - Jxz * Jxz, h);
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 toCam = cameraPosition - vWorldPos;
  float dist = length(toCam);
  vec3 V = toCam / max(dist, 0.001);
  vec2 p = vWorldPos.xz;
  float t = uTime;

  // ---- campo da costa: profundidade e distância à linha d'água
  vec3 sh = shoreAt(p);
  float depth = -sh.x;
  float nearI = sh.z;
  float calm = mix(1.0, 0.45 + 0.55 * smoothstep(0.5, 7.0, depth), nearI); // raso: marola menor

  // ---- normal: 4 oitavas do mapa de normais (detalhe some pela pegada do pixel) + vagas
  //      analíticas longas + Gerstner perto da câmera. A inclinação "perdida" vira rugosidade.
  vec2 fpv = max(abs(dFdx(p)), abs(dFdy(p)));
  float fp = max(max(fpv.x, fpv.y), dist * 0.0006);
  float graze = pow(saturate(V.y), 0.5);
  float w0 = (1.0 - smoothstep(0.015, 0.09, fp / 7.0)) * (1.0 - smoothstep(120.0, 320.0, dist));
  float w1 = 1.0 - smoothstep(0.015, 0.09, fp / 24.0);
  float w2 = 1.0 - smoothstep(0.015, 0.10, fp / 75.0);
  float w3 = 1.0 - smoothstep(0.02, 0.14, fp / 260.0);
  float wS = 1.0 - smoothstep(0.03, 0.20, fp / 210.0);
  const mat2 rotA  = mat2(0.866, 0.5, -0.5, 0.866);
  const mat2 rotAi = mat2(0.866, -0.5, 0.5, 0.866);
  const mat2 rotB  = mat2(0.342, -0.940, 0.940, 0.342);
  const mat2 rotBi = mat2(0.342, 0.940, -0.940, 0.342);
  vec2 warp = (texture2D(uNormals, p * (1.0 / 1400.0) + vec2(t * 0.0002, 0.0)).rb - 0.5) * 90.0;
  vec2 pw = p + warp;
  const float A0 = 0.09, A1 = 0.11, A2 = 0.13, A3 = 0.17, AS = 0.035;
  vec2 s = vec2(0.0);
  s += slopeAt(p * (1.0 / 7.0) + t * vec2(0.06, -0.04)) * A0 * w0;
  s += rotBi * slopeAt(rotB * pw * (1.0 / 24.0) + t * vec2(0.026, 0.034)) * A1 * w1;
  s += rotAi * slopeAt(rotA * pw * (1.0 / 75.0) + t * vec2(-0.010, 0.013)) * A2 * w2;
  s += slopeAt(pw * (1.0 / 260.0) + t * vec2(0.0022, -0.0016)) * A3 * w3;
  s *= calm;
  // Gerstner (perto): some com a distância (o mar longe fica como era) e no raso
  float gN = (1.0 - smoothstep(uNF.x, uNF.y, dist)) * mix(1.0, smoothstep(0.4, 10.0, depth), nearI);
  vec4 G = vec4(0.0, 0.0, 1.0, 0.0);
  if (gN > 0.001) { G = gerstner(vParam, t, fp, gN); s += G.xy; }
  float env = texture2D(uNormals, p * (1.0 / 2300.0) + vec2(0.0, t * 0.00004)).a;
  env = 0.25 + 1.5 * smoothstep(0.3, 0.8, env);
  vec2 d1 = normalize(vec2(0.82, 0.45)), d2 = normalize(vec2(0.15, 0.99));
  float k1 = PI2 / 210.0, w1a = sqrt(9.81 * k1);
  float k2 = PI2 / 133.0, w2a = sqrt(9.81 * k2);
  float ph1 = dot(d1, p) * k1 - w1a * t + 0.8 * sin(dot(vec2(-0.45, 0.82), p) * (PI2 / 1700.0));
  float ph2 = dot(d2, p) * k2 - w2a * t + 1.3;
  s += (d1 * (AS * cos(ph1)) + d2 * (AS * 0.55 * cos(ph2))) * env * wS * (1.0 - 0.85 * gN) * calm;
  vec3 N = normalize(vec3(-s.x, 1.0, -s.y));
  float detail = length(s);
  float lost = A0 * A0 * (1.0 - w0) + A1 * A1 * (1.0 - w1) + A2 * A2 * (1.0 - w2) + A3 * A3 * (1.0 - w3) + AS * AS * (1.0 - wS);

  float ndl = dot(N, uSunDir);
  float ndv = max(dot(N, V), 1e-3);

  // ---- reflexo do céu
  vec3 R = reflect(-V, N);
  R.y = max(R.y, 0.012);
  float hazeScale = 1.0 - 0.30 * smoothstep(1500.0, 6000.0, uCamHeight);
  vec3 skyRefl = skyRadiance(normalize(R), uSunDir, hazeScale);
  skyRefl = mix(skyRefl, SKY_HAZE_COL, 0.35 * exp(-max(R.y, 0.0) * 28.0) * hazeScale);
  vec3 Nf = normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.25));
  float ndvF = max(dot(Nf, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - ndvF, 5.0) * 0.78;

  // ---- corpo d'água (subsuperfície)
  float big = texture2D(uNormals, p * (1.0 / 3100.0) + vec2(t * 0.00002)).a;
  float big2 = texture2D(uNormals, p * (1.0 / 700.0) - vec2(t * 0.00005, 0.0)).a;
  vec3 water = mix(uDeep, uMid, saturate(big * 0.7 + big2 * 0.4));
  vec3 skyAmb = skyRadiance(vec3(0.0, 1.0, 0.0), uSunDir, hazeScale) * 1.6 + SKY_HAZE_COL * 0.35;
  vec3 sunT = uSunColor * skySunTransmittance(uSunDir);
  float wrap = saturate(ndl * 0.6 + 0.4);
  vec3 irr = skyAmb * 0.7 + sunT * 0.95 * wrap;
  float towardSun = saturate(-dot(V, uSunDir) * 0.5 + 0.5);
  float crest = saturate(detail * 2.5) * saturate(dot(N, normalize(V + uSunDir)) * 1.4 - 0.4);
  float sss = pow(towardSun, 2.0) * crest;
  water = mix(water, uShallow, sss * 0.45 + saturate(1.0 - N.y * 1.2) * 0.06);
  vec3 body = water * irr * 1.35;

  // ---- água rasa: o fundo (terreno, já desenhado) aparece pela transmissão; halo turquesa
  vec3 Tu = vec3(0.0);
  float Tg = 0.0;
  if (nearI > 0.5 && depth < 44.0) {
    float halo = exp(-max(sh.y, 0.0) / 240.0) * smoothstep(-1.0, 4.0, depth);
    body = mix(body, uShallowBody * irr, 0.4 * halo);
    float cosV = sqrt(max(0.04, 1.0 - (1.0 - V.y * V.y) / 1.7689)); // refração (n = 1,33)
    float dd = max(depth, 0.0) / cosV;
    Tu = exp(-uSigma * dd);
    Tg = exp(-uSigma.g * dd) * (1.0 - smoothstep(30.0, 42.0, depth));
  }
  vec3 colP = skyRefl * F + (1.0 - F) * body * (1.0 - Tu);   // radiância pré-multiplicada
  float alpha = 1.0 - (1.0 - F) * Tg;

  // ---- brilho do sol (GGX)
  vec3 H = normalize(uSunDir + V);
  float ndh = max(dot(N, H), 0.0);
  float rough = sqrt(0.07 * 0.07 + lost * 2.2) + 0.04 * (1.0 - graze);
  float ndlS = max(ndl, 0.0);
  float Fh = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
  float spec = D_GGX(ndh, rough) * V_Smith(ndlS, ndv, rough) * Fh * ndlS;
  spec = min(spec, 3.0);
  colP += sunT * 2.6 * spec;

  // ---- espuma: arrebentação na costa + carneirinhos nas cristas
  float foam = 0.0;
  if (nearI > 0.5 && depth > -0.6 && sh.y < 700.0) {
    float n1 = texture2D(uFoam, p * (1.0 / 61.0) + vec2(t * 0.004, -t * 0.002)).g;
    float ft = texture2D(uFoam, p * (1.0 / 9.0) + vec2(-t * 0.006, t * 0.009)).r;
    float ph = sh.y / uFoamL + t * 0.075 + n1 * 0.9;           // linhas que avançam para a praia
    float w = fract(ph);
    float band = smoothstep(0.0, 0.06, w) * (1.0 - smoothstep(0.06, 0.45, w));
    band = mix(0.28, band, 1.0 - smoothstep(0.15, 0.5, fp / uFoamL)); // longe: média (sem cintilar)
    float zone = (1.0 - smoothstep(1.8, 7.0, depth)) * smoothstep(-0.3, 0.5, depth);
    float sw = depth + 0.2 * sin(t * 0.6 + dot(p, vec2(0.021, 0.017)) + n1 * 7.0);
    float swash = 1.0 - smoothstep(0.0, 0.6, sw);              // espraiamento na linha d'água
    float broken = smoothstep(0.3, 0.75, ft * (0.55 + 0.7 * n1));
    foam = max(band * zone, swash * 0.95) * broken;
    foam = max(foam, zone * 0.3 * smoothstep(0.55, 0.85, ft) * n1);
  }
  if (gN > 0.001) {
    float patchN = texture2D(uFoam, p * (1.0 / 830.0) + vec2(t * 0.0011, 0.0)).b;
    float wc = (1.0 - smoothstep(uWC.y, uWC.x, G.z)) * smoothstep(0.45, 0.75, patchN) * gN;
    float ft2 = texture2D(uFoam, p * (1.0 / 6.5) + vec2(t * 0.02, -t * 0.013)).r;
    foam = max(foam, wc * smoothstep(0.35, 0.8, ft2) * 0.85);
  }
  vec3 foamCol = vec3(0.82) * (skyAmb * 0.75 + sunT * saturate(uSunDir.y * 0.9 + 0.1));
  colP = mix(colP, foamCol, foam);
  alpha = mix(alpha, 1.0, foam);

  // leve dessaturação: o mar das referências é azul-aço, não azul puro
  float lum = dot(colP, vec3(0.2126, 0.7152, 0.0722));
  colP = mix(colP, vec3(lum), 0.20);

  alpha = clamp(alpha, 0.02, 1.0);
  gl_FragColor = vec4(min(colP / alpha, vec3(40.0)), alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function createOcean(scene, opts = {}) {
  const quality = opts.quality || 'high';
  const low = quality === 'low';
  const outer = WORLD.CAMERA_FAR * 1.1;
  const seg = low ? OCEAN.SEGMENTS_LOW : OCEAN.SEGMENTS_HIGH;
  const ratio = 1 + (Math.PI * 2) / seg;                    // células ~quadradas
  const geo = makeRadialGeometry(seg, ratio, low ? OCEAN.NEAR_RADIUS * 0.6 : OCEAN.NEAR_RADIUS, outer);

  // ondas de Gerstner (dispersão de águas profundas ω = √(g·k))
  const wind = THREE.MathUtils.degToRad(OCEAN.WIND_DEG);
  const prng = createRng(SEED + 7707);
  const GA = [], GB = [];
  for (const [lam, A, dirDeg] of OCEAN.WAVES) {
    const k = (Math.PI * 2) / lam, a = wind + THREE.MathUtils.degToRad(dirDeg);
    GA.push(new THREE.Vector4(Math.cos(a), Math.sin(a), k, A));
    GB.push(new THREE.Vector4(Math.sqrt(9.81 * k), prng() * Math.PI * 2, OCEAN.CHOP / k, OCEAN.CHOP));
  }
  const shore = getShoreField(WORLD_DATA);
  const nIsl = shore.count;

  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uDeep: { value: new THREE.Color(COLORS.oceanDeep) },
      uMid: { value: new THREE.Color(COLORS.oceanMid) },
      uShallow: { value: new THREE.Color(COLORS.oceanShallow) },
      uShallowBody: { value: new THREE.Color(COLORS.shallows).multiplyScalar(0.55) },
      uSunDir: { value: sunDirection.clone() },
      uSunColor: { value: new THREE.Color(COLORS.sunLight) },
      uSigma: { value: new THREE.Vector3(...ISLANDS.WATER_SIGMA) },
      uTime: { value: 0 },
      uCamHeight: { value: 0 },
      uNormals: { value: null },
      uFoam: { value: null },
      uShore: { value: null },
      uIsl: { value: shore.islands },
      uShoreP: { value: new THREE.Vector3(shore.U0, shore.U1, shore.rows) },
      uGA: { value: GA },
      uGB: { value: GB },
      uGeo: { value: new THREE.Vector4(ratio - 1, 0.05, OCEAN.DISP_FADE[0] * (low ? 0.6 : 1), OCEAN.DISP_FADE[1] * (low ? 0.6 : 1)) },
      uNF: { value: new THREE.Vector2(...OCEAN.NORMAL_FADE) },
      uWC: { value: new THREE.Vector2(...OCEAN.WHITECAP) },
      uFoamL: { value: OCEAN.FOAM_LINE_M },
    },
  ]);
  // (merge clona os valores: texturas e arrays de vetores entram depois)
  uniforms.uNormals.value = makeNormalMap(low ? 256 : 512);
  uniforms.uFoam.value = makeFoamTexture(low ? 256 : 512);
  uniforms.uShore.value = shore.texture;
  uniforms.uIsl.value = shore.islands;
  uniforms.uGA.value = GA; uniforms.uGB.value = GB;

  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT(nIsl), fragmentShader: FRAG(nIsl), fog: true, side: THREE.FrontSide,
    // opaco na lista de render (desenhado depois do terreno), com mistura própria só onde alfa < 1 (água rasa)
    transparent: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.name = 'ocean';
  mesh.position.y = WORLD.SEA_LEVEL;
  scene.add(mesh);

  return {
    object: mesh,
    update(camera, time) {
      // a malha acompanha a câmera continuamente (ondas e texturas são de mundo)
      mesh.position.set(camera.position.x, WORLD.SEA_LEVEL, camera.position.z);
      uniforms.uTime.value = time;
      uniforms.uCamHeight.value = camera.position.y - WORLD.SEA_LEVEL;
    },
  };
}
