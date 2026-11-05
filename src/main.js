// =====================================================================
//  RUPPEN — ponto de entrada. Monta o mundo, o jogador e a interface e
//  roda o laço principal. Os módulos seguem os contratos de ARCHITECTURE.md.
// =====================================================================
import * as THREE from 'three';
import { WORLD, DOVE } from './config.js';
import { createLighting, applyRendererDefaults } from './world/lighting.js';
import { WORLD_DATA } from './world/worldData.js';
import { createSky } from './world/sky.js';
import { createOcean } from './world/ocean.js';
import { createClouds } from './world/clouds.js';
import { createPost } from './world/post.js';
import { createIslands } from './world/islands.js';
import { createInput } from './input.js';
import { createFlightController } from './player/flight.js';
import { createChaseCamera } from './player/camera.js';
import { createPackageSystem } from './player/package.js';
import { createDelivery } from './game/delivery.js';
import { createHUD } from './ui/hud.js';
import { createMapUI } from './ui/map.js';
import { createAudio } from './audio.js';

// ------------------------ parâmetros de URL (#a=1&b=2) ------------------
const params = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
// Permite testar candidatos de modelo sem trocar o arquivo oficial: #elephant=candidates/elephant_a.js&dove=candidates/dove_b.js
let createElephant, createDove;
const candidatePath = (dir, file) => './' + dir + '/' + file; // caminho em tempo de execução (não entra no bundle)
if (params.elephant) ({ createElephant } = await import(candidatePath('elephant', params.elephant)));
else ({ createElephant } = await import('./elephant/elephant.js'));
if (params.dove) ({ createDove } = await import(candidatePath('player', params.dove)));
else ({ createDove } = await import('./player/dove.js'));
const num = (k, d) => (params[k] !== undefined ? Number(params[k]) : d);
const quality = params.quality || 'high';

// ------------------------------ renderer --------------------------------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'low' ? 1 : 1.5));
renderer.setSize(window.innerWidth, window.innerHeight, false);
applyRendererDefaults(renderer);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, WORLD.CAMERA_NEAR, WORLD.CAMERA_FAR);
camera.position.set(0, 200, 30);

const lighting = createLighting(scene);

// -------------------------------- mundo ---------------------------------
const sky = createSky(scene, { quality });
const ocean = createOcean(scene, { quality });
const islands = createIslands(scene, WORLD_DATA, { quality });
const clouds = createClouds(scene, WORLD_DATA, { quality });
const post = createPost(scene, camera); // vinheta/haze sutil (quad de tela cheia)
if (quality === 'low') post.object.visible = false;
const elephants = WORLD_DATA.routes.map((route, i) => createElephant(route, i, { quality }));
for (const e of elephants) scene.add(e.group);

// ------------------------------- jogador --------------------------------
const input = createInput(canvas);
const dove = createDove({ quality });
scene.add(dove.group);
const flight = createFlightController({ input, islandHeightAt: WORLD_DATA.islandHeightAt, elephants });
const chase = createChaseCamera(camera, flight, { input });
const audio = createAudio();
const pkg = createPackageSystem({ scene, dove, flight, elephants, islandHeightAt: WORLD_DATA.islandHeightAt });
const delivery = createDelivery({ elephants, flight, pkg, input, audio });
const hud = createHUD({ root: document.getElementById('ui'), delivery, flight, elephants, input, camera });
const map = createMapUI({ root: document.getElementById('ui'), worldData: WORLD_DATA, elephants, flight, delivery, input, camera });
clouds.attachTo?.(elephants);

// posição inicial: centro do mundo, olhando para o alvo da primeira entrega
{
  const target = delivery.target;
  let heading = DOVE.SPAWN.heading;
  if (target) {
    const p = target.position;
    heading = Math.atan2(-(p.x - DOVE.SPAWN.x), -(p.z - DOVE.SPAWN.z)); // frente local = -Z
  }
  flight.setPose({ position: new THREE.Vector3(num('x', DOVE.SPAWN.x), num('y', DOVE.SPAWN.y), num('z', DOVE.SPAWN.z)), heading: params.yaw !== undefined ? THREE.MathUtils.degToRad(num('yaw', 0)) : heading, pitch: THREE.MathUtils.degToRad(num('pitch', 0)) });
  if (params.speed !== undefined) flight.state.speed = num('speed', DOVE.SPEED_CRUISE);
}
input.onFirstInteraction(() => audio.unlock());
// Esc não conta como gesto de ativação no Chrome; garante o desbloqueio do áudio em qualquer gesto real
for (const ev of ['keydown', 'pointerdown', 'touchstart']) window.addEventListener(ev, () => audio.unlock(), { passive: true });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') audio.unlock(); });

// ------------------------------ laço ------------------------------------
const clock = new THREE.Timer();
let time = num('t', 0);
let paused = params.pause === '1';
const freeCam = params.cam === 'free';
if (freeCam) {
  camera.position.set(num('cx', 0), num('cy', 300), num('cz', 0));
  camera.lookAt(num('lx', 0), num('ly', 300), num('lz', -1000));
}
if (params.nohud === '1') document.getElementById('ui').style.display = 'none';

function tick(dt) {
  time += dt;
  for (const e of elephants) e.update(dt, time);
  flight.update(dt);
  dove.group.position.copy(flight.state.position);
  dove.group.quaternion.copy(flight.state.quaternion);
  dove.update(dt, flight.state);
  pkg.update(dt);
  delivery.update(dt);
  if (!freeCam) chase.update(dt);
  lighting.update(camera.position);
  sky.update(camera, time);
  ocean.update(camera, time);
  clouds.update(camera, time, dt);
  post.update?.(camera, time);
  islands.update?.(camera, time);
  hud.update(dt);
  map.update(dt);
  input.endFrame();
}

function frame() {
  requestAnimationFrame(frame);
  clock.update(); const dt = Math.min(clock.getDelta(), 0.05);
  if (!paused) tick(dt);
  renderer.render(scene, camera);
}
frame();

window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  if (!w || !h) return; // janela minimizada
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'low' ? 1 : 1.5));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
});

// ----------------------- ganchos de depuração/teste ---------------------
window.__ready = true;
window.__step = async (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) { tick(dt); } renderer.render(scene, camera); };
window.__stats = () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, player: flight.state.position.toArray().map((v) => Math.round(v)), target: delivery.target?.name, deliveries: delivery.count });
window.__ruppen = { THREE, scene, camera, renderer, flight, dove, elephants, delivery, pkg, map, hud, ocean, sky, clouds, islands, input, audio, worldData: WORLD_DATA, setPaused: (p) => { paused = p; }, get time() { return time; } };
