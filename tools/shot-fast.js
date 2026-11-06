// Uso: node tools/shot-fast.js --url "<url>" --out .shots/x.png [--w 1280 --h 720 --frames 3 --wait 6000 --eval "js"]
// Captura sem o loop de rAF (máquina sobrecarregada): para o loop, espera as texturas,
// roda __step(frames) e lê o canvas no mesmo tick (toDataURL).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const args = {};
for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith('--')) { const k = a.slice(2), v = process.argv[i + 1]; if (v === undefined || v.startsWith('--')) args[k] = true; else { args[k] = v; i++; } } }
const W = Number(args.w || 1280), H = Number(args.h || 720), frames = Number(args.frames || 3), wait = Number(args.wait || 6000);
fs.mkdirSync(path.dirname(args.out), { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-vsync'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { const t = `[${m.type()}] ${m.text()}`; logs.push(t); if (m.type() === 'error') console.log(t); });
page.on('pageerror', (e) => { console.log('[pageerror] ' + e.message); logs.push('[pageerror] ' + e.message); });
await page.addInitScript(() => { const raf = window.requestAnimationFrame.bind(window); let n = 0; window.requestAnimationFrame = (cb) => (n++ < 2 ? raf(cb) : 0); });
const t0 = Date.now();
await page.goto(args.url, { waitUntil: 'load', timeout: 900000 });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 900000, polling: 1000 });
await page.waitForTimeout(wait);
if (args.eval) console.log('[eval]', JSON.stringify(await page.evaluate(args.eval)));
const url = await page.evaluate(async (n) => { await window.__step(n); await new Promise((r) => setTimeout(r, 50)); await window.__step(1); return document.querySelector('canvas').toDataURL('image/png'); }, frames);
fs.writeFileSync(args.out, Buffer.from(url.split(',')[1], 'base64'));
const stats = await page.evaluate(() => (window.__stats ? window.__stats() : null));
console.log('[stats]', JSON.stringify(stats));
const errs = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
const warns = logs.filter((l) => l.startsWith('[warning]'));
console.log(`[shot2] ${args.out} ${((Date.now() - t0) / 1000).toFixed(0)}s errors=${errs.length} warnings=${warns.length}`);
if (args.logs) for (const l of logs) console.log(l);
await browser.close();
