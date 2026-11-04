// STUB — substituído pelo agente de voo. Contrato em ARCHITECTURE.md.
import * as THREE from 'three';
import { DOVE } from '../config.js';
export function createFlightController({ input, islandHeightAt, elephants }) {
  const state = { position: new THREE.Vector3(0, 160, 0), quaternion: new THREE.Quaternion(), velocity: new THREE.Vector3(), heading: 0, pitch: 0, roll: 0, speed: DOVE.SPEED_CRUISE, boost: false, altitude: 160, forward: new THREE.Vector3(0, 0, -1) };
  const euler = new THREE.Euler();
  const api = {
    state,
    setPose({ position, heading = 0, pitch = 0 }) { if (position) state.position.copy(position); state.heading = heading; state.pitch = pitch; api.update(0); },
    update(dt) {
      const yawIn = (input.isDown('KeyA') || input.isDown('ArrowLeft') ? 1 : 0) - (input.isDown('KeyD') || input.isDown('ArrowRight') ? 1 : 0);
      const pitchIn = (input.isDown('KeyW') || input.isDown('ArrowUp') ? 1 : 0) - (input.isDown('KeyS') || input.isDown('ArrowDown') ? 1 : 0);
      state.boost = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
      state.heading += yawIn * DOVE.TURN_RATE * dt;
      state.pitch = THREE.MathUtils.clamp(state.pitch + pitchIn * DOVE.PITCH_RATE * dt - state.pitch * 0.8 * dt, -DOVE.MAX_PITCH, DOVE.MAX_PITCH);
      state.roll += (yawIn * DOVE.MAX_BANK * 0.7 - state.roll) * Math.min(1, 3 * dt);
      const target = state.boost ? DOVE.SPEED_BOOST : DOVE.SPEED_CRUISE;
      state.speed += (target - state.speed) * Math.min(1, dt * 0.8);
      euler.set(state.pitch, state.heading, state.roll, 'YXZ');
      state.quaternion.setFromEuler(euler);
      state.forward.set(0, 0, -1).applyQuaternion(state.quaternion);
      state.velocity.copy(state.forward).multiplyScalar(state.speed);
      state.position.addScaledVector(state.velocity, dt);
      const ground = Math.max(0, islandHeightAt(state.position.x, state.position.z));
      if (state.position.y < ground + DOVE.ALT_MIN) state.position.y = ground + DOVE.ALT_MIN;
      if (state.position.y > DOVE.ALT_MAX) state.position.y = DOVE.ALT_MAX;
      state.altitude = state.position.y - ground;
    },
  };
  return api;
}
