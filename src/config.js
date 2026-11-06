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
  FOG_DENSITY: 0.000085,  // FogExp2 — perspectiva aérea forte: ~45% de névoa a 8–10 km, ~90% a 20 km (como nas referências)
};

// Direção DO sol (de onde a luz vem), normalizada em lighting.js
export const SUN_DIR = { x: -0.55, y: 0.70, z: -0.30 };  // sol um pouco mais alto: sombras curtas e suaves, glitter mais baixo

export const COLORS = {
  skyZenith: 0x2c5189,    // azul profundo mas dessaturado (sRGB na tela: o céu não passa pelo tone mapping)
  skyHorizon: 0xb9cadb,   // faixa leitosa do horizonte = MESMA cor da névoa (sem emenda céu/oceano)
  fog: 0xb9cadb,          // azul-cinza pálido e opaco (sRGB; o renderer mistura a névoa depois do tone mapping)
  sunLight: 0xfff1d6,
  oceanDeep: 0x1c4470,    // mar azul-aço/marinho, pouco saturado
  oceanMid: 0x2b5c8a,
  oceanShallow: 0x5187b1,
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
  shallows: 0x4fb3c8,    // água rasa turquesa ao redor das ilhas
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
  FOOT_PUFFS: 300,          // puffs do banco (quality=high)
  FOOT_HEAPS: 5,            // montes mais altos dentro do banco
  FOOT_HEAP_PUFFS: 22,
  FOOT_TOP_FRACTION: 0.30,  // altura do banco como fração da altura da pata (joelho ≈ 0,3)
  FOOT_HEAP_FRACTION: 0.46, // altura dos montes como fração da altura da pata
  // orçamento: COUNT×~34 + BIG_COUNT×~105 + 7×(14+FOOT_PUFFS+FOOT_HEAPS×FOOT_HEAP_PUFFS) ≈ 10,1 k instâncias (≤ 12 k)
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
  TREES_HIGH: 6000,        // árvores instanciadas por ilha (~12 triângulos cada)
  TREES_LOW: 3000,
  ROCKS_HIGH: 400,         // pedras instanciadas por ilha (inclui os matacões)
  ROCKS_LOW: 220,
  BOULDERS_HIGH: 40,       // matacões grandes no sopé das falésias (parte de ROCKS_*)
  BOULDERS_LOW: 20,
  TREE_HEIGHT_MIN: 12,     // árvores grandes (m) para serem visíveis do voo
  TREE_HEIGHT_MAX: 30,
  SKIRT_Y: -300,           // y da "saia" submersa da malha fora do contorno da ilha
  TREE_VIS_DIST: 28000,    // além desta distância da câmera as árvores somem (sub-pixel)
  ROCK_VIS_DIST: 18000,    // idem para as pedras
  VEG_NOISE_M: 700,        // m — escala das manchas prado/pasto seco
  FOREST_NOISE_M: 520,     // m — escala das manchas de floresta
  BEACH_NOISE_M: 900,      // m — escala das costas com/sem praia
  SAND_MAX_Y: 8,           // m — areia até esta altura (onde a encosta é suave)
  SAND_WET_Y: 1.5,         // m — faixa de areia molhada/escura junto à água
  TREELINE: 0.45,          // fração de maxH acima da qual não há floresta
  SHALLOWS_SEGMENTS: 160,  // ângulos do anel de água rasa
  SHALLOWS_Y: 0.8,         // m — altura do anel acima do oceano (evita z-fight)
  SHALLOWS_OUTER: 0.27,    // fração de R além da costa onde o turquesa desaparece
  SHALLOWS_OPACITY: 0.55,  // opacidade junto à costa
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
  // --- src/player/dove.js (modelo principal, asa em gaivota com primárias separadas) ---
  TAIL_LENGTH_FAN: 0.66,    // cauda curta em leque arredondado (m)
  PRIMARIES: 7,             // "dedos" de penas primárias por asa
  PRIMARY_DARK_FRACTION: 0.4, // fração externa de cada primária que escurece (pontas escuras)
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
  CITY_SPACING_HIGH: 6.5,   // m — passo da malha de casas do dorso no alto (quality=high); cresce para ~1,5× nos flancos
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
  TUSK_HOUSE_MAX: 6000,     // limite de casinhas por par de presas
  TUSK_TOWERS: 9,           // torres brancas por presa
  FOLD_BODY: 20,            // m — amplitude das dobras esculpidas do corpo (geometria)
  FOLD_HEAD: 8,             // m — idem cabeça
  FOLD_LEG: 9,              // m — idem patas (anéis)
  FOLD_EAR: 12,             // m — idem orelhas
  SPRAY_PERIOD: { min: 70, max: 110 },  // s — intervalo entre jatos d'água da tromba (semente por elefante)
  SPRAY_DURATION: 12,       // s — duração de cada jato
  SPRAY_LIFE: 4.2,          // s — vida de cada gota (arco de ≈ 1,2 corpos de comprimento)
  SPRAY_POINTS: 1500,
  SPRAY_POINT_SIZE: 70,     // m (modelo-base) — tamanho dos sprites do jato
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
