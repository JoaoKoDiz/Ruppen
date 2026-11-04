// STUB — substituído pelo agente de ilhas. Contrato: createIslands(scene, worldData, opts) -> { group, update?(camera, time) }
import * as THREE from 'three';
import { COLORS } from '../config.js';
export function createIslands(scene, worldData, opts = {}) {
  const group = new THREE.Group();
  for (const isl of worldData.islands) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(isl.R, isl.maxH * 0.6, 24), new THREE.MeshStandardMaterial({ color: COLORS.grass }));
    m.position.set(isl.cx, isl.maxH * 0.3, isl.cz);
    group.add(m);
  }
  scene.add(group);
  return { group, update(camera, time) {} };
}
