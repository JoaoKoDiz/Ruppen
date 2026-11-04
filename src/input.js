// STUB — substituído pelo agente de voo. Contrato em ARCHITECTURE.md.
export function createInput(domElement) {
  const down = new Set(); const pressed = new Set(); const cbs = []; let interacted = false;
  const first = () => { if (!interacted) { interacted = true; cbs.forEach((c) => c()); } };
  window.addEventListener('keydown', (e) => { if (!down.has(e.code)) pressed.add(e.code); down.add(e.code); first(); });
  window.addEventListener('keyup', (e) => down.delete(e.code));
  window.addEventListener('pointerdown', first);
  return {
    isDown: (c) => down.has(c), justPressed: (c) => pressed.has(c), endFrame: () => pressed.clear(),
    onFirstInteraction: (cb) => cbs.push(cb),
    axes: { pitch: 0, yaw: 0, boost: false },
    actions: { drop: 'Space', map: 'KeyM', boost: 'ShiftLeft' },
  };
}
