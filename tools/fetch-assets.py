#!/usr/bin/env python3
# Baixa o pacote de texturas/HDRI CC0 do Poly Haven usado pelo jogo (polyhaven.com, licença CC0).
#   python3 tools/fetch-assets.py
# Grava em assets/tex/<id>_<mapa>.jpg e assets/hdri/<id>.hdr, e atualiza assets/manifest.json.
import json, os, sys, urllib.request
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEX = {
  # terreno das ilhas
  'aerial_rocks_02': ['diff', 'nor_gl', 'rough'],
  'cliff_side': ['diff', 'nor_gl', 'rough'],
  'aerial_grass_rock': ['diff', 'nor_gl', 'rough'],
  'forest_ground_04': ['diff', 'nor_gl', 'rough'],
  'coast_sand_01': ['diff', 'nor_gl', 'rough'],
  'damp_beach_sand': ['diff', 'nor_gl', 'rough'],
  'bark_brown_02': ['diff', 'nor_gl'],
  # elefante (pele: couro + lama seca rachada como detalhe)
  'fabric_leather_02': ['diff', 'nor_gl', 'rough'],
  'brown_mud_dry': ['diff', 'nor_gl', 'rough'],
  # tecidos / adornos / sela
  'poly_wool_herringbone': ['diff', 'nor_gl', 'rough'],
  'wool_boucle': ['diff', 'nor_gl'],
  'brown_leather': ['diff', 'nor_gl', 'rough'],
  # arquitetura
  'white_stucco_02': ['diff', 'nor_gl', 'rough'],
  'beige_wall_001': ['diff', 'nor_gl', 'rough'],
  'clay_roof_tiles_02': ['diff', 'nor_gl', 'rough'],
  'brick_wall_02': ['diff', 'nor_gl', 'rough'],
  'marble_01': ['diff', 'nor_gl', 'rough'],
}
HDRI = {'kloofendal_48d_partly_cloudy_puresky': '1k'}
RES = '1k'

def get(url):
    # a API do Poly Haven recusa o User-Agent padrão do Python
    req = urllib.request.Request(url, headers={'User-Agent': 'ruppen-asset-fetch/1.0'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()

manifest = {'source': 'https://polyhaven.com (CC0)', 'resolution': RES, 'textures': {}, 'hdri': {}}
for tid, maps in TEX.items():
    files = json.loads(get(f'https://api.polyhaven.com/files/{tid}'))
    entry = {}
    for m in maps:
        key = {'diff': 'Diffuse', 'nor_gl': 'nor_gl', 'rough': 'Rough'}[m]
        node = files.get(key) or files.get(m)
        if not node or RES not in node or 'jpg' not in node[RES]:
            print('  sem', tid, m); continue
        url = node[RES]['jpg']['url']
        out = os.path.join(ROOT, 'assets', 'tex', f'{tid}_{m}.jpg')
        if not os.path.exists(out):
            open(out, 'wb').write(get(url))
        entry[m] = f'assets/tex/{tid}_{m}.jpg'
    manifest['textures'][tid] = entry
    print(tid, sorted(entry))
for hid, res in HDRI.items():
    files = json.loads(get(f'https://api.polyhaven.com/files/{hid}'))
    url = files['hdri'][res]['hdr']['url']
    out = os.path.join(ROOT, 'assets', 'hdri', f'{hid}_{res}.hdr')
    if not os.path.exists(out):
        open(out, 'wb').write(get(url))
    manifest['hdri'][hid] = f'assets/hdri/{hid}_{res}.hdr'
    print('hdri', hid)
json.dump(manifest, open(os.path.join(ROOT, 'assets', 'manifest.json'), 'w'), indent=2)
print('ok')
