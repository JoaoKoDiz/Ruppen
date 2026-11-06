// =====================================================================
//  Iluminação compartilhada por main.js e pelo preview de desenvolvimento:
//   • sol direcional COM sombras (PCF, disco de Vogel) numa caixa ortográfica que segue
//     o jogador, encaixada em texels para não tremer (quality high/ultra);
//   • mapa de ambiente PMREM gerado de um céu procedural (mesmo gradiente e sol
//     de config.js) → luz ambiente e reflexos realistas nos MeshStandardMaterial
//     (o ouro reflete o céu/sol; o lado da sombra fica azulado, nunca preto);
//   • hemisfério azul-cinza (céu em cima, mar refletido embaixo) como preenchimento: o lado
//     da sombra do elefante fica cinza médio, o sol esculpe o lado iluminado; e FogExp2.
//  Perspectiva aérea (todas as qualidades): ao ser importado, este módulo substitui os chunks
//  fog_pars_vertex / fog_vertex / fog_pars_fragment / fog_fragment do three.js. Além da FogExp2 (agora
//  residual, WORLD.FOG_DENSITY), todo material com névoa aplica a extinção exponencial com a altura de
//  RENDER.AERIAL na profundidade REAL do fragmento (por isso fica no material e não no pós: nuvens e véus
//  transparentes não gravam depth). O vertex calcula vFogOffset = posição do fragmento − câmera, em mundo
//  ((mvPosition, 0) · viewMatrix = rotação inversa da vista). AERIAL_GLSL (exportado) traz as funções
//    vec3 ruppenAerialT(vec3 offsetDaCamera, float alturaDaCamera)          → transmitância RGB
//    vec3 ruppenApplyAerial(vec3 cor, vec3 offset, float camY, vec3 haze)   → cor com haze (sRGB de tela)
//  para shaders que não usam os chunks (ex.: nuvens volumétricas em ray-march): cole AERIAL_GLSL e chame
//  ruppenApplyAerial(cor, pos − cameraPosition, cameraPosition.y, fogColor) — protegido por #ifndef RUPPEN_AERIAL.
//
//  Contrato:
//    createLighting(scene, renderer, { quality, shadowRange? }) → {
//      sun, hemi, ambient, sunDirection, environment (Texture | null — getter: muda quando o HDRI chega),
//      envReady (Promise<boolean>), hdriInfo, shadowsEnabled, setEnvIntensity(k),
//      update(camera | Vector3),            // por quadro: move o sol/caixa de sombras para perto do jogador e
//                                           // afina a névoa com a altitude (RENDER.FOG_ALTITUDE)
//      enableShadows(root),                 // liga castShadow/receiveShadow (+ envMap PBR) em tudo o que deve ter
//      refreshShadows(root, dt),            // chama enableShadows a cada RENDER.SHADOW.REFRESH_S s (objetos novos)
//    }
//    enableShadows(root) também é exportada solta.  Opt-out por objeto: obj.userData.noShadow = true.
//
//  envMap por material: o three.js (r163+) SOBRESCREVE material.envMapIntensity com
//  scene.environmentIntensity sempre que material.envMap é null. Para respeitar os pesos
//  escolhidos pelos módulos (pele 0,5, ouro 1,2…), a travessia de enableShadows/refreshShadows
//  liga material.envMap = environment explicitamente nos MeshStandard/Physical e usa
//  envMapIntensity = (valor do material) × RENDER.ENV_INTENSITY. Lambert/Phong continuam
//  no fallback scene.environment × scene.environmentIntensity (só irradiância difusa).
// =====================================================================
import * as THREE from 'three';
import { COLORS, SUN_DIR, WORLD, RENDER } from '../config.js';
import { loadHDRI } from '../assets.js';

export const sunDirection = new THREE.Vector3(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z).normalize();

// ------------------------- perspectiva aérea ------------------------------
const glf = (x) => { const t = Number(x).toPrecision(7); return /[.e]/.test(t) ? t : t + '.0'; };
const AP = RENDER.AERIAL;
export const AERIAL_GLSL = /* glsl */`
#ifndef RUPPEN_AERIAL
#define RUPPEN_AERIAL
const float AP_H = ${glf(AP.H)};
const float AP_SIGMA0 = ${glf(AP.SIGMA0)};
const float AP_SIGMA1 = ${glf(AP.SIGMA1)};
const vec3 AP_RGB = vec3(${AP.RGB.map(glf).join(', ')});
const float AP_DESAT = ${glf(AP.DESAT)};
// profundidade óptica analítica de um raio reto da câmera (altura camY) até camY + offset, com
// densidade SIGMA0·exp(−h/H) + SIGMA1 (h ≥ 0: abaixo do mar conta como o nível do mar)
vec3 ruppenAerialT(vec3 offset, float camY) {
  float dist = length(offset);
  float h0 = max(camY, 0.0);
  float h1 = max(camY + offset.y, 0.0);
  float k = (h1 - h0) / AP_H;
  float shape = abs(k) < 1e-3 ? 1.0 - 0.5 * k : (1.0 - exp(-k)) / k;
  float tau = dist * (AP_SIGMA0 * exp(-h0 / AP_H) * shape + AP_SIGMA1);
  return exp(-tau * AP_RGB);
}
vec3 ruppenApplyAerial(vec3 col, vec3 offset, float camY, vec3 haze) {
  vec3 T = ruppenAerialT(offset, camY);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3(l), AP_DESAT * (1.0 - T.g));
  return col * T + haze * (1.0 - T);
}
#endif
`;

function installAerialPerspective() {
  const C = THREE.ShaderChunk;
  if (C.fog_fragment.includes('ruppenApplyAerial')) return;
  C.fog_pars_vertex = /* glsl */`
#ifdef USE_FOG
	varying float vFogDepth;
	varying vec3 vFogOffset;
#endif`;
  C.fog_vertex = /* glsl */`
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	vFogOffset = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;
#endif`;
  C.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vFogOffset;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
${AERIAL_GLSL}
#endif`;
  C.fog_fragment = /* glsl */`
#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = ruppenApplyAerial( gl_FragColor.rgb, vFogOffset, cameraPosition.y, fogColor );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;
}
installAerialPerspective();

// ------------------------- mapa de ambiente ------------------------------
// Esfera invertida pequena (o PMREMGenerator renderiza com near 0,1 / far 100). Duas fontes:
//  • procedural (imediato): gradiente do céu em espaço perceptual (igual ao sky.js), mar abaixo do
//    horizonte e um halo de sol HDR;
//  • HDRI real (Poly Haven, kloofendal_48d_partly_cloudy_puresky, via assets.js → loadHDRI, assíncrono):
//    girado em torno de Y para que o sol dele caia no azimute de SUN_DIR, normalizado para a mesma
//    luminância média do céu procedural (o look geral não muda, só ganha nuvens/variação reais nos
//    reflexos), sol limitado (RENDER.HDRI.SUN_CLAMP: o DirectionalLight já é o sol direto) e misturado
//    ao procedural (RENDER.HDRI.MIX). Abaixo do horizonte continua o mar procedural.
// Quando o HDRI chega, um novo PMREM é gerado e trocado em scene.environment e em todo material que
// usava o antigo (mesmo tamanho → mesmo programa, sem recompilar). Sai em linear, sem tone mapping.
const ENV_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const ENV_FRAG = /* glsl */`
precision highp float;
uniform vec3 uZenith, uHorizon, uOcean, uSunDir, uSunColor;
uniform float uSunGlow;
uniform sampler2D tHDRI;
uniform float uHdriMix, uHdriScale, uHdriAzimuth, uHdriClamp;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y, hh = max(h, 0.0);
  vec3 hz = pow(uHorizon, vec3(1.0 / 2.2));
  vec3 zn = pow(uZenith, vec3(1.0 / 2.2));
  vec3 col = mix(hz, zn, pow(hh, 0.48));
  float haze = exp(-hh * 7.5) * 0.70 + exp(-hh * 40.0) * 0.30;
  col = mix(col, hz, clamp(haze, 0.0, 1.0));
  col = pow(col, vec3(2.2));
  // sol: halo largo discreto + disco HDR
  float s = max(dot(d, uSunDir), 0.0);
  float glow = pow(s, 64.0) * 0.25 + pow(s, 600.0) * 0.8 + smoothstep(0.9993, 0.9998, s) * 4.0;
  col += uSunColor * glow * uSunGlow * (1.0 - uHdriMix);
  // HDRI real girado (azimute) — só o hemisfério de cima; a linha do horizonte funde no mar
  if (uHdriMix > 0.0) {
    vec3 dh = normalize(vec3(d.x, max(h, 0.002), d.z));
    vec2 uv = vec2(fract((atan(dh.z, dh.x) - uHdriAzimuth) * 0.15915494 + 0.5), asin(clamp(dh.y, -1.0, 1.0)) * 0.31830989 + 0.5);
    vec3 hdr = texture2D(tHDRI, uv).rgb * uHdriScale;
    float l = dot(hdr, vec3(0.2126, 0.7152, 0.0722));
    hdr *= min(1.0, uHdriClamp / max(l, 1e-6));
    col = mix(col, hdr, uHdriMix);
  }
  // abaixo do horizonte: névoa junto à linha d'água → azul do oceano (reflexo "de baixo" no ouro)
  vec3 sea = mix(uHorizon, uOcean, smoothstep(0.0, 0.35, -h));
  col = mix(col, sea, smoothstep(0.004, -0.004, h));
  gl_FragColor = vec4(col, 1.0);
}`;

function envUniforms() {
  return {
    uZenith: { value: new THREE.Color(COLORS.skyZenith) },
    uHorizon: { value: new THREE.Color(COLORS.skyHorizon) },
    uOcean: { value: new THREE.Color(COLORS.oceanMid) },
    uSunDir: { value: sunDirection.clone() },
    uSunColor: { value: new THREE.Color(COLORS.sunLight) },
    uSunGlow: { value: RENDER.ENV_SUN_GLOW },
    tHDRI: { value: null },
    uHdriMix: { value: 0 }, uHdriScale: { value: 1 }, uHdriAzimuth: { value: 0 }, uHdriClamp: { value: RENDER.HDRI.SUN_CLAMP },
  };
}

function renderEnvironment(renderer, uniforms) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: ENV_VERT, fragmentShader: ENV_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false });
  mat.toneMapped = false;
  const geo = new THREE.SphereGeometry(40, 64, 32);
  envScene.add(new THREE.Mesh(geo, mat));
  const rt = pmrem.fromScene(envScene, 0.04);
  rt.texture.name = 'ruppen.env';
  pmrem.dispose(); geo.dispose(); mat.dispose();
  return rt;
}

export function createEnvironmentMap(renderer) {
  return renderEnvironment(renderer, envUniforms()).texture;
}

// Luminância média (ponderada pelo ângulo sólido) do hemisfério de cima do céu procedural (espelha ENV_FRAG sem o sol).
function proceduralSkyLuminance() {
  const z = new THREE.Color(COLORS.skyZenith), hc = new THREE.Color(COLORS.skyHorizon);
  const P = (c) => [c.r, c.g, c.b].map((x) => Math.pow(x, 1 / 2.2));
  const zn = P(z), hz = P(hc);
  let sum = 0, wsum = 0;
  for (let i = 0; i < 90; i++) {
    const lat = ((i + 0.5) / 90) * Math.PI / 2, hh = Math.sin(lat), w = Math.cos(lat);
    const t = Math.pow(hh, 0.48), haze = Math.min(1, Math.exp(-hh * 7.5) * 0.7 + Math.exp(-hh * 40) * 0.3);
    const c = [0, 1, 2].map((k) => Math.pow((hz[k] + (zn[k] - hz[k]) * t) * (1 - haze) + hz[k] * haze, 2.2));
    sum += (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) * w; wsum += w;
  }
  return sum / wsum;
}

// Analisa o HDRI (equirretangular, linhas de cima para baixo, flipY): direção do sol (pixel mais brilhante)
// e luminância média do céu (hemisfério de cima, ponderada pelo ângulo sólido, sem o sol).
function analyzeHDRI(tex) {
  const { width: W, height: H, data } = tex.image;
  const half = tex.type === THREE.HalfFloatType;
  const val = half ? (i) => THREE.DataUtils.fromHalfFloat(data[i]) : (i) => data[i];
  let best = -1, bi = 0, bj = 0, sum = 0, wsum = 0;
  const step = 2;
  for (let r = 0; r < H / 2; r += 1) {
    const lat = (0.5 - (r + 0.5) / H) * Math.PI; // linha 0 = zênite
    const w = Math.cos(lat);
    for (let c = 0; c < W; c += (r % step === 0 ? 1 : W)) {
      const i = 4 * (r * W + c);
      const l = 0.2126 * val(i) + 0.7152 * val(i + 1) + 0.0722 * val(i + 2);
      if (l > best) { best = l; bi = r; bj = c; }
      if (l < 20) { sum += l * w; wsum += w; }
    }
  }
  const lat = (0.5 - (bi + 0.5) / H) * Math.PI;
  const azimuth = ((bj + 0.5) / W - 0.5) * 2 * Math.PI; // = atan2(z, x) no mapeamento equirretangular do three
  return { sunAzimuth: azimuth, sunElevation: lat, peak: best, meanSky: sum / Math.max(wsum, 1e-6) };
}

// ------------------------------ sombras ----------------------------------
// Objetos que nunca participam das sombras (por nome) — céu, oceano, nuvens, espuma, jato d'água, UI de tela.
const NO_SHADOW_NAMES = new Set(['sky', 'ocean', 'clouds', 'cloudPuffs', 'footFoam', 'postPass', 'spray', 'packageRope']);
const NO_SHADOW_PREFIXES = ['raso:'];

function shadowEligible(obj) {
  if (!obj.isMesh || obj.isSprite) return false;              // Points/Sprites/Lines não
  if (obj.userData?.noShadow) return false;
  const name = obj.name || '';
  if (NO_SHADOW_NAMES.has(name)) return false;
  for (const p of NO_SHADOW_PREFIXES) if (name.startsWith(p)) return false;
  const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
  for (const m of mats) {
    if (!m) continue;
    if (m.transparent && !m.depthWrite) return false;         // billboards/véus (nuvens, água rasa, anéis)
  }
  return true;
}

// envMap explícito nos materiais PBR (ver cabeçalho). Guarda o peso original em userData.envBase.
function applyEnvironment(obj, env, scale) {
  const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
  for (const m of mats) {
    if (!m || !m.isMeshStandardMaterial) continue;
    if (m.userData.envBase === undefined) {
      if (m.envMap) continue; // o módulo escolheu o próprio envMap: não mexe
      m.userData.envBase = m.envMapIntensity;
      m.envMap = env;
      m.needsUpdate = true;
    }
    m.envMapIntensity = m.userData.envBase * scale;
  }
}

// Liga castShadow/receiveShadow numa única travessia. Marca os objetos já tratados
// (userData.shadowsSet) para que as travessias periódicas sejam baratas e não
// sobrescrevam escolhas feitas por outros módulos.
export function enableShadows(root) {
  let n = 0;
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    if (obj.userData.shadowsSet) return;
    obj.userData.shadowsSet = true;
    if (!shadowEligible(obj)) return;
    obj.castShadow = true;
    obj.receiveShadow = true;
    n++;
  });
  return n;
}

export function createLighting(scene, renderer = null, opts = {}) {
  const quality = ['low', 'high', 'ultra'].includes(opts.quality) ? opts.quality : 'high';
  // opts.shadowRange: substitui o ±range do nível (o preview ajusta a caixa ao tamanho do objeto em foco)
  const shadowCfg = RENDER.SHADOW[quality] && (opts.shadowRange ? { ...RENDER.SHADOW[quality], range: opts.shadowRange } : RENDER.SHADOW[quality]);

  // Sol dominante + preenchimento azul-cinza (envMap do céu + hemisfério): o lado da sombra do
  // elefante fica cinza médio azulado, o lado do sol esculpe as rugas e os volumes.
  const sun = new THREE.DirectionalLight(COLORS.sunLight, RENDER.SUN_INTENSITY);
  sun.position.copy(sunDirection).multiplyScalar(RENDER.SHADOW.DEPTH);
  sun.target.position.set(0, 0, 0);
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight(RENDER.HEMI_SKY, RENDER.HEMI_GROUND, RENDER.HEMI_INTENSITY);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(RENDER.AMBIENT_COLOR, RENDER.AMBIENT_INTENSITY);
  scene.add(ambient);

  scene.fog = new THREE.FogExp2(COLORS.fog, WORLD.FOG_DENSITY);
  scene.background = new THREE.Color(COLORS.skyHorizon);

  // ---- mapa de ambiente: procedural já, HDRI real quando carregar (troca transparente)
  let environment = null, envTarget = null;
  let envScale = RENDER.ENV_INTENSITY;
  let envReady = Promise.resolve(false);
  let hdriInfo = null;
  if (renderer) {
    envTarget = renderEnvironment(renderer, envUniforms());
    environment = envTarget.texture;
    scene.environment = environment;                       // fallback (Lambert/Phong e objetos ainda não varridos)
    scene.environmentIntensity = RENDER.ENV_INTENSITY_FALLBACK;
    if (RENDER.HDRI.MIX > 0 && opts.hdri !== false) {
      envReady = loadHDRI().then((hdri) => {
        const info = analyzeHDRI(hdri);
        const target = Math.atan2(sunDirection.z, sunDirection.x);
        const u = envUniforms();
        u.tHDRI.value = hdri;
        u.uHdriMix.value = RENDER.HDRI.MIX;
        u.uHdriAzimuth.value = target - info.sunAzimuth;
        u.uHdriScale.value = (proceduralSkyLuminance() / Math.max(info.meanSky, 1e-6)) * RENDER.HDRI.BRIGHTNESS;
        const next = renderEnvironment(renderer, u);
        const old = environment;
        environment = next.texture;
        if (scene.environment === old) scene.environment = environment;
        scene.traverse((o) => {
          if (!o.isMesh && !o.isPoints) return;
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m && m.envMap === old) m.envMap = environment;
        });
        envTarget = next; // o PMREM procedural não é descartado: algum material fora da cena pode ainda apontar para ele (retarget troca depois)
        hdriInfo = { ...info, azimuthOffset: u.uHdriAzimuth.value, scale: u.uHdriScale.value };
        return true;
      }).catch((e) => { console.warn('[lighting] HDRI indisponível, mantendo o céu procedural: ' + (e?.message || e)); return false; });
    }
  }

  // ---- sombras
  const shadowsEnabled = !!(renderer && shadowCfg);
  let texel = 1;
  if (shadowsEnabled) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap; // r187: PCFSoftShadowMap foi removido; o PCF já filtra num disco de Vogel (shadow.radius)
    sun.castShadow = true;
    const s = sun.shadow;
    const mapSize = renderer.capabilities.maxTextureSize >= shadowCfg.mapSize ? shadowCfg.mapSize : RENDER.SHADOW.MAP_FALLBACK;
    s.mapSize.set(mapSize, mapSize);
    s.radius = shadowCfg.radius;
    s.intensity = RENDER.SHADOW.INTENSITY;
    const cam = s.camera;
    cam.left = -shadowCfg.range; cam.right = shadowCfg.range;
    cam.bottom = -shadowCfg.range; cam.top = shadowCfg.range;
    // caixa justa ao longo do raio do sol: de DEPTH acima do foco (topos das cidades nas costas) até BELOW abaixo
    cam.near = 1; cam.far = RENDER.SHADOW.DEPTH + RENDER.SHADOW.BELOW;
    cam.updateProjectionMatrix();
    s.bias = shadowCfg.bias;
    s.normalBias = shadowCfg.normalBias;
    texel = (2 * shadowCfg.range) / mapSize;
  }

  // Base ortonormal do espaço da luz (a mesma que DirectionalLightShadow usa via lookAt com up = +Y).
  const lightBasis = new THREE.Matrix4().lookAt(sunDirection, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
  const lx = new THREE.Vector3(), ly = new THREE.Vector3(), lz = new THREE.Vector3();
  lightBasis.extractBasis(lx, ly, lz);
  const focus = new THREE.Vector3(), fwd = new THREE.Vector3();
  let refreshAcc = RENDER.SHADOW.REFRESH_S; // a 1ª chamada de refreshShadows varre logo

  function update(cameraOrPosition) {
    const isCam = !!cameraOrPosition?.isCamera;
    const pos = isCam ? cameraOrPosition.position : cameraOrPosition;
    // névoa mais rala com a altitude da câmera (FogExp2 não depende da altura: de 3–5 km o ar ficaria leitoso)
    const fa = RENDER.FOG_ALTITUDE;
    scene.fog.density = WORLD.FOG_DENSITY * THREE.MathUtils.lerp(1, fa.factor, THREE.MathUtils.smoothstep(pos.y, fa.from, fa.to));
    if (!shadowsEnabled) {
      sun.position.copy(pos).addScaledVector(sunDirection, RENDER.SHADOW.DEPTH);
      sun.target.position.copy(pos);
      return;
    }
    // Foco: um pouco à frente da câmera (a pomba e o que ela olha ficam dentro da caixa); se o olhar
    // desce e cruza o plano das cidades antes disso, o foco pára lá.
    focus.copy(pos);
    if (isCam) {
      cameraOrPosition.getWorldDirection(fwd);
      let t = shadowCfg.range * RENDER.SHADOW.FOCUS_AHEAD;
      if (fwd.y < -1e-4 && pos.y > RENDER.SHADOW.FOCUS_Y) t = Math.min(t, (RENDER.SHADOW.FOCUS_Y - pos.y) / fwd.y);
      focus.addScaledVector(fwd, t);
    }
    // Encaixe em texels no espaço da luz: a caixa só se move em passos inteiros de texel → sem shimmering.
    const fx = Math.round(focus.dot(lx) / texel) * texel;
    const fy = Math.round(focus.dot(ly) / texel) * texel;
    const fz = focus.dot(lz);
    focus.set(0, 0, 0).addScaledVector(lx, fx).addScaledVector(ly, fy).addScaledVector(lz, fz);
    sun.target.position.copy(focus);
    sun.position.copy(focus).addScaledVector(sunDirection, RENDER.SHADOW.DEPTH);
  }

  // material varrido antes da troca procedural → HDRI (clonado depois, p.ex.) ainda com o PMREM antigo
  function retarget(o) {
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m && m.userData.envBase !== undefined && m.envMap && m.envMap !== environment && m.envMap.name === 'ruppen.env') m.envMap = environment;
  }
  // Varredura: envMap explícito nos materiais PBR + sombras nos objetos novos.
  function sweep(root) {
    if (environment) root.traverse((o) => { if (o.isMesh && !o.userData.envSet) { o.userData.envSet = true; applyEnvironment(o, environment, envScale); } else if (o.isMesh) retarget(o); });
    return shadowsEnabled ? enableShadows(root) : 0;
  }

  return {
    sun, hemi, ambient, sunDirection, shadowsEnabled, quality,
    get environment() { return environment; },
    envReady,                                  // Promise<boolean>: true quando o PMREM do HDRI substituiu o procedural
    get hdriInfo() { return hdriInfo; },
    update,
    enableShadows: sweep,
    refreshShadows(root, dt = 0) {
      refreshAcc += dt;
      if (refreshAcc < RENDER.SHADOW.REFRESH_S) return 0;
      refreshAcc = 0;
      return sweep(root);
    },
    // ajuste fino em tempo de execução (console / ferramentas de captura)
    setEnvIntensity(k, root = scene) {
      envScale = k;
      root.traverse((o) => { if (!o.isMesh) return; const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) if (m && m.userData.envBase !== undefined) m.envMapIntensity = m.userData.envBase * k; });
    },
  };
}

export function applyRendererDefaults(renderer) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = RENDER.EXPOSURE;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}
