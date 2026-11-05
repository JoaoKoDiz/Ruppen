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
const HOUSE_AVG = 14;            // altura média das casas usada em getSurfaceHeight
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

// Linhas de rugas onduladas e horizontais, periódicas em x E em y (cada linha é desenhada também
// deslocada ±H: a textura fecha nos dois sentidos e o dorso pode usar uv "inclinado" sem emenda).
// `fold` = dobra grande esculpida: sulco escuro largo e suave + crista clara por baixo (luz de cima).
function drawWrinkles(ctx, W, H, rng, { count, color, alpha, width, highlight = false, breaks = 0.15, amp = 1, y0 = 0, fold = false, hiAlpha = 0.13 }) {
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const yc = y0 + (i + 0.25 + rng() * 0.5) * H / count;
    // fases ALEATÓRIAS por linha (uma deriva regular de fase cria "impressões digitais"); a amplitude
    // fica abaixo de metade do espaçamento para as dobras vizinhas não se cruzarem
    const k1 = rng.int(1, 3), k2 = rng.int(4, 9), k3 = rng.int(10, 22);
    const p1 = rng() * TAU, p2 = rng() * TAU, p3 = rng() * TAU;
    const a1 = (5 + rng() * 9) * amp, a2 = (2 + rng() * 3) * amp, a3 = (0.5 + rng() * 1.5) * amp;
    const lw = width * (0.6 + rng() * 0.8);
    const al = alpha * (0.7 + rng() * 0.3);
    const yf = (x) => yc + a1 * Math.sin(TAU * k1 * x / W + p1) + a2 * Math.sin(TAU * k2 * x / W + p2) + a3 * Math.sin(TAU * k3 * x / W + p3);
    const pass = (dy, style, w) => {
      ctx.lineWidth = w; ctx.strokeStyle = style;
      for (const oy of [-H, 0, H]) {
        ctx.beginPath();
        let drawing = false;
        for (let x = 0; x <= W; x += 3) {
          const gap = noise.noise2(x / 110 + i * 11.3, i * 2.1) < -0.8 + breaks * 1.3;
          if (gap) { drawing = false; continue; }
          const y = yf(x) + dy + oy;
          if (!drawing) { ctx.moveTo(x, y); drawing = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    };
    if (fold) {
      // sombra larga e suave (3 passes decrescentes) + sulco + crista iluminada por baixo
      pass(lw * 0.15, rgba(color, al * 0.22), lw * 2.6);
      pass(lw * 0.1, rgba(color, al * 0.35), lw * 1.6);
      pass(0, rgba(color, al), lw);
      if (highlight) { pass(lw * 0.95, `rgba(255,245,235,${hiAlpha})`, lw * 0.7); pass(-lw * 0.75, `rgba(0,0,0,${al * 0.25})`, lw * 0.35); }
    } else {
      pass(0, rgba(color, al), lw);
      if (highlight) pass(lw * 0.9, `rgba(255,255,255,${hiAlpha})`, lw * 0.6);
    }
  }
}

// ------------------------------------------------------------------
//  texturas (compartilhadas entre todos os elefantes)
// ------------------------------------------------------------------
function makeSkinTextures() {
  const W = 1024, H = 1024;
  const c = makeCanvas(W, H), ctx = c.getContext('2d');
  // base: cinza quente ESCURO (as referências: barro molhado ~#5e5a5c), sombras levemente azuladas
  ctx.fillStyle = '#716a6c'; ctx.fillRect(0, 0, W, H);
  const blot = noiseCanvas(128, 17, 3, 4, 150, 255);
  ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.45; ctx.drawImage(blot, 0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.07; ctx.fillStyle = '#4e5e8a'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
  // dobras GRANDES esculpidas (poucas, grossas, onduladas, com sombreado suave) + camada fina discreta;
  // o MESMO gerador para a cor e o bump
  const r1 = createRng(SEED + 5), r2 = createRng(SEED + 5);
  drawWrinkles(ctx, W, H, r1, { count: 24, color: 0x2c272c, alpha: 0.46, width: 7.5, highlight: true, breaks: 0.04, amp: 1.25, fold: true, hiAlpha: 0.075 });
  drawWrinkles(ctx, W, H, r1, { count: 30, color: 0x3a353a, alpha: 0.2, width: 2.6, breaks: 0.3, amp: 1.0, highlight: true, hiAlpha: 0.04 });
  // poros/granulado fino
  ctx.globalAlpha = 0.12; const grain = noiseCanvas(256, 23, 24, 2, 120, 255);
  ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(grain, 0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  // bump: cinza médio = altura neutra; sulcos escuros largos e suaves (dobras de barro)
  const b = makeCanvas(W, H), bctx = b.getContext('2d');
  bctx.fillStyle = '#8c8c8c'; bctx.fillRect(0, 0, W, H);
  bctx.globalAlpha = 0.35; bctx.drawImage(blot, 0, 0, W, H); bctx.globalAlpha = 1;
  bctx.filter = 'blur(2.5px)';
  drawWrinkles(bctx, W, H, r2, { count: 24, color: 0x000000, alpha: 0.9, width: 9, breaks: 0.04, amp: 1.25, fold: true, highlight: true, hiAlpha: 0.45 });
  bctx.filter = 'blur(1px)';
  drawWrinkles(bctx, W, H, r2, { count: 30, color: 0x101010, alpha: 0.45, width: 2.6, breaks: 0.3, amp: 1.0 });
  bctx.filter = 'none';
  // esmaecimento radial nos polos: v→0 e v→1 (topo/fundo das esferas: a convergência das linhas
  // num polo viraria uma "estrela"); as dobras somem suavemente nos últimos 12 % de v
  const FADE = Math.round(H * 0.12);
  for (const [y0, y1] of [[0, FADE], [H, H - FADE]]) {
    let g = ctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, 'rgba(96,91,94,0.92)'); g.addColorStop(1, 'rgba(96,91,94,0)');
    ctx.fillStyle = g; ctx.fillRect(0, Math.min(y0, y1), W, FADE);
    g = bctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, 'rgba(140,140,140,0.95)'); g.addColorStop(1, 'rgba(140,140,140,0)');
    bctx.fillStyle = g; bctx.fillRect(0, Math.min(y0, y1), W, FADE);
  }
  return { map: canvasTexture(c), bump: canvasTexture(b, false) };
}

const TRUNK_FABRIC_END = 0.76; // fração do comprimento da tromba coberta pelo tecido listrado
function makeTrunkTextures() {
  const W = 512, H = 1024;
  const c = makeCanvas(W, H), ctx = c.getContext('2d');
  const b = makeCanvas(W, H), bctx = b.getContext('2d');
  const ySplit = Math.round((1 - TRUNK_FABRIC_END) * H); // acima = ponta de pele (v alto), abaixo = tecido
  // --- ponta de pele ---
  ctx.fillStyle = '#6c6567'; ctx.fillRect(0, 0, W, ySplit);
  const blot = noiseCanvas(128, 17, 3, 4, 150, 255);
  ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.45; ctx.drawImage(blot, 0, 0, W, ySplit);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  bctx.fillStyle = '#8c8c8c'; bctx.fillRect(0, 0, W, H);
  const r1 = createRng(SEED + 9), r2 = createRng(SEED + 9);
  // dobras horizontais grandes na ponta de pele (anéis da tromba)
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, ySplit); ctx.clip();
  drawWrinkles(ctx, W, ySplit, r1, { count: 9, color: 0x2c272c, alpha: 0.45, width: 6, highlight: true, breaks: 0.06, amp: 0.5, fold: true, hiAlpha: 0.075 });
  ctx.restore();
  bctx.save(); bctx.beginPath(); bctx.rect(0, 0, W, ySplit); bctx.clip(); bctx.filter = 'blur(2px)';
  drawWrinkles(bctx, W, ySplit, r2, { count: 9, color: 0x000000, alpha: 0.95, width: 7, breaks: 0.06, amp: 0.5, fold: true, highlight: true, hiAlpha: 0.5 });
  bctx.filter = 'none'; bctx.restore();
  // --- tecido em faixas: laranja / castanho / creme / rosa empoeirado (tons quentes e abafados) ---
  const palette = [COLORS.cloth, COLORS.cream, 0xb8703e, 0xc98a92, COLORS.cloth, COLORS.clothDark, COLORS.cream, 0xc27a4a, 0xbf8f6a, 0xa65a4e, COLORS.cream, COLORS.cloth];
  const rng = createRng(SEED + 12);
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
  ctx.fillStyle = '#4b4244'; ctx.fillRect(0, 0, S, 256);
  const thin = [0xb8703e, COLORS.cloth, 0x8a5a48, 0xc98a92];
  for (let i = 0; i < 11; i++) {
    const y = 10 + i * 23, ph = rng() * TAU, kk = rng.int(2, 4), amp = 4 + rng() * 4;
    ctx.strokeStyle = rgba(thin[i % thin.length], 0.28 + rng() * 0.12); ctx.lineWidth = 2 + rng() * 2.5; ctx.beginPath();
    for (let x = 0; x <= S; x += 8) { const yy = y + amp * Math.sin(TAU * kk * x / S + ph); if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy); }
    ctx.stroke();
    bctx.strokeStyle = 'rgba(0,0,0,0.35)'; bctx.lineWidth = 3; bctx.beginPath();
    for (let x = 0; x <= S; x += 8) { const yy = y + amp * Math.sin(TAU * kk * x / S + ph); if (x === 0) bctx.moveTo(x, yy); else bctx.lineTo(x, yy); }
    bctx.stroke();
  }
  ctx.fillStyle = hex(COLORS.cloth); ctx.fillRect(0, 256, S, 256);
  // 5 listras (creme / rosa empoeirado / creme / castanho / creme) sobre o laranja, bordas onduladas
  const stripes = [[COLORS.cream, 270, 26], [0xc98a92, 318, 22], [COLORS.cream, 362, 30], [COLORS.clothDark, 412, 20], [COLORS.cream, 452, 30]];
  for (const [col, y, h] of stripes) {
    const ph = rng() * TAU, kk = rng.int(3, 6), amp = 4 + rng() * 4;
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

let shared = null;
function getShared() {
  if (shared) return shared;
  const skin = makeSkinTextures(), trunk = makeTrunkTextures(), cloth = makeClothTextures();
  const city = makeCityAtlas(), tassel = makeTasselTexture(), eye = makeEyeTexture(), pom = makePompomTextures();
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
function tubeGeometry(curve, segs, radial, radiusAt, { capStart = false, capEnd = true } = {}) {
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = [], nor = [], uv = [], idx = [];
  const P = new V3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs; curve.getPointAt(t, P); const r = radiusAt(t);
    const N = frames.normals[i], Bn = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU, cx = Math.cos(a), sx = Math.sin(a);
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
function bodyPoint(d, out) {
  const nx = d.x, ny = d.y, nz = d.z;
  let x = nx * B.rx * BODY_SX, y = ny * B.ry, z = nz * B.rz;
  if (ny < 0) {
    const belly = Math.pow(-ny, 1.6) * (1 - Math.min(1, Math.abs(nx) * 1.15) ** 2);
    y -= 55 * belly; z *= 1 + 0.07 * belly;
  }
  y += backBump(nx, ny);
  const amp = 14 * (1 - smooth(0.25, 0.65, ny));
  const n = noise.fbm3(nx * 2.3 + 5, ny * 2.3, nz * 2.3, 3);
  return out.set(x, B.cy + y, z).addScaledVector(d, amp * n);
}
// Ponto da pele da cabeça para uma direção unitária d (centro em HD).
function headPoint(d, out) {
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
  return out.set(HD.cx + x, HD.cy + y, z).addScaledVector(d, n);
}
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
  headPoint(d, out); out.addScaledVector(d, lift);
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
    const g = new THREE.SphereGeometry(1, low ? 56 : 72, low ? 36 : 46);
    g.rotateY(Math.PI);
    // uv: u ao redor do corpo (2,5 ladrilhos), v do polo de baixo ao de cima (1 ladrilho: 24 dobras)
    { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, u * 2.5, v); } }   // + inclinação: dobras diagonais nos flancos
    mapVertices(g, (v) => { tmp.copy(v).normalize(); bodyPoint(tmp, v); });
    add('skin', g);
  }
  // pescoço (une corpo e cabeça)
  {
    const g = new THREE.SphereGeometry(1, 40, 28);
    mapVertices(g, (v) => { tmp.copy(v); const n = noise.fbm3(tmp.x * 2 + 3, tmp.y * 2, tmp.z * 2, 3) * 8; v.set(tmp.x * 300 + 580, tmp.y * 345 + 1110, tmp.z * 345).addScaledVector(tmp, n); });
    scaleUV(g, 2, 0.62, 0, 0.14);
    add('skin', g);
  }
  // ============================ CABEÇA =============================
  {
    const g = new THREE.SphereGeometry(1, low ? 48 : 58, low ? 32 : 40);
    mapVertices(g, (v) => { tmp.copy(v).normalize(); headPoint(tmp, v); });
    scaleUV(g, 1.6, 0.74, 0, 0.1);   // dobras horizontais pela bochecha; o polo de baixo (queixo) esmaece
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
    placeGeom(g, headPoint(d, tmp).addScaledVector(d, -EM.EYE_SINK), q);
    add('eye', g);
    // anel de pele escura (pálpebras) rente à pele, mapeado no canto escuro da textura do olho
    const ring = new THREE.TorusGeometry(EM.EYE_RADIUS + 3, 9, 8, 24);
    placeGeom(ring, headPoint(d, tmp).addScaledVector(d, -4), new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, 1), d));
    remapUV(ring, [0.01, 0.05, 0.01, 0.05]);
    add('eye', ring);
    // pálpebra superior: dobra de pele por cima (meia-casca), ligeiramente acima do globo
    const lid = new THREE.SphereGeometry(EM.EYE_RADIUS + 6, 14, 8, 0, TAU, 0, Math.PI * 0.27);
    placeGeom(lid, headPoint(d, tmp).addScaledVector(d, -9), quatFromUp(new V3(0.0, 0.92, side * 0.38).normalize()));
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
  const legPts = legProfile.map(([r, y]) => new THREE.Vector2(r, y));
  const legR = (y) => { // raio do perfil na altura y (interpolação linear)
    for (let i = 1; i < legProfile.length; i++) { const [r0, y0] = legProfile[i - 1], [r1, y1] = legProfile[i]; if (y <= y1) return lerp(r0, r1, (y - y0) / (y1 - y0)); }
    return 0;
  };
  const legIdx = { '1,-1': BONE.legFL, '1,1': BONE.legFR, '-1,-1': BONE.legBL, '-1,1': BONE.legBR };
  for (const sx of [1, -1]) for (const sz of [-1, 1]) {
    const bone = legIdx[sx + ',' + sz];
    const cx = sx * LG.offsetX, cz = sz * LG.offsetZ;
    const g = new THREE.LatheGeometry(legPts, low ? 24 : 32);
    // deformação da pata (também aplicada à faixa do tornozelo, para ela seguir a pele)
    const legDeform = (v, lift = 0) => {
      // ruído RADIAL (sem descontinuidade nos planos x=0 / z=0, que criava uma "costura" vertical)
      const rl = Math.hypot(v.x, v.z);
      const n = noise.fbm3(v.x / 220 + cx, v.y / 220, v.z / 220 + cz, 2) * 6 + lift;
      if (rl > 1e-3) { v.x += (n * v.x) / rl; v.z += (n * v.z) / rl; }
      // leve dobra do joelho (frente: joelho à frente; trás: jarrete atrás) e coxa inclinada para dentro,
      // de modo que o topo da pata entre na barriga em vez de sair pelo flanco
      const k = smooth(560, 320, v.y) * (1 - smooth(140, -40, v.y));   // 1 na altura do joelho
      v.x += sx * 18 * k + sx * 10 * smooth(560, 900, v.y);
      v.z -= sz * EM.LEG_HIP_LEAN * smooth(600, 968, v.y);
      v.x += cx; v.z += cz;
    };
    mapVertices(g, (v) => legDeform(v));
    scaleUV(g, 2, 0.45, 0, 0.14);   // faixas de dobras largas e horizontais na coluna da pata (fora da zona esmaecida)
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
    // faixa listrada no tornozelo (segue o perfil: um pouco mais larga embaixo)
    const band = new THREE.CylinderGeometry(legR(187), legR(69), 118, 28, 1, true);
    band.translate(0, 128, 0);
    mapVertices(band, (v) => legDeform(v, 9));   // segue a pele, 9 m acima dela
    remapUV(band, [0, 1, 0.255, 0.495]);
    add('cloth', band, bone);
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
    const g = tubeGeometry(trunkCurve, low ? 48 : 72, low ? 16 : 22, trunkR);
    add('trunk', g, BONE.trunk);
    // anel de ouro prendendo a ponta do tecido
    const t0 = TRUNK_FABRIC_END - 0.01;
    const ring = new THREE.TorusGeometry(trunkR(t0) + 6, 11, 10, 28);
    const tan = trunkCurve.getTangentAt(t0);
    placeGeom(ring, trunkCurve.getPointAt(t0), new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, 1), tan));
    add('gold', ring, BONE.trunk);
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
      const ring = new THREE.TorusGeometry(r + 10, 13, 8, 24); placeGeom(ring, P, q); add('gold', ring);
      // contas nas duas bordas do anel
      const N = new V3().crossVectors(tan, _up).normalize(), Bn = new V3().crossVectors(tan, N);
      for (const off of [-17, 17]) for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU + (off > 0 ? Math.PI / 16 : 0); const bead = new THREE.SphereGeometry(7, 6, 3);
        placeGeom(bead, tmp.copy(P).addScaledVector(tan, off).addScaledVector(N, Math.cos(a) * (r + 18)).addScaledVector(Bn, Math.sin(a) * (r + 18)));
        add('gold', bead);
      }
    }
  }
  // ============================ ORELHAS =============================
  // Orelhas GIGANTES (tão altas quanto a cabeça, pendendo abaixo dela), quase retangulares, com a
  // borda de baixo pendendo reta; cobertas por um manto: borda LISTRADA laranja/creme concêntrica
  // ao contorno, tecido escuro dentro e um grande bloco retangular de casas em terraços (refs 1–3, 7).
  // Contorno em coordenadas locais da orelha: x<0 para trás, y<0 para baixo, z>0 lado de fora;
  // (0,0) = canto superior dianteiro (pivô na cabeça).
  const earOutline = [[0, 0], [-100, 70], [-300, 96], [-480, 82], [-575, 42], [-628, -60], [-650, -250], [-648, -480], [-630, -660], [-578, -762], [-470, -802], [-300, -810], [-150, -796], [-52, -742], [6, -620], [28, -440], [26, -260], [16, -110]];
  const esx = (EAR.width * EM.EAR_SCALE) / 665, esy = (EAR.height * EM.EAR_SCALE) / 810;
  const EAR_C = { x: -310 * esx, y: -360 * esy };
  const earShape = (scale = 1, cx = EAR_C.x, cy = EAR_C.y) => {
    const sh = new THREE.Shape();
    const pts = earOutline.map(([x, y]) => new THREE.Vector2(cx + (x * esx - cx) * scale, cy + (y * esy - cy) * scale));
    sh.moveTo(pts[0].x, pts[0].y); sh.splineThru(pts.slice(1).concat([pts[0]]));
    return sh;
  };
  const EAR_W = 665 * esx, EAR_H = 810 * esy;
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
  // deformação da orelha (ondulação suave: topo enrolando para fora, traseira abrindo, ponta de baixo fechando)
  const earWarp = (p) => {
    const topCurl = Math.max(0, (p.y + 190 * esy) / (280 * esy)); p.z += 95 * topCurl * topCurl;   // borda de cima enrola para fora
    const back = Math.min(1, -p.x / EAR_W); p.z += 80 * back * back;
    const low2 = Math.max(0, (-p.y - 380 * esy) / (420 * esy)); p.z += 56 * low2 * low2; // base abre para fora (afasta do ombro)
    p.z += noise.noise2(p.x / 260 + 7, p.y / 260) * 12;
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
  const RING_OUT = 0.985, RING_IN = 0.885;
  const corePoly = earShape(RING_IN - 0.02).extractPoints(8).shape;
  const HOUSE_RECT = { x0: -572 * esx, x1: -52 * esx, y0: -716 * esy, y1: -52 * esy };
  for (const side of [-1, 1]) {
    const bone = side < 0 ? BONE.earL : BONE.earR;
    const M = new THREE.Matrix4().compose(new V3(EAR_PIVOT.x, EAR_PIVOT.y, EAR_PIVOT.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.1, EM.EAR_YAW, -0.04, 'YXZ')), new V3(1, 1, 1));
    if (side < 0) M.premultiply(new THREE.Matrix4().makeScale(1, 1, -1));
    const finish = (g) => { g.applyMatrix4(M); if (side < 0) flipWinding(g); g.computeVertexNormals(); return g; };
    // aba de pele (grossa na raiz, fina na borda: bisel)
    let ear = new THREE.ExtrudeGeometry(earShape(1), { depth: 28, bevelEnabled: true, bevelThickness: 18, bevelSize: 18, bevelSegments: 3, curveSegments: low ? 5 : 8 });
    ear.translate(0, 0, 18); earUV(ear); ear = tessellate(ear, low ? 90 : 60); mapVertices(ear, earWarp);
    ear = mergeVertices(ear); ear.computeVertexNormals();
    add('skin', finish(ear), bone);
    // manto: miolo de tecido escuro + borda listrada (anel concêntrico), ambos no lado de fora
    const Z_BL = 67; // acima da face de fora da orelha (bisel chega a z≈64)
    let core = new THREE.ExtrudeGeometry(earShape(RING_IN + 0.01), { depth: 6, bevelEnabled: false, curveSegments: 6 });
    core.translate(0, 0, Z_BL); core = tessellate(core, low ? 100 : 80); coreUV(core);
    mapVertices(core, earWarp); core = mergeVertices(core); core.computeVertexNormals();
    add('cloth', finish(core), bone);
    const ringShape = earShape(RING_OUT); ringShape.holes.push(earShape(RING_IN));
    let ring = new THREE.ExtrudeGeometry(ringShape, { depth: 10, bevelEnabled: true, bevelThickness: 3, bevelSize: 3, bevelSegments: 1, curveSegments: 6 });
    ring.translate(0, 0, Z_BL - 2); ring = tessellate(ring, low ? 80 : 60); ringUV(ring, RING_OUT, RING_IN);
    mapVertices(ring, earWarp); ring = mergeVertices(ring); ring.computeVertexNormals();
    add('cloth', finish(ring), bone);
    // bloco RETANGULAR de casas em terraços sobre o manto: retalho cerrado e regular de casinhas
    // (fileiras × colunas, profundidades parecidas), com 1–2 recortes pequenos (refs. 2/3); fica uma
    // margem de tecido escuro + a borda listrada ao redor
    const hrng = createRng(SEED + 500 + index * 13 + side);
    const hg = [];
    const ROWS = EM.EAR_HOUSE_GRID.rows, COLS = EM.EAR_HOUSE_GRID.cols;
    const dy = (HOUSE_RECT.y1 - HOUSE_RECT.y0) / ROWS, dx = (HOUSE_RECT.x1 - HOUSE_RECT.x0) / COLS;
    const notches = [];
    const nN = 1 + (hrng() < 0.5 ? 1 : 0);
    for (let k = 0; k < nN; k++) {
      const c0 = hrng.int(1, COLS - 4), r0 = hrng.int(1, ROWS - 5), cw = hrng.int(2, 3), rh = hrng.int(2, 4);
      notches.push({ c0, c1: c0 + cw, r0, r1: r0 + rh });
    }
    const inNotch = (c, r) => notches.some((n) => c >= n.c0 && c < n.c1 && r >= n.r0 && r < n.r1);
    for (let row = 0; row < ROWS; row++) {
      const y = HOUSE_RECT.y0 + (row + 0.5) * dy;
      for (let col = 0; col < COLS; col++) {
        const x = HOUSE_RECT.x0 + (col + 0.5) * dx;
        if (!pointInPolygon(x + dx * 0.5, y + dy * 0.5, corePoly) || !pointInPolygon(x - dx * 0.5, y - dy * 0.5, corePoly) || !pointInPolygon(x + dx * 0.5, y - dy * 0.5, corePoly) || !pointInPolygon(x - dx * 0.5, y + dy * 0.5, corePoly)) continue;
        if (inNotch(col, row)) continue;
        if (hrng() < 0.01) continue;
        // profundidades parecidas (12–30 m), um pouco maiores nas fileiras de baixo (terraços)
        const h = EM.EAR_HOUSE_H.min + (EM.EAR_HOUSE_H.max - EM.EAR_HOUSE_H.min) * (0.3 * hrng() + 0.7 * (1 - row / ROWS) * hrng());
        const wall = hrng() < 0.85 ? hrng.pick(COLORS.houses) : hrng.pick([0xd9a593, 0xe7b39f, 0xf0d8c8]);
        const b = boxHouse(dx * 0.9, dy * 0.88, h, 'z', wall, wall, true, false, true);
        b.translate(x, y, Z_BL + 4 + h / 2);
        mapVertices(b, earWarp);
        hg.push(b);
      }
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
        const lf = j === 0 || j === NW + 2 ? -2 : lift;
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
    const fr = new THREE.CylinderGeometry(80, 62, 330, 28, 1, true); fr.translate(ax.x, domeY - 165, 0);
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
      const cyl = new THREE.CylinderGeometry(EM.POMPOM_RADIUS * 0.48, EM.POMPOM_RADIUS * 0.48, EM.POMPOM_RADIUS * 0.95, 12); placeGeom(cyl, mid, quatFromUp(b.pos.clone().sub(a.pos).normalize())); add('silver', cyl);
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
  // TAPETE FINO de milhares de casinhas pálidas (5–10 m de pé, 6–20 m de altura) cobrindo todo o
  // dorso e descendo em terraços pelos flancos (InstancedMesh ×2: lajes pálidas / telhados rosa);
  // palácio enorme com cúpula dourada, minaretes, torres rosa de telhado cônico e muro de tijolos
  // arcado atrás do centro; prédio de tijolos e praça de mercado no centro (ponto da entrega).
  const city = [];
  const goldCity = [];
  const carpet = { flat: [], tile: [] };   // instâncias do tapete: {m: Matrix4, c: cor}
  const rngCity = createRng(SEED + 9001 + index * 31);
  const RX = B.rx * BODY_SX;
  const surfAt = (x, z, out) => { // ponto da pele do dorso acima de (x,z) local e normal aproximada
    const nx = x / RX, nz = z / B.rz, q = nx * nx + nz * nz; if (q >= 1) return null;
    const ny = Math.sqrt(1 - q); tmp.set(nx, ny, nz); bodyPoint(tmp, out);
    tmp2.set(nx / RX, ny / B.ry, nz / B.rz).normalize(); return tmp2; // normal
  };
  const insideNeckOrHead = (p) => (((p.x - 580) / 320) ** 2 + ((p.y - 1110) / 365) ** 2 + (p.z / 365) ** 2 < 1) || (((p.x - HD.cx) / (HR * 1.02)) ** 2 + ((p.y - HD.cy) / (HR * 1.24)) ** 2 + (p.z / (HR * 0.97)) ** 2 < 1);
  const inPalace = (x, z) => Math.abs(x - PALACE_X) < PS.hx + 85 && Math.abs(z) < PS.hz + 80;
  const inBrick = (x, z) => Math.abs(x - BRICK.x) < BRICK.hx + 6 && Math.abs(z - BRICK.z) < BRICK.hz + 6;
  const inPlaza = (x, z) => x > PZ.x0 && x < PZ.x1 && Math.abs(z) < PZ.hz;
  const nearPlaza = (x, z) => x > PZ.x0 - 40 && x < PZ.x1 + 40 && Math.abs(z) < PZ.hz + 40;
  const PALE = [0xf8f4ec, 0xf4efe5, 0xf1e6d6, 0xf3dccd, 0xf0d0c0, 0xece2d2, 0xfaf6f0, 0xead9c8, 0xf6e9e2];
  {
    const spacing = low ? EM.CITY_SPACING_LOW : EM.CITY_SPACING_HIGH;
    const nrm = new V3(), qh = new THREE.Quaternion(), qy = new THREE.Quaternion(), dirv = new V3(), upMix = new V3();
    const dummy = new THREE.Object3D();
    let row = 0;
    for (let x = -RX * 0.97; x <= RX * 0.95; x += spacing, row++) {
      const nx = x / RX; const k = Math.sqrt(Math.max(0.03, 1 - nx * nx));
      const arcR = (k * (B.ry + B.rz)) / 2;      // raio aproximado da seção transversal
      const dphi = spacing / arcR;
      // ângulo máximo a partir do zênite: desce bem pelos flancos no meio, menos nas pontas
      const phiMax = EM.CITY_FLANK_ANGLE * (0.7 + 0.3 * smooth(0.1, 0.5, k));
      for (let phi = -phiMax + (row % 2 ? dphi / 2 : 0); phi <= phiMax; phi += dphi) {
        const p2 = phi + rngCity.range(-0.15, 0.15) * dphi, xx = x + rngCity.range(-0.15, 0.15) * spacing;
        const nx2 = xx / RX, k2 = Math.sqrt(Math.max(0.03, 1 - nx2 * nx2));
        dirv.set(nx2, Math.cos(p2) * k2, Math.sin(p2) * k2);
        bodyPoint(dirv, tmp3);
        nrm.set(dirv.x / RX, dirv.y / B.ry, dirv.z / B.rz).normalize();
        const lx = tmp3.x, lz = tmp3.z;
        if (insideNeckOrHead(tmp3)) continue;
        if (Math.abs(nx2 + 0.12) < 0.075 && Math.abs(p2) > 1.05) continue; // trama da barriga
        if (inPalace(lx, lz) || inBrick(lx, lz) || inPlaza(lx, lz)) continue;
        // ruas: curvas de ruído (duas escalas) + avenida central para a frente da praça
        const st = noise.noise2(lx / 230 + index * 3.1, lz / 230 + phi * 0.3);
        if (Math.abs(st) < 0.03) continue;
        const st2 = noise.noise2(lx / 95 + index * 1.7 + 40, lz / 95 - phi * 0.2);
        if (Math.abs(st2) < 0.018) continue;
        if (Math.abs(lz) < 12 && lx > PZ.x1) continue;
        // densidade quase total em cima, caindo um pouco nos flancos baixos
        const flank = Math.abs(phi) / phiMax;
        if (rngCity() > 1 - 0.12 * flank * flank * flank) continue;
        const edge = nearPlaza(lx, lz);
        const fl = smooth(0.8, 1.5, Math.abs(phi));
        const foot = rngCity.range(EM.HOUSE_FOOT.min, EM.HOUSE_FOOT.max) * (1 + 0.35 * fl);   // nos flancos, casas um pouco maiores: crosta contínua
        const w = foot * rngCity.range(0.85, 1.15), d = foot * rngCity.range(0.85, 1.15);
        let h = rngCity.range(EM.HOUSE_H.min, EM.HOUSE_H.max) * (1 - 0.25 * flank);
        if (edge) h = rngCity.range(44, 66);
        else if (rngCity() < EM.TALL_BLOCK_CHANCE) h *= 1.6;
        // nos flancos as casas inclinam um pouco para o "para cima" (terraços) e saem da pele em vez
        // de afundar (uma casa em pé num flanco quase vertical ficaria enterrada no corpo)
        upMix.copy(nrm).addScaledVector(_up, 0.45 * fl).normalize();
        qh.copy(quatFromUp(upMix)).multiply(qy.setFromAxisAngle(_up, rngCity.range(-0.25, 0.25)));
        if (edge) {   // prédios mais altos ao redor da praça: geometria mesclada (fachada de vários andares)
          const wall = rngCity.pick(COLORS.houses), roof = rngCity.pick(COLORS.roofs);
          const sink = 18; const b = boxHouse(w * 1.6, h + sink, d * 1.6, 'y', wall, roof, false, true, true);
          b.translate(0, (h - sink) / 2, 0); placeGeom(b, tmp3, qh); city.push(b);
          continue;
        }
        // tapete: instância (caixa unitária afundada 30% na pele)
        dummy.position.copy(tmp3).addScaledVector(nrm, -0.3 * h * (1 - fl) + 0.15 * h * fl); dummy.quaternion.copy(qh); dummy.scale.set(w, h, d); dummy.updateMatrix();
        const col = rngCity.pick(PALE);
        (rngCity() < EM.ROOF_TILE_CHANCE ? carpet.tile : carpet.flat).push({ m: dummy.matrix.clone(), c: col });
      }
    }
  }
  // --- o tapete transborda dos ombros para o pescoço (até a nuca / raiz das orelhas) ---
  {
    const spacing = (low ? EM.CITY_SPACING_LOW : EM.CITY_SPACING_HIGH) * 1.05;
    const dummy = new THREE.Object3D(), nrm = new V3(), qh = new THREE.Quaternion(), qy = new THREE.Quaternion(), upMix = new V3();
    const NC = { x: 580, y: 1110, rx: 300, ry: 345, rz: 345 };
    const dlat = spacing / NC.ry;
    for (let lat = Math.PI / 2 - dlat * 0.5, row = 0; lat > -0.15; lat -= dlat, row++) {
      const ring = NC.rz * Math.cos(lat); const n = Math.max(1, Math.round((TAU * ring) / spacing));
      for (let j = 0; j < n; j++) {
        const lon = ((j + (row % 2 ? 0.5 : 0)) / n) * TAU + rngCity.range(-0.1, 0.1) * (TAU / n);
        const la = lat + rngCity.range(-0.15, 0.15) * dlat;
        nrm.set(Math.cos(la) * Math.cos(lon), Math.sin(la), Math.cos(la) * Math.sin(lon));
        const nz = noise.fbm3(nrm.x * 2 + 3, nrm.y * 2, nrm.z * 2, 3) * 8;
        tmp3.set(NC.x + nrm.x * NC.rx, NC.y + nrm.y * NC.ry, nrm.z * NC.rz).addScaledVector(nrm, nz - 1);
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
        dummy.position.copy(tmp3).addScaledVector(upMix, -0.2 * h); dummy.quaternion.copy(qh); dummy.scale.set(w, h, d); dummy.updateMatrix();
        (rngCity() < EM.ROOF_TILE_CHANCE ? carpet.tile : carpet.flat).push({ m: dummy.matrix.clone(), c: rngCity.pick(PALE) });
      }
    }
  }
  // --- palácio (atrás do centro): bloco longo de arcadas brancas + andar recuado + tambor + cúpula
  //     dourada; 6 minaretes com varandas; 2 torres rosa de telhado cônico; muro de tijolos arcado ---
  {
    const px = PALACE_X; const yb = 1100; // base desce fundo (afunda no corpo; na garupa vira muralha arcada)
    const base = archBox(PS.hx * 2, PALACE_BASE_TOP - yb, PS.hz * 2, REG.PAL, 0xf4f1ea); base.translate(px, (PALACE_BASE_TOP + yb) / 2, 0); city.push(base);
    // soco de tijolos vermelhos com arcos ao redor da base
    const sock = archBox(PS.hx * 2 + 14, 80, PS.hz * 2 + 14, REG.BRK, 0xffffff, { rv: 0.25 }); sock.translate(px, 1330, 0); city.push(sock);
    // cornija + andar recuado
    const cornice = archBox(PS.hx * 2 + 16, 14, PS.hz * 2 + 16, REG.PLAIN, 0xe9e3d8); cornice.translate(px, PALACE_BASE_TOP + 6, 0); city.push(cornice);
    const tier = archBox(PS.hx * 1.3, PALACE_TIER_H, PS.hz * 1.3, REG.PAL, 0xf4f1ea, { rv: 0.25 }); tier.translate(px, PALACE_BASE_TOP + PALACE_TIER_H / 2, 0); city.push(tier);
    const drum = new THREE.CylinderGeometry(DOME_R + 8, DOME_R + 8, DRUM_H, 36, 1, false); remapUV(drum, REG.PAL, 0, Infinity, 1, 0.085); setColorRange(drum, 0xf4f1ea);
    drum.translate(px, PALACE_BASE_TOP + PALACE_TIER_H + DRUM_H / 2, 0); city.push(drum);
    const dome = new THREE.SphereGeometry(DOME_R, 36, 20, 0, TAU, 0, Math.PI / 2); dome.translate(px, DOME_CY, 0); goldCity.push(dome);
    const spire = new THREE.ConeGeometry(8, 60, 10); spire.translate(px, DOME_CY + DOME_R + 26, 0); goldCity.push(spire);
    const knob = new THREE.SphereGeometry(10, 8, 6); knob.translate(px, DOME_CY + DOME_R + 2, 0); goldCity.push(knob);
    // cúpulas menores nos cantos do bloco principal
    for (const [cx, cz] of [[-PS.hx + 60, -PS.hz + 50], [-PS.hx + 60, PS.hz - 50], [PS.hx - 60, -PS.hz + 50], [PS.hx - 60, PS.hz - 50]]) {
      const sd = new THREE.SphereGeometry(40, 16, 9, 0, TAU, 0, Math.PI / 2); sd.translate(px + cx, PALACE_BASE_TOP + 14, cz); goldCity.push(sd);
      const sdr = new THREE.CylinderGeometry(42, 42, 16, 16); remapUV(sdr, REG.PLAIN); setColorRange(sdr, 0xf4f1ea); sdr.translate(px + cx, PALACE_BASE_TOP + 12, cz); city.push(sdr);
    }
    // minaretes altos com varandas (4 cantos + 2 atrás)
    const minPos = [[px - PS.hx - 30, -PS.hz - 30], [px - PS.hx - 30, PS.hz + 30], [px + PS.hx + 30, -PS.hz - 30], [px + PS.hx + 30, PS.hz + 30], [px - 60, -PS.hz - 50], [px - 60, PS.hz + 50]];
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
    // muro LONGO de tijolos vermelhos com arcos à frente do palácio (entre o palácio e a praça)
    {
      const wx = px + PS.hx + 52; surfAt(wx, 0, tmp3); const wy0 = tmp3.y - 40, wh = 120;
      const wall = archBox(40, wh, PS.hz * 2 + 220, REG.BRK, 0xffffff, { rv: 0.3, topColor: 0xd9c7ab }); wall.translate(wx, wy0 + wh / 2, 0); city.push(wall);
      const crown = archBox(48, 10, PS.hz * 2 + 228, REG.PLAIN, 0xe9d9c4); crown.translate(wx, wy0 + wh + 4, 0); city.push(crown);
      // torres redondas ROSA de telhado cônico nas pontas do muro
      for (const tz of [-(PS.hz + 130), PS.hz + 130]) {
        const th = 300; const tw = new THREE.CylinderGeometry(34, 38, th, 14); remapUV(tw, REG.TOWER, 0, Infinity, 1, 0.99); setColorRange(tw, 0xf3ece3); tw.translate(wx, wy0 - 20 + th / 2, tz); city.push(tw);
        const balc = new THREE.CylinderGeometry(46, 36, 16, 14); remapUV(balc, REG.PLAIN); setColorRange(balc, 0xe8e2d6); balc.translate(wx, wy0 - 20 + th - 30, tz); city.push(balc);
        const roof = new THREE.ConeGeometry(44, 130, 14); remapUV(roof, REG.PLAIN); setColorRange(roof, 0xe8a0b4); roof.translate(wx, wy0 - 20 + th + 65, tz); city.push(roof);
        const tip = new THREE.SphereGeometry(6, 8, 6); tip.translate(wx, wy0 - 20 + th + 130, tz); goldCity.push(tip);
      }
    }
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
      const t = new THREE.ConeGeometry(trng.range(5, 8), 6, trng() < 0.5 ? 4 : 8); t.rotateY(Math.PI / 4); setColorRange(t, trng.pick(COLORS.pompoms)); remapUV(t, REG.PLAIN);
      t.translate(PZ.x0 + 20 + trng() * (PZ.x1 - PZ.x0 - 40), top + 5, -PZ.hz + 16 + trng() * (PZ.hz * 2 - 32)); city.push(t);
    }
    // fonte no centro da praça
    const fb = new THREE.CylinderGeometry(12, 13, 4, 12); remapUV(fb, REG.PLAIN); setColorRange(fb, 0xd9d0bd); fb.translate((PZ.x0 + PZ.x1) / 2, top + 2, 0); city.push(fb);
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
  // torres e pequenas mesquitas espalhadas pelo tapete de casas
  for (let i = 0; i < 24; i++) {
    const x = rngCity.range(-RX * 0.85, RX * 0.85), z = rngCity.range(-B.rz * 0.75, B.rz * 0.75);
    if (inPalace(x, z) || inBrick(x, z) || nearPlaza(x, z)) continue;
    const n = surfAt(x, z, tmp3); if (!n || n.y < 0.82 || insideNeckOrHead(tmp3)) continue;
    if (i % 3 === 0) { // mesquita pequena: tambor + cúpula + minarete
      const dr = rngCity.range(26, 40); const drum = new THREE.CylinderGeometry(dr, dr, 56, 16); remapUV(drum, REG.PAL, 0, Infinity, 1, 0.3); setColorRange(drum, 0xf6f1e8); drum.translate(0, 20, 0); placeGeom(drum, tmp3, quatFromUp(n)); city.push(drum);
      const dome = new THREE.SphereGeometry(dr, 14, 8, 0, TAU, 0, Math.PI / 2); dome.translate(0, 48, 0); placeGeom(dome, tmp3, quatFromUp(n)); goldCity.push(dome);
      slimTower(tmp3.clone().addScaledVector(n, -4).add(new V3(dr + 14, 0, 0)), n.clone(), 120 + rngCity.range(0, 60), 0xf6f3ec, true, 7);
    } else slimTower(tmp3.clone().addScaledVector(n, -4), n.clone(), 90 + rngCity.range(0, 90), rngCity.pick([0xf6f3ec, 0xf1c9b1, 0xeadbc6]), rngCity() < 0.6, 7);
  }
  // --- cidades das presas: TODA a metade de cima de cada presa coberta de casinhas de telhado
  //     vermelho (ref. 6) + torres brancas; 3 anéis de ouro com contas por presa ---
  for (const [si, curve] of tuskCurves.entries()) {
    const rAt = (t) => (t < 0.06 ? lerp(92, 72, t / 0.06) : lerp(72, TK.tipRadius, (t - 0.06) / 0.91));
    const tan = new V3(), up = new V3(), sd = new V3(), P = new V3();
    const trng = createRng(SEED + 1200 + index * 7 + si);
    const span = EM.TUSK_HOUSE_SPAN;
    for (let t = 0.12; t < 0.955; t += EM.TUSK_HOUSE_STEP) {
      if (TUSK_RINGS.some((tr) => Math.abs(t - tr) < 0.028)) continue;
      curve.getPointAt(t, P); curve.getTangentAt(t, tan); surfaceUp(tan, up); sd.crossVectors(tan, up).normalize();
      const r = rAt(t); const nAcross = Math.max(2, Math.round((r * 2 * span) / 12));
      for (let k = 0; k < nAcross; k++) {
        const phi = ((k + 0.5) / nAcross) * 2 * span - span + trng.range(-0.04, 0.04);
        if (trng() < 0.06) continue;
        const nrm = tmp.copy(up).multiplyScalar(Math.cos(phi)).addScaledVector(sd, Math.sin(phi)).normalize();
        const w = trng.range(6.5, 9.5), d = trng.range(6.5, 9.5), h = trng.range(5, 13) * (trng() < 0.05 ? 1.8 : 1);
        const b = boxHouse(w, h + 4, d, 'y', trng.pick(PALE), trng.pick(COLORS.roofs), false, false, true);
        b.translate(0, (h - 4) / 2, 0); placeGeom(b, tmp2.copy(P).addScaledVector(nrm, r - 1), quatFromUp(nrm).multiply(new THREE.Quaternion().setFromAxisAngle(_up, Math.atan2(tan.z, tan.x))));
        city.push(b);
      }
    }
    for (const t of [0.17, 0.33, 0.42, 0.56, 0.66, 0.8, 0.88, 0.93]) {
      curve.getPointAt(t, P); curve.getTangentAt(t, tan); surfaceUp(tan, up);
      slimTower(tmp2.copy(P).addScaledVector(up, rAt(t) - 2), up.clone(), 50 + trng.range(0, 60), 0xf6f3ec, trng() < 0.6, 4.5);
    }
  }
  // --- torres no alto da cabeça (atrás da placa) ---
  for (const lon of [-0.62, -0.36, -0.12, 0.12, 0.36, 0.62]) {
    const d = headDir(1.28, lon, new V3()); headPoint(d, tmp);
    slimTower(tmp.clone().addScaledVector(d, -6), new V3(0, 1, 0), 80 + rngCity.range(0, 60), rngCity.pick([0xf6f3ec, 0xeadbc6]), rngCity() < 0.6);
  }
  // casinhas no topo da cabeça entre as torres
  for (let i = 0; i < (low ? 40 : 90); i++) {
    const d = headDir(rngCity.range(1.1, 1.44), rngCity.range(-0.8, 0.8), new V3()); headPoint(d, tmp);
    const w = rngCity.range(9, 17), dd = rngCity.range(9, 17), h = rngCity.range(10, 24);
    const b = boxHouse(w, h + 12, dd, 'y', rngCity.pick(COLORS.houses), rngCity.pick(COLORS.roofs)); b.translate(tmp.x, tmp.y + (h - 12) / 2, tmp.z); city.push(b);
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

  // ---- tapete de casas do dorso (2 InstancedMesh: lajes pálidas / telhados rosa-terracota) ----
  {
    const unitHouse = (roofReg) => {
      const g = new THREE.BoxGeometry(1, 1.3, 1); g.translate(0, 0.35, 0);   // base em y=−0.3 (afundada), topo em y=1
      const idx = Array.from(g.index.array); idx.splice(18, 6); g.setIndex(idx);   // sem a face de baixo
      setColorRange(g, 0xffffff);
      remapUV(g, REG.HOUSE, 0, 8); remapUV(g, REG.HOUSE, 16, 24); remapUV(g, roofReg, 8, 12); remapUV(g, REG.PLAIN, 12, 16);
      return g;
    };
    const col = new THREE.Color();
    for (const [key, reg] of [['flat', REG.PLAIN], ['tile', REG.ROOFT]]) {
      const list = carpet[key]; if (!list.length) continue;
      const inst = new THREE.InstancedMesh(unitHouse(reg), S.mat.city, list.length);
      list.forEach((it, i) => { inst.setMatrixAt(i, it.m); inst.setColorAt(i, col.set(it.c)); });
      inst.instanceMatrix.needsUpdate = true; if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.frustumCulled = true; rig.add(inst);
    }
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

  // ============================ ENTIDADE ===========================
  const state = { u: route.u0, position: new THREE.Vector3(), heading: 0 };
  const colLocal = [
    [-240, 1060, 0, 430], [0, 1075, 0, 445], [240, 1060, 0, 425], [-470, 1040, 0, 330],
    [HD.cx, HD.cy, 0, HR * 1.02], [580, 1100, 0, 340],
    [1100, 760, 0, 190], [1140, 420, 0, 115], [1240, 150, 0, 95],
    [1260, 720, -300, 85], [1620, 700, -400, 65], [1260, 720, 300, 85], [1620, 700, 300 + 100, 65],
    [300, 900, -480, 470], [300, 900, 480, 470],   // orelhas gigantes
  ];
  for (const sx of [1, -1]) for (const sz of [-1, 1]) { colLocal.push([sx * LG.offsetX, 250, sz * LG.offsetZ, 160], [sx * LG.offsetX, 600, sz * LG.offsetZ, 170]); }
  // Escala global: o modelo é construído nas dimensões-base e o grupo é ampliado por ELEPHANT.SCALE.
  const SCALE = E.SCALE || 1;
  group.scale.setScalar(SCALE);
  const colliders = colLocal.map((c) => ({ center: new THREE.Vector3(), local: new THREE.Vector3(c[0], c[1], c[2]), radius: c[3] * SCALE }));
  const B2 = { legFL: bones[BONE.legFL], legFR: bones[BONE.legFR], legBL: bones[BONE.legBL], legBR: bones[BONE.legBR], earL: bones[BONE.earL], earR: bones[BONE.earR], trunk: bones[BONE.trunk], tail: bones[BONE.tail] };
  const phaseOff = index * 1.7;

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
      // corpo + cidade
      const q = (px / RX) ** 2 + (pz / B.rz) ** 2;
      if (q < 1) {
        const ny = Math.sqrt(1 - q), nx = px / RX, nz = pz / B.rz;
        let h = B.cy + B.ry * ny + backBump(nx, ny);
        const nY = (ny / B.ry) / Math.hypot(nx / RX, ny / B.ry, nz / B.rz);
        if (inPlaza(px, pz)) h = Math.max(h, PLAZA_TOP);
        else if (inPalace(px, pz)) { h = Math.max(h, Math.abs(px - PALACE_X) < PS.hx * 0.65 && Math.abs(pz) < PS.hz * 0.65 ? PALACE_BASE_TOP + PALACE_TIER_H : Math.abs(px - PALACE_X) < PS.hx && Math.abs(pz) < PS.hz ? PALACE_BASE_TOP : h); const rr = Math.hypot(px - PALACE_X, pz); if (rr < DOME_R + 8) h = Math.max(h, DOME_CY + Math.sqrt(Math.max(0, DOME_R * DOME_R - rr * rr))); }
        else if (inBrick(px, pz)) h = Math.max(h, BRICK_TOP);
        else if (nY > 0.3) h += nearPlaza(px, pz) ? 60 : HOUSE_AVG;
        best = Math.max(best, h);
      }
      // cabeça (elipsoide) — topo
      const hr = HR; const dx = (px - HD.cx) / (hr * 0.98), dz = pz / (hr * 0.94); const qh = dx * dx + dz * dz;
      if (qh < 1) { const ny = Math.sqrt(1 - qh); best = Math.max(best, HD.cy + hr * 1.14 * ny + 50 * Math.max(0, dx) * ny + (ny > 0.4 ? 20 : 0)); }
      // pescoço
      const dnx = (px - 580) / 300, dnz = pz / 345; const qn = dnx * dnx + dnz * dnz;
      if (qn < 1) best = Math.max(best, 1110 + 345 * Math.sqrt(1 - qn) + HOUSE_AVG);
      return best === -Infinity ? null : (best + rig.position.y) * SCALE;
    },
    isOverCity(x, z) {
      const c = Math.cos(state.heading), sn = Math.sin(state.heading);
      const wx = x - state.position.x, wz = z - state.position.z;
      const px = c * wx - sn * wz, pz = sn * wx + c * wz;
      return (px / ent.cityFootprint.rx) ** 2 + (pz / ent.cityFootprint.rz) ** 2 < 1;
    },
  };
  group.updateMatrixWorld(true);
  ent.update(0, 0);
  return ent;
}
