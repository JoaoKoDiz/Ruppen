// Teste de src/world/life.js no mundo do jogo (céu, oceano, nuvens, ilhas, 7 elefantes nas rotas reais).
// Query: view=cargo|sail|fish|birds|crowd|free  ship=<n-ésimo do tipo>  t=<s>  frames=<n>  quality=low|high
//        free: cx,cy,cz,lx,ly,lz   alt=<m> back=<m> (ajustes das vistas)   anim=1 (laço rAF)  ao=0
import * as THREE from 'three';
import { WORLD } from '../src/config.js';
import { createLighting, applyRendererDefaults } from '../src/world/lighting.js';
import { createPost } from '../src/world/post.js';
import { WORLD_DATA } from '../src/world/worldData.js';
import { createSky } from '../src/world/sky.js';
import { createOcean } from '../src/world/ocean.js';
import { createClouds } from '../src/world/clouds.js';
import { createIslands } from '../src/world/islands.js';
import { createElephant } from '../src/elephant/elephant.js';
import { createLife } from '../src/world/life.js';

const q = Object.fromEntries(new URLSearchParams(location.search));
const num = (k, d) => (q[k] !== undefined ? Number(q[k]) : d);
const quality = ['low', 'high', 'ultra'].includes(q.quality) ? q.quality : 'high';
const wq = quality === 'low' ? 'low' : 'high';
let view = q.view || 'cargo';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, logarithmicDepthBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight, false);
applyRendererDefaults(renderer);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(num('fov', 55), window.innerWidth / window.innerHeight, WORLD.CAMERA_NEAR, WORLD.CAMERA_FAR);
camera.position.set(0, 300, 0);
const lighting = createLighting(scene, renderer, { quality });
const sky = createSky(scene, { quality: wq });
const ocean = createOcean(scene, { quality: wq });
const islands = createIslands(scene, WORLD_DATA, { quality: wq });
const clouds = createClouds(scene, WORLD_DATA, { quality: wq });
const post = createPost(renderer, scene, camera, { quality, ao: q.ao !== '0', msaa: q.msaa !== undefined ? num('msaa', 4) : undefined });
clouds.attachPost?.(post);
const elephants = WORLD_DATA.routes.map((r, i) => createElephant(r, i, { quality: wq }));
for (const e of elephants) scene.add(e.group);
clouds.attachTo?.(elephants);
const life = createLife(scene, { worldData: WORLD_DATA, elephants, camera, quality: wq });
lighting.enableShadows(scene);

const V = THREE.Vector3;
const D = life.debug;
const pickShip = (type) => D.ships.filter((s) => s.type === type)[num('ship', 0)] || D.ships[0];
function aim() {
  const alt = num('alt', NaN), back = num('back', NaN);
  if (view === 'free') { camera.position.set(num('cx', 0), num('cy', 300), num('cz', 0)); camera.lookAt(num('lx', 0), num('ly', 0), num('lz', -1000)); return; }
  if (view === 'cargo') {
    const s = pickShip('CARGO'); const e = elephants[s.el] || elephants[0];
    const u = new V(s.pos.x - e.position.x, 0, s.pos.z - e.position.z).normalize();
    const side = new V(-u.z, 0, u.x);
    camera.position.copy(s.pos).addScaledVector(u, isNaN(back) ? 650 : back).addScaledVector(side, num('side', 250)).setY(isNaN(alt) ? 300 : alt);
    const look = s.pos.clone().lerp(e.position, num('mix', 0.3)); look.y = num('ly', 350);
    camera.lookAt(look);
  } else if (view === 'sail' || view === 'fish') {
    const s = pickShip(view === 'sail' ? 'DHOW' : 'FISHING');
    const f = new V(Math.cos(s.heading), 0, -Math.sin(s.heading));
    const side = new V(-f.z, 0, f.x);
    camera.position.copy(s.pos).addScaledVector(f, num('fwd', -0.6) * s.L * 3).addScaledVector(side, num('side', 1.2) * s.L * 2).setY(isNaN(alt) ? s.L * 3.2 : alt);
    camera.lookAt(s.pos.x - f.x * s.L * num('lookback', 0.8), 0, s.pos.z - f.z * s.L * num('lookback', 0.8));
  } else if (view === 'birds') {
    const fl = D.flocks[num('flock', 0)];
    const m = new THREE.Matrix4(), p = new V(), c = new V(); let n = 0;
    const mesh = life.object.getObjectByName('life_birds');
    const idx = D.birds.map((b, i) => (b.f === fl ? i : -1)).filter((i) => i >= 0);
    // câmera atrás do bando, olhando ao longo do voo (a cabeça do elefante ao fundo)
    mesh.getMatrixAt(idx[num('bird', 0)], m);
    const qq = new THREE.Quaternion(), sc = new V(); m.decompose(c, qq, sc);
    const fwd = new V(0, 0, -1).applyQuaternion(qq).setY(0).normalize(), side = new V(-fwd.z, 0, fwd.x);
    camera.position.copy(c).addScaledVector(fwd, -(isNaN(back) ? 70 : back)).addScaledVector(side, num('side', 25)).add(new V(0, isNaN(alt) ? 18 : alt, 0));
    camera.lookAt(c.clone().addScaledVector(fwd, num('ahead', 120)).lerp(fl.anchor, num('mix', 0)));
  } else if (view === 'crowd') {
    const e = elephants[num('el', 0)];
    const c = D.crowds.get(e) || D.buildCrowd(e, num('el', 0));
    const pc = e.body.localToWorld(c.focusLocal.clone());
    const f = new V(Math.cos(e.heading), 0, -Math.sin(e.heading)), side = new V(-f.z, 0, f.x);
    camera.position.copy(pc).addScaledVector(f, num('fwd', -60)).addScaledVector(side, num('side', 110)).add(new V(0, isNaN(alt) ? 150 : alt, 0));
    camera.lookAt(pc.clone().addScaledVector(f, num('lookf', 40)).addScaledVector(side, num('looks', 0)));
  }
}

let time = num('t', 30);
function tick(dt) {
  time += dt;
  for (const e of elephants) { e.setViewerPosition?.(camera.position); e.update(dt, time); }
  aim();
  camera.updateMatrixWorld();
  lighting.update(camera);
  lighting.refreshShadows(scene, dt);
  sky.update(camera, time);
  ocean.update(camera, time);
  clouds.update(camera, time, dt);
  post.update?.(camera, time);
  islands.update?.(camera, time);
  life.update(dt, time, camera);
}
for (let i = 0; i < num('frames', 2); i++) tick(1 / 30);
const clock = new THREE.Timer();
function frame() {
  requestAnimationFrame(frame);
  clock.update(); const dt = Math.min(clock.getDelta(), 0.05);
  if (q.anim === '1') tick(dt);
  post.render();
  document.getElementById('info').textContent = `life ${JSON.stringify(life.stats)}\ncalls ${renderer.info.render.calls} tris ${renderer.info.render.triangles} t=${time.toFixed(1)}`;
}
frame();
await Promise.race([lighting.envReady, new Promise((r) => setTimeout(r, 8000))]);
window.__ready = true;
window.__step = async (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) tick(dt); post.render(); };
window.__stats = () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, life: life.stats });
window.__setView = (o) => { for (const k of Object.keys(q)) if (!['quality', 'ao', 'msaa', 't', 'frames'].includes(k)) delete q[k]; Object.assign(q, o); view = q.view || 'cargo'; camera.fov = num('fov', 55); camera.updateProjectionMatrix(); };
window.__life = { life, elephants, camera, scene, THREE };
