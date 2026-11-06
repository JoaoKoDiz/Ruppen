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
  scree: 0x9d9282,       // tálus/cascalho nas encostas erodidas
  gravel: 0xa39a84,      // leques aluviais (deposição na saída dos vales)
  meadowLush: 0x5f9c43,  // fundos de vale úmidos
  wetRock: 0x4a463e,     // leito molhado dos talvegues
  riverWater: 0x193c45,  // lâmina d'água dos rios (fundo)
  riverShallow: 0x3a6461, // rios rasos/corredeiras (bordas)
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
    FOOT_RING: 2200,           // raio médio do anel de nuvem ao redor das patas (m, local do elefante)
    LEG_CLEAR: [0.92, 1.25],    // a densidade cai dentro deste cilindro (× raio da pata) — pernas visíveis no banco
    NEAR_FADE: [25, 220],      // m — a densidade some perto da câmera (sem "parede" colada na lente)
    CULL_DIST: 40000,          // m — além disso a nuvem não é desenhada
    FADE_START: 30000,         // m — começa a desvanecer
    DENSITY: 0.03,             // coeficiente de extinção máximo (1/m): cúmulo denso, silhueta nítida
    BASE_NOISE_SCALE: 1500,    // m por ladrilho do ruído base (perlin-worley 64³)
    DETAIL_NOISE_SCALE: 300,   // m por ladrilho do ruído de detalhe (worley 32³)
    EROSION: 0.82,             // quanto o ruído base corrói a forma dos lóbulos
    DETAIL_EROSION: 0.55,      // idem para o detalhe (couve-flor nos topos, fiapos nas bases)
    DETAIL_LOD: [8, 26],       // m de pegada do pixel: o detalhe (voxel ≈ 9 m) some entre esses valores (anti-serrilhado)
    EDGE_SHARP: 0.3,           // a densidade satura em d = EDGE_SHARP (borda nítida, miolo uniforme)
    MAX_STEPS: 110,            // passos primários (inclui saltos no vazio)
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
  TERRAIN_LEAVES_HIGH: 15000, // folhas por ilha antes da restrição 2:1 (fora as forçadas na costa/rios) em quality=high
  TERRAIN_LEAVES_LOW: 8000,
  TERRAIN_TRIS_HIGH: 60000, // teto de triângulos do terreno por ilha (o resto do orçamento de 160k: árvores, pedras, rios)
  TERRAIN_TRIS_LOW: 40000,
  LAND_LEAF_MAX: 90,       // m — folha máxima em terra (triângulos grandes viram vincos na AO de tela)
  COAST_LEAF: 11,          // m — folhas da malha na linha d'água/falésias (refinadas antes do resto)
  RIVER_LEAF: 22,          // m — folha máx. sobre o leito dos rios
  RIVER_LEAF_MIN_HW: 2.4,  // m — só rios com meia-largura ≥ isto forçam folhas pequenas
  RIVER_PLAIN: 5,          // m — várzea plana (cascalho) de cada lado da lâmina d'água
  DEEP_CULL_Y: -45,        // m — folhas inteiras abaixo disto não são desenhadas (o mar é opaco ali)
  RASTER: 256,             // células da grade regular de cobertura (posicionar árvores/pedras, relevo local)
  // --- relevo assado (src/world/terrainGen.js → tools/bake-terrain.js → src/world/terrainData.js) ---
  TERRAIN: {
    GRID: 512,              // células por lado (cobre ±boundRadius: 13–21 m por célula)
    LOWLAND: 55,            // m — planície costeira média (antes do maciço)
    PEAK_SPREAD: 1.25,      // raio do perfil de cada pico ∝ altura (encosta máx. ≈ 0,81·h/r)
    SUMMIT: 0.22,           // fração do raio de cada pico que fica como cimo largo (maciço arredondado, não cone)
    SPUR: 0.4,              // amplitude relativa dos esporões (ridged) sobre o maciço
    CAP_SLOPE: 0.74,        // teto de segurança do declive pela distância à costa (×1,25)
    PEAK_DC: 0.7,           // altura máx. de um pico = PEAK_DC × (distância à costa − COAST_FLAT)
    COAST_FLAT: 70,         // m — faixa costeira antes de o maciço começar a subir
    COAST_FALL: 800,        // m — distância à costa em que o maciço chega a ~63% da altura
    SPL_ITERS: 60,          // incisão fluvial (lei de potência do fluxo): iterações
    SPL_K: 0.04,            // K·dt (m^(1-2m)) — força da incisão
    SPL_M: 0.5,             // expoente da área drenada
    DIFFUSION: 0.12,        // difusão de encosta por iteração (células²): cristas arredondadas
    LEVELS: [[1, 2, 3, 200]], // erosão: [fator da célula (níveis grossos primeiro), gotas por célula de terra, raio, vida, ×erosão]
    INERTIA: 0.08,
    CAPACITY: 2,
    MIN_CAPACITY: 0.004,  
    ERODE: 0.15,
    DEPOSIT: 0.02,
    EVAPORATE: 0.005,
    GRAVITY: 4,
    MAX_ERODE: 0.0015,      // por passo (fração de maxH)
    TALUS_DEG: 36,          // ângulo de repouso da erosão térmica
    THERMAL_ITERS: 60, 
    THERMAL_RATE: 0.4,
    RIVER_AREA: 150000,      // m² — área de drenagem a partir da qual há rio visível
    RIVER_MOUTH_AREA: 700000,  // m² — sistemas com foz deste tamanho sempre viram rio
    RIVER_SYSTEMS: 7,       // … e pelo menos os N maiores (× R/2500) de cada ilha
    RIVER_W: [3.5, 26],     // m — largura mín./máx. da lâmina d'água
    RIVER_W_K: 7,           // m por √km² de bacia
  },
  // --- detalhe de renderização (só visual: a jogabilidade continua em island.heightAt) ---
  DETAIL_M: 3.5,           // m — rugosidade fina sobre a grade erodida (renderHeight ≤ heightAt + 4,5 m)
  CLIFF_TOP: [4, 11],      // m — heightAt onde fica a borda das falésias costeiras (costa sem praia → rocha)
  CLIFF_RAISE: 5,          // m — a borda é erguida até isto (< DOVE.ALT_MIN): faces de ~10–18 m sobre o mar
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
  TREELINE: 0.55,          // fração de maxH acima da qual não há floresta
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
  CITY_SPACING_HIGH: 8.7,   // m — passo da grade de casas do dorso no alto (quality=high); cresce para ~1,5× nos flancos (as casas enchem a célula; ruas recortam)
  CITY_SPACING_LOW: 11,
  CITY_FLANK_ANGLE: 1.2,    // rad — até que ângulo (a partir do zênite) as casas INSTANCIADAS descem pelos flancos
  CRUST_FLANK_ANGLE: 1.7,   // rad — até onde desce a casca-crosta (textura de casinhas) pelos flancos
  CRUST_OFFSET: 3,          // m — a casca-crosta fica a esta distância acima da pele
  CRUST_REPEAT: 12,         // repetições da textura da crosta ao longo do dorso
  CARPET_MAX: 30000,        // limite de instâncias do tapete de casas do dorso
  LOD_DISTANCE: 10000,      // m (mundo) — além desta distância da câmera o tapete instanciado some (fica a crosta)
  PALACE_X: -262,           // x local do centro do palácio (atrás do centro)
  PALACE_SIZE: { hx: 250, hz: 190 },    // meio-lados do bloco arcado principal do palácio (≈ 1/3 do corpo)
  PLAZA: { x0: -60, x1: 120, hz: 75 },  // praça de mercado (no centro do dorso: ponto da entrega)
  TUSK_HOUSE_DIV: 19,       // lado da casinha da presa = diâmetro local / TUSK_HOUSE_DIV
  TUSK_HOUSE_GAP: 1.4,      // passo entre casinhas da presa (× lado)
  TUSK_HOUSE_SPAN: 1.35,    // rad — meio-ângulo coberto pelas casas (±: quase toda a metade de cima da presa)
  TUSK_HOUSE_MAX: 1150,     // limite de casinhas por par de presas (orçamento de triângulos)
  TUSK_TOWERS: 9,           // torres brancas por presa
  FOLD_BODY: 28,            // m — amplitude das dobras esculpidas do corpo (geometria; legíveis a 5–10 km)
  FOLD_HEAD: 9,             // m — idem cabeça
  FOLD_LEG: 10,             // m — idem patas (anéis)
  FOLD_EAR: 8,              // m — idem orelhas (+ caimento do manto: ELEPHANT_MATERIALS.EAR_DRAPE)
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
  SKIN_NORMAL_SCALE: 0.55,  // intensidade das micro-rugas/poros
  SKIN_ROUGHNESS: 0.86,     // pele fosca e empoeirada (o roughnessMap baixa nos vincos)
  SKIN_ENV: 0.4,            // envMapIntensity da pele
  SKIN_COLOR: 0x685c52,     // base do albedo (após manchas/vincos a média fica ≈ #5d5552: cinza quente médio-escuro)
  SKIN_CAVITY_AO: 0.32,     // escurecimento máximo (cor do vértice) nos vincos esculpidos da geometria
  SKIN_RIDGE_LIFT: 0.08,    // clareamento leve das cristas das dobras
  SKIN_FINE_WRINKLES: 150,  // segmentos de rugas finas onduladas pintados no mapa de cor da pele (1024²)
  // manto da orelha (rodada 6): cobertor tecido escuro quente + borda grossa listrada tecida
  EAR_CLOTH: { color: 0x502d25, alt: 0x3a2d30, worn: 0x6e5a52, wear: 0.38, borderWear: 0.55 },   // vinho-castanho, índigo-castanho, desbotado
  EAR_BORDER_STRIPES: [      // [cor, largura relativa], de FORA para DENTRO
    [0x4a2a1c, 9], [0xc8792f, 40], [0xeedcb8, 9], [0x6b3a24, 6], [0xc58a86, 16], [0xeedcb8, 7], [0xd0823a, 44], [0xd9a640, 4],
    [0xeedcb8, 11], [0x7a4228, 7], [0xb87a7a, 13], [0xc8792f, 28], [0xd9a640, 4], [0x3a2220, 6]],
  CLOTH_TILE: 22,           // m (modelo-base) por ladrilho da trama real (uv1 métrico dos panos: manto, faixas, barriga)
  CLOTH_BIG_TILE: 160,      // m — couro gasto (brown_leather) como amassado/desgaste largo na normal dos panos
  CLOTH_BIG_NORMAL: 0.45,
  CLOTH_WEAVE_COLOR: 0.45,  // quanto a luminância da trama real modula a cor dos panos
  EAR_DRAPE: { amp: 30, wave: 170, grow: 0.3, shade: 0.42, fringe: { step: 9, len: [20, 42], r: 2.6 } },   // dobras do caimento (geometria) e franja desfiada da barra
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
  TASSEL_STRANDS: 110,      // fios da franja da borla (tubos finos; low = 90)
  TASSEL_STRAND_LENGTH: { min: 380, max: 450 },
  TASSEL_STRAND_RADIUS: 4.2,
  POMPOM_FUZZ: 0.4,        // deslocamento dos tufos (fuzzySphere)
  POMPOM_DESAT: 0.1,       // dessaturação das cores dos pompons (mistura com cinza)
  EAR_HOUSE_SIZE: { min: 0.7, max: 1.4 },   // variação de tamanho das casinhas do bloco da orelha
  EAR_HOUSE_STREETS: { min: 2, max: 3 },    // ruas estreitas (colunas vazias) no bloco
  EAR_TOWER_CHANCE: 0.06,   // fração de casinhas que viram torres (2,2× mais altas)
  EYE_ROUGHNESS: 0.15,      // esclera molhada
};
// Arquitetura das cidades (src/elephant/architecture.js + elephant.js). Metros do modelo-base (×ELEPHANT.SCALE no mundo).
export const ELEPHANT_CITY = {
  STOREY: 1.1,              // altura de um andar (≈ 3,3 m no mundo)
  BAY: 1.05,                // largura de um vão de janela das casas
  PARAPET: 0.45,            // parapeito (ameado) das casas de laje
  EAVE: 0.28,               // beiral dos telhados de 4 águas
  ROOF_PITCH: 0.42,         // altura da cumeeira = ROOF_PITCH × lado menor (≈ 40°)
  AWNING_Y: 0.92,           // altura da borda presa dos toldos (térreo)
  TILE: { stucco: 1.6, beige: 2.2, roof: 0.9, brick: 1.5, marble: 3.2, pave: [1.3, 0.9] },   // m por ladrilho das texturas reais / lajes
  SHUTTERS: 0.45,           // fração das casas com venezianas
  LIT_WINDOWS: 0.06,        // fração das janelas acesas (quentes)
  ENV: 0.6,                 // envMapIntensity do material da cidade
  F90: 0.25,                // reflexo de Fresnel rasante máximo do reboco/telhas (1 = físico; o céu HDRI deixava tudo branco de longe)
  ALBEDO: 0.82,             // fator do albedo das paredes de reboco (reboco branco real ≈ 0,7–0,75)
  BLOCK: { x: 46, a: 34 },  // tamanho dos quarteirões (ao longo do dorso / ao redor) — grade deformada
  STREET: 1.9,              // largura das ruas (≈ 6 m no mundo)
  AVENUE: 6,                // largura das avenidas (a cada AVENUE_EVERY quarteirões)
  AVENUE_EVERY: 4,
  WARP: 16,                 // deformação da grade das ruas (m)
  FILL: { min: 0.9, max: 0.98 },         // fração da célula ocupada pela casa (o resto: becos)
  MIX: { flat: 0.3, hip: 0.53, tall: 0.11, dome: 0.06 },      // arquétipos do tapete
  STOREYS: { flat: [3, 5], hip: [2, 4], tall: [5, 7], dome: [3, 4] },
  PLAZAS: 4,                // pracinhas espalhadas (com cúpula/obelisco/chafariz no centro)
  PLAZA_R: { min: 18, max: 30 },
  STALLS: 110,              // bancas do mercado (praça da entrega)
  UMBRELLAS: 30,
  CRUST_FADE: [5200, 7600], // m (mundo): a crosta passa de "chão de pedra" (perto) a "casinhas vistas do alto" (longe)
};
// Pele ESCULPIDA como uma única malha (src/elephant/sculpt.js): campo de distância com união suave
// (smin polinomial) de elipsoides/cones arredondados, poligonizado por "surface nets" uma vez e
// compartilhado pelos 7 elefantes; dobras deslocadas na normal, AO de cavidade nos vértices,
// pesos de skinning pela região dominante do campo.
export const ELEPHANT_SCULPT = {
  CELL_HIGH: 14.6,          // lado da célula da grade (m, modelo-base) em quality=high (≈ 142 k triângulos)
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
  LEATHER_TILE: 96,         // m (modelo-base) — ladrilho do couro enrugado (fabric_leather_02, normal + rugosidade); 2ª escala ×2,6 (frequência baixa: dobras pesadas, não "pelo")
  LEATHER_NORMAL: 0.5,      // intensidade do couro na normal (some com a distância: DETAIL_FADE)
  MUD_TILE: 360,            // m (modelo-base) — ladrilho da lama seca rachada (brown_mud_dry, normal + luminância); 2ª escala ×2,7
  MUD_NORMAL: 0.38,         // intensidade das rachaduras na normal
  DETAIL_FADE: { leather: [450, 3200], mud: [900, 6500] },   // m (MUNDO) — o detalhe fino da pele (couro / rachaduras) esmaece entre estas distâncias da câmera
  MUD_TONE: 0.35,           // quanto a luminância da lama modula o cinza quente da pele
  SKIN_TINT: [1.16, 1.03, 0.85], // tinta (linear) sobre o albedo da pele: compensa o azul do céu no lado da sombra (cinza quente)
  NOD: 0.012,               // rad — aceno leve da cabeça
  KNEE_FLEX: 0.2,           // rad — flexão do joelho na fase de balanço
  HIP_SWING: 0.12,          // rad — balanço das patas a partir do quadril
  // --- rodada 6 (look-dev da pele/patas) ---
  FOLD_SHARP: 0.25,         // expoente do perfil do lençol (menor = parede mais íngreme logo após o vinco)
  FOLD_WARP: [0.55, 0.16, 4.2], // ondulação das curvas de nível dos lençóis (baixa freq., alta freq., período ×espaçamento): linhas longas e fluidas
  LEG_WARP: 0.45,           // ondulação relativa dos anéis das patas (menor: anéis longos, não bolhas)
  FOLD_MIN: 0.45,           // amplitude mínima relativa dos lençóis (não somem: leitura de longe)
  FOLD_SPACING: { body: 76, head: 54, leg: 50 },   // m — espaçamento dos lençóis
  ANKLE_RINGS: { y0: 52, y1: 128, spacing: 15, amp: 7 },   // anéis de rugas do tornozelo (entre o pé e a faixa)
  // perfil da pata [y, raio relativo a LEG_HIP_RADIUS]: pé alargado, tornozelo fino, canela, joelho, coxa
  LEG_PROFILE: [[-60, 1.2], [-10, 1.17], [40, 1.07], [100, 0.94], [170, 0.91], [300, 0.9], [410, 1.0], [530, 0.91], [650, 0.95], [800, 1.0], [960, 1.06]],
  KNEE_BULGE: { fwd: 0.66, rx: 92, ry: 128, rz: 165 },   // bossa do joelho à frente (patas da frente; atrás: joelho alto + jarrete)
  TOE: { y: 16, r: 205, angles: [-1.0, -0.5, 0, 0.5, 1.0], size: [56, 40] },   // lóbulos dos dedos na borda do pé
  NAIL: { y: 30, size: [84, 58, 26], sink: -7 },   // unhas de marfim (meio enterradas nos dedos)
  ANKLE_BAND: { y0: 132, y1: 272 },   // faixa listrada do tornozelo (re-assentada acima dos anéis de rugas)
  CAVITY_DARK: 0.42,        // escurecimento (cor do vértice) nos vincos pela curvatura da malha
  CREST_LIFT: 0.1,          // clareamento das cristas
  // material (shader da pele): albedo quente, poeira nas cristas, lama seca nas patas/barriga, faixa molhada
  DUST_COLOR: [0.25, 0.215, 0.18],   // poeira clara (albedo linear) nas cristas das dobras
  DUST_CREST: 0.35,         // quanto a poeira cobre as cristas
  CREASE_DARK: 0.28,        // escurecimento extra no fundo dos vincos (shader)
  ROUGH_CREST: 0.97, ROUGH_CREASE: 0.6, ROUGH_WET: 0.32,
  MUD: { top: 560, bottom: 40, amount: 0.6, belly: 0.4, bellyTop: 860, color: [0.3, 0.262, 0.205], texColor: 0.12 },   // lama seca clara (brown_mud_dry tingida) subindo das patas/barriga
  WET: { top: 46, soft: 26, dark: 0.52 },   // faixa molhada escura na linha d'água (y local)
  SSS: { wrap: 0.45, color: [0.5, 0.24, 0.14], amount: 0.22 },   // terminador suave e quente (subsuperfície)
  FAR_FLATTEN: [2500, 9000], // m (mundo) — as manchas finas de cor (lama/blots) esmaecem para um tom médio: de longe ficam as dobras
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
  ENV_SUN_GLOW: 2.5,         // brilho (HDR) do halo do sol no mapa de ambiente procedural → reflexo quente no ouro
  // HDRI real (assets/hdri/kloofendal_48d_partly_cloudy_puresky_1k.hdr) como fonte do PMREM (lighting.js): girado para o
  // sol cair em SUN_DIR, normalizado para a luminância média do céu procedural × BRIGHTNESS, sol limitado a SUN_CLAMP
  // (luminância linear; o DirectionalLight é o sol direto) e misturado ao procedural por MIX. Não é usado como fundo.
  HDRI: { MIX: 0.8, BRIGHTNESS: 1.0, SUN_CLAMP: 14 },
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
    LARGE_K: 0.07,           // escala larga: raio = dist × K (constante na tela ≈ 7% da altura com fov 62°)…
    RADIUS_MAX_LARGE: 160,   // …até este raio no mundo (m): longe, a AO não escurece faces inteiras
    MAX_PX: 0.2, MIN_PX: 1.5, // raio projetado máximo (fração da altura da tela) / mínimo (px)
    INTENSITY: 4.5,          // ganho da oclusão fina
    INTENSITY_LARGE: 4.0,    // ganho da oclusão larga
    BIAS: 0.22,              // cosseno mínimo: ignora diedros rasos (< ~13°) — arestas de malhas facetadas, curvas suaves
    POWER: 1.4,              // contraste da AO
    STRENGTH: 0.9,           // mistura final: cor × mix(1, ao, STRENGTH × visibilidade)
    FADE: [18000, 40000],    // m — some com a distância
    BLUR_SHARP: 0.06,        // tolerância relativa de profundidade do blur bilateral
  },
  MSAA: 4,                   // amostras do render target da cena (high/ultra)
  // Realismo de câmera (post.js, só high/ultra; low intocado). Flags de URL: #godrays=0 #flare=0 #mblur=0 #grain=0
  // #ca=0 #autoexp=0 (#cine=0 desliga tudo). Ordem: cena → AO → nuvens → [CINE: raios de sol + motion blur + exposição]
  // → bloom → grade (+ glare/fantasmas/véu, aberração cromática, vinheta, grão) → SMAA.
  CINE: {
    // Raios de luz volumétricos ("god rays") em espaço de tela: máscara em meia resolução (céu e horizonte distante =
    // ar aceso, geometria = sombra, × (1 − alfa) das nuvens volumétricas quando o passe delas existe), borrada
    // radialmente em direção ao sol.
    GODRAYS: {
      samples: { high: 32, ultra: 48 },
      scale: 0.5,              // resolução da máscara/borrão em relação ao drawing buffer
      density: 0.85,           // fração do caminho pixel→sol percorrida pelas amostras
      decay: 0.972,            // peso de cada amostra seguinte (mais perto do sol pesa menos)
      intensity: 0.16,         // brilho somado (sRGB de tela, × cor do sol × fração acesa^contrast × queda)
      occlusion: 0.42,         // escurecimento máximo do ar no volume de sombra (feixes escuros a partir das silhuetas)
      occNear: [120, 250],     // m — oclusores mais próximos não contam (a pomba não projeta feixe na tela inteira)
      seaY: 4,                 // m — superfície abaixo disto é mar: não bloqueia o sol (o ar acima dele está aceso)
      falloff: 1.0,            // × exp(−dist·falloff): enfraquecem longe do sol (dist em alturas de tela)
      airLength: 2500,         // m — espalhamento ∝ 1 − exp(−dist/airLength): objetos próximos (a pomba) quase não recebem raios
      far: [9000, 30000],      // m — geometria além disto conta como "ar aceso" (horizonte enevoado entre as patas)
      maxNdc: [1.6, 3.5],      // |ndc| do sol: força total até [0], some em [1] (sol bem acima do quadro ainda projeta raios); além disso custo zero
      contrast: 1.5,           // potência sobre a fração acesa: realça os feixes em relação ao brilho uniforme
    },
    // Efeitos de lente com o sol na/perto da tela, ocluídos pela profundidade (+ alfa das nuvens): halo suave, fantasmas
    // ao longo do eixo sol→centro (tinta cromática, raio por canal), véu (perda de contraste).
    FLARE: {
      halo: [0.10, 0.035, 0.035, 0.22], // [intensidade, raio] do núcleo e do halo largo (raios em alturas de tela)
      sunRadius: 0.012,        // raio (alturas de tela) do disco de amostras de visibilidade do sol
      // [posição no eixo (0 = sol, 1 = centro, 2 = espelho), raio, intensidade, r, g, b]
      ghosts: [
        [0.55, 0.030, 0.060, 0.75, 1.0, 0.65],
        [1.25, 0.055, 0.035, 0.55, 0.75, 1.0],
        [1.55, 0.020, 0.070, 1.0, 0.70, 0.45],
        [1.85, 0.090, 0.022, 0.65, 0.85, 1.0],
        [2.30, 0.140, 0.014, 1.0, 0.85, 0.60],
      ],
      chroma: 0.08,            // diferença relativa de raio R/G/B dos fantasmas (franjas)
      veil: 0.07,              // véu máximo (fração da imagem trocada pela cor do brilho) com o sol no centro
      veilFalloff: 1.1,        // × exp(−dist(sol, centro)·k)
      fadeNdc: 1.25,           // halo/fantasmas somem com o sol além desta |ndc|
      veilNdc: 2.0,            // véu some com o sol além desta |ndc|
    },
    // Motion blur da câmera: reprojeção com a view-projection anterior + depth, amostras centradas no pixel.
    MBLUR: {
      samples: { high: 8, ultra: 12 },
      shutter: 1 / 40,         // s — obturador equivalente com ganho 1; × ganho pela velocidade da câmera
      gain: [60, 140, 0.35, 1.0], // velocidade (m/s) de/até → ganho de/até (cruzeiro quase invisível, boost/mergulho visível)
      maxLen: 0.035,           // comprimento máximo do rastro (alturas de tela)
      near: [20, 30],          // m — pixels mais próximos (pomba, cavaleiro, corda) não borram nem são amostrados
      teleport: 400,           // m — salto da câmera entre quadros acima disto não borra
    },
    GRAIN: 0.014,              // amplitude do grão (sRGB de tela; maior nos meios-tons, menor no preto/branco)
    CA_PX: 0.9,                // separação R–B nos cantos a 1080p (px) — aberração cromática lateral
    // Exposição automática (adaptação do olho): média geométrica da luminância (128×64 + mipmaps, centro pesa mais,
    // pomba excluída) → EV alvo = (log2(KEY) − log2(média))·STRENGTH, limitado, adaptado com constante de tempo TAU.
    AUTOEXP: {
      key: 0.30,               // luminância "de cena" (proxy L/(1−L) do sRGB de tela) que fica com EV 0
      strength: 0.6,           // adaptação parcial (o olho não normaliza tudo)
      minEv: -0.35, maxEv: 0.9,
      tauUp: 1.8, tauDown: 1.2, // s — clarear (entrar na sombra) é mais lento que escurecer
    },
  },
};

// ------------------------------ VIDA ----------------------------------
// Navios, pássaros e multidões (src/world/life.js): escala humana para a sensação de ser minúsculo.
// Distâncias em metros do MUNDO, exceto onde indicado "local" (unidades do modelo-base do elefante).
export const LIFE = {
  SEED_OFF: 7171,
  // --- navios: 3 tipos (InstancedMesh por tipo), geometria procedural com cores por vértice ---
  SHIPS: {
    // escort = orbita um elefante (passa perto das patas: elipse local a × b, m); island = laço ao redor de uma ilha
    CARGO: { count: 4, low: 3, length: [92, 128], speed: [9, 11.5], escort: 1.0, orbitA: [2300, 2900], orbitB: [1950, 2450], wake: 1100 },
    DHOW: { count: 5, low: 4, length: [26, 44], speed: [4.5, 6.5], escort: 0.6, orbitA: [2700, 3800], orbitB: [2400, 3400], coast: [700, 1400], wake: 420 },
    FISHING: { count: 5, low: 3, length: [8, 15], speed: [3, 5.5], escort: 0.2, orbitA: [2400, 3200], orbitB: [2200, 2900], coast: [260, 750], wake: 170 },
    MIN_COAST_DEPTH: -30,   // m — o casco nunca passa onde islandHeightAt > isto (encolhe/afasta a órbita)
    DRAW_DIST: 26000,       // m — além disto o navio some (a perspectiva aérea já o apagou)
    WAKE_POINTS: 30,        // pontos ao longo da esteira (×9 através); low: 18
    WAKE_LIFT: 0.45,        // m acima da superfície das ondas
    KELVIN: 0.3,            // meia-largura dos braços da esteira de Kelvin por metro atrás da proa (≈ tan 19,5° × 0,85)
    BOB: { CARGO: 0.55, DHOW: 0.85, FISHING: 1.0 },   // resposta do arfagem/balanço às ondas
  },
  // --- pássaros: um InstancedMesh (bater de asas no vertex shader) ---
  BIRDS: {
    // bandos (high). low: metade.
    HEAD_GULLS: 70,          // ao redor da cabeça do elefante mais próximo
    CITY_DOVES: 60,          // sobre a cidade do mais próximo
    MARKET_PIGEONS: 60,      // pombos rodando baixo sobre a praça do mercado
    HEAD_GULLS_2: 50,        // cabeça do 2º elefante mais próximo
    ISLAND_GULLS: 60,        // costa da ilha mais próxima
    SHIP_GULLS: 30,          // seguindo o navio mais próximo (≤ 8 km)
    SOARERS: 8,              // aves grandes planando em térmicas perto da altitude da pomba
    SIZE: [0.7, 1.0],        // envergadura (m) das gaivotas/pombas
    SOAR_SIZE: [1.9, 2.4],   // envergadura das planadoras
    SOAR_CELL: 2600,         // m — grade das térmicas (metade das células tem térmica)
  },
  // --- multidões: pessoas instanciadas no mercado e na avenida central de cada cidade (presas a elephant.body) ---
  CROWD: {
    COUNT_HIGH: 1500,        // por elefante (low: sem multidões)
    DIST: 3000,              // m — só elefantes com a praça a menos disto da câmera
    FULL_DIST: 1200,         // m — até aqui todas as pessoas; depois a contagem cai até 35% em DIST
    HEIGHT: 1.7,             // m (mundo)
    PLAZA_TOP: 1518,         // local — piso da praça (fallback se getSurfaceHeight falhar; ver elephant.js)
    FOUNTAIN_R: 19,          // local — chafariz no centro da praça (tanque r 17 + margem)
    STALL_MARGIN: 0.3,       // local — folga ao redor das bancas
    AVENUE_HALF: 7,          // local — meia-largura útil da avenida central (|z| < 9 sem casas)
    AVENUE_MAX_X: 520,       // local — fim da avenida (frente do dorso)
    WALK_SPEED: [0.9, 1.5],  // m/s
    STRIDE: 1.45,            // m por ciclo de passos
  },
};
