// =====================================================================
//  RUPPEN — o elefante colossal (modelo final, derivado do candidato B).
//  Foco: anatomia inconfundível (barriga caída, cabeça abaulada, tromba e
//  presas afiladas, joelhos, unhas) + pele enrugada procedural (mapa de cor
//  + bump) + os adornos e a civilização das referências: orelhas GIGANTES
//  (≈ altura da cabeça) com manto laranja de borda listrada e um bloco de
//  casas em terraços; tapete denso de casas pastel (20–70 m) cobrindo o dorso
//  e descendo pelos flancos; palácio com cúpula dourada, minaretes e soco de
//  tijolos; prédio alto de tijolos com arcos; praça de mercado no centro
//  (ponto da entrega); cidades e torres nas presas; placa dourada com tachas,
//  guirlanda de pompons, borla rosa, anéis de ouro, faixas nos tornozelos.
//  Medidas extras em config.js → ELEPHANT_MODEL.
//
//  Estrutura: UM SkinnedMesh com 9 ossos (raiz, 4 patas, 2 orelhas,
//  tromba, cauda) e grupos de material (pele, tecido da tromba, panos,
//  marfim, ouro, cidade, borla, olhos, prata) + 2 InstancedMesh (tachas
//  e pompons). Tudo o que é rígido vai preso ao osso raiz; o que anima vai
//  preso ao osso da parte. Resultado: ~11 draw calls por elefante.
//
//  Espaço local: +X = frente, +Y = cima, +Z = lado direito; origem no
//  nível do mar entre as patas (ver config.js / ARCHITECTURE.md).
// =====================================================================
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { ELEPHANT, ELEPHANT_MODEL, COLORS, SEED } from '../config.js';
import { createRng, hashInt } from '../util/rng.js';
import { createNoise } from '../util/noise.js';

const E = ELEPHANT, B = E.BODY, LG = E.LEG, HD = E.HEAD, EAR = E.EAR, TR = E.TRUNK, TK = E.TUSK;
const TAU = Math.PI * 2;
const V3 = THREE.Vector3;
const noise = createNoise(SEED + 331);

// Alturas da cidade (locais a este modelo)
const EM = ELEPHANT_MODEL;
const HOUSE_AVG = 42;            // altura média das casas usada em getSurfaceHeight
const PALACE_X = EM.PALACE_X, PZ = EM.PLAZA;
const PALACE_BASE_TOP = 1650;    // topo do bloco principal do palácio
const DOME_R = 90, DOME_CY = 1748;   // cúpula dourada (topo ≈ SHOULDER_HEIGHT + CITY_MAX_HEIGHT)
const BRICK = { x: 60, z: -190, hx: 110, hz: 70 }, BRICK_TOP = 1690; // prédio de tijolos com arcos
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

// Linhas de rugas onduladas e horizontais, periódicas em x (emenda invisível no wrap).
function drawWrinkles(ctx, W, H, rng, { count, color, alpha, width, highlight = false, breaks = 0.15, amp = 1, y0 = 0 }) {
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const yc = y0 + (i + 0.25 + rng() * 0.5) * H / count;
    const k1 = rng.int(2, 5), k2 = rng.int(6, 13), k3 = rng.int(14, 28);
    const p1 = rng() * TAU, p2 = rng() * TAU, p3 = rng() * TAU;
    const a1 = (5 + rng() * 9) * amp, a2 = (2 + rng() * 4) * amp, a3 = (0.5 + rng() * 1.5) * amp;
    const lw = width * (0.6 + rng() * 0.8);
    const al = alpha * (0.7 + rng() * 0.3);
    const yf = (x) => yc + a1 * Math.sin(TAU * k1 * x / W + p1) + a2 * Math.sin(TAU * k2 * x / W + p2) + a3 * Math.sin(TAU * k3 * x / W + p3);
    const pass = (dy, style, w) => {
      ctx.lineWidth = w; ctx.strokeStyle = style; ctx.beginPath();
      let drawing = false;
      for (let x = 0; x <= W; x += 3) {
        const gap = noise.noise2(x / 70 + i * 11.3, i * 2.1) < -0.8 + breaks * 1.3;
        if (gap) { drawing = false; continue; }
        const y = yf(x) + dy;
        if (!drawing) { ctx.moveTo(x, y); drawing = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    pass(0, rgba(color, al), lw);
    if (highlight) pass(lw * 0.9, 'rgba(255,255,255,0.13)', lw * 0.6);
  }
}

// ------------------------------------------------------------------
//  texturas (compartilhadas entre todos os elefantes)
// ------------------------------------------------------------------
function makeSkinTextures() {
  const W = 1024, H = 1024;
  const c = makeCanvas(W, H), ctx = c.getContext('2d');
  // base um pouco mais clara que a cor nominal: as rugas e as manchas escurecem a média
  ctx.fillStyle = '#908c8e'; ctx.fillRect(0, 0, W, H);
  const blot = noiseCanvas(128, 17, 3, 4, 170, 255);
  ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.4; ctx.drawImage(blot, 0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
  // leve tom azulado nas sombras das dobras
  ctx.globalAlpha = 0.05; ctx.fillStyle = '#5c6a92'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
  // rugas: duas camadas (principais e finas) com o MESMO gerador para a cor e o bump
  const r1 = createRng(SEED + 5), r2 = createRng(SEED + 5);
  drawWrinkles(ctx, W, H, r1, { count: 110, color: 0x3f3d45, alpha: 0.55, width: 1.9, highlight: true, breaks: 0.12 });
  drawWrinkles(ctx, W, H, r1, { count: 90, color: 0x4a4850, alpha: 0.3, width: 1.1, breaks: 0.35 });
  // poros/granulado fino
  ctx.globalAlpha = 0.1; const grain = noiseCanvas(256, 23, 24, 2, 120, 255);
  ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(grain, 0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  // bump: cinza médio = altura neutra; sulcos escuros
  const b = makeCanvas(W, H), bctx = b.getContext('2d');
  bctx.fillStyle = '#8c8c8c'; bctx.fillRect(0, 0, W, H);
  bctx.globalAlpha = 0.3; bctx.drawImage(blot, 0, 0, W, H); bctx.globalAlpha = 1;
  bctx.filter = 'blur(1px)';
  drawWrinkles(bctx, W, H, r2, { count: 110, color: 0x000000, alpha: 0.9, width: 2.6, breaks: 0.12 });
  drawWrinkles(bctx, W, H, r2, { count: 90, color: 0x101010, alpha: 0.55, width: 1.5, breaks: 0.35 });
  bctx.filter = 'none';
  return { map: canvasTexture(c), bump: canvasTexture(b, false) };
}

const TRUNK_FABRIC_END = 0.76; // fração do comprimento da tromba coberta pelo tecido listrado
function makeTrunkTextures() {
  const W = 512, H = 1024;
  const c = makeCanvas(W, H), ctx = c.getContext('2d');
  const b = makeCanvas(W, H), bctx = b.getContext('2d');
  const ySplit = Math.round((1 - TRUNK_FABRIC_END) * H); // acima = ponta de pele (v alto), abaixo = tecido
  // --- ponta de pele ---
  ctx.fillStyle = '#8a888f'; ctx.fillRect(0, 0, W, ySplit);
  const blot = noiseCanvas(128, 17, 3, 4, 170, 255);
  ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.45; ctx.drawImage(blot, 0, 0, W, ySplit);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  bctx.fillStyle = '#8c8c8c'; bctx.fillRect(0, 0, W, H);
  const r1 = createRng(SEED + 9), r2 = createRng(SEED + 9);
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, ySplit); ctx.clip();
  drawWrinkles(ctx, W, ySplit, r1, { count: 36, color: 0x3f3d45, alpha: 0.55, width: 1.8, highlight: true, breaks: 0.1, amp: 0.6 });
  ctx.restore();
  bctx.save(); bctx.beginPath(); bctx.rect(0, 0, W, ySplit); bctx.clip(); bctx.filter = 'blur(1px)';
  drawWrinkles(bctx, W, ySplit, r2, { count: 36, color: 0x000000, alpha: 0.9, width: 2.6, breaks: 0.1, amp: 0.6 });
  bctx.filter = 'none'; bctx.restore();
  // --- tecido em faixas (laranja / creme / rosa / vinho) ---
  const palette = [COLORS.cloth, COLORS.cream, COLORS.cloth, 0xe07aa0, COLORS.cream, COLORS.clothDark, COLORS.cream, 0xc98a3a, COLORS.cream, 0xc9454a];
  const rng = createRng(SEED + 12);
  let y = ySplit; let k = 0;
  ctx.fillStyle = hex(COLORS.cloth); ctx.fillRect(0, ySplit, W, H - ySplit);
  while (y < H) {
    const h = 10 + rng() * 26;
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
  // --- manto (y 0..512): miolo (y 0..256, v 0.75..1) laranja com linhas finas onduladas;
  //     borda (y 256..512, v 0.5..0.75) com listras largas creme/rosa/vinho ---
  ctx.fillStyle = hex(COLORS.cloth); ctx.fillRect(0, 0, S, 512);
  const thin = [COLORS.cream, COLORS.clothDark, 0xf0b060, 0xe07aa0];
  for (let i = 0; i < 9; i++) {
    const y = 14 + i * 27, ph = rng() * TAU, kk = rng.int(2, 4), amp = 3 + rng() * 3;
    ctx.strokeStyle = rgba(thin[i % thin.length], 0.5); ctx.lineWidth = 2.5 + rng() * 2; ctx.beginPath();
    for (let x = 0; x <= S; x += 8) { const yy = y + amp * Math.sin(TAU * kk * x / S + ph); if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy); }
    ctx.stroke();
  }
  const stripes = [COLORS.cream, 0xe07aa0, COLORS.clothDark, COLORS.cream, 0xf0b060];
  for (let i = 0; i < 8; i++) {
    const y = 262 + i * 31, h = 7 + rng() * 6, ph = rng() * TAU, kk = rng.int(3, 6), amp = 5 + rng() * 5;
    ctx.fillStyle = hex(stripes[i % stripes.length]);
    ctx.beginPath();
    for (let x = 0; x <= S; x += 8) { const yy = y + amp * Math.sin(TAU * kk * x / S + ph); if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy); }
    for (let x = S; x >= 0; x -= 8) ctx.lineTo(x, y + h + amp * Math.sin(TAU * kk * x / S + ph));
    ctx.closePath(); ctx.fill();
    bctx.strokeStyle = 'rgba(0,0,0,0.5)'; bctx.lineWidth = 2; bctx.beginPath();
    for (let x = 0; x <= S; x += 8) { const yy = y + amp * Math.sin(TAU * kk * x / S + ph); if (x === 0) bctx.moveTo(x, yy); else bctx.lineTo(x, yy); }
    bctx.stroke();
  }
  // --- faixas de tornozelo (y 512..768): listras horizontais laranja/vermelho/creme ---
  const bands = [COLORS.cloth, 0xc0392b, COLORS.cream, COLORS.clothDark, COLORS.cream, 0xc0392b, COLORS.cloth, 0xf0c070, COLORS.cream, 0xc0392b];
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
  ROOF: [0.5 + INSET, 1 - INSET, 0 + INSET, 0.25 - INSET],
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
      if (frame) { ctx.fillStyle = frame; ctx.beginPath(); ctx.moveTo(cx - wwF / 2 - 2, topF + hhF + 2); ctx.lineTo(cx - wwF / 2 - 2, topF + wwF / 2); ctx.arc(cx, topF + wwF / 2, wwF / 2 + 2, Math.PI, 0); ctx.lineTo(cx + wwF / 2 + 2, topF + hhF + 2); ctx.closePath(); ctx.fill(); }
      ctx.fillStyle = win; ctx.beginPath(); ctx.moveTo(cx - wwF / 2, topF + hhF); ctx.lineTo(cx - wwF / 2, topF + wwF / 2); ctx.arc(cx, topF + wwF / 2, wwF / 2, Math.PI, 0); ctx.lineTo(cx + wwF / 2, topF + hhF); ctx.closePath(); ctx.fill();
    }
  }
}
function makeCityAtlas() {
  const S = 1024, c = makeCanvas(S, S), ctx = c.getContext('2d');
  ctx.fillStyle = '#f4f1ea'; ctx.fillRect(0, 0, S, S);
  // PAL: fileiras de janelas em arco (palácio branco)
  drawArchWindows(ctx, 0, 0, 512, 512, 18, 6, { wall: '#f3efe7', win: '#2c2e3c', frame: '#dcd6cb', ledge: '#d3cdc2', winW: 0.44, winH: 0.62 });
  ctx.fillStyle = 'rgba(0,0,0,0.06)'; for (let i = 1; i < 18; i++) ctx.fillRect(i * 512 / 18 - 1, 0, 2, 512);
  // BRK: tijolo vermelho com arcos creme
  ctx.fillStyle = '#a84b3b'; ctx.fillRect(512, 0, 512, 512);
  ctx.fillStyle = 'rgba(70,25,20,0.45)';
  for (let yy = 0; yy < 512; yy += 8) { ctx.fillRect(512, yy, 512, 1); const off = (yy / 8) % 2 ? 10 : 0; for (let xx = off; xx < 512; xx += 20) ctx.fillRect(512 + xx, yy, 1, 8); }
  drawArchWindows(ctx, 512, 0, 512, 512, 13, 5, { wall: 'rgba(0,0,0,0)', win: '#3a2624', frame: '#eadbc6', winW: 0.4, winH: 0.6 });
  // PLAIN: creme com leve ruído
  ctx.fillStyle = '#f5f2ec'; ctx.fillRect(0, 512, 256, 256);
  const grain = noiseCanvas(128, 51, 6, 3, 200, 255);
  ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.5; ctx.drawImage(grain, 0, 512, 256, 256); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  // TOWER: janelas estreitas
  drawArchWindows(ctx, 256, 512, 256, 256, 3, 6, { wall: '#f3efe7', win: '#2c2e3c', frame: '#d8d2c6', winW: 0.3, winH: 0.62 });
  // PAVE: calçamento
  ctx.fillStyle = '#d9d0bd'; ctx.fillRect(512, 512, 256, 256);
  const prng = createRng(SEED + 77);
  for (let yy = 512; yy < 768; yy += 32) for (let xx = 512; xx < 768; xx += 32) { ctx.fillStyle = `rgba(120,100,80,${0.08 + prng() * 0.18})`; ctx.fillRect(xx + 1, yy + 1, 30, 30); }
  // TALL: prédio de vários andares (3x5 janelas em arco), sem porta
  drawArchWindows(ctx, 768, 512, 256, 256, 3, 5, { wall: '#ffffff', win: '#33353f', frame: '#e3ddd2', winW: 0.34, winH: 0.56 });
  ctx.fillStyle = 'rgba(0,0,0,0.07)'; for (let r = 1; r < 5; r++) ctx.fillRect(768, 512 + r * 51.2 - 1, 256, 2);
  // HOUSE: parede branca com 3x2 janelas + porta
  drawArchWindows(ctx, 0, 768, 512, 256, 3, 2, { wall: '#ffffff', win: '#33353f', frame: '#e3ddd2', winW: 0.3, winH: 0.5, door: true });
  // ROOF: telhas (claras: a cor do vértice tinge)
  ctx.fillStyle = '#ffffff'; ctx.fillRect(512, 768, 512, 256);
  ctx.strokeStyle = '#b8aea2'; ctx.lineWidth = 2;
  for (let row = 0; row < 8; row++) { const yy = 768 + row * 32 + 16; const off = row % 2 ? 16 : 0; for (let xx = 512 + off; xx < 1024 + 32; xx += 32) { ctx.beginPath(); ctx.arc(xx, yy, 15, Math.PI, 0); ctx.stroke(); } }
  return canvasTexture(c);
}

function makeTasselTexture() {
  const W = 256, H = 512, c = makeCanvas(W, H), ctx = c.getContext('2d');
  // cúpula rosa com tachas douradas (metade de cima, v∈[0.5,1])
  ctx.fillStyle = '#e2639f'; ctx.fillRect(0, 0, W, 256);
  ctx.fillStyle = 'rgba(0,0,0,0.12)'; for (let yy = 0; yy < 256; yy += 24) ctx.fillRect(0, yy, W, 3);
  for (let row = 0; row < 3; row++) for (let i = 0; i < 10; i++) {
    const cx = (i + 0.5 + (row % 2) * 0.5) * W / 10, cy = 200 - row * 44;
    const g = ctx.createRadialGradient(cx - 2, cy - 2, 1, cx, cy, 8); g.addColorStop(0, '#ffe9a0'); g.addColorStop(1, '#9c6f1e');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 8, 0, TAU); ctx.fill();
  }
  // franja listrada vertical (metade de baixo, v∈[0,0.5])
  const cols = [0xe2639f, 0xd94f8f, 0xf08a2c, 0xf3e3c3, 0xc2185b, 0xe8a0c0];
  for (let x = 0; x < W; x += 6) { ctx.fillStyle = hex(cols[(x / 6) % cols.length]); ctx.fillRect(x, 256, 6, 256); }
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; for (let x = 0; x < W; x += 6) ctx.fillRect(x, 256, 1, 256);
  const grad = ctx.createLinearGradient(0, 256, 0, 512); grad.addColorStop(0, 'rgba(0,0,0,0.25)'); grad.addColorStop(0.3, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.15)');
  ctx.fillStyle = grad; ctx.fillRect(0, 256, W, 256);
  return canvasTexture(c);
}

function makeEyeTexture() {
  const S = 128, c = makeCanvas(S, S), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 70); g.addColorStop(0, '#120e0b'); g.addColorStop(0.55, '#2a1d15'); g.addColorStop(1, '#3d3028');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.beginPath(); ctx.arc(64, 42, 9, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(78, 60, 4, 0, TAU); ctx.fill();
  return canvasTexture(c);
}

let shared = null;
function getShared() {
  if (shared) return shared;
  const skin = makeSkinTextures(), trunk = makeTrunkTextures(), cloth = makeClothTextures();
  const city = makeCityAtlas(), tassel = makeTasselTexture(), eye = makeEyeTexture();
  const mat = {
    skin: new THREE.MeshStandardMaterial({ map: skin.map, bumpMap: skin.bump, bumpScale: 4, roughness: 0.86, metalness: 0 }),
    trunk: new THREE.MeshStandardMaterial({ map: trunk.map, bumpMap: trunk.bump, bumpScale: 3.5, roughness: 0.88, metalness: 0 }),
    cloth: new THREE.MeshStandardMaterial({ map: cloth.map, bumpMap: cloth.bump, bumpScale: 2, roughness: 0.92, metalness: 0 }),
    ivory: new THREE.MeshStandardMaterial({ color: COLORS.ivory, roughness: 0.45, metalness: 0.05 }),
    // sem envMap no jogo: metalness moderado + emissivo quente para o ouro não ficar escuro
    gold: new THREE.MeshStandardMaterial({ color: COLORS.gold, metalness: 0.65, roughness: 0.36, emissive: COLORS.goldDark, emissiveIntensity: 0.22 }),
    city: new THREE.MeshStandardMaterial({ map: city, vertexColors: true, roughness: 0.8, metalness: 0 }),
    pink: new THREE.MeshStandardMaterial({ map: tassel, roughness: 0.9, metalness: 0 }),
    eye: new THREE.MeshStandardMaterial({ map: eye, roughness: 0.25, metalness: 0.1 }),
    silver: new THREE.MeshStandardMaterial({ color: 0xd9dee5, metalness: 0.6, roughness: 0.3, emissive: 0x2a3038, emissiveIntensity: 0.4 }),
    pompom: new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 }),
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
  return mapVertices(g, (v) => { const n = hashInt(Math.round(v.x * 7), Math.round(v.y * 7), Math.round(v.z * 7)); v.multiplyScalar(1 + amount * (n - 0.5)); });
}

// Casa em caixa: paredes com janelas (atlas HOUSE), telhado tingido (ROOF), base lisa.
// upAxis: 'y' (cidade do dorso/presas) ou 'z' (terraços das orelhas: o lado de fora da orelha é +z).
// facadeOut: a face de cima recebe a fachada com janelas (blocos das orelhas); tall: fachada de vários andares.
function boxHouse(w, h, d, upAxis, wallColor, roofColor, facadeOut = false, tall = false) {
  const g = new THREE.BoxGeometry(w, h, d);
  const sideReg = tall ? REG.TALL : REG.HOUSE;
  // ordem das faces na BoxGeometry: +x, -x, +y, -y, +z, -z (4 vértices cada)
  const faces = { px: [0, 4], nx: [4, 8], py: [8, 12], ny: [12, 16], pz: [16, 20], nz: [20, 24] };
  const roof = upAxis === 'y' ? faces.py : faces.pz, bottom = upAxis === 'y' ? faces.ny : faces.nz;
  setColorRange(g, wallColor);
  for (const k of Object.keys(faces)) {
    const f = faces[k];
    if (f === roof) { remapUV(g, facadeOut ? REG.TALL : REG.ROOF, f[0], f[1]); setColorRange(g, roofColor, f[0], f[1]); }
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
  if (nx < -0.4) { const q = (-nx - 0.4) / 0.6; y -= 25 * q * q * Math.max(0, ny); }
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
  const R = HD.radius;
  let x = d.x * R * 0.96, y = d.y * R * 1.16, z = d.z * R * 0.9;
  const f = Math.max(0, d.x) * Math.max(0, d.y); y += 34 * f; x += 12 * f;           // testa abaulada (domo)
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

// Placa dourada da testa: parametrização (s: 0 topo → 1 ponta na raiz da tromba; w: -1..1)
const PLATE = { latTop: 1.2, latBot: -0.66, maxHalf: 0.68 };
function plateHalfWidth(s) {
  if (s < 0.3) return PLATE.maxHalf * Math.sqrt(Math.max(0, 1 - ((0.3 - s) / 0.3) ** 2));
  return PLATE.maxHalf * Math.pow(Math.max(0, 1 - (s - 0.3) / 0.7), 0.62);
}
function platePoint(s, w, lift, out) {
  const lat = lerp(PLATE.latTop, PLATE.latBot, s), lon = w * plateHalfWidth(s);
  const d = headDir(lat, lon, new V3());
  headPoint(d, out); return out.addScaledVector(d, lift);
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
  const EAR_PIVOT = { x: 745, y: 1335, z: 228 };
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
    const g = new THREE.SphereGeometry(1, low ? 56 : 80, low ? 36 : 52);
    mapVertices(g, (v) => { tmp.copy(v).normalize(); bodyPoint(tmp, v); });
    scaleUV(g, 3, 1);
    add('skin', g);
  }
  // pescoço (une corpo e cabeça)
  {
    const g = new THREE.SphereGeometry(1, 40, 28);
    mapVertices(g, (v) => { tmp.copy(v); const n = noise.fbm3(tmp.x * 2 + 3, tmp.y * 2, tmp.z * 2, 3) * 8; v.set(tmp.x * 265 + 560, tmp.y * 300 + 1095, tmp.z * 300).addScaledVector(tmp, n); });
    scaleUV(g, 2, 0.7);
    add('skin', g);
  }
  // ============================ CABEÇA =============================
  {
    const g = new THREE.SphereGeometry(1, low ? 48 : 64, low ? 32 : 44);
    mapVertices(g, (v) => { tmp.copy(v).normalize(); headPoint(tmp, v); });
    scaleUV(g, 2, 0.8);
    add('skin', g);
  }
  // olhos
  for (const side of [-1, 1]) {
    const d = new V3(0.56, 0.1, side * 0.82).normalize();
    const g = new THREE.SphereGeometry(27, 16, 12);
    const q = new THREE.Quaternion().setFromAxisAngle(_up, -side * 0.65);
    placeGeom(g, headPoint(d, tmp).addScaledVector(d, -9), q);
    add('eye', g);
    // pálpebra: dobra de pele por cima (meia-casca)
    const lid = new THREE.SphereGeometry(33, 14, 8, 0, TAU, 0, Math.PI * 0.42);
    placeGeom(lid, headPoint(d, tmp).addScaledVector(d, -12), quatFromUp(new V3(0.2, 0.75, side * 0.55).normalize()));
    scaleUV(lid, 0.3, 0.1);
    add('skin', lid);
  }
  // ============================ PATAS ==============================
  const legProfile = [[0, -90], [138, -90], [157, -74], [156, -42], [147, 0], [140, 60], [137, 140], [137, 230], [139, 320], [144, 400], [149, 470], [150, 560], [158, 650], [172, 740], [190, 820], [205, 900], [215, 960], [0, 960]];
  const legPts = legProfile.map(([r, y]) => new THREE.Vector2(r, y));
  const legIdx = { '1,-1': BONE.legFL, '1,1': BONE.legFR, '-1,-1': BONE.legBL, '-1,1': BONE.legBR };
  for (const sx of [1, -1]) for (const sz of [-1, 1]) {
    const bone = legIdx[sx + ',' + sz];
    const cx = sx * LG.offsetX, cz = sz * LG.offsetZ;
    const g = new THREE.LatheGeometry(legPts, low ? 22 : 30);
    // leve dobra do joelho: parte de baixo da pata ligeiramente deslocada (frente: joelho à frente; trás: jarrete atrás)
    mapVertices(g, (v) => {
      const k = smooth(560, 320, v.y) * (1 - smooth(140, -40, v.y));   // 1 na altura do joelho
      v.x += sx * 18 * k + sx * 10 * smooth(560, 900, v.y);
      const n = noise.fbm3(v.x / 220 + cx, v.y / 220, v.z / 220 + cz, 2) * 6; v.x += n * (v.x > 0 ? 1 : -1) * 0.5; v.z += n * (v.z > 0 ? 1 : -1) * 0.5;
      v.x += cx; v.z += cz;
    });
    scaleUV(g, 1, 1);
    add('skin', g, bone);
    // unhas (frente da pata)
    for (const a of [-0.78, -0.26, 0.26, 0.78]) {
      const ux = sx * Math.cos(a), uz = Math.sin(a);  // frente da pata = +X (lado sx)
      const n = new THREE.SphereGeometry(1, 10, 7);
      n.scale(30, 24, 20);
      const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, 1), new V3(ux, 0, uz));
      placeGeom(n, new V3(cx + ux * 150, -12, cz + uz * 150), q);
      add('ivory', n, bone);
    }
    // faixa listrada no tornozelo
    const band = new THREE.CylinderGeometry(150, 153, 118, 28, 1, true);
    band.translate(cx, 128, cz);
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
  const trunkCurve = new THREE.CatmullRomCurve3([
    new V3(900, 1010, 0), new V3(1035, 925, 0), new V3(1105, 790, 0), new V3(1140, 640, 0), new V3(1145, 480, 0),
    new V3(1135, 320, 0), new V3(1145, 180, 0), new V3(1205, 90, 0), new V3(1310, 90, 0), new V3(1390, 160, 0), new V3(1400, 250, 0)]);
  trunkCurve.arcLengthDivisions = 400;
  const trunkR = (t) => {
    if (t < 0.1) return lerp(195, TR.baseRadius, t / 0.1);
    if (t < 0.965) return lerp(TR.baseRadius, TR.tipRadius, (t - 0.1) / 0.865);
    return TR.tipRadius * Math.sqrt(Math.max(0, 1 - ((t - 0.965) / 0.035) ** 2)) + 0.5;
  };
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
  for (const side of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3([
      new V3(940, 880, side * 115), new V3(1080, 800, side * 210), new V3(1240, 715, side * 300), new V3(1420, 665, side * 365),
      new V3(1590, 680, side * 405), new V3(1720, 770, side * 415), new V3(1790, 905, side * 400), new V3(1800, 1000, side * 380)]);
    curve.arcLengthDivisions = 300;
    tuskCurves.push(curve);
    const rAt = (t) => (t < 0.06 ? lerp(92, 72, t / 0.06) : t < 0.97 ? lerp(72, TK.tipRadius, (t - 0.06) / 0.91) : TK.tipRadius * Math.sqrt(Math.max(0, 1 - ((t - 0.97) / 0.03) ** 2)) + 0.5);
    const g = tubeGeometry(curve, low ? 36 : 54, low ? 12 : 16, rAt);
    add('ivory', g);
    // anéis de ouro com contas
    for (const t of [0.3, 0.62]) {
      const tan = curve.getTangentAt(t), P = curve.getPointAt(t), r = rAt(t);
      const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, 1), tan);
      const ring = new THREE.TorusGeometry(r + 9, 12, 10, 30); placeGeom(ring, P, q); add('gold', ring);
      const ring2 = new THREE.TorusGeometry(r + 9, 5, 8, 30); placeGeom(ring2, P.clone().addScaledVector(tan, 16), q); add('gold', ring2);
      const ring3 = new THREE.TorusGeometry(r + 9, 5, 8, 30); placeGeom(ring3, P.clone().addScaledVector(tan, -16), q); add('gold', ring3);
      const N = new V3().crossVectors(tan, _up).normalize(), Bn = new V3().crossVectors(tan, N);
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * TAU; const bead = new THREE.SphereGeometry(6.5, 6, 5);
        placeGeom(bead, tmp.copy(P).addScaledVector(N, Math.cos(a) * (r + 21)).addScaledVector(Bn, Math.sin(a) * (r + 21)));
        add('gold', bead);
      }
    }
  }
  // ============================ ORELHAS =============================
  // Orelhas gigantes (≈ altura da cabeça) penduradas ao lado da cabeça, cobertas por um manto
  // laranja com borda listrada e um grande bloco de casas em terraços (referências 1, 2, 3 e 7).
  // Contorno em coordenadas locais da orelha: x<0 para trás, y<0 para baixo, z>0 lado de fora;
  // (0,0) = canto superior dianteiro (pivô na cabeça).
  const earOutline = [[0, 0], [-80, 50], [-250, 80], [-420, 70], [-540, 20], [-610, -100], [-630, -280], [-615, -450], [-560, -590], [-440, -690], [-280, -730], [-130, -700], [-30, -600], [20, -440], [35, -260], [20, -110]];
  const esx = (EAR.width * EM.EAR_SCALE) / 665, esy = (EAR.height * EM.EAR_SCALE) / 810;
  const EAR_C = { x: -300 * esx, y: -320 * esy };
  const earShape = (scale = 1, cx = EAR_C.x, cy = EAR_C.y) => {
    const sh = new THREE.Shape();
    const pts = earOutline.map(([x, y]) => new THREE.Vector2(cx + (x * esx - cx) * scale, cy + (y * esy - cy) * scale));
    sh.moveTo(pts[0].x, pts[0].y); sh.splineThru(pts.slice(1).concat([pts[0]]));
    return sh;
  };
  const EAR_W = 665 * esx, EAR_H = 810 * esy;
  // deformação da orelha (ondulação suave: topo enrolando para fora, traseira abrindo, ponta de baixo fechando)
  const earWarp = (p) => {
    const topCurl = Math.max(0, (p.y + 170 * esy) / (250 * esy)); p.z += 70 * topCurl * topCurl;
    const back = Math.min(1, -p.x / EAR_W); p.z += 70 * back * back;
    const low2 = Math.max(0, (-p.y - 380 * esy) / (360 * esy)); p.z += 48 * low2 * low2; // base abre para fora (afasta do ombro)
    p.z += noise.noise2(p.x / 220 + 7, p.y / 220) * 9;
  };
  const earUV = (g) => {
    g.computeBoundingBox(); const bb = g.boundingBox; const p = g.attributes.position; const uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, ((p.getX(i) - bb.min.x) / (bb.max.x - bb.min.x)) * 0.7, ((p.getY(i) - bb.min.y) / (bb.max.y - bb.min.y)) * 0.8);
    return g;
  };
  // uv planar do manto: borda listrada (v 0.5..0.75) ou miolo liso (v 0.75..1)
  const blanketUV = (g, v0, v1, ru) => {
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, ((p.getX(i) + EAR_W) / EAR_W) * ru, v0 + (v1 - v0) * 0.98 * ((p.getY(i) + EAR_H) / (EAR_H + 90)));
  };
  const housePoly = earShape(0.78).extractPoints(8).shape;
  const HOUSE_RECT = { x0: -575 * esx, x1: -95 * esx, y0: -640 * esy, y1: -140 * esy };
  for (const side of [-1, 1]) {
    const bone = side < 0 ? BONE.earL : BONE.earR;
    const M = new THREE.Matrix4().compose(new V3(EAR_PIVOT.x, EAR_PIVOT.y, EAR_PIVOT.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.12, EM.EAR_YAW, -0.05, 'YXZ')), new V3(1, 1, 1));
    if (side < 0) M.premultiply(new THREE.Matrix4().makeScale(1, 1, -1));
    const finish = (g) => { g.applyMatrix4(M); if (side < 0) flipWinding(g); g.computeVertexNormals(); return g; };
    // aba de pele (grossa na raiz, fina na borda: bisel)
    let ear = new THREE.ExtrudeGeometry(earShape(1), { depth: 26, bevelEnabled: true, bevelThickness: 16, bevelSize: 16, bevelSegments: 3, curveSegments: low ? 5 : 8 });
    ear.translate(0, 0, 16); earUV(ear); ear = tessellate(ear, low ? 70 : 48); mapVertices(ear, earWarp);
    ear = mergeVertices(ear); ear.computeVertexNormals();
    add('skin', finish(ear), bone);
    // manto: miolo liso laranja + borda listrada (anel), ambos no lado de fora
    const Z_BL = 63; // acima da face de fora da orelha (bisel chega a z≈58)
    let core = new THREE.ExtrudeGeometry(earShape(0.84), { depth: 6, bevelEnabled: false, curveSegments: 6 });
    core.translate(0, 0, Z_BL); core = tessellate(core, low ? 70 : 48); blanketUV(core, 0.75, 1, 3);
    mapVertices(core, earWarp); core = mergeVertices(core); core.computeVertexNormals();
    add('cloth', finish(core), bone);
    const ringShape = earShape(0.93); ringShape.holes.push(earShape(0.83));
    let ring = new THREE.ExtrudeGeometry(ringShape, { depth: 9, bevelEnabled: true, bevelThickness: 3, bevelSize: 3, bevelSegments: 1, curveSegments: 6 });
    ring.translate(0, 0, Z_BL - 2); ring = tessellate(ring, low ? 70 : 48); blanketUV(ring, 0.5, 0.75, 1);
    mapVertices(ring, earWarp); ring = mergeVertices(ring); ring.computeVertexNormals();
    add('cloth', finish(ring), bone);
    // bloco de casas em terraços sobre o manto: fileiras de prédios pastel saindo da orelha
    const hrng = createRng(SEED + 500 + index * 13 + side);
    const hg = [];
    const dy = 28 * esy, dx = 31 * esx;
    for (let y = HOUSE_RECT.y0, row = 0; y < HOUSE_RECT.y1; y += dy, row++) {
      for (let x = HOUSE_RECT.x0 + (row % 2 ? dx / 2 : 0); x < HOUSE_RECT.x1; x += dx) {
        if (!pointInPolygon(x, y, housePoly) || !pointInPolygon(x + dx * 0.5, y + dy * 0.5, housePoly) || !pointInPolygon(x - dx * 0.5, y - dy * 0.5, housePoly)) continue;
        // o bloco tem recortes retangulares (como nas referências): ruído quantizado abre falhas
        const cut = noise.noise2(Math.floor(x / (dx * 3)) * 0.9 + side * 9 + index, Math.floor(y / (dy * 3)) * 0.9);
        if (cut < -0.55) continue;
        if (hrng() < 0.06) continue;
        // mais fundo no centro do bloco
        const cxr = (x - (HOUSE_RECT.x0 + HOUSE_RECT.x1) / 2) / ((HOUSE_RECT.x1 - HOUSE_RECT.x0) / 2);
        const h = EM.EAR_HOUSE_H.min + (EM.EAR_HOUSE_H.max - EM.EAR_HOUSE_H.min) * hrng() * (1 - 0.35 * Math.abs(cxr));
        const wall = hrng.pick(COLORS.houses);
        const b = boxHouse(dx * 0.92, dy * 0.9, h, 'z', wall, wall, true);
        b.translate(x, y, Z_BL + 5 + h / 2);
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
    placeGeom(boss, tmp, quatFromUp(dn), new V3(78, 52, 78)); add('gold', boss);
    const bring = new THREE.TorusGeometry(84, 9, 10, 36); placeGeom(bring, platePoint(0.2, 0, lift + 2, tmp), new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, 1), dn)); add('gold', bring);
  }
  // ============================ BORLA ROSA =========================
  const tasselTop = platePoint(1, 0, 15, new V3());
  {
    const ax = new V3(1290, 0, 0); // eixo vertical da borla (à frente da tromba)
    const yTop = tasselTop.y - 20;
    // cordão dourado da ponta da placa até a borla
    const strap = new THREE.CylinderGeometry(7, 7, tasselTop.distanceTo(new V3(ax.x, yTop, 0)), 8);
    const mid = tasselTop.clone().add(new V3(ax.x, yTop, 0)).multiplyScalar(0.5);
    placeGeom(strap, mid, quatFromUp(new V3(ax.x, yTop, 0).sub(tasselTop).normalize())); add('gold', strap);
    // pompom vermelho no alto
    const pom = fuzzySphere(52, 14, 10, 0.12); pom.translate(ax.x, yTop - 40, 0); setColorRange(pom, 0xc9303a); parts.city; // (cor via vértice não se aplica ao material pompom; usamos ouro-rosa abaixo)
    add('pink', remapUV(pom, [0.02, 0.98, 0.52, 0.98]));
    // sino dourado (cone) abaixo do pompom
    const bell = new THREE.ConeGeometry(44, 95, 24); bell.rotateX(Math.PI); bell.translate(ax.x, yTop - 92 - 47, 0); add('gold', bell);
    // cúpula rosa com tachas
    const dome = new THREE.SphereGeometry(76, 24, 14, 0, TAU, 0, Math.PI / 2); dome.translate(ax.x, yTop - 92 - 95 - 20, 0);
    remapUV(dome, [0, 1, 0.52, 0.98]); add('pink', dome);
    const domeY = yTop - 92 - 95 - 20;
    const rim = new THREE.TorusGeometry(76, 6, 8, 32); rim.rotateX(Math.PI / 2); rim.translate(ax.x, domeY, 0); add('gold', rim);
    for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; const s = new THREE.SphereGeometry(8, 7, 5); s.translate(ax.x + Math.cos(a) * 76, domeY - 10, Math.sin(a) * 76); add('gold', s); }
    // franja
    const fr = new THREE.CylinderGeometry(72, 58, 240, 28, 1, true); fr.translate(ax.x, domeY - 120, 0);
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
    let acc = 0; const spacing = 66; let next = 30;
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
      const mid = a.pos.clone().lerp(b.pos, 0.5); const dn = mid.clone().sub(new V3(HD.cx, HD.cy, 0)).normalize(); mid.addScaledVector(dn, 26);
      const cyl = new THREE.CylinderGeometry(20, 20, 20, 12); placeGeom(cyl, mid, quatFromUp(b.pos.clone().sub(a.pos).normalize())); add('silver', cyl);
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
  // Tapete denso de casas pastel (20–70 m) cobrindo todo o dorso e descendo em terraços pelos
  // flancos; palácio com cúpula dourada e minaretes atrás do centro; prédio de tijolos com arcos
  // e praça de mercado no centro (ponto da entrega). Tudo mesclado em UM grupo de material.
  const city = [];
  const goldCity = [];
  const rngCity = createRng(SEED + 9001 + index * 31);
  const RX = B.rx * BODY_SX;
  const surfAt = (x, z, out) => { // ponto da pele do dorso acima de (x,z) local e normal aproximada
    const nx = x / RX, nz = z / B.rz, q = nx * nx + nz * nz; if (q >= 1) return null;
    const ny = Math.sqrt(1 - q); tmp.set(nx, ny, nz); bodyPoint(tmp, out);
    tmp2.set(nx / RX, ny / B.ry, nz / B.rz).normalize(); return tmp2; // normal
  };
  const insideNeckOrHead = (p) => (((p.x - 560) / 285) ** 2 + ((p.y - 1095) / 320) ** 2 + (p.z / 320) ** 2 < 1) || (((p.x - HD.cx) / (HD.radius * 1.02)) ** 2 + ((p.y - HD.cy) / (HD.radius * 1.2)) ** 2 + (p.z / (HD.radius * 0.95)) ** 2 < 1);
  const inPalace = (x, z) => Math.abs(x - PALACE_X) < 225 && Math.abs(z) < 175;
  const inBrick = (x, z) => Math.abs(x - BRICK.x) < BRICK.hx + 6 && Math.abs(z - BRICK.z) < BRICK.hz + 6;
  const inPlaza = (x, z) => x > PZ.x0 && x < PZ.x1 && Math.abs(z) < PZ.hz;
  const nearPlaza = (x, z) => x > PZ.x0 - 40 && x < PZ.x1 + 40 && Math.abs(z) < PZ.hz + 40;
  {
    const spacing = low ? EM.CITY_SPACING_LOW : EM.CITY_SPACING_HIGH;
    const nrm = new V3(), qh = new THREE.Quaternion(), qy = new THREE.Quaternion(), dirv = new V3();
    let row = 0;
    for (let x = -RX * 0.96; x <= RX * 0.94; x += spacing, row++) {
      const nx = x / RX; const k = Math.sqrt(Math.max(0.03, 1 - nx * nx));
      const arcR = (k * (B.ry + B.rz)) / 2;      // raio aproximado da seção transversal
      const dphi = spacing / arcR;
      // ângulo máximo a partir do zênite: desce bem pelos flancos no meio, menos nas pontas
      const phiMax = EM.CITY_FLANK_ANGLE * (0.75 + 0.25 * smooth(0.1, 0.5, k));
      for (let phi = -phiMax + (row % 2 ? dphi / 2 : 0); phi <= phiMax; phi += dphi) {
        const p2 = phi + rngCity.range(-0.12, 0.12) * dphi, xx = x + rngCity.range(-0.12, 0.12) * spacing;
        const nx2 = xx / RX, k2 = Math.sqrt(Math.max(0.03, 1 - nx2 * nx2));
        dirv.set(nx2, Math.cos(p2) * k2, Math.sin(p2) * k2);
        bodyPoint(dirv, tmp3);
        nrm.set(dirv.x / RX, dirv.y / B.ry, dirv.z / B.rz).normalize();
        const lx = tmp3.x, lz = tmp3.z;
        if (insideNeckOrHead(tmp3)) continue;
        if (Math.abs(nx2 + 0.12) < 0.075 && Math.abs(p2) > 1.05) continue; // trama da barriga
        if (inPalace(lx, lz) || inBrick(lx, lz) || inPlaza(lx, lz)) continue;
        // ruas: curvas de ruído + avenida central para a frente da praça
        const st = noise.noise2(lx / 210 + index * 3.1, lz / 210 + phi * 0.3);
        if (Math.abs(st) < 0.05) continue;
        if (Math.abs(lz) < 14 && lx > PZ.x1) continue;
        // densidade quase total em cima, caindo um pouco nos flancos baixos
        const flank = Math.abs(phi) / phiMax;
        if (rngCity() > 1 - 0.35 * flank * flank) continue;
        const edge = nearPlaza(lx, lz);
        const foot = rngCity.range(EM.HOUSE_FOOT.min, EM.HOUSE_FOOT.max);
        const w = foot * rngCity.range(0.85, 1.15), d = foot * rngCity.range(0.85, 1.15);
        let h = rngCity.range(EM.HOUSE_H.min, EM.HOUSE_H.max) * (1 - 0.3 * flank);
        if (edge) h = rngCity.range(48, 72);
        else if (rngCity() < EM.TALL_BLOCK_CHANCE) h *= 1.6;
        const wall = rngCity.pick(COLORS.houses), roof = rngCity() < 0.45 ? rngCity.pick(COLORS.roofs) : rngCity.pick(COLORS.houses);
        const pitched = !edge && rngCity() < 0.3;
        nrm.copy(nrm); qh.copy(quatFromUp(nrm)).multiply(qy.setFromAxisAngle(_up, rngCity.range(-0.2, 0.2)));
        const sink = 18;
        const b = boxHouse(w, h + sink, d, 'y', wall, pitched ? wall : roof, false, h > 34);
        b.translate(0, (h - sink) / 2, 0); placeGeom(b, tmp3, qh); city.push(b);
        if (pitched) { const r = roofWedge(w + 2, d + 2, rngCity.range(6, 14), roof); r.translate(0, h - 0.5, 0); placeGeom(r, tmp3, qh); city.push(r); }
        else if (h > 50 && rngCity() < 0.14) { // cúpula dourada ou branca sobre prédios altos
          const dr = Math.min(w, d) * 0.3; const dome = new THREE.SphereGeometry(dr, 10, 6, 0, TAU, 0, Math.PI / 2); dome.translate(0, h - 1, 0); placeGeom(dome, tmp3, qh);
          if (rngCity() < 0.6) goldCity.push(dome); else { remapUV(dome, REG.PLAIN); setColorRange(dome, 0xf8f4ec); city.push(dome); }
        }
      }
    }
  }
  // --- palácio (atrás do centro) ---
  {
    const px = PALACE_X; const yb = 1300; // base afunda no corpo
    const base = archBox(440, PALACE_BASE_TOP - yb, 320, REG.PAL, 0xf4f1ea); base.translate(px, (PALACE_BASE_TOP + yb) / 2, 0); city.push(base);
    // soco de tijolos vermelhos com arcos ao redor da base
    const sock = archBox(452, 70, 332, REG.BRK, 0xffffff, { rv: 0.4 }); sock.translate(px, yb + 190, 0); city.push(sock);
    const tier = archBox(280, 65, 210, REG.PAL, 0xf4f1ea, { rv: 0.34 }); tier.translate(px, PALACE_BASE_TOP + 32, 0); city.push(tier);
    const drum = new THREE.CylinderGeometry(DOME_R + 6, DOME_R + 6, 38, 32, 1, false); remapUV(drum, REG.PAL, 0, Infinity, 1, 0.17); setColorRange(drum, 0xf4f1ea);
    drum.translate(px, PALACE_BASE_TOP + 65 + 19, 0); city.push(drum);
    const dome = new THREE.SphereGeometry(DOME_R, 32, 18, 0, TAU, 0, Math.PI / 2); dome.translate(px, DOME_CY, 0); goldCity.push(dome);
    const spire = new THREE.ConeGeometry(7, 44, 10); spire.translate(px, DOME_CY + DOME_R + 18, 0); goldCity.push(spire);
    const knob = new THREE.SphereGeometry(8, 8, 6); knob.translate(px, DOME_CY + DOME_R + 2, 0); goldCity.push(knob);
    // cúpulas menores nos cantos do bloco principal
    for (const [cx, cz] of [[-160, -110], [-160, 110], [160, -110], [160, 110]]) {
      const sd = new THREE.SphereGeometry(34, 16, 9, 0, TAU, 0, Math.PI / 2); sd.translate(px + cx, PALACE_BASE_TOP, cz); goldCity.push(sd);
      const sdr = new THREE.CylinderGeometry(36, 36, 16, 16); remapUV(sdr, REG.PLAIN); setColorRange(sdr, 0xf4f1ea); sdr.translate(px + cx, PALACE_BASE_TOP, cz); city.push(sdr);
    }
    // minaretes altos (4 cantos + 2 atrás)
    const minPos = [[px - 200, -150], [px - 200, 150], [px + 200, -150], [px + 200, 150], [px - 60, -185], [px - 60, 185]];
    for (let i = 0; i < minPos.length; i++) {
      const [mx, mz] = minPos[i]; const h = (i < 4 ? 400 : 330) + rngCity.range(-15, 15); const y0 = 1400;
      const shaft = new THREE.CylinderGeometry(12, 15, h, 12); remapUV(shaft, REG.PLAIN); setColorRange(shaft, 0xf6f3ec); shaft.translate(mx, y0 + h / 2, mz); city.push(shaft);
      for (const f of [0.6, 0.84]) { const balc = new THREE.CylinderGeometry(21, 16, 10, 12); remapUV(balc, REG.PLAIN); setColorRange(balc, 0xe8e2d6); balc.translate(mx, y0 + h * f, mz); city.push(balc); }
      const cap = new THREE.SphereGeometry(16, 12, 8, 0, TAU, 0, Math.PI / 2); cap.translate(mx, y0 + h, mz); goldCity.push(cap);
      const pin = new THREE.ConeGeometry(3.5, 30, 6); pin.translate(mx, y0 + h + 24, mz); goldCity.push(pin);
    }
    // torres quadradas com telhado piramidal (rosa e vinho) nos fundos
    const tcol = [0xe8a0b4, 0xb0563d];
    for (const [i, tz] of [[0, -60], [1, 60]]) {
      const tw = new THREE.BoxGeometry(50, 240, 50); setColorRange(tw, 0xf1ece3); remapUV(tw, REG.TOWER, 0, 8); remapUV(tw, REG.TOWER, 16, 24); remapUV(tw, REG.PLAIN, 8, 16);
      tw.translate(px - 265, 1350 + 120, tz); city.push(tw);
      const roof = new THREE.ConeGeometry(37, 80, 4); roof.rotateY(Math.PI / 4); remapUV(roof, REG.PLAIN); setColorRange(roof, tcol[i]); roof.translate(px - 265, 1350 + 240 + 40, tz); city.push(roof);
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
  for (let i = 0; i < 14; i++) {
    const x = rngCity.range(-RX * 0.8, RX * 0.8), z = rngCity.range(-B.rz * 0.7, B.rz * 0.7);
    if (inPalace(x, z) || inBrick(x, z) || nearPlaza(x, z)) continue;
    const n = surfAt(x, z, tmp3); if (!n || n.y < 0.5 || insideNeckOrHead(tmp3)) continue;
    if (i % 3 === 0) { // mesquita pequena: tambor + cúpula + minarete
      const dr = rngCity.range(26, 40); const drum = new THREE.CylinderGeometry(dr, dr, 56, 16); remapUV(drum, REG.PAL, 0, Infinity, 1, 0.3); setColorRange(drum, 0xf6f1e8); drum.translate(0, 20, 0); placeGeom(drum, tmp3, quatFromUp(n)); city.push(drum);
      const dome = new THREE.SphereGeometry(dr, 18, 10, 0, TAU, 0, Math.PI / 2); dome.translate(0, 48, 0); placeGeom(dome, tmp3, quatFromUp(n)); goldCity.push(dome);
      slimTower(tmp3.clone().addScaledVector(n, -4).add(new V3(dr + 14, 0, 0)), n.clone(), 120 + rngCity.range(0, 60), 0xf6f3ec, true, 7);
    } else slimTower(tmp3.clone().addScaledVector(n, -4), n.clone(), 90 + rngCity.range(0, 90), rngCity.pick([0xf6f3ec, 0xf1c9b1, 0xeadbc6]), rngCity() < 0.6, 7);
  }
  // --- cidades das presas: casas densas no dorso de cada presa + torres esguias ---
  for (const [si, curve] of tuskCurves.entries()) {
    const rAt = (t) => (t < 0.06 ? lerp(92, 72, t / 0.06) : lerp(72, TK.tipRadius, (t - 0.06) / 0.91));
    const tan = new V3(), up = new V3(), sd = new V3(), P = new V3();
    const trng = createRng(SEED + 1200 + index * 7 + si);
    for (let t = 0.15; t < 0.955; t += EM.TUSK_HOUSE_STEP) {
      if (Math.abs(t - 0.3) < 0.035 || Math.abs(t - 0.62) < 0.035) continue;
      curve.getPointAt(t, P); curve.getTangentAt(t, tan); surfaceUp(tan, up); sd.crossVectors(tan, up).normalize();
      const r = rAt(t); const nAcross = r > 56 ? 5 : r > 44 ? 4 : r > 30 ? 3 : 2;
      const span = Math.min(0.95, 36 / r * 1.1);
      for (let k = 0; k < nAcross; k++) {
        const phi = ((k / (nAcross - 1)) * 2 - 1) * span + trng.range(-0.06, 0.06);
        if (trng() < 0.08) continue;
        const nrm = tmp.copy(up).multiplyScalar(Math.cos(phi)).addScaledVector(sd, Math.sin(phi)).normalize();
        const w = trng.range(8, 13), d = trng.range(8, 13), h = trng.range(7, 18) * (trng() < 0.08 ? 1.7 : 1);
        const b = boxHouse(w, h + 5, d, 'y', trng.pick(COLORS.houses), trng.pick(COLORS.roofs));
        b.translate(0, (h - 5) / 2, 0); placeGeom(b, tmp2.copy(P).addScaledVector(nrm, r - 1.5), quatFromUp(nrm).multiply(new THREE.Quaternion().setFromAxisAngle(_up, Math.atan2(tan.z, tan.x))));
        city.push(b);
      }
    }
    for (const t of [0.19, 0.4, 0.5, 0.56, 0.72, 0.8, 0.9]) {
      curve.getPointAt(t, P); curve.getTangentAt(t, tan); surfaceUp(tan, up);
      slimTower(tmp2.copy(P).addScaledVector(up, rAt(t) - 2), up.clone(), 55 + trng.range(0, 60), trng.pick([0xf6f3ec, 0xf1c9b1, 0xeadbc6]), trng() < 0.7, 4.5);
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

  // ---- tachas da placa (instâncias) ----
  {
    const studGeo = new THREE.SphereGeometry(1, low ? 8 : 12, low ? 4 : 6, 0, TAU, 0, Math.PI / 2);
    const mats4 = []; const dummy = new THREE.Object3D();
    const rowsN = 19;
    for (let i = 1; i < rowsN; i++) {
      const s = i / rowsN; const L = platePoint(s, 1, 0, tmp).distanceTo(platePoint(s, -1, 0, tmp2));
      const n = Math.max(1, Math.floor(L / 44)); if (L < 40) continue;
      for (let j = 0; j < n; j++) {
        const w = n === 1 ? 0 : ((j + (i % 2 ? 0.5 : 0)) / (n - (i % 2 ? 0 : 1))) * 2 - 1;
        if (Math.abs(w) > 0.93) continue;
        // sem tachas em cima da bossa central
        if (Math.abs(s - 0.2) < 0.13 && Math.abs(w) < 0.22) continue;
        platePoint(s, w, 15, tmp); const dn = tmp.clone().sub(new V3(HD.cx, HD.cy, 0)).normalize();
        const r = (13 + 11 * (1 - Math.abs(w)) * Math.sin(Math.PI * Math.min(1, s * 1.1)));
        dummy.position.copy(tmp); dummy.quaternion.copy(quatFromUp(dn)); dummy.scale.set(r, r * 0.75, r); dummy.updateMatrix(); mats4.push(dummy.matrix.clone());
      }
    }
    const inst = new THREE.InstancedMesh(studGeo, S.mat.gold, mats4.length);
    mats4.forEach((m, i) => inst.setMatrixAt(i, m)); inst.instanceMatrix.needsUpdate = true;
    rig.add(inst);
  }
  // ---- pompons (instâncias com cor) ----
  {
    const pomGeo = fuzzySphere(1, low ? 9 : 13, low ? 6 : 9, 0.14);
    const inst = new THREE.InstancedMesh(pomGeo, S.mat.pompom, garland.length);
    const dummy = new THREE.Object3D(); const col = new THREE.Color();
    garland.forEach((gp, i) => {
      const dn = gp.pos.clone().sub(new V3(HD.cx, HD.cy, 0)).normalize();
      dummy.position.copy(gp.pos).addScaledVector(dn, 28); dummy.quaternion.copy(quatFromUp(gp.tangent)); dummy.scale.setScalar(33); dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix); inst.setColorAt(i, col.set(COLORS.pompoms[i % COLORS.pompoms.length]));
    });
    inst.instanceMatrix.needsUpdate = true; if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    rig.add(inst);
  }

  // ============================ ENTIDADE ===========================
  const state = { u: route.u0, position: new THREE.Vector3(), heading: 0 };
  const colLocal = [
    [-240, 1060, 0, 430], [0, 1075, 0, 445], [240, 1060, 0, 425], [-470, 1040, 0, 330],
    [HD.cx, HD.cy, 0, 345], [560, 1090, 0, 300],
    [1120, 700, 0, 135], [1140, 420, 0, 115], [1240, 150, 0, 95],
    [1260, 720, -300, 85], [1620, 700, -400, 65], [1260, 720, 300, 85], [1620, 700, 300 + 100, 65],
    [540, 1000, -450, 300], [540, 1000, 450, 300],
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
        else if (inPalace(px, pz)) { h = Math.max(h, Math.abs(px - PALACE_X) < 140 && Math.abs(pz) < 105 ? PALACE_BASE_TOP + 65 : PALACE_BASE_TOP); const rr = Math.hypot(px - PALACE_X, pz); if (rr < DOME_R) h = Math.max(h, DOME_CY + Math.sqrt(DOME_R * DOME_R - rr * rr)); }
        else if (inBrick(px, pz)) h = Math.max(h, BRICK_TOP);
        else if (nY > 0.3) h += nearPlaza(px, pz) ? 60 : HOUSE_AVG;
        best = Math.max(best, h);
      }
      // cabeça (elipsoide) — topo
      const hr = HD.radius; const dx = (px - HD.cx) / (hr * 0.98), dz = pz / (hr * 0.96); const qh = dx * dx + dz * dz;
      if (qh < 1) { const ny = Math.sqrt(1 - qh); best = Math.max(best, HD.cy + hr * 1.08 * ny + 30 * Math.max(0, dx) * ny + (ny > 0.4 ? 20 : 0)); }
      // pescoço
      const dnx = (px - 560) / 265, dnz = pz / 300; const qn = dnx * dnx + dnz * dnz;
      if (qn < 1) best = Math.max(best, 1095 + 300 * Math.sqrt(1 - qn));
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
