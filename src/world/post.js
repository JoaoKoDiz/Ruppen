// =====================================================================
//  Pós-processamento barato SEM render target: um quad de tela cheia
//  desenhado por último (renderOrder 1000, depthTest off) que aplica
//  uma vinheta suave e um leve "levantamento dos pretos" (haze) via
//  blending — out = cena × (1 − vinheta) + haze. Não precisa de passes
//  extras nem de mudar o renderer.render. A dessaturação do look fica
//  nas paletas/iluminação (sky, ocean, lighting).
//  Contrato: createPost(scene, camera, {quality}) -> { object, update(camera, time) }
//  Integração (main.js): const post = createPost(scene, camera); … post.update(camera, time) por quadro.
// =====================================================================
import * as THREE from 'three';
import { COLORS } from '../config.js';

export const POST = {
  VIGNETTE: 0.07,     // escurecimento máximo nos cantos (0..1)
  VIGNETTE_START: 0.45, // raio (0..1, do centro ao canto) onde a vinheta começa
  HAZE_LIFT: 0.028,   // fração da cor da névoa somada à imagem inteira (levanta os pretos)
  HAZE_LIFT_EDGE: 0.012, // leve véu extra nas bordas (filmic)
};

const VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0); // já em espaço de recorte: cobre a tela toda
}`;

const FRAG = /* glsl */`
precision highp float;
uniform vec3 uHaze;        // cor do véu (sRGB, já no espaço da tela)
uniform float uVignette;
uniform float uVigStart;
uniform float uLift;
uniform float uLiftEdge;
varying vec2 vUv;
void main() {
  vec2 q = (vUv - 0.5) * vec2(1.15, 1.0);           // elipse levemente mais larga que alta
  float r = length(q) / 0.72;                        // 0 no centro, ~1 no canto
  float v = smoothstep(uVigStart, 1.15, r);
  float dark = uVignette * v;                        // quanto escurecer (alpha → fator (1 − a) na cena)
  vec3 lift = uHaze * (uLift + uLiftEdge * v);
  // blending: ONE × src + (1 − srcAlpha) × dst  ⇒  dst·(1 − dark) + lift
  gl_FragColor = vec4(lift, dark);
}`;

export function createPost(scene, camera, opts = {}) {
  const haze = new THREE.Color(COLORS.fog); // hex já é sRGB (cor de tela): usada direto, sem conversão
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uHaze: { value: new THREE.Vector3(haze.r, haze.g, haze.b) },
      uVignette: { value: POST.VIGNETTE },
      uVigStart: { value: POST.VIGNETTE_START },
      uLift: { value: POST.HAZE_LIFT },
      uLiftEdge: { value: POST.HAZE_LIFT_EDGE },
    },
    vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthTest: false, depthWrite: false, fog: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
  mat.toneMapped = false;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1000; // por último, depois das nuvens (20) e de tudo o que é transparente
  mesh.name = 'postPass';
  scene.add(mesh);
  return {
    object: mesh,
    material: mat,
    update() { /* nada por quadro: o quad é em espaço de recorte e não depende da câmera */ },
  };
}
