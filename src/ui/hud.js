// =====================================================================
//  RUPPEN — HUD: só texto sobre o jogo (sem caixas), no estilo das legendas
//  das referências (branco em negrito com a palavra-chave em amarelo).
//  Contrato (ARCHITECTURE.md 4.7):
//    createHUD({ root, delivery, flight, elephants, input, camera }) → { update(dt), toast(msg, ms) }
//  Eventos DOM (em root):
//    dispara 'ruppen:togglemap' (clique na setinha) e escuta 'ruppen:mapstate' ({ detail: { open } }).
// =====================================================================
import * as THREE from 'three';
import { HUD as H } from '../config.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Cria um elemento com classe e (opcional) texto.
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
// Distância legível em pt-BR: "12,4 km" / "850 m".
export function formatDistance(m) {
  if (!Number.isFinite(m)) return '—';
  if (m < 1000) return `${Math.max(0, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

export function createHUD({ root, delivery, flight, elephants = [], input, camera }) {
  // ------------------------------ DOM ---------------------------------
  const hud = el('div', 'hud');
  const top = el('div', 'hud-top');
  const label = el('div', 'hud-label', 'Entregar em');
  const city = el('div', 'hud-city', '—');
  const dist = el('div', 'hud-dist', '');
  const count = el('div', 'hud-count', 'Entregas: 0');
  const hint = el('div', 'hud-hint', '');
  top.append(label, city, dist, count, hint);

  const mapBtn = el('button', 'hud-mapbtn', '›');
  mapBtn.type = 'button'; mapBtn.title = 'Mapa (M)'; mapBtn.setAttribute('aria-label', 'Abrir o mapa (M)'); mapBtn.tabIndex = -1;

  const help = el('div', 'hud-help');
  help.append(
    helpItem('W/S', 'subir e descer'), sep(), helpItem('A/D', 'virar'), sep(), helpItem('Shift', 'acelerar'), sep(),
    helpItem('Espaço', 'soltar encomenda'), sep(), helpItem('M', 'mapa'), sep(), helpItem('H', 'ajuda'),
  );
  function helpItem(key, what) { const s = el('span', 'hud-help-item'); s.append(el('b', '', key), ' ' + what); return s; }
  function sep() { return el('span', 'hud-help-sep', '·'); }

  const tele = el('div', 'hud-tele');
  const teleAlt = el('span', 'hud-tele-alt', 'alt 0 m');
  const teleSpd = el('span', 'hud-tele-spd', '0 m/s');
  tele.append(teleAlt, teleSpd);

  const toastEl = el('div', 'hud-toast');

  // indicador do alvo: losango + nome (na tela) e seta na borda (fora da tela)
  const marker = el('div', 'hud-marker');
  const diamond = el('div', 'hud-marker-diamond');
  const markerName = el('div', 'hud-marker-name', '');
  const markerDist = el('div', 'hud-marker-dist', '');
  marker.append(diamond, markerName, markerDist);
  const edge = el('div', 'hud-edge');
  const edgeSvg = document.createElementNS(SVG_NS, 'svg');
  edgeSvg.setAttribute('viewBox', '0 0 40 40'); edgeSvg.setAttribute('width', '40'); edgeSvg.setAttribute('height', '40');
  const edgePath = document.createElementNS(SVG_NS, 'path');
  edgePath.setAttribute('d', 'M4 20 L30 8 L24 20 L30 32 Z');   // seta apontando para −X (esquerda); giramos via CSS
  edgePath.setAttribute('class', 'hud-edge-arrow');
  edgeSvg.append(edgePath);
  const edgeName = el('div', 'hud-edge-name', '');
  edge.append(edgeSvg, edgeName);

  hud.append(top, mapBtn, help, tele, marker, edge, toastEl);
  root.appendChild(hud);

  // ----------------------------- estado -------------------------------
  let helpTimer = H.HELP_INITIAL_TIME;
  let toastTimer = 0, toastDur = 1;
  let flashText = '', flashTimer = 0;   // dica breve (ex.: "Você não está sobre a cidade")
  let pulseT = 0;
  let mapOpen = false;
  const toastQueue = [];

  mapBtn.addEventListener('click', () => {
    mapBtn.blur();
    root.dispatchEvent(new CustomEvent('ruppen:togglemap', { bubbles: true }));
  });
  root.addEventListener('ruppen:mapstate', (e) => setMapOpen(!!(e.detail && e.detail.open)));
  function setMapOpen(open) {
    mapOpen = open;
    mapBtn.textContent = open ? '‹' : '›';
    mapBtn.title = open ? 'Fechar o mapa (M / Esc)' : 'Mapa (M)';
    hud.classList.toggle('hud--mapopen', open);
  }

  // ------------------------------ toast -------------------------------
  // toast(msg, ms): texto simples; msg pode ser string ou [{ text, accent }] para destacar palavras.
  function toast(msg, ms = H.TOAST_TIME) {
    toastQueue.push({ msg, ms });
    if (toastTimer <= 0) showNextToast();
  }
  function showNextToast() {
    const next = toastQueue.shift();
    if (!next) return;
    toastEl.replaceChildren();
    const parts = Array.isArray(next.msg) ? next.msg : [{ text: String(next.msg) }];
    for (const p of parts) { const s = el('span', p.accent ? 'accent' : '', p.text); toastEl.append(s); }
    toastEl.classList.add('show');
    toastDur = next.ms / 1000; toastTimer = toastDur;
    styleToast();
  }
  function flash(text) { flashText = text; flashTimer = H.FLASH_TIME; }
  // Animação do aviso guiada pelo tempo de jogo (entra com escala, some com fade).
  function styleToast() {
    const p = 1 - toastTimer / toastDur;                  // 0..1
    const ease = (k) => 1 - (1 - k) * (1 - k);
    let op, sc = 1, dy = 0;
    if (p < 0.12) { const k = ease(p / 0.12); op = k; sc = 0.86 + 0.17 * k; }
    else if (p < 0.22) { const k = (p - 0.12) / 0.1; op = 1; sc = 1.03 - 0.03 * k; }
    else if (p < 0.8) { op = 1; }
    else { const k = (p - 0.8) / 0.2; op = 1 - k; sc = 1 + 0.04 * k; dy = -6 * k; }
    toastEl.style.opacity = op.toFixed(3);
    toastEl.style.transform = `translateY(${dy.toFixed(1)}px) scale(${sc.toFixed(3)})`;
  }

  // ------------------------ eventos da entrega ------------------------
  delivery.onEvent?.((ev) => {
    switch (ev.type) {
      case 'delivered':
        toast([{ text: 'Entregue em ' }, { text: ev.name + '!', accent: true }], 2500);
        break;
      case 'newTarget':
        toast([{ text: 'Nova entrega: ' }, { text: ev.name, accent: true }], 2600);
        break;
      case 'wrongCity':
        toast([{ text: 'Cidade errada! ' }, { text: 'Era para ' + ev.targetName, accent: true }], 2800);
        break;
      case 'lost':
        toast(ev.onWater ? 'A encomenda caiu no mar…' : 'A encomenda se perdeu na ilha…', 2600);
        break;
      case 'notInZone':
        if (ev.reason === 'noPackage') flash('Aguarde a próxima encomenda');
        else if (ev.reason === 'tooHigh') flash('Alto demais: desça até perto da cidade');
        else flash('Você precisa estar sobre a cidade de ' + (delivery.target?.name || ''));
        break;
      default: break;
    }
  });

  // --------------------------- projeção do alvo -----------------------
  const vCam = new THREE.Vector3(), vNdc = new THREE.Vector3();
  function updateMarker() {
    const t = delivery.target;
    if (!t || !t.deliveryMarker || !camera || mapOpen) { marker.style.display = 'none'; edge.style.display = 'none'; return; }
    const W = window.innerWidth, Hh = window.innerHeight;
    const p = t.deliveryMarker;
    camera.updateMatrixWorld();
    vCam.copy(p).applyMatrix4(camera.matrixWorldInverse);
    const behind = vCam.z > 0;                 // a câmera olha para −Z no seu espaço
    vNdc.copy(p).project(camera);
    let nx = vNdc.x, ny = vNdc.y;
    if (behind) { nx = -nx; ny = -ny; }
    const onScreen = !behind && nx > -1 && nx < 1 && ny > -1 && ny < 1;
    const zs = delivery.zoneStatus();
    if (onScreen) {
      edge.style.display = 'none';
      if (zs.distance < H.MARKER_MIN_DIST || zs.overCity) { marker.style.display = 'none'; return; }
      const sx = ((nx + 1) / 2) * W, sy = ((1 - ny) / 2) * Hh;
      // não sobrepor o bloco de texto do topo (que já diz nome e distância)
      const tr = top.getBoundingClientRect();
      if (sy < tr.bottom + 40 && sx > tr.left + tr.width * 0.5 - 240 && sx < tr.left + tr.width * 0.5 + 240) { marker.style.display = 'none'; return; }
      marker.style.display = '';
      marker.style.transform = `translate(${sx}px, ${sy}px)`;
      markerName.textContent = t.name;
      markerDist.textContent = formatDistance(zs.distance);
      return;
    }
    // fora da tela: leva o ponto até a borda do retângulo (com margem), a partir do centro
    marker.style.display = 'none';
    if (zs.overCity || zs.distance < H.MARKER_MIN_DIST) { edge.style.display = 'none'; return; } // já estamos lá: a dica diz o que fazer
    edge.style.display = '';
    const cx = W / 2, cy = Hh / 2;
    let dx = nx * cx, dy = -ny * cy;            // vetor em px a partir do centro
    if (behind && Math.abs(dx) < 1 && Math.abs(dy) < 1) dy = cy; // exatamente atrás: aponta para baixo
    const m = H.EDGE_MARGIN;
    const sx = Math.abs(dx) > 1e-6 ? (cx - m) / Math.abs(dx) : Infinity;
    const sy = Math.abs(dy) > 1e-6 ? (cy - m) / Math.abs(dy) : Infinity;
    const s = Math.min(sx, sy);
    let ex = cx + dx * s, ey = cy + dy * s;
    // não sobrepor o bloco de texto do topo: desce a seta para logo abaixo dele
    const tr = top.getBoundingClientRect();
    let underCaption = false;
    if (ey < tr.bottom + 28 && Math.abs(ex - W / 2) < 300) { ey = tr.bottom + 28; underCaption = true; }
    const ang = Math.atan2(dy, dx) * 180 / Math.PI;     // 0° = direita
    edge.style.transform = `translate(${ex}px, ${ey}px)`;
    edgeSvg.style.transform = `rotate(${ang + 180}deg)`;  // o path aponta para a esquerda
    edgeName.textContent = underCaption ? '' : `${t.name} · ${formatDistance(zs.distance)}`;
    edge.classList.toggle('hud-edge--left', ex < W * 0.25);
    edge.classList.toggle('hud-edge--right', ex > W * 0.75);
    edge.classList.toggle('hud-edge--top', ey < Hh * 0.25);
    edge.classList.toggle('hud-edge--bottom', ey > Hh * 0.75);
  }

  // ------------------------------ update ------------------------------
  function update(dt) {
    dt = dt > 0 ? Math.min(dt, 0.1) : 0;
    pulseT += dt;
    const t = delivery.target;
    const zs = delivery.zoneStatus();

    // topo
    city.textContent = t ? t.name : '—';
    dist.textContent = formatDistance(zs.distance);
    count.textContent = `Entregas: ${delivery.count}`;

    // dica contextual
    let text = '', cls = '';
    if (flashTimer > 0) { flashTimer -= dt; text = flashText; cls = 'warn'; }
    else if (delivery.state === 'falling') text = 'Encomenda caindo…';
    else if (delivery.state === 'done') text = '';
    else if (zs.inZone) { text = 'Pressione ESPAÇO para soltar a encomenda'; cls = 'pulse'; }
    else if (zs.overCity && zs.tooHigh) text = 'Desça até a cidade para entregar';
    else if (zs.distance < H.HINT_NEAR_DIST) text = 'Aproxime-se da cidade';
    if (hint.textContent !== text) hint.textContent = text;
    hint.className = 'hud-hint' + (cls ? ' ' + cls : '') + (text ? ' show' : '');

    // ajuda dos controles
    if (input && input.justPressed('KeyH')) helpTimer = helpTimer > 0 ? 0 : H.HELP_RECALL_TIME;
    if (helpTimer > 0) helpTimer -= dt;
    help.classList.toggle('show', helpTimer > 0);

    // telemetria
    const st = flight.state;
    teleAlt.textContent = `alt ${Math.round(st.position.y)} m`;
    teleSpd.textContent = `${Math.round(st.speed)} m/s`;

    // toast
    if (toastTimer > 0) {
      toastTimer -= dt;
      if (toastTimer <= 0) { toastEl.classList.remove('show'); toastEl.style.opacity = '0'; if (toastQueue.length) showNextToast(); }
      else styleToast();
    }

    updateMarker();
  }

  return { update, toast, get element() { return hud; }, setMapOpen };
}
