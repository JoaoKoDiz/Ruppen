// =====================================================================
//  RUPPEN — pele esculpida do elefante (UMA malha contínua).
//  Campo de distância (SDF) = união suave (smin polinomial) de grupos de primitivas
//  (elipsoides e cones arredondados): tronco (barriga caída, cernelha, crista da espinha, peito,
//  ombros, quadris, garupa), pescoço (+ papada), cabeça (crânio, domos da testa, testa, bochechas,
//  queixo, bainhas das presas, raízes das orelhas), tromba (cadeia de cones ao longo da curva),
//  4 patas (cones com joelho/jarrete e sola chata) e cauda. Olhos e narinas são subtrações suaves.
//  Poligonização por "surface nets" com avaliação esparsa (blocos grossos longe da superfície são
//  pulados), projeção dos vértices na superfície, dobras deslocadas na normal (lençóis diagonais nos
//  flancos, anéis nas patas e na tromba, rugas finas nos joelhos, vincos fundos nas junções), AO de
//  cavidade (amostras do campo ao longo da normal + curvatura da malha) na cor do vértice e pesos de
//  skinning pela região dominante do campo (quadril/joelho, cabeça, 4 ossos da tromba, cauda).
//  Construída UMA vez por qualidade (cache do módulo) e compartilhada pelos 7 elefantes.
//  Também oferece consultas rápidas de superfície (tabelas por direção para corpo/cabeça/pescoço,
//  marcha vertical do campo para getSurfaceHeight e lançamentos radiais para faixas/mangas).
//  Espaço: modelo-base (o grupo do elefante é ampliado por ELEPHANT.SCALE).
// =====================================================================
import * as THREE from 'three';
import { ELEPHANT, ELEPHANT_MODEL, ELEPHANT_POLISH, ELEPHANT_SCULPT, SEED } from '../config.js';
import { createNoise } from '../util/noise.js';

const E = ELEPHANT, B = E.BODY, LG = E.LEG, HD = E.HEAD, TR = E.TRUNK;
const EM = { ...ELEPHANT_MODEL, ...ELEPHANT_POLISH };
const SC = ELEPHANT_SCULPT;
const TAU = Math.PI * 2;
const V3 = THREE.Vector3;
export const BODY_SX = 1.1;
export const RX = B.rx * BODY_SX;
export const HR = HD.radius * EM.HEAD_SCALE;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// ------------------------------------------------------------------
//  dobras (mesmo campo usado nas orelhas e nas consultas)
// ------------------------------------------------------------------
const fnz = createNoise(SEED + 919);
export function foldValue(x, y, z) {
  const wx = fnz.noise3(x * 0.55 + 3.1, y * 0.55, z * 0.55), wy = fnz.noise3(x * 0.55, y * 0.55 + 7.3, z * 0.55), wz = fnz.noise3(x * 0.55 + 1.7, y * 0.55, z * 0.55 + 5.7);
  const X = x + 0.9 * wx, Y = y + 0.9 * wy, Z = z + 0.9 * wz;
  const n1 = fnz.noise3(X, Y, Z), n2 = fnz.noise3(X * 2.2 + 11, Y * 2.2, Z * 2.2);
  return Math.min(1, Math.abs(n1) * 1.5 + Math.abs(n2) * 0.4) - 0.5;
}
export const FOLD_CA = Math.cos(0.6), FOLD_SA = Math.sin(0.6);

// ------------------------------------------------------------------
//  tromba (curva e raio), orelhas (pivô), olhos
// ------------------------------------------------------------------
export const TRUNK_CURVE = new THREE.CatmullRomCurve3([
  new V3(900, 1010, 0), new V3(1035, 925, 0), new V3(1105, 790, 0), new V3(1140, 640, 0), new V3(1145, 480, 0),
  new V3(1135, 320, 0), new V3(1145, 180, 0), new V3(1205, 90, 0), new V3(1310, 90, 0), new V3(1390, 160, 0), new V3(1400, 250, 0)]);
TRUNK_CURVE.arcLengthDivisions = 400;
export function trunkR(t) {
  if (t < 0.26) { const q = smooth(0, 0.26, t); return lerp(EM.TRUNK_ROOT_RADIUS, TR.baseRadius, q); }
  if (t < 0.965) return lerp(TR.baseRadius, TR.tipRadius, (t - 0.26) / 0.705);
  return TR.tipRadius * Math.sqrt(Math.max(0, 1 - ((t - 0.965) / 0.035) ** 2)) + 0.5;
}
const TRUNK_SAMPLES = 256;
const trunkPts = new Float64Array((TRUNK_SAMPLES + 1) * 3);
for (let i = 0; i <= TRUNK_SAMPLES; i++) { const p = TRUNK_CURVE.getPointAt(i / TRUNK_SAMPLES); trunkPts[i * 3] = p.x; trunkPts[i * 3 + 1] = p.y; trunkPts[i * 3 + 2] = p.z; }
export const EAR_PIVOT = { x: 740, y: 1415, z: 225 };
export const TRUNK_ROOT = { x: 1010, y: 950, z: 0 };
export const TAIL_ROOT = { x: -560, y: 1190, z: 0 };
export const TAIL_CURVE = new THREE.CatmullRomCurve3([new V3(-560, 1190, 0), new V3(-655, 1080, 8), new V3(-688, 900, -6), new V3(-680, 760, 10), new V3(-650, 655, 0)]);
export const tailR = (t) => (t < 0.75 ? lerp(34, 15, t / 0.75) : t < 0.9 ? lerp(15, 26, (t - 0.75) / 0.15) : 26 * Math.sqrt(Math.max(0.04, 1 - ((t - 0.9) / 0.1) ** 2)));
export const EYE_DIR = new V3(0.56, 0.1, 0.82).normalize();
export const SOLE_Y = LG.bottomY;

// ------------------------------------------------------------------
//  primitivas (Float64Array(20)): [0] tipo (0 elipsoide, 1 cone arredondado), [13] k (smin dentro do
//  grupo), [14..16] centro da esfera envolvente, [17] raio envolvente
// ------------------------------------------------------------------
function ell(cx, cy, cz, rx, ry, rz, k = 0) {
  const q = new Float64Array(20);
  q[0] = 0; q[1] = cx; q[2] = cy; q[3] = cz; q[4] = rx; q[5] = ry; q[6] = rz;
  q[7] = 1 / rx; q[8] = 1 / ry; q[9] = 1 / rz; q[10] = 1 / (rx * rx); q[11] = 1 / (ry * ry); q[12] = 1 / (rz * rz);
  q[13] = k; q[14] = cx; q[15] = cy; q[16] = cz; q[17] = Math.max(rx, ry, rz);
  return q;
}
function cone(ax, ay, az, bx, by, bz, ra, rb, k = 0) {
  const q = new Float64Array(20);
  const bax = bx - ax, bay = by - ay, baz = bz - az, l2 = bax * bax + bay * bay + baz * baz, rr = ra - rb;
  q[0] = 1; q[1] = ax; q[2] = ay; q[3] = az; q[4] = bax; q[5] = bay; q[6] = baz; q[7] = l2; q[8] = rr; q[9] = l2 - rr * rr; q[10] = 1 / l2; q[11] = ra; q[12] = rb;
  q[13] = k; q[14] = (ax + bx) / 2; q[15] = (ay + by) / 2; q[16] = (az + bz) / 2; q[17] = Math.sqrt(l2) / 2 + Math.max(ra, rb);
  return q;
}
function primDist(q, x, y, z) {
  if (q[0] === 0) {
    const px = x - q[1], py = y - q[2], pz = z - q[3];
    const ax = px * q[7], ay = py * q[8], az = pz * q[9];
    const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
    const bx = px * q[10], by = py * q[11], bz = pz * q[12];
    const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
    return k1 > 1e-12 ? (k0 * (k0 - 1)) / k1 : -Math.min(q[4], q[5], q[6]);
  }
  const pax = x - q[1], pay = y - q[2], paz = z - q[3];
  const bax = q[4], bay = q[5], baz = q[6], l2 = q[7];
  const yy = pax * bax + pay * bay + paz * baz, zz = yy - l2;
  const cx = pax * l2 - bax * yy, cy = pay * l2 - bay * yy, cz = paz * l2 - baz * yy;
  const x2 = cx * cx + cy * cy + cz * cz, y2 = yy * yy * l2, z2 = zz * zz * l2;
  const rr = q[8], a2 = q[9], il2 = q[10];
  const k = (rr > 0 ? 1 : rr < 0 ? -1 : 0) * rr * rr * x2;
  if ((zz > 0 ? a2 * z2 : zz < 0 ? -a2 * z2 : 0) > k) return Math.sqrt(x2 + z2) * il2 - q[12];
  if ((yy > 0 ? a2 * y2 : yy < 0 ? -a2 * y2 : 0) < k) return Math.sqrt(x2 + y2) * il2 - q[11];
  return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - q[11];
}
function smin(a, b, k) { if (k <= 0) return Math.min(a, b); const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
function smax(a, b, k) { return -smin(-a, -b, k); }

// ------------------------------------------------------------------
//  regiões / grupos
// ------------------------------------------------------------------
export const REGION = { BODY: 0, NECK: 1, HEAD: 2, TRUNK: 3, LEG_FL: 4, LEG_FR: 5, LEG_BL: 6, LEG_BR: 7, TAIL: 8 };
export const LEGS = [[1, -1], [1, 1], [-1, -1], [-1, 1]];   // (sx, sz) na ordem FL, FR, BL, BR (esquerda = −Z)
const NREG = 9;
const groups = [];
function group(region, k, prims) {
  let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (const q of prims) { mnx = Math.min(mnx, q[14] - q[17]); mny = Math.min(mny, q[15] - q[17]); mnz = Math.min(mnz, q[16] - q[17]); mxx = Math.max(mxx, q[14] + q[17]); mxy = Math.max(mxy, q[15] + q[17]); mxz = Math.max(mxz, q[16] + q[17]); }
  const c = [(mnx + mxx) / 2, (mny + mxy) / 2, (mnz + mxz) / 2];
  let r = 0; for (const q of prims) r = Math.max(r, Math.hypot(q[14] - c[0], q[15] - c[1], q[16] - c[2]) + q[17]);
  groups[region] = { region, k, prims, c, r };
}
// eixo da pata (centro do perfil na altura y): joelho levemente à frente, coxa inclinada para dentro
export function legAxis(sx, sz, y, out) {
  const kf = smooth(560, 320, y) * (1 - smooth(140, -40, y));
  return out.set(sx * LG.offsetX + sx * 18 * kf + sx * 10 * smooth(560, 900, y), y, sz * LG.offsetZ - sz * EM.LEG_HIP_LEAN * smooth(600, 968, y));
}
const LR = EM.LEG_HIP_RADIUS;
export const LEG_PROFILE = [[-40, 1.09], [60, 1.04], [200, 0.95], [410, 0.89], [600, 0.93], [800, 1.0], [960, 1.06]];
export function legRadius(y) {
  const P = LEG_PROFILE; if (y <= P[0][0]) return P[0][1] * LR;
  for (let i = 1; i < P.length; i++) if (y <= P[i][0]) return lerp(P[i - 1][1], P[i][1], (y - P[i - 1][0]) / (P[i][0] - P[i - 1][0])) * LR;
  return P[P.length - 1][1] * LR;
}
const EAR_MAT = [];
{
  const _a = new V3();
  // tronco
  group(REGION.BODY, 0, [
    ell(0, B.cy, 0, RX, 420, B.rz),
    ell(-30, 835, 0, 450, 265, 405, SC.K_BODY * 1.3),             // barriga caída
    ell(190, 1245, 0, 360, 255, 335, SC.K_BODY),                  // cernelha
    cone(-470, 1395, 0, 380, 1432, 0, 52, 62, SC.K_BODY * 0.8),  // crista da espinha
    ell(410, 880, 0, 230, 260, 330, SC.K_BODY),                   // peito
    ell(-480, 1120, 0, 175, 262, 365, SC.K_BODY),                 // garupa arredondada
    ell(335, 965, -300, 215, 335, 180, SC.K_BODY * 0.9), ell(335, 965, 300, 215, 335, 180, SC.K_BODY * 0.9),     // ombros
    ell(-350, 990, -300, 240, 330, 190, SC.K_BODY * 0.9), ell(-350, 990, 300, 240, 330, 190, SC.K_BODY * 0.9),  // quadris
  ]);
  // pescoço + papada
  group(REGION.NECK, SC.K_NECK, [ell(590, 1110, 0, 300, 350, 362), ell(665, 850, 0, 205, 200, 270, 120)]);
  // cabeça
  const hp = [
    ell(775, 1090, 0, 362, 432, 342),
    ell(835, 1408, -120, 222, 166, 176, 95), ell(835, 1408, 120, 222, 166, 176, 95),   // domos gêmeos do alto da testa
    ell(935, 1235, 0, 198, 232, 250, 110),                                             // testa (frente, abaulada)
    ell(870, 925, -212, 205, 192, 122, 100), ell(870, 925, 212, 205, 192, 122, 100),   // bochechas
    ell(930, 772, 0, 172, 108, 150, 80),                                               // queixo / lábio sob a tromba
    ell(985, 885, -132, 150, 112, 110, 80), ell(985, 885, 132, 150, 112, 110, 80),     // bainhas das presas
  ];
  // raízes das orelhas: cristas carnudas ao longo da borda dianteira da aba (no plano da orelha)
  for (const side of [-1, 1]) {
    const M = new THREE.Matrix4().compose(new V3(EAR_PIVOT.x, EAR_PIVOT.y, EAR_PIVOT.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.1, EM.EAR_YAW, -0.04, 'YXZ')), new V3(1, 1, 1));
    if (side < 0) M.premultiply(new THREE.Matrix4().makeScale(1, 1, -1));
    EAR_MAT.push(M);
    const a = _a.set(-48, -70, 30).applyMatrix4(M).clone(), b = new V3(-48, -640, 30).applyMatrix4(M);
    hp.push(cone(a.x, a.y, a.z, b.x, b.y, b.z, 56, 42, 75));
    const c = new V3(-150, 18, 34).applyMatrix4(M);
    hp.push(cone(a.x, a.y, a.z, c.x, c.y, c.z, 52, 30, 60));   // e ao longo do começo da borda de cima
  }
  group(REGION.HEAD, SC.K_HEAD, hp);
  // tromba: cadeia de cones arredondados ao longo da curva
  const tp = [], NT = 20, P0 = new V3(), P1 = new V3();
  for (let i = 0; i < NT; i++) {
    const t0 = i / NT, t1 = (i + 1) / NT;
    TRUNK_CURVE.getPointAt(t0, P0); TRUNK_CURVE.getPointAt(t1, P1);
    tp.push(cone(P0.x, P0.y, P0.z, P1.x, P1.y, P1.z, Math.max(trunkR(t0), 30), Math.max(i === NT - 1 ? TR.tipRadius * 0.82 : trunkR(t1), 30), 8));
    tp[i].t0 = t0; tp[i].t1 = t1;
  }
  group(REGION.TRUNK, SC.K_TRUNK, tp);
  // patas
  for (let li = 0; li < 4; li++) {
    const [sx, sz] = LEGS[li], lp = [];
    const P = LEG_PROFILE;
    for (let i = 0; i + 1 < P.length; i++) {
      legAxis(sx, sz, P[i][0], P0); legAxis(sx, sz, P[i + 1][0], P1);
      lp.push(cone(P0.x, P0.y, P0.z, P1.x, P1.y, P1.z, P[i][1] * LR, P[i + 1][1] * LR, 34));
    }
    legAxis(sx, sz, SC.KNEE_Y, P0);
    if (sx > 0) lp.push(ell(P0.x + 0.74 * LR, SC.KNEE_Y + 10, P0.z, 70, 112, 132, 60));    // joelho (carpo) à frente
    else { legAxis(sx, sz, 300, P0); lp.push(ell(P0.x - 0.74 * LR, 300, P0.z, 72, 105, 130, 60)); }  // jarrete atrás
    group(REGION.LEG_FL + li, SC.K_LEG, lp);
  }
  // cauda
  const tl = [];
  for (let i = 0; i < 8; i++) { const t0 = i / 8, t1 = (i + 1) / 8; TAIL_CURVE.getPointAt(t0, P0); TAIL_CURVE.getPointAt(t1, P1); tl.push(cone(P0.x, P0.y, P0.z, P1.x, P1.y, P1.z, tailR(t0), tailR(t1), 6)); }
  group(REGION.TAIL, SC.K_TAIL, tl);
}
// olhos (subtrações suaves; posição achada no próprio campo, antes de ligar as órbitas)
export const EYES = [];       // [{ pos: V3 (na pele sem órbita), dir: V3 }]
const SOCKETS = [];           // [x, y, z, r]
const NOSTRILS = [];
{
  const tip = TRUNK_CURVE.getPointAt(1), tan = TRUNK_CURVE.getTangentAt(1);
  for (const s of [-1, 1]) NOSTRILS.push([tip.x - tan.x * 4, tip.y - tan.y * 4, tip.z + s * 14, 12]);
}

// ------------------------------------------------------------------
//  avaliação
// ------------------------------------------------------------------
const GD = new Float64Array(NREG);          // distância por grupo (última avaliação detalhada)
let trunkT = 0;                             // parâmetro t da tromba no ponto (avaliação detalhada)
function groupDist(g, x, y, z) {
  const P = g.prims; let d = 1e9;
  for (let i = 0; i < P.length; i++) {
    const q = P[i];
    const dx = x - q[14], dy = y - q[15], dz = z - q[16], lim = d + q[13] + q[17];
    if (lim > 0 && dx * dx + dy * dy + dz * dz > lim * lim) continue;
    d = smin(d, primDist(q, x, y, z), q[13]);
  }
  return d;
}
function post(d, x, y, z) {
  if (y < SOLE_Y + 60) d = smax(d, SOLE_Y - y, 12);
  for (let i = 0; i < SOCKETS.length; i++) {
    const s = SOCKETS[i], dx = x - s[0], dy = y - s[1], dz = z - s[2], r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (r < s[3] + 60) d = smax(d, s[3] - r, 16);
  }
  if (x > 1330 && y < 340) for (const s of NOSTRILS) { const r = Math.hypot(x - s[0], y - s[1], z - s[2]); if (r < s[3] + 30) d = smax(d, s[3] - r, 6); }
  return d;
}
// SDF rápido (grupos distantes são pulados por esfera envolvente)
export function sdf(x, y, z) {
  let d = 1e9;
  for (let gi = 0; gi < NREG; gi++) {
    const g = groups[gi];
    const dx = x - g.c[0], dy = y - g.c[1], dz = z - g.c[2], lim = d + g.k + g.r;
    if (lim > 0 && dx * dx + dy * dy + dz * dz > lim * lim) continue;
    d = smin(d, groupDist(g, x, y, z), g.k);
  }
  return post(d, x, y, z);
}
// SDF de um grupo só (para achar a superfície "própria" de uma parte)
export function sdfGroup(gi, x, y, z) { return groupDist(groups[gi], x, y, z); }
// SDF detalhado: preenche GD (todos os grupos) e trunkT
export function sdfDetail(x, y, z) {
  let d = 1e9;
  for (let gi = 0; gi < NREG; gi++) {
    const g = groups[gi], lb = Math.hypot(x - g.c[0], y - g.c[1], z - g.c[2]) - g.r;
    const gd = lb > 420 ? lb : groupDist(g, x, y, z); GD[gi] = gd; d = smin(d, gd, g.k);
  }
  // parâmetro da tromba: segmento mais próximo
  const TP = groups[REGION.TRUNK].prims; let best = Infinity;
  if (GD[REGION.TRUNK] > 420) return post(d, x, y, z);
  for (let i = 0; i < TP.length; i++) {
    const q = TP[i]; const pax = x - q[1], pay = y - q[2], paz = z - q[3];
    const f = Math.min(1, Math.max(0, (pax * q[4] + pay * q[5] + paz * q[6]) * q[10]));
    const ex = pax - q[4] * f, ey = pay - q[5] * f, ez = paz - q[6] * f;
    const dd = Math.sqrt(ex * ex + ey * ey + ez * ez) - lerp(q[11], q[12], f);
    if (dd < best) { best = dd; trunkT = lerp(q.t0, q.t1, f); }
  }
  return post(d, x, y, z);
}
// pesos por região (somam 1) a partir de GD: regiões a menos de ~k da mais próxima dividem o peso
const RW = new Float64Array(NREG);
function regionWeights() {
  let m = Infinity; for (let i = 0; i < NREG; i++) m = Math.min(m, GD[i]);
  let s = 0;
  for (let i = 0; i < NREG; i++) { const K = Math.max(40, groups[i].k || SC.K_BODY) * 0.6; const w = Math.max(0, 1 - (GD[i] - m) / K); RW[i] = w * w; s += RW[i]; }
  for (let i = 0; i < NREG; i++) RW[i] /= s;
  return RW;
}
export function gradient(x, y, z, out, e = 1.5) {
  // tetraedro (4 avaliações)
  const a = sdf(x + e, y - e, z - e), b = sdf(x - e, y - e, z + e), c = sdf(x - e, y + e, z - e), d = sdf(x + e, y + e, z + e);
  out.set(a - b - c + d, -a - b + c + d, -a + b - c + d);
  const L = out.length(); if (L > 1e-12) out.multiplyScalar(1 / L); else out.set(0, 1, 0);
  return out;
}

// ------------------------------------------------------------------
//  dobras: deslocamento (m) na normal num ponto da pele (normal n)
// ------------------------------------------------------------------
// Lençóis de pele sobrepostos: curvas de nível (deformadas por ruído) de uma altura ao longo de "ax";
// em cada período a pele sobe rápido logo após o vinco e desce devagar até o próximo (terraços).
// Devolve ≈ −0.45 (vinco) … +0.55 (crista), com amplitude modulada (alguns lençóis somem).
function sheet(u) { const s = u - Math.floor(u); return 2.16 * Math.pow(s, 0.35) * (1 - s) - 0.45; }
function sheets(x, y, z, ax, ay, az, sp, seed) {
  const w = 1 / (sp * 3.2), w2 = 1 / (sp * 1.25);
  const u = (x * ax + y * ay + z * az) / sp + 0.6 * fnz.noise3(x * w + seed, y * w, z * w) + 0.22 * fnz.noise3(x * w2, y * w2 + seed, z * w2 + 7);
  const m = 0.6 + 0.5 * fnz.noise3(x / (sp * 6) + 13, y / (sp * 6) + seed, z / (sp * 6));
  return sheet(u) * Math.min(1, Math.max(0.08, m));
}
const TRUNK_LEN = TRUNK_CURVE.getLength();
const BODY_AX = new V3(0.28, 1, 0.05).normalize(), HEAD_AX = new V3(0.42, 1, 0).normalize();
export function foldDisp(x, y, z, nx, ny, nz, W = null) {
  if (!W) { sdfDetail(x, y, z); W = regionWeights(); }
  let disp = 0;
  const wb = W[0] + W[1];
  if (wb > 0.01) {
    // flancos: lençóis longos levemente inclinados; rasos no alto do dorso (sob a cidade); um segundo
    // conjunto cruzado e fraco faz os lençóis se ramificarem
    const fa = EM.FOLD_BODY * (1 - 0.6 * smooth(0.4, 0.85, ny)) * (W[0] + 0.8 * W[1]) / Math.max(1e-6, wb);
    disp += wb * fa * (sheets(x, y, z, BODY_AX.x, BODY_AX.y, BODY_AX.z, 64, 1.7) + 0.35 * sheets(x, y, z, -0.45, 1, 0.2, 41, 5.3));
  }
  if (W[2] > 0.01) {
    let mask = 1 - 0.6 * smooth(0.7, 0.95, ny);
    for (const e of EYES) { const r = Math.hypot(x - e.pos.x, y - e.pos.y, z - e.pos.z); mask *= 1 - 0.85 * smooth(105, 50, r); }
    disp += W[2] * EM.FOLD_HEAD * 1.5 * mask * (sheets(x, y, z, HEAD_AX.x, HEAD_AX.y, HEAD_AX.z, 50, 3.9) + 0.3 * sheets(x, y, z, -0.3, 1, 0, 33, 8.1));
  }
  if (W[3] > 0.01) {
    const t = trunkT, r = trunkR(t);
    const amp = (5 + 0.045 * r) * SC.FOLD_TRUNK * smooth(0.02, 0.12, t) * (1 - smooth(0.9, 0.97, t));
    // anéis: u = comprimento ao longo da tromba (+ ondulação ao redor dela)
    const u = (t * TRUNK_LEN) / 40 + 0.35 * fnz.noise3(x / 120 + 4, y / 120, z / 120) + 0.15 * fnz.noise3(x / 50, y / 50 + 9, z / 50);
    disp += W[3] * amp * (sheet(u) * (0.7 + 0.3 * fnz.noise3(x / 300, y / 300, z / 300 + 3)));
  }
  for (let li = 0; li < 4; li++) {
    const w = W[4 + li]; if (w < 0.01) continue;
    const [sx, sz] = LEGS[li];
    const fade = smooth(-40, 60, y);
    const knee = 1 + 0.7 * Math.exp(-(((y - SC.KNEE_Y) / 110) ** 2)) + 0.4 * Math.exp(-(((y - 130) / 70) ** 2));   // joelho e tornozelo mais vincados
    disp += w * EM.FOLD_LEG * 1.45 * fade * knee * sheets(x, y, z, 0.06 * sx, 1, 0.05 * sz, 46, 2.3 + li);
  }
  if (W[8] > 0.01) disp += W[8] * 2.5 * sheet(y / 22 + 0.3 * fnz.noise3(x / 40, y / 40, z / 40));
  // vincos fundos nas junções (zona de mistura entre regiões): sulco + anéis mais fundos ao redor
  let cLeg = 0; for (let li = 0; li < 4; li++) cLeg += W[4 + li] * (W[0] + W[1]);
  const cNeck = W[1] * (W[0] + W[2]), cTrunk = W[3] * (W[2] + W[1]);
  const c = 4 * (cLeg * SC.CREASE_LEG + cNeck * SC.CREASE_NECK + cTrunk * SC.CREASE_TRUNK);
  if (c > 0.05) disp += -0.45 * c + 1.1 * c * sheets(x, y, z, 0.15, 1, 0.1, 44, 11.7);
  return disp;
}
// deslocamento das dobras num ponto/normal quaisquer (uma avaliação detalhada)
export function foldAt(p, n) { sdfDetail(p.x, p.y, p.z); return foldDisp(p.x, p.y, p.z, n.x, n.y, n.z, regionWeights()); }

// ------------------------------------------------------------------
//  ossos e pesos de skinning
// ------------------------------------------------------------------
// Posições no espaço do modelo; o elefante cria os THREE.Bone com position = pos − pos(pai).
export const BONES = (() => {
  const b = [{ name: 'root', parent: -1, pos: [0, 0, 0] }];
  const legNames = ['FL', 'FR', 'BL', 'BR'], tmp = new V3();
  for (let li = 0; li < 4; li++) {
    const [sx, sz] = LEGS[li];
    legAxis(sx, sz, 800, tmp); b.push({ name: 'hip' + legNames[li], parent: 0, pos: [tmp.x, 800, tmp.z] });
    legAxis(sx, sz, SC.KNEE_Y, tmp); b.push({ name: 'knee' + legNames[li], parent: b.length - 1, pos: [tmp.x, SC.KNEE_Y, tmp.z] });
  }
  b.push({ name: 'head', parent: 0, pos: [610, 1190, 0] });
  const head = b.length - 1;
  let par = head;
  for (const t of [0.08, 0.32, 0.56, 0.8]) { const p = TRUNK_CURVE.getPointAt(t); b.push({ name: 'trunk' + t, parent: par, pos: [p.x, p.y, p.z], t }); par = b.length - 1; }
  b.push({ name: 'tail', parent: 0, pos: [TAIL_ROOT.x, TAIL_ROOT.y, TAIL_ROOT.z] });
  b.push({ name: 'earL', parent: head, pos: [EAR_PIVOT.x, EAR_PIVOT.y, -EAR_PIVOT.z] });
  b.push({ name: 'earR', parent: head, pos: [EAR_PIVOT.x, EAR_PIVOT.y, EAR_PIVOT.z] });
  return b;
})();
export const BONE = { root: 0, hipFL: 1, kneeFL: 2, hipFR: 3, kneeFR: 4, hipBL: 5, kneeBL: 6, hipBR: 7, kneeBR: 8, head: 9, trunk0: 10, trunk1: 11, trunk2: 12, trunk3: 13, tail: 14, earL: 15, earR: 16 };
const TRUNK_BONE_T = [0, 0.08, 0.32, 0.56, 0.8];
const TRUNK_BONE_I = [BONE.head, BONE.trunk0, BONE.trunk1, BONE.trunk2, BONE.trunk3];
const WB = new Float64Array(BONES.length);
// pesos de 4 influências a partir das regiões do ponto (chama sdfDetail antes)
function boneWeights(x, y, z, W, si, sw, o) {
  WB.fill(0);
  for (let li = 0; li < 4; li++) {
    const w = W[4 + li]; if (w <= 0) continue;
    const kf = smooth(SC.KNEE_Y + 75, SC.KNEE_Y - 75, y);
    WB[1 + li * 2] += w * (1 - kf); WB[2 + li * 2] += w * kf;
  }
  if (W[3] > 0) {
    const t = trunkT; let k = TRUNK_BONE_T.length - 1;
    for (let i = 0; i + 1 < TRUNK_BONE_T.length; i++) if (t < TRUNK_BONE_T[i + 1]) { k = i; break; }
    if (k >= TRUNK_BONE_T.length - 1) WB[TRUNK_BONE_I[k]] += W[3];
    else { const f = smooth(TRUNK_BONE_T[k], TRUNK_BONE_T[k + 1], t); WB[TRUNK_BONE_I[k]] += W[3] * (1 - f); WB[TRUNK_BONE_I[k + 1]] += W[3] * f; }
  }
  WB[BONE.tail] += W[8];
  const hn = smooth(430, 760, x);
  WB[BONE.head] += W[2] + W[1] * hn;
  WB[BONE.root] += W[0] + W[1] * (1 - hn);
  // 4 maiores
  for (let s = 0; s < 4; s++) {
    let bi = 0, bw = -1; for (let i = 0; i < WB.length; i++) if (WB[i] > bw) { bw = WB[i]; bi = i; }
    si[o + s] = bi; sw[o + s] = Math.max(0, bw); WB[bi] = -1;
  }
  const t = sw[o] + sw[o + 1] + sw[o + 2] + sw[o + 3];
  for (let s = 0; s < 4; s++) sw[o + s] /= t;
}
// pesos para qualquer geometria acessória (faixas, manga da tromba, anéis): mesmo campo da pele
export function skinWeightsFor(g) {
  const p = g.attributes.position, n = p.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); sdfDetail(x, y, z); boneWeights(x, y, z, regionWeights(), si, sw, i * 4); }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  return g;
}

// ------------------------------------------------------------------
//  consultas de superfície
// ------------------------------------------------------------------
const _q = new V3(), _n = new V3();
// A partir de s0 sobre o raio C + dir·s: se fora, marcha para dentro até a pele; se dentro, para fora.
function surfaceOnRay(cx, cy, cz, dx, dy, dz, s0) {
  let s = s0, d = sdf(cx + dx * s, cy + dy * s, cz + dz * s);
  if (d >= 0) { for (let it = 0; it < 64 && d > 0.25; it++) { s -= d * 0.95; d = sdf(cx + dx * s, cy + dy * s, cz + dz * s); } }
  else { for (let it = 0; it < 64 && d < -0.25; it++) { s += Math.max(-d, 0.5); d = sdf(cx + dx * s, cy + dy * s, cz + dz * s); } }
  return s;
}
// superfície do grupo gi sozinho ao longo do raio, vindo de sFar
function groupSurfaceOnRay(gi, cx, cy, cz, dx, dy, dz, sFar) {
  let s = sFar, d = sdfGroup(gi, cx + dx * s, cy + dy * s, cz + dz * s);
  for (let it = 0; it < 80 && d > 0.25; it++) { s -= d * 0.95; d = sdfGroup(gi, cx + dx * s, cy + dy * s, cz + dz * s); if (s < 0) return 0; }
  return s;
}
// Lança do interior (o) para fora na direção dir até sair da pele → ponto e normal. lift = folga.
export function castOut(o, dir, out, nOut = null, folds = true, lift = 0) {
  let s = 0, d = sdf(o.x, o.y, o.z);
  for (let it = 0; it < 96 && d < -0.25; it++) { s += Math.max(-d, 0.5); d = sdf(o.x + dir.x * s, o.y + dir.y * s, o.z + dir.z * s); }
  out.copy(o).addScaledVector(dir, s);
  const n = gradient(out.x, out.y, out.z, nOut || _n);
  if (folds) out.addScaledVector(n, foldAt(out, n));
  if (lift) out.addScaledVector(n, lift);
  return out;
}
// Marcha vertical (de cima) até a pele: devolve y (sem dobras) ou null
export function skinTopY(x, z, yTop = 1800) {
  let y = yTop, d = sdf(x, y, z);
  for (let it = 0; it < 80; it++) {
    if (d < 0.3) return y;
    y -= d * 0.95; if (y < SOLE_Y - 5) return null;
    d = sdf(x, y, z);
  }
  return d < 2 ? y : null;
}
export function skinTop(x, z, out, nOut, folds = true) {
  const y = skinTopY(x, z); if (y === null) return null;
  out.set(x, y, z); gradient(x, y, z, nOut);
  if (folds) out.addScaledVector(nOut, foldAt(out, nOut));
  return out;
}

// Tabelas por direção (bilineares): s ao longo do raio, dobra e normal; "coberto" quando outra parte
// cobre a superfície própria da parte (ex.: corpo sob o pescoço/patas).
function makeTable(nu, nv, centerFn, dirFn, gi, sFar) {
  const N = nu * nv, S = new Float32Array(N), F = new Float32Array(N), NR = new Float32Array(N * 3), COV = new Uint8Array(N);
  const d = new V3(), c = new V3(), p = new V3(), n = new V3();
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    dirFn(i / (nu - 1), j / (nv - 1), d); centerFn(c);
    const sg = groupSurfaceOnRay(gi, c.x, c.y, c.z, d.x, d.y, d.z, sFar);
    const s = surfaceOnRay(c.x, c.y, c.z, d.x, d.y, d.z, sg + 40);
    const k = j * nu + i;
    S[k] = s; COV[k] = s > sg + 90 ? 1 : 0;
    p.copy(c).addScaledVector(d, s); gradient(p.x, p.y, p.z, n);
    NR[k * 3] = n.x; NR[k * 3 + 1] = n.y; NR[k * 3 + 2] = n.z;
    F[k] = foldAt(p, n);
  }
  return { nu, nv, S, F, NR, COV, centerFn, dirFn };
}
const _c = new V3(), _d = new V3();
function lookup(T, u, v, out, nOut, folds, rayDir, center) {
  u = Math.min(1, Math.max(0, u)); v = Math.min(1, Math.max(0, v));
  const fu = u * (T.nu - 1), fv = v * (T.nv - 1), i0 = Math.min(T.nu - 2, Math.floor(fu)), j0 = Math.min(T.nv - 2, Math.floor(fv)), a = fu - i0, b = fv - j0;
  const k00 = j0 * T.nu + i0, k10 = k00 + 1, k01 = k00 + T.nu, k11 = k01 + 1;
  const w00 = (1 - a) * (1 - b), w10 = a * (1 - b), w01 = (1 - a) * b, w11 = a * b;
  const s = T.S[k00] * w00 + T.S[k10] * w10 + T.S[k01] * w01 + T.S[k11] * w11;
  const f = T.F[k00] * w00 + T.F[k10] * w10 + T.F[k01] * w01 + T.F[k11] * w11;
  const n = nOut || _n;
  n.set(T.NR[k00 * 3] * w00 + T.NR[k10 * 3] * w10 + T.NR[k01 * 3] * w01 + T.NR[k11 * 3] * w11,
    T.NR[k00 * 3 + 1] * w00 + T.NR[k10 * 3 + 1] * w10 + T.NR[k01 * 3 + 1] * w01 + T.NR[k11 * 3 + 1] * w11,
    T.NR[k00 * 3 + 2] * w00 + T.NR[k10 * 3 + 2] * w10 + T.NR[k01 * 3 + 2] * w01 + T.NR[k11 * 3 + 2] * w11).normalize();
  out.copy(center).addScaledVector(rayDir, s);
  if (folds) out.addScaledVector(n, f);
  const cov = Math.max(w00 > 0.01 ? T.COV[k00] : 0, w10 > 0.01 ? T.COV[k10] : 0, w01 > 0.01 ? T.COV[k01] : 0, w11 > 0.01 ? T.COV[k11] : 0);
  return cov === 0;   // true = superfície própria da parte (não coberta)
}
let TABLES = null;
const NECK = { x: 590, y: 1110, rx: 300, ry: 350, rz: 362 };
export const NECK_C = NECK;
function bodyRay(nx, phi, out) { const k = Math.sqrt(Math.max(0, 1 - nx * nx)); return out.set(nx * RX, Math.cos(phi) * k * 420, Math.sin(phi) * k * B.rz).normalize(); }
function headRay(lat, lon, out) { const cl = Math.cos(lat); return out.set(cl * Math.cos(lon) * 0.96, Math.sin(lat) * 1.2, cl * Math.sin(lon) * 0.92).normalize(); }
function neckRay(lat, lon, out) { const cl = Math.cos(lat); return out.set(cl * Math.cos(lon) * NECK.rx, Math.sin(lat) * NECK.ry, cl * Math.sin(lon) * NECK.rz).normalize(); }
export function getTables() {
  if (TABLES) return TABLES;
  initEyes();
  TABLES = {
    body: makeTable(97, 145, (c) => c.set(0, B.cy, 0), (u, v, d) => bodyRay(-1 + 2 * u, -Math.PI + TAU * v, d), REGION.BODY, 1400),
    head: makeTable(97, 61, (c) => c.set(HD.cx, HD.cy, 0), (u, v, d) => headRay(-Math.PI / 2 + Math.PI * v, -Math.PI + TAU * u, d), REGION.HEAD, 1000),
    neck: makeTable(65, 33, (c) => c.set(NECK.x, NECK.y, 0), (u, v, d) => neckRay(-Math.PI / 2 + Math.PI * v, -Math.PI + TAU * u, d), REGION.NECK, 900),
  };
  return TABLES;
}
// Pele do corpo na "direção" unitária d (mesma parametrização do elipsoide antigo). Devolve true se a
// superfície ali é do próprio corpo (false = coberta por pescoço/patas/cabeça).
const _bc = new V3(0, B.cy, 0), _hc = new V3(HD.cx, HD.cy, 0), _nc = new V3(NECK.x, NECK.y, 0);
export function skinBody(d, out, nOut = null, folds = true) {
  const T = getTables().body; const phi = Math.atan2(d.z, d.y);
  bodyRay(d.x, phi, _d);
  return lookup(T, (d.x + 1) / 2, (phi + Math.PI) / TAU, out, nOut, folds, _d, _bc);
}
export function skinHead(d, out, nOut = null, folds = true) {
  const T = getTables().head; const lat = Math.asin(Math.max(-1, Math.min(1, d.y))), lon = Math.atan2(d.z, d.x);
  headRay(lat, lon, _d);
  return lookup(T, (lon + Math.PI) / TAU, (lat + Math.PI / 2) / Math.PI, out, nOut, folds, _d, _hc);
}
export function skinNeck(d, out, nOut = null, folds = true) {
  const T = getTables().neck; const lat = Math.asin(Math.max(-1, Math.min(1, d.y))), lon = Math.atan2(d.z, d.x);
  neckRay(lat, lon, _d);
  return lookup(T, (lon + Math.PI) / TAU, (lat + Math.PI / 2) / Math.PI, out, nOut, folds, _d, _nc);
}
function initEyes() {
  if (EYES.length) return;
  for (const side of [-1, 1]) {
    const dir = new V3(EYE_DIR.x, EYE_DIR.y, side * EYE_DIR.z).normalize();
    const r = headRay(Math.asin(dir.y), Math.atan2(dir.z, dir.x), new V3());
    const s = surfaceOnRay(HD.cx, HD.cy, 0, r.x, r.y, r.z, HR * 1.5);
    const pos = new V3(HD.cx, HD.cy, 0).addScaledVector(r, s);
    const n = gradient(pos.x, pos.y, pos.z, new V3());
    EYES.push({ pos, dir: n.clone() });
    SOCKETS.push([pos.x - n.x * (EM.EYE_SINK + 2), pos.y - n.y * (EM.EYE_SINK + 2), pos.z - n.z * (EM.EYE_SINK + 2), EM.EYE_RADIUS - 2]);
  }
}

// ------------------------------------------------------------------
//  poligonização (surface nets esparso) + dobras + AO + pesos
// ------------------------------------------------------------------
const BOUNDS = { x0: -790, x1: 1490, y0: SOLE_Y - 25, y1: 1660, z0: -575, z1: 575 };
// AO de cavidade por curvatura da malha (média dos vizinhos − p)·n → fator multiplicativo por vértice
function cavityFactor(pos, nrm, idx, nV, dark, lift) {
  const sum = new Float32Array(nV * 3), cnt = new Float32Array(nV), elen = new Float32Array(nV);
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = idx[t + e], b = idx[t + (e + 1) % 3];
    const dx = pos[b * 3] - pos[a * 3], dy = pos[b * 3 + 1] - pos[a * 3 + 1], dz = pos[b * 3 + 2] - pos[a * 3 + 2], L = Math.hypot(dx, dy, dz);
    sum[a * 3] += dx; sum[a * 3 + 1] += dy; sum[a * 3 + 2] += dz; cnt[a]++; elen[a] += L;
    sum[b * 3] -= dx; sum[b * 3 + 1] -= dy; sum[b * 3 + 2] -= dz; cnt[b]++; elen[b] += L;
  }
  const c = new Float32Array(nV);
  for (let i = 0; i < nV; i++) { if (!cnt[i]) continue; const L = elen[i] / cnt[i] || 1; c[i] = (sum[i * 3] * nrm[i * 3] + sum[i * 3 + 1] * nrm[i * 3 + 1] + sum[i * 3 + 2] * nrm[i * 3 + 2]) / cnt[i] / L; }
  const abs = Array.from(c, Math.abs).sort((a, b) => a - b), p90 = abs[Math.floor(abs.length * 0.9)] || 1;
  const sm = new Float32Array(nV), sc = new Float32Array(nV);
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) { const a = idx[t + e], b = idx[t + (e + 1) % 3]; sm[a] += c[b]; sc[a]++; sm[b] += c[a]; sc[b]++; }
  const f = new Float32Array(nV);
  for (let i = 0; i < nV; i++) { const v = (0.5 * c[i] + 0.5 * (sc[i] ? sm[i] / sc[i] : c[i])) / p90; f[i] = v > 0 ? 1 - dark * smooth(0, 1.2, v) : 1 + lift * smooth(0, 1.2, -v); }
  return f;
}
const SKIN_CACHE = {};
export function getSkinGeometry(cell, opts = {}) {
  const key = String(cell);
  if (SKIN_CACHE[key]) return SKIN_CACHE[key];
  const g = buildSkinGeometry(cell, opts);
  SKIN_CACHE[key] = g;
  return g;
}
export function buildSkinGeometry(h, { dark = 0.32, lift = 0.08 } = {}) {
  initEyes();
  const T0 = (typeof performance !== 'undefined' ? performance : Date).now();
  const { x0, y0, z0 } = BOUNDS;
  const nx = Math.ceil((BOUNDS.x1 - x0) / h) + 1, ny = Math.ceil((BOUNDS.y1 - y0) / h) + 1, nz = Math.ceil((BOUNDS.z1 - z0) / h) + 1;
  // blocos grossos em dois níveis (8 e 2 células): só os blocos perto da superfície são avaliados
  const blocks = (CB, parent, pcb) => {
    const cnx = Math.ceil((nx - 1) / CB), cny = Math.ceil((ny - 1) / CB), cnz = Math.ceil((nz - 1) / CB);
    const act = new Int8Array(cnx * cny * cnz);   // 0 = ativo; ±1 = sinal constante
    const Rb = CB * h * Math.sqrt(3) * 0.5 * 1.3 + 2.5 * h, r = pcb / CB;
    for (let ci = 0; ci < cnx; ci++) for (let cj = 0; cj < cny; cj++) for (let ck = 0; ck < cnz; ck++) {
      if (parent) { const pa = parent.act[((Math.min(parent.cnx - 1, (ci / r) | 0)) * parent.cny + Math.min(parent.cny - 1, (cj / r) | 0)) * parent.cnz + Math.min(parent.cnz - 1, (ck / r) | 0)]; if (pa !== 0) { act[(ci * cny + cj) * cnz + ck] = pa; continue; } }
      const d = sdf(x0 + (ci + 0.5) * CB * h, y0 + (cj + 0.5) * CB * h, z0 + (ck + 0.5) * CB * h);
      act[(ci * cny + cj) * cnz + ck] = Math.abs(d) < Rb ? 0 : d < 0 ? -1 : 1;
    }
    return { act, cnx, cny, cnz };
  };
  const L1 = blocks(8, null, 0), L2 = blocks(2, L1, 8);
  const CB = 2, { act, cnx, cny, cnz } = L2;
  let evals = 0;
  const sl = ny * nz;
  // por linha (j) da fatia: faixa [kLo, kHi] dos pontos avaliados (fora dela tudo tem o mesmo sinal)
  const fillSlab = (i, V, KL, KH) => {
    const ci = Math.min(cnx - 1, (i / CB) | 0), x = x0 + i * h;
    for (let j = 0; j < ny; j++) {
      const cj = Math.min(cny - 1, (j / CB) | 0), y = y0 + j * h, row = (ci * cny + cj) * cnz;
      let lo = nz, hi = -1;
      for (let k = 0; k < nz; k++) {
        const a = act[row + Math.min(cnz - 1, (k / CB) | 0)];
        if (a !== 0) V[j * nz + k] = a * 1e4;
        else { V[j * nz + k] = sdf(x, y, z0 + k * h); evals++; if (k < lo) lo = k; hi = k; }
      }
      KL[j] = lo; KH[j] = hi;
    }
  };
  let V0 = new Float32Array(sl), V1 = new Float32Array(sl);
  const cs = (ny - 1) * (nz - 1);
  let C0 = new Int32Array(cs).fill(-1), C1 = new Int32Array(cs).fill(-1);
  let KL0 = new Int32Array(ny), KH0 = new Int32Array(ny), KL1 = new Int32Array(ny), KH1 = new Int32Array(ny);
  const P = [], G = [], Q = [];   // posições, gradientes (normais), quads
  fillSlab(0, V0, KL0, KH0);
  const cv = new Float64Array(8);
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  // canto c: bit0 = k (z), bit1 = j (y), bit2 = i (x)
  for (let i = 0; i < nx - 1; i++) {
    fillSlab(i + 1, V1, KL1, KH1);
    C1.fill(-1);
    for (let j = 0; j < ny - 1; j++) {
      const lo = Math.max(0, Math.min(KL0[j], KL0[j + 1], KL1[j], KL1[j + 1]) - 1), hi = Math.min(nz - 2, Math.max(KH0[j], KH0[j + 1], KH1[j], KH1[j + 1]));
      for (let k = lo; k <= hi; k++) {
      const b0 = j * nz + k;
      cv[0] = V0[b0]; cv[1] = V0[b0 + 1]; cv[2] = V0[b0 + nz]; cv[3] = V0[b0 + nz + 1];
      cv[4] = V1[b0]; cv[5] = V1[b0 + 1]; cv[6] = V1[b0 + nz]; cv[7] = V1[b0 + nz + 1];
      let mask = 0; for (let c = 0; c < 8; c++) if (cv[c] < 0) mask |= 1 << c;
      if (mask === 0 || mask === 255) continue;
      let sx = 0, sy = 0, sz = 0, ne = 0;
      for (const [a, b] of EDGES) {
        const va = cv[a], vb = cv[b]; if ((va < 0) === (vb < 0)) continue;
        const t = va / (va - vb);
        sx += ((a >> 2) & 1) + t * (((b >> 2) & 1) - ((a >> 2) & 1)); sy += ((a >> 1) & 1) + t * (((b >> 1) & 1) - ((a >> 1) & 1)); sz += (a & 1) + t * ((b & 1) - (a & 1)); ne++;
      }
      const u = sx / ne, v = sy / ne, w = sz / ne;
      // gradiente trilinear na posição local (u,v,w)
      const gx = (1 - v) * (1 - w) * (cv[4] - cv[0]) + (1 - v) * w * (cv[5] - cv[1]) + v * (1 - w) * (cv[6] - cv[2]) + v * w * (cv[7] - cv[3]);
      const gy = (1 - u) * (1 - w) * (cv[2] - cv[0]) + (1 - u) * w * (cv[3] - cv[1]) + u * (1 - w) * (cv[6] - cv[4]) + u * w * (cv[7] - cv[5]);
      const gz = (1 - u) * (1 - v) * (cv[1] - cv[0]) + (1 - u) * v * (cv[3] - cv[2]) + u * (1 - v) * (cv[5] - cv[4]) + u * v * (cv[7] - cv[6]);
      C1[j * (nz - 1) + k] = P.length / 3;
      P.push(x0 + (i + u) * h, y0 + (j + v) * h, z0 + (k + w) * h);
      const gl = Math.hypot(gx, gy, gz) || 1; G.push(gx / gl, gy / gl, gz / gl);
      }
    }
    const cell = (C, j, k) => C[j * (nz - 1) + k];
    // arestas em x (pontos (i,j,k)→(i+1,j,k)): células (i, j-1..j, k-1..k)
    for (let j = 1; j < ny - 1; j++) for (let k = Math.max(1, Math.min(KL0[j], KL1[j])), kh = Math.min(nz - 2, Math.max(KH0[j], KH1[j])); k <= kh; k++) {
      const a = V0[j * nz + k], b = V1[j * nz + k]; if ((a < 0) === (b < 0)) continue;
      Q.push(cell(C1, j - 1, k - 1), cell(C1, j, k - 1), cell(C1, j, k), cell(C1, j - 1, k), a < 0 ? 1 : 0);
    }
    if (i >= 1) {
      // arestas em y no plano de pontos i: células (i-1..i, j, k-1..k), ordem cíclica (z, x)
      for (let j = 0; j < ny - 1; j++) for (let k = Math.max(1, Math.min(KL0[j], KL0[j + 1])), kh = Math.min(nz - 2, Math.max(KH0[j], KH0[j + 1])); k <= kh; k++) {
        const a = V0[j * nz + k], b = V0[(j + 1) * nz + k]; if ((a < 0) === (b < 0)) continue;
        Q.push(cell(C0, j, k - 1), cell(C0, j, k), cell(C1, j, k), cell(C1, j, k - 1), a < 0 ? 1 : 0);
      }
      // arestas em z: células (i-1..i, j-1..j, k), ordem cíclica (x, y)
      for (let j = 1; j < ny - 1; j++) for (let k = Math.max(0, KL0[j] - 1), kh = Math.min(nz - 2, KH0[j]); k <= kh; k++) {
        const a = V0[j * nz + k], b = V0[j * nz + k + 1]; if ((a < 0) === (b < 0)) continue;
        Q.push(cell(C0, j - 1, k), cell(C1, j - 1, k), cell(C1, j, k), cell(C0, j, k), a < 0 ? 1 : 0);
      }
    }
    let t = V0; V0 = V1; V1 = t; t = C0; C0 = C1; C1 = t; t = KL0; KL0 = KL1; KL1 = t; t = KH0; KH0 = KH1; KH1 = t;
  }
  const T1 = (typeof performance !== 'undefined' ? performance : Date).now();
  const nV = P.length / 3;
  const pos = new Float32Array(P), nrm = new Float32Array(G);
  // projeta na superfície (1 passo de Newton com o gradiente da grade)
  for (let v = 0; v < nV; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2], d = sdf(x, y, z);
    pos[v * 3] = x - nrm[v * 3] * d; pos[v * 3 + 1] = y - nrm[v * 3 + 1] * d; pos[v * 3 + 2] = z - nrm[v * 3 + 2] * d;
  }
  // triângulos (diagonal mais curta); orientação conferida depois
  const idx = [];
  const d2 = (a, b) => { const dx = pos[a * 3] - pos[b * 3], dy = pos[a * 3 + 1] - pos[b * 3 + 1], dz = pos[a * 3 + 2] - pos[b * 3 + 2]; return dx * dx + dy * dy + dz * dz; };
  for (let q = 0; q < Q.length; q += 5) {
    let a = Q[q], b = Q[q + 1], c = Q[q + 2], d = Q[q + 3];
    if (a < 0 || b < 0 || c < 0 || d < 0) continue;
    if (Q[q + 4]) { const t = b; b = d; d = t; }
    if (d2(a, c) <= d2(b, d)) idx.push(a, b, c, a, c, d); else idx.push(a, b, d, b, c, d);
  }
  // orientação: compara a normal de um triângulo com o gradiente
  {
    let agree = 0;
    for (let t = 0; t < Math.min(idx.length, 3000); t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
      const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      agree += Math.sign(fx * nrm[a * 3] + fy * nrm[a * 3 + 1] + fz * nrm[a * 3 + 2]);
    }
    if (agree < 0) for (let t = 0; t < idx.length; t += 3) { const b = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = b; }
  }
  // regiões → dobras, pesos, AO do campo
  const col = new Float32Array(nV * 3), si = new Uint16Array(nV * 4), sw = new Float32Array(nV * 4), disp = new Float32Array(nV);
  const AO = SC.AO_STEP;
  for (let v = 0; v < nV; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2], ax = nrm[v * 3], ay = nrm[v * 3 + 1], az = nrm[v * 3 + 2];
    sdfDetail(x, y, z); const W = regionWeights();
    boneWeights(x, y, z, W, si, sw, v * 4);
    disp[v] = foldDisp(x, y, z, ax, ay, az, W);
    let occ = 0, ws = 0;
    for (let s = 1; s <= 4; s *= 2) { const dd = s * AO; const sv = sdf(x + ax * dd, y + ay * dd, z + az * dd); occ += Math.max(0, (dd - sv) / dd) / s; ws += 1 / s; }
    occ /= ws;
    const ao = 1 - SC.AO_STRENGTH * smooth(0.02, 0.5, occ);
    col[v * 3] = col[v * 3 + 1] = col[v * 3 + 2] = ao;
  }
  for (let v = 0; v < nV; v++) { pos[v * 3] += nrm[v * 3] * disp[v]; pos[v * 3 + 1] += nrm[v * 3 + 1] * disp[v]; pos[v * 3 + 2] += nrm[v * 3 + 2] * disp[v]; }
  const geom = new THREE.BufferGeometry();
  const index = nV > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
  geom.setIndex(new THREE.BufferAttribute(index, 1));
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.computeVertexNormals();
  const fn = geom.attributes.normal.array;
  const cav = cavityFactor(pos, fn, index, nV, dark, lift);
  for (let v = 0; v < nV; v++) { const f = cav[v]; col[v * 3] *= f; col[v * 3 + 1] *= f; col[v * 3 + 2] *= f; }
  geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geom.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  geom.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  geom.computeBoundingBox(); geom.computeBoundingSphere();
  const T2 = (typeof performance !== 'undefined' ? performance : Date).now();
  geom.userData.sculpt = { cell: h, grid: [nx, ny, nz], evals, vertices: nV, triangles: index.length / 3, msField: Math.round(T1 - T0), msAttrib: Math.round(T2 - T1) };
  return geom;
}
