// =====================================================================
//  RUPPEN — lógica das entregas.
//  Contrato (ARCHITECTURE.md 4.7):
//    createDelivery({ elephants, flight, pkg, input, audio }) →
//      { target, count, lostCount, state ('carrying'|'falling'|'done'),
//        update(dt), zoneStatus(), pickNext(), onEvent(cb) }
//  Eventos emitidos em onEvent(cb({ type, ... })):
//    'dropped'     — a cesta foi solta
//    'notInZone'   — tentou soltar fora da zona ({ reason: 'noPackage'|'notOverCity'|'tooHigh' })
//    'delivered'   — pousou no alvo ({ name, count })
//    'wrongCity'   — pousou em outro elefante ({ name, targetName })
//    'lost'        — caiu no mar/ilha ({ onWater, lostCount })
//    'newTarget'   — novo alvo escolhido ({ name, target })
// =====================================================================
import { DOVE, ELEPHANT, GAME } from '../config.js';

export function createDelivery({ elephants = [], flight, pkg, input, audio }) {
  const listeners = [];
  const timers = [];       // { t, fn } — ações agendadas (s)
  let rumbleIn = rand(GAME.RUMBLE_INTERVAL_MIN, GAME.RUMBLE_INTERVAL_MAX);

  function rand(a, b) { return a + Math.random() * (b - a); } // efêmero: pode usar Math.random
  function emit(ev) { for (const cb of listeners) { try { cb(ev); } catch (e) { console.warn('[delivery] onEvent', e); } } }
  function after(seconds, fn) { timers.push({ t: seconds, fn }); }
  function horizDist(a, bx, bz) { return Math.hypot(a.x - bx, a.z - bz); }

  // Alvo inicial: o elefante mais próximo do spawn da pomba.
  function nearestTo(x, z) {
    let best = null, bd = Infinity;
    for (const e of elephants) {
      const d = horizDist(e.position, x, z);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  const api = {
    target: nearestTo(DOVE.SPAWN.x, DOVE.SPAWN.z),
    count: 0,
    lostCount: 0,
    state: 'carrying',
    message: '',
    onEvent(cb) { if (typeof cb === 'function') listeners.push(cb); },
    update,
    zoneStatus,
    pickNext,
  };

  // Situação do jogador em relação à cidade-alvo.
  function zoneStatus() {
    const t = api.target, p = flight.state.position;
    if (!t) return { overCity: false, tooHigh: false, inZone: false, distance: Infinity, heightAbove: 0 };
    const overCity = t.isOverCity(p.x, p.z);
    const heightAbove = p.y - t.cityTop;
    const inZone = overCity && heightAbove > 0 && heightAbove <= ELEPHANT.DELIVERY_ABOVE_MAX;
    const tooHigh = overCity && heightAbove > ELEPHANT.DELIVERY_ABOVE_MAX;
    return { overCity, tooHigh, inZone, distance: horizDist(p, t.position.x, t.position.z), heightAbove };
  }

  // Próximo alvo: outro elefante, de preferência entre 8 e 25 km do jogador.
  function pickNext() {
    const p = flight.state.position;
    const others = elephants.filter((e) => e !== api.target);
    if (others.length === 0) return api.target;
    const preferred = others.filter((e) => { const d = horizDist(p, e.position.x, e.position.z); return d >= GAME.NEXT_PREFER_MIN && d <= GAME.NEXT_PREFER_MAX; });
    const pool = preferred.length ? preferred : others;
    api.target = pool[Math.floor(Math.random() * pool.length)];
    return api.target;
  }

  function ensurePackage() { if (!pkg.attached && !pkg.falling) pkg.attachNew(); }

  function tryDrop() {
    if (api.state !== 'carrying') return;
    if (!pkg.canDrop()) { emit({ type: 'notInZone', reason: 'noPackage' }); return; }
    const z = zoneStatus();
    if (!z.inZone) { emit({ type: 'notInZone', reason: !z.overCity ? 'notOverCity' : z.tooHigh ? 'tooHigh' : 'tooLow', zone: z }); return; }
    if (pkg.drop()) { api.state = 'falling'; api.message = ''; emit({ type: 'dropped' }); }
  }

  pkg.onLanded(({ elephant }) => {
    if (elephant === api.target) {
      api.count++;
      api.state = 'done';
      emit({ type: 'delivered', name: elephant.name, count: api.count });
      audio?.chime?.();
      after(GAME.NEXT_TARGET_DELAY, () => {
        pickNext();
        ensurePackage();
        api.state = 'carrying';
        emit({ type: 'newTarget', name: api.target?.name, target: api.target });
      });
    } else {
      api.state = 'done';
      emit({ type: 'wrongCity', name: elephant.name, targetName: api.target?.name });
      after(GAME.WRONG_CITY_DELAY, () => { ensurePackage(); api.state = 'carrying'; });
    }
  });
  pkg.onLost(({ onWater }) => {
    api.lostCount++;
    api.state = 'done';
    audio?.splash?.();
    emit({ type: 'lost', onWater: !!onWater, lostCount: api.lostCount });
    after(GAME.LOST_DELAY, () => { ensurePackage(); api.state = 'carrying'; });
  });

  // Clique do mapa (o mapa dispara 'ruppen:mapstate' com bubbles: true).
  if (typeof window !== 'undefined') window.addEventListener('ruppen:mapstate', () => audio?.map?.());

  function update(dt) {
    if (!(dt > 0)) return;
    // ações agendadas
    for (let i = timers.length - 1; i >= 0; i--) {
      const tm = timers[i]; tm.t -= dt;
      if (tm.t <= 0) { timers.splice(i, 1); try { tm.fn(); } catch (e) { console.warn('[delivery] timer', e); } }
    }
    // segurança: se a cesta sumiu sem evento (ex.: caiu por timeout) e nada está agendado, nova cesta
    if (api.state === 'falling' && !pkg.falling && !pkg.attached && timers.length === 0) { ensurePackage(); api.state = 'carrying'; }
    if (api.state === 'carrying' && pkg.attached === false && !pkg.falling && timers.length === 0) ensurePackage();

    if (input && (input.justPressed('Space') || input.justPressed('KeyE'))) tryDrop();

    // vento proporcional à velocidade (SPEED_MIN..SPEED_BOOST → 0..1)
    const sp = flight.state.speed;
    const w = (sp - DOVE.SPEED_MIN) / (DOVE.SPEED_BOOST - DOVE.SPEED_MIN);
    audio?.setWind?.(w < 0 ? 0 : w > 1 ? 1 : w);

    // ronco distante de vez em quando, se há algum elefante por perto
    rumbleIn -= dt;
    if (rumbleIn <= 0) {
      rumbleIn = rand(GAME.RUMBLE_INTERVAL_MIN, GAME.RUMBLE_INTERVAL_MAX);
      const p = flight.state.position;
      if (elephants.some((e) => horizDist(p, e.position.x, e.position.z) < GAME.RUMBLE_DIST)) audio?.rumble?.();
    }
  }

  return api;
}
