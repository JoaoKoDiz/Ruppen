// =====================================================================
//  RUPPEN — pomba do jogador: modelo procedural com arreios e cavaleiro.
//
//  Visual alinhado às referências: corpo branco liso em gota, cabeça pequena
//  num pescoço curto, asas LONGAS e RECUADAS em gaivota (braço um pouco à
//  frente/erguido, mão recuada com quebra visível no punho, bordo de fuga
//  côncavo) terminando em 7 primárias longas e separadas com o terço externo
//  escuro; cauda curta em leque arredondado; cavaleiro sentado no MEIO do
//  dorso numa sela de couro com patilha alta, segurando as rédeas.
//
//  Cada asa é UMA chapa de penas "esfolada" (SkinnedMesh) com três ossos:
//  ombro -> punho -> leque das primárias. Isso dá a dobra contínua no punho,
//  o atraso das pontas na batida e custa 1 draw call por asa.
//
//  Contrato (ARCHITECTURE.md 4.5):
//    createDove({ quality }) -> { group, packageAnchor, update(dt, flightState) }
//  Convenção local: frente = -Z, cima = +Y, direita = +X. Centro do corpo na
//  origem do grupo. O integrador posiciona o grupo (position/quaternion); aqui
//  nunca mexemos nisso.
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

const TMP = {
  v1: new THREE.Vector3(), v2: new THREE.Vector3(), v3: new THREE.Vector3(), v4: new THREE.Vector3(),
  q: new THREE.Quaternion(), m: new THREE.Matrix4(), c: new THREE.Color(),
};
const UP = new THREE.Vector3(0, 1, 0);

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
function paint(g, hex) {
  const n = g.attributes.position.count;
  const c = new THREE.Color(hex);
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

// Cor por vértice dependendo da normal: topo quente, barriga azulada.
function shadeByNormal(g, topHex = COL.featherTop, underHex = COL.featherUnder) {
  const n = g.attributes.position.count;
  const nor = g.attributes.normal;
  const top = new THREE.Color(topHex), under = new THREE.Color(underHex);
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const w = THREE.MathUtils.smoothstep(nor.getY(i), -0.7, 0.6);
    TMP.c.copy(under).lerp(top, w);
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

// Tubo fino ao longo de pontos (tiras de couro que abraçam o corpo).
function strap(points, r = 0.018, closed = false, segs = 0, radial = 6) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p.x, p.y, p.z)), closed, 'centripetal');
  return new THREE.TubeGeometry(curve, segs || Math.max(6, points.length * 5), r, radial, closed);
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
    // normal para fora: à direita de a->b no plano da forma (y para a frente)
    const dx = bx - ax, dz = bz - az;
    TMP.v2.set(-dz, 0, dx).normalize();  // (dy, 0, dx) com y = -z
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
//  Texturas procedurais (canvas 2D). "bounds" define o espaço da forma
//  (coordenadas em metros) para que uv = coordenada da forma.
// ----------------------------------------------------------------------
function shapeTexture(W, H, bounds, draw) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const { xmin, xmax, ymin, ymax } = bounds;
  const sx = W / (xmax - xmin), sy = H / (ymax - ymin);
  const px = (x) => (x - xmin) * sx, py = (y) => (ymax - y) * sy;
  draw(ctx, px, py, sx, sy);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  tex.repeat.set(1 / (xmax - xmin), 1 / (ymax - ymin));
  tex.offset.set(-xmin / (xmax - xmin), -ymin / (ymax - ymin));
  return tex;
}

// Textura do corpo: branco quase liso (ruído de penas muito leve).
function bodyTexture() {
  const S = 128;
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const noise = createNoise(SEED + 7331);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const streak = noise.noise2(u * 5, v * 40) * 0.5 + noise.noise2(u * 9 + 3, v * 80) * 0.25;
      const d = 1 - 0.014 * Math.max(0, streak);
      const i = (y * S + x) * 4;
      img.data[i] = 255 * d; img.data[i + 1] = 255 * (d - 0.003); img.data[i + 2] = 255 * (d - 0.008); img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2);
  return tex;
}

// ----------------------------------------------------------------------
//  Planta da asa. Espaço da forma: x = para fora (ombro em 0), y = +frente.
//  Braço: bordo de ataque levemente à frente até o punho; mão recuada
//  (sweep) até o leque de 7 primárias longas e separadas; bordo de fuga
//  côncavo entre as secundárias bojudas e as primárias.
// ----------------------------------------------------------------------
function fingerDefs() {
  const n = DOVE_MODEL.PRIMARIES;
  const a0 = -8, step = -16.5;                                  // graus (0 = para fora, negativo = para trás)
  const lensRel = [1.0, 1.0, 0.96, 0.88, 0.78, 0.67, 0.56, 0.48];
  const halfW = [0.052, 0.054, 0.054, 0.053, 0.051, 0.048, 0.044, 0.04];
  const defs = [];
  for (let i = 0; i < n; i++) {
    const a = THREE.MathUtils.degToRad(a0 + step * i);
    const len = FINGER_LEN_MAX * lensRel[Math.min(i, lensRel.length - 1)];
    const w = halfW[Math.min(i, halfW.length - 1)];
    const dx = Math.cos(a), dy = Math.sin(a), px = -dy, py = dx;  // px,py = perpendicular (lado do dedo anterior)
    const tip = { x: FAN_X + dx * len, y: FAN_Y + dy * len };
    defs.push({
      a, len, w, dx, dy, tip,
      tipA: { x: tip.x + px * w, y: tip.y + py * w },
      tipB: { x: tip.x - px * w, y: tip.y - py * w },
      ctrl: { x: tip.x + dx * w * 1.3, y: tip.y + dy * w * 1.3 },
    });
  }
  for (let i = 0; i < n - 1; i++) {
    const am = (defs[i].a + defs[i + 1].a) / 2, r = 0.5 * Math.min(defs[i].len, defs[i + 1].len);
    defs[i].notch = { x: FAN_X + Math.cos(am) * r, y: FAN_Y + Math.sin(am) * r };
  }
  return defs;
}

function wingShape(fingers) {
  const s = new THREE.Shape();
  const f0 = fingers[0];
  s.moveTo(ROOT_X, 0.55);
  s.quadraticCurveTo(0.45, 0.66, WRIST_X, 0.6);                       // braço: bordo de ataque um pouco à frente
  s.quadraticCurveTo(WRIST_X + 0.62, 0.46, f0.tipA.x, f0.tipA.y);     // mão: recuo (sweep) até a 1ª primária
  for (let i = 0; i < fingers.length; i++) {
    const f = fingers[i];
    if (i > 0) s.lineTo(f.tipA.x, f.tipA.y);
    s.quadraticCurveTo(f.ctrl.x, f.ctrl.y, f.tipB.x, f.tipB.y);       // ponta arredondada
    if (f.notch) s.lineTo(f.notch.x, f.notch.y);                      // entalhe fundo entre dedos
  }
  s.quadraticCurveTo(1.06, -0.36, 0.8, -0.44);                        // "axila": bordo de fuga côncavo
  s.quadraticCurveTo(0.42, -0.8, ROOT_X, -0.66);                      // secundárias bojudas junto ao corpo
  s.closePath();
  return s;
}

function tailShape() {
  const s = new THREE.Shape();
  const half = 0.5, L = TAIL_LEN, y0 = -0.4, ry = L + y0;
  s.moveTo(-0.14, 0.12);
  s.lineTo(-half, y0);
  const n = 12;
  for (let k = 1; k <= n; k++) {
    const th = Math.PI * (1 - k / n);
    const x = half * Math.cos(th), y = y0 - ry * Math.sin(th);
    const scallop = k % 2 === 1 ? 0.02 : 0;
    s.lineTo(x, y + scallop);
  }
  s.lineTo(0.14, 0.12);
  s.closePath();
  return s;
}

function wingTexture(fingers) {
  const bounds = { xmin: ROOT_X - 0.1, xmax: HALF_SPAN - SHOULDER_X + 0.15, ymin: -0.95, ymax: 0.8 };
  return shapeTexture(1024, 640, bounds, (ctx, px, py, sx) => {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.fillStyle = '#fbfaf6'; ctx.fillRect(0, 0, W, H);
    // sombra muito suave em direção ao bordo de fuga das secundárias
    const g1 = ctx.createLinearGradient(0, py(0.1), 0, py(-0.85));
    g1.addColorStop(0, 'rgba(196,204,216,0)'); g1.addColorStop(1, 'rgba(196,204,216,0.35)');
    ctx.fillStyle = g1; ctx.fillRect(0, py(0.1), px(WRIST_X + 0.3), H);
    // raques das secundárias: bem leves
    ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(160,170,186,0.16)';
    for (let k = 0; k < 10; k++) {
      const t = k / 9;
      ctx.beginPath(); ctx.moveTo(px(0.05 + t * 0.3), py(0.25)); ctx.lineTo(px(0.0 + t * (WRIST_X - 0.1)), py(-0.75 + t * 0.3)); ctx.stroke();
    }
    // primárias: raque leve + ponta escura (terço externo), como nas referências
    const dark = new THREE.Color(COL.primaries);
    const dr = Math.round(dark.r * 255), dg = Math.round(dark.g * 255), db = Math.round(dark.b * 255);
    const frac = DOVE_MODEL.PRIMARY_DARK_FRACTION;
    ctx.lineCap = 'round';
    fingers.forEach((f, i) => {
      ctx.strokeStyle = 'rgba(130,138,150,0.35)'; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(px(FAN_X + f.dx * 0.1), py(FAN_Y + f.dy * 0.1)); ctx.lineTo(px(f.tip.x), py(f.tip.y)); ctx.stroke();
      const x1 = FAN_X + f.dx * f.len * (1 - frac - 0.12), y1 = FAN_Y + f.dy * f.len * (1 - frac - 0.12);
      const x2 = FAN_X + f.dx * f.len * (1 - frac), y2 = FAN_Y + f.dy * f.len * (1 - frac);
      const strength = i < 5 ? 0.97 : 0.75;      // as internas escurecem um pouco menos
      const grad = ctx.createLinearGradient(px(x1), py(y1), px(x2 + f.dx * 0.12), py(y2 + f.dy * 0.12));
      grad.addColorStop(0, `rgba(${dr},${dg},${db},0)`);
      grad.addColorStop(1, `rgba(${dr},${dg},${db},${strength})`);
      ctx.strokeStyle = grad; ctx.lineWidth = (2 * f.w + 0.02) * sx;
      ctx.beginPath(); ctx.moveTo(px(x1), py(y1)); ctx.lineTo(px(f.tip.x + f.dx * 0.12), py(f.tip.y + f.dy * 0.12)); ctx.stroke();
    });
  });
}

function tailTexture() {
  const bounds = { xmin: -0.6, xmax: 0.6, ymin: -TAIL_LEN - 0.1, ymax: 0.15 };
  return shapeTexture(512, 384, bounds, (ctx, px, py) => {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.fillStyle = '#fbfaf6'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(160,170,186,0.22)'; ctx.lineWidth = 1.6;
    for (let k = 0; k <= 10; k++) {
      const t = k / 10, th = Math.PI * (1 - t);
      const x = 0.5 * Math.cos(th), y = -0.4 - (TAIL_LEN - 0.4) * Math.sin(th);
      ctx.beginPath(); ctx.moveTo(px(0), py(0.05)); ctx.lineTo(px(x), py(y)); ctx.stroke();
    }
    const g2 = ctx.createLinearGradient(0, py(-TAIL_LEN + 0.25), 0, py(-TAIL_LEN - 0.05));
    g2.addColorStop(0, 'rgba(150,160,176,0)'); g2.addColorStop(1, 'rgba(150,160,176,0.3)');
    ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);
  });
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

function makeBodyGeometry(profile, segs) {
  const lathePts = profile.pts.map((p) => new THREE.Vector2(p.y, p.x));
  const step = Math.max(1, Math.round(lathePts.length / segs.body));
  const sub = lathePts.filter((_, i) => i % step === 0);
  if (sub[sub.length - 1] !== lathePts[lathePts.length - 1]) sub.push(lathePts[lathePts.length - 1]);
  const g = new THREE.LatheGeometry(sub, segs.around);
  g.rotateX(Math.PI / 2); // eixo do perfil vira o eixo Z (frente em -Z)
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    TMP.v1.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    profile.deform(TMP.v1);
    pos.setXYZ(i, TMP.v1.x, TMP.v1.y, TMP.v1.z);
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
        uvs[vi * 2] = i / segs; uvs[vi * 2 + 1] = j / ringN;
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
  const segs = { body: low ? 24 : 40, around: low ? 22 : 36, sph: low ? 12 : 18, edge: low ? 0.24 : 0.16 };
  const rng = createRng(SEED + 4242); // variação determinística (ex.: fases iniciais)

  const group = new THREE.Group();
  group.name = 'dove';

  // ------------------------------ materiais ----------------------------
  const fingers = fingerDefs();
  const wingTex = wingTexture(fingers);
  const tailTex = tailTexture();
  const bodyTex = bodyTexture();
  const featherMat = new THREE.MeshStandardMaterial({ map: wingTex, vertexColors: true, roughness: 0.76, metalness: 0 });
  const tailMat = new THREE.MeshStandardMaterial({ map: tailTex, vertexColors: true, roughness: 0.76, metalness: 0 });
  const bodyMat = new THREE.MeshStandardMaterial({ map: bodyTex, vertexColors: true, roughness: 0.74, metalness: 0 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: COL.eye, roughness: 0.3, metalness: 0.05 });
  const leatherMat = new THREE.MeshStandardMaterial({ color: COL.leather, roughness: 0.68, metalness: 0 });
  const metalMat = new THREE.MeshStandardMaterial({ color: COL.metal, roughness: 0.45, metalness: 0.6 });
  const reinMat = new THREE.MeshStandardMaterial({ color: COL.leatherDark, roughness: 0.75, metalness: 0 });
  const riderMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });

  const profile = makeBodyProfile();

  // ------------------------------ corpo ------------------------------
  const bodyParts = [];
  {
    const body = makeBodyGeometry(profile, segs);
    shadeByNormal(body);
    bodyParts.push(body);
    // escapulares: almofadas lisas sobre a raiz das asas (fundem asa e corpo)
    for (const sx of [-1, 1]) bodyParts.push(shadeByNormal(sphere(1, new THREE.Vector3(sx * 0.28, 0.295, -0.08), [0.3, 0.04, 0.56], 16, 10)));
    // pescoço curto: tubo do peito à cabeça
    const neckCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.16, -0.78), new THREE.Vector3(0, 0.27, -0.98), new THREE.Vector3(0, 0.38, -1.16),
    ]);
    const NS = 10;
    const neck = new THREE.TubeGeometry(neckCurve, NS, 0.17, segs.sph, false);
    {
      const p = neck.attributes.position; const n = p.count;
      for (let i = 0; i < n; i++) {
        const t = Math.floor(i / (segs.sph + 1)) / NS;
        const s = 1.05 - 0.25 * t;
        const z = p.getZ(i); const y = p.getY(i); const x = p.getX(i);
        const c = neckCurve.getPoint(t, TMP.v1);
        p.setXYZ(i, c.x + (x - c.x) * s, c.y + (y - c.y) * s, c.z + (z - c.z) * s);
      }
      neck.computeVertexNormals();
    }
    shadeByNormal(neck);
    bodyParts.push(neck);
    // patas recolhidas sob a barriga (rosadas, discretas)
    for (const sx of [-1, 1]) {
      const hip = new THREE.Vector3(sx * 0.13, -0.42, 0.2), foot = new THREE.Vector3(sx * 0.15, -0.5, 0.36);
      bodyParts.push(paint(limb(hip, foot, 0.035, 8), COL.feet));
      bodyParts.push(paint(sphere(0.04, foot, [1.2, 0.8, 1.1], 10, 8), COL.feet));
      for (let k = -1; k <= 1; k++) {
        const toe = new THREE.Vector3(foot.x + k * 0.045 + sx * 0.01, foot.y - 0.02, foot.z + 0.13 - Math.abs(k) * 0.03);
        bodyParts.push(paint(limb(foot, toe, 0.012, 6, 2), COL.feet));
      }
    }
  }
  const bodyMesh = new THREE.Mesh(mergeAll(bodyParts), bodyMat);
  bodyMesh.name = 'body';
  group.add(bodyMesh);

  // ------------------------------ cabeça (grupo que balança) ----------
  const HEAD_C = new THREE.Vector3(0, 0.43, -1.25);
  const headGroup = new THREE.Group();
  headGroup.position.copy(HEAD_C);
  group.add(headGroup);
  {
    const parts = [];
    const head = new THREE.SphereGeometry(HEAD_R, segs.sph + 4, segs.sph);
    head.scale(0.95, 1, 1.06);
    shadeByNormal(head);
    parts.push(head);
    // cera (bumpzinho branco na base do bico)
    parts.push(shadeByNormal(sphere(0.04, new THREE.Vector3(0, -0.015, -HEAD_R - 0.01), [1.2, 0.8, 1], 8, 6)));
    // bico: cone pequeno cinza, levemente para baixo
    const beak = new THREE.ConeGeometry(0.034, 0.17, 10, 1);
    beak.rotateX(-Math.PI / 2); beak.rotateX(-0.2);
    beak.translate(0, -0.035, -HEAD_R - 0.085);
    parts.push(paint(beak, COL.beak));
    // brilho dos olhos
    for (const sx of [-1, 1]) parts.push(paint(sphere(0.009, new THREE.Vector3(sx * 0.158, 0.07, -0.09), [1, 1, 1], 6, 4), 0xffffff));
    const headMesh = new THREE.Mesh(mergeAll(parts), bodyMat);
    headMesh.name = 'head';
    headGroup.add(headMesh);
    const eyes = mergeAll([-1, 1].map((sx) => sphere(0.036, new THREE.Vector3(sx * 0.152, 0.05, -0.07), [0.7, 1, 1], 12, 10)));
    headGroup.add(new THREE.Mesh(eyes, eyeMat));
  }

  // ------------------------------ asas (SkinnedMesh, 3 ossos) ----------
  const wingGeo = skinByX(featherSheet(wingShape(fingers), { camber: 0.045, chord: 0.66, segs: 10, maxEdge: segs.edge }), WRIST_X, FAN_X);
  const wings = [];
  for (const side of [1, -1]) {
    const shoulder = new THREE.Group();
    shoulder.name = side > 0 ? 'wingR' : 'wingL';
    shoulder.position.set(side * SHOULDER_X, SHOULDER_Y, SHOULDER_Z);
    shoulder.scale.x = side; // asa esquerda espelhada (depois das rotações dos ossos)
    const b0 = new THREE.Bone(), b1 = new THREE.Bone(), b2 = new THREE.Bone();
    b1.position.set(WRIST_X, 0, 0); b2.position.set(FAN_X - WRIST_X, 0, -FAN_Y);
    b0.add(b1); b1.add(b2);
    const mesh = new THREE.SkinnedMesh(wingGeo, featherMat);
    mesh.name = 'wing';
    mesh.frustumCulled = false;
    mesh.add(b0);
    shoulder.add(mesh);
    group.add(shoulder);
    shoulder.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton([b0, b1, b2]));
    wings.push({ side, shoulder, b0, b1, b2 });
  }

  // ------------------------------ cauda ------------------------------
  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0.03, BODY_BACK - 0.16);
  const tailMesh = new THREE.Mesh(featherSheet(tailShape(), { camber: -0.02, chord: 0.5, segs: 6, maxEdge: 0.3 }), tailMat);
  tailMesh.name = 'tail';
  tailPivot.add(tailMesh);
  group.add(tailPivot);

  // ------------------------------ arreios (estáticos) -----------------
  const SADDLE_Z = -0.08;                       // meio do dorso, entre as asas
  const SADDLE_Y = profile.surface(SADDLE_Z, 0).y;  // topo do dorso ali (~0.48)
  let packageAnchor;
  const leather = [], metal = [];
  {
    // assento
    leather.push(sphere(1, new THREE.Vector3(0, SADDLE_Y + 0.02, SADDLE_Z), [0.26, 0.065, 0.34], 24, 12));
    // maçaneta (pommel) baixa à frente
    leather.push(sphere(1, new THREE.Vector3(0, SADDLE_Y + 0.09, SADDLE_Z - 0.28), [0.085, 0.06, 0.06], 14, 10));
    // patilha (cantle) ALTA atrás do assento: encosto curvo + rebordo
    leather.push(box(0.36, 0.26, 0.045, new THREE.Vector3(0, SADDLE_Y + 0.17, SADDLE_Z + 0.21), [0.22, 0, 0]));
    leather.push(limb(new THREE.Vector3(-0.18, SADDLE_Y + 0.3, SADDLE_Z + 0.24), new THREE.Vector3(0.18, SADDLE_Y + 0.3, SADDLE_Z + 0.24), 0.03, 10));
    for (const sx of [-1, 1]) {
      // "orelhas" laterais da patilha
      leather.push(box(0.05, 0.14, 0.2, new THREE.Vector3(sx * 0.19, SADDLE_Y + 0.08, SADDLE_Z + 0.14), [0, sx * 0.3, 0]));
      // abas laterais (skirts)
      leather.push(box(0.025, 0.28, 0.38, new THREE.Vector3(sx * 0.4, SADDLE_Y - 0.17, SADDLE_Z - 0.02), [0, 0, sx * 0.34]));
      // loro do estribo
      const topP = new THREE.Vector3(sx * 0.33, SADDLE_Y - 0.06, SADDLE_Z - 0.06), botP = new THREE.Vector3(sx * 0.57, SADDLE_Y - 0.55, SADDLE_Z - 0.06);
      const dir = botP.clone().sub(topP); const len = dir.length();
      const lth = new THREE.BoxGeometry(0.035, len, 0.012);
      lth.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
      lth.translate((topP.x + botP.x) / 2, (topP.y + botP.y) / 2, (topP.z + botP.z) / 2);
      leather.push(lth);
      // estribo (argola de metal com piso)
      const iron = new THREE.TorusGeometry(0.07, 0.012, 6, 18);
      iron.translate(sx * 0.57, SADDLE_Y - 0.61, SADDLE_Z - 0.06);
      metal.push(iron);
      metal.push(box(0.02, 0.012, 0.09, new THREE.Vector3(sx * 0.57, SADDLE_Y - 0.68, SADDLE_Z - 0.06)));
    }
    // cilha: tubo que abraça a seção do corpo
    const girthPts = [];
    for (let k = 0; k < 40; k++) girthPts.push(profile.surface(SADDLE_Z, (k / 40) * Math.PI * 2, 0.012));
    leather.push(strap(girthPts, 0.022, true, 80, 8));
    metal.push(box(0.05, 0.05, 0.02, profile.surface(SADDLE_Z, Math.PI * 0.62, 0.03)));
    // peitoral: duas tiras dos ombros à argola sob o peito + tira do peito
    const RING = profile.surface(-0.58, Math.PI, 0.02);
    for (const sx of [-1, 1]) {
      const pts = [
        profile.surface(SADDLE_Z - 0.12, sx * 0.55, 0.012), profile.surface(-0.48, sx * 1.15, 0.012),
        profile.surface(-0.58, sx * 1.85, 0.012), profile.surface(-0.62, sx * 2.5, 0.012), RING,
      ];
      leather.push(strap(pts, 0.018, false, 30, 6));
    }
    leather.push(strap([RING, profile.surface(-0.45, Math.PI, 0.012), profile.surface(SADDLE_Z, Math.PI, 0.012)], 0.016, false, 14, 6));
    leather.push(strap([RING, profile.surface(-0.76, Math.PI * 0.95, 0.012), profile.surface(-0.9, Math.PI * 0.75, 0.012), new THREE.Vector3(0, 0.02, -0.97)], 0.016, false, 16, 6));
    // argola de metal da encomenda (plano YZ: a corda passa por ela)
    const ring = new THREE.TorusGeometry(0.06, 0.011, 8, 20);
    ring.rotateY(Math.PI / 2);
    ring.translate(RING.x, RING.y - 0.04, RING.z);
    metal.push(ring);
    metal.push(box(0.06, 0.03, 0.03, new THREE.Vector3(RING.x, RING.y + 0.005, RING.z)));

    group.add(new THREE.Mesh(mergeAll(leather), leatherMat));
    group.add(new THREE.Mesh(mergeAll(metal), metalMat));

    packageAnchor = new THREE.Object3D();
    packageAnchor.name = 'packageAnchor';
    packageAnchor.position.set(RING.x, RING.y - 0.08, RING.z);
    group.add(packageAnchor);
  }

  // ------------------------------ bridão (na cabeça) ------------------
  const bitRings = [];
  {
    const hl = [], hm = [];
    const nose = new THREE.TorusGeometry(HEAD_R * 0.82, 0.01, 6, 24); nose.translate(0, -0.01, -0.1); hl.push(nose);
    const crown = new THREE.TorusGeometry(HEAD_R * 0.96, 0.01, 6, 28); crown.rotateX(-0.35); crown.translate(0, 0.02, 0.06); hl.push(crown);
    for (const sx of [-1, 1]) {
      hl.push(limb(new THREE.Vector3(sx * 0.18, -0.04, 0.05), new THREE.Vector3(sx * 0.155, -0.05, -0.1), 0.01, 6, 2));
      const r = new THREE.TorusGeometry(0.03, 0.007, 6, 14);
      r.rotateY(Math.PI / 2); r.translate(sx * 0.175, -0.045, -0.1);
      hm.push(r);
      bitRings.push(new THREE.Vector3(sx * 0.195, -0.045, -0.1)); // local do headGroup
    }
    headGroup.add(new THREE.Mesh(mergeAll(hl), leatherMat));
    headGroup.add(new THREE.Mesh(mergeAll(hm), metalMat));
  }

  // ------------------------------ cavaleiro ---------------------------
  const C = { jacket: COL.jacket, trousers: COL.trousers, boots: COL.boots, skin: COL.skin, hair: COL.hair, pack: COL.pack, scarf: 0xc26e2b, belt: COL.boots, glove: 0x5a4030 };
  const PELVIS = new THREE.Vector3(0, SADDLE_Y + 0.08, SADDLE_Z + 0.02);
  const riderLegs = new THREE.Group(); riderLegs.position.copy(PELVIS); group.add(riderLegs);
  const riderUpper = new THREE.Group(); riderUpper.position.copy(PELVIS); group.add(riderUpper);
  const hands = [];
  {
    // --- pernas (fixas na sela) ---
    const lg = [];
    lg.push(paint(sphere(1, new THREE.Vector3(0, 0.04, 0), [0.19, 0.11, 0.15], 14, 10), C.trousers));
    for (const sx of [-1, 1]) {
      const hip = new THREE.Vector3(sx * 0.12, 0.02, 0.0), knee = new THREE.Vector3(sx * 0.4, -0.27, -0.26), ankle = new THREE.Vector3(sx * 0.57, -0.63, -0.08);
      lg.push(paint(limb(hip, knee, 0.078, 10), C.trousers));
      lg.push(paint(limb(knee, ankle, 0.062, 10), C.trousers));
      const shinDir = ankle.clone().sub(knee).normalize();
      lg.push(paint(limb(ankle.clone().addScaledVector(shinDir, -0.17), ankle, 0.068, 10), C.boots));
      lg.push(paint(limb(ankle, new THREE.Vector3(ankle.x + sx * 0.01, ankle.y - 0.04, ankle.z - 0.2), 0.052, 10), C.boots));
    }
    riderLegs.add(new THREE.Mesh(mergeAll(lg), riderMat));

    // --- tronco ereto, braços, cabeça, mochila (inclinam juntos) ---
    const ug = [];
    ug.push(paint(sphere(1, new THREE.Vector3(0, 0.3, -0.02), [0.2, 0.27, 0.14], 18, 12), C.jacket));
    ug.push(paint(limb(new THREE.Vector3(-0.2, 0.5, -0.06), new THREE.Vector3(0.2, 0.5, -0.06), 0.085, 10), C.jacket)); // ombros
    ug.push(paint(limb(new THREE.Vector3(0, 0.51, -0.08), new THREE.Vector3(0, 0.63, -0.1), 0.05, 10), C.skin)); // pescoço
    ug.push(paint(sphere(0.11, new THREE.Vector3(0, 0.74, -0.1), [0.95, 1.05, 1], 18, 14), C.skin)); // cabeça
    const hair = new THREE.SphereGeometry(0.118, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62);
    hair.rotateX(0.35); hair.scale(0.97, 1.05, 1.02); hair.translate(0, 0.745, -0.085);
    ug.push(paint(hair, C.hair));
    ug.push(paint(sphere(0.05, new THREE.Vector3(0, 0.76, 0.02), [1, 1, 1], 10, 8), C.hair));
    const scarf = new THREE.TorusGeometry(0.078, 0.032, 8, 16); scarf.rotateX(Math.PI / 2); scarf.translate(0, 0.58, -0.08);
    ug.push(paint(scarf, C.scarf));
    const belt = new THREE.TorusGeometry(0.19, 0.02, 6, 20); belt.rotateX(Math.PI / 2); belt.scale(1, 1, 0.75); belt.translate(0, 0.1, -0.02);
    ug.push(paint(belt, C.belt));
    // braços à frente segurando as rédeas
    for (const sx of [-1, 1]) {
      const sh = new THREE.Vector3(sx * 0.22, 0.48, -0.07), el = new THREE.Vector3(sx * 0.25, 0.26, -0.3), hd = new THREE.Vector3(sx * 0.15, 0.3, -0.5);
      ug.push(paint(limb(sh, el, 0.052, 10), C.jacket));
      ug.push(paint(limb(el, hd, 0.044, 10), C.jacket));
      ug.push(paint(sphere(0.047, hd, [1, 0.85, 1.15], 10, 8), C.glove));
      hands.push(hd.clone());
    }
    // mochila pequena com rolo
    ug.push(paint(box(0.28, 0.26, 0.12, new THREE.Vector3(0, 0.36, 0.16), [0.1, 0, 0]), C.pack));
    ug.push(paint(limb(new THREE.Vector3(-0.13, 0.51, 0.17), new THREE.Vector3(0.13, 0.51, 0.17), 0.042, 10), C.pack));
    for (const sx of [-1, 1]) ug.push(paint(limb(new THREE.Vector3(sx * 0.12, 0.49, 0.1), new THREE.Vector3(sx * 0.12, 0.47, -0.14), 0.016, 6, 2), C.belt));
    riderUpper.add(new THREE.Mesh(mergeAll(ug), riderMat));
  }

  // ------------------------------ rédeas (dinâmicas) ------------------
  const ropes = createRopes(2, 22, 6, 0.012);
  const reinMesh = new THREE.Mesh(ropes.geometry, reinMat);
  reinMesh.frustumCulled = false;
  reinMesh.name = 'reins';
  group.add(reinMesh);
  const reinCtrl = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

  // ------------------------------ estado da animação ------------------
  const GLIDE_CYCLE = DOVE_MODEL.GLIDE_PERIOD, FLAP_WINDOW = DOVE_MODEL.FLAP_WINDOW;
  const st = {
    time: rng() * 10, phase: rng() * Math.PI * 2, freq: DOVE_MODEL.FLAP_HZ_CRUISE, flapW: 1, boostW: 0, prevSpeed: DOVE.SPEED_CRUISE,
    tailSpread: 1, tailX: 0, tailY: 0, tailZ: 0, riderX: 0, riderZ: 0, headY: 0, sweep: 0, dive: 0, slow: 0,
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
    const gl0z = DOVE_MODEL.GLIDE_DIHEDRAL + 0.08 * st.slow + rip1;
    const gl1z = -DOVE_MODEL.GLIDE_WRIST_DROOP + rip2;
    const gl2z = 0.14 + rip3;
    const glSweep = DOVE_MODEL.GLIDE_SWEEP + 0.18 * st.boostW + 0.25 * st.dive - 0.06 * st.slow;
    const gl1x = -0.04, gl2x = -0.03;

    // ---- bater: lento e fundo em cruzeiro, forte no boost; a mão atrasa, as pontas atrasam mais ----
    const amp = DOVE_MODEL.FLAP_AMP + 0.14 * st.boostW;
    const fl0z = amp * wave(ph) + 0.04;
    const fl1z = 0.42 * amp / DOVE_MODEL.FLAP_AMP * wave(ph - 0.6) - 0.05;
    const fl2z = 0.3 * amp / DOVE_MODEL.FLAP_AMP * wave(ph - 1.15);
    const fl1x = 0.18 * Math.cos(ph - 0.6);                            // bordo de ataque desce na batida para baixo
    const fl2x = 0.12 * Math.cos(ph - 1.0);
    const flSweep = 0.08 + 0.14 * Math.max(0, Math.cos(ph - 0.3)) + 0.12 * st.boostW; // mão recua na subida

    const b0z = fw * fl0z + (1 - fw) * gl0z;
    const b1z = fw * fl1z + (1 - fw) * gl1z;
    const b2z = fw * fl2z + (1 - fw) * gl2z;
    const b1x = fw * fl1x + (1 - fw) * gl1x;
    const b2x = fw * fl2x + (1 - fw) * gl2x;
    st.sweep = lerpTo(st.sweep, fw * flSweep + (1 - fw) * glSweep, dt, 6);
    for (const w of wings) {
      // os ossos giram no referencial da asa direita; a esquerda é espelhada pelo grupo (scale.x = -1)
      w.b0.rotation.set(0, -0.04, b0z);
      w.b1.rotation.set(b1x, -st.sweep, b1z);
      w.b2.rotation.set(b2x, -0.05 - 0.08 * st.dive, b2z);
    }

    // ---- cauda: abre nas curvas / lentidão / subida; inclina com a curva; levemente para baixo ----
    const spread = THREE.MathUtils.clamp(1 + 0.3 * Math.abs(turn) + 0.22 * st.slow + 0.15 * Math.max(0, climb) + 0.06 * fw, 0.85, 1.6);
    st.tailSpread = lerpTo(st.tailSpread, spread, dt, 4);
    st.tailX = lerpTo(st.tailX, 0.1 + 0.16 * climb + 0.04 * fw * Math.sin(ph - 1.2), dt, 5);
    st.tailZ = lerpTo(st.tailZ, roll * 0.35 + turn * 0.12, dt, 4);
    st.tailY = lerpTo(st.tailY, -turn * 0.14, dt, 4);
    tailPivot.scale.set(st.tailSpread, 1, 1 - 0.15 * (st.tailSpread - 1));
    tailPivot.rotation.set(st.tailX, st.tailY, st.tailZ);

    // ---- cabeça: balanço sutil, olha para a curva ----
    st.headY = lerpTo(st.headY, turn * 0.22, dt, 4);
    headGroup.rotation.set(0.05 * fw * Math.sin(ph - 0.6) - 0.06 * st.boostW, st.headY, 0);
    headGroup.position.y = HEAD_C.y + 0.015 * fw * Math.sin(ph - 0.6);

    // ---- cavaleiro: ereto; inclina na curva, agacha no boost ----
    st.riderZ = lerpTo(st.riderZ, roll * 0.3 + turn * 0.08, dt, 3);
    st.riderX = lerpTo(st.riderX, -0.3 * st.boostW - 0.05 * Math.max(0, climb), dt, 3);
    riderUpper.rotation.set(st.riderX - 0.02 * fw * Math.sin(ph - 0.3), 0, st.riderZ);
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
