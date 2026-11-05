// =====================================================================
//  Céu: esfera invertida enorme que segue a câmera, com gradiente
//  zênite→horizonte, sol com disco e halo, cirros leves e faixa de névoa
//  no horizonte na MESMA cor da FogExp2 (para o oceano fundir sem emenda).
//  Contrato: createSky(scene, {quality}) -> { object, update(camera, time) }
// =====================================================================
import * as THREE from 'three';
import { WORLD, COLORS, SEED } from '../config.js';
import { sunDirection } from './lighting.js';
import { createNoise } from '../util/noise.js';

// Textura de ruído "tileável" (mistura de 4 cópias deslocadas) usada pelos cirros.
function makeCirrusTexture(size) {
  const noise = createNoise(SEED + 9101);
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const f = 3.0 / size; // frequência base (ciclos por tile)
  const sample = (x, y) => noise.fbm2(x * f, y * f * 3.2, 5, 2.1, 0.55); // esticado em Y → filamentos
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // mistura bilinear das 4 cópias para o tile fechar sem costura
      const wx = x / size, wy = y / size;
      const n = sample(x, y) * (1 - wx) * (1 - wy) + sample(x - size, y) * wx * (1 - wy)
        + sample(x - size, y - size) * wx * wy + sample(x, y - size) * (1 - wx) * wy;
      const v = Math.max(0, Math.min(255, Math.round(128 + 128 * n)));
      const i = (y * size + x) * 4;
      img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
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
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uFogSRGB;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uTime;
uniform float uCirrusAmount;
uniform sampler2D uCirrus;
varying vec3 vDir;

void main() {
  #include <logdepthbuf_fragment>
  vec3 d = normalize(vDir);
  float h = d.y;
  float hh = max(h, 0.0);

  // ---- gradiente feito em espaço sRGB (perceptual): pálido no horizonte →
  //      azul profundo saturado no zênite; depois volta para linear
  vec3 hz = pow(uHorizon, vec3(1.0 / 2.2));
  vec3 zn = pow(uZenith, vec3(1.0 / 2.2));
  float t = pow(hh, 0.35);
  vec3 col = mix(hz, zn, t);
  col = mix(col, hz * 1.03, exp(-hh * 40.0) * 0.35); // faixa de haze junto ao horizonte
  col = pow(col, vec3(2.2));

  // ---- sol: disco nítido + halo quente largo (mistura "screen" para saturar em branco)
  float s = max(dot(d, uSunDir), 0.0);
  float disc = smoothstep(0.99930, 0.99972, s);
  float halo = pow(s, 18.0) * 0.10 + pow(s, 150.0) * 0.45 + pow(s, 900.0) * 0.9;
  vec3 sun = clamp(uSunColor * (halo * (0.8 + 0.5 * (1.0 - t)) + disc * 4.0), 0.0, 1.0);
  col = 1.0 - (1.0 - col) * (1.0 - sun);

  // ---- cirros finos (ruído projetado num plano alto, esticado em filamentos)
  if (uCirrusAmount > 0.0 && h > 0.02) {
    vec2 pr = d.xz / (h + 0.09);
    mat2 rot = mat2(0.92, 0.39, -0.39, 0.92);
    vec2 uv = rot * pr;
    float n1 = texture2D(uCirrus, uv * vec2(0.55, 0.11) + vec2(uTime * 0.0006, 0.0)).r;
    float n2 = texture2D(uCirrus, uv * vec2(1.7, 0.33) + vec2(-uTime * 0.0011, 0.17)).r;
    float n = n1 * 0.7 + n2 * 0.3;
    float band = smoothstep(0.03, 0.16, h) * (1.0 - smoothstep(0.42, 0.85, h));
    float cirrus = smoothstep(0.60, 0.84, n) * band * 0.30 * uCirrusAmount;
    col = mix(col, vec3(0.85) + col * 0.2, cirrus);
  }

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // Névoa do horizonte: a mesma cor da FogExp2 (já em sRGB), para que o oceano
  // totalmente enevoado e o céu se encontrem sem emenda. Abaixo do horizonte = névoa.
  float horizonMix = 1.0 - smoothstep(0.0, 0.045, h);
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
    uZenith: { value: new THREE.Color(COLORS.skyZenith) },
    uHorizon: { value: new THREE.Color(COLORS.skyHorizon) },
    uFogSRGB: { value: fogSRGB },
    uSunDir: { value: sunDirection.clone() },
    uSunColor: { value: new THREE.Color(COLORS.sunLight) },
    uTime: { value: 0 },
    uCirrusAmount: { value: quality === 'low' ? 0 : 1 },
    uCirrus: { value: quality === 'low' ? null : makeCirrusTexture(256) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG,
    side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
  });
  // O céu NÃO passa pelo tone mapping (ACES dessatura/escurece o gradiente): as cores
  // de config.js aparecem na tela como foram definidas; o chunk continua incluído.
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
    },
  };
}
