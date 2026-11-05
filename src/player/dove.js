// =====================================================================
//  RUPPEN — pomba do jogador (candidato B): modelo procedural com arreios
//  detalhados e cavaleiro, foco em ANIMAÇÃO (batida de asas com atraso das
//  penas externas, planagem, cauda em leque nas curvas, cavaleiro inclinando)
//  e em ARREIOS (sela, cilha, estribos, rédeas, peitoral com argola).
//
//  Contrato (ARCHITECTURE.md 4.5):
//    createDove({ quality }) -> { group, packageAnchor, update(dt, flightState) }
//  Convenção local: frente = -Z, cima = +Y, direita = +X. Centro do corpo na
//  origem do grupo. O integrador posiciona o grupo (position/quaternion); aqui
//  nunca mexemos nisso.
// =====================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DOVE, SEED } from '../../config.js';
import { createNoise } from '../../util/noise.js';
import { createRng } from '../../util/rng.js';

// ----------------------------------------------------------------------
//  Dimensões derivadas (tudo relativo a DOVE.* do config)
// ----------------------------------------------------------------------
const HALF_SPAN = DOVE.WINGSPAN / 2;          // 2.3 m
const SHOULDER_X = 0.22;                      // onde a asa sai do corpo
const ARM_LEN = 1.03;                         // ombro -> punho
const HAND_LEN = HALF_SPAN - SHOULDER_X - ARM_LEN; // punho -> ponta (1.05 m)
const BODY_FRONT = -1.05;                     // z da base do pescoço
const BODY_BACK = 1.15;                       // z da base da cauda
const TAIL_LEN = 0.95;
const WING_THICK = 0.035;

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
function shadeByNormal(g, topHex, underHex) {
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

// Textura suave do corpo: branco com riscos de penas muito leves (ruído).
function bodyTexture() {
  const S = 256;
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const noise = createNoise(SEED + 7331);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      // riscos alongados (penas) + leve manchado
      const streak = noise.noise2(u * 6, v * 70) * 0.5 + noise.noise2(u * 14 + 3, v * 160) * 0.25;
      const blotch = noise.noise2(u * 5 + 9, v * 5 + 4);
      const d = 1 - 0.045 * Math.max(0, streak) - 0.02 * Math.max(0, blotch);
      const i = (y * S + x) * 4;
      img.data[i] = 255 * d; img.data[i + 1] = 255 * (d - 0.004); img.data[i + 2] = 255 * (d - 0.012); img.data[i + 3] = 255;
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
//  Planta da asa (espaço da forma: x = envergadura para fora, y = +frente)
//  Coordenadas globais da asa: ombro em x=0, punho em x=ARM_LEN, ponta em
//  x=ARM_LEN+HAND_LEN. A mão (penas primárias) tem 6 "dedos".
// ----------------------------------------------------------------------
function fingerDefs() {
  const cx = ARM_LEN + 0.44, cy = -0.06;             // centro de onde os dedos irradiam
  const angles = [14, -10, -33, -55, -75, -94];      // graus (0 = para fora, negativo = para trás)
  const lens = [0.64, 0.66, 0.62, 0.56, 0.50, 0.43];
  const defs = [];
  for (let i = 0; i < angles.length; i++) {
    const a = THREE.MathUtils.degToRad(angles[i]);
    defs.push({ a, len: lens[i], cx, cy, tip: { x: cx + Math.cos(a) * lens[i], y: cy + Math.sin(a) * lens[i] } });
  }
  // entalhes entre dedos
  for (let i = 0; i < defs.length - 1; i++) {
    const am = (defs[i].a + defs[i + 1].a) / 2, lm = (defs[i].len + defs[i + 1].len) / 2 * 0.7;
    defs[i].notch = { x: cx + Math.cos(am) * lm, y: cy + Math.sin(am) * lm };
  }
  return defs;
}

function armShape() {
  const s = new THREE.Shape();
  s.moveTo(-0.2, 0.46);
  s.quadraticCurveTo(0.45, 0.58, ARM_LEN + 0.02, 0.45);
  s.lineTo(ARM_LEN + 0.02, -0.46);
  s.quadraticCurveTo(0.6, -0.72, 0.32, -0.68);   // secundárias (bojo do bordo de fuga)
  s.quadraticCurveTo(0.05, -0.62, -0.2, -0.4);   // escapulares afinam junto ao corpo
  s.closePath();
  return s;
}

function handShape(fingers) {
  const s = new THREE.Shape();
  const x0 = ARM_LEN - 0.12;                       // aba de sobreposição no punho
  s.moveTo(x0, 0.45);
  s.lineTo(ARM_LEN, 0.45);
  s.quadraticCurveTo(ARM_LEN + 0.6, 0.36, fingers[0].tip.x, fingers[0].tip.y);
  for (let i = 0; i < fingers.length; i++) {
    const f = fingers[i];
    if (i > 0) s.lineTo(f.tip.x, f.tip.y);
    if (f.notch) s.lineTo(f.notch.x, f.notch.y);
  }
  const last = fingers[fingers.length - 1];
  s.quadraticCurveTo(last.cx - 0.05, last.cy - 0.42, ARM_LEN, -0.46);
  s.lineTo(x0, -0.46);
  s.closePath();
  return s;
}

function tailShape() {
  const s = new THREE.Shape();
  const half = 0.56, L = TAIL_LEN;
  s.moveTo(-0.17, 0.08);
  s.lineTo(-half, -L + 0.28);
  // ponta arredondada com pequenos entalhes de penas
  const n = 8;
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const x = -half + (2 * half) * (k / n);
    const y = -L + 0.28 * Math.pow(x / half, 2);
    pts.push({ x, y });
  }
  for (let k = 1; k <= n; k++) {
    const a = pts[k - 1], b = pts[k];
    s.lineTo((a.x + b.x) / 2, (a.y + b.y) / 2 + 0.035);
    s.lineTo(b.x, b.y);
  }
  s.lineTo(0.17, 0.08);
  s.closePath();
  return s;
}

// Extrusão fina de uma forma plana -> chapa de penas no plano XZ (y = espessura),
// uv = coordenada da forma, cor por vértice (topo quente / baixo azulado),
// leve curvatura (camber) e normais suaves nas faces.
function featherSheet(shape, { camber = 0.04, chord = 0.65, segs = 10 } = {}) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: WING_THICK, bevelEnabled: false, curveSegments: segs, steps: 1 });
  g.rotateX(-Math.PI / 2);          // forma y(+frente) -> -z ; profundidade -> +y
  g.translate(0, -WING_THICK / 2, 0);
  const pos = g.attributes.position, nor = g.attributes.normal;
  const n = pos.count;
  const uv = new Float32Array(n * 2), col = new Float32Array(n * 3);
  const top = new THREE.Color(0xfffdf8), under = new THREE.Color(0xe0e6ee), side = new THREE.Color(0xeceef2);
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    uv[i * 2] = x; uv[i * 2 + 1] = -z;
    const ny = nor.getY(i);
    const c = ny > 0.5 ? top : ny < -0.5 ? under : side;
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    // camber: parábola ao longo da corda
    const t = z / chord;
    const h = camber * Math.max(0, 1 - t * t);
    pos.setY(i, y + h);
    if (Math.abs(ny) > 0.5) {
      // normal analítica da superfície curva
      const dh = -2 * camber * t / chord;
      TMP.v1.set(0, 1, -dh).normalize();
      if (ny < 0) TMP.v1.negate();
      nor.setXYZ(i, TMP.v1.x, TMP.v1.y, TMP.v1.z);
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  pos.needsUpdate = true; nor.needsUpdate = true;
  return g;
}

function wingTexture(fingers) {
  const bounds = { xmin: -0.25, xmax: HALF_SPAN - SHOULDER_X + 0.1, ymin: -0.85, ymax: 0.7 };
  return shapeTexture(1024, 512, bounds, (ctx, px, py, sx) => {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.fillStyle = '#fbfaf5'; ctx.fillRect(0, 0, W, H);
    // sombreamento suave em direção ao bordo de fuga
    const g1 = ctx.createLinearGradient(0, py(0.5), 0, py(-0.8));
    g1.addColorStop(0, 'rgba(200,208,220,0)'); g1.addColorStop(1, 'rgba(190,200,214,0.45)');
    ctx.fillStyle = g1; ctx.fillRect(0, 0, W, H);
    // coberteiras: fileiras de arcos leves perto do bordo de ataque
    ctx.strokeStyle = 'rgba(175,185,200,0.22)'; ctx.lineWidth = 1.5;
    for (let row = 0; row < 3; row++) {
      const yb = 0.42 - row * 0.16;
      ctx.beginPath();
      for (let k = 0; k < 14; k++) {
        const xa = -0.1 + k * 0.12;
        ctx.moveTo(px(xa), py(yb));
        ctx.quadraticCurveTo(px(xa + 0.06), py(yb - 0.08), px(xa + 0.12), py(yb));
      }
      ctx.stroke();
    }
    // raques das secundárias (braço): irradiam do ombro para o bordo de fuga
    ctx.lineWidth = 1.6;
    for (let k = 0; k < 12; k++) {
      const t = k / 11;
      const xe = -0.1 + t * (ARM_LEN + 0.05), ye = -0.7 + t * 0.26;
      ctx.strokeStyle = 'rgba(150,162,180,0.30)';
      ctx.beginPath(); ctx.moveTo(px(0.02 + t * 0.25), py(0.3)); ctx.lineTo(px(xe), py(ye)); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath(); ctx.moveTo(px(0.02 + t * 0.25 + 0.012), py(0.3)); ctx.lineTo(px(xe + 0.012), py(ye)); ctx.stroke();
    }
    // faixa cinza suave ao longo do bordo de fuga das secundárias
    const g2 = ctx.createLinearGradient(0, py(-0.45), 0, py(-0.75));
    g2.addColorStop(0, 'rgba(120,130,148,0)'); g2.addColorStop(1, 'rgba(120,130,148,0.28)');
    ctx.fillStyle = g2; ctx.fillRect(px(-0.3), py(-0.4), px(ARM_LEN + 0.1) - px(-0.3), py(-0.9) - py(-0.4));
    // primárias: raques + pontas escuras (como nas referências)
    for (const f of fingers) {
      const bx = f.cx, by = f.cy;
      const dx = Math.cos(f.a), dy = Math.sin(f.a);
      // raque
      ctx.strokeStyle = 'rgba(120,130,145,0.45)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px(bx - dx * 0.1), py(by - dy * 0.1)); ctx.lineTo(px(f.tip.x), py(f.tip.y)); ctx.stroke();
      // ponta escura com gradiente ao longo do dedo
      const x1 = bx + dx * f.len * 0.42, y1 = by + dy * f.len * 0.42;
      const grad = ctx.createLinearGradient(px(x1), py(y1), px(f.tip.x), py(f.tip.y));
      grad.addColorStop(0, 'rgba(70,74,80,0)');
      grad.addColorStop(0.45, 'rgba(70,74,80,0.55)');
      grad.addColorStop(1, 'rgba(40,42,46,0.95)');
      ctx.strokeStyle = grad; ctx.lineWidth = 0.2 * sx; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(px(x1), py(y1)); ctx.lineTo(px(f.tip.x + dx * 0.1), py(f.tip.y + dy * 0.1)); ctx.stroke();
    }
  });
}

function tailTexture() {
  const bounds = { xmin: -0.62, xmax: 0.62, ymin: -TAIL_LEN - 0.12, ymax: 0.12 };
  return shapeTexture(512, 512, bounds, (ctx, px, py) => {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.fillStyle = '#fbfaf5'; ctx.fillRect(0, 0, W, H);
    const g1 = ctx.createLinearGradient(0, py(-0.2), 0, py(-TAIL_LEN));
    g1.addColorStop(0, 'rgba(190,200,214,0)'); g1.addColorStop(1, 'rgba(180,190,206,0.5)');
    ctx.fillStyle = g1; ctx.fillRect(0, 0, W, H);
    // raques em leque
    for (let k = 0; k <= 8; k++) {
      const x = -0.52 + k * 0.13, y = -TAIL_LEN + 0.28 * Math.pow(x / 0.56, 2);
      ctx.strokeStyle = 'rgba(150,162,180,0.35)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px(0), py(0.05)); ctx.lineTo(px(x), py(y)); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(px(0.01), py(0.05)); ctx.lineTo(px(x + 0.012), py(y)); ctx.stroke();
    }
    // faixa terminal cinza bem leve
    const g2 = ctx.createLinearGradient(0, py(-TAIL_LEN + 0.22), 0, py(-TAIL_LEN - 0.05));
    g2.addColorStop(0, 'rgba(110,118,132,0)'); g2.addColorStop(1, 'rgba(110,118,132,0.35)');
    ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);
  });
}

// ----------------------------------------------------------------------
//  Corpo: perfil por spline + deformação (peito mais fundo). A função
//  bodySurface(z, ang) é reutilizada para as tiras dos arreios.
// ----------------------------------------------------------------------
function makeBodyProfile() {
  const ctrl = [
    [BODY_FRONT, 0.0], [BODY_FRONT + 0.05, 0.16], [-0.85, 0.31], [-0.55, 0.42], [-0.2, 0.45],
    [0.2, 0.42], [0.55, 0.33], [0.85, 0.22], [1.05, 0.12], [BODY_BACK, 0.0],
  ];
  const curve = new THREE.SplineCurve(ctrl.map(([z, r]) => new THREE.Vector2(z, r)));
  const N = 220;
  const pts = curve.getPoints(N);
  // tabela radius(z) por interpolação linear
  const radiusAt = (z) => {
    if (z <= pts[0].x) return 0; if (z >= pts[N].x) return 0;
    let lo = 0, hi = N;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid].x <= z) lo = mid; else hi = mid; }
    const a = pts[lo], b = pts[hi];
    const t = (z - a.x) / Math.max(1e-6, b.x - a.x);
    return Math.max(0, a.y + (b.y - a.y) * t);
  };
  // deformação: quilha do peito e corpo um pouco mais estreito que alto
  const deform = (p) => {
    const keel = Math.exp(-Math.pow((p.z + 0.4) / 0.55, 2));
    if (p.y < 0) p.y *= 1 + 0.28 * keel;
    else p.y *= 0.98;
    p.x *= 0.94;
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
  const lathePts = profile.pts.map((p) => new THREE.Vector2(p.y, p.x)); // (raio, eixo z); eixo Y do lathe vira +Z
  // reamostra (menos pontos ao longo do eixo)
  const step = Math.max(1, Math.round(lathePts.length / segs.body));
  const sub = lathePts.filter((_, i) => i % step === 0);
  if (sub[sub.length - 1] !== lathePts[lathePts.length - 1]) sub.push(lathePts[lathePts.length - 1]);
  const g = new THREE.LatheGeometry(sub, segs.around);
  g.rotateX(Math.PI / 2); // (0,y,0) -> (0,0,y): o eixo do perfil vira o eixo Z (frente em -Z)
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
  // ctrl: 4 Vector3 de controle
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
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, -1), 2.5); // evita recomputar
  return { geometry: g, update };
}

// ======================================================================
//  createDove
// ======================================================================
export function createDove(opts = {}) {
  const quality = opts.quality || 'high';
  const low = quality === 'low';
  const segs = { body: low ? 26 : 44, around: low ? 24 : 40, sph: low ? 12 : 20 };
  const rng = createRng(SEED + 4242); // variação determinística (ex.: fases iniciais)

  const group = new THREE.Group();
  group.name = 'dove_b';

  // ------------------------------ materiais ----------------------------
  const fingers = fingerDefs();
  const wingTex = wingTexture(fingers);
  const tailTex = tailTexture();
  const bodyTex = bodyTexture();
  const featherMat = new THREE.MeshStandardMaterial({ map: wingTex, vertexColors: true, roughness: 0.72, metalness: 0 });
  const tailMat = new THREE.MeshStandardMaterial({ map: tailTex, vertexColors: true, roughness: 0.72, metalness: 0 });
  const bodyMat = new THREE.MeshStandardMaterial({ map: bodyTex, vertexColors: true, roughness: 0.7, metalness: 0 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x15100d, roughness: 0.2, metalness: 0.1 });
  const leatherMat = new THREE.MeshStandardMaterial({ color: 0x6e4225, roughness: 0.62, metalness: 0 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0xc9c6bd, roughness: 0.38, metalness: 0.65 });
  const reinMat = new THREE.MeshStandardMaterial({ color: 0x4a2b17, roughness: 0.7, metalness: 0 });
  const riderMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });

  const profile = makeBodyProfile();

  // ------------------------------ corpo ------------------------------
  const bodyParts = [];
  {
    const body = makeBodyGeometry(profile, segs);
    shadeByNormal(body, 0xfffdf9, 0xdfe5ee);
    bodyParts.push(body);
    // escapulares: almofadas brancas sobre a raiz das asas (escondem a junta)
    for (const sx of [-1, 1]) bodyParts.push(shadeByNormal(sphere(1, new THREE.Vector3(sx * 0.27, 0.3, -0.1), [0.3, 0.045, 0.55], 16, 10), 0xfffdf9, 0xdfe5ee));
    // pescoço: tubo do peito até a cabeça
    const neckCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.12, -0.78), new THREE.Vector3(0, 0.2, -0.98), new THREE.Vector3(0, 0.34, -1.2), new THREE.Vector3(0, 0.46, -1.36),
    ]);
    const neck = new THREE.TubeGeometry(neckCurve, 14, 0.165, segs.sph, false);
    // afina o pescoço em direção à cabeça
    {
      const p = neck.attributes.position; const n = p.count;
      for (let i = 0; i < n; i++) {
        const t = Math.floor(i / (segs.sph + 1)) / 14;
        const s = 1.08 - 0.25 * t;
        const z = p.getZ(i); const y = p.getY(i); const x = p.getX(i);
        const c = neckCurve.getPoint(t, TMP.v1);
        p.setXYZ(i, c.x + (x - c.x) * s, c.y + (y - c.y) * s, c.z + (z - c.z) * s);
      }
      neck.computeVertexNormals();
    }
    shadeByNormal(neck, 0xfffdf9, 0xdfe5ee);
    bodyParts.push(neck);
    // patas recolhidas sob a barriga (rosadas)
    for (const sx of [-1, 1]) {
      const hip = new THREE.Vector3(sx * 0.14, -0.4, 0.22), foot = new THREE.Vector3(sx * 0.17, -0.5, 0.42);
      bodyParts.push(paint(limb(hip, foot, 0.04, 8), 0xe39a84));
      bodyParts.push(paint(sphere(0.045, foot, [1.2, 0.8, 1.1], 10, 8), 0xe39a84));
      for (let k = -1; k <= 1; k++) {
        const toe = new THREE.Vector3(foot.x + k * 0.05 + sx * 0.01, foot.y - 0.02, foot.z + 0.15 - Math.abs(k) * 0.03);
        bodyParts.push(paint(limb(foot, toe, 0.013, 6, 2), 0xe39a84));
      }
      // dedo traseiro
      bodyParts.push(paint(limb(foot, new THREE.Vector3(foot.x, foot.y - 0.01, foot.z - 0.08), 0.011, 6, 2), 0xe39a84));
    }
  }
  const bodyMesh = new THREE.Mesh(mergeAll(bodyParts), bodyMat);
  bodyMesh.name = 'body';
  group.add(bodyMesh);

  // ------------------------------ cabeça (grupo que balança) ----------
  const HEAD_C = new THREE.Vector3(0, 0.5, -1.4);
  const headGroup = new THREE.Group();
  headGroup.position.copy(HEAD_C);
  group.add(headGroup);
  {
    const parts = [];
    const head = new THREE.SphereGeometry(0.2, segs.sph + 4, segs.sph);
    head.scale(0.95, 1, 1.08);
    shadeByNormal(head, 0xfffdf9, 0xdfe5ee);
    parts.push(head);
    // cera (bumpzinho branco na base do bico)
    parts.push(shadeByNormal(sphere(0.045, new THREE.Vector3(0, -0.01, -0.205), [1.2, 0.8, 1], 8, 6), 0xfffdf9, 0xdfe5ee));
    // bico: cone cinza-rosado apontando para a frente e levemente para baixo
    const beak = new THREE.ConeGeometry(0.05, 0.27, 10, 1);
    beak.rotateX(-Math.PI / 2); // aponta para -Z
    beak.rotateX(-0.18);        // ponta levemente para baixo
    beak.translate(0, -0.035, -0.31);
    parts.push(paint(beak, 0xd4b2aa));
    // brilho dos olhos (pontinhos brancos, no mesmo mesh branco)
    for (const sx of [-1, 1]) parts.push(paint(sphere(0.01, new THREE.Vector3(sx * 0.168, 0.075, -0.105), [1, 1, 1], 6, 4), 0xffffff));
    const headMesh = new THREE.Mesh(mergeAll(parts), bodyMat);
    headMesh.name = 'head';
    headGroup.add(headMesh);
    // olhos escuros
    const eyes = mergeAll([-1, 1].map((sx) => sphere(0.04, new THREE.Vector3(sx * 0.162, 0.055, -0.08), [0.75, 1, 1], 12, 10)));
    headGroup.add(new THREE.Mesh(eyes, eyeMat));
  }

  // ------------------------------ asas ------------------------------
  const armGeo = featherSheet(armShape(), { camber: 0.045, chord: 0.62 });
  const handGeo = featherSheet(handShape(fingers), { camber: 0.03, chord: 0.6 });
  handGeo.translate(-ARM_LEN, 0, 0); // pivô no punho
  const wings = [];
  for (const side of [1, -1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * SHOULDER_X, 0.25, -0.18);
    shoulder.scale.x = side; // asa esquerda espelhada
    const arm = new THREE.Mesh(armGeo, featherMat); arm.name = 'wingArm';
    const wrist = new THREE.Group(); wrist.position.set(ARM_LEN, 0, 0);
    const hand = new THREE.Mesh(handGeo, featherMat); hand.name = 'wingHand';
    wrist.add(hand); shoulder.add(arm); shoulder.add(wrist);
    group.add(shoulder);
    wings.push({ side, shoulder, wrist });
  }

  // ------------------------------ cauda ------------------------------
  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0.04, BODY_BACK - 0.2);
  const tailMesh = new THREE.Mesh(featherSheet(tailShape(), { camber: -0.02, chord: 0.5 }), tailMat);
  tailMesh.name = 'tail';
  tailPivot.add(tailMesh);
  group.add(tailPivot);

  // ------------------------------ arreios (estáticos) -----------------
  const SADDLE_Z = -0.3;
  let packageAnchor;
  const leather = [], metal = [];
  {
    // assento
    const seat = sphere(1, new THREE.Vector3(0, 0.47, SADDLE_Z), [0.27, 0.075, 0.37], 24, 12);
    leather.push(seat);
    // maçaneta (pommel) e patilha (cantle)
    leather.push(sphere(1, new THREE.Vector3(0, 0.55, SADDLE_Z - 0.3), [0.09, 0.075, 0.07], 14, 10));
    const cantle = new THREE.TorusGeometry(0.2, 0.035, 8, 18, Math.PI);
    cantle.rotateX(-Math.PI / 2); cantle.rotateY(Math.PI);  // arco atrás do assento, aberto para a frente
    cantle.translate(0, 0.545, SADDLE_Z + 0.08);
    leather.push(cantle);
    // abas laterais (skirts)
    for (const sx of [-1, 1]) {
      const flap = box(0.025, 0.3, 0.38, new THREE.Vector3(sx * 0.4, 0.3, SADDLE_Z - 0.04), [0, 0, sx * 0.32]);
      leather.push(flap);
      // loro do estribo
      const topP = new THREE.Vector3(sx * 0.33, 0.42, SADDLE_Z - 0.06), botP = new THREE.Vector3(sx * 0.57, -0.07, SADDLE_Z - 0.06);
      const dir = botP.clone().sub(topP); const len = dir.length();
      const lth = new THREE.BoxGeometry(0.035, len, 0.012);
      lth.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
      lth.translate((topP.x + botP.x) / 2, (topP.y + botP.y) / 2, (topP.z + botP.z) / 2);
      leather.push(lth);
      // estribo (argola de metal com piso)
      const iron = new THREE.TorusGeometry(0.075, 0.012, 6, 18);
      iron.translate(sx * 0.57, -0.13, SADDLE_Z - 0.06);
      metal.push(iron);
      metal.push(box(0.02, 0.012, 0.09, new THREE.Vector3(sx * 0.57, -0.205, SADDLE_Z - 0.06)));
    }
    // cilha: tubo que abraça a seção do corpo
    const girthPts = [];
    for (let k = 0; k < 40; k++) girthPts.push(profile.surface(SADDLE_Z, (k / 40) * Math.PI * 2, 0.012));
    leather.push(strap(girthPts, 0.022, true, 80, 8));
    // fivela da cilha
    metal.push(box(0.05, 0.05, 0.02, profile.surface(SADDLE_Z, Math.PI * 0.62, 0.03)));
    // peitoral: duas tiras dos ombros à argola sob o peito + tira do peito + tira da barriga
    const RING = profile.surface(-0.62, Math.PI, 0.02);
    for (const sx of [-1, 1]) {
      const pts = [
        profile.surface(SADDLE_Z - 0.12, sx * 0.55, 0.012), profile.surface(-0.52, sx * 1.15, 0.012),
        profile.surface(-0.62, sx * 1.85, 0.012), profile.surface(-0.66, sx * 2.5, 0.012), RING,
      ];
      leather.push(strap(pts, 0.018, false, 30, 6));
    }
    leather.push(strap([RING, profile.surface(-0.5, Math.PI, 0.012), profile.surface(SADDLE_Z, Math.PI, 0.012)], 0.016, false, 14, 6));
    leather.push(strap([RING, profile.surface(-0.8, Math.PI * 0.95, 0.012), profile.surface(-0.95, Math.PI * 0.75, 0.012), new THREE.Vector3(0, 0.0, -1.02)], 0.016, false, 16, 6));
    // argola de metal da encomenda (plano YZ: a corda passa por ela)
    const ring = new THREE.TorusGeometry(0.06, 0.011, 8, 20);
    ring.rotateY(Math.PI / 2);
    ring.translate(RING.x, RING.y - 0.04, RING.z);
    metal.push(ring);
    // pequena presilha D onde as tiras encontram a argola
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
    // focinheira (ao redor da base do bico) e testeira (ao redor da cabeça)
    const nose = new THREE.TorusGeometry(0.165, 0.011, 6, 24); nose.translate(0, -0.005, -0.12); hl.push(nose);
    const crown = new THREE.TorusGeometry(0.19, 0.011, 6, 28); crown.rotateX(-0.35); crown.translate(0, 0.02, 0.07); hl.push(crown);
    for (const sx of [-1, 1]) {
      hl.push(limb(new THREE.Vector3(sx * 0.19, -0.04, 0.06), new THREE.Vector3(sx * 0.165, -0.05, -0.12), 0.011, 6, 2));
      const r = new THREE.TorusGeometry(0.032, 0.007, 6, 14);
      r.rotateY(Math.PI / 2); r.translate(sx * 0.185, -0.045, -0.12);
      hm.push(r);
      bitRings.push(new THREE.Vector3(sx * 0.205, -0.045, -0.12)); // local do headGroup
    }
    headGroup.add(new THREE.Mesh(mergeAll(hl), leatherMat));
    headGroup.add(new THREE.Mesh(mergeAll(hm), metalMat));
  }

  // ------------------------------ cavaleiro ---------------------------
  const C = { jacket: 0x2b3444, trousers: 0x2a2731, boots: 0x3a281b, skin: 0xc99b7c, hair: 0x2a1a10, pack: 0x6b4a2a, scarf: 0xc26e2b, belt: 0x3a281b, glove: 0x5a4030 };
  const PELVIS = new THREE.Vector3(0, 0.52, SADDLE_Z + 0.02);
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
      // bota: cano + pé
      const shinDir = ankle.clone().sub(knee).normalize();
      lg.push(paint(limb(ankle.clone().addScaledVector(shinDir, -0.17), ankle, 0.068, 10), C.boots));
      lg.push(paint(limb(ankle, new THREE.Vector3(ankle.x + sx * 0.01, ankle.y - 0.04, ankle.z - 0.2), 0.052, 10), C.boots));
    }
    riderLegs.add(new THREE.Mesh(mergeAll(lg), riderMat));

    // --- tronco, braços, cabeça, mochila (inclinam juntos) ---
    const ug = [];
    const torso = sphere(1, new THREE.Vector3(0, 0.3, -0.03), [0.2, 0.27, 0.14], 18, 12);
    ug.push(paint(torso, C.jacket));
    ug.push(paint(limb(new THREE.Vector3(-0.2, 0.49, -0.08), new THREE.Vector3(0.2, 0.49, -0.08), 0.085, 10), C.jacket)); // ombros
    ug.push(paint(limb(new THREE.Vector3(0, 0.5, -0.1), new THREE.Vector3(0, 0.62, -0.13), 0.05, 10), C.skin)); // pescoço
    ug.push(paint(sphere(0.11, new THREE.Vector3(0, 0.73, -0.14), [0.95, 1.05, 1], 18, 14), C.skin)); // cabeça
    // cabelo: calota + coque
    const hair = new THREE.SphereGeometry(0.118, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62);
    hair.rotateX(0.35); hair.scale(0.97, 1.05, 1.02); hair.translate(0, 0.735, -0.125);
    ug.push(paint(hair, C.hair));
    ug.push(paint(sphere(0.05, new THREE.Vector3(0, 0.75, -0.02), [1, 1, 1], 10, 8), C.hair));
    // lenço no pescoço
    const scarf = new THREE.TorusGeometry(0.078, 0.032, 8, 16); scarf.rotateX(Math.PI / 2); scarf.translate(0, 0.57, -0.11);
    ug.push(paint(scarf, C.scarf));
    // cinto
    const belt = new THREE.TorusGeometry(0.19, 0.02, 6, 20); belt.rotateX(Math.PI / 2); belt.scale(1, 1, 0.75); belt.translate(0, 0.1, -0.02);
    ug.push(paint(belt, C.belt));
    // braços à frente segurando as rédeas
    for (const sx of [-1, 1]) {
      const sh = new THREE.Vector3(sx * 0.22, 0.47, -0.09), el = new THREE.Vector3(sx * 0.25, 0.25, -0.32), hd = new THREE.Vector3(sx * 0.15, 0.28, -0.52);
      ug.push(paint(limb(sh, el, 0.052, 10), C.jacket));
      ug.push(paint(limb(el, hd, 0.044, 10), C.jacket));
      ug.push(paint(sphere(0.047, hd, [1, 0.85, 1.15], 10, 8), C.glove));
      hands.push(hd.clone());
    }
    // mochila com alças e rolo
    const pack = box(0.3, 0.3, 0.13, new THREE.Vector3(0, 0.32, 0.15), [0.1, 0, 0]);
    ug.push(paint(pack, C.pack));
    ug.push(paint(limb(new THREE.Vector3(-0.14, 0.49, 0.16), new THREE.Vector3(0.14, 0.49, 0.16), 0.045, 10), C.pack)); // rolo
    for (const sx of [-1, 1]) ug.push(paint(limb(new THREE.Vector3(sx * 0.12, 0.47, 0.1), new THREE.Vector3(sx * 0.12, 0.46, -0.16), 0.016, 6, 2), C.belt));
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
  const GLIDE_CYCLE = 7.5;
  const st = {
    time: rng() * 10, phase: rng() * Math.PI * 2, freq: 1.3, flapW: 1, boostW: 0, prevSpeed: DOVE.SPEED_CRUISE,
    tailSpread: 1, tailX: 0, tailY: 0, tailZ: 0, riderX: 0, riderZ: 0, headY: 0, sweep: 0, glideBase: 0.14,
  };
  const lerpTo = (cur, target, dt, rate) => cur + (target - cur) * Math.min(1, dt * rate);

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

    // ---- regime: bater (rápido/lento) ou planar ----
    let targetFreq, targetFlap;
    if (boost || climb > 0.3) { targetFreq = 2.2; targetFlap = 1; }
    else if (climb < -0.3) { targetFreq = 1.3; targetFlap = 0; }           // mergulho: planar
    else {
      targetFreq = speed < DOVE.SPEED_MIN + 8 ? 1.7 : 1.3;
      const c = (st.time % GLIDE_CYCLE) / GLIDE_CYCLE;
      const glide = steady && c > 0.4 && speed01 > 0.05;                   // 60% do ciclo planando
      targetFlap = glide ? 0 : 1;
    }
    st.freq = lerpTo(st.freq, targetFreq, dt, 3);
    st.flapW = lerpTo(st.flapW, targetFlap, dt, 2.5);
    st.boostW = lerpTo(st.boostW, boost || climb > 0.3 ? 1 : 0, dt, 3);
    st.phase += Math.PI * 2 * st.freq * dt;
    const ph = st.phase;
    const wave = (p) => Math.sin(p + 0.35 * Math.sin(p));                  // descida mais rápida que a subida
    const LAG = 0.55;
    const ampIn = 0.4 + 0.2 * st.boostW, ampOut = 0.44 + 0.2 * st.boostW;
    const t = st.time;
    const ripple = 0.025 * Math.sin(t * 5.6) + 0.015 * Math.sin(t * 10.7 + 1.3);
    const ripple2 = 0.03 * Math.sin(t * 5.6 - 0.8) + 0.02 * Math.sin(t * 12.1);
    st.glideBase = lerpTo(st.glideBase, 0.12 + 0.12 * (1 - speed01), dt, 2);
    const inner = st.flapW * (ampIn * wave(ph) + 0.06) + (1 - st.flapW) * (st.glideBase + ripple);
    const outer = st.flapW * (ampOut * wave(ph - LAG)) + (1 - st.flapW) * (-0.08 + ripple2);
    const twist = st.flapW * 0.16 * Math.cos(ph - LAG);
    st.sweep = lerpTo(st.sweep, 0.1 * st.boostW + 0.16 * Math.max(0, -climb) + 0.04 * (1 - st.flapW), dt, 3);
    for (const w of wings) {
      // asa direita: rot.z > 0 levanta a ponta; a esquerda é espelhada (scale.x = -1), logo o sinal inverte
      // no ombro, mas NÃO no punho (o espelho é aplicado depois da rotação do filho).
      w.shoulder.rotation.z = w.side * inner;
      w.shoulder.rotation.y = -w.side * st.sweep;   // recuo das asas (sweep) no boost/mergulho
      w.wrist.rotation.z = outer;
      w.wrist.rotation.x = twist;                   // bordo de ataque desce na batida para baixo
    }

    // ---- cauda: abre nas curvas / lentidão / subida, inclina com a curva ----
    const spread = THREE.MathUtils.clamp(1 + 0.3 * Math.abs(turn) + 0.22 * (1 - speed01) + 0.15 * Math.max(0, climb) + 0.08 * st.flapW, 0.85, 1.6);
    st.tailSpread = lerpTo(st.tailSpread, spread, dt, 4);
    st.tailX = lerpTo(st.tailX, 0.14 * climb + 0.05 * st.flapW * Math.sin(ph - 1.2) + 0.04, dt, 5);
    st.tailZ = lerpTo(st.tailZ, roll * 0.35 + turn * 0.12, dt, 4);
    st.tailY = lerpTo(st.tailY, -turn * 0.14, dt, 4);
    tailPivot.scale.set(st.tailSpread, 1, 1 - 0.15 * (st.tailSpread - 1));
    tailPivot.rotation.set(st.tailX, st.tailY, st.tailZ);

    // ---- cabeça: balanço sutil, olha para a curva ----
    st.headY = lerpTo(st.headY, turn * 0.22, dt, 4);
    headGroup.rotation.set(0.05 * st.flapW * Math.sin(ph - 0.6) - 0.06 * st.boostW, st.headY, 0);
    headGroup.position.y = HEAD_C.y + 0.015 * st.flapW * Math.sin(ph - 0.6);

    // ---- cavaleiro: inclina na curva, agacha no boost ----
    st.riderZ = lerpTo(st.riderZ, roll * 0.3 + turn * 0.08, dt, 3);
    st.riderX = lerpTo(st.riderX, -0.32 * st.boostW - 0.05 * Math.max(0, climb), dt, 3);
    riderUpper.rotation.set(st.riderX - 0.02 * st.flapW * Math.sin(ph - 0.3), 0, st.riderZ);
    riderUpper.updateMatrix();
    headGroup.updateMatrix();

    // ---- rédeas: das mãos até as argolas do bridão, com barriga ----
    const sag = 0.08 + 0.1 * (1 - st.boostW) + 0.02 * Math.sin(ph);
    for (let i = 0; i < 2; i++) {
      const sx = i === 0 ? -1 : 1;
      const h = TMP.v1.copy(hands[i]).applyMatrix4(riderUpper.matrix);
      const b = TMP.v2.copy(bitRings[i]).applyMatrix4(headGroup.matrix);
      reinCtrl[0].copy(h);
      reinCtrl[1].lerpVectors(h, b, 0.35).add(TMP.v3.set(sx * 0.1, -sag * 0.9, 0));
      reinCtrl[2].lerpVectors(h, b, 0.72).add(TMP.v3.set(sx * 0.09, -sag * 0.6, 0));
      reinCtrl[3].copy(b);
      ropes.update(i, reinCtrl);
    }
  }

  // pose inicial coerente
  update(1 / 60, { speed: DOVE.SPEED_CRUISE, boost: false, climbInput: 0, turnInput: 0, roll: 0 });

  return { group, packageAnchor, update, debug: st };
}
