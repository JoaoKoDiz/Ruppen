// =====================================================================
//  RUPPEN — sistema da encomenda: cesta-gaiola esférica de metal com uma
//  caixa de madeira e uma trouxa de pano dentro, pendurada por uma corda em
//  dove.packageAnchor (DOVE.ROPE_LENGTH), com pêndulo (atraso/arrasto),
//  queda com gravidade + arrasto, pouso nos elefantes (fica presa ao grupo)
//  e perda no mar/ilhas (splash/poeira).
//  Contrato (ARCHITECTURE.md 4.6):
//    createPackageSystem({ scene, dove, flight, elephants, islandHeightAt })
//      → { attached, canDrop(), drop() → bool, onLanded(cb), onLost(cb),
//          attachNew(), update(dt), landedCount }
// =====================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DOVE, WORLD, COLORS, PACKAGE as P, FLIGHT } from '../config.js';

const clamp = THREE.MathUtils.clamp;
const hex = (c) => '#' + c.toString(16).padStart(6, '0');

// ---------------------------------------------------------------------
//  Texturas procedurais (atlas 2×2): madeira | metal / pano | corda
// ---------------------------------------------------------------------
const REGION = { wood: [0, 0], metal: [0.5, 0], cloth: [0, 0.5], rope: [0.5, 0.5] };
const INSET = 0.012; // evita sangrar entre regiões nos mipmaps

function makeAtlas() {
  const S = 512, Q = S / 2;
  const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
  const g = cv.getContext('2d');
  const rnd = () => Math.random(); // efêmero/visual: pode usar Math.random

  // --- madeira (tábuas horizontais, veios, pregos) — quadrante inferior-esquerdo no canvas
  // (v = 0 fica embaixo no canvas, por isso o quadrante "wood" [0,0] é desenhado em y = Q..S)
  const drawWood = (ox, oy) => {
    g.fillStyle = hex(COLORS.wood); g.fillRect(ox, oy, Q, Q);
    const planks = 4, ph = Q / planks;
    for (let i = 0; i < planks; i++) {
      const y = oy + i * ph;
      const tone = 0.9 + rnd() * 0.2;
      g.fillStyle = `rgb(${Math.round(138 * tone)}, ${Math.round(90 * tone)}, ${Math.round(43 * tone)})`;
      g.fillRect(ox, y + 3, Q, ph - 6);
      // veios ondulados
      g.strokeStyle = 'rgba(60, 35, 12, 0.35)'; g.lineWidth = 1.2;
      for (let k = 0; k < 7; k++) {
        const yy = y + 6 + rnd() * (ph - 12);
        g.beginPath();
        for (let x = 0; x <= Q; x += 8) g.lineTo(ox + x, yy + Math.sin((x + k * 37) * 0.07) * 2.2 + Math.sin(x * 0.021) * 1.5);
        g.stroke();
      }
      // sombra entre as tábuas
      g.fillStyle = 'rgba(30, 18, 6, 0.75)'; g.fillRect(ox, y, Q, 3); g.fillRect(ox, y + ph - 3, Q, 3);
      // pregos nas pontas
      for (const nx of [14, Q - 14]) {
        g.fillStyle = '#2b2b2e'; g.beginPath(); g.arc(ox + nx, y + ph / 2, 3.2, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#9d9da3'; g.beginPath(); g.arc(ox + nx - 1, y + ph / 2 - 1, 1.4, 0, Math.PI * 2); g.fill();
      }
    }
    // sarrafos diagonais (reforço) sutis
    g.strokeStyle = 'rgba(70, 42, 16, 0.45)'; g.lineWidth = 10;
    g.beginPath(); g.moveTo(ox + 6, oy + Q - 6); g.lineTo(ox + Q - 6, oy + 6); g.stroke();
  };
  // --- metal escuro escovado (gaiola)
  const drawMetal = (ox, oy) => {
    g.fillStyle = hex(COLORS.cage); g.fillRect(ox, oy, Q, Q);
    for (let i = 0; i < 1400; i++) {
      const x = ox + rnd() * Q, y = oy + rnd() * Q, l = 3 + rnd() * 18;
      g.strokeStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.12)';
      g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + l, y); g.stroke();
    }
  };
  // --- pano laranja com dobras e faixas creme
  const drawCloth = (ox, oy) => {
    g.fillStyle = hex(COLORS.cloth); g.fillRect(ox, oy, Q, Q);
    g.fillStyle = hex(COLORS.cream);
    for (let i = 0; i < 3; i++) g.fillRect(ox, oy + 30 + i * 80, Q, 14);
    g.fillStyle = hex(COLORS.clothDark);
    for (let i = 0; i < 3; i++) g.fillRect(ox, oy + 48 + i * 80, Q, 4);
    // dobras diagonais suaves
    for (let i = 0; i < 26; i++) {
      g.strokeStyle = i % 2 ? 'rgba(255,240,220,0.18)' : 'rgba(120,50,20,0.22)'; g.lineWidth = 2 + rnd() * 5;
      const x = ox + rnd() * Q;
      g.beginPath(); g.moveTo(x, oy); g.lineTo(x - 70 + rnd() * 40, oy + Q); g.stroke();
    }
  };
  // --- corda trançada
  const drawRope = (ox, oy) => {
    g.fillStyle = hex(COLORS.rope); g.fillRect(ox, oy, Q, Q);
    g.strokeStyle = 'rgba(70, 50, 25, 0.45)'; g.lineWidth = 6;
    for (let y = -40; y < Q + 40; y += 16) { g.beginPath(); g.moveTo(ox, oy + y); g.lineTo(ox + Q, oy + y + 40); g.stroke(); }
    g.strokeStyle = 'rgba(255, 240, 200, 0.25)'; g.lineWidth = 3;
    for (let y = -40; y < Q + 40; y += 16) { g.beginPath(); g.moveTo(ox, oy + y + 7); g.lineTo(ox + Q, oy + y + 47); g.stroke(); }
  };
  // canvas: y cresce para baixo; v cresce para cima → região [u0,v0] fica em (u0*S, (1-v0)*S - Q)
  const at = (r) => [REGION[r][0] * S, (1 - REGION[r][1]) * S - Q];
  drawWood(...at('wood')); drawMetal(...at('metal')); drawCloth(...at('cloth')); drawRope(...at('rope'));

  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  map.anisotropy = 4;

  // mapa de rugosidade (G) / metalicidade (B) por região
  const oc = document.createElement('canvas'); oc.width = 64; oc.height = 64;
  const og = oc.getContext('2d');
  const orm = (r, rough, metal) => { const [x, y] = at(r); og.fillStyle = `rgb(0, ${Math.round(rough * 255)}, ${Math.round(metal * 255)})`; og.fillRect(x / 8, y / 8, 32, 32); };
  orm('wood', 0.82, 0.0); orm('metal', 0.42, 0.75); orm('cloth', 0.95, 0.0); orm('rope', 0.92, 0.0);
  const ormTex = new THREE.CanvasTexture(oc);
  ormTex.minFilter = THREE.NearestFilter; ormTex.magFilter = THREE.NearestFilter; ormTex.generateMipmaps = false;
  return { map, ormTex };
}

// Remapeia os UVs de uma geometria para um quadrante do atlas.
function toRegion(geo, region, tile = 1) {
  const [u0, v0] = REGION[region];
  const uv = geo.attributes.uv;
  const span = 0.5 - 2 * INSET;
  for (let i = 0; i < uv.count; i++) {
    let u = (uv.getX(i) * tile) % 1, v = (uv.getY(i) * tile) % 1;
    if (u < 0) u += 1; if (v < 0) v += 1;
    uv.setXY(i, u0 + INSET + u * span, v0 + INSET + v * span);
  }
  return geo;
}
const placed = (geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  geo.applyMatrix4(m);
  return geo;
};

// ---------------------------------------------------------------------
//  Geometria da cesta (uma única malha): origem = gancho no topo (onde a corda prende).
// ---------------------------------------------------------------------
function buildBasketGeometry(R) {
  const parts = [];
  const cy = -(R + 0.1);        // centro da esfera (abaixo do gancho)
  const band = 0.026;           // raio das barras
  const seg = 6, around = 40;
  // anéis de latitude: equador e ±0,5R
  parts.push(toRegion(placed(new THREE.TorusGeometry(R, band, seg, around), 0, cy, 0, Math.PI / 2), 'metal'));
  for (const s of [-1, 1]) parts.push(toRegion(placed(new THREE.TorusGeometry(R * 0.866, band, seg, around), 0, cy + s * 0.5 * R, 0, Math.PI / 2), 'metal'));
  // meridianos (verticais) a 0°, 45°, 90°, 135°
  for (let k = 0; k < 4; k++) parts.push(toRegion(placed(new THREE.TorusGeometry(R, band, seg, around), 0, cy, 0, 0, (k * Math.PI) / 4), 'metal'));
  // anel-gancho no topo e pequeno cone de junção
  parts.push(toRegion(placed(new THREE.TorusGeometry(0.075, 0.018, 6, 18), 0, -0.02, 0), 'metal'));
  parts.push(toRegion(placed(new THREE.CylinderGeometry(0.035, 0.06, 0.09, 10), 0, -0.1, 0), 'metal'));
  // fundo: disco de metal sobre o anel inferior
  parts.push(toRegion(placed(new THREE.CircleGeometry(R * 0.866, 28), 0, cy - 0.5 * R + 0.005, 0, -Math.PI / 2), 'metal'));
  // caixa de madeira (tábuas) assentada no fundo
  const crateY = cy - 0.5 * R + 0.26;
  parts.push(toRegion(placed(new THREE.BoxGeometry(0.62, 0.5, 0.62, 1, 1, 1), 0, crateY, 0.03, 0, 0.12, 0), 'wood'));
  // trouxa de pano sobre a caixa + nó
  parts.push(toRegion(placed(new THREE.SphereGeometry(0.24, 14, 10), 0.14, crateY + 0.25 + 0.14, -0.12, 0, 0, 0, 1.05, 0.7, 0.9), 'cloth', 2));
  parts.push(toRegion(placed(new THREE.SphereGeometry(0.075, 8, 6), 0.17, crateY + 0.25 + 0.3, -0.1, 0, 0, 0, 1.2, 0.8, 1), 'cloth', 2));
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  merged.computeBoundingSphere();
  return merged;
}

// ---------------------------------------------------------------------
//  Texturas dos efeitos (anel de espuma, borrifo/poeira)
// ---------------------------------------------------------------------
function makeRingTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 34, 64, 64, 62);
  grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.45, 'rgba(255,255,255,0.95)'); grd.addColorStop(0.75, 'rgba(255,255,255,0.6)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function makePuffTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------------------------------------------------------------------
//  createPackageSystem
// ---------------------------------------------------------------------
export function createPackageSystem({ scene, dove, flight, elephants = [], islandHeightAt }) {
  const heightAt = typeof islandHeightAt === 'function' ? islandHeightAt : () => -Infinity;
  const groundAt = (x, z) => Math.max(WORLD.SEA_LEVEL, heightAt(x, z));
  const R = P.CAGE_RADIUS;
  const CAGE_HEIGHT = 2 * R + 0.1;     // do gancho (origem) ao fundo da esfera
  const L = DOVE.ROPE_LENGTH;

  // ---- materiais/geometrias compartilhados
  const { map, ormTex } = makeAtlas();
  const basketMat = new THREE.MeshStandardMaterial({ map, roughnessMap: ormTex, metalnessMap: ormTex, roughness: 1, metalness: 1 });
  const basketGeo = buildBasketGeometry(R);
  const ropeMat = new THREE.MeshStandardMaterial({ color: COLORS.rope, roughness: 0.9, metalness: 0 });
  const ropeGeo = new THREE.CylinderGeometry(P.ROPE_RADIUS, P.ROPE_RADIUS, 1, 6, 1, true);
  const ringTex = makeRingTexture(), puffTex = makePuffTexture();

  const rope = new THREE.Mesh(ropeGeo, ropeMat);
  rope.frustumCulled = false; rope.visible = false; rope.name = 'packageRope';
  scene.add(rope);

  // ---- estado
  const state = {
    attached: false, falling: false, cage: null,
    p: new THREE.Vector3(), v: new THREE.Vector3(), pPrev: new THREE.Vector3(),
    anchor: new THREE.Vector3(), anchorPrev: new THREE.Vector3(), anchorVel: new THREE.Vector3(),
    initialized: false, scaleT: 1, fallTime: 0, yaw: 0, spin: new THREE.Vector3(),
    reattachTimer: -1,
  };
  const landedList = [];
  let landedTotal = 0;
  const landedCbs = [], lostCbs = [];
  const effects = [];

  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), up = new THREE.Vector3();
  const qTilt = new THREE.Quaternion(), qYaw = new THREE.Quaternion(), qUpright = new THREE.Quaternion();
  const Y = new THREE.Vector3(0, 1, 0);

  function makeCage() {
    const grp = new THREE.Group(); grp.name = 'packageCage';
    const mesh = new THREE.Mesh(basketGeo, basketMat);
    grp.add(mesh);
    return grp;
  }
  function getAnchorWorld(out) {
    const a = dove && dove.packageAnchor;
    if (a && a.getWorldPosition) return a.getWorldPosition(out);
    if (dove && dove.group) { out.set(0, -0.4, 0.2).applyQuaternion(dove.group.quaternion).add(dove.group.position); return out; }
    return out.copy(flight.state.position);
  }
  function placeRope(a, b) {
    rope.position.lerpVectors(a, b, 0.5);
    tmp.subVectors(b, a);
    const len = tmp.length();
    rope.scale.set(1, Math.max(0.01, len), 1);
    if (len > 1e-5) rope.quaternion.setFromUnitVectors(Y, tmp.divideScalar(len));
  }

  // ------------------------------ ciclo de vida ----------------------------
  function attachNew() {
    if (state.cage && (state.attached || state.falling)) { scene.remove(state.cage); }
    state.cage = makeCage();
    scene.add(state.cage);
    state.attached = true; state.falling = false; state.initialized = false;
    state.scaleT = 0; state.reattachTimer = -1; state.fallTime = 0;
    state.cage.scale.setScalar(0.01);
    rope.visible = true;
    return true;
  }
  function canDrop() { return state.attached && !state.falling && state.scaleT >= 1; }
  function drop() {
    if (!canDrop()) return false;
    state.attached = false; state.falling = true; state.fallTime = 0;
    rope.visible = false;
    // velocidade inicial = a da cesta (já acompanha a pomba) com um toque da pomba
    state.v.lerp(flight.state.velocity, 0.25);
    state.spin.set((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 1.2);
    return true;
  }
  function land(elephant, surfaceY) {
    const cage = state.cage;
    state.p.y = surfaceY + CAGE_HEIGHT;
    cage.position.copy(state.p);
    qYaw.setFromAxisAngle(Y, state.yaw);
    cage.quaternion.copy(qYaw);
    cage.scale.setScalar(1);
    cage.updateMatrixWorld(true);
    const holder = elephant.body || elephant.group; if (holder) holder.attach(cage);
    landedList.push({ cage, elephant });
    landedTotal++;
    while (landedList.length > P.MAX_LANDED) {
      const old = landedList.shift();
      old.cage.parent?.remove(old.cage);
    }
    const position = state.p.clone();
    state.falling = false; state.attached = false; state.cage = null;
    if (landedCbs.length === 0 && lostCbs.length === 0) state.reattachTimer = P.AUTO_REATTACH_DELAY;
    for (const cb of landedCbs) { try { cb({ elephant, position }); } catch (e) { console.warn('[package] onLanded', e); } }
  }
  function lose(groundY, onWater) {
    const position = state.p.clone(); position.y = groundY;
    spawnImpact(position, onWater);
    scene.remove(state.cage);
    state.falling = false; state.attached = false; state.cage = null;
    if (landedCbs.length === 0 && lostCbs.length === 0) state.reattachTimer = P.AUTO_REATTACH_DELAY;
    for (const cb of lostCbs) { try { cb({ position, onWater }); } catch (e) { console.warn('[package] onLost', e); } }
  }

  // ------------------------------ efeitos ---------------------------------
  function spawnImpact(pos, onWater) {
    const grp = new THREE.Group(); grp.position.copy(pos); grp.position.y += 0.05;
    const items = [];
    const tint = onWater ? new THREE.Color(COLORS.foam) : new THREE.Color(0xc8b48c);
    if (onWater) {
      for (let i = 0; i < 2; i++) {
        const mat = new THREE.MeshBasicMaterial({ map: ringTex, color: tint, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
        mat.fog = true;
        const ring = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.1 + i * 0.05;
        grp.add(ring); items.push({ obj: ring, kind: 'ring', delay: i * 0.18, r0: 0.6, r1: 7 + i * 3 });
      }
    }
    const nPuff = onWater ? 3 : 4;
    for (let i = 0; i < nPuff; i++) {
      const mat = new THREE.SpriteMaterial({ map: puffTex, color: tint, transparent: true, opacity: 0.85, depthWrite: false });
      const sp = new THREE.Sprite(mat);
      const ang = (i / nPuff) * Math.PI * 2 + Math.random();
      sp.position.set(Math.cos(ang) * 0.6, 0.5, Math.sin(ang) * 0.6);
      grp.add(sp);
      items.push({ obj: sp, kind: 'puff', delay: i * 0.05, s0: 0.8, s1: onWater ? 4.5 : 3.5, rise: onWater ? 4.5 : 2.2, vx: Math.cos(ang) * 1.6, vz: Math.sin(ang) * 1.6 });
    }
    scene.add(grp);
    effects.push({ grp, items, t: 0 });
  }
  function updateEffects(dt) {
    for (let i = effects.length - 1; i >= 0; i--) {
      const fx = effects[i]; fx.t += dt;
      const T = P.SPLASH_TIME;
      for (const it of fx.items) {
        const k = clamp((fx.t - it.delay) / (T - it.delay), 0, 1);
        const e = 1 - (1 - k) * (1 - k);       // ease-out
        if (it.kind === 'ring') {
          const r = it.r0 + (it.r1 - it.r0) * e;
          it.obj.scale.set(r, r, 1);
          it.obj.material.opacity = 0.9 * (1 - k);
          it.obj.visible = k > 0;
        } else {
          const s = it.s0 + (it.s1 - it.s0) * e;
          it.obj.scale.set(s, s * (0.8 + 0.5 * e), 1);
          it.obj.position.y = 0.5 + it.rise * e;
          it.obj.position.x += it.vx * dt; it.obj.position.z += it.vz * dt;
          it.obj.material.opacity = 0.85 * (1 - k * k);
          it.obj.visible = k > 0;
        }
      }
      if (fx.t >= T) {
        scene.remove(fx.grp);
        for (const it of fx.items) { it.obj.material.dispose(); if (!it.obj.isSprite) it.obj.geometry?.dispose?.(); }
        effects.splice(i, 1);
      }
    }
  }

  // ------------------------------- física --------------------------------
  function updateHanging(dt) {
    const cage = state.cage;
    getAnchorWorld(state.anchor);
    // primeira vez ou teleporte da pomba: pendura reta abaixo da âncora
    if (!state.initialized || state.anchor.distanceToSquared(state.anchorPrev) > (DOVE.SPEED_BOOST * dt * 4 + 5) ** 2) {
      state.p.copy(state.anchor); state.p.y -= L;
      state.v.copy(flight.state.velocity);
      state.anchorPrev.copy(state.anchor);
      state.initialized = true;
    }
    state.anchorVel.subVectors(state.anchor, state.anchorPrev).divideScalar(dt);
    const vmax = DOVE.SPEED_BOOST * 1.5;
    if (state.anchorVel.lengthSq() > vmax * vmax) state.anchorVel.setLength(vmax);
    state.anchorPrev.copy(state.anchor);

    // gravidade, arrasto do ar e amortecimento do balanço (relativo à âncora)
    state.v.y -= P.GRAVITY * dt;
    const sp = state.v.length();
    state.v.multiplyScalar(Math.max(0, 1 - P.DRAG_HANGING * sp * dt));
    tmp.subVectors(state.v, state.anchorVel).multiplyScalar(Math.max(0, 1 - P.SWING_DAMPING * dt));
    state.v.copy(state.anchorVel).add(tmp);

    state.pPrev.copy(state.p);
    state.p.addScaledVector(state.v, dt);
    // corda: só puxa (restrição de distância)
    tmp.subVectors(state.p, state.anchor);
    const len = tmp.length();
    if (len > L) state.p.copy(state.anchor).addScaledVector(tmp, L / len);
    // não afunda na água/relevo: a cesta raspa a superfície
    const floor = groundAt(state.p.x, state.p.z) + CAGE_HEIGHT + 0.15;
    if (state.p.y < floor) state.p.y = floor;
    state.v.subVectors(state.p, state.pPrev).divideScalar(dt);

    // orientação: eixo da cesta ao longo da corda; guinada acompanha a pomba
    up.subVectors(state.anchor, state.p);
    const ul = up.length();
    if (ul > 1e-4) up.divideScalar(ul); else up.set(0, 1, 0);
    state.yaw = flight.state.heading;
    qTilt.setFromUnitVectors(Y, up);
    qYaw.setFromAxisAngle(Y, state.yaw);
    cage.quaternion.copy(qTilt).multiply(qYaw);
    cage.position.copy(state.p);
    placeRope(state.anchor, state.p);
  }

  function updateFalling(dt) {
    const cage = state.cage;
    state.fallTime += dt;
    // gravidade + arrasto quadrático (velocidade terminal P.TERMINAL_SPEED)
    state.v.y -= P.GRAVITY * dt;
    const sp = state.v.length();
    const k = P.GRAVITY / (P.TERMINAL_SPEED * P.TERMINAL_SPEED);
    state.v.multiplyScalar(Math.max(0, 1 - k * sp * dt));
    state.pPrev.copy(state.p);
    state.p.addScaledVector(state.v, dt);

    // tomba devagar e vai se endireitando (aerodinâmica)
    qUpright.setFromAxisAngle(Y, state.yaw);
    cage.quaternion.slerp(qUpright, 1 - Math.exp(-0.8 * dt));
    tmp.copy(state.spin).multiplyScalar(dt);
    const a = tmp.length();
    if (a > 1e-6) { qTilt.setFromAxisAngle(tmp.divideScalar(a), a); cage.quaternion.multiply(qTilt); }
    state.spin.multiplyScalar(Math.max(0, 1 - 0.6 * dt));
    cage.position.copy(state.p);

    // pouso num elefante? (cruzando a superfície vindo de cima)
    const bottom = state.p.y - CAGE_HEIGHT;
    const broad2 = FLIGHT.BROADPHASE_DIST * FLIGHT.BROADPHASE_DIST;
    for (const e of elephants) {
      if (!e || !e.position || typeof e.getSurfaceHeight !== 'function') continue;
      const dx = state.p.x - e.position.x, dz = state.p.z - e.position.z;
      if (dx * dx + dz * dz > broad2) continue;
      const h = e.getSurfaceHeight(state.p.x, state.p.z);
      if (h === null || h === undefined || !Number.isFinite(h)) continue;
      if (bottom > h) continue;
      // estava fora da superfície no quadro anterior? (vindo de cima ou entrando de lado num degrau da cidade)
      const hPrev = e.getSurfaceHeight(state.pPrev.x, state.pPrev.z);
      const prevBottom = state.pPrev.y - CAGE_HEIGHT;
      const wasOutside = hPrev === null || hPrev === undefined || !Number.isFinite(hPrev) || prevBottom > hPrev;
      if (wasOutside) {
        // entrou de lado numa parede (muito abaixo do novo topo): pousa no pé da parede, na posição anterior
        if (bottom < h - P.LAND_DEPTH_TOLERANCE && hPrev !== null && Number.isFinite(hPrev)) { state.p.x = state.pPrev.x; state.p.z = state.pPrev.z; land(e, hPrev); return; }
        land(e, h); return;
      }
    }
    // mar ou ilha?
    const g = groundAt(state.p.x, state.p.z);
    if (bottom <= g) { lose(g, g <= WORLD.SEA_LEVEL + 1e-3); return; }
    if (state.fallTime > P.FALL_TIMEOUT) { lose(g, g <= WORLD.SEA_LEVEL + 1e-3); return; }
  }

  // ------------------------------- update --------------------------------
  function update(dt) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.05);
    if (effects.length) updateEffects(dt);
    if (state.reattachTimer >= 0) {
      state.reattachTimer -= dt;
      if (state.reattachTimer < 0 && !state.attached && !state.falling) attachNew();
    }
    if (state.attached && state.cage) {
      updateHanging(dt);
      // animação de aparecer (escala com leve "pulo")
      if (state.scaleT < 1) {
        state.scaleT = Math.min(1, state.scaleT + dt / P.SCALE_IN_TIME);
        const t = state.scaleT, c1 = 1.70158, c3 = c1 + 1;
        const s = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); // easeOutBack
        state.cage.scale.setScalar(Math.max(0.01, s));
      }
    } else if (state.falling && state.cage) {
      updateFalling(dt);
    } else {
      rope.visible = false;
    }
  }

  // Começa com uma cesta pendurada.
  attachNew();
  state.scaleT = 1; state.cage.scale.setScalar(1);

  return {
    get attached() { return state.attached; },
    set attached(v) { if (v && !state.attached) attachNew(); else if (!v && state.attached) { scene.remove(state.cage); state.cage = null; state.attached = false; rope.visible = false; } },
    get falling() { return state.falling; },
    get landedCount() { return landedTotal; },
    get landed() { return landedList; },
    get cage() { return state.cage; },
    get cagePosition() { return state.p; },
    canDrop, drop, attachNew, update,
    onLanded(cb) { if (typeof cb === 'function') landedCbs.push(cb); },
    onLost(cb) { if (typeof cb === 'function') lostCbs.push(cb); },
    dispose() {
      scene.remove(rope); if (state.cage) scene.remove(state.cage);
      for (const l of landedList) l.cage.parent?.remove(l.cage);
      basketGeo.dispose(); basketMat.dispose(); ropeGeo.dispose(); ropeMat.dispose(); map.dispose(); ormTex.dispose(); ringTex.dispose(); puffTex.dispose();
    },
  };
}
