// STUB — substituído pelo agente de UI/jogo. Contrato em ARCHITECTURE.md.
export function createDelivery({ elephants, flight, pkg, input, audio }) {
  const api = { target: elephants[0], count: 0, lostCount: 0, state: 'carrying', message: '', update(dt) {}, zoneStatus() { return { inZone: false, tooHigh: false, overCity: false, distance: 0 }; }, pickNext() {} };
  return api;
}
