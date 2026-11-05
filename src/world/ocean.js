// =====================================================================
//  Oceano infinito: disco radial (denso perto da câmera) que segue a câmera,
//  com ShaderMaterial em coordenadas de MUNDO (a textura não "nada"):
//  3 camadas de normal em escalas diferentes (mapa de derivadas gerado em
//  canvas, soma de senoides tileável) + 2 ondulações analíticas, Lambert
//  envolvente, especular Blinn do sol (glitter), fresnel para a cor do
//  céu/horizonte, variação de cor por ruído grande e névoa FogExp2.
//  Contrato: createOcean(scene, {quality}) -> { object, update(camera, time) }
// =====================================================================
import * as THREE from 'three';
import { WORLD, COLORS, SEED } from '../config.js';
import { sunDirection } from './lighting.js';
import { createNoise } from '../util/noise.js';
import { createRng } from '../util/rng.js';

// Mapa de derivadas (R = dh/dx, G = dh/dz, remapeados 0..1) de uma soma de
// senoides com números de onda inteiros → tile perfeitamente periódico.
// B recebe um ruído tileável para a variação de cor em grande escala.
function makeWaveTexture(size) {
  const rng = createRng(SEED + 7303);
  const noise = createNoise(SEED + 7304);
  const waves = [];
  const mainDir = rng.range(0, Math.PI * 2);
  for (let i = 0; i < 44; i++) {
    const kmag = 2 + Math.floor(Math.pow(rng(), 1.3) * 30); // 2..31 ciclos por tile
    // metade das ondas segue o "vento", a outra metade é quase isotrópica → sem listras
    const ang = i % 2 === 0 ? mainDir + rng.gauss() * 0.9 : rng.range(0, Math.PI * 2);
    let nx = Math.round(Math.cos(ang) * kmag), nz = Math.round(Math.sin(ang) * kmag);
    if (nx === 0 && nz === 0) nx = 1;
    const k = Math.hypot(nx, nz);
    waves.push({ nx, nz, amp: Math.pow(k, -1.55) * rng.range(0.6, 1.0), phase: rng.range(0, Math.PI * 2) });
  }
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const sx = new Float32Array(size * size), sz = new Float32Array(size * size);
  const fN = 6.0 / size;
  const nN = (x, y) => noise.fbm2(x * fN + 40, y * fN - 40, 4, 2.2, 0.5);
  const tileNoise = (x, y) => { // fbm tileável (mistura de 4 cópias)
    const wx = ((x % size) + size) % size / size, wy = ((y % size) + size) % size / size;
    return nN(x, y) * (1 - wx) * (1 - wy) + nN(x - size, y) * wx * (1 - wy) + nN(x - size, y - size) * wx * wy + nN(x, y - size) * (1 - wx) * wy;
  };
  let maxS = 1e-6;
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      let dx = 0, dz = 0;
      for (const w of waves) {
        const ph = Math.PI * 2 * (w.nx * u + w.nz * v) + w.phase;
        const c = Math.cos(ph) * w.amp * Math.PI * 2;
        dx += c * w.nx; dz += c * w.nz;
      }
      // componente de ruído (derivada numérica de fbm tileável) para quebrar a regularidade
      const e = 1.5;
      dx += (tileNoise(x + e, y) - tileNoise(x - e, y)) * 1.3;
      dz += (tileNoise(x, y + e) - tileNoise(x, y - e)) * 1.3;
      const i = y * size + x;
      sx[i] = dx; sz[i] = dz;
      maxS = Math.max(maxS, Math.abs(dx), Math.abs(dz));
    }
  }
  const f = 2.5 / size;
  const nz2 = (x, y) => noise.fbm2(x * f, y * f, 4, 2, 0.5);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x, o = i * 4;
      img.data[o] = Math.round(127.5 + 127.5 * sx[i] / maxS);
      img.data[o + 1] = Math.round(127.5 + 127.5 * sz[i] / maxS);
      const wx = x / size, wy = y / size; // ruído tileável por mistura de 4 cópias
      const n = nz2(x, y) * (1 - wx) * (1 - wy) + nz2(x - size, y) * wx * (1 - wy)
        + nz2(x - size, y - size) * wx * wy + nz2(x, y - size) * (1 - wx) * wy;
      img.data[o + 2] = Math.max(0, Math.min(255, Math.round(127.5 + 127.5 * n)));
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
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
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uShallow;
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uTime;
uniform sampler2D uWaves;
varying vec3 vWorldPos;

vec2 slopeAt(vec2 uv) { return texture2D(uWaves, uv).rg * 2.0 - 1.0; }

void main() {
  #include <logdepthbuf_fragment>
  vec3 toCam = cameraPosition - vWorldPos;
  float dist = length(toCam);
  vec3 V = toCam / max(dist, 0.001);
  vec2 p = vWorldPos.xz;
  float t = uTime;

  // ---- normal: soma de derivadas de 3 escalas (atenuadas com a distância e em
  //      ângulos rasantes para não cintilar) + 2 ondulações analíticas (dispersão)
  float graze = pow(saturate(V.y), 0.5);
  float fadeFine = graze / (1.0 + dist * (1.0 / 320.0));
  float fadeMed  = graze / (1.0 + dist * (1.0 / 1100.0));
  float fadeBig  = (0.4 + 0.6 * graze) / (1.0 + dist * (1.0 / 9000.0));
  const mat2 rotA  = mat2(0.866, 0.5, -0.5, 0.866);
  const mat2 rotAi = mat2(0.866, -0.5, 0.5, 0.866);
  const mat2 rotB  = mat2(0.342, -0.940, 0.940, 0.342);
  const mat2 rotBi = mat2(0.342, 0.940, -0.940, 0.342);
  // deformação lenta do domínio (quebra a repetição visível dos tiles)
  vec2 warp = (texture2D(uWaves, p * (1.0 / 760.0) + vec2(t * 0.0004, 0.0)).rg - 0.5) * 48.0;
  vec2 pw = p + warp;
  vec2 s = vec2(0.0);
  // ondulações largas e suaves (refs: mar calmo, sem marola picada)
  s += rotBi * slopeAt(rotB * pw * (1.0 / 13.0) + t * vec2(0.05, 0.03)) * 0.016 * fadeFine;   // fino ~13 m
  s += slopeAt(p * (1.0 / 8.3) + t * vec2(-0.03, 0.055)) * 0.008 * fadeFine;                  // fino ~8 m
  s += rotAi * slopeAt(rotA * pw * (1.0 / 36.0) + t * vec2(-0.010, 0.014)) * 0.07 * fadeMed;  // médio ~36 m
  s += rotBi * slopeAt(rotB * p * (1.0 / 110.0) + t * vec2(0.004, 0.003)) * 0.08 * fadeMed;   // médio-largo ~110 m
  s += slopeAt(pw * (1.0 / 320.0) + t * vec2(0.0019, -0.0014)) * 0.065 * fadeBig;             // largo ~320 m
  vec2 d1 = normalize(vec2(0.82, 0.45)), d2 = normalize(vec2(-0.35, 0.92));
  float k1 = PI2 / 70.0, k2 = PI2 / 24.0;
  float w1 = sqrt(9.81 * k1), w2 = sqrt(9.81 * k2);
  s += d1 * (0.55 * k1 * cos(dot(d1, p) * k1 - w1 * t)) * fadeMed;
  s += d2 * (0.10 * k2 * cos(dot(d2, p) * k2 - w2 * t + 1.7)) * fadeFine;
  vec3 N = normalize(vec3(-s.x, 1.0, -s.y));

  float ndl = dot(N, uSunDir);
  vec3 Nf = normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.5)); // normal suavizada para o fresnel
  float ndv = max(dot(Nf, V), 0.0);

  // ---- cor da água: variação lenta em grande escala entre azul profundo e médio
  float big = texture2D(uWaves, p * (1.0 / 2900.0) + vec2(t * 0.00002)).b;
  float big2 = texture2D(uWaves, p * (1.0 / 640.0) - vec2(t * 0.00005, 0.0)).b;
  vec3 water = mix(uDeep, uMid, saturate(big * 0.75 + big2 * 0.35));
  // ondas que olham para a câmera e o sol ficam ligeiramente mais claras (falsa transmissão)
  float facing = saturate(dot(N, normalize(V + uSunDir * 0.6)));
  water = mix(water, uShallow, pow(facing, 6.0) * 0.14);
  water *= 0.74 + 0.28 * saturate(ndl * 0.7 + 0.3); // sombreamento suave (luz difusa de céu)

  // ---- reflexo do céu com fresnel (horizonte pálido, zênite azul)
  vec3 R = reflect(-V, N);
  vec3 sky = mix(uHorizon * 0.80, uZenith * 1.1, pow(saturate(R.y), 0.5));
  float F = 0.03 + 0.30 * pow(1.0 - ndv, 5.0);
  vec3 col = mix(water, sky, F);

  // ---- especular do sol (Blinn normalizado), lobo mais largo à distância
  vec3 H = normalize(uSunDir + V);
  float ndh = max(dot(N, H), 0.0);
  float farness = saturate(dist / 12000.0);
  float shin = mix(240.0, 40.0, farness);
  float fresH = 0.04 + 0.96 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
  // glitter discreto (sem pontos brancos duros) + trilha larga e macia do sol
  float spec = pow(ndh, shin) * (shin + 8.0) / (8.0 * PI) * fresH * 0.16;
  float broad = pow(ndh, 10.0) * 0.06 * fresH;
  col += uSunColor * (spec + broad) * mix(1.0, 0.45, farness);
  // leve dessaturação: o mar das referências é azul-aço, não azul puro
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3(lum), 0.10);

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
      uDeep: { value: new THREE.Color(COLORS.oceanDeep).multiplyScalar(1.05) },
      uMid: { value: new THREE.Color(COLORS.oceanMid).multiplyScalar(1.1) },
      uShallow: { value: new THREE.Color(COLORS.oceanShallow).multiplyScalar(1.05) },
      uHorizon: { value: new THREE.Color(COLORS.skyHorizon) },
      uZenith: { value: new THREE.Color(COLORS.skyZenith) },
      uSunDir: { value: sunDirection.clone() },
      uSunColor: { value: new THREE.Color(COLORS.sunLight) },
      uTime: { value: 0 },
      uWaves: { value: null },
    },
  ]);
  uniforms.uWaves.value = makeWaveTexture(quality === 'low' ? 256 : 512);
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
    },
  };
}
