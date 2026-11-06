// =====================================================================
//  Iluminação compartilhada por main.js e pelo preview de desenvolvimento:
//   • sol direcional COM sombras (PCF suave) numa caixa ortográfica que segue
//     o jogador, encaixada em texels para não tremer (quality high/ultra);
//   • mapa de ambiente PMREM gerado de um céu procedural (mesmo gradiente e sol
//     de config.js) → luz ambiente e reflexos realistas nos MeshStandardMaterial
//     (o ouro reflete o céu/sol; o lado da sombra fica azulado, nunca preto);
//   • hemisfério + ambiente reduzidos (o envMap já dá a luz do céu) e FogExp2.
//  Contrato:
//    createLighting(scene, renderer, { quality, shadowRange? }) → {
//      sun, hemi, ambient, sunDirection, environment (Texture | null), shadowsEnabled, setEnvIntensity(k),
//      update(camera | Vector3),            // por quadro: move o sol/caixa de sombras para perto do jogador
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

export const sunDirection = new THREE.Vector3(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z).normalize();

// ------------------------- mapa de ambiente ------------------------------
// Esfera invertida pequena (o PMREMGenerator renderiza com near 0,1 / far 100) com o
// gradiente do céu em espaço perceptual (igual ao sky.js), mar abaixo do horizonte e um
// halo de sol HDR. Sai em linear (render target do PMREM), sem tone mapping.
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
  // abaixo do horizonte: névoa junto à linha d'água → azul do oceano (reflexo "de baixo" no ouro)
  vec3 sea = mix(uHorizon, uOcean, smoothstep(0.0, 0.35, -h));
  col = h < 0.0 ? sea : col;
  // sol: halo largo discreto + disco HDR
  float s = max(dot(d, uSunDir), 0.0);
  float glow = pow(s, 64.0) * 0.25 + pow(s, 600.0) * 0.8 + smoothstep(0.9993, 0.9998, s) * 4.0;
  col += uSunColor * glow * uSunGlow;
  gl_FragColor = vec4(col, 1.0);
}`;

export function createEnvironmentMap(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: new THREE.Color(COLORS.skyZenith) },
      uHorizon: { value: new THREE.Color(COLORS.skyHorizon) },
      uOcean: { value: new THREE.Color(COLORS.oceanMid) },
      uSunDir: { value: sunDirection.clone() },
      uSunColor: { value: new THREE.Color(COLORS.sunLight) },
      uSunGlow: { value: RENDER.ENV_SUN_GLOW },
    },
    vertexShader: ENV_VERT, fragmentShader: ENV_FRAG,
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  });
  mat.toneMapped = false;
  const geo = new THREE.SphereGeometry(40, 48, 24);
  envScene.add(new THREE.Mesh(geo, mat));
  const rt = pmrem.fromScene(envScene, 0.04);
  pmrem.dispose(); geo.dispose(); mat.dispose();
  return rt.texture;
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

  // Sol dominante + pouca luz de preenchimento: o lado da sombra do elefante fica cinza-escuro
  // azulado (envMap do céu + hemisfério fraco), o lado do sol esculpe as rugas e os volumes.
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

  // ---- mapa de ambiente
  let environment = null;
  let envScale = RENDER.ENV_INTENSITY;
  if (renderer) {
    environment = createEnvironmentMap(renderer);
    scene.environment = environment;                       // fallback (Lambert/Phong e objetos ainda não varridos)
    scene.environmentIntensity = RENDER.ENV_INTENSITY_FALLBACK;
  }

  // ---- sombras
  const shadowsEnabled = !!(renderer && shadowCfg);
  let texel = 1;
  if (shadowsEnabled) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap; // r187: PCFSoftShadowMap foi removido; o PCF já filtra num disco de Vogel (shadow.radius)
    sun.castShadow = true;
    const s = sun.shadow;
    s.mapSize.set(shadowCfg.mapSize, shadowCfg.mapSize);
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
    texel = (2 * shadowCfg.range) / shadowCfg.mapSize;
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

  // Varredura: envMap explícito nos materiais PBR + sombras nos objetos novos.
  function sweep(root) {
    if (environment) root.traverse((o) => { if (o.isMesh && !o.userData.envSet) { o.userData.envSet = true; applyEnvironment(o, environment, envScale); } });
    return shadowsEnabled ? enableShadows(root) : 0;
  }

  return {
    sun, hemi, ambient, sunDirection, environment, shadowsEnabled, quality,
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
