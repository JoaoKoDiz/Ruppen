// STUB — substituído pelo modelo vencedor. Contrato: createDove(opts) -> { group, packageAnchor, update(dt, flightState) }
import * as THREE from 'three';
export function createDove(opts = {}) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 2.4), new THREE.MeshStandardMaterial({ color: 0xffffff }));
  group.add(body);
  const wings = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.08, 0.9), new THREE.MeshStandardMaterial({ color: 0xf0f0f0 }));
  group.add(wings);
  const packageAnchor = new THREE.Object3D(); packageAnchor.position.set(0, -0.3, 0.2); group.add(packageAnchor);
  return { group, packageAnchor, update(dt, flightState) {} };
}
