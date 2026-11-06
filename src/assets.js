// =====================================================================
//  Texturas e HDRI reais (Poly Haven, CC0) — carregador comum.
//  Os arquivos ficam em assets/ (veja assets/manifest.json e tools/fetch-assets.py).
//  No arquivo único (dist/ruppen.html) as imagens vêm embutidas em
//  window.__RUPPEN_ASSETS (caminho → data URI), porque o WebGL não aceita
//  imagens carregadas de file:// sem isso.
//
//  Uso:
//    import { tex, texSet, loadHDRI, ASSET_IDS } from '../assets.js';
//    const t = tex('aerial_rocks_02', 'diff', { repeat: 8 });         // THREE.Texture (sRGB para 'diff')
//    const s = texSet('white_stucco_02', { repeat: 4 });             // { map, normalMap, roughnessMap }
//    mat.map = s.map; mat.normalMap = s.normalMap; mat.roughnessMap = s.roughnessMap;
//  As texturas são devolvidas na hora (vazias) e preenchidas quando a imagem chega;
//  o material atualiza sozinho. Cada (id, mapa, repeat) é um objeto em cache:
//  para outro repeat, use { repeat } diferente (gera um clone que compartilha a imagem).
// =====================================================================
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

// Lista dos conjuntos disponíveis e dos mapas de cada um (espelha assets/manifest.json).
export const ASSET_IDS = {
  // terreno
  aerial_rocks_02: ['diff', 'nor_gl', 'rough'],
  cliff_side: ['diff', 'nor_gl', 'rough'],
  aerial_grass_rock: ['diff', 'nor_gl', 'rough'],
  forest_ground_04: ['diff', 'nor_gl', 'rough'],
  coast_sand_01: ['diff', 'nor_gl', 'rough'],
  damp_beach_sand: ['diff', 'nor_gl', 'rough'],
  bark_brown_02: ['diff', 'nor_gl'],
  // elefante
  fabric_leather_02: ['diff', 'nor_gl', 'rough'],
  brown_mud_dry: ['diff', 'nor_gl', 'rough'],
  // tecidos / adornos / sela
  poly_wool_herringbone: ['diff', 'nor_gl', 'rough'],
  wool_boucle: ['diff', 'nor_gl'],
  brown_leather: ['diff', 'nor_gl', 'rough'],
  // arquitetura
  white_stucco_02: ['diff', 'nor_gl', 'rough'],
  beige_wall_001: ['diff', 'nor_gl', 'rough'],
  clay_roof_tiles_02: ['diff', 'nor_gl', 'rough'],
  brick_wall_02: ['diff', 'nor_gl', 'rough'],
  marble_01: ['diff', 'nor_gl', 'rough'],
};
export const HDRI_PATH = 'assets/hdri/kloofendal_48d_partly_cloudy_puresky_1k.hdr';

// Base dos caminhos: as páginas ficam na raiz (index.html) ou em dev/ (preview.html).
const BASE = (() => {
  try { return new URL('../', import.meta.url).href; } catch { return './'; }
})();
const resolve = (p) => (globalThis.__RUPPEN_ASSETS && globalThis.__RUPPEN_ASSETS[p]) || BASE + p;
export const pathOf = (id, map) => `assets/tex/${id}_${map}.jpg`;

const loader = new THREE.TextureLoader();
const images = new Map();   // caminho → textura-base (carregada uma vez)
const cache = new Map();    // chave → textura configurada

function baseTexture(path) {
  let t = images.get(path);
  if (!t) {
    t = loader.load(resolve(path), undefined, undefined, () => console.warn('[assets] falhou: ' + path));
    images.set(path, t);
  }
  return t;
}

// Textura de um mapa: 'diff' em sRGB, os demais lineares; repetição e anisotropia.
export function tex(id, map, { repeat = 1, anisotropy = 8 } = {}) {
  if (!ASSET_IDS[id] || !ASSET_IDS[id].includes(map)) return null;
  const rx = Array.isArray(repeat) ? repeat[0] : repeat, ry = Array.isArray(repeat) ? repeat[1] : repeat;
  const key = `${id}|${map}|${rx}|${ry}|${anisotropy}`;
  let t = cache.get(key);
  if (t) return t;
  const base = baseTexture(pathOf(id, map));
  t = base.clone();
  // o clone compartilha a imagem; quando ela chegar, a fonte é a mesma (Source compartilhada)
  t.source = base.source;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = anisotropy;
  t.colorSpace = map === 'diff' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  // sem needsUpdate aqui: a imagem ainda não chegou. Quando chegar, o loader marca a
  // Source compartilhada (version++) e todos os clones são reenviados à GPU sozinhos.
  cache.set(key, t);
  return t;
}

// Conjunto PBR pronto para MeshStandardMaterial.
export function texSet(id, opts = {}) {
  const maps = ASSET_IDS[id] || [];
  return {
    map: maps.includes('diff') ? tex(id, 'diff', opts) : null,
    normalMap: maps.includes('nor_gl') ? tex(id, 'nor_gl', opts) : null,
    roughnessMap: maps.includes('rough') ? tex(id, 'rough', opts) : null,
  };
}

// Imagem crua (HTMLImageElement) quando carregada — para quem quer pintar num canvas.
export function imageOf(id, map) {
  return baseTexture(pathOf(id, map)).image || null;
}

// HDRI do céu → Promise<THREE.DataTexture> (equirretangular, linear). Use com PMREMGenerator.
let hdriPromise = null;
export function loadHDRI() {
  if (!hdriPromise) {
    hdriPromise = new Promise((res, rej) => {
      new HDRLoader().load(resolve(HDRI_PATH), (t) => { t.mapping = THREE.EquirectangularReflectionMapping; res(t); }, undefined, rej);
    });
  }
  return hdriPromise;
}
