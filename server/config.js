/**
 * Constantes do servidor — espelho das do cliente (src/config.js).
 * Tudo que o servidor precisa saber sobre o mundo e o jogador mora aqui.
 * A cidade é gerada com a MESMA seed do cliente, então os colisores batem.
 */

// ---------------------------------------------------------------- malha urbana
export const GRID = 8;
export const CELL = 64;
export const HALF = ((GRID - 1) * CELL) / 2;   // 224
export const ROAD_W = 18;
export const ROAD_H = ROAD_W / 2;
export const SIDEWALK_W = 5;
export const CURB = ROAD_H + SIDEWALK_W;       // 14
export const CURB_H = 0.24;
export const LANE = 4.5;
export const BLOCK_INNER = CELL - 2 * CURB;    // 36
/** Onde o carro para no vermelho: atrás da faixa de pedestre, contando o capô. */
export const STOP_LINE = 16.5;
export const WORLD_EDGE = HALF + CELL * 0.5;

export const PROP_OFF = 9.9;           // postes e árvores junto ao meio-fio (igual ao cliente)
// ---------------------------------------------------------------- jogador
export const PLAYER = {
  radius: 0.42,
  height: 1.78,
  eye: 1.62,
  // DOBRADA a pedido (2x o solo 6.4/14.5): no MP/BR o Bob é mais veloz
  walkSpeed: 12.8,
  runSpeed: 29.0,
  accel: 58,
  jumpSpeed: 10,
  gravity: 28,
  turnSmooth: 14,
  maxHearts: 6,
  invulnTime: 1.6,
  regenDelay: 9,
  regenTime: 6,
};

// ---------------------------------------------------------------- veiculos MP
export const CAR = {
  radius: 2.1,
  height: 1.6,
  maxSpeed: 26,
  accel: 14,
  brake: 34,
  steer: 1.9,
  enterRange: 4.5,
  npcSpeed: 12.5,          // m/s do tráfego (~45 km/h, igual ao solo)
  stopDistance: 11,        // distância de parada no semáforo
};
export const NUM_CARS = 8;

// ---------------------------------------------------------------- helicopteros MP
export const HELI = {
  liftAccel: 13,
  maxLift: 16,
  tiltAccel: 17,
  maxSpeed: 42,
  yawRate: 1.35,
  drag: 0.62,
  landHeight: 0.02,
  /** [MP] só dá para entrar perto do aparelho (mesmo raio do hint do cliente). */
  enterRange: 6.5,
  /** [MP] só dá para sair com o aparelho quase pousado (igual ao solo [49]). */
  exitMaxHeight: 3.2,
  /** [MP] parado no ar sem interagir: depois de 20 s desce de ~25 em 25 m. */
  idleMax: 20,        // s parado antes de descer (anti-"escondido no céu")
  idleDesc: 12,       // m/s da descida forçada (~25 m a cada 2 s)
  idleCiclo: 4,       // 2 s caindo + 2 s estabilizado
  /** [MP] gasolina: 100 = tanque cheio (~3,3 min de voo contínuo). */
  fuelMax: 100,
  fuelConsume: 1.0,   // % por segundo voando (tanque cheio ~1,7 min)
  fuelRefill: 15,     // % por segundo pousado (~7 s p/ encher)
  fuelMinY: 0.5,      // (m) do chão p/ considerar "pousado"
  /** [teto] altura máxima de voo no MP/BR — 150 m (prédios vão até ~36 m). */
  maxAlt: 150,
};

// ---------------------------------------------------------------- míssil do heli (MP)
export const MISSIL = {
  speed: 55,     // m/s
  dano: 70,      // no centro da explosão (cai com a distância)
  raio: 7,       // m de alcance do dano em área
  cooldown: 0.5, // s entre disparos (míssil mais rápido)
  vida: 5,       // s de voo máximo antes de explodir no ar
  curva: 2.5,    // rad/s de curva do teleguiado (homing no alvo da mira)
};
/** Quantos helicópteros espalhados pelo mapa no MP. */
export const NUM_HELIS = 5;



// ---------------------------------------------------------------- combate
export const GAME = {
  totalTime: 600,
  fireCooldown: 0.16,
  bulletSpeed: 145,
  bulletLife: 3.0,
  pickupRange: 3.4,
};

// ---------------------------------------------------------------- rede
export const NET = {
  port: process.env.PORT || 3000,
  /** Frequência do loop de física do servidor (Hz). */
  tickRate: 30,
  /** Quantos inputs o servidor aceita por segundo por jogador (anti-spam). */
  maxInputRate: 40,
  /** Depois disto sem mensagem, o jogador é desconectado. */
  timeoutMs: 15_000,
  /** Máximo de mensagens por segundo por conexão (anti-flood). */
  maxMsgPerSec: 120,
  maxPayload: 4096,
  /** Versão do protocolo — cliente e servidor precisam bater. */
  version: 1,
};

// ---------------------------------------------------------------- modos
export const MODES = {
  dm: {
    id: 'dm',
    label: 'MULTIPLAYER',
    maxPlayers: 12,   // total SEMPRE 12: players + bots (4 players -> 8 bots)
    minPlayers: 2,       // bots completam até minPlayers quando ligado
    killLimit: 25,
    timeLimit: 300,      // segundos (5 min — vence quem tiver mais kills)
    respawnTime: 2,      // segundos até renascer (botão antecipa na hora)
    spawnProtect: 3,     // segundos imune após nascer
    teamCount: 2,        // verde x amarelo
  },
  br: {
    id: 'br',
    label: 'BATTLE ROYALE',
    maxPlayers: 20,
    minPlayers: 6,       // bots completam até minPlayers quando ligado
    lootPerSpawn: 3,     // itens por ponto de loot
    zoneStartR: 210,     // raio inicial da zona
    zoneFinalR: 8,       // raio final — fecha de verdade
    zoneSteps: 6,        // quantas vezes a zona encolhe
    zoneStepTime: 45,    // segundos entre encolhimentos
    zoneDpsBase: 2,      // dano/s fora da zona (cresce a cada passo)
    timeLimit: 300,      // 5 min — no fim, vence quem tiver mais kills
    planeSpeed: 60,      // velocidade do avião
    planeHeight: 70,
    fallSpeed: 12,       // queda livre
    parachuteSpeed: 5.5, // queda de paraquedas
    lootRarity: { comum: 0.6, raro: 0.3, epico: 0.1 },
  },
};

// ---------------------------------------------------------------- zona BR
/** Sequência de raios da zona (fração do raio inicial). */
export const ZONE_SHRINK = [1.0, 0.72, 0.5, 0.32, 0.18, 0.08, 0.0];

/** Raios máximos de segurança contra posições absurdas (mapa ~ -2600..2600). */
export const WORLD_LIMIT = 2600;

/**
 * Platôs — espelho de src/config.js (terreno aplainado dos marcos).
 * `y` é calculado na carga do terrain.js (média do relevo natural).
 */
export const PLATOS = [
  { id: 'pelourinho', x: -121.6, z: -435.0, rot: -0.25, hx: 62, hz: 34, fade: 26 },
  { id: 'museu', x: -424.3, z: 140.8, rot: 0.42, hx: 58, hz: 52, fade: 28 },
];

export const CABLE = {
  rise: 9,
  halfX: 10, halfZ: 8,
  deckOver: 1,
  cabinFloor: 5.1,
  dock: 4.6,
  cableSep: 1.7,
  dwell: 7,
  boardDwell: 1.8,
  speed: 8.5,
  rampLen: 42, rampHalfW: 2.4,
  boardRange: 4.6,
};

