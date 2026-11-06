// =====================================================================
//  Ilhas — terreno realista, vegetação e pedras instanciadas e o campo da
//  costa (lido pelo oceano para a água rasa). Tudo procedural, estático e
//  determinístico (SEED).
//  Contrato (ARCHITECTURE.md 4.3):
//    createIslands(scene, worldData, { quality }) -> { group, islands, update(camera, time) }
//  Extra (usado por ocean.js):
//    getShoreField(worldData) -> { texture, islands: Vector4[] (cx, cz, R, rMax), U0, U1, rows, count }
//    islandRenderHeight(island, x, z) -> altura VISUAL (m) — a jogabilidade continua em island.heightAt
//    makeTileNoise(seed) -> ruído periódico (gradiente + células) para texturas tileáveis
//
//  Por ilha (5 draw calls, ≤ ~155k triângulos em quality=high):
//    1. TERRENO: malha adaptativa (quadtree restrita, folhas de ~4 m na linha d'água e nas cristas,
//       ~100 m nas planícies; ~60k tris) amostrando renderHeight = heightAt + ravinas de erosão
//       (ridged, só cavam) + falésias costeiras onde não há praia + plataforma submersa suave
//       (praias rasas → turquesa). Cor macro por vértice (como antes, vista de longe) + máscaras
//       de cobertura (areia, mata, rocha) que o shader (MeshStandardMaterial + onBeforeCompile)
//       usa para misturar texturas procedurais de detalhe: rocha TRIPLANAR com estratos, fendas e
//       líquen (+ normal), grama em tufos, dossel da mata visto de cima (+ normal), areia com grão
//       e marcas de ondulação (+ normal); duas escalas + ruído macro (sem repetição visível), e o
//       detalhe some com a distância na cor macro. Junto à água: areia molhada brilhante com a
//       borda da onda animada, renda de espuma, e o fundo submerso com absorção da água (Beer-
//       Lambert por canal) e cáusticas animadas — o oceano por cima fica translúcido no raso.
//    2. CONÍFERAS instanciadas (3 andares de galhos em estrela + ponta, textura de agulhas e normal);
//    3. FOLHOSAS + ARBUSTOS instanciados (copa em dois lóbulos, textura de tufos de folhas);
//    4. PEDRAS e matacões (icosaedro facetado com a textura de rocha triplanar);
//    5. AGULHAS DE ROCHA no mar (sea stacks) junto às falésias.
// =====================================================================
import * as THREE from 'three';
import { COLORS, SEED, ISLANDS, SUN_DIR } from '../config.js';
import { createRng } from '../util/rng.js';
import { createNoise } from '../util/noise.js';

// ------------------------------ utilidades ----------------------------
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

// Paleta (THREE.Color já converte sRGB -> linear; os atributos de cor usam linear)
const PAL = (() => {
  const c = (hex) => new THREE.Color(hex);
  const mix = (a, b, t) => c(a).lerp(c(b), t);
  return {
    sand: c(COLORS.sand),
    sandLight: mix(COLORS.sand, 0xfff7dd, 0.55),      // topo da praia (seca, mais clara)
    sandWet: c(COLORS.sandWet),                        // faixa molhada 0–1.5 m
    sandSub: mix(COLORS.sandWet, COLORS.sand, 0.45),   // areia submersa (a água por cima faz o turquesa)
    seabed: c(0x2f4f55),                               // saia profunda (nunca visível)
    seabedRock: c(COLORS.seabedRock),
    grassDry: c(COLORS.grassDry),
    meadow: c(COLORS.meadow),
    meadowDark: mix(COLORS.meadow, COLORS.forestDark, 0.45), // vales úmidos
    scrub: c(COLORS.scrub),
    forest: c(COLORS.forest),
    forestDark: c(COLORS.forestDark),
    carpet: mix(COLORS.forestDark, 0x1a3520, 0.7),     // dossel da mata visto de cima (massa escura)
    rock: c(COLORS.rock),
    rockDark: c(COLORS.rockDark),
    rockLight: mix(COLORS.rock, 0xdcd7cd, 0.65),       // picos mais claros
    rockWarm: mix(COLORS.rock, 0xa08a6a, 0.4),         // rocha com tom quente (falésias baixas)
    wood: c(COLORS.wood),
  };
})();

// ===================== ruído periódico (texturas tileáveis) =====================
export function makeTileNoise(seed) {
  const rng = createRng(seed);
  const G = 256;
  const gx = new Float32Array(G * G), gy = new Float32Array(G * G);
  for (let i = 0; i < G * G; i++) { const a = rng() * TAU; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
  // ruído de gradiente periódico (períodos Px, Py ≤ 256 células), saída ~[-1, 1]
  function grad(x, y, Px, Py) {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const x0 = ((xi % Px) + Px) % Px, y0 = ((yi % Py) + Py) % Py, x1 = (x0 + 1) % Px, y1 = (y0 + 1) % Py;
    const i00 = y0 * G + x0, i10 = y0 * G + x1, i01 = y1 * G + x0, i11 = y1 * G + x1;
    const n00 = gx[i00] * fx + gy[i00] * fy, n10 = gx[i10] * (fx - 1) + gy[i10] * fy;
    const n01 = gx[i01] * fx + gy[i01] * (fy - 1), n11 = gx[i11] * (fx - 1) + gy[i11] * (fy - 1);
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const a = n00 + (n10 - n00) * u, b = n01 + (n11 - n01) * u;
    return 1.45 * (a + (b - a) * v);
  }
  // fbm periódico em coordenadas de tile (u, v ∈ [0,1)); período base P (e Py opcional)
  function fbm(u, v, P, oct, gain = 0.5, Py = P) {
    let s = 0, a = 1, n = 0, px = P, py = Py;
    for (let o = 0; o < oct; o++) { s += a * grad(u * px, v * py, px, py); n += a; a *= gain; px *= 2; py *= 2; }
    return s / n;
  }
  // células de Voronoi periódicas (nx × ny células por tile)
  function cells(nx, ny, off = 0) {
    const r = createRng(seed * 7 + 131 + off);
    const n = nx * ny, px = new Float32Array(n), py = new Float32Array(n), id = new Float32Array(n);
    for (let i = 0; i < n; i++) { px[i] = r(); py[i] = r(); id[i] = r(); }
    return { nx, ny, px, py, id };
  }
  // out: f1, f2 (distâncias em unidades de célula em x), id da célula mais próxima, dx/dy até ela
  function voronoi(C, u, v, out) {
    const x = u * C.nx, y = v * C.ny, xi = Math.floor(x), yi = Math.floor(y), asp = C.nx / C.ny;
    let f1 = 1e9, f2 = 1e9, id = 0, bx = 0, by = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const cy = yi + dy, wy = ((cy % C.ny) + C.ny) % C.ny;
      for (let dx = -1; dx <= 1; dx++) {
        const cx = xi + dx, wx = ((cx % C.nx) + C.nx) % C.nx, k = wy * C.nx + wx;
        const ddx = cx + C.px[k] - x, ddy = (cy + C.py[k] - y) * asp;
        const d = ddx * ddx + ddy * ddy;
        if (d < f1) { f2 = f1; f1 = d; id = C.id[k]; bx = ddx; by = ddy; } else if (d < f2) f2 = d;
      }
    }
    out.f1 = Math.sqrt(f1); out.f2 = Math.sqrt(f2); out.id = id; out.dx = bx; out.dy = by;
    return out;
  }
  return { grad, fbm, cells, voronoi };
}

// normal (tangente) por diferenças finitas com wrap: devolve [nx, ny] em 0..255
function heightToNormal(H, W, Hh, strength, out, o0, stride, wrapY = true) {
  for (let y = 0; y < Hh; y++) {
    const ym = wrapY ? (y - 1 + Hh) % Hh : Math.max(0, y - 1), yp = wrapY ? (y + 1) % Hh : Math.min(Hh - 1, y + 1);
    for (let x = 0; x < W; x++) {
      const xm = (x - 1 + W) % W, xp = (x + 1) % W;
      const dx = (H[y * W + xp] - H[y * W + xm]) * strength, dy = (H[yp * W + x] - H[ym * W + x]) * strength;
      const l = Math.hypot(dx, dy, 1);
      const o = (y * W + x) * stride + o0;
      out[o] = Math.round(127.5 + 127.5 * (-dx / l)); out[o + 1] = Math.round(127.5 + 127.5 * (-dy / l));
    }
  }
}
// normaliza a média de cada canal RGB para 0,5 (as texturas de detalhe são MODULADORES da cor macro)
function normalizeMean(F, n, stride = 3) {
  for (let c = 0; c < 3; c++) {
    let m = 0; for (let i = 0; i < n; i++) m += F[i * stride + c];
    m = Math.max(1e-4, m / n);
    const k = 0.5 / m; for (let i = 0; i < n; i++) F[i * stride + c] = clamp(F[i * stride + c] * k, 0, 1);
  }
}
function dataTex(data, w, h, { mip = true, srgb = false } = {}) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.generateMipmaps = mip;
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}
const makeCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
// desenha com wrap (cópias deslocadas) dentro de [x0, x0+W) × [0, H)
function wrapDraw(W, H, x, y, pad, fn, x0 = 0, wrapY = true) {
  fn(x0 + x, y);
  const nx = x < pad ? 1 : (x > W - pad ? -1 : 0), ny = wrapY ? (y < pad ? 1 : (y > H - pad ? -1 : 0)) : 0;
  if (nx) fn(x0 + x + nx * W, y);
  if (ny) fn(x0 + x, y + ny * H);
  if (nx && ny) fn(x0 + x + nx * W, y + ny * H);
}

// ================= texturas de detalhe do terreno (geradas uma vez) =================
//  tRock    RGB rocha (estratos, fendas, líquen; média 0,5)   A altura
//  tRockN   RG normal da rocha                               BA normal das marcas de ondulação da areia
//  tGround  RGB grama (tufos/lâminas)                         A dossel da mata (luminância das copas)
//  tGroundN RG normal do dossel                              BA normal da grama
//  tMisc    R grão da areia   G cáusticas   B manchas (molhado/seixos)   A ruído macro (anti-repetição)
let DETAIL = null;
function buildDetailTextures(S) {
  if (DETAIL && DETAIL.size === S) return DETAIL;
  const T = makeTileNoise(SEED + 31337);
  const N = S * S;
  const vo = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };

  // ---------- rocha ----------
  const rockC = new Float32Array(N * 3), rockH = new Float32Array(N);
  const joints = T.cells(7, 3, 1), blocks = T.cells(15, 13, 2);
  const LAY = 17, layR = [], layR2 = [];
  { const r = createRng(SEED + 5151); for (let i = 0; i < LAY; i++) { layR.push(r()); layR2.push(r()); } }
  const lichenC = [[1.08, 1.1, 0.72], [0.98, 1.04, 0.9], [1.16, 0.94, 0.66]];
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S, i = y * S + x;
      const w1 = T.fbm(u, v, 3, 3);
      const sc = v * LAY + w1 * 1.4 + T.fbm(u, v, 8, 2) * 0.22;
      const L = Math.floor(sc), fl = sc - L, li = ((L % LAY) + LAY) % LAY;
      const lr = layR[li], lr2 = layR2[li];
      const prof = smoothstep(0, 0.1, fl) * smoothstep(1, 0.72 - 0.25 * lr, fl);   // bancada saliente
      T.voronoi(joints, u + w1 * 0.025, v, vo);
      const jc = 1 - smoothstep(0, 0.045 + 0.03 * lr2, vo.f2 - vo.f1);              // diáclases (verticais)
      T.voronoi(blocks, u, v, vo);
      const fc = 1 - smoothstep(0, 0.03, vo.f2 - vo.f1), bid = vo.id;              // fraturas finas
      const bed = 1 - smoothstep(0, 0.045, Math.min(fl, 1 - fl));                   // plano de acamamento
      const grain = T.fbm(u, v, 32, 3), fine = T.grad(u * 128, v * 128, 128, 128);
      const crack = Math.max(jc * 0.95, fc * 0.45 * (0.4 + 0.6 * lr2), bed * 0.55);
      rockH[i] = clamp(0.55 + 0.2 * prof * (0.4 + 0.6 * lr) + 0.12 * grain + 0.04 * fine + 0.06 * (bid - 0.5) - 0.5 * crack, 0, 1);
      let lum = 0.8 + 0.32 * (lr - 0.5) + 0.15 * grain + 0.05 * fine + 0.08 * (bid - 0.5);
      lum *= (1 - 0.6 * crack) * (0.9 + 0.14 * prof);
      const streak = smoothstep(0.15, 0.6, T.fbm(u, v, 24, 3, 0.5, 2));          // escorrimento escuro (vertical)
      lum *= 1 - 0.22 * streak;
      const warm = (lr2 - 0.5) * 0.14;
      let r = lum * (1 + warm), g = lum, b = lum * (1 - warm * 1.2);
      // líquen: manchas claras amareladas / verde-acinzentadas / alaranjadas, fora das fendas
      const lm = T.fbm(u + 0.31, v + 0.67, 6, 4) + 0.3 * T.fbm(u, v, 48, 2);
      const lich = smoothstep(0.2, 0.42, lm) * (1 - crack) * 0.85;
      if (lich > 0.001) {
        const lc = lichenC[Math.floor(bid * 2.999)];
        const ll = 1.0 + 0.25 * fine;
        r = lerp(r, lc[0] * ll, lich); g = lerp(g, lc[1] * ll, lich); b = lerp(b, lc[2] * ll, lich);
      }
      rockC[i * 3] = r; rockC[i * 3 + 1] = g; rockC[i * 3 + 2] = b;
    }
  }
  normalizeMean(rockC, N);
  const tRockD = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    tRockD[i * 4] = rockC[i * 3] * 255; tRockD[i * 4 + 1] = rockC[i * 3 + 1] * 255; tRockD[i * 4 + 2] = rockC[i * 3 + 2] * 255;
    tRockD[i * 4 + 3] = rockH[i] * 255;
  }

  // ---------- areia: grão + marcas de ondulação ----------
  const sandH = new Float32Array(N), misc = new Uint8Array(N * 4);
  const caus = T.cells(9, 9, 3);
  const hashP = createRng(SEED + 777);
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S, i = y * S + x;
      const grain = T.fbm(u, v, 64, 2);
      const rv = v * 11 + 0.55 * T.fbm(u, v, 2, 3) + 0.06 * T.fbm(u, v, 16, 2);
      const rp = 0.5 + 0.5 * Math.sin(TAU * rv);
      sandH[i] = Math.pow(rp, 1.6) * 0.75 + grain * 0.12;
      let g = 0.5 + 0.16 * grain + 0.1 * T.fbm(u, v, 8, 2);
      const hp = hashP();
      if (hp > 0.985) g -= 0.32; else if (hp < 0.008) g += 0.28;               // grãos escuros / conchinhas
      // cáusticas: rede fina e brilhante (bordas das células)
      T.voronoi(caus, u + 0.02 * T.fbm(u, v, 4, 2), v + 0.02 * T.fbm(u + 0.5, v, 4, 2), vo);
      const c = Math.pow(1 - smoothstep(0, 0.26, vo.f2 - vo.f1), 2.2);
      const mot = 0.5 + 0.5 * T.fbm(u + 0.2, v + 0.9, 4, 3);
      const mac = 0.5 + 0.62 * T.fbm(u + 0.7, v + 0.1, 2, 4);
      misc[i * 4] = clamp(g, 0, 1) * 255; misc[i * 4 + 1] = c * 255; misc[i * 4 + 2] = clamp(mot, 0, 1) * 255; misc[i * 4 + 3] = clamp(mac, 0, 1) * 255;
    }
  }
  const tRockND = new Uint8Array(N * 4);
  heightToNormal(rockH, S, S, S / 90, tRockND, 0, 4);
  heightToNormal(sandH, S, S, S / 140, tRockND, 2, 4);

  // ---------- grama (base por pixel + lâminas/tufos desenhados no canvas) ----------
  const cv = makeCanvas(S, S), g2 = cv.getContext('2d', { willReadFrequently: true });
  const img = g2.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S, i = (y * S + x) * 4;
      const clump = T.fbm(u, v, 6, 3), fine = T.fbm(u, v, 40, 2), dry = smoothstep(0.05, 0.5, T.fbm(u + 0.4, v + 0.2, 3, 2));
      const l = 0.42 + 0.14 * clump + 0.07 * fine;
      img.data[i] = clamp(l * (0.78 + 0.35 * dry), 0, 1) * 255;
      img.data[i + 1] = clamp(l * (1.0 + 0.05 * dry), 0, 1) * 255;
      img.data[i + 2] = clamp(l * (0.55 + 0.05 * dry), 0, 1) * 255;
      img.data[i + 3] = 255;
    }
  }
  g2.putImageData(img, 0, 0);
  const br = createRng(SEED + 4040);
  const blades = Math.round(9000 * (S / 512) * (S / 512));
  g2.lineCap = 'round';
  for (let k = 0; k < blades; k++) {
    const x = br() * S, y = br() * S, len = (3 + br() * 9) * (S / 512), ang = br() * TAU;
    const lum = 0.25 + br() * 0.55, yel = br();
    g2.strokeStyle = `rgba(${Math.round(255 * lum * (0.62 + 0.45 * yel))},${Math.round(255 * lum * (1.02 + 0.08 * yel))},${Math.round(255 * lum * 0.42)},${0.35 + 0.4 * br()})`;
    g2.lineWidth = (0.8 + br() * 1.0) * (S / 512);
    const dx = Math.cos(ang) * len, dy = Math.sin(ang) * len, bend = (br() - 0.5) * len * 0.6;
    wrapDraw(S, S, x, y, 14, (px, py) => { g2.beginPath(); g2.moveTo(px, py); g2.quadraticCurveTo(px + dx * 0.5 - dy * 0.2, py + dy * 0.5 + bend * 0.2, px + dx, py + dy); g2.stroke(); });
  }
  const gd = g2.getImageData(0, 0, S, S).data;
  const grassC = new Float32Array(N * 3), grassH = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    grassC[i * 3] = gd[i * 4] / 255; grassC[i * 3 + 1] = gd[i * 4 + 1] / 255; grassC[i * 3 + 2] = gd[i * 4 + 2] / 255;
    grassH[i] = (gd[i * 4] + gd[i * 4 + 1]) / 510;
  }
  normalizeMean(grassC, N);

  // ---------- dossel da mata visto de cima: copas sobrepostas (cúpulas por célula) ----------
  const crowns = T.cells(9, 9, 4);
  const canH = new Float32Array(N), canL = new Float32Array(N);
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S, i = y * S + x;
      const X = u * 9, Y = v * 9, xi = Math.floor(X), yi = Math.floor(Y);
      let h = 0, hid = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const cx = xi + dx, cy = yi + dy, k = (((cy % 9) + 9) % 9) * 9 + (((cx % 9) + 9) % 9);
        const ddx = cx + crowns.px[k] - X, ddy = cy + crowns.py[k] - Y;
        const rc = 0.55 + 0.5 * crowns.id[k];
        const q = 1 - (ddx * ddx + ddy * ddy) / (rc * rc);
        if (q > 0) { const hh = Math.sqrt(q) * (0.65 + 0.35 * crowns.id[k]); if (hh > h) { h = hh; hid = crowns.id[k]; } }
      }
      const leaf = T.fbm(u, v, 72, 2);
      canH[i] = h + 0.08 * leaf;
      canL[i] = (h > 0.02 ? 0.3 + 0.75 * Math.pow(h, 0.7) * (0.85 + 0.3 * hid) : 0.12) * (0.88 + 0.24 * leaf);
    }
  }
  { let m = 0; for (let i = 0; i < N; i++) m += canL[i]; m /= N; for (let i = 0; i < N; i++) canL[i] = clamp(canL[i] * 0.5 / m, 0, 1); }
  const tGroundD = new Uint8Array(N * 4), tGroundND = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    tGroundD[i * 4] = grassC[i * 3] * 255; tGroundD[i * 4 + 1] = grassC[i * 3 + 1] * 255; tGroundD[i * 4 + 2] = grassC[i * 3 + 2] * 255;
    tGroundD[i * 4 + 3] = canL[i] * 255;
  }
  heightToNormal(canH, S, S, S / 110, tGroundND, 0, 4);
  heightToNormal(grassH, S, S, S / 260, tGroundND, 2, 4);

  DETAIL = {
    size: S,
    tRock: dataTex(tRockD, S, S), tRockN: dataTex(tRockND, S, S),
    tGround: dataTex(tGroundD, S, S), tGroundN: dataTex(tGroundND, S, S),
    tMisc: dataTex(misc, S, S),
  };
  return DETAIL;
}

// ======================= altura VISUAL da ilha =======================
// heightAt (jogabilidade) + ravinas de erosão (só cavam), falésias nas costas
// sem praia, plataforma submersa suave e o pé das agulhas de rocha no mar.
const CTX = new WeakMap();
function islandCtx(island) {
  let c = CTX.get(island);
  if (c) return c;
  const noise = createNoise(SEED + 7001 + island.id * 13);
  const enoise = createNoise(SEED + 7507 + island.id * 31);
  const vegAt = (x, z) => noise.fbm2(x / ISLANDS.VEG_NOISE_M, z / ISLANDS.VEG_NOISE_M, 3, 2, 0.5);
  const forAt = (x, z) => noise.fbm2(x / ISLANDS.FOREST_NOISE_M + 53.1, z / ISLANDS.FOREST_NOISE_M - 17.7, 3, 2, 0.55);
  const bchAt = (x, z) => noise.fbm2(x / ISLANDS.BEACH_NOISE_M - 9.3, z / ISLANDS.BEACH_NOISE_M + 27.1, 2, 2, 0.5);
  const fineAt = (x, z) => noise.fbm2(x / 70 + 31.7, z / 70 - 11.3, 2, 2, 0.5);
  const microAt = (x, z) => noise.noise2(x / 23 - 8.1, z / 23 + 4.4);
  const speciesAt = (x, z) => enoise.noise2(x / 430 + 5.5, z / 430 - 2.5);
  // costa rochosa (sem praia) onde o ruído de praia é baixo
  const rockyAt = (x, z) => smoothstep(-0.02, -0.36, bchAt(x, z) + 0.12 * fineAt(x, z));
  const SK = ISLANDS.SKIRT_Y, EM = ISLANDS.EROSION_M, CT = ISLANDS.CLIFF_TOP;

  function baseHeight(x, z) {
    const h0 = island.heightAt(x, z);
    if (h0 === -Infinity) return SK;
    let h = h0;
    if (h0 > 6) { // ravinas: ridged pequeno cava os vales entre cristas finas (mais nas montanhas)
      const m = smoothstep(25, 380, h0), lo = smoothstep(6, 70, h0);
      const e1 = enoise.ridged2(x / 230, z / 230, 3, 2.1, 0.5);
      const e2 = enoise.ridged2(x / 83 + 17.3, z / 83 - 9.1, 2, 2.0, 0.5);
      h += -m * EM * Math.pow(1 - e1, 1.7) + m * 3 * e1 * e1 * e1 - lo * 6 * (1 - e2) * (1 - e2);
    }
    let rocky = -1;
    if (h0 < 22 && h0 > -40) { // falésia costeira: a borda fica a `top` m e a face cai até o fundo
      rocky = rockyAt(x, z);
      if (rocky > 0.002) {
        const fn = fineAt(x, z), mn = enoise.noise2(x / 21 + 3.3, z / 21 - 7.7);
        const top = CT[0] + (CT[1] - CT[0]) * rocky + 2.2 * fn;
        const k = smoothstep(top - 0.3, top - 1.25, h0 + 0.55 * mn);
        const plateau = h + 0.45 * clamp(top + 1.8 - h0, 0, 2.2);
        const sea = Math.min(h0, top - 2) - 11 - 2 * rocky + 2.5 * mn;
        h = lerp(h, lerp(plateau, Math.min(sea, plateau), k), smoothstep(0, 0.6, rocky));
      }
    }
    if (h < 0) { // plataforma submersa: rasa e suave nas praias, mais funda nas costas rochosas
      if (rocky < 0) rocky = rockyAt(x, z);
      const d = -h;
      const dS = 10 * (1 - Math.exp(-d / 10)) + 0.12 * d, dR = 6 * (1 - Math.exp(-d / 6)) + 0.4 * d;
      h = -lerp(dS, dR, rocky);
    }
    return h;
  }

  // agulhas de rocha (sea stacks) logo além das falésias
  const stacks = [];
  {
    const rng = createRng(SEED + 9900 + island.id * 7);
    const want = ISLANDS.STACKS_HIGH;
    for (let t = 0; t < want * 40 && stacks.length < want; t++) {
      const th = rng() * TAU, ct = Math.cos(th), st = Math.sin(th), ro = island.outlineRadius(th);
      let rs = -1;
      for (let u = 1.06; u > 0.82; u -= 0.004) { if (baseHeight(island.cx + ct * ro * u, island.cz + st * ro * u) > 0) { rs = ro * u; break; } }
      if (rs < 0) continue;
      const group = 1 + (rng() < 0.4 ? Math.floor(rng() * 3) : 0);
      const off0 = rng.range(16, 70), lat0 = 0;
      for (let gI = 0; gI < group && stacks.length < want; gI++) {
        const off = off0 + gI * rng.range(-14, 22), lat = lat0 + gI * rng.range(-30, 30);
        const x = island.cx + ct * (rs + off) - st * lat, z = island.cz + st * (rs + off) + ct * lat;
        if (rockyAt(x, z) < 0.55) continue;
        const hb = baseHeight(x, z);
        if (hb > -1.5 || hb < -11) continue;
        const r = rng.range(4.5, 10.5) * (gI ? 0.7 : 1);
        if (stacks.some((o) => (o.x - x) ** 2 + (o.z - z) ** 2 < (o.r + r + 8) ** 2)) continue;
        stacks.push({ x, z, r, h: rng.range(8, 24) * (gI ? 0.65 : 1), r2m: (2.2 * r) ** 2, rot: rng() * TAU });
      }
    }
  }
  function renderHeight(x, z) {
    let h = baseHeight(x, z);
    if (h > -25 && h < 3) {
      for (let i = 0; i < stacks.length; i++) {
        const s = stacks[i], dx = x - s.x, dz = z - s.z, d2 = dx * dx + dz * dz;
        if (d2 < s.r2m) h = Math.max(h, 1.0 - 6 * Math.max(0, Math.sqrt(d2) / s.r - 0.7)); // pé de rochas na água
      }
    }
    return h;
  }
  c = { island, cx: island.cx, cz: island.cz, noise, vegAt, forAt, bchAt, fineAt, microAt, speciesAt, rockyAt, renderHeight, stacks };
  CTX.set(island, c);
  return c;
}
export function islandRenderHeight(island, x, z) { return islandCtx(island).renderHeight(x, z); }

// ===================== campo da costa (textura polar) =====================
// Por ilha, W ângulos × ROWS raios (u = r / contorno(θ) de U0 a U1):
//   R = altura visual do fundo (m)   G = distância radial à linha d'água (m, + mar adentro)
//   B = contorno(θ) / R              A = 1
// HalfFloat, filtro linear, wrap em S (ângulo). Lido pelo oceano (profundidade → transparência,
// cor turquesa, ondas amortecidas, linhas de espuma) — uma única fonte para terreno e água.
const SHORE = new WeakMap();
export function getShoreField(worldData) {
  let f = SHORE.get(worldData);
  if (f) return f;
  const W = ISLANDS.SHORE_TEX_W, ROWS = ISLANDS.SHORE_TEX_ROWS, U0 = ISLANDS.SHORE_U0, U1 = ISLANDS.SHORE_U1;
  const list = worldData.islands, NI = list.length;
  const data = new Uint16Array(W * ROWS * NI * 4);
  const toH = THREE.DataUtils.toHalfFloat;
  const col = new Float32Array(ROWS);
  const isl = [];
  for (let n = 0; n < NI; n++) {
    const I = list[n], ctx = islandCtx(I);
    let rMax = 0;
    for (let c = 0; c < W; c++) {
      const th = -Math.PI + TAU * (c + 0.5) / W, ct = Math.cos(th), st = Math.sin(th);
      const ro = I.outlineRadius(th);
      rMax = Math.max(rMax, ro);
      for (let j = 0; j < ROWS; j++) {
        const r = ro * (U0 + (U1 - U0) * j / (ROWS - 1));
        col[j] = ctx.renderHeight(I.cx + ct * r, I.cz + st * r);
      }
      // linha d'água: primeiro cruzamento vindo do mar
      let rs = ro * U0;
      if (col[ROWS - 1] > 0) rs = ro * U1;
      else for (let j = ROWS - 2; j >= 0; j--) {
        if (col[j] > 0) { const t = col[j] / (col[j] - col[j + 1]); rs = ro * (U0 + (U1 - U0) * (j + t) / (ROWS - 1)); break; }
      }
      for (let j = 0; j < ROWS; j++) {
        const r = ro * (U0 + (U1 - U0) * j / (ROWS - 1));
        const o = (((n * ROWS + j) * W) + c) * 4;
        data[o] = toH(clamp(col[j], -120, 80));
        data[o + 1] = toH(clamp(r - rs, -1500, 3000));
        data[o + 2] = toH(ro / I.R);
        data[o + 3] = toH(1);
      }
    }
    isl.push(new THREE.Vector4(I.cx, I.cz, I.R, rMax * U1 + 20));
  }
  const tex = new THREE.DataTexture(data, W, ROWS * NI, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  f = { texture: tex, islands: isl, U0, U1, rows: ROWS, count: NI };
  SHORE.set(worldData, f);
  return f;
}

// ---------------------- classificação da cobertura --------------------
// Pesos (0..1) das faixas num ponto do terreno.
//   y      altura (m); ny = componente Y da normal (1 = plano, 0 = vertical)
//   relief altura relativa à média local (-1 vale … +1 crista)
//   vegN   ruído ~700 m: prado (−) vs pasto seco (+)
//   forN   ruído ~520 m: manchas de floresta
//   bchN   ruído ~900 m: costas com praia (+) ou sem (−)
//   fineN  ruído ~70 m para tremer as bordas
function coverAt(y, ny, relief, vegN, forN, bchN, fineN, maxH, out) {
  const sandTop = ISLANDS.SAND_MAX_Y * (0.35 + 1.0 * smoothstep(-0.45, 0.45, bchN));
  const yS = y + 1.6 * fineN;
  const sand = (1 - smoothstep(sandTop - 1.5, sandTop + 2.5, yS)) * smoothstep(0.78, 0.9, ny + 0.03 * fineN) * smoothstep(-5, -2, y);
  const sD = ny + 0.06 * fineN;
  const rock = Math.max(smoothstep(0.72, 0.55, sD), smoothstep(0.52 * maxH, 0.70 * maxH, y + 45 * fineN + 30 * vegN));
  const peak = smoothstep(0.68 * maxH, 0.95 * maxH, y);
  const treeline = 1 - smoothstep(ISLANDS.TREELINE * maxH * 0.8, ISLANDS.TREELINE * maxH, y + 40 * fineN);
  const f = forN - 0.35 * relief + 0.08 * fineN;
  const forest = smoothstep(0.12, 0.4, f) * treeline * smoothstep(4, 12, y) * smoothstep(0.5, 0.7, ny) * (1 - sand) * (1 - rock);
  const scrub = clamp(smoothstep(0.2 * maxH, 0.42 * maxH, y + 30 * vegN) + 0.45 * smoothstep(0.25, 0.9, relief), 0, 1);
  const dry = smoothstep(-0.45, 0.5, 1.3 * vegN + 0.6 * relief + 0.12 * fineN);
  out.sand = sand; out.rock = rock; out.peak = peak; out.forest = forest; out.scrub = scrub; out.dry = dry;
  out.grass = clamp(1 - sand - forest, 0, 1) * (1 - rock);
  return out;
}

const _tmpA = new THREE.Color(), _tmpB = new THREE.Color();
// Cor macro do vértice (linear) a partir dos pesos de cobertura — é o que se vê de longe.
function terrainColor(y, ny, relief, fineN, microN, rocky, cov, out) {
  out.copy(PAL.meadowDark).lerp(PAL.meadow, clamp(0.55 + 0.6 * relief + 0.15 * fineN, 0, 1));
  out.lerp(PAL.grassDry, cov.dry);
  out.lerp(PAL.scrub, cov.scrub * 0.85);
  out.multiplyScalar(0.92);
  _tmpA.copy(PAL.carpet).lerp(PAL.forestDark, clamp(0.5 + 0.5 * fineN, 0, 1));
  out.lerp(_tmpA, Math.min(1, cov.forest * 1.15));
  if (cov.sand > 0.001) {
    _tmpB.copy(PAL.sandWet).lerp(PAL.sand, smoothstep(0, ISLANDS.SAND_WET_Y, y));
    _tmpB.lerp(PAL.sandLight, 0.75 * smoothstep(ISLANDS.SAND_WET_Y, ISLANDS.SAND_MAX_Y + 2, y));
    out.lerp(_tmpB, cov.sand);
  }
  _tmpB.copy(PAL.rockDark).lerp(PAL.rock, clamp(0.5 + 0.4 * fineN + 0.2 * microN, 0, 1));
  _tmpB.lerp(PAL.rockWarm, 0.5 * (1 - smoothstep(150, 400, y)));
  _tmpB.lerp(PAL.rockLight, cov.peak * clamp(0.6 + 0.4 * fineN, 0, 1));
  out.lerp(_tmpB, cov.rock);
  // submerso: areia (praias) ou rocha com algas (costas rochosas); a absorção da água é feita no shader
  if (y < 0.5) {
    _tmpA.copy(PAL.sandSub).lerp(PAL.seabedRock, clamp(rocky * 0.85 + 0.15 * microN, 0, 1));
    _tmpA.lerp(PAL.seabed, smoothstep(-60, -150, y));
    out.lerp(_tmpA, smoothstep(0.5, -1.2, y));
  }
  out.multiplyScalar(1 + (0.06 + 0.08 * cov.rock) * microN + 0.07 * fineN * cov.grass);
  return out;
}

// ===================== shader de detalhe (terreno + rochas) =====================
const DETAIL_VERT_PARS = /* glsl */`
varying vec3 vDtPos;
varying vec3 vDtNrm;
#ifdef DT_TERRAIN
attribute vec4 aCover;
varying vec4 vDtCover;
#endif
`;
const DETAIL_VERT = /* glsl */`
{
  vec4 dtWP = vec4(transformed, 1.0);
  vec3 dtWN = objectNormal;
#ifdef USE_INSTANCING
  dtWP = instanceMatrix * dtWP;
  mat3 dtIM = mat3(instanceMatrix);
  dtWN = dtIM * (dtWN / vec3(dot(dtIM[0], dtIM[0]), dot(dtIM[1], dtIM[1]), dot(dtIM[2], dtIM[2])));
#endif
  dtWP = modelMatrix * dtWP;
  vDtPos = dtWP.xyz;
  vDtNrm = normalize(mat3(modelMatrix) * dtWN);
#ifdef DT_TERRAIN
  vDtCover = aCover;
#endif
}
`;
const DETAIL_FRAG_PARS = /* glsl */`
uniform sampler2D tRock;
uniform sampler2D tRockN;
uniform sampler2D tGround;
uniform sampler2D tGroundN;
uniform sampler2D tMisc;
uniform vec4 uFade;
uniform float uTime;
uniform vec3 uSigma;
uniform vec3 uSunW;
varying vec3 vDtPos;
varying vec3 vDtNrm;
#ifdef DT_TERRAIN
varying vec4 vDtCover;
#endif
// rocha triplanar: albedo (rgb, média 0,5) + altura (a) e perturbação da normal (mundo)
void dtRockTri(vec3 P, vec3 dx, vec3 dy, vec3 w, float sc, out vec4 alb, out vec3 pert) {
  alb = vec4(0.0); pert = vec3(0.0); float ws = 0.0;
  if (w.x > 0.03) {
    vec2 uv = P.zy * sc, gx = dx.zy * sc, gy = dy.zy * sc;
    vec2 n = textureGrad(tRockN, uv, gx, gy).rg * 2.0 - 1.0;
    alb += textureGrad(tRock, uv, gx, gy) * w.x; pert += vec3(0.0, n.y, n.x) * w.x; ws += w.x;
  }
  if (w.y > 0.03) {
    vec2 uv = P.xz * sc, gx = dx.xz * sc, gy = dy.xz * sc;
    vec2 n = textureGrad(tRockN, uv, gx, gy).rg * 2.0 - 1.0;
    alb += textureGrad(tRock, uv, gx, gy) * w.y; pert += vec3(n.x, 0.0, n.y) * w.y; ws += w.y;
  }
  if (w.z > 0.03) {
    vec2 uv = P.xy * sc, gx = dx.xy * sc, gy = dy.xy * sc;
    vec2 n = textureGrad(tRockN, uv, gx, gy).rg * 2.0 - 1.0;
    alb += textureGrad(tRock, uv, gx, gy) * w.z; pert += vec3(n.x, n.y, 0.0) * w.z; ws += w.z;
  }
  alb /= max(ws, 1e-4); pert /= max(ws, 1e-4);
}
`;
const DETAIL_FRAG = /* glsl */`
vec3 dtN = normalize(vDtNrm);
float dtRough = roughness;
vec3 dtDx = dFdx(vDtPos), dtDy = dFdy(vDtPos);
float dtFadeF = 0.0;
float dtWs = 0.0, dtWr = 1.0, dtWf = 0.0, dtWg = 0.0;
{
  vec3 P = vDtPos;
  vec3 Ng = dtN;
  float dist = length(cameraPosition - P);
  float fF = 1.0 - smoothstep(uFade.x, uFade.y, dist);
  float fC = 1.0 - smoothstep(uFade.z, uFade.w, dist);
  dtFadeF = fF;
#ifdef DT_TERRAIN
  float ws = vDtCover.x, wf = vDtCover.y, wr = vDtCover.z;
  float wg = max(0.0, 1.0 - ws - wf - wr);
#else
  float ws = 0.0, wf = 0.0, wr = 1.0, wg = 0.0;
#endif
  if (fC > 0.001) {
    float macro = textureGrad(tMisc, P.xz * (1.0 / 730.0), dtDx.xz * (1.0 / 730.0), dtDy.xz * (1.0 / 730.0)).a;
    vec3 modc = vec3(0.0), pert = vec3(0.0);
    float rough = 0.0;
    if (wr > 0.004) {
      vec3 w = pow(abs(Ng), vec3(4.0)); w /= (w.x + w.y + w.z);
      vec3 Pw = P + vec3(0.0, (macro - 0.5) * 16.0, 0.0);   // estratos ondulados
      vec4 a1, a2; vec3 n1, n2;
      dtRockTri(Pw, dtDx, dtDy, w, 1.0 / 13.0, a1, n1);
      dtRockTri(Pw + vec3(37.0, 11.0, 53.0), dtDx, dtDy, w, 1.0 / 61.0, a2, n2);
      float rh = mix(a2.a, a1.a, fF);
#ifdef DT_TERRAIN
      // transição pela altura da textura: a rocha aflora primeiro nas saliências
      float wr2 = clamp(wr + (rh - 0.5) * 3.0 * wr * (1.0 - wr), 0.0, 1.0);
      float kO = (1.0 - wr2) / max(1.0 - wr, 1e-3);
      ws *= kO; wf *= kO; wg *= kO; wr = wr2;
#endif
      vec3 mr = (1.0 + fF * (2.0 * a1.rgb - 1.0) * 0.9) * (1.0 + fC * (2.0 * a2.rgb - 1.0) * 0.75);
      modc += mr * wr; pert += (n1 * (fF * 0.9) + n2 * (fC * 0.6)) * wr;
      rough += (0.72 + 0.18 * rh) * wr;
    }
#ifdef DT_TERRAIN
    if (wg > 0.004) {
      const mat2 R1 = mat2(0.825, 0.565, -0.565, 0.825);
      vec2 u1 = P.xz * (1.0 / 6.5), u2 = R1 * P.xz * (1.0 / 29.0);
      vec2 g1x = dtDx.xz * (1.0 / 6.5), g1y = dtDy.xz * (1.0 / 6.5);
      vec2 g2x = R1 * dtDx.xz * (1.0 / 29.0), g2y = R1 * dtDy.xz * (1.0 / 29.0);
      vec4 g1 = textureGrad(tGround, u1, g1x, g1y), g2 = textureGrad(tGround, u2, g2x, g2y);
      vec2 gn = textureGrad(tGroundN, u1, g1x, g1y).ba * 2.0 - 1.0;
      vec3 mg = (1.0 + fF * (2.0 * g1.rgb - 1.0) * 0.75) * (1.0 + fC * (2.0 * g2.rgb - 1.0) * 0.5);
      modc += mg * wg; pert += vec3(gn.x, 0.0, gn.y) * (fF * 0.5 * wg); rough += 0.95 * wg;
    }
    if (wf > 0.004) {
      const mat2 R2 = mat2(0.27, 0.963, -0.963, 0.27);
      vec2 u1 = P.xz * (1.0 / 58.0), u2 = R2 * P.xz * (1.0 / 171.0);
      vec2 g1x = dtDx.xz * (1.0 / 58.0), g1y = dtDy.xz * (1.0 / 58.0);
      vec2 g2x = R2 * dtDx.xz * (1.0 / 171.0), g2y = R2 * dtDy.xz * (1.0 / 171.0);
      float c1 = textureGrad(tGround, u1, g1x, g1y).a, c2 = textureGrad(tGround, u2, g2x, g2y).a;
      vec2 cn = textureGrad(tGroundN, u1, g1x, g1y).rg * 2.0 - 1.0;
      vec3 mf = vec3((1.0 + fC * (2.0 * c1 - 1.0) * 0.95) * (1.0 + fC * (2.0 * c2 - 1.0) * 0.35));
      mf *= mix(vec3(1.0), mix(vec3(0.86, 0.93, 1.1), vec3(1.1, 1.05, 0.84), c1), fC); // copas ao sol amareladas, vãos azulados
      modc += mf * wf; pert += vec3(cn.x, 0.0, cn.y) * (fC * 1.0 * wf); rough += 0.93 * wf;
    }
    if (ws > 0.004) {
      const mat2 R3 = mat2(0.76, 0.65, -0.65, 0.76);
      vec2 u1 = P.xz * (1.0 / 4.3);
      float s1 = textureGrad(tMisc, u1, dtDx.xz * (1.0 / 4.3), dtDy.xz * (1.0 / 4.3)).r;
      vec2 ru = R3 * P.xz * (1.0 / 17.0);
      vec2 rn = textureGrad(tRockN, ru, R3 * dtDx.xz * (1.0 / 17.0), R3 * dtDy.xz * (1.0 / 17.0)).ba * 2.0 - 1.0;
      rn = vec2(0.76 * rn.x + 0.65 * rn.y, -0.65 * rn.x + 0.76 * rn.y);
      float sm = 1.0 + fF * (2.0 * s1 - 1.0) * 0.55;
      modc += vec3(sm) * ws; pert += vec3(rn.x, 0.0, rn.y) * (fF * 0.55 * ws); rough += 0.86 * ws;
    }
#endif
    float wt = max(ws + wf + wr + wg, 1e-3);
    modc /= wt; pert /= wt; rough /= wt;
    diffuseColor.rgb *= modc;
    dtN = normalize(Ng + pert);
    dtRough = mix(dtRough, rough, fC);
  }
  dtWs = ws; dtWr = wr; dtWf = wf; dtWg = wg;
}
#ifdef DT_WATER
{
  vec3 P = vDtPos;
  // areia molhada (escura e brilhante) até a borda da onda, que sobe e desce devagar
  float wn = textureGrad(tMisc, P.xz * (1.0 / 41.0), dtDx.xz * (1.0 / 41.0), dtDy.xz * (1.0 / 41.0)).b;
  float swash = 0.3 * sin(uTime * 0.6 + dot(P.xz, vec2(0.021, 0.017)) + wn * 7.0);
  float wetTop = 0.45 + 0.8 * wn + max(swash, 0.0);
  float wetMask = clamp(dtWs + 0.75 * dtWr + 0.3 * dtWg, 0.0, 1.0);
  float wet = (1.0 - smoothstep(wetTop - 0.35, wetTop + 0.08, P.y)) * wetMask;
  diffuseColor.rgb *= 1.0 - 0.4 * wet;
  dtRough = mix(dtRough, 0.26, wet * 0.85);
  // renda de espuma deixada na borda da onda
  float lace = (1.0 - smoothstep(0.0, 0.16, abs(P.y - (0.3 + 0.75 * wn + swash)))) *
    smoothstep(0.45, 0.8, textureGrad(tMisc, P.xz * (1.0 / 5.0), dtDx.xz * 0.2, dtDy.xz * 0.2).g) * step(0.0, P.y);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86), lace * 0.65 * dtFadeF * wetMask);
  // fundo submerso: luz atenuada na descida e na subida (por canal) + cáusticas
  if (P.y < 0.0) {
    float d = -P.y;
    vec3 V = normalize(cameraPosition - P);
    float cosV = sqrt(max(0.04, 1.0 - (1.0 - V.y * V.y) / 1.7689));
    float cosS = sqrt(max(0.04, 1.0 - (1.0 - uSunW.y * uSunW.y) / 1.7689));
    vec3 Td = exp(-uSigma * d / cosS);
    vec3 Tu = exp(-uSigma * d / cosV);
    float Tg = exp(-uSigma.g * d / cosV);
    vec2 cuv = P.xz * (1.0 / 9.0);
    vec2 cgx = dtDx.xz * (1.0 / 9.0), cgy = dtDy.xz * (1.0 / 9.0);
    float c1 = textureGrad(tMisc, cuv + vec2(0.021, 0.013) * uTime, cgx, cgy).g;
    float c2 = textureGrad(tMisc, cuv * 1.31 + vec2(-0.017, 0.019) * uTime, cgx * 1.31, cgy * 1.31).g;
    float caust = min(c1, c2) * smoothstep(0.0, 0.9, d) * exp(-0.08 * d) * (0.3 + 0.7 * dtFadeF);
    diffuseColor.rgb *= Td * min(Tu / max(Tg, 1e-4), vec3(4.0)) * (1.0 + 2.4 * caust);
  }
}
#endif
`;

// Liga o shader de detalhe num MeshStandardMaterial. mode: 'terrain' (máscaras por vértice + água) ou 'rock'.
function patchDetailMaterial(mat, uniforms, mode) {
  mat.defines = Object.assign(mat.defines || {}, mode === 'terrain' ? { DT_TERRAIN: '', DT_WATER: '' } : { DT_WATER: '' });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + DETAIL_VERT_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + DETAIL_VERT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + DETAIL_FRAG_PARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + DETAIL_FRAG)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = dtRough;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(dtN, 0.0)).xyz);');
  };
  mat.customProgramCacheKey = () => 'ruppen-detail-' + mode;
  return mat;
}

// ===================== malha adaptativa do terreno =====================
// Quadtree restrita (vizinhos diferem ≤ 1 nível) refinada gulosamente pelo erro da
// interpolação (cristas, picos, falésias) com prioridade extra na linha d'água;
// folhas inteiras muito fundas são descartadas. Triangulação sem fendas: folha com
// vizinho mais fino ganha vértice central + leque com os pontos médios.
function buildTerrainMesh(ctx, B, L, targetLeaves) {
  const NL = 1 << L, NV = NL + 1, step = (2 * B) / NL, cx = ctx.cx, cz = ctx.cz, deep = ISLANDS.DEEP_CULL_Y;
  const cache = new Map();
  const H = (ix, iz) => {
    const k = iz * NV + ix;
    let v = cache.get(k);
    if (v === undefined) { v = ctx.renderHeight(cx - B + ix * step, cz - B + iz * step); cache.set(k, v); }
    return v;
  };
  const KEY = (l, i, j) => (l * 2048 + i) * 2048 + j;
  const leaves = new Set(), internal = new Set();
  // heap máximo por prioridade
  const hp = [], hk = [];
  const hpush = (p, k) => {
    let n = hp.length; hp.push(p); hk.push(k);
    while (n > 0) { const pa = (n - 1) >> 1; if (hp[pa] >= hp[n]) break; [hp[pa], hp[n]] = [hp[n], hp[pa]]; [hk[pa], hk[n]] = [hk[n], hk[pa]]; n = pa; }
  };
  const hpop = () => {
    const k = hk[0], p = hp[0], lp = hp.pop(), lk = hk.pop();
    if (hp.length) {
      hp[0] = lp; hk[0] = lk; let n = 0;
      for (;;) {
        const a = 2 * n + 1, b = a + 1; let m = n;
        if (a < hp.length && hp[a] > hp[m]) m = a;
        if (b < hp.length && hp[b] > hp[m]) m = b;
        if (m === n) break;
        [hp[m], hp[n]] = [hp[n], hp[m]]; [hk[m], hk[n]] = [hk[n], hk[m]]; n = m;
      }
    }
    return [p, k];
  };
  function errorOf(l, i, j) {
    const s = NL >> l, x0 = i * s, z0 = j * s, h = s >> 1;
    const a = H(x0, z0), b = H(x0 + s, z0), c = H(x0, z0 + s), d = H(x0 + s, z0 + s);
    const m = H(x0 + h, z0 + h), e0 = H(x0 + h, z0), e1 = H(x0, z0 + h), e2 = H(x0 + s, z0 + h), e3 = H(x0 + h, z0 + s);
    let mn = Math.min(a, b, c, d, m, e0, e1, e2, e3), mx = Math.max(a, b, c, d, m, e0, e1, e2, e3);
    let err = Math.max(Math.abs(m - (a + b + c + d) * 0.25), Math.abs(e0 - (a + b) * 0.5), Math.abs(e1 - (a + c) * 0.5),
      Math.abs(e2 - (b + d) * 0.5), Math.abs(e3 - (c + d) * 0.5));
    if (s >= 4) {
      const q = s >> 2;
      const bl = (fx, fz) => (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
      const q0 = H(x0 + q, z0 + q), q1 = H(x0 + s - q, z0 + q), q2 = H(x0 + q, z0 + s - q), q3 = H(x0 + s - q, z0 + s - q);
      err = Math.max(err, Math.abs(q0 - bl(0.25, 0.25)), Math.abs(q1 - bl(0.75, 0.25)), Math.abs(q2 - bl(0.25, 0.75)), Math.abs(q3 - bl(0.75, 0.75)));
      mn = Math.min(mn, q0, q1, q2, q3); mx = Math.max(mx, q0, q1, q2, q3);
    }
    const size = s * step;
    if (mx < deep) return size > 1400 ? 1 : 0;              // fundo invisível: grosso
    if (mx < -8) err *= 0.3;                                // submerso (visto através da água)
    if (mn < 2.5 && mx > -3) err = Math.max(err, size * 0.16); // linha d'água: folhas pequenas
    else if (mn < 14 && mx > -8) err = Math.max(err, size * 0.03);
    return err;
  }
  leaves.add(KEY(0, 0, 0));
  hpush(errorOf(0, 0, 0), KEY(0, 0, 0));
  let leafCount = 1;
  const decode = (k) => { const j = k % 2048, r = (k - j) / 2048, i = r % 2048, l = (r - i) / 2048; return [l, i, j]; };
  const split = (k, l, i, j, queue) => {
    leaves.delete(k); internal.add(k);
    for (let c = 0; c < 4; c++) {
      const ci = 2 * i + (c & 1), cj = 2 * j + (c >> 1), ck = KEY(l + 1, ci, cj);
      leaves.add(ck);
      if (queue) queue.push(ck);
      else if (l + 1 < L) hpush(errorOf(l + 1, ci, cj), ck);
    }
    leafCount += 3;
  };
  while (hp.length && leafCount < targetLeaves) {
    const [p, k] = hpop();
    if (p <= 0.12) break;
    const [l, i, j] = decode(k);
    if (l >= L || !leaves.has(k)) continue;
    split(k, l, i, j, null);
  }
  // restrição 2:1
  const queue = Array.from(leaves);
  while (queue.length) {
    const k = queue.pop();
    if (!leaves.has(k)) continue;
    const [l, i, j] = decode(k);
    if (l < 2) continue;
    const n = 1 << l;
    let changed = false;
    for (let q = 0; q < 4; q++) {
      const ni = i + (q === 0 ? -1 : q === 1 ? 1 : 0), nj = j + (q === 2 ? -1 : q === 3 ? 1 : 0);
      if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
      for (let ll = l - 2; ll >= 0; ll--) {
        const sh = l - ll, kk = KEY(ll, ni >> sh, nj >> sh);
        if (leaves.has(kk)) { split(kk, ll, ni >> sh, nj >> sh, queue); changed = true; break; }
      }
    }
    if (changed) queue.push(k);
  }
  // triangulação
  const idxMap = new Map(), pos = [], index = [];
  const V = (ix, iz) => {
    const k = iz * NV + ix;
    let v = idxMap.get(k);
    if (v === undefined) { v = pos.length / 3; pos.push(ix * step - B, H(ix, iz), iz * step - B); idxMap.set(k, v); }
    return v;
  };
  const tri = (ax, az, bx, bz, qx, qz) => {
    // orientação com a face para cima (+Y)
    if ((bz - az) * (qx - ax) - (bx - ax) * (qz - az) > 0) index.push(V(ax, az), V(bx, bz), V(qx, qz));
    else index.push(V(ax, az), V(qx, qz), V(bx, bz));
  };
  for (const k of leaves) {
    const [l, i, j] = decode(k);
    const s = NL >> l, x0 = i * s, z0 = j * s, h = s >> 1, n = 1 << l;
    const a = H(x0, z0), b = H(x0 + s, z0), c = H(x0, z0 + s), d = H(x0 + s, z0 + s);
    if (Math.max(a, b, c, d) < deep) continue;
    const fS = j > 0 && internal.has(KEY(l, i, j - 1)), fE = i < n - 1 && internal.has(KEY(l, i + 1, j));
    const fN = j < n - 1 && internal.has(KEY(l, i, j + 1)), fW = i > 0 && internal.has(KEY(l, i - 1, j));
    if (!(fS || fE || fN || fW)) {
      if (Math.abs(a - d) < Math.abs(b - c)) { tri(x0, z0, x0 + s, z0 + s, x0 + s, z0); tri(x0, z0, x0, z0 + s, x0 + s, z0 + s); }
      else { tri(x0, z0, x0, z0 + s, x0 + s, z0); tri(x0 + s, z0, x0, z0 + s, x0 + s, z0 + s); }
      continue;
    }
    const mx = x0 + h, mz = z0 + h;
    const edge = (ax, az, bx, bz, fine) => {
      if (fine) { const ex = (ax + bx) >> 1, ez = (az + bz) >> 1; tri(mx, mz, ax, az, ex, ez); tri(mx, mz, ex, ez, bx, bz); }
      else tri(mx, mz, ax, az, bx, bz);
    };
    edge(x0, z0, x0 + s, z0, fS); edge(x0 + s, z0, x0 + s, z0 + s, fE);
    edge(x0 + s, z0 + s, x0, z0 + s, fN); edge(x0, z0 + s, x0, z0, fW);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(index), 1));
  geo.computeVertexNormals();
  return { geo, H, step, NL };
}

// --------------------- média local das alturas (vale/crista) ----------
function boxBlur(H, N, r) {
  const tmp = new Float32Array(N * N), out = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    let acc = 0, cnt = 0;
    for (let i = -r; i <= r; i++) { const ii = clamp(i, 0, N - 1); acc += H[j * N + ii]; cnt++; }
    for (let i = 0; i < N; i++) {
      tmp[j * N + i] = acc / cnt;
      const add = clamp(i + r + 1, 0, N - 1), rem = clamp(i - r, 0, N - 1);
      acc += H[j * N + add] - H[j * N + rem];
    }
  }
  for (let i = 0; i < N; i++) {
    let acc = 0, cnt = 0;
    for (let j = -r; j <= r; j++) { const jj = clamp(j, 0, N - 1); acc += tmp[jj * N + i]; cnt++; }
    for (let j = 0; j < N; j++) {
      out[j * N + i] = acc / cnt;
      const add = clamp(j + r + 1, 0, N - 1), rem = clamp(j - r, 0, N - 1);
      acc += tmp[add * N + i] - tmp[rem * N + i];
    }
  }
  return out;
}

// ======================= vegetação: texturas e malhas =======================
// Atlas 2:1 (metade esquerda: agulhas de conífera, v = ápice→borda do andar;
// metade direita: tufos de folhas) + mapa de normais derivado da luminância.
let TREE_TEX = null;
function buildTreeAtlas(S) {
  if (TREE_TEX && TREE_TEX.size === S) return TREE_TEX;
  const W = S, Hh = S, HW = W / 2, k = S / 512;
  const cv = makeCanvas(W, Hh), g = cv.getContext('2d', { willReadFrequently: true });
  const r = createRng(SEED + 6262);
  // conífera: base escura que clareia para a borda (pontas dos galhos ao sol)
  const grd = g.createLinearGradient(0, 0, 0, Hh);
  grd.addColorStop(0, '#2a3527'); grd.addColorStop(0.6, '#3d4c35'); grd.addColorStop(1, '#55663f');
  g.fillStyle = grd; g.fillRect(0, 0, HW, Hh);
  g.save(); g.beginPath(); g.rect(0, 0, HW, Hh); g.clip();
  g.lineCap = 'round';
  for (let i = 0; i < 1100 * k * k; i++) {
    const x = r() * HW, y = r() * Hh * 1.05 - 0.05 * Hh, len = (14 + r() * 30) * k, ang = Math.PI / 2 + (r() - 0.5) * 0.7;
    const t = clamp(y / Hh, 0, 1), lum = 0.35 + 0.5 * t * (0.6 + 0.4 * r()) + 0.12 * r();
    const hue = 85 + r() * 30, sat = 22 + r() * 18;
    const col = `hsl(${hue},${sat}%,${Math.round(lum * 40)}%)`;
    wrapDraw(HW, Hh, x, y, 40 * k, (px, py) => {
      const ex = px + Math.cos(ang) * len, ey = py + Math.sin(ang) * len;
      g.strokeStyle = col; g.lineWidth = 1.6 * k;
      g.beginPath(); g.moveTo(px, py); g.lineTo(ex, ey); g.stroke();
      g.lineWidth = 0.9 * k;
      for (let q = 0.15; q < 1; q += 0.12) { // agulhas
        const qx = px + (ex - px) * q, qy = py + (ey - py) * q, nl = (4 + 4 * q) * k;
        g.beginPath(); g.moveTo(qx, qy); g.lineTo(qx + Math.cos(ang - 0.9) * nl, qy + Math.sin(ang - 0.9) * nl);
        g.moveTo(qx, qy); g.lineTo(qx + Math.cos(ang + 0.9) * nl, qy + Math.sin(ang + 0.9) * nl); g.stroke();
      }
    }, 0, false);
  }
  g.restore();
  // folhosa: base escura + aglomerados de folhas (claras no alto/esquerda)
  g.fillStyle = '#2c3a22'; g.fillRect(HW, 0, HW, Hh);
  g.save(); g.beginPath(); g.rect(HW, 0, HW, Hh); g.clip();
  for (let c = 0; c < 140 * k * k; c++) {
    const ccx = r() * HW, ccy = r() * Hh, cr = (16 + r() * 26) * k;
    const nLeaves = 26 + Math.floor(r() * 24);
    for (let i = 0; i < nLeaves; i++) {
      const a = r() * TAU, d = Math.sqrt(r()) * cr;
      const x = ccx + Math.cos(a) * d, y = ccy + Math.sin(a) * d;
      const top = 1 - (Math.sin(a) * d) / cr * 0.5 - (Math.cos(a) * d) / cr * 0.2; // lado de cima/esquerda mais claro
      const lum = clamp(0.3 + 0.32 * top * (0.7 + 0.5 * r()), 0.12, 0.85);
      const hue = 78 + r() * 30;
      g.fillStyle = `hsl(${hue},${30 + r() * 20}%,${Math.round(lum * 48)}%)`;
      const lw = (3 + r() * 4) * k, lh = lw * (0.45 + 0.2 * r()), rot = r() * Math.PI;
      wrapDraw(HW, Hh, x, y, 12 * k, (px, py) => { g.beginPath(); g.ellipse(px, py, lw, lh, rot, 0, TAU); g.fill(); }, HW, false);
    }
  }
  g.restore();
  const id = g.getImageData(0, 0, W, Hh).data;
  const Hgt = new Float32Array(W * Hh);
  for (let i = 0; i < W * Hh; i++) Hgt[i] = (id[i * 4] * 0.3 + id[i * 4 + 1] * 0.6 + id[i * 4 + 2] * 0.1) / 255;
  const nd = new Uint8Array(W * Hh * 4);
  // normais por metade (wrap horizontal dentro de cada metade)
  for (let half = 0; half < 2; half++) {
    const sub = new Float32Array(HW * Hh);
    for (let y = 0; y < Hh; y++) for (let x = 0; x < HW; x++) sub[y * HW + x] = Hgt[y * W + half * HW + x];
    const tmp = new Uint8Array(HW * Hh * 4);
    heightToNormal(sub, HW, Hh, 3.2, tmp, 0, 4, false);
    for (let y = 0; y < Hh; y++) for (let x = 0; x < HW; x++) {
      const o = (y * W + half * HW + x) * 4, t = (y * HW + x) * 4;
      nd[o] = tmp[t]; nd[o + 1] = tmp[t + 1]; nd[o + 2] = 255; nd[o + 3] = 255;
    }
  }
  // o normalMap do three usa (x, y, z): recompõe z
  for (let i = 0; i < W * Hh; i++) {
    const nx = nd[i * 4] / 127.5 - 1, ny = nd[i * 4 + 1] / 127.5 - 1;
    nd[i * 4 + 2] = Math.round(127.5 + 127.5 * Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)));
  }
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
  map.wrapS = THREE.ClampToEdgeWrapping; map.wrapT = THREE.ClampToEdgeWrapping;
  const nmap = dataTex(nd, W, Hh);
  nmap.wrapS = nmap.wrapT = THREE.ClampToEdgeWrapping;
  TREE_TEX = { size: S, map, nmap };
  return TREE_TEX;
}

// Monta uma BufferGeometry não indexada a partir de listas de triângulos.
function geoFromTris(P, Nr, UV, C) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(Nr), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(UV), 2));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(C), 3));
  g.computeBoundingSphere();
  return g;
}

// Conífera (altura 1): andares de galhos em estrela (raios alternados, pontas caídas),
// normais suaves de cone, UV na metade esquerda do atlas, oclusão por vértice (ápice de
// cada andar escuro, coberto pelo de cima; pontas claras).
function makeConiferGeometry(lo) {
  const P = [], Nr = [], UV = [], C = [];
  const r = createRng(SEED + 818);
  const push = (p, n, uv, c) => { P.push(...p); Nr.push(...n); UV.push(...uv); C.push(c, c, c); };
  const tiers = lo ? [[0.12, 1.0, 0.36, 6, 0.0]] : [[0.13, 0.56, 0.4, 7, 0.06], [0.33, 0.76, 0.31, 7, 0.05], [0.53, 0.92, 0.22, 7, 0.04], [0.72, 1.0, 0.12, 5, 0.02]];
  for (const [y0, y1, rad, seg, droop] of tiers) {
    const rim = [];
    const ph = r() * TAU;
    for (let k = 0; k < seg; k++) {
      const a = ph + (k / seg) * TAU + (r() - 0.5) * 0.35;
      const rr = rad * (k % 2 && !lo ? 0.78 : 1.0) * (0.9 + 0.2 * r());
      rim.push([Math.cos(a) * rr, y0 - (k % 2 ? 0 : droop), Math.sin(a) * rr, a]);
    }
    const slope = rad / (y1 - y0);
    const nrm = (a) => { const l = Math.hypot(1, slope); return [Math.cos(a) / l, slope / l, Math.sin(a) / l]; };
    const cA = lo ? 0.75 : 0.5, cR = lo ? 1.0 : (y0 < 0.2 ? 0.92 : 1.05);
    for (let k = 0; k < seg; k++) {
      const p0 = rim[k], p1 = rim[(k + 1) % seg];
      const am = p0[3] + (((p1[3] - p0[3]) % TAU) + TAU) % TAU * 0.5;
      const u0 = (k / seg) * 0.5, u1 = ((k + 1) / seg) * 0.5;
      push([0, y1, 0], nrm(am), [0.5 * (u0 + u1), 0.02], cA);
      push([p1[0], p1[1], p1[2]], nrm(p1[3]), [u1 * 0.998, 0.98], cR);
      push([p0[0], p0[1], p0[2]], nrm(p0[3]), [u0 + 0.001, 0.98], cR);
    }
  }
  if (!lo) { // tronco (3 faces, cor marrom "pré-dividida" pelo verde médio das instâncias)
    const avg = PAL.forestDark.clone().lerp(PAL.meadow, 0.3);
    const tc = (PAL.wood.r / avg.r + PAL.wood.g / avg.g + PAL.wood.b / avg.b) / 3 * 0.5;
    for (let k = 0; k < 3; k++) {
      const a0 = (k / 3) * TAU, a1 = ((k + 1) / 3) * TAU;
      const b0 = [Math.cos(a0) * 0.045, 0, Math.sin(a0) * 0.045], b1 = [Math.cos(a1) * 0.045, 0, Math.sin(a1) * 0.045];
      const n = [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)];
      push([0, 0.34, 0], n, [0.25, 0.99], tc); push(b1, n, [0.25, 0.99], tc); push(b0, n, [0.25, 0.99], tc);
    }
  }
  return geoFromTris(P, Nr, UV, C);
}

// Folhosa (altura 1): copa em dois lóbulos (icosaedro deformado + octaedro), normais
// elipsoidais suaves, UV planar na metade direita do atlas, base da copa escura.
function makeBroadleafGeometry(lo) {
  const P = [], Nr = [], UV = [], C = [];
  const r = createRng(SEED + 929);
  const lobe = (src, cx, cy, cz, rx, ry, rz, jit) => {
    const g = src.index ? src.toNonIndexed() : src; const pa = g.attributes.position;
    const offs = new Map();
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      const key = x.toFixed(3) + ',' + y.toFixed(3) + ',' + z.toFixed(3);
      let o = offs.get(key); if (o === undefined) { o = 1 + (r() - 0.5) * jit; offs.set(key, o); }
      const px = cx + x * rx * o, py = cy + y * ry * o, pz = cz + z * rz * o;
      const nx = x / rx, ny = y / ry, nz = z / rz, nl = Math.hypot(nx, ny, nz);
      P.push(px, py, pz); Nr.push(nx / nl, ny / nl, nz / nl);
      UV.push(0.75 + 0.235 * clamp((px * 0.707 + pz * 0.707) / 0.42, -1, 1), clamp(0.5 - 0.47 * (py - 0.62) / 0.4, 0.02, 0.98));
      const c = 0.45 + 0.6 * smoothstep(-0.9, 0.8, y);
      C.push(c, c, c);
    }
    g.dispose(); src.dispose();
  };
  if (lo) lobe(new THREE.OctahedronGeometry(1, 0), 0, 0.6, 0, 0.42, 0.36, 0.42, 0.1);
  else {
    lobe(new THREE.IcosahedronGeometry(1, 0), 0, 0.6, 0, 0.42, 0.34, 0.42, 0.3);
    lobe(new THREE.OctahedronGeometry(1, 0), 0.16, 0.76, -0.1, 0.26, 0.22, 0.26, 0.25);
    const avg = PAL.forest.clone().lerp(PAL.meadow, 0.4);
    const tc = (PAL.wood.r / avg.r + PAL.wood.g / avg.g + PAL.wood.b / avg.b) / 3 * 0.45;
    for (let k = 0; k < 3; k++) {
      const a0 = (k / 3) * TAU, a1 = ((k + 1) / 3) * TAU;
      const n = [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)];
      P.push(0, 0.5, 0, Math.cos(a1) * 0.05, 0, Math.sin(a1) * 0.05, Math.cos(a0) * 0.05, 0, Math.sin(a0) * 0.05);
      for (let q = 0; q < 3; q++) { Nr.push(...n); UV.push(0.75, 0.97); C.push(tc, tc, tc); }
    }
  }
  return geoFromTris(P, Nr, UV, C);
}

// Pedra: icosaedro (detalhe 1) com vértices deslocados por ruído (mesmo deslocamento nos
// vértices coincidentes) → facetas angulosas; achatado em Y.
function makeRockGeometry(rng) {
  let geo = new THREE.IcosahedronGeometry(1, 1);
  if (geo.index) geo = geo.toNonIndexed();
  const pos = geo.attributes.position;
  const offs = new Map();
  const n = createNoise(SEED + 4243);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = x.toFixed(3) + ',' + y.toFixed(3) + ',' + z.toFixed(3);
    let o = offs.get(key);
    if (!o) { const s = 1 + 0.28 * n.noise3(x * 1.3, y * 1.3, z * 1.3) + rng.range(-0.08, 0.08); o = s; offs.set(key, o); }
    pos.setXYZ(i, x * o, y * o * (y < -0.3 ? 0.55 : 0.78), z * o);
  }
  geo.deleteAttribute('uv');
  geo.computeVertexNormals();
  return geo;
}
// Agulha de rocha no mar (altura 1 a partir de y=0): prisma de 7 lados afunilado, 5 anéis.
function makeStackGeometry() {
  const r = createRng(SEED + 5353), SEG = 7, RINGS = 5;
  const ring = [];
  for (let j = 0; j <= RINGS; j++) {
    const t = j / RINGS, row = [];
    for (let k = 0; k < SEG; k++) {
      const a = (k / SEG) * TAU + (r() - 0.5) * 0.4, rr = (1 - 0.38 * t) * (0.8 + 0.4 * r()) * (j === RINGS ? 0.85 : 1);
      row.push([Math.cos(a) * rr + (r() - 0.5) * 0.12, t + (j > 0 && j < RINGS ? (r() - 0.5) * 0.06 : 0), Math.sin(a) * rr]);
    }
    ring.push(row);
  }
  const P = [];
  const tri = (a, b, c) => P.push(...a, ...b, ...c);
  for (let j = 0; j < RINGS; j++) for (let k = 0; k < SEG; k++) {
    const a = ring[j][k], b = ring[j][(k + 1) % SEG], c = ring[j + 1][k], d = ring[j + 1][(k + 1) % SEG];
    tri(a, c, b); tri(b, c, d);
  }
  const top = [0, 1.04, 0];
  for (let k = 0; k < SEG; k++) tri(ring[RINGS][k], top, ring[RINGS][(k + 1) % SEG]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  g.computeVertexNormals();
  return g;
}

// ------------------------------ uma ilha ------------------------------
function buildIsland(island, opts) {
  const { quality, materials, geos } = opts;
  const low = quality === 'low';
  const ctx = islandCtx(island);
  const B = island.boundRadius, cx = island.cx, cz = island.cz, maxH = island.maxH;
  const rng = createRng(SEED + 9100 + island.id * 17);

  // ---- malha adaptativa ----
  const L = ISLANDS.TERRAIN_LEVELS;
  const { geo, H } = buildTerrainMesh(ctx, B, L, low ? ISLANDS.TERRAIN_LEAVES_LOW : ISLANDS.TERRAIN_LEAVES_HIGH);

  // ---- grade regular de cobertura (reaproveita as alturas da malha) ----
  const RN = ISLANDS.RASTER, RV = RN + 1, rs = (1 << L) / RN, rstep = (2 * B) / RN;
  const RY = new Float32Array(RV * RV);
  for (let j = 0; j < RV; j++) for (let i = 0; i < RV; i++) RY[j * RV + i] = H(i * rs, j * rs);
  const RNY = new Float32Array(RV * RV);
  for (let j = 0; j < RV; j++) for (let i = 0; i < RV; i++) {
    const hx = RY[j * RV + Math.min(RN, i + 1)] - RY[j * RV + Math.max(0, i - 1)];
    const hz = RY[Math.min(RN, j + 1) * RV + i] - RY[Math.max(0, j - 1) * RV + i];
    const dd = 2 * rstep;
    RNY[j * RV + i] = 1 / Math.hypot(hx / dd, hz / dd, 1);
  }
  const blurR = Math.max(2, Math.round(300 / rstep));
  const Hb = boxBlur(RY, RV, blurR);
  const REL = new Float32Array(RV * RV);
  for (let k = 0; k < RV * RV; k++) REL[k] = clamp((RY[k] - Hb[k]) / 70, -1, 1);
  const RF = new Float32Array(RV * RV), RS = new Float32Array(RV * RV), RR = new Float32Array(RV * RV), RG = new Float32Array(RV * RV);
  const cov = { sand: 0, grass: 0, forest: 0, rock: 0, peak: 0, scrub: 0, dry: 0 };
  for (let j = 0; j < RV; j++) for (let i = 0; i < RV; i++) {
    const k = j * RV + i, y = RY[k];
    if (y < -2) continue;
    const x = cx - B + i * rstep, z = cz - B + j * rstep;
    coverAt(y, RNY[k], REL[k], ctx.vegAt(x, z), ctx.forAt(x, z), ctx.bchAt(x, z), ctx.fineAt(x, z), maxH, cov);
    RF[k] = cov.forest; RS[k] = cov.sand; RR[k] = cov.rock; RG[k] = cov.grass;
  }
  const s = { y: 0, ny: 1, forest: 0, sand: 0, rock: 0, grass: 0, rel: 0 };
  const bil = (A, a, b, c, d, u, v) => (A[a] * (1 - u) + A[b] * u) * (1 - v) + (A[c] * (1 - u) + A[d] * u) * v;
  function sampleRaster(lx, lz) {
    const fx = (lx + B) / rstep, fz = (lz + B) / rstep;
    const i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= RN || j >= RN) return false;
    const u = fx - i, v = fz - j, a = j * RV + i, b = a + 1, c = a + RV, d = c + 1;
    s.y = bil(RY, a, b, c, d, u, v); s.ny = bil(RNY, a, b, c, d, u, v);
    s.forest = bil(RF, a, b, c, d, u, v); s.sand = bil(RS, a, b, c, d, u, v);
    s.rock = bil(RR, a, b, c, d, u, v); s.grass = bil(RG, a, b, c, d, u, v); s.rel = bil(REL, a, b, c, d, u, v);
    return true;
  }

  // ---- cores por vértice + máscaras de cobertura ----
  const pa = geo.attributes.position.array, na = geo.attributes.normal.array, nv = pa.length / 3;
  const colors = new Float32Array(nv * 3), cover = new Float32Array(nv * 4);
  const col = new THREE.Color();
  for (let v = 0; v < nv; v++) {
    const lx = pa[v * 3], y = pa[v * 3 + 1], lz = pa[v * 3 + 2], x = lx + cx, z = lz + cz;
    if (y <= ISLANDS.SKIRT_Y + 1) {
      colors[v * 3] = PAL.seabed.r; colors[v * 3 + 1] = PAL.seabed.g; colors[v * 3 + 2] = PAL.seabed.b;
      cover[v * 4 + 2] = 1; continue;
    }
    const ny = na[v * 3 + 1];
    sampleRaster(lx, lz);
    const fineN = ctx.fineAt(x, z), microN = ctx.microAt(x, z);
    const bchN = ctx.bchAt(x, z);
    coverAt(y, ny, s.rel, ctx.vegAt(x, z), ctx.forAt(x, z), bchN, fineN, maxH, cov);
    const rocky = y < 1 ? ctx.rockyAt(x, z) : 0;
    terrainColor(y, ny, s.rel, fineN, microN, rocky, cov, col);
    colors[v * 3] = col.r; colors[v * 3 + 1] = col.g; colors[v * 3 + 2] = col.b;
    let wr = cov.rock, ws = cov.sand * (1 - wr), wf = cov.forest;
    if (y < 0.3) { // fundo: areia nas praias, rocha nas costas rochosas
      const kk = smoothstep(0.3, -1.0, y);
      wr = lerp(wr, Math.max(wr, 0.12 + 0.85 * rocky), kk); ws = lerp(ws, 1 - wr, kk); wf *= 1 - kk;
    }
    cover[v * 4] = ws; cover[v * 4 + 1] = wf; cover[v * 4 + 2] = wr;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aCover', new THREE.BufferAttribute(cover, 4));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  const terrain = new THREE.Mesh(geo, materials.terrain);
  terrain.name = 'terreno:' + island.name;
  terrain.position.set(cx, 0, cz);
  terrain.matrixAutoUpdate = false; terrain.updateMatrix();

  let rMax = 0;
  for (let k = 0; k < 64; k++) rMax = Math.max(rMax, island.outlineRadius((k / 64) * TAU));
  rMax = Math.min(B, rMax * 1.02);
  const mat4 = new THREE.Matrix4(), pos3 = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3(), eul = new THREE.Euler();
  const icol = new THREE.Color();
  const UP = THREE.Object3D.DEFAULT_UP;
  const finishInst = (m) => {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.position.set(cx, 0, cz); m.matrixAutoUpdate = false; m.updateMatrix();
    m.computeBoundingSphere();
  };

  // ---- árvores: bosques densos em aglomerados + árvores soltas; coníferas no alto, folhosas nos vales ----
  const nCon = low ? ISLANDS.CONIFERS_LOW : ISLANDS.CONIFERS_HIGH, nBro = low ? ISLANDS.BROADLEAF_LOW : ISLANDS.BROADLEAF_HIGH;
  const nBush = low ? ISLANDS.BUSHES_LOW : ISLANDS.BUSHES_HIGH;
  const conifers = new THREE.InstancedMesh(geos.conifer, materials.tree, nCon);
  const broad = new THREE.InstancedMesh(geos.broadleaf, materials.tree, nBro + nBush);
  conifers.name = 'coniferas:' + island.name; broad.name = 'folhosas:' + island.name;
  let pc = 0, pb = 0;
  const placeTree = (lx, lz, inWood, forcedBush) => {
    const y = ctx.renderHeight(lx + cx, lz + cz);
    if (y < 3) return;
    const x = lx + cx, z = lz + cz;
    const sp = ctx.speciesAt(x, z);
    const pCon = clamp(0.3 + 0.55 * smoothstep(30, 260, y) + 0.4 * sp - 0.25 * s.rel, 0.04, 0.97);
    const yaw = rng() * TAU;
    if (forcedBush) {
      if (pb >= nBro + nBush) return;
      const h = rng.range(2.2, 5.5);
      pos3.set(lx, y - 0.25 * h, lz); quat.setFromAxisAngle(UP, yaw); scl.set(h * rng.range(1.1, 1.7), h, h * rng.range(1.1, 1.7));
      mat4.compose(pos3, quat, scl); broad.setMatrixAt(pb, mat4);
      icol.copy(PAL.scrub).lerp(PAL.forest, rng() * 0.6).lerp(PAL.grassDry, rng() * 0.3).multiplyScalar(rng.range(0.7, 0.95));
      broad.setColorAt(pb, icol); pb++;
      return;
    }
    const sink = (1 - s.ny) * 6 + 0.6;
    if (rng() < pCon) {
      if (pc >= nCon) return;
      const h = inWood ? lerp(ISLANDS.TREE_HEIGHT_MIN + 4, ISLANDS.TREE_HEIGHT_MAX, Math.pow(rng(), 0.8)) : lerp(ISLANDS.TREE_HEIGHT_MIN, ISLANDS.TREE_HEIGHT_MIN + 10, rng());
      const w = rng.range(0.5, 0.68) * (inWood ? 1 : 1.12);
      pos3.set(lx, y - sink, lz); quat.setFromAxisAngle(UP, yaw); scl.set(h * w, h, h * w);
      mat4.compose(pos3, quat, scl); conifers.setMatrixAt(pc, mat4);
      icol.copy(PAL.forestDark).lerp(PAL.forest, rng() * 0.5).multiplyScalar(rng.range(0.62, 0.86));
      icol.b *= rng.range(0.95, 1.12);
      conifers.setColorAt(pc, icol); pc++;
    } else {
      if (pb >= nBro) return;
      const h = lerp(ISLANDS.TREE_HEIGHT_MIN - 3, ISLANDS.TREE_HEIGHT_MIN + 8, rng()) * (inWood ? 1 : 0.85);
      const w = rng.range(1.0, 1.4);
      pos3.set(lx, y - sink, lz); quat.setFromAxisAngle(UP, yaw); scl.set(h * w, h * rng.range(0.9, 1.1), h * w);
      mat4.compose(pos3, quat, scl); broad.setMatrixAt(pb, mat4);
      icol.copy(PAL.forest).lerp(PAL.meadow, rng() * 0.55).lerp(PAL.grassDry, rng() * 0.2).multiplyScalar(rng.range(0.72, 0.98));
      broad.setColorAt(pb, icol); pb++;
    }
  };
  // aglomerados (mata fechada, mais densa nas bordas)
  for (let tries = 0; (pc < nCon * 0.92 || pb < nBro * 0.85) && tries < 9000; tries++) {
    const lx = rng.range(-rMax, rMax), lz = rng.range(-rMax, rMax);
    if (!sampleRaster(lx, lz) || s.forest < 0.35 || s.y < 4) continue;
    const n = 5 + Math.floor(rng() * 10), rad = rng.range(10, 26);
    for (let q = 0; q < n; q++) {
      const tx = lx + rng.gauss() * rad, tz = lz + rng.gauss() * rad;
      if (!sampleRaster(tx, tz)) continue;
      const f = s.forest, edge = 4 * f * (1 - f);
      if (rng() > (f * 0.9 + edge * 0.6) * smoothstep(0.5, 0.72, s.ny) * (1 - s.rock)) continue;
      placeTree(tx, tz, true, false);
    }
  }
  // árvores soltas nos prados + arbustos (prados, bordas de mata, sopé das praias)
  for (let tries = 0; tries < (nBush + 400) * 60 && (pb < nBro + nBush); tries++) {
    const lx = rng.range(-rMax, rMax), lz = rng.range(-rMax, rMax);
    if (lx * lx + lz * lz > rMax * rMax || !sampleRaster(lx, lz) || s.y < 4) continue;
    const slopeOK = smoothstep(0.55, 0.75, s.ny) * (1 - s.rock);
    const edge = 4 * s.forest * (1 - s.forest);
    if (rng() < (0.05 * s.grass + 0.5 * edge) * slopeOK) placeTree(lx, lz, false, true);
    else if (rng() < 0.006 * s.grass * slopeOK && pb < nBro) placeTree(lx, lz, false, false);
  }
  conifers.count = pc; broad.count = pb;
  finishInst(conifers); finishInst(broad);

  // ---- pedras, matacões e pedras na arrebentação ----
  const rockCount = low ? ISLANDS.ROCKS_LOW : ISLANDS.ROCKS_HIGH;
  const boulderCount = Math.min(rockCount, low ? ISLANDS.BOULDERS_LOW : ISLANDS.BOULDERS_HIGH);
  const surfCount = Math.round(rockCount * 0.15);
  const rocks = new THREE.InstancedMesh(geos.rock, materials.rock, rockCount);
  rocks.name = 'pedras:' + island.name;
  let placedR = 0;
  const steepNear = (lx, lz) => {
    let worst = 1;
    for (let q = 0; q < 4; q++) { const a = q * Math.PI / 2; if (sampleRaster(lx + Math.cos(a) * 45, lz + Math.sin(a) * 45)) worst = Math.min(worst, s.ny); }
    return worst;
  };
  const putRock = (lx, y, lz, sz, tall, bright) => {
    scl.set(sz * rng.range(0.8, 1.5), sz * rng.range(0.6, 1.0) * tall, sz * rng.range(0.8, 1.5));
    eul.set(rng.range(-0.4, 0.4), rng() * TAU, rng.range(-0.4, 0.4)); quat.setFromEuler(eul);
    pos3.set(lx, y - scl.y * 0.28, lz); mat4.compose(pos3, quat, scl); rocks.setMatrixAt(placedR, mat4);
    const peakW = smoothstep(0.68 * maxH, 0.95 * maxH, y);
    icol.copy(PAL.rockDark).lerp(PAL.rock, rng()).lerp(PAL.rockLight, 0.35 * rng() * peakW + 0.1 * rng() + bright);
    icol.multiplyScalar(rng.range(0.85, 1.1) * 1.35); // a textura de rocha tem média 0,5 → ~0,74 com o detalhe
    rocks.setColorAt(placedR, icol); placedR++;
  };
  // pedras soltas na arrebentação das costas rochosas
  for (let tries = 0; placedR < surfCount && tries < surfCount * 400; tries++) {
    const th = rng() * TAU, ro = island.outlineRadius(th), u = rng.range(0.88, 1.02);
    const lx = Math.cos(th) * ro * u, lz = Math.sin(th) * ro * u;
    const y = ctx.renderHeight(lx + cx, lz + cz);
    if (y > 1.2 || y < -2.5 || ctx.rockyAt(lx + cx, lz + cz) < 0.4) continue;
    putRock(lx, y, lz, rng.range(2.5, 7), 1, 0);
  }
  for (let tries = 0; placedR < rockCount && tries < rockCount * 300; tries++) {
    const lx = rng.range(-rMax, rMax), lz = rng.range(-rMax, rMax);
    if (lx * lx + lz * lz > rMax * rMax || !sampleRaster(lx, lz) || s.y < 1) continue;
    const ny = s.ny, rockW = s.rock, sandW = s.sand, forestW = s.forest;
    const wantBoulder = placedR < surfCount + boulderCount;
    let sz;
    if (wantBoulder) {
      if (ny < 0.8 || rockW > 0.4) continue;
      if (steepNear(lx, lz) > 0.6) continue;
      sz = rng.range(14, 30);
    } else {
      let prob;
      if (rockW > 0.35 && ny > 0.3) prob = 0.9; else if (sandW > 0.5) prob = 0.06; else prob = 0.03 * (1 - forestW);
      if (rng() > prob) continue;
      sz = 4 + 18 * rng() * rng();
    }
    putRock(lx, ctx.renderHeight(lx + cx, lz + cz), lz, sz, 1, wantBoulder ? 0.15 : 0);
  }
  rocks.count = placedR;
  finishInst(rocks);

  // ---- agulhas de rocha no mar ----
  const st = ctx.stacks.slice(0, low ? ISLANDS.STACKS_LOW : ISLANDS.STACKS_HIGH);
  const stacks = new THREE.InstancedMesh(geos.stack, materials.rock, Math.max(1, st.length));
  stacks.name = 'rochedos:' + island.name;
  st.forEach((o, k) => {
    eul.set(rng.range(-0.06, 0.06), o.rot, rng.range(-0.06, 0.06)); quat.setFromEuler(eul);
    pos3.set(o.x - cx, -8, o.z - cz); scl.set(o.r * rng.range(0.85, 1.15), o.h + 8, o.r * rng.range(0.85, 1.15));
    mat4.compose(pos3, quat, scl); stacks.setMatrixAt(k, mat4);
    icol.copy(PAL.rockDark).lerp(PAL.rockWarm, rng() * 0.6).multiplyScalar(rng.range(1.15, 1.4));
    stacks.setColorAt(k, icol);
  });
  stacks.count = st.length;
  finishInst(stacks);

  const tris = (geo.index.count / 3) + pc * (geos.conifer.attributes.position.count / 3) + pb * (geos.broadleaf.attributes.position.count / 3)
    + placedR * (geos.rock.attributes.position.count / 3) + st.length * (geos.stack.attributes.position.count / 3);
  return { island, cx, cz, terrain, conifers, broad, rocks, stacks, stats: { terrainTris: geo.index.count / 3, verts: nv, conifers: pc, broadleaf: pb, rocks: placedR, stacks: st.length, tris } };
}

// ------------------------------ API pública ---------------------------
export function createIslands(scene, worldData, opts = {}) {
  const quality = opts.quality || 'high';
  const low = quality === 'low';
  const group = new THREE.Group();
  group.name = 'ilhas';

  const D = buildDetailTextures(low ? ISLANDS.TEX_SIZE_LOW : ISLANDS.TEX_SIZE_HIGH);
  const uniforms = {
    tRock: { value: D.tRock }, tRockN: { value: D.tRockN }, tGround: { value: D.tGround }, tGroundN: { value: D.tGroundN }, tMisc: { value: D.tMisc },
    uFade: { value: new THREE.Vector4(...ISLANDS.DETAIL_FADE) },
    uTime: { value: 0 },
    uSigma: { value: new THREE.Vector3(...ISLANDS.WATER_SIGMA) },
    uSunW: { value: new THREE.Vector3(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z).normalize() },
  };
  const TA = buildTreeAtlas(low ? 256 : 512);
  const materials = {
    terrain: patchDetailMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }), uniforms, 'terrain'),
    rock: patchDetailMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 }), uniforms, 'rock'),
    tree: new THREE.MeshStandardMaterial({
      vertexColors: true, map: TA.map, normalMap: TA.nmap, normalScale: new THREE.Vector2(1.3, 1.3),
      roughness: 0.88, metalness: 0, side: THREE.DoubleSide,
    }),
  };
  const geos = {
    conifer: makeConiferGeometry(false), coniferLo: makeConiferGeometry(true),
    broadleaf: makeBroadleafGeometry(false), broadleafLo: makeBroadleafGeometry(true),
    rock: makeRockGeometry(createRng(SEED + 4242)), stack: makeStackGeometry(),
  };

  const built = [];
  for (const island of worldData.islands) {
    const it = buildIsland(island, { quality, materials, geos });
    group.add(it.terrain, it.conifers, it.broad, it.rocks, it.stacks);
    built.push(it);
  }
  scene.add(group);

  return {
    group,
    islands: built,
    stats: built.map((b) => b.stats),
    // LOD por ilha: malhas simples de árvore longe, vegetação/pedras somem muito longe
    // (seriam sub-pixel); o terreno fica sempre visível (frustum culling cuida do resto).
    update(camera, time) {
      uniforms.uTime.value = time || 0;
      const cp = camera.position;
      for (const it of built) {
        const d = Math.hypot(cp.x - it.cx, cp.z - it.cz, cp.y);
        const near = d < ISLANDS.TREE_LOD_DIST + it.island.R;
        it.conifers.geometry = near ? geos.conifer : geos.coniferLo;
        it.broad.geometry = near ? geos.broadleaf : geos.broadleafLo;
        it.conifers.visible = it.broad.visible = d < ISLANDS.TREE_VIS_DIST;
        it.rocks.visible = d < ISLANDS.ROCK_VIS_DIST;
      }
    },
  };
}
export const __islandsTest = { buildTerrainMesh: (...a) => buildTerrainMesh(...a), islandCtx: (i) => islandCtx(i) };
