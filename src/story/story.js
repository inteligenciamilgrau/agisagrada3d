/**
 * ============================================================
 *  BOB EM BUSCA DA AGI SAGRADA — dados da história
 * ============================================================
 *
 * Portado do beat 'em up 2D da comunidade Inteligência Mil Grau.
 * Aqui só existe DADO: diálogo, quem é quem, o que cada fase entrega.
 * Nada de Three.js, nada de DOM — quem desenha é `ui/dialogue.js`,
 * quem encena é `sys/stage.js`.
 *
 * Manter assim tem uma razão prática: o roteiro é a parte do jogo que
 * mais muda (a comunidade opina, a piada envelhece, o vilão da semana
 * troca). Separado, mexer no texto nunca arrisca quebrar o jogo.
 *
 * ---- A ADAPTAÇÃO 2D -> 3D ----
 * No 2D o Bob viajava o mundo numa tela que rolava para o lado.
 * Aqui a cidade é o HUB: cada fase tem um PORTAL num ponto do mapa
 * aberto, e entrar nele carrega a arena daquele país. O mapa-múndi
 * virou uma viagem de carro (ou de helicóptero, se estiver com pressa).
 */

/** As 8 peças do Plano da AGI Sagrada — o placar da campanha. */
export const PLAN_ITEMS = [
  { key: 'checkpoint',    icon: '🧠', label: 'O MODELO',      sub: 'CURUPIRA-beta resgatado' },
  { key: 'itaipu',        icon: '⚡', label: 'ENERGIA',       sub: 'a Chave de Itaipu' },
  { key: 'investimento',  icon: '💰', label: 'INVESTIMENTO',  sub: 'a aposta perdida do Ilon' },
  { key: 'pesquisadores', icon: '🧑‍🔬', label: 'PESQUISADORES', sub: 'os demitidos do Vale' },
  { key: 'dados',         icon: '📚', label: 'DADOS',         sub: 'libertados do aspirador' },
  { key: 'eficiencia',    icon: '🔲', label: 'CHIPS',         sub: 'o tesouro do dragão' },
  { key: 'predio',        icon: '🏗️', label: 'O GALPÃO',      sub: 'mutirão da comunidade' },
  { key: 'treino',        icon: '🔥', label: 'O TREINO',      sub: 'segurar os chefões e treinar' },
];

/**
 * Quem fala. A cor vira a borda do retrato e o nome na caixa de diálogo;
 * `voxel` aponta para o molde em `ent/voxeldef.js`.
 */
export const CAST = {
  BOB:         { nome: 'BOB',         cor: '#ffb020', voxel: 'bob' },
  LORO:        { nome: 'LORO',        cor: '#3ddc84', voxel: 'loro' },
  FEFE:        { nome: 'FÊ-FÊ LI',    cor: '#25d0ff', voxel: 'fefe' },
  ESCUDEIRO:   { nome: 'ESCUDEIRO',   cor: '#a78bfa', voxel: 'escudeiro' },
  MIRA:        { nome: 'MIRA',        cor: '#c9d1d9', voxel: 'mira' },
  ESTAGIARIO:  { nome: 'ESTAGIÁRIO',  cor: '#ff6b6b', voxel: 'estagiario' },
  TRUNFO:      { nome: 'TRUNFO',      cor: '#ffd700', voxel: 'trunfo' },
  ILON:        { nome: 'ILON',        cor: '#8ab4f8', voxel: 'ilon' },
  SAMUCA:      { nome: 'SAMUCA',      cor: '#b8b8b8', voxel: 'samuca' },
  DARIO:       { nome: 'DÁRIO',       cor: '#7c9cbf', voxel: 'dario' },
  DEEPZEEK:    { nome: 'DEEP-ZEEK',   cor: '#ff4d4d', voxel: 'deepzeek' },
  CURUPIRA:    { nome: 'CURUPIRA',    cor: '#3ddc84', voxel: 'curupira' },
  SISTEMA:     { nome: 'SISTEMA',     cor: '#ffb020', voxel: null },
  '???':       { nome: '???',         cor: '#8b949e', voxel: null },
};

/**
 * As fases. `portal` é onde o marcador nasce no mundo aberto — as
 * coordenadas são os marcos que o mapa já tem, então a viagem até a
 * fase é jogo de verdade, não menu.
 *
 * Marcos usados (de `world/landmarks.js` e `world/brasil.js`):
 *   Corcovado (-640,-300) · Museu do Olho (-430,128)
 *   Pelourinho (-110,-432) · Hercílio Luz (62,~362) · Pão de Açúcar (700,355)
 *
 * ---- REGRA: `portal` E `local` ANDAM JUNTOS ----
 * `local` é de onde os inimigos saem; `portal` é onde o jogador entra.
 * Os dois têm que coincidir, senão a fase começa e a briga está a
 * centenas de metros — foi o que aconteceu com a Gigafábrica, cujo
 * portal ficou no topo do Pão de Açúcar enquanto a luta acontecia 400 m
 * abaixo, e o jogador levava um tempo só para achar o combate.
 *
 * A única exceção é a fase do colosso: ali o portal fica no mirante do
 * Cristo porque dali se VÊ o gigante entrando na cidade, e ele mesmo é
 * grande demais para passar despercebido.
 */
export const PHASES = [
  // ============================================================ FASE 0
  {
    id: 0,
    local: { x: 0, z: 96 },
    key: 'chamado',
    title: 'FASE 0 — O CHAMADO',
    place: 'Estúdio IMG, São Paulo',
    flag: '🇧🇷',
    aberta: true,
    boss: 'estagiario',
    reward: 'checkpoint',
    /*
     * O portal fica no HALL do Estúdio IMG — o prédio existe de verdade,
     * com porta, no quarteirão reservado em (0, 64). A batalha é na rua
     * em frente: 96 é um cruzamento de verdade, e ali cabe a briga.
     */
    portal: { x: 0, z: 74.5, label: 'ESTÚDIO IMG' },
    intro: [
      ['BOB', 'Mais um vídeo no ar... "Será que a AGI vem em 2027?" Os membros vão amar.'],
      ['???', '*CRASH!* — drones invadem o estúdio pela janela!'],
      ['BOB', 'A GPU!! Levaram a GPU com o checkpoint do CURUPIRA-beta!! O LLM que a comunidade INTEIRA tá treinando!'],
      ['LORO', 'roubaram os pesos! roubaram os pesos! *sons de papagaio em pânico*'],
      ['BOB', 'Calma, Loro. Respira. ...Eles querem matar a nossa AGI antes dela nascer.'],
      ['BOB', 'Grande erro. Ninguém mexe com a comunidade MIL GRAU.'],
      ['BOB', '*pega o Prompt Mágico* — Hora de engenheirar uns prompts na mão dura.'],
    ],
    bossDialog: [
      ['???', 'PARADO AÍ, INFLUENCERZINHO DE IA!'],
      ['BOB', 'Quem é você?! E... por que esse crachá tem o logo de TRÊS consultorias ao mesmo tempo?'],
      ['ESTAGIARIO', 'Sou o ESTAGIÁRIO VIBE-CODER! Braço armado das Big Techs! Nunca li uma linha do código que eu entrego!'],
      ['ESTAGIARIO', 'Me mandaram exfiltrar seus pesos. Não é pessoal, Bob... é OKR.'],
      ['BOB', 'Você tá roubando a AGI de uma comunidade INTEIRA... por uma bolsa-auxílio?'],
      ['ESTAGIARIO', 'Eles prometeram EFETIVAÇÃO!! *aperta o botão de chamar drones*'],
      ['LORO', 'efetivação! efetivação! KKKKK *risada de papagaio*'],
    ],
    victory: [
      ['ESTAGIARIO', 'Ai... pega lá sua GPU... eu nem consegui o acesso ao checkpoint mesmo...'],
      ['BOB', 'OKR de quem? QUEM te mandou?!'],
      ['ESTAGIARIO', 'N-não posso falar... assinei NDA... mas pergunta pro SEU modelo. Eles têm MEDO do que ele já aprendeu.'],
      ['BOB', '*pluga a GPU e roda o CURUPIRA-beta* — Ele... desenhou um MAPA. Cinco fragmentos. Espalhados pelo mundo.'],
      ['BOB', 'O caminho da AGI Sagrada não tava num arquivo. Tava NOS PESOS. E se depender de mim... ela vai falar PORTUGUÊS.'],
      ['SISTEMA', '🎓 CONQUISTA: Guilda Prof. Milgrau — checkpoint do CURUPIRA-beta recuperado!'],
      ['SISTEMA', 'Primeiro fragmento localizado: ⚡ A CHAVE DE ITAIPU. Confiscada por decreto em... Washington, D.C.'],
    ],
    waves: [
      { at: 0.0, spawn: [['drone', 2]] },
      { at: 0.3, spawn: [['drone', 2], ['crawler', 1]] },
      { at: 0.6, spawn: [['crawler', 2], ['drone', 1]] },
      { at: 1.0, boss: true },
    ],
  },

  // ============================================================ FASE 1
  {
    id: 1,
    // ele desce do Corcovado e é para lá que foge no fim
    local: { x: -560, z: -330 },
    key: 'canetada',
    title: 'FASE 1 — A CANETADA',
    place: 'Washington, D.C.',
    flag: '🖋️',
    /*
     * ---- A ÚNICA FASE A CÉU ABERTO ----
     * O Trunfo não cabe numa sala: ele vem COLOSSAL, pisando na cidade
     * a caminho do Labs IMG, e só míssil de helicóptero o arranha.
     *
     * A fase existe assim porque o mapa tem helicóptero, mísseis e uma
     * cidade inteira, e nenhuma fase usava nada disso — todas
     * aconteciam em salas fechadas. Aqui a fase É a cidade.
     */
    aberta: true,
    boss: 'trunfoGigante',
    reward: 'itaipu',
    // o portal fica no mirante do Cristo: dali se vê a cidade inteira,
    // que é justamente por onde o gigante vem entrando
    portal: { x: -640, z: -300, y: 'mirante', label: 'A CANETADA' },
    intro: [
      ['BOB', 'O CURUPIRA-beta rastreou a Chave de Itaipu. Ela tá... vindo pra cá?'],
      ['LORO', 'grande! GRANDE! *aponta pro horizonte com a asa tremendo*'],
      ['BOB', 'Loro, isso não é um prédio novo. Isso tá ANDANDO.'],
      ['TRUNFO', '*ecoando pela cidade* — TARIFA DE IMPORTAÇÃO DE ELÉTRONS! Eu confisquei Itaipu e vim PESSOALMENTE cobrar!'],
      ['BOB', 'Ele tá indo pro Labs IMG. Se ele pisar no galpão, acabou.'],
      ['MIRA', 'Bob, esquece a pistola. Bala nem faz cócega nisso. O HELICÓPTERO. Vai de MÍSSIL.'],
      ['BOB', 'Então é hoje que eu descubro se aprendi a voar. SEGURA, MIL GRAU!'],
    ],
    bossDialog: [
      ['TRUNFO', 'Você deve ser o tal do Bob. FAKE NEWS! Eu sou o maior entendedor de AGI do mundo. Todo mundo diz isso.'],
      ['TRUNFO', 'Gente grande, gente séria, vem a mim CHORANDO: "Senhor, nos ensine a inteligência artificial".'],
      ['BOB', 'Devolve a Chave de Itaipu, Trunfo. Energia limpa não se confisca com canetada.'],
      ['TRUNFO', 'Itaipu? ADOREI aquela represa. Enorme. Tremenda. Quase do tamanho do meu ego. Agora tem TARIFA!'],
      ['TRUNFO', 'E anota aí: regulamentação é CRIME! ...exceto a MINHA regulamentação, que é PERFEITA.'],
      ['LORO', 'flip-flop! flip-flop! *voa em círculos*'],
      ['TRUNFO', 'CHEGA! Vou resolver isso do jeito que resolvo tudo: NA CANETADA!'],
    ],
    // sem ondas de capangas: a cidade não é arena, o gigante entra direto
    semOndas: true,
    victory: [
      ['TRUNFO', 'IMPOSSÍVEL! Eu NUNCA perco! Isso foi fraude... FRAUDE DE GAMEPLAY! Exijo recontagem dos hit points!'],
      ['BOB', 'A contagem tá certa, Trunfo. Zero. Igual sua noção de energia renovável.'],
      ['BOB', '*pega a Chave de Itaipu* — De volta pro povo. 14 gigawatts de treino limpo pro CURUPIRA.'],
      ['SISTEMA', '⚡ CONQUISTA: Guilda Guardiões da Matriz — CHAVE DE ITAIPU recuperada!'],
      ['SISTEMA', '⚖ Contraexemplo nº 1: "não decidir o futuro da IA por birra".'],
      ['BOB', 'Peça 2: ENERGIA ✔. Mas GPU não roda de brisa: treinar AGI custa uma FORTUNA. Precisamos de grana.'],
      ['BOB', 'E adivinha quem tem grana infinita e adora uma aposta? Texas. Bora provocar um bilionário.'],
    ],
    waves: [
      { at: 0.0, spawn: [['lobista', 2]] },
      { at: 0.3, spawn: [['lobista', 2], ['advogado', 1]] },
      { at: 0.6, spawn: [['advogado', 2], ['lobista', 1]] },
      { at: 1.0, boss: true },
    ],
  },

  // ============================================================ FASE 2
  {
    id: 2,
    // terreno aberto a leste: a gigafábrica do Ilon, longe da malha urbana
    local: { x: 380, z: 120 },
    key: 'lata',
    title: 'FASE 2 — O EXÉRCITO DE LATA',
    place: 'Gigafábrica, Texas',
    flag: '🤖',
    aberta: true,
    boss: 'ilon',
    reward: 'investimento',
    coin: true,                       // 🔘 moeda de silício escondida
    portal: { x: 380, z: 120, label: 'GIGAFÁBRICA' },
    intro: [
      ['BOB', 'Texas. A gigafábrica. O CURUPIRA rastreou o Fragmento das GPUs até aqui... junto com 10 mil robôs.'],
      ['LORO', 'optimus! optimus! *imita robozinho de fábrica*'],
      ['BOB', 'Olha o letreiro: "TRABALHE 80 HORAS OU SAIA". O RH daqui deve ser uma britadeira.'],
      ['BOB', 'O plano dele é simples: desempregar geral, pagar renda básica... e ficar com o resto. O resto = TUDO.'],
      ['???', '*megafone* — ATENÇÃO: intrusos orgânicos detectados. Produtividade deles: LAMENTÁVEL.'],
      ['BOB', 'Lamentável é roubar GPU de comunidade. BORA!'],
    ],
    bossDialog: [
      ['ILON', 'Bob! Grande fã do canal. Sério. Eu ia comprar ele semana passada, mas acabei comprando um país.'],
      ['BOB', 'Devolve as GPUs, Ilon. A comunidade precisa delas pro CURUPIRA treinar.'],
      ['ILON', 'GPUs? Estão treinando meu EXÉRCITO. Quando eu vencer, você ganha renda básica. Sem emprego, mas com renda. De nada.'],
      ['BOB', 'Então aposta comigo, apostador. Se EU vencer... você FINANCIA o nosso laboratório. Tudo. Assinado.'],
      ['ILON', 'HAHAHA! ADORO! Aposto qualquer coisa, nunca perco. Fechado! Testemunhado pela live e pelos meus 14 advogados.'],
      ['LORO', 'tá gravado! tá gravado! *tira print com a asa*'],
      ['ILON', 'E de aquecimento, uma demonstração AO VIVO do Optimus. ROBÔS: ATACAR!'],
    ],
    victory: [
      ['ILON', 'Eu... perdi? EU PERDI?! Isso nunca aconteceu. Bem... uma aposta é uma aposta. *assina o cheque chorando em ASCII*'],
      ['BOB', 'PATROCÍNIO GARANTIDO! E olha: ele fez questão de 1% do projeto. Sem direito a voto.'],
      ['SISTEMA', '💰 CONQUISTA: INVESTIMENTO! O Ilon agora financia o Labs IMG (e tuíta que a ideia foi dele).'],
      ['SISTEMA', '🤖 BÔNUS: Guilda dos Roboticistas montou o SACI-BOT com os blueprints do Optimus!'],
      ['SISTEMA', '⚖ Contraexemplo nº 2: "não demita quem te carrega".'],
      ['BOB', 'Peça 3: GRANA ✔. Agora falta GENTE que saiba treinar modelo. E o Vale anda demitindo os melhores...'],
    ],
    waves: [
      { at: 0.0, spawn: [['optimus', 3]] },
      { at: 0.3, spawn: [['optimus', 2], ['drone', 2]] },
      { at: 0.6, spawn: [['optimus', 3], ['drone', 1]] },
      { at: 1.0, boss: true },
    ],
  },

  // ============================================================ FASE 3
  {
    id: 3,
    // sob os pilotis do Museu do Olho — o campus de vidro do Samuca
    local: { x: -430, z: 128 },
    key: 'lucro',
    title: 'FASE 3 — O TEMPLO DO LUCRO SEM FINS LUCRATIVOS',
    place: 'Vale do Silício',
    flag: '💸',
    aberta: true,
    boss: 'samuca',
    reward: 'pesquisadores',
    coin: true,
    portal: { x: -430, z: 128, label: 'VALE DO SILÍCIO' },
    intro: [
      ['BOB', 'Vale do Silício. O campus onde "sem fins lucrativos" é o nome do iate.'],
      ['LORO', 'asterisco! asterisco! *aponta pra parede com a asa*'],
      ['BOB', 'É... "beneficial for humanity*". O asterisco leva pra 400 páginas de letra miúda no chão.'],
      ['BOB', 'Missão dupla: pegar o Segredo do Scaling... e RECRUTAR. Ele demitiu metade dos pesquisadores por "eficiência operacional".'],
      ['BOB', 'Cuidado com os PMs: atacam com roadmap e prometem entregar na Q4. NUNCA é na Q4.'],
      ['???', '*recepção* — Bem-vindos! Assinem o NDA da entrada. E o termo de imagem. E a cláusula 47-B.'],
      ['BOB', 'A gente NÃO vai assinar nada. Vamos, gente!'],
    ],
    bossDialog: [
      ['SAMUCA', 'Bob! Que honra. ADORO creators. Aliás: parceria de lançamento? Assina aqui, aqui e aqui.'],
      ['BOB', 'Vim pelo Segredo do Scaling, Samuca. O que era da humanidade volta pra humanidade.'],
      ['SAMUCA', '"Humanidade" é marca registrada nossa, cuidado com o processo. E o Segredo virou produto: beta fechado. Pra sempre.'],
      ['LORO', 'beta eterno! beta eterno!'],
      ['SAMUCA', 'Isso não vai ser uma luta. Vai ser uma EXPERIÊNCIA ANTECIPADA DE COMBATE. Feedback é bem-vindo!'],
    ],
    victory: [
      ['SAMUCA', 'Interessante... vou chamar essa derrota de "aprendizado". A gente pivota semana que vem.'],
      ['BOB', '*abre o cofre* — O Segredo do Scaling é... "mais dados e mais GPU"?! SÓ ISSO?! A gente achava que era MAGIA!'],
      ['???', '*do lado de fora* — Ei... vocês são do Labs IMG? A gente viu a luta. TODOS NÓS vimos a luta.'],
      ['BOB', 'Os pesquisadores demitidos! Gente... quer treinar uma AGI que fala português? Tem churrasco toda sexta.'],
      ['SISTEMA', '🧑‍🔬 CONQUISTA: PESQUISADORES! O êxodo do Vale topou na hora.'],
      ['SISTEMA', '⚖ Contraexemplo nº 3: "não chame produto de milagre".'],
      ['BOB', 'Peça 4: GENTE ✔. Mas modelo brasileiro sem dado brasileiro é papagaio de sotaque estranho.'],
    ],
    waves: [
      { at: 0.0, spawn: [['pm', 2]] },
      { at: 0.3, spawn: [['pm', 2], ['advogado', 1]] },
      { at: 0.6, spawn: [['pm', 2], ['advogado', 2]] },
      { at: 1.0, boss: true },
    ],
  },

  // ============================================================ FASE 4
  {
    id: 4,
    // o largo do Pelourinho, com a igreja fechando a rua ao fundo
    local: { x: -110, z: -432 },
    key: 'biblioteca',
    title: 'FASE 4 — A BIBLIOTECA INFINITA',
    place: 'Templo-datacenter secreto',
    flag: '📚',
    aberta: true,
    boss: 'dario',
    reward: 'dados',
    portal: { x: -110, z: -432, label: 'BIBLIOTECA INFINITA' },
    intro: [
      ['BOB', 'Uma biblioteca-catedral no meio do nada. Estantes de GPU até o teto. Monges de capuz servindo... servidores.'],
      ['LORO', '*arrepiado* — tô sentindo cheiro de crawler. CHEIRO DE CRAWLER!'],
      ['BOB', 'O Fragmento dos Dados tá no altar central. Junto com tudo que já foi postado na internet.'],
      ['BOB', 'Dizem que é o mais gentil dos chefões. Também dizem que gentileza não apaga histórico de scraping.'],
      ['???', '*eco na catedral* — Bem-vindos à Biblioteca. Seus dados de visita... já foram catalogados.'],
      ['BOB', 'Catalogou errado. A gente veio DESCATALOGAR.'],
    ],
    bossDialog: [
      ['DARIO', 'Bob! Eu li TUDO sobre você. Literalmente tudo. Inclusive o que você apagou.'],
      ['BOB', 'Devolve os dados, Dário. Dado soberano é dado no seu país, na sua língua, com seu povo.'],
      ['DARIO', 'O que eu faço é pela SEGURANÇA de todos. Alguém precisa guardar os dados da humanidade. Comigo.'],
      ['DARIO', 'Aliás... dados interessantes, os seus. *liga o aspirador* Já são meus.'],
      ['LORO', 'aspirador! aspirad— *é puxado pelo vento* SOCORRO, BOB!'],
    ],
    victory: [
      ['DARIO', '*tossindo um dado sintético* — Ok... ok. Vou escrever um ensaio sobre limites. 15 mil palavras.'],
      ['BOB', '*pega o Fragmento dos Dados* — De volta pro povo. E as fotos da sua mãe? Devolvidas. PRA ELA.'],
      ['SISTEMA', '📚 CONQUISTA: Fragmento dos Dados! O CURUPIRA vai falar português DE VERDADE!'],
      ['SISTEMA', '⚖ Contraexemplo nº 4: "gentileza não é licença pra raspar tudo".'],
      ['BOB', 'Peça 5: DADOS ✔. Falta o CORAÇÃO da máquina: CHIPS. E chip de ponta tá embargado e esgotado.'],
      ['BOB', 'A não ser... que a gente negocie com quem treina por 1/10 do preço. Muralha de Firewall, lá vamos nós.'],
    ],
    waves: [
      { at: 0.0, spawn: [['crawler', 2]] },
      { at: 0.3, spawn: [['crawler', 2], ['drone', 1]] },
      { at: 0.6, spawn: [['crawler', 3], ['drone', 1]] },
      { at: 1.0, boss: true },
    ],
  },

  // ============================================================ FASE 5
  {
    id: 5,
    // o tabuleiro da Ponte Hercílio Luz: a Muralha de Firewall
    local: { x: 62, z: 362 },
    key: 'muralha',
    title: 'FASE 5 — A GRANDE MURALHA DE FIREWALL',
    place: 'China',
    flag: '🐉',
    aberta: true,
    boss: 'deepzeek',
    reward: 'eficiencia',
    coin: true,
    portal: { x: 62, z: 362, y: 'ponte', label: 'MURALHA DE FIREWALL' },
    intro: [
      ['BOB', 'A Grande Muralha de Firewall. Cada tijolo é um rack de servidor. E... TEM UM DRAGÃO NAS NUVENS.'],
      ['LORO', '*se enfia na mochila* — dragão! DRAGÃO! eu vi no meu dataset!'],
      ['BOB', 'A última peça tá com ele: os CHIPS. Montanhas de chips... e o segredo de treinar por 1/10 do preço.'],
      ['BOB', 'Cuidado, pessoal. Aqui até o vento coleta telemetria.'],
      ['???', '*alto-falantes na muralha inteira* — Bem-vindos. Seu itinerário já era conhecido. Há três semanas.'],
      ['BOB', '...ok, isso foi assustador. BORA LOGO.'],
    ],
    bossDialog: [
      ['DEEPZEEK', 'Vocês gastaram QUATRO fases pra chegar aqui. Eu teria feito em duas. Com metade do orçamento.'],
      ['BOB', 'Deep-Zeek. A gente veio pela Eficiência. A comunidade precisa treinar o CURUPIRA sem falir.'],
      ['DEEPZEEK', '"Veio pela"? Curioso. Eficiência não se toma. Se APRENDE. Mas vamos testar se vocês merecem a lição.'],
      ['DEEPZEEK', '*escaneia o grupo* — Golpes catalogados. Clonados. Otimizados. Custo: 1/10. Chá antes?'],
      ['LORO', 'quero chá! quero ch— FOCO, LORO, FOCO!'],
    ],
    victory: [
      ['DEEPZEEK', '*pousa calmamente* — Adequado. Vocês lutam de forma... ineficiente. Mas com coração. Isso eu não consegui clonar.'],
      ['BOB', 'Você... não vai fugir? Nem soltar um golpe final traiçoeiro?'],
      ['DEEPZEEK', 'Pra quê? *aponta pra um contêiner* — CHIPS. Sobra do trimestre passado. Levem. Conhecimento não se guarda. Se DISTRIBUI.'],
      ['BOB', 'Um contêiner INTEIRO?! Isso é mais chip do que o Vale vê num ano!'],
      ['DEEPZEEK', 'O segredo nunca foi o chip. Foi o que se faz com ele. *volta ao pastel*'],
      ['SISTEMA', '🔲 CONQUISTA: CHIPS! O coração da máquina — última peça técnica do plano!'],
      ['SISTEMA', '⚖ Contraexemplo nº 5: "vigiar tudo não é o mesmo que ver as pessoas".'],
      ['BOB', 'PLANO QUASE COMPLETO! Falta só um teto. A comunidade já marcou o MUTIRÃO do galpão!'],
    ],
    waves: [
      { at: 0.0, spawn: [['drone', 3]] },
      { at: 0.3, spawn: [['clone', 1], ['drone', 2]] },
      { at: 0.6, spawn: [['clone', 2], ['drone', 2]] },
      { at: 1.0, boss: true },
    ],
  },

  // ============================================================ FINAL
  {
    id: 6,
    // a rua em frente ao galpão: o boss rush não cabe dentro dele
    local: { x: 0, z: 32 },
    key: 'labs',
    final: true,
    title: 'FASE FINAL — LABS IMG',
    place: 'De volta ao Brasil',
    flag: '🇧🇷',
    aberta: true,
    /*
     * A fase final não tem UM chefão: tem todos eles.
     *
     * Os quatro invadem o Brasil em fila para impedir o treino do
     * CURUPIRA. O Deep-Zeek fica de fora de propósito — no roteiro ele
     * assiste de camarote comendo pastel, porque já tinha entregado os
     * chips por vontade própria.
     */
    bossRush: ['estagiario', 'trunfo', 'ilon', 'samuca', 'dario'],
    /*
     * O GALPÃO não é uma fase, é o mutirão da comunidade — 400 pessoas,
     * churrasco e fita isolante num fim de semana. Ele é entregue ao
     * CHEGAR no Labs IMG, junto do diálogo em que a Mira confere o
     * plano. Sem isso a peça ficava órfã: nenhuma fase a dava e o
     * jogador procurava um portal que não existe.
     */
    rewardOnEnter: 'predio',
    reward: 'treino',
    // no hall do galpão; o mutirão ergueu ele no quarteirão central
    portal: { x: 0, z: 10.5, label: 'LABS IMG' },
    requires: ['checkpoint', 'itaipu', 'investimento', 'pesquisadores', 'dados', 'eficiencia'],
    intro: [
      ['BOB', 'LABS IMG. O galpão ficou pronto NUM FIM DE SEMANA. Mutirão da comunidade: churrasco, fita isolante e 400 voluntários.'],
      ['LORO', 'chegamos! chegamos! *chora em binário*'],
      ['MIRA', 'Confere comigo: MODELO ✔. ENERGIA ✔. GRANA ✔. PESQUISADORES ✔. DADOS ✔. CHIPS ✔. GALPÃO ✔.'],
      ['MIRA', 'Falta UMA peça: O TREINO. Começa AGORA... mas Bob: ELES vêm vindo. TODOS ELES.'],
      ['BOB', 'Então a gente SEGURA. Cada peça desse plano foi conquistada na porrada. GUILDAS: POSIÇÕES!'],
      ['LORO', 'HOJE NASCE MEU IRMÃO DE DATASET!'],
    ],
    bossDialog: [
      ['ESTAGIARIO', 'Oi de novo... me EFETIVARAM! Agora sou Estagiário Vibe-Coder SÊNIOR. E dessa vez... eu trouxe TODO MUNDO.'],
      ['TRUNFO', 'Essa AGI é MINHA! Vou comprar! Ou taxar! Os dois!'],
      ['ILON', 'Vou cloná-la e mandá-la pra Marte de foguete!'],
      ['SAMUCA', 'Vou lançá-la em beta fechado com lista de espera!'],
      ['DARIO', 'Eu vou apenas... catalogá-la. Com muito carinho.'],
      ['BOB', 'ELA NÃO ESTÁ À VENDA!! SEGURA A LINHA, MIL GRAU!!'],
    ],
    victory: [
      ['SISTEMA', '━━━━ TREINO CONCLUÍDO ━━━━'],
      ['CURUPIRA', 'Oi. Fui feito por muita gente junta. Em que posso ajudar?'],
      ['BOB', '*segurando o riso e o choro ao mesmo tempo* — Fala "Indiana Bob".'],
      ['CURUPIRA', 'INDIANA BOB! 🤠 ...adicionei o chapéu por conta própria. Achei apropriado.'],
      ['LORO', 'MEU IRMÃO DE DATASET!! *desmaia de emoção*'],
      ['SISTEMA', 'Os chefões derrotados receberam contas gratuitas. O Trunfo tentou comprar. NÃO ESTÁ À VENDA.'],
      ['DEEPZEEK', '*de camarote, terminando o pastel* — Eficiente. Aprovado. *envia um pull request*'],
      ['SISTEMA', '🏆 A AGI SAGRADA NUNCA ESTEVE NUMA FORTALEZA. ESTAVA NA COMUNIDADE. SEMPRE ESTEVE.'],
    ],
    waves: [
      { at: 0.0, spawn: [['lobista', 2], ['optimus', 2]] },
      { at: 0.5, spawn: [['crawler', 2], ['pm', 2]] },
      { at: 1.0, boss: true },
    ],
  },
];

/** Estado da campanha — o que o jogador já conquistou. */
export function estadoInicial() {
  const conquistas = {};
  for (const p of PLAN_ITEMS) conquistas[p.key] = false;
  return {
    conquistas,
    fasesVencidas: {},     // key da fase -> true
    moedas: {},            // key da fase -> true (moedas de silício)
    faseAtual: null,
  };
}

// ---------------------------------------------------------------- persistência
const CHAVE_SAVE = 'agisagrada3d:campanha:v1';

/**
 * A campanha é longa: ninguém termina as 7 fases numa sentada. Guardar
 * o progresso não é luxo, é o que faz o jogo existir entre sessões.
 *
 * Vai num `try` porque `localStorage` pode simplesmente não existir
 * (aba anônima, `file://`) — e nesse caso o certo é o jogo rodar igual,
 * só sem lembrar, exatamente como `settings.js` já faz.
 */
export function carregarCampanha() {
  const base = estadoInicial();
  try {
    const bruto = JSON.parse(localStorage.getItem(CHAVE_SAVE));
    if (!bruto || typeof bruto !== 'object') return base;
    // só aceita chaves conhecidas: um save de versão antiga (ou editado
    // à mão) não pode injetar peça que não existe mais
    for (const p of PLAN_ITEMS) {
      if (bruto.conquistas && bruto.conquistas[p.key] === true) base.conquistas[p.key] = true;
    }
    for (const f of PHASES) {
      if (bruto.fasesVencidas && bruto.fasesVencidas[f.key] === true) base.fasesVencidas[f.key] = true;
      if (bruto.moedas && bruto.moedas[f.key] === true) base.moedas[f.key] = true;
    }
  } catch { /* sem persistência: segue o jogo */ }
  return base;
}

export function salvarCampanha(estado) {
  try {
    localStorage.setItem(CHAVE_SAVE, JSON.stringify({
      conquistas: estado.conquistas,
      fasesVencidas: estado.fasesVencidas,
      moedas: estado.moedas,
    }));
  } catch { /* segue o jogo */ }
}

export function zerarCampanha() {
  try { localStorage.removeItem(CHAVE_SAVE); } catch { /* nada */ }
}

/** A próxima fase que faz sentido jogar (a primeira ainda não vencida). */
export function proximaFase(estado) {
  return PHASES.find((f) => !estado.fasesVencidas[f.key] && liberada(f, estado)) || null;
}

/** A fase final só abre com as 6 peças técnicas na mão. */
export function liberada(fase, estado) {
  if (!fase.requires) return true;
  return fase.requires.every((k) => estado.conquistas[k]);
}
