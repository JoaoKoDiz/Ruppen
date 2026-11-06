// Gera dist/ruppen.html: o jogo inteiro num único arquivo (abre com duplo clique, sem servidor).
//   npm run build
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
fs.mkdirSync(out, { recursive: true });

const result = await build({
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  write: false,
  legalComments: 'none',
  logLevel: 'warning',
  alias: { three: path.join(root, 'vendor/three/three.module.js'), 'three/addons': path.join(root, 'vendor/three/addons') },
});
const js = result.outputFiles[0].text;
const css = fs.readFileSync(path.join(root, 'src/ui/style.css'), 'utf8');
// texturas/HDRI reais: embutidas como data URIs (o WebGL recusa imagens de file:// sem isso)
const assets = {};
for (const dir of ['assets/tex', 'assets/hdri']) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) continue;
  for (const f of fs.readdirSync(abs)) {
    const mime = f.endsWith('.jpg') ? 'image/jpeg' : f.endsWith('.png') ? 'image/png' : 'application/octet-stream';
    assets[`${dir}/${f}`] = `data:${mime};base64,` + fs.readFileSync(path.join(abs, f)).toString('base64');
  }
}
const assetScript = `<script>window.__RUPPEN_ASSETS=${JSON.stringify(assets)};</script>\n`;
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '');
// funções de substituição evitam a expansão de padrões "$&"/"$'" presentes no código minificado
html = html.replace('<link rel="stylesheet" href="./src/ui/style.css">', () => `<style>\n${css}\n</style>`);
html = html.replace('<script type="module" src="./src/main.js"></script>', () => `${assetScript}<script type="module">\n${js.replace(/<\/script/g, '<\\/script')}\n</script>`);
fs.writeFileSync(path.join(out, 'ruppen.html'), html);
console.log(`dist/ruppen.html gerado (${(html.length / 1024).toFixed(0)} KB)`);
