// Preview isolado de um módulo (modelo do elefante, pomba, ambiente...).
// Query string:
//   mod=<caminho sob /src/>   ex.: mod=elephant/candidates/elephant_a.js   (padrão por kind)
//   fn=<nome do export>       ex.: fn=createElephant                        (padrão por kind)
//   kind=elephant|dove|env|islands|clouds|ocean|sky|all
//   env=1                     também carrega céu, oceano e nuvens (padrão em kind=env/all)
//   câmera: cx,cy,cz + lx,ly,lz   OU   dist,az,el (graus) ao redor de tx,ty,tz
//   t=<segundos> frames=<n>   avança o tempo/animação antes de renderizar
//   orbit=1                   OrbitControls interativo (para olhar no navegador)
//   quality=low|high|ultra   (os módulos do mundo recebem low/high)   ao=0 desliga a SSAO   postdebug=1|2 mostra a AO
//   godrays=0 flare=0 mblur=0 grain=0 ca=0 autoexp=0   desligam os efeitos de câmera (cine=0: todos)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WORLD, ELEPHANT, DOVE } from '../src/config.js';
import { createLighting, applyRendererDefaults } from '../src/world/lighting.js';
import { createPost } from '../src/world/post.js';
import { WORLD_DATA } from '../src/world/worldData.js';

const q = Object.fromEntries(new URLSearchParams(location.search));
const num = (k, d) => (q[k] !== undefined ? Number(q[k]) : d);
const kind = q.kind || 'elephant';
const quality = ['low', 'high', 'ultra'].includes(q.quality) ? q.quality : 'high';
const worldQuality = quality === 'low' ? 'low' : 'high';
const withEnv = q.env === '1' || kind === 'env' || kind === 'all';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality === 'low', logarithmicDepthBuffer: true }); // high/ultra: MSAA no render target do post
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight, false);
applyRendererDefaults(renderer);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, WORLD.CAMERA_NEAR, WORLD.CAMERA_FAR);

const defaults = {
  elephant: { mod: 'elephant/elephant.js', fn: 'createElephant', dist: 4200, az: 35, el: 12, ty: 900 },
  dove: { mod: 'player/dove.js', fn: 'createDove', dist: 9, az: 40, el: 18, ty: 0 },
  env: { dist: 1, az: 0, el: 0, ty: 0 },
  all: { dist: 1, az: 0, el: 0, ty: 0 },
  islands: { mod: 'world/islands.js', fn: 'createIslands', dist: 9000, az: 30, el: 25, ty: 300 },
  clouds: { mod: 'world/clouds.js', fn: 'createClouds', dist: 1, az: 0, el: 0, ty: 0 },
  ocean: { mod: 'world/ocean.js', fn: 'createOcean', dist: 1, az: 0, el: 0, ty: 0 },
  sky: { mod: 'world/sky.js', fn: 'createSky', dist: 1, az: 0, el: 0, ty: 0 },
};
const d = defaults[kind] || defaults.elephant;

// Sombras: com câmera orbital/fixa a caixa de sombras fica centrada no ponto olhado e dimensionada
// pela distância (elefante inteiro a 4–6 km, pomba a 9 m); kind=env/all (dist 1) segue a câmera como no jogo.
const shadowFocus = q.cx !== undefined ? new THREE.Vector3(num('lx', 0), num('ly', 0), num('lz', -100))
  : new THREE.Vector3(num('tx', d.tx || 0), num('ty', d.ty), num('tz', d.tz || 0));
const viewDist = q.cx !== undefined ? shadowFocus.distanceTo(new THREE.Vector3(num('cx', 0), num('cy', 100), num('cz', 0))) : num('dist', d.dist);
const focusSubject = viewDist > 2;
const lighting = createLighting(scene, renderer, { quality, shadowRange: focusSubject ? THREE.MathUtils.clamp(viewDist * 0.9, 12, 4800) : undefined }); // mesmo envMap/sombras do jogo
const cineFlag = (k) => q[k] !== undefined ? q[k] !== '0' : q.cine !== '0'; // godrays=0 flare=0 mblur=0 grain=0 ca=0 autoexp=0 (cine=0: todos)
const cine = Object.fromEntries(['godrays', 'flare', 'mblur', 'grain', 'ca', 'autoexp'].map((k) => [k, cineFlag(k)]));
const post = createPost(renderer, scene, camera, { quality, ao: q.ao !== '0', debug: num('postdebug', 0), cine });   // mesmo pós-processamento do jogo

// -------- ambiente opcional (sempre tenta; stubs funcionam) --------
const updaters = [];
async function loadEnv() {
  const [skyM, oceanM, cloudsM] = await Promise.all([import('../src/world/sky.js'), import('../src/world/ocean.js'), import('../src/world/clouds.js')]);
  const sky = skyM.createSky(scene, { quality: worldQuality }); updaters.push((t, dt) => sky.update(camera, t));
  const ocean = oceanM.createOcean(scene, { quality: worldQuality }); updaters.push((t, dt) => ocean.update(camera, t));
  const clouds = cloudsM.createClouds(scene, WORLD_DATA, { quality: worldQuality }); updaters.push((t, dt) => clouds.update(camera, t, dt));
  clouds.attachPost?.(post);
  if (kind === 'all') {
    const islM = await import('../src/world/islands.js');
    const isl = islM.createIslands(scene, WORLD_DATA, { quality: worldQuality }); updaters.push((t, dt) => isl.update?.(camera, t));
  }
}
if (withEnv) await loadEnv();
else {
  // chão simples azul para referência de escala
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200000, 200000), new THREE.MeshStandardMaterial({ color: 0x1b4f8a, roughness: 0.5 }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
}

// rota "parada" na origem para o preview do elefante (frente = +X)
const previewRoute = {
  id: 0, cityName: 'Preview', length: 1e9, speed: ELEPHANT.SPEED, u0: 0, center: { x: 0, z: 0 }, radius: 1,
  curve: null,
  poseAt(u) { return { position: new THREE.Vector3(0, 0, 0), tangent: new THREE.Vector3(1, 0, 0), heading: 0 }; },
  aheadPoints() { return [new THREE.Vector3(0, 0, 0), new THREE.Vector3(2500, 0, 0)]; },
};
if (q.realroute === '1') Object.assign(previewRoute, WORLD_DATA.routes[0]);

let subject = null;
const info = [];
if (kind === 'elephant' || kind === 'dove' || kind === 'islands' || (q.mod && !['env', 'all', 'clouds', 'ocean', 'sky'].includes(kind))) {
  const modPath = '../src/' + (q.mod || d.mod);
  const m = await import(modPath);
  const fn = m[q.fn || d.fn] || Object.values(m).find((v) => typeof v === 'function');
  if (kind === 'elephant') {
    subject = fn(previewRoute, 0, { quality: worldQuality });
    scene.add(subject.group);
    updaters.push((t, dt) => subject.update(dt, t));
    info.push('elefante: ' + (q.mod || d.mod));
  } else if (kind === 'dove') {
    subject = fn({ quality: worldQuality });
    scene.add(subject.group);
    const fake = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), velocity: new THREE.Vector3(0, 0, -60), forward: new THREE.Vector3(0, 0, -1), heading: 0, pitch: num('pitch', 0), roll: num('roll', 0), speed: num('speed', DOVE.SPEED_CRUISE), boost: q.boost === '1', altitude: 150, climbInput: num('climb', 0), turnInput: num('turn', 0) };
    subject.group.quaternion.setFromEuler(new THREE.Euler(fake.pitch, 0, fake.roll, 'YXZ'));
    updaters.push((t, dt) => subject.update(dt, fake));
    info.push('pomba: ' + (q.mod || d.mod));
  } else if (kind === 'islands') {
    subject = fn(scene, WORLD_DATA, { quality: worldQuality });
    updaters.push((t, dt) => subject.update?.(camera, t));
    // câmera padrão: ilha 0
    const isl = WORLD_DATA.islands[num('island', 0)];
    d.tx = isl.cx; d.tz = isl.cz; d.ty = 300;
  }
}

// -------- câmera --------
const target = new THREE.Vector3(num('tx', d.tx || 0), num('ty', d.ty), num('tz', d.tz || 0));
if (q.cx !== undefined) {
  camera.position.set(num('cx', 0), num('cy', 100), num('cz', 0));
  camera.lookAt(num('lx', 0), num('ly', 0), num('lz', -100));
} else {
  const dist = num('dist', d.dist), az = THREE.MathUtils.degToRad(num('az', d.az)), el = THREE.MathUtils.degToRad(num('el', d.el));
  camera.position.set(target.x + Math.sin(az) * Math.cos(el) * dist, target.y + Math.sin(el) * dist, target.z + Math.cos(az) * Math.cos(el) * dist);
  camera.lookAt(target);
}
camera.fov = num('fov', 55); camera.updateProjectionMatrix();

let time = num('t', 0);
if (q.cx === undefined) shadowFocus.copy(target); // (kind=islands escolhe a ilha depois de criar a luz)
function tick(dt) { time += dt; lighting.update(focusSubject ? shadowFocus : camera); lighting.refreshShadows(scene, dt); for (const u of updaters) u(time, dt); post.update(camera, time, dt); }
lighting.enableShadows(scene);
for (let i = 0; i < num('frames', 3); i++) tick(1 / 30);

let controls = null;
if (q.orbit === '1') { controls = new OrbitControls(camera, canvas); controls.target.copy(target); controls.update(); }
const clock = new THREE.Timer();
function frame() {
  requestAnimationFrame(frame);
  clock.update(); const dt = Math.min(clock.getDelta(), 0.05);
  if (q.orbit === '1' || q.anim === '1') tick(dt);
  controls?.update();
  post.render();
  document.getElementById('info').textContent = info.join('\n') + `\ncalls ${renderer.info.render.calls}  tris ${renderer.info.render.triangles}  t=${time.toFixed(1)}`;
}
frame();
window.addEventListener('resize', () => { renderer.setSize(window.innerWidth, window.innerHeight, false); camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); post.setSize(); });
await Promise.race([lighting.envReady, new Promise((r) => setTimeout(r, 8000))]); // PMREM do HDRI real
window.__ready = true;
window.__step = async (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) tick(dt); post.render(); };
window.__stats = () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures });
window.__preview = { THREE, scene, camera, renderer, subject, lighting, post, quality, setCamera(pos, look) { camera.position.set(...pos); camera.lookAt(...look); } };
