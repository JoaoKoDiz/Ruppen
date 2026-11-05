// =====================================================================
//  RUPPEN — Pomba do jogador, candidato A ("fidelidade à referência").
//  createDove({ quality }) -> { group, packageAnchor, update(dt, flightState) }
//
//  Convenção local: frente = -Z, cima = +Y, direita = +X; centro do corpo na origem.
//  Tudo procedural: corpo por perfil de estações (elipses ao longo de Z), asas como
//  chapas extrudadas com "dedos" (primárias) animadas por esqueleto de 3 ossos
//  (ombro → pulso → mão), cauda em leque, arreios que seguem a superfície do corpo
//  (sela, cilha, peitoral com argola, estribos, rédeas dinâmicas) e cavaleiro
//  estilizado em proporções humanas. Texturas de penas via canvas 2D.
//  Orçamento: ~10 draw calls, ~12 k triângulos.
// =====================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DOVE, DOVE_MODEL, SEED } from '../../config.js';
import { createRng } from '../../util/rng.js';

const TAU = Math.PI * 2;
const C = DOVE_MODEL.COLORS;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const smooth = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = THREE.MathUtils.lerp;

// ------------------------------------------------------------------
//  Utilitários de geometria
// ------------------------------------------------------------------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const UP = V(0, 1, 0);

// Cor uniforme por vértice (+ uv vazio se faltar) para permitir a fusão num só draw call
function paint(geo, hex) {
  const n = geo.attributes.position.count;
  const c = new THREE.Color(hex);
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!geo.attributes.normal) geo.computeVertexNormals();
  return geo;
}
// Posiciona/rotaciona/escala uma geometria no lugar
function place(geo, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
  _e.set(rot[0], rot[1], rot[2]); _q.setFromEuler(_e);
  _m.compose(_p.set(pos[0], pos[1], pos[2]), _q, _s.set(scale[0], scale[1], scale[2]));
  geo.applyMatrix4(_m);
  return geo;
}
// Esfera (elipsoide) pronta
function ball(r, pos, scale = [1, 1, 1], seg = 14) {
  return place(new THREE.SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.75))), pos, [0, 0, 0], scale);
}
// Cilindro cônico entre dois pontos (membros, tiras, hastes)
function limb(a, b, r0, r1 = r0, seg = 10) {
  const dir = b.clone().sub(a); const len = dir.length();
  const geo = new THREE.CylinderGeometry(r1, r0, len, seg, 1, false);
  geo.translate(0, len / 2, 0);
  _q.setFromUnitVectors(UP, dir.normalize());
  _m.compose(a, _q, _s.set(1, 1, 1));
  geo.applyMatrix4(_m);
  return geo;
}
// Tira chata (caixa fina) entre dois pontos
function strap(a, b, w, t) {
  const dir = b.clone().sub(a); const len = dir.length();
  const geo = new THREE.BoxGeometry(w, len, t);
  geo.translate(0, len / 2, 0);
  _q.setFromUnitVectors(UP, dir.normalize());
  _m.compose(a, _q, _s.set(1, 1, 1));
  geo.applyMatrix4(_m);
  return geo;
}
// Garante que cada triângulo indexado aponte para o lado da normal dos vértices
function fixWinding(geo) {
  const idx = geo.index.array, p = geo.attributes.position.array, n = geo.attributes.normal.array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nn = new THREE.Vector3();
  for (let i = 0; i < idx.length; i += 3) {
    const ia = idx[i], ib = idx[i + 1], ic = idx[i + 2];
    a.fromArray(p, ia * 3); b.fromArray(p, ib * 3); c.fromArray(p, ic * 3); nn.fromArray(n, ia * 3);
    b.sub(a); c.sub(a); b.cross(c);
    if (b.dot(nn) < 0) { idx[i + 1] = ic; idx[i + 2] = ib; }
  }
  return geo;
}

// ------------------------------------------------------------------
//  Perfil do corpo: estações [z, centroY, meia-largura X, meia-altura Y]
//  (da base da cauda ao pescoço; interpolação Catmull-Rom)
// ------------------------------------------------------------------
const STATIONS = [
  [ 0.92,  0.05, 0.04, 0.04],
  [ 0.82,  0.04, 0.13, 0.11],
  [ 0.58,  0.02, 0.28, 0.25],
  [ 0.25,  0.00, 0.40, 0.38],
  [-0.10,  0.00, 0.44, 0.44],
  [-0.45, -0.02, 0.42, 0.46],   // peito um pouco mais fundo
  [-0.75,  0.02, 0.33, 0.38],
  [-0.95,  0.12, 0.20, 0.23],
  [-1.08,  0.22, 0.14, 0.15],   // pescoço curto
  [-1.20,  0.28, 0.12, 0.12],
  [-1.27,  0.30, 0.05, 0.05],
];
const HEAD_POS = V(0, 0.31, -1.24);
function crom(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
function stationAt(u) {
  const n = STATIONS.length - 1; const f = u * n; const i = Math.min(n - 1, Math.floor(f)); const t = f - i;
  const g = (k) => STATIONS[Math.max(0, Math.min(n, k))];
  const out = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) out[c] = crom(g(i - 1)[c], g(i)[c], g(i + 1)[c], g(i + 2)[c], t);
  return out;
}
let TABLE = null;
function profileAt(z) { // interpola a tabela amostrada pelo z (decrescente da cauda ao pescoço)
  if (!TABLE) { TABLE = []; for (let i = 0; i <= 240; i++) TABLE.push(stationAt(i / 240)); }
  if (z >= TABLE[0][0]) return TABLE[0];
  for (let k = 0; k < TABLE.length - 1; k++) {
    const a = TABLE[k], b = TABLE[k + 1];
    if (z <= a[0] && z >= b[0]) {
      const t = (a[0] - z) / Math.max(1e-6, a[0] - b[0]);
      return [z, lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)];
    }
  }
  return TABLE[TABLE.length - 1];
}
// Ponto (e normal aproximada) sobre a pele do corpo, com afastamento `off`
function surface(z, th, off, outP, outN) {
  const pr = profileAt(z); const cy = pr[1], hx = pr[2], hy = pr[3];
  const c = Math.cos(th), s = Math.sin(th);
  let nx = c / Math.max(hx, 0.02), ny = s / Math.max(hy, 0.02); const l = Math.hypot(nx, ny); nx /= l; ny /= l;
  outP.set(hx * c + nx * off, cy + hy * s + ny * off, z);
  if (outN) outN.set(nx, ny, 0);
  return outP;
}
// Fita que acompanha a pele (tiras de couro): path = [[z, th], ...], hw = meia-largura (m)
function ribbon(path, hw, off, hex) {
  const pos = [], nor = [], idx = [];
  const P = V(), N = V(), T = V(), L = V(), Pp = V(), Pn = V();
  const n = path.length;
  for (let i = 0; i < n; i++) {
    surface(path[i][0], path[i][1], off, P, N);
    const ip = Math.max(0, i - 1), inn = Math.min(n - 1, i + 1);
    surface(path[ip][0], path[ip][1], off, Pp); surface(path[inn][0], path[inn][1], off, Pn);
    T.subVectors(Pn, Pp).normalize();
    L.crossVectors(N, T).normalize();
    pos.push(P.x + L.x * hw, P.y + L.y * hw, P.z + L.z * hw, P.x - L.x * hw, P.y - L.y * hw, P.z - L.z * hw);
    nor.push(N.x, N.y, N.z, N.x, N.y, N.z);
  }
  for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setIndex(idx);
  return paint(fixWinding(geo), hex);
}
// Retalho de couro sobre a pele (abas da sela): grade em (z, th)
function patch(z0, z1, th0, th1, off, hex, nz = 6, nt = 8, round = 0) {
  const pos = [], nor = [], idx = [];
  const P = V(), N = V();
  for (let i = 0; i <= nz; i++) for (let j = 0; j <= nt; j++) {
    // `round` estreita a faixa de th perto das pontas em z (retalho ovalado)
    const t = 2 * (i / nz) - 1, k = 1 - round * (1 - Math.sqrt(Math.max(0, 1 - t * t)));
    const thm = (th0 + th1) / 2, thh = ((th1 - th0) / 2) * k;
    surface(lerp(z0, z1, i / nz), lerp(thm - thh, thm + thh, j / nt), off, P, N);
    pos.push(P.x, P.y, P.z); nor.push(N.x, N.y, N.z);
  }
  for (let i = 0; i < nz; i++) for (let j = 0; j < nt; j++) {
    const a = i * (nt + 1) + j, b = a + nt + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setIndex(idx);
  return paint(fixWinding(geo), hex);
}

// ------------------------------------------------------------------
//  Corpo (malha por estações) + pés recolhidos, cores por vértice
// ------------------------------------------------------------------
function buildBody(nAlong, nAround) {
  const pos = [], nor = [], uv = [], col = [], idx = [];
  const warm = new THREE.Color(C.featherTop), cool = new THREE.Color(C.featherUnder), tmp = new THREE.Color();
  const Pu = V(), Pt = V(), Nn = V();
  for (let i = 0; i <= nAlong; i++) {
    const u = i / nAlong; const st = stationAt(u), st2 = stationAt(Math.min(1, u + 1e-3));
    for (let j = 0; j <= nAround; j++) {
      const th = (j / nAround) * TAU, c = Math.cos(th), s = Math.sin(th);
      pos.push(st[2] * c, st[1] + st[3] * s, st[0]);
      // normal por diferenças finitas (tangente ao longo × tangente ao redor)
      Pu.set(st2[2] * c - st[2] * c, (st2[1] + st2[3] * s) - (st[1] + st[3] * s), st2[0] - st[0]);
      Pt.set(-st[2] * s, st[3] * c, 0);
      Nn.crossVectors(Pu, Pt).normalize();
      nor.push(Nn.x, Nn.y, Nn.z);
      uv.push((j / nAround) * 2, u * 3);
      const k = 0.5 + 0.5 * s; // 1 em cima, 0 embaixo
      tmp.copy(cool).lerp(warm, Math.pow(k, 0.6));
      col.push(tmp.r, tmp.g, tmp.b);
    }
  }
  for (let i = 0; i < nAlong; i++) for (let j = 0; j < nAround; j++) {
    const a = i * (nAround + 1) + j, b = a + nAround + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  fixWinding(geo);

  // pés rosados recolhidos sob a barriga (perna curta + 3 dedos para trás)
  const feet = [];
  for (const sx of [-1, 1]) {
    const hip = V(sx * 0.13, -0.3, 0.12), ankle = V(sx * 0.16, -0.41, 0.34);
    feet.push(limb(hip, ankle, 0.03, 0.022, 8));
    feet.push(ball(0.028, ankle.toArray(), [1, 1, 1], 8));
    for (const [dx, dz] of [[0.0, 1], [0.6, 0.8], [-0.5, 0.85]]) {
      const tip = ankle.clone().add(V(sx * dx * 0.12, -0.02, dz * 0.17));
      feet.push(limb(ankle, tip, 0.014, 0.005, 6));
    }
  }
  const feetGeo = mergeGeometries(feet.map((g) => paint(g, C.feet)), false);
  // uv dos pés numa área lisa da textura
  feetGeo.attributes.uv.array.fill(0.5);
  return mergeGeometries([geo, feetGeo], false);
}

// ------------------------------------------------------------------
//  Contorno da asa direita (coordenadas da forma: x = envergadura a partir do
//  ombro, y = para a frente). Dedos = leque de primárias ao redor do pulso W.
// ------------------------------------------------------------------
function wingOutline() {
  const W = [1.3, -0.02];
  const angles = [12, -5, -22, -39, -56].map((a) => (a * Math.PI) / 180);
  const R = [0.7, 0.68, 0.64, 0.58, 0.5];
  const notchR = 0.27;
  const polar = (a, r) => [W[0] + Math.cos(a) * r, W[1] + Math.sin(a) * r];
  const pts = [[-0.22, 0.4], [0.15, 0.5], [0.55, 0.52], [0.95, 0.45], [1.25, 0.33], [1.5, 0.26], [1.72, 0.2]];
  const fingers = [];
  for (let i = 0; i < 5; i++) {
    const a = angles[i], r = R[i], d = (6 * Math.PI) / 180;
    const front = polar(a + d, r - 0.1), tip = polar(a, r), back = polar(a - d, r - 0.1);
    pts.push(front, tip, back);
    const notchA = i < 4 ? (a + angles[i + 1]) / 2 : a - (8 * Math.PI) / 180;
    pts.push(polar(notchA, i < 4 ? notchR : 0.4));
    fingers.push({ a, r, front, tip, back });
  }
  pts.push([1.3, -0.45], [1.0, -0.55], [0.6, -0.6], [0.2, -0.6], [-0.22, -0.5]);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  return { pts, fingers, W, bbox: { minX, minY, W: maxX - minX, H: maxY - minY } };
}
// Contorno da cauda (x lateral, y para a frente; o leque vai para -y)
function tailOutline() {
  const pts = [[0.14, 0.1], [0.2, -0.1], [0.4, -0.4], [0.5, -0.58]];
  const cx = 0, cy = 0.05, Rt = DOVE_MODEL.TAIL_LENGTH - 0.05, Rn = Rt - 0.03;
  const a0 = (-52 * Math.PI) / 180, a1 = (-128 * Math.PI) / 180, nF = 7;
  for (let k = 0; k < nF; k++) {
    const a = lerp(a0 - 0.05, a1 + 0.05, (k + 0.5) / nF);
    pts.push([cx + Math.cos(a) * Rt, cy + Math.sin(a) * Rt]);
    if (k < nF - 1) { const an = lerp(a0 - 0.05, a1 + 0.05, (k + 1) / nF); pts.push([cx + Math.cos(an) * Rn, cy + Math.sin(an) * Rn]); }
  }
  pts.push([-0.5, -0.58], [-0.4, -0.4], [-0.2, -0.1], [-0.14, 0.1]);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  return { pts, bbox: { minX, minY, W: maxX - minX, H: maxY - minY } };
}

// ------------------------------------------------------------------
//  Texturas procedurais (canvas 2D)
// ------------------------------------------------------------------
function makeCanvas(w, h) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; return [cv, cv.getContext('2d')]; }
function toTexture(cv, repeat) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  return t;
}
// Pele do corpo: branco quente com estrias suaves de penas (repetível)
function bodyTexture(rng) {
  const w = 512, h = 512; const [cv, g] = makeCanvas(w, h);
  g.fillStyle = '#fbf8f3'; g.fillRect(0, 0, w, h);
  g.lineCap = 'round';
  for (let i = 0; i < 260; i++) {
    const x = rng() * w, y = rng() * h, len = 18 + rng() * 60, bend = (rng() - 0.5) * 24;
    const a = 0.03 + rng() * 0.07;
    g.strokeStyle = rng() < 0.3 ? `rgba(205,190,172,${a})` : `rgba(140,152,168,${a})`;
    g.lineWidth = 1.5 + rng() * 4;
    for (const [ox, oy] of [[0, 0], [w, 0], [-w, 0], [0, h], [0, -h]]) {
      g.beginPath(); g.moveTo(x + ox, y + oy); g.quadraticCurveTo(x + ox + bend, y + oy + len * 0.5, x + ox, y + oy + len); g.stroke();
    }
  }
  return toTexture(cv, true);
}
// Asa: estrias radiais a partir do ombro, fileiras de coberteiras e primárias escuras
function wingTexture(rng, outline) {
  const w = 1024, h = 512; const [cv, g] = makeCanvas(w, h);
  const { minX, minY, W: BW, H: BH } = outline.bbox;
  const px = (x) => ((x - minX) / BW) * w, py = (y) => (1 - (y - minY) / BH) * h;
  g.fillStyle = '#fbf8f3'; g.fillRect(0, 0, w, h);
  g.lineCap = 'round';
  // estrias
  for (let i = 0; i < 220; i++) {
    const s0 = -0.2 + rng() * 1.6, c0 = -0.55 + rng() * 1.05;
    const ang = Math.atan2(c0 - 0.15, s0 + 0.35) + (rng() - 0.5) * 0.3;
    const len = 0.08 + rng() * 0.3, a = 0.03 + rng() * 0.06;
    g.strokeStyle = `rgba(150,160,175,${a})`; g.lineWidth = 1 + rng() * 3;
    g.beginPath(); g.moveTo(px(s0), py(c0)); g.lineTo(px(s0 + Math.cos(ang) * len), py(c0 + Math.sin(ang) * len)); g.stroke();
  }
  // fileiras de coberteiras (arcos em escama)
  g.strokeStyle = 'rgba(120,132,150,0.13)'; g.lineWidth = 2;
  for (const [cf, sz] of [[0.15, 0.06], [0.42, 0.09], [0.68, 0.12]]) {
    for (let s = -0.2; s < 1.6; s += sz * 1.1) {
      const y = 0.5 - cf * 1.05 + (s > 0.9 ? (s - 0.9) * 0.18 : 0);
      g.beginPath(); g.arc(px(s), py(y) - sz * 0.5 * (h / BH) * 0, (sz * 0.55 * w) / BW, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
    }
  }
  // mancha cinza suave na "mão"
  const [Wx, Wy] = outline.W;
  const rg = g.createRadialGradient(px(Wx), py(Wy), 0, px(Wx), py(Wy), (0.34 * w) / BW);
  rg.addColorStop(0, 'rgba(120,126,138,0.28)'); rg.addColorStop(1, 'rgba(120,126,138,0)');
  g.fillStyle = rg; g.fillRect(0, 0, w, h);
  // primárias escuras: leque a partir do pulso com gradiente ao longo de cada dedo
  for (const f of outline.fingers) {
    const dx = Math.cos(f.a), dy = Math.sin(f.a);
    const grad = g.createLinearGradient(px(Wx), py(Wy), px(Wx + dx * f.r), py(Wy + dy * f.r));
    grad.addColorStop(0, 'rgba(52,56,64,0)'); grad.addColorStop(0.3, 'rgba(52,56,64,0)');
    grad.addColorStop(0.5, 'rgba(52,56,64,0.92)'); grad.addColorStop(1, 'rgba(40,43,50,1)');
    g.fillStyle = grad;
    const d = (9.5 * Math.PI) / 180;
    g.beginPath(); g.moveTo(px(Wx), py(Wy));
    g.lineTo(px(Wx + Math.cos(f.a + d) * (f.r - 0.1)), py(Wy + Math.sin(f.a + d) * (f.r - 0.1)));
    g.lineTo(px(f.tip[0] + dx * 0.03), py(f.tip[1] + dy * 0.03));
    g.lineTo(px(Wx + Math.cos(f.a - d) * (f.r - 0.1)), py(Wy + Math.sin(f.a - d) * (f.r - 0.1)));
    g.closePath(); g.fill();
    // raque clara
    g.strokeStyle = 'rgba(235,238,242,0.35)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(px(Wx + dx * 0.3), py(Wy + dy * 0.3)); g.lineTo(px(f.tip[0]), py(f.tip[1])); g.stroke();
  }
  return toTexture(cv, false);
}
// Cauda: estrias radiais da base, raques e faixa cinza clara perto da ponta
function tailTexture(rng, outline) {
  const w = 512, h = 512; const [cv, g] = makeCanvas(w, h);
  const { minX, minY, W: BW, H: BH } = outline.bbox;
  const px = (x) => ((x - minX) / BW) * w, py = (y) => (1 - (y - minY) / BH) * h;
  g.fillStyle = '#fbf8f3'; g.fillRect(0, 0, w, h);
  g.lineCap = 'round';
  for (let i = 0; i < 120; i++) {
    const a = lerp(-0.4 * Math.PI, -0.6 * Math.PI, rng()) + (rng() - 0.5) * 0.9, r0 = rng() * 0.6, len = 0.05 + rng() * 0.25;
    g.strokeStyle = `rgba(150,160,175,${0.03 + rng() * 0.06})`; g.lineWidth = 1 + rng() * 3;
    g.beginPath(); g.moveTo(px(Math.cos(a) * r0), py(0.05 + Math.sin(a) * r0)); g.lineTo(px(Math.cos(a) * (r0 + len)), py(0.05 + Math.sin(a) * (r0 + len))); g.stroke();
  }
  for (let k = 0; k < 7; k++) { // raques das retrizes
    const a = lerp((-56 * Math.PI) / 180, (-124 * Math.PI) / 180, (k + 0.5) / 7);
    g.strokeStyle = 'rgba(205,210,220,0.5)'; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(px(0), py(0.05)); g.lineTo(px(Math.cos(a) * 0.74), py(0.05 + Math.sin(a) * 0.74)); g.stroke();
  }
  const rg = g.createRadialGradient(px(0), py(0.05), (0.5 * w) / BW, px(0), py(0.05), (0.78 * w) / BW);
  rg.addColorStop(0, 'rgba(120,128,142,0)'); rg.addColorStop(1, 'rgba(120,128,142,0.3)');
  g.fillStyle = rg; g.fillRect(0, 0, w, h);
  return toTexture(cv, false);
}

// ------------------------------------------------------------------
//  Chapa extrudada (asa/cauda) com uv pela caixa da forma e cores por face
// ------------------------------------------------------------------
function sheetGeometry(pts, bbox, side, thickness, curveSeg = 3) {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x * side, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: curveSeg });
  geo.translate(0, 0, -thickness / 2);
  const p = geo.attributes.position, n = p.count;
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    uv[i * 2] = (Math.abs(p.getX(i)) - bbox.minX) / bbox.W;
    uv[i * 2 + 1] = (p.getY(i) - bbox.minY) / bbox.H;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.rotateX(-Math.PI / 2); // forma +y (frente) → -z ; espessura → +y
  const nrm = geo.attributes.normal;
  const top = new THREE.Color(C.featherTop), under = new THREE.Color(C.featherUnder), edge = top.clone().lerp(under, 0.5);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const ny = nrm.getY(i); const c = ny > 0.5 ? top : ny < -0.5 ? under : edge;
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// Asa com esqueleto (ombro → pulso → mão). side = +1 direita, -1 esquerda
function makeWing(side, outline, material) {
  const geo = sheetGeometry(outline.pts, outline.bbox, side, DOVE_MODEL.WING_THICKNESS, 3);
  const p = geo.attributes.position, n = p.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const s = Math.abs(p.getX(i));
    const w1 = smooth(0.62, 1.08, s), w2 = smooth(1.15, 1.5, s);
    si[i * 4] = 0; si[i * 4 + 1] = 1; si[i * 4 + 2] = 2; si[i * 4 + 3] = 0;
    sw[i * 4] = 1 - w1; sw[i * 4 + 1] = w1 - w2; sw[i * 4 + 2] = w2; sw[i * 4 + 3] = 0;
  }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  const mesh = new THREE.SkinnedMesh(geo, material);
  const shoulder = new THREE.Bone(), wrist = new THREE.Bone(), hand = new THREE.Bone();
  wrist.position.x = side * 0.95; hand.position.x = side * 0.35; // mão em |x| = 1.3 (pulso do contorno)
  shoulder.add(wrist); wrist.add(hand);
  mesh.add(shoulder);
  mesh.bind(new THREE.Skeleton([shoulder, wrist, hand]));
  mesh.frustumCulled = false;
  return { mesh, shoulder, wrist, hand };
}

// ------------------------------------------------------------------
//  Rédeas: tubo dinâmico (posições recalculadas a cada quadro)
// ------------------------------------------------------------------
function makeReins(nSeg, nRad, radius, material) {
  const nRein = 2, vertsPer = (nSeg + 1) * nRad;
  const pos = new Float32Array(nRein * vertsPer * 3), nor = new Float32Array(nRein * vertsPer * 3), idx = [];
  for (let r = 0; r < nRein; r++) for (let i = 0; i < nSeg; i++) for (let j = 0; j < nRad; j++) {
    const base = r * vertsPer;
    const a = base + i * nRad + j, b = base + i * nRad + ((j + 1) % nRad), c = a + nRad, d = b + nRad;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  const T = V(), N = V(), B = V(), P = V(), ref = V();
  const samples = [];
  for (let i = 0; i <= nSeg; i++) samples.push(V());
  function update(r, curve) {
    curve.getPoints(nSeg).forEach((q, i) => samples[i].copy(q));
    for (let i = 0; i <= nSeg; i++) {
      P.copy(samples[i]);
      T.subVectors(samples[Math.min(nSeg, i + 1)], samples[Math.max(0, i - 1)]).normalize();
      ref.set(0, 1, 0); if (Math.abs(T.dot(ref)) > 0.9) ref.set(1, 0, 0);
      N.crossVectors(T, ref).normalize(); B.crossVectors(T, N);
      for (let j = 0; j < nRad; j++) {
        const a = (j / nRad) * TAU, ca = Math.cos(a), sa = Math.sin(a);
        const k = (r * vertsPer + i * nRad + j) * 3;
        nor[k] = N.x * ca + B.x * sa; nor[k + 1] = N.y * ca + B.y * sa; nor[k + 2] = N.z * ca + B.z * sa;
        pos[k] = P.x + nor[k] * radius; pos[k + 1] = P.y + nor[k + 1] * radius; pos[k + 2] = P.z + nor[k + 2] * radius;
      }
    }
    geo.attributes.position.needsUpdate = true; geo.attributes.normal.needsUpdate = true;
  }
  return { mesh, update };
}

// ------------------------------------------------------------------
//  Cabeça (esfera + bico + olhos + cabeçada da brida) — 1 draw call
// ------------------------------------------------------------------
function buildHead(seg) {
  const r = DOVE_MODEL.HEAD_RADIUS, parts = [];
  parts.push(paint(ball(r, [0, 0, 0], [0.95, 0.95, 1.08], seg), C.featherTop));
  // bico: cone apontando para -z, levemente para baixo
  const beak = new THREE.ConeGeometry(0.05, 0.2, 10); beak.translate(0, 0.1, 0);
  parts.push(paint(place(beak, [0, -0.02, -0.19], [-Math.PI / 2 - 0.14, 0, 0]), C.beak));
  parts.push(paint(ball(0.032, [0, 0.015, -0.2], [1.3, 0.8, 0.9], 8), 0xe9dcd6)); // cera
  // olhos (escuros) com brilho
  for (const sx of [-1, 1]) {
    const d = V(sx * 0.7, 0.28, -0.62).normalize();
    const e = [d.x * 0.95 * r, d.y * 0.95 * r, d.z * 1.08 * r];
    parts.push(paint(ball(0.034, e, [1, 1, 1], 10), C.eye));
    parts.push(paint(ball(0.011, [e[0] + sx * 0.012, e[1] + 0.016, e[2] - 0.022], [1, 1, 1], 6), 0xffffff));
  }
  // cabeçada: testeira/queixeira (anel), focinheira na base do bico, faceiras e argolas do bocal
  parts.push(paint(place(new THREE.TorusGeometry(r * 0.95 + 0.012, 0.011, 6, 28), [0, 0, 0.01], [0.12, 0, 0]), C.leatherDark));
  parts.push(paint(place(new THREE.TorusGeometry(0.075, 0.009, 6, 20), [0, -0.02, -0.19], [0, 0, 0]), C.leatherDark));
  for (const sx of [-1, 1]) {
    parts.push(paint(limb(V(sx * 0.19, 0.0, 0.01), V(sx * 0.072, -0.03, -0.19), 0.008, 0.008, 6), C.leatherDark));
    parts.push(paint(place(new THREE.TorusGeometry(0.026, 0.006, 6, 14), [sx * 0.085, -0.05, -0.17], [0, Math.PI / 2, 0]), C.metal));
  }
  return mergeGeometries(parts, false);
}

// ------------------------------------------------------------------
//  Arreios: couro (sela, cilha, peitoral, estribos) e metal (argola, ferros)
// ------------------------------------------------------------------
function buildTack() {
  const leather = [], metal = [];
  const d2r = (a) => (a * Math.PI) / 180;
  // sela: saia que abraça o dorso, abas laterais, assento, arção dianteiro (pommel) e traseiro (cantle)
  leather.push(patch(-0.64, 0.02, d2r(35), d2r(145), 0.012, C.leather, 8, 12));
  leather.push(patch(-0.52, -0.08, d2r(2), d2r(62), 0.016, C.leather, 8, 8, 0.8));
  leather.push(patch(-0.52, -0.08, d2r(118), d2r(178), 0.016, C.leather, 8, 8, 0.8));
  leather.push(paint(ball(0.26, [0, 0.455, -0.3], [1, 0.3, 1.22], 16), C.leather));
  leather.push(paint(limb(V(0, 0.48, -0.56), V(0, 0.6, -0.6), 0.032, 0.022, 8), C.leatherDark));
  leather.push(paint(ball(0.045, [0, 0.605, -0.6], [1, 0.8, 1], 10), C.leatherDark));
  leather.push(paint(place(new THREE.TorusGeometry(0.2, 0.034, 8, 18, Math.PI), [0, 0.47, -0.03], [0, 0, 0], [1, 0.5, 1]), C.leatherDark));
  // cilha ao redor do corpo
  const girth = []; for (let k = 0; k <= 40; k++) girth.push([-0.3, (k / 40) * TAU]);
  leather.push(ribbon(girth, 0.03, 0.014, C.leatherDark));
  // peitoral em "Y": duas tiras dos flancos até a argola sob o peito + tira central até a cilha
  const left = [], right = [], center = [];
  for (let k = 0; k <= 10; k++) {
    const t = k / 10;
    right.push([lerp(-0.4, -0.74, t), d2r(lerp(30, -90, t))]);
    left.push([lerp(-0.4, -0.74, t), d2r(lerp(150, 270, t))]);
    center.push([lerp(-0.74, -0.3, t), d2r(-90)]);
  }
  leather.push(ribbon(right, 0.025, 0.014, C.leatherDark), ribbon(left, 0.025, 0.014, C.leatherDark), ribbon(center, 0.025, 0.014, C.leatherDark));
  const ringP = surface(-0.74, d2r(-90), 0.05, V());
  metal.push(paint(place(new THREE.TorusGeometry(0.05, 0.011, 8, 20), ringP.toArray(), [0, 0, 0]), C.metal));
  metal.push(paint(place(new THREE.TorusGeometry(0.022, 0.007, 6, 12), [ringP.x, ringP.y + 0.055, ringP.z], [Math.PI / 2, 0, 0]), C.metal)); // elo de fixação
  // estribos: tira do flanco da sela até o ferro
  for (const sx of [-1, 1]) {
    leather.push(paint(strap(V(sx * 0.33, 0.44, -0.32), V(sx * 0.49, 0.02, -0.44), 0.04, 0.01), C.leatherDark));
    metal.push(paint(place(new THREE.TorusGeometry(0.07, 0.011, 8, 18), [sx * 0.49, -0.05, -0.44], [0, 0, 0]), C.metal));
    metal.push(paint(ball(0.016, [sx * 0.49, 0.02, -0.44], [1, 1, 1], 6), C.metal)); // fivela
  }
  return { leather: mergeGeometries(leather, false), metal: mergeGeometries(metal, false), ringP, anchor: V(ringP.x, ringP.y - 0.05, ringP.z) };
}

// ------------------------------------------------------------------
//  Cavaleiro: parte inferior fixa (quadril, pernas, botas) e superior
//  (tronco, braços, cabeça, mochila) que se inclina a partir do quadril.
// ------------------------------------------------------------------
const HIP_PIVOT = V(0, 0.6, -0.28);
const HAND_L = V(-0.17, 0.86, -0.64), HAND_R = V(0.17, 0.86, -0.64);
function buildRider(seg) {
  const lower = [], upper = [];
  // quadril e pernas (calça escura), botas
  lower.push(paint(ball(0.17, [0, 0.58, -0.28], [1, 0.62, 0.85], seg), C.trousers));
  for (const sx of [-1, 1]) {
    const hip = V(sx * 0.12, 0.52, -0.3), knee = V(sx * 0.36, 0.34, -0.6), ankle = V(sx * 0.47, -0.02, -0.43);
    lower.push(paint(limb(hip, knee, 0.075, 0.065, 10), C.trousers));
    lower.push(paint(ball(0.068, knee.toArray(), [1, 1, 1], 10), C.trousers));
    lower.push(paint(limb(knee, ankle, 0.06, 0.05, 10), C.boots));
    lower.push(paint(place(new THREE.BoxGeometry(0.09, 0.075, 0.25), [sx * 0.48, -0.05, -0.49], [0.08, 0, 0]), C.boots));
  }
  // tronco (jaqueta escura) inclinado um pouco para a frente
  upper.push(paint(ball(0.2, [0, 0.86, -0.3], [1, 1.6, 0.68], seg), C.jacket));
  upper.push(paint(ball(0.24, [0, 1.07, -0.31], [1, 0.5, 0.6], seg), C.jacket)); // ombros
  upper.push(paint(place(new THREE.TorusGeometry(0.075, 0.022, 6, 14), [0, 1.13, -0.32], [Math.PI / 2, 0, 0]), C.jacket)); // gola
  // braços à frente segurando as rédeas
  for (const sx of [-1, 1]) {
    const sh = V(sx * 0.21, 1.1, -0.31), el = V(sx * 0.25, 0.9, -0.46), hd = sx < 0 ? HAND_L : HAND_R;
    upper.push(paint(limb(sh, el, 0.055, 0.048, 10), C.jacket));
    upper.push(paint(ball(0.048, el.toArray(), [1, 1, 1], 8), C.jacket));
    upper.push(paint(limb(el, hd, 0.046, 0.04, 10), C.jacket));
    upper.push(paint(ball(0.045, hd.toArray(), [1, 0.85, 1.1], 8), C.skin));
  }
  // pescoço, cabeça e cabelo
  upper.push(paint(limb(V(0, 1.12, -0.32), V(0, 1.22, -0.34), 0.045, 0.04, 8), C.skin));
  upper.push(paint(ball(0.105, [0, 1.31, -0.35], [0.92, 1.1, 1.0], seg), C.skin));
  const hairTop = new THREE.SphereGeometry(0.112, seg, 10, 0, TAU, 0, 0.46 * Math.PI);
  const hairBack = new THREE.SphereGeometry(0.112, seg, 8, 0, Math.PI, 0.44 * Math.PI, 0.3 * Math.PI);
  upper.push(paint(place(hairTop, [0, 1.315, -0.35], [0, 0, 0], [0.95, 1.1, 1.02]), C.hair));
  upper.push(paint(place(hairBack, [0, 1.315, -0.35], [0, 0, 0], [0.95, 1.1, 1.02]), C.hair));
  // mochila nas costas com alças
  upper.push(paint(place(new THREE.BoxGeometry(0.3, 0.34, 0.15), [0, 0.95, -0.1], [-0.1, 0, 0]), C.pack));
  upper.push(paint(place(new THREE.BoxGeometry(0.26, 0.1, 0.05), [0, 1.1, -0.06], [-0.1, 0, 0]), C.leatherDark)); // tampa
  for (const sx of [-1, 1]) upper.push(paint(strap(V(sx * 0.12, 1.12, -0.42), V(sx * 0.12, 0.84, -0.14), 0.035, 0.012), C.leatherDark));
  const upperGeo = mergeGeometries(upper, false); upperGeo.translate(-HIP_PIVOT.x, -HIP_PIVOT.y, -HIP_PIVOT.z);
  return { lower: mergeGeometries(lower, false), upper: upperGeo };
}

// ==================================================================
//  createDove
// ==================================================================
export function createDove(opts = {}) {
  const quality = opts.quality || 'high';
  const hi = quality !== 'low';
  const rng = createRng(SEED + 7101);
  const group = new THREE.Group();
  group.name = 'dove_a';

  // ---------------- materiais ----------------
  const bodyTex = bodyTexture(rng);
  const wingOut = wingOutline(), tailOut = tailOutline();
  const wingTex = wingTexture(rng, wingOut), tailTex = tailTexture(rng, tailOut);
  const matBody = new THREE.MeshStandardMaterial({ map: bodyTex, vertexColors: true, roughness: 0.72, metalness: 0 });
  const matHead = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.68, metalness: 0 });
  const matWing = new THREE.MeshStandardMaterial({ map: wingTex, vertexColors: true, roughness: 0.7, metalness: 0 });
  const matTail = new THREE.MeshStandardMaterial({ map: tailTex, vertexColors: true, roughness: 0.7, metalness: 0 });
  const matLeather = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 });
  const matMetal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.65 });
  const matRider = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  const matRein = new THREE.MeshStandardMaterial({ color: C.leatherDark, roughness: 0.6, metalness: 0 });

  // ---------------- corpo, cabeça, cauda ----------------
  const body = new THREE.Mesh(buildBody(hi ? 44 : 28, hi ? 28 : 18), matBody);
  group.add(body);
  const head = new THREE.Mesh(buildHead(hi ? 22 : 14), matHead);
  head.position.copy(HEAD_POS);
  group.add(head);
  const TAIL_POS = V(0, 0.045, 0.78);
  const tail = new THREE.Mesh(sheetGeometry(tailOut.pts, tailOut.bbox, 1, DOVE_MODEL.WING_THICKNESS, 3), matTail);
  tail.position.copy(TAIL_POS);
  group.add(tail);

  // ---------------- asas ----------------
  const WING_Y = 0.3, WING_Z = -0.25, WING_X = 0.3;
  const wingR = makeWing(1, wingOut, matWing), wingL = makeWing(-1, wingOut, matWing);
  wingR.mesh.position.set(WING_X, WING_Y, WING_Z); wingL.mesh.position.set(-WING_X, WING_Y, WING_Z);
  group.add(wingR.mesh, wingL.mesh);

  // ---------------- arreios ----------------
  const tack = buildTack();
  group.add(new THREE.Mesh(tack.leather, matLeather), new THREE.Mesh(tack.metal, matMetal));
  const packageAnchor = new THREE.Object3D();
  packageAnchor.name = 'packageAnchor';
  packageAnchor.position.copy(tack.anchor);
  group.add(packageAnchor);

  // ---------------- cavaleiro ----------------
  const rider = buildRider(hi ? 16 : 10);
  const riderLower = new THREE.Mesh(rider.lower, matRider);
  const riderUpper = new THREE.Mesh(rider.upper, matRider);
  riderUpper.position.copy(HIP_PIVOT);
  group.add(riderLower, riderUpper);

  // ---------------- rédeas ----------------
  const reins = makeReins(hi ? 16 : 10, hi ? 6 : 4, 0.012, matRein);
  group.add(reins.mesh);
  const BIT_L = V(-0.1, -0.06, -0.17), BIT_R = V(0.1, -0.06, -0.17);
  const handL = V(), handR = V(), bitL = V(), bitR = V(), m1 = V(), m2 = V();
  const curveL = new THREE.CatmullRomCurve3([V(), V(), V(), V()], false, 'centripetal');
  const curveR = new THREE.CatmullRomCurve3([V(), V(), V(), V()], false, 'centripetal');
  function layRein(curve, hand, bit, sx) {
    const d = hand.distanceTo(bit);
    const sag = 0.03 + Math.max(0, DOVE_MODEL.REIN_LENGTH - d) * 0.7;
    m1.lerpVectors(hand, bit, 0.35); m1.y -= sag * 0.9; m1.x += sx * 0.05;
    m2.lerpVectors(hand, bit, 0.7); m2.y -= sag * 0.8; m2.x += sx * 0.06;
    curve.points[0].copy(hand); curve.points[1].copy(m1); curve.points[2].copy(m2); curve.points[3].copy(bit);
    curve.updateArcLengths();
  }

  // ---------------- estado da animação ----------------
  let time = 0, phase = 0, cycle = 0, flapMix = 0, boostMix = 0, turnS = 0, climbS = 0, rollS = 0, prevSpeed = null, fan = 1;
  const HZ_C = DOVE_MODEL.FLAP_HZ_CRUISE, HZ_B = DOVE_MODEL.FLAP_HZ_BOOST;

  function update(dt, fs) {
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    const speed = fs?.speed ?? DOVE.SPEED_CRUISE, boost = !!fs?.boost;
    const climb = THREE.MathUtils.clamp(fs?.climbInput ?? 0, -1, 1), turn = THREE.MathUtils.clamp(fs?.turnInput ?? 0, -1, 1), roll = fs?.roll ?? 0;
    time += dt;
    if (prevSpeed === null) prevSpeed = speed;
    const accel = dt > 0 ? (speed - prevSpeed) / dt : 0; prevSpeed = speed;
    // --- bater ou planar ---
    const working = boost || climb > 0.3 || accel > 4 || speed < DOVE.SPEED_MIN + 6;
    let wantFlap;
    if (working) { wantFlap = true; cycle = 0; }
    else { cycle += dt; wantFlap = (cycle % DOVE_MODEL.GLIDE_PERIOD) > 4.0; } // plana ~4 s, bate ~3,5 s
    if (flapMix === 0 && boostMix === 0 && time === dt) { flapMix = wantFlap ? 1 : 0; boostMix = boost ? 1 : 0; }
    flapMix += ((wantFlap ? 1 : 0) - flapMix) * Math.min(1, dt * 4);
    boostMix += ((boost ? 1 : 0) - boostMix) * Math.min(1, dt * 3);
    turnS += (turn - turnS) * Math.min(1, dt * 5);
    climbS += (climb - climbS) * Math.min(1, dt * 5);
    rollS += (roll - rollS) * Math.min(1, dt * 5);
    const freq = boost ? HZ_B : climb > 0.3 ? 2.0 : HZ_C;
    phase += TAU * freq * dt;
    const amp = boost ? 0.62 : climb > 0.3 ? 0.56 : 0.42;
    const glide = 1 - flapMix;
    const s0 = Math.sin(phase), s1 = Math.sin(phase - 0.7), s2 = Math.sin(phase - 1.3);
    const ripple = Math.sin(time * 5.3) * 0.025 + Math.sin(time * 8.1) * 0.012;
    const shoulder = flapMix * (amp * s0 + 0.08) + glide * 0.14;
    const wrist = flapMix * (amp * 0.55 * s1 - 0.05) + glide * (-0.09 + ripple * 0.5);
    const hand = flapMix * (amp * 0.5 * s2) + glide * (0.06 + ripple);
    const twist = flapMix * 0.22 * Math.cos(phase - 0.4) + glide * 0.03;
    const sweep = flapMix * 0.05 * Math.cos(phase);
    // asa interna da curva um pouco mais baixa (aileron)
    const aileron = turnS * 0.06;
    wingR.shoulder.rotation.set(twist, sweep, shoulder - aileron);
    wingR.wrist.rotation.set(0, 0, wrist);
    wingR.hand.rotation.set(twist * 0.6, 0, hand);
    // asa esquerda espelhada: rotações em Y/Z invertem de sinal, a torção em X (eixo da envergadura) não
    wingL.shoulder.rotation.set(twist, -sweep, -(shoulder + aileron));
    wingL.wrist.rotation.set(0, 0, -wrist);
    wingL.hand.rotation.set(twist * 0.6, 0, -hand);
    // --- cauda: abre nas curvas/subidas e inclina como leme ---
    const fanTarget = 1.05 + 0.4 * Math.abs(turnS) + 0.3 * Math.max(0, climbS) + 0.1 * glide;
    fan += (fanTarget - fan) * Math.min(1, dt * 6);
    tail.scale.set(fan, 1, 1);
    tail.rotation.set(0.3 * climbS + 0.06 * flapMix * Math.sin(phase - 1.2), 0.15 * turnS, 0.45 * turnS);
    // --- cabeça: balanço sutil, olha para dentro da curva ---
    head.position.set(HEAD_POS.x, HEAD_POS.y + 0.02 * flapMix * Math.sin(phase + 0.5), HEAD_POS.z + 0.01 * flapMix * Math.sin(phase));
    head.rotation.set(0.04 * flapMix * Math.sin(phase) - 0.08 * climbS, 0.18 * turnS, 0.1 * turnS);
    head.updateMatrix();
    // --- cavaleiro: inclina na curva, abaixa no boost, leve balanço ---
    riderUpper.rotation.set(-0.1 - 0.32 * boostMix - 0.04 * flapMix * Math.sin(phase), 0.05 * turnS, 0.22 * rollS + 0.08 * turnS);
    riderUpper.position.set(HIP_PIVOT.x, HIP_PIVOT.y + 0.008 * flapMix * Math.sin(phase), HIP_PIVOT.z);
    riderUpper.updateMatrix();
    // --- rédeas: das mãos às argolas do bocal, com folga ---
    handL.copy(HAND_L).sub(HIP_PIVOT).applyMatrix4(riderUpper.matrix);
    handR.copy(HAND_R).sub(HIP_PIVOT).applyMatrix4(riderUpper.matrix);
    bitL.copy(BIT_L).applyMatrix4(head.matrix); bitR.copy(BIT_R).applyMatrix4(head.matrix);
    layRein(curveL, handL, bitL, -1); layRein(curveR, handR, bitR, 1);
    reins.update(0, curveL); reins.update(1, curveR);
  }

  return { group, packageAnchor, update };
}
