// STUB — substituído pelo agente de ambiente. Contrato: createOcean(scene, opts) -> { object, update(camera, time) }
import * as THREE from 'three';
import { COLORS } from '../config.js';
export function createOcean(scene, opts = {}) {
  const geo = new THREE.PlaneGeometry(400000, 400000, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: COLORS.oceanDeep, roughness: 0.35, metalness: 0.1 }));
  scene.add(mesh);
  return { object: mesh, update(camera, time) { mesh.position.set(camera.position.x, 0, camera.position.z); } };
}
