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
  FOG_DENSITY: 0.00003,   // FogExp2 residual (gaussiana: fecha o horizonte a 40+ km). A perspectiva aérea principal é
                          // a extinção exponencial com a altura de RENDER.AERIAL (lighting.js, no chunk de névoa de todo material)
};

// Direção DO sol (de onde a luz vem), normalizada em lighting.js
export const SUN_DIR = { x: -0.55, y: 0.70, z: -0.30 };  // sol um pouco mais alto: sombras curtas e suaves, glitter mais baixo

export const COLORS = {
  skyZenith: 0x2c5189,    // azul profundo mas dessaturado (sRGB na tela: o céu não passa pelo tone mapping)
  skyHorizon: 0xb9cadb,   // faixa leitosa do horizonte = MESMA cor da névoa (sem emenda céu/oceano)
  fog: 0xb9cadb,          // azul-cinza pálido e opaco (sRGB; o renderer mistura a névoa depois do tone mapping)
  sunLight: 0xfff1d6,
  oceanDeep: 0x24507c,    // mar azul-aço/marinho, pouco saturado (referências: azul-aço calmo)
  oceanMid: 0x31628f,
  oceanShallow: 0x3f8c9f, // verde-azulado das cristas contra o sol (falsa transmissão)
  foam: 0xf4f8fb,
  cloudLit: 0xffffff,
  cloudShade: 0x8ca3c2,   // base das nuvens azul-cinza (nunca cinza-marrom)
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
  // vegetação/costa das ilhas (src/world/islands.js)
  grassDry: 0x9aa75a,    // pasto seco (cristas, encostas expostas)
  meadow: 0x6f9a4a,      // prado verde (vales)
  forestDark: 0x3b6a37,  // mata fechada
  scrub: 0x7d8c4b,       // matagal/charneca de altitude
  sandWet: 0xb9a97c,     // faixa de areia molhada na linha d'água
  shallows: 0x4fb3c8,    // água rasa turquesa ao redor das ilhas (luz espalhada sobre a plataforma de areia)
  seabedRock: 0x55604f,  // fundo rochoso com algas (costas sem praia)
  lichen: 0xb9b47a,      // líquen nas rochas
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
  EAR: { width: 500, height: 660, thickness: 50 },
  TRUNK: { length: 1050, baseRadius: 125, tipRadius: 45 },
  TUSK: { length: 860, baseRadius: 64, tipRadius: 22 },
  STRIDE: 2200,              // comprimento do passo (m): cadência das pernas = SPEED / STRIDE
  CITY_MAX_HEIGHT: 560,     // altura máxima das construções acima da pele (topo da cúpula/minaretes do palácio)
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
  COUNT: 140,               // nuvens-cúmulo pequenas/médias espalhadas pelo mundo (fixas, semente)
  BASE_MIN: 170,
  BASE_MAX: 720,
  PUFFS_MIN: 18,
  PUFFS_MAX: 46,
  // montes de cúmulo GRANDES sobre o mar (refs 2 e 4): poucos, densos, base plana e topo em couve-flor
  BIG_COUNT: 22,
  BIG_BASE_MIN: 150,
  BIG_BASE_MAX: 600,
  BIG_WIDTH: { min: 1600, max: 3400 },   // m — largura do monte
  BIG_HEIGHT: { min: 520, max: 1000 },   // m — altura do monte
  BIG_PUFFS_MIN: 80,
  BIG_PUFFS_MAX: 130,
  // bancos de nuvem ao redor das patas (src/world/clouds.js), por elefante
  FOOT_PUFFS: 420,          // puffs do banco (quality=high) — banco denso junto à água
  FOOT_HEAPS: 5,            // montes mais altos dentro do banco
  FOOT_HEAP_PUFFS: 22,
  FOOT_TOP_FRACTION: 0.30,  // altura do banco como fração da altura da pata (joelho ≈ 0,3)
  FOOT_HEAP_FRACTION: 0.46, // altura dos montes como fração da altura da pata
  // orçamento: COUNT×~34 + BIG_COUNT×~105 + 7×(14+FOOT_PUFFS+FOOT_HEAPS×FOOT_HEAP_PUFFS) ≈ 11,3 k instâncias (≤ 12 k)
  // (os puffs acima são o modo quality=low; em high/ultra as nuvens são VOLUMÉTRICAS — src/world/volclouds.js)
  VOL: {
    SMALL_COUNT: 120,          // cúmulos pequenos espalhados (refs: "small scattered cumulus")
    SMALL_WIDTH: { min: 380, max: 1300 },
    SMALL_HEIGHT: { min: 170, max: 420 },
    BIG_COUNT: 34,             // cúmulos grandes sobre o mar
    BIG_WIDTH: { min: 1500, max: 3400 },
    BIG_HEIGHT: { min: 600, max: 1300 },
    BASE_MIN: 160, BASE_MAX: 650,   // altura da base plana (m)
    FOOT_TOP: 1800,            // topo dos montes do banco das patas (m)
    FOOT_COVER: 2.2,           // reforço da cobertura do banco das patas (resiste mais à erosão: banco contínuo)
    FOOT_RING: 2150,           // raio médio do anel de nuvem ao redor das patas (m, local do elefante)
    LEG_CLEAR: [0.92, 1.25],    // a densidade cai dentro deste cilindro (× raio da pata) — pernas visíveis no banco
    CULL_DIST: 40000,          // m — além disso a nuvem não é desenhada
    FADE_START: 30000,         // m — começa a desvanecer
    DENSITY: 0.03,             // coeficiente de extinção máximo (1/m): cúmulo denso, silhueta nítida
    BASE_NOISE_SCALE: 1500,    // m por ladrilho do ruído base (perlin-worley 64³)
    DETAIL_NOISE_SCALE: 300,   // m por ladrilho do ruído de detalhe (worley 32³)
    EROSION: 0.82,             // quanto o ruído base corrói a forma dos lóbulos
    DETAIL_EROSION: 0.55,      // idem para o detalhe (couve-flor nos topos, fiapos nas bases)
    EDGE_SHARP: 0.26,          // a densidade satura em d = EDGE_SHARP (borda nítida, miolo uniforme)
    MAX_STEPS: 80,             // passos primários (inclui saltos no vazio)
    LIGHT_STEPS: 5,            // passos de luz em direção ao sol
    LIGHT_STEP0: 28,           // m — 1º passo de luz (dobra a cada passo)
    STEP_MIN: 9,               // m — passo mínimo
    STEP_K: 0.011,             // passo = clamp(t·K, MIN, MAX): cresce com a distância
    STEP_MAX: 280,
    SUN: 2.6,                  // intensidade do sol (linear, antes do ACES)
    AMB_TOP: 0.62,             // luz do céu nos topos
    AMB_BOTTOM: 0.42,          // ambiente azul-cinza nas bases
    AMB_PROBE: 90,             // m — sonda de oclusão do céu (para cima)
    PHASE_G: 0.6,              // Henyey–Greenstein para frente
    PHASE_BACK: -0.3,          // lobo de retroespalhamento
    PHASE_BACK_W: 0.3,
    POWDER: 0.55,              // força do termo "powder" (vincos escuros entre os lóbulos com o sol atrás)
    BODY_SHADOW: 0.3,          // transmitância da sombra do corpo do elefante sobre o banco das patas
    WIND: { x: 1.1, z: 0.45 }, // m/s — deriva das nuvens do mundo
    CHURN: 0.9,                // m/s — evolução lenta do ruído (nuvem "fervendo")
    PASS_SCALE: 0.5,             // resolução do passe de nuvens (1 = cheia; 0,5 = meia resolução, composta por cima)
  },
};

export const CITY_NAMES = ['Zamurra', 'Kethari', 'Oronde', 'Vashtu', 'Mirapol', 'Sulaymi', 'Tendravel'];
export const ISLAND_NAMES = ['Ilha Corvina', 'Ilha Ardósia', 'Ilha Tamarin', 'Ilha Véspera', 'Ilha Saibro'];

export const SEED = 20260512;

// Camadas de renderização (camera.layers) — úteis para o mapa/HUD se precisar
export const LAYERS = { DEFAULT: 0, NO_FOG: 1 };

// ----------------------------- ILHAS ---------------------------------
// Parâmetros da malha de terreno e da vegetação instanciada (src/world/islands.js).
export const ISLANDS = {
  // --- malha de terreno adaptativa (quadtree restrita: densa na costa, cristas e picos) ---
  TERRAIN_LEVELS: 11,      // níveis do quadtree (folha mínima = 2·boundRadius / 2^níveis ≈ 3–5 m)
  TERRAIN_LEAVES_HIGH: 18000, // folhas por ilha (≈ 3,3 triângulos/folha → ~60k tris) em quality=high
  TERRAIN_LEAVES_LOW: 8000,
  DEEP_CULL_Y: -45,        // m — folhas inteiras abaixo disto não são desenhadas (o mar é opaco ali)
  RASTER: 256,             // células da grade regular de cobertura (posicionar árvores/pedras, relevo local)
  // --- detalhe de renderização (só visual: a jogabilidade continua em island.heightAt) ---
  EROSION_M: 24,           // m — profundidade máx. das ravinas (só cava: nunca acima de heightAt + ~3 m)
  CLIFF_TOP: [3.2, 9.7],   // m — altura da borda das falésias costeiras (costa sem praia → com rocha)
  DETAIL_FADE: [160, 750, 1100, 5200], // m — detalhe fino some de [0]→[1], o grosso de [2]→[3]
  TEX_SIZE_HIGH: 512,      // px — texturas procedurais de detalhe (tileáveis)
  TEX_SIZE_LOW: 256,
  // --- vegetação e pedras instanciadas ---
  CONIFERS_HIGH: 1700,     // coníferas (~29 tris) por ilha
  CONIFERS_LOW: 800,
  BROADLEAF_HIGH: 650,     // folhosas de copa redonda (~31 tris)
  BROADLEAF_LOW: 280,
  BUSHES_HIGH: 420,        // arbustos nos prados/bordas (mesma malha das folhosas)
  BUSHES_LOW: 200,
  ROCKS_HIGH: 160,         // pedras (80 tris, facetadas) — inclui os matacões e as pedras da arrebentação
  ROCKS_LOW: 90,
  BOULDERS_HIGH: 34,       // matacões grandes no sopé das falésias (parte de ROCKS_*)
  BOULDERS_LOW: 16,
  STACKS_HIGH: 22,         // agulhas/rochedos no mar junto às costas rochosas
  STACKS_LOW: 12,
  TREE_HEIGHT_MIN: 12,     // árvores grandes (m) para serem visíveis do voo
  TREE_HEIGHT_MAX: 30,
  TREE_LOD_DIST: 7500,     // m — além disto (distância ao centro da ilha) as árvores usam a malha simples
  SKIRT_Y: -300,           // y da "saia" submersa da malha fora do contorno da ilha
  TREE_VIS_DIST: 28000,    // além desta distância da câmera as árvores somem (sub-pixel)
  ROCK_VIS_DIST: 18000,    // idem para as pedras
  VEG_NOISE_M: 700,        // m — escala das manchas prado/pasto seco
  FOREST_NOISE_M: 520,     // m — escala das manchas de floresta
  BEACH_NOISE_M: 900,      // m — escala das costas com/sem praia (sem praia → costa rochosa com falésia)
  SAND_MAX_Y: 8,           // m — areia até esta altura (onde a encosta é suave)
  SAND_WET_Y: 1.5,         // m — faixa de areia molhada/escura junto à água
  TREELINE: 0.45,          // fração de maxH acima da qual não há floresta
  // --- campo da costa (textura polar por ilha lida pelo oceano: fundo, distância à costa) ---
  SHORE_TEX_W: 2048,       // amostras angulares por ilha
  SHORE_TEX_ROWS: 48,      // amostras radiais por ilha (u = r / contorno de SHORE_U0 a SHORE_U1)
  SHORE_U0: 0.86,
  SHORE_U1: 1.16,
  WATER_SIGMA: [0.30, 0.072, 0.052], // 1/m — absorção da água clara (R, G, B): areia turquesa no raso
};

// ----------------------------- OCEANO --------------------------------
// Ondas de Gerstner perto da câmera (src/world/ocean.js). Cada onda: [comprimento (m), amplitude (m),
// direção em graus relativa ao vento]. Soma das amplitudes ≈ 2,8 m (crista máx. < DOVE.ALT_MIN = 6 m).
export const OCEAN = {
  WIND_DEG: 28.8,          // direção do vento/ondulação (graus a partir de +X para +Z) = trem longo do shader
  WAVES: [[262, 0.82, 0], [187, 0.6, 27], [133, 0.44, -23], [95, 0.32, 46], [68, 0.23, -37], [49, 0.16, 12], [36, 0.11, -58], [27, 0.08, 71]],
  CHOP: 0.085,             // Q·k·A por onda (agudeza das cristas; soma 0,68 < 1 → sem laços)
  NEAR_RADIUS: 4600,       // m — raio da malha densa (anéis ×1,0245) com deslocamento
  DISP_FADE: [2400, 4200], // m — o deslocamento some entre estes raios
  NORMAL_FADE: [1800, 4500], // m — a normal analítica de Gerstner some (o mar longe continua como antes)
  SEGMENTS_HIGH: 256,      // segmentos angulares da malha (high) — ~180k tris
  SEGMENTS_LOW: 128,
  WHITECAP: [0.74, 0.5],   // jacobiano: espuma começa em [0] e é plena em [1] (esparsa)
  FOAM_LINE_M: 21,         // m — espaçamento das linhas de arrebentação que chegam à praia
};

// ------------------------- MODELO DA POMBA ----------------------------
// Cores e medidas usadas pelos modelos procedurais da pomba (src/player/candidates/dove_*.js).
export const DOVE_MODEL = {
  HEAD_RADIUS: 0.2,         // raio da cabeça (m)
  TAIL_LENGTH: 0.8,         // comprimento da cauda em leque (m)
  RIDER_HEIGHT: 1.75,       // altura do cavaleiro em pé (m) — cabeça = altura/7,5; sentado ≈ 0,92 acima do quadril
  WING_THICKNESS: 0.028,    // espessura das asas (chapas extrudadas)
  FLAP_HZ_CRUISE: 1.3,      // batidas por segundo em cruzeiro
  FLAP_HZ_BOOST: 2.2,       // batidas por segundo acelerando / subindo
  GLIDE_PERIOD: 7.5,        // ciclo em cruzeiro: ~4 s planando + ~3,5 s batendo
  REIN_LENGTH: 0.95,        // comprimento em repouso de cada rédea (m) — define a folga
  COLORS: {
    featherTop: 0xfdf8f0, featherUnder: 0xe3e7ee, breast: 0xeed8d3, primaries: 0x4a4e57,
    beak: 0x55505a, cere: 0xece3e6, eye: 0x111013, eyering: 0xd6c0bb, feet: 0xd9806a,
    leather: 0x6a4426, leatherDark: 0x3a2516, metal: 0xd9dbe0,
    jacket: 0x3a404b, trousers: 0x564c41, boots: 0x3d2b1d, skin: 0xc99a7d, hair: 0x2e2015, pack: 0x6e563a,
    scarf: 0xb8642a, glove: 0x3b2a1e,
  },
  // --- src/player/dove.js (modelo principal, asa em gaivota com primárias separadas) ---
  TAIL_LENGTH_FAN: 0.66,    // cauda curta em leque arredondado (m)
  PRIMARIES: 8,             // lâminas de penas primárias por asa
  PRIMARY_DARK_FRACTION: 0.4, // fração externa de cada primária que escurece (pontas escuras)
  PRIMARY_TWIST: 0.14,      // rad — torção da lâmina da primária na ponta (bordo de fuga sobe)
  PRIMARY_TIP_RISE: 0.05,   // m — curvatura para cima da ponta de cada primária
  TIP_LAG: 0.26,            // rad — atraso angular das pontas das penas na batida (osso da ponta)
  TIP_SUPINATION: 0.32,     // rad — supinação das primárias na subida da asa
  BODY_BOB: 0.014,          // m — balanço vertical do corpo por batida
  BODY_FEATHER_TILE: { repeatU: 3, repeatV: 2, perRow: 6, rows: 8 }, // tile de penas do corpo (3 voltas × 2 ao longo)
  FLAP_WINDOW: 2.6,         // s de batidas no início de cada GLIDE_PERIOD (o resto é planado)
  GLIDE_DIHEDRAL: 0.17,     // rad — braço levemente erguido (V raso) ao planar
  GLIDE_WRIST_DROOP: 0.3,   // rad — mão cai em relação ao braço (quebra do punho / asa em gaivota)
  GLIDE_SWEEP: 0.12,        // rad — recuo da mão ao planar (mais no boost/mergulho)
  FLAP_AMP: 0.5,            // rad — amplitude da batida no ombro em cruzeiro
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
  HEAD_SCALE: 1.15,         // fator sobre ELEPHANT.HEAD.radius (cabeça maior e mais pesada, como nas referências)
  EAR_SCALE: 1.6,           // fator sobre ELEPHANT.EAR (orelhas tão altas quanto a cabeça, pendendo abaixo dela)
  EAR_YAW: 0.5,             // rad — abertura das orelhas para fora (0 = coladas ao corpo)
  EAR_HOUSE_H: { min: 6, max: 14 },     // m — profundidade das casinhas que saem do manto da orelha
  EAR_HOUSE_GRID: { rows: 22, cols: 16 },   // bloco de casinhas em terraços no manto (muitas fileiras pequenas)
  EAR_HOUSE_RECT: { x0: -0.95, x1: -0.26, y0: -0.6, y1: -0.05 },   // região do bloco (frações da largura/altura da orelha; x<0 = para trás, y<0 = para baixo): parte SUPERIOR-EXTERNA (ref. 1)
  TRUNK_ROOT_RADIUS: 235,   // m — raio da tromba na raiz (afunila até TRUNK.baseRadius a ~25% do comprimento)
  CITY_SPACING_HIGH: 7.6,   // m — passo da malha de casas do dorso no alto (quality=high); cresce para ~1,5× nos flancos
  CITY_SPACING_LOW: 11,
  CITY_FLANK_ANGLE: 1.25,   // rad — até que ângulo (a partir do zênite) as casas INSTANCIADAS descem pelos flancos
  CRUST_FLANK_ANGLE: 1.7,   // rad — até onde desce a casca-crosta (textura de casinhas) pelos flancos
  CRUST_OFFSET: 3,          // m — a casca-crosta fica a esta distância acima da pele
  CRUST_REPEAT: 12,         // repetições da textura da crosta ao longo do dorso
  HOUSE_H: { min: 3, max: 10 },         // m — alturas das casas do dorso (→ 9–30 m no mundo)
  HOUSE_FOOT: { min: 2.8, max: 5.2 },   // m — lado das casas do dorso (→ 8–16 m no mundo)
  TALL_BLOCK_CHANCE: 0.05,  // fração de prédios mais altos (até ~1,6× HOUSE_H.max)
  ROOF_TILE_CHANCE: 0.4,    // fração de casas do dorso com telhado rosa/terracota (o resto é laje pálida)
  CARPET_MAX: 30000,        // limite de instâncias do tapete de casas do dorso
  LOD_DISTANCE: 10000,      // m (mundo) — além desta distância da câmera o tapete instanciado some (fica a crosta)
  PALACE_X: -262,           // x local do centro do palácio (atrás do centro)
  PALACE_SIZE: { hx: 250, hz: 190 },    // meio-lados do bloco arcado principal do palácio (≈ 1/3 do corpo)
  PLAZA: { x0: -60, x1: 120, hz: 75 },  // praça de mercado (no centro do dorso: ponto da entrega)
  TUSK_HOUSE_DIV: 30,       // lado da casinha da presa = diâmetro local / TUSK_HOUSE_DIV
  TUSK_HOUSE_GAP: 2.0,      // passo entre casinhas da presa (× lado)
  TUSK_HOUSE_SPAN: 1.35,    // rad — meio-ângulo coberto pelas casas (±: quase toda a metade de cima da presa)
  TUSK_HOUSE_MAX: 1800,     // limite de casinhas por par de presas (orçamento de triângulos)
  TUSK_TOWERS: 9,           // torres brancas por presa
  FOLD_BODY: 20,            // m — amplitude das dobras esculpidas do corpo (geometria)
  FOLD_HEAD: 8,             // m — idem cabeça
  FOLD_LEG: 9,              // m — idem patas (anéis)
  FOLD_EAR: 12,             // m — idem orelhas
  SPRAY_PERIOD: { min: 70, max: 110 },  // s — intervalo entre jatos d'água da tromba (semente por elefante)
  SPRAY_DURATION: 12,       // s — duração de cada jato
  SPRAY_LIFE: 5.2,          // s — vida de cada gota (arco alto de ≈ 1,5 corpo de comprimento)
  SPRAY_POINTS: 1500,
  SPRAY_POINT_SIZE: 115,    // m (modelo-base) — tamanho dos sprites do jato (sobrepostos: jato cheio)
};
export const ELEPHANT_POLISH = {
  EYE_RADIUS: 34,           // raio do globo ocular
  EYE_SINK: 5,              // quanto o globo afunda na pele (pequeno: olho pouco "furado")
  LEG_HIP_RADIUS: 210,      // raio de referência do perfil da pata (quadril = 1.0; joelho ≈ 0.88; pé ≈ 1.12)
  LEG_HIP_LEAN: 40,         // m — a coxa inclina para dentro no topo (entra na barriga, não sai pelo flanco)
  SKIN_BUMP: 4,             // bumpScale da pele (vincos finos; as dobras grandes são geometria)
  STUD_SIZES: { big: 40, mid: 21, small: 12 },   // raios das tachas da placa (coluna central, médias, pequenas)
  POMPOM_RADIUS: 44,        // raio dos pompons da guirlanda
  POMPOM_SPACING: 114,       // passo entre pompons ao longo da borda da placa
};
// Materiais PBR do elefante (src/elephant/elephant.js): mapas procedurais tileáveis (canvas → normal/roughness)
export const ELEPHANT_MATERIALS = {
  SKIN_NORMAL_REPEAT: 8,    // repetições do mapa de normais micro da pele por ladrilho do mapa de cor (≈ 425 m/ladrilho no mundo)
  SKIN_NORMAL_SCALE: 0.85,  // intensidade das micro-rugas/poros
  SKIN_ROUGHNESS: 0.86,     // pele fosca e empoeirada (o roughnessMap baixa nos vincos)
  SKIN_ENV: 0.4,            // envMapIntensity da pele
  SKIN_COLOR: 0x675e5a,     // base do albedo (após manchas/vincos a média fica ≈ #5d5552: cinza quente médio-escuro)
  SKIN_CAVITY_AO: 0.32,     // escurecimento máximo (cor do vértice) nos vincos esculpidos da geometria
  SKIN_RIDGE_LIFT: 0.08,    // clareamento leve das cristas das dobras
  SKIN_FINE_WRINKLES: 520,  // segmentos de rugas finas onduladas pintados no mapa de cor da pele (1024²)
  EAR_CLOTH_COLOR: 0x5a4c46, // miolo do manto da orelha: tecido taupe escuro quente (não azulado sob o céu)
  GOLD_COLOR: 0xb8862c,     // ouro-bronze quente
  GOLD_ROUGHNESS: 0.34,     // metal escovado (roughnessMap com riscos 0.28–0.42)
  GOLD_ENV: 1.2,
  GOLD_EMISSIVE: 0.3,       // brilho residual (sem envMap o metal puro ficaria preto)
  IVORY_COLOR: 0xe8d6b2,    // creme amarelado (marfim velho), não branco
  IVORY_ROUGHNESS: 0.45,
  IVORY_CLEARCOAT: 0.15,
  CLOTH_WEAVE_REPEAT: 25,   // repetições da trama tecida por ladrilho do atlas dos panos (≈ 50–60 m no mundo)
  TRUNK_WEAVE_REPEAT: { u: 50, v: 40 },
  CLOTH_ROUGHNESS: 0.9,
  TASSEL_STRANDS: 150,      // fios da franja da borla (tubos finos; low = 90)
  TASSEL_STRAND_LENGTH: { min: 380, max: 450 },
  TASSEL_STRAND_RADIUS: 4.2,
  POMPOM_FUZZ: 0.4,        // deslocamento dos tufos (fuzzySphere)
  POMPOM_DESAT: 0.1,       // dessaturação das cores dos pompons (mistura com cinza)
  EAR_HOUSE_SIZE: { min: 0.7, max: 1.4 },   // variação de tamanho das casinhas do bloco da orelha
  EAR_HOUSE_STREETS: { min: 2, max: 3 },    // ruas estreitas (colunas vazias) no bloco
  EAR_TOWER_CHANCE: 0.06,   // fração de casinhas que viram torres (2,2× mais altas)
  EYE_ROUGHNESS: 0.15,      // esclera molhada
  CITY_NORMAL_SCALE: 0.7,   // relevo das janelas/telhas/tijolos
};
// Pele ESCULPIDA como uma única malha (src/elephant/sculpt.js): campo de distância com união suave
// (smin polinomial) de elipsoides/cones arredondados, poligonizado por "surface nets" uma vez e
// compartilhado pelos 7 elefantes; dobras deslocadas na normal, AO de cavidade nos vértices,
// pesos de skinning pela região dominante do campo.
export const ELEPHANT_SCULPT = {
  CELL_HIGH: 14.2,          // lado da célula da grade (m, modelo-base) em quality=high (≈ 140 k triângulos)
  CELL_LOW: 19,             // idem quality=low (≈ 80 k)
  K_BODY: 120,              // suavidade (k do smin) entre os volumes do tronco (barriga, cernelha, ombros, quadris)
  K_NECK: 150,              // pescoço ↔ corpo/cabeça
  K_HEAD: 120,              // cabeça (crânio, domos, bochechas, queixo) ↔ pescoço
  K_TRUNK: 110,             // raiz da tromba ↔ face (abaulado suave)
  K_LEG: 130,               // patas ↔ ombros/quadris (musculosos)
  K_TAIL: 45,
  CREASE_LEG: 16,           // m — vinco extra onde as patas entram no corpo
  CREASE_NECK: 10,          // m — idem pescoço/cabeça
  CREASE_TRUNK: 12,         // m — anéis fundos na raiz da tromba
  FOLD_TRUNK: 1.0,          // fator das dobras em anel da tromba
  KNEE_Y: 410,              // altura dos joelhos (osso do joelho; dobras finas ao redor)
  AO_STEP: 30,              // m — passo das amostras do campo para o AO de cavidade
  AO_STRENGTH: 0.42,        // escurecimento máximo do AO (axilas, virilhas, sob a barriga, raiz da tromba)
  TRI_COLOR_TILE: 1100,     // m (modelo-base) — ladrilho do mapa de cor triplanar
  TRI_NORMAL_TILE: 140,     // m (modelo-base) — ladrilho dos mapas de normal/rugosidade triplanares
  TRI_SHARPNESS: 4,         // expoente da mistura triplanar
  NOD: 0.012,               // rad — aceno leve da cabeça
  KNEE_FLEX: 0.2,           // rad — flexão do joelho na fase de balanço
  HIP_SWING: 0.12,          // rad — balanço das patas a partir do quadril
};

// ----------------------------- RENDER --------------------------------
// Iluminação baseada em imagem, sombras, perspectiva aérea e pós-processamento (src/world/lighting.js, src/world/post.js).
// Níveis de qualidade (#quality= no jogo, ?quality= no preview):
//   'low'   — sem sombras, sem pós-processamento (render direto no canvas, sem AA); envMap e perspectiva aérea ficam (baratos)
//   'high'  — padrão: envMap PMREM, sombras PCF 4096² (±1600 m); cena num render target MSAA 4× com depth;
//             SSAO (meia resolução, 12 amostras) → bloom sutil → grade fílmica → SMAA
//   'ultra' — 'high' + pixel ratio até 2 + filtro de sombra mais largo + SSAO com 16 amostras
export const RENDER = {
  EXPOSURE: 0.9,             // toneMappingExposure (ACES)
  PIXEL_RATIO: { low: 1, high: 1.5, ultra: 2 }, // teto de devicePixelRatio por nível (main.js)
  ENV_INTENSITY: 1.0,        // multiplica o envMapIntensity de cada MeshStandard/Physical (1 = respeita o peso do material: pele 0,4, ouro 1,2)
  ENV_INTENSITY_FALLBACK: 0.5,  // scene.environmentIntensity (Lambert/Phong e objetos ainda não varridos)
  ENV_SUN_GLOW: 2.5,         // brilho (HDR) do halo do sol no mapa de ambiente → reflexo quente no ouro
  SUN_INTENSITY: 3.4,        // DirectionalLight — luz-chave dominante (volumes esculpidos)
  HEMI_INTENSITY: 2.6,       // HemisphereLight — preenchimento azul-cinza: lado da sombra do elefante em cinza médio
  HEMI_SKY: 0xcbd9ee, HEMI_GROUND: 0x8494a6, // chão = luz refletida pelo mar/nuvens (barriga não fica preta)
  AMBIENT_INTENSITY: 0.16,   // AmbientLight residual (sombras cinza-azuladas, nunca pretas)
  AMBIENT_COLOR: 0xb6c9e0,
  SHADOW: {
    low: null,                                                                        // sem sombras
    high: { range: 1600, mapSize: 4096, radius: 2.0, bias: -0.0002, normalBias: 1.2 }, // ±range (m) em torno do foco
    ultra: { range: 1600, mapSize: 4096, radius: 3.0, bias: -0.0002, normalBias: 1.2 },
    MAP_FALLBACK: 2048,      // mapSize quando a GPU não suporta 4096² (maxTextureSize)
    INTENSITY: 1.0,          // light.shadow.intensity
    DEPTH: 6000,             // m — distância do sol ao foco ao longo do raio (casters até ~4,5 km acima do foco)
    BELOW: 3000,             // m — alcance do frustum de sombra abaixo do foco (far = DEPTH + BELOW)
    FOCUS_AHEAD: 0.6,        // o centro da caixa de sombras fica à frente da câmera: esta fração de `range` ao longo do olhar
    FOCUS_Y: 900,            // m — altura do plano de interesse: o foco pára quando o olhar o cruza
    REFRESH_S: 2,            // s — intervalo da varredura da cena que liga sombras/envMap em objetos criados depois
  },
  // Bloom em espaço de tela (0..1): só o que satura (disco/glitter do sol, brilho especular do ouro);
  // plumagem branca ao sol fica em ~0,85–0,93 e não deve brilhar.
  BLOOM: { strength: 0.14, radius: 0.6, threshold: 0.965 },
  FOG_ALTITUDE: { from: 300, to: 6000, factor: 0.45 }, // densidade × lerp(1, factor, smoothstep(from, to, câmera.y))
  GRADE: {
    contrast: 0.18,          // peso da curva S fílmica (0 = sem contraste extra)
    desaturate: 0.06,        // 6% de dessaturação
    vignette: 0.08,          // escurecimento máximo nos cantos (0..1)
    vignetteStart: 0.45,     // raio (0..1, do centro ao canto) onde a vinheta começa
    hazeLift: 0.02,          // fração da cor da névoa somada à imagem inteira (levanta os pretos)
    hazeLiftEdge: 0.012,     // leve véu extra nas bordas
  },
  // Perspectiva aérea física (todas as qualidades): injetada em ShaderChunk.fog_* por lighting.js, então vale para todo
  // material com fog=true (padrão e ShaderMaterial com os chunks), na profundidade real do fragmento (nuvens transparentes
  // incluídas). Transmitância T = exp(−τ·RGB), τ = ∫ σ(h) ds com σ(h) = SIGMA0·exp(−h/H) + SIGMA1 (analítica ao longo do
  // raio); cor = mix(cor, luma, DESAT·(1−T)) · T + corDaNévoa · (1 − T). RGB > 1 no azul: o ar espalha mais azul →
  // objetos distantes azulados, dessaturados, de baixo contraste (silhuetas ainda visíveis a 15–20 km).
  AERIAL: {
    H: 1200,                 // m — altura de escala do haze (camada limite marinha: denso junto ao mar, ralo no alto)
    SIGMA0: 6.0e-5,          // 1/m — extinção ao nível do mar (verde)
    SIGMA1: 1.2e-5,          // 1/m — piso (ar limpo acima da camada)
    RGB: [0.80, 0.96, 1.22], // extinção relativa por canal
    DESAT: 0.35,             // dessaturação extra com a distância
  },
  // Oclusão ambiente em espaço de tela (post.js): lê o depth logarítmico, reconstrói a posição de vista, normal pelas
  // derivadas do depth, espiral de amostras num disco de raio ∝ distância, blur bilateral, aplicada antes do grade com
  // desvanecimento pela névoa/perspectiva aérea (ao longe não escurece o haze). quality=low: desligada.
  AO: {
    high: { samples: 12, scale: 0.5 },   // scale = resolução do buffer de AO em relação ao drawing buffer
    ultra: { samples: 16, scale: 0.5 },
    // escala fina: raio no mundo = NEAR·(dist/NEAR_DIST)^EXP (≈ 2 m a 10 m, 7 m a 120 m, 20 m a 1,2 km, 40 m a 5 km)
    RADIUS_NEAR: 2.0, RADIUS_NEAR_DIST: 10, RADIUS_EXP: 0.48,
    RADIUS_MIN: 0.5, RADIUS_MAX: 120, // limites da escala fina (m)
    LARGE_K: 0.06,           // escala larga: raio = dist × K (constante na tela ≈ 6% da altura com fov 62°)
    MAX_PX: 0.13, MIN_PX: 1.5, // raio projetado máximo (fração da altura da tela) / mínimo (px)
    INTENSITY: 1.6,          // ganho da oclusão fina
    INTENSITY_LARGE: 1.3,    // ganho da oclusão larga
    BIAS: 0.08,              // cosseno mínimo (evita auto-oclusão em superfícies curvas)
    POWER: 1.25,             // contraste da AO
    STRENGTH: 0.9,           // mistura final: cor × mix(1, ao, STRENGTH × visibilidade)
    FADE: [18000, 40000],    // m — some com a distância
    BLUR_SHARP: 0.06,        // tolerância relativa de profundidade do blur bilateral
  },
  MSAA: 4,                   // amostras do render target da cena (high/ultra)
};
