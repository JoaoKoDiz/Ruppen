// =====================================================================
//  RUPPEN — câmera de perseguição em 3ª pessoa.
//  Contrato (ARCHITECTURE.md 4.6): createChaseCamera(camera, flight, { input }) → { update(dt) }
//  Fica atrás/acima da pomba num referencial suavizado (guinada com pequeno
//  atraso, pitch parcial, rolamento reduzido para o horizonte ficar estável),
//  olha para um ponto à frente da pomba, abre o FOV no boost, treme de leve
//  em alta velocidade, nunca entra na água/relevo e aceita olhar com o mouse
//  (arrastar) com retorno automático.
// =====================================================================
import * as THREE from 'three';
import { WORLD, DOVE, CHASE_CAM as C } from '../config.js';
import { WORLD_DATA } from '../world/worldData.js';

const clamp = THREE.MathUtils.clamp;
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

export function createChaseCamera(camera, flight, opts = {}) {
  const input = opts.input || null;
  const heightAt = typeof opts.islandHeightAt === 'function' ? opts.islandHeightAt : WORLD_DATA.islandHeightAt;

  const s = {
    heading: 0, pitch: 0, roll: 0,      // referencial suavizado
    fov: C.FOV, pull: 0, time: 0,
    lookYaw: 0, lookPitch: 0,           // olhar com o mouse
    initialized: false,
  };

  const frame = new THREE.Quaternion();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const desired = new THREE.Vector3();
  const target = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const viewDir = new THREE.Vector3();
  const upv = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const qTarget = new THREE.Quaternion();

  function update(dt) {
    const f = flight.state;
    if (!(dt >= 0)) dt = 0;
    let snap = false;
    if (!s.initialized) {
      s.initialized = true; snap = true;
      s.heading = f.heading; s.pitch = f.pitch * C.PITCH_FOLLOW; s.roll = f.roll * C.ROLL_FOLLOW;
    }
    s.time += dt;

    // ---- olhar com o mouse: acumula enquanto arrasta; volta ao soltar
    const ptr = input && input.pointer;
    if (ptr && ptr.dragging) {
      s.lookYaw = clamp(s.lookYaw - ptr.dx * C.LOOK_SENS, -C.LOOK_MAX_YAW, C.LOOK_MAX_YAW);
      s.lookPitch = clamp(s.lookPitch - ptr.dy * C.LOOK_SENS * 0.7, -C.LOOK_MAX_PITCH, C.LOOK_MAX_PITCH);
    } else if (dt > 0) {
      s.lookYaw = damp(s.lookYaw, 0, C.LOOK_RETURN, dt);
      s.lookPitch = damp(s.lookPitch, 0, C.LOOK_RETURN, dt);
    }

    // ---- referencial suavizado (lag na guinada, pitch parcial, rolamento reduzido)
    if (snap || dt <= 0) {
      if (snap) { /* já copiado acima */ }
    } else {
      s.heading = wrapAngle(s.heading + wrapAngle(f.heading - s.heading) * (1 - Math.exp(-C.YAW_SMOOTH * dt)));
      s.pitch = damp(s.pitch, f.pitch * C.PITCH_FOLLOW, C.PITCH_SMOOTH, dt);
      s.roll = damp(s.roll, f.roll * C.ROLL_FOLLOW, C.ROLL_SMOOTH, dt);
    }
    const boost01 = clamp((f.speed - DOVE.SPEED_CRUISE) / (DOVE.SPEED_BOOST - DOVE.SPEED_CRUISE), 0, 1);
    s.pull = snap ? boost01 * C.BOOST_PULLBACK : damp(s.pull, boost01 * C.BOOST_PULLBACK, 2.5, dt);

    euler.set(s.pitch + s.lookPitch, s.heading + s.lookYaw, 0, 'YXZ');
    frame.setFromEuler(euler);

    // ---- posição desejada: atrás/acima no referencial suavizado (sem lag de posição,
    //      para a pomba ficar firme na tela), mais afastada no boost
    desired.set(C.OFFSET.x, C.OFFSET.y, C.OFFSET.z + s.pull).applyQuaternion(frame).add(f.position);

    // tremor sutil em alta velocidade
    if (boost01 > 0.05) {
      const a = C.SHAKE * boost01;
      desired.x += Math.sin(s.time * 31.0) * a * 0.6;
      desired.y += Math.sin(s.time * 43.0 + 1.3) * a;
      desired.z += Math.sin(s.time * 37.0 + 2.1) * a * 0.4;
    }

    // nunca abaixo da água/relevo
    const floor = Math.max(WORLD.SEA_LEVEL, heightAt(desired.x, desired.z)) + C.MIN_ABOVE_GROUND;
    if (desired.y < floor) desired.y = floor;
    camera.position.copy(desired);

    // ---- orientação: olha um ponto à frente da pomba; up com rolamento reduzido
    fwd.set(0, 0, -1).applyQuaternion(frame);
    target.copy(f.position).addScaledVector(fwd, C.LOOK_AHEAD);
    target.y += C.LOOK_UP;
    viewDir.subVectors(target, camera.position).normalize();
    // roll > 0 = asa direita sobe: giro do "up" em torno do eixo +Z local (= −viewDir)
    upv.set(0, 1, 0).applyAxisAngle(viewDir, -s.roll);
    m.lookAt(camera.position, target, upv);
    qTarget.setFromRotationMatrix(m);
    if (snap || dt <= 0) camera.quaternion.copy(qTarget);
    else camera.quaternion.slerp(qTarget, 1 - Math.exp(-14 * dt));

    // ---- FOV: abre no boost
    const fovTarget = C.FOV + (C.FOV_BOOST - C.FOV) * boost01;
    s.fov = snap ? fovTarget : damp(s.fov, fovTarget, C.FOV_SMOOTH, dt);
    if (Math.abs(camera.fov - s.fov) > 0.01) { camera.fov = s.fov; camera.updateProjectionMatrix(); }
  }

  return { update, state: s };
}
