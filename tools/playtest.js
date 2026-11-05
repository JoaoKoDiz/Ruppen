// Teste de jogabilidade automatizado (headless): simula teclas e verifica invariantes.
//   node tools/playtest.js [porta]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const port = process.argv[2] || 8080;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok, info }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : '')); };

async function load(hash) {
  await page.goto('about:blank'); // mudar só o hash não recarrega a página
  await page.goto(`http://localhost:${port}/#${hash}&quality=low`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  await page.evaluate(() => window.__ruppen.setPaused(true)); // controlamos o tempo via __step
}
const step = (n, dt = 1 / 30) => page.evaluate(([n, dt]) => window.__step(n, dt), [n, dt]);
const key = (code, down) => page.evaluate(([code, down]) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code, bubbles: true })), [code, down]);
const S = () => page.evaluate(() => { const f = window.__ruppen.flight.state; const d = window.__ruppen.delivery; return { p: f.position.toArray(), alt: f.altitude, speed: f.speed, heading: f.heading, pitch: f.pitch, roll: f.roll, target: d.target?.name, count: d.count, lost: d.lostCount, state: d.state, attached: window.__ruppen.pkg.attached, mapOpen: window.__ruppen.map.isOpen }; });
const finite = (s) => s.p.every(Number.isFinite) && Number.isFinite(s.speed) && Number.isFinite(s.heading);

// 1) spawn e voo reto
await load('t=0');
let s0 = await S(); await step(60); let s1 = await S();
check('voo reto avança', Math.hypot(s1.p[0] - s0.p[0], s1.p[2] - s0.p[2]) > 60, `dist ${Math.hypot(s1.p[0] - s0.p[0], s1.p[2] - s0.p[2]).toFixed(0)} m em 2 s`);
check('estado finito', finite(s1));
// 2) curva com A: heading cresce (esquerda) e roll positivo
await key('KeyA', true); await step(45); let s2 = await S(); await key('KeyA', false);
check('A vira à esquerda (heading cresce)', s2.heading > s1.heading + 0.3, `Δ=${(s2.heading - s1.heading).toFixed(2)}`);
check('A inclina (roll > 0)', s2.roll > 0.15, `roll=${s2.roll.toFixed(2)}`);
await step(60); let s2b = await S();
check('auto-nivela ao soltar', Math.abs(s2b.roll) < 0.12, `roll=${s2b.roll.toFixed(2)}`);
// 3) subir com W, descer com S
await key('KeyW', true); await step(60); let s3 = await S(); await key('KeyW', false);
check('W sobe', s3.p[1] > s2b.p[1] + 20, `Δy=${(s3.p[1] - s2b.p[1]).toFixed(0)}`);
await step(60); s3 = await S(); // deixa o nariz nivelar antes de descer
await key('KeyS', true); await step(60); let s4 = await S(); await key('KeyS', false);
check('S desce', s4.p[1] < s3.p[1] - 20, `Δy=${(s4.p[1] - s3.p[1]).toFixed(0)}`);
// 4) boost
await key('ShiftLeft', true); await step(90); let s5 = await S(); await key('ShiftLeft', false);
check('Shift acelera', s5.speed > 100, `speed=${s5.speed.toFixed(0)}`);
// 5) mergulho: nunca abaixo da altitude mínima
await load('x=0&y=60&z=0');
await key('KeyS', true); let minAlt = Infinity; for (let i = 0; i < 12; i++) { await step(15); const s = await S(); minAlt = Math.min(minAlt, s.alt); } await key('KeyS', false);
check('nunca entra na água', minAlt >= 5, `altitude mínima ${minAlt.toFixed(1)} m`);
// 6) teto
await load('x=0&y=3500&z=0'); await key('KeyW', true); let maxY = 0; for (let i = 0; i < 10; i++) { await step(20); const s = await S(); maxY = Math.max(maxY, s.p[1]); } await key('KeyW', false);
check('respeita o teto', maxY <= 8200, `y máx ${maxY.toFixed(0)}`);
// 7) mapa: M abre, Esc fecha
await load('t=0'); await key('KeyM', true); await step(2); await key('KeyM', false); let m1 = await S();
check('M abre o mapa', m1.mapOpen === true);
await key('Escape', true); await step(2); await key('Escape', false); let m2 = await S();
check('Esc fecha o mapa', m2.mapOpen === false);
await page.evaluate(() => document.querySelector('[title^="Mapa"]')?.click()); await step(2); let m3 = await S();
check('setinha abre o mapa', m3.mapOpen === true); await key('Escape', true); await step(2); await key('Escape', false);
// 8) entrega: posicionar sobre a cidade-alvo e soltar
const tgt = await page.evaluate(() => { const e = window.__ruppen.delivery.target; return { x: e.position.x, z: e.position.z, top: e.cityTop, name: e.name }; });
await load(`x=${tgt.x.toFixed(0)}&y=${(tgt.top + 220).toFixed(0)}&z=${tgt.z.toFixed(0)}&speed=30`);
await step(5); const zone = await page.evaluate(() => window.__ruppen.delivery.zoneStatus());
check('zona de entrega detectada', zone.inZone === true, JSON.stringify(zone));
await key('Space', true); await step(2); await key('Space', false); let d1 = await S();
check('Espaço solta a cesta', d1.attached === false && d1.state === 'falling', `state=${d1.state} attached=${d1.attached}`);
let delivered = false; for (let i = 0; i < 40 && !delivered; i++) { await step(15); const s = await S(); if (s.count >= 1) delivered = true; }
const d2 = await S();
check('entrega concluída no alvo', delivered, `count=${d2.count} state=${d2.state}`);
await step(120); const d3 = await S();
check('novo alvo diferente e cesta nova', d3.target !== tgt.name && d3.attached === true, `alvo=${d3.target} attached=${d3.attached}`);
// 9) perda no mar
await load('x=0&y=300&z=0'); await page.evaluate(() => window.__ruppen.pkg.drop()); let lost = false;
for (let i = 0; i < 40 && !lost; i++) { await step(15); const s = await S(); if (s.lost >= 1) lost = true; }
check('cesta perdida no mar é detectada', lost); await step(120); const l2 = await S();
check('cesta nova após perda', l2.attached === true);
// 10) colisão com elefante: voar direto contra o corpo
await load(`x=${(tgt.x - 2500).toFixed(0)}&y=1100&z=${tgt.z.toFixed(0)}&yaw=-90&speed=140`);
let inside = false, minDist = Infinity;
for (let i = 0; i < 75; i++) { await step(10, 1 / 30); const r = await page.evaluate(() => { const f = window.__ruppen.flight.state.position; const e = window.__ruppen.delivery.target; let md = Infinity; for (const c of e.colliders) { md = Math.min(md, f.distanceTo(c.center) - c.radius); } return md; }); minDist = Math.min(minDist, r); if (r < -40) inside = true; }
check('não atravessa o elefante', !inside, `penetração mínima ${minDist.toFixed(0)} m`);
// 11) estatísticas
await load('t=0'); await step(5); const st = await page.evaluate(() => window.__stats());
check('orçamento de triângulos', st.triangles < 2500000 && st.calls < 350, `${st.triangles} tris, ${st.calls} calls`);
check('sem erros de console', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} verificações passaram`);
process.exit(fails ? 1 : 0);
