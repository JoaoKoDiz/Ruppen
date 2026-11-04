// STUB — substituído pelo agente de ambiente. Contrato: createSky(scene, opts) -> { object, update(camera, time) }
import * as THREE from 'three';
import { COLORS } from '../config.js';
export function createSky(scene, opts = {}) {
  scene.background = new THREE.Color(COLORS.skyHorizon);
  return { object: null, update(camera, time) {} };
}
