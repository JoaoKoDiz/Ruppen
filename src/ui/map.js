// =====================================================================
//  RUPPEN — mapa do mundo: painel que desliza da esquerda até o centro,
//  com o jogo borrado atrás; <canvas> 2D redesenhado a cada quadro enquanto
//  aberto (ilhas, elefantes em movimento com tracejado curto à frente,
//  alvo dourado pulsante, jogador, grade, escala e bússola).
//  Contrato (ARCHITECTURE.md 4.7):
//    createMapUI({ root, worldData, elephants, flight, delivery, input, camera })
//      → { update(dt), isOpen, toggle(), open(), close() }
//  Eventos DOM (em root): escuta 'ruppen:togglemap'; dispara 'ruppen:mapstate' { detail: { open } }.
//  Eixos: mundo x → direita, mundo z → baixo.
// =====================================================================
import { WORLD, MAP_UI as M, UI_COLORS as C } from '../config.js';

const TAU = Math.PI * 2;

export function createMapUI({ root, worldData, elephants = [], flight, delivery, input, camera }) {
  // ------------------------------ DOM ---------------------------------
  const backdrop = document.createElement('div'); backdrop.className = 'map-backdrop';
  const panel = document.createElement('div'); panel.className = 'map-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Mapa');
  const head = document.createElement('div'); head.className = 'map-head';
  const title = document.createElement('div'); title.className = 'map-title'; title.textContent = 'Mapa';
  const sub = document.createElement('div'); sub.className = 'map-sub'; sub.textContent = '';
  const closeBtn = document.createElement('button'); closeBtn.className = 'map-close'; closeBtn.type = 'button'; closeBtn.textContent = '✕'; closeBtn.title = 'Fechar (Esc)'; closeBtn.tabIndex = -1;
  head.append(title, sub, closeBtn);
  const body = document.createElement('div'); body.className = 'map-body';
  const canvas = document.createElement('canvas'); canvas.className = 'map-canvas';
  body.append(canvas);
  panel.append(head, body);
  root.append(backdrop, panel);
  const ctx = canvas.getContext('2d');

  // ----------------------------- estado -------------------------------
  let open = false;
  let time = 0;
  let cw = 0, ch = 0, dpr = 1;          // tamanho lógico do canvas e razão de pixels
  // projeção mundo → canvas
  let scale = 1, ox = 0, oy = 0;
  const islands = (worldData && worldData.islands) || [];
  const bounds = (worldData && worldData.bounds) || { min: -WORLD.HALF, max: WORLD.HALF };
  // contornos das ilhas (fixos) — calculados uma vez, em coordenadas do mundo
  const outlines = islands.map((isl) => {
    const poly = isl.outlinePolygon(M.OUTLINE_POINTS);
    const inner = (k) => poly.map((p) => ({ x: isl.cx + (p.x - isl.cx) * k, z: isl.cz + (p.z - isl.cz) * k }));
    return { island: isl, poly, forest: inner(M.FOREST_SCALE), rock: inner(M.ROCK_SCALE) };
  });

  function setOpen(v) {
    if (open === v) return;
    open = v;
    backdrop.classList.toggle('open', open);
    panel.classList.toggle('open', open);
    if (open) { resize(); draw(); }
    root.dispatchEvent(new CustomEvent('ruppen:mapstate', { detail: { open }, bubbles: true }));
  }
  const api = {
    get isOpen() { return open; },
    open() { setOpen(true); },
    close() { setOpen(false); },
    toggle() { setOpen(!open); },
    update,
    draw,
  };

  root.addEventListener('ruppen:togglemap', () => api.toggle());
  closeBtn.addEventListener('click', () => { closeBtn.blur(); api.close(); });
  backdrop.addEventListener('click', () => api.close());
  window.addEventListener('resize', () => { if (open) { resize(); draw(); } });

  // ---------------------------- geometria -----------------------------
  function resize() {
    const r = body.getBoundingClientRect();
    const w = Math.max(1, Math.floor(r.width)), h = Math.max(1, Math.floor(r.height));
    const d = Math.min(window.devicePixelRatio || 1, 2);
    if (w === cw && h === ch && d === dpr) return;
    cw = w; ch = h; dpr = d;
    canvas.width = Math.round(w * d); canvas.height = Math.round(h * d);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    const span = bounds.max - bounds.min;
    scale = (Math.min(cw, ch) - 2 * M.PADDING) / span;
    ox = cw / 2 - ((bounds.min + bounds.max) / 2) * scale;
    oy = ch / 2 - ((bounds.min + bounds.max) / 2) * scale;
  }
  const mx = (x) => ox + x * scale;
  const my = (z) => oy + z * scale;

  function polyPath(pts) {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) { const p = pts[i]; if (i === 0) ctx.moveTo(mx(p.x), my(p.z)); else ctx.lineTo(mx(p.x), my(p.z)); }
    ctx.closePath();
  }

  // Silhueta de elefante (frente = +x), ~20 px com s = 1.
  function elephantPath(s) {
    const p = new Path2D();
    // patas (3 visíveis)
    p.rect(-6.5 * s, 1.5 * s, 2.8 * s, 7.5 * s); p.rect(-2.2 * s, 2 * s, 2.8 * s, 7 * s); p.rect(2.4 * s, 1.5 * s, 2.8 * s, 7.5 * s);
    // cauda
    p.moveTo(-6.5 * s, -1.5 * s); p.lineTo(-9.5 * s, 3.5 * s); p.lineTo(-8.5 * s, 4 * s); p.lineTo(-6 * s, 0);
    // corpo
    p.moveTo(7 * s, 0); p.ellipse(0, 0, 7.2 * s, 5 * s, 0, 0, TAU);
    // cabeça
    p.moveTo(12 * s, -1.5 * s); p.arc(8.2 * s, -1.6 * s, 4 * s, 0, TAU);
    // orelha
    p.moveTo(7.5 * s, -1 * s); p.ellipse(5.4 * s, -1 * s, 2.1 * s, 3.1 * s, 0.15, 0, TAU);
    // tromba (curva para baixo e enrola)
    p.moveTo(11.2 * s, -1 * s); p.quadraticCurveTo(14.6 * s, 0.5 * s, 14 * s, 6.5 * s);
    p.quadraticCurveTo(13.6 * s, 8 * s, 12.2 * s, 7.2 * s); p.quadraticCurveTo(12.6 * s, 2 * s, 10.2 * s, 1.2 * s); p.closePath();
    // presa
    p.moveTo(10.5 * s, 1.2 * s); p.quadraticCurveTo(13.5 * s, 3 * s, 15 * s, 2 * s); p.quadraticCurveTo(13.6 * s, 4.2 * s, 10.2 * s, 2.4 * s); p.closePath();
    return p;
  }
  const ELE_PATH = elephantPath(1);
  // Pomba vista de cima (frente = +x).
  function dovePath() {
    const p = new Path2D();
    p.moveTo(11, 0);
    p.quadraticCurveTo(4, -3, -1, -2.2);          // flanco superior
    p.lineTo(-2, -12); p.lineTo(-6, -11.5); p.lineTo(-5.5, -2.5);  // asa superior
    p.lineTo(-11, -4); p.lineTo(-12.5, 0); p.lineTo(-11, 4);        // cauda em leque
    p.lineTo(-5.5, 2.5); p.lineTo(-6, 11.5); p.lineTo(-2, 12); p.lineTo(-1, 2.2);  // asa inferior
    p.quadraticCurveTo(4, 3, 11, 0);
    p.closePath();
    return p;
  }
  const DOVE_PATH = dovePath();

  // ------------------------------ desenho -----------------------------
  function draw() {
    if (!ctx || cw === 0) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // oceano
    ctx.fillStyle = C.mapOcean; ctx.fillRect(0, 0, cw, ch);
    // grade a cada 10 km (só dentro do mundo)
    ctx.save();
    ctx.beginPath(); ctx.rect(mx(bounds.min), my(bounds.min), (bounds.max - bounds.min) * scale, (bounds.max - bounds.min) * scale); ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
    for (let v = bounds.min; v <= bounds.max + 1; v += M.GRID_STEP) {
      ctx.beginPath(); ctx.moveTo(mx(v) + 0.5, my(bounds.min)); ctx.lineTo(mx(v) + 0.5, my(bounds.max)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(mx(bounds.min), my(v) + 0.5); ctx.lineTo(mx(bounds.max), my(v) + 0.5); ctx.stroke();
    }
    ctx.restore();
    // limites do mundo
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1.2;
    ctx.setLineDash([6, 5]);
    ctx.strokeRect(mx(bounds.min) + 0.5, my(bounds.min) + 0.5, (bounds.max - bounds.min) * scale, (bounds.max - bounds.min) * scale);
    ctx.setLineDash([]);

    // ilhas
    for (const o of outlines) {
      polyPath(o.poly);
      ctx.fillStyle = C.mapGrass; ctx.fill();
      ctx.strokeStyle = C.mapSand; ctx.lineWidth = 2.2; ctx.lineJoin = 'round'; ctx.stroke();
      polyPath(o.forest); ctx.fillStyle = C.mapForest; ctx.fill();
      polyPath(o.rock); ctx.fillStyle = C.mapRock; ctx.fill();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.font = 'italic 11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    for (const o of outlines) {
      const isl = o.island;
      const y = my(isl.cz) + isl.boundRadius * scale * 0.72;
      strokedText(isl.name, mx(isl.cx), y, 'rgba(255,255,255,0.85)', 'rgba(10,30,60,0.7)');
    }

    // tracejado curto à frente de cada elefante
    ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.4;
    for (const e of elephants) {
      if (!e.route || typeof e.route.aheadPoints !== 'function') continue;
      const pts = e.route.aheadPoints(e.u, M.AHEAD_METERS, M.AHEAD_POINTS);
      ctx.beginPath();
      pts.forEach((p, i) => { if (i === 0) ctx.moveTo(mx(p.x), my(p.z)); else ctx.lineTo(mx(p.x), my(p.z)); });
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // linha tênue do jogador até o alvo
    const target = delivery && delivery.target;
    const pp = flight.state.position;
    if (target) {
      ctx.strokeStyle = 'rgba(245,213,74,0.35)'; ctx.lineWidth = 1; ctx.setLineDash([2, 6]);
      ctx.beginPath(); ctx.moveTo(mx(pp.x), my(pp.z)); ctx.lineTo(mx(target.position.x), my(target.position.z)); ctx.stroke();
      ctx.setLineDash([]);
    }

    // elefantes
    ctx.font = '600 11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    for (const e of elephants) {
      const isTarget = e === target;
      const x = mx(e.position.x), y = my(e.position.z);
      if (isTarget) {
        const k = 0.5 + 0.5 * Math.sin(time * 4);
        ctx.beginPath(); ctx.arc(x, y, 15 + 5 * k, 0, TAU);
        ctx.strokeStyle = `rgba(245,213,74,${0.9 - 0.5 * k})`; ctx.lineWidth = 2; ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, 12, 0, TAU);
        ctx.fillStyle = 'rgba(245,213,74,0.18)'; ctx.fill();
      }
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-e.heading);         // frente do elefante no mundo = (cos h, 0, −sin h) → no mapa (cos h, −sin h)
      ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = isTarget ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.9)';
      ctx.stroke(ELE_PATH);
      ctx.fillStyle = isTarget ? C.accent : '#cfd3d9';
      ctx.fill(ELE_PATH);
      ctx.restore();
      strokedText(e.name, x, y + 13, isTarget ? C.accent : 'rgba(255,255,255,0.92)', 'rgba(5,20,45,0.8)');
    }

    // jogador
    {
      const x = mx(pp.x), y = my(pp.z), h = flight.state.heading;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(-Math.cos(h), -Math.sin(h)));   // frente da pomba no mundo = (−sin h, 0, −cos h)
      ctx.scale(0.85, 0.85);
      ctx.lineJoin = 'round'; ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(10,30,60,0.85)';
      ctx.stroke(DOVE_PATH);
      ctx.fillStyle = '#ffffff'; ctx.fill(DOVE_PATH);
      ctx.restore();
      ctx.font = '600 10px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      strokedText('você', x, y + 12, 'rgba(255,255,255,0.9)', 'rgba(5,20,45,0.8)');
    }

    // escala (5 km) — canto inferior esquerdo
    {
      const len = M.SCALE_BAR * scale, x0 = 18, y0 = ch - 22;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + len, y0); ctx.moveTo(x0, y0 - 5); ctx.lineTo(x0, y0 + 5); ctx.moveTo(x0 + len, y0 - 5); ctx.lineTo(x0 + len, y0 + 5); ctx.stroke();
      ctx.font = '600 11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      strokedText(`${M.SCALE_BAR / 1000} km`, x0, y0 - 6, 'rgba(255,255,255,0.9)', 'rgba(5,20,45,0.8)');
    }
    // bússola — canto superior direito
    {
      const x = cw - 34, y = 34;
      ctx.beginPath(); ctx.arc(x, y, 18, 0, TAU); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y - 14); ctx.lineTo(x + 5, y + 4); ctx.lineTo(x, y); ctx.lineTo(x - 5, y + 4); ctx.closePath();
      ctx.fillStyle = C.accent; ctx.fill();
      ctx.beginPath(); ctx.moveTo(x, y + 14); ctx.lineTo(x + 5, y - 4); ctx.lineTo(x, y); ctx.lineTo(x - 5, y - 4); ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fill();
      ctx.font = '700 10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      strokedText('N', x, y - 19, '#fff', 'rgba(5,20,45,0.8)');
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  }
  function strokedText(text, x, y, fill, stroke) {
    ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeStyle = stroke; ctx.strokeText(text, x, y);
    ctx.fillStyle = fill; ctx.fillText(text, x, y);
  }

  // ------------------------------ update ------------------------------
  function update(dt) {
    if (dt > 0) time += Math.min(dt, 0.1);
    if (input) {
      if (input.justPressed('KeyM')) api.toggle();
      else if (open && input.justPressed('Escape')) api.close();
    }
    if (!open) return;
    const t = delivery && delivery.target;
    const d = t ? Math.hypot(t.position.x - flight.state.position.x, t.position.z - flight.state.position.z) : NaN;
    const dText = !Number.isFinite(d) ? '' : d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(1).replace('.', ',')} km`;
    const subText = t ? `Entregar em ${t.name} · ${dText}` : '';
    if (sub.textContent !== subText) sub.textContent = subText;
    resize();
    draw();
  }

  return api;
}
