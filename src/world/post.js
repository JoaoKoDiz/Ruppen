// =====================================================================
//  Pós-processamento com EffectComposer (vendor/three/addons/postprocessing):
//
//    captura da cena → [ultra: GTAO] → UnrealBloom (sutil) → grade final (vinheta,
//    haze lift, curva S fílmica, 6% dessaturação) → tela
//
//  Por que "captura" e não RenderPass + OutputPass: o céu é desenhado SEM tone
//  mapping (toneMapped=false) e a névoa/horizonte são casados em sRGB de tela
//  (ARCHITECTURE §2). Num pipeline linear + OutputPass o céu seria tone-mapeado
//  de novo e a emenda céu/oceano quebraria. Então a cena é renderizada na tela
//  exatamente como antes (MSAA, ACES + sRGB por material), copiada para uma
//  textura (renderer.copyFramebufferToTexture) e os passes trabalham nessa
//  imagem já "de tela" (display-referred). O último passe desenha na tela.
//  quality=low: sem composer (renderer.render direto).
//
//  Contrato: createPost(renderer, scene, camera, { quality }) ->
//    { render(), setSize(), composer | null, bloom | null, grade | null, ao | null, update() }
// =====================================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { CopyShader } from 'three/addons/shaders/CopyShader.js';
import { COLORS, RENDER } from '../config.js';

// ---- passe 1: renderiza a cena na tela e copia o framebuffer para o composer
class SceneCapturePass extends Pass {
  constructor(scene, camera) {
    super();
    this.scene = scene; this.camera = camera;
    this.needsSwap = true;
    this.texture = new THREE.FramebufferTexture(2, 2);
    this.material = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(CopyShader.uniforms), vertexShader: CopyShader.vertexShader, fragmentShader: CopyShader.fragmentShader, depthTest: false, depthWrite: false });
    this.material.uniforms.tDiffuse.value = this.texture;
    this.quad = new FullScreenQuad(this.material);
  }
  setSize(w, h) {
    if (this.texture.image.width === w && this.texture.image.height === h) return;
    this.texture.dispose();
    this.texture = new THREE.FramebufferTexture(w, h);
    this.material.uniforms.tDiffuse.value = this.texture;
  }
  render(renderer, writeBuffer) {
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
    renderer.copyFramebufferToTexture(this.texture);
    renderer.setRenderTarget(writeBuffer);
    renderer.clear();
    this.quad.render(renderer);
  }
  dispose() { this.texture.dispose(); this.material.dispose(); this.quad.dispose(); }
}

// ---- passe final: vinheta + haze lift + curva S + dessaturação (entrada já em sRGB de tela)
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uHaze: { value: new THREE.Vector3() },
    uVignette: { value: RENDER.GRADE.vignette },
    uVigStart: { value: RENDER.GRADE.vignetteStart },
    uLift: { value: RENDER.GRADE.hazeLift },
    uLiftEdge: { value: RENDER.GRADE.hazeLiftEdge },
    uContrast: { value: RENDER.GRADE.contrast },
    uDesat: { value: RENDER.GRADE.desaturate },
  },
  vertexShader: /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
precision highp float;
uniform sampler2D tDiffuse;
uniform vec3 uHaze;
uniform float uVignette, uVigStart, uLift, uLiftEdge, uContrast, uDesat;
varying vec2 vUv;
void main() {
  vec3 c = clamp(texture2D(tDiffuse, vUv).rgb, 0.0, 1.0);
  // curva S fílmica suave em torno do cinza médio (contraste "de filme", sem estourar)
  vec3 s = c * c * (3.0 - 2.0 * c);
  c = mix(c, s, uContrast);
  // leve dessaturação (look limpo das referências)
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(c, vec3(l), uDesat);
  // vinheta elíptica + véu de névoa (levanta os pretos, mais nas bordas)
  vec2 q = (vUv - 0.5) * vec2(1.15, 1.0);
  float r = length(q) / 0.72;
  float v = smoothstep(uVigStart, 1.15, r);
  c = c * (1.0 - uVignette * v) + uHaze * (uLift + uLiftEdge * v);
  gl_FragColor = vec4(c, 1.0);
}`,
};

// ---- GTAO com logarithmicDepthBuffer: a textura de profundidade guarda
//      log2(1 + w) / log2(far + 1) (gl_FragDepth do chunk logdepthbuf), não z/w.
//      Reconstruímos a posição de vista a partir disso (raio pelo plano far × w / w_far).
const LOG_DEPTH_VIEWPOS = /* glsl */`
		vec3 getViewPosition( const in vec2 screenPosition, const in float depth ) {
			float w = exp2( depth * log2( cameraFar + 1.0 ) ) - 1.0;      // -viewZ
			vec4 fp = cameraProjectionMatrixInverse * vec4( screenPosition * 2.0 - 1.0, 1.0, 1.0 );
			fp.xyz /= fp.w;
			return fp.xyz * ( w / max( -fp.z, 1e-6 ) );
		}`;
function patchLogDepth(material) {
  const re = /vec3 getViewPosition\( const in vec2 screenPosition, const in float depth \) \{[\s\S]*?\n\t\t\}/;
  let src = material.fragmentShader;
  if (!re.test(src)) { console.warn('[post] GTAO: getViewPosition não encontrado — AO sem correção de log depth'); return; }
  src = src.replace(re, LOG_DEPTH_VIEWPOS);
  src = src.replace(/return perspectiveDepthToViewZ\(depth, cameraNear, cameraFar\);/, 'return -( exp2( depth * log2( cameraFar + 1.0 ) ) - 1.0 );');
  if (!/uniform float cameraFar;/.test(src)) src = src.replace('uniform mat4 cameraProjectionMatrixInverse;', 'uniform mat4 cameraProjectionMatrixInverse;\n\t\tuniform float cameraFar;');
  if (!material.uniforms.cameraFar) material.uniforms.cameraFar = { value: 1 };
  material.fragmentShader = src;
  material.needsUpdate = true;
}

export function createPost(renderer, scene, camera, opts = {}) {
  const quality = opts.quality || 'high';
  renderer.info.autoReset = false; // o composer chama renderer.render várias vezes: zeramos nós, uma vez por quadro

  if (quality === 'low') {
    return {
      composer: null, bloom: null, grade: null, ao: null,
      render() { renderer.info.reset(); renderer.render(scene, camera); },
      setSize() {},
      update() {},
    };
  }

  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(1); // trabalhamos no tamanho do drawing buffer (já inclui o pixel ratio)
  composer.setSize(size.x, size.y);

  const capture = new SceneCapturePass(scene, camera);
  composer.addPass(capture);

  let ao = null;
  if (quality === 'ultra') {
    ao = new GTAOPass(scene, camera, size.x, size.y);
    ao.output = GTAOPass.OUTPUT.Default;
    ao.blendIntensity = RENDER.AO.blendIntensity;
    const { blendIntensity, ...aoParams } = RENDER.AO;
    ao.updateGtaoMaterial({ ...aoParams, screenSpaceRadius: false });
    ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, radiusExponent: 1, rings: 2, samples: 16 });
    patchLogDepth(ao.gtaoMaterial);
    patchLogDepth(ao.pdMaterial);
    // Além de Points/Lines, esconde na passada de normais os billboards/véus (nuvens, espuma, água rasa)
    const origOverride = ao._overrideVisibility.bind(ao);
    ao._overrideVisibility = function () {
      origOverride();
      scene.traverse((o) => {
        if (!o.visible || !(o.isMesh || o.isSprite)) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        if (o.isSprite || o.userData?.noShadow || mats.some((m) => m && m.transparent && !m.depthWrite)) { o.visible = false; this._visibilityCache.push(o); }
      });
    };
    composer.addPass(ao);
  }

  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), RENDER.BLOOM.strength, RENDER.BLOOM.radius, RENDER.BLOOM.threshold);
  composer.addPass(bloom);

  const grade = new ShaderPass(GradeShader);
  { const c = new THREE.Color(COLORS.fog); grade.uniforms.uHaze.value.set(c.r, c.g, c.b); } // hex já é sRGB de tela
  composer.addPass(grade);

  function setSize() {
    renderer.getDrawingBufferSize(size);
    composer.setSize(size.x, size.y);
  }

  return {
    composer, bloom, grade, ao, capture,
    render() {
      renderer.info.reset();
      composer.render();
    },
    setSize,
    update() { /* nada por quadro */ },
    dispose() { composer.dispose(); capture.dispose(); },
  };
}
