// =====================================================================
//  RUPPEN — entrada do jogador (teclado + ponteiro).
//  Contrato (ARCHITECTURE.md 4.6):
//    createInput(canvas) → { isDown(code), justPressed(code), endFrame(),
//      onFirstInteraction(cb), axes:{pitch,yaw,boost}, actions, pointer }
//  Teclas: W/↑ sobe o nariz, S/↓ desce, A/← e D/→ viram, Shift acelera,
//  Espaço/E solta a encomenda, M abre o mapa, Esc fecha (M/Esc NÃO são
//  consumidas aqui — o módulo de UI as trata). O arrasto do ponteiro sobre o
//  canvas alimenta pointer.dx/dy (olhar da câmera, opcional).
// =====================================================================

// Teclas cujo comportamento padrão do navegador atrapalha (rolagem, clique em botão focado).
const PREVENT_DEFAULT = new Set([
  'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight',
]);

// Mapeamento das teclas para os eixos (−1..1). Mais de uma tecla por direção.
const KEYS = {
  pitchUp: ['KeyW', 'ArrowUp'],
  pitchDown: ['KeyS', 'ArrowDown'],
  yawLeft: ['KeyA', 'ArrowLeft'],
  yawRight: ['KeyD', 'ArrowRight'],
  boost: ['ShiftLeft', 'ShiftRight'],
};

export function createInput(domElement) {
  const target = domElement || (typeof document !== 'undefined' ? document.body : null);
  const down = new Set();      // teclas atualmente pressionadas (e.code)
  const pressed = new Set();   // teclas que desceram neste quadro
  const released = new Set();  // teclas que subiram neste quadro
  const firstCbs = [];
  let interacted = false;

  const axes = { pitch: 0, yaw: 0, boost: false };
  const actions = { drop: 'Space', dropAlt: 'KeyE', map: 'KeyM', close: 'Escape', boost: 'ShiftLeft', boostAlt: 'ShiftRight' };
  // Ponteiro: posição normalizada (−1..1), deslocamento do quadro (px) e estado do arrasto.
  const pointer = { x: 0, y: 0, dx: 0, dy: 0, down: false, dragging: false, button: -1, touch: false };
  let lastPX = 0, lastPY = 0, activePointerId = null;

  const anyDown = (list) => { for (const c of list) if (down.has(c)) return true; return false; };
  function refreshAxes() {
    axes.pitch = (anyDown(KEYS.pitchUp) ? 1 : 0) - (anyDown(KEYS.pitchDown) ? 1 : 0);
    axes.yaw = (anyDown(KEYS.yawLeft) ? 1 : 0) - (anyDown(KEYS.yawRight) ? 1 : 0);
    axes.boost = anyDown(KEYS.boost);
  }
  function fireFirst() {
    if (interacted) return;
    interacted = true;
    for (const cb of firstCbs) { try { cb(); } catch (e) { console.warn('[input] onFirstInteraction', e); } }
  }
  const isEditable = (t) => !!t && !!t.tagName && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable === true);

  // ------------------------------ teclado ------------------------------
  function onKeyDown(e) {
    if (isEditable(e.target)) return;
    const code = e.code || e.key;
    if (!down.has(code)) pressed.add(code);   // ignora auto-repeat
    down.add(code);
    refreshAxes();
    fireFirst();
    if (PREVENT_DEFAULT.has(code) && !e.ctrlKey && !e.metaKey && !e.altKey && typeof e.preventDefault === 'function') e.preventDefault();
  }
  function onKeyUp(e) {
    const code = e.code || e.key;
    if (down.has(code)) released.add(code);
    down.delete(code);
    refreshAxes();
  }
  // Janela perde o foco / aba escondida: solta tudo (evita tecla "presa").
  function releaseAll() {
    down.clear();
    refreshAxes();
    pointer.down = false; pointer.dragging = false; pointer.button = -1; activePointerId = null;
  }
  function onVisibility() { if (document.visibilityState !== 'visible') releaseAll(); }

  // ------------------------------ ponteiro -----------------------------
  function onPointerDown(e) {
    fireFirst();
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    activePointerId = e.pointerId;
    pointer.down = true; pointer.dragging = true; pointer.button = e.button;
    pointer.touch = e.pointerType === 'touch';
    lastPX = e.clientX; lastPY = e.clientY;
    updateNormalized(e);
    try { e.target.setPointerCapture?.(e.pointerId); } catch (_) { /* sem captura: tudo bem */ }
  }
  function onPointerMove(e) {
    updateNormalized(e);
    if (!pointer.dragging || e.pointerId !== activePointerId) return;
    pointer.dx += e.clientX - lastPX;
    pointer.dy += e.clientY - lastPY;
    lastPX = e.clientX; lastPY = e.clientY;
  }
  function onPointerUp(e) {
    if (e.pointerId !== activePointerId) return;
    pointer.down = false; pointer.dragging = false; pointer.button = -1; activePointerId = null;
    try { e.target.releasePointerCapture?.(e.pointerId); } catch (_) { /* ignorar */ }
  }
  function updateNormalized(e) {
    const w = window.innerWidth || 1, h = window.innerHeight || 1;
    pointer.x = (e.clientX / w) * 2 - 1;
    pointer.y = -((e.clientY / h) * 2 - 1);
  }
  // Toque: evita o scroll/zoom do navegador sobre o canvas.
  function onTouchMove(e) { if (e.cancelable) e.preventDefault(); }
  function onContextMenu(e) { e.preventDefault(); }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', releaseAll);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
  if (target) {
    target.addEventListener('pointerdown', onPointerDown);
    target.addEventListener('pointermove', onPointerMove);
    target.addEventListener('pointerup', onPointerUp);
    target.addEventListener('pointercancel', onPointerUp);
    target.addEventListener('touchmove', onTouchMove, { passive: false });
    target.addEventListener('contextmenu', onContextMenu);
  }

  return {
    isDown: (code) => down.has(code),
    justPressed: (code) => pressed.has(code),
    justReleased: (code) => released.has(code),
    // Chamado pelo integrador no fim de cada quadro.
    endFrame() { pressed.clear(); released.clear(); pointer.dx = 0; pointer.dy = 0; },
    onFirstInteraction(cb) { if (interacted) cb(); else firstCbs.push(cb); },
    get interacted() { return interacted; },
    axes, actions, pointer,
    releaseAll,
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releaseAll);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      if (target) {
        target.removeEventListener('pointerdown', onPointerDown);
        target.removeEventListener('pointermove', onPointerMove);
        target.removeEventListener('pointerup', onPointerUp);
        target.removeEventListener('pointercancel', onPointerUp);
        target.removeEventListener('touchmove', onTouchMove);
        target.removeEventListener('contextmenu', onContextMenu);
      }
    },
  };
}
