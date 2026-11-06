// =====================================================================
//  RUPPEN — o elefante colossal (modelo final, derivado do candidato B,
//  reformado para bater com as referências).
//  Anatomia: cabeça grande e pesada com testa em domo alto, pescoço cheio,
//  garupa mais baixa, tromba grossa na raiz, patas em coluna; pele cinza quente
//  ESCURA com dobras GRANDES esculpidas (textura procedural de cor + bump:
//  poucas linhas grossas e onduladas, sombreado suave, camada fina discreta;
//  faixas horizontais nas patas/tromba, diagonais nos flancos).
//  Adornos: placa dourada em gota ENORME (do alto do crânio à raiz da tromba,
//  de orelha a orelha) com tachas em malha hexagonal de 3 tamanhos e bossa
//  central; guirlanda de pompons felpudos com elos de prata; borla rosa com
//  cúpula tacheada, cone de ouro e franja comprida; anéis de ouro com contas
//  nas presas; mangas listradas (laranja/castanho/creme/rosa) na tromba e nos
//  tornozelos. Orelhas GIGANTES quase retangulares, pendendo abaixo da cabeça,
//  com manto: borda listrada concêntrica, tecido escuro e um bloco retangular
//  de casas em terraços.
//  Civilização: tapete FINO de milhares de casinhas pálidas (InstancedMesh ×2)
//  cobrindo o dorso, descendo pelos flancos e transbordando para o pescoço;
//  palácio com muralha arcada, cúpula dourada sobre tambor, 6 minaretes com
//  varandas, torres rosa de telhado cônico e muro de tijolos arcado; prédio de
//  tijolos e praça de mercado no centro (ponto da entrega); mesquitas e torres
//  espalhadas; presas com a metade de cima coberta de casinhas de telhado
//  vermelho e torres brancas; torres e casinhas no alto da cabeça.
//  Medidas em config.js → ELEPHANT, ELEPHANT_MODEL e ELEPHANT_POLISH.
//
//  Rodada 3: dobras ESCULPIDAS na geometria (ruído |fbm| com deformação de domínio, malhas densas),
//  textura de vincos orgânicos (cor quente #6b625f), civilização 3× menor (casinhas 8–16 m no mundo)
//  em dois níveis de detalhe (casca-crosta texturizada sempre visível + tapete instanciado até
//  LOD_DISTANCE), presas cobertas de casinhas minúsculas (instâncias) com anéis grossos de contas,
//  orelhas orgânicas com borda de 7 listras e bloco pequeno de casinhas, e jato d'água periódico.
//  Rodada 4 (realismo): a pele é UMA malha contínua esculpida num campo de distância (src/elephant/
//  sculpt.js): união suave de tronco (barriga caída, cernelha, crista da espinha, peito, ombros,
//  quadris, garupa), pescoço, cabeça (domos, testa, bochechas, queixo, bainhas das presas, raízes das
//  orelhas), tromba, patas (joelho/jarrete, sola chata) e cauda, poligonizada por surface nets UMA vez
//  e compartilhada pelos 7 elefantes; dobras em lençóis sobrepostos deslocadas na normal, vincos
//  fundos nas junções, AO de cavidade nos vértices e mapas da pele em TRIPLANAR (procedurais + couro
//  e lama seca reais do Poly Haven), sem UV nem emendas.
//  Estrutura: DOIS SkinnedMesh com o MESMO esqueleto de 17 ossos (raiz, quadril+joelho ×4, cabeça,
//  4 da tromba, cauda, 2 orelhas; pesos da pele pela região dominante do campo): a pele esculpida e as
//  demais partes (grupos de material: pele das orelhas/pálpebras, manga da tromba, panos, marfim,
//  ouro, cidade, borla, olhos, prata) + InstancedMesh (tapete de casas ×2, casinhas das presas, tachas,
//  pompons — estes três presos ao osso da cabeça) + crosta. Faixas dos tornozelos, unhas e manga da
//  tromba são lançadas na pele esculpida; cidade, crosta, placa, olhos e guirlanda usam as consultas
//  de superfície do campo. ≈ 17 draw calls e ≈ 360 k triângulos por elefante com o tapete visível.
//  Espaço local: +X = frente, +Y = cima, +Z = lado direito; origem no
//  nível do mar entre as patas (ver config.js / ARCHITECTURE.md).
// =====================================================================
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { ELEPHANT, ELEPHANT_MODEL, ELEPHANT_POLISH, ELEPHANT_MATERIALS, ELEPHANT_SCULPT, COLORS, SEED } from '../config.js';
import { createRng, hashInt } from '../util/rng.js';
import { createNoise } from '../util/noise.js';
import { tex } from '../assets.js';
import {
  foldValue, FOLD_CA, FOLD_SA, TRUNK_CURVE, trunkR, BODY_SX, BONES, BONE, EYES, EAR_PIVOT, TRUNK_ROOT, LEGS,
  getSkinGeometry, getTables, skinBody, skinHead, skinNeck, skinTop, skinTopY, castOut, sdf, gradient, foldAt,
  skinWeightsFor, legAxis, NECK_C,
} from './sculpt.js';

const E = ELEPHANT, B = E.BODY, LG = E.LEG, HD = E.HEAD, EAR = E.EAR, TR = E.TRUNK, TK = E.TUSK, SC = ELEPHANT_SCULPT;
const TAU = Math.PI * 2;
const V3 = THREE.Vector3;
const noise = createNoise(SEED + 331);

// Alturas da cidade (locais a este modelo)
const EM = { ...ELEPHANT_MODEL, ...ELEPHANT_POLISH };
const MT = ELEPHANT_MATERIALS;
const HOUSE_AVG = 6;             // altura média das casas usada em getSurfaceHeight
const HR = HD.radius * EM.HEAD_SCALE;   // raio efetivo da cabeça
const PALACE_X = EM.PALACE_X, PZ = EM.PLAZA, PS = EM.PALACE_SIZE;
const PALACE_BASE_TOP = 1700;    // topo do bloco principal do palácio (arcadas)
const PALACE_TIER_H = 90;        // andar recuado sobre o bloco
const DOME_R = 122, DRUM_H = 52, DOME_CY = PALACE_BASE_TOP + PALACE_TIER_H + DRUM_H;   // cúpula dourada sobre o tambor
const BRICK = { x: 215, z: -205, hx: 105, hz: 70 }, BRICK_TOP = 1690; // prédio de tijolos com arcos
const PLAZA_TOP = 1518;          // piso da praça de mercado (centro do dorso)

// ------------------------------------------------------------------
//  utilidades
// ------------------------------------------------------------------
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const rgba = (c, a) => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;

// Solda as normais das duas colunas coincidentes da emenda de uma malha em grade (idxA(k), idxB(k)).
function weldSeam(g, idxA, idxB, count) {
  const n = g.attributes.normal, v = new THREE.Vector3();
  for (let k = 0; k < count; k++) {
    const a = idxA(k), b = idxB(k);
    v.set(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
    n.setXYZ(a, v.x, v.y, v.z); n.setXYZ(b, v.x, v.y, v.z);
  }
  return g;
}

function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function canvasTexture(canvas, srgb = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Ruído em tons de cinza (manchas) — pequeno e ampliado ao desenhar.
function noiseCanvas(size, seedOff, scale, octaves, lo, hi) {
  const c = makeCanvas(size, size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const n = createNoise(SEED + seedOff);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // mistura de 4 amostras deslocadas para ficar (quase) sem emenda
    const u = x / size, v = y / size;
    const a = n.fbm2(u * scale, v * scale, octaves), b = n.fbm2((u + 1) * scale, v * scale, octaves);
    const cc = n.fbm2(u * scale, (v + 1) * scale, octaves), d = n.fbm2((u + 1) * scale, (v + 1) * scale, octaves);
    const val = (a * (1 - u) * (1 - v) + b * u * (1 - v) + cc * (1 - u) * v + d * u * v) * 0.5 + 0.5;
    const g = lo + (hi - lo) * val, i = (y * size + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = g; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ------------------------------------------------------------------
//  campos tileáveis e mapas PBR (normal / roughness) gerados em canvas
// ------------------------------------------------------------------
// Campo escalar size×size com amostragem bilinear periódica (u,v em voltas).
class Field {
  constructor(size, data = null) { this.size = size; this.data = data || new Float32Array(size * size); }
  sample(u, v) {
    const S = this.size, d = this.data;
    let x = (u - Math.floor(u)) * S, y = (v - Math.floor(v)) * S;
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const x1 = (x0 + 1) % S, y1 = (y0 + 1) % S;
    return d[y0 * S + x0] * (1 - fx) * (1 - fy) + d[y0 * S + x1] * fx * (1 - fy) + d[y1 * S + x0] * (1 - fx) * fy + d[y1 * S + x1] * fx * fy;
  }
}
// Ruído fbm tileável (mistura dos 4 cantos) com escalas independentes em u e v → [-1,1].
function tileNoise(n, u, v, su, sv, oct = 3) {
  const a = n.fbm2(u * su, v * sv, oct), b = n.fbm2((u + 1) * su, v * sv, oct), c = n.fbm2(u * su, (v + 1) * sv, oct), d = n.fbm2((u + 1) * su, (v + 1) * sv, oct);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
// Campo de ruído tileável de baixa frequência pré-calculado (barato de amostrar em 1024²).
function noiseField(size, seedOff, su, sv, oct = 3) {
  const n = createNoise(SEED + seedOff), f = new Field(size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) f.data[y * size + x] = tileNoise(n, x / size, y / size, su, sv, oct);
  return f;
}
// Células de Worley periódicas (cells × cells por ladrilho): devolve [F1, F2] em unidades de célula.
const _wo = [0, 0];
function worley(u, v, cells, seedOff) {
  const px = u * cells, py = v * cells, ix = Math.floor(px), iy = Math.floor(py);
  let f1 = 9, f2 = 9;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = ix + i, cy = iy + j, wx = ((cx % cells) + cells) % cells, wy = ((cy % cells) + cells) % cells;
    const h1 = hashInt(wx + 1, wy + 7, seedOff), h2 = hashInt(wx + 3, wy + 11, seedOff + 1);
    const dx = cx + h1 - px, dy = cy + h2 - py, d = Math.sqrt(dx * dx + dy * dy);
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
  }
  _wo[0] = f1; _wo[1] = f2; return _wo;
}
// Mapa de normais (espaço tangente, convenção OpenGL/three.js: R = +u, G = +v) a partir de um campo de altura
// periódico (0..1). strength = altura relativa à largura do texel.
function normalCanvas(h, strength) {
  const S = h.size, d = h.data, c = makeCanvas(S, S), ctx = c.getContext('2d'), img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const xl = (x + S - 1) % S, xr = (x + 1) % S, yu = (y + S - 1) % S, yd = (y + 1) % S;   // yu = linha de cima do canvas = +v
    const dhdu = (d[y * S + xr] - d[y * S + xl]) * 0.5 * strength, dhdv = (d[yu * S + x] - d[yd * S + x]) * 0.5 * strength;
    const inv = 1 / Math.sqrt(dhdu * dhdu + dhdv * dhdv + 1);
    const k = (y * S + x) * 4;
    img.data[k] = (-dhdu * inv * 0.5 + 0.5) * 255; img.data[k + 1] = (-dhdv * inv * 0.5 + 0.5) * 255; img.data[k + 2] = (inv * 0.5 + 0.5) * 255; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0); return c;
}
// Canvas cinza a partir de um campo (0..1) — roughnessMap lê o canal G (todos iguais aqui).
function grayCanvas(f) {
  const S = f.size, c = makeCanvas(S, S), ctx = c.getContext('2d'), img = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) { const g = Math.max(0, Math.min(255, f.data[i] * 255)), k = i * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = g; img.data[k + 3] = 255; }
  ctx.putImageData(img, 0, 0); return c;
}
// Lê o canal R de um canvas quadrado como campo 0..1 (para converter desenhos 2D em altura).
function canvasField(c) {
  const S = c.width, f = new Field(S), d = c.getContext('2d').getImageData(0, 0, S, S).data;
  for (let i = 0; i < S * S; i++) f.data[i] = d[i * 4] / 255;
  return f;
}
// Textura linear (normal/roughness) com repetição própria (cada mapa tem sua transformação no three.js).
function linearTexture(canvas, ru = 1, rv = ru) { const t = canvasTexture(canvas, false); t.repeat.set(ru, rv); return t; }
const sstep = (a, b, x) => smooth(a, b, x);

// ------------------------------------------------------------------
//  texturas (compartilhadas entre todos os elefantes)
// ------------------------------------------------------------------
// Campo de VINCOS orgânicos (barro/tecido amassado): |ruído| com deformação de domínio → cristas
// arredondadas separadas por vincos finos. Periódico em u (o domínio é um cilindro em 3D); em v não
// precisa fechar (nenhuma peça dá a volta em v). aniso > 1 alonga os vincos ao longo de u.
// Retorna Float32Array (0 = vinco, 1 = crista) de size×size.
function creaseField(size, seedOff, { fu = 5, aniso = 3, warp = 0.7, vScale = 1 } = {}) {
  const n = createNoise(SEED + seedOff);
  const out = new Float32Array(size * size);
  const R = fu / TAU;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const px = Math.cos(u * TAU) * R, py = Math.sin(u * TAU) * R, pz = v * fu * aniso * vScale;
    const wx = n.noise3(px * 0.7 + 3.1, py * 0.7, pz * 0.7), wy = n.noise3(px * 0.7, py * 0.7 + 7.3, pz * 0.7), wz = n.noise3(px * 0.7 + 1.7, py * 0.7, pz * 0.7 + 5.7);
    const X = px + warp * wx, Y = py + warp * wy, Z = pz + warp * wz;
    const n1 = n.noise3(X, Y, Z), n2 = n.noise3(X * 2.3 + 11, Y * 2.3, Z * 2.3);
    out[y * size + x] = Math.min(1, Math.abs(n1) * 1.5 + Math.abs(n2) * 0.45);
  }
  return out;
}
// Desenha um campo (0..1) num canvas: cor = lerp(lo, hi, f) (lo/hi em [r,g,b]).
function fieldCanvas(field, size, lo, hi) {
  const c = makeCanvas(size, size), ctx = c.getContext('2d'), img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const f = field[i], k = i * 4;
    img.data[k] = lo[0] + (hi[0] - lo[0]) * f; img.data[k + 1] = lo[1] + (hi[1] - lo[1]) * f; img.data[k + 2] = lo[2] + (hi[2] - lo[2]) * f; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0); return c;
}
let creaseCache = null;
function getCrease() {
  if (creaseCache) return creaseCache;
  const S = 512, f = creaseField(S, 707, { fu: 6, aniso: 2.6, warp: 0.8 });
  // vinco escuro e estreito, cristas quase planas (sombreado suave)
  const col = fieldCanvas(f.map((v) => Math.min(1, 0.55 + 0.45 * Math.min(1, v * 1.4))), S, [0, 0, 0], [255, 255, 255]);
  const bump = fieldCanvas(f, S, [40, 40, 40], [200, 200, 200]);
  creaseCache = { col, bump };
  return creaseCache;
}
// Camada RGBA de ruído tileável tingido: alfa = smooth(lo, hi, ruído) × maxA (manchas de cor).
function tintedNoise(size, seedOff, scale, oct, color, lo, hi, maxA) {
  const c = makeCanvas(size, size), ctx = c.getContext('2d'), img = ctx.createImageData(size, size), n = createNoise(SEED + seedOff);
  const r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const val = tileNoise(n, x / size, y / size, scale, scale, oct) * 0.5 + 0.5, k = (y * size + x) * 4;
    img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = smooth(lo, hi, val) * maxA * 255;
  }
  ctx.putImageData(img, 0, 0); return c;
}
// Pele: cor (cinza quente com manchas rosadas/castanhas, poeira clara e escurecimento AO nos vincos) +
// mapa de NORMAIS micro (rugas anisotrópicas finas, rede de fendas em duas escalas — células de Worley
// deformadas — e poros) + roughnessMap (fosca/empoeirada; um pouco mais lisa nos vincos). O mapa de
// normais e o de rugosidade repetem SKIN_NORMAL_REPEAT vezes por ladrilho do mapa de cor (≈ 425 m no
// mundo → fendas de 1–3 m e poros de ~1 m).
function makeSkinTextures() {
  const W = 1024, H = 1024;
  const c = makeCanvas(W, H), ctx = c.getContext('2d');
  // base: cinza-castanho QUENTE (refs.: ~#6b625f ao sol), sem tinta azul
  ctx.fillStyle = hex(MT.SKIN_COLOR); ctx.fillRect(0, 0, W, H);
  const blot = noiseCanvas(128, 17, 3, 4, 170, 255);
  ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.35; ctx.drawImage(blot, 0, 0, W, H);
  ctx.globalAlpha = 0.5; ctx.drawImage(getCrease().col, 0, 0, W, H);   // AO dos vincos orgânicos (vales escuros)
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  // manchas (mottling): rosado-castanho nas zonas finas da pele, castanho escuro em placas, poeira por cima
  ctx.drawImage(tintedNoise(256, 121, 5, 3, 0x7a605a, 0.55, 0.8, 0.4), 0, 0, W, H);
  ctx.drawImage(tintedNoise(256, 122, 7, 3, 0x463a35, 0.56, 0.82, 0.3), 0, 0, W, H);
  ctx.drawImage(tintedNoise(256, 123, 3.5, 3, 0x84796f, 0.6, 0.86, 0.26), 0, 0, W, H);
  // rugas finas onduladas (ref.: linhas paralelas sinuosas por cima das dobras grandes): segmentos de
  // linhas escuras com um fio de luz logo acima (relevo pintado), tileáveis (desenhadas com wrap em x e y)
  {
    const lrng = createRng(SEED + 131);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = 0; i < MT.SKIN_FINE_WRINKLES; i++) {
      const y0 = lrng() * H, kk = lrng.int(1, 3), amp = 4 + lrng() * 12, ph = lrng() * TAU, k2 = lrng.int(4, 9), a2 = 1 + lrng() * 3, ph2 = lrng() * TAU;
      const x0 = lrng() * W, len = W * (0.15 + lrng() * 0.5), lw = 1.2 + lrng() * 2.4, al = 0.18 + lrng() * 0.3;
      const yAt = (x) => y0 + amp * Math.sin(TAU * kk * x / W + ph) + a2 * Math.sin(TAU * k2 * x / W + ph2);
      for (const [col, dy, wMul] of [[`rgba(150,138,128,${al * 0.45})`, -lw * 1.4, 0.8], [`rgba(32,24,21,${al})`, 0, 1]]) {
        ctx.strokeStyle = col; ctx.lineWidth = lw * wMul;
        for (const ox of [0, -W]) for (const oy of [0, -H, H]) {
          ctx.beginPath();
          for (let x = x0; x <= x0 + len; x += 6) { const xx = x + ox, yy = yAt(x) + dy + oy; if (x === x0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy); }
          ctx.stroke();
        }
      }
    }
  }
  // poros/granulado fino
  ctx.globalAlpha = 0.1; const grain = noiseCanvas(256, 23, 24, 2, 120, 255);
  ctx.globalCompositeOperation = 'multiply'; for (let y = 0; y < H; y += 256) for (let x = 0; x < W; x += 256) ctx.drawImage(grain, x, y, 256, 256);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  // --- micro-relevo (altura) e máscara de vincos → normal + roughness ---
  const S = 1024;
  const wr = noiseField(256, 71, 2.5, 7, 3);                    // rugas alongadas em u (anisotrópicas)
  const wr2 = noiseField(256, 74, 6, 14, 2);                    // rugas finas secundárias
  const warpU = noiseField(256, 72, 4, 4, 2), warpV = noiseField(256, 73, 4, 4, 2);
  const h = new Field(S), rf = new Field(S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    const wrinkle = 1 - sstep(0, 0.16, Math.abs(wr.sample(u, v)));
    const wrinkle2 = 1 - sstep(0, 0.1, Math.abs(wr2.sample(u, v)));
    const wu = u + 0.025 * warpU.sample(u, v), wv = v + 0.025 * warpV.sample(u, v);
    const cz = worley(wu, wv, 12, 5); const crack = 1 - sstep(0, 0.05, cz[1] - cz[0]), dome = 1 - Math.min(1, cz[0] * 1.5);
    const fz = worley(wu + 0.37, wv + 0.11, 44, 9); const fine = 1 - sstep(0, 0.11, fz[1] - fz[0]), pore = 1 - sstep(0, 0.16, fz[0]);
    const k = y * S + x;
    h.data[k] = 0.6 - 0.2 * wrinkle - 0.1 * wrinkle2 - 0.2 * crack - 0.1 * fine - 0.1 * pore + 0.06 * dome;
    const groove = Math.max(wrinkle, crack, fine * 0.6, pore * 0.5);
    rf.data[k] = MT.SKIN_ROUGHNESS + 0.04 * warpU.sample(u * 3, v * 3) - 0.24 * groove;
  }
  const R = MT.SKIN_NORMAL_REPEAT;
  return { map: canvasTexture(c), normal: linearTexture(normalCanvas(h, 6), R, R), rough: linearTexture(grayCanvas(rf), R, R) };
}
// Trama tecida (fios por cima/por baixo em xadrez + fibras): campo de altura tileável 256².
function makeWeaveField(S = 256, N = 16) {
  const f = new Field(S), n = createNoise(SEED + 81);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const fu = (x / S) * N, fv = (y / S) * N, iu = Math.floor(fu), iv = Math.floor(fv), pu = fu - iu, pv = fv - iv;
    const over = (iu + iv) & 1, warpH = Math.sin(Math.PI * pu), weftH = Math.sin(Math.PI * pv);
    const fiber = 0.04 * n.noise2(x * 0.9, y * 0.15) + 0.04 * n.noise2(x * 0.15, y * 0.9);
    f.data[y * S + x] = 0.45 + 0.22 * (over ? warpH : weftH) + 0.08 * (over ? weftH : warpH) + fiber;
  }
  return f;
}
// Ouro escovado: riscos longos ao longo de u (leves) + alguns arranhões cruzados → roughness 0.28–0.42 e
// normal fraca. Tileável em u (as linhas atravessam a borda) e em v (linhas horizontais).
function makeGoldTextures() {
  const S = 512, c = makeCanvas(S, S), ctx = c.getContext('2d');
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, S, S);
  const rng = createRng(SEED + 404);
  ctx.lineCap = 'round';
  for (let i = 0; i < 1400; i++) {
    const y = rng() * S, len = 30 + rng() * 300, x0 = rng() * S - S * 0.5, light = rng() < 0.5;
    ctx.strokeStyle = light ? `rgba(255,255,255,${0.05 + rng() * 0.16})` : `rgba(0,0,0,${0.05 + rng() * 0.16})`;
    ctx.lineWidth = 0.8 + rng() * 1.6; ctx.beginPath();
    for (const off of [0, S]) { ctx.moveTo(x0 + off, y); ctx.lineTo(x0 + len + off, y + (rng() - 0.5) * 1.5); }
    ctx.stroke();
  }
  for (let i = 0; i < 60; i++) {   // arranhões finos cruzados
    const x = rng() * S, y = rng() * S, a = rng() * TAU, L = 10 + rng() * 60;
    ctx.strokeStyle = `rgba(0,0,0,${0.15 + rng() * 0.2})`; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); ctx.stroke();
  }
  const hf = canvasField(c), wear = noiseField(128, 405, 3, 3, 2), rf = new Field(S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const k = y * S + x; rf.data[k] = MT.GOLD_ROUGHNESS + (hf.data[k] - 0.5) * 0.55 + 0.05 * wear.sample(x / S, y / S); }
  return { normal: linearTexture(normalCanvas(hf, 4), 4, 4), rough: linearTexture(grayCanvas(rf), 4, 4) };
}
// Marfim: creme com veios finos ao longo de v (o comprimento da presa) na cor e numa normal muito fraca.
function makeIvoryTextures() {
  const S = 256, g = makeCanvas(S, S), gctx = g.getContext('2d');
  gctx.fillStyle = '#808080'; gctx.fillRect(0, 0, S, S);
  const rng = createRng(SEED + 505);
  for (let i = 0; i < 140; i++) {
    const x = rng() * S, kk = rng.int(1, 3), amp = 1 + rng() * 3, ph = rng() * TAU, light = rng() < 0.5;
    gctx.strokeStyle = light ? `rgba(255,255,255,${0.08 + rng() * 0.2})` : `rgba(0,0,0,${0.08 + rng() * 0.2})`; gctx.lineWidth = 0.8 + rng() * 2.2;
    gctx.beginPath();
    for (let y = 0; y <= S; y += 8) { const xx = x + amp * Math.sin(TAU * kk * y / S + ph); if (y === 0) gctx.moveTo(xx, y); else gctx.lineTo(xx, y); }
    gctx.stroke();
  }
  const hf = canvasField(g);
  const c = makeCanvas(S, S), ctx = c.getContext('2d'), img = ctx.createImageData(S, S);
  const cr = (MT.IVORY_COLOR >> 16) & 255, cg = (MT.IVORY_COLOR >> 8) & 255, cb = MT.IVORY_COLOR & 255;   // bytes sRGB (o canvas é sRGB)
  for (let i = 0; i < S * S; i++) { const f = 0.9 + 0.2 * (hf.data[i] - 0.5), k = i * 4; img.data[k] = Math.min(255, cr * f); img.data[k + 1] = Math.min(255, cg * f); img.data[k + 2] = Math.min(255, cb * f * 0.98); img.data[k + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  const map = canvasTexture(c); map.repeat.set(3, 12);
  return { map, normal: linearTexture(normalCanvas(hf, 3), 3, 12) };
}

const TRUNK_FABRIC_END = 0.76; // fração do comprimento da tromba coberta pelo tecido listrado
function makeTrunkTextures() {
  const W = 512, H = 1024;
  const c = makeCanvas(W, H), ctx = c.getContext('2d');
  const b = makeCanvas(W, H), bctx = b.getContext('2d');
  const ySplit = Math.round((1 - TRUNK_FABRIC_END) * H); // acima = ponta de pele (v alto), abaixo = tecido
  // --- ponta de pele ---
  ctx.fillStyle = '#6e645f'; ctx.fillRect(0, 0, W, ySplit);
  const blot = noiseCanvas(128, 17, 3, 4, 170, 255);
  ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.4; ctx.drawImage(blot, 0, 0, W, ySplit);
  // vincos orgânicos (anéis suaves) na ponta de pele: o mesmo campo da pele, só a metade de cima
  ctx.globalAlpha = 0.25; ctx.drawImage(getCrease().col, 0, 0, 512, 256, 0, 0, W, ySplit);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  bctx.fillStyle = '#8c8c8c'; bctx.fillRect(0, 0, W, H);
  bctx.drawImage(getCrease().bump, 0, 0, 512, 256, 0, 0, W, ySplit);
  const rng = createRng(SEED + 12);
  // --- tecido em faixas: laranja / castanho / creme / rosa empoeirado (tons quentes e abafados) ---
  const palette = [COLORS.cloth, COLORS.cream, 0xb8703e, 0xc98a92, COLORS.cloth, COLORS.clothDark, COLORS.cream, 0xc27a4a, 0xbf8f6a, 0xa65a4e, COLORS.cream, COLORS.cloth];
  let y = ySplit; let k = 0;
  ctx.fillStyle = hex(COLORS.cloth); ctx.fillRect(0, ySplit, W, H - ySplit);
  while (y < H) {
    const h = 12 + rng() * 30;
    const ph = rng() * TAU, kk = rng.int(2, 4);
    ctx.fillStyle = hex(palette[k % palette.length]);
    ctx.beginPath(); ctx.moveTo(0, y + 5 * Math.sin(ph));
    for (let x = 0; x <= W; x += 8) ctx.lineTo(x, y + 5 * Math.sin(TAU * kk * x / W + ph));
    for (let x = W; x >= 0; x -= 8) ctx.lineTo(x, y + h + 5 * Math.sin(TAU * kk * x / W + ph + 0.7));
    ctx.closePath(); ctx.fill();
    // sombra da borda da faixa (cor) e sulco (bump)
    ctx.strokeStyle = 'rgba(60,30,20,0.35)'; ctx.lineWidth = 2; ctx.beginPath();
    for (let x = 0; x <= W; x += 8) { const yy = y + 5 * Math.sin(TAU * kk * x / W + ph); if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy); }
    ctx.stroke();
    bctx.strokeStyle = 'rgba(0,0,0,0.7)'; bctx.lineWidth = 3; bctx.beginPath();
    for (let x = 0; x <= W; x += 8) { const yy = y + 5 * Math.sin(TAU * kk * x / W + ph); if (x === 0) bctx.moveTo(x, yy); else bctx.lineTo(x, yy); }
    bctx.stroke();
    y += h; k++;
  }
  // trama do tecido (cor) + desgaste: mais claro nas cristas das dobras (campo de vincos em "screen")
  const weave = noiseCanvas(256, 31, 40, 2, 150, 255);
  ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.3; ctx.drawImage(weave, 0, ySplit, W, H - ySplit);
  ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.16; ctx.drawImage(getCrease().col, 0, 0, 512, 512, 0, ySplit, W, H - ySplit);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  const wn = MT.TRUNK_WEAVE_REPEAT;
  return { map: canvasTexture(c), normal: linearTexture(normalCanvas(getWeave(), 8), wn.u, wn.v) };
}
let weaveCache = null;
function getWeave() { if (!weaveCache) weaveCache = makeWeaveField(256, 16); return weaveCache; }

// Atlas de panos: v∈[0.5,1] manto das orelhas; v∈[0.25,0.5] faixas de tornozelo; v∈[0,0.25] trama da barriga.
function makeClothTextures() {
  const S = 1024, c = makeCanvas(S, S), ctx = c.getContext('2d');
  const b = makeCanvas(S, S), bctx = b.getContext('2d');
  bctx.fillStyle = '#8c8c8c'; bctx.fillRect(0, 0, S, S);
  const rng = createRng(SEED + 44);
  // --- manto (y 0..512): miolo (y 0..256, v 0.75..1) tecido ESCURO quente com linhas onduladas
  //     laranja discretas; borda (y 256..512, v 0.5..0.75) = faixa LISTRADA laranja/creme/rosa
  //     (v cresce da borda externa para dentro: as listras ficam concêntricas ao contorno da orelha) ---
  ctx.fillStyle = hex(MT.EAR_CLOTH_COLOR); ctx.fillRect(0, 0, S, 256);
  // vincos orgânicos suaves no tecido escuro (o mesmo campo da pele, mais contrastado) + 4 linhas
  // onduladas laranja/rosa muito discretas
  ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.45; ctx.drawImage(getCrease().col, 0, 0, 512, 512, 0, 0, S, 256);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  bctx.globalAlpha = 0.8; bctx.drawImage(getCrease().bump, 0, 0, 512, 512, 0, 0, S, 256); bctx.globalAlpha = 1;
  const thin = [0xb8703e, 0xc98a92, 0x8a5a48, COLORS.cloth];
  for (let i = 0; i < 4; i++) {
    const y = 40 + i * 58, ph = rng() * TAU, kk = rng.int(2, 4), amp = 6 + rng() * 6;
    ctx.strokeStyle = rgba(thin[i % thin.length], 0.16 + rng() * 0.08); ctx.lineWidth = 2 + rng() * 2; ctx.beginPath();
    for (let x = 0; x <= S; x += 8) { const yy = y + amp * Math.sin(TAU * kk * x / S + ph); if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy); }
    ctx.stroke();
  }
  ctx.fillStyle = hex(COLORS.cloth); ctx.fillRect(0, 256, S, 256);
  // 7 listras (creme / rosa / creme / castanho / creme / rosa / creme) sobre o laranja, bordas onduladas
  // (ref. 1: borda GROSSA listrada laranja/creme com fios castanhos e rosa)
  const stripes = [[COLORS.cream, 264, 24], [0xc98a92, 300, 16], [COLORS.cream, 328, 26], [COLORS.clothDark, 366, 18], [COLORS.cream, 396, 26], [0xb8703e, 434, 14], [COLORS.cream, 460, 26]];
  for (const [col, y, h] of stripes) {
    const ph = rng() * TAU, kk = rng.int(3, 6), amp = 3 + rng() * 4;
    ctx.fillStyle = hex(col);
    ctx.beginPath();
    for (let x = 0; x <= S; x += 8) { const yy = y + amp * Math.sin(TAU * kk * x / S + ph); if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy); }
    for (let x = S; x >= 0; x -= 8) ctx.lineTo(x, y + h + amp * Math.sin(TAU * kk * x / S + ph));
    ctx.closePath(); ctx.fill();
    bctx.strokeStyle = 'rgba(0,0,0,0.5)'; bctx.lineWidth = 2; bctx.beginPath();
    for (let x = 0; x <= S; x += 8) { const yy = y + amp * Math.sin(TAU * kk * x / S + ph); if (x === 0) bctx.moveTo(x, yy); else bctx.lineTo(x, yy); }
    bctx.stroke();
  }
  // costura escura na borda externa (v=0.5) e interna (v=0.75)
  ctx.fillStyle = 'rgba(60,30,20,0.5)'; ctx.fillRect(0, 256, S, 5); ctx.fillRect(0, 506, S, 6);
  // --- faixas de tornozelo (y 512..768): listras horizontais laranja/vermelho/creme ---
  const bands = [COLORS.cloth, 0xa65a4e, COLORS.cream, COLORS.clothDark, COLORS.cream, 0xc98a92, COLORS.cloth, 0xd9b07a, COLORS.cream, 0xa65a4e];
  let y = 512; let k = 0;
  while (y < 768) {
    const h = k % 2 === 0 ? 30 : 20; ctx.fillStyle = hex(bands[k % bands.length]); ctx.fillRect(0, y, S, Math.min(h, 768 - y));
    bctx.strokeStyle = 'rgba(0,0,0,0.6)'; bctx.lineWidth = 2; bctx.beginPath(); bctx.moveTo(0, y); bctx.lineTo(S, y); bctx.stroke();
    // losangos pequenos nas listras creme
    if (bands[k % bands.length] === COLORS.cream) {
      ctx.fillStyle = rgba(COLORS.clothDark, 0.8);
      for (let x = 12; x < S; x += 32) { ctx.beginPath(); ctx.moveTo(x, y + h / 2 - 6); ctx.lineTo(x + 6, y + h / 2); ctx.lineTo(x, y + h / 2 + 6); ctx.lineTo(x - 6, y + h / 2); ctx.closePath(); ctx.fill(); }
    }
    y += h; k++;
  }
  // --- trama da barriga (y 768..1024): creme com chevrons laranja/vinho ---
  ctx.fillStyle = hex(COLORS.cream); ctx.fillRect(0, 768, S, 256);
  for (let row = 0; row < 4; row++) {
    const yy = 768 + 32 + row * 64;
    ctx.strokeStyle = hex(row % 2 ? COLORS.clothDark : COLORS.cloth); ctx.lineWidth = 14; ctx.beginPath();
    for (let x = 0; x <= S; x += 32) { const up = (x / 32) % 2 === 0; if (x === 0) ctx.moveTo(x, yy + (up ? -14 : 14)); else ctx.lineTo(x, yy + (up ? -14 : 14)); }
    ctx.stroke();
  }
  ctx.strokeStyle = hex(COLORS.goldDark); ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(0, 772); ctx.lineTo(S, 772); ctx.moveTo(0, 1020); ctx.lineTo(S, 1020); ctx.stroke();
  // trama fina em tudo (cor) + desgaste do tecido: cristas das dobras mais claras (manto e faixas)
  const weave = noiseCanvas(256, 31, 40, 2, 150, 255);
  ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.3; ctx.drawImage(weave, 0, 0, S, S);
  ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.14; ctx.drawImage(getCrease().col, 0, 0, 512, 512, 0, 0, S, 768);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  const R = MT.CLOTH_WEAVE_REPEAT;
  return { map: canvasTexture(c), normal: linearTexture(normalCanvas(getWeave(), 8), R, R) };
}

// Regiões do atlas da cidade (u0,u1,v0,v1) com pequena margem contra sangria
const INSET = 0.004;
const REG = {
  PAL: [0 + INSET, 0.5 - INSET, 0.5 + INSET, 1 - INSET],
  BRK: [0.5 + INSET, 1 - INSET, 0.5 + INSET, 1 - INSET],
  PLAIN: [0 + INSET, 0.25 - INSET, 0.25 + INSET, 0.5 - INSET],
  TOWER: [0.25 + INSET, 0.5 - INSET, 0.25 + INSET, 0.5 - INSET],
  PAVE: [0.5 + INSET, 0.75 - INSET, 0.25 + INSET, 0.5 - INSET],
  TALL: [0.75 + INSET, 1 - INSET, 0.25 + INSET, 0.5 - INSET],
  HOUSE: [0 + INSET, 0.5 - INSET, 0 + INSET, 0.25 - INSET],
  ROOF: [0.5 + INSET, 0.75 - INSET, 0 + INSET, 0.25 - INSET],
  ROOFT: [0.75 + INSET, 1 - INSET, 0 + INSET, 0.25 - INSET],   // telhas rosa/terracota já coloridas (instâncias do tapete)
};
// Janelas em arco desenhadas nas 3 camadas do atlas: L = { c: cor, h: altura (128 = plano; janela
// rebaixada, moldura/peitoril salientes), r: rugosidade (vidro liso, parede fosca) }.
function drawArchWindows(L, x0, y0, w, h, cols, rows, { wall, win, frame, ledge, winW = 0.42, winH = 0.6, door = false }) {
  const layers = [
    { ctx: L.c, wall, win, frame, ledge, extras: true },
    { ctx: L.h, wall: wall ? '#808080' : null, win: '#3a3a3a', frame: frame ? '#9c9c9c' : null, ledge: ledge ? '#b4b4b4' : null, sill: '#a8a8a8' },
    { ctx: L.r, wall: wall ? '#c8c8c8' : null, win: '#404040', frame: frame ? '#c0c0c0' : null, ledge: ledge ? '#c8c8c8' : null },
  ];
  const cw = w / cols, ch = h / rows;
  for (const ly of layers) {
    const ctx = ly.ctx; if (!ctx) continue;
    if (ly.wall) { ctx.fillStyle = ly.wall; ctx.fillRect(x0, y0, w, h); }
    for (let r = 0; r < rows; r++) {
      if (ly.ledge) { ctx.fillStyle = ly.ledge; ctx.fillRect(x0, y0 + r * ch, w, Math.max(2, ch * 0.06)); }
      for (let cI = 0; cI < cols; cI++) {
        const cx = x0 + (cI + 0.5) * cw, top = y0 + r * ch + ch * (1 - winH) * 0.55;
        const ww = cw * winW, hh = ch * winH;
        const isDoor = door && r === rows - 1 && cI === Math.floor(cols / 2);
        const wwF = isDoor ? ww * 1.3 : ww, hhF = isDoor ? ch * 0.8 : hh, topF = isDoor ? y0 + (r + 1) * ch - hhF : top;
        // moldura clara fina (arco), vidro cinza-quente escuro, leve reflexo no alto e peitoril
        if (ly.frame) { ctx.fillStyle = ly.frame; ctx.beginPath(); ctx.moveTo(cx - wwF / 2 - 2.5, topF + hhF + 2.5); ctx.lineTo(cx - wwF / 2 - 2.5, topF + wwF / 2); ctx.arc(cx, topF + wwF / 2, wwF / 2 + 2.5, Math.PI, 0); ctx.lineTo(cx + wwF / 2 + 2.5, topF + hhF + 2.5); ctx.closePath(); ctx.fill(); }
        ctx.fillStyle = ly.win; ctx.beginPath(); ctx.moveTo(cx - wwF / 2, topF + hhF); ctx.lineTo(cx - wwF / 2, topF + wwF / 2); ctx.arc(cx, topF + wwF / 2, wwF / 2, Math.PI, 0); ctx.lineTo(cx + wwF / 2, topF + hhF); ctx.closePath(); ctx.fill();
        if (!isDoor && ly.extras) {
          ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.beginPath(); ctx.arc(cx, topF + wwF / 2, wwF / 2 - 1.5, Math.PI * 1.05, Math.PI * 1.75); ctx.lineTo(cx, topF + wwF / 2); ctx.closePath(); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(cx - wwF / 2 - 3, topF + hhF + 1, wwF + 6, Math.max(1.5, wwF * 0.08));
        }
        if (!isDoor && ly.sill) { ctx.fillStyle = ly.sill; ctx.fillRect(cx - wwF / 2 - 3, topF + hhF + 1, wwF + 6, Math.max(1.5, wwF * 0.08)); }
      }
    }
  }
}
// Atlas da cidade: cor + ALTURA (→ mapa de normais: janelas rebaixadas, molduras, pilastras do palácio,
// juntas de argamassa dos tijolos, telhas em relevo, lajes do calçamento) + RUGOSIDADE (vidro liso 0.27,
// paredes foscas ~0.78, tijolo 0.85, telhas 0.72).
function makeCityAtlas() {
  const S = 1024, c = makeCanvas(S, S), ctx = c.getContext('2d');
  const hc = makeCanvas(S, S), hctx = hc.getContext('2d'), rc = makeCanvas(S, S), rctx = rc.getContext('2d');
  const L = { c: ctx, h: hctx, r: rctx };
  ctx.fillStyle = '#f4f1ea'; ctx.fillRect(0, 0, S, S);
  hctx.fillStyle = '#808080'; hctx.fillRect(0, 0, S, S);
  rctx.fillStyle = '#c8c8c8'; rctx.fillRect(0, 0, S, S);
  // PAL: fileiras de janelas em arco (palácio branco) com pilastras entre as colunas
  drawArchWindows(L, 0, 0, 512, 512, 22, 12, { wall: '#f6f3ec', win: '#3a3230', frame: '#dcd6cb', ledge: '#d3cdc2', winW: 0.46, winH: 0.68 });
  ctx.fillStyle = 'rgba(0,0,0,0.07)'; hctx.fillStyle = '#9a9a9a';
  for (let i = 1; i < 22; i++) { ctx.fillRect(i * 512 / 22 - 1, 0, 2, 512); hctx.fillRect(i * 512 / 22 - 2, 0, 4, 512); }
  // BRK: tijolo vermelho com arcos creme (argamassa rebaixada)
  ctx.fillStyle = '#a84b3b'; ctx.fillRect(512, 0, 512, 512);
  hctx.fillStyle = '#8a8a8a'; hctx.fillRect(512, 0, 512, 512); rctx.fillStyle = '#d8d8d8'; rctx.fillRect(512, 0, 512, 512);
  ctx.fillStyle = 'rgba(70,25,20,0.45)'; hctx.fillStyle = '#5c5c5c';
  for (let yy = 0; yy < 512; yy += 8) {
    ctx.fillRect(512, yy, 512, 1); hctx.fillRect(512, yy, 512, 1.5);
    const off = (yy / 8) % 2 ? 10 : 0; for (let xx = off; xx < 512; xx += 20) { ctx.fillRect(512 + xx, yy, 1, 8); hctx.fillRect(512 + xx, yy, 1.5, 8); }
  }
  drawArchWindows(L, 512, 0, 512, 512, 16, 8, { wall: null, win: '#3f322d', frame: '#eadbc6', winW: 0.42, winH: 0.62 });
  // PLAIN: creme com leve ruído (relevo quase nulo)
  ctx.fillStyle = '#f5f2ec'; ctx.fillRect(0, 512, 256, 256);
  const grain = noiseCanvas(128, 51, 6, 3, 200, 255);
  ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.5; ctx.drawImage(grain, 0, 512, 256, 256); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  hctx.globalAlpha = 0.12; hctx.drawImage(grain, 0, 512, 256, 256); hctx.globalAlpha = 1;
  // TOWER: janelas estreitas
  drawArchWindows(L, 256, 512, 256, 256, 3, 6, { wall: '#f3efe7', win: '#3a3230', frame: '#d8d2c6', winW: 0.3, winH: 0.62 });
  // PAVE: calçamento (lajes com juntas rebaixadas)
  ctx.fillStyle = '#d9d0bd'; ctx.fillRect(512, 512, 256, 256);
  hctx.fillStyle = '#5a5a5a'; hctx.fillRect(512, 512, 256, 256); rctx.fillStyle = '#d0d0d0'; rctx.fillRect(512, 512, 256, 256);
  const prng = createRng(SEED + 77);
  for (let yy = 512; yy < 768; yy += 32) for (let xx = 512; xx < 768; xx += 32) {
    ctx.fillStyle = `rgba(120,100,80,${0.08 + prng() * 0.18})`; ctx.fillRect(xx + 1, yy + 1, 30, 30);
    const lum = 120 + prng() * 20; hctx.fillStyle = `rgb(${lum},${lum},${lum})`; hctx.fillRect(xx + 2, yy + 2, 28, 28);
  }
  // TALL: prédio de vários andares (3x5 janelas em arco), sem porta
  drawArchWindows(L, 768, 512, 256, 256, 3, 5, { wall: '#ffffff', win: '#3a3230', frame: '#e6e0d5', winW: 0.3, winH: 0.5 });
  ctx.fillStyle = 'rgba(0,0,0,0.07)'; hctx.fillStyle = '#a0a0a0';
  for (let r = 1; r < 5; r++) { ctx.fillRect(768, 512 + r * 51.2 - 1, 256, 2); hctx.fillRect(768, 512 + r * 51.2 - 1.5, 256, 3); }
  // HOUSE: parede branca com 3x2 janelas + porta
  drawArchWindows(L, 0, 768, 512, 256, 3, 2, { wall: '#ffffff', win: '#3a3230', frame: '#e6e0d5', winW: 0.26, winH: 0.44, door: true });
  // ROOF: telhas claras (a cor do vértice tinge); ROOFT: telhas rosa/terracota já coloridas. Altura: cada
  // telha é um arco saliente sobre fundo rebaixado.
  const tiles = (x0, strokeCol) => {
    ctx.strokeStyle = strokeCol; ctx.lineWidth = 2; hctx.strokeStyle = '#b0b0b0'; hctx.lineWidth = 3;
    hctx.fillStyle = '#6a6a6a'; hctx.fillRect(x0, 768, 256, 256); rctx.fillStyle = '#b8b8b8'; rctx.fillRect(x0, 768, 256, 256);
    for (let row = 0; row < 8; row++) {
      const yy = 768 + row * 32 + 16; const off = row % 2 ? 16 : 0;
      for (let xx = x0 + off; xx < x0 + 256 + 32; xx += 32) {
        ctx.beginPath(); ctx.arc(xx, yy, 15, Math.PI, 0); ctx.stroke();
        hctx.save(); hctx.beginPath(); hctx.rect(x0, 768, 256, 256); hctx.clip();
        const g = hctx.createRadialGradient(xx, yy, 2, xx, yy, 15); g.addColorStop(0, '#b4b4b4'); g.addColorStop(1, '#787878');
        hctx.fillStyle = g; hctx.beginPath(); hctx.arc(xx, yy, 15, Math.PI, 0); hctx.fill(); hctx.restore();
      }
    }
  };
  ctx.fillStyle = '#ffffff'; ctx.fillRect(512, 768, 256, 256); tiles(512, '#b8aea2');
  ctx.fillStyle = '#c9775f'; ctx.fillRect(768, 768, 256, 256); tiles(768, 'rgba(90,40,30,0.5)');
  ctx.save(); ctx.beginPath(); ctx.rect(768, 768, 256, 256); ctx.clip();
  const rt = noiseCanvas(128, 93, 5, 3, 170, 255); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.5; ctx.drawImage(rt, 768, 768, 256, 256);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.restore();
  return { map: canvasTexture(c), normal: canvasTexture(normalCanvas(canvasField(hc), 3), false), rough: canvasTexture(rc, false) };
}

function makeTasselTexture() {
  const W = 256, H = 512, c = makeCanvas(W, H), ctx = c.getContext('2d');
  // cúpula rosa com tachas douradas (metade de cima, v∈[0.5,1])
  ctx.fillStyle = '#d2628e'; ctx.fillRect(0, 0, W, 256);
  ctx.fillStyle = 'rgba(0,0,0,0.12)'; for (let yy = 0; yy < 256; yy += 24) ctx.fillRect(0, yy, W, 3);
  for (let row = 0; row < 3; row++) for (let i = 0; i < 10; i++) {
    const cx = (i + 0.5 + (row % 2) * 0.5) * W / 10, cy = 200 - row * 44;
    const g = ctx.createRadialGradient(cx - 2, cy - 2, 1, cx, cy, 8); g.addColorStop(0, '#ffe9a0'); g.addColorStop(1, '#9c6f1e');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 8, 0, TAU); ctx.fill();
  }
  // fios (metade de baixo, v∈[0,0.5]): quase branco com fibras verticais — a COR vem do vértice de cada fio
  ctx.fillStyle = '#f4ecec'; ctx.fillRect(0, 256, W, 256);
  const frng = createRng(SEED + 707);
  for (let i = 0; i < 160; i++) {
    const x = frng() * W, light = frng() < 0.45;
    ctx.strokeStyle = light ? `rgba(255,255,255,${0.2 + frng() * 0.3})` : `rgba(90,40,60,${0.08 + frng() * 0.18})`; ctx.lineWidth = 0.8 + frng() * 1.8;
    ctx.beginPath(); ctx.moveTo(x, 256); ctx.lineTo(x + (frng() - 0.5) * 6, 512); ctx.stroke();
  }
  const grad = ctx.createLinearGradient(0, 256, 0, 512); grad.addColorStop(0, 'rgba(0,0,0,0.18)'); grad.addColorStop(0.25, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.1)');
  ctx.fillStyle = grad; ctx.fillRect(0, 256, W, 256);
  return canvasTexture(c);
}

// Olho: globo castanho-escuro, anel de íris âmbar, pupila, brilho branco (também usado como
// emissiveMap: só o brilho "acende"). Canto inferior-esquerdo = pele escura (anel das pálpebras).
function makeEyeTexture() {
  const S = 256, c = makeCanvas(S, S), ctx = c.getContext('2d');
  ctx.fillStyle = '#2b1d16'; ctx.fillRect(0, 0, S, S);
  const cx = 128, cy = 128;
  // esclera escura levemente mais clara nas bordas (globo úmido)
  let g = ctx.createRadialGradient(cx, cy, 30, cx, cy, 128); g.addColorStop(0, '#2b1d16'); g.addColorStop(0.5, '#34241b'); g.addColorStop(1, '#4a3a30');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  // íris: anel âmbar com estrias radiais
  g = ctx.createRadialGradient(cx, cy, 22, cx, cy, 60); g.addColorStop(0, '#5a3618'); g.addColorStop(0.55, '#8a5a26'); g.addColorStop(0.85, '#6a4420'); g.addColorStop(1, '#2e1e12');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 60, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(40,22,10,0.45)'; ctx.lineWidth = 1.5;
  for (let i = 0; i < 48; i++) { const a = (i / 48) * TAU; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * 26, cy + Math.sin(a) * 26); ctx.lineTo(cx + Math.cos(a + 0.05) * 58, cy + Math.sin(a + 0.05) * 58); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(20,12,6,0.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, cy, 60, 0, TAU); ctx.stroke(); // limbo
  // pupila
  g = ctx.createRadialGradient(cx, cy, 2, cx, cy, 30); g.addColorStop(0, '#000000'); g.addColorStop(0.85, '#050302'); g.addColorStop(1, '#2a1a0c');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 30, 0, TAU); ctx.fill();
  // brilhos (branco puro: o emissivo acende só aqui)
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(cx - 22, cy - 26, 13, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.arc(cx + 24, cy + 20, 6, 0, TAU); ctx.fill();
  // canto escuro para o anel das pálpebras (uv 0..0.06)
  ctx.fillStyle = '#3a373c'; ctx.fillRect(0, S - 20, 20, 20);
  const t = canvasTexture(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Pompom: lã felpuda — manchas de ruído + fios curtos aleatórios (cinza claro: a cor da instância tinge).
function makePompomTextures() {
  const S = 256, c = makeCanvas(S, S), ctx = c.getContext('2d');
  // base quase branca: a cor real vem da instância (evita escurecer duas vezes)
  ctx.fillStyle = '#ededed'; ctx.fillRect(0, 0, S, S);
  const blot = noiseCanvas(128, 61, 9, 3, 170, 255);
  ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.45; ctx.drawImage(blot, 0, 0, S, S);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  const rng = createRng(SEED + 606);
  const b = makeCanvas(S, S), bctx = b.getContext('2d');
  bctx.fillStyle = '#808080'; bctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 4200; i++) {
    const x = rng() * S, y = rng() * S, a = rng() * TAU, L = 4 + rng() * 9, w = 0.7 + rng() * 1.2;
    const light = rng() < 0.5;
    ctx.strokeStyle = light ? `rgba(255,255,255,${0.25 + rng() * 0.35})` : `rgba(40,40,40,${0.15 + rng() * 0.3})`;
    ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); ctx.stroke();
    bctx.strokeStyle = light ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)'; bctx.lineWidth = w; bctx.lineCap = 'round';
    bctx.beginPath(); bctx.moveTo(x, y); bctx.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); bctx.stroke();
  }
  // normal de "pelos": fios curtos em relevo (campo lido do canvas de traços)
  return { map: canvasTexture(c), normal: linearTexture(normalCanvas(canvasField(b), 2.6), 1, 1) };
}

// "Crosta" de casinhas: ladrilho de quadradinhos pastel (malha 20×20 com jitter dentro da célula:
// fecha perfeitamente) com frestas escuras, um lado de sombra e um fio de luz; de longe o dorso lê
// como crosta rosa/branca fina (ref. 4). bump: quadrados claros sobre fundo escuro.
function makeCrustTextures() {
  const S = 1024, N = 20, cell = S / N;
  const c = makeCanvas(S, S), ctx = c.getContext('2d');
  const b = makeCanvas(S, S), bctx = b.getContext('2d');
  ctx.fillStyle = '#a3928b'; ctx.fillRect(0, 0, S, S);
  bctx.fillStyle = '#404040'; bctx.fillRect(0, 0, S, S);
  const rng = createRng(SEED + 808);
  const pale = ['#f7f1e8', '#f3ebe0', '#f1e2d4', '#f2d9cc', '#efd0c2', '#ebe0d0', '#faf5ee', '#e9d6c6', '#f4e6e0', '#e6c9bd', '#d9b5a8', '#f0dcd2'];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    if (rng() < 0.06) continue;                               // fresta/ruela
    const gap = cell * (0.12 + rng() * 0.14);
    const w = cell - gap - rng() * cell * 0.18, h = cell - gap - rng() * cell * 0.18;
    const x = i * cell + gap * 0.5 + rng() * (cell - w - gap), y = j * cell + gap * 0.5 + rng() * (cell - h - gap);
    const col = pale[Math.floor(rng() * pale.length)];
    ctx.fillStyle = col; ctx.fillRect(x, y, w, h);
    // lado de sombra (embaixo/direita) e fio de luz (em cima)
    ctx.fillStyle = 'rgba(80,50,45,0.26)'; ctx.fillRect(x, y + h - h * 0.26, w, h * 0.26); ctx.fillRect(x + w - w * 0.14, y, w * 0.14, h);
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x, y, w, Math.max(1, h * 0.08));
    if (rng() < 0.3) { ctx.fillStyle = 'rgba(205,120,100,0.55)'; ctx.fillRect(x + w * 0.1, y + h * 0.1, w * 0.8, h * 0.45); }   // telhado rosa
    const lum = 150 + rng() * 90;
    bctx.fillStyle = `rgb(${lum},${lum},${lum})`; bctx.fillRect(x, y, w, h);
  }
  const grain = noiseCanvas(256, 93, 6, 3, 200, 255);
  ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.2; for (let y = 0; y < S; y += 256) for (let x = 0; x < S; x += 256) ctx.drawImage(grain, x, y, 256, 256);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  return { map: canvasTexture(c), bump: canvasTexture(b, false) };
}
// Sprite macio para o jato d'água (disco radial branco → transparente).
function makeSprayTexture() {
  const S = 64, c = makeCanvas(S, S), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.35, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

let shared = null;
function getShared() {
  if (shared) return shared;
  const skin = makeSkinTextures(), trunk = makeTrunkTextures(), cloth = makeClothTextures(), gold = makeGoldTextures(), ivory = makeIvoryTextures();
  const city = makeCityAtlas(), tassel = makeTasselTexture(), eye = makeEyeTexture(), pom = makePompomTextures();
  const crust = makeCrustTextures(), spray = makeSprayTexture();
  const NS = new THREE.Vector2(MT.SKIN_NORMAL_SCALE, MT.SKIN_NORMAL_SCALE);
  const mat = {
    // pele: PBR fosca e empoeirada; micro-rugas/fendas/poros no mapa de normais (repetido 8×), rugosidade
    // absoluta no roughnessMap (roughness=1 → o mapa manda), dobras grandes na geometria
    // pele esculpida (malha única): os mesmos mapas em triplanar, sem UV
    skinTri: makeTriplanarSkin(skin),
    skin: new THREE.MeshStandardMaterial({ map: skin.map, vertexColors: true, normalMap: skin.normal, normalScale: NS, roughnessMap: skin.rough, roughness: 1, metalness: 0, envMapIntensity: MT.SKIN_ENV }),
    // manga listrada da tromba: tecido (trama tecida na normal)
    trunk: new THREE.MeshStandardMaterial({ map: trunk.map, normalMap: trunk.normal, normalScale: new THREE.Vector2(0.6, 0.6), roughness: MT.CLOTH_ROUGHNESS, metalness: 0, envMapIntensity: 0.45 }),
    cloth: new THREE.MeshStandardMaterial({ map: cloth.map, normalMap: cloth.normal, normalScale: new THREE.Vector2(0.6, 0.6), roughness: MT.CLOTH_ROUGHNESS, metalness: 0, envMapIntensity: 0.45 }),
    // marfim: creme levemente translúcido (sheen + clearcoat fraco), veios ao longo da presa
    ivory: new THREE.MeshPhysicalMaterial({ map: ivory.map, normalMap: ivory.normal, normalScale: new THREE.Vector2(0.35, 0.35), roughness: MT.IVORY_ROUGHNESS, metalness: 0, clearcoat: MT.IVORY_CLEARCOAT, clearcoatRoughness: 0.4, sheen: 0.3, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xfff2dc), envMapIntensity: 0.8 }),
    // ouro-bronze escovado: metal puro (reflete o envMap); emissivo residual fraco para não ficar preto sem envMap
    gold: new THREE.MeshStandardMaterial({ color: MT.GOLD_COLOR, metalness: 1, roughness: 1, roughnessMap: gold.rough, normalMap: gold.normal, normalScale: new THREE.Vector2(0.35, 0.35), emissive: 0x3a2608, emissiveIntensity: MT.GOLD_EMISSIVE, envMapIntensity: MT.GOLD_ENV }),
    // cidade: cor do vértice × atlas (paredes brancas no atlas → sem escurecer duas vezes); janelas rebaixadas e lisas
    city: new THREE.MeshStandardMaterial({ map: city.map, normalMap: city.normal, normalScale: new THREE.Vector2(MT.CITY_NORMAL_SCALE, MT.CITY_NORMAL_SCALE), roughnessMap: city.rough, roughness: 1, vertexColors: true, metalness: 0, envMapIntensity: 0.5 }),
    // borla: cúpula rosa (textura) + fios (cor por vértice sobre textura quase branca)
    pink: new THREE.MeshStandardMaterial({ map: tassel, vertexColors: true, roughness: 0.85, metalness: 0, envMapIntensity: 0.4 }),
    // olho: esclera molhada (clearcoat + roughness baixa); brilho branco acende via emissiveMap
    eye: new THREE.MeshPhysicalMaterial({ map: eye, emissiveMap: eye, emissive: 0xffffff, emissiveIntensity: 0.45, roughness: MT.EYE_ROUGHNESS, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1 }),
    silver: new THREE.MeshStandardMaterial({ color: 0xbdb9b2, metalness: 1, roughness: 1, roughnessMap: gold.rough, normalMap: gold.normal, normalScale: new THREE.Vector2(0.3, 0.3), emissive: 0x2a2724, emissiveIntensity: 0.5, envMapIntensity: 0.55 }),
    // lã: sem brilho algum + pelos em relevo (a cor vem da instância)
    // lã bouclé real (Poly Haven): a cor bege-clara da textura é neutralizada (color) para a instância tingir
    pompom: new THREE.MeshStandardMaterial({ map: pom.map, normalMap: pom.normal, normalScale: new THREE.Vector2(1.1, 1.1), roughness: 1.0, metalness: 0, envMapIntensity: 0.4 }),
    // crosta de casinhas do dorso (casca fina; alfa por vértice esmaece as bordas)
    crust: new THREE.MeshStandardMaterial({ map: crust.map, bumpMap: crust.bump, bumpScale: 2.5, roughness: 0.85, metalness: 0, vertexColors: true, transparent: true, depthWrite: true, alphaTest: 0.02, envMapIntensity: 0.5 }),
    // jato d'água: pontos aditivos brancos (a cor por vértice esmaece para névoa)
    spray: new THREE.PointsMaterial({ map: spray, size: EM.SPRAY_POINT_SIZE * (E.SCALE || 1), sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true, opacity: 0.5, fog: true }),
  };
  // Texturas reais (Poly Haven, CC0; src/assets.js) — carregam de forma assíncrona e entram nos
  // materiais quando TODAS as imagens chegaram (antes disso valem os mapas procedurais):
  //   pele (triplanar): fabric_leather_02 + brown_mud_dry;  panos/manga: poly_wool_herringbone;
  //   pompons: wool_boucle (só a normal: a cor do bouclé é xadrez).
  const herr = (ru, rv, map) => tex('poly_wool_herringbone', map, { repeat: [ru, rv] });
  const real = {
    clothN: herr(MT.CLOTH_WEAVE_REPEAT, MT.CLOTH_WEAVE_REPEAT, 'nor_gl'), clothR: herr(MT.CLOTH_WEAVE_REPEAT, MT.CLOTH_WEAVE_REPEAT, 'rough'),
    trunkN: herr(MT.TRUNK_WEAVE_REPEAT.u, MT.TRUNK_WEAVE_REPEAT.v, 'nor_gl'), trunkR: herr(MT.TRUNK_WEAVE_REPEAT.u, MT.TRUNK_WEAVE_REPEAT.v, 'rough'),
    pomN: tex('wool_boucle', 'nor_gl', { repeat: [2, 1] }),
  };
  const all = [...Object.values(real), ...Object.values(mat.skinTri.userData.real)];
  let upgraded = false;
  const upgrade = () => {
    if (upgraded || !all.every((t) => t && t.image && t.image.width)) return;
    upgraded = true;
    mat.skinTri.userData.onReady();
    mat.cloth.normalMap = real.clothN; mat.cloth.roughnessMap = real.clothR; mat.cloth.roughness = 1; mat.cloth.normalScale.set(0.8, 0.8);
    mat.trunk.normalMap = real.trunkN; mat.trunk.roughnessMap = real.trunkR; mat.trunk.roughness = 1; mat.trunk.normalScale.set(0.8, 0.8);
    mat.pompom.normalMap = real.pomN;   // (a cor do bouclé é xadrez: tingida pela instância vira tartã → fica a lã procedural na cor)
    for (const k of ['cloth', 'trunk', 'pompom']) mat[k].needsUpdate = true;
  };
  shared = { mat, upgrade };
  return shared;
}

// ------------------------------------------------------------------
//  geometria: utilidades
// ------------------------------------------------------------------
// Garante índice, cor e atributos de skinning (todos os vértices presos a UM osso).
function prep(g, bone = 0, color = 0xffffff) {
  if (!g.index) g = mergeVertices(g);
  const n = g.attributes.position.count;
  if (!g.attributes.color) {
    const col = new Float32Array(n * 3), c = new THREE.Color(color);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  if (!g.attributes.skinIndex) {   // sem pesos calculados: todos os vértices presos a UM osso
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { si[i * 4] = bone; sw[i * 4] = 1; }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  }
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}
function scaleUV(g, su, sv, ou = 0, ov = 0) {
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, ou + uv.getX(i) * su, ov + uv.getY(i) * sv); return g;
}
// Remapeia uv (0..1) para uma região do atlas, numa faixa de vértices. ru/rv ≤ 1 usam só parte da
// região (sem repetição: regiões de atlas não podem dar wrap); valores maiores são limitados a 1.
function remapUV(g, reg, from = 0, to = Infinity, ru = 1, rv = 1) {
  const uv = g.attributes.uv; const end = Math.min(to, uv.count);
  for (let i = from; i < end; i++) {
    const u = Math.min(1, uv.getX(i) * ru), v = Math.min(1, uv.getY(i) * rv);
    uv.setXY(i, reg[0] + u * (reg[1] - reg[0]), reg[2] + v * (reg[3] - reg[2]));
  }
  return g;
}
function setColorRange(g, color, from = 0, to = Infinity) {
  const n = g.attributes.position.count;
  if (!g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  const col = g.attributes.color, c = new THREE.Color(color), end = Math.min(to, n);
  for (let i = from; i < end; i++) col.setXYZ(i, c.r, c.g, c.b);
  return g;
}
function flipWinding(g) {
  const idx = g.index; for (let i = 0; i < idx.count; i += 3) { const b = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, b); }
  return g;
}
function mapVertices(g, fn) {
  const p = g.attributes.position, v = new V3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); fn(v, i); p.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals(); return g;
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new V3(), _s = new V3(), _up = new V3(0, 1, 0);
function placeGeom(g, pos, quat = null, scale = 1) {
  _s.setScalar(scale); _m.compose(pos, quat || _q.identity(), typeof scale === 'number' ? _s : scale);
  g.applyMatrix4(_m); return g;
}
function quatFromUp(dir, out = new THREE.Quaternion()) { return out.setFromUnitVectors(_up, dir); }

// Tubo ao longo de uma curva com raio variável (anel a anel). uv: u ao redor, v ao longo.
function tubeGeometry(curve, segs, radial, radiusAt, { capStart = false, capEnd = true, disp = null } = {}) {
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = [], nor = [], uv = [], idx = [];
  const P = new V3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs; curve.getPointAt(t, P); const r0 = radiusAt(t);
    const N = frames.normals[i], Bn = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU, cx = Math.cos(a), sx = Math.sin(a);
      const r = disp ? r0 + disp(t, j === radial ? 0 : j / radial) : r0;
      const nx = cx * N.x + sx * Bn.x, ny = cx * N.y + sx * Bn.y, nz = cx * N.z + sx * Bn.z;
      pos.push(P.x + r * nx, P.y + r * ny, P.z + r * nz); nor.push(nx, ny, nz); uv.push(j / radial, t);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const cap = (ring, t, flip) => {
    const c = pos.length / 3; curve.getPointAt(t, P); pos.push(P.x, P.y, P.z); nor.push(0, 0, 0); uv.push(0.5, t);
    for (let j = 0; j < radial; j++) { const a = ring + j, b = ring + j + 1; if (flip) idx.push(c, a, b); else idx.push(c, b, a); }
  };
  if (capStart) cap(0, 0, false);
  if (capEnd) cap(segs * (radial + 1), 1, true);
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  // garante faces para fora (compara normal calculada com a analítica do 1º anel)
  const analytic = new V3(nor[(radial + 1) * 3], nor[(radial + 1) * 3 + 1], nor[(radial + 1) * 3 + 2]);
  g.computeVertexNormals();
  const comp = new V3().fromBufferAttribute(g.attributes.normal, radial + 1);
  if (comp.dot(analytic) < 0) { flipWinding(g); g.computeVertexNormals(); }
  weldSeam(g, (k) => k * (radial + 1), (k) => k * (radial + 1) + radial, segs + 1);
  return g;
}
// Divide uma malha indexada em duas pelo v médio de cada triângulo (< vSplit → primeira): usada para a
// tromba (manga de tecido / ponta de pele com materiais diferentes). Saída não indexada (prep solda).
function splitByV(g, vSplit) {
  const idx = g.index.array, pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  const out = [[], []];
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    const vm = (uv.getY(a) + uv.getY(b) + uv.getY(c)) / 3;
    out[vm < vSplit ? 0 : 1].push(a, b, c);
  }
  return out.map((list) => {
    const n = list.length, P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2);
    for (let k = 0; k < n; k++) { const s = list[k]; P[k * 3] = pos.getX(s); P[k * 3 + 1] = pos.getY(s); P[k * 3 + 2] = pos.getZ(s); N[k * 3] = nor.getX(s); N[k * 3 + 1] = nor.getY(s); N[k * 3 + 2] = nor.getZ(s); U[k * 2] = uv.getX(s); U[k * 2 + 1] = uv.getY(s); }
    const o = new THREE.BufferGeometry();
    o.setAttribute('position', new THREE.BufferAttribute(P, 3)); o.setAttribute('normal', new THREE.BufferAttribute(N, 3)); o.setAttribute('uv', new THREE.BufferAttribute(U, 2));
    return o;
  });
}
// "Para cima" perpendicular à tangente de uma curva (para apoiar casas no dorso das presas)
function surfaceUp(tangent, out) { out.set(0, 1, 0).addScaledVector(tangent, -tangent.y); if (out.lengthSq() < 1e-6) out.set(1, 0, 0); return out.normalize(); }

// Subdivide triângulos (não indexados) pela aresta mais longa até maxLen: as tampas da ExtrudeGeometry
// só têm vértices no contorno, e as deformações não lineares (earWarp) precisam de amostras no interior.
function tessellate(g, maxLen, maxIter = 12) {
  if (g.index) g = g.toNonIndexed();
  let pos = Array.from(g.attributes.position.array), uv = Array.from(g.attributes.uv.array);
  const mid = (a, b) => a.map((v, i) => (v + b[i]) * 0.5);
  for (let it = 0; it < maxIter; it++) {
    const np = [], nu = []; let split = false;
    for (let t = 0; t < pos.length / 9; t++) {
      const P = [0, 1, 2].map((k) => pos.slice(t * 9 + k * 3, t * 9 + k * 3 + 3)), U = [0, 1, 2].map((k) => uv.slice(t * 6 + k * 2, t * 6 + k * 2 + 2));
      const L = [0, 1, 2].map((k) => { const a = P[k], b = P[(k + 1) % 3]; return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); });
      let k = 0; if (L[1] > L[k]) k = 1; if (L[2] > L[k]) k = 2;
      if (L[k] <= maxLen) { np.push(...P[0], ...P[1], ...P[2]); nu.push(...U[0], ...U[1], ...U[2]); continue; }
      split = true;
      const a = k, b = (k + 1) % 3, c = (k + 2) % 3, M = mid(P[a], P[b]), MU = mid(U[a], U[b]);
      np.push(...P[a], ...M, ...P[c], ...M, ...P[b], ...P[c]); nu.push(...U[a], ...MU, ...U[c], ...MU, ...U[b], ...U[c]);
    }
    pos = np; uv = nu; if (!split) break;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.computeVertexNormals(); return out;
}

// AO de cavidade por vértice (cor do vértice) a partir da própria malha: c = (média dos vizinhos − p)·n,
// normalizado pelo percentil 90 de |c| da peça → vincos esculpidos (côncavos) escurecem, cristas clareiam
// de leve. Uma passada de suavização tira o ruído de malha. Multiplica a cor que já houver.
function bakeCavity(g, dark = MT.SKIN_CAVITY_AO, lift = MT.SKIN_RIDGE_LIFT) {
  const idx = g.index; if (!idx) return g;
  const p = g.attributes.position, nrm = g.attributes.normal, n = p.count, I = idx.array;
  const sum = new Float32Array(n * 3), cnt = new Float32Array(n), elen = new Float32Array(n);
  for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = I[t + e], b = I[t + (e + 1) % 3];
    const dx = p.getX(b) - p.getX(a), dy = p.getY(b) - p.getY(a), dz = p.getZ(b) - p.getZ(a), L = Math.hypot(dx, dy, dz);
    sum[a * 3] += dx; sum[a * 3 + 1] += dy; sum[a * 3 + 2] += dz; cnt[a]++; elen[a] += L;
    sum[b * 3] -= dx; sum[b * 3 + 1] -= dy; sum[b * 3 + 2] -= dz; cnt[b]++; elen[b] += L;
  }
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!cnt[i]) continue;
    const L = elen[i] / cnt[i] || 1;
    c[i] = (sum[i * 3] * nrm.getX(i) + sum[i * 3 + 1] * nrm.getY(i) + sum[i * 3 + 2] * nrm.getZ(i)) / cnt[i] / L;
  }
  const abs = Array.from(c, Math.abs).sort((x, y) => x - y), p90 = abs[Math.floor(abs.length * 0.9)] || 1;
  // suavização (média com os vizinhos de aresta)
  const sm = new Float32Array(n), sc = new Float32Array(n);
  for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) { const a = I[t + e], b = I[t + (e + 1) % 3]; sm[a] += c[b]; sc[a]++; sm[b] += c[a]; sc[b]++; }
  const col = g.attributes.color;
  for (let i = 0; i < n; i++) {
    const v = (0.5 * c[i] + 0.5 * (sc[i] ? sm[i] / sc[i] : c[i])) / p90;
    const f = v > 0 ? 1 - dark * smooth(0, 1.2, v) : 1 + lift * smooth(0, 1.2, -v);
    col.setXYZ(i, col.getX(i) * f, col.getY(i) * f, col.getZ(i) * f);
  }
  return g;
}

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function fuzzySphere(r, ws, hs, amount) {
  const g = new THREE.SphereGeometry(r, ws, hs);
  // deslocamento radial por hash do vértice (tufos); mergeVertices antes para o polo deslocar junto
  const m = mergeVertices(g);
  // tufos: lóbulos de baixa frequência (ruído 3D) + fibras soltas (hash por vértice) → lã, não pedra
  mapVertices(m, (v) => {
    const k = 9 / r; const n = hashInt(Math.round(v.x * k * 1.31), Math.round(v.y * k * 1.07), Math.round(v.z * k * 1.19));
    const lobe = noise.noise3(v.x / r * 2.2 + 4.1, v.y / r * 2.2, v.z / r * 2.2);
    v.multiplyScalar(1 + amount * (0.55 * (n - 0.5) + 0.6 * lobe));
  });
  return m;
}

// Casa em caixa: paredes com janelas (atlas HOUSE), telhado tingido (ROOF), base lisa.
// upAxis: 'y' (cidade do dorso/presas) ou 'z' (terraços das orelhas: o lado de fora da orelha é +z).
// facadeOut: a face de cima recebe a fachada com janelas (blocos das orelhas); tall: fachada de vários andares.
function boxHouse(w, h, d, upAxis, wallColor, roofColor, facadeOut = false, tall = false, noBottom = false) {
  let g = new THREE.BoxGeometry(w, h, d);
  if (noBottom) { // remove a face de baixo (−y ou −z): afundada na pele, nunca se vê → 10 triângulos
    const idx = Array.from(g.index.array), f0 = upAxis === 'y' ? 18 : 30; idx.splice(f0, 6); g.setIndex(idx);
  }
  const sideReg = tall ? REG.TALL : REG.HOUSE;
  // ordem das faces na BoxGeometry: +x, -x, +y, -y, +z, -z (4 vértices cada)
  const faces = { px: [0, 4], nx: [4, 8], py: [8, 12], ny: [12, 16], pz: [16, 20], nz: [20, 24] };
  const roof = upAxis === 'y' ? faces.py : faces.pz, bottom = upAxis === 'y' ? faces.ny : faces.nz;
  setColorRange(g, wallColor);
  for (const k of Object.keys(faces)) {
    const f = faces[k];
    if (f === roof) { remapUV(g, facadeOut === 'plain' ? REG.PLAIN : facadeOut ? (tall ? REG.TALL : REG.HOUSE) : REG.ROOF, f[0], f[1]); setColorRange(g, roofColor, f[0], f[1]); }
    else if (f === bottom) remapUV(g, REG.PLAIN, f[0], f[1]);
    else remapUV(g, facadeOut ? REG.PLAIN : sideReg, f[0], f[1]);
  }
  return g;
}
// Telhado de duas águas (cume ao longo de x), base em y=0
function roofWedge(w, d, h, color) {
  const hw = w / 2, hd = d / 2;
  const pos = [-hw, 0, hd, hw, 0, hd, hw, h, 0, -hw, h, 0, hw, 0, -hd, -hw, 0, -hd, -hw, h, 0, hw, h, 0, hw, 0, hd, hw, 0, -hd, hw, h, 0, -hw, 0, -hd, -hw, 0, hd, -hw, h, 0];
  const idx = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 11, 12, 13];
  const uv = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 0.5, 1, 0, 0, 1, 0, 0.5, 1];
  const g = new THREE.BufferGeometry();
  g.setIndex(idx); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals(); remapUV(g, REG.ROOF); setColorRange(g, color);
  return g;
}
// Caixa de arquitetura com região do atlas nas laterais, topo liso e cor de vértice
function archBox(w, h, d, sideReg, color, { ru = 1, rv = 1, topReg = REG.PLAIN, topColor = color } = {}) {
  const g = new THREE.BoxGeometry(w, h, d);
  setColorRange(g, color);
  remapUV(g, sideReg, 0, 8, ru, rv); remapUV(g, sideReg, 16, 24, ru, rv);
  remapUV(g, topReg, 8, 12); setColorRange(g, topColor, 8, 12); remapUV(g, REG.PLAIN, 12, 16);
  return g;
}

// ------------------------------------------------------------------
//  superfícies (consultas na pele esculpida: tabelas por direção de src/elephant/sculpt.js)
// ------------------------------------------------------------------
// Ponto da pele do corpo na direção unitária d (mesma parametrização do elipsoide do corpo); com
// "folds" inclui as dobras deslocadas. nOut (opcional) recebe a normal suave.
function bodyPoint(d, out, folds = true, nOut = null) { skinBody(d, out, nOut, folds); return out; }
// Ponto da pele da cabeça para uma direção unitária d (a partir do centro HD)
function headPoint(d, out, folds = true, nOut = null) { skinHead(d, out, nOut, folds); return out; }
// Direção na cabeça a partir de latitude/longitude (lon 0 = frente +X, positivo = +Z)
function headDir(lat, lon, out) { return out.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)); }
// Empurra um ponto para fora do tubo da raiz da tromba (a ponta da placa e a guirlanda abraçam a raiz)
const _tp = new V3();
function pushOutOfTrunk(p, lift) {
  let bestD = Infinity, bestT = 0;
  for (let i = 0; i <= 40; i++) { const t = (i / 40) * 0.4; TRUNK_CURVE.getPointAt(t, _tp); const d = _tp.distanceTo(p); if (d < bestD) { bestD = d; bestT = t; } }
  const r = trunkR(bestT) + lift; if (bestD >= r) return p;
  TRUNK_CURVE.getPointAt(bestT, _tp); return p.sub(_tp).normalize().multiplyScalar(r).add(_tp);
}

// Placa dourada da testa: parametrização (s: 0 topo → 1 ponta na raiz da tromba; w: -1..1).
// Gota ENORME: do alto do crânio até a raiz da tromba, e para os lados até as orelhas (ref. 1).
const PLATE = { latTop: 1.32, latBot: -0.68, maxHalf: 0.95 };
function plateHalfWidth(s) {
  if (s < 0.32) return PLATE.maxHalf * Math.sqrt(Math.max(0, 1 - ((0.32 - s) / 0.32) ** 2));
  return PLATE.maxHalf * Math.pow(Math.max(0, 1 - (s - 0.32) / 0.68), 0.58);
}
function platePoint(s, w, lift, out) {
  const lat = lerp(PLATE.latTop, PLATE.latBot, s), lon = w * plateHalfWidth(s);
  const d = headDir(lat, lon, new V3());
  headPoint(d, out, false); out.addScaledVector(d, lift + EM.FOLD_HEAD);   // placa rígida: pele sem dobras + folga
  return pushOutOfTrunk(out, lift + 6);
}

// ------------------------------------------------------------------
//  o modelo
// ------------------------------------------------------------------
// Peças fixas encaixadas na pele esculpida (iguais para os 7 elefantes): faixas dos tornozelos,
// unhas, manga de tecido da tromba e seus anéis. Calculadas uma vez por qualidade.
const fittedCache = {};
// Lança da linha/eixo (o) para fora até a pele; distância limitada a sMax (além disso a peça afunda
// sob outra parte — ex.: a manga da tromba sob a face).
const _fo = new V3(), _fn = new V3();
function fitOut(o, dir, lift, sMax, out, folds = true) {
  let s = 0, d = sdf(o.x, o.y, o.z);
  for (let it = 0; it < 96 && d < -0.25 && s < sMax; it++) { s += Math.max(-d, 0.5); d = sdf(o.x + dir.x * s, o.y + dir.y * s, o.z + dir.z * s); }
  s = Math.min(s, sMax);
  out.copy(o).addScaledVector(dir, s);
  gradient(out.x, out.y, out.z, _fn);
  if (folds) out.addScaledVector(_fn, foldAt(out, _fn));
  return out.addScaledVector(_fn, lift);
}
function getFitted(low) {
  const key = low ? 'low' : 'high';
  if (fittedCache[key]) return fittedCache[key];
  const out = { bands: [], nails: [], sleeve: null, sleeveRings: [] };
  const P = new V3(), o = new V3(), dir = new V3();
  // --- faixas dos tornozelos: casca que segue a pele (dobras incluídas) 11 m acima dela ---
  const BAND_Y0 = 62, BAND_Y1 = 232, RAD = 30, ROWS = 7;
  for (let li = 0; li < 4; li++) {
    const [sx, sz] = LEGS[li];
    const pos = [], uv = [], idx = [], ringR = [];
    for (let r = 0; r <= ROWS; r++) {
      const y = lerp(BAND_Y0, BAND_Y1, r / ROWS); let acc = 0;
      legAxis(sx, sz, y, o);
      for (let j = 0; j <= RAD; j++) {
        const a = (j / RAD) * TAU; dir.set(Math.cos(a), 0, Math.sin(a));
        if (j === RAD) { pos.push(pos[(r * (RAD + 1)) * 3], pos[(r * (RAD + 1)) * 3 + 1], pos[(r * (RAD + 1)) * 3 + 2]); }
        else { fitOut(o, dir, 11, 400, P); pos.push(P.x, P.y, P.z); acc += Math.hypot(P.x - o.x, P.z - o.z); }
        uv.push(j / RAD, 0.255 + 0.24 * (r / ROWS));
      }
      ringR.push({ y, r: acc / RAD, c: o.clone() });
    }
    for (let r = 0; r < ROWS; r++) for (let j = 0; j < RAD; j++) { const a = r * (RAD + 1) + j, b = a + RAD + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const g = new THREE.BufferGeometry(); g.setIndex(idx);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals(); weldSeam(g, (k) => k * (RAD + 1), (k) => k * (RAD + 1) + RAD, ROWS + 1);
    { const n = new V3().fromBufferAttribute(g.attributes.normal, (RAD + 1) * 2); const p0 = new V3().fromBufferAttribute(g.attributes.position, (RAD + 1) * 2); legAxis(sx, sz, p0.y, o); if (n.dot(p0.sub(o)) < 0) { flipWinding(g); g.computeVertexNormals(); } }
    out.bands.push({ g, rings: [ringR[0], ringR[ROWS]] });
    // unhas: 5 na borda do pé, da frente para os lados
    const nails = [];
    legAxis(sx, sz, -14, o);
    for (const a of [-1.05, -0.52, 0, 0.52, 1.05]) {
      dir.set(Math.cos(a), 0, Math.sin(a)); fitOut(o, dir, -6, 400, P, false);   // unhas sempre à frente (+X)
      nails.push({ p: P.clone(), d: dir.clone() });
    }
    out.nails.push(nails);
  }
  // --- manga de tecido da tromba (t 0.04 → TRUNK_FABRIC_END) 9 m acima da pele ---
  {
    const segs = low ? 52 : 84, radial = low ? 16 : 24, t0 = 0.04, t1 = TRUNK_FABRIC_END;
    const frames = TRUNK_CURVE.computeFrenetFrames(segs, false);
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= segs; i++) {
      const t = lerp(t0, t1, i / segs); TRUNK_CURVE.getPointAt(t, o);
      const fi = Math.round(t * segs), N = frames.normals[Math.min(segs, fi)], Bn = frames.binormals[Math.min(segs, fi)];
      for (let j = 0; j <= radial; j++) {
        if (j === radial) { const k = (i * (radial + 1)) * 3; pos.push(pos[k], pos[k + 1], pos[k + 2]); }
        else {
          const a = (j / radial) * TAU; dir.set(0, 0, 0).addScaledVector(N, Math.cos(a)).addScaledVector(Bn, Math.sin(a)).normalize();
          fitOut(o, dir, 9, trunkR(t) * 1.22 + 18, P); pos.push(P.x, P.y, P.z);
        }
        uv.push(j / radial, t);
      }
    }
    for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) { const a = i * (radial + 1) + j, b = a + radial + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
    const g = new THREE.BufferGeometry(); g.setIndex(idx);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    { const k = Math.floor(segs / 2) * (radial + 1); const n = new V3().fromBufferAttribute(g.attributes.normal, k), p0 = new V3().fromBufferAttribute(g.attributes.position, k); TRUNK_CURVE.getPointAt(lerp(t0, t1, 0.5), o); if (n.dot(p0.sub(o)) < 0) { flipWinding(g); g.computeVertexNormals(); } }
    weldSeam(g, (k) => k * (radial + 1), (k) => k * (radial + 1) + radial, segs + 1);
    skinWeightsFor(g);
    out.sleeve = g;
    // raio médio da manga nos anéis de ouro
    for (const tr of [TRUNK_FABRIC_END - 0.01, 0.47]) {
      TRUNK_CURVE.getPointAt(tr, o); const tan = TRUNK_CURVE.getTangentAt(tr); const N = new V3(0, 0, 1).cross(tan).normalize(), Bn = new V3().crossVectors(tan, N);
      let acc = 0; for (let j = 0; j < 12; j++) { const a = (j / 12) * TAU; dir.set(0, 0, 0).addScaledVector(N, Math.cos(a)).addScaledVector(Bn, Math.sin(a)); fitOut(o, dir, 0, trunkR(tr) * 1.3, P, false); acc += P.distanceTo(o); }
      out.sleeveRings.push({ t: tr, r: acc / 12 });
    }
  }
  fittedCache[key] = out;
  return out;
}

// Material da pele esculpida: mapas da pele (cor, normal micro, rugosidade) amostrados em TRIPLANAR no
// espaço do modelo em pose de ligação (sem UV, sem emendas); o quadro tangente de cada projeção sai das
// derivadas de tela (funciona com skinning). AO de cavidade na cor do vértice.
function makeTriplanarSkin(src) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: MT.SKIN_ENV });
  // detalhe real (Poly Haven, CC0): couro enrugado (normal + rugosidade, 2 escalas) e lama seca
  // rachada (normal + luminância da cor, 2 escalas) — carregados de forma assíncrona: até chegarem,
  // usa os mapas procedurais (triReady = 0)
  const real = { leatherN: tex('fabric_leather_02', 'nor_gl'), leatherR: tex('fabric_leather_02', 'rough'), mudN: tex('brown_mud_dry', 'nor_gl'), mudD: tex('brown_mud_dry', 'diff') };
  m.color.setRGB(SC.SKIN_TINT[0], SC.SKIN_TINT[1], SC.SKIN_TINT[2]);
  const uni = {
    triMap: { value: src.map }, triNormal: { value: src.normal }, triRough: { value: src.rough },
    triScaleC: { value: 1 / SC.TRI_COLOR_TILE }, triScaleN: { value: 1 / SC.TRI_NORMAL_TILE }, triNS: { value: MT.SKIN_NORMAL_SCALE }, triSharp: { value: SC.TRI_SHARPNESS },
    triReady: { value: 0 }, leatherN: { value: src.normal }, leatherR: { value: src.rough }, mudN: { value: src.normal }, mudD: { value: src.rough },
    scLeather: { value: new THREE.Vector2(1 / SC.LEATHER_TILE, 1 / (SC.LEATHER_TILE * 2.618)) }, scMud: { value: new THREE.Vector2(1 / SC.MUD_TILE, 1 / (SC.MUD_TILE * 2.71)) },
    nsLeather: { value: SC.LEATHER_NORMAL }, nsMud: { value: SC.MUD_NORMAL }, mudTone: { value: SC.MUD_TONE },
  };
  // pronto quando as 4 imagens tiverem chegado (verificado a cada quadro pelo elefante)
  // (as texturas só entram nos uniformes depois de carregadas: antes disso ficam os mapas procedurais)
  m.userData.real = real;
  m.userData.onReady = () => { for (const k of Object.keys(real)) uni[k].value = real[k]; uni.triReady.value = 1; };
  m.userData.triplanar = uni;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTriP;\nvarying vec3 vTriN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTriP = position;\nvTriN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vTriP;
varying vec3 vTriN;
uniform sampler2D triMap, triNormal, triRough, leatherN, leatherR, mudN, mudD;
uniform float triScaleC, triScaleN, triNS, triSharp, triReady, nsLeather, nsMud, mudTone;
uniform vec2 scLeather, scMud;
// normal em espaço tangente de uma projeção: couro (2 escalas) + lama rachada, mistura "whiteout"
vec3 triTanN(vec2 p) {
  vec3 a = texture2D(leatherN, p * scLeather.x).xyz * 2.0 - 1.0, b = texture2D(leatherN, p * scLeather.y + 0.37).xyz * 2.0 - 1.0;
  vec3 c = texture2D(mudN, p * scMud.x + 0.61).xyz * 2.0 - 1.0;
  vec2 xy = a.xy * nsLeather * 0.65 + b.xy * nsLeather * 0.45 + c.xy * nsMud;
  return normalize(vec3(xy, a.z * b.z * c.z));
}
// luminância da lama seca (2 escalas) relativa à média → modula o cinza quente procedural
float triMud(vec2 p) {
  float l = dot(texture2D(mudD, p * scMud.x + 0.61).rgb, vec3(0.299, 0.587, 0.114)) * 0.6 + dot(texture2D(mudD, p * scMud.y + 0.2).rgb, vec3(0.299, 0.587, 0.114)) * 0.4;
  return mix(1.0, clamp(l / 0.11, 0.35, 1.8), mudTone);
}
vec3 triW() { vec3 w = pow(abs(normalize(vTriN)), vec3(triSharp)); return w / (w.x + w.y + w.z); }
vec3 triPerturb(vec3 eyePos, vec3 N, vec2 uv, vec3 mapN) {
  vec3 q0 = dFdx(eyePos), q1 = dFdy(eyePos); vec2 st0 = dFdx(uv), st1 = dFdy(uv);
  vec3 q1perp = cross(q1, N), q0perp = cross(N, q0);
  vec3 T = q1perp * st0.x + q0perp * st1.x, B = q1perp * st0.y + q0perp * st1.y;
  float det = max(dot(T, T), dot(B, B)); float sc = det == 0.0 ? 0.0 : inversesqrt(det);
  return normalize(mat3(T * sc, B * sc, N) * mapN);
}`)
      .replace('#include <map_fragment>', `{
  vec3 tw = triW(); vec3 tp = vTriP * triScaleC;
  vec4 tc = texture2D(triMap, tp.zy) * tw.x + texture2D(triMap, tp.xz) * tw.y + texture2D(triMap, tp.xy) * tw.z;
  if (triReady > 0.5) tc.rgb *= triMud(vTriP.zy) * tw.x + triMud(vTriP.xz) * tw.y + triMud(vTriP.xy) * tw.z;
  diffuseColor *= tc;
}`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = roughness;
{
  vec3 tw = triW(); vec3 tp = vTriP * triScaleN;
  if (triReady > 0.5) {
    vec2 s = vec2(scLeather.x); float r = texture2D(leatherR, vTriP.zy * s.x).g * tw.x + texture2D(leatherR, vTriP.xz * s.x).g * tw.y + texture2D(leatherR, vTriP.xy * s.x).g * tw.z;
    roughnessFactor *= clamp(0.62 + 0.45 * r, 0.6, 0.97);
  } else roughnessFactor *= texture2D(triRough, tp.zy).g * tw.x + texture2D(triRough, tp.xz).g * tw.y + texture2D(triRough, tp.xy).g * tw.z;
}`)
      .replace('#include <normal_fragment_maps>', `{
  vec3 tw = triW(); vec3 tp = vTriP * triScaleN;
  vec3 mx, my, mz;
  if (triReady > 0.5) { mx = triTanN(vTriP.zy); my = triTanN(vTriP.xz); mz = triTanN(vTriP.xy); }
  else {
    mx = texture2D(triNormal, tp.zy).xyz * 2.0 - 1.0; mx.xy *= triNS;
    my = texture2D(triNormal, tp.xz).xyz * 2.0 - 1.0; my.xy *= triNS;
    mz = texture2D(triNormal, tp.xy).xyz * 2.0 - 1.0; mz.xy *= triNS;
  }
  vec3 nAcc = tw.x * triPerturb(-vViewPosition, normal, tp.zy, mx) + tw.y * triPerturb(-vViewPosition, normal, tp.xz, my) + tw.z * triPerturb(-vViewPosition, normal, tp.xy, mz);
  normal = normalize(nAcc);
}`);
  };
  m.customProgramCacheKey = () => 'ruppen-skin-triplanar';
  return m;
}

export function createElephant(route, index, opts = {}) {
  const low = opts.quality === 'low';
  const S = getShared();
  const rng = createRng(SEED + 7919 * (index + 1));
  const group = new THREE.Group();
  group.name = 'elephant_' + index;
  const rig = new THREE.Group(); // recebe o balanço vertical do passo
  group.add(rig);
  getTables();

  // ossos (src/elephant/sculpt.js → BONES): raiz, quadril+joelho ×4, cabeça, 4 da tromba, cauda, orelhas
  const bones = BONES.map((b) => { const bo = new THREE.Bone(); bo.name = b.name; const pp = b.parent >= 0 ? BONES[b.parent].pos : [0, 0, 0]; bo.position.set(b.pos[0] - pp[0], b.pos[1] - pp[1], b.pos[2] - pp[2]); return bo; });
  BONES.forEach((b, i) => { if (b.parent >= 0) bones[b.parent].add(bones[i]); });
  const legBone = (li, knee) => 1 + li * 2 + (knee ? 1 : 0);
  const HEAD_POS = new V3(...BONES[BONE.head].pos);

  // partes por material (grupos do SkinnedMesh)
  const parts = { skin: [], trunk: [], cloth: [], ivory: [], gold: [], city: [], pink: [], eye: [], silver: [] };
  // pele: oclusão de cavidade (AO dos vincos esculpidos) gravada na cor do vértice
  // (malhas em grade regular apenas: a orelha tesselada tem triângulos desiguais → cavity = ruído; cavity=false)
  const add = (key, g, bone = 0, color, cavity = true) => { const pg = prep(g, bone, color); if (key === 'skin' && cavity) bakeCavity(pg); parts[key].push(pg); return g; };
  const tmp = new V3(), tmp2 = new V3(), tmp3 = new V3();
  const fitted = getFitted(low);

  // ====================== PELE ESCULPIDA (uma malha) ======================
  // corpo, pescoço, cabeça, tromba, patas e cauda: um único campo de distância poligonizado
  // (compartilhado pelos 7 elefantes), com skinning pelos ossos acima
  const skinGeom = getSkinGeometry(low ? SC.CELL_LOW : SC.CELL_HIGH);
  // olhos: globo castanho-escuro com íris âmbar e brilho (textura + emissivo), na órbita esculpida;
  // anel de pele escura ao redor (pálpebra) + dobra de pele por cima
  for (const E0 of EYES) {
    const d = E0.dir, side = Math.sign(E0.pos.z), at = E0.pos;
    const g = new THREE.SphereGeometry(EM.EYE_RADIUS, 20, 14);
    // o centro da textura (u=v=0.5) fica em +X da esfera → aponta na direção d (para fora da cabeça)
    const q = new THREE.Quaternion().setFromUnitVectors(new V3(1, 0, 0), d);
    // u cobre 360° e v 180°: comprime u ×2 para a íris ficar redonda (a borda da textura é esclera escura, clamp)
    { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) - 0.5) * 2 + 0.5, uv.getY(i)); }
    placeGeom(g, tmp.copy(at).addScaledVector(d, -EM.EYE_SINK), q);
    add('eye', g, BONE.head);
    // anel de pele escura (pálpebras) rente à pele, mapeado no canto escuro da textura do olho
    const ring = new THREE.TorusGeometry(EM.EYE_RADIUS + 3, 9, 8, 24);
    placeGeom(ring, tmp.copy(at).addScaledVector(d, -4), new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, 1), d));
    remapUV(ring, [0.01, 0.05, 0.01, 0.05]);
    add('eye', ring, BONE.head);
    // pálpebra superior: dobra de pele por cima (meia-casca), ligeiramente acima do globo
    const lid = new THREE.SphereGeometry(EM.EYE_RADIUS + 6, 14, 8, 0, TAU, 0, Math.PI * 0.27);
    placeGeom(lid, tmp.copy(at).addScaledVector(d, -9), quatFromUp(new V3(0.0, 0.92, side * 0.38).normalize()));
    scaleUV(lid, 0.3, 0.1);
    add('skin', lid, BONE.head);
    // dobra da pálpebra: rolo de pele em arco sobre o olho (sobrancelha carnuda) e dobra menor por baixo
    const qd = new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, 1), d);
    const brow = new THREE.TorusGeometry(EM.EYE_RADIUS + 16, 11, 8, 20, Math.PI); brow.rotateZ(0.15 * side);
    placeGeom(brow, tmp.copy(at).addScaledVector(d, -3), qd); scaleUV(brow, 0.5, 0.08); add('skin', brow, BONE.head);
    const under = new THREE.TorusGeometry(EM.EYE_RADIUS + 10, 6, 7, 16, Math.PI); under.rotateZ(Math.PI + 0.1 * side);
    placeGeom(under, tmp.copy(at).addScaledVector(d, -4), qd); scaleUV(under, 0.4, 0.06); add('skin', under, BONE.head);
  }
  // ============================ PATAS ==============================
  // unhas (marfim, meio enterradas na borda do pé) e faixa listrada GROSSA no tornozelo que segue a
  // pele esculpida, com bordas de ouro com contas — tudo preso ao osso do joelho (canela)
  for (let li = 0; li < 4; li++) {
    const bone = legBone(li, true);
    for (const nl of fitted.nails[li]) {
      const n = new THREE.SphereGeometry(1, 10, 7); n.scale(36, 24, 22);
      placeGeom(n, nl.p, new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, 1), nl.d));
      add('ivory', n, bone);
    }
    const band = fitted.bands[li];
    add('cloth', band.g.clone(), bone);
    for (const [k, rr] of band.rings.entries()) {
      const yb = rr.y + (k === 0 ? 4 : -4), rb = rr.r + 4;
      const ring = new THREE.TorusGeometry(rb, 7, 6, 32); ring.rotateX(Math.PI / 2); ring.translate(rr.c.x, yb, rr.c.z); add('gold', ring, bone);
      for (let i = 0; i < 20; i++) { const a = (i / 20) * TAU; const bead = new THREE.OctahedronGeometry(5.5, 0); bead.translate(rr.c.x + Math.cos(a) * (rb + 7), yb, rr.c.z + Math.sin(a) * (rb + 7)); add('gold', bead, bone); }
    }
  }
  // ============================ TROMBA =============================
  // a tromba é pele esculpida (anéis de dobras); por cima, a manga de tecido listrado (até
  // TRUNK_FABRIC_END) com 2 anéis de ouro, deformadas pelos ossos da tromba como a pele
  const trunkCurve = TRUNK_CURVE;
  {
    add('trunk', fitted.sleeve.clone());
    for (const sr of fitted.sleeveRings) {
      const ring = new THREE.TorusGeometry(sr.r + 9, 11, 10, 32);
      const tan = trunkCurve.getTangentAt(sr.t);
      placeGeom(ring, trunkCurve.getPointAt(sr.t), new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, 1), tan));
      add('gold', skinWeightsFor(ring));
    }
  }
  // ============================ PRESAS =============================
  const tuskCurves = [];
  const TUSK_RINGS = [0.25, 0.5, 0.74];
  for (const side of [-1, 1]) {
    // presas: descem da boca, curvam para fora e para a frente e sobem só de leve na ponta
    // (subida reduzida ~40% em relação ao desenho anterior, que lembrava um mamute)
    const curve = new THREE.CatmullRomCurve3([
      new V3(940, 880, side * 115), new V3(1080, 800, side * 210), new V3(1240, 715, side * 300), new V3(1420, 665, side * 365),
      new V3(1600, 674, side * 405), new V3(1750, 728, side * 415), new V3(1850, 809, side * 400), new V3(1890, 866, side * 380)]);
    curve.arcLengthDivisions = 300;
    tuskCurves.push(curve);
    const rAt = (t) => (t < 0.06 ? lerp(92, 72, t / 0.06) : t < 0.97 ? lerp(72, TK.tipRadius, (t - 0.06) / 0.91) : TK.tipRadius * Math.sqrt(Math.max(0, 1 - ((t - 0.97) / 0.03) ** 2)) + 0.5);
    const g = tubeGeometry(curve, low ? 36 : 48, low ? 12 : 14, rAt);
    add('ivory', g, BONE.head);
    // anéis de ouro com contas (3 por presa)
    for (const t of TUSK_RINGS) {
      const tan = curve.getTangentAt(t), P = curve.getPointAt(t), r = rAt(t);
      const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, 1), tan);
      // anel GROSSO (tubo ≈ 0,35 do raio da presa) com duas fileiras de contas nas bordas (ref. 2)
      const tube = r * 0.35;
      const ring = new THREE.TorusGeometry(r + tube * 0.75, tube, 9, 30); placeGeom(ring, P, q); add('gold', ring, BONE.head);
      const N = new V3().crossVectors(tan, _up).normalize(), Bn = new V3().crossVectors(tan, N);
      const nb = 20, rb = tube * 0.3;
      for (const off of [-tube * 0.9, tube * 0.9]) for (let i = 0; i < nb; i++) {
        const a = (i / nb) * TAU + (off > 0 ? Math.PI / nb : 0); const bead = new THREE.OctahedronGeometry(rb, 0);
        placeGeom(bead, tmp.copy(P).addScaledVector(tan, off).addScaledVector(N, Math.cos(a) * (r + tube * 0.75 + tube * 0.55)).addScaledVector(Bn, Math.sin(a) * (r + tube * 0.75 + tube * 0.55)));
        add('gold', bead, BONE.head);
      }
    }
  }
  // ============================ ORELHAS =============================
  // Orelhas GIGANTES: aba orgânica (borda de cima enrolando para fora, lobo de baixo pendendo, leve
  // concavidade), com dobras esculpidas; cobertas por um manto: borda GROSSA listrada (7 listras)
  // concêntrica ao contorno, tecido escuro com vincos dentro e um bloco de MUITAS casinhas pequenas em
  // terraços na parte SUPERIOR-EXTERNA (refs. 1, 3), com 1–2 recortes e torrinhas na borda de cima.
  // Contorno em coordenadas locais da orelha: x<0 para trás, y<0 para baixo, z>0 lado de fora;
  // (0,0) = canto superior dianteiro (pivô na cabeça).
  const earOutline = [[0, 0], [-110, 62], [-300, 94], [-470, 88], [-590, 52], [-660, -40], [-696, -240], [-690, -450], [-656, -640], [-590, -756], [-465, -806], [-300, -814], [-150, -780], [-58, -712], [-4, -600], [22, -450], [24, -280], [14, -120]];
  const esx = (EAR.width * EM.EAR_SCALE) / 696, esy = (EAR.height * EM.EAR_SCALE) / 814;
  const EAR_C = { x: -320 * esx, y: -365 * esy };
  const earShape = (scale = 1, cx = EAR_C.x, cy = EAR_C.y) => {
    const sh = new THREE.Shape();
    const pts = earOutline.map(([x, y]) => new THREE.Vector2(cx + (x * esx - cx) * scale, cy + (y * esy - cy) * scale));
    sh.moveTo(pts[0].x, pts[0].y); sh.splineThru(pts.slice(1).concat([pts[0]]));
    return sh;
  };
  const EAR_W = 696 * esx, EAR_H = 814 * esy;
  // raio do contorno (escala 1) a partir de EAR_C numa direção: p pertence a earShape(s) com s = |p−C| / outlineDist(θ)
  const outlinePoly = earShape(1).extractPoints(12).shape;
  const outlineDist = (theta) => {
    const dx = Math.cos(theta), dy = Math.sin(theta); let best = 1;
    for (let i = 0, j = outlinePoly.length - 1; i < outlinePoly.length; j = i++) {
      const ax = outlinePoly[j].x - EAR_C.x, ay = outlinePoly[j].y - EAR_C.y, bx = outlinePoly[i].x - EAR_C.x, by = outlinePoly[i].y - EAR_C.y;
      const ex = bx - ax, ey = by - ay, den = dx * ey - dy * ex; if (Math.abs(den) < 1e-9) continue;
      const t = (ax * ey - ay * ex) / den, u = (ax * dy - ay * dx) / den;
      if (t > 0 && u >= 0 && u <= 1) best = Math.max(best, t);
    }
    return best;
  };
  const earScaleOf = (x, y) => { const dx = x - EAR_C.x, dy = y - EAR_C.y; return Math.hypot(dx, dy) / outlineDist(Math.atan2(dy, dx)); };
  // deformação da orelha: topo enrolando para fora, traseira abrindo, lobo de baixo abrindo um pouco,
  // leve concavidade no miolo e dobras esculpidas (lençóis quase verticais, ondulados)
  const earWarp = (p) => {
    const u = Math.min(1, Math.max(0, -p.x / EAR_W)), v = Math.min(1, Math.max(0, -p.y / EAR_H));
    const topCurl = Math.max(0, 1 - v / 0.3); p.z += 120 * topCurl * topCurl;        // borda de cima enrola para fora
    p.z += 85 * u * u;                                                               // traseira abre
    const low2 = Math.max(0, (v - 0.55) / 0.45); p.z += 55 * low2 * low2;           // base abre para fora (afasta do ombro)
    p.z -= 38 * Math.sin(Math.PI * u) * Math.sin(Math.PI * Math.min(1, v * 1.15));  // miolo levemente côncavo
    p.z += EM.FOLD_EAR * foldValue(p.x / 70 + 2, p.y / 210, 0.3) + noise.noise2(p.x / 260 + 7, p.y / 260) * 6;
  };
  const earUV = (g) => {
    g.computeBoundingBox(); const bb = g.boundingBox; const p = g.attributes.position; const uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, ((p.getX(i) - bb.min.x) / (bb.max.x - bb.min.x)) * 0.9, ((p.getY(i) - bb.min.y) / (bb.max.y - bb.min.y)) * 0.75);
    return g;
  };
  // uv do miolo do manto (tecido escuro, v 0.75..1): planar
  const coreUV = (g) => {
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, ((p.getX(i) + EAR_W) / EAR_W) * 2.5, 0.75 + 0.25 * 0.98 * ((p.getY(i) + EAR_H) / (EAR_H + 90)));
  };
  // uv da borda listrada (v 0.5..0.75): v = distância ao contorno (listras concêntricas), u = ângulo ao redor
  const ringUV = (g, sOut, sIn) => {
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i); const sc = earScaleOf(x, y);
      const f = Math.min(1, Math.max(0, (sOut - sc) / (sOut - sIn)));
      uv.setXY(i, (Math.atan2(y - EAR_C.y, x - EAR_C.x) / TAU + 0.5) * 9, 0.505 + 0.24 * f);
    }
  };
  const RING_OUT = 0.985, RING_IN = 0.875;   // borda listrada ≈ 11 % do raio da orelha
  const corePoly = earShape(RING_IN - 0.02).extractPoints(8).shape;
  const HR_ = EM.EAR_HOUSE_RECT;
  const HOUSE_RECT = { x0: HR_.x0 * EAR_W, x1: HR_.x1 * EAR_W, y0: HR_.y0 * EAR_H, y1: HR_.y1 * EAR_H };
  for (const side of [-1, 1]) {
    const bone = side < 0 ? BONE.earL : BONE.earR;
    const M = new THREE.Matrix4().compose(new V3(EAR_PIVOT.x, EAR_PIVOT.y, EAR_PIVOT.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.1, EM.EAR_YAW, -0.04, 'YXZ')), new V3(1, 1, 1));
    if (side < 0) M.premultiply(new THREE.Matrix4().makeScale(1, 1, -1));
    const finish = (g) => { g.applyMatrix4(M); if (side < 0) flipWinding(g); g.computeVertexNormals(); return g; };
    // aba de pele (grossa na raiz, fina na borda: bisel)
    let ear = new THREE.ExtrudeGeometry(earShape(1), { depth: 28, bevelEnabled: true, bevelThickness: 18, bevelSize: 18, bevelSegments: 3, curveSegments: low ? 5 : 6 });
    ear.translate(0, 0, 18); earUV(ear); ear = tessellate(ear, low ? 80 : 52); mapVertices(ear, earWarp);
    ear = mergeVertices(ear); ear.computeVertexNormals();
    add('skin', finish(ear), bone, undefined, false);
    // manto: miolo de tecido escuro + borda listrada (anel concêntrico), ambos no lado de fora
    const Z_BL = 67; // acima da face de fora da orelha (bisel chega a z≈64)
    let core = new THREE.ExtrudeGeometry(earShape(RING_IN + 0.01), { depth: 6, bevelEnabled: false, curveSegments: 6 });
    core.translate(0, 0, Z_BL); core = tessellate(core, low ? 90 : 70); coreUV(core);
    mapVertices(core, earWarp); core = mergeVertices(core); core.computeVertexNormals();
    add('cloth', finish(core), bone);
    const ringShape = earShape(RING_OUT); ringShape.holes.push(earShape(RING_IN));
    let ring = new THREE.ExtrudeGeometry(ringShape, { depth: 12, bevelEnabled: true, bevelThickness: 4, bevelSize: 4, bevelSegments: 1, curveSegments: 6 });
    ring.translate(0, 0, Z_BL - 2); ring = tessellate(ring, low ? 80 : 55); ringUV(ring, RING_OUT, RING_IN);
    mapVertices(ring, earWarp); ring = mergeVertices(ring); ring.computeVertexNormals();
    add('cloth', finish(ring), bone);
    // bloco de casinhas em terraços sobre o manto, na parte superior-externa: MUITAS fileiras de
    // caixinhas (profundidades 6–14), com 1–2 recortes e algumas torrinhas finas na borda de cima
    const hrng = createRng(SEED + 500 + index * 13 + side);
    const hg = [];
    const ROWS = EM.EAR_HOUSE_GRID.rows, COLS = EM.EAR_HOUSE_GRID.cols;
    const dy = (HOUSE_RECT.y1 - HOUSE_RECT.y0) / ROWS, dx = (HOUSE_RECT.x1 - HOUSE_RECT.x0) / COLS;
    const notches = [];
    const nN = 1 + (hrng() < 0.5 ? 1 : 0);
    for (let k = 0; k < nN; k++) {
      const c0 = hrng.int(1, COLS - 5), r0 = hrng.int(2, ROWS - 6), cw = hrng.int(2, 4), rh = hrng.int(3, 5);
      notches.push({ c0, c1: c0 + cw, r0, r1: r0 + rh });
    }
    const inNotch = (c, r) => notches.some((n) => c >= n.c0 && c < n.c1 && r >= n.r0 && r < n.r1);
    const inCore = (x, y) => pointInPolygon(x + dx * 0.5, y + dy * 0.5, corePoly) && pointInPolygon(x - dx * 0.5, y - dy * 0.5, corePoly) && pointInPolygon(x + dx * 0.5, y - dy * 0.5, corePoly) && pointInPolygon(x - dx * 0.5, y + dy * 0.5, corePoly);
    // ruas estreitas: 2–3 colunas vazias (becos verticais) e uma fileira vazia (travessa)
    const streets = new Set(); const nSt = hrng.int(MT.EAR_HOUSE_STREETS.min, MT.EAR_HOUSE_STREETS.max);
    while (streets.size < nSt) streets.add(hrng.int(2, COLS - 3));
    const streetRow = hrng.int(4, ROWS - 5);
    const SZ = MT.EAR_HOUSE_SIZE;
    let topRowY = -Infinity;
    for (let row = 0; row < ROWS; row++) {
      const y = HOUSE_RECT.y0 + (row + 0.5) * dy;
      for (let col = 0; col < COLS; col++) {
        const x = HOUSE_RECT.x0 + (col + 0.5) * dx;
        if (!inCore(x, y)) continue;
        if (inNotch(col, row)) continue;
        if (streets.has(col) || row === streetRow) continue;
        if (hrng() < 0.03) continue;
        // profundidades variadas, um pouco maiores nas fileiras de baixo (terraços); algumas torres
        let h = EM.EAR_HOUSE_H.min + (EM.EAR_HOUSE_H.max - EM.EAR_HOUSE_H.min) * (0.35 * hrng() + 0.65 * (1 - row / ROWS) * hrng());
        const tower = hrng() < MT.EAR_TOWER_CHANCE; if (tower) h *= 2.2;
        // tamanhos irregulares (0,7–1,4×), pequenos deslocamentos e rotações: nada de grade uniforme
        const sw = dx * 0.86 * (tower ? 0.7 : hrng.range(SZ.min, SZ.max)), sh = dy * 0.8 * (tower ? 0.7 : hrng.range(SZ.min, SZ.max));
        const ox = hrng.range(-0.14, 0.14) * dx, oy = hrng.range(-0.12, 0.12) * dy, rot = hrng.range(-0.1, 0.1);
        const wall = hrng() < 0.85 ? hrng.pick(COLORS.houses) : hrng.pick([0xd9a593, 0xe7b39f, 0xf0d8c8]);
        const b = boxHouse(sw, sh, h, 'z', wall, wall, hrng() < 0.4 ? true : 'plain', false, true);
        b.rotateZ(rot); b.translate(x + ox, y + oy, Z_BL + 4 + h / 2);
        mapVertices(b, earWarp);
        hg.push(b);
        if (row === ROWS - 1) topRowY = Math.max(topRowY, y + dy * 0.4);
      }
    }
    // torrinhas finas na borda de cima do bloco (sobem no plano da orelha)
    if (topRowY > -Infinity) for (let k = 0; k < 5; k++) {
      const col = 1 + Math.floor(((k + 0.5) / 5) * (COLS - 2)); const x = HOUSE_RECT.x0 + (col + 0.5) * dx;
      const th = 30 + hrng() * 40; if (!inCore(x, topRowY + th * 0.5)) continue;
      const t = archBox(dx * 0.45, th, 9, REG.PLAIN, 0xf6f3ec, { topReg: REG.PLAIN }); t.translate(x, topRowY + th / 2, Z_BL + 4 + 4.5); mapVertices(t, earWarp); hg.push(t);
    }
    if (hg.length) add('city', finish(mergeGeometries(hg, false)), bone);
  }
  // ============================ PLACA DOURADA ======================
  {
    const NS = 34, NW = 22, lift = 15;
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= NS; i++) {
      const s = i / NS;
      for (let j = 0; j <= NW + 2; j++) {
        // colunas 0 e NW+2 descem até a pele (borda com espessura)
        const jj = Math.min(NW, Math.max(0, j - 1)); const w = (jj / NW) * 2 - 1;
        const lf = j === 0 || j === NW + 2 ? -2 - EM.FOLD_HEAD * 1.4 : lift;
        platePoint(s, w, lf, tmp); pos.push(tmp.x, tmp.y, tmp.z); uv.push(j / (NW + 2), s);
      }
    }
    const cols = NW + 3;
    for (let i = 0; i < NS; i++) for (let j = 0; j < cols - 1; j++) { const a = i * cols + j, b = a + cols; idx.push(a, a + 1, b, b, a + 1, b + 1); }
    const g = new THREE.BufferGeometry(); g.setIndex(idx);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    // orientação: normal deve apontar para fora da cabeça
    { const n = new V3().fromBufferAttribute(g.attributes.normal, Math.floor(NS / 2) * cols + Math.floor(cols / 2)); platePoint(0.5, 0, 0, tmp); tmp2.copy(tmp).sub(new V3(HD.cx, HD.cy, 0)); if (n.dot(tmp2) < 0) { flipWinding(g); g.computeVertexNormals(); } }
    add('gold', g, BONE.head);
    // grande bossa dourada no alto da placa + anel
    const boss = new THREE.SphereGeometry(1, 24, 14, 0, TAU, 0, Math.PI / 2);
    platePoint(0.2, 0, lift, tmp); const dn = tmp.clone().sub(new V3(HD.cx, HD.cy, 0)).normalize();
    placeGeom(boss, tmp, quatFromUp(dn), new V3(92, 62, 92)); add('gold', boss, BONE.head);
    const bring = new THREE.TorusGeometry(98, 10, 10, 36); placeGeom(bring, platePoint(0.2, 0, lift + 2, tmp), new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, 1), dn)); add('gold', bring, BONE.head);
  }
  // ============================ BORLA ROSA =========================
  const tasselTop = platePoint(1, 0, 15, new V3());
  {
    const ax = new V3(1335, 0, 0); // eixo vertical da borla (à frente da raiz da tromba)
    const yTop = tasselTop.y - 20;
    // cordão dourado da ponta da placa até a borla
    const strap = new THREE.CylinderGeometry(7, 7, tasselTop.distanceTo(new V3(ax.x, yTop, 0)), 8);
    const mid = tasselTop.clone().add(new V3(ax.x, yTop, 0)).multiplyScalar(0.5);
    placeGeom(strap, mid, quatFromUp(new V3(ax.x, yTop, 0).sub(tasselTop).normalize())); add('gold', strap, BONE.head);
    // pompom vermelho no alto (textura de fios quase branca × cor do vértice)
    const pom = fuzzySphere(58, 16, 12, 0.3); pom.translate(ax.x, yTop - 44, 0);
    remapUV(pom, [0.02, 0.98, 0.04, 0.46]); setColorRange(pom, 0xc43a4c); add('pink', pom, BONE.head);
    // sino dourado (cone) abaixo do pompom
    const bell = new THREE.ConeGeometry(46, 110, 24); bell.rotateX(Math.PI); bell.translate(ax.x, yTop - 100 - 55, 0); add('gold', bell, BONE.head);
    // cúpula rosa com tachas
    const dome = new THREE.SphereGeometry(84, 24, 14, 0, TAU, 0, Math.PI / 2); dome.translate(ax.x, yTop - 100 - 110 - 22, 0);
    remapUV(dome, [0, 1, 0.52, 0.98]); add('pink', dome, BONE.head);
    const domeY = yTop - 100 - 110 - 22;
    const rim = new THREE.TorusGeometry(84, 6, 8, 32); rim.rotateX(Math.PI / 2); rim.translate(ax.x, domeY, 0); add('gold', rim, BONE.head);
    for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU; const s = new THREE.SphereGeometry(9, 7, 5); s.translate(ax.x + Math.cos(a) * 84, domeY - 10, Math.sin(a) * 84); add('gold', s, BONE.head); }
    // franja: MUITOS fios finos (tubos de 4 lados) em 3 anéis concêntricos, pendendo da borda da cúpula,
    // com leve abertura para fora e ondulação; cada fio tem a sua cor (rosa/magenta/laranja)
    {
      const srng = createRng(SEED + 909);
      const NSTR = low ? Math.round(MT.TASSEL_STRANDS * 0.6) : MT.TASSEL_STRANDS;
      const rings = [[0.42, 79], [0.33, 68], [0.25, 57]];
      const cols = [0xd2628e, 0xc9527f, 0xd98a52, 0xd2628e, 0xb84a72, 0xe0a0b8, 0xd2628e, 0xcf7a4e, 0xc45c86];
      let made = 0;
      for (const [frac, rr] of rings) {
        const n = Math.round(NSTR * frac);
        for (let k = 0; k < n; k++) {
          const a = ((k + 0.5) / n) * TAU + srng.range(-0.3, 0.3) * (TAU / n), ca = Math.cos(a), sa = Math.sin(a);
          const r0 = rr + srng.range(-3, 3), L = srng.range(MT.TASSEL_STRAND_LENGTH.min, MT.TASSEL_STRAND_LENGTH.max);
          const flare = srng.range(6, 26), wob = srng.range(-8, 8), ph = srng() * TAU;
          const pts = [];
          for (let s = 0; s <= 4; s++) {
            const t = s / 4, out = r0 + flare * t * t;
            pts.push(new V3(ax.x + ca * out + wob * Math.sin(ph + t * 3) * t, domeY - 4 - L * t, sa * out + wob * Math.cos(ph + t * 2.5) * t));
          }
          const curve = new THREE.CatmullRomCurve3(pts); curve.arcLengthDivisions = 20;
          const rs = MT.TASSEL_STRAND_RADIUS * srng.range(0.85, 1.15);
          const st = tubeGeometry(curve, 6, 4, (t) => rs * (1 - 0.35 * t), { capEnd: false });
          remapUV(st, [0.02, 0.98, 0.04, 0.46]); setColorRange(st, cols[(made++) % cols.length]);
          add('pink', st, BONE.head);
        }
      }
    }
  }
  // ============================ GUIRLANDA ==========================
  const garland = []; // {pos, tangent}
  {
    // laço fechado: borda direita de baixo para cima, depois borda esquerda de cima para baixo
    const loop = [];
    for (let i = 0; i <= 120; i++) loop.push(platePoint(1 - i / 120, 1, 0, new V3()));
    for (let i = 1; i <= 120; i++) loop.push(platePoint(i / 120, -1, 0, new V3()));
    // reamostra por comprimento
    let acc = 0; const spacing = EM.POMPOM_SPACING; let next = spacing * 0.5;
    for (let i = 1; i < loop.length; i++) {
      const seg = loop[i].distanceTo(loop[i - 1]);
      while (acc + seg >= next) {
        const t = (next - acc) / seg; const p = loop[i - 1].clone().lerp(loop[i], t);
        garland.push({ pos: p, tangent: loop[i].clone().sub(loop[i - 1]).normalize() }); next += spacing;
      }
      acc += seg;
    }
    // anéis de prata entre pompons
    for (let i = 0; i < garland.length; i++) {
      const a = garland[i], b = garland[(i + 1) % garland.length];
      if (a.pos.distanceTo(b.pos) > spacing * 1.6) continue;
      const mid = a.pos.clone().lerp(b.pos, 0.5); const dn = mid.clone().sub(new V3(HD.cx, HD.cy, 0)).normalize(); mid.addScaledVector(dn, EM.POMPOM_RADIUS * 0.8);
      // elo de prata visível entre os pompons (cilindro curto + dois anéis)
      const qd = quatFromUp(b.pos.clone().sub(a.pos).normalize());
      const cyl = new THREE.CylinderGeometry(EM.POMPOM_RADIUS * 0.46, EM.POMPOM_RADIUS * 0.46, EM.POMPOM_RADIUS * 0.95, 14); placeGeom(cyl, mid, qd); add('silver', cyl, BONE.head);
      // tampas de prata (flanges) nas duas pontas do elo, encostadas nos pompons
      for (const off of [-0.42, 0.42]) { const cap = new THREE.CylinderGeometry(EM.POMPOM_RADIUS * 0.6, EM.POMPOM_RADIUS * 0.6, EM.POMPOM_RADIUS * 0.16, 14); cap.translate(0, off * EM.POMPOM_RADIUS * 0.95, 0); placeGeom(cap, mid, qd); add('silver', cap, BONE.head); }
    }
  }
  // ============================ TRAMA DA BARRIGA ===================
  {
    const pos = [], uv = [], idx = [];
    const nx0 = 0.0, rows = [nx0 - 0.045, nx0 + 0.045]; const N = 64;
    const k = Math.sqrt(1 - nx0 * nx0); const phi0 = Math.acos(Math.min(1, 0.42 / k));
    for (let r = 0; r < 2; r++) for (let i = 0; i <= N; i++) {
      const phi = phi0 + (i / N) * (TAU - 2 * phi0); const kk = Math.sqrt(1 - rows[r] * rows[r]);
      tmp.set(rows[r], Math.cos(phi) * kk, Math.sin(phi) * kk);
      bodyPoint(tmp, tmp2, true, tmp3).addScaledVector(tmp3, 9); pos.push(tmp2.x, tmp2.y, tmp2.z); uv.push((i / N) * 9, 0.03 + r * 0.19);
    }
    for (let i = 0; i < N; i++) idx.push(i, i + 1, N + 1 + i, N + 1 + i, i + 1, N + 2 + i);
    const g = new THREE.BufferGeometry(); g.setIndex(idx);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
    { const n = new V3().fromBufferAttribute(g.attributes.normal, Math.floor(N / 2)); tmp.set(nx0, Math.cos(Math.PI) , 0); if (n.dot(new V3(0, -1, 0)) < 0) { flipWinding(g); g.computeVertexNormals(); } }
    add('cloth', g);
  }
  // ============================ CIDADE DO DORSO ====================
  // Dois níveis de detalhe: (a) uma casca-CROSTA fina (pele + 3) com textura de casinhas minúsculas,
  // sempre visível: de longe/de cima o dorso lê como crosta rosa/branca; (b) um tapete de MILHARES de
  // casinhas instanciadas (8–16 m de pé no mundo) por cima, escondido além de LOD_DISTANCE.
  // Palácio ENORME (≈ 1/3 do corpo) com muralha arcada, cúpulas douradas, minaretes e torres rosa;
  // prédio de tijolos e praça de mercado no centro (ponto da entrega); 2 templos menores; terraços
  // pálidos pendurados nos flancos; mesquitas e torres espalhadas.
  const city = [];
  const goldCity = [];
  const carpet = { flat: [], tile: [] };   // instâncias do tapete: {m: Matrix4, c: cor}
  const tuskInst = [];                      // instâncias das casinhas das presas
  const rngCity = createRng(SEED + 9001 + index * 31);
  const RX = B.rx * BODY_SX;
  const NC = NECK_C;
  const _sn = new V3();
  // ponto da pele (com dobras) na vertical de (x,z) local, por marcha do campo de distância; devolve a normal
  const surfAt = (x, z, out) => (skinTop(x, z, out, _sn) ? _sn : null);
  const insideNeckOrHead = (p) => (((p.x - NC.x) / 320) ** 2 + ((p.y - NC.y) / 365) ** 2 + (p.z / 365) ** 2 < 1) || (((p.x - HD.cx) / (HR * 1.02)) ** 2 + ((p.y - HD.cy) / (HR * 1.24)) ** 2 + (p.z / (HR * 0.97)) ** 2 < 1);
  const inPalace = (x, z) => Math.abs(x - PALACE_X) < PS.hx + 85 && Math.abs(z) < PS.hz + 80;
  const inBrick = (x, z) => Math.abs(x - BRICK.x) < BRICK.hx + 6 && Math.abs(z - BRICK.z) < BRICK.hz + 6;
  const inPlaza = (x, z) => x > PZ.x0 && x < PZ.x1 && Math.abs(z) < PZ.hz;
  const nearPlaza = (x, z) => x > PZ.x0 - 40 && x < PZ.x1 + 40 && Math.abs(z) < PZ.hz + 40;
  const TEMPLES = [{ x: 390, z: 235, hx: 80, hz: 58, h: 140, ang: 0.25 }, { x: -95, z: -335, hx: 72, hz: 56, h: 125, ang: -0.2 }];
  const inTemple = (x, z) => TEMPLES.some((t) => Math.abs(x - t.x) < t.hx + 30 && Math.abs(z - t.z) < t.hz + 30);
  const PALE = [0xf8f4ec, 0xf4efe5, 0xf1e6d6, 0xf3dccd, 0xf0d0c0, 0xece2d2, 0xfaf6f0, 0xead9c8, 0xf6e9e2];
  {
    const spacing0 = low ? EM.CITY_SPACING_LOW : EM.CITY_SPACING_HIGH;
    const nrm = new V3(), qh = new THREE.Quaternion(), qy = new THREE.Quaternion(), dirv = new V3(), upMix = new V3();
    const dummy = new THREE.Object3D();
    let row = 0;
    const phiMaxAll = EM.CITY_FLANK_ANGLE;
    for (let x = -RX * 0.97; x <= RX * 0.95; x += spacing0, row++) {
      const nx = x / RX; const k = Math.sqrt(Math.max(0.03, 1 - nx * nx));
      const arcR = (k * (B.ry + B.rz)) / 2;      // raio aproximado da seção transversal
      // ângulo máximo a partir do zênite: desce pelos flancos no meio, menos nas pontas
      const phiMax = phiMaxAll * (0.7 + 0.3 * smooth(0.1, 0.5, k));
      let phi = -phiMax + (row % 2 ? 0.5 : 0) * (spacing0 / arcR);
      while (phi <= phiMax) {
        // passo cresce nos flancos (onde só a crosta precisa ler de longe)
        const spacing = spacing0 * (1 + 0.6 * smooth(0.45, phiMaxAll, Math.abs(phi)));
        const dphi = spacing / arcR;
        const p2 = phi + rngCity.range(-0.15, 0.15) * dphi, xx = x + rngCity.range(-0.15, 0.15) * spacing0;
        phi += dphi;
        const nx2 = xx / RX, k2 = Math.sqrt(Math.max(0.03, 1 - nx2 * nx2));
        dirv.set(nx2, Math.cos(p2) * k2, Math.sin(p2) * k2);
        if (!skinBody(dirv, tmp3, nrm, true)) continue;   // coberto por pescoço/patas/cabeça
        const lx = tmp3.x, lz = tmp3.z;
        if (insideNeckOrHead(tmp3)) continue;
        if (Math.abs(nx2 - 0.0) < 0.075 && Math.abs(p2) > 1.05) continue; // trama da barriga
        if (inPalace(lx, lz) || inBrick(lx, lz) || inPlaza(lx, lz) || inTemple(lx, lz)) continue;
        // ruas: curvas de ruído (duas escalas) + avenida central para a frente da praça
        const st = noise.noise2(lx / 230 + index * 3.1, lz / 230 + phi * 0.3);
        if (Math.abs(st) < 0.03) continue;
        const st2 = noise.noise2(lx / 95 + index * 1.7 + 40, lz / 95 - phi * 0.2);
        if (Math.abs(st2) < 0.018) continue;
        if (Math.abs(lz) < 8 && lx > PZ.x1) continue;
        const flank = Math.abs(phi) / phiMax;
        if (rngCity() > 1 - 0.1 * flank * flank * flank) continue;
        const edge = nearPlaza(lx, lz);
        const fl = smooth(0.8, 1.4, Math.abs(phi));
        const foot = rngCity.range(EM.HOUSE_FOOT.min, EM.HOUSE_FOOT.max) * (1 + 0.35 * fl);
        const w = foot * rngCity.range(0.85, 1.15), d = foot * rngCity.range(0.85, 1.15);
        let h = rngCity.range(EM.HOUSE_H.min, EM.HOUSE_H.max) * (1 - 0.25 * flank);
        if (edge) h = rngCity.range(22, 34);
        else if (rngCity() < EM.TALL_BLOCK_CHANCE) h *= 1.6;
        // nos flancos as casas inclinam um pouco para o "para cima" (terraços) e saem da pele em vez
        // de afundar
        upMix.copy(nrm).addScaledVector(_up, 0.45 * fl).normalize();
        qh.copy(quatFromUp(upMix)).multiply(qy.setFromAxisAngle(_up, rngCity.range(-0.25, 0.25)));
        if (edge) {   // prédios mais altos ao redor da praça: geometria mesclada (fachada de vários andares)
          const wall = rngCity.pick(COLORS.houses), roof = rngCity.pick(COLORS.roofs);
          const sink = 10; const b = boxHouse(w * 1.6, h + sink, d * 1.6, 'y', wall, roof, false, true, true);
          b.translate(0, (h - sink) / 2, 0); placeGeom(b, tmp3, qh); city.push(b);
          continue;
        }
        if (carpet.flat.length + carpet.tile.length >= EM.CARPET_MAX) continue;
        // tapete: instância (caixa unitária afundada 30% na pele, acima da crosta)
        dummy.position.copy(tmp3).addScaledVector(nrm, EM.CRUST_OFFSET - 0.3 * h * (1 - fl) + 0.15 * h * fl); dummy.quaternion.copy(qh); dummy.scale.set(w, h, d); dummy.updateMatrix();
        const col = rngCity.pick(PALE);
        (rngCity() < EM.ROOF_TILE_CHANCE ? carpet.tile : carpet.flat).push({ m: dummy.matrix.clone(), c: col });
      }
    }
  }
  // --- o tapete transborda dos ombros para o pescoço (até a nuca / raiz das orelhas) ---
  {
    const spacing = (low ? EM.CITY_SPACING_LOW : EM.CITY_SPACING_HIGH) * 1.15;
    const dummy = new THREE.Object3D(), nrm = new V3(), dn = new V3(), qh = new THREE.Quaternion(), qy = new THREE.Quaternion(), upMix = new V3();
    const dlat = spacing / NC.ry;
    for (let lat = Math.PI / 2 - dlat * 0.5, row = 0; lat > -0.15; lat -= dlat, row++) {
      const ring = NC.rz * Math.cos(lat); const n = Math.max(1, Math.round((TAU * ring) / spacing));
      for (let j = 0; j < n; j++) {
        if (carpet.flat.length + carpet.tile.length >= EM.CARPET_MAX) break;
        const lon = ((j + (row % 2 ? 0.5 : 0)) / n) * TAU + rngCity.range(-0.1, 0.1) * (TAU / n);
        const la = lat + rngCity.range(-0.15, 0.15) * dlat;
        dn.set(Math.cos(la) * Math.cos(lon), Math.sin(la), Math.cos(la) * Math.sin(lon));
        // só onde a pele é do próprio pescoço (fora do corpo e da cabeça)
        if (!skinNeck(dn, tmp3, nrm, true)) continue;
        if (tmp3.x > HD.cx - 60 && tmp3.y < HD.cy + HR * 0.9) continue;
        if (nrm.y < 0.1 && Math.abs(nrm.z) > 0.85) continue;   // flanco baixo do pescoço: pele (debaixo das orelhas)
        const st = noise.noise2(tmp3.x / 230 + index * 3.1, tmp3.z / 230 + la * 0.3); if (Math.abs(st) < 0.03) continue;
        if (rngCity() < 0.12) continue;
        const foot = rngCity.range(EM.HOUSE_FOOT.min, EM.HOUSE_FOOT.max);
        const w = foot * rngCity.range(0.85, 1.15), d = foot * rngCity.range(0.85, 1.15), h = rngCity.range(EM.HOUSE_H.min, EM.HOUSE_H.max) * 0.85;
        upMix.copy(nrm).addScaledVector(_up, 0.9 * smooth(0.7, 0.2, nrm.y)).normalize();
        qh.copy(quatFromUp(upMix)).multiply(qy.setFromAxisAngle(_up, rngCity.range(-0.25, 0.25)));
        dummy.position.copy(tmp3).addScaledVector(nrm, EM.CRUST_OFFSET).addScaledVector(upMix, -0.2 * h); dummy.quaternion.copy(qh); dummy.scale.set(w, h, d); dummy.updateMatrix();
        (rngCity() < EM.ROOF_TILE_CHANCE ? carpet.tile : carpet.flat).push({ m: dummy.matrix.clone(), c: rngCity.pick(PALE) });
      }
    }
  }
  // --- casca-CROSTA (dorso + pescoço): casca fina a CRUST_OFFSET da pele com a textura de casinhas;
  //     alfa por vértice esmaece as bordas (recorte orgânico nos flancos) ---
  let crustGeom = null;
  {
    const pos = [], uv = [], col = [], idx = [];
    const nrm = new V3(), dirv = new V3();
    const grid = (NX, NP, vertexFn) => {
      const base = pos.length / 3;
      for (let i = 0; i <= NX; i++) for (let j = 0; j <= NP; j++) vertexFn(i / NX, j / NP);
      for (let i = 0; i < NX; i++) for (let j = 0; j < NP; j++) { const a = base + i * (NP + 1) + j, b = a + NP + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
    };
    const phiMax = EM.CRUST_FLANK_ANGLE, REP = EM.CRUST_REPEAT;
    grid(low ? 40 : 54, low ? 28 : 36, (fi, fj) => {
      const nx = -0.985 + fi * (0.985 + 0.96), k = Math.sqrt(Math.max(0.02, 1 - nx * nx)), phi = -phiMax + fj * 2 * phiMax;
      dirv.set(nx, Math.cos(phi) * k, Math.sin(phi) * k); const own = skinBody(dirv, tmp3, nrm, true);
      tmp3.addScaledVector(nrm, EM.CRUST_OFFSET);
      pos.push(tmp3.x, tmp3.y, tmp3.z); uv.push(fi * REP, fj * REP * 1.35);
      const edge = noise.noise2(nx * 3 + index * 1.3, phi * 2.2) * 0.25;
      let a = 1 - smooth(phiMax - 0.55, phiMax - 0.05, Math.abs(phi) + edge);
      a *= 1 - smooth(0.92, 0.985, -nx + edge * 0.4);                       // garupa: borda esmaecida
      if (Math.abs(nx - 0.0) < 0.075 && Math.abs(phi) > 1.05) a = 0;       // trama da barriga
      if (!own) a = 0;                                                      // sob pescoço/patas
      col.push(1, 1, 1, a);
    });
    grid(low ? 32 : 40, low ? 14 : 20, (fi, fj) => {   // pescoço: lon ao redor, lat 0 → π/2
      const lon = fi * TAU, lat = fj * (Math.PI / 2 - 0.02);
      dirv.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)); const own = skinNeck(dirv, tmp3, nrm, true); tmp3.addScaledVector(nrm, EM.CRUST_OFFSET);
      pos.push(tmp3.x, tmp3.y, tmp3.z); uv.push(fi * REP * 0.9, fj * REP * 0.45);
      const a = own ? smooth(0.06, 0.32, lat) * (1 - smooth(0.72, 0.9, Math.abs(dirv.z)) * (1 - smooth(0.25, 0.55, dirv.y))) : 0;
      col.push(1, 1, 1, a);
    });
    const g = new THREE.BufferGeometry(); g.setIndex(idx);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    g.computeVertexNormals();
    { const n = new V3().fromBufferAttribute(g.attributes.normal, 18 * 37 + 18); if (n.y < 0) { flipWinding(g); g.computeVertexNormals(); } }
    crustGeom = g;
  }
  // --- palácio (atrás do centro): bloco longo de arcadas brancas + andar recuado + tambor + cúpula
  //     dourada; 2 cúpulas médias e 4 pequenas; 8 minaretes com varandas; 4 torres rosa de telhado
  //     cônico; muro de tijolos arcado ---
  {
    const px = PALACE_X; const yb = 1100; // base desce fundo (afunda no corpo; na garupa vira muralha arcada)
    const base = archBox(PS.hx * 2, PALACE_BASE_TOP - yb, PS.hz * 2, REG.PAL, 0xf4f1ea); base.translate(px, (PALACE_BASE_TOP + yb) / 2, 0); city.push(base);
    // soco de tijolos vermelhos com arcos ao redor da base
    const sock = archBox(PS.hx * 2 + 14, 80, PS.hz * 2 + 14, REG.BRK, 0xffffff, { rv: 0.25 }); sock.translate(px, 1330, 0); city.push(sock);
    // cornija + andar recuado
    const cornice = archBox(PS.hx * 2 + 16, 14, PS.hz * 2 + 16, REG.PLAIN, 0xe9e3d8); cornice.translate(px, PALACE_BASE_TOP + 6, 0); city.push(cornice);
    const tier = archBox(PS.hx * 1.1, PALACE_TIER_H, PS.hz * 1.3, REG.PAL, 0xf4f1ea, { rv: 0.25 }); tier.translate(px, PALACE_BASE_TOP + PALACE_TIER_H / 2, 0); city.push(tier);
    const drum = new THREE.CylinderGeometry(DOME_R + 8, DOME_R + 8, DRUM_H, 36, 1, false); remapUV(drum, REG.PAL, 0, Infinity, 1, 0.085); setColorRange(drum, 0xf4f1ea);
    drum.translate(px, PALACE_BASE_TOP + PALACE_TIER_H + DRUM_H / 2, 0); city.push(drum);
    const dome = new THREE.SphereGeometry(DOME_R, 36, 20, 0, TAU, 0, Math.PI / 2); dome.translate(px, DOME_CY, 0); goldCity.push(dome);
    const spire = new THREE.ConeGeometry(8, 60, 10); spire.translate(px, DOME_CY + DOME_R + 26, 0); goldCity.push(spire);
    const knob = new THREE.SphereGeometry(10, 8, 6); knob.translate(px, DOME_CY + DOME_R + 2, 0); goldCity.push(knob);
    // 2 cúpulas médias sobre tambores nas alas (ref. 4: fileira de cúpulas)
    for (const dx of [-PS.hx + 95, PS.hx - 95]) {
      const R2 = 74, DH = 40;
      const dr = new THREE.CylinderGeometry(R2 + 6, R2 + 6, DH, 28, 1, false); remapUV(dr, REG.PAL, 0, Infinity, 1, 0.07); setColorRange(dr, 0xf4f1ea); dr.translate(px + dx, PALACE_BASE_TOP + DH / 2, 0); city.push(dr);
      const d2 = new THREE.SphereGeometry(R2, 28, 14, 0, TAU, 0, Math.PI / 2); d2.translate(px + dx, PALACE_BASE_TOP + DH, 0); goldCity.push(d2);
      const sp2 = new THREE.ConeGeometry(5, 40, 8); sp2.translate(px + dx, PALACE_BASE_TOP + DH + R2 + 18, 0); goldCity.push(sp2);
    }
    // cúpulas menores nos cantos do bloco principal
    for (const [cx, cz] of [[-PS.hx + 40, -PS.hz + 44], [-PS.hx + 40, PS.hz - 44], [PS.hx - 40, -PS.hz + 44], [PS.hx - 40, PS.hz - 44]]) {
      const sd = new THREE.SphereGeometry(36, 16, 9, 0, TAU, 0, Math.PI / 2); sd.translate(px + cx, PALACE_BASE_TOP + 14, cz); goldCity.push(sd);
      const sdr = new THREE.CylinderGeometry(38, 38, 16, 16); remapUV(sdr, REG.PLAIN); setColorRange(sdr, 0xf4f1ea); sdr.translate(px + cx, PALACE_BASE_TOP + 12, cz); city.push(sdr);
    }
    // minaretes altos com varandas (4 cantos + 2 atrás + 2 à frente)
    const minPos = [[px - PS.hx - 30, -PS.hz - 30], [px - PS.hx - 30, PS.hz + 30], [px + PS.hx + 30, -PS.hz - 30], [px + PS.hx + 30, PS.hz + 30], [px - 70, -PS.hz - 50], [px - 70, PS.hz + 50], [px + 110, -PS.hz - 50], [px + 110, PS.hz + 50]];
    for (let i = 0; i < minPos.length; i++) {
      const [mx, mz] = minPos[i]; const h = (i < 4 ? 560 : 440) + rngCity.range(-15, 15); const y0 = 1380;
      const shaft = new THREE.CylinderGeometry(14, 18, h, 12); remapUV(shaft, REG.PLAIN); setColorRange(shaft, 0xf6f3ec); shaft.translate(mx, y0 + h / 2, mz); city.push(shaft);
      for (const f of [0.55, 0.74, 0.9]) {
        const balc = new THREE.CylinderGeometry(26, 20, 12, 12); remapUV(balc, REG.PLAIN); setColorRange(balc, 0xe8e2d6); balc.translate(mx, y0 + h * f, mz); city.push(balc);
        const rail = new THREE.CylinderGeometry(27, 27, 14, 12, 1, true); remapUV(rail, REG.TOWER, 0, Infinity, 1, 0.12); setColorRange(rail, 0xf2ede4); rail.translate(mx, y0 + h * f + 13, mz); city.push(rail);
      }
      const cap = new THREE.SphereGeometry(19, 12, 8, 0, TAU, 0, Math.PI / 2); cap.translate(mx, y0 + h, mz); goldCity.push(cap);
      const pin = new THREE.ConeGeometry(4, 40, 6); pin.translate(mx, y0 + h + 30, mz); goldCity.push(pin);
    }
    // torres redondas ROSA de telhado cônico
    const pinkTower = (tx, ty0, tz, th) => {
      const tw = new THREE.CylinderGeometry(34, 38, th, 14); remapUV(tw, REG.TOWER, 0, Infinity, 1, 0.99); setColorRange(tw, 0xf3ece3); tw.translate(tx, ty0 + th / 2, tz); city.push(tw);
      const balc = new THREE.CylinderGeometry(46, 36, 16, 14); remapUV(balc, REG.PLAIN); setColorRange(balc, 0xe8e2d6); balc.translate(tx, ty0 + th - 30, tz); city.push(balc);
      const roof = new THREE.ConeGeometry(44, 130, 14); remapUV(roof, REG.PLAIN); setColorRange(roof, 0xe8a0b4); roof.translate(tx, ty0 + th + 65, tz); city.push(roof);
      const tip = new THREE.SphereGeometry(6, 8, 6); tip.translate(tx, ty0 + th + 130, tz); goldCity.push(tip);
    };
    // muro LONGO de tijolos vermelhos com arcos à frente do palácio (entre o palácio e a praça)
    {
      const wx = px + PS.hx + 52; surfAt(wx, 0, tmp3); const wy0 = tmp3.y - 40, wh = 120;
      const wall = archBox(40, wh, PS.hz * 2 + 220, REG.BRK, 0xffffff, { rv: 0.3, topColor: 0xd9c7ab }); wall.translate(wx, wy0 + wh / 2, 0); city.push(wall);
      const crown = archBox(48, 10, PS.hz * 2 + 228, REG.PLAIN, 0xe9d9c4); crown.translate(wx, wy0 + wh + 4, 0); city.push(crown);
      for (const tz of [-(PS.hz + 130), PS.hz + 130]) pinkTower(wx, wy0 - 20, tz, 300);
    }
    for (const tz of [-(PS.hz + 70), PS.hz + 70]) pinkTower(px - PS.hx - 60, 1310, tz, 260);
    // torres quadradas com telhado piramidal (rosa e vinho) nos fundos
    const tcol = [0xe8a0b4, 0xb0563d];
    for (const [i, tz] of [[0, -90], [1, 90]]) {
      const tw = new THREE.BoxGeometry(54, 280, 54); setColorRange(tw, 0xf1ece3); remapUV(tw, REG.TOWER, 0, 8); remapUV(tw, REG.TOWER, 16, 24); remapUV(tw, REG.PLAIN, 8, 16);
      tw.translate(px - PS.hx - 50, 1330 + 140, tz); city.push(tw);
      const roof = new THREE.ConeGeometry(40, 90, 4); roof.rotateY(Math.PI / 4); remapUV(roof, REG.PLAIN); setColorRange(roof, tcol[i]); roof.translate(px - PS.hx - 50, 1330 + 280 + 45, tz); city.push(roof);
    }
  }
  // --- prédio alto de tijolos vermelhos com arcos, ao lado da praça ---
  {
    surfAt(BRICK.x, BRICK.z, tmp3); const y0 = tmp3.y - 40;
    const brick = archBox(BRICK.hx * 2, BRICK_TOP - y0, BRICK.hz * 2, REG.BRK, 0xffffff, { topColor: 0xc9b79c }); brick.translate(BRICK.x, (BRICK_TOP + y0) / 2, BRICK.z); city.push(brick);
    const crown = archBox(BRICK.hx * 2 + 10, 14, BRICK.hz * 2 + 10, REG.PLAIN, 0xe9d9c4); crown.translate(BRICK.x, BRICK_TOP + 5, BRICK.z); city.push(crown);
    // minarete fino colado ao prédio
    const mh = 300; const shaft = new THREE.CylinderGeometry(9, 11, mh, 10); remapUV(shaft, REG.PLAIN); setColorRange(shaft, 0xf6f3ec); shaft.translate(BRICK.x + BRICK.hx + 16, y0 + mh / 2, BRICK.z + BRICK.hz - 10); city.push(shaft);
    const cap = new THREE.SphereGeometry(13, 10, 7, 0, TAU, 0, Math.PI / 2); cap.translate(BRICK.x + BRICK.hx + 16, y0 + mh, BRICK.z + BRICK.hz - 10); goldCity.push(cap);
  }
  // --- praça de mercado (terraço calçado no centro do dorso) com tendas coloridas ---
  {
    surfAt((PZ.x0 + PZ.x1) / 2, 0, tmp3); const top = PLAZA_TOP;
    const plaza = new THREE.BoxGeometry(PZ.x1 - PZ.x0, 80, PZ.hz * 2); setColorRange(plaza, 0xe4dccb); remapUV(plaza, REG.PLAIN, 0, 8); remapUV(plaza, REG.PLAIN, 12, 24); remapUV(plaza, REG.PAVE, 8, 12);
    plaza.translate((PZ.x0 + PZ.x1) / 2, top - 40, 0); city.push(plaza);
    const trng = createRng(SEED + 4242 + index);
    for (let i = 0; i < 22; i++) {
      const t = new THREE.ConeGeometry(trng.range(4, 6), 5, trng() < 0.5 ? 4 : 8); t.rotateY(Math.PI / 4); setColorRange(t, trng.pick(COLORS.pompoms)); remapUV(t, REG.PLAIN);
      t.translate(PZ.x0 + 20 + trng() * (PZ.x1 - PZ.x0 - 40), top + 4, -PZ.hz + 16 + trng() * (PZ.hz * 2 - 32)); city.push(t);
    }
    // fonte no centro da praça
    const fb = new THREE.CylinderGeometry(10, 11, 4, 12); remapUV(fb, REG.PLAIN); setColorRange(fb, 0xd9d0bd); fb.translate((PZ.x0 + PZ.x1) / 2, top + 2, 0); city.push(fb);
  }
  // --- torres esguias ---
  const slimTower = (p, up, h, color, capGold = true, r = 6.5) => {
    const q = quatFromUp(up);
    const shaft = new THREE.CylinderGeometry(r, r * 1.25, h, 10); remapUV(shaft, REG.TOWER, 0, Infinity, 1, Math.min(0.99, h / 160)); setColorRange(shaft, color);
    shaft.translate(0, h / 2 - 4, 0); placeGeom(shaft, p, q); city.push(shaft);
    const top = new THREE.CylinderGeometry(r * 1.7, r * 1.4, 8, 10); remapUV(top, REG.PLAIN); setColorRange(top, color); top.translate(0, h - 4, 0); placeGeom(top, p, q); city.push(top);
    if (capGold) { const cap = new THREE.SphereGeometry(r * 1.55, 8, 5, 0, TAU, 0, Math.PI / 2); cap.translate(0, h - 2, 0); placeGeom(cap, p, q); goldCity.push(cap); }
    else { const cap = new THREE.ConeGeometry(r * 1.7, r * 3, 8); remapUV(cap, REG.PLAIN); setColorRange(cap, 0xb0563d); cap.translate(0, h + r * 1.2, 0); placeGeom(cap, p, q); city.push(cap); }
  };
  // --- 2 templos menores (bloco arcado + soco de tijolos + tambor + cúpula dourada + 4 minaretes) ---
  for (const T of TEMPLES) {
    const n = surfAt(T.x, T.z, tmp3); if (!n) continue;
    const y0 = tmp3.y - 36, q = new THREE.Quaternion().setFromAxisAngle(_up, T.ang), at = new V3(T.x, y0, T.z);
    const blk = archBox(T.hx * 2, T.h, T.hz * 2, REG.PAL, 0xf4f1ea, { rv: Math.min(1, T.h / 300) }); blk.translate(0, T.h / 2, 0); placeGeom(blk, at, q); city.push(blk);
    const sock = archBox(T.hx * 2 + 8, 36, T.hz * 2 + 8, REG.BRK, 0xffffff, { rv: 0.12 }); sock.translate(0, 18, 0); placeGeom(sock, at, q); city.push(sock);
    const dr = Math.min(T.hx, T.hz) * 0.62;
    const drum = new THREE.CylinderGeometry(dr + 4, dr + 4, 30, 24); remapUV(drum, REG.PAL, 0, Infinity, 1, 0.06); setColorRange(drum, 0xf4f1ea); drum.translate(0, T.h + 15, 0); placeGeom(drum, at, q); city.push(drum);
    const dome = new THREE.SphereGeometry(dr, 24, 12, 0, TAU, 0, Math.PI / 2); dome.translate(0, T.h + 30, 0); placeGeom(dome, at, q); goldCity.push(dome);
    const sp = new THREE.ConeGeometry(4, 34, 8); sp.translate(0, T.h + 30 + dr + 15, 0); placeGeom(sp, at, q); goldCity.push(sp);
    for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const c = new V3(sx * (T.hx + 12), 0, sz * (T.hz + 12)).applyQuaternion(q).add(at);
      slimTower(c, new V3(0, 1, 0), T.h * 1.4 + 90 + rngCity.range(0, 30), 0xf6f3ec, true, 7);
    }
  }
  // --- terraços PÁLIDOS pendurados nos flancos (refs. 3/4): retalhos de caixinhas em fileiras que
  //     saem da pele quase na horizontal ---
  for (const [sz, nx0, nx1] of [[-1, 0.06, 0.4], [-1, -0.6, -0.3], [1, 0.14, 0.48], [1, -0.54, -0.22]]) {
    const prng = createRng(SEED + 2600 + index * 5 + Math.round(nx0 * 100) + sz * 7);
    const phi0 = 1.22, phi1 = 1.72, rows = 8;
    const cols = Math.round(((nx1 - nx0) * RX) / 15), nrm = new V3(), dirv = new V3(), upMix = new V3();
    const notch = { c0: prng.int(1, Math.max(1, cols - 4)), r0: prng.int(1, rows - 3), cw: prng.int(2, 3), rh: prng.int(2, 3) };
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (c >= notch.c0 && c < notch.c0 + notch.cw && r >= notch.r0 && r < notch.r0 + notch.rh) continue;
      if (prng() < 0.04) continue;
      const nx = nx0 + ((c + 0.5) / cols) * (nx1 - nx0), k = Math.sqrt(Math.max(0.03, 1 - nx * nx));
      const phi = sz * (phi0 + ((r + 0.5) / rows) * (phi1 - phi0));
      dirv.set(nx, Math.cos(phi) * k, Math.sin(phi) * k); if (!skinBody(dirv, tmp3, nrm, true)) continue;
      const depth = prng.range(9, 18), w = 13, d = (((phi1 - phi0) / rows) * k * (B.ry + B.rz)) / 2 * 0.86;
      upMix.copy(nrm).addScaledVector(_up, 0.25).normalize();
      const b = boxHouse(w, depth + 4, d, 'y', prng.pick(PALE), prng.pick(PALE), true, false, true); b.translate(0, (depth - 4) / 2, 0);
      placeGeom(b, tmp3.addScaledVector(nrm, EM.CRUST_OFFSET), quatFromUp(upMix)); city.push(b);
    }
  }
  // torres e pequenas mesquitas espalhadas pelo tapete de casas
  for (let i = 0; i < 24; i++) {
    const x = rngCity.range(-RX * 0.85, RX * 0.85), z = rngCity.range(-B.rz * 0.75, B.rz * 0.75);
    if (inPalace(x, z) || inBrick(x, z) || nearPlaza(x, z) || inTemple(x, z)) continue;
    const n = surfAt(x, z, tmp3); if (!n || n.y < 0.82 || insideNeckOrHead(tmp3)) continue;
    if (i % 3 === 0) { // mesquita pequena: tambor + cúpula + minarete
      const dr = rngCity.range(22, 34); const drum = new THREE.CylinderGeometry(dr, dr, 48, 16); remapUV(drum, REG.PAL, 0, Infinity, 1, 0.3); setColorRange(drum, 0xf6f1e8); drum.translate(0, 18, 0); placeGeom(drum, tmp3, quatFromUp(n)); city.push(drum);
      const dome = new THREE.SphereGeometry(dr, 14, 8, 0, TAU, 0, Math.PI / 2); dome.translate(0, 42, 0); placeGeom(dome, tmp3, quatFromUp(n)); goldCity.push(dome);
      slimTower(tmp3.clone().addScaledVector(n, -4).add(new V3(dr + 12, 0, 0)), n.clone(), 100 + rngCity.range(0, 60), 0xf6f3ec, true, 6);
    } else slimTower(tmp3.clone().addScaledVector(n, -4), n.clone(), 80 + rngCity.range(0, 90), rngCity.pick([0xf6f3ec, 0xf1c9b1, 0xeadbc6]), rngCity() < 0.6, 6);
  }
  // (daqui em diante: peças presas ao osso da CABEÇA — presas e alto do crânio acenam com ela)
  const cityMain = city.splice(0), goldMain = goldCity.splice(0);
  // --- cidades das presas: a metade de cima de cada presa COBERTA de casinhas minúsculas (lado ≈
  //     diâmetro/30, telhados vermelhos; instanciadas) + torres brancas com cúpulas; 3 anéis de ouro ---
  for (const [si, curve] of tuskCurves.entries()) {
    const rAt = (t) => (t < 0.06 ? lerp(92, 72, t / 0.06) : lerp(72, TK.tipRadius, (t - 0.06) / 0.91));
    const tan = new V3(), up = new V3(), sd = new V3(), P = new V3(), nrm = new V3();
    const trng = createRng(SEED + 1200 + index * 7 + si);
    const span = EM.TUSK_HOUSE_SPAN, L = curve.getLength(), dummy = new THREE.Object3D(), qy = new THREE.Quaternion();
    const maxN = Math.floor(EM.TUSK_HOUSE_MAX / 2);
    let count = 0;
    for (let t = 0.1; t < 0.955 && count < maxN;) {
      const r = rAt(t), hs = (2 * r) / EM.TUSK_HOUSE_DIV, step = hs * EM.TUSK_HOUSE_GAP;
      const tNext = t + step / L;
      if (TUSK_RINGS.some((tr) => Math.abs(t - tr) < 0.03)) { t = tNext; continue; }
      curve.getPointAt(t, P); curve.getTangentAt(t, tan); surfaceUp(tan, up); sd.crossVectors(tan, up).normalize();
      const nAcross = Math.max(3, Math.round((r * 2 * span) / step));
      qy.setFromAxisAngle(_up, Math.atan2(tan.z, tan.x));
      for (let k = 0; k < nAcross && count < maxN; k++) {
        const phi = ((k + 0.5) / nAcross) * 2 * span - span + trng.range(-0.3, 0.3) * (2 * span / nAcross);
        if (trng() < 0.07) continue;
        nrm.copy(up).multiplyScalar(Math.cos(phi)).addScaledVector(sd, Math.sin(phi)).normalize();
        const w = hs * trng.range(0.8, 1.2), d = hs * trng.range(0.8, 1.2), h = hs * trng.range(0.8, 2.0) * (trng() < 0.05 ? 1.8 : 1);
        dummy.position.copy(P).addScaledVector(nrm, r - 0.5); dummy.quaternion.copy(quatFromUp(nrm)).multiply(qy); dummy.scale.set(w, h, d); dummy.updateMatrix();
        tuskInst.push({ m: dummy.matrix.clone(), c: trng.pick(PALE) }); count++;
      }
      t = tNext;
    }
    for (let i = 0; i < EM.TUSK_TOWERS; i++) {
      const t = 0.15 + ((i + trng.range(0.2, 0.8)) / EM.TUSK_TOWERS) * 0.78;
      if (TUSK_RINGS.some((tr) => Math.abs(t - tr) < 0.035)) continue;
      curve.getPointAt(t, P); curve.getTangentAt(t, tan); surfaceUp(tan, up);
      const side = trng.range(-0.5, 0.5); sd.crossVectors(tan, up).normalize(); nrm.copy(up).multiplyScalar(Math.cos(side)).addScaledVector(sd, Math.sin(side)).normalize();
      slimTower(tmp2.copy(P).addScaledVector(nrm, rAt(t) - 2), nrm.clone(), (0.5 + trng.range(0, 0.5)) * 2 * rAt(t), 0xf6f3ec, true, 0.055 * rAt(t) + 1.5);
    }
  }
  // --- torres no alto da cabeça (atrás da placa) ---
  for (const lon of [-0.62, -0.36, -0.12, 0.12, 0.36, 0.62]) {
    const d = headDir(1.28, lon, new V3()); headPoint(d, tmp);
    slimTower(tmp.clone().addScaledVector(d, -6), new V3(0, 1, 0), 70 + rngCity.range(0, 50), rngCity.pick([0xf6f3ec, 0xeadbc6]), rngCity() < 0.6, 5);
  }
  // casinhas no topo da cabeça entre as torres
  for (let i = 0; i < (low ? 60 : 160); i++) {
    const d = headDir(rngCity.range(1.1, 1.46), rngCity.range(-0.85, 0.85), new V3()); headPoint(d, tmp);
    const w = rngCity.range(5, 9), dd = rngCity.range(5, 9), h = rngCity.range(5, 12);
    const b = boxHouse(w, h + 10, dd, 'y', rngCity.pick(COLORS.houses), rngCity.pick(COLORS.roofs), false, false, true); b.translate(tmp.x, tmp.y + (h - 10) / 2, tmp.z); city.push(b);
  }
  if (city.length) add('city', mergeGeometries(city, false), BONE.head);
  if (cityMain.length) add('city', mergeGeometries(cityMain, false));
  for (const g of goldCity) add('gold', g, BONE.head);
  for (const g of goldMain) add('gold', g);

  // ============================ MONTAGEM ===========================
  const order = ['skin', 'trunk', 'cloth', 'ivory', 'gold', 'city', 'pink', 'eye', 'silver'];
  const merged = [], mats = [];
  for (const k of order) { if (!parts[k].length) continue; merged.push(mergeGeometries(parts[k], false)); mats.push(S.mat[k]); }
  const geom = mergeGeometries(merged, true);
  geom.computeBoundingSphere();
  // dois SkinnedMesh com o MESMO esqueleto: a pele esculpida (geometria compartilhada, material
  // triplanar) e as demais partes (grupos de material)
  const skinMesh = new THREE.SkinnedMesh(skinGeom, S.mat.skinTri); skinMesh.name = 'skin';
  const mesh = new THREE.SkinnedMesh(geom, mats); mesh.name = 'parts';
  rig.add(bones[0]); rig.add(skinMesh); rig.add(mesh);
  group.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  for (const m of [skinMesh, mesh]) {
    m.bind(skeleton);
    // esfera envolvente fixa (folgada): evita o cálculo com skinning de todos os vértices
    m.boundingSphere = m.geometry.boundingSphere.clone(); m.boundingSphere.radius *= 1.12;
    m.frustumCulled = true;
  }
  const headAttach = (o) => { o.position.copy(HEAD_POS).negate(); bones[BONE.head].add(o); return o; };

  // ---- tapete de casas do dorso (2 InstancedMesh: lajes pálidas / telhados rosa-terracota),
  //      casinhas das presas (1 InstancedMesh) e a casca-crosta ----
  const carpetGroup = new THREE.Group(); carpetGroup.name = 'carpet';
  let carpetCount = 0;
  {
    const unitHouse = (roofReg) => {
      const g = new THREE.BoxGeometry(1, 1.3, 1); g.translate(0, 0.35, 0);   // base em y=−0.3 (afundada), topo em y=1
      const idx = Array.from(g.index.array); idx.splice(18, 6); g.setIndex(idx);   // sem a face de baixo
      setColorRange(g, 0xffffff);
      remapUV(g, REG.HOUSE, 0, 8); remapUV(g, REG.HOUSE, 16, 24); remapUV(g, roofReg, 8, 12); remapUV(g, REG.PLAIN, 12, 16);
      return g;
    };
    const col = new THREE.Color();
    const makeInst = (list, reg) => {
      const inst = new THREE.InstancedMesh(unitHouse(reg), S.mat.city, list.length);
      list.forEach((it, i) => { inst.setMatrixAt(i, it.m); inst.setColorAt(i, col.set(it.c)); });
      inst.instanceMatrix.needsUpdate = true; if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.frustumCulled = true; return inst;
    };
    // tapete do dorso: grupo próprio (some além de LOD_DISTANCE; a crosta fica)
    for (const [key, reg] of [['flat', REG.PLAIN], ['tile', REG.ROOFT]]) { if (carpet[key].length) carpetGroup.add(makeInst(carpet[key], reg)); }
    rig.add(carpetGroup);
    // casinhas das presas (sempre visíveis: são poucas)
    if (tuskInst.length) headAttach(makeInst(tuskInst, REG.ROOFT));
    // casca-crosta
    // crosta: casca transparente a 3 m da pele — recebe sombra mas não projeta (evitaria linhas duplas na pele)
    if (crustGeom) { const cm = new THREE.Mesh(crustGeom, S.mat.crust); cm.frustumCulled = true; cm.castShadow = false; cm.receiveShadow = true; cm.userData.shadowsSet = true; rig.add(cm); }
    carpetCount = carpet.flat.length + carpet.tile.length;
  }
  // ---- tachas da placa (instâncias) ----
  {
    // tachas em malha hexagonal com 3 tamanhos: coluna central de bossas GRANDES, médias ao redor,
    // pequenas junto à borda (ref. 1: a placa é uma gota dourada coberta de semiesferas)
    const studGeo = new THREE.SphereGeometry(1, 8, 4, 0, TAU, 0, Math.PI / 2);
    const mats4 = []; const dummy = new THREE.Object3D();
    const ST = EM.STUD_SIZES; const rowsN = 26; const pitch = ST.mid * 2.35;
    for (let i = 1; i < rowsN; i++) {
      const s = i / rowsN; const L = platePoint(s, 1, 0, tmp).distanceTo(platePoint(s, -1, 0, tmp2));
      if (L < ST.mid * 2.2) continue;
      const n = Math.max(1, Math.round(L / pitch)); const odd = i % 2 === 1;
      // fileiras ímpares: coluna central (w=0) + pares simétricos; pares: deslocadas meio passo
      const ws = [];
      if (odd) { for (let j = -Math.floor(n / 2); j <= Math.floor(n / 2); j++) ws.push((j * pitch) / (L / 2)); }
      else { for (let j = -Math.floor(n / 2); j < Math.floor(n / 2); j++) ws.push(((j + 0.5) * pitch) / (L / 2)); }
      for (const w of ws) {
        if (Math.abs(w) > 0.9) continue;
        if (Math.abs(s - 0.2) < 0.14 && Math.abs(w) < 0.3) continue;   // sem tachas em cima da bossa central
        platePoint(s, w, 15, tmp); const dn = tmp.clone().sub(new V3(HD.cx, HD.cy, 0)).normalize();
        let r = Math.abs(w) < 1e-3 ? ST.big : Math.abs(w) < 0.62 ? ST.mid : ST.small;
        r *= 0.75 + 0.25 * Math.sin(Math.PI * Math.min(1, s * 1.05 + 0.05));  // um pouco menores nas pontas da gota
        dummy.position.copy(tmp); dummy.quaternion.copy(quatFromUp(dn)); dummy.scale.set(r, r * 0.8, r); dummy.updateMatrix(); mats4.push(dummy.matrix.clone());
      }
    }
    const inst = new THREE.InstancedMesh(studGeo, S.mat.gold, mats4.length);
    mats4.forEach((m, i) => inst.setMatrixAt(i, m)); inst.instanceMatrix.needsUpdate = true;
    headAttach(inst);
  }
  // ---- pompons (instâncias com cor) ----
  {
    // lã fibrosa: mais tufos (deslocamento maior) + normal de pelos; cores levemente dessaturadas e variadas
    const pomGeo = fuzzySphere(1, low ? 12 : 15, low ? 8 : 10, MT.POMPOM_FUZZ);
    scaleUV(pomGeo, 2, 1);
    const inst = new THREE.InstancedMesh(pomGeo, S.mat.pompom, garland.length);
    const dummy = new THREE.Object3D(); const col = new THREE.Color(), grey = new THREE.Color(0x8c8c8c);
    const prng = createRng(SEED + 5151 + index);
    garland.forEach((gp, i) => {
      const dn = gp.pos.clone().sub(new V3(HD.cx, HD.cy, 0)).normalize();
      dummy.position.copy(gp.pos).addScaledVector(dn, EM.POMPOM_RADIUS * 0.8); dummy.quaternion.copy(quatFromUp(gp.tangent)); dummy.scale.set(EM.POMPOM_RADIUS, EM.POMPOM_RADIUS * 1.08, EM.POMPOM_RADIUS); dummy.updateMatrix();
      col.set(COLORS.pompoms[i % COLORS.pompoms.length]).lerp(grey, MT.POMPOM_DESAT).multiplyScalar(prng.range(0.88, 1.08));
      inst.setMatrixAt(i, dummy.matrix); inst.setColorAt(i, col);
    });
    inst.instanceMatrix.needsUpdate = true; if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    headAttach(inst);
  }

  // ============================ JATO D'ÁGUA ========================
  // De vez em quando (período semeado por elefante) a tromba espirra um jato em arco (ref. 3): pontos
  // aditivos brancos seguindo uma parábola da ponta da tromba para a frente/cima, esmaecendo em névoa.
  const sprayN = low ? 700 : EM.SPRAY_POINTS;
  const sprayPos = new Float32Array(sprayN * 3), sprayCol = new Float32Array(sprayN * 3), sprayJit = new Float32Array(sprayN * 4);
  const spray = (() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(sprayPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(sprayCol, 3).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new V3(1900, 900, 0), 1600);
    const pts = new THREE.Points(g, S.mat.spray); pts.visible = false; pts.frustumCulled = false; pts.name = 'spray';
    rig.add(pts);
    const r = createRng(SEED + 3131 + index * 17);
    for (let i = 0; i < sprayN; i++) { sprayJit[i * 4] = r.range(0.86, 1.14); sprayJit[i * 4 + 1] = r.range(-1, 1); sprayJit[i * 4 + 2] = r.range(-1, 1); sprayJit[i * 4 + 3] = r(); }
    const period = r.range(EM.SPRAY_PERIOD.min, EM.SPRAY_PERIOD.max);
    // ponta da tromba no espaço do último osso da tromba (pose de ligação sem rotação)
    return { pts, period, offset: r() * period, tip: new V3(), tipRel: TRUNK_CURVE.getPointAt(1).sub(new V3(...BONES[BONE.trunk3].pos)) };
  })();
  const SPRAY_V = 680, SPRAY_G = 230, SPRAY_DIR = new V3(0.56, 0.83, 0).normalize();   // arco alto: ápice ≈ 690 m acima da ponta, alcance ≈ 1,5 corpo
  function updateSpray(time) {
    const ph = (time + spray.offset) % spray.period, LIFE = EM.SPRAY_LIFE, DUR = EM.SPRAY_DURATION;
    const active = ph < DUR + LIFE;
    spray.pts.visible = active; if (!active) return;
    // ponta (mundo, pelo osso da ponta da tromba) → espaço do rig (onde vivem os pontos)
    spray.tip.copy(spray.tipRel).applyMatrix4(bones[BONE.trunk3].matrixWorld); rig.worldToLocal(spray.tip);
    const tx = spray.tip.x, ty = spray.tip.y, tz = spray.tip.z;
    for (let i = 0; i < sprayN; i++) {
      const b = (i / sprayN) * LIFE;                       // instante de nascimento dentro do ciclo
      let age = ph - b; const cyc = Math.floor(age / LIFE); age -= cyc * LIFE;
      const born = ph - age;
      const k3 = i * 3, k4 = i * 4;
      if (age < 0 || born < 0 || born > DUR) { sprayPos[k3] = tx; sprayPos[k3 + 1] = ty; sprayPos[k3 + 2] = tz; sprayCol[k3] = sprayCol[k3 + 1] = sprayCol[k3 + 2] = 0; continue; }
      const sf = sprayJit[k4], jz = sprayJit[k4 + 1], jy = sprayJit[k4 + 2];
      const spread = 5 * age + 95 * smooth(1.6, LIFE, age) * smooth(1.6, LIFE, age);   // abre em névoa no fim do arco
      sprayPos[k3] = tx + SPRAY_DIR.x * SPRAY_V * sf * age + 0.15 * spread * jy;
      sprayPos[k3 + 1] = ty + SPRAY_DIR.y * SPRAY_V * sf * age - 0.5 * SPRAY_G * age * age + spread * jy * 0.6;
      sprayPos[k3 + 2] = tz + spread * jz + 8 * jz * age;
      const bright = (0.35 + 0.65 * smooth(0, 0.2, age)) * (1 - smooth(LIFE * 0.55, LIFE, age)) * (0.75 + 0.25 * sprayJit[k4 + 3]);
      sprayCol[k3] = bright; sprayCol[k3 + 1] = bright; sprayCol[k3 + 2] = bright;
    }
    spray.pts.geometry.attributes.position.needsUpdate = true;
    spray.pts.geometry.attributes.color.needsUpdate = true;
  }

  // ============================ ENTIDADE ===========================
  const state = { u: route.u0, position: new THREE.Vector3(), heading: 0 };
  const colLocal = [
    [-240, 1060, 0, 430], [0, 1075, 0, 445], [240, 1070, 0, 430], [-480, 1060, 0, 350],
    [HD.cx, HD.cy + 40, 0, HR * 1.02], [590, 1110, 0, 350],
    [1100, 760, 0, 190], [1140, 420, 0, 115], [1240, 150, 0, 95],
    [1260, 720, -300, 85], [1620, 700, -400, 65], [1260, 720, 300, 85], [1620, 700, 300 + 100, 65],
    [290, 880, -500, 500], [290, 880, 500, 500],   // orelhas gigantes
  ];
  for (const [sx, sz] of LEGS) { legAxis(sx, sz, 250, tmp); colLocal.push([tmp.x, 250, tmp.z, 190]); legAxis(sx, sz, 620, tmp); colLocal.push([tmp.x, 620, tmp.z, 205]); }
  // Escala global: o modelo é construído nas dimensões-base e o grupo é ampliado por ELEPHANT.SCALE.
  const SCALE = E.SCALE || 1;
  group.scale.setScalar(SCALE);
  const colliders = colLocal.map((c) => ({ center: new THREE.Vector3(), local: new THREE.Vector3(c[0], c[1], c[2]), radius: c[3] * SCALE }));
  const bn = (n) => bones[BONE[n]];
  const B2 = {
    hip: [bn('hipFL'), bn('hipFR'), bn('hipBL'), bn('hipBR')], knee: [bn('kneeFL'), bn('kneeFR'), bn('kneeBL'), bn('kneeBR')],
    head: bn('head'), trunk: [bn('trunk0'), bn('trunk1'), bn('trunk2'), bn('trunk3')], tail: bn('tail'), earL: bn('earL'), earR: bn('earR'),
  };
  const phaseOff = index * 1.7;
  const viewer = { pos: null, has: false };
  const _sv = new V3();
  const LEG_PHASE = [0, Math.PI, Math.PI, 0];   // pares diagonais: FL+BR, FR+BL

  const ent = {
    group, index, name: route.cityName, route,
    position: state.position,
    get heading() { return state.heading; },
    get u() { return state.u; },
    colliders,
    cityTop: (E.SHOULDER_HEIGHT + 60) * SCALE,
    cityTopLocal: E.SHOULDER_HEIGHT + 60,
    cityFootprint: { rx: (B.rx * BODY_SX + 150) * SCALE, rz: (B.rz + 150) * SCALE },
    deliveryMarker: new THREE.Vector3(),
    bones: B2,
    body: rig,                 // nó que balança com o passo (cestas pousadas são presas aqui)
    lodDistance: EM.LOD_DISTANCE,   // m (mundo): além disto o tapete instanciado de casas some (fica a crosta)
    spray: { period: spray.period, offset: spray.offset, duration: EM.SPRAY_DURATION },   // jato d'água: ativo quando (time+offset) % period < duration (+ vida das gotas)
    carpetCount,
    // Posição (mundo) do observador, para o LOD do tapete; o integrador chama a cada quadro.
    // Sem chamada, usa window.__ruppen.camera; sem nada, o tapete fica sempre visível.
    setViewerPosition(v) { if (v) { if (!viewer.pos) viewer.pos = new V3(); viewer.pos.copy(v); viewer.has = true; } else viewer.has = false; },
    update(dt, time) {
      state.u = (state.u + (route.speed * dt) / route.length) % 1;
      const pose = route.poseAt(state.u);
      state.position.copy(pose.position);
      state.heading = pose.heading;
      group.position.copy(pose.position);
      group.rotation.y = pose.heading;
      // passo lentíssimo: pares diagonais; a pata balança do quadril e o joelho dobra na fase de
      // balanço (quando a pata vai à frente, levantada)
      const phase = (time * E.SPEED) / E.STRIDE * TAU + phaseOff;
      for (let li = 0; li < 4; li++) {
        const ph = phase + LEG_PHASE[li];
        B2.hip[li].rotation.z = SC.HIP_SWING * Math.sin(ph);
        B2.knee[li].rotation.z = -SC.KNEE_FLEX * Math.max(0, Math.cos(ph)) ** 2;
      }
      rig.position.y = 8 * Math.sin(2 * phase + 0.4);
      rig.rotation.x = 0.006 * Math.sin(phase);  // leve balanço lateral
      B2.head.rotation.z = SC.NOD * Math.sin(2 * phase + 1.1);   // aceno leve da cabeça a cada passo
      // orelhas abanando, tromba oscilando (onda ao longo dos 4 ossos), cauda
      const t = time + phaseOff * 3;
      B2.earR.rotation.y = 0.08 * Math.sin((TAU * t) / 9);
      B2.earL.rotation.y = -0.08 * Math.sin((TAU * t) / 9 + 0.6);
      for (let i = 0; i < 4; i++) {
        B2.trunk[i].rotation.x = (0.012 + 0.006 * i) * Math.sin((TAU * t) / 7 - 0.55 * i);
        B2.trunk[i].rotation.z = (0.006 + 0.004 * i) * Math.sin((TAU * t) / 11 + 1 - 0.4 * i);
      }
      B2.tail.rotation.y = 0.16 * Math.sin((TAU * t) / 5.5);
      B2.tail.rotation.x = 0.05 * Math.sin((TAU * t) / 3.7);
      group.updateMatrixWorld(true);
      // LOD do tapete de casas
      let vp = viewer.has ? viewer.pos : (typeof window !== 'undefined' ? window.__ruppen?.camera?.position : null);
      if (vp) { _sv.copy(vp); carpetGroup.visible = _sv.distanceTo(state.position) < ent.lodDistance; }
      else carpetGroup.visible = true;
      updateSpray(time);
      S.upgrade();   // texturas reais assim que carregarem
      for (const c of colliders) c.center.copy(c.local).applyMatrix4(rig.matrixWorld);
      ent.deliveryMarker.set((PZ.x0 + PZ.x1) / 2, ent.cityTopLocal + 260, 0).applyMatrix4(group.matrixWorld);
    },
    // Altura (mundo) da superfície do elefante/cidade na vertical de (x,z); null fora.
    getSurfaceHeight(x, z) {
      const c = Math.cos(state.heading), sn = Math.sin(state.heading);
      const wx = (x - state.position.x) / SCALE, wz = (z - state.position.z) / SCALE;
      const px = c * wx - sn * wz, pz = sn * wx + c * wz;
      let best = -Infinity;
      // pele esculpida: marcha do campo de distância de cima para baixo (+ dobras) — vale para corpo,
      // pescoço, cabeça, tromba e patas; por cima, crosta + casas + palácio/templos/praça
      const ys = skinTopY(px, pz);
      if (ys === null) return null;
      _sh.set(px, ys, pz); gradient(px, ys, pz, _sn2);
      let h = ys + foldAt(_sh, _sn2) * _sn2.y;
      const q = (px / RX) ** 2 + (pz / B.rz) ** 2;
      if (q < 1 && px < 560) {
        if (inPlaza(px, pz)) h = Math.max(h, PLAZA_TOP);
        else if (inPalace(px, pz)) { h = Math.max(h, Math.abs(px - PALACE_X) < PS.hx * 0.55 && Math.abs(pz) < PS.hz * 0.65 ? PALACE_BASE_TOP + PALACE_TIER_H : Math.abs(px - PALACE_X) < PS.hx && Math.abs(pz) < PS.hz ? PALACE_BASE_TOP : h); const rr = Math.hypot(px - PALACE_X, pz); if (rr < DOME_R + 8) h = Math.max(h, DOME_CY + Math.sqrt(Math.max(0, DOME_R * DOME_R - rr * rr))); }
        else if (inBrick(px, pz)) h = Math.max(h, BRICK_TOP);
        else if (inTemple(px, pz)) { const T = TEMPLES.find((tt) => Math.abs(px - tt.x) < tt.hx + 30 && Math.abs(pz - tt.z) < tt.hz + 30); h += T.h; }
        else if (_sn2.y > 0.3) h += EM.CRUST_OFFSET + (nearPlaza(px, pz) ? 28 : HOUSE_AVG);
      } else if (((px - NC.x) / NC.rx) ** 2 + (pz / NC.rz) ** 2 < 1 && _sn2.y > 0.3 && px < HD.cx - 60) h += EM.CRUST_OFFSET + HOUSE_AVG;   // casas do pescoço
      best = h;
      return best === -Infinity ? null : (best + rig.position.y) * SCALE;
    },
    isOverCity(x, z) {
      const c = Math.cos(state.heading), sn = Math.sin(state.heading);
      const wx = x - state.position.x, wz = z - state.position.z;
      const px = c * wx - sn * wz, pz = sn * wx + c * wz;
      return (px / ent.cityFootprint.rx) ** 2 + (pz / ent.cityFootprint.rz) ** 2 < 1;
    },
  };
  const _sh = new V3(), _sn2 = new V3();
  group.updateMatrixWorld(true);
  ent.update(0, 0);
  return ent;
}
