# Ruppen

Jogo 3D de entregas, no navegador. Você voa montado numa **pomba branca** sobre um **oceano infinito**, entre
**civilizações construídas sobre elefantes gigantes** que caminham, lentíssimos, pelo mar. A pomba é do
tamanho de um carro; os elefantes têm cerca de quatro quilômetros e meio de altura até as costas. O jogo é
sobre se sentir minúsculo.

Sem instalar nada: baixe `dist/ruppen.html` e abra no navegador (arquivo único, funciona offline).

## Como jogar

```
npm install        # só na primeira vez (instala o three.js vendorizado e o esbuild)
npm start          # abre um servidor local em http://localhost:8080/
```

Abra `http://localhost:8080/` no navegador (Chrome, Edge ou Firefox atualizados).

Também dá para gerar um arquivo único, sem servidor:

```
npm run build      # cria dist/ruppen.html — abra com duplo clique
```

### Controles

| Tecla | Ação |
| --- | --- |
| **W / ↑** | subir |
| **S / ↓** | descer |
| **A / ←** e **D / →** | virar |
| **Shift** | acelerar |
| **Espaço** ou **E** | soltar a encomenda |
| **M** (ou a setinha **›** à esquerda) | abrir / fechar o mapa |
| **Esc** | fechar o mapa |
| **H** | mostrar os controles de novo |

### Objetivo

No topo da tela aparece a cidade onde a encomenda deve ser entregue. Abra o mapa para ver as ilhas,
os sete elefantes (com um pequeno tracejado do caminho que cada um ainda vai percorrer) e a sua posição.
Voe até o elefante certo, desça até perto da cidade nas costas dele e aperte **Espaço**: a cesta com a
caixa cai sobre a civilização. Entregou? Já aparece a próxima cidade. E assim para sempre.

Se a cesta cair no mar, outra aparece em alguns segundos.

## Estrutura

```
index.html              página do jogo (import map → vendor/three)
src/main.js             montagem do mundo e laço principal
src/config.js           escalas, cores e constantes (1 unidade = 1 metro)
src/world/worldData.js  ilhas fixas (forma/altura) e rotas dos elefantes
src/world/*.js          céu, oceano, nuvens, ilhas, iluminação
src/elephant/           modelo procedural do elefante com cidade e adornos
src/player/             pomba, voo, câmera, encomenda
src/game/delivery.js    regras de entrega
src/ui/                 HUD, mapa, estilos
src/audio.js            sons procedurais (WebAudio)
dev/preview.html        visualizador de módulos isolados (desenvolvimento)
tools/                  servidor estático, screenshots headless, build
vendor/three/           three.js r187 (sem CDN — funciona offline)
```

Tudo é procedural: não há texturas nem modelos externos; o mundo é determinístico (mesmas ilhas, mesmos
elefantes e rotas a cada partida).

## Desenvolvimento

* `node tools/serve.js 8080` — servidor estático.
* `node tools/shot.js --url "http://localhost:8080/#x=0&y=200&z=0" --out .shots/a.png` — screenshot headless.
* `dev/preview.html?kind=elephant` ou `?kind=dove&orbit=1` — olhar um modelo isolado.
* `node tools/playtest.js 8080` — teste automatizado de jogabilidade (voo, mapa, entrega, colisão).
* Parâmetros no hash da página do jogo: `x,y,z,yaw,pitch,speed,t,pause=1,nohud=1,quality=low`.
* Dica de desempenho: em máquinas fracas abra `index.html#quality=low`.

Veja `ARCHITECTURE.md` para os contratos entre os módulos.
