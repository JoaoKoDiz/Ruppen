// =====================================================================
//  RUPPEN — VIDA em escala humana: navios com esteira, pássaros e multidões.
//
//  createLife(scene, { worldData, elephants, camera, quality }) → { update(dt, time, camera), object, debug }
//
//  • NAVIOS (3 InstancedMesh: cargueiros, dhows de vela latina, barcos de pesca): geometria procedural
//    (casco "loftado" por estações com faixas de pintura por vértice, superestrutura, contêineres,
//    mastros, velas enfunadas), PBR padrão (névoa/perspectiva aérea/sombras automáticas). Cada navio
//    segue uma função determinística do tempo: órbita elíptica ao redor de um elefante (no referencial
//    dele — passa entre as patas e a tromba) ou laço ao redor de uma ilha, sempre em água funda
//    (islandHeightAt). Arfagem/balanço com as MESMAS ondas de Gerstner do ocean.js (OCEAN.WAVES).
//  • ESTEIRA: uma malha única (todas as esteiras) recalculada por quadro a partir das posições
//    passadas (analíticas) da proa: braços de Kelvin, onda de proa colada ao casco e água revolvida
//    atrás da popa, espuma procedural amostrada em coordenadas de mundo, desvanecendo com a distância.
//  • PÁSSAROS (1 InstancedMesh, ≤ 400): bandos que circulam a cabeça e a cidade dos elefantes mais
//    próximos, o mercado, a costa da ilha mais próxima e o navio mais próximo; aves grandes planando
//    em térmicas perto da altitude da câmera. Batida de asas (com planeio intermitente) no vertex shader.
//  • MULTIDÕES (1 InstancedMesh por elefante próximo, filho de elephant.body → acompanha o balanço):
//    pessoas low-poly (62 tri) com roupas variadas, andando pelos corredores entre as bancas, ao
//    redor do chafariz e pela avenida central; vendedores atrás das bancas e fregueses parados.
//    Caminho, rotação e passada inteiramente no vertex shader (zero CPU por quadro).
//
//  Orçamento: ~6–10 draw calls (navios 3, esteira 1, pássaros 1, multidões ≤ 2–3), ≤ 30 sempre.
// =====================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LIFE, ELEPHANT, ELEPHANT_MODEL, OCEAN, SEED, COLORS } from '../config.js';
import { createRng } from '../util/rng.js';

const TAU = Math.PI * 2;
const V3 = THREE.Vector3;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;

// ------------------------------------------------------------------
//  Ondas: as mesmas de ocean.js (fase da mesma semente), só a componente vertical
// ------------------------------------------------------------------
const WAVES = (() => {
  const wind = THREE.MathUtils.degToRad(OCEAN.WIND_DEG);
  const prng = createRng(SEED + 7707);
  return OCEAN.WAVES.map(([lam, A, dd]) => {
    const k = TAU / lam, a = wind + THREE.MathUtils.degToRad(dd);
    return { dx: Math.cos(a), dz: Math.sin(a), k, A, w: Math.sqrt(9.81 * k), ph: prng() * TAU };
  });
})();
// Altura da superfície do ocean.js no ponto (x,z) do MUNDO, como o vertex shader dele a desenha: cada trem
// some quando a malha radial (centrada na câmera) fica grossa demais para ele, tudo some entre
// OCEAN.DISP_FADE, e o deslocamento horizontal de Gerstner é desfeito por uma iteração de ponto fixo.
const WAVE_CTX = { cx: 0, cz: 0, camH: 100, seg: OCEAN.SEGMENTS_HIGH, f0: OCEAN.DISP_FADE[0], f1: OCEAN.DISP_FADE[1] };
function waveAmp(x, z) {
  const C = WAVE_CTX, rr = Math.hypot(x - C.cx, z - C.cz);
  let amp = 1 - smooth(C.f0, C.f1, rr);
  amp *= lerp(clamp((C.camH - 0.8) / 3, 0.15, 1), 1, smooth(40, 160, rr));
  return { amp, spacing: Math.max(rr * (TAU / C.seg), 0.05) };
}
const _wf = new Float32Array(OCEAN.WAVES.length);
function waveHeight(x, z, t) {
  const { amp, spacing } = waveAmp(x, z);
  if (amp <= 0) return 0;
  for (let i = 0; i < WAVES.length; i++) { const lam = TAU / WAVES[i].k; _wf[i] = amp * (1 - smooth(lam * 0.12, lam * 0.2, spacing)); }
  // p0 ≈ x − D(p0): uma iteração a partir de x
  let px = x, pz = z;
  for (let i = 0; i < WAVES.length; i++) {
    const W = WAVES[i]; if (_wf[i] <= 0) continue;
    const c = Math.cos(W.k * (W.dx * x + W.dz * z) - W.w * t + W.ph) * (OCEAN.CHOP / W.k) * _wf[i];
    px -= W.dx * c; pz -= W.dz * c;
  }
  let h = 0;
  for (let i = 0; i < WAVES.length; i++) { const W = WAVES[i]; if (_wf[i] > 0) h += W.A * _wf[i] * Math.sin(W.k * (W.dx * px + W.dz * pz) - W.w * t + W.ph); }
  return h;
}

// ------------------------------------------------------------------
//  Construtor de geometria (não indexada; position, normal, color, aTint)
// ------------------------------------------------------------------
const _col = new THREE.Color();
class GeoBuild {
  constructor() { this.parts = []; }
  add(geo, color = 0xffffff, tint = 0) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count;
    if (!g.attributes.color) {
      _col.set(color);
      const c = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { c[i * 3] = _col.r; c[i * 3 + 1] = _col.g; c[i * 3 + 2] = _col.b; }
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    }
    if (!g.attributes.aTint) g.setAttribute('aTint', new THREE.BufferAttribute(new Float32Array(n).fill(tint), 1));
    this.parts.push(g);
    return g;
  }
  xf(geo, x, y, z, rx = 0, ry = 0, rz = 0) {
    geo.applyMatrix4(new THREE.Matrix4().compose(new V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new V3(1, 1, 1)));
    return geo;
  }
  box(w, h, d, x, y, z, color, o = {}) { return this.add(this.xf(new THREE.BoxGeometry(w, h, d), x, y, z, o.rx, o.ry, o.rz), color, o.tint || 0); }
  cyl(rt, rb, h, seg, x, y, z, color, o = {}) { return this.add(this.xf(new THREE.CylinderGeometry(rt, rb, h, seg, 1, !!o.open), x, y, z, o.rx, o.ry, o.rz), color, o.tint || 0); }
  // haste fina de a até b (caixa quadrada de lado t)
  spar(a, b, t, color, o = {}) {
    const d = new V3().subVectors(b, a), len = d.length();
    const g = new THREE.BoxGeometry(t, len, t); g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), d.normalize()));
    g.translate(a.x, a.y, a.z);
    return this.add(g, color, o.tint || 0);
  }
  build() {
    const g = mergeGeometries(this.parts, false);
    g.computeBoundingSphere();
    return g;
  }
}

// Casco "loftado": estações ao longo de x (popa −L/2 → proa +L/2), seção com faixas de pintura.
// bands: [[yTopo, cor, tint], …] de cima para baixo (o topo da 1ª é o costado Ds); abaixo da água a
// seção arredonda até a quilha.
function loftHull(o) {
  const { L, B, D, T } = o;
  const U = [0, 0.035, 0.09, 0.18, 0.3, 0.42, 0.54, 0.65, 0.74, 0.81, 0.87, 0.92, 0.96, 0.985, 1];
  const bowU = o.bowU ?? 0.66, sternW = o.sternW ?? 0.8;
  const halfB = (u) => {
    let f = 1;
    if (u < 0.2) f = sternW + (1 - sternW) * smooth(0, 0.2, u);
    if (u > bowU) { const t = (u - bowU) / (1 - bowU); f *= Math.sqrt(Math.max(0, 1 - Math.pow(t, 1.9))); }
    return Math.max(0.012, f) * B * 0.5;
  };
  const deckY = (u) => D + (o.sheerBow || 0) * smooth(0.55, 1, u) ** 2 + (o.sheerStern || 0) * smooth(0.35, 0, u) ** 2;
  const bands = o.bands;
  const under = [[-0.28, 0.96], [-0.62, 0.8], [-0.9, 0.42], [-1, 0.0]];   // (y/T, fração da meia-boca)
  const pos = [], col = [], tint = [], idx = [];
  const C = new THREE.Color();
  let M = 0;
  const sections = [];
  for (const u of U) {
    const Ds = deckY(u), hb = halfB(u);
    // pontos de um lado (de cima para baixo): [y, zf, cor, tint]
    const side = [[Ds, 1, bands[0][1], bands[0][2]]];
    for (let b = 1; b < bands.length; b++) {
      const yb = Math.min(bands[b][0], Ds - 0.06 * b);
      side.push([yb + 0.03, 1, bands[b - 1][1], bands[b - 1][2]]);
      side.push([yb - 0.03, 1, bands[b][1], bands[b][2]]);
    }
    const last = bands[bands.length - 1];
    const sh = Math.pow(hb / (B * 0.5), 0.35);   // proa/popa: carena mais fina
    for (const [yf, zf] of under) side.push([yf * T * (0.55 + 0.45 * sh), zf * sh, last[1], last[2]]);
    // seção completa: boreste (z+) de cima até a quilha, depois bombordo da quilha até em cima
    const pts = [];
    for (const p of side) pts.push([p[0], p[1], p[2], p[3]]);
    for (let k = side.length - 2; k >= 0; k--) pts.push([side[k][0], -side[k][1], side[k][2], side[k][3]]);
    M = pts.length;
    const base = pos.length / 3;
    for (const [y, zf, c, ti] of pts) {
      let x = (u - 0.5) * L;
      const r = (y + T) / (Ds + T);
      x += (o.rake || 0) * smooth(0.8, 1, u) * r * r;           // roda de proa lançada
      x -= (o.sternRake || 0) * smooth(0.12, 0, u) * r;          // painel de popa inclinado
      const flare = 1 + (o.flare || 0) * smooth(0.55, 1, u) * Math.max(0, y / Ds);
      pos.push(x, y, zf * hb * flare);
      C.set(c); col.push(C.r, C.g, C.b); tint.push(ti);
    }
    sections.push({ base, Ds, hb, u });
  }
  for (let s = 0; s < U.length - 1; s++) {
    const a = sections[s].base, b = sections[s + 1].base;
    for (let j = 0; j < M - 1; j++) idx.push(a + j, b + j, a + j + 1, a + j + 1, b + j, b + j + 1);
  }
  // painel de popa (leque a partir do centro da seção 0)
  {
    const c0 = pos.length / 3; const s0 = sections[0];
    let cy = 0; for (let j = 0; j < M; j++) cy += pos[(s0.base + j) * 3 + 1]; cy /= M;
    pos.push(pos[s0.base * 3], cy, 0); C.set(bands[0][1]); col.push(C.r, C.g, C.b); tint.push(bands[0][2]);
    for (let j = 0; j < M - 1; j++) idx.push(c0, s0.base + j + 1, s0.base + j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aTint', new THREE.Float32BufferAttribute(tint, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  // garante normais para fora (boreste z+)
  const mid = sections[6].base + 2;
  if (g.attributes.normal.getZ(mid) < 0) { const I = g.index.array; for (let i = 0; i < I.length; i += 3) { const t = I[i + 1]; I[i + 1] = I[i + 2]; I[i + 2] = t; } g.computeVertexNormals(); }
  // convés: faixa entre os topos de boreste e bombordo
  const dp = [], dc = [], dt = [], di = [];
  C.set(o.deckColor);
  for (const s of sections) {
    const y = s.Ds - (o.deckDrop || 0.05);
    const xS = pos[s.base * 3], zS = pos[s.base * 3 + 2] * 0.985;
    dp.push(xS, y, zS, xS, y, -zS); dc.push(C.r, C.g, C.b, C.r, C.g, C.b); dt.push(0, 0);
  }
  for (let s = 0; s < sections.length - 1; s++) { const a = s * 2, b = a + 2; di.push(a, b, a + 1, a + 1, b, b + 1); }
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.Float32BufferAttribute(dp, 3));
  dg.setAttribute('color', new THREE.Float32BufferAttribute(dc, 3));
  dg.setAttribute('aTint', new THREE.Float32BufferAttribute(dt, 1));
  dg.setIndex(di); dg.computeVertexNormals();
  if (dg.attributes.normal.getY(2) < 0) { const I = dg.index.array; for (let i = 0; i < I.length; i += 3) { const t = I[i + 1]; I[i + 1] = I[i + 2]; I[i + 2] = t; } dg.computeVertexNormals(); }
  return { hull: g, deck: dg, deckY, halfB };
}

// Vela triangular enfunada (subdividida), vértices a (amura), b (pico), c (punho); bojo para +z
function sailGeo(a, b, c, billow, n = 4) {
  const pos = [];
  const P = (i, j) => {
    const u = i / n, v = j / n, w = 1 - u - v;
    const p = new V3().addScaledVector(a, w).addScaledVector(b, u).addScaledVector(c, v);
    p.z += billow * 4 * (w * u + u * v + v * w) * 1.4;
    return p;
  };
  for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) {
    const p0 = P(i, j), p1 = P(i + 1, j), p2 = P(i, j + 1);
    pos.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    if (i + j < n - 1) { const p3 = P(i + 1, j + 1); pos.push(p1.x, p1.y, p1.z, p3.x, p3.y, p3.z, p2.x, p2.y, p2.z); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// ------------------------- modelos dos navios -------------------------
// Frente local = +X, cima = +Y, boreste = +Z; linha d'água em y = 0. Comprimento nominal L0.
const CONTAINER_COLORS = [0x2d5d9f, 0xb33a2b, 0xd9822b, 0x3f7d4b, 0x8a9296, 0xe5e2da, 0x2f8a8a, 0x6c2a2a, 0xd6b23a, 0x1f3f6e, 0x9a4b2a];
function makeCargoGeometry(rng) {
  const L = 110, B = 18, D = 7.5, T = 6;
  const G = new GeoBuild();
  const H = loftHull({ L, B, D, T, bowU: 0.68, sternW: 0.86, rake: 7, sternRake: 2.5, sheerBow: 2.2, flare: 0.12, deckColor: 0x4f5a55, deckDrop: 0.06,
    bands: [[D, 0xf2f0ea, 0], [D - 0.75, 0xa3241c, 1], [0.7, 0x1d1d1f, 0], [-0.35, 0x5a1e19, 0]] });
  G.add(H.hull); G.add(H.deck);
  const WHITE = 0xf1efe9, WIN = 0x1f262c, YEL = 0xd8b53a, GREY = 0x9aa0a3;
  // superestrutura de popa (4 andares) com faixas de janelas
  const x0 = -L / 2 + 3;
  const tiers = [[16.5, B - 1.2, 3.1], [14, B - 3, 2.9], [11, B - 4.5, 2.9], [7, B + 1.6, 2.6]];
  let y = D;
  for (const [len, w, h] of tiers) {
    const cxT = x0 + len / 2;
    G.box(len, h, w, cxT, y + h / 2, 0, WHITE);
    G.box(0.12, h * 0.34, w * 0.86, x0 + len + 0.03, y + h * 0.6, 0, WIN);                     // janelas da frente
    for (const sz of [1, -1]) G.box(len * 0.82, h * 0.3, 0.12, cxT, y + h * 0.6, sz * (w / 2 + 0.03), WIN);
    G.box(len + 0.4, 0.22, w + 0.4, cxT, y + h + 0.11, 0, 0xdedbd2);                            // beiral/cornija
    y += h + 0.22;
  }
  // chaminés gêmeas (brancas com topo preto), mastro do radar e radome
  for (const sz of [-3.2, 3.2]) { G.cyl(1.0, 1.15, 4.2, 10, x0 + 3.2, y + 2.1, sz, WHITE); G.cyl(1.02, 1.02, 0.7, 10, x0 + 3.2, y + 4.55, sz, 0x1b1b1b); }
  G.box(0.35, 6, 0.35, x0 + 6.5, y + 3, 0, WHITE);
  G.box(0.25, 0.25, 5.5, x0 + 6.5, y + 4.6, 0, WHITE);
  G.box(3.2, 0.18, 0.4, x0 + 6.5, y + 6.1, 0, 0x2a2a2a);
  G.add(G.xf(new THREE.IcosahedronGeometry(0.75, 1), x0 + 8.5, y + 0.8, 2.5), WHITE);
  // contêineres em baias de 20 pés (6,1 m) entre a superestrutura e o castelo de proa
  const bayX0 = x0 + 17.5, bayX1 = L / 2 - 16;
  const rows = Math.floor((B - 2.2) / 2.5);
  for (let bx = bayX0; bx + 6.1 <= bayX1; bx += 6.45) {
    if (Math.abs(bx + 3 - 4) < 3.3) continue;   // vão do guindaste
    for (let r = 0; r < rows; r++) {
      const zc = (r - (rows - 1) / 2) * 2.5;
      const nt = rng() < 0.12 ? 0 : rng() < 0.55 ? 1 : 2;
      for (let t = 0; t < nt; t++) G.box(6.05, 2.55, 2.42, bx + 3.05, D + 1.29 + t * 2.6, zc, CONTAINER_COLORS[Math.floor(rng() * CONTAINER_COLORS.length)]);
    }
  }
  // guindaste amarelo no vão (coluna + lança inclinada)
  G.cyl(0.55, 0.7, 8, 8, 4, D + 4, -B * 0.28, YEL);
  G.spar(new V3(4, D + 7.4, -B * 0.28), new V3(16, D + 12.5, -B * 0.05), 0.55, YEL);
  // castelo de proa (convés elevado) + mastro de vante com verga
  const fx = L / 2 - 14;
  G.box(12, 1.6, H.halfB(0.9) * 1.7, fx + 5, H.deckY(0.93) - 0.75 + 0.6, 0, WHITE);
  G.cyl(0.2, 0.3, 11, 6, fx + 4, D + 5.5 + 1.2, 0, WHITE);
  G.box(0.2, 0.2, 4, fx + 4, D + 9.5, 0, WHITE);
  // balaustrada amarela (corrimão + balaústres) ao longo dos bordos
  for (const sz of [1, -1]) {
    const xa = x0 + 17, xb = L / 2 - 15;
    G.box(xb - xa, 0.12, 0.12, (xa + xb) / 2, D + 1.15, sz * (B / 2 - 0.15), YEL);
    G.box(xb - xa, 0.08, 0.08, (xa + xb) / 2, D + 0.6, sz * (B / 2 - 0.15), YEL);
    for (let x = xa; x <= xb; x += 6) G.box(0.1, 1.15, 0.1, x, D + 0.58, sz * (B / 2 - 0.15), YEL);
  }
  // botes salva-vidas laranja nas asas da ponte
  for (const sz of [1, -1]) G.add(G.xf(new THREE.CapsuleGeometry(0.9, 4.2, 2, 6), x0 + 9, D + 5.2, sz * (B / 2 - 0.4), 0, 0, Math.PI / 2), 0xe0621f);
  return { geo: G.build(), L0: L, B };
}

function makeDhowGeometry() {
  const L = 34, B = 7.6, D = 2.6, T = 2.0;
  const G = new GeoBuild();
  const H = loftHull({ L, B, D, T, bowU: 0.55, sternW: 0.55, rake: 5.5, sternRake: 1.6, sheerBow: 1.4, sheerStern: 2.2, flare: 0.1, deckColor: 0x9a7a52,
    bands: [[D, 0xc9a66b, 0], [D - 0.35, 0x5e3f25, 0], [0.25, 0x2e2520, 0], [-0.25, 0xd6cfbf, 0]] });
  G.add(H.hull); G.add(H.deck);
  const WOOD = 0x6e4a2c, DARK = 0x4a3220, SAIL = 0xece2c6;
  // tombadilho da popa (casaria) com guarda-corpo
  const sx = -L / 2 + 4.6, sy = H.deckY(0.05);
  G.box(7, 1.7, B * 0.66, sx, sy + 0.4, 0, 0x7d5534);
  G.box(7.4, 0.15, B * 0.7, sx, sy + 1.3, 0, 0xb08a58);
  for (const sz of [1, -1]) G.box(7, 0.6, 0.1, sx, sy + 1.6, sz * B * 0.33, DARK);
  // mastros inclinados para vante, vergas longas e velas latinas
  const deck = (u) => H.deckY(u);
  const rig = (mx, mh, tack, peak, clew, zs, billow) => {
    const base = new V3(mx, deck(mx / L + 0.5) - 0.2, 0);
    const top = new V3(mx + mh * 0.13, base.y + mh, 0);
    G.spar(base, top, 0.42, WOOD);
    G.spar(new V3(tack.x, tack.y, zs * 0.6), new V3(peak.x, peak.y, zs * 0.6), 0.3, DARK);   // verga
    G.add(sailGeo(new V3(tack.x, tack.y - 0.2, zs), new V3(peak.x, peak.y - 0.25, zs), new V3(clew.x, clew.y, zs), billow), SAIL);
    G.spar(top, new V3(L / 2 + 4.5, deck(1) + 0.6, 0), 0.08, DARK);                          // estai de vante
    G.spar(top, new V3(mx - 6, deck(mx / L + 0.5 - 0.18) + 0.3, 0), 0.08, DARK);              // brandal
  };
  rig(L * 0.06, L * 0.62, new V3(L * 0.47, deck(0.97) + 1.4, 0), new V3(-L * 0.36, D + L * 0.78, 0), new V3(-L * 0.3, deck(0.2) + 1.3, 0), 0.55, 1.5);
  rig(-L * 0.27, L * 0.4, new V3(-L * 0.08, deck(0.42) + 1.6, 0), new V3(-L * 0.55, D + L * 0.5, 0), new V3(-L * 0.47, deck(0.03) + 1.8, 0), -0.55, 0.9);
  // carga no convés (fardos e jarras)
  for (let i = 0; i < 5; i++) G.box(1.6, 0.9, 1.3, -2 + i * 1.9, deck(0.5) + 0.45, (i % 2 ? 1 : -1) * 1.2, i % 2 ? 0xb89a6a : 0x8a6d47);
  return { geo: G.build(), L0: L, B };
}

function makeFishingGeometry() {
  const L = 11, B = 3.7, D = 1.25, T = 0.9;
  const G = new GeoBuild();
  const H = loftHull({ L, B, D, T, bowU: 0.6, sternW: 0.82, rake: 0.9, sheerBow: 0.55, flare: 0.18, deckColor: 0xb6ad9c,
    bands: [[D, 0xf3f1ea, 0], [D - 0.2, 0xf3f1ea, 1], [0.12, 0x1a1a1a, 0], [-0.08, 0x8e2a22, 0]] });
  G.add(H.hull); G.add(H.deck);
  const WHITE = 0xf2f0ea, WIN = 0x1c2329;
  // casaria do leme (popa-meio) com janelas e teto colorido (tint)
  const wx = -0.8, wy = H.deckY(0.4);
  G.box(2.6, 1.9, 2.2, wx, wy + 0.95, 0, WHITE);
  G.box(0.06, 0.55, 1.8, wx + 1.31, wy + 1.4, 0, WIN);
  for (const sz of [1, -1]) G.box(2.0, 0.5, 0.06, wx, wy + 1.4, sz * 1.11, WIN);
  G.box(2.9, 0.14, 2.5, wx, wy + 1.97, 0, 0xffffff, { tint: 1 });
  // mastro com retranca, antena, tambor de rede e boias
  G.cyl(0.07, 0.1, 5.2, 6, 1.9, wy + 2.6, 0, WHITE);
  G.spar(new V3(1.9, wy + 1.4, 0), new V3(-3.8, wy + 2.4, 0), 0.09, 0x5a5a5a);
  G.cyl(0.03, 0.03, 1.6, 4, wx - 0.6, wy + 2.8, 0.6, 0x333333);
  G.cyl(0.45, 0.45, 1.6, 10, -3.9, wy + 0.55, 0, 0x2d5a3a, { rz: 0, rx: Math.PI / 2 });
  for (let i = 0; i < 4; i++) G.add(G.xf(new THREE.IcosahedronGeometry(0.16, 0), -3.2 + i * 0.35, wy + 0.2, (i % 2 ? 1 : -1) * 1.3), 0xe8641e);
  G.box(1.2, 0.4, 1.4, 3.0, wy + 0.2, 0, 0x2f4f6a);   // caixa de peixe
  return { geo: G.build(), L0: L, B };
}

// ------------------------- pássaro (frente −Z, envergadura 1) ----------
function makeBirdGeometry() {
  const pos = [], col = [];
  const C = new THREE.Color();
  const tri = (a, b, c, color) => { pos.push(...a, ...b, ...c); C.set(color); for (let i = 0; i < 3; i++) col.push(C.r, C.g, C.b); };
  // corpo: octaedro alongado
  const N = [0, 0.01, -0.2], Tl = [0, 0, 0.2], Up = [0, 0.05, -0.03], Dn = [0, -0.045, -0.02], Lf = [-0.055, 0, -0.03], Rt = [0.055, 0, -0.03];
  const BODY = 0xf4f4f2, BELLY = 0xe6e8ea;
  tri(N, Up, Rt, BODY); tri(N, Rt, Dn, BELLY); tri(N, Dn, Lf, BELLY); tri(N, Lf, Up, BODY);
  tri(Tl, Rt, Up, BODY); tri(Tl, Dn, Rt, BELLY); tri(Tl, Lf, Dn, BELLY); tri(Tl, Up, Lf, BODY);
  // cauda
  tri([-0.05, 0.005, 0.17], [0.05, 0.005, 0.17], [0, 0.005, 0.3], 0xd9dcdf);
  // asas: painel interno + externo (ponta escura)
  const INNER = 0xc9ced3, OUTER = 0xb5bbc1, TIP = 0x2b2c2e;
  for (const s of [1, -1]) {
    const a = [s * 0.04, 0, -0.07], b = [s * 0.26, 0, -0.08], c = [s * 0.26, 0, 0.05], d = [s * 0.04, 0, 0.07];
    const e = [s * 0.43, 0, -0.04], f = [s * 0.52, 0, 0.03], g = [s * 0.4, 0, 0.05];
    tri(a, b, c, INNER); tri(a, c, d, INNER);
    tri(b, e, g, OUTER); tri(b, g, c, OUTER); tri(e, f, g, TIP);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const n = new Float32Array(pos.length); for (let i = 1; i < n.length; i += 3) n[i] = 1;   // normal "para cima" (DoubleSide)
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  return g;
}

// ------------------------- pessoa (frente +Z, altura 1, pés em y=0) -----
// aBody = (parte: 0 pele, 1 tronco/mangas, 2 pernas/saia, 3 cabelo/turbante; lado ±1; membro: 0, 1 perna, 2 braço)
function makePersonGeometry() {
  const pos = [], body = [];
  const H = 1 / 1.7;   // modelado em metros para 1,7 m e normalizado para altura 1
  const quad = (a, b, c, d, part, side, limb) => { pos.push(...a, ...b, ...c, ...a, ...c, ...d); for (let i = 0; i < 6; i++) body.push(part, side, limb); };
  // prisma (4 lados [+ topo]) de y0 a y1, meias larguras w0/w1 (x) e d0/d1 (z)
  const prism = (cx, cz, y0, y1, w0, w1, d0, d1, part, side, limb, top) => {
    const P = (sx, sz, y, w, d) => [cx + sx * w, y, cz + sz * d];
    const c = [[-1, 1], [1, 1], [1, -1], [-1, -1]];
    for (let k = 0; k < 4; k++) {
      const [ax, az] = c[k], [bx, bz] = c[(k + 1) % 4];
      quad(P(ax, az, y0, w0, d0), P(bx, bz, y0, w0, d0), P(bx, bz, y1, w1, d1), P(ax, az, y1, w1, d1), part, side, limb);
    }
    if (top) quad(P(-1, 1, y1, w1, d1), P(1, 1, y1, w1, d1), P(1, -1, y1, w1, d1), P(-1, -1, y1, w1, d1), part, side, limb);
  };
  for (const s of [1, -1]) prism(s * 0.095, 0, 0, 0.86, 0.062, 0.075, 0.075, 0.085, 2, s, 1, false);      // pernas
  prism(0, 0, 0.82, 1.44, 0.17, 0.205, 0.105, 0.115, 1, 0, 0, true);                                         // tronco
  for (const s of [1, -1]) prism(s * 0.25, 0, 0.8, 1.42, 0.042, 0.052, 0.048, 0.055, 1, s, 2, false);      // braços
  // cabeça: icosaedro (cabelo/turbante em cima, pele embaixo)
  const ico = new THREE.IcosahedronGeometry(0.115, 0);   // já não indexada
  const P = ico.attributes.position;
  for (let i = 0; i < P.count; i += 3) {
    let cy = 0; for (let k = 0; k < 3; k++) cy += P.getY(i + k);
    const part = cy / 3 > 0.02 ? 3 : 0;
    for (let k = 0; k < 3; k++) { pos.push(P.getX(i + k), P.getY(i + k) * 1.12 + 1.57, P.getZ(i + k)); body.push(part, 0, 0); }
  }
  for (let i = 0; i < pos.length; i++) pos[i] *= H;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aBody', new THREE.Float32BufferAttribute(body, 3));
  g.computeVertexNormals();
  return g;
}

// ------------------------- textura de espuma (periódica) ---------------
function makeFoamTexture(S = 256) {
  const rng = createRng(SEED + LIFE.SEED_OFF + 5);
  const lat = (n) => { const a = new Float32Array(n * n); for (let i = 0; i < a.length; i++) a[i] = rng(); return a; };
  const octs = [[8, lat(8)], [16, lat(16)], [32, lat(32)], [64, lat(64)]];
  const vn = (n, L, x, y) => {   // ruído de valor periódico (período n) em [0,1)²
    const fx = x * n, fy = y * n, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const g = (i, j) => L[((j % n + n) % n) * n + ((i % n + n) % n)];
    return lerp(lerp(g(ix, iy), g(ix + 1, iy), sx), lerp(g(ix, iy + 1), g(ix + 1, iy + 1), sx), sy);
  };
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    let f = 0, amp = 0.55;
    for (const [n, L] of octs) { f += amp * vn(n, L, u, v); amp *= 0.5; }
    f /= 1.03;
    // bolhas/rendilhado: realça as cristas do ruído
    const lace = 1 - Math.abs(2 * vn(32, octs[2][1], u + 0.31, v + 0.17) - 1);
    const val = clamp(f * 0.75 + lace * lace * 0.45 - 0.12, 0, 1);
    const o = (y * S + x) * 4;
    data[o] = data[o + 1] = data[o + 2] = val * 255; data[o + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true; tex.anisotropy = 4; tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ------------------------- shaders -------------------------------------
const WAKE_VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
#include <fog_pars_vertex>
attribute vec4 aW;    // s (−1..1 através), d (m atrás da proa), fração do casco, fração da água revolvida
attribute vec4 aW2;   // L, intensidade, comprimento máx., boca
varying vec4 vW;
varying vec4 vW2;
varying vec2 vXZ;
void main() {
  vW = aW; vW2 = aW2; vXZ = position.xz;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}`;
const WAKE_FRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
#include <fog_pars_fragment>
uniform sampler2D uFoam;
uniform vec3 uFoamColor;
uniform float uTime;
varying vec4 vW;
varying vec4 vW2;
varying vec2 vXZ;
void main() {
  #include <logdepthbuf_fragment>
  float s = abs(vW.x), d = vW.y, hf = vW.z, cf = vW.w;
  float L = vW2.x, inten = vW2.y, dmax = vW2.z;
  float n1 = texture2D(uFoam, vXZ / 26.0 + vec2(0.0, uTime * 0.004)).r;
  float n2 = texture2D(uFoam, vXZ / 7.5 + 0.37).r;
  float nz = n1 * 0.62 + n2 * 0.48;
  float lifeF = 1.0 - smoothstep(0.3 * dmax, dmax, d);
  // água revolvida atrás da popa (hélice): faixa central que alarga e enfraquece
  float behind = smoothstep(0.8 * L, 1.02 * L, d);
  float centre = (1.0 - smoothstep(cf * 0.45, cf, s)) * behind * mix(1.0, 0.5, smoothstep(L, dmax * 0.7, d));
  // braços de Kelvin (cúspides) nas bordas da cunha
  float arm = smoothstep(0.84, 0.92, s) * (1.0 - smoothstep(0.94, 1.0, s)) * (1.0 - smoothstep(0.0, 0.65 * dmax, d));
  arm *= 0.5 * smoothstep(0.42, 0.8, nz);   // braços fracos e quebrados (a cunha de Kelvin é sutil vista do alto)
  // onda de proa colada ao casco (da roda de proa até ~0,45 L)
  float bowz = (1.0 - smoothstep(0.05 * L, 0.5 * L, d)) * (1.0 - smoothstep(0.0, 0.16, abs(s - hf - 0.05)));
  float a = max(max(centre, arm), bowz * 1.15) * lifeF;
  a *= smoothstep(0.32, 0.78, nz + 0.28 * a);
  a = clamp(a * inten, 0.0, 1.0);
  if (a < 0.004) discard;
  gl_FragColor = vec4(uFoamColor * (0.9 + 0.1 * n2), a * 0.92);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

// pessoas: caminho + giro + passada (vertex shader). Coordenadas no espaço do crowdRoot (m).
const CROWD_PARS = /* glsl */`
uniform float uTime;
uniform float uStride;
attribute vec3 aBody;
attribute vec4 aP0;    // modo 0: A.xyz, B.x | modo 1: centro.xyz, raio | modo 2: posição.xyz, yaw
attribute vec4 aP1;    // modo 0: B.y, B.z, velocidade, fase | modo 1: ângulo inicial, -, velocidade (±), fase | modo 2: -, -, -, fase
attribute vec4 aMode;  // modo, altura (m), largura, cadência
attribute vec3 aC0;    // tronco
attribute vec3 aC1;    // pernas / saia
attribute vec3 aC2;    // pele
attribute vec3 aC3;    // cabelo / turbante
varying vec3 vCrowdCol;
vec3 crowdXform(vec3 p, inout vec3 n) {
  vec3 pos; float yaw; float walk = 1.0; float dist;
  if (aMode.x < 0.5) {
    vec3 A = aP0.xyz, B = vec3(aP0.w, aP1.x, aP1.y);
    float L = max(length(B.xz - A.xz), 0.01);
    float s = mod(uTime * aP1.z + aP1.w * 2.0 * L, 2.0 * L);
    float u = s < L ? s / L : 2.0 - s / L;
    pos = mix(A, B, u);
    vec2 dir = (B.xz - A.xz) / L * (s < L ? 1.0 : -1.0);
    yaw = atan(dir.x, dir.y);
    dist = uTime * aP1.z + aP1.w * 17.0;
  } else if (aMode.x < 1.5) {
    float w = aP1.z / aP0.w, a = aP1.x + uTime * w;
    pos = aP0.xyz + vec3(cos(a), 0.0, sin(a)) * aP0.w;
    vec2 dir = vec2(-sin(a), cos(a)) * sign(w);
    yaw = atan(dir.x, dir.y);
    dist = uTime * abs(aP1.z) + aP1.w * 17.0;
  } else {
    pos = aP0.xyz; yaw = aP0.w; walk = 0.0; dist = 0.0;
  }
  float ph = dist / uStride * 6.2831853 * aMode.w;
  // membros: giro em torno do eixo X no quadril (pernas) / ombro (braços)
  float ang = 0.0, pivot = 0.0;
  if (aBody.z > 0.5 && aBody.z < 1.5) { pivot = 0.5; ang = walk * 0.42 * aBody.y * sin(ph); }
  else if (aBody.z > 1.5) {
    pivot = 0.83;
    ang = walk * -0.32 * aBody.y * sin(ph) + (1.0 - walk) * (0.05 + 0.12 * max(0.0, sin(uTime * 1.3 + aP1.w * 40.0 + aBody.y))) * -1.0;
  }
  if (pivot > 0.0) {
    float c = cos(ang), sn = sin(ang);
    vec2 yz = vec2(p.y - pivot, p.z);
    p.y = pivot + yz.x * c - yz.y * sn; p.z = yz.x * sn + yz.y * c;
    n.yz = vec2(n.y * c - n.z * sn, n.y * sn + n.z * c);
  }
  // quem está parado balança de leve
  float sway = (1.0 - walk) * 0.025 * sin(uTime * 0.7 + aP1.w * 31.0) * p.y;
  p.x += sway;
  p.xz *= aMode.z * aMode.y;   // a malha é normalizada para altura 1
  p.y *= aMode.y;
  p.y += walk * 0.028 * abs(sin(ph));
  float cy = cos(yaw), sy = sin(yaw);
  p.xz = vec2(p.x * cy + p.z * sy, -p.x * sy + p.z * cy);
  n.xz = vec2(n.x * cy + n.z * sy, -n.x * sy + n.z * cy);
  return p + pos;
}
`;

function crowdColorGLSL() {
  return /* glsl */`
  vCrowdCol = aBody.x < 0.5 ? aC2 : aBody.x < 1.5 ? aC0 : aBody.x < 2.5 ? aC1 : aC3;`;
}

// ------------------------------------------------------------------
//  createLife
// ------------------------------------------------------------------
export function createLife(scene, { worldData, elephants = [], camera = null, quality = 'high' } = {}) {
  const low = quality === 'low';
  const root = new THREE.Group(); root.name = 'life';
  scene.add(root);
  const islandHeightAt = worldData?.islandHeightAt || (() => -Infinity);
  const islands = worldData?.islands || [];
  const rng = createRng(SEED + LIFE.SEED_OFF);
  const timeU = { value: 0 };
  const SH = LIFE.SHIPS;

  // =========================== NAVIOS ============================
  const types = {
    CARGO: makeCargoGeometry(createRng(SEED + LIFE.SEED_OFF + 1)),
    DHOW: makeDhowGeometry(),
    FISHING: makeFishingGeometry(),
  };
  const shipMat = (side) => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.05, side });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aTint;')
        .replace('#include <color_vertex>', `#include <color_vertex>
#if defined( USE_COLOR ) && defined( USE_INSTANCING_COLOR )
  vColor.rgb = color.rgb * mix(vec3(1.0), instanceColor.rgb, aTint);   // só o que tem aTint recebe a cor da instância
#endif`);
    };
    m.customProgramCacheKey = () => 'life-ship';
    return m;
  };
  const HULL_TINTS = {
    CARGO: [0xffffff, 0xffffff, 0x2f4f8f, 0x2f6a4a].map((c) => new THREE.Color(c)),   // multiplica o vermelho: alguns azuis/verdes
    FISHING: [0x3a78c8, 0xd2402e, 0x2f9a7a, 0xe0b23a, 0x3f5fa0, 0xf2f2f2].map((c) => new THREE.Color(c)),
  };
  const ships = [];
  const shipMeshes = {};
  for (const [ti, key] of ['CARGO', 'DHOW', 'FISHING'].entries()) {
    const C = SH[key];
    const count = low ? C.low : C.count;
    const mesh = new THREE.InstancedMesh(types[key].geo, shipMat(key === 'DHOW' ? THREE.DoubleSide : THREE.FrontSide), count);
    mesh.name = 'life_ships_' + key.toLowerCase();
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < count; i++) {
      const L = rng.range(C.length[0], C.length[1]);
      const scale = L / types[key].L0;
      const s = {
        type: key, mesh, i, L, B: types[key].B * scale, scale,
        speed: rng.range(C.speed[0], C.speed[1]),
        dir: rng() < 0.5 ? 1 : -1, th0: rng() * TAU,
        wakeLen: C.wake * (0.8 + 0.4 * rng()) * Math.sqrt(scale),
        bob: SH.BOB[key],
        pos: new V3(), heading: 0, visible: true,
      };
      // tipo de trajeto: órbita de elefante (cargueiros sempre; dhows/pesca em parte) ou laço de ilha
      const escort = elephants.length > 0 && (rng() < C.escort || !islands.length);
      if (escort) {
        s.mode = 'escort';
        // distribui pelos elefantes: cargueiros nos 4 primeiros (um por elefante), os outros no resto
        s.el = key === 'CARGO' ? i % elephants.length : (4 + ti * 2 + i) % elephants.length;
        s.a = rng.range(C.orbitA[0], C.orbitA[1]); s.b = rng.range(C.orbitB[0], C.orbitB[1]);
        s.omega = s.speed / ((s.a + s.b) / 2);
      } else {
        s.mode = 'island';
        s.isl = (i * 2 + ti) % Math.max(1, islands.length);
        s.off = rng.range((C.coast || [600, 1200])[0], (C.coast || [600, 1200])[1]);
        const isl = islands[s.isl];
        s.omega = s.speed / ((isl ? isl.R : 2000) + s.off);
        s.wob = rng() * TAU;
      }
      const tintSet = HULL_TINTS[key];
      mesh.setColorAt(i, tintSet ? tintSet[Math.floor(rng() * tintSet.length)] : new THREE.Color(1, 1, 1).multiplyScalar(rng.range(0.9, 1)));
      ships.push(s);
    }
    mesh.instanceColor.needsUpdate = true;
    shipMeshes[key] = mesh;
    root.add(mesh);
  }

  // posição (mundo, xz) do navio no instante t (now = tempo atual: o elefante é extrapolado para trás)
  const _ep = new V3();
  function shipPos(s, t, now, out) {
    if (s.mode === 'escort') {
      const e = elephants[s.el];
      const h = e.heading, ch = Math.cos(h), sh = Math.sin(h);
      const age = now - t, sp = e.route?.speed ?? ELEPHANT.SPEED;
      _ep.copy(e.position);
      _ep.x -= ch * sp * age; _ep.z += sh * sp * age;   // frente do elefante = (cos h, 0, −sin h)
      const th = s.th0 + s.dir * s.omega * t;
      let lx = s.a * Math.cos(th), lz = s.b * Math.sin(th);
      // água funda: encolhe/expande a órbita se cair perto de terra
      for (let k = 0; k < 6; k++) {
        const x = _ep.x + lx * ch + lz * sh, z = _ep.z - lx * sh + lz * ch;
        if (islandHeightAt(x, z) < SH.MIN_COAST_DEPTH) { out.set(x, 0, z); return out; }
        const f = k < 3 ? 0.88 : 1.25; lx *= f; lz *= f;
      }
      out.set(_ep.x + lx * ch + lz * sh, 0, _ep.z - lx * sh + lz * ch);
      return out;
    }
    const isl = islands[s.isl];
    if (!isl) { out.set(0, 0, 0); return out; }
    const th = s.th0 + s.dir * s.omega * t;
    let r = isl.outlineRadius(th) + s.off + 90 * Math.sin(3 * th + s.wob);
    let x = isl.cx + Math.cos(th) * r, z = isl.cz + Math.sin(th) * r;
    for (let k = 0; k < 12 && islandHeightAt(x, z) > SH.MIN_COAST_DEPTH; k++) { r += 90; x = isl.cx + Math.cos(th) * r; z = isl.cz + Math.sin(th) * r; }
    out.set(x, 0, z);
    return out;
  }

  // ---------------------------- esteiras ------------------------------
  const NW = low ? 18 : SH.WAKE_POINTS;
  // vértices através da esteira: densos no centro (água revolvida estreita) e nas bordas (braços de Kelvin),
  // para a fita acompanhar as ondas sem afundar entre vértices
  const ACROSS = [-1, -0.88, -0.45, -0.14, 0, 0.14, 0.45, 0.88, 1], NA = ACROSS.length;
  const wakeVerts = ships.length * NW * NA;
  const wPos = new Float32Array(wakeVerts * 3), wW = new Float32Array(wakeVerts * 4), wW2 = new Float32Array(wakeVerts * 4);
  const wIdx = [];
  for (let si = 0; si < ships.length; si++) {
    const base = si * NW * NA;
    for (let j = 0; j < NW - 1; j++) for (let k = 0; k < NA - 1; k++) {
      const a = base + j * NA + k, b = a + NA;
      wIdx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const s = ships[si];
    const inten = clamp(s.speed / 8, 0.45, 1.1) * clamp(Math.sqrt(s.L / 60), 0.6, 1);   // barco pequeno/lento: esteira fraca
    for (let v = 0; v < NW * NA; v++) { const o = (base + v) * 4; wW2[o] = s.L; wW2[o + 1] = inten; wW2[o + 2] = s.wakeLen; wW2[o + 3] = s.B; }
    // distâncias-alvo atrás da proa: denso ao longo do casco, depois progressão geométrica
    const fixed = [0, 0.12, 0.28, 0.48, 0.7, 0.9, 1.08].map((f) => f * s.L);
    const dists = fixed.slice(0, Math.min(fixed.length, NW - 2));
    const d0 = dists[dists.length - 1], rest = NW - dists.length;
    const ratio = Math.pow(s.wakeLen / d0, 1 / rest);
    for (let j = 1; j <= rest; j++) dists.push(d0 * Math.pow(ratio, j));
    s.wakeDists = dists;
    s.trail = dists.map(() => new V3());
  }
  const wakeGeo = new THREE.BufferGeometry();
  wakeGeo.setAttribute('position', new THREE.BufferAttribute(wPos, 3).setUsage(THREE.DynamicDrawUsage));
  wakeGeo.setAttribute('aW', new THREE.BufferAttribute(wW, 4).setUsage(THREE.DynamicDrawUsage));
  wakeGeo.setAttribute('aW2', new THREE.BufferAttribute(wW2, 4));
  wakeGeo.setIndex(wIdx);
  const foamColor = new THREE.Color(COLORS.foam).multiplyScalar(0.92);
  const wakeMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uFoam: { value: null }, uFoamColor: { value: foamColor }, uTime: { value: 0 } }]),
    vertexShader: WAKE_VERT, fragmentShader: WAKE_FRAG, fog: true, transparent: true, depthWrite: false,
  });
  wakeMat.uniforms.uFoam.value = makeFoamTexture(low ? 128 : 256);
  const wakeMesh = new THREE.Mesh(wakeGeo, wakeMat);
  wakeMesh.name = 'life_wakes'; wakeMesh.frustumCulled = false; wakeMesh.renderOrder = 3;
  wakeMesh.userData.noShadow = true; wakeMesh.userData.shadowsSet = true;
  root.add(wakeMesh);

  // =========================== PÁSSAROS ==========================
  const BC = LIFE.BIRDS;
  const q = (n) => (low ? Math.round(n / 2) : n);
  const flockDefs = [
    { kind: 'headGulls', n: q(BC.HEAD_GULLS), R: [2400, 2900], h: [250, 900], speed: [11, 15], swirl: [8, 40], color: 0xffffff, flap: [2.6, 3.2], glide: 0.8 },
    { kind: 'cityDoves', n: q(BC.CITY_DOVES), R: [500, 800], h: [120, 320], speed: [12, 16], swirl: [6, 30], color: 0xa8b0b8, flap: [4.5, 5.5], glide: 0.4 },
    { kind: 'market', n: q(BC.MARKET_PIGEONS), R: [110, 170], h: [25, 60], speed: [9, 12], swirl: [4, 16], color: 0x9aa2ac, flap: [5, 6], glide: 0.3 },
    { kind: 'headGulls2', n: q(BC.HEAD_GULLS_2), R: [2400, 2900], h: [250, 900], speed: [11, 15], swirl: [8, 40], color: 0xffffff, flap: [2.6, 3.2], glide: 0.8 },
    { kind: 'island', n: q(BC.ISLAND_GULLS), R: [260, 420], h: [70, 190], speed: [9, 13], swirl: [6, 30], color: 0xffffff, flap: [2.6, 3.2], glide: 0.85 },
    { kind: 'ship', n: q(BC.SHIP_GULLS), R: [45, 90], h: [22, 45], speed: [8, 11], swirl: [3, 14], color: 0xffffff, flap: [2.8, 3.3], glide: 0.85 },
    { kind: 'soar', n: q(BC.SOARERS), R: [70, 160], h: [-60, 60], speed: [10, 13], swirl: [0, 0], color: 0x5a4636, flap: [1.2, 1.4], glide: 1.0 },
  ];
  const birds = [];
  const flocks = flockDefs.map((d, fi) => {
    const fr = createRng(SEED + LIFE.SEED_OFF + 100 + fi);
    const f = { ...d, anchor: new V3(), active: false, R0: fr.range(d.R[0], d.R[1]), H: fr.range(d.h[0], d.h[1]), dir: fr() < 0.5 ? 1 : -1, th0: fr() * TAU, k: fr() * 10, center: new V3() };
    f.omega = fr.range(d.speed[0], d.speed[1]) / f.R0;
    for (let i = 0; i < d.n; i++) {
      const soar = d.kind === 'soar';
      birds.push({
        f, lag: soar ? 0 : fr.range(0, 1) ** 1.5 * (55 / Math.max(8, f.R0 * f.omega)) * 3,
        ro: fr.range(d.swirl[0], d.swirl[1]), ph: fr() * TAU, w2: fr.range(0.15, 0.4) * (fr() < 0.5 ? 1 : -1), va: fr.range(2, 10),
        size: soar ? fr.range(BC.SOAR_SIZE[0], BC.SOAR_SIZE[1]) : fr.range(BC.SIZE[0], BC.SIZE[1]),
        // térmica própria das planadoras
        tR: fr.range(d.R[0], d.R[1]), tTh: fr() * TAU, tW: fr.range(0.06, 0.1) * (fr() < 0.5 ? 1 : -1), tH: fr.range(d.h[0], d.h[1]), tOff: new V3(fr.range(-250, 250), 0, fr.range(-250, 250)),
        flap: [fr() * TAU, fr.range(d.flap[0], d.flap[1]), soar ? 0.05 : fr.range(0.55, 0.75), d.glide],
        tint: new THREE.Color(d.color).multiplyScalar(soar ? 1 : fr.range(0.88, 1.0)),
      });
    }
    return f;
  });
  const birdGeo = makeBirdGeometry();
  const flapAttr = new Float32Array(birds.length * 4);
  birds.forEach((b, i) => flapAttr.set(b.flap, i * 4));
  birdGeo.setAttribute('aFlap', new THREE.InstancedBufferAttribute(flapAttr, 4));
  const birdMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0, side: THREE.DoubleSide });
  birdMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = timeU;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
attribute vec4 aFlap;
vec3 birdPos; `)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
  birdPos = position;
  {
    float wx = abs(position.x);
    if (wx > 0.035) {
      float sgn = sign(position.x);
      float cyc = uTime * aFlap.y * 6.2831853 + aFlap.x;
      float env = mix(1.0, smoothstep(-0.35, 0.35, sin(uTime * 0.42 + aFlap.x * 1.7)), aFlap.w);
      float amp = aFlap.z * env;
      float a1 = amp * sin(cyc) + 0.1;
      float a2 = a1 + amp * 0.55 * sin(cyc - 0.9);
      float h = 0.035, e = 0.26;
      vec2 el = vec2(cos(a1), sin(a1)) * (min(wx, e) - h);
      vec2 q = el;
      if (wx > e) q += vec2(cos(a2), sin(a2)) * (wx - e);
      birdPos.x = sgn * (h + q.x);
      birdPos.y = position.y + q.y;
      float an = wx > e ? a2 : a1;
      objectNormal = vec3(-sgn * sin(an), cos(an), 0.0);
    }
  }`)
      .replace('#include <begin_vertex>', 'vec3 transformed = birdPos;');
  };
  birdMat.customProgramCacheKey = () => 'life-bird';
  const birdMesh = new THREE.InstancedMesh(birdGeo, birdMat, birds.length);
  birdMesh.name = 'life_birds';
  birdMesh.frustumCulled = false;
  birdMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  birds.forEach((b, i) => birdMesh.setColorAt(i, b.tint));
  birdMesh.instanceColor.needsUpdate = true;
  birdMesh.userData.shadowsSet = true; birdMesh.castShadow = false; birdMesh.receiveShadow = false;
  root.add(birdMesh);

  // posição do pássaro no instante t
  function birdPos(b, t, out) {
    const f = b.f;
    if (f.kind === 'soar') {
      const th = b.tTh + b.tW * t;
      out.set(f.anchor.x + b.tOff.x + Math.cos(th) * b.tR, f.anchor.y + b.tH + 6 * Math.sin(0.05 * t + b.ph), f.anchor.z + b.tOff.z + Math.sin(th) * b.tR);
      return avoidElephants(out);
    }
    const tt = t - b.lag;
    const th = f.th0 + f.dir * f.omega * tt;
    const R = f.R0 * (1 + 0.12 * Math.sin(0.11 * tt + f.k));
    const sw = b.w2 * t + b.ph;
    out.set(
      f.anchor.x + R * Math.cos(th) + b.ro * Math.cos(sw),
      f.anchor.y + f.H * (0.35 + 0.65 * Math.sin(0.05 * tt + f.k)) * (f.kind.startsWith('head') ? 1 : 0.5) + (f.kind.startsWith('head') ? 0 : f.H * 0.5) + b.va * Math.sin(1.7 * sw) + b.ro * 0.3 * Math.sin(sw * 1.3),
      f.anchor.z + R * Math.sin(th) + b.ro * Math.sin(sw),
    );
    return avoidElephants(out);
  }
  // empurra o ponto para fora das esferas de colisão dos elefantes próximos (cabeça, orelhas, tromba…)
  const nearEls = [];
  function avoidElephants(p) {
    for (const e of nearEls) {
      for (const c of e.colliders || []) {
        const dx = p.x - c.center.x, dy = p.y - c.center.y, dz = p.z - c.center.z, r = c.radius + 40;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < r * r) { const d = Math.sqrt(d2) || 1, k = r / d; p.x = c.center.x + dx * k; p.y = c.center.y + dy * k; p.z = c.center.z + dz * k; }
      }
    }
    return p;
  }

  // ========================== MULTIDÕES ==========================
  const CR = LIFE.CROWD;
  const crowdGeoBase = makePersonGeometry();
  const crowdUniforms = { uTime: timeU, uStride: { value: CR.STRIDE } };
  const crowdMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
  crowdMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, crowdUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + CROWD_PARS + '\nvec3 crowdP;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n  crowdP = crowdXform(position, objectNormal);' + crowdColorGLSL())
      .replace('#include <begin_vertex>', 'vec3 transformed = crowdP;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCrowdCol;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= vCrowdCol;');
  };
  crowdMat.customProgramCacheKey = () => 'life-crowd';
  const crowdDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  crowdDepth.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, crowdUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + CROWD_PARS)
      .replace('#include <begin_vertex>', 'vec3 _cn = vec3(0.0, 1.0, 0.0);\nvec3 transformed = crowdXform(position, _cn);');
  };
  crowdDepth.customProgramCacheKey = () => 'life-crowd-depth';

  const CLOTHES = [0xf1ece0, 0xe9dfc8, 0x2c3e66, 0x7a2a2a, 0xd08a2c, 0x5f6b3a, 0x2f7a74, 0xb5522f, 0x2a2a2a, 0x8c8c88, 0xc23b3b, 0x3d5a8a, 0xe2c44f, 0x6b3f6e, 0xa47a4c, 0xf4f1ea, 0x1e5a3c];
  const SKIN = [0x8d5524, 0xa86a3c, 0xc68642, 0xe0ac69, 0xf1c27d, 0x6b4226, 0xd19a6a];
  const HAIR = [0x1a1410, 0x2b1d14, 0x3a2a1c, 0x111111, 0x5a4030];
  const HEADWEAR = [0xf2efe6, 0xc23b3b, 0xd08a2c, 0x2c3e66, 0xe9dfc8, 0x2f7a74];

  const crowds = new Map();   // elephant → { root, mesh, center (local), counts }
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new V3(), _p = new V3(), _v = new V3();
  const PZ = ELEPHANT_MODEL.PLAZA;
  const plazaCX = (PZ.x0 + PZ.x1) / 2;

  // Piso da praça (local, modelo-base): a altura das bancas do mercado (instâncias 'market_stall'), ou a
  // moda das alturas de getSurfaceHeight na praça. Mais uma grade de alturas para saber onde o piso
  // está à vista (onde a pele/prédios sobem acima dele não se anda).
  const GRID = 3;   // passo da grade (local)
  function plazaOf(e) {
    if (e._lifePlaza) return e._lifePlaza;
    const rig = e.body || e.group, SC = e.group.scale.x || ELEPHANT.SCALE;
    e.group.updateMatrixWorld(true);
    const rigY = rig !== e.group ? rig.position.y : 0;
    const surf = (x, z) => {
      _v.set(x, 0, z); e.group.localToWorld(_v);
      const h = e.getSurfaceHeight?.(_v.x, _v.z);
      return h === null || h === undefined || !Number.isFinite(h) ? NaN : h / SC - rigY;
    };
    let top = NaN;
    const ys = [];
    rig.traverse((o) => { if (o.isInstancedMesh && o.name === 'market_stall') for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, _m4); ys.push(_m4.elements[13]); } });
    if (ys.length) { ys.sort((x, y) => x - y); top = ys[ys.length >> 1]; }
    const nx = Math.ceil((PZ.x1 - PZ.x0) / GRID) + 1, nz = Math.ceil((2 * PZ.hz) / GRID) + 1;
    const hraw = new Float32Array(nx * nz);
    const hist = new Map();
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const h = surf(PZ.x0 + i * GRID, -PZ.hz + j * GRID);
      hraw[i * nz + j] = h;
      if (Number.isFinite(h)) { const k = Math.round(h * 2) / 2; hist.set(k, (hist.get(k) || 0) + 1); }
    }
    if (!Number.isFinite(top)) { let best = 0; for (const [k, c] of hist) if (c > best) { best = c; top = k; } }
    if (!(Math.abs(top - CR.PLAZA_TOP) < 150)) top = CR.PLAZA_TOP;
    // onde a pele sobe acima do piso, o chão visível é a casca-crosta (calçamento): calibra a distância
    // pele → crosta com alguns raios contra a malha 'crust'
    let crustDelta = ELEPHANT_MODEL.CRUST_OFFSET ?? 3;
    const crust = rig.getObjectByName('crust');
    const rayCrust = crust && crust.geometry ? (() => {
      rig.updateMatrixWorld(true);
      const rel = new THREE.Matrix4().copy(rig.matrixWorld).invert().multiply(crust.matrixWorld);
      const tmp = new THREE.Mesh(crust.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      tmp.matrixAutoUpdate = false; tmp.matrix.copy(rel); tmp.matrixWorld.copy(rel);
      const rc = new THREE.Raycaster(), down = new V3(0, -1, 0), o = new V3();
      return (x, z) => { rc.set(o.set(x, 4000, z), down); const hit = rc.intersectObject(tmp, false)[0]; return hit ? hit.point.y : NaN; };
    })() : null;
    if (rayCrust) {
      const ds = [];
      for (let i = 1; i < nx - 1 && ds.length < 9; i += 4) for (let j = 1; j < nz - 1 && ds.length < 9; j += 4) {
        const h = hraw[i * nz + j]; if (!(h > top + 1)) continue;
        const c = rayCrust(PZ.x0 + i * GRID, -PZ.hz + j * GRID); if (Number.isFinite(c)) ds.push(c - h);
      }
      if (ds.length) { ds.sort((x, y) => x - y); crustDelta = clamp(ds[ds.length >> 1], -2, 8); }
    }
    const grid = new Float32Array(nx * nz);
    for (let k = 0; k < grid.length; k++) { const h = hraw[k]; grid[k] = !Number.isFinite(h) ? NaN : h > top + 0.4 ? h + crustDelta : top; }
    const g = (i, j) => (i >= 0 && j >= 0 && i < nx && j < nz ? grid[i * nz + j] : NaN);
    const groundAt = (x, z) => {
      const fx = clamp((x - PZ.x0) / GRID, 0, nx - 1.001), fz = clamp((z + PZ.hz) / GRID, 0, nz - 1.001);
      const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
      return lerp(lerp(g(i, j), g(i + 1, j), tx), lerp(g(i, j + 1), g(i + 1, j + 1), tx), tz);
    };
    // andável: chão definido e sem degraus (piso da praça ↔ crosta) na vizinhança
    const cellOK = (i, j) => {
      const c = g(i, j); if (!Number.isFinite(c)) return false;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = g(i + di, j + dj); if (!Number.isFinite(n) || Math.abs(n - c) > 1.1) return false; }
      return true;
    };
    const walkable = (x, z) => {
      const i = Math.round((x - PZ.x0) / GRID), j = Math.round((z + PZ.hz) / GRID);
      return cellOK(i, j) && cellOK(i + 1, j) && cellOK(i - 1, j) && cellOK(i, j + 1) && cellOK(i, j - 1);
    };
    let nOK = 0, nFloor = 0;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) { if (cellOK(i, j)) nOK++; if (Math.abs(hraw[i * nz + j] - top) < 0.4) nFloor++; }
    e._lifePlaza = { top, walkable, groundAt, rayCrust, crustDelta, fracWalk: nOK / (nx * nz), fracFloor: nFloor / (nx * nz), surf };
    return e._lifePlaza;
  }
  const plazaTopOf = (e) => plazaOf(e).top;

  function buildCrowd(e, ei) {
    const rig = e.body || e.group, SC = e.group.scale.x || ELEPHANT.SCALE;
    const cr = createRng(SEED + LIFE.SEED_OFF + 500 + ei * 13);
    const yTop = plazaTopOf(e);
    rig.updateMatrixWorld(true);
    const rigInv = new THREE.Matrix4().copy(rig.matrixWorld).invert();
    // bancas do mercado (matrizes no espaço do rig)
    const stalls = [];
    rig.traverse((o) => {
      if (!o.isInstancedMesh || o.name !== 'market_stall') return;
      const rel = new THREE.Matrix4().multiplyMatrices(rigInv, o.matrixWorld);
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, _m4); _m4.premultiply(rel); _m4.decompose(_p, _q, _s);
        const fwd = new V3(0, 0, 1).applyQuaternion(_q);
        const yaw = Math.atan2(fwd.x, fwd.z);
        stalls.push({ x: _p.x, y: _p.y, z: _p.z, yaw, c: Math.cos(yaw), s: Math.sin(yaw), hx: 0.56 * _s.x, hz: 0.48 * _s.z, sx: _s.x, sz: _s.z });
      }
    });
    const M = CR.STALL_MARGIN;
    const inStall = (x, z, m = M) => {
      for (const st of stalls) {
        const dx = x - st.x, dz = z - st.z;
        // para o referencial da banca (giro −yaw)
        const lx = dx * st.c - dz * st.s, lz = dx * st.s + dz * st.c;
        if (Math.abs(lx) < st.hx + m && Math.abs(lz) < st.hz + m) return true;
      }
      return false;
    };
    const inPlaza = (x, z) => x > PZ.x0 + 1.2 && x < PZ.x1 - 1.2 && Math.abs(z) < PZ.hz - 1.2;
    const PL = plazaOf(e);
    const free = (x, z) => inPlaza(x, z) && !inStall(x, z) && Math.hypot(x - plazaCX, z) > CR.FOUNTAIN_R && PL.walkable(x, z);
    // avenida central (da praça para a frente): perfil da crosta por raio vertical
    const avenue = [];
    const crust = rig.getObjectByName('crust');
    if (crust && crust.geometry) {
      const tmp = new THREE.Mesh(crust.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      const rel = new THREE.Matrix4().multiplyMatrices(rigInv, crust.matrixWorld);
      tmp.matrixAutoUpdate = false; tmp.matrix.copy(rel); tmp.matrixWorld.copy(rel);
      const rc = new THREE.Raycaster();
      let prevY = null;
      for (let x = PZ.x1 + 2; x <= CR.AVENUE_MAX_X; x += 6) {
        rc.set(_v.set(x, 4000, 0), new V3(0, -1, 0));
        const hit = rc.intersectObject(tmp, false)[0];
        if (!hit) break;
        if (prevY !== null && Math.abs(hit.point.y - prevY) > 6 * 0.75) break;
        avenue.push({ x, y: hit.point.y }); prevY = hit.point.y;
      }
    }
    const avY = (x) => {
      if (!avenue.length) return null;
      if (x <= avenue[0].x) return avenue[0].y;
      for (let i = 0; i < avenue.length - 1; i++) if (x <= avenue[i + 1].x) return lerp(avenue[i].y, avenue[i + 1].y, (x - avenue[i].x) / (avenue[i + 1].x - avenue[i].x));
      return avenue[avenue.length - 1].y;
    };
    const avX1 = avenue.length ? avenue[avenue.length - 1].x : 0;

    const N = CR.COUNT_HIGH;
    const people = [];   // { mode, p0:[4], p1:[4] }
    const speed = () => cr.range(CR.WALK_SPEED[0], CR.WALK_SPEED[1]);
    const add = (mode, p0, p1) => people.push({ mode, p0, p1 });
    // vendedores atrás do balcão e fregueses na frente
    for (const st of stalls) {
      const nv = cr() < 0.75 ? 1 : 2;
      for (let k = 0; k < nv && people.length < N; k++) {
        const lx = (nv === 1 ? cr.range(-0.2, 0.2) : (k ? 0.22 : -0.22)) * st.sx, lz = -0.4 * st.sz;
        const x = st.x + lx * st.c + lz * st.s, z = st.z - lx * st.s + lz * st.c;
        if (!PL.walkable(x, z) || Math.abs(PL.groundAt(x, z) - yTop) > 0.3) continue;   // banca à vista (não coberta pela crosta)
        add(2, [x * SC, yTop * SC, z * SC, st.yaw + cr.range(-0.3, 0.3)], [0, 0, 0, cr()]);
      }
      const nb = cr() < 0.45 ? 0 : cr() < 0.6 ? 1 : 2;
      for (let k = 0; k < nb && people.length < N; k++) {
        const lx = cr.range(-0.4, 0.4) * st.sx, lz = (0.62 + cr.range(0, 0.15)) * st.sz;
        const x = st.x + lx * st.c + lz * st.s, z = st.z - lx * st.s + lz * st.c;
        if (!free(x, z) || Math.abs(PL.groundAt(x, z) - yTop) > 0.3) continue;
        add(2, [x * SC, yTop * SC, z * SC, st.yaw + Math.PI + cr.range(-0.5, 0.5)], [0, 0, 0, cr()]);
      }
    }
    // grupinhos conversando
    for (let g = 0; g < 18; g++) {
      const x = cr.range(PZ.x0 + 3, PZ.x1 - 3), z = cr.range(-PZ.hz + 3, PZ.hz - 3);
      if (!free(x, z)) continue;
      const n = cr.int(2, 5);
      for (let k = 0; k < n && people.length < N; k++) {
        const a = (k / n) * TAU + cr.range(-0.3, 0.3), r = cr.range(0.25, 0.45);
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (!free(px, pz)) continue;
        add(2, [px * SC, PL.groundAt(px, pz) * SC, pz * SC, Math.atan2(x - px, z - pz)], [0, 0, 0, cr()]);
      }
    }
    // volta ao redor do chafariz
    const nRing = Math.round(N * 0.07);
    let ringOK = true;
    for (let k = 0; k < 24; k++) { const a = (k / 24) * TAU, r = CR.FOUNTAIN_R + 4, x = plazaCX + Math.cos(a) * r, z = Math.sin(a) * r; if (!PL.walkable(x, z) || Math.abs(PL.groundAt(x, z) - yTop) > 0.3) ringOK = false; }
    for (let k = 0; ringOK && k < nRing; k++) {
      const r = CR.FOUNTAIN_R + cr.range(0.6, 7);
      add(1, [plazaCX * SC, yTop * SC, 0, r * SC], [cr() * TAU, 0, speed() * (cr() < 0.5 ? 1 : -1), cr()]);
    }
    // avenida central
    const nAv = avenue.length > 3 ? Math.round(N * 0.2) : 0;
    for (let k = 0, tries = 0; k < nAv && tries < nAv * 4; tries++) {
      const ax0 = avenue[0].x;
      const xa = cr.range(ax0, avX1 - 2), len = cr.range(4, 14) * (cr() < 0.5 ? 1 : -1);
      const xb = clamp(xa + len, ax0, avX1);
      if (Math.abs(xb - xa) < 2) continue;
      const z = cr.range(-CR.AVENUE_HALF, CR.AVENUE_HALF);
      const ya = avY(xa), yb = avY(xb);
      add(0, [xa * SC, ya * SC, z * SC, xb * SC], [yb * SC, (z + cr.range(-0.6, 0.6)) * SC, speed(), cr()]);
      k++;
    }
    // caminhantes da praça: segmentos livres (corredores entre as bancas)
    for (let tries = 0; people.length < N && tries < N * 30; tries++) {
      const x = cr.range(PZ.x0 + 1.5, PZ.x1 - 1.5), z = cr.range(-PZ.hz + 1.5, PZ.hz - 1.5);
      if (!free(x, z)) continue;
      const ang = cr() < 0.7 ? Math.floor(cr() * 4) * (Math.PI / 2) + cr.range(-0.05, 0.05) : cr() * TAU;
      const len = cr.range(6, 38) / SC;
      const bx = x + Math.cos(ang) * len, bz = z + Math.sin(ang) * len;
      let ok = true;
      const ya = PL.groundAt(x, z), yb = PL.groundAt(bx, bz);
      if (Math.max(ya, yb) > yTop + 0.3 && cr() < 0.6) continue;   // a maioria anda entre as bancas (piso à vista), menos sobre a crosta
      const steps = Math.ceil(len / 0.4);
      for (let k = 1; k <= steps && ok; k++) {
        const t = k / steps, px = lerp(x, bx, t), pz = lerp(z, bz, t);
        if (!free(px, pz) || Math.abs(PL.groundAt(px, pz) - lerp(ya, yb, t)) > 0.2) ok = false;   // nem enterra nem flutua no meio
      }
      if (!ok) continue;
      add(0, [x * SC, ya * SC, z * SC, bx * SC], [yb * SC, bz * SC, speed(), cr()]);
    }
    // embaralha (o LOD reduz a contagem por um prefixo uniforme)
    for (let i = people.length - 1; i > 0; i--) { const j = Math.floor(cr() * (i + 1)); const t = people[i]; people[i] = people[j]; people[j] = t; }

    const n = people.length;
    const geo = new THREE.InstancedBufferGeometry();
    for (const k of Object.keys(crowdGeoBase.attributes)) geo.setAttribute(k, crowdGeoBase.attributes[k]);
    const A = (sz) => new Float32Array(n * sz);
    const P0 = A(4), P1 = A(4), MO = A(4), C0 = A(3), C1 = A(3), C2 = A(3), C3 = A(3);
    const col = new THREE.Color();
    const setC = (arr, i, hex, jit = 0.08) => { col.set(hex); const f = 1 + cr.range(-jit, jit); arr[i * 3] = col.r * f; arr[i * 3 + 1] = col.g * f; arr[i * 3 + 2] = col.b * f; };
    people.forEach((p, i) => {
      P0.set(p.p0, i * 4); P1.set(p.p1, i * 4);
      const robe = cr() < 0.3;
      MO[i * 4] = p.mode; MO[i * 4 + 1] = CR.HEIGHT * cr.range(0.9, 1.08) * (cr() < 0.08 ? 0.72 : 1); MO[i * 4 + 2] = cr.range(0.9, 1.15) * (robe ? 1.12 : 1); MO[i * 4 + 3] = cr.range(0.9, 1.1);
      const top = CLOTHES[Math.floor(cr() * CLOTHES.length)];
      setC(C0, i, top);
      setC(C1, i, robe ? top : CLOTHES[Math.floor(cr() * CLOTHES.length)]);
      setC(C2, i, SKIN[Math.floor(cr() * SKIN.length)], 0.05);
      setC(C3, i, cr() < 0.35 ? HEADWEAR[Math.floor(cr() * HEADWEAR.length)] : HAIR[Math.floor(cr() * HAIR.length)], 0.05);
    });
    geo.setAttribute('aP0', new THREE.InstancedBufferAttribute(P0, 4));
    geo.setAttribute('aP1', new THREE.InstancedBufferAttribute(P1, 4));
    geo.setAttribute('aMode', new THREE.InstancedBufferAttribute(MO, 4));
    geo.setAttribute('aC0', new THREE.InstancedBufferAttribute(C0, 3));
    geo.setAttribute('aC1', new THREE.InstancedBufferAttribute(C1, 3));
    geo.setAttribute('aC2', new THREE.InstancedBufferAttribute(C2, 3));
    geo.setAttribute('aC3', new THREE.InstancedBufferAttribute(C3, 3));
    const mesh = new THREE.InstancedMesh(geo, crowdMat, n);   // matrizes identidade: o shader posiciona
    mesh.name = 'life_crowd_' + ei;
    mesh.customDepthMaterial = crowdDepth;
    mesh.frustumCulled = false;
    mesh.userData.shadowsSet = true; mesh.castShadow = !low; mesh.receiveShadow = true;
    const croot = new THREE.Group(); croot.name = 'life_crowd_root';
    croot.scale.setScalar(1 / SC);
    croot.add(mesh);
    rig.add(croot);
    const centerLocal = new V3(plazaCX + (avX1 ? (avX1 - plazaCX) * 0.35 : 0), yTop, 0);
    const radius = Math.max(PZ.x1 - PZ.x0, avX1 - PZ.x0) * SC * 0.75;
    // ponto de interesse (local): centróide dos vendedores/fregueses (as bancas à vista)
    const focusLocal = new V3(); let nf = 0;
    for (const p of people) if (p.mode === 2) { focusLocal.x += p.p0[0] / SC; focusLocal.y += p.p0[1] / SC; focusLocal.z += p.p0[2] / SC; nf++; }
    if (nf) focusLocal.divideScalar(nf); else focusLocal.copy(centerLocal);
    const c = { root: croot, mesh, n, centerLocal, radius, focusLocal, stalls: stalls.length, avenue: avenue.length, rig };
    crowds.set(e, c);
    stats.crowdBuilt = (stats.crowdBuilt || []).concat([{ el: ei, people: n, stalls: stalls.length, avenue: avenue.length, plazaTop: +yTop.toFixed(1), walkable: +PL.fracWalk.toFixed(2), floorVisible: +PL.fracFloor.toFixed(2), crustDelta: +PL.crustDelta.toFixed(2) }]);
    return c;
  }

  // ============================ UPDATE ============================
  const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _fw = new V3();
  const _quat = new THREE.Quaternion(), _eul = new THREE.Euler(0, 0, 0, 'YXZ'), _one = new V3(1, 1, 1), _zero = new V3(0, 0, 0);
  const _frustum = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sph = new THREE.Sphere();
  const dispFade = OCEAN.DISP_FADE.map((v) => v * (low ? 0.6 : 1));
  const stats = { ships: ships.length, birds: birds.length, crowdsVisible: 0, people: 0 };
  let camAlt = camera ? camera.position.y : 300;
  const plazaWorld = (e, out) => { const rig = e.body || e.group; return rig.localToWorld(out.set(plazaCX, plazaTopOf(e), 0)); };

  function updateShips(time, cam) {
    const cx = cam.position.x, cz = cam.position.z;
    Object.assign(WAVE_CTX, { cx, cz, camH: cam.position.y, seg: low ? OCEAN.SEGMENTS_LOW : OCEAN.SEGMENTS_HIGH, f0: dispFade[0], f1: dispFade[1] });
    let wv = 0;
    for (let si = 0; si < ships.length; si++) {
      const s = ships[si];
      shipPos(s, time, time, s.pos);
      shipPos(s, time - 1, time, _a);
      const dx = s.pos.x - _a.x, dz = s.pos.z - _a.z;
      if (dx * dx + dz * dz > 1e-6) s.heading = Math.atan2(-dz, dx);
      const fx = Math.cos(s.heading), fz = -Math.sin(s.heading);
      const dist = Math.hypot(s.pos.x - cx, s.pos.z - cz);
      s.visible = dist < SH.DRAW_DIST;
      // ondas: altura na proa, popa e bordos (a mesma superfície que o ocean.js desenha)
      const fade = dist < dispFade[1] ? 1 : 0;
      let heave = 0, pitch = 0, roll = 0;
      if (fade > 0) {
        const hl = s.L * 0.42, hb = s.B * 0.5;
        const hBow = waveHeight(s.pos.x + fx * hl, s.pos.z + fz * hl, time), hSt = waveHeight(s.pos.x - fx * hl, s.pos.z - fz * hl, time);
        const hP = waveHeight(s.pos.x - fz * hb, s.pos.z + fx * hb, time), hS = waveHeight(s.pos.x + fz * hb, s.pos.z - fx * hb, time);
        heave = (hBow + hSt + hP + hS) * 0.25;
        pitch = Math.atan2(hBow - hSt, 2 * hl) * s.bob * fade;
        roll = Math.atan2(hS - hP, 2 * hb) * s.bob * 0.8 * fade;
      }
      // balanço próprio leve (barcos pequenos jogam mais)
      roll += Math.sin(time * (0.5 + 0.3 / s.scale) + si * 1.7) * 0.012 * s.bob;
      _eul.set(roll, s.heading, pitch, 'YXZ');
      _quat.setFromEuler(_eul);
      _p.set(s.pos.x, heave, s.pos.z);
      _m4.compose(_p, _quat, s.visible ? _s.setScalar(s.scale) : _zero);
      s.mesh.setMatrixAt(s.i, _m4);

      // esteira: pontos passados da proa
      const base = si * NW * NA;
      const on = s.visible && dist < 18000;
      if (!on) {
        for (let v = 0; v < NW * NA; v++) { const o = (base + v) * 3; wPos[o] = s.pos.x; wPos[o + 1] = -50; wPos[o + 2] = s.pos.z; }
        continue;
      }
      const vNom = s.mode === 'escort' ? Math.max(4, s.speed * 0.9) : s.speed;
      for (let j = 0; j < NW; j++) {
        const age = s.wakeDists[j] / vNom;
        shipPos(s, time - age, time, s.trail[j]);
      }
      // a proa: centro + frente·L/2 (direção de cada ponto pela diferença dos vizinhos)
      let dAcc = 0;
      for (let j = 0; j < NW; j++) {
        const p = s.trail[j];
        const pa = s.trail[Math.max(0, j - 1)], pb = s.trail[Math.min(NW - 1, j + 1)];
        let tx = pa.x - pb.x, tz = pa.z - pb.z;
        if (j === 0) { tx = fx; tz = fz; }
        const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        _b.set(p.x + tx * s.L * 0.5, 0, p.z + tz * s.L * 0.5);
        if (j > 0) dAcc += Math.hypot(_b.x - _c.x, _b.z - _c.z);
        _c.copy(_b);
        const d = dAcc;
        const hullHalf = 0.5 * s.B * smooth(0, 0.3 * s.L, d) * (d < s.L * 1.05 ? 1 : 0.9);
        const hw = 1.2 + 0.5 * s.B * smooth(0, 0.3 * s.L, d) + SH.KELVIN * d;
        const cw = 0.5 * s.B * (0.75 + 0.6 * smooth(s.L, s.L * 5, d));
        const nx = -tz, nz = tx;   // perpendicular (bombordo)
        const fadeW = Math.hypot(_b.x - cx, _b.z - cz) < dispFade[1] + 400 ? 1 : 0;
        for (let k = 0; k < NA; k++) {
          const sv = ACROSS[k];
          const x = _b.x + nx * hw * sv, z = _b.z + nz * hw * sv;
          const v = base + j * NA + k, o = v * 3, o4 = v * 4;
          wPos[o] = x; wPos[o + 2] = z;
          wPos[o + 1] = (fadeW > 0 ? waveHeight(x, z, time) : 0) + SH.WAKE_LIFT;
          wW[o4] = sv; wW[o4 + 1] = d; wW[o4 + 2] = hullHalf / hw; wW[o4 + 3] = Math.min(0.95, cw / hw);
        }
      }
      wv++;
    }
    for (const k in shipMeshes) shipMeshes[k].instanceMatrix.needsUpdate = true;
    wakeGeo.attributes.position.needsUpdate = true;
    wakeGeo.attributes.aW.needsUpdate = true;
    stats.wakes = wv;
  }

  function updateBirds(time, dt, cam) {
    const cp = cam.position;
    // âncoras: elefantes mais próximos, ilha mais próxima, navio mais próximo, térmicas
    const els = elephants.map((e) => ({ e, d: Math.hypot(e.position.x - cp.x, e.position.z - cp.z) })).sort((a, b) => a.d - b.d);
    camAlt = lerp(camAlt, cp.y, 1 - Math.exp(-dt / 20));
    nearEls.length = 0;
    for (let k = 0; k < Math.min(2, els.length); k++) if (els[k].d < 12000) nearEls.push(els[k].e);
    for (const f of flocks) {
      f.active = true;
      if (f.kind === 'headGulls' || f.kind === 'headGulls2') {
        let it = els[f.kind === 'headGulls' ? 0 : 1];
        if (!it) { f.active = false; continue; }
        // histerese: só troca de elefante se o novo estiver bem mais perto (o bando não pisca entre dois)
        const cur = f.subject && els.find((x) => x.e === f.subject);
        const other = flocks.find((g2) => g2 !== f && (g2.kind === 'headGulls' || g2.kind === 'headGulls2'));
        if (cur && it.e !== cur.e && (it.d > cur.d * 0.8 || (other && other.subject === it.e))) it = cur;
        if (other && other.subject === it.e && it.e !== f.subject) it = els.find((x) => x.e !== other.subject) || it;
        f.subject = it.e;
        const g = it.e.group;
        f.anchor.set(ELEPHANT.HEAD.cx, ELEPHANT.HEAD.cy, 0); g.localToWorld(f.anchor);
      } else if (f.kind === 'cityDoves') {
        const it = els[0]; if (!it) { f.active = false; continue; }
        f.anchor.set((ELEPHANT_MODEL.PLAZA.x0 + ELEPHANT_MODEL.PLAZA.x1) / 2, it.e.plazaTopLocal ?? it.e.cityTopLocal ?? (ELEPHANT.SHOULDER_HEIGHT + 60), 0); it.e.group.localToWorld(f.anchor);
      } else if (f.kind === 'market') {
        const it = els[0]; if (!it) { f.active = false; continue; }
        plazaWorld(it.e, f.anchor);
      } else if (f.kind === 'island') {
        let best = null, bd = Infinity;
        for (const isl of islands) { const d = Math.hypot(isl.cx - cp.x, isl.cz - cp.z) - isl.R; if (d < bd) { bd = d; best = isl; } }
        if (!best) { f.active = false; continue; }
        const th = Math.atan2(cp.z - best.cz, cp.x - best.cx);
        const qth = Math.round(th / 0.5) * 0.5;   // ponto da costa voltado para a câmera (quantizado: não segue a câmera)
        const r = best.outlineRadius(qth) + 150;
        f.anchor.set(best.cx + Math.cos(qth) * r, 0, best.cz + Math.sin(qth) * r);
      } else if (f.kind === 'ship') {
        let best = null, bd = 8000;
        for (const s of ships) { const d = Math.hypot(s.pos.x - cp.x, s.pos.z - cp.z); if (d < bd && s.type !== 'FISHING') { bd = d; best = s; } }
        if (!best) { f.active = false; continue; }
        f.anchor.set(best.pos.x - Math.cos(best.heading) * best.L * 0.3, best.L * 0.05, best.pos.z + Math.sin(best.heading) * best.L * 0.3);
      } else if (f.kind === 'soar') {
        const cell = BC.SOAR_CELL;
        const ix = Math.round(cp.x / cell), iz = Math.round(cp.z / cell);
        const hsh = (Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453) % 1;
        f.active = Math.abs(hsh) < 0.6 && camAlt > 60;
        f.anchor.set(ix * cell + 400, clamp(camAlt, 120, 7000), iz * cell - 300);
      }
    }
    for (let i = 0; i < birds.length; i++) {
      const b = birds[i];
      if (!b.f.active) { _m4.makeScale(0, 0, 0); birdMesh.setMatrixAt(i, _m4); continue; }
      birdPos(b, time, _a);
      birdPos(b, time - 0.08, _b);
      birdPos(b, time - 0.16, _c);
      const vx = _a.x - _b.x, vy = _a.y - _b.y, vz = _a.z - _b.z;
      const sp = Math.hypot(vx, vy, vz) / 0.08 || 1;
      const yaw = Math.atan2(-vx, -vz), yaw0 = Math.atan2(-(_b.x - _c.x), -(_b.z - _c.z));
      let dy = yaw - yaw0; if (dy > Math.PI) dy -= TAU; if (dy < -Math.PI) dy += TAU;
      const roll = clamp(Math.atan(sp * (dy / 0.08) / 9.81), -0.9, 0.9);
      const pitch = clamp(Math.asin(clamp(vy / (sp * 0.08), -1, 1)), -0.5, 0.5);
      _eul.set(pitch, yaw, roll, 'YXZ'); _quat.setFromEuler(_eul);
      _m4.compose(_a, _quat, _s.setScalar(b.size));
      birdMesh.setMatrixAt(i, _m4);
    }
    birdMesh.instanceMatrix.needsUpdate = true;
  }

  function updateCrowds(cam) {
    stats.crowdsVisible = 0; stats.people = 0;
    if (low) return;
    _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pm);
    elephants.forEach((e, ei) => {
      const d = plazaWorld(e, _d).distanceTo(cam.position);
      let c = crowds.get(e);
      if (d > CR.DIST) { if (c) c.root.visible = false; return; }
      if (!c) c = buildCrowd(e, ei);
      c.rig.localToWorld(_sph.center.copy(c.centerLocal));
      _sph.radius = c.radius;
      const vis = _frustum.intersectsSphere(_sph);
      c.root.visible = vis;
      if (!vis) return;
      const f = d < CR.FULL_DIST ? 1 : lerp(1, 0.35, smooth(CR.FULL_DIST, CR.DIST, d));
      c.mesh.count = Math.max(1, Math.round(c.n * f));
      c.mesh.castShadow = d < 1600;
      stats.crowdsVisible++; stats.people += c.mesh.count;
    });
  }

  const api = {
    object: root,
    stats,
    update(dt, time, cam = camera) {
      if (!cam) return;
      timeU.value = time;
      wakeMat.uniforms.uTime.value = time;
      updateShips(time, cam);
      updateBirds(time, dt, cam);
      updateCrowds(cam);
    },
    // depuração/testes (dev/life-test.js)
    debug: { ships, flocks, birds, crowds, plazaWorld, plazaTopOf, buildCrowd },
  };
  // triângulos por tipo (orçamento ≤ 3k)
  stats.tris = Object.fromEntries(Object.entries(types).map(([k, t]) => [k, t.geo.attributes.position.count / 3]));
  stats.tris.person = crowdGeoBase.attributes.position.count / 3;
  stats.tris.bird = birdGeo.attributes.position.count / 3;
  if (camera) api.update(0, 0, camera);
  return api;
}
