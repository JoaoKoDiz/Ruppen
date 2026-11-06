// =====================================================================
//  Pós-processamento (high / ultra) com EffectComposer (vendor/three/addons/postprocessing):
//
//    cena → sceneTarget (MSAA 4×, cor HalfFloat em sRGB de tela + DepthTexture float, log depth)
//         → [passes 'afterScene']
//         → SSAO meia resolução (depth → posição/normal de vista → espiral de amostras) → blur bilateral H+V
//         → aplica AO (upsample bilateral, some com a névoa/perspectiva aérea; céu intocado)
//         → [passes 'beforeGrade']
//         → UnrealBloom (sutil) → grade (curva S, dessaturação, vinheta, haze lift) → SMAA → tela
//    quality=low: sem composer (renderer.render direto no canvas, como sempre).
//
//  Por que um render target "de tela": o céu é desenhado SEM tone mapping (toneMapped=false) e a névoa
//  e o horizonte são casados em sRGB de tela (ARCHITECTURE §2). O three.js só aplica tone mapping e a
//  conversão sRGB por material quando o alvo é a tela ou um XR render target; por isso o sceneTarget é
//  marcado isXRRenderTarget = true com texture.colorSpace = SRGB e internalFormat explícito (RGBA16F,
//  sem codificação sRGB de hardware). Resultado: o sceneTarget recebe exatamente o que o canvas recebia
//  em quality=low, mais um depth legível — e os passes seguintes trabalham na imagem "de tela".
//
//  Depth: o renderer usa logarithmicDepthBuffer (0,5 m a 160 km sem z-fighting). O depth gravado é
//  d = log2(1 + w) / log2(far + 1) (w = −z de vista), então w = exp2(d · log2(far + 1)) − 1 (POST_DEPTH_GLSL).
//  Céu: d ≥ 0,99995 (o domo não grava depth; o clear é 1).
//
//  Contrato: createPost(renderer, scene, camera, { quality, ao = true, debug = 0 }) → {
//    render(), setSize(), update(), dispose(),
//    composer | null, bloom | null, grade | null, smaa | null, quality,
//    sceneTarget   : WebGLRenderTarget | null — cor da cena (sRGB de tela) + .depthTexture
//    depthTexture  : DepthTexture | null      — depth logarítmico da cena (resolvido do MSAA), mesmo objeto após resize
//    depthUniforms : { tDepth, uLog2Far1, uProj, uCamWorld, uCamPos, uResolution } — objetos de uniform COMPARTILHADOS
//                    (atualizados por quadro; use-os por referência: uniforms: { ...post.depthUniforms, meus… })
//    glsl          : { depth: POST_DEPTH_GLSL, aerial: AERIAL_GLSL }
//    addPass(pass, where = 'beforeGrade') → pass | null
//        'afterScene' : pass.render(renderer, sceneTarget, sceneTarget, dt) logo após a cena, ANTES da AO.
//                       Desenhe por cima do sceneTarget com blending (ele tem o depth MSAA da cena ligado:
//                       depthTest funciona; inclua os chunks de log depth). post.depthTexture pode ser lido.
//        'beforeGrade': pass de composer normal (readBuffer = cena com AO, writeBuffer; needsSwap), DEPOIS da AO
//                       e antes do bloom/grade. Recomendado para nuvens volumétricas (a AO não as escurece).
//        número       : índice cru em composer.passes.
//    removePass(pass), setAO(bool), setDebug(0 | 1 = AO crua | 2 = AO aplicada × visibilidade)
//  }
//  renderer.info.autoReset = false: render() zera as estatísticas uma vez por quadro
//  (o composer chama renderer.render várias vezes) → __stats() conta cena + sombra + pós.
// =====================================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { COLORS, RENDER } from '../config.js';
import { AERIAL_GLSL } from './lighting.js';

const SKY_DEPTH = '0.99995';

// Funções de depth compartilhadas (uniforms: tDepth, uLog2Far1, uProj, uNearFar).
// #define POST_PERSPECTIVE_DEPTH para depth perspectivo comum (renderer sem log depth).
export const POST_DEPTH_GLSL = /* glsl */`
uniform sampler2D tDepth;
uniform float uLog2Far1;   // log2(far + 1)
uniform vec4 uProj;        // projectionMatrix.elements[0], [5], [8], [9]
uniform vec2 uNearFar;
float postDepthRaw(vec2 uv) { return texture2D(tDepth, uv).x; }
bool postIsSky(float d) { return d >= ${SKY_DEPTH}; }
// w = distância ao longo do eixo da câmera (−z de vista), em metros
float postViewW(float d) {
#ifdef POST_PERSPECTIVE_DEPTH
  float z = d * 2.0 - 1.0;
  return 2.0 * uNearFar.x * uNearFar.y / (uNearFar.y + uNearFar.x - z * (uNearFar.y - uNearFar.x));
#else
  return exp2(d * uLog2Far1) - 1.0;
#endif
}
vec3 postViewPos(vec2 uv, float w) {
  vec2 ndc = uv * 2.0 - 1.0;
  return vec3((ndc.x + uProj.z) * w / uProj.x, (ndc.y + uProj.w) * w / uProj.y, -w);
}
`;

const QUAD_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// ---- SSAO (meia resolução). Saída: r = AO (1 = livre), g = w em km (para o blur/upsample bilaterais; céu = 999)
const AO_FRAG = /* glsl */`
${POST_DEPTH_GLSL}
uniform vec2 uTexel;      // 1 / tamanho do depth (resolução cheia)
uniform vec2 uResolution; // tamanho do depth em px
uniform float uRadiusNear, uRadiusNearDist, uRadiusExp, uRadiusMin, uRadiusMax, uLargeK, uMaxPx, uMinPx, uIntensity, uIntensityLarge, uBias, uPower;
uniform vec2 uFade;
varying vec2 vUv;
// amostras sempre no centro do texel do depth: a posição reconstruída casa exatamente com o depth lido
// (senão, em paredes rasantes, o meio texel de erro vira ruído de auto-oclusão)
vec2 snapUv(vec2 uv) { return (floor(uv * uResolution) + 0.5) * uTexel; }
vec3 posAt(vec2 uv) { uv = snapUv(uv); return postViewPos(uv, postViewW(postDepthRaw(uv))); }
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  vec2 uv0 = snapUv(vUv);
  float d = postDepthRaw(uv0);
  if (postIsSky(d)) { gl_FragColor = vec4(1.0, 999.0, 0.0, 1.0); return; }
  float w = postViewW(d);
  vec3 P = postViewPos(uv0, w);
  // normal pelas derivadas do depth, escolhendo de cada lado o vizinho mais próximo em profundidade (sem borda falsa)
  vec3 pl = posAt(uv0 - vec2(uTexel.x, 0.0)), pr = posAt(uv0 + vec2(uTexel.x, 0.0));
  vec3 pd = posAt(uv0 - vec2(0.0, uTexel.y)), pu = posAt(uv0 + vec2(0.0, uTexel.y));
  vec3 dx = abs(pr.z - P.z) < abs(P.z - pl.z) ? pr - P : P - pl;
  vec3 dy = abs(pu.z - P.z) < abs(P.z - pd.z) ? pu - P : P - pd;
  vec3 N = normalize(cross(dx, dy));
  // Duas escalas (metade das amostras cada):
  //  • fina  — raio no mundo R = NEAR·(w/NEAR_DIST)^EXP (≈ 2 m a 10 m, 20 m a 1,2 km, 40 m a 5 km): contato, frestas, entre casas;
  //  • larga — raio constante na tela (LARGE_K·w): volumes grandes (sob a orelha, dobras, sob as presas, pernas na espuma).
  float pxPerM = uProj.y * 0.5 * uResolution.y / w;
  float maxPx = uMaxPx * uResolution.y;
  float Rs = clamp(uRadiusNear * pow(w / uRadiusNearDist, uRadiusExp), uRadiusMin, uRadiusMax);
  float RsPx = min(Rs * pxPerM, maxPx);
  float RlPx = min(w * uLargeK * pxPerM, maxPx);
  if (RlPx < uMinPx) { gl_FragColor = vec4(1.0, w * 0.001, 0.0, 1.0); return; }
  float n1 = ign(gl_FragCoord.xy) * 6.2831853;
  float n2 = ign(gl_FragCoord.yx + vec2(17.0, 5.0));
  float occS = 0.0, occL = 0.0;
  const int HALF = AO_SAMPLES / 2;
  for (int i = 0; i < AO_SAMPLES; i++) {
    bool large = i >= HALF;
    float rpx = large ? RlPx : RsPx;
    float R = rpx / pxPerM;
    float t = (float(large ? i - HALF : i) + n2) / float(HALF);
    float a = float(i) * 2.3999632 + n1;                // espiral de ângulo áureo
    vec2 suv = uv0 + vec2(cos(a), sin(a)) * (rpx * t) * uTexel;
    if (suv.x < 0.0 || suv.y < 0.0 || suv.x > 1.0 || suv.y > 1.0 || rpx < uMinPx) continue;
    vec3 v = posAt(suv) - P;
    float vv = dot(v, v);
    float f = max(0.0, 1.0 - vv / (R * R));             // fora do raio (fundo distante, céu) não oclui: sem halos
    float o = max(0.0, dot(v, N) * inversesqrt(vv + 1e-4 * R * R) - uBias) * f;
    if (large) occL += o; else occS += o;
  }
  float ao = clamp(1.0 - (uIntensity * occS + uIntensityLarge * occL) / float(HALF), 0.0, 1.0);
  ao = pow(ao, uPower);
  ao = mix(ao, 1.0, smoothstep(uFade.x, uFade.y, w));
  gl_FragColor = vec4(ao, w * 0.001, 0.0, 1.0);
}`;

// ---- blur bilateral separável (9 taps gaussianos, peso pela diferença relativa de profundidade)
const BLUR_FRAG = /* glsl */`
uniform sampler2D tAO;
uniform vec2 uStep;
uniform float uSharp;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tAO, vUv);
  float w0 = c.g;
  if (w0 > 900.0) { gl_FragColor = c; return; }
  float G[5]; G[0] = 0.2270270; G[1] = 0.1945946; G[2] = 0.1216216; G[3] = 0.0540541; G[4] = 0.0162162;
  float sum = c.r * G[0], ws = G[0];
  float tol = 1.0 / (w0 * uSharp + 1e-6);
  for (int i = 1; i < 5; i++) {
    for (int s = -1; s <= 1; s += 2) {
      vec4 t = texture2D(tAO, vUv + uStep * float(i * s));
      float bw = G[i] * max(0.0, 1.0 - abs(t.g - w0) * tol);
      sum += t.r * bw; ws += bw;
    }
  }
  gl_FragColor = vec4(sum / ws, w0, 0.0, 1.0);
}`;

// ---- aplica a AO na cor da cena (resolução cheia): upsample bilateral, peso pela visibilidade através do haze
const APPLY_FRAG = /* glsl */`
${POST_DEPTH_GLSL}
${AERIAL_GLSL}
uniform sampler2D tColor;
uniform sampler2D tAO;
uniform vec2 uAOSize;
uniform float uStrength, uFogDensity, uAOOn;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform int uDebug;
varying vec2 vUv;
void main() {
  vec4 col = texture2D(tColor, vUv);
  float d = postDepthRaw(vUv);
  if (uAOOn < 0.5 || postIsSky(d)) { if (uDebug > 0) col.rgb = vec3(1.0); gl_FragColor = col; return; }
  float w = postViewW(d);
  float wk = w * 0.001;
  vec2 hp = vUv * uAOSize - 0.5;
  vec2 b = floor(hp), f = hp - b;
  float sum = 0.0, ws = 0.0;
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    vec4 s = texture2D(tAO, (b + vec2(float(i), float(j)) + 0.5) / uAOSize);
    float bil = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
    float bw = bil * max(1e-3, 1.0 - abs(s.g - wk) / (wk * 0.08 + 1e-6));
    sum += s.r * bw; ws += bw;
  }
  float ao = sum / ws;
  // visibilidade da superfície através da perspectiva aérea + FogExp2: a AO não escurece o haze
  vec3 off = mat3(uCamWorld) * postViewPos(vUv, w);
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * w * w);
  float vis = ruppenAerialT(off, uCamPos.y).g * (1.0 - fogF);
  float l = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722));
  float k = uStrength * vis * mix(1.0, 0.75, smoothstep(0.6, 1.0, l)); // ~só a parte indireta: o que está ao sol pleno perde menos
  if (uDebug == 1) { gl_FragColor = vec4(vec3(ao), 1.0); return; }
  if (uDebug == 2) { gl_FragColor = vec4(vec3(mix(1.0, ao, k)), 1.0); return; }
  col.rgb *= mix(1.0, ao, k);
  gl_FragColor = col;
}`;

// ---- passe 1: renderiza a cena no sceneTarget e roda os passes 'afterScene'
class ScenePass extends Pass {
  constructor(scene, camera, target, hooks) {
    super();
    this.scene = scene; this.camera = camera; this.target = target; this.hooks = hooks;
    this.needsSwap = false;
  }
  setSize(w, h) { this.target.setSize(w, h); for (const p of this.hooks) p.setSize?.(w, h); }
  render(renderer, writeBuffer, readBuffer, deltaTime) {
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera); // autoClear limpa cor + depth
    for (const p of this.hooks) if (p.enabled !== false) p.render(renderer, this.target, this.target, deltaTime, false);
  }
}

// ---- passe 2: SSAO em meia resolução + blur bilateral (não toca read/write buffers)
class AOPass extends Pass {
  constructor(depthUniforms, cfg, perspectiveDepth) {
    super();
    this.needsSwap = false;
    this.scale = cfg.scale;
    const A = RENDER.AO;
    const mk = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
    this.rtA = mk(); this.rtB = mk();
    this.rtA.texture.name = 'post.ao'; this.rtB.texture.name = 'post.aoBlur';
    const defines = { AO_SAMPLES: cfg.samples };
    if (perspectiveDepth) defines.POST_PERSPECTIVE_DEPTH = 1;
    this.aoMat = new THREE.ShaderMaterial({
      name: 'post.ssao', defines, vertexShader: QUAD_VERT, fragmentShader: AO_FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        ...depthUniforms,
        uTexel: { value: new THREE.Vector2() },
        uRadiusNear: { value: A.RADIUS_NEAR }, uRadiusNearDist: { value: A.RADIUS_NEAR_DIST }, uRadiusExp: { value: A.RADIUS_EXP },
        uRadiusMin: { value: A.RADIUS_MIN }, uRadiusMax: { value: A.RADIUS_MAX }, uLargeK: { value: A.LARGE_K },
        uMaxPx: { value: A.MAX_PX }, uMinPx: { value: A.MIN_PX }, uIntensity: { value: A.INTENSITY }, uIntensityLarge: { value: A.INTENSITY_LARGE },
        uBias: { value: A.BIAS }, uPower: { value: A.POWER }, uFade: { value: new THREE.Vector2(A.FADE[0], A.FADE[1]) },
      },
    });
    this.blurMat = new THREE.ShaderMaterial({
      name: 'post.aoBlur', vertexShader: QUAD_VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tAO: { value: null }, uStep: { value: new THREE.Vector2() }, uSharp: { value: A.BLUR_SHARP } },
    });
    this.quadAO = new FullScreenQuad(this.aoMat);
    this.quadBlur = new FullScreenQuad(this.blurMat);
    this.size = new THREE.Vector2(1, 1);
  }
  get texture() { return this.rtA.texture; } // resultado final (após H+V) fica em rtA
  setSize(w, h) {
    const aw = Math.max(1, Math.round(w * this.scale)), ah = Math.max(1, Math.round(h * this.scale));
    this.size.set(aw, ah);
    this.rtA.setSize(aw, ah); this.rtB.setSize(aw, ah);
    this.aoMat.uniforms.uTexel.value.set(1 / w, 1 / h);
  }
  render(renderer) {
    renderer.setRenderTarget(this.rtA); this.quadAO.render(renderer);
    this.blurMat.uniforms.tAO.value = this.rtA.texture; this.blurMat.uniforms.uStep.value.set(1 / this.size.x, 0);
    renderer.setRenderTarget(this.rtB); this.quadBlur.render(renderer);
    this.blurMat.uniforms.tAO.value = this.rtB.texture; this.blurMat.uniforms.uStep.value.set(0, 1 / this.size.y);
    renderer.setRenderTarget(this.rtA); this.quadBlur.render(renderer);
  }
  dispose() { this.rtA.dispose(); this.rtB.dispose(); this.aoMat.dispose(); this.blurMat.dispose(); this.quadAO.dispose(); this.quadBlur.dispose(); }
}

// ---- passe 3: cor da cena × AO → writeBuffer (entra na cadeia do composer)
class AOApplyPass extends Pass {
  constructor(sceneTarget, aoPass, depthUniforms, perspectiveDepth) {
    super();
    this.aoPass = aoPass;
    this.material = new THREE.ShaderMaterial({
      name: 'post.aoApply', defines: perspectiveDepth ? { POST_PERSPECTIVE_DEPTH: 1 } : {},
      vertexShader: QUAD_VERT, fragmentShader: APPLY_FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        ...depthUniforms,
        tColor: { value: sceneTarget.texture },
        tAO: { value: aoPass.texture },
        uAOSize: { value: aoPass.size },
        uStrength: { value: RENDER.AO.STRENGTH },
        uFogDensity: { value: 0 },
        uAOOn: { value: 1 },
        uDebug: { value: 0 },
      },
    });
    this.quad = new FullScreenQuad(this.material);
  }
  render(renderer, writeBuffer) {
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  dispose() { this.material.dispose(); this.quad.dispose(); }
}

// ---- grade final: curva S + dessaturação + vinheta + haze lift (entrada já em sRGB de tela)
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
      quality, composer: null, bloom: null, grade: null, smaa: null, sceneTarget: null, depthTexture: null, depthUniforms: null,
      glsl: { depth: POST_DEPTH_GLSL, aerial: AERIAL_GLSL },
      render() { renderer.info.reset(); renderer.render(scene, camera); },
      setSize() {}, update() {}, addPass() { return null; }, removePass() {}, setAO() {}, setDebug() {}, dispose() {},
    };
  }

  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const perspectiveDepth = !renderer.capabilities.logarithmicDepthBuffer;
  const floatColor = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
  const samples = Math.min(RENDER.MSAA, renderer.capabilities.maxSamples || 0);

  // ---- render target da cena: cor "de tela" + depth float (log)
  const depthTexture = new THREE.DepthTexture(size.x, size.y, THREE.FloatType);
  depthTexture.name = 'post.depth';
  const sceneTarget = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: floatColor ? THREE.HalfFloatType : THREE.UnsignedByteType,
    format: THREE.RGBAFormat, colorSpace: THREE.SRGBColorSpace,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
    depthBuffer: true, stencilBuffer: false, samples, depthTexture,
  });
  sceneTarget.texture.name = 'post.scene';
  sceneTarget.texture.internalFormat = floatColor ? 'RGBA16F' : 'RGBA8'; // valores já codificados em sRGB pelo shader: sem SRGB8 de hardware
  sceneTarget.isXRRenderTarget = true; // → tone mapping + sRGB por material, como na tela (ver cabeçalho)

  const depthUniforms = {
    tDepth: { value: depthTexture },
    uLog2Far1: { value: Math.log2(camera.far + 1) },
    uProj: { value: new THREE.Vector4() },
    uNearFar: { value: new THREE.Vector2(camera.near, camera.far) },
    uCamWorld: { value: new THREE.Matrix4() },
    uCamPos: { value: new THREE.Vector3() },
    uResolution: { value: new THREE.Vector2(size.x, size.y) },
  };

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(1); // trabalhamos no tamanho do drawing buffer (já inclui o pixel ratio)
  composer.setSize(size.x, size.y);

  const afterScene = [];
  const scenePass = new ScenePass(scene, camera, sceneTarget, afterScene);
  composer.addPass(scenePass);

  const aoCfg = RENDER.AO[quality] || RENDER.AO.high;
  const aoPass = new AOPass(depthUniforms, aoCfg, perspectiveDepth);
  composer.addPass(aoPass);
  const apply = new AOApplyPass(sceneTarget, aoPass, depthUniforms, perspectiveDepth);
  composer.addPass(apply);
  const setAO = (on) => { aoPass.enabled = !!on; apply.material.uniforms.uAOOn.value = on ? 1 : 0; };
  setAO(opts.ao !== false);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), RENDER.BLOOM.strength, RENDER.BLOOM.radius, RENDER.BLOOM.threshold);
  composer.addPass(bloom);

  const grade = new ShaderPass(GradeShader);
  { const c = new THREE.Color().setHex(COLORS.fog, THREE.LinearSRGBColorSpace); grade.uniforms.uHaze.value.set(c.r, c.g, c.b); } // valores crus do hex = sRGB de tela (sem a conversão do ColorManagement)
  composer.addPass(grade);

  const smaa = new SMAAPass();
  composer.addPass(smaa);

  apply.material.uniforms.uDebug.value = opts.debug | 0;
  if (opts.debug) bloom.enabled = false;

  function setSize() {
    renderer.getDrawingBufferSize(size);
    composer.setSize(size.x, size.y);
    depthUniforms.uResolution.value.set(size.x, size.y);
  }
  setSize();

  function updateCameraUniforms() {
    camera.updateMatrixWorld();
    const e = camera.projectionMatrix.elements;
    depthUniforms.uProj.value.set(e[0], e[5], e[8], e[9]);
    depthUniforms.uLog2Far1.value = Math.log2(camera.far + 1);
    depthUniforms.uNearFar.value.set(camera.near, camera.far);
    depthUniforms.uCamWorld.value.copy(camera.matrixWorld);
    depthUniforms.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    apply.material.uniforms.uFogDensity.value = scene.fog?.isFogExp2 ? scene.fog.density : 0;
  }

  return {
    quality, composer, bloom, grade, smaa, sceneTarget, depthTexture, depthUniforms,
    ao: aoPass, aoApply: apply,
    glsl: { depth: POST_DEPTH_GLSL, aerial: AERIAL_GLSL },
    render() {
      renderer.info.reset();
      updateCameraUniforms();
      composer.render();
    },
    setSize,
    update() { /* nada por quadro: as uniforms de câmera são atualizadas em render() */ },
    addPass(pass, where = 'beforeGrade') {
      if (where === 'afterScene') { afterScene.push(pass); pass.setSize?.(size.x, size.y); return pass; }
      const index = typeof where === 'number' ? where : composer.passes.indexOf(bloom);
      composer.insertPass(pass, index);
      return pass;
    },
    removePass(pass) {
      const i = afterScene.indexOf(pass);
      if (i >= 0) afterScene.splice(i, 1); else composer.removePass(pass);
    },
    setAO,
    setDebug(mode) { apply.material.uniforms.uDebug.value = mode | 0; bloom.enabled = !mode; },
    dispose() { composer.dispose(); sceneTarget.dispose(); depthTexture.dispose(); aoPass.dispose(); apply.dispose(); smaa.dispose(); },
  };
}
