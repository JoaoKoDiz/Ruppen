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
//  Relevo: grade ERODIDA assada offline (src/world/terrainGen.js → tools/bake-terrain.js →
//  src/world/terrainData.js; island.terrain em worldData): maciços com espinhaço, incisão fluvial
//  (lei de potência do fluxo) + difusão de encosta, erosão por gotas e térmica (tálus), drenagem
//  (fluxo MFD), máscaras de erosão/deposição/tálus e os rios principais até o mar.
//
//  Por ilha (6 draw calls, ≤ 160k triângulos em quality=high — o terreno se limita a TERRAIN_TRIS_*):
//    1. TERRENO: malha adaptativa (quadtree restrita, folhas de ~11 m na linha d'água, ≤ 22 m nos leitos
//       dos rios, refinamento guloso pelo erro no resto) amostrando renderHeight = grade erodida em
//       Catmull-Rom + rugosidade fina (≤ heightAt + 4,5 m) + leito/várzea dos rios escavados + falésias
//       costeiras onde não há praia + plataforma submersa suave (praias rasas → turquesa). Cor macro por
//       vértice (cobertura guiada pela hidrologia: mata nos vales e fugindo das cristas, rocha nua nas
//       cristas e picos, tálus nas encostas, leques aluviais de cascalho, fundos de vale mais verdes,
//       talvegues molhados, oclusão por cavidade) + máscaras (areia, mata, rocha, molhado) que o shader
//       (MeshStandardMaterial + onBeforeCompile) usa para misturar as fotos de detalhe: rocha TRIPLANAR
//       com estratos, fendas e líquen (+ normal), grama em tufos, dossel da mata visto de cima (+ normal),
//       areia com grão e marcas de ondulação (+ normal); duas escalas + ruído macro (sem repetição
//       visível), e o detalhe some com a distância na cor macro. Junto à água: areia molhada brilhante com
//       a borda da onda animada, renda de espuma, e o fundo submerso com absorção da água (Beer-Lambert
//       por canal) e cáusticas animadas — o oceano por cima fica translúcido no raso.
//    2. CONÍFERAS instanciadas (3 andares de galhos em estrela + ponta, textura de agulhas e normal);
//    3. FOLHOSAS + ARBUSTOS instanciados (copa em dois lóbulos, textura de tufos de folhas);
//    4. PEDRAS e matacões (icosaedro facetado com a textura de rocha triplanar);
//    5. AGULHAS DE ROCHA no mar (sea stacks) junto às falésias;
//    6. RIOS: fita d'água nos talvegues principais até o mar (estuário na foz), ondulação correndo.
// =====================================================================
import * as THREE from 'three';
import { COLORS, SEED, ISLANDS, SUN_DIR } from '../config.js';
import { createRng } from '../util/rng.js';
import { createNoise } from '../util/noise.js';
import { tex } from '../assets.js';

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
    scree: c(COLORS.scree),                            // tálus/cascalho de encosta
    gravel: c(COLORS.gravel),                          // leques aluviais
    lush: c(COLORS.meadowLush),                        // fundos de vale úmidos
    wetRock: c(COLORS.wetRock),                        // leito molhado dos talvegues
    river: c(COLORS.riverWater),
    riverShallow: c(COLORS.riverShallow),
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

// ================= texturas do terreno =================
// Fotos PBR reais (Poly Haven, CC0, via src/assets.js): rocha de falésia (triplanar nas
// encostas íngremes), rocha vista do alto (projeção de cima), grama com pedras, chão de
// mata, areia seca e areia molhada — usadas como MODULADORES da cor macro por vértice
// (cor / média da foto, com parte do matiz) em duas escalas + ruído macro, sumindo com a
// distância. Procedurais só o que as fotos não têm:
//  tGround  RG normal do dossel da mata visto de cima   A luminância das copas
//  tMisc    R grão   G cáusticas   B manchas (borda da onda)   A ruído macro (anti-repetição)
const TEX_SETS = [ // [id, hue (quanto do matiz da foto fica), tem normal]
  ['cliff_side', 0.3, true], ['aerial_rocks_02', 0.45, true], ['aerial_grass_rock', 0.55, true],
  ['forest_ground_04', 0.4, false], ['coast_sand_01', 0.5, true], ['damp_beach_sand', 0.5, false],
];
let DETAIL = null;
function buildDetailTextures(S) {
  if (DETAIL && DETAIL.size === S) return DETAIL;
  const T = makeTileNoise(SEED + 31337);
  const N = S * S;
  const vo = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  // ---------- misc: grão, cáusticas, manchas, ruído macro ----------
  const misc = new Uint8Array(N * 4);
  const caus = T.cells(9, 9, 3);
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S, i = y * S + x;
      const g = 0.5 + 0.16 * T.fbm(u, v, 64, 2) + 0.1 * T.fbm(u, v, 8, 2);
      T.voronoi(caus, u + 0.02 * T.fbm(u, v, 4, 2), v + 0.02 * T.fbm(u + 0.5, v, 4, 2), vo);
      const c = Math.pow(1 - smoothstep(0, 0.26, vo.f2 - vo.f1), 2.2);
      const mot = 0.5 + 0.5 * T.fbm(u + 0.2, v + 0.9, 4, 3);
      const mac = 0.5 + 0.62 * T.fbm(u + 0.7, v + 0.1, 2, 4);
      misc[i * 4] = clamp(g, 0, 1) * 255; misc[i * 4 + 1] = c * 255; misc[i * 4 + 2] = clamp(mot, 0, 1) * 255; misc[i * 4 + 3] = clamp(mac, 0, 1) * 255;
    }
  }
  // ---------- dossel da mata visto de cima: copas sobrepostas (cúpulas por célula) ----------
  const crowns = T.cells(9, 9, 4);
  const canH = new Float32Array(N), canL = new Float32Array(N);
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S, i = y * S + x;
      const X = u * 9 + 0.45 * T.fbm(u, v, 18, 2), Y = v * 9 + 0.45 * T.fbm(u + 0.5, v + 0.3, 18, 2), xi = Math.floor(X), yi = Math.floor(Y);
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
  const tGroundD = new Uint8Array(N * 4);
  heightToNormal(canH, S, S, S / 110, tGroundD, 0, 4);
  for (let i = 0; i < N; i++) { tGroundD[i * 4 + 2] = 128; tGroundD[i * 4 + 3] = canL[i] * 255; }
  // ---------- fotos ----------
  const photos = TEX_SETS.map(([id, hue, hasN]) => ({ id, hue, map: tex(id, 'diff'), nor: hasN ? tex(id, 'nor_gl') : null, mean: new THREE.Vector3(0.25, 0.22, 0.18) }));
  DETAIL = { size: S, tGround: dataTex(tGroundD, S, S), tMisc: dataTex(misc, S, S), photos, ready: false };
  return DETAIL;
}
// média LINEAR de cada foto (para usá-la como moduladora) assim que a imagem chega
function measurePhotos(D) {
  if (D.ready) return true;
  for (const p of D.photos) { const im = p.map && p.map.image; if (!im || !(im.width > 0) || (im.complete === false)) return false; }
  const cv = makeCanvas(32, 32), g = cv.getContext('2d', { willReadFrequently: true });
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  for (const p of D.photos) {
    g.clearRect(0, 0, 32, 32); g.drawImage(p.map.image, 0, 0, 32, 32);
    const d = g.getImageData(0, 0, 32, 32).data;
    let r = 0, gg = 0, b = 0;
    for (let i = 0; i < 1024; i++) { r += lin(d[i * 4]); gg += lin(d[i * 4 + 1]); b += lin(d[i * 4 + 2]); }
    p.mean.set(r / 1024, gg / 1024, b / 1024);
  }
  D.ready = true;
  return true;
}

// ======================= altura VISUAL da ilha =======================
// Grade erodida (worldData: island.terrain) amostrada em Catmull-Rom (superfície lisa, nunca mais de
// ~3 m acima do bilinear da jogabilidade) + rugosidade fina nas encostas, leitos dos rios escavados
// (canal sob a lâmina d'água), falésias nas costas sem praia, plataforma submersa suave e o pé das
// agulhas de rocha no mar. Sempre ≤ heightAt + ~4,5 m (folga de voo DOVE.ALT_MIN = 6 m).
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
  const SK = ISLANDS.SKIRT_Y, CT = ISLANDS.CLIFF_TOP, DM = ISLANDS.DETAIL_M;

  // ---- grade erodida ----
  const T = island.terrain, N = T.N, inv = 1 / T.cs, gx0 = T.x0, gz0 = T.z0, HG = T.h;
  // declive |∇h| por nó (para a rugosidade e as máscaras)
  const SL = new Float32Array(N * N);
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
    const k = j * N + i;
    SL[k] = Math.hypot(HG[k + 1] - HG[k - 1], HG[k + N] - HG[k - N]) * 0.5 * inv;
  }
  // cavidade (h − média 7×7 células): côncavo < 0 (talvegues, ravinas), convexo > 0 (cristas) — sombreia
  // o relevo erodido na cor macro (oclusão do céu nos vales), legível de longe
  const CAV = new Float32Array(N * N);
  {
    const tmp = new Float32Array(N * N), r = 3, w = 2 * r + 1;
    for (let j = 0; j < N; j++) for (let i = r; i < N - r; i++) { let a = 0; for (let q = -r; q <= r; q++) a += HG[j * N + i + q]; tmp[j * N + i] = a / w; }
    for (let j = r; j < N - r; j++) for (let i = r; i < N - r; i++) { let a = 0; for (let q = -r; q <= r; q++) a += tmp[(j + q) * N + i]; CAV[j * N + i] = HG[j * N + i] - a / w; }
  }
  const G = { fx: 0, fz: 0, k: 0, u: 0, v: 0 };
  const locate = (x, z) => {
    let fx = (x - gx0) * inv, fz = (z - gz0) * inv;
    fx = fx < 1 ? 1 : fx > N - 2.001 ? N - 2.001 : fx;
    fz = fz < 1 ? 1 : fz > N - 2.001 ? N - 2.001 : fz;
    const ix = fx | 0, iz = fz | 0;
    G.k = iz * N + ix; G.u = fx - ix; G.v = fz - iz;
  };
  const bil = (A) => { const k = G.k, u = G.u, v = G.v; return (A[k] * (1 - u) + A[k + 1] * u) * (1 - v) + (A[k + N] * (1 - u) + A[k + N + 1] * u) * v; };
  const cr = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  // Catmull-Rom 4×4 (lisa entre células: sem facetas da grade de 13–21 m)
  function smoothH() {
    const k = G.k, u = G.u, v = G.v;
    const r0 = cr(HG[k - N - 1], HG[k - N], HG[k - N + 1], HG[k - N + 2], u);
    const r1 = cr(HG[k - 1], HG[k], HG[k + 1], HG[k + 2], u);
    const r2 = cr(HG[k + N - 1], HG[k + N], HG[k + N + 1], HG[k + N + 2], u);
    const r3 = cr(HG[k + 2 * N - 1], HG[k + 2 * N], HG[k + 2 * N + 1], HG[k + 2 * N + 2], u);
    return cr(r0, r1, r2, r3, v);
  }
  // máscaras hidrológicas (fluxo 0..1, erosão m, deposição m, declive)
  const hydro = (x, z, out) => { locate(x, z); out.flow = bil(T.flow); out.ero = bil(T.ero); out.dep = bil(T.dep); out.tal = bil(T.tal); out.slope = bil(SL); out.cav = bil(CAV); return out; };

  // ---- rios: polilinhas suavizadas, nível d'água monotônico, índice espacial ----
  const rivers = buildRivers(island, (x, z) => { locate(x, z); return bil(HG); });
  const RC = 48, rmap = new Map();
  rivers.forEach((r, ri) => {
    for (let n = 0; n < r.n - 1; n++) {
      const reach = Math.max(r.hw[n], r.hw[n + 1]) + ISLANDS.RIVER_PLAIN + 40;
      const xa = Math.min(r.x[n], r.x[n + 1]) - reach, xb = Math.max(r.x[n], r.x[n + 1]) + reach;
      const za = Math.min(r.z[n], r.z[n + 1]) - reach, zb = Math.max(r.z[n], r.z[n + 1]) + reach;
      for (let a = Math.floor(xa / RC); a <= Math.floor(xb / RC); a++) for (let b = Math.floor(za / RC); b <= Math.floor(zb / RC); b++) {
        const key = a * 100003 + b;
        let l = rmap.get(key);
        if (!l) rmap.set(key, (l = []));
        l.push(ri, n);
      }
    }
  });
  const RQ = { s: 0, hw: 0, yw: 0, ri: -1 };
  const RIVER_PLAIN = ISLANDS.RIVER_PLAIN;
  // segmento de rio mais próximo (distância ao eixo, meia-largura e nível d'água interpolados)
  function riverAt(x, z) {
    const l = rmap.get(Math.floor(x / RC) * 100003 + Math.floor(z / RC));
    if (!l) return false;
    let best = 1e9;
    for (let q = 0; q < l.length; q += 2) {
      const r = rivers[l[q]], n = l[q + 1];
      const ax = r.x[n], az = r.z[n], dx = r.x[n + 1] - ax, dz = r.z[n + 1] - az;
      const L2 = dx * dx + dz * dz;
      let t = L2 > 0 ? ((x - ax) * dx + (z - az) * dz) / L2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + dx * t - x, pz = az + dz * t - z, d2 = px * px + pz * pz;
      const hw = r.hw[n] + (r.hw[n + 1] - r.hw[n]) * t;
      const sc = Math.sqrt(d2) - hw; // distância à margem (negativa dentro)
      if (sc < best) { best = sc; RQ.s = Math.sqrt(d2); RQ.hw = hw; RQ.yw = r.yw[n] + (r.yw[n + 1] - r.yw[n]) * t; RQ.ri = l[q]; }
    }
    return best < 60;
  }

  function baseHeight(x, z) {
    const h0 = island.heightAt(x, z);
    if (h0 === -Infinity) return SK;
    locate(x, z);
    let h = Math.min(smoothH(), h0 + 3);
    if (h0 > 4) { // rugosidade fina (só visual): mais nas encostas íngremes, quase nada nos fundos de vale
      const sl = bil(SL), m = smoothstep(4, 40, h0);
      const amp = DM * (0.25 + 0.75 * smoothstep(0.25, 0.9, sl)) * m;
      const e1 = enoise.fbm2(x / 47 + 17.3, z / 47 - 9.1, 3, 2.1, 0.5);
      const e2 = enoise.ridged2(x / 160 - 3.3, z / 160 + 7.7, 2, 2.0, 0.5);
      h += amp * (0.7 * e1 - 0.9 * (1 - e2) * (1 - e2) + 0.2);
    }
    let rocky = -1;
    if (h0 < 22 && h0 > -40) { // falésia costeira: a borda fica a `top` m e a face cai até o fundo
      rocky = rockyAt(x, z);
      if (rocky > 0.002) {
        const fn = fineAt(x, z), mn = enoise.noise2(x / 21 + 3.3, z / 21 - 7.7);
        const top = CT[0] + (CT[1] - CT[0]) * rocky + 2.2 * fn;
        const k = smoothstep(top - 0.3, top - 1.25, h0 + 0.55 * mn);
        // borda erguida (≤ CLIFF_RAISE m, dentro da folga de voo DOVE.ALT_MIN) que some terra adentro
        const plateau = h + ISLANDS.CLIFF_RAISE * (1 - smoothstep(top, top + 16, h0)) * (0.75 + 0.25 * mn);
        const sea = Math.min(h0, top - 2) - 11 - 2 * rocky + 2.5 * mn;
        h = lerp(h, lerp(plateau, Math.min(sea, plateau), k), smoothstep(0, 0.6, rocky));
      }
    }
    // leito do rio (só escava): canal sob a lâmina d'água, várzea plana de cascalho dos dois lados (a malha
    // grossa a representa sem esconder a água) e margens subindo
    if (riverAt(x, z)) {
      const s = RQ.s, hw = RQ.hw, yw = RQ.yw, fp = hw + RIVER_PLAIN;
      const carved = s < hw ? yw - 0.25 - (0.4 + 0.06 * hw) * (1 - (s / hw) * (s / hw)) : s < fp ? yw - 0.25 + 0.5 * (s - hw) / RIVER_PLAIN : yw + 0.25 + (s - fp) * 0.55;
      if (carved < h) h = carved;
    }
    if (h < 0) { // plataforma submersa: rasa e suave nas praias, mais funda nas costas rochosas
      if (rocky < 0) rocky = rockyAt(x, z);
      const d = -h;
      const dS = 10 * (1 - Math.exp(-d / 10)) + 0.12 * d, dR = 6 * (1 - Math.exp(-d / 6)) + 0.4 * d;
      h = -lerp(dS, dR, rocky);
    }
    return Math.min(h, h0 + 4.5);
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
  c = { island, cx: island.cx, cz: island.cz, noise, vegAt, forAt, bchAt, fineAt, microAt, speciesAt, rockyAt, renderHeight, stacks, hydro, rivers, riverAt, RQ };
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
//   hy     máscaras da erosão assada: flow (0..1, log da área drenada), ero / dep (m escavados / depositados)
function coverAt(y, ny, relief, vegN, forN, bchN, fineN, maxH, hy, out) {
  const sandTop = ISLANDS.SAND_MAX_Y * (0.35 + 1.0 * smoothstep(-0.45, 0.45, bchN));
  const yS = y + 1.6 * fineN;
  const sand = (1 - smoothstep(sandTop - 1.5, sandTop + 2.5, yS)) * smoothstep(0.78, 0.9, ny + 0.03 * fineN) * smoothstep(-5, -2, y);
  const sD = ny + 0.06 * fineN;
  const flow = hy.flow, chan = smoothstep(0.5, 0.66, flow);           // talvegues (canais com água)
  const vale = smoothstep(0.24, 0.42, flow) * (1 - smoothstep(0.0, 0.5, relief)); // fundos de vale
  // rocha nua: encostas íngremes, alto da montanha e as CRISTAS (divisores de água)
  const crest = smoothstep(0.35, 0.85, relief) * smoothstep(0.42 * maxH, 0.72 * maxH, y + 50 * fineN) * (1 - smoothstep(0.2, 0.34, flow));
  const rock = Math.max(smoothstep(0.74, 0.58, sD), smoothstep(0.7 * maxH, 0.88 * maxH, y + 45 * fineN + 30 * vegN), 0.85 * crest);
  const peak = smoothstep(0.68 * maxH, 0.95 * maxH, y);
  // tálus/cascalho: cones da erosão térmica no pé das encostas íngremes + ravinas muito erodidas
  const scree = clamp(smoothstep(16, 55, hy.tal + 12 * fineN) * smoothstep(0.96, 0.8, sD) + 0.7 * smoothstep(80, 150, hy.ero + 30 * fineN) * smoothstep(0.92, 0.76, sD), 0, 1)
    * smoothstep(30, 140, y) * (1 - rock) * (1 - 0.6 * vale);
  // leques aluviais / cascalheiras: deposição das gotas em terreno suave (saída dos vales)
  const gravel = smoothstep(10, 28, hy.dep + 4 * fineN) * smoothstep(0.34, 0.5, flow) * smoothstep(0.86, 0.95, ny) * (1 - sand) * smoothstep(1, 5, y);
  const alluv = smoothstep(3, 14, hy.dep) * smoothstep(0.85, 0.95, ny) * (1 - gravel);   // solo aluvial (verde)
  const treeline = 1 - smoothstep(ISLANDS.TREELINE * maxH * 0.8, ISLANDS.TREELINE * maxH, y + 40 * fineN - 120 * vale);
  // mata segue os vales (umidade) e foge das cristas
  const f = 0.6 * forN - 0.75 * relief + 0.08 * fineN + 0.5 * vale + 0.15 * chan - 0.35 * crest;
  const forest = smoothstep(-0.12, 0.22, f) * treeline * smoothstep(4, 12, y) * smoothstep(0.5, 0.7, ny) * (1 - sand) * (1 - rock) * (1 - 0.7 * scree) * (1 - 0.8 * gravel);
  const scrub = clamp(smoothstep(0.2 * maxH, 0.42 * maxH, y + 30 * vegN) + 0.45 * smoothstep(0.25, 0.9, relief) - 0.5 * vale, 0, 1);
  const dry = smoothstep(-0.15, 0.75, 1.3 * vegN + 0.6 * relief + 0.12 * fineN - 0.9 * vale);
  out.sand = sand; out.rock = rock; out.peak = peak; out.forest = forest; out.scrub = scrub; out.dry = dry;
  out.scree = scree; out.gravel = gravel * (1 - rock); out.lush = Math.max(vale, alluv) * (1 - rock); out.wet = chan * (1 - sand);
  out.grass = clamp(1 - sand - forest, 0, 1) * (1 - rock);
  return out;
}

const _tmpA = new THREE.Color(), _tmpB = new THREE.Color();
// Cor macro do vértice (linear) a partir dos pesos de cobertura — é o que se vê de longe.
function terrainColor(y, ny, relief, fineN, microN, rocky, cov, out) {
  out.copy(PAL.meadowDark).lerp(PAL.meadow, clamp(0.55 + 0.6 * relief + 0.15 * fineN, 0, 1));
  out.lerp(PAL.grassDry, cov.dry);
  out.lerp(PAL.scrub, cov.scrub * 0.85);
  out.lerp(PAL.lush, cov.lush * 0.55);                       // fundos de vale mais verdes
  { const l = 0.2126 * out.r + 0.7152 * out.g + 0.0722 * out.b; out.lerp(_tmpB.setRGB(l, l, l), 0.18); }
  out.multiplyScalar(0.9);
  _tmpA.copy(PAL.gravel).lerp(PAL.sandLight, 0.25 + 0.25 * fineN);
  out.lerp(_tmpA, cov.gravel * 0.65);                        // leques aluviais (cascalho claro)
  _tmpA.copy(PAL.carpet).lerp(PAL.forestDark, clamp(0.5 + 0.5 * fineN, 0, 1));
  out.lerp(_tmpA, Math.min(1, cov.forest * 1.15));
  if (cov.sand > 0.001) {
    _tmpB.copy(PAL.sandWet).lerp(PAL.sand, smoothstep(0, ISLANDS.SAND_WET_Y, y));
    _tmpB.lerp(PAL.sandLight, 0.75 * smoothstep(ISLANDS.SAND_WET_Y, ISLANDS.SAND_MAX_Y + 2, y));
    out.lerp(_tmpB, cov.sand);
  }
  _tmpB.copy(PAL.scree).lerp(PAL.rock, clamp(0.4 + 0.5 * fineN, 0, 1));
  out.lerp(_tmpB, cov.scree * 0.85);                         // tálus nas encostas erodidas
  _tmpB.copy(PAL.rockDark).lerp(PAL.rock, clamp(0.5 + 0.4 * fineN + 0.2 * microN, 0, 1));
  _tmpB.lerp(PAL.rockWarm, 0.5 * (1 - smoothstep(150, 400, y)));
  _tmpB.lerp(PAL.rockLight, cov.peak * clamp(0.6 + 0.4 * fineN, 0, 1));
  out.lerp(_tmpB, cov.rock);
  // talvegues: rocha/solo molhados (escuros)
  out.lerp(_tmpB.copy(PAL.wetRock).lerp(out, 0.3), cov.wet * 0.7);
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
uniform sampler2D tCliff;
uniform sampler2D tCliffN;
uniform sampler2D tRockTop;
uniform sampler2D tRockTopN;
uniform sampler2D tGrass;
uniform sampler2D tGrassN;
uniform sampler2D tForest;
uniform sampler2D tSand;
uniform sampler2D tSandN;
uniform sampler2D tWet;
uniform sampler2D tGround;
uniform sampler2D tMisc;
uniform vec3 uMean[6];   // média linear de cada foto: falésia, rocha de cima, grama, mata, areia, areia molhada
uniform vec4 uHue0;      // quanto do matiz de cada foto fica (0 = só luminância)
uniform vec2 uHue1;
uniform float uReady;    // 0 até as fotos chegarem
uniform vec4 uFade;
uniform float uTime;
uniform vec3 uSigma;
uniform vec3 uSunW;
varying vec3 vDtPos;
varying vec3 vDtNrm;
#ifdef DT_TERRAIN
varying vec4 vDtCover;
#endif
// foto → modulador da cor macro (média 1), mantendo uma fração do matiz
vec3 dtMod(vec3 c, vec3 mean, float hue) {
  vec3 r = c / max(mean, vec3(1e-3));
  float l = dot(r, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(l), r, hue);
}
// amostra "passa-alta": divide pela própria foto borrada (mip ~4 níveis acima) → fica só o
// detalhe fino; as manchas grandes do tile (que denunciam a repetição) somem. O matiz médio
// da foto vem de 'mean'.
vec3 dtHP(sampler2D t, vec2 uv, vec2 gx, vec2 gy, vec3 mean, float hue) {
  vec3 c = textureGrad(t, uv, gx, gy).rgb;
  vec3 b = textureGrad(t, uv, gx * 14.0, gy * 14.0).rgb;
  return dtMod(c / max(b, vec3(1e-3)) * mean, mean, hue);
}
vec2 dtNrm(sampler2D t, vec2 uv, vec2 gx, vec2 gy) { return textureGrad(t, uv, gx, gy).rg * 2.0 - 1.0; }
// rocha triplanar: faces laterais com a foto de falésia (estratos horizontais), topo com a rocha
// vista do alto. Devolve modulador (rgb) e perturbação da normal (mundo).
void dtRockTri(vec3 P, vec3 dx, vec3 dy, vec3 w, float sc, bool coarse, out vec3 m, out vec3 pert) {
  m = vec3(0.0); pert = vec3(0.0); float ws = 0.0;
  if (w.x > 0.03) {
    vec2 uv = P.zy * sc, gx = dx.zy * sc, gy = dy.zy * sc;
    vec2 n = coarse ? dtNrm(tRockTopN, uv, gx, gy) : dtNrm(tCliffN, uv, gx, gy);
    m += (coarse ? dtHP(tRockTop, uv, gx, gy, uMean[1], uHue0.y) : dtMod(textureGrad(tCliff, uv, gx, gy).rgb, uMean[0], uHue0.x)) * w.x;
    pert += vec3(0.0, n.y, n.x) * w.x; ws += w.x;
  }
  if (w.y > 0.03) {
    float s2 = sc * 0.7;
    vec2 uv = P.xz * s2, gx = dx.xz * s2, gy = dy.xz * s2;
    vec2 n = dtNrm(tRockTopN, uv, gx, gy);
    m += dtHP(tRockTop, uv, gx, gy, uMean[1], uHue0.y) * w.y; pert += vec3(n.x, 0.0, n.y) * w.y; ws += w.y;
  }
  if (w.z > 0.03) {
    vec2 uv = P.xy * sc, gx = dx.xy * sc, gy = dy.xy * sc;
    vec2 n = coarse ? dtNrm(tRockTopN, uv, gx, gy) : dtNrm(tCliffN, uv, gx, gy);
    m += (coarse ? dtHP(tRockTop, uv, gx, gy, uMean[1], uHue0.y) : dtMod(textureGrad(tCliff, uv, gx, gy).rgb, uMean[0], uHue0.x)) * w.z;
    pert += vec3(n.x, n.y, 0.0) * w.z; ws += w.z;
  }
  m /= max(ws, 1e-4); pert /= max(ws, 1e-4);
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
  float fF = (1.0 - smoothstep(uFade.x, uFade.y, dist)) * uReady;
  float fC = 1.0 - smoothstep(uFade.z, uFade.w, dist);
  float fP = (1.0 - smoothstep(uFade.y, uFade.z * 2.6, dist)) * uReady;   // escala grossa das fotos (some antes: sem repetição visível de longe)
  dtFadeF = fF;
#ifdef DT_TERRAIN
  float ws = vDtCover.x, wf = vDtCover.y, wr = vDtCover.z;
  float wg = max(0.0, 1.0 - ws - wf - wr);
#else
  float ws = 0.0, wf = 0.0, wr = 1.0, wg = 0.0;
#endif
  if (fC > 0.001) {
    float macro = textureGrad(tMisc, P.xz * (1.0 / 730.0), dtDx.xz * (1.0 / 730.0), dtDy.xz * (1.0 / 730.0)).a;
    float mx = smoothstep(0.25, 0.75, macro);   // mistura entre as duas escalas (anti-repetição)
    vec3 modc = vec3(0.0), pert = vec3(0.0);
    float rough = 0.0;
    if (wr > 0.004) {
      vec3 w = pow(abs(Ng), vec3(4.0)); w /= (w.x + w.y + w.z);
      vec3 m1, m2, n1, n2;
      vec3 Pw = P + vec3(0.0, (macro - 0.5) * 22.0, 0.0);   // estratos ondulados (sem faixas retas)
      dtRockTri(Pw, dtDx, dtDy, w, 1.0 / 9.0, false, m1, n1);
      dtRockTri(Pw + vec3(37.0, 11.0, 53.0), dtDx, dtDy, w, 1.0 / 53.0, true, m2, n2);   // escala grossa: rocha sem estratos (sem faixas regulares)
      m2 = mix(vec3(1.0), m2, 0.4);
      float l1 = dot(m1, vec3(0.333)), l2 = dot(m2, vec3(0.333));
      float rh = clamp(0.5 + 0.6 * (mix(l2, l1, fF) - 1.0), 0.0, 1.0);
#ifdef DT_TERRAIN
      // transição pela luminância da foto: a rocha aflora primeiro nas partes claras/salientes
      float wr2 = clamp(wr + (rh - 0.5) * 3.0 * wr * (1.0 - wr) * uReady, 0.0, 1.0);
      float kO = (1.0 - wr2) / max(1.0 - wr, 1e-3);
      ws *= kO; wf *= kO; wg *= kO; wr = wr2;
#endif
      vec3 mr = mix(vec3(1.0), m1, fF * (0.55 + 0.35 * mx)) * mix(vec3(1.0), m2, fP * (0.75 - 0.3 * mx * fF));
      modc += mr * wr; pert += (n1 * (fF * 0.9) + n2 * (fP * 0.6)) * wr;
      rough += (0.74 + 0.16 * rh) * wr;
    }
#ifdef DT_TERRAIN
    if (wg > 0.004) {
      const mat2 R1 = mat2(0.825, 0.565, -0.565, 0.825);
      vec2 u1 = P.xz * (1.0 / 7.0), u2 = R1 * P.xz * (1.0 / 31.0);
      vec2 g1x = dtDx.xz * (1.0 / 7.0), g1y = dtDy.xz * (1.0 / 7.0);
      vec2 g2x = R1 * dtDx.xz * (1.0 / 31.0), g2y = R1 * dtDy.xz * (1.0 / 31.0);
      const mat2 R4 = mat2(-0.416, 0.909, -0.909, -0.416);
      vec2 u3 = R4 * P.xz * (1.0 / 12.7) + vec2(0.37, 0.61);
      vec2 g3x = R4 * dtDx.xz * (1.0 / 12.7), g3y = R4 * dtDy.xz * (1.0 / 12.7);
      vec3 g1 = dtHP(tGrass, u1, g1x, g1y, uMean[2], uHue0.z);
      vec3 g3 = dtHP(tGrass, u3, g3x, g3y, uMean[2], uHue0.z);
      vec3 g2 = dtHP(tGrass, u2, g2x, g2y, uMean[2], uHue0.z);
      // duas escalas finas com rotações diferentes, trocadas por ruído de ~100 m (a grade do tile some)
      float mA = textureGrad(tMisc, P.xz * (1.0 / 97.0), dtDx.xz * (1.0 / 97.0), dtDy.xz * (1.0 / 97.0)).a;
      vec3 gF = mix(g1, g3, smoothstep(0.35, 0.65, mA));
      vec2 gn = dtNrm(tGrassN, u1, g1x, g1y);
      vec3 mg = mix(vec3(1.0), gF, fF * 0.45) * mix(vec3(1.0), g2, fP * 0.3);
      modc += mg * wg; pert += vec3(gn.x, 0.0, gn.y) * (fF * 0.6 * wg); rough += 0.94 * wg;
    }
    if (wf > 0.004) {
      // dossel (procedural: copas vistas de cima, leem-se de longe) + chão de mata nos vãos (foto)
      const mat2 R2 = mat2(0.27, 0.963, -0.963, 0.27);
      vec2 u1 = P.xz * (1.0 / 58.0), u2 = R2 * P.xz * (1.0 / 171.0);
      vec2 g1x = dtDx.xz * (1.0 / 58.0), g1y = dtDy.xz * (1.0 / 58.0);
      vec2 g2x = R2 * dtDx.xz * (1.0 / 171.0), g2y = R2 * dtDy.xz * (1.0 / 171.0);
      vec4 c1 = textureGrad(tGround, u1, g1x, g1y);
      float c2 = textureGrad(tGround, u2, g2x, g2y).a;
      float dense = smoothstep(0.35, 0.85, wf);   // copas só na mata fechada (borda: chão de mata)
      vec3 mf = vec3((1.0 + fC * dense * (2.0 * c1.a - 1.0) * 0.7) * (1.0 + fC * (2.0 * c2 - 1.0) * 0.35));
      mf *= mix(vec3(1.0), mix(vec3(0.86, 0.93, 1.1), vec3(1.1, 1.05, 0.84), c1.a), fC * dense);
      vec2 fu = P.xz * (1.0 / 5.0);
      vec3 fg = dtHP(tForest, fu, dtDx.xz * 0.2, dtDy.xz * 0.2, uMean[3], uHue1.x);
      mf *= mix(vec3(1.0), fg, fF * mix(0.6, 0.45 * (1.0 - smoothstep(0.35, 0.6, c1.a)), dense));
      modc += mf * wf; pert += vec3(c1.r * 2.0 - 1.0, 0.0, c1.g * 2.0 - 1.0) * (fC * dense * wf); rough += 0.93 * wf;
    }
    if (ws > 0.004) {
      const mat2 R3 = mat2(0.76, 0.65, -0.65, 0.76);
      vec2 u1 = P.xz * (1.0 / 3.5), u2 = R3 * P.xz * (1.0 / 15.0);
      vec2 g1x = dtDx.xz * (1.0 / 3.5), g1y = dtDy.xz * (1.0 / 3.5);
      vec2 g2x = R3 * dtDx.xz * (1.0 / 15.0), g2y = R3 * dtDy.xz * (1.0 / 15.0);
      float wetS = 1.0 - smoothstep(0.5, 1.9, P.y);   // areia molhada junto à água (e submersa)
      vec3 sd = dtHP(tSand, u1, g1x, g1y, uMean[4], uHue1.y);
      vec3 sw = dtHP(tWet, u1 * 0.85, g1x * 0.85, g1y * 0.85, uMean[5], uHue1.y);
      vec3 s2 = dtHP(tSand, u2, g2x, g2y, uMean[4], uHue1.y);
      vec2 sn = dtNrm(tSandN, u1, g1x, g1y);
      vec3 ms = mix(vec3(1.0), mix(sd, sw, wetS), fF * 0.8) * mix(vec3(1.0), s2, fP * 0.45);
      modc += ms * ws; pert += vec3(sn.x, 0.0, sn.y) * (fF * 0.5 * ws); rough += mix(0.88, 0.55, wetS) * ws;
    }
#endif
    float wt = max(ws + wf + wr + wg, 1e-3);
    modc /= wt; pert /= wt; rough /= wt;
    diffuseColor.rgb *= modc;
    dtN = normalize(Ng + pert);
    dtRough = mix(dtRough, rough, fC);
  }
  dtWs = ws; dtWr = wr; dtWf = wf; dtWg = wg;
#ifdef DT_TERRAIN
  // talvegues/leitos molhados: mais escuros e com brilho (a cor macro já escureceu de longe)
  diffuseColor.rgb *= 1.0 - 0.18 * vDtCover.w * fC;
  dtRough = mix(dtRough, 0.38, vDtCover.w * 0.75 * fC);
#endif
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
    diffuseColor.rgb *= Td * min(Tu / max(Tg, 1e-4), vec3(4.0)) * (1.0 + 1.5 * caust);
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
function buildTerrainMesh(ctx, B, L, targetLeaves, coastLeaf = ISLANDS.COAST_LEAF, coarse = 1) {
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
    if (mx < -30) err *= 0.25;                              // fundo além da visibilidade da água
    else if (mx < -8) err = Math.max(err * 0.6, size * 0.012); // fundo raso visto através da água
    if (mn < 2.5 && mx > -3) err = Math.max(err, size * 0.16); // linha d'água: folhas pequenas
    else if (mn < 14 && mx > -8) err = Math.max(err, size * 0.03);
    return err;
  }
  leaves.add(KEY(0, 0, 0));
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
  // fase 1: a linha d'água (e a face das falésias) sempre com folhas de ≤ COAST_LEAF m
  const coastLevel = Math.min(L, Math.ceil(Math.log2((2 * B) / coastLeaf)));
  // leitos dos rios: folhas ≤ RIVER_LEAF sobre a várzea (senão a malha grossa cobre a lâmina d'água).
  // Máscara rasterizada (células de RIVER_LEAF/2) + tabela de somas para testar uma folha em O(1).
  const riverLeaf = ISLANDS.RIVER_LEAF * coarse, landLeafMax = ISLANDS.LAND_LEAF_MAX * coarse;
  const riverLevel = Math.min(L, Math.ceil(Math.log2((2 * B) / riverLeaf)));
  const RMc = riverLeaf / 2, RMn = Math.ceil((2 * B) / RMc) + 1;
  const RSAT = new Int32Array((RMn + 1) * (RMn + 1));
  {
    const M = new Uint8Array(RMn * RMn);
    for (const r of ctx.rivers) for (let n = 0; n < r.n - 1; n++) {
      if (r.hw[n] < ISLANDS.RIVER_LEAF_MIN_HW) continue;   // córregos estreitos: só o viés de profundidade
      const L2 = Math.hypot(r.x[n + 1] - r.x[n], r.z[n + 1] - r.z[n]), steps = Math.max(1, Math.ceil(L2 / (RMc * 0.5)));
      for (let q = 0; q <= steps; q++) {
        const t = q / steps, x = r.x[n] + (r.x[n + 1] - r.x[n]) * t - (ctx.cx - B), z = r.z[n] + (r.z[n + 1] - r.z[n]) * t - (ctx.cz - B);
        const rad = (r.hw[n] + ISLANDS.RIVER_PLAIN + 3) / RMc, ci = x / RMc, cj = z / RMc;
        for (let b = Math.floor(cj - rad); b <= Math.ceil(cj + rad); b++) for (let a = Math.floor(ci - rad); a <= Math.ceil(ci + rad); a++) {
          if (a < 0 || b < 0 || a >= RMn || b >= RMn || (a - ci) * (a - ci) + (b - cj) * (b - cj) > rad * rad) continue;
          M[b * RMn + a] = 1;
        }
      }
    }
    for (let b = 0; b < RMn; b++) for (let a = 0; a < RMn; a++)
      RSAT[(b + 1) * (RMn + 1) + a + 1] = M[b * RMn + a] + RSAT[b * (RMn + 1) + a + 1] + RSAT[(b + 1) * (RMn + 1) + a] - RSAT[b * (RMn + 1) + a];
  }
  const nearRiver = (l, i, j) => {
    const s = NL >> l, a0 = Math.max(0, Math.floor(i * s * step / RMc)), b0 = Math.max(0, Math.floor(j * s * step / RMc));
    const a1 = Math.min(RMn, Math.ceil((i + 1) * s * step / RMc)), b1 = Math.min(RMn, Math.ceil((j + 1) * s * step / RMc));
    return RSAT[b1 * (RMn + 1) + a1] - RSAT[b0 * (RMn + 1) + a1] - RSAT[b1 * (RMn + 1) + a0] + RSAT[b0 * (RMn + 1) + a0] > 0;
  };
  const isCoast = (l, i, j) => {
    const s = NL >> l, x0 = i * s, z0 = j * s, h = s >> 1;
    let mn = Infinity, mx = -Infinity;
    const q = Math.max(1, s >> 2);
    for (let a = 0; a <= s; a += q) for (let b = 0; b <= s; b += q) { const v = H(x0 + a, z0 + b); if (v < mn) mn = v; if (v > mx) mx = v; }
    return (mn < 0.3 && mx > -0.3) || (mn < 3 && mx - mn > 6 && mx > 0 && s * step < 200 && h >= 0); // cruza a água ou face de falésia
  };
  {
    const stack = [[0, 0, 0]];
    while (stack.length) {
      const [l, i, j] = stack.pop();
      const big = (NL >> l) * step > landLeafMax && H((NL >> l) * i + (NL >> (l + 1)), (NL >> l) * j + (NL >> (l + 1))) > -3;
      if (!big && (l >= coastLevel || !isCoast(l, i, j)) && (l >= riverLevel || !nearRiver(l, i, j))) continue;
      split(KEY(l, i, j), l, i, j, []);
      for (let c = 0; c < 4; c++) stack.push([l + 1, 2 * i + (c & 1), 2 * j + (c >> 1)]);
    }
  }
  // fase 2: refinamento guloso pelo erro com o resto do orçamento
  for (const k of leaves) { const [l, i, j] = decode(k); if (l < L) hpush(errorOf(l, i, j), k); }
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
    if (Math.max(a, b, c, d) < deep && (s < 2 || Math.max(H(x0 + h, z0 + h), H(x0 + h, z0), H(x0, z0 + h), H(x0 + s, z0 + h), H(x0 + h, z0 + s)) < deep)) continue;
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
const BARK_U0 = 0.94; // faixa do atlas com a casca dos troncos
function buildTreeAtlas(S) {
  if (TREE_TEX && TREE_TEX.size === S) return TREE_TEX;
  const W = S, Hh = S, HW = W / 2, k = S / 512;
  const cv = makeCanvas(W, Hh), g = cv.getContext('2d', { willReadFrequently: true });
  const r = createRng(SEED + 6262);
  // conífera: base escura que clareia para a borda (pontas dos galhos ao sol)
  const grd = g.createLinearGradient(0, 0, 0, Hh);
  grd.addColorStop(0, '#6f7a68'); grd.addColorStop(0.6, '#97a389'); grd.addColorStop(1, '#b4bf9c');
  g.fillStyle = grd; g.fillRect(0, 0, HW, Hh);
  g.save(); g.beginPath(); g.rect(0, 0, HW, Hh); g.clip();
  g.lineCap = 'round';
  for (let i = 0; i < 1100 * k * k; i++) {
    const x = r() * HW, y = r() * Hh * 1.05 - 0.05 * Hh, len = (14 + r() * 30) * k, ang = Math.PI / 2 + (r() - 0.5) * 0.7;
    const t = clamp(y / Hh, 0, 1), lum = 0.35 + 0.5 * t * (0.6 + 0.4 * r()) + 0.12 * r();
    const hue = 80 + r() * 30, sat = 12 + r() * 16;
    const col = `hsl(${hue},${sat}%,${Math.round(30 + lum * 52)}%)`;
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
  g.fillStyle = '#5f6b4f'; g.fillRect(HW, 0, HW, Hh);
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
      g.fillStyle = `hsl(${hue},${14 + r() * 16}%,${Math.round(28 + lum * 62)}%)`;
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
  // faixa da casca (u ≥ BARK_U0): marrom até a foto da casca chegar (paintBark)
  const bx = Math.floor(W * BARK_U0);
  g.fillStyle = '#5a4634'; g.fillRect(bx, 0, W - bx, Hh);
  for (let y = 0; y < Hh; y++) for (let x = bx; x < W; x++) { const o = (y * W + x) * 4; nd[o] = 128; nd[o + 1] = 128; nd[o + 2] = 255; }
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
  map.wrapS = THREE.ClampToEdgeWrapping; map.wrapT = THREE.ClampToEdgeWrapping;
  const nmap = dataTex(nd, W, Hh);
  nmap.wrapS = nmap.wrapT = THREE.ClampToEdgeWrapping;
  TREE_TEX = { size: S, map, nmap, cv, nd, W, Hh, bx, bark: tex('bark_brown_02', 'diff'), barkN: tex('bark_brown_02', 'nor_gl'), barkDone: false };
  return TREE_TEX;
}
// Pinta a foto da casca (Poly Haven bark_brown_02, cor + normal) na faixa dos troncos do atlas
// assim que as imagens chegam.
function paintBark(TA) {
  if (TA.barkDone) return;
  const im = TA.bark && TA.bark.image, imN = TA.barkN && TA.barkN.image;
  if (!im || !(im.width > 0) || im.complete === false || !imN || !(imN.width > 0) || imN.complete === false) return;
  const w = TA.W - TA.bx, H = TA.Hh;
  const g = TA.cv.getContext('2d');
  g.drawImage(im, 0, 0, im.width * 0.25, im.height, TA.bx, 0, w, H);    // um quarto da largura (casca não esticada)
  const c2 = makeCanvas(w, H), g2 = c2.getContext('2d', { willReadFrequently: true });
  g2.drawImage(imN, 0, 0, imN.width * 0.25, imN.height, 0, 0, w, H);
  const d = g2.getImageData(0, 0, w, H).data;
  for (let y = 0; y < H; y++) for (let x = 0; x < w; x++) {
    const o = (y * TA.W + TA.bx + x) * 4, q = (y * w + x) * 4;
    TA.nd[o] = d[q]; TA.nd[o + 1] = d[q + 1]; TA.nd[o + 2] = d[q + 2];
  }
  TA.map.needsUpdate = true; TA.nmap.needsUpdate = true;
  TA.barkDone = true;
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
    // casca (foto) × 1/verde médio das instâncias → a casca sai com a cor da foto
    const avg = PAL.forestDark.clone().multiplyScalar(1.6);
    const tc = 0.75 * 3 / (avg.r + avg.g + avg.b);
    for (let k = 0; k < 3; k++) {
      const a0 = (k / 3) * TAU, a1 = ((k + 1) / 3) * TAU;
      const b0 = [Math.cos(a0) * 0.045, 0, Math.sin(a0) * 0.045], b1 = [Math.cos(a1) * 0.045, 0, Math.sin(a1) * 0.045];
      const n = [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)];
      const u0 = BARK_U0 + 0.005 + (1 - BARK_U0 - 0.01) * k / 3, u1 = BARK_U0 + 0.005 + (1 - BARK_U0 - 0.01) * (k + 1) / 3;
      push([0, 0.34, 0], n, [(u0 + u1) / 2, 0.98], tc); push(b1, n, [u1, 0.02], tc); push(b0, n, [u0, 0.02], tc);
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
      UV.push(0.72 + 0.2 * clamp((px * 0.707 + pz * 0.707) / 0.42, -1, 1), clamp(0.5 - 0.47 * (py - 0.62) / 0.4, 0.02, 0.98));
      const c = 0.45 + 0.6 * smoothstep(-0.9, 0.8, y);
      C.push(c, c, c);
    }
    g.dispose(); src.dispose();
  };
  if (lo) lobe(new THREE.OctahedronGeometry(1, 0), 0, 0.6, 0, 0.42, 0.36, 0.42, 0.1);
  else {
    lobe(new THREE.IcosahedronGeometry(1, 0), 0, 0.6, 0, 0.42, 0.34, 0.42, 0.3);
    lobe(new THREE.OctahedronGeometry(1, 0), 0.16, 0.76, -0.1, 0.26, 0.22, 0.26, 0.25);
    const avg = PAL.forest.clone().lerp(PAL.meadow, 0.3).multiplyScalar(1.45);
    const tc = 0.75 * 3 / (avg.r + avg.g + avg.b);
    for (let k = 0; k < 3; k++) {
      const a0 = (k / 3) * TAU, a1 = ((k + 1) / 3) * TAU;
      const n = [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)];
      const u0 = BARK_U0 + 0.005 + (1 - BARK_U0 - 0.01) * k / 3, u1 = BARK_U0 + 0.005 + (1 - BARK_U0 - 0.01) * (k + 1) / 3;
      P.push(0, 0.5, 0, Math.cos(a1) * 0.05, 0, Math.sin(a1) * 0.05, Math.cos(a0) * 0.05, 0, Math.sin(a0) * 0.05);
      Nr.push(...n, ...n, ...n); UV.push((u0 + u1) / 2, 0.98, u1, 0.02, u0, 0.02); C.push(tc, tc, tc, tc, tc, tc, tc, tc, tc);
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

// ======================= rios (polilinhas assadas → lâmina d'água) =======================
// As polilinhas D8 da drenagem assada são suavizadas (Chaikin ×2) e reamostradas; o nível d'água
// é monotônico (nunca sobe rio abaixo) e mergulha sob o mar na foz, que se alarga (estuário).
// Afluentes terminam na margem do rio principal.
function buildRivers(island, bilH) {
  const src = island.terrain.rivers, cs = island.terrain.cs;
  const step = Math.max(9, cs * 0.85);
  const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const out = src.map((r) => {
    let P = [];
    for (let n = 0; n < r.pts.length; n += 3) P.push([r.pts[n], r.pts[n + 1], r.pts[n + 2]]);
    for (let it = 0; it < 2 && P.length > 2; it++) {
      const Q = [P[0]];
      for (let n = 0; n < P.length - 1; n++) { Q.push(mix3(P[n], P[n + 1], 0.25), mix3(P[n], P[n + 1], 0.75)); }
      Q.push(P[P.length - 1]); P = Q;
    }
    // reamostra por comprimento de arco
    const R = [P[0]];
    let acc = 0;
    for (let n = 1; n < P.length; n++) {
      const a = P[n - 1], b = P[n], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      let t0 = 0;
      while (acc + L * (1 - t0) >= step) { t0 += (step - acc) / L; R.push(mix3(a, b, t0)); acc = 0; }
      acc += L * (1 - t0);
    }
    if (acc > step * 0.3) R.push(P[P.length - 1]); else R[R.length - 1] = P[P.length - 1];
    let len = 0;
    for (let n = 1; n < R.length; n++) len += Math.hypot(R[n][0] - R[n - 1][0], R[n][1] - R[n - 1][1]);
    return { P: R, join: r.join, len };
  });
  const rivers = out.map((r) => {
    const n = r.P.length;
    const x = new Float32Array(n), z = new Float32Array(n), hw = new Float32Array(n), yw = new Float32Array(n);
    let ymin = Infinity;
    for (let i = 0; i < n; i++) {
      x[i] = r.P[i][0]; z[i] = r.P[i][1]; hw[i] = 0.5 * r.P[i][2];
      ymin = Math.min(ymin, bilH(x[i], z[i]));
      yw[i] = ymin + 0.3;
    }
    // foz: a lâmina desce abaixo do mar e o leito se alarga (estuário)
    if (r.join < 0) {
      let m = n - 1;
      for (let i = 0; i < n; i++) if (yw[i] < 0.9) { m = i; break; }
      const m0 = Math.max(0, m - 4);
      for (let i = m0; i < n; i++) {
        const t = (i - m0) / Math.max(1, n - 1 - m0);
        yw[i] = Math.min(yw[i], lerp(Math.min(yw[m0], 0.9), -1.2, t));
        hw[i] *= 1 + 1.4 * smoothstep(0, 1, t);
      }
    }
    return { n, x, z, hw, yw, join: r.join, len: r.len, mainLen: 0 };
  });
  // afluentes: terminam na margem do principal (sem lâminas sobrepostas)
  for (const r of rivers) {
    if (r.join < 0 || !rivers[r.join]) continue;
    const p = rivers[r.join], ex = r.x[r.n - 1], ez = r.z[r.n - 1];
    let phw = 4;
    { let bd = Infinity; for (let i = 0; i < p.n; i++) { const d = Math.hypot(p.x[i] - ex, p.z[i] - ez); if (d < bd) { bd = d; phw = p.hw[i]; } } }
    while (r.n > 2 && Math.hypot(r.x[r.n - 2] - ex, r.z[r.n - 2] - ez) < phw * 0.9) r.n--;
    r.x[r.n - 1] = r.x[r.n - 2] + (r.x[r.n - 1] - r.x[r.n - 2]) * 0.6; r.z[r.n - 1] = r.z[r.n - 2] + (r.z[r.n - 1] - r.z[r.n - 2]) * 0.6;
  }
  return rivers.filter((r) => r.len > 110 && r.n >= 3);
}

// Fita d'água de cada rio (3 vértices na seção: margens rasas e claras, centro fundo; corredeiras
// espumam onde o declive é forte). aFlow = direção × velocidade da correnteza (ondulação no shader).
function buildRiverGeometry(ctx) {
  const pos = [], col = [], flw = [], idx = [];
  const cx = ctx.cx, cz = ctx.cz, cDeep = PAL.river, cEdge = PAL.riverShallow, foam = new THREE.Color(0xdfe8e6), c = new THREE.Color();
  for (const r of ctx.rivers) {
    const base = pos.length / 3;
    for (let i = 0; i < r.n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(r.n - 1, i + 1);
      let tx = r.x[b] - r.x[a], tz = r.z[b] - r.z[a];
      const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
      const drop = Math.max(0, (r.yw[a] - r.yw[b]) / L);
      const rap = smoothstep(0.35, 0.8, drop);
      const w = r.hw[i] * 1.18, y = r.yw[i] + 0.12, nx = -tz, nz = tx;
      const sp = 0.6 + 4 * Math.min(0.4, drop);
      for (let s = -1; s <= 1; s++) {
        pos.push(r.x[i] + nx * w * s - cx, y, r.z[i] + nz * w * s - cz);
        c.copy(s === 0 ? cDeep : cEdge).lerp(cEdge, s === 0 ? smoothstep(10, 3, r.hw[i]) * 0.5 : 0).lerp(foam, rap * (s === 0 ? 0.3 : 0.5));
        col.push(c.r, c.g, c.b);
        flw.push(tx * sp, tz * sp);
      }
      if (i < r.n - 1) {
        const q = base + i * 3;
        idx.push(q, q + 1, q + 3, q + 1, q + 4, q + 3, q + 1, q + 2, q + 4, q + 2, q + 5, q + 4); // face para cima
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(pos.length).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  g.setAttribute('aFlow', new THREE.BufferAttribute(new Float32Array(flw), 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
// Água dos rios: PBR liso (reflete o céu/HDRI) + ondulação que corre rio abaixo (tMisc) e um
// pequeno viés de profundidade (∝ distância) para a lâmina não sumir sob triângulos grossos do terreno.
function makeRiverMaterial(uniforms) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0, envMapIntensity: 0.35 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tMisc = uniforms.tMisc; shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aFlow;\nvarying vec3 vRvPos;\nvarying vec2 vRvFlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRvPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvRvFlow = aFlow;')
      .replace('#include <logdepthbuf_vertex>', '#include <logdepthbuf_vertex>\n#ifdef USE_LOGARITHMIC_DEPTH_BUFFER\nvFragDepth = 1.0 + gl_Position.w * 0.9986;\n#endif');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tMisc;\nuniform float uTime;\nvarying vec3 vRvPos;\nvarying vec2 vRvFlow;')
      .replace('#include <normal_fragment_maps>', `{
        vec2 uv1 = vRvPos.xz * (1.0 / 7.0) - vRvFlow * uTime * 0.16;
        vec2 uv2 = vRvPos.xz * (1.0 / 2.9) - vRvFlow * uTime * 0.3 + 0.37;
        const float e = 0.015;
        float a = texture(tMisc, uv1).r + 0.5 * texture(tMisc, uv2).r;
        float b = texture(tMisc, uv1 + vec2(e, 0.0)).r + 0.5 * texture(tMisc, uv2 + vec2(e, 0.0)).r;
        float c = texture(tMisc, uv1 + vec2(0.0, e)).r + 0.5 * texture(tMisc, uv2 + vec2(0.0, e)).r;
        float fade = 1.0 - smoothstep(300.0, 2500.0, length(cameraPosition - vRvPos));
        vec3 nW = normalize(vec3((a - b) * 1.6 * fade, 1.0, (a - c) * 1.6 * fade));
        normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
      }`);
  };
  mat.customProgramCacheKey = () => 'ruppen-river';
  return mat;
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
  // orçamento: se as folhas forçadas (costa, rios) somadas ao refinamento passarem do teto de triângulos,
  // refaz com menos folhas no refinamento guloso
  const maxTris = low ? ISLANDS.TERRAIN_TRIS_LOW : ISLANDS.TERRAIN_TRIS_HIGH;
  let target = low ? ISLANDS.TERRAIN_LEAVES_LOW : ISLANDS.TERRAIN_LEAVES_HIGH;
  let coarse = 1;
  let mesh = buildTerrainMesh(ctx, B, L, target, ISLANDS.COAST_LEAF * (low ? 2 : 1), coarse);
  for (let it = 0; it < 4 && mesh.geo.index.count / 3 > maxTris; it++) {
    const over = (mesh.geo.index.count / 3) / maxTris;
    target = Math.floor(target / Math.pow(over, 1.6) * 0.97);
    if (it > 0 || over > 1.1) coarse *= 1.25;   // as folhas forçadas também engrossam (rios, terra firme)
    mesh = buildTerrainMesh(ctx, B, L, target, ISLANDS.COAST_LEAF * (low ? 2 : 1) * Math.sqrt(coarse), coarse);
  }
  const { geo, H } = mesh;

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
  const cov = { sand: 0, grass: 0, forest: 0, rock: 0, peak: 0, scrub: 0, dry: 0, scree: 0, gravel: 0, lush: 0, wet: 0 };
  const hy = { flow: 0, ero: 0, dep: 0, tal: 0, slope: 0, cav: 0 };
  const RW = new Uint8Array(RV * RV); // perto de rio (sem árvores nem pedras)
  for (let j = 0; j < RV; j++) for (let i = 0; i < RV; i++) {
    const k = j * RV + i, y = RY[k];
    if (y < -2) continue;
    const x = cx - B + i * rstep, z = cz - B + j * rstep;
    coverAt(y, RNY[k], REL[k], ctx.vegAt(x, z), ctx.forAt(x, z), ctx.bchAt(x, z), ctx.fineAt(x, z), maxH, ctx.hydro(x, z, hy), cov);
    RF[k] = cov.forest; RS[k] = cov.sand + 0.5 * cov.gravel; RR[k] = Math.max(cov.rock, cov.scree); RG[k] = cov.grass;
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
    let ny = na[v * 3 + 1];
    if (y < 30 && y > -20 && ctx.rockyAt(x, z) > 0.05) {
      // costa rochosa: inclinação exata da função (a face da falésia tem 1–2 células de largura)
      const e = 2.5, hx = ctx.renderHeight(x + e, z) - ctx.renderHeight(x - e, z), hz = ctx.renderHeight(x, z + e) - ctx.renderHeight(x, z - e);
      ny = Math.min(ny, 1 / Math.hypot(hx / (2 * e), hz / (2 * e), 1));
    }
    sampleRaster(lx, lz);
    const fineN = ctx.fineAt(x, z), microN = ctx.microAt(x, z);
    const bchN = ctx.bchAt(x, z);
    ctx.hydro(x, z, hy);
    // inclinação para a cobertura: a da grade erodida (13–21 m), não a da rugosidade fina da malha
    if (y > 25) ny = Math.max(ny, 1 / Math.sqrt(1 + hy.slope * hy.slope) - 0.03);
    coverAt(y, ny, s.rel, ctx.vegAt(x, z), ctx.forAt(x, z), bchN, fineN, maxH, hy, cov);
    // leito dos rios: cascalho molhado sob a lâmina d'água e nas margens
    if (y > -1 && ctx.riverAt(x, z)) {
      const rq = ctx.RQ, bank = 1 - smoothstep(rq.hw + ISLANDS.RIVER_PLAIN * 0.6, rq.hw + ISLANDS.RIVER_PLAIN + 6, rq.s);
      cov.wet = Math.max(cov.wet, bank); cov.gravel = Math.max(cov.gravel, 0.35 * bank * (1 - cov.rock));
      cov.forest *= 1 - bank; cov.sand *= 1 - bank; cov.dry *= 1 - bank;
    }
    const rocky = y < 1 ? ctx.rockyAt(x, z) : 0;
    terrainColor(y, ny, s.rel, fineN, microN, rocky, cov, col);
    if (y > 2) { // oclusão/convexidade do relevo erodido (a grade tem 13–21 m: escala dos vales e ravinas)
      const cv = clamp(hy.cav / (6 + 0.02 * maxH), -1, 1);
      col.multiplyScalar(1 + (cv < 0 ? 0.32 : 0.14) * cv);
    }
    colors[v * 3] = col.r; colors[v * 3 + 1] = col.g; colors[v * 3 + 2] = col.b;
    let wr = Math.max(cov.rock, cov.scree + 0.45 * cov.gravel), ws = Math.min(1 - wr, cov.sand * (1 - wr) + 0.3 * cov.gravel), wf = cov.forest * (1 - cov.scree);
    if (y < 0.3) { // fundo: areia nas praias, rocha nas costas rochosas
      const kk = smoothstep(0.3, -1.0, y);
      wr = lerp(wr, Math.max(wr, 0.12 + 0.85 * rocky), kk); ws = lerp(ws, 1 - wr, kk); wf *= 1 - kk;
    }
    cover[v * 4] = ws; cover[v * 4 + 1] = wf; cover[v * 4 + 2] = wr; cover[v * 4 + 3] = y > 0.4 ? cov.wet : 0;
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
  const nearRiver = (x, z, m) => ctx.riverAt(x, z) && ctx.RQ.s < ctx.RQ.hw + m;
  const placeTree = (lx, lz, inWood, forcedBush) => {
    const y = ctx.renderHeight(lx + cx, lz + cz);
    if (y < 3) return;
    const x = lx + cx, z = lz + cz;
    if (nearRiver(x, z, 4)) return;
    const sp = ctx.speciesAt(x, z);
    const pCon = clamp(0.3 + 0.55 * smoothstep(30, 260, y) + 0.4 * sp - 0.25 * s.rel, 0.04, 0.97);
    const yaw = rng() * TAU;
    if (forcedBush) {
      if (pb >= nBro + nBush) return;
      const h = rng.range(2.2, 5.5);
      pos3.set(lx, y - 0.25 * h, lz); quat.setFromAxisAngle(UP, yaw); scl.set(h * rng.range(1.1, 1.7), h, h * rng.range(1.1, 1.7));
      mat4.compose(pos3, quat, scl); broad.setMatrixAt(pb, mat4);
      icol.copy(PAL.scrub).lerp(PAL.forest, rng() * 0.6).lerp(PAL.grassDry, rng() * 0.3).multiplyScalar(rng.range(1.15, 1.5));
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
      icol.copy(PAL.forestDark).lerp(PAL.forest, rng() * 0.5).multiplyScalar(rng.range(1.35, 1.85));
      icol.b *= rng.range(0.95, 1.12);
      conifers.setColorAt(pc, icol); pc++;
    } else {
      if (pb >= nBro) return;
      const h = lerp(ISLANDS.TREE_HEIGHT_MIN - 3, ISLANDS.TREE_HEIGHT_MIN + 8, rng()) * (inWood ? 1 : 0.85);
      const w = rng.range(1.0, 1.4);
      pos3.set(lx, y - sink, lz); quat.setFromAxisAngle(UP, yaw); scl.set(h * w, h * rng.range(0.9, 1.1), h * w);
      mat4.compose(pos3, quat, scl); broad.setMatrixAt(pb, mat4);
      icol.copy(PAL.forest).lerp(PAL.meadow, rng() * 0.55).lerp(PAL.grassDry, rng() * 0.2).multiplyScalar(rng.range(1.25, 1.65));
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
    icol.multiplyScalar(rng.range(0.85, 1.1));
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
  // matacões no sopé das encostas íngremes (cones de tálus) e depois pedras soltas (rocha, tálus, cascalho)
  const nBoulder = surfCount + boulderCount;
  for (let tries = 0; placedR < nBoulder && tries < boulderCount * 400; tries++) {
    const lx = rng.range(-rMax, rMax), lz = rng.range(-rMax, rMax);
    if (lx * lx + lz * lz > rMax * rMax || !sampleRaster(lx, lz) || s.y < 1) continue;
    if (s.ny < 0.78 || s.rock > 0.5 || steepNear(lx, lz) > 0.66) continue;
    const sz = rng.range(12, 28);
    if (nearRiver(lx + cx, lz + cz, sz + 2)) continue;
    putRock(lx, ctx.renderHeight(lx + cx, lz + cz), lz, sz, 1, 0.15);
  }
  for (let tries = 0; placedR < rockCount && tries < rockCount * 300; tries++) {
    const lx = rng.range(-rMax, rMax), lz = rng.range(-rMax, rMax);
    if (lx * lx + lz * lz > rMax * rMax || !sampleRaster(lx, lz) || s.y < 1) continue;
    const ny = s.ny, rockW = s.rock, sandW = s.sand, forestW = s.forest;
    let prob;
    if (rockW > 0.35 && ny > 0.3) prob = 0.9; else if (sandW > 0.5) prob = 0.08; else prob = 0.03 * (1 - forestW);
    if (rng() > prob) continue;
    const sz = 4 + 18 * rng() * rng();
    if (nearRiver(lx + cx, lz + cz, sz + 2)) continue;
    putRock(lx, ctx.renderHeight(lx + cx, lz + cz), lz, sz, 1, 0);
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
    icol.copy(PAL.rockDark).lerp(PAL.rockWarm, rng() * 0.6).lerp(PAL.rock, 0.4).multiplyScalar(rng.range(0.9, 1.1));
    stacks.setColorAt(k, icol);
  });
  stacks.count = st.length;
  finishInst(stacks);

  // ---- rios: lâmina d'água nos talvegues principais até o mar ----
  const rgeo = buildRiverGeometry(ctx);
  const river = new THREE.Mesh(rgeo, materials.river);
  river.name = 'rios:' + island.name;
  river.position.set(cx, 0, cz); river.matrixAutoUpdate = false; river.updateMatrix();
  river.renderOrder = 1;
  const riverTris = rgeo.index ? rgeo.index.count / 3 : 0;

  const tris = (geo.index.count / 3) + pc * (geos.conifer.attributes.position.count / 3) + pb * (geos.broadleaf.attributes.position.count / 3)
    + placedR * (geos.rock.attributes.position.count / 3) + st.length * (geos.stack.attributes.position.count / 3) + riverTris;
  return { island, cx, cz, terrain, conifers, broad, rocks, stacks, river, stats: { terrainTris: geo.index.count / 3, verts: nv, conifers: pc, broadleaf: pb, rocks: placedR, stacks: st.length, rivers: ctx.rivers.length, riverTris, tris } };
}

// ------------------------------ API pública ---------------------------
export function createIslands(scene, worldData, opts = {}) {
  const quality = opts.quality || 'high';
  const low = quality === 'low';
  const group = new THREE.Group();
  group.name = 'ilhas';

  const D = buildDetailTextures(low ? ISLANDS.TEX_SIZE_LOW : ISLANDS.TEX_SIZE_HIGH);
  const uniforms = {
    tCliff: { value: D.photos[0].map }, tCliffN: { value: D.photos[0].nor },
    tRockTop: { value: D.photos[1].map }, tRockTopN: { value: D.photos[1].nor },
    tGrass: { value: D.photos[2].map }, tGrassN: { value: D.photos[2].nor },
    tForest: { value: D.photos[3].map },
    tSand: { value: D.photos[4].map }, tSandN: { value: D.photos[4].nor },
    tWet: { value: D.photos[5].map },
    tGround: { value: D.tGround }, tMisc: { value: D.tMisc },
    uMean: { value: D.photos.map((p) => p.mean) },
    uHue0: { value: new THREE.Vector4(D.photos[0].hue, D.photos[1].hue, D.photos[2].hue, D.photos[3].hue) },
    uHue1: { value: new THREE.Vector2(D.photos[3].hue, D.photos[4].hue) },
    uReady: { value: 0 },
    uFade: { value: new THREE.Vector4(...ISLANDS.DETAIL_FADE) },
    uTime: { value: 0 },
    uSigma: { value: new THREE.Vector3(...ISLANDS.WATER_SIGMA) },
    uSunW: { value: new THREE.Vector3(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z).normalize() },
  };
  const TA = buildTreeAtlas(low ? 256 : 512);
  const materials = {
    terrain: patchDetailMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }), uniforms, 'terrain'),
    rock: patchDetailMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 }), uniforms, 'rock'),
    river: makeRiverMaterial(uniforms),
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
    group.add(it.terrain, it.conifers, it.broad, it.rocks, it.stacks, it.river);
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
      if (!uniforms.uReady.value && measurePhotos(D)) uniforms.uReady.value = 1; // fotos carregadas
      paintBark(TA);
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
