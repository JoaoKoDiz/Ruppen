// =====================================================================
//  RUPPEN — pomba do jogador: modelo procedural com arreios e cavaleiro.
//
//  Visual alinhado às referências: corpo branco em gota com plumagem lisa
//  (escamas de penas sobrepostas, barbas finas), cabeça de pomba (coroa
//  redonda, transição suave para o bico com cera, olho escuro e brilhante
//  com anel), asas LONGAS em gaivota terminando em primárias SEPARADAS
//  (lâminas sobrepostas com ponta arredondada, leve torção e terço externo
//  escuro com raque clara), cauda em leque de retrizes sobrepostas, cavaleiro
//  com proporções reais sentado com peso na sela de couro costurado.
//
//  Cada asa é UMA SkinnedMesh (chapa das secundárias/coberteiras + 8 lâminas
//  das primárias) com quatro ossos: ombro -> punho -> leque -> ponta. A ponta
//  atrasa na batida e supina na subida. Custa 1 draw call por asa.
//
//  Todas as texturas são procedurais (canvas 2D): mapa de cor + mapa de
//  normais (escamas sobrepostas ao longo da direção da pena, barbas como
//  estrias finas) + mapa de rugosidade (coberteiras um pouco mais lustrosas).
//
//  Contrato (ARCHITECTURE.md 4.5):
//    createDove({ quality }) -> { group, packageAnchor, update(dt, flightState) }
//  Convenção local: frente = -Z, cima = +Y, direita = +X. Centro do corpo na
//  origem do grupo. O integrador posiciona o grupo (position/quaternion); aqui
//  nunca mexemos nisso (o "balanço" do corpo move um sub-grupo interno).
// =====================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DOVE, DOVE_MODEL, SEED } from '../config.js';
import { createNoise } from '../util/noise.js';
import { createRng } from '../util/rng.js';

// ----------------------------------------------------------------------
//  Dimensões derivadas (tudo relativo a DOVE.* / DOVE_MODEL.* do config)
// ----------------------------------------------------------------------
const COL = DOVE_MODEL.COLORS;
const DEG = Math.PI / 180;
const HALF_SPAN = DOVE.WINGSPAN / 2;          // 2.3 m
const SHOULDER_X = 0.2;                       // onde a asa sai do corpo
const SHOULDER_Y = 0.27, SHOULDER_Z = -0.12;
const ROOT_X = -0.35;                         // raiz da chapa (dentro do corpo, esconde a junta)
const WRIST_X = 0.95;                         // ombro -> punho
const FAN_X = 1.4, FAN_Y = -0.04;             // centro do leque das primárias (espaço da forma)
const FINGER_LEN_MAX = HALF_SPAN - SHOULDER_X - FAN_X; // 0.7 m: a primária mais longa fecha a envergadura
const BODY_FRONT = -1.0;                      // z da base do pescoço
const BODY_BACK = 1.0;                        // z da base da cauda
const TAIL_LEN = DOVE_MODEL.TAIL_LENGTH_FAN;
const WING_THICK = DOVE_MODEL.WING_THICKNESS;
const HEAD_R = DOVE_MODEL.HEAD_RADIUS * 0.95;
const BODY_TILE = DOVE_MODEL.BODY_FEATHER_TILE; // { repeatU, repeatV, perRow, rows }

const TMP = {
  v1: new THREE.Vector3(), v2: new THREE.Vector3(), v3: new THREE.Vector3(), v4: new THREE.Vector3(),
  q: new THREE.Quaternion(), m: new THREE.Matrix4(), c: new THREE.Color(), c2: new THREE.Color(),
};
const UP = new THREE.Vector3(0, 1, 0);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ----------------------------------------------------------------------
//  Utilitários de geometria
// ----------------------------------------------------------------------
function mergeAll(list) {
  const anyNonIndexed = list.some((g) => !g.index);
  const gs = anyNonIndexed ? list.map((g) => (g.index ? g.toNonIndexed() : g)) : list;
  const merged = mergeGeometries(gs, false);
  for (const g of list) g.dispose();
  return merged;
}

// Pinta uma geometria inteira com uma cor (atributo "color", linear).
function paint(g, hex, mult = 1) {
  const n = g.attributes.position.count;
  const c = new THREE.Color(hex).multiplyScalar(mult);
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

// Cor por vértice do corpo: topo quente, barriga azulada, peito rosado-cinza
// (como o papo iridescente das pombas) — a textura dá o detalhe das penas.
function shadeBody(g, breast = true) {
  const n = g.attributes.position.count;
  const nor = g.attributes.normal, pos = g.attributes.position;
  const top = new THREE.Color(COL.featherTop), under = new THREE.Color(COL.featherUnder), bre = new THREE.Color(COL.breast);
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const w = THREE.MathUtils.smoothstep(nor.getY(i), -0.7, 0.6);
    TMP.c.copy(under).lerp(top, w);
    if (breast) {
      const bz = THREE.MathUtils.smoothstep(-pos.getZ(i), 0.1, 0.8) * THREE.MathUtils.smoothstep(-pos.getY(i), -0.15, 0.3);
      TMP.c.lerp(bre, 0.65 * bz);
    }
    arr[i * 3] = TMP.c.r; arr[i * 3 + 1] = TMP.c.g; arr[i * 3 + 2] = TMP.c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

// Cápsula entre dois pontos (membros do cavaleiro, patas, alças).
function limb(a, b, r, radial = 8, cap = 3) {
  const dir = new THREE.Vector3().subVectors(b, a); const len = dir.length();
  const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len), cap, radial);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());
  g.applyQuaternion(q); g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

function sphere(r, pos, scale = [1, 1, 1], ws = 16, hs = 12) {
  const g = new THREE.SphereGeometry(r, ws, hs);
  g.scale(scale[0], scale[1], scale[2]);
  g.translate(pos.x, pos.y, pos.z);
  return g;
}

function box(w, h, d, pos, rot = [0, 0, 0]) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.rotateX(rot[0]); g.rotateY(rot[1]); g.rotateZ(rot[2]);
  g.translate(pos.x, pos.y, pos.z);
  return g;
}

// Caixa de arestas arredondadas (raio r): caixa subdividida "inflada" sobre
// a caixa interna encolhida — normais exatas da superfície arredondada.
function roundedBox(w, h, d, r, pos, rot = [0, 0, 0], segs = 4) {
  const g = new THREE.BoxGeometry(w, h, d, segs, segs, segs);
  const p = g.attributes.position, n = g.attributes.normal;
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const qx = THREE.MathUtils.clamp(x, -hx, hx), qy = THREE.MathUtils.clamp(y, -hy, hy), qz = THREE.MathUtils.clamp(z, -hz, hz);
    TMP.v1.set(x - qx, y - qy, z - qz);
    if (TMP.v1.lengthSq() < 1e-10) TMP.v1.set(n.getX(i), n.getY(i), n.getZ(i));
    TMP.v1.normalize();
    p.setXYZ(i, qx + TMP.v1.x * r, qy + TMP.v1.y * r, qz + TMP.v1.z * r);
    n.setXYZ(i, TMP.v1.x, TMP.v1.y, TMP.v1.z);
  }
  g.rotateX(rot[0]); g.rotateY(rot[1]); g.rotateZ(rot[2]);
  g.translate(pos.x, pos.y, pos.z);
  return g;
}

// Tira chata de seção retangular arredondada ao longo de pontos (correias de
// couro que abraçam o corpo). outward(p, t) dá a normal "para fora" (lado da
// face larga). uv: u ao longo (em metros * uScale), v ao redor.
function ribbon(points, outward, halfW, halfT, { closed = false, segs = 0, M = 10, uScale = 2 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => p.clone()), closed, 'centripetal');
  const N = segs || Math.max(8, points.length * 6);
  const r = Math.min(halfT, halfW) * 0.85;
  const prof = [];
  for (let k = 0; k < M; k++) {
    const a = (k / M) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    prof.push([Math.sign(ca) * (halfT - r) + r * ca, Math.sign(sa) * (halfW - r) + r * sa, ca, sa]);
  }
  const total = (N + 1) * M;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2);
  const index = [];
  const P = new THREE.Vector3(), T = new THREE.Vector3(), Nn = new THREE.Vector3(), B = new THREE.Vector3();
  const len = curve.getLength();
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    curve.getPointAt(t, P); curve.getTangentAt(t, T);
    outward(P, t, Nn); Nn.addScaledVector(T, -Nn.dot(T)).normalize();
    B.crossVectors(T, Nn).normalize();
    for (let k = 0; k < M; k++) {
      const [pn, pb, cn, cb] = prof[k];
      const vi = i * M + k;
      pos[vi * 3] = P.x + Nn.x * pn + B.x * pb; pos[vi * 3 + 1] = P.y + Nn.y * pn + B.y * pb; pos[vi * 3 + 2] = P.z + Nn.z * pn + B.z * pb;
      nor[vi * 3] = Nn.x * cn + B.x * cb; nor[vi * 3 + 1] = Nn.y * cn + B.y * cb; nor[vi * 3 + 2] = Nn.z * cn + B.z * cb;
      uv[vi * 2] = t * len * uScale; uv[vi * 2 + 1] = k / M;
    }
  }
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < M; k++) {
      const a = i * M + k, b = i * M + (k + 1) % M, c = (i + 1) * M + k, d = (i + 1) * M + (k + 1) % M;
      index.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}

// Fivela de metal: moldura retangular fina + pino.
function buckle(center, w, h, t, rot = [0, 0, 0]) {
  const parts = [
    box(w, t, t, V(0, h / 2, 0)), box(w, t, t, V(0, -h / 2, 0)),
    box(t, h, t, V(w / 2, 0, 0)), box(t, h, t, V(-w / 2, 0, 0)),
    box(t * 0.8, h, t * 0.8, V(0, 0, t * 0.3)),
  ];
  const g = mergeAll(parts);
  g.rotateX(rot[0]); g.rotateY(rot[1]); g.rotateZ(rot[2]);
  g.translate(center.x, center.y, center.z);
  return g;
}

// ----------------------------------------------------------------------
//  Chapa de penas: forma plana (x = envergadura para fora, y = +frente)
//  -> malha fina no plano XZ (y = espessura + camber), triangulada e
//  subdividida de forma CONSISTENTE (arestas partilhadas partem no mesmo
//  ponto, sem fendas) para que a deformação por ossos dobre suavemente.
//  uv = coordenada da forma; cor por vértice topo/baixo/lado.
// ----------------------------------------------------------------------
function dedupe(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q.x - p.x) > 1e-6 || Math.abs(q.y - p.y) > 1e-6) out.push(p);
  }
  const a = out[0], b = out[out.length - 1];
  if (out.length > 1 && Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) out.pop();
  return out;
}

function featherSheet(shape, { thick = WING_THICK, camber = 0.04, chord = 0.65, segs = 10, maxEdge = 0.16 } = {}) {
  const pts = shape.extractPoints(segs);
  let contour = dedupe(pts.shape);
  if (THREE.ShapeUtils.isClockWise(contour)) contour = contour.reverse();
  const verts = contour.map((p) => [p.x, p.y]);
  let faces = THREE.ShapeUtils.triangulateShape(contour, []).map((t) => [t[0], t[1], t[2]]);

  // subdivisão por aresta longa, decidida por aresta (consistente entre vizinhos)
  for (let it = 0; it < 8; it++) {
    const mids = new Map(); let any = false;
    const key = (a, b) => (a < b ? a * 1048576 + b : b * 1048576 + a);
    const midOf = (a, b) => {
      const k = key(a, b); let m = mids.get(k);
      if (m === undefined) { m = verts.length; verts.push([(verts[a][0] + verts[b][0]) / 2, (verts[a][1] + verts[b][1]) / 2]); mids.set(k, m); }
      return m;
    };
    const isLong = (a, b) => Math.hypot(verts[a][0] - verts[b][0], verts[a][1] - verts[b][1]) > maxEdge;
    const next = [];
    for (const [a, b, c] of faces) {
      const sab = isLong(a, b), sbc = isLong(b, c), sca = isLong(c, a);
      const n = sab + sbc + sca;
      if (n === 0) { next.push([a, b, c]); continue; }
      any = true;
      if (n === 3) {
        const m1 = midOf(a, b), m2 = midOf(b, c), m3 = midOf(c, a);
        next.push([a, m1, m3], [m1, b, m2], [m3, m2, c], [m1, m2, m3]);
      } else if (n === 1) {
        const [p, q, r] = sab ? [a, b, c] : sbc ? [b, c, a] : [c, a, b];
        const m = midOf(p, q); next.push([p, m, r], [m, q, r]);
      } else {
        const [p, q, r] = !sca ? [a, b, c] : !sab ? [b, c, a] : [c, a, b];
        const m1 = midOf(p, q), m2 = midOf(q, r);
        next.push([q, m2, m1], [p, m1, m2], [p, m2, r]);
      }
    }
    faces = next; if (!any) break;
  }

  // arestas de contorno (sem triângulo do outro lado) -> paredes laterais
  const dirSet = new Set(faces.flatMap(([a, b, c]) => [a + ',' + b, b + ',' + c, c + ',' + a]));
  const boundary = [];
  for (const [a, b, c] of faces) {
    for (const [p, q] of [[a, b], [b, c], [c, a]]) if (!dirSet.has(q + ',' + p)) boundary.push([p, q]);
  }

  const nTop = faces.length * 3, nSide = boundary.length * 6, N = nTop * 2 + nSide;
  const pos = new Float32Array(N * 3), nor = new Float32Array(N * 3), uv = new Float32Array(N * 2), col = new Float32Array(N * 3);
  const top = new THREE.Color(COL.featherTop), under = new THREE.Color(COL.featherUnder), side = new THREE.Color(COL.featherTop).lerp(under, 0.5);
  const hOf = (z) => { const t = z / chord; return camber * Math.max(0, 1 - t * t); };
  const dhOf = (z) => (Math.abs(z) < chord ? -2 * camber * z / (chord * chord) : 0);
  let k = 0;
  const put = (x, y, z, nx, ny, nz, c) => {
    pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
    nor[k * 3] = nx; nor[k * 3 + 1] = ny; nor[k * 3 + 2] = nz;
    uv[k * 2] = x; uv[k * 2 + 1] = -z;
    col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    k++;
  };
  const face = (i, sign) => { // sign +1 topo, -1 baixo
    const x = verts[i][0], z = -verts[i][1];
    const h = hOf(z), dh = dhOf(z);
    TMP.v1.set(0, 1, -dh).normalize().multiplyScalar(sign);
    put(x, sign * thick / 2 + h, z, TMP.v1.x, TMP.v1.y, TMP.v1.z, sign > 0 ? top : under);
  };
  for (const [a, b, c] of faces) { face(a, 1); face(b, 1); face(c, 1); }
  for (const [a, b, c] of faces) { face(a, -1); face(c, -1); face(b, -1); }
  for (const [a, b] of boundary) {
    const ax = verts[a][0], az = -verts[a][1], bx = verts[b][0], bz = -verts[b][1];
    const ha = hOf(az), hb = hOf(bz);
    const dx = bx - ax, dz = bz - az;
    TMP.v2.set(-dz, 0, dx).normalize();
    TMP.v3.set(bx - ax, hb - ha, bz - az); TMP.v4.set(0, -thick, 0);
    TMP.v1.crossVectors(TMP.v3, TMP.v4);
    const flip = TMP.v1.dot(TMP.v2) < 0;
    const A = [ax, thick / 2 + ha, az], B = [bx, thick / 2 + hb, bz], C = [bx, -thick / 2 + hb, bz], D = [ax, -thick / 2 + ha, az];
    const quad = flip ? [A, D, C, A, C, B] : [A, B, C, A, C, D];
    for (const p of quad) put(p[0], p[1], p[2], TMP.v2.x, TMP.v2.y, TMP.v2.z, side);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// Pesos de "pele" por posição ao longo da envergadura: osso 0 (ombro),
// 1 (punho), 2 (leque das primárias), com transições suaves.
function skinByX(g, x1, x2, blend = 0.2) {
  const pos = g.attributes.position, n = pos.count;
  const idx = new Uint16Array(n * 4), wgt = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i);
    const w1 = THREE.MathUtils.smoothstep(x, x1 - blend, x1 + blend * 0.9);
    const w2 = THREE.MathUtils.smoothstep(x, x2 - blend, x2 + blend * 0.75);
    idx[i * 4] = 0; idx[i * 4 + 1] = 1; idx[i * 4 + 2] = 2; idx[i * 4 + 3] = 0;
    wgt[i * 4] = 1 - w1; wgt[i * 4 + 1] = w1 - w2; wgt[i * 4 + 2] = w2; wgt[i * 4 + 3] = 0;
  }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(wgt, 4));
  return g;
}

// ----------------------------------------------------------------------
//  Lâmina de pena: contorno (x = ao longo da raque, y = através, +y = vão
//  de ataque, mais estreito), ponta arredondada, base afunilada (cálamo).
//  Partilhado pela textura e pela geometria para que coincidam.
// ----------------------------------------------------------------------
function bladeWidth(s, len, wL, wT) {
  const R = (wL + wT) * 0.95;
  let k = 1;
  if (s > len - R) { const t = (s - (len - R)) / R; k = Math.sqrt(Math.max(0, 1 - t * t)); }
  const kb = 0.45 + 0.55 * THREE.MathUtils.smoothstep(s, 0, len * 0.22);
  return [wL * k * kb, wT * k * kb];
}

function bladeShape(len, wL, wT, n = 14) {
  const s = new THREE.Shape();
  const lead = [], trail = [];
  for (let i = 0; i <= n; i++) {
    const t = len * (i / n);
    const [a, b] = bladeWidth(t, len, wL, wT);
    lead.push([t, a]); trail.push([t, -b]);
  }
  s.moveTo(lead[0][0], lead[0][1]);
  for (let i = 1; i <= n; i++) s.lineTo(lead[i][0], lead[i][1]);
  for (let i = n - 1; i >= 0; i--) s.lineTo(trail[i][0], trail[i][1]);
  s.closePath();
  return s;
}

// ----------------------------------------------------------------------
//  Texturas procedurais (canvas 2D).
// ----------------------------------------------------------------------
function makeTex(rgba, W, H, { srgb = false, wrap = false, bounds = null, repeat = null } = {}) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  img.data.set(rgba);
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  if (bounds) {
    const { xmin, xmax, ymin, ymax } = bounds;
    tex.repeat.set(1 / (xmax - xmin), 1 / (ymax - ymin));
    tex.offset.set(-xmin / (xmax - xmin), -ymin / (ymax - ymin));
  }
  if (repeat) tex.repeat.set(repeat[0], repeat[1]);
  return tex;
}

// Mapa de normais (espaço tangente, +v = linha 0 do canvas) a partir de um
// campo de alturas; devolve também "oclusão" (pixel abaixo da vizinhança).
function normalsFromHeight(h, W, H, strength, wrap) {
  const out = new Uint8ClampedArray(W * H * 4);
  const occ = new Float32Array(W * H);
  const at = (x, y) => {
    if (wrap) { x = (x + W) % W; y = (y + H) % H; } else { x = x < 0 ? 0 : x >= W ? W - 1 : x; y = y < 0 ? 0 : y >= H ? H - 1 : y; }
    return h[y * W + x];
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const hx = (at(x + 1, y) - at(x - 1, y)) * 0.5, hy = (at(x, y + 1) - at(x, y - 1)) * 0.5;
      let nx = -hx * strength, ny = hy * strength; // linha para baixo = -v
      const m = Math.hypot(nx, ny);
      if (m > 2.2) { nx *= 2.2 / m; ny *= 2.2 / m; }
      const inv = 1 / Math.hypot(nx, ny, 1);
      const i = (y * W + x) * 4;
      out[i] = 128 + 127 * nx * inv; out[i + 1] = 128 + 127 * ny * inv; out[i + 2] = 128 + 127 * inv; out[i + 3] = 255;
      const c = h[y * W + x];
      const nb = (at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1)) * 0.5 + (at(x - 3, y) + at(x + 3, y) + at(x, y - 3) + at(x, y + 3)) * 0.5;
      occ[y * W + x] = Math.max(0, nb / 4 - c);
    }
  }
  return { normal: out, occ };
}

// Plumagem: desenha lâminas (penas) sobrepostas num campo de alturas e gera
// mapa de cor (branco quente, bordas levemente cinzentas, pontas escuras com
// raque clara), de normais (escamas + barbas) e de rugosidade.
// blades: { bx, by, dx, dy, len, wL, wT, layer, gloss, dark, darkK, darkColor, tint }
function plumageMaps({ W, H, bounds, blades, wrap = false, base = [252, 249, 243], edge = [190, 197, 208], dark = [52, 56, 64],
  roughBase = 0.74, strength = 1.5, layerStep = 0.45, barbAmp = 0.07, seed = 1 }) {
  const noise = createNoise(seed);
  const { xmin, xmax, ymin, ymax } = bounds;
  const sx = W / (xmax - xmin), sy = H / (ymax - ymin);
  const N = W * H;
  const h = new Float32Array(N), rough = new Float32Array(N).fill(roughBase);
  const col = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { col[i * 3] = base[0]; col[i * 3 + 1] = base[1]; col[i * 3 + 2] = base[2]; }
  const list = blades.map((b, i) => ({ ...b, i })).sort((a, b) => (a.layer - b.layer) || (a.i - b.i));
  const shaft = [238, 235, 230];
  const sm = THREE.MathUtils.smoothstep;
  for (const b of list) {
    const wmax = Math.max(b.wL, b.wT) * 1.05;
    const px_ = (x) => (x - xmin) * sx, py_ = (y) => (ymax - y) * sy;
    const cx = [b.bx + b.dy * wmax, b.bx - b.dy * wmax, b.bx + b.dx * b.len + b.dy * wmax, b.bx + b.dx * b.len - b.dy * wmax];
    const cy = [b.by - b.dx * wmax, b.by + b.dx * wmax, b.by + b.dy * b.len - b.dx * wmax, b.by + b.dy * b.len + b.dx * wmax];
    let x0 = Math.floor(Math.min(...cx.map(px_))), x1 = Math.ceil(Math.max(...cx.map(px_)));
    let y0 = Math.floor(Math.min(...cy.map(py_))), y1 = Math.ceil(Math.max(...cy.map(py_)));
    if (!wrap) { x0 = Math.max(0, x0); x1 = Math.min(W - 1, x1); y0 = Math.max(0, y0); y1 = Math.min(H - 1, y1); }
    const tint = b.tint || null, dk = b.darkColor || dark, gloss = b.gloss || 0, darkK = b.darkK === undefined ? 1 : b.darkK;
    const layerH = b.layer * layerStep;
    for (let py = y0; py <= y1; py++) {
      const y = ymax - (py + 0.5) / sy;
      for (let px = x0; px <= x1; px++) {
        const x = xmin + (px + 0.5) / sx;
        const rx = x - b.bx, ry = y - b.by;
        const s = rx * b.dx + ry * b.dy; if (s < 0 || s > b.len) continue;
        const u = -rx * b.dy + ry * b.dx;
        const [wl, wt] = bladeWidth(s, b.len, b.wL, b.wT);
        if (u > wl || u < -wt) continue;
        const w = u > 0 ? wl : wt; const un = u / Math.max(1e-5, w);
        const ridge = Math.exp(-un * un / 0.012);
        const au = Math.abs(u);
        const p = s * 0.87 - au * 0.5;                              // coordenada perpendicular às barbas (~30°)
        const streak = noise.noise2(p * 85, (s * 0.8 + au * 0.5) * 9);
        const i = wrap ? (((py % H) + H) % H) * W + (((px % W) + W) % W) : py * W + px;
        h[i] = layerH + 0.55 * ridge - 0.3 * un * un + barbAmp * streak;
        // cor
        let r = base[0], g = base[1], bl = base[2];
        if (tint) { r *= tint[0]; g *= tint[1]; bl *= tint[2]; }
        const e = 0.42 * sm(Math.abs(un), 0.72, 1.0);
        r += (edge[0] - r) * e; g += (edge[1] - g) * e; bl += (edge[2] - bl) * e;
        const sc = 1 + 0.025 * streak; r *= sc; g *= sc; bl *= sc;
        let ro = roughBase - 0.2 * gloss - 0.05 * ridge + 0.04 * streak;
        if (b.dark > 0) {
          const t = (s - b.len * (1 - b.dark)) / (b.len * b.dark);
          if (t > 0) {
            const d = sm(t, 0, 0.3) * darkK;
            r += (dk[0] - r) * d; g += (dk[1] - g) * d; bl += (dk[2] - bl) * d;
            const sh = Math.pow(ridge, 1.6) * 0.9 * d;
            r += (shaft[0] - r) * sh; g += (shaft[1] - g) * sh; bl += (shaft[2] - bl) * sh;
            ro += (0.6 - ro) * d;
          }
        }
        col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = bl;
        rough[i] = ro;
      }
    }
  }
  const { normal, occ } = normalsFromHeight(h, W, H, strength, wrap);
  const rgb = new Uint8ClampedArray(N * 4), rg = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    const o = Math.min(1, occ[i] * 1.6) * 0.45;
    rgb[i * 4] = col[i * 3] + (edge[0] * 0.92 - col[i * 3]) * o;
    rgb[i * 4 + 1] = col[i * 3 + 1] + (edge[1] * 0.92 - col[i * 3 + 1]) * o;
    rgb[i * 4 + 2] = col[i * 3 + 2] + (edge[2] * 0.92 - col[i * 3 + 2]) * o;
    rgb[i * 4 + 3] = 255;
    const rv = 255 * THREE.MathUtils.clamp(rough[i] + 0.06 * o, 0.2, 1);
    rg[i * 4] = rv; rg[i * 4 + 1] = rv; rg[i * 4 + 2] = rv; rg[i * 4 + 3] = 255;
  }
  const opt = { wrap, bounds: wrap ? null : bounds };
  return {
    map: makeTex(rgb, W, H, { srgb: true, ...opt }),
    normalMap: makeTex(normal, W, H, opt),
    roughnessMap: makeTex(rg, W, H, opt),
  };
}

// Couro: grão + costuras (duas fileiras de pontos) + manchas gastas mais
// claras e um pouco mais lustrosas. Tileável.
function leatherMaps(S, baseHex, { stitch = true, seed = 11 } = {}) {
  const noise = createNoise(SEED + seed);
  const base = new THREE.Color(baseHex);
  const N = S * S;
  const h = new Float32Array(N), rgb = new Uint8ClampedArray(N * 4), rg = new Uint8ClampedArray(N * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, i = y * S + x;
      // ruído tileável: soma de amostras deslocadas (aproximação suficiente para um tile pequeno)
      const g1 = noise.noise2(u * 18, v * 18) * 0.5 + noise.noise2(u * 47 + 9, v * 47) * 0.3 + noise.noise2(u * 110 + 3, v * 110 + 7) * 0.2;
      const worn = THREE.MathUtils.smoothstep(noise.noise2(u * 3.5 + 20, v * 3.5 + 11) + 0.35 * noise.noise2(u * 9 + 5, v * 9), 0.25, 0.75);
      let hv = 0.22 * g1;
      if (stitch) {
        for (const vr of [0.25, 0.75]) {
          let dv = Math.abs(v - vr); dv = Math.min(dv, 1 - dv);
          hv -= 0.18 * Math.exp(-(dv * dv) / 0.00012);                // sulco da costura
          const per = 1 / 10, ph = ((u + (vr > 0.5 ? per / 2 : 0)) % per) / per;
          const along = Math.exp(-Math.pow((ph - 0.5) / 0.28, 4));
          hv += 0.42 * along * Math.exp(-(dv * dv) / 0.00005);         // ponto em relevo
        }
      }
      h[i] = hv;
      const lum = 1 + 0.08 * g1 + 0.3 * worn;
      TMP.c.copy(base).multiplyScalar(lum);
      if (stitch) {
        for (const vr of [0.25, 0.75]) {
          let dv = Math.abs(v - vr); dv = Math.min(dv, 1 - dv);
          const per = 1 / 10, ph = ((u + (vr > 0.5 ? per / 2 : 0)) % per) / per;
          const along = Math.exp(-Math.pow((ph - 0.5) / 0.28, 4));
          TMP.c.lerp(TMP.c2.set(0xd9c39a), along * Math.exp(-(dv * dv) / 0.00005) * 0.85);
        }
      }
      rgb[i * 4] = TMP.c.r * 255; rgb[i * 4 + 1] = TMP.c.g * 255; rgb[i * 4 + 2] = TMP.c.b * 255; rgb[i * 4 + 3] = 255;
      const ro = 0.62 - 0.2 * worn + 0.06 * g1;
      rg[i * 4] = rg[i * 4 + 1] = rg[i * 4 + 2] = 255 * THREE.MathUtils.clamp(ro, 0.25, 1); rg[i * 4 + 3] = 255;
    }
  }
  const { normal } = normalsFromHeight(h, S, S, 2.2, true);
  return { map: makeTex(rgb, S, S, { srgb: true, wrap: true }), normalMap: makeTex(normal, S, S, { wrap: true }), roughnessMap: makeTex(rg, S, S, { wrap: true }) };
}

// Tecido: dobras suaves (cristas onduladas perpendiculares ao membro) + trama
// fina. Tileável; rugosidade alta (sem brilho plástico).
function clothMaps(S, { seed = 23 } = {}) {
  const noise = createNoise(SEED + seed);
  const rng = createRng(SEED + seed);
  const N = S * S;
  const folds = [];
  for (let k = 0; k < 6; k++) folds.push({ v: rng(), a: 0.5 + rng() * 0.6, w: 0.012 + rng() * 0.02, f: 1 + Math.floor(rng() * 3), ph: rng() * 6.28, sw: 0.02 + rng() * 0.03 });
  const h = new Float32Array(N), rg = new Uint8ClampedArray(N * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, i = y * S + x;
      let hv = 0;
      for (const f of folds) {
        let dv = v - f.v - f.sw * Math.sin(u * Math.PI * 2 * f.f + f.ph); dv -= Math.round(dv);
        hv += f.a * Math.exp(-(dv * dv) / (f.w * f.w)) * (0.6 + 0.4 * noise.noise2(u * 6 + f.ph, 3));
      }
      const weave = noise.noise2(u * 160, v * 160) * 0.5 + noise.noise2(u * 23 + 4, v * 23) * 0.5;
      h[i] = hv + 0.05 * weave;
      const ro = 0.9 - 0.05 * weave - 0.06 * hv;
      rg[i * 4] = rg[i * 4 + 1] = rg[i * 4 + 2] = 255 * THREE.MathUtils.clamp(ro, 0.5, 1); rg[i * 4 + 3] = 255;
    }
  }
  const { normal } = normalsFromHeight(h, S, S, 1.6, true);
  return { normalMap: makeTex(normal, S, S, { wrap: true }), roughnessMap: makeTex(rg, S, S, { wrap: true }) };
}

// ----------------------------------------------------------------------
//  Planta da asa. Espaço da forma: x = para fora (ombro em 0), y = +frente.
//  Braço: bordo de ataque levemente à frente até o punho; mão recuada
//  (sweep) até as coberteiras primárias (borda escalopada); as primárias
//  são lâminas separadas que nascem no leque, sob as coberteiras.
// ----------------------------------------------------------------------
function fingerDefs() {
  const n = DOVE_MODEL.PRIMARIES;
  const a0 = -8, step = -15.5;                                  // graus (0 = para fora, negativo = para trás)
  const lensRel = [1.0, 1.0, 0.97, 0.9, 0.8, 0.69, 0.58, 0.5];
  const halfW = [0.052, 0.054, 0.054, 0.053, 0.051, 0.048, 0.044, 0.04];
  const defs = [];
  for (let i = 0; i < n; i++) {
    const a = THREE.MathUtils.degToRad(a0 + step * i);
    const len = FINGER_LEN_MAX * lensRel[Math.min(i, lensRel.length - 1)];
    const w = halfW[Math.min(i, halfW.length - 1)];
    const dx = Math.cos(a), dy = Math.sin(a), px = -dy, py = dx;  // px,py = perpendicular (lado do dedo anterior = bordo de ataque)
    const cov = 0.42 * len + 0.1;                                 // alcance das coberteiras primárias sobre a lâmina
    const wc = w * 1.08;
    const tip = { x: FAN_X + dx * cov, y: FAN_Y + dy * cov };
    defs.push({
      a, len, w, dx, dy, px, py, cov, tip,
      tipA: { x: tip.x + px * wc, y: tip.y + py * wc },
      tipB: { x: tip.x - px * wc, y: tip.y - py * wc },
      ctrl: { x: tip.x + dx * wc * 1.2, y: tip.y + dy * wc * 1.2 },
    });
  }
  for (let i = 0; i < n - 1; i++) {
    const am = (defs[i].a + defs[i + 1].a) / 2, r = 0.72 * Math.min(defs[i].cov, defs[i + 1].cov);
    defs[i].notch = { x: FAN_X + Math.cos(am) * r, y: FAN_Y + Math.sin(am) * r };
  }
  return defs;
}

function wingShape(fingers) {
  const s = new THREE.Shape();
  const f0 = fingers[0];
  s.moveTo(ROOT_X, 0.55);
  s.quadraticCurveTo(0.45, 0.66, WRIST_X, 0.6);                       // braço: bordo de ataque um pouco à frente
  s.quadraticCurveTo(WRIST_X + 0.55, 0.5, f0.tipA.x, f0.tipA.y);      // mão: recuo (sweep) até a 1ª coberteira primária
  for (let i = 0; i < fingers.length; i++) {
    const f = fingers[i];
    if (i > 0) s.lineTo(f.tipA.x, f.tipA.y);
    s.quadraticCurveTo(f.ctrl.x, f.ctrl.y, f.tipB.x, f.tipB.y);       // ponta arredondada da coberteira
    if (f.notch) s.lineTo(f.notch.x, f.notch.y);                      // escalope entre coberteiras
  }
  s.quadraticCurveTo(1.12, -0.36, 0.84, -0.44);                       // "axila": bordo de fuga côncavo
  s.quadraticCurveTo(0.42, -0.8, ROOT_X, -0.66);                      // secundárias bojudas junto ao corpo
  s.closePath();
  return s;
}

// Lâminas (penas) da textura da asa, no espaço da forma.
function wingBlades(fingers) {
  const B = [];
  const add = (bx, by, deg, len, wL, wT, extra = {}) => {
    const a = deg * DEG;
    B.push({ bx, by, dx: Math.cos(a), dy: Math.sin(a), len, wL, wT, layer: 0, gloss: 0, dark: 0, ...extra });
  };
  const NS = 13, span = WRIST_X - 0.06 - ROOT_X;
  for (let j = 0; j < NS; j++) {                                      // secundárias + terciais (internas por cima)
    const t = j / (NS - 1);
    add(ROOT_X + 0.02 + t * span, 0.34 - 0.05 * t, -84 - 24 * t, 1.05, 0.045, 0.07, { layer: 0.3 - 0.01 * j });
  }
  fingers.forEach((f, i) => {                                         // primárias (internas por cima), ponta escura, raque clara
    add(FAN_X, FAN_Y, f.a / DEG, f.len, f.w * 0.72, f.w * 1.28, { layer: 0.5 + 0.01 * i, dark: DOVE_MODEL.PRIMARY_DARK_FRACTION, darkK: i < 5 ? 1 : 0.75 });
  });
  for (let j = 0; j < NS; j++) {                                      // coberteiras maiores
    const t = j / (NS - 1);
    add(ROOT_X + 0.02 + t * span, 0.46 - 0.06 * t, -86 - 22 * t, 0.52, 0.038, 0.055, { layer: 1 - 0.005 * j, gloss: 0.35 });
  }
  for (let j = 0; j < 15; j++) {                                      // coberteiras médias
    const t = j / 14;
    add(ROOT_X + 0.0 + t * (span + 0.05), 0.55 - 0.07 * t, -88 - 22 * t, 0.32, 0.032, 0.042, { layer: 2 - 0.004 * j, gloss: 0.7 });
  }
  for (let r = 0; r < 3; r++) {                                       // coberteiras menores (3 fileiras no bordo de ataque)
    for (let j = 0; j < 20; j++) {
      const t = j / 19;
      add(ROOT_X - 0.02 + t * (span + 0.08) + (r % 2) * 0.03, 0.6 + 0.045 * r - 0.08 * t, -92 - 20 * t, 0.17, 0.024, 0.03, { layer: 3 + r - 0.002 * j, gloss: 1 });
    }
  }
  fingers.forEach((f, i) => {                                         // coberteiras primárias
    add(FAN_X + f.dx * 0.03, FAN_Y + f.dy * 0.03, f.a / DEG, f.cov - 0.02, 0.035, 0.05, { layer: 1.5 + 0.01 * i, gloss: 0.35 });
  });
  for (let r = 0; r < 2; r++) {                                       // coberteiras menores da mão (bordo de ataque da mão)
    for (let j = 0; j < 10; j++) {
      const t = j / 9;
      add(WRIST_X + 0.02 + t * 0.72 + r * 0.05, 0.52 - 0.5 * t - 0.06 * r, -33 - 10 * t, 0.22, 0.028, 0.034, { layer: 3 + r - 0.002 * j, gloss: 0.9 });
    }
  }
  add(WRIST_X + 0.05, 0.6, -36, 0.34, 0.025, 0.036, { layer: 5, dark: 0.35, darkK: 0.45, gloss: 0.4 });   // álula
  add(WRIST_X + 0.13, 0.57, -38, 0.27, 0.022, 0.03, { layer: 5.1, dark: 0.3, darkK: 0.35, gloss: 0.4 });
  return B;
}

// Retrizes: 12 penas em leque (par central por cima), espaço da forma:
// x = lateral, y = +frente; a cauda vai para -y.
function tailDefs() {
  const n = 12, defs = [];
  for (let k = 0; k < n; k++) {
    const c = k - (n - 1) / 2;                                        // -5.5 .. 5.5
    const deg = -90 + c * 9.5;
    const a = deg * DEG;
    const len = TAIL_LEN - 0.07 * Math.abs(c) / 5.5;
    defs.push({ k, c, a, deg, len, w: 0.058, bx: c * 0.012, by: 0.1, order: 6 - Math.abs(c) });
  }
  return defs;
}

function tailBlades(defs) {
  return defs.map((d) => ({ bx: d.bx, by: d.by, dx: Math.cos(d.a), dy: Math.sin(d.a), len: d.len, wL: d.w, wT: d.w, layer: d.order, gloss: 0.2, dark: 0.16, darkK: 0.45, darkColor: [176, 180, 188] }));
}

// Tile do corpo: fileiras de penas apontando para +v (para trás), alternadas.
function bodyBlades() {
  const rng = createRng(SEED + 99);
  const B = [];
  const { perRow: NF, rows: NR } = BODY_TILE;
  for (let r = NR - 1; r >= 0; r--) {
    for (let j = 0; j < NF; j++) {
      const deg = 90 + (rng() - 0.5) * 7;
      const a = deg * DEG;
      B.push({ bx: (j + 0.5 + 0.5 * (r % 2)) / NF, by: r / NR - 0.04 + (rng() - 0.5) * 0.02, dx: Math.cos(a), dy: Math.sin(a), len: 2.3 / NR, wL: 0.5 / NF * 1.18, wT: 0.5 / NF * 1.18, layer: NR - 1 - r, gloss: 0.25, dark: 0 });
    }
  }
  return B;
}

// ----------------------------------------------------------------------
//  Corpo: gota lisa e gorducha (peito fundo, barriga redonda, base da
//  cauda fina). bodySurface(z, ang) é reutilizada para as tiras dos arreios.
// ----------------------------------------------------------------------
function makeBodyProfile() {
  const ctrl = [
    [BODY_FRONT, 0.0], [BODY_FRONT + 0.04, 0.2], [-0.8, 0.38], [-0.5, 0.48], [-0.15, 0.5],
    [0.2, 0.46], [0.5, 0.36], [0.75, 0.24], [0.92, 0.13], [BODY_BACK, 0.0],
  ];
  const curve = new THREE.SplineCurve(ctrl.map(([z, r]) => new THREE.Vector2(z, r)));
  const N = 220;
  const pts = curve.getPoints(N);
  const radiusAt = (z) => {
    if (z <= pts[0].x) return 0; if (z >= pts[N].x) return 0;
    let lo = 0, hi = N;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid].x <= z) lo = mid; else hi = mid; }
    const a = pts[lo], b = pts[hi];
    const t = (z - a.x) / Math.max(1e-6, b.x - a.x);
    return Math.max(0, a.y + (b.y - a.y) * t);
  };
  // deformação: quilha/peito fundo, dorso levemente achatado, corpo um pouco mais estreito que alto
  const deform = (p) => {
    const keel = Math.exp(-Math.pow((p.z + 0.35) / 0.6, 2));
    if (p.y < 0) p.y *= 1 + 0.3 * keel;
    else p.y *= 0.97;
    p.x *= 0.92;
    return p;
  };
  // ang = 0 topo, pi/2 lado direito, pi barriga
  const surface = (z, ang, pad = 0, target = new THREE.Vector3()) => {
    const r = radiusAt(z) + pad;
    target.set(Math.sin(ang) * r, Math.cos(ang) * r, z);
    return deform(target);
  };
  return { radiusAt, deform, surface, pts };
}

function latheZ(profilePts, around) {
  // profilePts: [{x: z, y: r}] da frente para trás -> v cresce para trás (penas apontam para +v)
  const lathePts = profilePts.map((p) => new THREE.Vector2(p.y, p.x));
  const g = new THREE.LatheGeometry(lathePts, around);
  g.rotateX(Math.PI / 2); // eixo do perfil vira o eixo Z (frente em -Z)
  return g;
}

function makeBodyGeometry(profile, segs) {
  const step = Math.max(1, Math.round(profile.pts.length / segs.body));
  const sub = profile.pts.filter((_, i) => i % step === 0);
  if (sub[sub.length - 1] !== profile.pts[profile.pts.length - 1]) sub.push(profile.pts[profile.pts.length - 1]);
  const g = latheZ(sub, segs.around);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    TMP.v1.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    profile.deform(TMP.v1);
    pos.setXYZ(i, TMP.v1.x, TMP.v1.y, TMP.v1.z);
  }
  g.computeVertexNormals();
  return g;
}

// Cabeça de pomba: coroa redonda, nuca cheia, testa descendo suave até a
// cera; perfil revolvido em torno de Z (frente em -Z) e levemente estreitado.
function makeHeadGeometry(segs) {
  const R = HEAD_R;
  const ctrl = [
    [-1.5, 0.0], [-1.45, 0.26], [-1.34, 0.45], [-1.16, 0.63], [-0.92, 0.79], [-0.63, 0.92], [-0.32, 1.0],
    [0.0, 1.03], [0.37, 1.0], [0.68, 0.9], [0.9, 0.72], [1.05, 0.46], [1.13, 0.22], [1.16, 0.0],
  ].map(([z, r]) => new THREE.Vector2(z * R, r * R));
  const curve = new THREE.SplineCurve(ctrl);
  const pts = curve.getPoints(segs.sph + 10);
  const g = latheZ(pts, segs.sph + 10);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    // queixo/garganta um pouco mais cheios, lados ligeiramente achatados
    const throat = y < 0 ? 1 + 0.08 * Math.exp(-Math.pow((z + 0.3 * R) / (0.6 * R), 2)) : 1;
    pos.setXYZ(i, x * 0.9, y * throat, z);
  }
  g.computeVertexNormals();
  return g;
}

// ----------------------------------------------------------------------
//  Corda dinâmica (rédeas): geometria reutilizada, atualizada por quadro.
// ----------------------------------------------------------------------
function createRopes(count, segs, radial, radius) {
  const ringN = radial;
  const vertsPer = (segs + 1) * ringN;
  const total = vertsPer * count;
  const positions = new Float32Array(total * 3);
  const normals = new Float32Array(total * 3);
  const uvs = new Float32Array(total * 2);
  const index = [];
  for (let r = 0; r < count; r++) {
    const base = r * vertsPer;
    for (let i = 0; i < segs; i++) {
      for (let j = 0; j < ringN; j++) {
        const a = base + i * ringN + j, b = base + i * ringN + (j + 1) % ringN;
        const c = base + (i + 1) * ringN + j, d = base + (i + 1) * ringN + (j + 1) % ringN;
        index.push(a, c, b, b, c, d);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(index);
  const pts = Array.from({ length: segs + 1 }, () => new THREE.Vector3());
  const tangent = new THREE.Vector3(), nrm = new THREE.Vector3(), bin = new THREE.Vector3();
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], false, 'centripetal');
  const update = (ropeIndex, ctrl) => {
    for (let k = 0; k < 4; k++) curve.points[k].copy(ctrl[k]);
    for (let i = 0; i <= segs; i++) curve.getPoint(i / segs, pts[i]);
    const base = ropeIndex * vertsPer;
    for (let i = 0; i <= segs; i++) {
      const p = pts[i];
      tangent.subVectors(pts[Math.min(segs, i + 1)], pts[Math.max(0, i - 1)]).normalize();
      nrm.crossVectors(tangent, UP);
      if (nrm.lengthSq() < 1e-6) nrm.set(1, 0, 0);
      nrm.normalize();
      bin.crossVectors(tangent, nrm).normalize();
      for (let j = 0; j < ringN; j++) {
        const a = (j / ringN) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const vi = base + i * ringN + j;
        const nx = nrm.x * ca + bin.x * sa, ny = nrm.y * ca + bin.y * sa, nz = nrm.z * ca + bin.z * sa;
        positions[vi * 3] = p.x + nx * radius; positions[vi * 3 + 1] = p.y + ny * radius; positions[vi * 3 + 2] = p.z + nz * radius;
        normals[vi * 3] = nx; normals[vi * 3 + 1] = ny; normals[vi * 3 + 2] = nz;
        uvs[vi * 2] = i / segs * 3; uvs[vi * 2 + 1] = j / ringN;
      }
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
  };
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, -0.8), 2.5); // evita recomputar
  return { geometry: g, update };
}

// ======================================================================
//  createDove
// ======================================================================
export function createDove(opts = {}) {
  const quality = opts.quality || 'high';
  const low = quality === 'low';
  const segs = { body: low ? 24 : 40, around: low ? 22 : 36, sph: low ? 12 : 18, edge: low ? 0.24 : 0.17, blade: low ? 0.14 : 0.09, tex: low ? 0.5 : 1 };
  const rng = createRng(SEED + 4242); // variação determinística (ex.: fases iniciais)

  const group = new THREE.Group();
  group.name = 'dove';
  const root = new THREE.Group();   // tudo pendura aqui: o balanço do corpo move só este sub-grupo
  root.name = 'doveRoot';
  group.add(root);

  // ------------------------------ texturas ----------------------------
  const fingers = fingerDefs();
  const tails = tailDefs();
  const WB = { xmin: ROOT_X - 0.1, xmax: HALF_SPAN - SHOULDER_X + 0.15, ymin: -0.95, ymax: 0.8 };
  const TB = { xmin: -0.78, xmax: 0.78, ymin: -TAIL_LEN - 0.12, ymax: 0.22 };
  const wingMaps = plumageMaps({ W: 1024 * segs.tex, H: 640 * segs.tex, bounds: WB, blades: wingBlades(fingers), seed: SEED + 7, strength: 1.6, layerStep: 0.42 });
  const tailMaps = plumageMaps({ W: 512 * segs.tex, H: 320 * segs.tex, bounds: TB, blades: tailBlades(tails), seed: SEED + 8, strength: 1.6, layerStep: 0.42 });
  const bodyMaps = plumageMaps({ W: 512 * segs.tex, H: 512 * segs.tex, bounds: { xmin: 0, xmax: 1, ymin: 0, ymax: 1 }, blades: bodyBlades(), wrap: true, seed: SEED + 9, strength: 1.3, layerStep: 0.35, barbAmp: 0.05, edge: [205, 208, 216] });
  for (const k of ['map', 'normalMap', 'roughnessMap']) bodyMaps[k].repeat.set(BODY_TILE.repeatU, BODY_TILE.repeatV);
  const saddleMaps = leatherMaps(256, COL.leather, { stitch: true, seed: 11 });
  const darkLeatherMaps = leatherMaps(128, COL.leatherDark, { stitch: false, seed: 12 });
  const cloth = clothMaps(256);

  // ------------------------------ materiais ----------------------------
  const NS = (s) => new THREE.Vector2(s, s);
  const featherMat = new THREE.MeshStandardMaterial({ map: wingMaps.map, normalMap: wingMaps.normalMap, normalScale: NS(0.9), roughnessMap: wingMaps.roughnessMap, vertexColors: true, roughness: 1, metalness: 0 });
  const tailMat = new THREE.MeshStandardMaterial({ map: tailMaps.map, normalMap: tailMaps.normalMap, normalScale: NS(0.9), roughnessMap: tailMaps.roughnessMap, vertexColors: true, roughness: 1, metalness: 0 });
  const bodyMat = new THREE.MeshStandardMaterial({ map: bodyMaps.map, normalMap: bodyMaps.normalMap, normalScale: NS(0.7), roughnessMap: bodyMaps.roughnessMap, vertexColors: true, roughness: 1, metalness: 0 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: COL.eye, roughness: 0.12, metalness: 0.0 });
  const leatherMat = new THREE.MeshStandardMaterial({ map: saddleMaps.map, normalMap: saddleMaps.normalMap, normalScale: NS(0.8), roughnessMap: saddleMaps.roughnessMap, roughness: 1, metalness: 0 });
  const darkLeatherMat = new THREE.MeshStandardMaterial({ map: darkLeatherMaps.map, normalMap: darkLeatherMaps.normalMap, normalScale: NS(0.6), roughnessMap: darkLeatherMaps.roughnessMap, vertexColors: true, roughness: 1, metalness: 0 });
  const metalMat = new THREE.MeshStandardMaterial({ color: COL.metal, roughness: 0.35, metalness: 1 });
  const clothMat = new THREE.MeshStandardMaterial({ normalMap: cloth.normalMap, normalScale: NS(0.8), roughnessMap: cloth.roughnessMap, vertexColors: true, roughness: 1, metalness: 0 });
  const skinMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 });
  for (const m of [saddleMaps.map, saddleMaps.normalMap, saddleMaps.roughnessMap]) m.repeat.set(3, 3);
  for (const m of [darkLeatherMaps.map, darkLeatherMaps.normalMap, darkLeatherMaps.roughnessMap]) m.repeat.set(2, 2);
  for (const m of [cloth.normalMap, cloth.roughnessMap]) m.repeat.set(1.5, 1.5);

  const meshes = [];
  const addMesh = (parent, geo, mat, name, receive = false) => {
    const m = geo.isObject3D ? geo : new THREE.Mesh(geo, mat);
    if (name) m.name = name;
    m.castShadow = true; m.receiveShadow = receive;
    parent.add(m); meshes.push(m);
    return m;
  };

  const profile = makeBodyProfile();

  // ------------------------------ corpo ------------------------------
  const bodyParts = [];
  {
    const body = makeBodyGeometry(profile, segs);
    shadeBody(body);
    bodyParts.push(body);
    // escapulares: 3 penas largas por lado, deitadas sobre a raiz da asa (escondem a junta)
    const fu = 1 / BODY_TILE.perRow / BODY_TILE.repeatU, fv = 2.3 / BODY_TILE.rows / BODY_TILE.repeatV;
    const scap = [[-0.38, 24, 0.6, 0.095, 0.0], [-0.2, 33, 0.56, 0.09, -0.012], [-0.02, 43, 0.5, 0.085, -0.024], [0.16, 55, 0.42, 0.075, -0.036]];
    for (const side of [1, -1]) {
      for (const [z0, deg, len, w, dy] of scap) {
        const g = featherSheet(bladeShape(len, w, w, 12), { thick: WING_THICK * 0.6, camber: 0.015, chord: w, segs: 1, maxEdge: 0.12 });
        const p = g.attributes.position, uv = g.attributes.uv;
        for (let i = 0; i < p.count; i++) {
          const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
          const t = Math.max(0, x / len);
          p.setXYZ(i, x, y - 0.1 * t * t - 0.012 * (z / w) * (z / w), z);
          uv.setXY(i, (0.5 - z / (2 * w) * 0.9) * fu, t * fv);
        }
        g.computeVertexNormals();
        const th = (side > 0 ? deg : 180 - deg) * DEG;
        g.rotateY(-th);
        const top = profile.surface(z0, side * 0.45, 0.01);
        g.translate(side * 0.1, top.y + 0.02 + dy, z0);
        shadeBody(g, false);
        bodyParts.push(g);
      }
      // almofada do ombro (cobre a raiz da chapa quando a asa sobe/desce)
      bodyParts.push(shadeBody(sphere(1, V(side * 0.27, 0.29, -0.1), [0.3, 0.045, 0.55], 16, 10), false));
    }
    // pescoço curto: tubo do peito à cabeça, uv alinhado ao tile do corpo
    const neckCurve = new THREE.CatmullRomCurve3([V(0, 0.16, -0.78), V(0, 0.27, -0.98), V(0, 0.38, -1.16)]);
    const NSg = 10;
    const neck = new THREE.TubeGeometry(neckCurve, NSg, 0.17, segs.sph, false);
    {
      const p = neck.attributes.position, uv = neck.attributes.uv; const n = p.count;
      for (let i = 0; i < n; i++) {
        const ring = Math.floor(i / (segs.sph + 1)), t = ring / NSg, j = i % (segs.sph + 1);
        const s = 1.05 - 0.25 * t;
        const z = p.getZ(i); const y = p.getY(i); const x = p.getX(i);
        const c = neckCurve.getPoint(t, TMP.v1);
        p.setXYZ(i, c.x + (x - c.x) * s, c.y + (y - c.y) * s, c.z + (z - c.z) * s);
        uv.setXY(i, (j / segs.sph) * 0.4, 0.5 + t * 0.2);
      }
      neck.computeVertexNormals();
    }
    shadeBody(neck);
    bodyParts.push(neck);
    // patas recolhidas sob a barriga (rosadas, discretas)
    for (const sx of [-1, 1]) {
      const hip = V(sx * 0.13, -0.42, 0.2), foot = V(sx * 0.15, -0.5, 0.36);
      bodyParts.push(paint(limb(hip, foot, 0.035, 8), COL.feet));
      bodyParts.push(paint(sphere(0.04, foot, [1.2, 0.8, 1.1], 10, 8), COL.feet));
      for (let k = -1; k <= 1; k++) {
        const toe = V(foot.x + k * 0.045 + sx * 0.01, foot.y - 0.02, foot.z + 0.13 - Math.abs(k) * 0.03);
        bodyParts.push(paint(limb(foot, toe, 0.012, 6, 2), COL.feet));
      }
    }
  }
  addMesh(root, mergeAll(bodyParts), bodyMat, 'body', true);

  // ------------------------------ cabeça (grupo que balança) ----------
  const HEAD_C = V(0, 0.43, -1.25);
  const headGroup = new THREE.Group();
  headGroup.position.copy(HEAD_C);
  root.add(headGroup);
  {
    const parts = [];
    const head = makeHeadGeometry(segs);
    shadeBody(head, false);
    parts.push(head);
    const BEAK_Z = -1.46 * HEAD_R;                 // base do bico (ponta da testa)
    // cera: dois montinhos esbranquiçados sobre a base do bico, com narinas
    for (const sx of [-1, 1]) {
      parts.push(paint(sphere(0.026, V(sx * 0.02, 0.012, BEAK_Z - 0.01), [1, 0.75, 1.3], 8, 6), COL.cere));
      parts.push(paint(sphere(0.006, V(sx * 0.02, 0.012, BEAK_Z - 0.04), [1.4, 0.6, 1], 6, 4), 0x303036));
    }
    // bico: tubo afunilado, levemente curvado para baixo na ponta
    const beakCurve = new THREE.CatmullRomCurve3([V(0, -0.012, BEAK_Z + 0.03), V(0, -0.016, BEAK_Z - 0.07), V(0, -0.035, BEAK_Z - 0.165)]);
    const BS = 8;
    const beak = new THREE.TubeGeometry(beakCurve, BS, 0.04, 10, false);
    {
      const p = beak.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const t = Math.floor(i / 11) / BS;
        const s = 1 - 0.78 * t;                                       // afunila
        const c = beakCurve.getPoint(t, TMP.v1);
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        p.setXYZ(i, c.x + (x - c.x) * s * 0.85, c.y + (y - c.y) * s, c.z + (z - c.z) * s);
      }
      beak.computeVertexNormals();
    }
    parts.push(paint(beak, COL.beak));
    parts.push(paint(sphere(0.009, V(0, -0.035, BEAK_Z - 0.165), [0.85, 1, 1], 6, 5), COL.beak));
    // anel do olho (pele clara) e brilho da córnea
    for (const sx of [-1, 1]) {
      const ring = new THREE.TorusGeometry(0.034, 0.0055, 6, 18);
      ring.rotateY(Math.PI / 2); ring.translate(sx * 0.167, 0.045, -0.07);
      parts.push(paint(ring, COL.eyering));
      parts.push(paint(sphere(0.007, V(sx * 0.178, 0.056, -0.082), [1, 1, 1], 6, 4), 0xffffff));
    }
    addMesh(headGroup, mergeAll(parts), bodyMat, 'head', true);
    const eyes = mergeAll([-1, 1].map((sx) => sphere(0.032, V(sx * 0.15, 0.045, -0.07), [0.85, 1, 1], 14, 10)));
    addMesh(headGroup, eyes, eyeMat, 'eyes');
  }

  // ------------------------------ asas (SkinnedMesh, 4 ossos) ----------
  const meanA = fingers.reduce((s, f) => s + f.a, 0) / fingers.length;  // ângulo médio das primárias (espaço da forma)
  const TIP_BONE_R = 0.3;                                                 // distância do leque ao osso da ponta
  const wingGeo = (() => {
    const sheet = skinByX(featherSheet(wingShape(fingers), { camber: 0.045, chord: 0.66, segs: 10, maxEdge: segs.edge }), WRIST_X, FAN_X);
    const parts = [sheet];
    fingers.forEach((f, i) => {
      const g = featherSheet(bladeShape(f.len, f.w * 0.72, f.w * 1.28, 14), { thick: WING_THICK * 0.7, camber: 0.012, chord: f.w * 1.3, segs: 1, maxEdge: segs.blade });
      const p = g.attributes.position, nr = g.attributes.normal;
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
        const t = Math.max(0, x / f.len);
        const tw = -DOVE_MODEL.PRIMARY_TWIST * t * t;                 // torção: bordo de fuga sobe para a ponta
        const c = Math.cos(tw), s = Math.sin(tw);
        p.setXYZ(k, x, y * c - z * s + DOVE_MODEL.PRIMARY_TIP_RISE * t * t, y * s + z * c);
        const ny = nr.getY(k), nz = nr.getZ(k);
        nr.setXYZ(k, nr.getX(k), ny * c - nz * s, ny * s + nz * c);
      }
      g.rotateY(f.a);
      g.translate(FAN_X, -0.012 - (fingers.length - 1 - i) * 0.007, -FAN_Y);   // internas por cima
      const uv = g.attributes.uv, n = p.count;
      const idx = new Uint16Array(n * 4), wgt = new Float32Array(n * 4);
      for (let k = 0; k < n; k++) {
        const xs = p.getX(k), ys = -p.getZ(k);
        uv.setXY(k, xs, ys);
        const s = (xs - FAN_X) * f.dx + (ys - FAN_Y) * f.dy;
        const w3 = 0.9 * THREE.MathUtils.smoothstep(s / f.len, 0.3, 0.95);
        idx[k * 4] = 2; idx[k * 4 + 1] = 3; idx[k * 4 + 2] = 0; idx[k * 4 + 3] = 0;
        wgt[k * 4] = 1 - w3; wgt[k * 4 + 1] = w3; wgt[k * 4 + 2] = 0; wgt[k * 4 + 3] = 0;
      }
      g.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(wgt, 4));
      parts.push(g);
    });
    return mergeAll(parts);
  })();
  const wings = [];
  for (const side of [1, -1]) {
    const shoulder = new THREE.Group();
    shoulder.name = side > 0 ? 'wingR' : 'wingL';
    shoulder.position.set(side * SHOULDER_X, SHOULDER_Y, SHOULDER_Z);
    shoulder.scale.x = side; // asa esquerda espelhada (depois das rotações dos ossos)
    const b0 = new THREE.Bone(), b1 = new THREE.Bone(), b2 = new THREE.Bone(), b3 = new THREE.Bone();
    b1.position.set(WRIST_X, 0, 0); b2.position.set(FAN_X - WRIST_X, 0, -FAN_Y);
    b3.position.set(Math.cos(meanA) * TIP_BONE_R, 0, -Math.sin(meanA) * TIP_BONE_R);
    b3.rotation.set(0, meanA, 0);          // z local perpendicular à direção média das primárias
    b0.add(b1); b1.add(b2); b2.add(b3);
    const mesh = new THREE.SkinnedMesh(wingGeo, featherMat);
    mesh.name = 'wing';
    mesh.frustumCulled = false;
    mesh.add(b0);
    shoulder.add(mesh);
    root.add(shoulder);
    shoulder.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton([b0, b1, b2, b3]));
    mesh.castShadow = true; mesh.receiveShadow = true; meshes.push(mesh);
    wings.push({ side, shoulder, b0, b1, b2, b3 });
  }

  // ------------------------------ cauda: retrizes sobrepostas ---------
  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0.03, BODY_BACK - 0.2);
  {
    const parts = [];
    for (const d of tails) {
      const g = featherSheet(bladeShape(d.len, d.w, d.w, 14), { thick: WING_THICK * 0.7, camber: 0.01, chord: d.w, segs: 1, maxEdge: segs.blade * 1.2 });
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k), t = Math.max(0, x / d.len);
        p.setY(k, p.getY(k) - 0.03 * t * t);                        // ponta cai um pouco
      }
      g.rotateY(d.a);
      g.translate(d.bx, -0.004 * (6 - d.order), -d.by);
      const uv = g.attributes.uv;
      for (let k = 0; k < p.count; k++) uv.setXY(k, p.getX(k), -p.getZ(k));
      g.computeVertexNormals();
      parts.push(g);
    }
    addMesh(tailPivot, mergeAll(parts), tailMat, 'tail', true);
  }
  root.add(tailPivot);

  // ------------------------------ arreios (estáticos) -----------------
  const SADDLE_Z = -0.08;                       // meio do dorso, entre as asas
  const SADDLE_Y = profile.surface(SADDLE_Z, 0).y;  // topo do dorso ali (~0.48)
  const radial = (p, t, out) => out.set(p.x, p.y, 0).normalize();
  let packageAnchor;
  const PELVIS = V(0, SADDLE_Y + 0.1, SADDLE_Z + 0.03);
  // pose do cavaleiro (coordenadas locais do quadril) — usada também para o estribo
  const R = {
    hip: (sx) => V(sx * 0.11, 0.0, 0.0), knee: (sx) => V(sx * 0.42, -0.2, -0.33), ankle: (sx) => V(sx * 0.56, -0.6, -0.2), toe: (sx) => V(sx * 0.57, -0.655, -0.42),
    shoulder: (sx) => V(sx * 0.21, 0.47, -0.09), elbow: (sx) => V(sx * 0.245, 0.2, -0.2), hand: (sx) => V(sx * 0.13, 0.25, -0.4),
  };
  const footBall = (sx) => R.ankle(sx).lerp(R.toe(sx), 0.5).add(PELVIS);
  const leather = [], metal = [];
  {
    // assento côncavo + abas
    leather.push(sphere(1, V(0, SADDLE_Y + 0.02, SADDLE_Z), [0.27, 0.07, 0.36], 24, 12));
    leather.push(sphere(1, V(0, SADDLE_Y + 0.09, SADDLE_Z - 0.3), [0.085, 0.06, 0.06], 14, 10));                  // maçaneta (pommel)
    leather.push(roundedBox(0.36, 0.26, 0.05, 0.018, V(0, SADDLE_Y + 0.17, SADDLE_Z + 0.22), [0.22, 0, 0]));      // patilha (cantle)
    leather.push(limb(V(-0.18, SADDLE_Y + 0.3, SADDLE_Z + 0.25), V(0.18, SADDLE_Y + 0.3, SADDLE_Z + 0.25), 0.03, 10));
    for (const sx of [-1, 1]) {
      leather.push(roundedBox(0.05, 0.14, 0.2, 0.015, V(sx * 0.19, SADDLE_Y + 0.08, SADDLE_Z + 0.14), [0, sx * 0.3, 0]));   // "orelhas" da patilha
      leather.push(roundedBox(0.025, 0.3, 0.4, 0.01, V(sx * 0.4, SADDLE_Y - 0.17, SADDLE_Z - 0.04), [0, 0, sx * 0.34]));   // aba lateral (skirt)
      // loro do estribo: tira chata até o olhal do estribo
      const ball = footBall(sx);
      const eye = V(ball.x, ball.y + 0.105, ball.z);
      const bar = V(sx * 0.3, SADDLE_Y - 0.02, SADDLE_Z - 0.12);
      leather.push(ribbon([bar, bar.clone().lerp(eye, 0.5), eye], (p, t, o) => o.set(sx, 0, 0), 0.02, 0.005, { segs: 8 }));
      metal.push(buckle(bar.clone().lerp(eye, 0.3), 0.05, 0.035, 0.006, [0, sx * Math.PI / 2, Math.atan2(eye.y - bar.y, sx * (eye.x - bar.x)) + Math.PI / 2]));
      // estribo: arco de metal + piso + olhal
      const arch = new THREE.TorusGeometry(0.075, 0.011, 8, 18, Math.PI);
      arch.scale(1, 1.15, 1); arch.translate(ball.x, ball.y + 0.012, ball.z);
      metal.push(arch);
      metal.push(roundedBox(0.16, 0.014, 0.055, 0.005, V(ball.x, ball.y, ball.z)));
      const eyeRing = new THREE.TorusGeometry(0.016, 0.006, 6, 12); eyeRing.translate(ball.x, ball.y + 0.108, ball.z);
      metal.push(eyeRing);
    }
    // cilha: tira chata que abraça a seção do corpo, com fivela no flanco
    const girthPts = [];
    for (let k = 0; k < 40; k++) girthPts.push(profile.surface(SADDLE_Z, (k / 40) * Math.PI * 2, 0.012));
    leather.push(ribbon(girthPts, radial, 0.036, 0.0065, { closed: true, segs: 72 }));
    {
      const bp = profile.surface(SADDLE_Z, Math.PI * 0.6, 0.026);
      metal.push(buckle(bp, 0.05, 0.08, 0.006, [0, 0, -Math.PI * 0.6 + Math.PI / 2]));
    }
    // peitoral: duas tiras dos ombros à argola sob o peito + tira do peito + tira ao pescoço
    const RING = profile.surface(-0.58, Math.PI, 0.02);
    for (const sx of [-1, 1]) {
      const pts = [
        profile.surface(SADDLE_Z - 0.12, sx * 0.55, 0.012), profile.surface(-0.48, sx * 1.15, 0.012),
        profile.surface(-0.58, sx * 1.85, 0.012), profile.surface(-0.62, sx * 2.5, 0.012), RING,
      ];
      leather.push(ribbon(pts, radial, 0.022, 0.005, { segs: 28 }));
      metal.push(buckle(profile.surface(-0.5, sx * 1.3, 0.025), 0.04, 0.05, 0.005, [0, 0, -sx * 1.3]));
    }
    leather.push(ribbon([RING, profile.surface(-0.45, Math.PI, 0.012), profile.surface(SADDLE_Z, Math.PI, 0.012)], radial, 0.018, 0.005, { segs: 14 }));
    leather.push(ribbon([RING, profile.surface(-0.76, Math.PI * 0.95, 0.012), profile.surface(-0.9, Math.PI * 0.75, 0.012), V(0, 0.02, -0.97)], radial, 0.018, 0.005, { segs: 16 }));
    // argola de metal da encomenda (plano YZ: a corda passa por ela) + placa
    const ring = new THREE.TorusGeometry(0.06, 0.011, 8, 20);
    ring.rotateY(Math.PI / 2);
    ring.translate(RING.x, RING.y - 0.04, RING.z);
    metal.push(ring);
    metal.push(roundedBox(0.07, 0.035, 0.035, 0.008, V(RING.x, RING.y + 0.005, RING.z)));

    addMesh(root, mergeAll(leather), leatherMat, 'tack');
    addMesh(root, mergeAll(metal), metalMat, 'tackMetal');

    packageAnchor = new THREE.Object3D();
    packageAnchor.name = 'packageAnchor';
    packageAnchor.position.set(RING.x, RING.y - 0.08, RING.z);
    group.add(packageAnchor);
  }

  // ------------------------------ bridão (na cabeça) ------------------
  const bitRings = [];
  {
    const hl = [], hm = [];
    const headOut = (p, t, o) => o.set(p.x / 0.9, p.y, p.z * 0.6).normalize();
    const ringPts = (z, r, tilt = 0, n = 28) => {
      const pts = [];
      for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; pts.push(V(Math.sin(a) * r * 0.9, Math.cos(a) * r, z + Math.cos(a) * tilt)); }
      return pts;
    };
    hl.push(ribbon(ringPts(-0.1, HEAD_R * 0.86), headOut, 0.014, 0.004, { closed: true, segs: 40 }));          // focinheira
    hl.push(ribbon(ringPts(0.05, HEAD_R * 0.98, 0.07), headOut, 0.014, 0.004, { closed: true, segs: 40 }));    // testeira/coroa
    for (const sx of [-1, 1]) {
      hl.push(ribbon([V(sx * 0.17, 0.0, 0.06), V(sx * 0.172, -0.03, -0.03), V(sx * 0.158, -0.05, -0.1)], headOut, 0.011, 0.004, { segs: 8 }));
      const r = new THREE.TorusGeometry(0.03, 0.007, 6, 14);
      r.rotateY(Math.PI / 2); r.translate(sx * 0.178, -0.048, -0.1);
      hm.push(r);
      hm.push(buckle(V(sx * 0.172, -0.005, 0.02), 0.022, 0.03, 0.004, [0, sx * Math.PI / 2, 0]));
      bitRings.push(V(sx * 0.198, -0.048, -0.1)); // local do headGroup
    }
    addMesh(headGroup, mergeAll(hl), leatherMat, 'bridle');
    addMesh(headGroup, mergeAll(hm), metalMat, 'bridleMetal');
  }

  // ------------------------------ cavaleiro ---------------------------
  // Proporções (altura 1,75 m): cabeça = altura/7,5; peso na sela (quadril
  // baixo), costas levemente curvadas à frente, joelhos dobrados nos estribos.
  const C = { jacket: COL.jacket, trousers: COL.trousers, boots: COL.boots, skin: COL.skin, hair: COL.hair, pack: COL.pack, scarf: COL.scarf, glove: COL.glove, belt: COL.leatherDark };
  const riderLegs = new THREE.Group(); riderLegs.position.copy(PELVIS); root.add(riderLegs);
  const riderUpper = new THREE.Group(); riderUpper.position.copy(PELVIS); root.add(riderUpper);
  const riderHead = new THREE.Group(); riderHead.position.set(0, 0.56, -0.1); riderUpper.add(riderHead);
  const hands = [];
  {
    // --- pernas (fixas na sela) ---
    const cl = [], lt = [];
    cl.push(paint(sphere(1, V(0, 0.05, 0.0), [0.17, 0.1, 0.13], 14, 10), C.trousers));                      // quadril/nádegas
    for (const sx of [-1, 1]) {
      const hip = R.hip(sx), knee = R.knee(sx), ankle = R.ankle(sx), toe = R.toe(sx);
      cl.push(paint(limb(hip, knee, 0.078, 10), C.trousers));
      cl.push(paint(sphere(0.07, knee, [1, 1, 1], 10, 8), C.trousers));
      cl.push(paint(limb(knee, knee.clone().lerp(ankle, 0.55), 0.06, 10), C.trousers));
      const shinDir = ankle.clone().sub(knee).normalize();
      lt.push(paint(limb(knee.clone().lerp(ankle, 0.45), ankle, 0.062, 10), C.boots));                     // cano da bota
      lt.push(paint(limb(ankle.clone().addScaledVector(shinDir, -0.02), toe, 0.05, 10), C.boots));           // pé
      lt.push(paint(sphere(0.045, toe, [1.1, 0.7, 1.2], 8, 6), C.boots));                                   // biqueira
      lt.push(paint(sphere(0.052, ankle, [1, 0.9, 1.1], 8, 6), C.boots, 0.85));                             // calcanhar
    }
    addMesh(riderLegs, mergeAll(cl), clothMat, 'riderLegs');
    addMesh(riderLegs, mergeAll(lt), darkLeatherMat, 'riderBoots');

    // --- tronco inclinado à frente, braços, mochila (inclinam juntos) ---
    const ug = [], ul = [];
    ug.push(paint(sphere(1, V(0, 0.18, -0.01), [0.155, 0.15, 0.115], 14, 10), C.jacket));                    // barriga
    const chest = sphere(1, V(0, 0, 0), [0.17, 0.21, 0.12], 18, 12); chest.rotateX(-0.16); chest.translate(0, 0.33, -0.05);
    ug.push(paint(chest, C.jacket));
    ug.push(paint(limb(V(-0.19, 0.49, -0.1), V(0.19, 0.49, -0.1), 0.07, 10), C.jacket));                    // ombros
    const collar = new THREE.TorusGeometry(0.068, 0.022, 8, 16); collar.rotateX(Math.PI / 2 - 0.25); collar.translate(0, 0.585, -0.1);
    ug.push(paint(collar, C.jacket, 0.85));
    const scarf = new THREE.TorusGeometry(0.08, 0.03, 8, 16); scarf.rotateX(Math.PI / 2 - 0.3); scarf.translate(0, 0.55, -0.105);
    ug.push(paint(scarf, C.scarf));
    ug.push(paint(limb(V(0.04, 0.52, -0.17), V(0.1, 0.36, -0.17), 0.028, 8, 2), C.scarf));                    // ponta do cachecol caída
    for (const sx of [-1, 1]) {
      const sh = R.shoulder(sx), el = R.elbow(sx), hd = R.hand(sx);
      ug.push(paint(limb(sh, el, 0.052, 10), C.jacket));
      ug.push(paint(sphere(0.05, el, [1, 1, 1], 8, 6), C.jacket));
      ug.push(paint(limb(el, hd.clone().lerp(el, 0.18), 0.044, 10), C.jacket));
      ul.push(paint(sphere(0.049, hd.clone().lerp(el, 0.2), [1, 1, 1], 8, 6), C.glove));                      // punho da luva
      const fist = sphere(1, V(0, 0, 0), [0.042, 0.038, 0.058], 10, 8);
      fist.rotateX(0.5); fist.translate(hd.x, hd.y, hd.z);
      ul.push(paint(fist, C.glove));
      ul.push(paint(limb(hd.clone().add(V(-sx * 0.02, 0.02, -0.01)), hd.clone().add(V(-sx * 0.045, 0.035, 0.015)), 0.012, 6, 2), C.glove)); // polegar
      hands.push(hd.clone());
      // alças da mochila
      ul.push(paint(limb(V(sx * 0.12, 0.5, 0.08), V(sx * 0.13, 0.33, -0.15), 0.014, 6, 2), C.belt));
    }
    const belt = new THREE.TorusGeometry(0.175, 0.018, 6, 20); belt.rotateX(Math.PI / 2); belt.scale(1, 1, 0.8); belt.translate(0, 0.1, -0.01);
    ul.push(paint(belt, C.belt));
    ul.push(paint(roundedBox(0.05, 0.035, 0.012, 0.004, V(0, 0.1, -0.15)), C.belt, 1.6));                     // fivela do cinto (couro claro)
    ug.push(paint(roundedBox(0.3, 0.3, 0.14, 0.04, V(0, 0.35, 0.15), [0.12, 0, 0]), C.pack));                   // mochila
    ug.push(paint(limb(V(-0.13, 0.52, 0.16), V(0.13, 0.52, 0.16), 0.042, 10), C.pack, 0.9));                  // rolo em cima
    addMesh(riderUpper, mergeAll(ug), clothMat, 'riderUpper');
    addMesh(riderUpper, mergeAll(ul), darkLeatherMat, 'riderGloves');

    // --- cabeça (grupo próprio: compensa a inclinação, olha para a curva) ---
    const hg = [];
    hg.push(paint(limb(V(0, -0.05, 0.0), V(0, 0.05, -0.02), 0.045, 10), C.skin));                            // pescoço
    hg.push(paint(sphere(1, V(0, 0.17, -0.03), [0.086, 0.116, 0.1], 18, 14), C.skin));                        // crânio/rosto
    for (const sx of [-1, 1]) hg.push(paint(sphere(0.02, V(sx * 0.086, 0.16, -0.02), [0.6, 1, 1], 6, 5), C.skin));   // orelhas
    hg.push(paint(sphere(0.016, V(0, 0.14, -0.13), [0.8, 1, 1], 6, 5), C.skin));                              // nariz
    const hair = new THREE.SphereGeometry(0.1, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.64);
    hair.rotateX(0.3); hair.scale(0.95, 1.1, 1.05); hair.translate(0, 0.19, -0.02);
    hg.push(paint(hair, C.hair));
    hg.push(paint(sphere(0.075, V(0, 0.15, 0.03), [1, 1.05, 1], 10, 8), C.hair));                            // volume da nuca
    hg.push(paint(sphere(0.045, V(0, 0.13, 0.085), [0.9, 1.3, 0.8], 8, 6), C.hair));                         // rabo-de-cavalo curto
    addMesh(riderHead, mergeAll(hg), skinMat, 'riderHead');
  }

  // ------------------------------ rédeas (dinâmicas) ------------------
  const ropes = createRopes(2, 22, 6, 0.011);
  const reinMesh = new THREE.Mesh(ropes.geometry, darkLeatherMat);
  reinMesh.frustumCulled = false;
  reinMesh.name = 'reins';
  reinMesh.castShadow = true;
  paint(ropes.geometry, COL.leatherDark);
  root.add(reinMesh);
  const reinCtrl = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

  // ------------------------------ estado da animação ------------------
  const GLIDE_CYCLE = DOVE_MODEL.GLIDE_PERIOD, FLAP_WINDOW = DOVE_MODEL.FLAP_WINDOW;
  const st = {
    time: rng() * 10, phase: rng() * Math.PI * 2, freq: DOVE_MODEL.FLAP_HZ_CRUISE, flapW: 1, boostW: 0, prevSpeed: DOVE.SPEED_CRUISE,
    tailSpread: 1, tailX: 0, tailY: 0, tailZ: 0, riderX: 0, riderZ: 0, riderHeadZ: 0, riderHeadY: 0, headY: 0, sweep: 0, dive: 0, slow: 0, bob: 0,
  };
  const lerpTo = (cur, target, dt, rate) => cur + (target - cur) * Math.min(1, dt * rate);
  // batida: descida mais rápida que a subida (+ = asa para cima)
  const wave = (p) => Math.sin(p + 0.35 * Math.sin(p));

  function update(dt, fs) {
    dt = Math.min(Math.max(dt || 0, 0), 0.05);
    st.time += dt;
    const boost = !!(fs && fs.boost);
    const climb = THREE.MathUtils.clamp((fs && fs.climbInput) || 0, -1, 1);
    const turn = THREE.MathUtils.clamp((fs && fs.turnInput) || 0, -1, 1);
    const roll = (fs && fs.roll) || 0;
    const speed = fs && typeof fs.speed === 'number' ? fs.speed : DOVE.SPEED_CRUISE;
    const speed01 = THREE.MathUtils.clamp((speed - DOVE.SPEED_MIN) / (DOVE.SPEED_BOOST - DOVE.SPEED_MIN), 0, 1);
    const accel = dt > 0 ? (speed - st.prevSpeed) / dt : 0;
    st.prevSpeed = speed;
    const steady = Math.abs(accel) < 6;

    // ---- regime: planar (maior parte do cruzeiro) ou bater (boost/subida/lento) ----
    let targetFreq, targetFlap;
    if (boost) { targetFreq = DOVE_MODEL.FLAP_HZ_BOOST; targetFlap = 1; }
    else if (climb > 0.3) { targetFreq = (DOVE_MODEL.FLAP_HZ_BOOST + DOVE_MODEL.FLAP_HZ_CRUISE) / 2; targetFlap = 1; }
    else if (climb < -0.3) { targetFreq = DOVE_MODEL.FLAP_HZ_CRUISE; targetFlap = 0; }          // mergulho: planar
    else {
      const slow = speed < DOVE.SPEED_MIN + 8;
      targetFreq = slow ? DOVE_MODEL.FLAP_HZ_CRUISE * 1.3 : DOVE_MODEL.FLAP_HZ_CRUISE;
      const c = st.time % GLIDE_CYCLE;
      targetFlap = slow || !steady || c < FLAP_WINDOW ? 1 : 0;                                      // algumas batidas lentas, depois planar
    }
    st.freq = lerpTo(st.freq, targetFreq, dt, 3);
    st.flapW = lerpTo(st.flapW, targetFlap, dt, 2.2);
    st.boostW = lerpTo(st.boostW, boost ? 1 : climb > 0.3 ? 0.5 : 0, dt, 3);
    st.dive = lerpTo(st.dive, Math.max(0, -climb), dt, 3);
    st.slow = lerpTo(st.slow, 1 - speed01, dt, 2);
    st.phase += Math.PI * 2 * st.freq * dt;
    const ph = st.phase, t = st.time, fw = st.flapW;

    // ---- planar: V raso no braço, mão caída e recuada (gaivota), pontas levemente erguidas ----
    const rip1 = 0.02 * Math.sin(t * 4.6) + 0.012 * Math.sin(t * 9.7 + 1.3);
    const rip2 = 0.025 * Math.sin(t * 4.6 - 0.9) + 0.015 * Math.sin(t * 11.1);
    const rip3 = 0.03 * Math.sin(t * 4.6 - 1.7) + 0.02 * Math.sin(t * 12.3 + 0.4);
    const rip4 = 0.035 * Math.sin(t * 4.6 - 2.4) + 0.025 * Math.sin(t * 13.1 + 0.9);
    const gl0z = DOVE_MODEL.GLIDE_DIHEDRAL + 0.08 * st.slow + rip1;
    const gl1z = -DOVE_MODEL.GLIDE_WRIST_DROOP + rip2;
    const gl2z = 0.14 + rip3;
    const gl3z = 0.12 + 0.08 * st.slow + rip4;                         // pontas das primárias viradas para cima (fendas de ponta)
    const glSweep = DOVE_MODEL.GLIDE_SWEEP + 0.18 * st.boostW + 0.25 * st.dive - 0.06 * st.slow;
    const gl1x = -0.04, gl2x = -0.03, gl3x = 0.03 * Math.sin(t * 3.1);

    // ---- bater: lento e fundo em cruzeiro, forte no boost; a mão atrasa, as pontas atrasam mais ----
    const amp = DOVE_MODEL.FLAP_AMP + 0.14 * st.boostW;
    const k = amp / DOVE_MODEL.FLAP_AMP;
    const fl0z = amp * wave(ph) + 0.04;
    const fl1z = 0.42 * k * wave(ph - 0.6) - 0.05;
    const fl2z = 0.3 * k * wave(ph - 1.15);
    const fl3z = DOVE_MODEL.TIP_LAG * k * wave(ph - 1.8) + 0.04;       // atraso das pontas das penas
    const up = Math.cos(ph - 0.9);                                     // > 0 durante a subida
    const fl1x = 0.18 * Math.cos(ph - 0.6);                            // bordo de ataque desce na batida para baixo
    const fl2x = 0.12 * Math.cos(ph - 1.0) + 0.1 * Math.max(0, up);
    const fl3x = DOVE_MODEL.TIP_SUPINATION * Math.max(0, up) - 0.08 * Math.max(0, -up); // supinação na subida (primárias "abrem" o ar)
    const flSweep = 0.08 + 0.14 * Math.max(0, Math.cos(ph - 0.3)) + 0.12 * st.boostW; // mão recua na subida

    const b0z = fw * fl0z + (1 - fw) * gl0z;
    const b1z = fw * fl1z + (1 - fw) * gl1z;
    const b2z = fw * fl2z + (1 - fw) * gl2z;
    const b3z = fw * fl3z + (1 - fw) * gl3z;
    const b1x = fw * fl1x + (1 - fw) * gl1x;
    const b2x = fw * fl2x + (1 - fw) * gl2x;
    const b3x = fw * fl3x + (1 - fw) * gl3x;
    st.sweep = lerpTo(st.sweep, fw * flSweep + (1 - fw) * glSweep, dt, 6);
    for (const w of wings) {
      // os ossos giram no referencial da asa direita; a esquerda é espelhada pelo grupo (scale.x = -1)
      w.b0.rotation.set(0, -0.04, b0z);
      w.b1.rotation.set(b1x, -st.sweep, b1z);
      w.b2.rotation.set(b2x, -0.05 - 0.08 * st.dive, b2z);
      w.b3.rotation.set(b3x, meanA, b3z);
    }

    // ---- balanço do corpo: sobe um pouco na batida para baixo ----
    st.bob = lerpTo(st.bob, -DOVE_MODEL.BODY_BOB * fw * wave(ph - 0.45), dt, 12);
    root.position.y = st.bob;

    // ---- cauda: abre nas curvas / lentidão / subida; torce com a curva; levemente para baixo ----
    const spread = THREE.MathUtils.clamp(1 + 0.3 * Math.abs(turn) + 0.22 * st.slow + 0.15 * Math.max(0, climb) + 0.06 * fw, 0.85, 1.6);
    st.tailSpread = lerpTo(st.tailSpread, spread, dt, 4);
    st.tailX = lerpTo(st.tailX, 0.1 + 0.16 * climb + 0.04 * fw * Math.sin(ph - 1.2), dt, 5);
    st.tailZ = lerpTo(st.tailZ, roll * 0.4 + turn * 0.15, dt, 4);
    st.tailY = lerpTo(st.tailY, -turn * 0.18, dt, 4);
    tailPivot.scale.set(st.tailSpread, 1, 1 - 0.15 * (st.tailSpread - 1));
    tailPivot.rotation.set(st.tailX, st.tailY, st.tailZ);

    // ---- cabeça: balanço sutil, olha para a curva ----
    st.headY = lerpTo(st.headY, turn * 0.22, dt, 4);
    headGroup.rotation.set(0.05 * fw * Math.sin(ph - 0.6) - 0.06 * st.boostW, st.headY, 0);
    headGroup.position.y = HEAD_C.y + 0.015 * fw * Math.sin(ph - 0.6);

    // ---- cavaleiro: contrabalança a inclinação (fica mais vertical que a pomba),
    //      agacha no boost, cabeça nivelada e olhando para a curva ----
    st.riderZ = lerpTo(st.riderZ, -roll * 0.22 + turn * 0.1, dt, 3);
    st.riderX = lerpTo(st.riderX, -0.3 * st.boostW - 0.05 * Math.max(0, climb), dt, 3);
    riderUpper.rotation.set(st.riderX - 0.02 * fw * Math.sin(ph - 0.3), 0, st.riderZ);
    st.riderHeadZ = lerpTo(st.riderHeadZ, THREE.MathUtils.clamp(-roll * 0.3, -0.35, 0.35), dt, 3);
    st.riderHeadY = lerpTo(st.riderHeadY, turn * 0.35, dt, 3);
    riderHead.rotation.set(0.08 * st.boostW, st.riderHeadY, st.riderHeadZ);
    riderUpper.updateMatrix();
    headGroup.updateMatrix();

    // ---- rédeas: das mãos até as argolas do bridão, com barriga ----
    const sag = 0.07 + 0.09 * (1 - st.boostW) + 0.02 * Math.sin(ph);
    for (let i = 0; i < 2; i++) {
      const sx = i === 0 ? -1 : 1;
      const h = TMP.v1.copy(hands[i]).applyMatrix4(riderUpper.matrix);
      const b = TMP.v2.copy(bitRings[i]).applyMatrix4(headGroup.matrix);
      reinCtrl[0].copy(h);
      reinCtrl[1].lerpVectors(h, b, 0.35).add(TMP.v3.set(sx * 0.09, -sag * 0.9, 0));
      reinCtrl[2].lerpVectors(h, b, 0.72).add(TMP.v3.set(sx * 0.08, -sag * 0.6, 0));
      reinCtrl[3].copy(b);
      ropes.update(i, reinCtrl);
    }
  }

  // pose inicial coerente
  update(1 / 60, { speed: DOVE.SPEED_CRUISE, boost: false, climbInput: 0, turnInput: 0, roll: 0 });

  return { group, packageAnchor, update, debug: st };
}
