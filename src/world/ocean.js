// =====================================================================
//  Oceano infinito: disco radial (denso perto da câmera) que segue a câmera,
//  com ShaderMaterial em coordenadas de MUNDO (a textura não "nada").
//  Água fisicamente plausível:
//   • mapa de NORMAIS tileável (512², gerado em código: soma de ondas tipo
//     Gerstner com cristas afiadas + ruído) amostrado em 3 escalas com rolagem
//     (capilar ~9 m, marola ~45 m, vagas ~260 m) + 2 vagas analíticas longas;
//     o detalhe fino some com a distância (o mar longe fica liso);
//   • reflexo do céu pela direção refletida usando o MESMO modelo analítico do
//     céu (skyRadiance de sky.js) + Fresnel de Schlick (F0 = 0.02);
//   • cor de profundidade: azul-marinho profundo com verde-azulado nas cristas
//     viradas para o sol (falsa transmissão / subsuperfície);
//   • brilho do sol por microfacetas (GGX) com rugosidade crescendo com a
//     distância (glitter fino perto, trilha larga e macia longe);
//   • névoa FogExp2, profundidade logarítmica, tone mapping, colorspace.
//  Contrato: createOcean(scene, {quality}) -> { object, update(camera, time) }
// =====================================================================
import * as THREE from 'three';
import { WORLD, COLORS, SEED } from '../config.js';
import { sunDirection } from './lighting.js';
import { SKY_GLSL } from './sky.js';
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
    // 2/3 das ondas seguem o "vento" (espectro direcional), o resto é quase isotrópico
    const ang = i % 3 !== 2 ? mainDir + rng.gauss() * 0.7 : rng.range(0, Math.PI * 2);
    let nx = Math.round(Math.cos(ang) * kmag), nz = Math.round(Math.sin(ang) * kmag);
    if (nx === 0 && nz === 0) nx = 1;
    const k = Math.hypot(nx, nz);
    waves.push({ nx, nz, amp: Math.pow(k, -1.7) * rng.range(0.55, 1.0), phase: rng.range(0, Math.PI * 2), sharp: rng.range(1.2, 2.6) });
  }
  // altura
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
        // seno com crista afiada e cava larga: 2·((sin+1)/2)^sharp − 1
        h += w.amp * (2 * Math.pow(0.5 + 0.5 * Math.sin(ph), w.sharp) - 1);
      }
      H[y * size + x] = h + tileNoise(x, y) * 0.035;
    }
  }
  // normal por diferenças finitas (com wrap) — escala de altura escolhida para
  // inclinações máximas de ~35° no tile (o shader modula por escala/distância)
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
      const wx = x / size, wy = y / size; // ruído tileável por mistura de 4 cópias
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

// Disco radial: anéis com raio crescendo geometricamente (≈3 m perto da câmera,
// até além do far plane). Sem deslocamento de vértices: tudo é normal/cor.
function makeRadialGeometry(segments, outerRadius) {
  const radii = [];
  for (let r = 3; r < outerRadius; r *= 1.19) radii.push(r);
  radii.push(outerRadius);
  const rings = radii.length;
  const verts = new Float32Array((1 + rings * segments) * 3);
  let p = 3; // vértice 0 = centro
  for (let i = 0; i < rings; i++) {
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      verts[p++] = Math.cos(a) * radii[i]; verts[p++] = 0; verts[p++] = Math.sin(a) * radii[i];
    }
  }
  const idx = [];
  for (let s = 0; s < segments; s++) idx.push(0, 1 + ((s + 1) % segments), 1 + s);
  for (let i = 0; i < rings - 1; i++) {
    const a0 = 1 + i * segments, b0 = 1 + (i + 1) * segments;
    for (let s = 0; s < segments; s++) {
      const s1 = (s + 1) % segments;
      idx.push(a0 + s, b0 + s1, b0 + s, a0 + s, a0 + s1, b0 + s1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), outerRadius);
  return geo;
}

const VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
#include <fog_pars_vertex>
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}`;

const FRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
#include <fog_pars_fragment>
${SKY_GLSL}
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uShallow;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uTime;
uniform float uCamHeight;
uniform sampler2D uNormals;
varying vec3 vWorldPos;

// inclinação (dh/dx, dh/dz) a partir do mapa de normais
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

void main() {
  #include <logdepthbuf_fragment>
  vec3 toCam = cameraPosition - vWorldPos;
  float dist = length(toCam);
  vec3 V = toCam / max(dist, 0.001);
  vec2 p = vWorldPos.xz;
  float t = uTime;

  // ---- normal: 3 escalas do mapa de normais (com rolagem e rotação) + 2 vagas
  //      analíticas longas. O detalhe some com a distância e em ângulos rasantes
  //      (evita cintilação); longe o mar fica liso e reflete o horizonte.
  float graze = pow(saturate(V.y), 0.6);
  float fadeFine = graze / (1.0 + dist * (1.0 / 260.0) + dist * dist * (1.0 / 4.0e6));
  float fadeMed  = (0.3 + 0.7 * graze) / (1.0 + dist * (1.0 / 1600.0));
  float fadeBig  = (0.5 + 0.5 * graze) / (1.0 + dist * (1.0 / 14000.0));
  const mat2 rotA  = mat2(0.866, 0.5, -0.5, 0.866);
  const mat2 rotAi = mat2(0.866, -0.5, 0.5, 0.866);
  const mat2 rotB  = mat2(0.342, -0.940, 0.940, 0.342);
  const mat2 rotBi = mat2(0.342, 0.940, -0.940, 0.342);
  // deformação lenta do domínio (quebra a repetição visível dos tiles)
  vec2 warp = (texture2D(uNormals, p * (1.0 / 900.0) + vec2(t * 0.0003, 0.0)).rb - 0.5) * 60.0;
  vec2 pw = p + warp;
  vec2 s = vec2(0.0);
  // capilares/marola fina ~9 m e ~14 m (duas direções, rolagem rápida)
  s += slopeAt(p * (1.0 / 9.0) + t * vec2(0.055, -0.035)) * 0.13 * fadeFine;
  s += rotBi * slopeAt(rotB * pw * (1.0 / 14.0) + t * vec2(0.03, 0.045)) * 0.11 * fadeFine;
  // marola média ~45 m
  s += rotAi * slopeAt(rotA * pw * (1.0 / 45.0) + t * vec2(-0.012, 0.016)) * 0.20 * fadeMed;
  // vagas ~110 m e ~260 m (suaves e largas — mar de alto-mar calmo das referências)
  s += rotBi * slopeAt(rotB * p * (1.0 / 110.0) + t * vec2(0.005, 0.004)) * 0.20 * fadeMed;
  s += slopeAt(pw * (1.0 / 260.0) + t * vec2(0.0022, -0.0016)) * 0.30 * fadeBig;
  // vagas analíticas longas (dispersão de água profunda: ω = sqrt(g·k))
  vec2 d1 = normalize(vec2(0.82, 0.45)), d2 = normalize(vec2(-0.35, 0.92));
  float k1 = PI2 / 90.0, k2 = PI2 / 31.0;
  float w1 = sqrt(9.81 * k1), w2 = sqrt(9.81 * k2);
  s += d1 * (0.9 * k1 * cos(dot(d1, p) * k1 - w1 * t)) * fadeMed;
  s += d2 * (0.14 * k2 * cos(dot(d2, p) * k2 - w2 * t + 1.7)) * fadeFine;
  vec3 N = normalize(vec3(-s.x, 1.0, -s.y));
  float detail = length(s); // quanta inclinação resta (0 longe)

  float ndl = dot(N, uSunDir);
  float ndv = max(dot(N, V), 1e-3);

  // ---- reflexo do céu pela direção refletida (mesmo modelo analítico do céu)
  vec3 R = reflect(-V, N);
  R.y = max(R.y, 0.012); // nunca "reflete o mar": abaixo do horizonte vira horizonte
  float hazeScale = 1.0 - 0.30 * smoothstep(1500.0, 6000.0, uCamHeight);
  vec3 skyRefl = skyRadiance(normalize(R), uSunDir, hazeScale);
  // Fresnel de Schlick (F0 = 0.02), com a normal um pouco suavizada para não cintilar
  vec3 Nf = normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.35));
  float ndvF = max(dot(Nf, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - ndvF, 5.0);

  // ---- cor da água (subsuperfície): azul-marinho profundo + variação lenta em
  //      grande escala; luz difusa do céu (hemisfério) + verde-azulado nas cristas
  //      viradas para o sol (luz atravessando a crista em direção à câmera)
  float big = texture2D(uNormals, p * (1.0 / 3100.0) + vec2(t * 0.00002)).a;
  float big2 = texture2D(uNormals, p * (1.0 / 700.0) - vec2(t * 0.00005, 0.0)).a;
  vec3 water = mix(uDeep, uMid, saturate(big * 0.7 + big2 * 0.4));
  vec3 skyAmb = skyRadiance(vec3(0.0, 1.0, 0.0), uSunDir, hazeScale) * 1.6 + SKY_HAZE_COL * 0.35;
  vec3 sunT = uSunColor * skySunTransmittance(uSunDir);
  float wrap = saturate(ndl * 0.6 + 0.4);
  vec3 irr = skyAmb * 0.7 + sunT * 0.95 * wrap;        // irradiância ambiente + sol
  float towardSun = saturate(-dot(V, uSunDir) * 0.5 + 0.5);
  float crest = saturate(detail * 2.5) * saturate(dot(N, normalize(V + uSunDir)) * 1.4 - 0.4);
  float sss = pow(towardSun, 2.0) * crest;
  water = mix(water, uShallow, sss * 0.45 + saturate(1.0 - N.y * 1.2) * 0.06);
  vec3 col = water * irr;
  col = mix(col, skyRefl, F);

  // ---- brilho do sol: GGX com rugosidade pela distância (glitter fino perto,
  //      trilha larga longe onde a normal foi suavizada)
  vec3 H = normalize(uSunDir + V);
  float ndh = max(dot(N, H), 0.0);
  float farness = saturate(dist / 15000.0);
  float rough = mix(0.075, 0.28, farness) + 0.06 * (1.0 - graze);
  float ndlS = max(ndl, 0.0);
  float Fh = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
  float spec = D_GGX(ndh, rough) * V_Smith(ndlS, ndv, rough) * Fh * ndlS;
  spec = min(spec, 3.0);
  col += sunT * 2.6 * spec;

  // leve dessaturação: o mar das referências é azul-aço, não azul puro
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3(lum), 0.16);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function createOcean(scene, opts = {}) {
  const quality = opts.quality || 'high';
  const outer = WORLD.CAMERA_FAR * 1.1; // raio = 1.1 × far (diâmetro 2,2 × far)
  const geo = makeRadialGeometry(quality === 'low' ? 56 : 96, outer);
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uDeep: { value: new THREE.Color(COLORS.oceanDeep) },
      uMid: { value: new THREE.Color(COLORS.oceanMid) },
      uShallow: { value: new THREE.Color(COLORS.oceanShallow) },
      uSunDir: { value: sunDirection.clone() },
      uSunColor: { value: new THREE.Color(COLORS.sunLight) },
      uTime: { value: 0 },
      uCamHeight: { value: 0 },
      uNormals: { value: null },
    },
  ]);
  uniforms.uNormals.value = makeNormalMap(quality === 'low' ? 256 : 512);
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, fog: true, side: THREE.FrontSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.name = 'ocean';
  mesh.position.y = WORLD.SEA_LEVEL;
  scene.add(mesh);

  const SNAP = 10; // grade de encaixe (as UVs são de mundo; o encaixe só evita jitter da malha)
  return {
    object: mesh,
    update(camera, time) {
      mesh.position.set(Math.round(camera.position.x / SNAP) * SNAP, WORLD.SEA_LEVEL, Math.round(camera.position.z / SNAP) * SNAP);
      uniforms.uTime.value = time;
      uniforms.uCamHeight.value = camera.position.y;
    },
  };
}
