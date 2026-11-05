// Iluminação e névoa compartilhadas por main.js e pelo preview de desenvolvimento.
import * as THREE from 'three';
import { COLORS, SUN_DIR, WORLD } from '../config.js';

export const sunDirection = new THREE.Vector3(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z).normalize();

export function createLighting(scene) {
  // Luz suave como nas referências: sol moderado, muita luz de céu/ambiente → sombras cinza-azuladas, nunca pretas.
  const sun = new THREE.DirectionalLight(COLORS.sunLight, 2.0);
  sun.position.copy(sunDirection).multiplyScalar(10000);
  sun.target.position.set(0, 0, 0);
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight(0xd9e6f6, 0x5b7392, 1.75);
  scene.add(hemi);

  const ambient = new THREE.AmbientLight(0xb6c9e0, 0.7);
  scene.add(ambient);

  scene.fog = new THREE.FogExp2(COLORS.fog, WORLD.FOG_DENSITY);
  scene.background = new THREE.Color(COLORS.skyHorizon);

  return {
    sun, hemi, ambient, sunDirection,
    // mantém a luz direcional "seguindo" o jogador (sem sombras a posição absoluta não importa,
    // mas deixamos preparado caso sombras sejam ligadas depois)
    update(cameraPosition) {
      sun.position.copy(cameraPosition).addScaledVector(sunDirection, 10000);
      sun.target.position.copy(cameraPosition);
    },
  };
}

export function applyRendererDefaults(renderer) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9; // levemente abaixo de 1: brancos não estouram, contraste menor
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}
