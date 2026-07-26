# 🏺 Bob em Busca da AGI Sagrada 3D

A cruzada da comunidade **Inteligência Mil Grau** em mundo aberto 3D, feita em
**Three.js (WebGL2 + PBR)**.

Bob e os escudeiros precisam recuperar os **5 Fragmentos do Cálice de Silício**
das mãos das Big Techs e trazê-los pro Brasil, onde a comunidade vai treinar o
**CURUPIRA-1** — a primeira AGI verde-amarela.

> Adaptação 3D do beat 'em up 2D
> [agisagrada](https://inteligenciamilgrau.github.io/agisagrada/). A história,
> os vilões e as guildas são os mesmos; o que mudou foi a forma de jogar.

---

## A campanha

O jogo 2D era um beat 'em up de tela lateral com um mapa-múndi de menu. Aqui a
cidade brasileira inteira é o **hub**: cada fase tem um **portal** num marco do
mapa, e chegar até ele é jogo — de carro, a pé ou de helicóptero.

| Fase | Chefão | Fragmento | Portal fica em |
|---|---|---|---|
| **0 — O Chamado** | Estagiário Vibe-Coder | 🧠 o checkpoint | Estúdio IMG, no centro |
| **1 — A Canetada** | Donald Trunfo **(colossal, na cidade)** | ⚡ Energia | mirante do **Cristo Redentor** |
| **2 — O Exército de Lata** | Ilon Mosca | 💰 Investimento | topo do **Pão de Açúcar** |
| **3 — O Templo do Lucro** | Samuca Altíssimo | 🧑‍🔬 Pesquisadores | **Museu do Olho** |
| **4 — A Biblioteca Infinita** | Dário Amô-Dei | 📚 Dados | **Pelourinho** |
| **5 — A Muralha de Firewall** | Xi Deep-Zeek | 🔲 Chips | **Ponte Hercílio Luz** |
| **FINAL — Labs IMG** | todos eles | 🔥 O Treino | centro da cidade |

Subir a serra do Corcovado de carro para ir cobrar o Trunfo é o tipo de coisa que
só existe porque o mapa já estava lá. **A viagem virou parte da fase.**

O **Plano da AGI** (tecla `J`) é o placar da campanha: oito peças, o que já caiu
e para onde ir agora. Ele existe porque num mundo aberto o jogador que voltou
depois de dois dias precisa saber, em um segundo, onde parou.

O progresso fica salvo no navegador — ninguém termina sete fases numa sentada.

---

## Por que os personagens são voxel

O jogo 2D é pixel art 16-bit. **Voxel é a tradução honesta disso para o 3D:**
pixel com profundidade. Não é uma engine diferente — um boneco de caixas é
`BoxGeometry`, e três.js desenha isso melhor do que qualquer coisa.

Sai mais barato, inclusive: um pedestre da cidade são 10 malhas de cilindro e
esfera; um boneco voxel articulado são **6 caixas**, e caixas iguais dividem
geometria e material.

O que impede de parecer asset colado de outro jogo é o **material, não a forma**.
Os blocos entram com `MeshStandardMaterial` e recebem o mesmo sol, o mesmo céu
por IBL e as mesmas sombras do resto da cena. Forma blocada + luz realista lê
como estilo; cor chapada sem luz leria como erro.

**Nenhuma imagem entra no repositório.** Os retratos da caixa de diálogo são o
próprio modelo voxel projetado de frente num canvas — as mesmas caixas, as
mesmas cores, vistas de face. Mexer no molde do personagem atualiza o retrato
junto, pelo mesmo motivo que os normal maps do projeto saem do mapa de altura:
duas coisas que precisam concordar não podem ser desenhadas duas vezes.

---

## Na cidade é terceira pessoa; na fase é primeira

Dentro da arena o jogo vira **primeira pessoa**, com a arma na tela.

Não é preferência estética — é conserto. A arena é um interior apertado, e a
câmera de terceira pessoa bate na parede atrás do jogador: o código que impede
a câmera de furar parede a empurra para frente, ela sobe na nuca do Bob e tapa
justamente a mira, bem na hora de atirar. Em primeira pessoa o problema não
existe.

A arma é o **Prompt Mágico**, o tablet-pergaminho dourado do roteiro. Ela é
filha da câmera, e isso teve duas consequências: objeto filho de câmera só
aparece se a câmera estiver na cena (o three percorre o grafo a partir dela),
e a 35 cm ela cairia dentro do plano de corte — por isso é uma miniatura logo
além do `near`, não um objeto de tamanho real colado no rosto.

O corpo do Bob some (a câmera está dentro dele). **O Loro não** — ele continua
voando ao lado, que é metade da graça.

## O Loro Estocástico

O papagaio voa atrás do ombro direito o tempo todo. Ele não copia a posição do
Bob: persegue um ponto-alvo com **mola amortecida**, e é essa folga que faz
parecer bicho em vez de peça grudada — quando o Bob vira de repente, o Loro faz
a curva larga e alcança depois.

## Energia

São **6 corações**, e eles voltam: sem apanhar por 9 s, você recupera um a cada
6 s. Eram 3, herdados do jogo de entregas — ali o risco era atropelamento
ocasional. A campanha mudou o jogo: ondas de capangas, canetadas teleguiadas e
chefões de 55 m, tudo a céu aberto ao mesmo tempo. Com 3 a fase acabava antes de
o jogador entender o padrão do chefão, que é justamente a graça.

A regeneração recompensa recuar e se reposicionar em vez de punir para sempre um
erro dos primeiros segundos — e no meio da briga ela nunca completa, porque o
relógio zera a cada dano.

## O míssil teleguiado (`X`)

Arma pesada de recarga longa: aponte a mira num inimigo, a trava fecha, e o
míssil **persegue ele** até acertar. 120 de dano, 11 s de recarga.

Existe porque o tiro comum e o míssil do helicóptero são balísticos: contra um
drone que zigue-zagueia a 40 m, ou contra um chefão de 15 m que anda enquanto
você recua, acertar vira loteria.

A trava não é raio exato — acha o inimigo cujo **ângulo** em relação à mira é o
menor dentro de um cone de ~14°. Assim vale "colocar a mira em cima", que é o
que o jogador acha que está fazendo, e não "encostar o raio no colisor". E o
tamanho do alvo puxa a trava a favor: sem isso, um colosso de 55 m visto de
perto ficava *mais* difícil de travar que um drone, porque o centro dele sai do
cone justamente quando ele enche a tela.

## Os dois ajudantes, decididos pelos pés

Atirar chama um companheiro, e **quem vem depende do pulo**:

| | Quem ataca | O que faz |
|---|---|---|
| Atirar **no ar** | 🦜 **Loro Estocástico** | mergulha girando e crava o bico (22 de dano) |
| Atirar **no chão** | 🤖 **Saci-Bot** | some num redemoinho e reaparece ATRÁS do inimigo (30 de dano) |

Uma tecla, dois golpes. Amarrar no pulo é o que transforma os dois em coisa
que se aprende a usar, em vez de automatismo que resolve a luta sozinho — e dá
ao pulo uma função ofensiva, que ele não tinha.

O Loro é a *Repetição Infinita* do jogo 2D, onde ele repetia o último golpe que
via na tela; aqui ele repete o SEU. O **Saci-Bot** é a conquista da Guilda dos
Roboticistas, montado com os blueprints do Optimus roubados na Gigafábrica —
ele só aparece depois que o Ilon cai. Reaparece atrás do alvo porque quem
rouba não chega pela frente.

## O Estúdio e o Labs IMG são prédios de verdade

Os dois pontos onde a campanha começa e termina agora são **galpões com porta e
hall**, em quarteirões reservados no centro. O portal fica dentro do hall: dá
para ver da rua pelo vão da porta, mas é preciso entrar.

Isso conserta um erro de coordenada que passou despercebido. Os cruzamentos da
malha ficam em múltiplos de 64 a partir de −224 — **−224, −160, −96, −32, 32,
96, 160, 224**. Ou seja: (0,0) e (0,64) *parecem* esquinas redondas e são
exatamente o **centro de um quarteirão**. O portal nascia dentro de um prédio
genérico, sem porta por onde entrar.

A colisão da fachada é dividida em dois trechos, deixando o vão da porta livre —
é isso que separa "prédio com desenho de porta" de "prédio em que se entra".
Testado nos dois: entrando pelo eixo da porta, passa; 12 m fora do eixo, a
parede barra.

O quarteirão é reservado antes da geração dos prédios, pelo mesmo caminho que o
heliporto já usava — `city.js` só ergue prédio em bloco `urban` e só planta
árvore em `park`, então o reservado nasce limpo.

## A guerra é na cidade

Nenhuma fase acontece em sala fechada. Os inimigos **saem do marco** que o
chefão ocupou — a boca da ponte, o vão do museu, o largo do Pelourinho — e a
briga corre a céu aberto, com trânsito, pedestres, carro e helicóptero ao
alcance.

O que separa um chefão do outro é o **tamanho**, e o tamanho muda a luta:

| Porte | Altura | Como se enfrenta | Quem |
|---|---|---|---|
| médio | 4,5 m | a pé, na porrada e no tiro | Estagiário, Samuca |
| grande | 15 m | precisa recuar; carro ajuda | Ilon (no mecha), Dário |
| colossal | 55 m | **só míssil de helicóptero** | Trunfo, Deep-Zeek |

A escala é mecânica, não enfeite: um boneco de 55 m combatido do chão vira
frustração, e um de 4,5 m combatido só de helicóptero vira tédio. Por isso
`soMissil` está amarrado ao PORTE. Já `marcha` é da FICHA — dos dois colossos,
só o Trunfo ameaça o Labs IMG; o dragão do Deep-Zeek persegue você. Amarrar a
marcha ao tamanho faria os dois jogarem a mesma luta.

## King Kong no Corcovado

O Trunfo desce do Corcovado e marcha os ~650 m até o laboratório. Mas abaixo de
**28% de vida** ele larga a marcha e **corre de volta morro acima para se
agarrar no Cristo Redentor** — e a luta vira aérea em volta da estátua.

Vale como último ato porque **inverte a pressão**: até ali o relógio corria
contra você, com ele caminhando para o galpão; agora ele está parado no ponto
mais alto do mapa e é você quem precisa chegar perto de um bicho de 55 m.

Um detalhe que a implementação obrigou: a escalada é interpolada pela distância
percorrida, **não pelo relevo**. O Corcovado de propósito não tem superfície
caminhável registrada — a colisão dele é amarrada à borda interna da estrada em
espiral, um equilíbrio que já custou caro. Pedir a altura ao mundo deixaria ele
andando no pé do morro.

Quatro regras fazem a luta funcionar:

**Bala não faz nada.** Atirar de pistola avisa na tela em vez de não fazer
efeito calado — sem o aviso o jogador acha que é bug, metralhando um alvo
enorme sem ver número descer.

**Ele caminha para um destino.** Se chegar, pisa no galpão e a fase é perdida.
São ~835 m a 6,5 m/s, e ele acelera para 11 m/s quando a vida cai: o relógio da
fase é a ameaça andando, não um cronômetro abstrato na tela.

**As canetadas perseguem, mas mal.** Os decretos voadores corrigem o rumo a
1,5 rad/s. Testado: alvo parado toma em 2,6 s, alvo fugindo a 55 m/s despista.
Perseguição perfeita não é desafio, é imposto — e sem ataque nenhum de longe
bastava ficar parado a 200 m metralhando sem risco.

**O tremor sai da animação, não de um cronômetro.** O baque de cada pisada
dispara quando a perna do boneco cruza o chão, então continua batendo junto com
o pé mesmo quando ele muda de velocidade.

## Som e trilha: tudo sintetizado

Cada efeito é montado na hora com osciladores e ruído em WebAudio — **nenhum
arquivo de áudio**. O jogo 2D já fazia assim, e aqui a razão é a mesma mais uma:
o projeto inteiro não tem um único asset externo (texturas procedurais, retratos
gerados do modelo voxel). Um `.mp3` seria a primeira exceção, e uma que pesa
megabytes.

O `AudioContext` nasce no **primeiro clique**, não na carga: navegador nenhum
deixa tocar áudio antes de um gesto, e criado cedo demais ele nasceria suspenso
e tudo sairia mudo sem explicação.

Volume em quatro níveis (MUDO / BAIXO / MÉDIO / ALTO), na tela de abertura ou na
tecla `O`, salvo no navegador.

Há uma trava por tipo de efeito: sem ela, uma explosão que pega 12 pedestres
dispara 12 sons no mesmo milissegundo e satura — vira estalo sujo em vez de
estouro.

### As trilhas vieram do jogo 2D

O motor de música chiptune foi portado inteiro: **13 trilhas**, mesmos acordes,
mesma marcha imperial de chefão. Cada fase toca a sua, e a cidade entre fases
toca a lofi de planejamento.

| Quando | Trilha |
|---|---|
| Tela de abertura | `abertura` — piano lento de lenda antiga |
| Na cidade, entre fases | `menu` — lofi de café e mapa |
| Fase 0 | `saopaulo` — **o tema surf em Mi frígio**, o hino do canal |
| Fases 1 a 5 | `washington`, `fabrica`, `vale`, `biblioteca`, `muralha` |
| Fase final | `final` — corrida heroica Am-F-C-G |
| **Chefão entra** | `boss` — **a marcha imperial em sol menor** |
| Vitória / derrota | `vitoria` + fanfarra · `gameover` |

O sequenciador **agenda à frente**, não toca "agora": a cada quadro ele enfileira
no relógio do áudio tudo que couber nos próximos 120 ms. O
`requestAnimationFrame` varia 10 ms de um quadro para o outro, e disparar nota
na hora do quadro faria a batida balançar junto com o FPS. O relógio do áudio
não balança.

Um teto de 64 passos por quadro protege o caso da aba em segundo plano: ao
voltar, `currentTime` pulou vários segundos e o laço tentaria agendar milhares
de notas de uma vez.

### Dá para ouvir o inimigo chegando

**Zumbido de drone**: um enxame, não um som por bicho. É uma nota contínua cuja
altura e volume vêm de quantos drones existem e de quão perto está o mais
próximo. Um oscilador por drone viraria serra elétrica; dois osciladores
levemente destunados dão o batimento de asa.

**Patinha de robô**: tique metálico curto por inimigo que anda, com trava de
cadência. Numa onda de seis, cada um sai em momento diferente e o conjunto vira
o tec-tec-tec de coisa se aproximando.

Os dois existem como **aviso**: numa cidade aberta o inimigo vem de trás de um
prédio e ninguém olha para os quatro lados ao mesmo tempo.

---

## Como rodar

**Online:** é só abrir o endereço do GitHub Pages. Não precisa instalar nada.

**Local**, para mexer no código: os módulos ES não funcionam abrindo o
`index.html` direto do disco — `file://` bloqueia `import` por CORS — então a
pasta precisa ser servida por HTTP. Qualquer servidor estático resolve, sem
instalar dependência nenhuma:

```bash
python -m http.server 8080     # Python 3
npx serve                      # Node
php -S localhost:8080          # PHP
```

Depois abra `http://localhost:8080`.

O Three.js é carregado por CDN (unpkg), como pedido — então a **primeira
execução precisa de internet**. Depois disso o navegador guarda em cache.

---

## Publicando no GitHub Pages

O jogo é 100% estático — HTML, CSS e módulos ES, sem build e sem dependências
para instalar. Dá para publicar o repositório como está.

```bash
git init
git add .
git commit -m "Cidade 3D IMG"
git branch -M main
git remote add origin https://github.com/inteligenciamilgrau/agisagrada3d.git
git push -u origin main
```

Depois, no GitHub: **Settings → Pages → Source: GitHub Actions**. O workflow em
`.github/workflows/pages.yml` publica a cada `push` na `main`, e o jogo fica em:

**https://inteligenciamilgrau.github.io/agisagrada3d/**

Três detalhes que fazem isso funcionar:

**Todos os caminhos são relativos** (`./src/main.js`, `./css/style.css`), então
o jogo roda numa subpasta — que é onde o Pages coloca um projeto — sem precisar
de `base` configurado em lugar nenhum.

**`.nojekyll` na raiz.** Sem ele o Pages passa o site pelo Jekyll, que descarta
qualquer caminho começando com `_` ou `.`. Hoje não há nenhum, mas o dia em que
houver o arquivo some da publicação sem erro nenhum — é o tipo de falha que
custa uma tarde.

**O pointer lock exige HTTPS ou localhost.** O Pages serve em HTTPS, então a
mira travada funciona igual. Abrir por `file://` não funciona nem localmente.

Não há nada a esconder no repositório: as texturas são todas procedurais
(nenhum asset externo), não existe chave de API nem back-end, e o `localStorage`
guarda só as preferências de quem joga, no navegador de quem joga.

---

## Por que o MUNDO não é voxel

Os personagens são voxel (seção acima); **o mundo não é**, e a distinção é
proposital. Cristo Redentor, Pão de Açúcar, Hercílio Luz e o casario do
Pelourinho vivem de forma curva e de reflexo — em cubo, viram outra coisa.
Personagem é o contrário: são ~20 figuras que precisam ser reconhecíveis à
distância, e aí o blocado com 3 ou 4 marcas fortes lê melhor que humanoide
orgânico mal modelado.

A escolha para o cenário foi **Three.js com pipeline PBR**, não voxel:

| | Voxel art | Three.js + PBR (escolhido) |
|---|---|---|
| Geometria | cubos, silhueta serrilhada | qualquer forma; prédios, estátua, morros |
| Materiais | cor chapada por voxel | metalness/roughness, verniz automotivo, vidro |
| Iluminação | tipicamente sem IBL | sol + céu real como mapa de ambiente (IBL) |
| Reflexos | ausentes | PMREM do céu em carros, vidros e água |
| Pós-processo | pouco ganho | tone mapping ACES, bloom, SMAA, SSAO |

Voxel é **estilizado por definição** — o "quadriculado" é a estética. Como o
pedido era o visual mais realista possível, o caminho é PBR.

### O que está ligado no pipeline gráfico

- **WebGL2** com espaço de cor correto e **tone mapping ACES Filmic**
- **Céu de Preetham** (espalhamento Rayleigh/Mie) dirigindo a hora do dia
- **IBL**: o próprio céu vira mapa de ambiente via PMREM, atualizado ao longo do dia
- **Sombras** direcionais PCF-Soft até 2048², com frustum que segue o jogador e
  *snap* na grade de texels (evita cintilação das bordas)
- **Bloom** seletivo (só fontes de luz de verdade) e **SMAA**
- **Verniz automotivo** (`clearcoat`) nos carros e no helicóptero
- **Texturas 100% procedurais** geradas em canvas — nenhum asset externo

> Não há SSAO. O `SSAOPass` do three renderiza um passe próprio de normais e
> profundidade com `scene.overrideMaterial`; nesta cena — cheia de
> `InstancedMesh` e com um `ShaderMaterial` customizado nas partículas — o AO
> sai zerado e **apaga a tela inteira** (verificado: quadro preto uniforme).
> A oclusão de contato aqui vem das sombras direcionais.

---

## Qualidade gráfica (tecla `G`)

O HUD mostra o **FPS** e o perfil atual no topo da tela. `G` alterna entre três
perfis e um aviso indica para qual mudou:

| | BAIXA | MÉDIA (padrão) | ALTA |
|---|---|---|---|
| Resolução de render | 55% (30% dos pixels) | 75% (56%) | 100% |
| Sombras | desligadas | 1024², raio 45 | 2048², raio 85 |
| Bloom | não | sim, a 40% | sim, a 55% |
| SMAA | não | não | sim |
| Postes com luz real | 0 | 2 | 5 |
| Pedestres / carros | 12 / 8 | 24 / 14 | 40 / 22 |
| **Draw calls / quadro** | **123** | **187** | **294** |

O que separa os perfis, em ordem de impacto:

1. **`renderScale`** — multiplica a densidade nativa de pixels. BAIXA desenha
   30% do que ALTA desenha. Usar `Math.min(devicePixelRatio, X)` não adiantaria:
   na maioria dos monitores o `devicePixelRatio` já é 1 e o limite nunca
   entraria em ação.
2. **Bloom e SMAA** — passes de tela cheia, custo de preenchimento puro. O
   bloom roda em resolução reduzida (o resultado já é borrado, a perda é
   invisível) e o SMAA só existe no ALTA.
3. **`shadowRadius`** — quanto maior o raio, mais objetos entram no passe de
   sombra. Pesa mais que a resolução do mapa.
4. **Quantidade de pedestres e carros** — draw calls.

### Por que os pedestres não lançam sombra inteira

Cada pessoa são 10 malhas (tronco, 4 segmentos de braço, 4 de perna, número).
Com todas lançando sombra, mediu-se **414 draw calls só de pedestres** no passe
de sombra, contra ~100 do mundo inteiro — e era isso que fazia MÉDIA e ALTA
custarem quase o mesmo. Agora só o **tronco** projeta (a silhueta no chão
continua sendo de uma pessoa), o que derrubou o passe de sombra de 229 para 65
draw calls no ALTA. O jogador é exceção e projeta corpo inteiro, porque está
sempre em primeiro plano e é uma entidade só.

---

## Controles

**Todas as teclas abaixo são configuráveis** na tela `CONTROLES`, no menu de
abertura: clique numa tecla, aperte a nova, pronto. Se a tecla escolhida já
pertencia a outra ação, as duas trocam de lugar — assim nada fica sem tecla,
que é como se perde o pulo sem perceber três reatribuições depois. `ESC` é a
única fixa: ela é a saída de emergência, e um atalho mal escolhido em cima
dela trancaria o jogador dentro da partida.

A tabela mostra o padrão de fábrica.

| Tecla | Ação |
|---|---|
| `W` `A` `S` `D` | Mover |
| Mouse | Olhar **e** dirigir (o corpo, o carro e o nariz do heli seguem a câmera) |
| Scroll | Zoom |
| `Shift` | Correr (14,5 m/s — o mapa tem 1,4 km) |
| `Espaço` | Pular / subir no helicóptero |
| `F` | **Entrar na fase** (perto de um portal) · entrar/sair de carro e helicóptero |
| `J` | **O Plano da AGI** — as 8 peças e o próximo passo |
| `Espaço` | Avançar diálogo · **pular muda quem ataca junto** |
| `F` | Pular a cutscene inteira (durante uma fala) |
| `V` | Alternar câmera interna / externa |
| `E` ou clique esquerdo | Atirar — no helicóptero, dispara **míssil** |
| `X` | **Míssil teleguiado** — trava no alvo sob a mira e persegue (recarga 11 s) |
| `C` | Abrir o celular |
| `T` | Ligar/desligar o limite de tempo |
| `G` | Alternar qualidade gráfica (BAIXA / MÉDIA / ALTA) |
| `L` | Alcance de renderização (CURTA / MÉDIA / LONGA / TOTAL) |
| `O` | Volume do som (MUDO / BAIXO / MÉDIO / ALTO) |
| `N` | Alternar iluminação (ciclo / sempre dia / sempre noite) |
| `P` | Movimento na cidade: pouca → normal → movimentada → cheia |
| `M` | Modo Deus: voar pelo mapa (`Espaço` sobe, `Shift` desce, `Ctrl` turbo) |
| `ESC` | Pausar / soltar o mouse |
| `Q` / `R` | Guinada do helicóptero |

No helicóptero: `W`/`S` frente e ré (o bico abaixa ao avançar), `A`/`D`
deslocam para os lados bancando, `Espaço` sobe e `Shift` desce.

### No celular

Em aparelho de toque os controles na tela ligam sozinhos (dá para forçar ou
desligar em `OPÇÕES ▸ CONTROLES NA TELA`). São três peças:

| Na tela | Ação |
|---|---|
| **Analógico**, embaixo à esquerda | Andar. Ele é **flutuante**: nasce onde o dedo encostar, em vez de exigir que o polegar acerte um círculo desenhado. A velocidade é proporcional à deflexão, e **no talo o Bob corre** — o anel acende para avisar |
| **Qualquer outro canto da tela** | Olhar em volta (é o mouse). **Dois dedos** dão zoom |
| **ATIRAR** (segurar), **PULAR**, **AÇÃO** | O mínimo para jogar |
| **▲ ▼** | Subir e descer — só aparecem voando |
| **👁 🚀** | Câmera interna e míssil teleguiado — só aparecem dentro de veículo e no meio de uma fase |
| **☰ 📋 📱** | Menu, o Plano da AGI e o celular |

O que não serve agora não aparece: fora do helicóptero não há botão de descer,
fora de uma fase não há botão de míssil. E durante uma conversa, o Plano ou o
celular os controles somem inteiros — a fala avança tocando em qualquer lugar.

Ao iniciar o jogo, o navegador é posto em tela cheia e, onde dá, travado na
horizontal. Estreando num celular o jogo já começa em qualidade `BAIXA` com a
cidade em `POUCA` — só na primeira vez, e só se nunca houve escolha salva ali.

**O mouse comanda a direção**, não só a câmera: a pé o corpo encara sempre para
onde a câmera olha (então `A`/`D` andam de lado sem virar as costas, e o tiro
sai na direção em que o personagem está encarando); no carro o volante busca o
rumo da câmera; no helicóptero o nariz faz o mesmo. Isso vale só nas câmeras
**externas** — na visão interna o mouse volta a apenas olhar pela cabine, senão
olhar para o lado esterçaria o veículo e o veículo giraria o olhar, num laço
sem fim. Ao entrar num veículo a câmera nasce alinhada com ele, para não dar
um tranco tentando acertar o rumo.

### Olhar para cima

A vista sobe até ~77° (e desce até ~66°), o bastante para acompanhar o topo dos
prédios, o Cristo visto do mirante e o helicóptero passando. Não vai aos 90°
exatos de propósito: na vertical o `lookAt` perde a referência de "para cima" e
a imagem cambaleia.

Só aumentar o limite, porém, não bastava — e este é o detalhe que interessa. Numa
câmera de terceira pessoa o braço orbita o jogador, então **olhar para cima
manda a câmera para trás e para baixo**, direto para dentro do chão. O trecho
que impede a câmera de furar o piso a devolvia para a superfície, mas o olhar
continuava mirando o jogador — que agora estava quase na altura dela. Resultado:
por mais que se puxasse o mouse, a vista empacava a uns 17°.

A correção tem duas partes, ambas em `camera.js#update`:

1. **O braço encurta conforme a vista sobe** (`pitchTuckStart`/`pitchTuck`), de
   forma que a câmera se aninha perto do personagem em vez de mergulhar.
2. **O ponto de mira sobe exatamente o quanto o chão empurrou a câmera.** Quando
   nada empurra, o alvo é o mesmo de sempre — o comportamento antigo continua
   idêntico; quando o chão levanta a câmera, ela passa a olhar *por cima* do
   jogador e o ângulo pedido chega inteiro à tela.

O teste mede o ângulo **real** da câmera (a direção do mundo, não o valor
pedido) e confere que os dois batem: 77,3° pedidos, 77,3° obtidos. Era
justamente essa diferença entre pedido e obtido que o limite sozinho escondia.

Nas visões internas o limite é menor (~60°), porque acima disso a vista é só o
teto da cabine ou o rotor.

---

## Estrutura

```
index.html            HUD, telas e importmap do Three.js
css/style.css         HUD, celular, telas de abertura/pausa/fim
.github/workflows/    publicação automática no GitHub Pages
src/
  main.js             boot e laço principal
  game.js             orquestrador: estados, veículos, dano, missão
  config.js           TODAS as constantes de mundo e de jogo
  utils.js            matemática, RNG determinístico, malha viária
  input.js            teclado, mouse, pointer lock e o estado do toque
  keys.js             ações do jogo e o mapa ação -> tecla (configurável)
  camera.js           câmera em 3ª pessoa, zoom e visões internas
  player.js           controle do jogador
  settings.js         preferências salvas no localStorage
  gfx/
    renderer.js       WebGL + pós-processamento
    sky.js            ciclo dia/noite, sol, lua, estrelas, IBL
    textures.js       todas as texturas procedurais
  world/
    collision.js      colisão, alturas de piso e raycast
    terrain.js        terreno, lago e ponte
    city.js           ruas, calçadas, faixas e prédios
    props.js          postes, árvores, arbustos, bancos
    landmarks.js      Corcovado + Cristo, Pão de Açúcar, bondinho, heliporto
    mountainroad.js   estrada em espiral até o mirante do Cristo
    brasil.js         Ponte Hercílio Luz, Museu do Olho, Pelourinho
  ent/
    human.js          personagem articulado
    pedestrian.js     IA dos pedestres (grafo de calçadas)
    car.js            carros, IA de tráfego e física do jogador
    helicopter.js     voo, pouso e embarque
  sys/
    traffic.js        semáforos de carro e de pedestre
    bullets.js        projéteis, traçantes e ricochete
    missiles.js       mísseis do helicóptero e dano em área
    fx.js             explosões, fumaça, estilhaços, onda de choque
    mission.js        coleta, entrega, pontuação
  ui/
    hud.js            corações, tempo, pontos, velocímetro
    minimap.js        radar rotativo
    phone.js          celular e conversas com os NPCs
    dialogue.js       cutscenes e retratos voxel
    plan.js           o Plano da AGI (tecla J)
    touch.js          analógico, área de olhar e botões no celular
    keysscreen.js     a tela de CONTROLES: troca de teclas
  story/
    story.js          TODO o roteiro: fases, diálogos, vilões, as 8 peças
  ent/
    voxel.js          boneco de caixas articulado (PBR)
    voxeldef.js       os moldes: quem é Bob, Trunfo, Loro, drone...
    foe.js            inimigos e chefões com vida e fases de luta
    loro.js           o papagaio que voa junto e mergulha no inimigo
    viewmodel.js      a arma na tela (o Prompt Mágico)
  sys/
    portal.js         os portais das fases no mundo aberto
    stage.js          andamento da fase: ondas, chefão, vitória
  world/
    arena.js          os interiores onde as fases acontecem
```

---

## Onde está cada requisito

| # | Requisito | Onde |
|---|---|---|
| 1 | Cidade simulada em 3D | `world/city.js` |
| 2 | Pessoas andando | `ent/pedestrian.js` |
| 3 | Carros andando | `ent/car.js` (`CarSystem`) |
| 4 | Semáforos (carro + pedestre) | `sys/traffic.js` |
| 5 | Pessoa com o objeto | `sys/mission.js` (`_pickCarrier`) |
| 6 | Entregar para outra pessoa | `sys/mission.js` (`_pickReceiver`) |
| 7 | +10 pontos e +30 s | `sys/mission.js`, `game.js#onDeliver` |
| 8 | 10 min, desativável (`T`) | `game.js#_updateTimer`, `_toggleTimer` |
| 9 | `F` entra/sai do carro | `game.js#_toggleVehicle` |
| 10 | Minimapa que gira com o jogador | `ui/minimap.js` |
| 11 | Mouse olha, WASD move | `input.js`, `camera.js`, `player.js` |
| 12 | Scroll controla o zoom | `camera.js#zoom` |
| 13 | Ciclo dia/noite | `gfx/sky.js` |
| 14 | Terceira pessoa | `camera.js` |
| 15 | Pointer lock, ESC solta | `input.js`, `game.js#_wireUI` |
| 16 | Plantas e calçadas | `world/props.js`, `city.js#_buildSidewalks` |
| 17 | Visão de dentro do carro | `game.js#_interiorTransform`, `car.js#setInteriorView` |
| 18 | Braços e pernas animados | `ent/human.js#update` |
| 19 | Faixas nas ruas | `city.js#_buildMarkings` |
| 20 | Janelas nos prédios | `gfx/textures.js#facadeTextures` |
| 21 | Faixas de pedestre | `city.js#_buildMarkings` |
| 22 | Postes de iluminação | `world/props.js#_buildLamps` |
| 23 | Mão direita, sem andar no meio | `ent/car.js` (`LANE_OFF`) |
| 24 | Atropelar explode a pessoa | `game.js#_checkVehicleImpacts` |
| 25 | `V` alterna a vista no carro | `game.js#_toggleView` |
| 26 | Bater explode o outro carro | `game.js#_checkVehicleImpacts` |
| 27 | `E`/clique atira | `game.js#_shoot`, `sys/bullets.js` |
| 28 | Velocímetro até 120 km/h | `ui/hud.js#setSpeed` |
| 29 | Reposição ao explodir | `pedestrian.js#remove`, `car.js#remove` |
| 30 | Shift corre | `player.js`, `input.js#running` |
| 31 | Colisão com prédios/postes/árvores | `world/collision.js` |
| 32 | Explodir dá +5 s | `game.js#_killPed`, `_killCar` |
| 33 | 3 corações | `config.js#PLAYER.maxHearts`, `ui/hud.js` |
| 34 | Atropelado perde coração | `game.js#_checkPlayerHit` |
| 35 | Sem corações, fim de jogo | `game.js#_damagePlayer` |
| 36 | Espaço pula | `player.js#update` |
| 37 | Mira no ponto do acerto | `camera.js#aimRay`, `game.js#_updateAimFeedback` |
| 38 | Tiro visível até acertar | `sys/bullets.js` (projétil real, não hitscan) |
| 39 | Tela de abertura | `index.html`, `game.js#_updateTitle` |
| 40 | Botão de reiniciar | `index.html#restart-btn`, `game.js#restart` |
| 41 | Ricochete | `sys/bullets.js#update` |
| 42 | Mira a 2/5 do topo | `css/style.css#crosshair`, `camera.js#aimRay` |
| 43 | Helicóptero no heliporto | `ent/helicopter.js`, `landmarks.js#_heliport` |
| 44 | Sombras | `gfx/sky.js`, `castShadow` nas malhas |
| 45 | Ninguém nasce em prédio | `collision.js#isBlocked`, `game.js#_findPlayerSpawn` |
| 46 | Pousar em laje | `helicopter.js#surfaceBelow`, `collision.js#roofHeightAt` |
| 47 | Veículos começam em 3ª pessoa | `game.js#_enterCar`, `_enterHeli` |
| 48 | ESC pausa | `game.js#pause` |
| 49 | Só sai do heli perto do chão | `helicopter.js#canExit` |
| 50 | Pacote na mão | `player.js#_makePackage`, `human.js` (pose) |
| 51 | Pegar/entregar voando | `sys/mission.js` (`airPickupRange`) |
| 52 | Lago com ponte | `world/terrain.js` |
| 53 | Cristo Redentor e Corcovado | `world/landmarks.js#_cristoRedentor` |
| 53+ | Estrada em espiral até o Cristo | `world/mountainroad.js` |
| 54 | Bondinho do Pão de Açúcar | `world/landmarks.js#_cableCar` |
| 54+ | Subir na estação a pé e viajar na cabine | `landmarks.js#_station`, `#_stationRamp`, `game.js#_boardCable` |
| 55 | Número nas costas do NPC | `ent/human.js`, `gfx/textures.js#numberTexture` |
| 56 | Celular com mensagens | `ui/phone.js` |

Os pedidos que vieram depois seguem a mesma numeração:

| # | Requisito | Onde |
|---|---|---|
| 57 | Ponte Hercílio Luz (Florianópolis) | `world/brasil.js#_herciliLuz` |
| 58 | Museu do Olho (Curitiba) | `world/brasil.js#_museuDoOlho` |
| 59 | Pelourinho (Salvador) | `world/brasil.js#_pelourinho` |
| 60 | Modo Deus: voar pelo mapa (`M`) | `player.js#updateFly`, `game.js#toggleGod` |
| 61 | Movimento na cidade, salvo (`P`) | `config.js#POPULATIONS`, `game.js#applyPopulation` |
| 62 | Voltar ao jogo pelo menu | `game.js#toTitle`, `#resumeFromTitle` |
| 63 | Mísseis no helicóptero | `sys/missiles.js`, `game.js#_fireMissile` |

Todos os pontos acima estão marcados no código com o número entre colchetes
(`// [23] ...`), então dá para buscar por `[23]` e cair direto na implementação.

---

## Duas observações sobre os requisitos

**Itens 17 e 47 se contradizem.** O 17 pede que ao entrar no carro a visão
seja de dentro; o 47 diz que o padrão do carro e do helicóptero é terceira
pessoa. Segui o **47** por ser a instrução posterior e explícita sobre o
padrão: os veículos começam em terceira pessoa e o `V` alterna para a visão
interna, que está implementada de verdade (câmera no banco do motorista, com
painel e volante, e o vidro escuro some para não tapar a visão).

---

## Preferências salvas

Tudo que dá para configurar fica guardado no `localStorage` e volta na próxima
sessão: **limite de tempo**, **iluminação**, **qualidade gráfica**, **alcance
de renderização**, **movimento na cidade**, **volume**, **controles na tela** e
**as teclas remapeadas**. O link *restaurar padrões*, dentro de `OPÇÕES`, volta
tudo ao original — inclusive as teclas, porque um reset pela metade, que diz ter
voltado ao normal e deixa o pulo no lugar errado, é pior que reset nenhum.

### O menu de abertura

A abertura tem uma pergunta só: **jogar**. As vinte teclas de atalho que ficavam
listadas ali saíram para a tela `CONTROLES`, e os seletores de qualidade, som e
população para `OPÇÕES`. Não era só desordem: a lista empurrava o botão de
iniciar para fora da janela em 720p, e a primeira coisa que o jogo mostrava era
uma parede de atalhos que ninguém decora de uma vez.

O mundo já nasce com a população salva, em vez de criar 24 pedestres
e descartar metade logo depois. Valores inválidos (de uma versão antiga ou
editados à mão) caem no padrão em vez de quebrar a inicialização, e se o
`localStorage` estiver indisponível — modo privado, `file://` — o jogo roda
igual, só não lembra entre sessões.

Fica em `src/settings.js`.

---

## Iluminação: ciclo, sempre dia ou sempre noite

Escolha em `OPÇÕES` ou com a tecla `N` em jogo. Em "sempre dia" (12h) e
"sempre noite" (22h) o relógio congela; reiniciar a partida mantém o modo.

Fixar a hora recalcula o estado do sol na hora, sem esperar o próximo quadro —
quem chama lê `nightFactor` logo em seguida para acender as janelas e os
postes, e um quadro de atraso deixaria a cidade com a luz errada.

---

## A estrada do Corcovado

Sai da malha da cidade em `(-233, -224)`, cruza o descampado e sobe o morro em
espiral (**~4,5 voltas, ~1,8 km, 8,5% de rampa constante**) até o piso do
mirante do Cristo. Dá para subir de carro inteira.

É um **viaduto sobre pilares**: o eixo da pista fica afastado da encosta e
pilares com sapata descem do tabuleiro até a rocha (de ~26 m de altura no pé do
morro a ~8 m no trecho médio). O afastamento não é enfeite — a modelagem do
morro desloca cada vértice em até ±16% do raio para dar cara de rocha, e uma
estrada colada no perfil médio ficaria enterrada nessas saliências. O
afastamento combina um fator proporcional (vence o ruído, que é proporcional)
com uma folga fixa **maior que a meia-largura da pista**, senão a borda interna
voltava a raspar a rocha justamente no trecho alto, onde o raio é pequeno.

Quatro decisões que ela obrigou:

**A curva é integrada, não parametrizada por ângulo.** Fazer a altura crescer
junto com o ângulo dava rampas de 29% perto do topo: lá em cima o morro
estreita, cada volta fica curta e o mesmo ganho de altura se espreme em muito
menos estrada. Integrando passo a passo — o avanço horizontal é que define
quanto se sobe — a rampa fica igual do pé ao topo e o número de voltas sai da
geometria do morro.

**A colisão do morro vem da estrada, e não o contrário.** Os anéis de colisão
do Corcovado usam a borda interna da pista como raio. Sem isso eles avançavam
por cima do asfalto e travavam o carro no meio da subida.

**Colisores ganharam base, não só topo.** Perto do pico as voltas ficam quase
uma sobre a outra, e o guarda-corpo de uma volta lá em cima bloqueava a pista
de baixo — o colisor era tratado como se descesse até o chão. Da mesma forma,
`groundHeightAt` passou a receber a altura de quem pergunta, para saber em qual
volta a entidade está quando duas passam pelo mesmo ponto do plano.

**Nada pode engolir a pista no topo.** O raio mínimo da espiral (32) é maior
que o mirante do Cristo: antes a última volta passava por baixo do piso dele, e
como a plataforma do mirante respondia por qualquer ponto dentro do seu raio, o
carro era teleportado para cima ao se aproximar e não conseguia mais descer. A
plataforma do mirante também passou a checar a altura de quem pergunta. E
pilares que desceriam atravessando uma volta de baixo — brotando no meio da rua
— são omitidos: ali já existe estrutura logo abaixo.

---

## Chegando ao Cristo a pé

A estrada termina exatamente na cota do mirante, e o parapeito tem uma
**abertura de 15 m** alinhada com o ponto onde ela chega. É por ali que se
entra; o resto do perímetro é sólido, senão dava para andar para fora e cair.

Duas coisas que precisaram ser acertadas juntas:

**A colisão do morro parava no piso do mirante.** Os anéis do Corcovado usam a
borda interna da pista como raio — lá em cima isso fechava justamente a
passagem da estrada para o mirante, e o Cristo ficava inacessível. Do piso do
mirante para cima nada bloqueia; quem barra o miolo é o colisor da estátua.

**O parapeito não pode nascer em cima da pista.** Numa primeira tentativa ele
ficou num raio maior que a borda interna da estrada e raspava o carro na última
volta — a descida travava ~15 s ali. O piso e o parapeito do mirante ficam
dentro da borda interna da pista; a área caminhável é um pouco maior que o piso
visível, só para encostar na estrada e não sobrar um anel sem chão entre as
duas superfícies.

---

## Uma armadilha que vale registrar

Alternar `light.visible` **recompila os shaders de toda a cena**. No three, uma
luz invisível sai da contagem de luzes, e essa contagem faz parte da chave de
cache do programa. O código fazia isso a cada frame (nos postes que acendem
perto do jogador e nos clarões de explosão), e o resultado era engasgo
constante à noite e a cada explosão.

Agora as luzes **nunca** trocam de visibilidade durante o jogo: apagam com
`intensity = 0`. A visibilidade só muda uma vez por ciclo dia/noite e quando o
jogador troca de perfil gráfico.

---

## Pegando o bondinho a pé

A estação da praia tem uma **rampa externa de 42 m** (uns 21% de inclinação)
que sobe do terreno até a plataforma de embarque. A cabine encosta ali e o `F`
embarca; no meio do vão o `F` avisa para esperar a estação.

A viagem inteira é a de verdade: **praia → Morro da Urca → Pão de Açúcar**, com
baldeação na Urca. Da praia ao topo são 150 m de altura.

Três decisões que economizaram bastante trabalho:

**A estação é um prédio maciço cujo telhado é a plataforma.** Não há mezanino
interno: o miolo é um único bloco de colisão e a rampa sobe por fora. Isso
evita ter que modelar interior, escada e vãos.

**`CABLE.cabinFloor` amarra a geometria toda.** É a distância do cabo até o
piso da cabine (5,1 m). O deck fica em `cabo − cabinFloor`, então a cabine
parada encosta no piso e não sobra degrau para entrar — o teste confere isso e
mede 0 cm nas quatro cabines.

**A cabine para antes do centro da estação**, não em cima dele. Na Urca os dois
vãos se encontram; parando no centro, as duas cabines ocupariam o mesmo ponto.
Com o recuo elas param em lados opostos da plataforma e a baldeação vira uma
travessia de uns 9 m pelo deck — que é como funciona de verdade.

As duas cabines de um mesmo vão correm em **linhas paralelas** (afastadas 3,4 m
perpendicularmente ao vão), senão se atravessariam no meio do caminho. O
afastamento é perpendicular ao vão, e não um deslocamento fixo em Z: com Z fixo
só ficaria certo num vão que corresse na direção de X.

---

## O helicóptero pousando

`HELI.landHeight` era **1,15 m** e a origem do modelo fica na base dos patins —
ou seja, pousado ele boiava mais de um metro acima do chão. Agora são 2 cm.

Junto veio um segundo problema: `surfaceBelow()` só olhava para as lajes de
prédio e, sem prédio, assumia um piso fixo de 0,24 m. Funcionava enquanto o
mapa era a cidade plana; com morro, lago, ponte, estrada da serra e as
plataformas do bondinho, pousar fora do asfalto deixava o aparelho boiando ou
enterrado. Agora vale a maior entre a laje e a superfície caminhável real.

E o disco do heliporto virou **plataforma de verdade**: antes era só pintura
sobre a calçada, 35 cm abaixo do topo do desenho, e o helicóptero pousava
afundado no concreto.

**A correção acordou um bug antigo.** Descendo a 16 m/s o aparelho afunda 27 cm
por quadro. Com a folga de 1,15 m isso nunca alcançava o topo da caixa do
prédio; com 2 cm, sim — e o quadro seguinte via o helicóptero "dentro" do
prédio e o empurrava para fora do telhado, fazendo-o despencar até o vizinho.
O pouso agora acontece em duas etapas: primeiro assenta na laje **se já vinha
por cima dela**, depois resolve os sólidos. A condição "já vinha por cima" é
necessária: sem ela, voar contra a fachada de um prédio teleportaria o
helicóptero para o telhado.

---

## Movimento na cidade (tecla `P`)

Quanta gente e quantos carros existem virou um ajuste **separado do perfil
gráfico**, com quatro níveis (18/12, 46/28, 85/48 e 140/78) salvos no
navegador. O padrão é MOVIMENTADA.

Antes a população vinha junto do perfil BAIXA/MÉDIA/ALTA, o que empacotava duas
decisões diferentes: quem quisesse a cidade cheia era obrigado a ligar sombra,
bloom e SMAA junto. Agora o perfil cuida de pixels e pós-processamento, e isto
aqui cuida de quantas pessoas e carros existem. Trocar de perfil não mexe mais
na população — há um teste travando exatamente esse ponto.

O custo é quase todo em draw calls, e o aviso está no menu.

---

## Voltar ao jogo

"Voltar ao menu" não joga mais a partida fora: o mundo continua de pé e a tela
de título ganha **VOLTAR AO JOGO** (ou `ESC`). Quando há partida em andamento o
botão de iniciar vira "COMEÇAR DE NOVO" e perde o destaque — descartar o que
estava rolando não pode ser o botão mais chamativo da tela. Depois de um fim de
jogo não há o que retomar, e o botão some.

---

## Modo Deus (tecla `M`)

Voo livre pelo mapa: sem gravidade, sem colisão e sem dano. `Espaço` sobe,
`Shift` desce, `Ctrl` dá turbo — os mesmos controles do helicóptero, porque é o
que a mão já sabe fazer. Só funciona a pé; dentro de um veículo o corpo do
jogador nem está na cena.

O único limite que sobra é o chão: voar por dentro do terreno deixaria a câmera
dentro da rocha, sem referência de para onde voltar.

---

## Os três marcos brasileiros

Ficam em `src/world/brasil.js`, todos em terreno aberto para não brigarem com a
malha da cidade nem com a estrada do Corcovado.

O detalhe fino (rebite, junta de pedra, canaleta da telha, caixilho do vidro)
vai em **textura + normal map**, não em geometria — nessa escala a imagem é a
mesma e o custo é incomparável. As texturas são procedurais como as do resto do
projeto, em `gfx/textures.js`: pedra portuguesa, reboco colonial (uma por cor),
telha-canal, azulejo português, chapa de aço rebitada, concreto de fôrma e pele
de vidro com caixilho.

Os normal maps saem de um **mapa de altura**, pela função `normalFromHeight`.
Vale mais que desenhar o relevo à mão: a mesma rotina que pinta a pedra ou a
telha serve de altura, então desenho e relevo nunca saem de sincronia. O canal
verde é invertido em relação ao eixo Y do canvas porque `CanvasTexture` sobe a
imagem com `flipY` — sem essa troca, todo o relevo aparece afundado.

A geometria é montada como listas agrupadas **por material** e fundida no fim.
Um sobrado tem umas 90 peças (batentes, bandeiras, balaústres, cimalha,
telhado); malha por peça seriam milhares de draw calls só na praça. Fundido por
material, o conjunto inteiro sai em 36 malhas.

**Ponte Hercílio Luz** — o que identifica a ponte é a "lente" entre as duas
torres: a corrente de barras desce das torres até o meio do vão enquanto a
treliça de rigidez sobe do tabuleiro para o mesmo ponto. O que dá a leitura de
ponte *metálica*, e não de viga lisa pintada de cinza, é a treliça: montantes e
diagonais em X nos dois banzos, torres treliçadas em vez de pilares chapados, e
a corrente feita de elos separados por placas de nó. Dá para atravessar a pé e
de carro; o teste faz a travessia inteira, de uma cabeceira à outra.

**Museu do Olho** — bloco horizontal sobre pilotis, pilar amarelo e o olho. A
pupila é um **segundo elipsoide**, mais estreito mas um pouco mais "gordo" na
profundidade: ele fura a casca no meio e afunda dentro dela perto da borda,
formando uma íris de contorno curvo em vez de um adesivo colado na frente. As
medidas vêm de resolver onde as duas superfícies se cruzam. A primeira
tentativa — uma calota encaixada por dentro — simplesmente não aparecia: ficava
inteira dentro da casca e o olho saía branco liso.

**Pelourinho** — duas fileiras de sobrados coloniais de frente uma para a
outra, com a igreja **fechando o fundo da rua** e o cruzeiro no adro. O que faz
o casario parecer colonial e não caixa colorida: cunhal e cimalha brancos
separando cada sobrado do vizinho, sacada de ferro com balaústres, bandeira em
arco sobre as portas, telha-canal com beiral apoiado em cachorros de madeira, e
algumas fachadas revestidas de azulejo. As cores saem de uma paleta fixa e a
variação vem do gerador com semente: a rua nasce diferente a cada casa e igual
a cada partida.

A igreja é modelada num referencial próprio (nave na origem, fachada para +Z) e
só depois **deitada um quarto de volta** e levada para a ponta da rua. Modelar
já deitada ficaria ilegível: cada peça teria de ser pensada com X e Z trocados.
`rotateY(π/2)` leva (x,y,z) para (z,y,-x), então as duas torres, que estão em
x = ±13,5, caem em z = ∓13,5 — exatamente sobre as faces internas das fileiras
de casas, emoldurando a rua. Um teste confere que caminhando pelo eixo central
o jogador esbarra na igreja, e não nas costas de uma casa.

O monumento do adro é um **cruzeiro**: a coluna termina em cruz de pedra, como
o Cruzeiro de São Francisco. Terminando em esfera, virava um poste ornamental
qualquer.

### Três coisas que só a captura de tela pegou

**Os telhados eram cones.** Um cilindro de 3 lados só vira prisma triangular
com os dois raios iguais; com raio de topo zero sai um bico. Viraram dois
planos inclinados com beiral e cumeeira.

**O reboco virou código de barras.** Os escorridos de chuva estavam a 32% de
opacidade e a umidade a 45%; de longe as casas pareciam listradas. Desgaste tem
que ficar no limite de "só se nota de perto".

**O frontão da igreja nasceu de pé**, como um paredão branco tapando a fachada.
O `thetaLength` do cilindro não garante qual metade sobra depois das rotações —
agora é um `Shape` com arco e base reta, extrudado, que não tem ambiguidade.

**O terreno furava o calçamento — e a primeira correção foi pelo lado errado.**
A cota do largo vinha de UMA amostra, no centro; como o terreno ondula, a laje
plana ficava abaixo do chão natural nas pontas e apareciam manchas de grama no
meio da praça. Levantei a laje até o ponto mais alto do relevo, e aí o problema
virou outro: ali o terreno varia **6,1 m**, então a laje passou a boiar 6 m no
ar do lado baixo, sem como subir nela.

Quem tem que ceder é o terreno. Agora existem **platôs** (`config.js#PLATOS`):
trechos aplainados que `terrainHeight` aplica antes do corredor da ponte e do
lago. A cota de cada um sai da **média** do relevo natural sob ele, calculada
uma vez na carga do módulo — `terrainHeight` roda milhares de vezes por quadro
e não pode sair integrando terreno. A borda se dissolve no relevo num fade de
26 m, virando encosta em vez de degrau.

Com o chão plano, o calçamento é só um meio-fio de 50 cm, com **dois degraus**
em volta para subir andando. Os degraus existem na colisão, não só no desenho:
senão o jogador veria a escada e continuaria esbarrando numa parede invisível.

**Os encontros da ponte viraram um paredão.** A caixa de concreto que recebe o
tabuleiro estava centrada no eixo da pista e subia 3,6 m acima do asfalto — um
quadrado enorme atravessado bem na boca da ponte. Encontro de ponte fica
enterrado: agora o bloco está inteiramente abaixo do tabuleiro e o que aparece
são duas alas laterais baixas, que guiam a entrada em vez de fechá-la.

E uma armadilha de API: `mergeGeometries` devolve **null**, só com um aviso no
console, se a lista misturar geometria indexada com não-indexada — que é o que
acontece ao juntar um `ExtrudeGeometry` (sem índice) com caixas e toros (com).
O erro aparece longe da causa, dentro do construtor de `Mesh`, reclamando de
`morphAttributes` de uma geometria nula. A função `fundir()` normaliza a lista
antes.

---

## Mísseis do helicóptero (`E` ou clique, voando)

No ar, o tiro de pistola não fazia sentido: o alvo está 80 m abaixo e uma bala
isolada não acerta nada em movimento. Voando, o `E` passa a disparar míssil.

Três diferenças em relação à bala:

- **sai devagar e acelera** (55 → 165 m/s), deixando rastro de fumaça: dá para
  ver para onde foi e corrigir a mira;
- **explode em área** (9,5 m para pessoas, 8,5 m para carros). Do alto, acertar
  um carro em movimento com um ponto seria frustrante; o raio resolve isso sem
  tirar a pontaria;
- **não ricocheteia.** Míssil que quica não existe — o ricochete [41] continua
  sendo coisa da bala.

O míssil não sai da câmera, e sim do trilho embaixo do aparelho, alternando
entre os dois pilones. Para ainda acertar onde a mira aponta, o alvo é
resolvido antes: traça-se o raio da mira, pega-se o ponto em que ele encosta e
o míssil é apontado do trilho para lá.

O dano em área percorre uma **cópia** da lista de alvos: o callback remove a
vítima e já repõe outra no lugar, e a remoção é troca-com-o-último — iterar
direto pularia elementos e poderia atingir quem acabou de nascer.

---

## A cidade não esvazia

Pessoa atropelada ou baleada e carro explodido são **repostos na hora**
(`peds.remove(ped, true)` / `cars.remove(car, true)`, requisito 29). Só a troca
de nível de movimento e o reinício removem sem repor, que é o que se espera.

O teste explode 40 pedestres e 40 carros de uma vez e confere que a contagem
volta ao nível escolhido, inclusive depois de alguns segundos de simulação.

---

## Ajustes rápidos

Quase tudo que dá vontade de mexer está em `src/config.js`:

- `PRESETS` — os três perfis de qualidade
- `POPULATIONS` — os quatro níveis de movimento na cidade
- `GRID` / `CELL` — tamanho da cidade (regenera tudo)
- `QUALITY.exposure`, `envIntensity`, `sunIntensity` — balanço de luz do dia
- `NIGHT` — brilho de janelas, postes, semáforos e bloom da noite
- `GAME.totalTime`, `deliveryPoints`, `killTimeBonus` — regras
- `DAY.duration` — quanto dura um dia completo (padrão: 210 s)
- `CABLE` — geometria e tempos do bondinho
- `PLAYER.flySpeed` — velocidade do modo Deus
- `MISSILE` — velocidade, cadência e raio de dano dos mísseis

Se ainda estiver pesado, aperte `G` até BAIXA e `P` até POUCA — agora são duas
alavancas independentes.
