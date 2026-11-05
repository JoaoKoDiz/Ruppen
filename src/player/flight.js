// =====================================================================
//  RUPPEN — controlador de voo da pomba (modelo arcade suave e "pesado").
//  Contrato (ARCHITECTURE.md 4.6):
//    createFlightController({ input, islandHeightAt, elephants })
//      → { state, update(dt), setPose({ position, heading, pitch }) }
//  Convenção: frente local = −Z, cima = +Y, direita = +X;
//  quaternion = Euler(pitch, heading, roll, 'YXZ'); pitch > 0 = nariz para
//  cima; heading cresce virando à esquerda; roll > 0 = asa direita sobe.
// =====================================================================
import * as THREE from 'three';
import { DOVE, WORLD, FLIGHT } from '../config.js';

const clamp = THREE.MathUtils.clamp;
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// Amortecimento exponencial independente do dt.
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

export function createFlightController({ input, islandHeightAt, elephants = [] }) {
  const heightAt = typeof islandHeightAt === 'function' ? islandHeightAt : () => -Infinity;
  const groundAt = (x, z) => Math.max(WORLD.SEA_LEVEL, heightAt(x, z));

  const state = {
    position: new THREE.Vector3(DOVE.SPAWN.x, DOVE.SPAWN.y, DOVE.SPAWN.z),
    quaternion: new THREE.Quaternion(),
    velocity: new THREE.Vector3(0, 0, -DOVE.SPEED_CRUISE),
    forward: new THREE.Vector3(0, 0, -1),
    up: new THREE.Vector3(0, 1, 0),
    right: new THREE.Vector3(1, 0, 0),
    heading: DOVE.SPAWN.heading,
    pitch: 0,
    roll: 0,
    speed: DOVE.SPEED_CRUISE,
    boost: false,
    altitude: DOVE.SPAWN.y,     // altura sobre a água/relevo logo abaixo
    groundHeight: 0,            // altura do relevo (ou mar) logo abaixo
    climbInput: 0,              // −1..1 suavizado (animação da pomba)
    turnInput: 0,               // −1..1 suavizado
    yawRate: 0,                 // rad/s efetivo (inclui a volta dos limites do mundo)
    autoPull: 0,                // 0..1 — quanto o relevo à frente está puxando o nariz
    colliding: false,           // tocou um elefante neste quadro
    collideTimer: 0,            // s restantes de autoridade reduzida
    outOfBounds: 0,             // 0..1 — quão fora da área jogável
  };

  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const prev = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const hitN = new THREE.Vector3(0, 1, 0); // normal do último toque num elefante

  // --------------------------- leitura das teclas ------------------------
  function readInput() {
    const d = (c) => !!input && typeof input.isDown === 'function' && input.isDown(c);
    let turn = (d('KeyA') || d('ArrowLeft') ? 1 : 0) - (d('KeyD') || d('ArrowRight') ? 1 : 0);
    let climb = (d('KeyW') || d('ArrowUp') ? 1 : 0) - (d('KeyS') || d('ArrowDown') ? 1 : 0);
    let boost = d('ShiftLeft') || d('ShiftRight');
    // Eixos analógicos (toque/gamepad) se o módulo de entrada os fornecer.
    const ax = input && input.axes;
    if (ax) {
      if (turn === 0 && typeof ax.yaw === 'number') turn = clamp(ax.yaw, -1, 1);
      if (climb === 0 && typeof ax.pitch === 'number') climb = clamp(ax.pitch, -1, 1);
      boost = boost || !!ax.boost;
    }
    return { turn, climb, boost };
  }

  // ------------------------- vetores de orientação -----------------------
  function refreshOrientation() {
    euler.set(state.pitch, state.heading, state.roll, 'YXZ');
    state.quaternion.setFromEuler(euler);
    state.forward.set(0, 0, -1).applyQuaternion(state.quaternion);
    state.up.set(0, 1, 0).applyQuaternion(state.quaternion);
    state.right.set(1, 0, 0).applyQuaternion(state.quaternion);
  }

  // --------------------- colisão suave com os elefantes ------------------
  function collideElephants(dt) {
    state.colliding = false;
    const broad2 = FLIGHT.BROADPHASE_DIST * FLIGHT.BROADPHASE_DIST;
    for (const e of elephants) {
      if (!e || !e.colliders || !e.position) continue;
      if (tmp.subVectors(state.position, e.position).lengthSq() > broad2) continue;
      for (const c of e.colliders) {
        if (!c || !c.center) continue;
        nrm.subVectors(state.position, c.center);
        const dist = nrm.length();
        const minD = c.radius + FLIGHT.COLLIDER_RADIUS;
        if (dist >= minD) continue;
        if (dist < 1e-4) nrm.set(0, 1, 0); else nrm.divideScalar(dist);
        hitN.copy(nrm);
        // empurra para fora pela normal da esfera
        state.position.copy(c.center).addScaledVector(nrm, minD);
        state.colliding = true;
        state.collideTimer = FLIGHT.COLLIDE_TIME;
        // desliza: vira para longe da superfície e acompanha a inclinação dela
        const side = nrm.dot(state.right);
        state.heading = wrapAngle(state.heading - Math.sign(side) * Math.min(1, Math.abs(side) * 2.5) * 1.4 * dt);
        state.pitch = clamp(state.pitch + nrm.y * 2.2 * dt, -DOVE.MAX_PITCH, DOVE.MAX_PITCH);
        // raspar na pele tira velocidade
        state.speed = Math.max(DOVE.SPEED_MIN, state.speed * (1 - 1.6 * dt));
      }
    }
  }

  // ------------------------------- update --------------------------------
  function update(dt) {
    if (!(dt > 0)) { refreshOrientation(); state.groundHeight = groundAt(state.position.x, state.position.z); state.altitude = state.position.y - state.groundHeight; return; }
    const p = state.position;
    const raw = readInput();
    state.boost = raw.boost;
    const authority = state.collideTimer > 0 ? 0.45 : 1;
    state.climbInput = damp(state.climbInput, raw.climb * authority, FLIGHT.INPUT_SMOOTH, dt);
    state.turnInput = damp(state.turnInput, raw.turn * authority, FLIGHT.INPUT_SMOOTH, dt);
    state.collideTimer = Math.max(0, state.collideTimer - dt);

    // ---- antecipação do relevo: amostra o chão à frente e puxa o nariz se for bater
    const la = FLIGHT.LOOKAHEAD_TIME * state.speed;
    const fx = state.forward.x, fz = state.forward.z;
    const fl = Math.hypot(fx, fz) || 1;
    const gAhead = groundAt(p.x + (fx / fl) * la, p.z + (fz / fl) * la);
    const gMid = groundAt(p.x + (fx / fl) * la * 0.5, p.z + (fz / fl) * la * 0.5);
    const yAhead = p.y + state.forward.y * la;
    const need = Math.max(gAhead, gMid) + DOVE.ALT_MIN + FLIGHT.LOOKAHEAD_MARGIN - yAhead;
    state.autoPull = need > 0 ? clamp(need / 40, 0, 1) : 0;

    // ---- pitch: comando + puxada automática + auto-nivelamento + teto
    let pitchRate = state.climbInput * DOVE.PITCH_RATE;
    if (state.autoPull > 0) pitchRate = Math.max(pitchRate, state.autoPull * DOVE.PITCH_RATE * 1.4);
    state.pitch += pitchRate * dt;
    const level = (1 - Math.min(1, Math.abs(state.climbInput))) * FLIGHT.PITCH_RETURN;
    state.pitch = damp(state.pitch, 0, level, dt);
    const overTop = (p.y - (DOVE.ALT_MAX - 200)) / 200;       // 0 a 200 m do teto: limita a subida
    if (overTop > 0) state.pitch = Math.min(state.pitch, DOVE.MAX_PITCH * Math.max(0, 1 - overTop));
    state.pitch = clamp(state.pitch, -DOVE.MAX_PITCH, DOVE.MAX_PITCH);

    // ---- guinada: menos eficaz com o nariz muito inclinado; limites do mundo
    const turnScale = 1 - Math.abs(state.pitch) * 0.3;
    let yawRate = state.turnInput * DOVE.TURN_RATE * turnScale;
    const soft = WORLD.HALF - FLIGHT.BOUNDS_MARGIN;
    const out = Math.max(Math.abs(p.x) - soft, Math.abs(p.z) - soft) / FLIGHT.BOUNDS_MARGIN;
    state.outOfBounds = clamp(out, 0, 1);
    if (out > 0) {
      const toCenter = Math.atan2(p.x, p.z);                 // heading que aponta para a origem
      const diff = wrapAngle(toCenter - state.heading);
      yawRate += clamp(diff * 1.5, -DOVE.TURN_RATE, DOVE.TURN_RATE) * Math.min(1, out);
      yawRate = clamp(yawRate, -DOVE.TURN_RATE * 1.2, DOVE.TURN_RATE * 1.2);
    }
    state.heading = wrapAngle(state.heading + yawRate * dt);
    state.yawRate = yawRate;

    // ---- rolamento visual proporcional à guinada efetiva
    const bankTarget = clamp(yawRate / DOVE.TURN_RATE, -1, 1) * DOVE.MAX_BANK * FLIGHT.BANK_FACTOR;
    state.roll = damp(state.roll, bankTarget, FLIGHT.BANK_SMOOTH, dt);

    // ---- velocidade: acelera/desacelera rumo ao alvo; mergulho ganha, subida perde
    const targetSpeed = state.boost ? DOVE.SPEED_BOOST : DOVE.SPEED_CRUISE;
    const diff = targetSpeed - state.speed;
    const step = diff > 0 ? DOVE.ACCEL * dt : -DOVE.ACCEL * FLIGHT.DRAG_DECEL * dt;
    state.speed += Math.abs(diff) < Math.abs(step) ? diff : step;
    state.speed += -Math.sin(state.pitch) * FLIGHT.DIVE_ACCEL * dt;
    state.speed = clamp(state.speed, DOVE.SPEED_MIN, DOVE.SPEED_BOOST * 1.1);

    // ---- integração
    refreshOrientation();
    prev.copy(p);
    p.addScaledVector(state.forward, state.speed * dt);

    // ---- piso (água/ilha), teto e limites duros
    const ground = groundAt(p.x, p.z);
    const minY = ground + DOVE.ALT_MIN;
    if (p.y < minY) {
      p.y = minY;
      if (state.pitch < 0) state.pitch = damp(state.pitch, 0.05, 12, dt); // raspa e levanta o nariz
    }
    if (p.y > DOVE.ALT_MAX) { p.y = DOVE.ALT_MAX; if (state.pitch > 0) state.pitch = damp(state.pitch, 0, 12, dt); }
    const hard = WORLD.HALF + FLIGHT.BOUNDS_HARD;
    p.x = clamp(p.x, -hard, hard);
    p.z = clamp(p.z, -hard, hard);

    // ---- elefantes
    collideElephants(dt);
    if (state.colliding || state.collideTimer > 0) refreshOrientation();

    // ---- velocidade efetiva (inclui empurrões e pisos) e altitude
    state.velocity.copy(p).sub(prev).divideScalar(dt);
    if (state.colliding) {
      // remove a componente da velocidade que aponta para dentro do elefante
      const vn = state.velocity.dot(hitN);
      if (vn < 0) state.velocity.addScaledVector(hitN, -vn);
    }
    // empurrões/pisos podem gerar picos num único quadro: limita a velocidade informada
    const vmax = DOVE.SPEED_BOOST * 3;
    if (state.velocity.lengthSq() > vmax * vmax) state.velocity.setLength(vmax);
    state.groundHeight = groundAt(p.x, p.z);
    state.altitude = p.y - state.groundHeight;
  }

  // ------------------------------ setPose --------------------------------
  function setPose({ position, heading = 0, pitch = 0 } = {}) {
    if (position) state.position.copy(position);
    state.heading = wrapAngle(heading);
    state.pitch = clamp(pitch, -DOVE.MAX_PITCH, DOVE.MAX_PITCH);
    state.roll = 0;
    state.climbInput = 0; state.turnInput = 0; state.yawRate = 0;
    state.collideTimer = 0; state.colliding = false; state.autoPull = 0;
    refreshOrientation();
    state.velocity.copy(state.forward).multiplyScalar(state.speed);
    update(0);
  }

  update(0);
  return { state, update, setPose };
}
