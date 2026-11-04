// STUB — substituído pelo agente de UI. Contrato: createHUD({root, delivery, flight, elephants, input}) -> { update(dt), toast(msg, ms) }
export function createHUD({ root, delivery }) {
  const el = document.createElement('div'); el.style.cssText = 'position:absolute;top:16px;left:0;right:0;text-align:center;color:#fff;font:600 22px system-ui;text-shadow:0 2px 8px rgba(0,0,0,.6)';
  root.appendChild(el);
  return { update() { el.textContent = 'Entregar em: ' + (delivery.target?.name || '—'); }, toast() {} };
}
