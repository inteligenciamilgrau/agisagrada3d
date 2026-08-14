# 🎮 ESPECIFICAÇÃO — FPS Multiplayer: MISSÕES + MULTIPLAYER + BATTLE ROYALE

> **Projeto:** Bob em Busca da AGI Sagrada 3D (game-3d)
> **Data:** 05/08/2026 (revisão 2 — versão ampliada)
> **Objetivo deste documento:** conter TODAS as informações necessárias para implementar os novos modos (Multiplayer mata-mata e Battle Royale) sem quebrar o modo MISSÕES atual.

---

## 1. VISÃO GERAL

O jogo atual é single-player (Three.js + física própria). Vamos evoluir para **3 modos** selecionáveis no menu:

| Modo | Ícone | Descrição | Servidor |
|---|---|---|---|
| 🏙️ **MISSÕES** | 🏺 | Campanha atual intacta (7 fases, 5 chefões, entregas, veículos) | ❌ offline |
| ⚔️ **MULTIPLAYER** | 🔫 | Mata-mata em equipes (verde × amarelo), respawn, placar, killfeed | ✅ servidor MP |
| 🪂 **BATTLE ROYALE** | 🏆 | Queda de avião + paraquedas, loot, zona encolhendo, último vivo vence | ✅ servidor BR |

**Arquitetura global:**

```
┌──────────────────────────────┐
│ GitHub Pages (estático)      │  → jogo + HUD novo (index.html)
│ https://saboracaiteria.github.io/cs/
└──────────────┬───────────────┘
               │ WebSocket (wss://servidor:porta)
┌──────────────▼───────────────┐
│ Servidor Node.js (VPS/Cloud) │
│  ┌──────────┐ ┌────────────┐ │
│  │ Sala MP  │ │ Sala BR    │ │  ← salas separadas, 1 processo
│  └──────────┘ └────────────┘ │
└──────────────────────────────┘
```

**Decisão de arquitetura: SERVIDOR AUTORITATIVO** — o servidor é a fonte da verdade (física, dano, zona). O cliente envia *inputs* e recebe *snapshots*. Anti-cheat embutido.

---

## 2. ESTADO ATUAL DO CÓDIGO (BASE REUTILIZÁVEL)

> ⚠️ **PONTO-CHAVE DESCOBERTO:** `src/world/collision.js` (`CollisionWorld`) é **100% matemática pura** — não importa Three.js. Roda IDENTICA em Node.js. Isso permite o servidor validar posição/tiro com a MESMA física do cliente.

### 2.1 Estrutura de arquivos atual (src/)

```
src/
├── main.js            → bootstrap, cria Game, loop de render
├── game.js            → classe Game (~2000 linhas): estados, missões, veículos, combate
├── config.js          → TODAS as constantes (CAMERA, PLAYER, GAME, CAR...)
├── input.js           → teclado + mouse → ações ('acao','atirar','pular')
├── touch.js           → controles de toque estilo COD Mobile (botões arrastáveis)
├── camera.js          → over-the-shoulder, ADS, colisão de câmera
├── player.js          → classe Player (a pé): física, yaw/pitch, modo foot/car/heli
├── ent/
│   ├── human.js       → Human articulado (cabeça, braços, arma no antebraço dir.)
│   ├── bullets.js     → sistema de tiro: hitscan + projéteis + dano
│   └── ...            → carro, helicóptero, NPCs, chefões
├── world/
│   ├── collision.js   → CollisionWorld (PURA — roda em Node) ⭐
│   ├── terrain.js     → terreno procedural (determinístico?)
│   ├── city.js        → cidade procedural (GRID 8×8, CELL 64)
│   └── ...
├── story/             → missões, diálogos, chefões (single-player)
├── sys/
│   ├── audio.js       → 100% WebAudio sintetizado (zero arquivos) — ótimo p/ MP
│   ├── music.js       → trilha procedural
│   └── ...
└── ui/
    ├── hud.js         → atualiza elementos #id do HUD
    ├── minimap.js     → minimapa 360×360 que gira com o jogador
    └── touch.js       → botões de toque
```

### 2.2 Constantes que o servidor DEVE copiar (src/config.js)

```js
// Jogador (a pé)
PLAYER = {
  walkSpeed: 6.4,     // m/s
  runSpeed: 14.5,     // m/s (segurar correr)
  jumpSpeed: ~7,      // impulso do pulo
  turnSmooth: 12,     // suavização de giro
  radius: ~0.45,      // raio do corpo (colisão)
  height: 1.75,       // altura do centro de massa
  eyeHeight: ~1.6,    // altura da câmera
  hp: 100,
}
// Câmera (só cliente, mas referência)
CAMERA = {
  defaultZoom: 3.5,   // sobre o ombro (a pé)
  adsZoom: 2.9,       // mirando
  shoulderX: 1.5,     // deslocamento lateral (lado da arma)
  bodyTurn: 0.32,     // giro do corpo p/ expor o braço
  spreadHip: 0.012,   // espalhamento sem mirar
  spreadAds: 0.0015,  // espalhamento mirando
  recoilPitch: 0.005, recoilYaw: 0.0022, recoilRecover: 5.0,
}
// Mapa
GAME = { WORLD_EDGE: ~256 }   // cidade: GRID 8×8, CELL 64 → HALF 224
// Marcos fora da cidade (para BR expandir): Corcovado x=-560, etc.
```

### 2.3 API da CollisionWorld (para o servidor)

```js
// Forma de uso no cliente (src/world/collision.js)
world.raycast(ox, oy, oz, dx, dy, dz, maxDist) → { t } | null
world.circleCast(...)                            // colisão de corpo com raio
world.groundHeightAt(x, z, y) → y do chão        // terreno + prédios
world.moveBody(...)                              // resolve colisão de corpo
```

> **Tarefa:** ler `src/world/collision.js` por completo na Fase 1 e copiar para `server/world.js` (ou criar um módulo compartilhado). Confirmar se `terrain.js` é determinístico (mesmo resultado em Node) — se for, o servidor regenera a cidade sem enviar mapa.

### 2.4 Sistema de tiro atual (base para o tiro online)

- Mira fixa no ombro (NDC 0.24 / 0.2), o tiro sai da câmera (aimRay).
- **hitscan** com espalhamento (spreadHip/spreadAds) + projéteis com raio.
- Coice: recoilPitch + deriva lateral, relaxa com recoilRecover.
- Dano por arma definido em `ent/bullets.js` (verificar valores na Fase 3).
- Headshot: a cabeça do Human virou grupo próprio (`human.head`, pivô no pescoço y=1.47) → dá para diferenciar dano de cabeça no servidor!

### 2.5 HUD atual (index.html) — elementos a reaproveitar

```
#hud (hidden) → #crosshair, #topleft (#hearts,#score,#timer,#deliveries),
#minimap-wrap (canvas 360×360 + #minimap-ring + #compass-n),
#objective, #speedo, #heli-panel, #lock-on, #missile-gauge,
#prompt, #toasts, #carrying, #clockbox, #perfbox
#boss-bar, #phase-card, #dialogue   (só MISSÕES)
```

### 2.6 PONTOS A VERIFICAR NO CÓDIGO (afetam o multiplayer — marcar na Fase 1)

| Verificação | Por quê | Impacto se não resolvido |
|---|---|---|
| `terrain.js` é determinístico? | Servidor precisa regenerar o mesmo chão | Desync de posição/colisão |
| Existe dano de queda (fall damage)? | BR: cair de prédio/paraquedas | Precisa adicionar no servidor |
| Colisão **entre jogadores** já existe? | No single não há 2 corpos vivos se tocando | Precisa `player-vs-player` (empurrar/bloquear) |
| `bullets.js` calcula dano de **NPCs** (mundo) também? | Raycast online deve ignorar NPCs | Separar camada de dano |
| Existe **água/rio** no mapa? | Zona BR + movimento | Comportamento especial (nadar?) |
| Hitmarker (`#hitmarker`) já anima? | Reuso no online | Só ligar o evento `dano` |
| `Human` tem animação de **morte/queda**? | Avatares remotos morrendo | Precisa pose de morte simples |
| Posição dos **pontos de spawn** da cidade? | Spawn MP/BR | Criar lista fixa no servidor |

---

## 3. ESTRUTURA DE PASTAS NOVA (aditiva — nada quebra)

```
game-3d/
├── server/                       ← NOVO (Node.js, roda separado do Pages)
│   ├── package.json              ← dependência: ws
│   ├── index.js                  ← HTTP + WebSocket, matchmaking, healthcheck
│   ├── config.js                 ← cópia das constantes do cliente
│   ├── world.js                  ← CollisionWorld copiada (100% pura)
│   ├── physics.js                ← física do jogador (gravidade, pulo, colisão)
│   ├── protocol.js               ← parse/encode das mensagens + VALIDAÇÃO
│   ├── persist.js                ← nick/stats em arquivo JSON (SQLite depois)
│   ├── rooms/
│   │   ├── lobby.js              ← sala de espera, nick, pronto, start
│   │   ├── dm.js                 ← mata-mata: score, respawn, times
│   │   └── br.js                 ← BR: zona, loot, avião, supply drop
│   └── README.md                 ← como rodar/deployar
├── src/
│   ├── net/
│   │   ├── client.js             ← WebSocket client, reconexão, ping, heartbeat
│   │   ├── protocol.js           ← espelho do protocolo do servidor
│   │   ├── snapshot.js           ← buffer + interpolação de jogadores remotos
│   │   └── remotePlayer.js       ← avatar remoto (reusa Human) + nome flutuante
│   ├── modes/
│   │   ├── modeSelect.js         ← tela de seleção (3 cards)
│   │   ├── match.js              ← orquestra partida online (lobby→jogo→fim)
│   │   └── brLogic.js            ← zona no minimapa, loot local, avião
│   └── ui/
│       ├── lobby.js              ← sala de espera (lista, pronto, iniciar)
│       ├── killfeed.js           ← "🔫 Bob matou Maria" (some em 4s)
│       ├── scoreboard.js         ← placar: kills/mortes/ping (Tab/botão)
│       ├── brHud.js              ← vivos, distância da zona, inventário
│       ├── netStatus.js          ← ícone 📶 + ms ping
│       ├── damageDir.js          ← indicador de direção do dano recebido
│       └── result.js             ← tela de fim: estatísticas da partida
└── MULTIPLAYER.md                ← este documento
```

---

## 4. PROTOCOLO DE REDE (especificação completa)

**Transporte:** WebSocket (`ws`) + JSON compacto. Começa JSON; otimiza para binário se o BR com 24+ jogadores pesar.

### 4.1 Cliente → Servidor

```jsonc
// Conexão e sala
{ "t":"hello",   "nick":"Bob", "versao":"0.1" }
{ "t":"join",    "modo":"mp" }              // "mp" | "br"
{ "t":"pronto",  "ok":true }                // jogador pronto no lobby
{ "t":"start" }                             // só o HOST inicia a partida

// Input (a cada frame/tick ~30/s)
{ "t":"input", "seq":42,
  "move":{"fx":0.8,"fz":0.2},               // direção (0..1)
  "correr":false,
  "yaw":1.204,"pitch":0.083,                // orientação da câmera
  "pular":false,
  "atirar":true,"ads":false,
  "recarregar":false }                      // ← NOVO: tecla R

// Interações
{ "t":"pegar",  "lootId":7 }                // BR: pegar loot
{ "t":"usar",   "item":"medkit" }           // BR: usar item
{ "t":"sair",   "motivo":"quit" }
{ "t":"ping",   "t":1691280000000 }         // resposta ao ping do servidor
```

### 4.2 Servidor → Cliente

```jsonc
// Handshake
{ "t":"bemvindo", "id":0, "modo":"br", "mapa":"cidade", "seed":12345,
  "versaoServidor":"0.1", "regiao":"saopaulo" }

// Lobby
{ "t":"lobby", "jogadores":[{"id":0,"nick":"Bob","pronto":true}], "host":0,
  "codigoSala":"BR-7K2" }                   // ← NOVO: código p/ convidar amigos

// Snapshot de estado (broadcast ~30/s) — NÚCLEO
{ "t":"snap", "seq":42, "you":0, "tempo":61.4,
  "players":[
    { "id":0, "x":12.3, "y":1.7, "z":5.1, "yaw":1.2, "pitch":0.1,
      "hp":100, "vivo":true, "arma":"pistola", "equipe":0, "recarregando":false }
  ],
  "zona":{ "x":0, "z":0, "r":120 },        // BR: centro + raio
  "loot":[ { "id":7, "x":40.2, "z":-15.3, "item":"medkit" } ] } // BR

// Eventos
{ "t":"dano",   "de":3, "para":1, "dmg":24, "hp":76, "parte":"cabeca" }
{ "t":"morte",  "de":3, "para":1, "arma":"pistola", "headshot":true,
  "x":12.3, "z":5.1 }                       // ← x/z p/ drop do inventário (BR)
{ "t":"killfeed","de":"Bob","para":"Maria","arma":"pistola" }
{ "t":"spawn",  "x":..., "y":..., "z":..., "yaw":... }  // respawn/queda
{ "t":"zona",   "x":0, "z":0, "r":90, "proximaR":60, "em":30 }  // BR
{ "t":"lootTirado", "id":7, "por":0 }       // BR
{ "t":"vivos",  "n":14, "total":20 }        // BR
{ "t":"fim",    "vencedor":0, "placar":[{"id":0,"kills":5,"mortes":2}] }
{ "t":"erro",   "codigo":"sala_cheia" }
{ "t":"ping",   "t":1691280000000 }         // servidor mede latência
{ "t":"supply", "x":50, "z":-30 }           // ← NOVO: supply drop caiu (BR)
{ "t":"danoZona", "dmg":8 }                 // ← NOVO: dano por tick da zona
{ "t":"spectate", "alvo":3 }                // ← NOVO: após morrer, segue alguém
```

### 4.3 Frequências e latência

| Dado | Frequência | Tamanho aprox. |
|---|---|---|
| Input do cliente | 30/s | ~60 bytes |
| Snapshot (MP, 10 jog.) | 30/s | ~1 KB |
| Snapshot (BR, 24 jog.) | 20/s | ~3 KB (ou binário) |
| Eventos (dano/kill) | sob demanda | pequenos |

**Interpolação:** cliente mantém buffer de 2 snapshots e interpola posições dos remotos (100 ms). Jogador local: **predição** do próprio movimento + reconciliação com snapshot (smooth).

### 4.4 Heartbeat, timeout e reconexão (NOVO)

| Regra | Valor | Ação |
|---|---|---|
| Heartbeat cliente→servidor | a cada 5s (msg `ping`) | mantém a conexão viva |
| Timeout sem resposta | 10s | servidor marca como `ausente` |
| Ausente no BR | 20s | jogador vira "espectador fantasma" (não conta como vivo? **sim, continua vivo 30s**) |
| Reconexão | até 30s após queda | retoma a MESMA sala (guarda `salaId` no cliente) |
| Versão incompatível | `versao` diferente | servidor responde `erro: versao` e cliente mostra "ATUALIZE O JOGO" |

---

## 5. SERVIDOR NODE — ESPECIFICAÇÃO

### 5.1 Stack
- **Node.js 18+**, dependência única: [`ws`](https://github.com/websockets/ws)
- Sem build, sem TypeScript (o projeto é JS puro — manter coerência)
- Porta `process.env.PORT || 8080` (Render/Railway injetam a porta)

### 5.2 Estrutura de estado (memória)

```js
// Por sala:
room = {
  id: 'mp-abc123', tipo: 'mp'|'br', status: 'lobby'|'contagem'|'jogo'|'fim',
  host: 0, seed: 12345, codigoSala: 'BR-7K2',
  jogadores: [ { id, nick, ws, pronto, vivo, hp, x,y,z, yaw, pitch,
                 kills, mortes, equipe, inventario:{}, ultimoInput,
                 lastFire, ausenteDesde: null } ],
  // MP:
  timeA: 0, timeB: 0,
  // BR:
  zona: { x, z, r, proximaR, em, fase },
  loot: [ { id, x, z, item } ],
  supply: { x, z, caiuEm, ativo },
  aviao: { x, z, yaw, ativo, em },
  vivos: n,
}
```

### 5.3 Física no servidor (autoritativa)

```js
// A cada tick (30 Hz):
// 1. Ler inputs de todos os jogadores
// 2. Aplicar movimento: direção * speed (valida velocidade ≤ runSpeed)
// 3. Gravidade + pulo + colisão com CollisionWorld (mesma do cliente)
// 4. Validação anti-teleporte: deslocamento máx. por tick
// 5. Colisão jogador-vs-jogador (empurrar, não atravessar) ← NOVO
// 6. Processar tiros: hitscan com a CollisionWorld (raycast) → dano
// 7. BR: encolher zona, dano fora da zona, checar vivos
// 8. Broadcast snapshot
```

### 5.4 Anti-cheat mínimo

| Cheat | Defesa |
|---|---|
| Teleporte | |Δpos| ≤ velocidade_máx × tick + tolerância (0.5m) |
| Tiro infinito | cadência mínima entre tiros por jogador |
| Velocidade | velocidade resultante ≤ runSpeed × 1.2 |
| Invulnerável | dano calculado SÓ no servidor |
| Aimbot | impossível de detectar 100% — mitigar com interpolação server-side |
| Flood de mensagens | limite de msgs/segundo por conexão (rate limit) |
| Payload malformado | `protocol.js` valida TODAS as mensagens (try/catch + schema) |
| Nick ofensivo | filtro de palavras (lista curta) + máx. 16 chars |

### 5.5 Matchmaking (simples)

1. Cliente manda `join {modo}`.
2. Servidor procura sala do tipo com status `lobby` e vagas (`mp: max 8–12`, `br: max 16–24`).
3. Se não achar, **cria** uma; o 1º jogador vira **host**.
4. Host clica INICIAR (ou contagem automática 30s no BR) → `contagem` 5s → `jogo`.

### 5.6 Salas privadas e convites (NOVO)

- Toda sala ganha um **código** (`BR-7K2`) mostrado no lobby.
- Jogador pode digitar um código → entra na sala específica (em vez de matchmaking).
- *Futuro:* convite por link (`https://site/#sala=BR-7K2`).

### 5.7 Identidade e persistência (NOVO)

- **Nickname** salvo no `localStorage` do cliente (`'nick'`) — sem login/senha na 1ª versão.
- Servidor guarda stats por nick em **arquivo JSON** (`server/data/stats.json`, com backup simples):
```js
{ "Bob": { partidas: 42, vitorias: 7, kills: 310, mortes: 180, kd: 1.72 } }
```
- Cliente mostra stats na tela de resultado ("SEU RECORDE: 7 vitórias").
- *Futuro:* SQLite + ranking global + skins.

### 5.8 Observabilidade (NOVO)

- `GET /health` → `{ ok:true, jogadores: 23, salas: 4 }` (para o Render monitorar).
- Log estruturado no console: `[12:03:01] sala BR-7K2 | Bob entrou (5/24)`.
- Métricas simples: pico de jogadores, tick médio (ms), erros de protocolo.
- Se o tick passar de 50ms → log de alerta (ajuda a detectar lentidão).

---

## 6. MODO MULTIPLAYER (MATA-MATA) — ESPECIFICAÇÃO

### 6.1 Regras
- **2 equipes:** Verde 🇧🇷 (time 0) × Amarelo (time 1). Cor do avatar + nome no HUD.
- **8–12 jogadores** (4–6 por time), respawn automático em 3s.
- **Objetivo:** primeira equipe a `limiteKills` (ex: 30) ou maior placar em `tempoLimite` (ex: 10 min).
- **Mapa:** cidade atual (1,4 km) — modo a pé apenas (1ª versão).
- **Armas:** pistola (padrão, munição infinita) + opcional metralhadora/escopeta como loot de mapa (decisão pendente).

### 6.2 Fluxo
```
Lobby (nick + pronto + host inicia)
  → contagem 5s (HUD: 3..2..1)
  → spawn em pontos seguros do time (lista de pontos fixos)
  → jogo (respawn 3s após morte)
  → fim (limite de kills OU tempo) → placar final → voltar ao lobby/menu
```

### 6.3 HUD do MP
- Killfeed (canto sup. direito): "🔫 Bob → Maria"
- Placar (Tab / botão ⏱): kills, mortes, ping por jogador + total dos times
- Timer da partida (reusa `#timer`)
- Spawn countdown ("VOCÊ MORREU — 3s")
- `#net-status`: 📶 + ping ms

### 6.4 Regras extras (NOVO)
- **Spawn protegido:** 3s de invencibilidade ao renascer (avatar piscando) — evita spawn-kill.
- **Desempate:** se o tempo acabar com placar igual → vitória do time com mais kills no último minuto (ou prorrogação de 1 min — decidir).
- **Dano de queda:** ativo (como no single, se existir) — testar consistência.
- *Futuro:* modos alternativos (FFA, Dominação de pontos) — arquitetura de sala já permite `tipo`.

---

## 7. MODO BATTLE ROYALE — ESPECIFICAÇÃO

### 7.1 Regras
- **16–24 jogadores**, todos-vs-todos, **sem respawn**.
- **Queda de avião:** todos iniciam no avião voando sobre o mapa; cada um escolhe quando pular → paraquedas (controlável) → pouso.
- **Loot:** armas, munição, medkits espalhados pelo mapa (gerados com seed determinística — iguais para todos).
- **Zona:** círculo encolhendo em fases. Fora da zona = dano progressivo (1º dano 5/s, aumenta). Anel visível (círculo 3D no chão + minimapa).
- **Vitória:** último jogador vivo (ou time, se em squad — 1ª versão: solo).
- **Mapa:** cidade atual inteira + marcos (Corcovado etc.) — a zona usa os limites do mapa (~1,4 km).

### 7.2 Fases da zona (exemplo)
| Fase | Raio | Tempo até encolher | Dano/s fora |
|---|---|---|---|
| 1 | 700 m (mapa todo) | 60 s | 5 |
| 2 | 450 m | 45 s | 8 |
| 3 | 280 m | 35 s | 12 |
| 4 | 160 m | 25 s | 16 |
| 5 | 80 m | 20 s | 20 |
| 6 | 30 m (fim) | 15 s | 25 |

A zona NUNCA encolhe para fora do mapa; cada fase sorteia novo centro dentro do círculo anterior (seed compartilhada). **Círculo final:** para a partida terminar, na fase 6 o dano sobe para 50/s e a zona fecha até r=0 — ninguém sobrevive fora (evita "partida infinita").

### 7.3 Loot (inventário)
```js
// Itens da 1ª versão
{ "pistola":   { municao: 60, dano: 24 }
  "metralhadora": { municao: 120, dano: 14, cadencia: 600/min }
  "escopeta":  { municao: 24, dano: 12×8, alcanceCurto: true }
  "medkit":    { cura: 50, tempoUso: 2s }
  "colete":    { absorve: 30 } }
```
- Inventário: 2 slots de arma + 3 itens de cura. Trocar arma com botão (⚔️ alternar).
- Spawns: ~40 pontos fixos pela cidade + 20 nos marcos (seed sorteia os itens).
- **Munição compartilhada** entre armas do mesmo calibre (simples).

### 7.4 HUD do BR
- **Vivos:** "14 VIVOS / 20" (canto sup. esquerdo, substitui corações)
- **Zona:** círculo no `#minimap` + distância/direção ("➡ 240 m") + aviso "ZONA ENCOLHENDO EM 30s" + anel 3D no chão
- **Inventário:** barra inferior com arma atual + munição + itens de cura (reusa área dos botões de toque)
- **Queda:** tela de paraquedas (ALT + VEL, reusa `#heli-panel` visual)
- **Vitória/Derrota:** tela "🏆 VOCÊ VENCEU" / "💀 VOCÊ MORREU — 12º lugar" + botão voltar
- Killfeed + net-status (como MP)

### 7.5 Regras extras do BR (NOVO)

**Dano de queda:** ao pousar de paraquedas NÃO há dano; mas cair de um prédio alto SEM paraquedas causa dano (mesma regra do single — verificar se existe; se não, adicionar: >8m de queda = 15 de dano por 5m extra).

**Desarmado:** ao cair do avião o jogador NÃO tem arma → precisa de um ataque básico (soco: dano 15, alcance 2m, cadência 1.5/s) para não ficar indefeso até achar loot.

**Drop do inventário:** ao morrer, o jogador solta os itens no chão (cair na posição `x,z` do evento `morte`) — outros podem pegar. **Supply drops:** a cada ~90s cai uma caixa de suprimento em ponto aleatório (evento `supply`) com loot raro (escopeta + medkit + colete) — cria disputa de território.

**Killcam:** na tela de morte, replay de 3s da câmera de quem te matou (simples: reposiciona a câmera na posição do assassino no momento do tiro — servidor guarda os últimos 3s de snapshots do assassino).

**Espectador:** após morrer, o cliente entra em modo espectador (câmera segue o assassino ou o líder atual — evento `spectate`); pode pular para o próximo vivo com botão.

**Squad (futuro):** times de 2–4 com "DBNO" (cair de joelhos, companheiro revive em 5s) — arquitetura já permite (flag `derrubado` no jogador).

**Zona e itens fora do mapa:** loot que cai fora da zona some após a fase — sem "farm de loot inacessível".

---

## 8. INTEGRAÇÃO NO CLIENTE

### 8.1 Menu de modos (index.html)
```
#title-screen (atual)
  └── NOVO: #mode-select
       ├── 🏺 MISSÕES      → fluxo atual (start button)
       ├── 🔫 MULTIPLAYER  → abre #lobby-screen (modo mp)
       └── 🪂 BATTLE ROYALE→ abre #lobby-screen (modo br)

#lobby-screen (NOVO, hidden por padrão)
  ├── campo de nickname (input, salvo em localStorage 'nick')
  ├── lista de jogadores (nick + ✅ pronto + host 👑)
  ├── código da sala (mostrar + campo para entrar) ← NOVO
  ├── botão PRONTO (toggle)
  ├── botão INICIAR (só host, habilita quando todos prontos)
  └── botão VOLTAR
```

### 8.2 Orquestração (modes/match.js)
```
modeSelect → escolhe modo → cria NetClient → connect(ws://...)
  → lobby (espera) → contagem → partida:
      - Game roda em modo online: Player LOCAL controlado por input
      - remotePlayer.js instancia Human para cada jogador do snapshot
      - bullets.js: tiros LOCAIS visuais + dano calculado no servidor
  → fim → tela de resultado (estatísticas) → volta ao lobby/menu
```

### 8.3 Reuso máximo
- **Player local:** mesma classe `Player` — inputs enviados ao servidor; snapshot do servidor corrige a posição (predição + reconciliação).
- **Avatares remotos:** `ent/human.js` instanciado com posição do snapshot (interpolação), nome flutuante via sprite, cor da equipe no material.
- **Touch controls:** intactos; botão de ATIRAR envia `atirar:true` no input.
- **Minimapa:** `ui/minimap.js` ganha círculo de zona (BR) e pontos dos jogadores (MP/BR).
- **Audio:** intacto — tudo sintetizado, zero assets para sincronizar.
- **Qualidade gráfica:** usar o sistema de presets existente; remotos com LOD (simples a >60 m).

### 8.4 Áudio posicional (NOVO — crítico para FPS online)
- O `sys/audio.js` é 100% WebAudio → usar **PannerNode** (posição 3D) para:
  - **Passos** de jogadores próximos (volume/canal conforme distância e direção)
  - **Tiros** distantes (som "seco" a >150m, direcional)
  - **Zona/avião/supply** (aviso sonoro com direção)
- Cliente calcula a posição relativa a partir do snapshot (x,z do remoto vs. jogador local).
- Sem assets novos: sintetizar sons curtos de passo/tiro com osciladores (já é o padrão do projeto).

### 8.5 Feedback de dano recebido (NOVO)
- **Indicador de direção:** borda da tela vermelha no lado de onde veio o tiro (evento `dano` traz `de` → calcula ângulo) — essencial em BR.
- Hitmarker (já existe `#hitmarker`) liga no evento `dano` que você causou.
- HUD de HP (reusa `#hearts` como barra única no MP/BR).

### 8.6 Acessibilidade e idioma (NOVO)
- **Daltonismo:** cores de time não dependem SÓ de verde/amarelo — ter ícone (⚔️ vs 🛡️) + contorno no nome.
- Tamanho do HUD: opção "HUD GRANDE" (escala 1.25×) no menu de opções.
- Textos: todas as strings novas em PT-BR, centralizadas num objeto `UI_TEXT` (facilita tradução futura).
- Volume separado: música × efeitos × **voz/UI** (já existe parcialmente).

### 8.7 Performance (NOVO)
**Cliente (celular):**
- Avatares remotos com LOD: a >60m usa Human simples (sem braços animados); a >120m vira "cápsula" com nome.
- Máximo de partículas/efeitos reduzido quando há 10+ remotos na tela (reusa presets de qualidade).
- Snapshots: aplicar em lotes (1 atualização por frame, não por jogador).

**Servidor:**
- Grid espacial simples (divisão da cidade em células 32m) para o raycast de tiro só testar jogadores próximos (em vez de testar todos × todos).
- Tick 30 Hz fixo com `setInterval` + `process.hrtime` (medir deriva).
- Se BR com 24 jogadores pesar: reduzir tick BR para 20 Hz (já previsto no protocolo).

---

## 9. PLANO DE IMPLEMENTAÇÃO — 10 FASES

| Fase | Entrega | Arquivos principais | Critério de aceite |
|---|---|---|---|
| **1** | Servidor mínimo + conexão + lobby | `server/index.js`, `server/rooms/lobby.js`, `src/net/client.js`, `src/ui/lobby.js` | 2 navegadores conectam, veem nick, ficam "prontos", host inicia contagem |
| **2** | Física autoritativa + movimento | `server/world.js`, `server/physics.js`, `src/net/snapshot.js`, `src/net/remotePlayer.js` | 2 jogadores se veem andando/pulando na cidade (interpolação ok) |
| **3** | Tiro autoritativo + morte + killfeed | `server/rooms/dm.js` (base), `src/ui/killfeed.js` | Um atira no outro, dano/morte aparecem, killfeed mostra |
| **4** | Modo MP completo | `server/rooms/dm.js`, `src/modes/match.js`, `src/ui/scoreboard.js`, respawn + spawn protegido | Partida 4v4 com placar, respawn e fim por limite de kills |
| **5** | Modo BR: avião + loot + zona | `server/rooms/br.js`, `src/modes/brLogic.js`, `src/ui/brHud.js` | 4+ jogadores dropam, pegam loot, zona encolhe, último vivo vence |
| **6** | Menu 3 modos + lobby final + sala privada | `src/modes/modeSelect.js`, integração `index.html`/`game.js`, código de sala | Fluxo completo: título → escolher modo → lobby → partida → resultado |
| **7** | Polimento online v1 | `src/ui/netStatus.js`, reconexão, nomes flutuantes, sons de rede, heartbeat | Partida 10+ jogadores estável, ping visível, reconexão em 30s funciona |
| **8** | Áudio posicional + dano recebido | `src/sys/audio.js` (Panner), `src/ui/damageDir.js` | Passos/tiros direcionais audíveis; borda vermelha indica direção do tiro |
| **9** | BR avançado: supply, killcam, espectador, desarmado | `server/rooms/br.js`, `src/modes/brLogic.js`, `src/ui/result.js` | Supply drop cai, morte mostra killcam, espectador segue assassino, soco funciona |
| **10** | Deploy + teste real + stats | Render/Railway + Pages, `server/persist.js`, `src/ui/result.js` (stats) | Jogo no Pages conecta ao servidor; 2 celulares jogam; stats salvam |

**Ordem pensada para ter "aha!" cedo:** na Fase 2 dois celulares já se veem andando na mesma cidade. As fases 8–9 são "camadas de qualidade" que não bloqueiam o jogo funcionar.

---

## 10. DEPLOY (IMPORTANTE)

- **GitHub Pages NÃO roda WebSocket** — o servidor vai para uma nuvem Node:
  - **OnRender (Render.com) — tipo de serviço: WEB SERVICE** (não "Static Site": Static Site não roda Node e o WebSocket nunca sobe)
  - Railway, Fly.io, ou VPS (alternativas)

### 10.1 Passo a passo no OnRender (Web Service)

1. **Dashboard → New → Web Service** → conecta o repositório (`saboracaiteria/cs`).
2. **Root Directory:** deixe a raiz (`/`) — o `package.json` da raiz tem o `start`.
3. **Build Command:** `npm install`
4. **Start Command:** `npm start`  (roda `node server/index.js` — serve o jogo E o WebSocket na MESMA porta)
5. **Instâncias: mantenha 1 (uma).** Com 2+ instâncias, cada jogador pode cair numa instância diferente → cada um vira host da própria sala e ninguém se vê.
6. **Plano pago (não hibernar):** o free tier "dorme" após ~15 min sem uso. Ao acordar, o processo REINICIA do zero — a sala anterior sumiu, e o próximo jogador entra numa sala NOVA (sintoma clássico: "todo mundo é host"). Para testar com amigos, suba o plano pago (US$ 7/mês) ou pelo menos entrem todos na mesma janela de atividade.
7. O Render injeta a porta via `PORT` — o servidor já usa (`process.env.PORT || 3000`). Nada a configurar.

### 10.2 Cliente conectando

- O cliente conecta no MESMO host de onde a página foi aberta: `wss://<seu-servidor>.onrender.com/ws` (auto, via `serverUrl()`).
- Se o frontend ficar em OUTRO domínio (ex.: GitHub Pages), preencha `NET.wsUrl` em `src/config.js`:
  `wsUrl: 'wss://SEU-SERVIDOR.onrender.com/ws'`
- HTTPS obrigatório (WSS) — o navegador bloqueia WS misto em página HTTPS.
- O lobby agora mostra o servidor conectado (linha discreta) — se ele aparecer como `localhost` num site remoto, a configuração está errada e cada jogador cai no PRÓPRIO PC.
- **Mapa, bots e kills são SEMPRE do servidor** (seed fixa 777 nos dois lados; bots criados no servidor; killfeed/placar vêm dos eventos do servidor) — conectando todos no mesmo servidor, todo mundo vê o mesmo mapa, os mesmos bots e o placar bate.

### 10.3 Healthcheck

- `GET /health` → `{ ok:true, ... }` — configurar no painel do Render para monitorar/evitar "unhealthy".

---

## 11. DECISÕES PENDENTES (a confirmar com o usuário)

1. **MP:** equipes (verde × amarelo) ou todos-vs-todos? → *sugestão: equipes*
2. **Servidor:** Render (free) ou outro? → *sugestão: Render região São Paulo*
3. **Armas:** só pistola na 1ª versão, ou metralhadora/escopeta como loot já no BR?
4. **Veículos no MP/BR:** só a pé na 1ª versão (mais justo e simples)?
5. **Squad no BR:** solo na 1ª versão; times de 2–4 depois?
6. **Soco (desarmado):** implementar já na Fase 5 ou só na Fase 9? → *sugestão: Fase 9*
7. **Killcam:** simples (3s) ou sem killcam na 1ª versão? → *sugestão: simples na Fase 9*
8. **Stats persistidos:** arquivo JSON (grátis) ou SQLite já na 1ª versão? → *sugestão: JSON*
9. **Código de sala privada:** essencial já na Fase 6 ou depois? → *sugestão: Fase 6*
10. **Dano de queda:** usar a regra do single-player ou desativar no online? → *sugestão: mesma regra*

---

## 12. CHECKLIST POR FASE (para o modo DEV)

### Fase 1 — servidor mínimo
- [ ] `server/package.json` com `ws`
- [ ] `server/index.js`: HTTP + WebSocket, log de conexão, `GET /health`
- [ ] `server/protocol.js`: decode/encode + VALIDAÇÃO de `hello`, `join`, `pronto`, `start`, `lobby`, `ping`
- [ ] `server/rooms/lobby.js`: criar/entrar sala, nick, pronto, host, contagem
- [ ] `src/net/client.js`: conectar, reconectar, ping, heartbeat
- [ ] `src/ui/lobby.js`: tela de lobby no index.html
- [ ] Verificar seções 2.6: determinismo do terreno, fall damage, colisão entre jogadores
- [ ] Teste: 2 abas do navegador + devtools network

### Fase 2 — física autoritativa
- [ ] Copiar `src/world/collision.js` → `server/world.js` (testar em Node: raycast/ground)
- [ ] Confirmar determinismo de `terrain.js` (rodar em Node, comparar alturas)
- [ ] `server/physics.js`: movimento, gravidade, pulo, colisão
- [ ] Loop de tick 30 Hz + snapshot
- [ ] Colisão jogador-vs-jogador
- [ ] `src/net/snapshot.js`: buffer + interpolação
- [ ] `src/net/remotePlayer.js`: Human remoto + nome
- [ ] Teste: 2 jogadores andam/pulam sincronizados

### Fase 3 — tiro
- [ ] Servidor: hitscan com CollisionWorld (raycast) contra jogadores (raio do corpo + head y=1.47)
- [ ] Cadência de tiro validada no servidor
- [ ] Eventos `dano`, `morte`, `killfeed`
- [ ] `src/ui/killfeed.js` no HUD
- [ ] Teste: um mata o outro, killfeed aparece

### Fase 4 — MP completo
- [ ] `server/rooms/dm.js`: times, respawn 3s, spawn protegido, limite de kills, tempo
- [ ] Pontos de spawn por time
- [ ] `src/ui/scoreboard.js` + timer
- [ ] Desempate (se tempo estourar)
- [ ] Teste: partida 4v4 completa com placar

### Fase 5 — BR
- [ ] `server/rooms/br.js`: avião, paraquedas, loot (seed), zona em fases
- [ ] Dano da zona + `vivos` + círculo final (fecha até 0)
- [ ] `src/modes/brLogic.js`: render zona (anel 3D + minimapa), inventário
- [ ] `src/ui/brHud.js`: vivos, distância zona, inventário, tela vitória/derrota
- [ ] Teste: 4+ jogadores, um vence

### Fase 6 — menu + salas privadas
- [ ] `src/modes/modeSelect.js` + cards no index.html
- [ ] Ligar botão INICIAR atual → MISSÕES; novos → MP/BR
- [ ] Código de sala (mostrar + entrar)
- [ ] Fluxo completo lobby→partida→resultado→menu

### Fase 7 — polimento online
- [ ] `src/ui/netStatus.js` 📶 + ping
- [ ] Heartbeat + timeout + reconexão 30s
- [ ] Nomes flutuantes (sprites)
- [ ] Sons: kill, hitmarker, zona, vitória (WebAudio)
- [ ] LOD de avatares remotos
- [ ] Filtro de nick + rate limit

### Fase 8 — áudio posicional + dano recebido
- [ ] PannerNode no `sys/audio.js` (passos, tiros direcionais, zona)
- [ ] `src/ui/damageDir.js`: borda vermelha direcional
- [ ] Teste: ouvir passos de outro jogador se aproximando

### Fase 9 — BR avançado
- [ ] Supply drop (evento `supply`, caixa 3D, loot raro)
- [ ] Killcam 3s (snapshots do assassino)
- [ ] Espectador pós-morte (`spectate` + pular alvo)
- [ ] Soco/desarmado (dano 15, alcance 2m)
- [ ] Drop de inventário na morte + coleta
- [ ] Teste: BR completo com killcam e supply

### Fase 10 — deploy + stats
- [ ] Subir `server/` no Render (região São Paulo)
- [ ] `NET.wsUrl` no config.js
- [ ] `server/persist.js`: stats por nick em JSON
- [ ] `src/ui/result.js`: estatísticas + recorde
- [ ] Push Pages + teste 2 celulares
- [ ] Atualizar este documento com decisões finais

---

## 13. GLOSSÁRIO

| Termo | Significado |
|---|---|
| **Snapshot** | Estado completo da partida enviado N vezes/segundo |
| **Input** | Comando do jogador (direção, mira, atirar) |
| **Autoritativo** | Servidor decide tudo; cliente apenas sugere inputs |
| **Interpolação** | Suavizar posição de remotos entre 2 snapshots |
| **Predição** | Cliente simula o próprio movimento antes do servidor confirmar |
| **Reconciliação** | Servidor corrige a posição predita do cliente |
| **Tick** | Passo da simulação do servidor (30 Hz = 33ms) |
| **Hitbox** | Área de acerto de um jogador (corpo + cabeça) |
| **LOD** | Nível de detalhe — avatar simples a distância |
| **Heartbeat** | Mensagem periódica p/ manter a conexão viva |
| **TTK** | Time-to-kill — tempo médio para matar com uma arma |
| **DBNO** | Down-but-not-out — "cair de joelhos" (squad) |
| **Supply drop** | Caixa de suprimento que cai do céu com loot raro |
| **Killcam** | Replay curto da câmera de quem te matou |
| **Spawn protegido** | Invencibilidade temporária ao renascer |
| **Rate limit** | Limite de mensagens por segundo (anti-flood) |
| **PannerNode** | API WebAudio p/ som posicional 3D (esquerda/direita, distância) |
| **Desync** | Quando cliente e servidor discordam sobre o estado |
| **Reconexão** | Voltar a uma partida após queda de internet (janela de 30s) |

---

## 14. RISCOS E MITIGAÇÕES

| Risco | Mitigação |
|---|---|
| Latência no Brasil | Interpolação 100ms + predição; servidor em São Paulo (Render tem região BR) |
| Colisão cliente×servidor diferente | Reutilizar a MESMA `CollisionWorld` + `terrainHeight` — já verificado que são puras |
| Cheating | Validação de velocidade/cadência/rate-limit; dano só no servidor |
| Celular + 24 jogadores = FPS baixo | LOD de remotos + presets de qualidade + partículas reduzidas |
| Servidor cai no meio da partida | Reconexão 30s; healthcheck do Render reinicia; estado das salas em memória (aceitável) |
| Free tier "dorme" | Aviso no lobby ("servidor acordando..."); considerar plano pago ao divulgar |
| BR "infinito" (ninguém se mata) | Círculo final fecha até r=0 com dano 50/s — partida sempre termina |
| Zona injusta (centro sorteado longe) | Novo centro sorteado DENTRO do círculo anterior (sempre alcançável) |
| Flood/DoS básico | Rate limit por conexão + limite de conexões por IP |
| Payload inválido quebra o servidor | `protocol.js` valida TUDO (try/catch, sem confiar no cliente) |
| Versão antiga do jogo no Pages | Handshake `versao` — servidor recusa e cliente avisa "atualize" |
| Nicks duplicados | Servidor adiciona sufixo ("Bob", "Bob2") |
| Squads futuros | Arquitetura de sala já tem `equipe` no jogador — DBNO é flag a mais |

---

## 15. PRÓXIMOS PASSOS

1. **Responder as 10 decisões pendentes** (seção 11) — ou "vai nas sugestões".
2. Trocar para o **modo DEV**.
3. Executar a **Fase 1** (checklist na seção 12).
4. Atualizar este documento conforme decisões e descobertas (é o documento vivo do projeto).
