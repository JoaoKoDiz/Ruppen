# RUPPEN — arquitetura e contratos dos módulos

Jogo 3D no navegador (three.js r187, ES modules, **sem bundler e sem rede**: a biblioteca está
vendorizada em `vendor/three/`; CDNs NÃO estão acessíveis neste ambiente — nunca importe de URLs).
Rodar: `node tools/serve.js 8080` e abrir `http://localhost:8080/`.

## 1. O jogo (resumo para quem implementa)

Você voa montado numa **pomba branca** (do tamanho de um carro) sobre um **oceano infinito**.
O mundo é gigantesco (60 km × 60 km jogáveis, distância de renderização de 160 km) com **5 ilhas fixas**
(montanhas altas, pedras, grama, florestas, pequenas praias — iguais em composição, diferentes no formato)
e **7 elefantes colossais** (~1,5 km de altura até as costas) que caminham **extremamente devagar** (6 m/s)
pelo oceano em laços fixos. Sobre cada elefante há uma **civilização medieval/oriental** (casas pastel
densas, palácio com cúpula dourada, minaretes, torres sobre as presas) e **adornos** (placa dourada
com tachas na testa, guirlanda de pompons coloridos, borla rosa, anéis de ouro nas presas e na tromba,
mantos laranja nas orelhas com casas em terraços).
É um jogo de **entregas**: o HUD diz a cidade-alvo, uma setinha à esquerda abre o **mapa** (desliza da
esquerda ao centro, fundo do jogo borrado) com ilhas, elefantes em movimento (com um pequeno tracejado do
trajeto à frente) e o jogador. Para entregar: aproximar-se do elefante, descer até perto da cidade e
apertar uma tecla: a **cesta com a caixa** cai; se pousar sobre o elefante, entrega concluída → próxima
cidade, para sempre. O aspecto central é a **sensação de ser minúsculo** diante dos elefantes e do oceano.

Referências visuais (8 imagens, estilo render limpo, céu azul profundo, haze claro no horizonte, oceano azul
escuro, nuvens brancas volumosas na base dos elefantes):
`/root/.claude/uploads/83338555-c5ea-5dd2-b765-f37a61a9186e/` → `2ac976b7-image.jpg` (elefante de frente sobre
nuvens, pomba minúscula), `e43910ba-image.jpg` (navio e elefante, mantos nas orelhas), `20ca0708-image.jpg`
(pomba com cesta pendurada perto da cabeça), `c9e4b165-image.jpg` (cidade nas costas: cúpula dourada, minaretes,
casas pastel), `4b265279-image.jpg` (praça de mercado com cesta descendo), `71a8e2e1-image.jpg` (cidades ao longo
das presas, borla rosa, anéis de ouro), `d48c0814-image.jpg` (elefante jorrando água pela tromba, cidade no dorso),
`5675d4a1-image.jpg` (vários elefantes ao longe, haze). Veja-as com a ferramenta Read antes de modelar.

UI em **português do Brasil**. Comentários de código em português; identificadores em inglês.

## 2. Convenções

* 1 unidade = 1 metro. Y para cima. Nível do mar y = 0. Mundo centrado na origem.
* **Pomba / jogador**: frente local = **−Z**, cima = +Y, direita = +X (mesma convenção da câmera do three.js).
  `quaternion = Euler(pitch, yaw, roll, 'YXZ')`; pitch > 0 = nariz para cima; yaw cresce virando à **esquerda**;
  roll > 0 = asa direita sobe (inclinação para a esquerda).
* **Elefante**: frente local = **+X**, cima = +Y, lado direito = +Z. Origem do grupo no nível do mar, entre as
  patas. `group.rotation.y = heading` (vindo de `route.poseAt(u)`).
* Todas as dimensões/cores vêm de `src/config.js` (`WORLD`, `ELEPHANT`, `DOVE`, `CLOUDS`, `COLORS`, `SEED`).
  Não duplique números mágicos; se precisar de uma constante nova, adicione em config.js.
* Mundo determinístico: use `createRng(SEED + algo)` de `src/util/rng.js` e `createNoise(seed)` de
  `src/util/noise.js`. Nunca `Math.random()` para conteúdo do mundo (pode em efeitos efêmeros).
* Renderer: `logarithmicDepthBuffer: true`, `ACESFilmicToneMapping`, `SRGBColorSpace`, `FogExp2` na cena.
  **Todo ShaderMaterial customizado** deve incluir os chunks:
  vertex: `#include <common>`, `#include <logdepthbuf_pars_vertex>`, `#include <fog_pars_vertex>` … e no main
  `#include <logdepthbuf_vertex>`, `#include <fog_vertex>` (precisa de `mvPosition`);
  fragment: `#include <common>`, `#include <logdepthbuf_pars_fragment>`, `#include <fog_pars_fragment>` … e no final
  `#include <logdepthbuf_fragment>`, `#include <tonemapping_fragment>`, `#include <colorspace_fragment>`,
  `#include <fog_fragment>` (na ordem: logdepth → cor final → tonemapping → colorspace → fog).
  Use `material.fog = true` e `uniforms: UniformsUtils.merge([UniformsLib.fog, {...}])` para a névoa funcionar.
  Objetos imensos que seguem a câmera (céu, oceano): `frustumCulled = false`.
* Materiais padrão: `MeshStandardMaterial`/`MeshLambertMaterial` (sem metalness alto, exceto ouro: metalness 0.6–0.8,
  roughness 0.35). Sem sombras em tempo real (shadow maps desligados). Use InstancedMesh para tudo repetido
  (casas, árvores, tachas, pompons). Orçamento: ≤ 2,5 M triângulos e ≤ 350 draw calls por quadro com os 7 elefantes
  e 5 ilhas visíveis; cada elefante completo ≤ 220k triângulos e ≤ 25 draw calls; cada ilha ≤ 150k triângulos.
* Nada de dependências novas no npm, nada de fetch/textures externas: texturas são procedurais (canvas 2D
  → `CanvasTexture`) ou geradas em código.
* Nunca edite arquivos de outros módulos (exceto `src/config.js` para ADICIONAR constantes). `src/main.js`,
  `index.html`, `dev/*`, `tools/*`, `src/world/worldData.js`, `src/world/lighting.js` são do integrador —
  se precisar de algo deles, descreva no seu relatório final em vez de editar.

## 3. Verificação (obrigatória para todos os agentes)

```
node tools/serve.js <PORTA> &            # use uma porta própria (ex.: 8101…8199) para não colidir
node tools/shot.js --url "http://localhost:<PORTA>/dev/preview.html?kind=elephant&mod=elephant/candidates/elephant_a.js&dist=4200&az=35&el=12" --out .shots/ele_a_1.png --w 1280 --h 720
node tools/shot.js --url "http://localhost:<PORTA>/#x=0&y=200&z=0&yaw=0" --out .shots/game.png --w 1280 --h 720 --frames 30
```
Depois **olhe a imagem** com a ferramenta Read e compare com as referências. `tools/shot.js` imprime erros do
console (`[error]`, `[pageerror]`) e `[stats]` (draw calls, triângulos). Zero erros de console é obrigatório.
O preview aceita: `kind=elephant|dove|islands|env|all`, `mod=` (caminho sob `src/`), `fn=`, câmera `dist/az/el`
(órbita em graus ao redor de `tx,ty,tz`) ou `cx,cy,cz,lx,ly,lz`, `t=` (segundos), `frames=`, `env=1`
(carrega céu/oceano/nuvens junto), `quality=low|high`, para a pomba: `speed= boost=1 pitch= roll= climb= turn=`.
O jogo (`index.html`) aceita no hash: `x,y,z,yaw(graus),pitch(graus),speed,t,pause=1,nohud=1,quality=low`,
`cam=free&cx=&cy=&cz=&lx=&ly=&lz=`, `elephant=candidates/elephant_a.js`, `dove=candidates/dove_b.js` (testa um candidato no jogo completo). No navegador headless o render é por software (lento): use `--w 1280 --h 720`
ou menos e poucos `--frames`.

## 4. Contratos

### 4.1 `src/world/worldData.js` (pronto — só leitura)
`WORLD_DATA = { islands, routes, islandHeightAt(x,z), islandAt(x,z), bounds }`
* `islands[i] = { id, name, cx, cz, R, maxH, boundRadius, outlineRadius(theta), heightAt(x,z) → m | -Infinity, outlinePolygon(n) → [{x,z}] }`
* `routes[i] = { id, cityName, curve (CatmullRomCurve3 fechada), length, u0, speed, center:{x,z}, radius,
  poseAt(u) → { position: Vector3, tangent: Vector3, heading }, aheadPoints(u, meters, n) → Vector3[] }`

### 4.2 Ambiente — `src/world/sky.js`, `ocean.js`, `clouds.js`
* `createSky(scene, {quality}) → { object, update(camera, time) }` — domo/esfera de céu (gradiente zênite→horizonte,
  sol com glow, cirros leves opcionais), segue a câmera, sem névoa, `depthWrite=false`, renderiza primeiro.
* `createOcean(scene, {quality}) → { object, update(camera, time) }` — plano enorme que segue a câmera (encaixado
  em grade para não "nadar"), shader com ondas em normal (soma de senoides/ruído), especular do sol, fresnel para a cor
  do horizonte, névoa. Deve parecer um oceano infinito azul-escuro, mais claro perto do horizonte.
* `createClouds(scene, worldData, {quality}) → { object, update(camera, time, dt), attachTo(elephants) }` — nuvens-cúmulo
  brancas e fofas (billboards instanciados com textura procedural suave, iluminação por altura dentro da nuvem, sem gravar
  depth, ordenação por distância a cada ~0,5 s), espalhadas pelo mundo (`CLOUDS.*`, semente) em altitudes 170–720 m, e
  **anéis de nuvem/espuma ao redor das patas de cada elefante** (raio `ELEPHANT.FOOT_CLOUD_RADIUS`). O integrador chama
  `clouds.attachTo(elephants)` uma vez (entidades com `.position` e `.heading` atualizados a cada quadro); as nuvens das
  patas seguem essas posições. Se `attachTo` nunca for chamado, use `routes[i].poseAt(routes[i].u0).position`.

### 4.3 Ilhas — `src/world/islands.js`
`createIslands(scene, worldData, {quality}) → { group, update?(camera, time) }` — para cada ilha, malha de terreno
amostrando `island.heightAt` (grade ~ 160×160 cobrindo `boundRadius`), cores por vértice (areia perto de y≈0–18 m,
grama, floresta escura em encostas médias, rocha cinza em encostas íngremes/altas, com variação de ruído), árvores
instanciadas (cones/esferas simples, 2–4 k por ilha) nas faixas grama/floresta, pedras instanciadas, e a pele de
rocha das falésias. Sem buracos na linha d'água (a malha desce abaixo de 0 pela função `heightAt`).

### 4.4 Elefante — `src/elephant/elephant.js` (candidatos em `src/elephant/candidates/elephant_X.js`)
`createElephant(route, index, {quality}) → ElephantEntity`:
```
{
  group: THREE.Group,            // adicionado à cena pelo integrador
  index, name: route.cityName, route,
  position: THREE.Vector3,       // ATUAL (nível do mar, entre as patas) — mesmo objeto, atualizado em update()
  heading: number,               // yaw atual (rad)
  u: number,                     // fração atual do laço
  update(dt, time),              // avança u (route.speed*dt/route.length), posiciona group, anima pernas/orelhas/tromba/cauda
  colliders: [{ center: Vector3 (MUNDO, atualizado em update), radius }],  // esferas aproximando corpo, cabeça, patas
  cityTop: number,               // altura (y absoluto, relativo ao nível do mar) do topo da cidade nas costas
  cityFootprint: { rx, rz },     // elipse horizontal (semi-eixos, no espaço local) onde o drop vale
  deliveryMarker: Vector3,       // ponto (MUNDO) acima da cidade onde o marcador de destino flutua
  getSurfaceHeight(x, z) → number | null,   // altura (mundo) da superfície do elefante/cidade na vertical de (x,z); null se fora
  isOverCity(x, z) → boolean,    // dentro da elipse cityFootprint (espaço local)
}
```
O modelo é **procedural** (primitivas, tubos com raio variável, instâncias), nas dimensões de `ELEPHANT`
(corpo elipsoide rx 560 / ry 430 / rz 470 centrado em y 1070; patas r 140 de y 780 a −90 em ±330,±290; cabeça r 340
em x 800 y 1060; orelhas 540×640; tromba 1050 de comprimento, curvando para baixo e enrolando na ponta; presas 860 de
comprimento, curvando para fora/frente/cima). Pele cinza com **textura procedural de rugas** (linhas onduladas
escuras, bump). Adornos e cidade conforme as referências. Animação lenta (passo = `ELEPHANT.STRIDE`, cadência =
SPEED/STRIDE ≈ 1 passo a cada 2 min; pares diagonais; leve balanço do corpo; orelhas abanando devagar; tromba
oscilando). Opcional: jato d'água da tromba (pontos) de vez em quando.

### 4.5 Pomba — `src/player/dove.js` (candidatos em `src/player/candidates/dove_X.js`)
`createDove({quality}) → { group, packageAnchor: Object3D, update(dt, flightState) }` — pomba branca (`DOVE.WINGSPAN`
4,6 m, corpo 2,4 m), asas com "dedos" de penas primárias, cauda em leque, cabeça pequena, bico, olhos; **arreios**:
sela de couro, cilha, estribos, rédeas até a cabeça, peitoral com argola onde a corda da cesta prende (`packageAnchor`
abaixo do peito, um pouco à frente); **cavaleiro** simples (roupa escura, mochila) sentado na sela. Batida de asas
proporcional a `flightState.speed/boost/climbInput`; planar com asas abertas; cauda abre nas curvas. O grupo é
posicionado pelo integrador (`position/quaternion` do voo) — não mova o grupo dentro de `update`.
`flightState = { position, quaternion, velocity, forward, heading, pitch, roll, speed, boost, altitude, climbInput (−1..1), turnInput (−1..1) }`.

### 4.6 Voo — `src/input.js`, `src/player/flight.js`, `src/player/camera.js`, `src/player/package.js`
* `createInput(canvas) → { isDown(code), justPressed(code), endFrame(), onFirstInteraction(cb), axes:{pitch,yaw,boost},
  actions:{drop:'Space', map:'KeyM', boost:'ShiftLeft'} , pointer:{dx,dy} (opcional) }`. Teclas: W/S ou ↑/↓ = descer/subir
  o nariz (W = mergulhar? **Não**: W/↑ = subir, S/↓ = descer, como "puxar as rédeas"), A/D ou ←/→ = virar, Shift = acelerar,
  Espaço/E = soltar encomenda, M = mapa, Esc fecha o mapa. Toques em telas pequenas são opcionais.
* `createFlightController({ input, islandHeightAt, elephants }) → { state, update(dt), setPose({position, heading, pitch}) }`
  com `state = { position, quaternion, velocity, forward, heading, pitch, roll, speed, boost, altitude, climbInput, turnInput }`.
  Modelo arcade suave: guinada com inclinação (banking) e auto-nivelamento, pitch limitado, velocidade com aceleração
  (`DOVE.*`), altitude mínima sobre água e sobre as ilhas (`islandHeightAt`), máxima `ALT_MAX`, limites do mundo (vira
  suavemente de volta), **colisão suave com os elefantes** (esferas `elephants[i].colliders`: empurra para fora e
  remove a componente da velocidade contra a superfície).
* `createChaseCamera(camera, flight, {input}) → { update(dt) }` — 3ª pessoa atrás/acima da pomba, suavizada, FOV
  sobe no boost, leve lag na curva, nunca entra na água. Olhar com o mouse (arrastar) é opcional, com retorno.
* `createPackageSystem({ scene, dove, flight, elephants, islandHeightAt }) → { attached, canDrop(), drop() → bool,
  onLanded(cb({elephant, position})), onLost(cb({position})), attachNew(), update(dt), landedCount }` — cesta-gaiola
  esférica de metal com caixa de madeira dentro, pendurada por corda em `dove.packageAnchor` (`DOVE.ROPE_LENGTH`),
  pêndulo com atraso/arrasto. `drop()` solta: gravidade + arrasto; a cada quadro testa `elephants[i].getSurfaceHeight(x,z)`
  (pousou → fica preso ao `group` do elefante na posição local, chama `onLanded`) e `islandHeightAt`/mar (→ splash
  simples, `onLost`). `attachNew()` recria uma cesta presa à pomba (com pequena animação de aparecer).

### 4.7 Jogo e UI — `src/game/delivery.js`, `src/ui/hud.js`, `src/ui/map.js`, `src/ui/style.css`, `src/audio.js`
* `createDelivery({ elephants, flight, pkg, input, audio }) → { target, count, lostCount, state ('carrying'|'falling'|'done'),
  update(dt), zoneStatus() → { overCity, tooHigh, inZone, distance, heightAbove }, pickNext(), onEvent(cb) }` — escolhe o
  alvo inicial (o elefante mais próximo do spawn), decide quando o drop é válido (`inZone` = `target.isOverCity(x,z)` e
  `0 < y − target.cityTop ≤ ELEPHANT.DELIVERY_ABOVE_MAX`), chama `pkg.drop()` em `justPressed('Space'|'KeyE')`, trata
  `onLanded` (se foi no alvo: entrega! `count++`, toast, chime, escolhe próximo alvo ≠ atual, preferindo 8–25 km;
  se foi em outro elefante: "cidade errada", nova cesta) e `onLost` (nova cesta após 2 s).
* `createHUD({ root, delivery, flight, elephants, input, camera }) → { update(dt), toast(msg, ms) }` — no topo, só texto
  (sem caixa): "Entregar em **Zamurra**" + distância (ex.: "12,4 km") + contador de entregas discreto; dica contextual
  (ex.: "Desça até a cidade e aperte ESPAÇO"); à esquerda, **uma setinha pequena "›"** (botão) que abre o mapa; dicas de
  controle que somem após alguns segundos; indicador de direção do alvo (seta na borda quando fora da tela, projetando
  `delivery.target.deliveryMarker` com `camera`).
* `createMapUI({ root, worldData, elephants, flight, delivery, input, camera }) → { update(dt), isOpen, toggle(), open(),
  close() }` — painel que **desliza da esquerda até o centro** (transição CSS), cobrindo quase toda a tela, fundo do jogo
  **borrado** (`backdrop-filter: blur`) e levemente escurecido; `<canvas>` 2D com: oceano, **ilhas** (polígonos de
  `island.outlinePolygon()`, areia na borda, verde, miolo de montanha), **elefantes** (ícone/silhueta + nome; o alvo
  destacado em dourado com anel pulsante) com **tracejado curto à frente** (`route.aheadPoints(e.u, 2500)`), o
  **jogador** (ícone de pomba com direção) e bússola/escala. Abre/fecha pela setinha, tecla M e Esc. Elefantes continuam
  se movendo enquanto o mapa está aberto. Toques e redimensionamento funcionam.
* `createAudio() → { unlock(), setWind(speed01), flap(), chime(), splash(), rumble(), map() }` — WebAudio procedural
  (ruído filtrado para o vento, batida de asa suave, carrilhão da entrega, splash, ronco grave distante do elefante).
  Nada toca antes de `unlock()` (chamado na 1ª interação).

## 5. Integração (`src/main.js`)
Ordem por quadro: elefantes.update → flight.update → pomba (posição/quaternion do estado + `dove.update`) → pkg.update
→ delivery.update → câmera → iluminação/céu/oceano/nuvens/ilhas → hud/map → `input.endFrame()`.
Ganchos de teste: `window.__ready`, `window.__step(n)`, `window.__stats()`, `window.__ruppen`.
