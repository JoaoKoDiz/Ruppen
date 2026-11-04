// =====================================================================
//  RUPPEN — configuração global de escala, cores e constantes de jogo.
//  Unidade: 1 unidade = 1 metro. Eixo Y para cima. Nível do mar: y = 0.
//  Todos os módulos leem daqui; não copie números "mágicos" para outros arquivos.
// =====================================================================

export const WORLD = {
  SIZE: 60000,            // lado do quadrado jogável (m), centrado na origem
  HALF: 30000,
  SEA_LEVEL: 0,
  CAMERA_NEAR: 0.5,
  CAMERA_FAR: 160000,     // distância de renderização enorme (usa logarithmicDepthBuffer)
  FOG_DENSITY: 0.000021,  // FogExp2 — névoa atmosférica suave; elefantes continuam visíveis a 30+ km
};

// Direção DO sol (de onde a luz vem), normalizada em lighting.js
export const SUN_DIR = { x: -0.55, y: 0.95, z: -0.30 };

export const COLORS = {
  skyZenith: 0x1d4d93,
  skyHorizon: 0xc6dcf0,
  fog: 0xbed5ec,
  sunLight: 0xfff1d6,
  oceanDeep: 0x16407a,
  oceanMid: 0x1f5a9e,
  oceanShallow: 0x2f7fc4,
  foam: 0xf4f8fb,
  cloudLit: 0xffffff,
  cloudShade: 0xb9c7d9,
  sand: 0xe2d6a6,
  grass: 0x7aa44f,
  forest: 0x3e6d38,
  rock: 0x8c857a,
  rockDark: 0x5d5850,
  elephantSkin: 0x75737a,
  elephantSkinDark: 0x4f4d55,
  ivory: 0xefe6cf,
  gold: 0xd8a63a,
  goldDark: 0x9c6f1e,
  cloth: 0xd98a3c,
  clothDark: 0xb0552e,
  cream: 0xf3e3c3,
  houses: [0xf4efe5, 0xeadbc6, 0xf1c9b1, 0xe7b39f, 0xd9c7ab, 0xf8f3ea, 0xd3bca7, 0xf0d8c8],
  roofs: [0xb0563d, 0xc46a4a, 0x9c4b3a, 0xd98e5a, 0xb86a4e],
  pompoms: [0xe8413d, 0xf2a7c9, 0xf5d54a, 0xf8f4ea, 0x3fa05a, 0x3a63c9, 0xf08a2c, 0x8e44ad],
  domeGold: 0xcfa040,
  wood: 0x8a5a2b,
  rope: 0xb89a6a,
  cage: 0x6b6b70,
};

// -------------------------- ELEFANTES --------------------------------
// Dimensões no espaço LOCAL do elefante: +X = frente (direção da caminhada),
// +Y = cima, +Z = lado direito. A origem do grupo fica no nível do mar,
// no centro entre as quatro patas. Os valores são referência para o modelo
// procedural, as cidades, as colisões e a entrega.
export const ELEPHANT = {
  COUNT: 7,
  SPEED: 6,                 // m/s — extremamente devagar (visível no mapa ao longo de minutos)
  SHOULDER_HEIGHT: 1500,    // y do topo das costas (pele), sem contar as construções
  BODY: { rx: 560, ry: 430, rz: 470, cy: 1070 }, // elipsoide do corpo (semi-eixos) e y do centro
  LEG: { radius: 140, topY: 780, bottomY: -90, offsetX: 330, offsetZ: 290 }, // 4 patas (±offsetX, ±offsetZ)
  HEAD: { radius: 340, cx: 800, cy: 1060 },
  EAR: { width: 540, height: 640, thickness: 50 },
  TRUNK: { length: 1050, baseRadius: 125, tipRadius: 45 },
  TUSK: { length: 860, baseRadius: 64, tipRadius: 22 },
  STRIDE: 720,              // comprimento do passo (m): cadência das pernas = SPEED / STRIDE
  CITY_MAX_HEIGHT: 340,     // altura máxima das construções acima da pele
  DELIVERY_ABOVE_MAX: 520,  // o drop só conta se o jogador estiver até esta altura acima do topo da cidade
  FOOT_CLOUD_RADIUS: 700,   // raio das nuvens/espuma ao redor das patas
};

// ----------------------------- POMBA ---------------------------------
export const DOVE = {
  WINGSPAN: 4.6,
  BODY_LENGTH: 2.4,
  SPEED_MIN: 28,
  SPEED_CRUISE: 60,
  SPEED_BOOST: 140,
  ACCEL: 35,
  ALT_MIN: 6,               // nunca descer abaixo disso sobre a água
  ALT_MAX: 3600,
  TURN_RATE: 1.0,           // rad/s de guinada máxima
  PITCH_RATE: 1.1,
  MAX_BANK: 1.05,           // inclinação visual máxima (rad)
  MAX_PITCH: 0.85,
  SPAWN: { x: 0, y: 160, z: 0, heading: 0 },
  ROPE_LENGTH: 11,          // comprimento da corda até a cesta da encomenda
};

export const CLOUDS = {
  COUNT: 170,               // nuvens-cúmulo espalhadas pelo mundo (fixas, semente)
  BASE_MIN: 170,
  BASE_MAX: 720,
  PUFFS_MIN: 18,
  PUFFS_MAX: 46,
};

export const CITY_NAMES = ['Zamurra', 'Kethari', 'Oronde', 'Vashtu', 'Mirapol', 'Sulaymi', 'Tendravel'];
export const ISLAND_NAMES = ['Ilha Corvina', 'Ilha Ardósia', 'Ilha Tamarin', 'Ilha Véspera', 'Ilha Saibro'];

export const SEED = 20260512;

// Camadas de renderização (camera.layers) — úteis para o mapa/HUD se precisar
export const LAYERS = { DEFAULT: 0, NO_FOG: 1 };
