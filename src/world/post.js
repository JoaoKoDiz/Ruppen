// =====================================================================
//  Pós-processamento (high / ultra) com EffectComposer (vendor/three/addons/postprocessing):
//
//    cena → sceneTarget (MSAA 4×, cor HalfFloat em sRGB de tela + DepthTexture float, log depth)
//         → [passes 'afterScene']
//         → SSAO meia resolução (depth → posição/normal de vista → espiral de amostras) → blur bilateral H+V
//         → aplica AO (upsample bilateral, some com a névoa/perspectiva aérea; céu intocado)
//         → [passes 'beforeGrade'] (nuvens volumétricas)
//         → CinePass (RENDER.CINE): raios de sol (máscara meia res. + borrão radial), motion blur da câmera
//           (reprojeção pela view-projection anterior), exposição automática (log-luminância 128×64 + mipmaps →
//           adaptação 1×1 na GPU, sem readback)
//         → UnrealBloom (sutil) → grade (aberração cromática, curva S, dessaturação, halo/fantasmas/véu do sol,
//           vinheta, haze lift, grão) → SMAA → tela
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
//  Contrato: createPost(renderer, scene, camera, { quality, ao = true, debug = 0, msaa = RENDER.MSAA }) → {
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
//    removePass(pass), setAO(bool), setDebug(0 | 1 = AO crua | 2 = AO aplicada × visibilidade | 3 = raios de sol)
//    update(camera, time, dt)  — por tick: acumula o dt SIMULADO até o próximo render() (motion blur, adaptação)
//    cine          : CinePass;  setCine({ godrays, flare, mblur, grain, ca, autoexp }) liga/desliga em tempo real;
//    getCine()     : flags + sol na tela + o que rodou no último quadro;  readExposure() → { ev, logAvg, target }
//                    (sincroniza a GPU: só depuração).  opts.cine = { ...flags } na criação.
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
import { AERIAL_GLSL, sunDirection } from './lighting.js';

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
uniform float uRadiusNear, uRadiusNearDist, uRadiusExp, uRadiusMin, uRadiusMax, uLargeK, uRadiusMaxLarge, uMaxPx, uMinPx, uIntensity, uIntensityLarge, uBias, uPower;
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
  //  • larga — raio constante na tela (LARGE_K·w, até RADIUS_MAX_LARGE m): volumes grandes (sob a orelha, dobras, sob as
  //    presas, pernas na espuma). O BIAS (cosseno mínimo) ignora diedros rasos: sem rede escura nas arestas de
  //    triângulos grandes do terreno.
  float pxPerM = uProj.y * 0.5 * uResolution.y / w;
  float maxPx = uMaxPx * uResolution.y;
  float Rs = clamp(uRadiusNear * pow(w / uRadiusNearDist, uRadiusExp), uRadiusMin, uRadiusMax);
  float RsPx = min(Rs * pxPerM, maxPx);
  float RlPx = min(min(w * uLargeK, uRadiusMaxLarge) * pxPerM, maxPx);
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
  if (uAOOn < 0.5 || postIsSky(d)) { if (uDebug == 1 || uDebug == 2) col.rgb = vec3(1.0); gl_FragColor = col; return; }
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
        uRadiusMin: { value: A.RADIUS_MIN }, uRadiusMax: { value: A.RADIUS_MAX }, uLargeK: { value: A.LARGE_K }, uRadiusMaxLarge: { value: A.RADIUS_MAX_LARGE },
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

// =====================================================================
//  Realismo de câmera (RENDER.CINE): raios de sol, motion blur, exposição automática (CinePass, antes do bloom)
//  e lente/filme (no grade). Tudo em sRGB "de tela" (o tone mapping ACES já foi feito pelos materiais).
// =====================================================================
const CINE = RENDER.CINE;
const IGN_GLSL = /* glsl */`
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }`;

// "Ar aceso" na direção do pixel: só o que fica ENTRE o sol e o ar faz sombra. Céu, o mar (y ≈ 0: está abaixo do ar,
// não bloqueia o sol), geometria muito distante (some no haze) e coisas muito próximas (a pomba: volume de sombra
// desprezível) contam como acesos; elefantes, ilhas e nuvens são oclusores.
const RAYS_LIT_GLSL = /* glsl */`
uniform vec2 uFar;
uniform vec2 uOccNear;   // m: oclusores mais próximos que isto não contam
uniform float uSeaY;     // m: altura abaixo da qual a superfície é mar
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
float raysLit(vec2 uv, float d) {
  if (postIsSky(d)) return 1.0;
  float w = postViewW(d);
  float y = uCamPos.y + (mat3(uCamWorld) * postViewPos(uv, w)).y;
  float lit = max(smoothstep(uFar.x, uFar.y, w), 1.0 - smoothstep(uOccNear.x, uOccNear.y, w));
  return max(lit, 1.0 - smoothstep(uSeaY, uSeaY * 2.0, y));
}`;

// máscara dos raios (meia resolução): ar aceso × transparência das nuvens volumétricas
const RAYS_MASK_FRAG = /* glsl */`
${POST_DEPTH_GLSL}
${RAYS_LIT_GLSL}
uniform sampler2D tColor;
uniform sampler2D tCloud;
uniform float uHasCloud;
varying vec2 vUv;
void main() {
  float lit = raysLit(vUv, postDepthRaw(vUv));
  if (uHasCloud > 0.5) lit *= 1.0 - clamp(texture2D(tCloud, vUv).a, 0.0, 1.0);
  float l = dot(texture2D(tColor, vUv).rgb, vec3(0.2126, 0.7152, 0.0722));
  lit *= mix(0.55, 1.0, smoothstep(0.45, 0.95, l)); // céu claro perto do sol espalha mais que o azul profundo
  gl_FragColor = vec4(lit, 0.0, 0.0, 1.0);
}`;

// borrão radial em direção ao sol (GPU Gems 3, cap. 13) com deslocamento inicial por pixel (sem bandas)
const RAYS_BLUR_FRAG = /* glsl */`
uniform sampler2D tMask;
uniform vec2 uSunUV;
uniform float uDensity, uDecay;
varying vec2 vUv;
${IGN_GLSL}
void main() {
  vec2 delta = (vUv - uSunUV) * (uDensity / float(GR_SAMPLES));
  vec2 uv = vUv - delta * ign(gl_FragCoord.xy);
  float sum = 0.0, wsum = 0.0, w = 1.0;
  for (int i = 0; i < GR_SAMPLES; i++) {
    sum += texture2D(tMask, uv).r * w; wsum += w;
    w *= uDecay; uv -= delta;
  }
  gl_FragColor = vec4(sum / wsum, 0.0, 0.0, 1.0);
}`;

// visibilidade do sol (1×1): disco de amostras no depth (céu = visível) × (1 − alfa das nuvens)
const SUNVIS_FRAG = /* glsl */`
${POST_DEPTH_GLSL}
uniform sampler2D tCloud;
uniform float uHasCloud, uAspect, uRadius;
uniform vec2 uSunUV;
void main() {
  float vis = 0.0;
  for (int i = 0; i < 24; i++) {
    float r = sqrt((float(i) + 0.5) / 24.0) * uRadius;
    float a = float(i) * 2.3999632;
    vec2 uv = clamp(uSunUV + vec2(cos(a) / uAspect, sin(a)) * r, vec2(0.001), vec2(0.999));
    float v = postIsSky(postDepthRaw(uv)) ? 1.0 : 0.0;
    if (uHasCloud > 0.5) v *= 1.0 - clamp(texture2D(tCloud, uv).a, 0.0, 1.0);
    vis += v;
  }
  gl_FragColor = vec4(vis / 24.0, 0.0, 0.0, 1.0);
}`;

// luminância log (128×64, com mipmaps → média geométrica no último nível); centro pesa mais, pomba fora
const LUM_FRAG = /* glsl */`
${POST_DEPTH_GLSL}
uniform sampler2D tColor;
uniform vec2 uTexel; // 1 / tamanho do alvo de luminância
uniform float uNear;
varying vec2 vUv;
float sceneLum(vec2 uv) {
  float L = dot(pow(max(texture2D(tColor, uv).rgb, 0.0), vec3(2.2)), vec3(0.2126, 0.7152, 0.0722));
  L = clamp(L, 1e-4, 0.97);
  return L / (1.0 - L); // proxy da luminância antes do tone mapping (inversa de Reinhard)
}
void main() {
  vec2 o = uTexel * 0.25;
  float l = 0.25 * (log2(sceneLum(vUv + vec2(-o.x, -o.y))) + log2(sceneLum(vUv + vec2(o.x, -o.y)))
                  + log2(sceneLum(vUv + vec2(-o.x, o.y))) + log2(sceneLum(vUv + vec2(o.x, o.y))));
  float d = postDepthRaw(vUv);
  float w = 1.0 - 0.6 * smoothstep(0.15, 0.75, length((vUv - 0.5) * vec2(1.4, 1.0)));
  if (!postIsSky(d) && postViewW(d) < uNear) w = 0.0;
  gl_FragColor = vec4(l * w, w, 0.0, 1.0);
}`;

// adaptação (1×1, ping-pong): r = EV atual, g = log2 da média medida, b = EV alvo
const ADAPT_FRAG = /* glsl */`
uniform sampler2D tLum;
uniform sampler2D tPrev;
uniform float uLod, uDt, uKeyLog, uStrength, uMinEv, uMaxEv, uTauUp, uTauDown, uSnap;
void main() {
  vec4 m = textureLod(tLum, vec2(0.5), uLod);
  float logAvg = m.g > 1e-4 ? m.r / m.g : uKeyLog;
  float target = clamp((uKeyLog - logAvg) * uStrength, uMinEv, uMaxEv);
  float prev = texture2D(tPrev, vec2(0.5)).r;
  float tau = target > prev ? uTauUp : uTauDown;
  float ev = uSnap > 0.5 ? target : mix(prev, target, 1.0 - exp(-uDt / tau));
  gl_FragColor = vec4(ev, logAvg, target, 1.0);
}`;

// composição (resolução cheia): motion blur da câmera → + raios de sol → exposição
const CINE_COMPOSITE_FRAG = /* glsl */`
${POST_DEPTH_GLSL}
uniform sampler2D tColor;
uniform sampler2D tRays;
uniform sampler2D tExposure;
${RAYS_LIT_GLSL}
uniform vec2 uResolution;
uniform float uAspect;
// motion blur
uniform float uMbOn, uMbScale, uMbMax;
uniform mat3 uPrevRot;
uniform vec3 uCamDelta;
uniform vec4 uPrevProj;
uniform vec2 uNear;
// raios
uniform float uRays, uRaysOcc, uRaysFalloff, uRaysAir, uRaysContrast;
uniform vec2 uSunUV;
uniform vec3 uSunTint;
// exposição
uniform float uExpOn;
uniform float uFrame;
uniform int uDebug;
varying vec2 vUv;
${IGN_GLSL}
float nearW(vec2 uv) { float d = postDepthRaw(uv); return postIsSky(d) ? 1.0 : smoothstep(uNear.x, uNear.y, postViewW(d)); }
void main() {
  vec4 c0 = texture2D(tColor, vUv);
  vec3 col = c0.rgb;
  float d = postDepthRaw(vUv);
  bool sky = postIsSky(d);
  float w = sky ? 1e7 : postViewW(d);
  if (uMbOn > 0.5) {
    // reprojeção: posição relativa à câmera atual → espaço de vista do quadro anterior → uv anterior
    vec3 wo = mat3(uCamWorld) * postViewPos(vUv, w);
    vec3 pv = uPrevRot * (wo + (sky ? vec3(0.0) : uCamDelta));
    vec2 v = vec2(0.0);
    if (pv.z < -1e-3) {
      float iz = 1.0 / -pv.z;
      vec2 prevUv = vec2(uPrevProj.x * pv.x + uPrevProj.z * pv.z, uPrevProj.y * pv.y + uPrevProj.w * pv.z) * iz * 0.5 + 0.5;
      v = (vUv - prevUv) * uMbScale * smoothstep(uNear.x, uNear.y, w);
      float len = length(v * vec2(uAspect, 1.0));
      if (len > uMbMax) v *= uMbMax / len;
    }
    vec2 vpx = v * uResolution;
    if (dot(vpx, vpx) > 0.36) {
      float j = ign(gl_FragCoord.xy + 5.588238 * uFrame) - 0.5;
      vec3 acc = col; float ws = 1.0;
      for (int i = 0; i < MB_SAMPLES; i++) {
        vec2 s = vUv + v * ((float(i) + 0.5 + j) / float(MB_SAMPLES) - 0.5);
        float sw = nearW(s); // a pomba (perto) não vaza para o fundo borrado
        acc += texture2D(tColor, s).rgb * sw; ws += sw;
      }
      col = acc / ws;
    }
  }
  if (uRays > 0.0 || uRaysOcc > 0.0) {
    // r = fração acesa do caminho pixel→sol (borrão radial). Dois termos, como no ar real:
    //  • oclusão: o ar à frente do céu/mar/horizonte que está no volume de sombra de um elefante/nuvem perde o
    //    espalhamento que o céu/haze já trazem → feixes escuros a partir das silhuetas e entre as patas;
    //  • brilho: espalhamento extra para frente, ∝ fração acesa, forte perto do sol.
    float r = texture2D(tRays, vUv).r;
    float fall = exp(-length((vUv - uSunUV) * vec2(uAspect, 1.0)) * uRaysFalloff);
    float air = sky ? 1.0 : 1.0 - exp(-w / uRaysAir); // só o ar entre a câmera e o objeto espalha
    float self = raysLit(vUv, d);                       // o próprio oclusor não escurece (já está na sombra dele)
    col *= 1.0 - uRaysOcc * fall * air * self * (1.0 - r);
    col += uSunTint * (pow(r, uRaysContrast) * fall * air * uRays);
    if (uDebug == 3) { gl_FragColor = vec4(vec3(r * fall * air), 1.0); return; }
  }
  if (uExpOn > 0.5) {
    // ganho de exposição sobre o proxy "antes do tone mapping" (Reinhard inverso na luminância): sombras sobem
    // ~linearmente, altas luzes comprimem — sem estourar o céu
    float g = exp2(texture2D(tExposure, vec2(0.5)).r);
    vec3 lin = pow(max(col, 0.0), vec3(2.2));
    float L = dot(lin, vec3(0.2126, 0.7152, 0.0722));
    float Lc = min(L, 0.97);
    float s = g * Lc / (1.0 - Lc);
    float Ln = s / (1.0 + s);
    lin *= L > 1e-5 ? Ln / Lc : g;
    col = pow(lin, vec3(1.0 / 2.2));
  }
  gl_FragColor = vec4(col, c0.a);
}`;

const _v = new THREE.Vector3(), _p = new THREE.Vector3(), _d = new THREE.Vector3();

// ---- CinePass: um passe do composer (antes do bloom) com sub-passes internos
class CinePass extends Pass {
  constructor(renderer, depthUniforms, quality, perspectiveDepth, floatTargets, flags) {
    super();
    this.flags = flags;            // { godrays, flare, mblur, grain, ca, autoexp } — mutável (post.setCine)
    this.cloudTex = null;          // alfa das nuvens volumétricas (meia resolução), se o passe delas existir
    this.cloudPass = null;
    this.cloudRendered = false;
    const G = CINE.GODRAYS, M = CINE.MBLUR, A = CINE.AUTOEXP;
    const persp = perspectiveDepth ? { POST_PERSPECTIVE_DEPTH: 1 } : {};
    const rtOpts = (type) => ({ type, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    const halfType = floatTargets ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.rtMask = new THREE.WebGLRenderTarget(1, 1, rtOpts(halfType)); this.rtMask.texture.name = 'cine.raysMask';
    this.rtRays = new THREE.WebGLRenderTarget(1, 1, rtOpts(halfType)); this.rtRays.texture.name = 'cine.rays';
    this.rtSunVis = new THREE.WebGLRenderTarget(1, 1, rtOpts(THREE.UnsignedByteType)); this.rtSunVis.texture.name = 'cine.sunVis';
    // exposição: só com alvos float (log da luminância é negativo, EV tem sinal)
    this.canAutoExp = floatTargets;
    const fType = renderer.extensions.has('EXT_color_buffer_float') ? THREE.FloatType : THREE.HalfFloatType;
    this.expType = fType;
    this.rtLum = new THREE.WebGLRenderTarget(128, 64, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true });
    this.rtLum.texture.name = 'cine.lum';
    this.rtExp = [0, 1].map((i) => { const t = new THREE.WebGLRenderTarget(1, 1, { ...rtOpts(fType), minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }); t.texture.name = 'cine.exposure' + i; return t; });
    this.expIndex = 0;
    this.snap = true;

    const mat = (name, frag, uniforms, defines = {}) => new THREE.ShaderMaterial({ name, defines: { ...persp, ...defines }, vertexShader: QUAD_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    const blank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 0]), 1, 1); blank.needsUpdate = true; // sem nuvens: alfa 0
    this.blank = blank;
    const litUniforms = { uFar: { value: new THREE.Vector2(G.far[0], G.far[1]) }, uOccNear: { value: new THREE.Vector2(G.occNear[0], G.occNear[1]) }, uSeaY: { value: G.seaY } };
    this.maskMat = mat('cine.raysMask', RAYS_MASK_FRAG, { ...depthUniforms, ...litUniforms, tColor: { value: null }, tCloud: { value: blank }, uHasCloud: { value: 0 } });
    this.blurMat = mat('cine.raysBlur', RAYS_BLUR_FRAG, { tMask: { value: this.rtMask.texture }, uSunUV: { value: new THREE.Vector2() }, uDensity: { value: G.density }, uDecay: { value: G.decay } }, { GR_SAMPLES: G.samples[quality] || G.samples.high });
    this.sunVisMat = mat('cine.sunVis', SUNVIS_FRAG, { ...depthUniforms, tCloud: { value: blank }, uHasCloud: { value: 0 }, uAspect: { value: 1 }, uRadius: { value: CINE.FLARE.sunRadius }, uSunUV: { value: new THREE.Vector2() } });
    this.lumMat = mat('cine.lum', LUM_FRAG, { ...depthUniforms, tColor: { value: null }, uTexel: { value: new THREE.Vector2(1 / 128, 1 / 64) }, uNear: { value: M.near[1] } });
    this.adaptMat = mat('cine.adapt', ADAPT_FRAG, {
      tLum: { value: this.rtLum.texture }, tPrev: { value: null }, uLod: { value: 7 }, uDt: { value: 0 }, uKeyLog: { value: Math.log2(A.key) },
      uStrength: { value: A.strength }, uMinEv: { value: A.minEv }, uMaxEv: { value: A.maxEv }, uTauUp: { value: A.tauUp }, uTauDown: { value: A.tauDown }, uSnap: { value: 1 },
    });
    const tint = new THREE.Color().setHex(COLORS.sunLight, THREE.LinearSRGBColorSpace); // hex cru = sRGB de tela
    this.sunTint = new THREE.Vector3(tint.r, tint.g, tint.b);
    this.compMat = mat('cine.composite', CINE_COMPOSITE_FRAG, {
      ...depthUniforms,
      ...litUniforms,
      tColor: { value: null }, tRays: { value: this.rtRays.texture }, tExposure: { value: this.rtExp[0].texture },
      uAspect: { value: 1 },
      uMbOn: { value: 0 }, uMbScale: { value: 0 }, uMbMax: { value: M.maxLen }, uPrevRot: { value: new THREE.Matrix3() }, uCamDelta: { value: new THREE.Vector3() },
      uPrevProj: { value: new THREE.Vector4() }, uNear: { value: new THREE.Vector2(M.near[0], M.near[1]) },
      uRays: { value: 0 }, uRaysOcc: { value: 0 }, uRaysFalloff: { value: G.falloff }, uRaysAir: { value: G.airLength }, uRaysContrast: { value: G.contrast },
      uSunUV: { value: new THREE.Vector2() }, uSunTint: { value: this.sunTint },
      uExpOn: { value: 0 }, uFrame: { value: 0 }, uDebug: { value: 0 },
    }, { MB_SAMPLES: M.samples[quality] || M.samples.high });
    this.quads = {};
    for (const k of ['mask', 'blur', 'sunVis', 'lum', 'adapt', 'comp']) this.quads[k] = new FullScreenQuad(this[k + 'Mat']);
    // estado por quadro (prepare())
    this.sun = { uv: new THREE.Vector2(0.5, 0.5), ndcMax: Infinity, front: false, rays: 0, flare: 0, veil: 0 };
    this.prev = { valid: false, pos: new THREE.Vector3(), rot: new THREE.Matrix3(), proj: new THREE.Vector4() };
    this.dt = 0; this.frame = 0; this.speed = 0; this.aspect = 1;
    this.runRays = false; this.runSunVis = false; this.runExp = false; this.runMb = false;
  }
  setSize(w, h) {
    const s = CINE.GODRAYS.scale;
    const hw = Math.max(1, Math.round(w * s)), hh = Math.max(1, Math.round(h * s));
    this.rtMask.setSize(hw, hh); this.rtRays.setSize(hw, hh);
    this.aspect = w / h;
    this.compMat.uniforms.uAspect.value = this.aspect;
    this.sunVisMat.uniforms.uAspect.value = this.aspect;
  }
  // Nuvens volumétricas (volclouds.js, modo passe em meia resolução): o alvo baixo guarda cor pré-multiplicada + alfa.
  // Só é usado se o passe desenhou neste quadro (senão o alvo guarda nuvens velhas).
  findClouds(composer, renderer) {
    if (this.cloudPass && composer.passes.includes(this.cloudPass)) return;
    this.cloudPass = null; this.cloudTex = null;
    const p = composer.passes.find((q) => q.rt?.texture?.name === 'volclouds.lowres');
    if (!p) return;
    this.cloudPass = p; this.cloudTex = p.rt.texture;
    const orig = p.render.bind(p), self = this;
    p.render = function (r, ...a) { const c0 = renderer.info.render.calls; orig(r, ...a); self.cloudRendered = renderer.info.render.calls > c0; };
  }
  // por quadro, antes do composer: sol na tela, fatores, deslocamento da câmera
  prepare(camera) {
    const f = this.flags, S = this.sun, G = CINE.GODRAYS, F = CINE.FLARE, M = CINE.MBLUR;
    const e = camera.projectionMatrix.elements;
    const v = _v.copy(sunDirection).transformDirection(camera.matrixWorldInverse);
    S.front = v.z < -1e-3;
    if (S.front) {
      const iz = 1 / -v.z;
      const nx = (e[0] * v.x + e[8] * v.z) * iz, ny = (e[5] * v.y + e[9] * v.z) * iz;
      S.uv.set(nx * 0.5 + 0.5, ny * 0.5 + 0.5);
      S.ndcMax = Math.max(Math.abs(nx), Math.abs(ny));
    } else S.ndcMax = Infinity;
    const fade = (lim, from = 1.0) => (S.front ? 1 - THREE.MathUtils.smoothstep(S.ndcMax, from, lim) : 0);
    S.rays = f.godrays ? fade(G.maxNdc[1], G.maxNdc[0]) : 0;
    S.flare = f.flare ? fade(F.fadeNdc) : 0;
    S.veil = f.flare ? fade(F.veilNdc) * F.veil : 0;
    this.runRays = S.rays > 1e-4;
    this.runSunVis = S.flare > 1e-4 || S.veil > 1e-4;
    this.runExp = !!f.autoexp && this.canAutoExp;
    // motion blur: deslocamento da câmera desde o último quadro desenhado
    camera.updateMatrixWorld();
    const pos = _p.setFromMatrixPosition(camera.matrixWorld);
    const delta = _d.subVectors(pos, this.prev.pos);
    const dist = this.prev.valid ? delta.length() : 0;
    this.speed = this.dt > 0 ? dist / this.dt : 0;
    if (this.prev.valid && dist > M.teleport) this.snap = true; // teleporte: a exposição salta junto
    this.runMb = !!f.mblur && this.prev.valid && this.dt > 1e-4 && dist < M.teleport;
    const u = this.compMat.uniforms;
    u.uMbOn.value = this.runMb ? 1 : 0;
    if (this.runMb) {
      const g = THREE.MathUtils.lerp(M.gain[2], M.gain[3], THREE.MathUtils.smoothstep(this.speed, M.gain[0], M.gain[1]));
      u.uMbScale.value = (M.shutter * g) / this.dt;
      u.uPrevRot.value.copy(this.prev.rot);
      u.uPrevProj.value.copy(this.prev.proj);
      u.uCamDelta.value.copy(delta);
    }
    u.uRays.value = this.runRays ? S.rays * G.intensity : 0;
    u.uRaysOcc.value = this.runRays ? S.rays * G.occlusion : 0;
    u.uSunUV.value.copy(S.uv);
    u.uExpOn.value = this.runExp ? 1 : 0;
    u.uFrame.value = this.frame % 64;
    this.blurMat.uniforms.uSunUV.value.copy(S.uv);
    this.sunVisMat.uniforms.uSunUV.value.copy(S.uv);
    this.enabled = this.runRays || this.runMb || this.runExp;
  }
  // depois do composer: guarda as matrizes deste quadro
  finish(camera) {
    const e = camera.projectionMatrix.elements;
    this.prev.pos.setFromMatrixPosition(camera.matrixWorld);
    this.prev.rot.setFromMatrix4(camera.matrixWorldInverse);
    this.prev.proj.set(e[0], e[5], e[8], e[9]);
    this.prev.valid = true;
    this.dt = 0;
    this.frame++;
  }
  render(renderer, writeBuffer, readBuffer) {
    const useCloud = !!(this.cloudTex && this.cloudRendered);
    const cloud = useCloud ? this.cloudTex : this.blank;
    if (this.runExp) {
      this.lumMat.uniforms.tColor.value = readBuffer.texture;
      renderer.setRenderTarget(this.rtLum); this.quads.lum.render(renderer);
      const prev = this.rtExp[this.expIndex], next = this.rtExp[1 - this.expIndex];
      const a = this.adaptMat.uniforms;
      a.tPrev.value = prev.texture; a.uDt.value = Math.min(this.dt, 0.25); a.uSnap.value = this.snap ? 1 : 0;
      renderer.setRenderTarget(next); this.quads.adapt.render(renderer);
      this.expIndex = 1 - this.expIndex;
      this.compMat.uniforms.tExposure.value = next.texture;
      this.snap = false;
    }
    if (this.runRays) {
      const m = this.maskMat.uniforms;
      m.tColor.value = readBuffer.texture; m.tCloud.value = cloud; m.uHasCloud.value = useCloud ? 1 : 0;
      renderer.setRenderTarget(this.rtMask); this.quads.mask.render(renderer);
      renderer.setRenderTarget(this.rtRays); this.quads.blur.render(renderer);
    }
    this.compMat.uniforms.tColor.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quads.comp.render(renderer);
  }
  // visibilidade do sol para a lente (roda mesmo com o CinePass desligado: chamado por createPost antes do grade)
  renderSunVis(renderer) {
    const useCloud = !!(this.cloudTex && this.cloudRendered);
    const s = this.sunVisMat.uniforms;
    s.tCloud.value = useCloud ? this.cloudTex : this.blank; s.uHasCloud.value = useCloud ? 1 : 0;
    renderer.setRenderTarget(this.rtSunVis); this.quads.sunVis.render(renderer);
  }
  // depuração: lê a exposição atual { ev, logAvg, target } (sincroniza a GPU — não usar por quadro)
  readExposure(renderer) {
    const rt = this.rtExp[this.expIndex];
    const isF = this.expType === THREE.FloatType;
    const buf = isF ? new Float32Array(4) : new Uint16Array(4);
    renderer.readRenderTargetPixels(rt, 0, 0, 1, 1, buf);
    const val = (i) => (isF ? buf[i] : THREE.DataUtils.fromHalfFloat(buf[i]));
    return { ev: val(0), logAvg: val(1), target: val(2) };
  }
  dispose() {
    for (const rt of [this.rtMask, this.rtRays, this.rtSunVis, this.rtLum, ...this.rtExp]) rt.dispose();
    for (const k in this.quads) { this.quads[k].material.dispose(); this.quads[k].dispose(); }
    this.blank.dispose();
  }
}

// ---- lente/filme no grade: halo + fantasmas + véu (sol visível)
const FLARE_GLSL = (() => {
  const F = CINE.FLARE, gl = (x) => { const t = Number(x).toPrecision(6); return /[.e]/.test(t) ? t : t + '.0'; };
  const gh = F.ghosts.map((g) => `  ghost(uv, ${gl(g[0])}, ${gl(g[1])}, ${gl(g[2])}, vec3(${gl(g[3])}, ${gl(g[4])}, ${gl(g[5])}), acc);`).join('\n');
  return /* glsl */`
uniform sampler2D tSunVis;
uniform vec2 uSunUV;
uniform float uFlare, uVeil, uAspect;
uniform vec3 uSunTint;
uniform vec4 uHalo;
const float FL_CHROMA = ${gl(F.chroma)};
const float FL_VEIL_FALLOFF = ${gl(F.veilFalloff)};
void ghost(vec2 uv, float t, float r, float k, vec3 tint, inout vec3 acc) {
  vec2 gp = uSunUV + (vec2(0.5) - uSunUV) * t;
  float d = length((uv - gp) * vec2(uAspect, 1.0));
  vec3 rr = r * (1.0 + FL_CHROMA * vec3(-1.0, 0.0, 1.0));   // raio por canal: franja fria por fora, quente por dentro
  vec3 disk = 1.0 - smoothstep(rr * 0.55, rr, vec3(d));
  vec3 ring = smoothstep(rr * 0.70, rr * 0.92, vec3(d)) * disk; // borda um pouco mais forte (abertura)
  acc += tint * k * (disk * 0.7 + ring * 0.6);
}
vec3 lensFlare(vec3 c, vec2 uv) {
  float vis = texture2D(tSunVis, vec2(0.5)).r;
  if (vis <= 0.0) return c;
  float ds = length((uv - uSunUV) * vec2(uAspect, 1.0));
  vec3 add = uSunTint * (uHalo.x * exp(-ds / uHalo.y) + uHalo.z * exp(-ds / uHalo.w));
  vec3 acc = vec3(0.0);
${gh}
  add = (add + acc) * uFlare;
  float veil = uVeil * exp(-length((uSunUV - 0.5) * vec2(uAspect, 1.0)) * FL_VEIL_FALLOFF);
  return mix(c, uSunTint, veil * vis) + add * vis;
}`;
})();

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
    // lente/filme (RENDER.CINE) — 0 desliga cada termo
    tSunVis: { value: null },
    uSunUV: { value: new THREE.Vector2(0.5, 0.5) },
    uFlare: { value: 0 }, uVeil: { value: 0 }, uAspect: { value: 1 },
    uSunTint: { value: new THREE.Vector3(1, 1, 1) },
    uHalo: { value: new THREE.Vector4(...RENDER.CINE.FLARE.halo) },
    uCA: { value: 0 },
    uGrain: { value: 0 }, uFrame: { value: 0 },
  },
  vertexShader: /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
precision highp float;
uniform sampler2D tDiffuse;
uniform vec3 uHaze;
uniform float uVignette, uVigStart, uLift, uLiftEdge, uContrast, uDesat;
uniform float uCA, uGrain, uFrame;
varying vec2 vUv;
${FLARE_GLSL}
${IGN_GLSL}
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  if (uCA > 0.0) {
    // aberração cromática lateral: R para fora, B para dentro, ∝ r³ (zero no centro, ≤ ~0,5 px por canal nos cantos a 1080p)
    vec2 dc = vUv - 0.5;
    vec2 off = dc * dot(dc * vec2(uAspect, 1.0), dc * vec2(uAspect, 1.0)) * uCA;
    c.r = texture2D(tDiffuse, vUv + off).r;
    c.b = texture2D(tDiffuse, vUv - off).b;
  }
  c = clamp(c, 0.0, 1.0);
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
  if (uFlare > 0.0 || uVeil > 0.0) c = lensFlare(c, vUv); // na lente: antes da vinheta (que também é óptica)
  c = c * (1.0 - uVignette * v) + uHaze * (uLift + uLiftEdge * v);
  if (uGrain > 0.0) {
    // grão fino por pixel, novo a cada quadro (ruído de gradiente intercalado: espectro "azul", sem padrão fixo);
    // mais forte nos meios-tons, quase nada no preto e no branco
    float gl = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float n = ign(gl_FragCoord.xy + 5.588238 * uFrame) + ign(gl_FragCoord.yx * 1.37 + 11.3 * uFrame + 3.1) - 1.0;
    c += n * uGrain * (0.25 + 3.0 * gl * (1.0 - gl));
  }
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
      cine: null, setCine() {}, getCine() { return null; }, readExposure() { return null; },
    };
  }

  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const perspectiveDepth = !renderer.capabilities.logarithmicDepthBuffer;
  const floatColor = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
  const samples = Math.min(opts.msaa ?? RENDER.MSAA, renderer.capabilities.maxSamples || 0); // opts.msaa: só para capturas headless rápidas

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
  // ---- realismo de câmera (raios de sol, motion blur, exposição) antes do bloom; lente/filme no grade
  const cineFlags = { godrays: true, flare: true, mblur: true, grain: true, ca: true, autoexp: true, ...(opts.cine || {}) };
  const cine = new CinePass(renderer, depthUniforms, quality, perspectiveDepth, floatColor, cineFlags);
  composer.addPass(cine);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), RENDER.BLOOM.strength, RENDER.BLOOM.radius, RENDER.BLOOM.threshold);
  composer.addPass(bloom);

  const grade = new ShaderPass(GradeShader);
  { const c = new THREE.Color().setHex(COLORS.fog, THREE.LinearSRGBColorSpace); grade.uniforms.uHaze.value.set(c.r, c.g, c.b); } // valores crus do hex = sRGB de tela (sem a conversão do ColorManagement)
  composer.addPass(grade);
  { // visibilidade do sol (1×1, depth + nuvens deste quadro) logo antes do grade, mesmo com o CinePass desligado
    const gradeRender = grade.render.bind(grade);
    grade.render = (r, ...a) => { if (cine.runSunVis) cine.renderSunVis(r); gradeRender(r, ...a); };
    const gu = grade.uniforms;
    gu.tSunVis.value = cine.rtSunVis.texture;
    gu.uSunUV.value = cine.sun.uv; // mesmo objeto: atualizado em prepare()
    gu.uSunTint.value.copy(cine.sunTint);
  }

  const smaa = new SMAAPass();
  composer.addPass(smaa);

  apply.material.uniforms.uDebug.value = opts.debug | 0;
  cine.compMat.uniforms.uDebug.value = opts.debug | 0; // 3 = só os raios de sol (fração acesa × queda)
  if (opts.debug) bloom.enabled = false;

  function setSize() {
    renderer.getDrawingBufferSize(size);
    composer.setSize(size.x, size.y);
    depthUniforms.uResolution.value.set(size.x, size.y);
    const aspect = size.x / size.y;
    grade.uniforms.uAspect.value = aspect;
    // CA: separação R–B de CA_PX px no canto a 1080p (off = dc·r²·uCA; canto: r² = (aspect/2)² + 1/4)
    const r2 = 0.25 * aspect * aspect + 0.25;
    grade.uniforms.uCA.value = cineFlags.ca ? (0.5 * RENDER.CINE.CA_PX) / (0.5 * r2 * 1080 * aspect) : 0;
  }
  function updateCineUniforms() {
    cine.findClouds(composer, renderer);
    cine.prepare(camera);
    const gu = grade.uniforms;
    gu.uFlare.value = cine.sun.flare;
    gu.uVeil.value = cine.sun.veil;
    gu.uGrain.value = cineFlags.grain ? RENDER.CINE.GRAIN : 0;
    gu.uFrame.value = cine.frame % 64;
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
    ao: aoPass, aoApply: apply, cine,
    glsl: { depth: POST_DEPTH_GLSL, aerial: AERIAL_GLSL },
    render() {
      renderer.info.reset();
      updateCameraUniforms();
      updateCineUniforms();
      composer.render();
      cine.finish(camera);
    },
    setSize,
    // por tick da simulação: acumula o dt desde o último render (motion blur e adaptação da exposição usam o tempo
    // SIMULADO entre dois quadros desenhados; pausa = sem rastro e sem adaptação)
    update(cam, time, dt = 0) { cine.dt += Math.max(0, dt || 0); },
    // liga/desliga efeitos em tempo de execução: setCine({ godrays, flare, mblur, grain, ca, autoexp })
    setCine(f = {}) {
      for (const k of Object.keys(cineFlags)) if (k in f) cineFlags[k] = !!f[k];
      if ('autoexp' in f && f.autoexp) cine.snap = true;
      setSize();
    },
    getCine() { return { ...cineFlags, sun: { uv: cine.sun.uv.toArray(), ndcMax: cine.sun.ndcMax, rays: cine.sun.rays, flare: cine.sun.flare, veil: cine.sun.veil }, speed: cine.speed, mblur: cine.runMb, rays: cine.runRays, exposure: cine.runExp, clouds: !!cine.cloudTex }; },
    readExposure() { return cine.runExp ? cine.readExposure(renderer) : null; },
    addPass(pass, where = 'beforeGrade') {
      if (where === 'afterScene') { afterScene.push(pass); pass.setSize?.(size.x, size.y); return pass; }
      const index = typeof where === 'number' ? where : composer.passes.indexOf(cine); // 'beforeGrade' = antes do CinePass (raios/blur/exposição veem as nuvens)
      composer.insertPass(pass, index);
      return pass;
    },
    removePass(pass) {
      const i = afterScene.indexOf(pass);
      if (i >= 0) afterScene.splice(i, 1); else composer.removePass(pass);
    },
    setAO,
    setDebug(mode) { apply.material.uniforms.uDebug.value = mode | 0; cine.compMat.uniforms.uDebug.value = mode | 0; bloom.enabled = !mode; },
    dispose() { composer.dispose(); sceneTarget.dispose(); depthTexture.dispose(); aoPass.dispose(); apply.dispose(); smaa.dispose(); cine.dispose(); },
  };
}
