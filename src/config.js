/**
 * Constantes de mundo e de jogo.
 * Toda a geometria da cidade deriva daqui — mudar CELL/GRID regenera tudo.
 */

// ---------------------------------------------------------------- malha urbana
// ------------------------------------------------------------ multiplayer
// URL do servidor MP. O site fica no GitHub Pages (estatico, sem WebSocket): o
// cliente precisa do endereco real do servidor, hospedado no Render.
export const NET = {
  wsUrl: 'wss://tiroteio.duckdns.org/ws',
};


export const GRID = 8;                 // linhas de cruzamento por eixo (8x8 = 64 nós)
export const CELL = 64;                // distância entre cruzamentos
export const HALF = ((GRID - 1) * CELL) / 2;   // 224 -> cidade vai de -224 a +224

export const ROAD_W = 18;              // largura total da pista
export const ROAD_H = ROAD_W / 2;      // 9
export const SIDEWALK_W = 5;           // [16] largura da calçada
export const CURB = ROAD_H + SIDEWALK_W;       // 14 -> limite externo da calçada
export const CURB_H = 0.24;            // altura do meio-fio
export const LANE = 4.5;               // [23] centro da faixa em relação ao eixo da rua
export const BLOCK_INNER = CELL - 2 * CURB;    // 36 -> área construível do quarteirão

/**
 * Seção transversal da calçada, medida a partir do eixo da rua.
 * A calçada vai de ROAD_H (9) até CURB (14); cada faixa tem seu lugar para
 * que pedestre, poste e semáforo nunca ocupem o mesmo ponto.
 *
 *   9.0 ─── 10.5   meio-fio: postes de luz e árvores        (PROP_OFF)
 *  10.8 ─── 13.2   faixa de caminhada dos pedestres         (WALK_OFF)
 *  13.4 ─── 14.0   junto aos prédios: postes de semáforo    (SIGNAL_OFF)
 */
export const PROP_OFF = 9.9;           // [22][16] postes e árvores junto ao meio-fio
export const WALK_OFF = 12.0;          // [2][21] eixo de caminhada = eixo da faixa de pedestre
export const SIGNAL_OFF = 13.6;        // [4] postes de semáforo rente aos prédios
/** Onde o carro para no vermelho: atrás da faixa de pedestre, contando o capô. */
export const STOP_LINE = 16.5;

export const WORLD_EDGE = HALF + CELL * 0.5;   // limite onde a cidade acaba

// ---------------------------------------------------------------- jogador
export const PLAYER = {
  radius: 0.42,
  height: 1.78,
  eye: 1.62,
  /*
   * Velocidade a pé.
   *
   * Era 4,2 / 9,0 — bom para um jogo de entregas num quarteirão. A
   * campanha espalhou a ação por 1,4 km de mapa e trouxe chefões que
   * andam a 9 m/s: no ritmo antigo o Bob era mais lento que a própria
   * ameaça, e atravessar a cidade virava espera.
   */
  walkSpeed: 6.4,
  runSpeed: 14.5,              // [30] Shift
  accel: 58,                   // acompanha: sem isso a arrancada fica mole
  jumpSpeed: 10,              // [36] espaço
  gravity: 28,
  turnSmooth: 14,
  /*
   * [33] Corações.
   *
   * Eram 3, herdados do jogo de entregas — ali o risco era atropelamento
   * ocasional e três bastavam. A campanha mudou o jogo: agora são ondas
   * de capangas, canetadas teleguiadas e chefões de 55 m, tudo a céu
   * aberto ao mesmo tempo. Com 3 corações a fase acabava antes de o
   * jogador entender o padrão do chefão, que é justamente a graça.
   */
  maxHearts: 6,
  invulnTime: 1.6,             // segundos de invulnerabilidade após levar dano
  /*
   * Regeneração: sem apanhar por `regenDelay` segundos, volta um coração
   * a cada `regenTime`. Recompensa quem recua e se reposiciona, em vez
   * de punir para sempre um erro dos primeiros segundos — e não vale
   * nada durante a briga, porque no meio dela você apanha antes.
   */
  regenDelay: 9,
  regenTime: 6,
  /**
   * [60] Modo Deus (tecla M): voo livre pelo mapa, sem gravidade nem colisão.
   * Rápido de propósito — serve para atravessar os 1,4 km do mapa e olhar os
   * marcos de perto sem precisar do helicóptero.
   */
  flySpeed: 38,
  flyUpSpeed: 22,
  flyBoost: 2.6,               // Ctrl acelera
};

// ---------------------------------------------------------------- câmera
export const CAMERA = {
  fov: 62,
  near: 0.15,
  far: 2600,
  minZoom: 2.6,                // [12] scroll do mouse
  maxZoom: 16,
  /**
   * [Ombro] Zoom padrão a pé — bem perto (3.6): o Bob preenche a tela e o
   * braço direito com a pistola aparece no canto, estilo COD Mobile. O
   * scroll do mouse ainda afasta até `maxZoom` quando o jogador quiser.
   */
  defaultZoom: 3.6,
  carZoom: 11,
  heliZoom: 18,
  cableZoom: 12,               // [54] dentro do bondinho
  /**
   * [Ombro] Over-the-shoulder estilo COD Mobile: quanto a câmera desloca
   * para o lado DIREITO do Bob (o lado da pistola) no modo a pé. É o que
   * põe o braço e a mão segurando a arma visíveis no canto da tela — sem
   * isto, o braço direito fica escondido atrás do corpo.
   */
  shoulderX: 1.8,
  heliShoulderX: 3.0,          // [heli] camera de ombro: heli sai do centro da tela, mira livre
  /**
   * [Ombro] Quanto o CORPO do Bob gira para a esquerda em relação à
   * câmera (rad) no modo a pé. Expõe o ombro direito e a pistola para a
   * câmera deslocada, deixando o braço em perfil em vez de de costas.
   */
  bodyTurn: 0.30,
  /**
   * [11][14] Limites da inclinação da câmera, em radianos.
   * pitchMax 1.35 ≈ 77° para cima: dá para ver o topo dos prédios, o Cristo
   * de baixo e o helicóptero passando. Não chega a 90° de propósito — na
   * vertical exata o `lookAt` perde a referência de "para cima" e a imagem gira.
   */
  pitchMin: -1.15,             // ≈ 66° para baixo
  pitchMax: 1.35,              // ≈ 77° para cima
  /**
   * Olhando para cima, o braço da câmera de terceira pessoa mergulha para
   * trás e para BAIXO do jogador, indo parar dentro do chão. Encurtar o braço
   * conforme o ângulo sobe mantém a câmera no ar. `pitchTuckStart` é o ângulo
   * onde o encurtamento começa e `pitchTuck` o quanto ele tira no limite.
   */
  pitchTuckStart: 0.35,
  pitchTuck: 0.62,
  /**
   * Dentro do veículo o limite é menor: acima disso a vista é só o teto da
   * cabine (a lataria é DoubleSide) ou o rotor do helicóptero.
   */
  pitchMaxInterior: 1.05,
  pitchMinInterior: -0.9,
  sensitivity: 0.0045,         // [11] mouse (~2x mais agil, estilo FPS)
  height: 1.55,
  lag: 12,
  /**
   * [43] Quanto o ponto de mira sobe acima do helicóptero, como fração da
   * distância da câmera. Empurra o aparelho para a parte de baixo da tela e
   * deixa o caminho à frente livre. 0.20 ≈ 11° de inclinação.
   */
  heliFrameLift: 0.20,

  /**
   * [FPS] Zoom de mira (ADS), estilo COD Mobile.
   *
   * Segurar o tiro fecha a câmera: o FOV aperta (fov -> adsFov) e, a pé,
   * a distância de terceira pessoa encolhe até `adsZoom`. A mira (que no
   * jogo fica a 62% da tela) desliza para o centro — é o "fixar a mira" —
   * e o espalhamento da bala cai para `spreadAds`: mirou, atira reto.
   *
   * [Ombro] Ficou mais curto que o defaultZoom novo (3.6): mirar ainda
   * aproxima de verdade, e o braço com a pistola domina o canto da tela.
   */
  adsFov: 45,             // [ADS-ZOOM] zoom real: FOV 62 -> 45 no celular (estilo COD Mobile)
  adsFovPc: 31,             // [PC] mira 2x no botão direito (FOV pela metade)
  adsSpeed: 9,
  adsEyeHeight: 0.22,           // [CODM-FPP] olhos: focus(1.48m) + 0.22 = 1.70m
  adsEyeForward: 0.18,          // [CODM-FPP] camera um pouco a frente do centro do corpo (olhos)
  adsDolly: 0,              // [CODM-FPP] a translacao virou o blend 1a pessoa (adsEyeHeight/adsEyeForward) — campo desativado
  /**
   * [FPS] SEM coice de câmera: ao atirar a mira NUNCA sai do lugar
   * (sniper-friendly). O recuo ficou só visual — a arma sobe no
   * viewmodel e o hitmarker confirma o acerto.
   */
  recoilPitch: 0,
  recoilYaw: 0,
  recoilRecover: 5.0,
  /** [FPS] Espalhamento da bala: sem mirar (cintura) vs mirando (ADS). */
  spreadHip: 0,   // [CALIBRACAO] tiro da cintura sai reto onde o crosshair aponta (sem espalhamento)
  spreadAds: 0,
};

// ---------------------------------------------------------------- veículos
export const CAR = {
  count: 26,                   // [3] carros de tráfego
  length: 4.35,
  width: 1.92,
  height: 1.34,
  npcSpeed: 12.5,              // m/s do tráfego (~45 km/h)
  playerAccel: 15.5,
  playerBrake: 26,
  maxSpeed: 33.3,              // 120 km/h  [28]
  reverseSpeed: 8,
  steerRate: 1.9,
  drag: 0.72,
  stopDistance: 11,            // distância de parada no semáforo
};

export const HELI = {
  liftAccel: 13,
  maxLift: 16,
  tiltAccel: 17,
  maxSpeed: 42,
  yawRate: 1.35,
  drag: 0.62,
  rotorSpeed: 26,
  exitMaxHeight: 3.2,          // [49] só sai perto do chão
  enterRange: 6.5,             // [MP] raio para entrar no aparelho (igual ao servidor)
  /**
   * [46] Altura do centro do helicóptero quando ele está POUSADO.
   *
   * A origem do modelo fica na base dos patins (o tubo do patim está em
   * y=0.12 com raio 0.11, ou seja, encosta em y≈0.01), então este valor tem
   * que ser praticamente zero. Estava em 1,15 e o resultado era o aparelho
   * pousado boiando mais de um metro acima do chão.
   */
  landHeight: 0.02,
};

// ---------------------------------------------------------------- NPCs
export const PED = {
  count: 46,                   // [2] pedestres
  speed: 1.5,
  runSpeed: 3.4,
  radius: 0.36,
  height: 1.75,
};

/**
 * [61] Quanta gente e quantos carros a cidade tem — escolha do jogador,
 * salva no navegador e alternada com a tecla P.
 *
 * Isto é um eixo SEPARADO do perfil gráfico. Antes a população vinha junto do
 * perfil (BAIXA/MÉDIA/ALTA), o que misturava duas decisões diferentes: quem
 * queria a cidade cheia era obrigado a ligar sombra, bloom e SMAA junto. Agora
 * o perfil cuida de pixels e pós-processamento; isto aqui cuida de quantas
 * pessoas e carros existem.
 *
 * O custo é quase todo em draw calls: cada pedestre é um corpo articulado e
 * cada carro tem rodas próprias. Por isso o aviso de FPS está no menu.
 */
export const POPULATIONS = [
  { id: 'pouca',  label: 'POUCA',       peds: 18,  cars: 12 },
  { id: 'normal', label: 'NORMAL',      peds: 46,  cars: 28 },
  { id: 'muita',  label: 'MOVIMENTADA', peds: 85,  cars: 48 },
  { id: 'cheia',  label: 'CIDADE CHEIA', peds: 140, cars: 78 },
];

/** [61] População inicial: MOVIMENTADA — a cidade parece viva sem pesar demais. */
export const DEFAULT_POPULATION = 2;

/**
 * [57][58][59] Platôs: trechos de terreno aplainados para receber os marcos.
 *
 * O relevo natural varia 6 m sob o Pelourinho. Assentar um largo plano ali
 * deixa a laje enterrada de um lado e boiando no ar do outro — e não adianta
 * levantá-la até o ponto mais alto: aí ela vira um bloco flutuante de 6 m que
 * não dá para subir. Quem tem que ceder é o terreno.
 *
 * A altura de cada platô não é fixa: sai da MÉDIA do terreno natural sob ele,
 * calculada uma vez na carga (`terrain.js`). Assim o marco se apoia na cota
 * que o relevo já tinha por ali, em vez de num número escolhido na mão.
 *
 * `fade` é a faixa em que o platô se dissolve no relevo natural — larga o
 * bastante para virar encosta suave, não degrau.
 *
 * Ficam aqui, e não junto dos marcos, porque `terrain.js` precisa deles e
 * `brasil.js` já importa `terrain.js`: pôr no outro sentido faria ciclo.
 */
export const PLATOS = [
  // [CENARIO-LIMPO] platos do museu/pelourinho removidos junto com as construcoes
];

// ---------------------------------------------------------------- [54] bondinho
/**
 * Bondinho do Pão de Açúcar: agora dá para subir na estação a pé e viajar
 * dentro da cabine.
 *
 * A estação é um prédio sólido cujo TELHADO é a plataforma de embarque, e uma
 * rampa externa sobe até lá. `cabinFloor` amarra tudo: é a distância do cabo
 * até o piso da cabine, então o deck fica em `cabo - cabinFloor` e o
 * passageiro entra sem degrau.
 */
export const CABLE = {
  rise: 9,                     // altura do deck acima da base da estação
  halfX: 10, halfZ: 8,         // planta do prédio da estação
  deckOver: 1,                 // o piso do deck passa isto além da parede
  cabinFloor: 5.1,             // do cabo até o piso da cabine
  dock: 4.6,                   // a cabine para a esta distância do centro
  cableSep: 1.7,               // afastamento entre as duas linhas
  dwell: 7,                    // segundos parada na estação
  boardDwell: 1.8,             // ao embarcar, parte em menos tempo
  speed: 8.5,                  // m/s
  rampLen: 42, rampHalfW: 2.4, // rampa de acesso a pé
  boardRange: 4.6,             // distância para embarcar
};

// ---------------------------------------------------------------- semáforos
export const TRAFFIC = {
  greenTime: 11,
  yellowTime: 2.4,
  allRedTime: 1.0,             // [4] tempo de segurança entre fases
};

// ---------------------------------------------------------------- combate / missão
export const GAME = {
  totalTime: 600,              // [8] 10 minutos
  deliveryPoints: 10,          // [7]
  deliveryTimeBonus: 30,       // [7]
  killTimeBonus: 5,            // [32]
  bulletSpeed: 145,            // [38]
  bulletLife: 3.0,
  bulletBounces: 0,            // [41] ricochete OFF (bala morre no 1º impacto - mais leve)
  fireCooldown: 0.16,          // [27]
  pickupRange: 3.4,            // [5][6]
  airPickupRange: 26,          // [51] pega/entrega voando alto
  vehicleRange: 4.2,           // [9]
};

/**
 * [63] Mísseis do helicóptero.
 *
 * No ar, o tiro de pistola não faz sentido: o alvo está a 80 m lá embaixo e
 * uma bala isolada não acerta nada em movimento. O míssil sai devagar, ACELERA
 * e explode em área — é o que dá para mirar de dentro de um helicóptero.
 *
 * O raio de dano é generoso de propósito: mirar um carro em movimento voando a
 * 40 m/s é difícil, e a graça é o estrago, não a precisão.
 */
export const MISSILE = {
  speed: 55,                   // m/s CONSTANTE — idêntico ao MP (MISSIL.speed do servidor)
  accel: 0,                    // sem aceleração: voa reto a 55 m/s o voo todo
  maxSpeed: 55,                // (era 165) igual ao servidor: míssil do MP não acelera
  turn: 4.0,                // [missil] guia para o ponto exato da mira (raio de giro seguro a 165 m/s)
  life: 5.0,
  cooldown: 0.5,               // míssil do heli mais rápido [27]
  blastPed: 9.5,               // raio que pega pedestres
  blastCar: 8.5,               // raio que pega carros
  blastFx: 3.2,                // escala da explosão
  shake: 0.85,
};

// ---------------------------------------------------------------- ciclo dia/noite [13]
export const DAY = {
  duration: 135.5,   // 55% mais rapido (era 210s)               // segundos por dia completo
  startHour: 8.5,
  sunriseHour: 6,
  sunsetHour: 18.5,
  /** Horas usadas quando o ciclo é congelado em "sempre dia" / "sempre noite". */
  fixedDayHour: 12,
  fixedNightHour: 22,
};

// ---------------------------------------------------------------- paletas
export const PALETTE = {
  building: [0xb9b3a8, 0xa8a49c, 0xcfc8bb, 0x8e8a84, 0xd6d2c8, 0x9aa3ab, 0xc0b6a6, 0x7f8890],
  buildingGlass: [0x2c4356, 0x1f3a4d, 0x38505f, 0x24404f],
  car: [0xd42a2a, 0x1a5fd6, 0xe8e8e8, 0x1b1b1e, 0xf0b400, 0x2f9e58, 0x8b8f96, 0xe06a1f, 0x6d3fbe, 0x14b0c4],
  shirt: [0xd94f4f, 0x3f7fd9, 0x4fbf74, 0xe0b23a, 0xb562d6, 0xe8e8e8, 0x2f3540, 0xe07a3f, 0x35b5b0, 0xd96fa8],
  pants: [0x2b3648, 0x3a3f4a, 0x1f2430, 0x5a4636, 0x2e2e33, 0x44506b],
  skin: [0xf1c8a0, 0xd9a877, 0xa9713f, 0x7a4a25, 0x54301a, 0xf6d9be],
  hair: [0x1d1512, 0x3b2415, 0x6b4423, 0xa8763c, 0x111111, 0x8a8a8a],
};

// ---------------------------------------------------------------- qualidade gráfica
export const QUALITY = {
  shadowMapSize: 2048,
  shadowRadius: 110,           // [44] frustum de sombra que segue o jogador
  /**
   * Postes com luz REAL perto do jogador [22]. Cada uma pesa em todo fragmento
   * iluminado da cena, então o número é baixo de propósito.
   */
  maxDynamicLights: 6,
  /**
   * O bloom roda ANTES do tone mapping, ou seja, sobre valores HDR lineares.
   * Uma superfície branca sob sol forte já fica perto de 1.0, então o limiar
   * precisa ficar acima disso: assim só as fontes de luz de verdade brilham
   * (janelas acesas, postes, faróis, semáforos, traçantes e explosões) e o
   * céu não vira uma névoa leitosa em cima da cena.
   */
  bloomStrength: 0.5,   // [FPS2] bloom mais leve (era 0.62)
  bloomRadius: 0.6,
  bloomThreshold: 1.55,
  /** Exposição do tone mapping (o céu já é reescalado em gfx/sky.js). */
  exposure: 1.12,
  /**
   * Névoa só para dar profundidade atmosférica. Precisa ser fraca o bastante
   * para o Corcovado e o Pão de Açúcar continuarem visíveis da cidade
   * (ficam a ~700 m do centro).
   */
  fogNear: 380,
  fogFar: 2300,
  /**
   * Intensidade do mapa de ambiente (IBL) gerado a partir do céu.
   * O céu de Preetham tem radiância ~7 em espaço linear, então esse fator
   * precisa ser baixo: com valores altos a luz ambiente sozinha estoura
   * todas as superfícies e o sol deixa de definir a iluminação.
   */
  envIntensity: 1.0,
  hemiIntensity: 0.16,
  /** Pico de intensidade do sol ao meio-dia. */
  sunIntensity: 4.0,
};

/**
 * [13] Intensidades da noite, todas num lugar só.
 *
 * Antes esses valores estavam espalhados e se MULTIPLICAVAM: exposição maior,
 * bloom mais forte, limiar mais baixo e emissivos altos ao mesmo tempo. O
 * resultado era janela e poste virando bolha branca. Agora cada um puxa pouco.
 */
export const NIGHT = {
  exposureBoost: 0.38,        // soma à exposição do dia (noite jogável) [22]
  bloomStrengthBoost: 0.26,   // soma à força do bloom
  bloomThresholdDrop: 0.28,   // subtrai do limiar do bloom
  windowGlow: 0.85,           // emissivo das janelas acesas [20]
  lampLens: 1.5,              // emissivo da lente do poste [22]
  lampGlow: 0.5,              // opacidade do halo do poste
  lampPower: 50,              // intensidade da PointLight do poste
  trafficLens: 0.7,           // acréscimo no emissivo do semáforo [4]
};

/**
 * Três perfis de qualidade, alternados no jogo com a tecla G.
 * `baixa` prioriza FPS; `alta` prioriza imagem.
 */
/**
 * `renderScale` multiplica a resolução nativa. É a alavanca mais forte de FPS:
 * 0.62 renderiza com ~38% dos pixels. Usar `Math.min(devicePixelRatio, X)` não
 * serviria, porque na maioria dos monitores o devicePixelRatio já é 1 e o
 * limite nunca entraria em ação.
 */
/*
 * Os três perfis precisam ficar REALMENTE espaçados. Numa primeira calibração
 * MÉDIA e ALTA custavam quase o mesmo (22 vs 20 fps numa máquina real) porque
 * as duas pagavam os mesmos itens caros: bloom em tela cheia, SMAA e um raio
 * de sombra largo. Quem separa de verdade, em ordem de impacto:
 *
 *   1. renderScale   — área de pixels; 0.55 desenha 30% do que 1.0 desenha
 *   2. bloom/SMAA    — passes de tela cheia, custo de preenchimento puro
 *   3. shadowRadius  — quanto MAIOR o raio, mais objetos entram no passe de
 *                      sombra; importa mais que a resolução do mapa
 *
 * A quantidade de pedestres e carros SAIU daqui: virou POPULATIONS, um ajuste
 * próprio. Eram duas decisões diferentes empacotadas numa só — quem quisesse a
 * cidade cheia tinha de aceitar sombra, bloom e SMAA no talo junto.
 */
export const PRESETS = [
  {
    id: 'baixa', label: 'BAIXA',
    renderScale: 0.55,
    shadows: false, shadowMapSize: 1024, shadowRadius: 45,
    bloom: false, smaa: false, bloomScale: 0.5,
    dynamicLights: 0,
    fogFar: 1400,
    envUpdate: 12,
  },
  {
    id: 'media', label: 'MÉDIA',
    renderScale: 0.75,
    // sombra curta e barata: pega o que está perto do jogador, que é o que
    // realmente se vê, e deixa o passe de sombra pequeno
    shadows: true, shadowMapSize: 1024, shadowRadius: 38,   // [FPS2] area de sombra -29% (menos casters no passe)
    shadowType: 'basic',     // [FPS] PCF basico (era PCFSoft): ~35% mais barato no passe de sombra
    bloom: true, smaa: false, bloomScale: 0.4,
    dynamicLights: 3,
    fogFar: 1900,
    envUpdate: 6,
    shadowTickEvery: 3,     // [FPS] sombra a cada 3 frames (era 2): -33% de custo
    dynFloor: 0.62,         // [FPS] mais margem p/ a resolucao dinamica agir antes de travar
  },
  {
    id: 'alta', label: 'ALTA',
    renderScale: 1.0,
    shadows: true, shadowMapSize: 2048, shadowRadius: 85,
    bloom: true, smaa: true, bloomScale: 0.55,
    dynamicLights: 6,
    fogFar: 2300,
    envUpdate: 3,
  },
  {
    id: '120fps', label: '120 FPS',
    renderScale: 0.5,
    shadows: true, shadowMapSize: 1024, shadowRadius: 40,
    shadowType: 'basic',
    bloom: false, smaa: false, bloomScale: 0.4,
    dynamicLights: 1,
    fogFar: 1500,
    envUpdate: 12,
    pixelRatioCap: 1.25,
    dynFloor: 0.55,
    targetMsHigh: 8.0,
    targetMsLow: 6.5,
    shadowTickEvery: 3,
  },
];

/** Perfil inicial (índice em PRESETS): MÉDIA, que roda liso na maioria das máquinas. */
export const DEFAULT_PRESET = 1;


/**
 * Distância de renderização (tecla `L`).
 *
 * Encurta o far plane da câmera e traz a névoa para perto, junto. Os
 * dois andam amarrados de propósito: cortar o far sem a névoa faz o
 * mundo sumir num corte reto, e a névoa sem o corte só pinta por cima
 * do que continua sendo desenhado.
 *
 * O céu acompanha. O domo, as estrelas e a lua são reposicionados em
 * função desta distância — se ficarem além do far plane, o céu é
 * recortado e a tela fica preta atrás do mundo.
 */
export const RENDER_DISTANCES = [
  { id: 'curta', label: 'CURTA', dist: 700,  fogNear: 110 },
  { id: 'media', label: 'MÉDIA', dist: 1300, fogNear: 230 },
  { id: 'longa', label: 'LONGA', dist: 1900, fogNear: 330 },
  { id: 'total', label: 'TOTAL', dist: 2600, fogNear: 380 },
];
export const DEFAULT_RENDER_DISTANCE = 2;
