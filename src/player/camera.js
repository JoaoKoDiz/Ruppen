// STUB — substituído pelo agente de voo. Contrato: createChaseCamera(camera, flight, opts) -> { update(dt) }
import * as THREE from 'three';
export function createChaseCamera(camera, flight, opts = {}) {
  const offset = new THREE.Vector3(0, 3.2, 10);
  const tmp = new THREE.Vector3();
  return {
    update(dt) {
      tmp.copy(offset).applyQuaternion(flight.state.quaternion).add(flight.state.position);
      camera.position.lerp(tmp, Math.min(1, dt * 6));
      camera.quaternion.slerp(flight.state.quaternion, Math.min(1, dt * 6));
    },
  };
}
