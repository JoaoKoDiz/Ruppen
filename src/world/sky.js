// =====================================================================
//  Céu: esfera invertida enorme que segue a câmera, com modelo analítico
//  de espalhamento simples (Rayleigh + Mie, uma dispersão, massa de ar de
//  Kasten-Young + véu de espalhamento múltiplo): zênite azul profundo,
//  mais claro e quente do lado do sol, faixa leitosa no horizonte, leve
//  escurecimento oposto ao sol; disco solar com corona macia; cirros altos
//  (ruído). A faixa do horizonte é fundida com a MESMA cor da FogExp2
//  (em sRGB, como o renderer aplica a névoa) para o oceano encontrar o céu
//  sem emenda. O trecho GLSL `SKY_GLSL` (skyRadiance) é exportado e reutilizado
//  pelo oceano para o reflexo — o mar reflete exatamente este céu.
//  Contrato: createSky(scene, {quality}) -> { object, update(camera, time) }
// =====================================================================
import * as THREE from 'three';
import { WORLD, COLORS, SEED } from '../config.js';
import { sunDirection } from './lighting.js';
import { createNoise } from '../util/noise.js';

// Parâmetros do modelo (ajustados numericamente para: zênite ≈ COLORS.skyZenith,
// horizonte ≈ COLORS.fog). Coeficientes por metro; alturas de escala em metros.
export const SKY_MODEL = {
  betaR: [4.2e-6, 11.4e-6, 32.0e-6],   // Rayleigh (λ⁻⁴ exagerado: zênite mais saturado, como nos renders)
  HR: 8000,
  betaM: 0.8e-5,                       // Mie (haze leve: dia limpo mas leitoso no horizonte)
  HM: 1200,
  g: 0.70,                             // Henyey-Greenstein (lobo para a frente: clareamento ao redor do sol)
  sunI: [7.4, 7.5, 7.9],               // irradiância do sol (já com um leve azul: céu de verão)
  hazeK: 0.10,                         // véu de espalhamento múltiplo em função da massa de ar
  hazeMix: 0.75,
};

// Cor linear a partir de um hex sRGB (como THREE.Color faz) → literal GLSL
function glslColor(hex) {
  const c = new THREE.Color(hex);
  return `vec3(${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)})`;
}
const v3 = (a) => `vec3(${a.map((x) => x.toExponential(4)).join(', ')})`;

// Trecho GLSL compartilhado (céu e oceano). skyRadiance(d, sun, hazeScale) → radiância LINEAR.
export const SKY_GLSL = /* glsl */`
const vec3 SKY_BETA_R = ${v3(SKY_MODEL.betaR)};
const float SKY_HR = ${SKY_MODEL.HR.toFixed(1)};
const float SKY_BETA_M = ${SKY_MODEL.betaM.toExponential(4)};
const float SKY_HM = ${SKY_MODEL.HM.toFixed(1)};
const float SKY_G = ${SKY_MODEL.g.toFixed(3)};
const vec3 SKY_SUN_I = ${v3(SKY_MODEL.sunI)};
const float SKY_HAZE_K = ${SKY_MODEL.hazeK.toFixed(4)};
const float SKY_HAZE_MIX = ${SKY_MODEL.hazeMix.toFixed(4)};
const vec3 SKY_HAZE_COL = ${glslColor(COLORS.fog)};

// massa de ar relativa (Kasten-Young), h = seno da elevação
float skyAirmass(float h) {
  h = max(h, 0.0);
  return 1.0 / (h + 0.02 + 0.15 * pow(h * 57.3 + 3.885, -1.253));
}
// transmitância do sol até o solo (tinge o sol e o reflexo de quente perto do horizonte)
vec3 skySunTransmittance(vec3 sun) {
  float as = skyAirmass(sun.y);
  return exp(-(SKY_BETA_R * SKY_HR + SKY_BETA_M * SKY_HM) * as);
}
vec3 skyRadiance(vec3 d, vec3 sun, float hazeScale) {
  float a = skyAirmass(d.y);
  vec3 Ts = sqrt(skySunTransmittance(sun));           // ≈ transmitância média ao longo do raio
  float mu = clamp(dot(d, sun), -1.0, 1.0);
  float pr = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  float g2 = SKY_G * SKY_G;
  float pm = (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * SKY_G * mu, 1.5));
  vec3 ext = (SKY_BETA_R * SKY_HR + SKY_BETA_M * SKY_HM) * a;
  vec3 sca = (SKY_BETA_R * SKY_HR * pr + SKY_BETA_M * SKY_HM * pm) * a;
  vec3 I = SKY_SUN_I * Ts * sca / ext * (1.0 - exp(-ext));
  // espalhamento múltiplo: véu leitoso proporcional à massa de ar (zero no zênite)
  float t = (1.0 - exp(-SKY_HAZE_K * max(a - 1.0, 0.0))) * hazeScale;
  return I * (1.0 - t * SKY_HAZE_MIX) + SKY_HAZE_COL * t;
}`;

// Textura de ruído "tileável" (mistura de 4 cópias deslocadas) usada pelos cirros.
function makeCirrusTexture(size) {
  const noise = createNoise(SEED + 9101);
  const data = new Uint8Array(size * size * 4);
  const f = 3.0 / size; // frequência base (ciclos por tile)
  const sample = (x, y) => noise.fbm2(x * f, y * f * 3.2, 5, 2.1, 0.55); // esticado em Y → filamentos
  const sample2 = (x, y) => noise.fbm2(x * f * 2.3 + 11.0, y * f * 1.1 + 7.0, 4, 2.0, 0.5); // manchas largas
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const wx = x / size, wy = y / size;
      const tile = (fn) => fn(x, y) * (1 - wx) * (1 - wy) + fn(x - size, y) * wx * (1 - wy)
        + fn(x - size, y - size) * wx * wy + fn(x, y - size) * (1 - wx) * wy;
      const n = tile(sample), m = tile(sample2);
      const i = (y * size + x) * 4;
      data[i] = Math.max(0, Math.min(255, Math.round(128 + 128 * n)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(128 + 128 * m)));
      data[i + 2] = 128; data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vDir;
void main() {
  vDir = position; // a esfera está centrada na câmera: posição local = direção de visão
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
}`;

const FRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
${SKY_GLSL}
uniform vec3 uFogSRGB;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uTime;
uniform float uCamHeight;
uniform float uCirrusAmount;
uniform sampler2D uCirrus;
varying vec3 vDir;

// joelho suave acima de 0.6 (o céu não passa pelo tone mapping do renderer)
vec3 softKnee(vec3 c) {
  vec3 hi = 0.6 + 0.4 * (1.0 - exp(-(c - 0.6) / 0.4));
  return mix(c, hi, step(0.6, c));
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 d = normalize(vDir);
  float h = d.y;
  // a névoa/haze fica mais rala quando a câmera voa alto (acima de ~2 km)
  float thin = 1.0 - 0.30 * smoothstep(1500.0, 6000.0, uCamHeight);
  vec3 dd = normalize(vec3(d.x, max(h, 0.0), d.z));
  vec3 col = skyRadiance(dd, uSunDir, thin);

  // ---- sol: disco + corona macia (espalhamento para a frente), tingido pela transmitância
  float s = clamp(dot(d, uSunDir), -1.0, 1.0);
  float ang = acos(s);
  float disc = 1.0 - smoothstep(0.0044, 0.0064, ang);
  float corona = exp(-ang * 55.0) * 0.55 + exp(-ang * 12.0) * 0.16 + exp(-ang * 3.0) * 0.05;
  vec3 Ts = skySunTransmittance(uSunDir);
  col += uSunColor * Ts * (disc * 6.0 + corona * 1.4);

  // ---- cirros finos e altos (ruído projetado num plano, esticado em filamentos),
  //      mais brilhantes do lado do sol (espalhamento para a frente do gelo)
  if (uCirrusAmount > 0.0 && h > 0.015) {
    vec2 pr = d.xz / (h + 0.08);
    mat2 rot = mat2(0.92, 0.39, -0.39, 0.92);
    vec2 uv = rot * pr;
    vec2 n1 = texture2D(uCirrus, uv * vec2(0.50, 0.10) + vec2(uTime * 0.0005, 0.0)).rg;
    float n2 = texture2D(uCirrus, uv * vec2(1.9, 0.36) + vec2(-uTime * 0.0010, 0.17)).r;
    float cover = smoothstep(0.42, 0.78, n1.g);                 // manchas largas onde há cirro
    float fil = smoothstep(0.50, 0.85, n1.r * 0.65 + n2 * 0.35); // filamentos dentro das manchas
    float band = smoothstep(0.04, 0.16, h) * (1.0 - smoothstep(0.45, 0.9, h));
    float cirrus = fil * cover * band * 0.30 * uCirrusAmount;
    float fwd = 0.6 + 0.6 * pow(max(s, 0.0), 3.0);
    vec3 cirCol = mix(col, vec3(0.78, 0.82, 0.88) * fwd, 0.85);
    col = mix(col, cirCol, cirrus);
  }

  col = softKnee(max(col, 0.0));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // Faixa do horizonte: a mesma cor da FogExp2 (já em sRGB), para que o oceano
  // totalmente enevoado e o céu se encontrem sem emenda. Abaixo do horizonte = névoa.
  float horizonMix = 1.0 - smoothstep(0.0, 0.025, h);
  horizonMix = max(horizonMix, 0.55 * exp(-max(h, 0.0) * 28.0) * thin);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogSRGB, horizonMix);
}`;

export function createSky(scene, opts = {}) {
  const quality = opts.quality || 'high';
  const radius = WORLD.CAMERA_FAR * 0.9;
  const geo = new THREE.SphereGeometry(radius, quality === 'low' ? 36 : 56, quality === 'low' ? 18 : 28);

  // cor da névoa em sRGB (é assim que o renderer envia fogColor para a tela)
  const fogSRGB = new THREE.Vector3();
  { const c = new THREE.Color(COLORS.fog); const o = {}; c.getRGB(o, THREE.SRGBColorSpace); fogSRGB.set(o.r, o.g, o.b); }

  const uniforms = {
    uFogSRGB: { value: fogSRGB },
    uSunDir: { value: sunDirection.clone() },
    uSunColor: { value: new THREE.Color(COLORS.sunLight) },
    uTime: { value: 0 },
    uCamHeight: { value: 0 },
    uCirrusAmount: { value: quality === 'low' ? 0 : 1 },
    uCirrus: { value: quality === 'low' ? null : makeCirrusTexture(256) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG,
    side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
  });
  // O céu NÃO passa pelo tone mapping (ACES dessatura/escurece o gradiente): o modelo
  // já produz valores de tela; o chunk continua incluído (contrato).
  mat.toneMapped = false;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.name = 'sky';
  scene.add(mesh);
  // fundo = cor da névoa (só aparece se algo falhar; a esfera cobre tudo)
  scene.background = new THREE.Color(COLORS.fog);

  return {
    object: mesh,
    update(camera, time) {
      mesh.position.copy(camera.position);
      uniforms.uTime.value = time;
      uniforms.uCamHeight.value = camera.position.y;
    },
  };
}
