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
  FOG_DENSITY: 0.000042,  // FogExp2 — névoa atmosférica suave; elefantes continuam visíveis a 30+ km
};

// Direção DO sol (de onde a luz vem), normalizada em lighting.js
export const SUN_DIR = { x: -0.55, y: 0.62, z: -0.30 };

export const COLORS = {
  skyZenith: 0x1d4d93,
  skyHorizon: 0xa9c6e6,
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
  ivory: 0xf1e2c0,
  gold: 0xbf8c30,
  goldDark: 0x7a5316,
  cloth: 0xc98a4a,
  clothDark: 0xa05a38,
  cream: 0xf3e3c3,
  houses: [0xf4efe5, 0xeadbc6, 0xf1c9b1, 0xe7b39f, 0xd9c7ab, 0xf8f3ea, 0xd3bca7, 0xf0d8c8],
  roofs: [0xc98b7a, 0xd9a593, 0xb97b6a, 0xc46a4a, 0xd4a08a],
  pompoms: [0xe8413d, 0xf2a7c9, 0xf5d54a, 0xf8f4ea, 0x3fa05a, 0x3a63c9, 0xf08a2c, 0x8e44ad],
  domeGold: 0xb88e38,
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
  SCALE: 3.0,               // fator de escala global do modelo (as dimensões abaixo são do modelo-base; o mundo vê 3×)
  SPEED: 6,                 // m/s — extremamente devagar (visível no mapa ao longo de minutos)
  SHOULDER_HEIGHT: 1500,    // y do topo das costas (pele), sem contar as construções
  BODY: { rx: 560, ry: 430, rz: 470, cy: 1070 }, // elipsoide do corpo (semi-eixos) e y do centro
  LEG: { radius: 140, topY: 780, bottomY: -90, offsetX: 330, offsetZ: 290 }, // 4 patas (±offsetX, ±offsetZ)
  HEAD: { radius: 340, cx: 800, cy: 1060 },
  EAR: { width: 540, height: 640, thickness: 50 },
  TRUNK: { length: 1050, baseRadius: 125, tipRadius: 45 },
  TUSK: { length: 860, baseRadius: 64, tipRadius: 22 },
  STRIDE: 2200,              // comprimento do passo (m): cadência das pernas = SPEED / STRIDE
  CITY_MAX_HEIGHT: 340,     // altura máxima das construções acima da pele
  DELIVERY_ABOVE_MAX: 900,  // o drop só conta se o jogador estiver até esta altura acima do topo da cidade
  FOOT_CLOUD_RADIUS: 2100,   // raio das nuvens/espuma ao redor das patas
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
  ALT_MAX: 8000,
  TURN_RATE: 1.0,           // rad/s de guinada máxima
  PITCH_RATE: 1.1,
  MAX_BANK: 1.05,           // inclinação visual máxima (rad)
  MAX_PITCH: 0.85,
  SPAWN: { x: -6000, y: 220, z: 2200, heading: 0 }, // ~9 km de Zamurra: o elefante inteiro cabe na vista inicial
  ROPE_LENGTH: 6,          // comprimento da corda até a cesta da encomenda
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

// ----------------------------- ILHAS ---------------------------------
// Parâmetros da malha de terreno e da vegetação instanciada (src/world/islands.js).
export const ISLANDS = {
  GRID_HIGH: 170,          // vértices por lado da malha de terreno (quality=high)
  GRID_LOW: 110,           // idem para quality=low
  TREES_HIGH: 3000,        // árvores instanciadas por ilha
  TREES_LOW: 1800,
  ROCKS_HIGH: 400,         // pedras instanciadas por ilha
  ROCKS_LOW: 220,
  TREE_HEIGHT_MIN: 15,     // árvores propositalmente grandes (m) para serem visíveis do voo
  TREE_HEIGHT_MAX: 40,
  SKIRT_Y: -300,           // y da "saia" submersa da malha fora do contorno da ilha
  TREE_VIS_DIST: 28000,    // além desta distância da câmera as árvores somem (sub-pixel)
  ROCK_VIS_DIST: 18000,    // idem para as pedras
};

// ------------------------- MODELO DA POMBA ----------------------------
// Cores e medidas usadas pelos modelos procedurais da pomba (src/player/candidates/dove_*.js).
export const DOVE_MODEL = {
  HEAD_RADIUS: 0.2,         // raio da cabeça (m)
  TAIL_LENGTH: 0.8,         // comprimento da cauda em leque (m)
  RIDER_HEIGHT: 1.75,       // altura do cavaleiro em pé (m) — sentado ≈ 0,92 acima do quadril
  WING_THICKNESS: 0.028,    // espessura das asas (chapas extrudadas)
  FLAP_HZ_CRUISE: 1.3,      // batidas por segundo em cruzeiro
  FLAP_HZ_BOOST: 2.2,       // batidas por segundo acelerando / subindo
  GLIDE_PERIOD: 7.5,        // ciclo em cruzeiro: ~4 s planando + ~3,5 s batendo
  REIN_LENGTH: 0.95,        // comprimento em repouso de cada rédea (m) — define a folga
  COLORS: {
    featherTop: 0xfff7ee, featherUnder: 0xe2e7ee, primaries: 0x343840,
    beak: 0xd8bdb4, eye: 0x1b1b1f, feet: 0xe58a66,
    leather: 0x5b3a21, leatherDark: 0x3d2614, metal: 0xcfd3d8,
    jacket: 0x23262e, trousers: 0x2b2826, boots: 0x261a12, skin: 0xc9977b, hair: 0x2a1c12, pack: 0x4d3b26,
  },
};

// ------------------------------- VOO ----------------------------------
// Sensação de voo (src/player/flight.js): suavizações, auto-nivelamento,
// antecipação do relevo, limites do mundo e colisão com os elefantes.
export const FLIGHT = {
  INPUT_SMOOTH: 7,        // 1/s — suavização das entradas (climbInput/turnInput)
  PITCH_RETURN: 1.3,      // 1/s — auto-nivelamento do nariz sem entrada
  BANK_SMOOTH: 4.5,       // 1/s — suavização do rolamento (banking)
  BANK_FACTOR: 0.85,      // fração de DOVE.MAX_BANK na curva máxima
  DIVE_ACCEL: 24,         // m/s² a −90° de pitch (mergulhar ganha velocidade, subir perde)
  DRAG_DECEL: 0.6,        // fração de DOVE.ACCEL ao desacelerar (mais lenta que acelerar)
  LOOKAHEAD_TIME: 1.7,    // s — antecipação do relevo à frente para puxar o nariz
  LOOKAHEAD_MARGIN: 14,   // m — folga extra sobre ALT_MIN na antecipação
  BOUNDS_MARGIN: 2500,    // m — faixa antes de WORLD.HALF onde a direção volta ao centro
  BOUNDS_HARD: 1500,      // m — além de WORLD.HALF + isto a posição é travada
  COLLIDER_RADIUS: 3,     // m — raio da pomba na colisão com os elefantes
  BROADPHASE_DIST: 8000,  // m — distância ao elefante para testar os colisores
  COLLIDE_TIME: 0.5,      // s — autoridade reduzida dos comandos após um toque
};

// ---------------------------- CÂMERA ---------------------------------
// Câmera de perseguição (src/player/camera.js), no referencial da pomba.
export const CHASE_CAM = {
  OFFSET: { x: 0, y: 4.4, z: 9.5 },   // posição atrás/acima da pomba (frente = −Z)
  LOOK_AHEAD: 14,         // m — ponto à frente da pomba para onde a câmera olha
  LOOK_UP: 1.2,           // m — elevação do ponto olhado (pomba fica no centro-baixo da tela)
  FOV: 62, FOV_BOOST: 72, FOV_SMOOTH: 3,
  YAW_SMOOTH: 5,          // 1/s — lag da guinada
  PITCH_FOLLOW: 0.5, PITCH_SMOOTH: 4,
  ROLL_FOLLOW: 0.3, ROLL_SMOOTH: 4,  // horizonte quase estável
  BOOST_PULLBACK: 2.0,    // m — a câmera afasta-se um pouco no boost
  MIN_ABOVE_GROUND: 2,    // m — nunca abaixo da água/relevo + isto
  SHAKE: 0.07,            // m — tremor sutil no boost
  LOOK_SENS: 0.0045,      // rad/px — olhar com o mouse (arrastar)
  LOOK_RETURN: 3,         // 1/s — retorno do olhar ao soltar
  LOOK_MAX_YAW: 2.4, LOOK_MAX_PITCH: 0.8,
};

// ---------------------------- ENCOMENDA -------------------------------
// Cesta-gaiola, corda, pêndulo e queda (src/player/package.js).
export const PACKAGE = {
  CAGE_RADIUS: 0.7,       // m — gaiola esférica de 1,4 m de diâmetro
  ROPE_RADIUS: 0.022,
  GRAVITY: 9.81,
  TERMINAL_SPEED: 60,     // m/s — velocidade terminal da cesta em queda
  DRAG_HANGING: 0.0012,   // arrasto (1/m) da cesta pendurada — faz atrasar/inclinar atrás
  SWING_DAMPING: 0.5,     // 1/s — amortecimento do balanço
  SCALE_IN_TIME: 0.4,     // s — animação de aparecer da nova cesta
  MAX_LANDED: 40,         // cestas pousadas mantidas nos elefantes (remove a mais antiga)
  SPLASH_TIME: 0.9,       // s — duração do splash/poeira ao perder a cesta
  AUTO_REATTACH_DELAY: 2, // s — se ninguém escuta onLanded/onLost, nova cesta sozinha
  LAND_DEPTH_TOLERANCE: 30, // m — só pousa se cruzou a superfície vindo de cima (até isto abaixo)
  FALL_TIMEOUT: 40,       // s — segurança: cesta perdida se nunca tocar nada
};

// ---------------------------- JOGO / ENTREGAS --------------------------
// Fluxo das entregas (src/game/delivery.js): atrasos, escolha do próximo alvo
// e o ronco distante dos elefantes.
export const GAME = {
  NEXT_TARGET_DELAY: 2.5,   // s — após entregar, até escolher a próxima cidade
  WRONG_CITY_DELAY: 2,      // s — cidade errada: nova cesta após isto
  LOST_DELAY: 2,            // s — cesta perdida: nova cesta após isto
  NEXT_PREFER_MIN: 8000,    // m — distância preferida do próximo alvo (mínimo)
  NEXT_PREFER_MAX: 25000,   // m — idem (máximo)
  RUMBLE_INTERVAL_MIN: 40,  // s — intervalo aleatório entre roncos distantes
  RUMBLE_INTERVAL_MAX: 90,
  RUMBLE_DIST: 6000,        // m — só ronca se algum elefante estiver a menos disto
};

// --------------------------------- HUD ---------------------------------
export const HUD = {
  HINT_NEAR_DIST: 6000,     // m — abaixo disto aparece "Aproxime-se da cidade"
  MARKER_MIN_DIST: 1500,    // m — o losango/nome do alvo só aparece além disto
  HELP_INITIAL_TIME: 12,    // s — as dicas de controle somem após isto
  HELP_RECALL_TIME: 8,      // s — tecla H traz as dicas de volta por isto
  TOAST_TIME: 2600,         // ms — duração padrão do aviso central
  FLASH_TIME: 2.2,          // s — duração da dica de erro ("não está sobre a cidade")
  EDGE_MARGIN: 58,          // px — margem da seta na borda da tela
};

// --------------------------------- MAPA --------------------------------
export const MAP_UI = {
  AHEAD_METERS: 6000,       // m — comprimento do tracejado à frente de cada elefante
  AHEAD_POINTS: 12,
  GRID_STEP: 10000,         // m — linhas de grade
  SCALE_BAR: 5000,          // m — barra de escala
  OUTLINE_POINTS: 96,       // pontos do contorno de cada ilha
  FOREST_SCALE: 0.55,       // miolo de floresta (polígono escalado ao centro)
  ROCK_SCALE: 0.3,          // núcleo rochoso
  PADDING: 20,              // px — folga ao redor do mundo no canvas
};

// --------------------------------- ÁUDIO -------------------------------
export const AUDIO = {
  MASTER: 0.5,
  WIND_FREQ_MIN: 240,       // Hz — corte do passa-baixas do vento parado…
  WIND_FREQ_MAX: 2400,      // …e no boost
  WIND_GAIN_MIN: 0.05,
  WIND_GAIN_MAX: 0.42,
  WIND_SMOOTH: 0.45,        // s — constante de tempo da suavização
  RUMBLE_FREQ: 48,          // Hz — ronco grave
  RUMBLE_TIME: 2.2,         // s
  RUMBLE_TREMOLO: 2.3,      // Hz
};

// Cores da interface (texto e mapa 2D).
export const UI_COLORS = {
  accent: '#f5d54a',        // amarelo das legendas (nome da cidade, alvo no mapa)
  text: '#ffffff',
  mapOcean: '#16407a',
  mapSand: '#e2d6a6',
  mapGrass: '#7aa44f',
  mapForest: '#3e6d38',
  mapRock: '#8c857a',
};

// ------------------------ MODELO DO ELEFANTE ----------------------------
// Medidas do modelo procedural (src/elephant/elephant.js) além das de ELEPHANT:
// orelhas gigantes com manto e casas em terraços, cidade densa do dorso, cidades das presas.
export const ELEPHANT_MODEL = {
  EAR_SCALE: 1.32,          // fator sobre ELEPHANT.EAR (as orelhas das referências são ~ da altura da cabeça)
  EAR_YAW: 0.5,             // rad — abertura das orelhas para fora (0 = coladas ao corpo)
  EAR_HOUSE_H: { min: 16, max: 48 },    // m — profundidade dos blocos de casas que saem do manto da orelha
  CITY_SPACING_HIGH: 17,    // m — passo da malha de casas do dorso (quality=high)
  CITY_SPACING_LOW: 36,
  CITY_FLANK_ANGLE: 1.65,    // rad — até que ângulo (a partir do zênite) as casas descem pelos flancos
  HOUSE_H: { min: 12, max: 42 },        // m — alturas das casas do dorso
  HOUSE_FOOT: { min: 10, max: 20 },     // m — lado das casas do dorso
  TALL_BLOCK_CHANCE: 0.05,  // fração de prédios mais altos (até ~1,6× HOUSE_H.max)
  PALACE_X: -270,           // x local do centro do palácio (atrás do centro)
  PLAZA: { x0: -60, x1: 120, hz: 75 },  // praça de mercado (no centro do dorso: ponto da entrega)
  TUSK_HOUSE_STEP: 0.0085,  // passo (fração da presa) entre fileiras de casas
};
