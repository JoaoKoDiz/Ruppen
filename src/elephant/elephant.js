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
//  Estrutura: UM SkinnedMesh com 9 ossos (raiz, 4 patas, 2 orelhas, tromba,
//  cauda) e grupos de material (pele, tecido da tromba, panos, marfim, ouro,
//  cidade, borla, olhos, prata) + 4 InstancedMesh (tapete de casas ×2, tachas,
//  pompons). Tudo o que é rígido vai preso ao osso raiz; o que anima vai preso
//  ao osso da parte. Resultado: 14 draw calls e ≈ 208 k triângulos por elefante
//  (quality=high; ≈ 120 k em low).
//
//  Espaço local: +X = frente, +Y = cima, +Z = lado direito; origem no
//  nível do mar entre as patas (ver config.js / ARCHITECTURE.md).
// =====================================================================
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { ELEPHANT, ELEPHANT_MODEL, ELEPHANT_POLISH, COLORS, SEED } from '../config.js';
import { createRng, hashInt } from '../util/rng.js';
import { createNoise } from '../util/noise.js';

const E = ELEPHANT, B = E.BODY, LG = E.LEG, HD = E.HEAD, EAR = E.EAR, TR = E.TRUNK, TK = E.TUSK;
const TAU = Math.PI * 2;
const V3 = THREE.Vector3;
const noise = createNoise(SEED + 331);

// Alturas da cidade (locais a este modelo)
const EM = { ...ELEPHANT_MODEL, ...ELEPHANT_POLISH };
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

// --- dobras ESCULPIDAS da pele (geometria): |ruído| com deformação de domínio → cristas arredondadas
//     separadas por vincos (lençóis de barro amassado). Devolve −0.5 (vinco) … +0.5 (crista). O domínio
//     é anisotrópico (quem chama alonga um eixo: lençóis longos, diagonais nos flancos, anéis nas patas). ---
const fnz = createNoise(SEED + 919);
function foldValue(x, y, z) {
  const wx = fnz.noise3(x * 0.55 + 3.1, y * 0.55, z * 0.55), wy = fnz.noise3(x * 0.55, y * 0.55 + 7.3, z * 0.55), wz = fnz.noise3(x * 0.55 + 1.7, y * 0.55, z * 0.55 + 5.7);
  const X = x + 0.9 * wx, Y = y + 0.9 * wy, Z = z + 0.9 * wz;
  const n1 = fnz.noise3(X, Y, Z), n2 = fnz.noise3(X * 2.2 + 11, Y * 2.2, Z * 2.2);
  return Math.min(1, Math.abs(n1) * 1.5 + Math.abs(n2) * 0.4) - 0.5;
}
const FOLD_CA = Math.cos(0.6), FOLD_SA = Math.sin(0.6);   // dobras a ~35° nos flancos (ref. 1)
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
function makeSkinTextures() {
  const W = 1024, H = 1024;
  const c = makeCanvas(W, H), ctx = c.getContext('2d');
  // base: cinza-castanho QUENTE (refs.: ~#6b625f ao sol), sem tinta azul; as sombras ficam um pouco
  // mais frias só pelas manchas
  ctx.fillStyle = '#6e645f'; ctx.fillRect(0, 0, W, H);
  const blot = noiseCanvas(128, 17, 3, 4, 170, 255);
  ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.4; ctx.drawImage(blot, 0, 0, W, H);
  ctx.globalAlpha = 0.25; ctx.drawImage(getCrease().col, 0, 0, W, H);   // vincos orgânicos suaves (cor)
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  // leve tinta fria nas manchas escuras
  ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.12; ctx.fillStyle = '#5a6a86'; ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  // poros/granulado fino
  ctx.globalAlpha = 0.1; const grain = noiseCanvas(256, 23, 24, 2, 120, 255);
  ctx.globalCompositeOperation = 'multiply'; for (let y = 0; y < H; y += 256) for (let x = 0; x < W; x += 256) ctx.drawImage(grain, x, y, 256, 256);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  // bump: cinza médio = neutro; vincos = vales, cristas = planaltos; poros finos por cima
  const b = makeCanvas(W, H), bctx = b.getContext('2d');
  bctx.drawImage(getCrease().bump, 0, 0, W, H);
  bctx.globalAlpha = 0.22; bctx.drawImage(blot, 0, 0, W, H);
  bctx.globalAlpha = 0.12; for (let y = 0; y < H; y += 256) for (let x = 0; x < W; x += 256) bctx.drawImage(grain, x, y, 256, 256);
  bctx.globalAlpha = 1;
  return { map: canvasTexture(c), bump: canvasTexture(b, false) };
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
  // trama do tecido
  const weave = noiseCanvas(256, 31, 40, 2, 150, 255);
  ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.35; ctx.drawImage(weave, 0, ySplit, W, H - ySplit);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  bctx.globalAlpha = 0.3; bctx.drawImage(weave, 0, ySplit, W, H - ySplit); bctx.globalAlpha = 1;
  return { map: canvasTexture(c), bump: canvasTexture(b, false) };
}

// Atlas de panos: v∈[0.5,1] manto das orelhas; v∈[0.25,0.5] faixas de tornozelo; v∈[0,0.25] trama da barriga.
function makeClothTextures() {
  const S = 1024, c = makeCanvas(S, S), ctx = c.getContext('2d');
  const b = makeCanvas(S, S), bctx = b.getContext('2d');
  bctx.fillStyle = '#8c8c8c'; bctx.fillRect(0, 0, S, S);
  const rng = createRng(SEED + 44);
  // --- manto (y 0..512): miolo (y 0..256, v 0.75..1) tecido ESCURO quente com linhas onduladas
  //     laranja discretas; borda (y 256..512, v 0.5..0.75) = faixa LISTRADA laranja/creme/rosa
  //     (v cresce da borda externa para dentro: as listras ficam concêntricas ao contorno da orelha) ---
  ctx.fillStyle = '#4a403f'; ctx.fillRect(0, 0, S, 256);
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
  // trama fina em tudo
  const weave = noiseCanvas(256, 31, 40, 2, 150, 255);
  ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.3; ctx.drawImage(weave, 0, 0, S, S);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  bctx.globalAlpha = 0.35; bctx.drawImage(weave, 0, 0, S, S); bctx.globalAlpha = 1;
  return { map: canvasTexture(c), bump: canvasTexture(b, false) };
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
function drawArchWindows(ctx, x0, y0, w, h, cols, rows, { wall, win, frame, ledge, winW = 0.42, winH = 0.6, door = false }) {
  ctx.fillStyle = wall; ctx.fillRect(x0, y0, w, h);
  const cw = w / cols, ch = h / rows;
  for (let r = 0; r < rows; r++) {
    if (ledge) { ctx.fillStyle = ledge; ctx.fillRect(x0, y0 + r * ch, w, Math.max(2, ch * 0.06)); }
    for (let cI = 0; cI < cols; cI++) {
      const cx = x0 + (cI + 0.5) * cw, top = y0 + r * ch + ch * (1 - winH) * 0.55;
      const ww = cw * winW, hh = ch * winH;
      const isDoor = door && r === rows - 1 && cI === Math.floor(cols / 2);
      const wwF = isDoor ? ww * 1.3 : ww, hhF = isDoor ? ch * 0.8 : hh, topF = isDoor ? y0 + (r + 1) * ch - hhF : top;
      // moldura clara fina (arco), vidro cinza-quente escuro, leve reflexo no alto e peitoril
      if (frame) { ctx.fillStyle = frame; ctx.beginPath(); ctx.moveTo(cx - wwF / 2 - 2.5, topF + hhF + 2.5); ctx.lineTo(cx - wwF / 2 - 2.5, topF + wwF / 2); ctx.arc(cx, topF + wwF / 2, wwF / 2 + 2.5, Math.PI, 0); ctx.lineTo(cx + wwF / 2 + 2.5, topF + hhF + 2.5); ctx.closePath(); ctx.fill(); }
      ctx.fillStyle = win; ctx.beginPath(); ctx.moveTo(cx - wwF / 2, topF + hhF); ctx.lineTo(cx - wwF / 2, topF + wwF / 2); ctx.arc(cx, topF + wwF / 2, wwF / 2, Math.PI, 0); ctx.lineTo(cx + wwF / 2, topF + hhF); ctx.closePath(); ctx.fill();
      if (!isDoor) {
        ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.beginPath(); ctx.arc(cx, topF + wwF / 2, wwF / 2 - 1.5, Math.PI * 1.05, Math.PI * 1.75); ctx.lineTo(cx, topF + wwF / 2); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(cx - wwF / 2 - 3, topF + hhF + 1, wwF + 6, Math.max(1.5, wwF * 0.08));
      }
    }
  }
}
function makeCityAtlas() {
  const S = 1024, c = makeCanvas(S, S), ctx = c.getContext('2d');
  ctx.fillStyle = '#f4f1ea'; ctx.fillRect(0, 0, S, S);
  // PAL: fileiras de janelas em arco (palácio branco)
  drawArchWindows(ctx, 0, 0, 512, 512, 22, 12, { wall: '#f3efe7', win: '#3a3230', frame: '#dcd6cb', ledge: '#d3cdc2', winW: 0.46, winH: 0.68 });
  ctx.fillStyle = 'rgba(0,0,0,0.07)'; for (let i = 1; i < 22; i++) ctx.fillRect(i * 512 / 22 - 1, 0, 2, 512);
  // BRK: tijolo vermelho com arcos creme
  ctx.fillStyle = '#a84b3b'; ctx.fillRect(512, 0, 512, 512);
  ctx.fillStyle = 'rgba(70,25,20,0.45)';
  for (let yy = 0; yy < 512; yy += 8) { ctx.fillRect(512, yy, 512, 1); const off = (yy / 8) % 2 ? 10 : 0; for (let xx = off; xx < 512; xx += 20) ctx.fillRect(512 + xx, yy, 1, 8); }
  drawArchWindows(ctx, 512, 0, 512, 512, 16, 8, { wall: 'rgba(0,0,0,0)', win: '#3f322d', frame: '#eadbc6', winW: 0.42, winH: 0.62 });
  // PLAIN: creme com leve ruído
  ctx.fillStyle = '#f5f2ec'; ctx.fillRect(0, 512, 256, 256);
  const grain = noiseCanvas(128, 51, 6, 3, 200, 255);
  ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.5; ctx.drawImage(grain, 0, 512, 256, 256); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  // TOWER: janelas estreitas
  drawArchWindows(ctx, 256, 512, 256, 256, 3, 6, { wall: '#f3efe7', win: '#3a3230', frame: '#d8d2c6', winW: 0.3, winH: 0.62 });
  // PAVE: calçamento
  ctx.fillStyle = '#d9d0bd'; ctx.fillRect(512, 512, 256, 256);
  const prng = createRng(SEED + 77);
  for (let yy = 512; yy < 768; yy += 32) for (let xx = 512; xx < 768; xx += 32) { ctx.fillStyle = `rgba(120,100,80,${0.08 + prng() * 0.18})`; ctx.fillRect(xx + 1, yy + 1, 30, 30); }
  // TALL: prédio de vários andares (3x5 janelas em arco), sem porta
  drawArchWindows(ctx, 768, 512, 256, 256, 3, 5, { wall: '#ffffff', win: '#3a3230', frame: '#e6e0d5', winW: 0.3, winH: 0.5 });
  ctx.fillStyle = 'rgba(0,0,0,0.07)'; for (let r = 1; r < 5; r++) ctx.fillRect(768, 512 + r * 51.2 - 1, 256, 2);
  // HOUSE: parede branca com 3x2 janelas + porta
  drawArchWindows(ctx, 0, 768, 512, 256, 3, 2, { wall: '#ffffff', win: '#3a3230', frame: '#e6e0d5', winW: 0.26, winH: 0.44, door: true });
  // ROOF: telhas claras (a cor do vértice tinge); ROOFT: telhas rosa/terracota já coloridas
  ctx.fillStyle = '#ffffff'; ctx.fillRect(512, 768, 256, 256);
  ctx.strokeStyle = '#b8aea2'; ctx.lineWidth = 2;
  for (let row = 0; row < 8; row++) { const yy = 768 + row * 32 + 16; const off = row % 2 ? 16 : 0; for (let xx = 512 + off; xx < 768 + 32; xx += 32) { ctx.beginPath(); ctx.arc(xx, yy, 15, Math.PI, 0); ctx.stroke(); } }
  ctx.fillStyle = '#c9775f'; ctx.fillRect(768, 768, 256, 256);
  ctx.strokeStyle = 'rgba(90,40,30,0.5)'; ctx.lineWidth = 2;
  for (let row = 0; row < 8; row++) { const yy = 768 + row * 32 + 16; const off = row % 2 ? 16 : 0; for (let xx = 768 + off; xx < 1024 + 32; xx += 32) { ctx.beginPath(); ctx.arc(xx, yy, 15, Math.PI, 0); ctx.stroke(); } }
  ctx.save(); ctx.beginPath(); ctx.rect(768, 768, 256, 256); ctx.clip();
  const rt = noiseCanvas(128, 93, 5, 3, 170, 255); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.5; ctx.drawImage(rt, 768, 768, 256, 256);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.restore();
  return canvasTexture(c);
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
  // franja listrada vertical (metade de baixo, v∈[0,0.5])
  const cols = [0xd2628e, 0xc9527f, 0xd98a52, 0xd2628e, 0xb84a72, 0xe0a0b8, 0xd2628e, 0xcf7a4e];
  for (let x = 0; x < W; x += 6) { ctx.fillStyle = hex(cols[(x / 6) % cols.length]); ctx.fillRect(x, 256, 6, 256); }
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; for (let x = 0; x < W; x += 6) ctx.fillRect(x, 256, 1, 256);
  const grad = ctx.createLinearGradient(0, 256, 0, 512); grad.addColorStop(0, 'rgba(0,0,0,0.25)'); grad.addColorStop(0.3, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.15)');
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
  ctx.fillStyle = '#d8d8d8'; ctx.fillRect(0, 0, S, S);
  const blot = noiseCanvas(128, 61, 9, 3, 150, 255);
  ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.9; ctx.drawImage(blot, 0, 0, S, S);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  const rng = createRng(SEED + 606);
  const b = makeCanvas(S, S), bctx = b.getContext('2d');
  bctx.fillStyle = '#808080'; bctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const x = rng() * S, y = rng() * S, a = rng() * TAU, L = 4 + rng() * 9, w = 0.8 + rng() * 1.4;
    const light = rng() < 0.5;
    ctx.strokeStyle = light ? `rgba(255,255,255,${0.25 + rng() * 0.35})` : `rgba(40,40,40,${0.15 + rng() * 0.3})`;
    ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); ctx.stroke();
    bctx.strokeStyle = light ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)'; bctx.lineWidth = w; bctx.lineCap = 'round';
    bctx.beginPath(); bctx.moveTo(x, y); bctx.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); bctx.stroke();
  }
  return { map: canvasTexture(c), bump: canvasTexture(b, false) };
}

// "Crosta" de casinhas: ladrilho de quadradinhos pastel (malha 20×20 com jitter dentro da célula:
// fecha perfeitamente) com frestas escuras, um lado de sombra e um fio de luz; de longe o dorso lê
// como crosta rosa/branca fina (ref. 4). bump: quadrados claros sobre fundo escuro.
function makeCrustTextures() {
  const S = 1024, N = 20, cell = S / N;
  const c = makeCanvas(S, S), ctx = c.getContext('2d');
  const b = makeCanvas(S, S), bctx = b.getContext('2d');
  ctx.fillStyle = '#7d6c66'; ctx.fillRect(0, 0, S, S);
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
    ctx.fillStyle = 'rgba(70,45,40,0.35)'; ctx.fillRect(x, y + h - h * 0.28, w, h * 0.28); ctx.fillRect(x + w - w * 0.14, y, w * 0.14, h);
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x, y, w, Math.max(1, h * 0.08));
    if (rng() < 0.3) { ctx.fillStyle = 'rgba(205,120,100,0.55)'; ctx.fillRect(x + w * 0.1, y + h * 0.1, w * 0.8, h * 0.45); }   // telhado rosa
    const lum = 150 + rng() * 90;
    bctx.fillStyle = `rgb(${lum},${lum},${lum})`; bctx.fillRect(x, y, w, h);
  }
  const grain = noiseCanvas(256, 93, 6, 3, 200, 255);
  ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.35; for (let y = 0; y < S; y += 256) for (let x = 0; x < S; x += 256) ctx.drawImage(grain, x, y, 256, 256);
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
  const skin = makeSkinTextures(), trunk = makeTrunkTextures(), cloth = makeClothTextures();
  const city = makeCityAtlas(), tassel = makeTasselTexture(), eye = makeEyeTexture(), pom = makePompomTextures();
  const crust = makeCrustTextures(), spray = makeSprayTexture();
  const mat = {
    skin: new THREE.MeshStandardMaterial({ map: skin.map, bumpMap: skin.bump, bumpScale: EM.SKIN_BUMP, roughness: 0.82, metalness: 0 }),
    trunk: new THREE.MeshStandardMaterial({ map: trunk.map, bumpMap: trunk.bump, bumpScale: EM.SKIN_BUMP * 0.7, roughness: 0.88, metalness: 0 }),
    cloth: new THREE.MeshStandardMaterial({ map: cloth.map, bumpMap: cloth.bump, bumpScale: 2, roughness: 0.92, metalness: 0 }),
    ivory: new THREE.MeshStandardMaterial({ color: COLORS.ivory, roughness: 0.45, metalness: 0.05 }),
    // sem envMap no jogo: metalness moderado + emissivo quente para o ouro não ficar escuro
    gold: new THREE.MeshStandardMaterial({ color: COLORS.gold, metalness: 0.65, roughness: 0.36, emissive: COLORS.goldDark, emissiveIntensity: 0.22 }),
    city: new THREE.MeshStandardMaterial({ map: city, vertexColors: true, roughness: 0.8, metalness: 0 }),
    pink: new THREE.MeshStandardMaterial({ map: tassel, roughness: 0.9, metalness: 0 }),
    // olho: brilho branco acende via emissiveMap (as partes escuras do mapa quase não emitem)
    eye: new THREE.MeshStandardMaterial({ map: eye, emissiveMap: eye, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.22, metalness: 0.05 }),
    silver: new THREE.MeshStandardMaterial({ color: 0xd9dee5, metalness: 0.6, roughness: 0.3, emissive: 0x2a3038, emissiveIntensity: 0.4 }),
    // lã: sem brilho algum + textura felpuda (a cor vem da instância)
    pompom: new THREE.MeshStandardMaterial({ map: pom.map, bumpMap: pom.bump, bumpScale: 1.2, roughness: 1.0, metalness: 0 }),
    // crosta de casinhas do dorso (casca fina; alfa por vértice esmaece as bordas)
    crust: new THREE.MeshStandardMaterial({ map: crust.map, bumpMap: crust.bump, bumpScale: 2.5, roughness: 0.85, metalness: 0, vertexColors: true, transparent: true, depthWrite: true }),
    // jato d'água: pontos aditivos brancos (a cor por vértice esmaece para névoa)
    spray: new THREE.PointsMaterial({ map: spray, size: EM.SPRAY_POINT_SIZE * (E.SCALE || 1), sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true, opacity: 0.6, fog: true }),
  };
  shared = { mat };
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
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { si[i * 4] = bone; sw[i * 4] = 1; }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
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
  mapVertices(m, (v) => { const k = 9 / r; const n = hashInt(Math.round(v.x * k * 1.31), Math.round(v.y * k * 1.07), Math.round(v.z * k * 1.19)); v.multiplyScalar(1 + amount * (n - 0.5)); });
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
    if (f === roof) { remapUV(g, facadeOut ? (tall ? REG.TALL : REG.HOUSE) : REG.ROOF, f[0], f[1]); setColorRange(g, roofColor, f[0], f[1]); }
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
//  superfícies analíticas (usadas pela geometria E pela colocação da cidade)
// ------------------------------------------------------------------
// Elevação extra no dorso (cernelha / garupa) em função da direção unitária.
function backBump(nx, ny) {
  const sh = smooth(0.05, 0.55, nx) * (1 - smooth(0.55, 0.95, nx));
  let y = 38 * sh * ny * ny;
  if (nx < -0.35) { const q = (-nx - 0.35) / 0.65; y -= 52 * q * q * Math.max(0, ny); }   // garupa mais baixa que a cernelha
  return y;
}
// Ponto da pele do corpo para uma direção unitária d (elipsoide + barriga caída + ruído).
// BODY_SX alonga o corpo em X (o elipsoide nominal fica atarracado na silhueta).
const BODY_SX = 1.1;
function bodyPoint(d, out, folds = true) {
  const nx = d.x, ny = d.y, nz = d.z;
  let x = nx * B.rx * BODY_SX, y = ny * B.ry, z = nz * B.rz;
  if (ny < 0) {
    const belly = Math.pow(-ny, 1.6) * (1 - Math.min(1, Math.abs(nx) * 1.15) ** 2);
    y -= 55 * belly; z *= 1 + 0.07 * belly;
  }
  y += backBump(nx, ny);
  const amp = 14 * (1 - smooth(0.25, 0.65, ny));
  const n = noise.fbm3(nx * 2.3 + 5, ny * 2.3, nz * 2.3, 3);
  out.set(x, B.cy + y, z).addScaledVector(d, amp * n);
  if (!folds) return out;
  // dobras esculpidas: lençóis longos e diagonais nos flancos, mais rasas no alto do dorso (sob a cidade)
  const fa = EM.FOLD_BODY * (1 - 0.55 * smooth(0.35, 0.8, ny));
  const lx = out.x, ly = out.y - B.cy, lz = out.z;
  const f = foldValue((lx * FOLD_CA + ly * FOLD_SA) / 210, (-lx * FOLD_SA + ly * FOLD_CA) / 68, lz / 130);
  return out.addScaledVector(d, fa * f);
}
// Ponto da pele da cabeça para uma direção unitária d (centro em HD).
function headPoint(d, out, folds = true) {
  const R = HR;
  let x = d.x * R * 0.96, y = d.y * R * 1.2, z = d.z * R * 0.92;
  const f = Math.max(0, d.x) * Math.max(0, d.y); y += 56 * f; x += 16 * f;           // testa abaulada (domo alto)
  if (d.y > 0.2) y += 22 * (d.y - 0.2) * (1 - Math.min(1, Math.abs(d.z) * 1.4));   // crista do crânio
  if (d.y > 0.35) y -= 16 * Math.pow(Math.max(0, 1 - Math.abs(d.z) * 2.2), 2) * (d.y - 0.35);   // leve sulco entre os dois domos do topo
  if (d.y < -0.1) { const q = Math.min(1, (-d.y - 0.1) / 0.6); z *= 1 - 0.14 * q * Math.max(0, d.x + 0.3); }   // face afunila para a raiz da tromba
  if (d.y < -0.2 && d.x > 0.1) { const q = Math.min(1, (-d.y - 0.2) / 0.5) * d.x; x += 22 * q; }  // mandíbula
  if (d.x < 0) x *= 0.92;                                                              // nuca mais achatada (encaixe no pescoço)
  const cheek = Math.max(0, Math.abs(d.z) - 0.55) * (1 - Math.min(1, Math.abs(d.y + 0.1) * 2)); z += 18 * cheek * Math.sign(d.z);
  const n = noise.fbm3(d.x * 2.5 + 11, d.y * 2.5, d.z * 2.5, 3) * 8;
  out.set(HD.cx + x, HD.cy + y, z).addScaledVector(d, n);
  if (!folds) return out;
  // dobras esculpidas (mais finas que no corpo), fluindo em diagonal para a raiz da tromba e
  // contornando os olhos; rasas no alto do crânio (casinhas) e sob a placa
  const eyeDot = Math.max(d.x * EYE_DIR.x + d.y * EYE_DIR.y + Math.abs(d.z) * EYE_DIR.z, 0);
  const mask = (1 - 0.85 * smooth(0.9, 0.985, eyeDot)) * (1 - 0.5 * smooth(0.7, 0.95, d.y));
  const lx = out.x - HD.cx, ly = out.y - HD.cy, lz = out.z;
  const fh = foldValue((lx * FOLD_CA + ly * FOLD_SA) / 150 + 4, (-lx * FOLD_SA + ly * FOLD_CA) / 46, lz / 90);
  return out.addScaledVector(d, EM.FOLD_HEAD * mask * fh);
}
const EYE_DIR = new V3(0.56, 0.1, 0.82).normalize();
// Direção na cabeça a partir de latitude/longitude (lon 0 = frente +X, positivo = +Z)
function headDir(lat, lon, out) { return out.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)); }

// Tromba: curva e raio (estáticos: usados pela geometria, pela placa e pelo pushOutOfTrunk)
const TRUNK_CURVE = new THREE.CatmullRomCurve3([
  new V3(900, 1010, 0), new V3(1035, 925, 0), new V3(1105, 790, 0), new V3(1140, 640, 0), new V3(1145, 480, 0),
  new V3(1135, 320, 0), new V3(1145, 180, 0), new V3(1205, 90, 0), new V3(1310, 90, 0), new V3(1390, 160, 0), new V3(1400, 250, 0)]);
TRUNK_CURVE.arcLengthDivisions = 400;
function trunkR(t) {
  if (t < 0.26) { const q = smooth(0, 0.26, t); return lerp(EM.TRUNK_ROOT_RADIUS, TR.baseRadius, q); }   // raiz grossa que afunila
  if (t < 0.965) return lerp(TR.baseRadius, TR.tipRadius, (t - 0.26) / 0.705);
  return TR.tipRadius * Math.sqrt(Math.max(0, 1 - ((t - 0.965) / 0.035) ** 2)) + 0.5;
}
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
export function createElephant(route, index, opts = {}) {
  const low = opts.quality === 'low';
  const S = getShared();
  const rng = createRng(SEED + 7919 * (index + 1));
  const group = new THREE.Group();
  group.name = 'elephant_' + index;
  const rig = new THREE.Group(); // recebe o balanço vertical do passo
  group.add(rig);

  // ossos
  const BONE = { root: 0, legFL: 1, legFR: 2, legBL: 3, legBR: 4, earL: 5, earR: 6, trunk: 7, tail: 8 };
  const EAR_PIVOT = { x: 740, y: 1415, z: 225 };
  const TRUNK_ROOT = { x: 1010, y: 950, z: 0 };
  const TAIL_ROOT = { x: -545, y: 1175, z: 0 };
  const bonePos = [
    [0, 0, 0],
    [LG.offsetX, LG.topY, -LG.offsetZ], [LG.offsetX, LG.topY, LG.offsetZ], [-LG.offsetX, LG.topY, -LG.offsetZ], [-LG.offsetX, LG.topY, LG.offsetZ],
    [EAR_PIVOT.x, EAR_PIVOT.y, -EAR_PIVOT.z], [EAR_PIVOT.x, EAR_PIVOT.y, EAR_PIVOT.z],
    [TRUNK_ROOT.x, TRUNK_ROOT.y, TRUNK_ROOT.z], [TAIL_ROOT.x, TAIL_ROOT.y, TAIL_ROOT.z],
  ];
  const bones = bonePos.map((p, i) => { const b = new THREE.Bone(); b.position.set(p[0], p[1], p[2]); b.name = Object.keys(BONE)[i]; return b; });
  for (let i = 1; i < bones.length; i++) bones[0].add(bones[i]);

  // partes por material (grupos do SkinnedMesh)
  const parts = { skin: [], trunk: [], cloth: [], ivory: [], gold: [], city: [], pink: [], eye: [], silver: [] };
  const add = (key, g, bone = 0, color) => { parts[key].push(prep(g, bone, color)); return g; };
  const tmp = new V3(), tmp2 = new V3(), tmp3 = new V3();

  // ============================ CORPO ==============================
  {
    // Esfera com os polos em cima (debaixo da cidade) e embaixo (barriga): as linhas de dobra
    // (v constante) são anéis horizontais ao redor do corpo — horizontais nos flancos, no ombro e na
    // garupa, sem convergir em "estrela" nos lados; a textura esmaece nos polos (v→0/1). A emenda de
    // u (u=0) fica à frente (+X), escondida pelo pescoço.
    const WS = low ? 72 : 128, HS = low ? 48 : 96;
    const g = new THREE.SphereGeometry(1, WS, HS);
    g.rotateY(Math.PI);
    // uv: u ao redor do corpo (2,5 ladrilhos), v do polo de baixo ao de cima
    { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, u * 2.5, v); } }
    mapVertices(g, (v) => { tmp.copy(v).normalize(); bodyPoint(tmp, v); });
    weldSeam(g, (k) => k * (WS + 1), (k) => k * (WS + 1) + WS, HS + 1);
    add('skin', g);
  }
  // pescoço (une corpo e cabeça): elipsoide + ruído + dobras (as mesmas do corpo, contínuas na junção)
  const NC = { x: 580, y: 1110, rx: 300, ry: 345, rz: 345 };
  const neckPoint = (n, out) => {
    const nz = noise.fbm3(n.x * 2 + 3, n.y * 2, n.z * 2, 3) * 8;
    out.set(NC.x + n.x * NC.rx, NC.y + n.y * NC.ry, n.z * NC.rz).addScaledVector(n, nz);
    const lx = out.x - NC.x, ly = out.y - NC.y;
    return out.addScaledVector(n, EM.FOLD_BODY * 0.7 * (1 - 0.5 * smooth(0.4, 0.8, n.y)) * foldValue((lx * FOLD_CA + ly * FOLD_SA) / 210 + 2, (-lx * FOLD_SA + ly * FOLD_CA) / 68, out.z / 130));
  };
  {
    const WS = low ? 40 : 64, HS = low ? 28 : 44;
    const g = new THREE.SphereGeometry(1, WS, HS);
    mapVertices(g, (v) => { tmp.copy(v); neckPoint(tmp, v); });
    weldSeam(g, (k) => k * (WS + 1), (k) => k * (WS + 1) + WS, HS + 1);
    scaleUV(g, 2, 0.62, 0, 0.14);
    add('skin', g);
  }
  // ============================ CABEÇA =============================
  {
    const WS = low ? 56 : 96, HS = low ? 36 : 64;
    const g = new THREE.SphereGeometry(1, WS, HS);
    mapVertices(g, (v) => { tmp.copy(v).normalize(); headPoint(tmp, v); });
    weldSeam(g, (k) => k * (WS + 1), (k) => k * (WS + 1) + WS, HS + 1);
    scaleUV(g, 1.6, 0.74, 0, 0.1);
    add('skin', g);
  }
  // olhos: globo castanho-escuro com íris âmbar e brilho (textura + emissivo), pouco afundado;
  // anel de pele escura ao redor (pálpebra) + dobra de pele por cima
  for (const side of [-1, 1]) {
    const d = new V3(0.56, 0.1, side * 0.82).normalize();
    const g = new THREE.SphereGeometry(EM.EYE_RADIUS, 20, 14);
    // o centro da textura (u=v=0.5) fica em +X da esfera → aponta na direção d (para fora da cabeça)
    const q = new THREE.Quaternion().setFromUnitVectors(new V3(1, 0, 0), d);
    // u cobre 360° e v 180°: comprime u ×2 para a íris ficar redonda (a borda da textura é esclera escura, clamp)
    { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) - 0.5) * 2 + 0.5, uv.getY(i)); }
    placeGeom(g, headPoint(d, tmp, false).addScaledVector(d, -EM.EYE_SINK), q);
    add('eye', g);
    // anel de pele escura (pálpebras) rente à pele, mapeado no canto escuro da textura do olho
    const ring = new THREE.TorusGeometry(EM.EYE_RADIUS + 3, 9, 8, 24);
    placeGeom(ring, headPoint(d, tmp, false).addScaledVector(d, -4), new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, 1), d));
    remapUV(ring, [0.01, 0.05, 0.01, 0.05]);
    add('eye', ring);
    // pálpebra superior: dobra de pele por cima (meia-casca), ligeiramente acima do globo
    const lid = new THREE.SphereGeometry(EM.EYE_RADIUS + 6, 14, 8, 0, TAU, 0, Math.PI * 0.27);
    placeGeom(lid, headPoint(d, tmp, false).addScaledVector(d, -9), quatFromUp(new V3(0.0, 0.92, side * 0.38).normalize()));
    scaleUV(lid, 0.3, 0.1);
    add('skin', lid);
  }
  // ============================ PATAS ==============================
  // Perfil de revolução (raio, y): pé alargado e arredondado embaixo (flare ≈ 1.12), tornozelo,
  // leve estreitamento no joelho (≈ 0.88 do quadril, a ~45% da altura) com duas pregas de pele,
  // coxa/quadril mais largos e topo FECHADO e arredondado (afunda na barriga sem aresta visível).
  const LR = EM.LEG_HIP_RADIUS;  // raio de referência (quadril)
  const legProfile = [
    [0, -90], [0.72 * LR, -90], [0.98 * LR, -80], [1.09 * LR, -62], [1.12 * LR, -30], [1.08 * LR, 10], [1.02 * LR, 60], [0.97 * LR, 120],
    [0.945 * LR, 190], [0.92 * LR, 260], [0.9 * LR, 320], [0.88 * LR, 360], [0.92 * LR, 400], [0.885 * LR, 430], [0.925 * LR, 470], [0.9 * LR, 510],
    [0.92 * LR, 580], [0.945 * LR, 650], [0.97 * LR, 720], [1.0 * LR, 790], [1.04 * LR, 850], [1.07 * LR, 900], [1.03 * LR, 935], [0.9 * LR, 955], [0.62 * LR, 966], [0, 968],
  ];
  const legR = (y) => { // raio do perfil na altura y (interpolação linear)
    for (let i = 1; i < legProfile.length; i++) { const [r0, y0] = legProfile[i - 1], [r1, y1] = legProfile[i]; if (y <= y1) return lerp(r0, r1, (y - y0) / (y1 - y0)); }
    return 0;
  };
  // perfil reamostrado (≈ 44 anéis: as dobras esculpidas precisam de vértices ao longo da pata)
  const legPts = [];
  { const ys = new Set(legProfile.map(([, y]) => y)); for (let y = -90; y < 968; y += 26) ys.add(y); for (const y of [...ys].sort((a, b) => a - b)) legPts.push(new THREE.Vector2(legR(y), y)); }
  const LEG_SEGS = low ? 28 : 48;
  const legIdx = { '1,-1': BONE.legFL, '1,1': BONE.legFR, '-1,-1': BONE.legBL, '-1,1': BONE.legBR };
  for (const sx of [1, -1]) for (const sz of [-1, 1]) {
    const bone = legIdx[sx + ',' + sz];
    const cx = sx * LG.offsetX, cz = sz * LG.offsetZ;
    const g = new THREE.LatheGeometry(legPts, LEG_SEGS);
    // deformação da pata (também aplicada à faixa do tornozelo, para ela seguir a pele)
    const legDeform = (v, lift = 0) => {
      // ruído RADIAL (sem descontinuidade nos planos x=0 / z=0, que criava uma "costura" vertical)
      // + anéis de dobras esculpidas (lençóis horizontais ondulados), rasos no pé e no topo
      const rl = Math.hypot(v.x, v.z);
      const fade = smooth(-30, 70, v.y) * (1 - smooth(800, 920, v.y));
      const n = noise.fbm3(v.x / 220 + cx, v.y / 220, v.z / 220 + cz, 2) * 6 + lift + EM.FOLD_LEG * fade * foldValue(v.x / 150 + cx * 0.011, v.y / 52, v.z / 150 + cz * 0.013);
      if (rl > 1e-3) { v.x += (n * v.x) / rl; v.z += (n * v.z) / rl; }
      // leve dobra do joelho (frente: joelho à frente; trás: jarrete atrás) e coxa inclinada para dentro,
      // de modo que o topo da pata entre na barriga em vez de sair pelo flanco
      const k = smooth(560, 320, v.y) * (1 - smooth(140, -40, v.y));   // 1 na altura do joelho
      v.x += sx * 18 * k + sx * 10 * smooth(560, 900, v.y);
      v.z -= sz * EM.LEG_HIP_LEAN * smooth(600, 968, v.y);
      v.x += cx; v.z += cz;
    };
    mapVertices(g, (v) => legDeform(v));
    weldSeam(g, (k) => k, (k) => LEG_SEGS * legPts.length + k, legPts.length);
    scaleUV(g, 2, 0.45, 0, 0.14);
    add('skin', g, bone);
    // unhas: 5 esferas achatadas de marfim meio enterradas na borda do pé, da frente para os lados
    const rNail = legR(-14);
    for (const a of [-1.05, -0.52, 0, 0.52, 1.05]) {
      const ux = sx * Math.cos(a), uz = Math.sin(a);  // frente da pata = +X (lado sx)
      const n = new THREE.SphereGeometry(1, 10, 7);
      n.scale(36, 24, 22);
      const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, 1), new V3(ux, 0, uz));
      placeGeom(n, new V3(cx + ux * (rNail - 6), -16, cz + uz * (rNail - 6)), q);
      add('ivory', n, bone);
    }
    // faixa listrada GROSSA no tornozelo (segue o perfil e as dobras da pele) com bordas de ouro com contas
    const BAND_Y0 = 62, BAND_Y1 = 232;
    const band = new THREE.CylinderGeometry(legR(BAND_Y1), legR(BAND_Y0), BAND_Y1 - BAND_Y0, 36, 8, true);
    band.translate(0, (BAND_Y0 + BAND_Y1) / 2, 0);
    mapVertices(band, (v) => legDeform(v, 11));   // segue a pele, 11 m acima dela
    weldSeam(band, (k) => k * 37, (k) => k * 37 + 36, 9);
    remapUV(band, [0, 1, 0.255, 0.495]);
    add('cloth', band, bone);
    for (const [yb, rb] of [[BAND_Y0 + 4, legR(BAND_Y0 + 4) + 13], [BAND_Y1 - 4, legR(BAND_Y1 - 4) + 13]]) {
      const ring = new THREE.TorusGeometry(rb, 7, 8, 40); ring.rotateX(Math.PI / 2); ring.translate(cx, yb, cz); add('gold', ring, bone);
      for (let i = 0; i < 22; i++) { const a = (i / 22) * TAU; const bead = new THREE.SphereGeometry(5.5, 6, 4); bead.translate(cx + Math.cos(a) * (rb + 7), yb, cz + Math.sin(a) * (rb + 7)); add('gold', bead, bone); }
    }
  }
  // ============================ CAUDA ==============================
  {
    const curve = new THREE.CatmullRomCurve3([new V3(-520, 1185, 0), new V3(-600, 1070, 8), new V3(-628, 900, -6), new V3(-618, 760, 10), new V3(-590, 655, 0)]);
    const g = tubeGeometry(curve, 20, 10, (t) => (t < 0.75 ? lerp(32, 14, t / 0.75) : t < 0.9 ? lerp(14, 26, (t - 0.75) / 0.15) : 26 * Math.sqrt(Math.max(0, 1 - ((t - 0.9) / 0.1) ** 2))));
    scaleUV(g, 0.3, 0.6);
    add('skin', g, BONE.tail);
  }
  // ============================ TROMBA =============================
  const trunkCurve = TRUNK_CURVE;
  {
    // anéis de dobras esculpidas (ondulados) ao longo da tromba, rasos na raiz (sob a cabeça) e na ponta
    const trunkDisp = (t, a) => (6 + 0.03 * trunkR(t)) * smooth(0.06, 0.2, t) * (1 - smooth(0.9, 0.97, t)) * foldValue(Math.cos(a * TAU) * 0.5 + 9, Math.sin(a * TAU) * 0.5, t * 16);
    const g = tubeGeometry(trunkCurve, low ? 56 : 96, low ? 16 : 24, trunkR, { disp: trunkDisp });
    add('trunk', g, BONE.trunk);
    // 2 anéis de ouro na manga: na ponta do tecido e a meio caminho
    for (const t0 of [TRUNK_FABRIC_END - 0.01, 0.47]) {
      const ring = new THREE.TorusGeometry(trunkR(t0) + 8, 11, 10, 32);
      const tan = trunkCurve.getTangentAt(t0);
      placeGeom(ring, trunkCurve.getPointAt(t0), new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, 1), tan));
      add('gold', ring, BONE.trunk);
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
    add('ivory', g);
    // anéis de ouro com contas (3 por presa)
    for (const t of TUSK_RINGS) {
      const tan = curve.getTangentAt(t), P = curve.getPointAt(t), r = rAt(t);
      const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, 1), tan);
      // anel GROSSO (tubo ≈ 0,35 do raio da presa) com duas fileiras de contas nas bordas (ref. 2)
      const tube = r * 0.35;
      const ring = new THREE.TorusGeometry(r + tube * 0.75, tube, 10, 36); placeGeom(ring, P, q); add('gold', ring);
      const N = new V3().crossVectors(tan, _up).normalize(), Bn = new V3().crossVectors(tan, N);
      const nb = 22, rb = tube * 0.3;
      for (const off of [-tube * 0.9, tube * 0.9]) for (let i = 0; i < nb; i++) {
        const a = (i / nb) * TAU + (off > 0 ? Math.PI / nb : 0); const bead = new THREE.SphereGeometry(rb, 6, 4);
        placeGeom(bead, tmp.copy(P).addScaledVector(tan, off).addScaledVector(N, Math.cos(a) * (r + tube * 0.75 + tube * 0.55)).addScaledVector(Bn, Math.sin(a) * (r + tube * 0.75 + tube * 0.55)));
        add('gold', bead);
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
  const earOutline = [[0, 0], [-110, 62], [-300, 94], [-470, 88], [-590, 52], [-652, -40], [-676, -230], [-670, -440], [-648, -630], [-596, -748], [-480, -804], [-320, -814], [-170, -784], [-70, -722], [-8, -610], [20, -450], [22, -280], [14, -120]];
  const esx = (EAR.width * EM.EAR_SCALE) / 676, esy = (EAR.height * EM.EAR_SCALE) / 814;
  const EAR_C = { x: -320 * esx, y: -365 * esy };
  const earShape = (scale = 1, cx = EAR_C.x, cy = EAR_C.y) => {
    const sh = new THREE.Shape();
    const pts = earOutline.map(([x, y]) => new THREE.Vector2(cx + (x * esx - cx) * scale, cy + (y * esy - cy) * scale));
    sh.moveTo(pts[0].x, pts[0].y); sh.splineThru(pts.slice(1).concat([pts[0]]));
    return sh;
  };
  const EAR_W = 676 * esx, EAR_H = 814 * esy;
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
    let ear = new THREE.ExtrudeGeometry(earShape(1), { depth: 28, bevelEnabled: true, bevelThickness: 18, bevelSize: 18, bevelSegments: 3, curveSegments: low ? 5 : 8 });
    ear.translate(0, 0, 18); earUV(ear); ear = tessellate(ear, low ? 80 : 42); mapVertices(ear, earWarp);
    ear = mergeVertices(ear); ear.computeVertexNormals();
    add('skin', finish(ear), bone);
    // manto: miolo de tecido escuro + borda listrada (anel concêntrico), ambos no lado de fora
    const Z_BL = 67; // acima da face de fora da orelha (bisel chega a z≈64)
    let core = new THREE.ExtrudeGeometry(earShape(RING_IN + 0.01), { depth: 6, bevelEnabled: false, curveSegments: 6 });
    core.translate(0, 0, Z_BL); core = tessellate(core, low ? 90 : 55); coreUV(core);
    mapVertices(core, earWarp); core = mergeVertices(core); core.computeVertexNormals();
    add('cloth', finish(core), bone);
    const ringShape = earShape(RING_OUT); ringShape.holes.push(earShape(RING_IN));
    let ring = new THREE.ExtrudeGeometry(ringShape, { depth: 12, bevelEnabled: true, bevelThickness: 4, bevelSize: 4, bevelSegments: 1, curveSegments: 6 });
    ring.translate(0, 0, Z_BL - 2); ring = tessellate(ring, low ? 80 : 45); ringUV(ring, RING_OUT, RING_IN);
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
    let topRowY = -Infinity;
    for (let row = 0; row < ROWS; row++) {
      const y = HOUSE_RECT.y0 + (row + 0.5) * dy;
      for (let col = 0; col < COLS; col++) {
        const x = HOUSE_RECT.x0 + (col + 0.5) * dx;
        if (!inCore(x, y)) continue;
        if (inNotch(col, row)) continue;
        if (hrng() < 0.015) continue;
        // profundidades parecidas, um pouco maiores nas fileiras de baixo (terraços)
        const h = EM.EAR_HOUSE_H.min + (EM.EAR_HOUSE_H.max - EM.EAR_HOUSE_H.min) * (0.35 * hrng() + 0.65 * (1 - row / ROWS) * hrng());
        const wall = hrng() < 0.85 ? hrng.pick(COLORS.houses) : hrng.pick([0xd9a593, 0xe7b39f, 0xf0d8c8]);
        const b = boxHouse(dx * 0.86, dy * 0.8, h, 'z', wall, wall, true, false, true);
        b.translate(x, y, Z_BL + 4 + h / 2);
        mapVertices(b, earWarp);
        hg.push(b);
        if (row === ROWS - 1) topRowY = Math.max(topRowY, y + dy * 0.4);
      }
    }
    // torrinhas finas na borda de cima do bloco (sobem no plano da orelha)
    if (topRowY > -Infinity) for (let k = 0; k < 5; k++) {
      const col = 1 + Math.floor(((k + 0.5) / 5) * (COLS - 2)); const x = HOUSE_RECT.x0 + (col + 0.5) * dx;
      const th = 30 + hrng() * 40; if (!inCore(x, topRowY + th * 0.5)) continue;
      const t = boxHouse(dx * 0.45, th, 9, 'z', 0xf6f3ec, 0xf6f3ec, true, true, true); t.translate(x, topRowY + th / 2, Z_BL + 4 + 4.5); mapVertices(t, earWarp); hg.push(t);
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
    add('gold', g);
    // grande bossa dourada no alto da placa + anel
    const boss = new THREE.SphereGeometry(1, 24, 14, 0, TAU, 0, Math.PI / 2);
    platePoint(0.2, 0, lift, tmp); const dn = tmp.clone().sub(new V3(HD.cx, HD.cy, 0)).normalize();
    placeGeom(boss, tmp, quatFromUp(dn), new V3(92, 62, 92)); add('gold', boss);
    const bring = new THREE.TorusGeometry(98, 10, 10, 36); placeGeom(bring, platePoint(0.2, 0, lift + 2, tmp), new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, 1), dn)); add('gold', bring);
  }
  // ============================ BORLA ROSA =========================
  const tasselTop = platePoint(1, 0, 15, new V3());
  {
    const ax = new V3(1335, 0, 0); // eixo vertical da borla (à frente da raiz da tromba)
    const yTop = tasselTop.y - 20;
    // cordão dourado da ponta da placa até a borla
    const strap = new THREE.CylinderGeometry(7, 7, tasselTop.distanceTo(new V3(ax.x, yTop, 0)), 8);
    const mid = tasselTop.clone().add(new V3(ax.x, yTop, 0)).multiplyScalar(0.5);
    placeGeom(strap, mid, quatFromUp(new V3(ax.x, yTop, 0).sub(tasselTop).normalize())); add('gold', strap);
    // pompom vermelho no alto
    const pom = fuzzySphere(58, 16, 12, 0.2); pom.translate(ax.x, yTop - 44, 0);
    add('pink', remapUV(pom, [0.02, 0.98, 0.52, 0.98]));
    // sino dourado (cone) abaixo do pompom
    const bell = new THREE.ConeGeometry(46, 110, 24); bell.rotateX(Math.PI); bell.translate(ax.x, yTop - 100 - 55, 0); add('gold', bell);
    // cúpula rosa com tachas
    const dome = new THREE.SphereGeometry(84, 24, 14, 0, TAU, 0, Math.PI / 2); dome.translate(ax.x, yTop - 100 - 110 - 22, 0);
    remapUV(dome, [0, 1, 0.52, 0.98]); add('pink', dome);
    const domeY = yTop - 100 - 110 - 22;
    const rim = new THREE.TorusGeometry(84, 6, 8, 32); rim.rotateX(Math.PI / 2); rim.translate(ax.x, domeY, 0); add('gold', rim);
    for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU; const s = new THREE.SphereGeometry(9, 7, 5); s.translate(ax.x + Math.cos(a) * 84, domeY - 10, Math.sin(a) * 84); add('gold', s); }
    // franja
    const fr = new THREE.CylinderGeometry(82, 58, 430, 28, 1, true); fr.translate(ax.x, domeY - 215, 0);
    remapUV(fr, [0, 1, 0.02, 0.48], 0, Infinity, 3, 1); add('pink', fr);
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
      const cyl = new THREE.CylinderGeometry(EM.POMPOM_RADIUS * 0.46, EM.POMPOM_RADIUS * 0.46, EM.POMPOM_RADIUS * 0.95, 14); placeGeom(cyl, mid, qd); add('silver', cyl);
      // tampas de prata (flanges) nas duas pontas do elo, encostadas nos pompons
      for (const off of [-0.42, 0.42]) { const cap = new THREE.CylinderGeometry(EM.POMPOM_RADIUS * 0.6, EM.POMPOM_RADIUS * 0.6, EM.POMPOM_RADIUS * 0.16, 14); cap.translate(0, off * EM.POMPOM_RADIUS * 0.95, 0); placeGeom(cap, mid, qd); add('silver', cap); }
    }
  }
  // ============================ TRAMA DA BARRIGA ===================
  {
    const pos = [], uv = [], idx = [];
    const nx0 = -0.12, rows = [nx0 - 0.045, nx0 + 0.045]; const N = 64;
    const k = Math.sqrt(1 - nx0 * nx0); const phi0 = Math.acos(Math.min(1, 0.42 / k));
    for (let r = 0; r < 2; r++) for (let i = 0; i <= N; i++) {
      const phi = phi0 + (i / N) * (TAU - 2 * phi0); const kk = Math.sqrt(1 - rows[r] * rows[r]);
      tmp.set(rows[r], Math.cos(phi) * kk, Math.sin(phi) * kk);
      bodyPoint(tmp, tmp2).addScaledVector(tmp, 9); pos.push(tmp2.x, tmp2.y, tmp2.z); uv.push((i / N) * 9, 0.03 + r * 0.19);
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
  const surfAt = (x, z, out) => { // ponto da pele do dorso acima de (x,z) local e normal aproximada
    const nx = x / RX, nz = z / B.rz, q = nx * nx + nz * nz; if (q >= 1) return null;
    const ny = Math.sqrt(1 - q); tmp.set(nx, ny, nz); bodyPoint(tmp, out);
    tmp2.set(nx / RX, ny / B.ry, nz / B.rz).normalize(); return tmp2; // normal
  };
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
        bodyPoint(dirv, tmp3);
        nrm.set(dirv.x / RX, dirv.y / B.ry, dirv.z / B.rz).normalize();
        const lx = tmp3.x, lz = tmp3.z;
        if (insideNeckOrHead(tmp3)) continue;
        if (Math.abs(nx2 + 0.12) < 0.075 && Math.abs(p2) > 1.05) continue; // trama da barriga
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
    const dummy = new THREE.Object3D(), nrm = new V3(), qh = new THREE.Quaternion(), qy = new THREE.Quaternion(), upMix = new V3();
    const dlat = spacing / NC.ry;
    for (let lat = Math.PI / 2 - dlat * 0.5, row = 0; lat > -0.15; lat -= dlat, row++) {
      const ring = NC.rz * Math.cos(lat); const n = Math.max(1, Math.round((TAU * ring) / spacing));
      for (let j = 0; j < n; j++) {
        if (carpet.flat.length + carpet.tile.length >= EM.CARPET_MAX) break;
        const lon = ((j + (row % 2 ? 0.5 : 0)) / n) * TAU + rngCity.range(-0.1, 0.1) * (TAU / n);
        const la = lat + rngCity.range(-0.15, 0.15) * dlat;
        nrm.set(Math.cos(la) * Math.cos(lon), Math.sin(la), Math.cos(la) * Math.sin(lon));
        neckPoint(nrm, tmp3);
        // só onde o pescoço está fora do corpo e da cabeça
        if ((tmp3.x / RX) ** 2 + ((tmp3.y - B.cy) / B.ry) ** 2 + (tmp3.z / B.rz) ** 2 < 1.0) continue;
        if (((tmp3.x - HD.cx) / (HR * 1.0)) ** 2 + ((tmp3.y - HD.cy) / (HR * 1.22)) ** 2 + (tmp3.z / (HR * 0.95)) ** 2 < 1) continue;
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
    grid(low ? 40 : 72, low ? 28 : 48, (fi, fj) => {
      const nx = -0.985 + fi * (0.985 + 0.96), k = Math.sqrt(Math.max(0.02, 1 - nx * nx)), phi = -phiMax + fj * 2 * phiMax;
      dirv.set(nx, Math.cos(phi) * k, Math.sin(phi) * k); bodyPoint(dirv, tmp3);
      nrm.set(dirv.x / RX, dirv.y / B.ry, dirv.z / B.rz).normalize(); tmp3.addScaledVector(nrm, EM.CRUST_OFFSET);
      pos.push(tmp3.x, tmp3.y, tmp3.z); uv.push(fi * REP, fj * REP * 1.35);
      const edge = noise.noise2(nx * 3 + index * 1.3, phi * 2.2) * 0.25;
      let a = 1 - smooth(phiMax - 0.55, phiMax - 0.05, Math.abs(phi) + edge);
      a *= 1 - smooth(0.92, 0.985, -nx + edge * 0.4);                       // garupa: borda esmaecida
      if (Math.abs(nx + 0.12) < 0.075 && Math.abs(phi) > 1.05) a = 0;       // trama da barriga
      col.push(1, 1, 1, a);
    });
    grid(low ? 32 : 48, low ? 14 : 24, (fi, fj) => {   // pescoço: lon ao redor, lat 0 → π/2
      const lon = fi * TAU, lat = fj * (Math.PI / 2 - 0.02);
      nrm.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)); neckPoint(nrm, tmp3); tmp3.addScaledVector(nrm, EM.CRUST_OFFSET);
      pos.push(tmp3.x, tmp3.y, tmp3.z); uv.push(fi * REP * 0.9, fj * REP * 0.45);
      const a = smooth(0.06, 0.32, lat) * (1 - smooth(0.72, 0.9, Math.abs(nrm.z)) * (1 - smooth(0.25, 0.55, nrm.y)));
      col.push(1, 1, 1, a);
    });
    const g = new THREE.BufferGeometry(); g.setIndex(idx);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    g.computeVertexNormals();
    { const n = new V3().fromBufferAttribute(g.attributes.normal, 24 * 49 + 24); if (n.y < 0) { flipWinding(g); g.computeVertexNormals(); } }
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
    if (capGold) { const cap = new THREE.SphereGeometry(r * 1.55, 10, 7, 0, TAU, 0, Math.PI / 2); cap.translate(0, h - 2, 0); placeGeom(cap, p, q); goldCity.push(cap); }
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
      dirv.set(nx, Math.cos(phi) * k, Math.sin(phi) * k); bodyPoint(dirv, tmp3);
      nrm.set(dirv.x / RX, dirv.y / B.ry, dirv.z / B.rz).normalize();
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
      slimTower(tmp2.copy(P).addScaledVector(nrm, rAt(t) - 2), nrm.clone(), 28 + trng.range(0, 40), 0xf6f3ec, true, 3.4);
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
  if (city.length) add('city', mergeGeometries(city, false));
  for (const g of goldCity) add('gold', g);

  // ============================ MONTAGEM ===========================
  const order = ['skin', 'trunk', 'cloth', 'ivory', 'gold', 'city', 'pink', 'eye', 'silver'];
  const merged = [], mats = [];
  for (const k of order) { if (!parts[k].length) continue; merged.push(mergeGeometries(parts[k], false)); mats.push(S.mat[k]); }
  const geom = mergeGeometries(merged, true);
  geom.computeBoundingSphere();
  const mesh = new THREE.SkinnedMesh(geom, mats);
  mesh.add(bones[0]);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.frustumCulled = true;
  rig.add(mesh);

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
    if (tuskInst.length) rig.add(makeInst(tuskInst, REG.ROOFT));
    // casca-crosta
    if (crustGeom) { const cm = new THREE.Mesh(crustGeom, S.mat.crust); cm.frustumCulled = true; rig.add(cm); }
    carpetCount = carpet.flat.length + carpet.tile.length;
  }
  // ---- tachas da placa (instâncias) ----
  {
    // tachas em malha hexagonal com 3 tamanhos: coluna central de bossas GRANDES, médias ao redor,
    // pequenas junto à borda (ref. 1: a placa é uma gota dourada coberta de semiesferas)
    const studGeo = new THREE.SphereGeometry(1, low ? 8 : 9, low ? 4 : 4, 0, TAU, 0, Math.PI / 2);
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
    rig.add(inst);
  }
  // ---- pompons (instâncias com cor) ----
  {
    const pomGeo = fuzzySphere(1, low ? 10 : 12, low ? 7 : 8, 0.26);
    scaleUV(pomGeo, 2, 1);
    const inst = new THREE.InstancedMesh(pomGeo, S.mat.pompom, garland.length);
    const dummy = new THREE.Object3D(); const col = new THREE.Color();
    garland.forEach((gp, i) => {
      const dn = gp.pos.clone().sub(new V3(HD.cx, HD.cy, 0)).normalize();
      dummy.position.copy(gp.pos).addScaledVector(dn, EM.POMPOM_RADIUS * 0.8); dummy.quaternion.copy(quatFromUp(gp.tangent)); dummy.scale.set(EM.POMPOM_RADIUS, EM.POMPOM_RADIUS * 1.08, EM.POMPOM_RADIUS); dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix); inst.setColorAt(i, col.set(COLORS.pompoms[i % COLORS.pompoms.length]));
    });
    inst.instanceMatrix.needsUpdate = true; if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    rig.add(inst);
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
    return { pts, period, offset: r() * period, tip: new V3(), tipRel: TRUNK_CURVE.getPointAt(1).sub(new V3(TRUNK_ROOT.x, TRUNK_ROOT.y, TRUNK_ROOT.z)), root: new V3(TRUNK_ROOT.x, TRUNK_ROOT.y, TRUNK_ROOT.z) };
  })();
  const SPRAY_V = 600, SPRAY_G = 230, SPRAY_DIR = new V3(0.72, 0.69, 0).normalize();
  function updateSpray(time) {
    const ph = (time + spray.offset) % spray.period, LIFE = EM.SPRAY_LIFE, DUR = EM.SPRAY_DURATION;
    const active = ph < DUR + LIFE;
    spray.pts.visible = active; if (!active) return;
    spray.tip.copy(spray.tipRel).applyQuaternion(B2.trunk.quaternion).add(spray.root);
    const tx = spray.tip.x, ty = spray.tip.y, tz = spray.tip.z;
    for (let i = 0; i < sprayN; i++) {
      const b = (i / sprayN) * LIFE;                       // instante de nascimento dentro do ciclo
      let age = ph - b; const cyc = Math.floor(age / LIFE); age -= cyc * LIFE;
      const born = ph - age;
      const k3 = i * 3, k4 = i * 4;
      if (age < 0 || born < 0 || born > DUR) { sprayPos[k3] = tx; sprayPos[k3 + 1] = ty; sprayPos[k3 + 2] = tz; sprayCol[k3] = sprayCol[k3 + 1] = sprayCol[k3 + 2] = 0; continue; }
      const sf = sprayJit[k4], jz = sprayJit[k4 + 1], jy = sprayJit[k4 + 2];
      const spread = 22 * age + 48 * age * age * smooth(1.5, LIFE, age);   // abre em névoa no fim do arco
      sprayPos[k3] = tx + SPRAY_DIR.x * SPRAY_V * sf * age + 0.15 * spread * jy;
      sprayPos[k3 + 1] = ty + SPRAY_DIR.y * SPRAY_V * sf * age - 0.5 * SPRAY_G * age * age + spread * jy * 0.6;
      sprayPos[k3 + 2] = tz + spread * jz + 12 * jz * age;
      const bright = (0.25 + 0.75 * smooth(0, 0.25, age)) * (1 - smooth(LIFE * 0.6, LIFE, age)) * (0.7 + 0.3 * sprayJit[k4 + 3]);
      sprayCol[k3] = bright; sprayCol[k3 + 1] = bright; sprayCol[k3 + 2] = bright;
    }
    spray.pts.geometry.attributes.position.needsUpdate = true;
    spray.pts.geometry.attributes.color.needsUpdate = true;
  }

  // ============================ ENTIDADE ===========================
  const state = { u: route.u0, position: new THREE.Vector3(), heading: 0 };
  const colLocal = [
    [-240, 1060, 0, 430], [0, 1075, 0, 445], [240, 1060, 0, 425], [-470, 1040, 0, 330],
    [HD.cx, HD.cy, 0, HR * 1.02], [580, 1100, 0, 340],
    [1100, 760, 0, 190], [1140, 420, 0, 115], [1240, 150, 0, 95],
    [1260, 720, -300, 85], [1620, 700, -400, 65], [1260, 720, 300, 85], [1620, 700, 300 + 100, 65],
    [290, 880, -500, 500], [290, 880, 500, 500],   // orelhas gigantes
  ];
  for (const sx of [1, -1]) for (const sz of [-1, 1]) { colLocal.push([sx * LG.offsetX, 250, sz * LG.offsetZ, 160], [sx * LG.offsetX, 600, sz * LG.offsetZ, 170]); }
  // Escala global: o modelo é construído nas dimensões-base e o grupo é ampliado por ELEPHANT.SCALE.
  const SCALE = E.SCALE || 1;
  group.scale.setScalar(SCALE);
  const colliders = colLocal.map((c) => ({ center: new THREE.Vector3(), local: new THREE.Vector3(c[0], c[1], c[2]), radius: c[3] * SCALE }));
  const B2 = { legFL: bones[BONE.legFL], legFR: bones[BONE.legFR], legBL: bones[BONE.legBL], legBR: bones[BONE.legBR], earL: bones[BONE.earL], earR: bones[BONE.earR], trunk: bones[BONE.trunk], tail: bones[BONE.tail] };
  const phaseOff = index * 1.7;
  const viewer = { pos: null, has: false };
  const _sv = new V3();

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
      // passo lentíssimo: pares diagonais
      const phase = (time * E.SPEED) / E.STRIDE * TAU + phaseOff;
      const s = Math.sin(phase);
      B2.legFL.rotation.z = 0.12 * s; B2.legBR.rotation.z = 0.12 * s;
      B2.legFR.rotation.z = -0.12 * s; B2.legBL.rotation.z = -0.12 * s;
      rig.position.y = 8 * Math.sin(2 * phase + 0.4);
      rig.rotation.x = 0.006 * Math.sin(phase);  // leve balanço lateral
      // orelhas abanando, tromba oscilando, cauda
      const t = time + phaseOff * 3;
      B2.earR.rotation.y = 0.08 * Math.sin((TAU * t) / 9);
      B2.earL.rotation.y = -0.08 * Math.sin((TAU * t) / 9 + 0.6);
      B2.trunk.rotation.x = 0.05 * Math.sin((TAU * t) / 7);
      B2.trunk.rotation.z = 0.02 * Math.sin((TAU * t) / 11 + 1);
      B2.tail.rotation.y = 0.16 * Math.sin((TAU * t) / 5.5);
      B2.tail.rotation.x = 0.05 * Math.sin((TAU * t) / 3.7);
      // LOD do tapete de casas
      let vp = viewer.has ? viewer.pos : (typeof window !== 'undefined' ? window.__ruppen?.camera?.position : null);
      if (vp) { _sv.copy(vp); carpetGroup.visible = _sv.distanceTo(state.position) < ent.lodDistance; }
      else carpetGroup.visible = true;
      updateSpray(time);
      group.updateMatrixWorld(true);
      for (const c of colliders) c.center.copy(c.local).applyMatrix4(rig.matrixWorld);
      ent.deliveryMarker.set((PZ.x0 + PZ.x1) / 2, ent.cityTopLocal + 260, 0).applyMatrix4(group.matrixWorld);
    },
    // Altura (mundo) da superfície do elefante/cidade na vertical de (x,z); null fora.
    getSurfaceHeight(x, z) {
      const c = Math.cos(state.heading), sn = Math.sin(state.heading);
      const wx = (x - state.position.x) / SCALE, wz = (z - state.position.z) / SCALE;
      const px = c * wx - sn * wz, pz = sn * wx + c * wz;
      let best = -Infinity;
      // corpo (pele com dobras) + crosta + cidade
      const q = (px / RX) ** 2 + (pz / B.rz) ** 2;
      if (q < 1) {
        const ny = Math.sqrt(1 - q), nx = px / RX, nz = pz / B.rz;
        _sv.set(nx, ny, nz); bodyPoint(_sv, _sh);
        let h = _sh.y;
        const nY = (ny / B.ry) / Math.hypot(nx / RX, ny / B.ry, nz / B.rz);
        if (inPlaza(px, pz)) h = Math.max(h, PLAZA_TOP);
        else if (inPalace(px, pz)) { h = Math.max(h, Math.abs(px - PALACE_X) < PS.hx * 0.55 && Math.abs(pz) < PS.hz * 0.65 ? PALACE_BASE_TOP + PALACE_TIER_H : Math.abs(px - PALACE_X) < PS.hx && Math.abs(pz) < PS.hz ? PALACE_BASE_TOP : h); const rr = Math.hypot(px - PALACE_X, pz); if (rr < DOME_R + 8) h = Math.max(h, DOME_CY + Math.sqrt(Math.max(0, DOME_R * DOME_R - rr * rr))); }
        else if (inBrick(px, pz)) h = Math.max(h, BRICK_TOP);
        else if (inTemple(px, pz)) { const T = TEMPLES.find((t) => Math.abs(px - t.x) < t.hx + 30 && Math.abs(pz - t.z) < t.hz + 30); h += T.h; }
        else if (nY > 0.3) h += EM.CRUST_OFFSET + (nearPlaza(px, pz) ? 28 : HOUSE_AVG);
        best = Math.max(best, h);
      }
      // cabeça (elipsoide) — topo
      const hr = HR; const dx = (px - HD.cx) / (hr * 0.98), dz = pz / (hr * 0.94); const qh = dx * dx + dz * dz;
      if (qh < 1) { const ny = Math.sqrt(1 - qh); best = Math.max(best, HD.cy + hr * 1.14 * ny + 50 * Math.max(0, dx) * ny + (ny > 0.4 ? 14 : 0)); }
      // pescoço
      const dnx = (px - NC.x) / NC.rx, dnz = pz / NC.rz; const qn = dnx * dnx + dnz * dnz;
      if (qn < 1) best = Math.max(best, NC.y + NC.ry * Math.sqrt(1 - qn) + EM.CRUST_OFFSET + HOUSE_AVG);
      return best === -Infinity ? null : (best + rig.position.y) * SCALE;
    },
    isOverCity(x, z) {
      const c = Math.cos(state.heading), sn = Math.sin(state.heading);
      const wx = x - state.position.x, wz = z - state.position.z;
      const px = c * wx - sn * wz, pz = sn * wx + c * wz;
      return (px / ent.cityFootprint.rx) ** 2 + (pz / ent.cityFootprint.rz) ** 2 < 1;
    },
  };
  const _sh = new V3();
  group.updateMatrixWorld(true);
  ent.update(0, 0);
  return ent;
}
