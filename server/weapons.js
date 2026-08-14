/**
 * Armas do multiplayer — dano, alcance, cadência.
 * O servidor é quem decide o dano (autoritativo); o cliente só anima.
 */

export const WEAPONS = {
  pistola: {
    id: 'pistola',
    nome: 'Pistola',
    damage: 34,
    range: 90,
    cooldown: 0.16,       // cadência ~375 RPM (igual à campanha)
    headshotMult: 2.0,
    spread: 0.008,
    // mira: o tiro sai da câmera (no cliente) e é validado por raycast aqui
  },
  metralhadora: {
    id: 'metralhadora',
    nome: 'Metralhadora',
    damage: 20,
    range: 110,
    cooldown: 0.09,
    headshotMult: 1.8,
    spread: 0.016,
  },
  escopeta: {
    id: 'escopeta',
    nome: 'Escopeta',
    damage: 12,            // por pellet (8 pellets = 96)
    pellets: 8,
    range: 40,
    cooldown: 0.85,
    headshotMult: 1.5,
    spread: 0.05,
  },
  rifle: {
    id: 'rifle',
    nome: 'Rifle de Precisão',
    damage: 100,
    range: 300,
    cooldown: 1.4,
    headshotMult: 2.5,
    spread: 0.001,
  },
};

/** Itens que aparecem como loot no BR. */
export const LOOT_TYPES = [
  { id: 'pistola',   tipo: 'arma', arma: 'pistola',     peso: 30 },
  { id: 'metralhadora', tipo: 'arma', arma: 'metralhadora', peso: 16 },
  { id: 'escopeta',  tipo: 'arma', arma: 'escopeta',    peso: 10 },
  { id: 'rifle',     tipo: 'arma', arma: 'rifle',       peso: 4 },
  { id: 'municao',   tipo: 'municao', qtd: 30,          peso: 22 },
  { id: 'medkit',    tipo: 'cura', hp: 50,              peso: 14 },
  { id: 'coleate',   tipo: 'armadura', hp: 50,          peso: 10 },
];

/** Escolhe um loot com peso (rng já rolado fora). */
export function rollLoot(rng) {
  const total = LOOT_TYPES.reduce((s, l) => s + l.peso, 0);
  let r = rng() * total;
  for (const l of LOOT_TYPES) {
    r -= l.peso;
    if (r <= 0) return { ...l };
  }
  return { ...LOOT_TYPES[0] };
}
