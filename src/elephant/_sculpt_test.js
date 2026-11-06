import * as THREE from 'three';
import { getSkinGeometry } from './sculpt.js';
export function createElephant() {
  const g = getSkinGeometry(13.5);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x8a817c, vertexColors: true, roughness: 0.9 }));
  const group = new THREE.Group(); group.add(m); group.scale.setScalar(3);
  return { group, update() {} };
}
