// =====================================================================
//  Pós-processamento com EffectComposer (vendor/three/addons/postprocessing):
//
//    captura da cena → UnrealBloom (sutil) → grade final (vinheta, haze lift,
//    curva S fílmica, 6% dessaturação) → tela                (high / ultra)
//    quality=low: sem composer (renderer.render direto).
//
//  Por que "captura" e não RenderPass … OutputPass: o céu é desenhado SEM tone
//  mapping (toneMapped=false) e a névoa/horizonte são casados em sRGB de tela
//  (ARCHITECTURE §2). Num pipeline linear (RenderPass num render target + OutputPass)
//  o three.js desliga o tone mapping/sRGB por material, o céu seria tone-mapeado
//  no OutputPass e a névoa misturada em linear — a emenda céu/oceano quebraria.
//  Então a cena é renderizada na tela exatamente como no modo low (MSAA do canvas,
//  ACES + sRGB por material), copiada para uma textura (copyFramebufferToTexture)
//  e os passes trabalham nessa imagem já "de tela" (display-referred); o último
//  passe (grade) escreve na tela e faz o papel do OutputPass.
//
//  Oclusão ambiente (GTAO/SAO) NÃO é usada: testada com logarithmicDepthBuffer
//  (reconstrução de posição corrigida para log depth), o AO saiu nulo no elefante
//  (escala de km) e preto no oceano, custando +1 render completo da cena.
//
//  Contrato: createPost(renderer, scene, camera, { quality }) ->
//    { render(), setSize(), composer | null, bloom | null, grade | null }
//  renderer.info.autoReset = false: render() zera as estatísticas uma vez por quadro
//  (o composer chama renderer.render várias vezes) → __stats() conta cena + sombra + pós.
// =====================================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
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

export function createPost(renderer, scene, camera, opts = {}) {
  const quality = ['low', 'high', 'ultra'].includes(opts.quality) ? opts.quality : 'high';
  renderer.info.autoReset = false; // o composer chama renderer.render várias vezes: zeramos nós, uma vez por quadro

  if (quality === 'low') {
    return {
      composer: null, bloom: null, grade: null,
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

  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), RENDER.BLOOM.strength, RENDER.BLOOM.radius, RENDER.BLOOM.threshold);
  composer.addPass(bloom);

  const grade = new ShaderPass(GradeShader);
  { const c = new THREE.Color().setHex(COLORS.fog, THREE.LinearSRGBColorSpace); grade.uniforms.uHaze.value.set(c.r, c.g, c.b); } // valores crus do hex = sRGB de tela (sem a conversão do ColorManagement)
  composer.addPass(grade);

  function setSize() {
    renderer.getDrawingBufferSize(size);
    composer.setSize(size.x, size.y);
  }

  return {
    composer, bloom, grade, capture,
    render() {
      renderer.info.reset();
      composer.render();
    },
    setSize,
    update() { /* nada por quadro */ },
    dispose() { composer.dispose(); capture.dispose(); },
  };
}
