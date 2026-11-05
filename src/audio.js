// =====================================================================
//  RUPPEN — áudio procedural (WebAudio, sem arquivos externos).
//  Contrato (ARCHITECTURE.md 4.7):
//    createAudio() → { unlock(), setWind(speed01), flap(), chime(), splash(), rumble(), map() }
//  Nada toca antes de unlock() (chamado pelo integrador na 1ª interação).
//  Se o AudioContext não existir ou falhar, todos os métodos viram no-ops.
// =====================================================================
import { AUDIO } from './config.js';

export function createAudio() {
  let ctx = null;          // AudioContext (criado preguiçosamente em unlock)
  let master = null;       // ganho mestre
  let noiseBuf = null;     // 2 s de ruído branco, reutilizado por todos os efeitos
  let wind = null;         // { src, filter, gain }
  let windLevel = 0;       // último valor pedido (0..1), aplicado quando o vento existir
  let rumbleBusy = false;  // evita roncos sobrepostos

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  // Executa uma função protegida: um erro no áudio nunca pode derrubar o jogo.
  const safe = (fn) => { if (!ctx) return; try { fn(); } catch (e) { console.warn('[audio]', e); } };

  function makeNoise() {
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // Vento: ruído em laço → passa-baixas → ganho; frequência/ganho seguem setWind.
  function buildWind() {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.Q.value = 0.7;
    filter.frequency.value = AUDIO.WIND_FREQ_MIN;
    // segundo filtro mais aberto dá um "sopro" leve nas altas
    const gain = ctx.createGain();
    gain.gain.value = AUDIO.WIND_GAIN_MIN;
    src.connect(filter); filter.connect(gain); gain.connect(master);
    src.start();
    wind = { src, filter, gain };
    applyWind(windLevel, true);
  }
  function applyWind(level, immediate) {
    if (!wind) return;
    const t = ctx.currentTime;
    const k = level * level * 0.6 + level * 0.4;  // curva: cresce mais no boost
    const freq = lerp(AUDIO.WIND_FREQ_MIN, AUDIO.WIND_FREQ_MAX, k);
    const g = lerp(AUDIO.WIND_GAIN_MIN, AUDIO.WIND_GAIN_MAX, k);
    if (immediate) { wind.filter.frequency.setValueAtTime(freq, t); wind.gain.gain.setValueAtTime(g, t); return; }
    wind.filter.frequency.setTargetAtTime(freq, t, AUDIO.WIND_SMOOTH);
    wind.gain.gain.setTargetAtTime(g, t, AUDIO.WIND_SMOOTH);
  }

  // Envelope de ganho simples: ataque linear, decaimento exponencial.
  function envGain(t0, peak, attack, decay) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    g.connect(master);
    return g;
  }
  function noiseSource(t0, dur) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.start(t0); src.stop(t0 + dur + 0.05);
    return src;
  }

  function unlock() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = AUDIO.MASTER;
      master.connect(ctx.destination);
      noiseBuf = makeNoise();
      buildWind();
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    } catch (e) {
      console.warn('[audio] WebAudio indisponível', e);
      ctx = null; master = null; wind = null;
    }
  }

  // Vento contínuo: 0 = velocidade mínima, 1 = boost.
  let lastWind = -1;
  function setWind(speed01) {
    const l = clamp01(Number(speed01) || 0);
    if (Math.abs(l - lastWind) < 0.01) return; // evita 2 eventos de automação por quadro
    lastWind = l; windLevel = l;
    safe(() => applyWind(windLevel, false));
  }

  // Batida de asa: sopro curto de ruído filtrado (~120 ms).
  function flap() {
    safe(() => {
      const t0 = ctx.currentTime;
      const src = noiseSource(t0, 0.14);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = 0.9;
      bp.frequency.setValueAtTime(500, t0);
      bp.frequency.exponentialRampToValueAtTime(1100, t0 + 0.06);
      bp.frequency.exponentialRampToValueAtTime(400, t0 + 0.13);
      const g = envGain(t0, 0.35, 0.04, 0.09);
      src.connect(bp); bp.connect(g);
    });
  }

  // Carrilhão da entrega: arpejo de 4 notas (seno + triângulo) com decaimento.
  function chime() {
    safe(() => {
      const t0 = ctx.currentTime + 0.02;
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
      notes.forEach((f, i) => {
        const t = t0 + i * 0.13;
        for (const [type, mul, vol] of [['sine', 1, 0.5], ['triangle', 2, 0.12]]) {
          const osc = ctx.createOscillator();
          osc.type = type; osc.frequency.value = f * mul;
          const g = envGain(t, vol, 0.012, 1.3 - i * 0.1);
          osc.connect(g);
          osc.start(t); osc.stop(t + 1.6);
        }
      });
    });
  }

  // Splash: rajada de ruído com varredura do passa-baixas (agudo → grave).
  function splash() {
    safe(() => {
      const t0 = ctx.currentTime;
      const src = noiseSource(t0, 0.7);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.Q.value = 1.2;
      lp.frequency.setValueAtTime(4200, t0);
      lp.frequency.exponentialRampToValueAtTime(260, t0 + 0.6);
      const g = envGain(t0, 0.6, 0.02, 0.6);
      src.connect(lp); lp.connect(g);
    });
  }

  // Ronco grave distante: seno 40–60 Hz com tremolo lento por ~2 s.
  function rumble() {
    safe(() => {
      if (rumbleBusy) return;
      rumbleBusy = true;
      const t0 = ctx.currentTime, T = AUDIO.RUMBLE_TIME;
      const osc = ctx.createOscillator();
      osc.type = 'sine'; osc.frequency.setValueAtTime(AUDIO.RUMBLE_FREQ * 1.15, t0);
      osc.frequency.exponentialRampToValueAtTime(AUDIO.RUMBLE_FREQ * 0.85, t0 + T);
      const osc2 = ctx.createOscillator();              // 2º harmônico, bem leve, dá corpo
      osc2.type = 'triangle'; osc2.frequency.value = AUDIO.RUMBLE_FREQ * 2.01;
      const h2 = ctx.createGain(); h2.gain.value = 0.18;
      // tremolo: ganho modulado por um LFO
      const trem = ctx.createGain(); trem.gain.value = 0.6;
      const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = AUDIO.RUMBLE_TREMOLO;
      const lfoG = ctx.createGain(); lfoG.gain.value = 0.4;
      lfo.connect(lfoG); lfoG.connect(trem.gain);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(0.55, t0 + T * 0.3);
      env.gain.setValueAtTime(0.55, t0 + T * 0.6);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + T);
      env.connect(master);
      osc.connect(trem); osc2.connect(h2); h2.connect(trem); trem.connect(env);
      osc.start(t0); osc2.start(t0); lfo.start(t0);
      osc.stop(t0 + T + 0.1); osc2.stop(t0 + T + 0.1); lfo.stop(t0 + T + 0.1);
      osc.onended = () => { rumbleBusy = false; };
    });
  }

  // Clique suave ao abrir/fechar o mapa.
  function map() {
    safe(() => {
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'sine'; osc.frequency.setValueAtTime(1500, t0);
      osc.frequency.exponentialRampToValueAtTime(700, t0 + 0.05);
      const g = envGain(t0, 0.22, 0.004, 0.07);
      osc.connect(g); osc.start(t0); osc.stop(t0 + 0.12);
      const src = noiseSource(t0, 0.03);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
      const g2 = envGain(t0, 0.08, 0.003, 0.03);
      src.connect(hp); hp.connect(g2);
    });
  }

  return { unlock, setWind, flap, chime, splash, rumble, map, get unlocked() { return !!ctx; } };
}
