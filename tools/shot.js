// Screenshot headless (Chromium + SwiftShader) de uma URL do jogo/preview.
//   node tools/shot.js --url "http://localhost:8080/#x=0&y=200&z=0" --out .shots/a.png [--w 1280 --h 720] [--wait 1500] [--eval "js"] [--frames 20]
// Espera window.__ready === true (se existir), roda `frames` quadros via window.__step(n) (se existir),
// imprime erros do console e, se existir, window.__stats().
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
// Playwright pode estar instalado globalmente (ambiente de desenvolvimento) ou no projeto.
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) { const k = a.slice(2); const v = process.argv[i + 1]; if (v === undefined || v.startsWith('--')) args[k] = true; else { args[k] = v; i++; } }
}
const url = args.url || 'http://localhost:8080/';
const out = args.out || '.shots/shot.png';
const W = Number(args.w || 1280), H = Number(args.h || 720);
const wait = Number(args.wait || 800);
const frames = Number(args.frames || 12);
const timeout = Number(args.timeout || 90000);
fs.mkdirSync(path.dirname(out), { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-vsync'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { const t = `[${m.type()}] ${m.text()}`; logs.push(t); if (m.type() === 'error' || m.type() === 'warning') console.log(t); });
page.on('pageerror', (e) => { console.log('[pageerror] ' + e.message); logs.push('[pageerror] ' + e.message); });
const t0 = Date.now();
try {
  await page.goto(url, { waitUntil: 'load', timeout });
  await page.waitForFunction(() => window.__ready === true, null, { timeout }).catch((e) => console.log('[shot] timeout esperando __ready: ' + e.message));
  if (args.eval) { try { const r = await page.evaluate(args.eval); if (r !== undefined) console.log('[eval]', JSON.stringify(r)); } catch (e) { console.log('[eval error] ' + e.message); } }
  await page.evaluate(async (n) => { if (typeof window.__step === 'function') await window.__step(n); }, frames);
  await page.waitForTimeout(wait);
  await page.evaluate(async () => { if (typeof window.__step === 'function') await window.__step(2); });
  await page.screenshot({ path: out, timeout: 240000 });
  const stats = await page.evaluate(() => (typeof window.__stats === 'function' ? window.__stats() : null));
  if (stats) console.log('[stats]', JSON.stringify(stats));
  console.log(`[shot] ${out} (${W}x${H}) em ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} catch (e) {
  console.log('[shot] falhou: ' + e.message);
  process.exitCode = 1;
}
const errs = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
if (errs.length) { console.log(`[shot] ${errs.length} erro(s) de console`); process.exitCode = 1; }
await browser.close();
