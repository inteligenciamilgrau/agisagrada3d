/**
 * Bots — IA que roda no servidor (online) e no cliente (modo treinamento).
 * Comportamento: patrulhar pontos, mirar no inimigo mais próximo, atirar,
 * fugir da zona no BR, pegar loot.
 */

import { dist2D, angleDelta, clamp, findStreetSpot } from '../util.js';

/** Máx. de bots atirando no MESMO alvo ao mesmo tempo. Sem este limite todos
 *  os bots focavam o jogador junto e ele morria em segundos. */
const MAX_FOCO = 2;

/** Linha de visão: amostra o segmento olho->peito a cada ~4 m; um sólido na
 *  altura do olhar entre os dois pontos bloqueia (bot não atira em parede). */
function temVisao(col, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const d = Math.hypot(dx, dy, dz);
  if (d < 0.5) return true;
  const n = Math.max(2, Math.ceil(d / 4));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (col.isBlocked(ax + dx * t, az + dz * t, 0.35, ay + dy * t, 0.5)) return false;
  }
  return true;
}

/** Nomes brasileiros para bots (tema BR, como pedido no documento). */
// [COVER] procura um ponto onde o atirador nao tem linha de visao: testa
// pontos atras e nas laterais (em raios crescentes) validando que o bot
// consegue ficar no ponto (nao dentro de predio) e que NAO e visto de la.
export const NOMES = [
  'Zé da Manga', 'Dona Flor', 'Seu Lunga', 'Batoré', 'Dedé', 'Bira',
  'Tininha', 'Careca', 'Coxinha', 'Pastel', 'Farofa', 'Ximbica',
  'Rabetão', 'Birobiro', 'Jabá', 'Pamonha', 'Pipoca', 'Gordão',
  'Formiga', 'Taturana', 'Mandioquinha', 'Canjica', 'Baião', 'Cuscuz',
];

/** Paleta de roupas dos bots (espelha a do jogador). */
const BOT_CORES = [0xe8453c, 0x2f9e5f, 0x3a6fd8, 0xe0a323, 0x9c4fd8, 0xd84f8f, 0x23b0c9, 0x8a6f4f, 0x5a6b8a, 0xc9c23a];

export function makeBot(nick, dificuldade = 'expert') {
  const DIF = {
    facil: { precisao: 0.25, reacao: 0.6, danoMult: 1.0, visao: 30 },
    media: { precisao: 0.45, reacao: 0.4, danoMult: 1.25, visao: 42 },   // [DANO2] dano reduzido
    dificil: { precisao: 0.7, reacao: 0.22, danoMult: 1.5, visao: 55 },   // [DANO2] dano reduzido
    // [EXPERT] perfil padrão do multiplayer: mira excelente, reação rápida e
    // visão longa — mas é BASTANTE LENTO no movimento (compensado no room.js)
    expert: { precisao: 0.78, reacao: 0.16, danoMult: 1.0, visao: 60 },
  };
  const d = DIF[dificuldade] || DIF.media;
  return {
    nick,
    dificuldade,
    cor: BOT_CORES[Math.floor(Math.random() * BOT_CORES.length)],
    precisao: d.precisao,
    reacao: d.reacao,
    danoMult: d.danoMult,
    visao: d.visao,
    target: null,
    wanderT: 0,
    wanderX: 0,
    wanderZ: 0,
    // [BOT-HELI] 30% dos bots embarcam num helicoptero livre e perseguem
    // os players pelo ar disparando MISSELS (BR e DM)
    pilotarHeli: Math.random() < 0.35,
    pilotarCarro: Math.random() < 0.5,   // [BOT-CARRO] bots tambem dirigem carros
    _heliT: 0,
    _missilT: 0,
    _carroT: 0,
    _carroYawW: 0,
    _puloT: 0,
    _travaT: 0,
    _travaX: 0,
    _travaZ: 0,
    _danoDe: null,     // ultimo atirador que acertou o bot
    _danoT: -99,       // tempo (s) do ultimo dano sofrido
    _reacaoT: 0,       // [EXPERT] tempo restante p/ reagir a um alvo novo
    _strafeT: 0,       // [EXPERT] tempo restante no strafe atual
    _strafeDir: 1,     // [EXPERT] direção do strafe (+1/-1)
    // [EXPERT] distância de engajamento ideal conforme a arma equipada
    _alcanceIdeal() {
      switch (this.arma) {
        case "escopeta": return 9;
        case "pistola": return 20;
        case "metralhadora": return 30;
        case "rifle": return 50;
        default: return 18;
      }
    },
    levouDano(dmg, por) {
      this._danoDe = por || null;
      this._danoT = Date.now() / 1000;
    },
    think(dt, room) {
      if (!this.body || this.hp <= 0) return;
      const modo = room.modo;

      // BR: prioridade é ficar dentro da zona
      let inZone = true;
      if (modo === 'br') {
        const d = dist2D(this.body.pos.x, this.body.pos.z, room.zone.x, room.zone.z);
        inZone = d <= room.zone.r;
      }

      // quantos bots já estão mirando cada alvo (o alvo é o PRÓPRIO objeto:
      // bots não têm .id — o id fica na chave do Map da sala; contagem do
      // frame, suficiente para espalhar o fogo)
      const foco = new Map();
      for (const b of room.bots.values()) {
        if (b !== this && b.target) foco.set(b.target, (foco.get(b.target) || 0) + 1);
      }

      // acha o inimigo mais próximo com LINHA DE VISÃO livre (sem paredes no
      // caminho) e que ainda não está saturado de atiradores
      let best = null, bestD = this.visao;
      const col = room.world.col;
      // [BOT-MAPA] bot saiu do mapa dos predios (+-224): destino = centro ate voltar
      const foraMapa = Math.abs(this.body.pos.x) > 215 || Math.abs(this.body.pos.z) > 215;
      if (foraMapa && this.inCar == null && this.inHeli == null) {
        this.wanderX = 0; this.wanderZ = 0; this.wanderT = 999;
      }
      for (const o of room._all()) {
        if (o === this || o.hp <= 0 || !o.body) continue;
        const dd = dist2D(this.body.pos.x, this.body.pos.z, o.body.pos.x, o.body.pos.z);
        if (dd >= bestD || (foco.get(o) || 0) >= MAX_FOCO) continue;
        // olho do bot (1.5) até o peito do alvo (1.2): se bater parede, não vê
        if (!temVisao(col,
          this.body.pos.x, this.body.pos.y + 1.5, this.body.pos.z,
          o.body.pos.x, o.body.pos.y + 1.2, o.body.pos.z)) continue;
        bestD = dd; best = o;
      }
      // [EXPERT] tempo de reação: alvo novo exige um instante antes de atirar
      const alvoNovo = best && best !== this.target;
      this.target = best;
      if (alvoNovo) this._reacaoT = this.reacao;
      this._reacaoT = Math.max(0, this._reacaoT - dt);

      const inp = { moveX: 0, moveZ: 0, yaw: this.body.yaw, pitch: 0, run: false, jump: false, up: false, down: false, heliYaw: 0, heliDesiredYaw: null };

      // ---- [BOT-HELI] piloto de helicoptero: embarca num aparelho livre e
      // persegue os players pelo ar disparando MISSELS (BR e DM) ----
      // ---- [BOT-CARRO] dirigindo: persegue o alvo atirando (esterco + gas) ----
      if (this.inCar != null) {
        this._carroT -= dt;
        const c = (room.cars || []).find((cc) => cc.id === this.inCar);
        if (!c || this._carroT <= 0) {
          room._veiculo(this, 0);
          this.pilotarCarro = false;
        } else if (foraMapa) {
          // [BOT-MAPA] carro saiu da cidade: dirige de volta ao centro
          const toZ = Math.atan2(-c.x, -c.z);
          const diff = angleDelta(c.yaw, toZ);
          inp.moveX = clamp(-diff * 2.5, -1, 1);
          inp.moveZ = 1;
          inp.yaw = toZ;
        } else if (modo === 'br' && room.zone && dist2D(c.x, c.z, room.zone.x, room.zone.z) > room.zone.r) {
          // [ZONA-FOCO] carro fora da zona: dirige de volta para a zona
          const toZ = Math.atan2(room.zone.x - c.x, room.zone.z - c.z);
          const diff = angleDelta(c.yaw, toZ);
          inp.moveX = clamp(-diff * 2.5, -1, 1);
          inp.moveZ = 1;
          inp.yaw = toZ;
        } else if (best) {
          const dxC = best.body.pos.x - c.x;
          const dzC = best.body.pos.z - c.z;
          const distC = Math.hypot(dxC, dzC);
          const yawC = Math.atan2(-dxC, -dzC);
          const diff = angleDelta(c.yaw, yawC);
          inp.moveX = clamp(-diff * 2.5, -1, 1);   // esterco rumo ao alvo
          inp.moveZ = distC > 20 ? 1 : distC < 9 ? -0.6 : 0.3;
          inp.yaw = yawC;
          this._fireT = (this._fireT || 0) - dt;
          if (this._fireT <= 0 && Math.abs(diff) < 0.35) {
            this._fireT = 0.85 + (1 - this.precisao) * 0.7;   // [DANO2] cadência reduzida (carro)
            const dyC = (best.body.pos.y + 1.2) - c.y;
            room.onShoot(this, { yaw: c.yaw, pitch: Math.atan2(dyC, distC) });
          }
        } else {
          // sem alvo: anda pela cidade ate acabar o tempo de direcao
          // [ZONA-FOCO] carro sem alvo: circula perto do centro da zona
          this._carroWT = (this._carroWT || 0) - dt;
          if (this._carroWT <= 0) {
            this._carroWT = 6 + Math.random() * 4;
            const angC = Math.random() * Math.PI * 2;
            const dC = (modo === 'br' && room.zone ? room.zone.r : 90) * 0.55;
            this._carroWX = clamp((modo === 'br' && room.zone ? room.zone.x : c.x) + Math.cos(angC) * dC, -200, 200);
            this._carroWZ = clamp((modo === 'br' && room.zone ? room.zone.z : c.z) + Math.sin(angC) * dC, -200, 200);
          }
          const toZ = Math.atan2(this._carroWX - c.x, this._carroWZ - c.z);
          const diff = angleDelta(c.yaw, toZ);
          inp.moveX = clamp(-diff * 2.5, -1, 1);
          inp.moveZ = 1;
          inp.yaw = toZ;
        }
        this._lastInput = inp;
        room._applyInput(this, inp);
        return;
      }

      if (this.pilotarHeli) {
        if (this.inHeli != null) {
          // --- pilotando: sobe, persegue o alvo a ~60 m e atira missile ---
          const gH = room.world.col.groundHeightAt(this.body.pos.x, this.body.pos.z, 999);
          const alvoY = gH + 26;
          inp.up = this.body.pos.y < alvoY - 3;
          inp.down = this.body.pos.y > alvoY + 3;
          if (foraMapa) {
            // [BOT-MAPA] heli fora da cidade: volta ao centro ANTES de continuar a luta
            const toZ = Math.atan2(-this.body.pos.x, -this.body.pos.z);
            inp.moveZ = 0.6;
            inp.yaw = toZ;
            inp.heliDesiredYaw = toZ;
          } else if (best) {
            const dxH = best.body.pos.x - this.body.pos.x;
            const dzH = best.body.pos.z - this.body.pos.z;
            const distH = Math.hypot(dxH, dzH);
            const dyH = (best.body.pos.y + 1.2) - this.body.pos.y;
            const yawH = Math.atan2(-dxH, -dzH);
            const pitchH = Math.atan2(dyH, distH);
            inp.moveZ = distH > 70 ? 0.55 : distH < 35 ? -0.45 : 0;
            inp.yaw = yawH;
            inp.heliDesiredYaw = yawH;
            this._missilT -= dt;
            if (this._missilT <= 0 && Math.abs(angleDelta(this.body.yaw, yawH)) < 0.4) {
              this._missilT = 2.5 + Math.random() * 1.5;
              room.onShoot(this, { yaw: yawH, pitch: pitchH });   // missile (inHeli)
            }
          } else if (modo === 'br' && !inZone) {
            const toZ = Math.atan2(room.zone.x - this.body.pos.x, room.zone.z - this.body.pos.z);
            inp.moveZ = 0.6;
            inp.yaw = toZ;
            inp.heliDesiredYaw = toZ;
          } else {
            // [ZONA-FOCO] sem alvo: heli circula perto do centro da zona
            this._heliWanderT = (this._heliWanderT || 0) - dt;
            if (this._heliWanderT <= 0) {
              this._heliWanderT = 5 + Math.random() * 4;
              const angH = Math.random() * Math.PI * 2;
              const dH2 = (modo === 'br' && room.zone ? room.zone.r : 80) * 0.55;
              this._heliWX = clamp((modo === 'br' && room.zone ? room.zone.x : 0) + Math.cos(angH) * dH2, -200, 200);
              this._heliWZ = clamp((modo === 'br' && room.zone ? room.zone.z : 0) + Math.sin(angH) * dH2, -200, 200);
            }
            const toZ = Math.atan2(this._heliWX - this.body.pos.x, this._heliWZ - this.body.pos.z);
            const dZ = Math.hypot(this._heliWX - this.body.pos.x, this._heliWZ - this.body.pos.z);
            inp.moveZ = dZ > 40 ? 0.55 : dZ < 15 ? -0.4 : 0;
            inp.yaw = toZ;
            inp.heliDesiredYaw = toZ;
          }
          this._heliT -= dt;
          if (this._heliT <= 0) {
            room._veiculoHeli(this, 0);   // tempo de voo acabou: vira bot de chao
            this.pilotarHeli = false;
          }
          this._lastInput = inp;
          room._applyInput(this, inp);
          return;
        }
        // --- no chao: caminha ate o helicoptero livre mais proximo e embarca ---
        let hNear = null, hD = Infinity;
        for (const h of room.helis || []) {
          if (h.playerId != null) continue;
          const dd = dist2D(this.body.pos.x, this.body.pos.z, h.x, h.z);
          if (dd < hD) { hD = dd; hNear = h; }
        }
        if (hNear) {
          if (hD < 7) {
            room._veiculoHeli(this, hNear.id);
            this._heliT = 55 + Math.random() * 40;   // voa de ~1 a ~1,5 min
            this._missilT = 1 + Math.random() * 2;
          } else {
            const toH = Math.atan2(hNear.x - this.body.pos.x, hNear.z - this.body.pos.z);
            inp.yaw = toH;
            inp.moveZ = 0.6;
            inp.run = true;
            this._lastInput = inp;
            room._applyInput(this, inp);
            return;
          }
        }
      }

      // ---- [COVER] sob fogo com vida baixa: corre para um abrigo ----
      if (modo === 'br' && !inZone && this.wanderT > 0) {
        // foge para o centro da zona
        const toZ = Math.atan2(room.zone.x - this.body.pos.x, room.zone.z - this.body.pos.z);
        inp.yaw = toZ;
        inp.moveZ = 0.5;
        inp.run = true;
        this.wanderT -= dt;
      } else if (best) {
        // mira no alvo
        const dy = (best.body.pos.y + 1.2) - (this.body.pos.y + 1.5);
        const dx = best.body.pos.x - this.body.pos.x;
        const dz = best.body.pos.z - this.body.pos.z;
        const yaw = Math.atan2(-dx, -dz);
        const dist = Math.hypot(dx, dz);
        const pitch = Math.atan2(dy, dist);
        const now = Date.now() / 1000;
        this.body.yaw += angleDelta(this.body.yaw, yaw) * Math.min(1, 8 * dt);
        this.body.pitch = pitch * 0.8;
        // [EXPERT] alcance ideal conforme a arma: mantém a distância tática
        const alcance = this._alcanceIdeal();
        const longe = dist > alcance * 1.2;
        const perto = dist < alcance * 0.55;
        // [EXPERT] consciência de fogo: sabe quem o acertou e quando
        const sobFogo = this._danoDe && (now - this._danoT) < 2.5;
        const vidaBaixa = this.hp < 35;
        // [EXPERT] strafe lateral: muda de direção a cada instante
        this._strafeT -= dt;
        if (this._strafeT <= 0) {
          this._strafeT = 0.7 + Math.random() * 1.3;
          this._strafeDir = Math.random() < 0.5 ? 1 : -1;
        }
        const strafe = this._strafeDir;
        if (sobFogo && vidaBaixa) {
          // auto-preservação: recua de costas (mirando) em zigue-zague
          inp.moveZ = -0.8;
          inp.moveX = strafe * 0.7;
          inp.jump = Math.random() < 0.12;
        } else if (sobFogo) {
          // sob fogo: desvia forte (strafe) mantendo a mira
          inp.moveZ = longe ? 0.4 : 0;
          inp.moveX = strafe * 0.9;
        } else {
          // combate normal: mantém a distância ideal + strafe constante
          inp.moveZ = longe ? 0.55 : perto ? -0.35 : 0;
          inp.moveX = strafe * 0.55;
        }
        inp.yaw = this.body.yaw;
        // dispara só depois da reação ao alvo e com a mira alinhada
        this._fireT = (this._fireT || 0) - dt;
        if (this._reacaoT <= 0 && this._fireT <= 0 && Math.abs(angleDelta(this.body.yaw, yaw)) < 0.25) {
          this._fireT = 0.85 + (1 - this.precisao) * 0.7;   // [DANO2] cadência reduzida (pé)
          room.onShoot(this, { yaw: this.body.yaw, pitch: this.body.pitch });
        }
        // [BOT-PULO] pulo tático em combate próximo
        this._puloT -= dt;
        if (dist < 12 && this._puloT <= 0 && Math.random() < 0.15) {
          inp.jump = true;
          this._puloT = 1.2 + Math.random() * 1.6;
        }
      } else {

        // [BOT-CARRO] sem alvo: prefere pegar um carro livre e rodar pela cidade
        // [ZONA-FOCO] BR: sem alvo e na borda da zona (>72% do raio) — volta ao centro da zona
        if (modo === 'br' && room.zone && dist2D(this.body.pos.x, this.body.pos.z, room.zone.x, room.zone.z) > room.zone.r * 0.72) {
          const toZ = Math.atan2(room.zone.x - this.body.pos.x, room.zone.z - this.body.pos.z);
          inp.yaw = toZ;
          inp.moveZ = 0.5;
          inp.run = true;
          this.wanderT = 0.2;
        } else {
        let cNear = null, cD = Infinity;
        if (this.pilotarCarro) {
          for (const cc of room.cars || []) {
            if (cc.playerId != null || cc.destroyed) continue;
            const dd = dist2D(this.body.pos.x, this.body.pos.z, cc.x, cc.z);
            if (dd < cD) { cD = dd; cNear = cc; }
          }
        }
        if (cNear && cD < 90) {
          if (cD < 4.5) {
            room._veiculo(this, cNear.id);
            this._carroT = 35 + Math.random() * 30;
            this._carroYawW = 0;
          } else {
            inp.yaw = Math.atan2(cNear.x - this.body.pos.x, cNear.z - this.body.pos.z);
            inp.moveZ = 0.6;
            inp.run = true;
          }
        } else {

        // vadiagem: muda de direção de tempos em tempos
        this.wanderT -= dt;
        if (this.wanderT <= 0) {
          this.wanderT = 2 + Math.random() * 3;
          // [BOT-STUCK] destino sempre em RUA LIVRE — nunca gera ponto dentro de prédio
          let w;
          if (modo === 'br' && room.zone) {
            // [ZONA-FOCO] BR: destino sempre perto do centro da zona — bots concentrados
            const angZ = Math.random() * Math.PI * 2;
            const distZ = Math.random() * room.zone.r * 0.6;
            w = findStreetSpot(col,
              room.zone.x + Math.cos(angZ) * distZ,
              room.zone.z + Math.sin(angZ) * distZ, 3, 16);
          } else {
            w = findStreetSpot(col, this.body.pos.x, this.body.pos.z, 2, 14);
          }
          // [BOT-MAPA] destino nunca fora dos predios
          this.wanderX = clamp(w.x, -200, 200);
          this.wanderZ = clamp(w.z, -200, 200);
        }
        const toW = Math.atan2(this.wanderX - this.body.pos.x, this.wanderZ - this.body.pos.z);
        inp.yaw = toW;
        inp.moveZ = 0.5;
        }
        }
      }

      // BR: pega loot se estiver vazio (só arma)
      if (modo === 'br' && this.arma === 'pistola' && room.loot.length) {
        let near = null, nd = 12;
        for (const it of room.loot) {
          if (it.tipo !== 'arma') continue;
          const dd = dist2D(this.body.pos.x, this.body.pos.z, it.x, it.z);
          if (dd < nd) { nd = dd; near = it; }
        }
        if (near) {
          const toL = Math.atan2(near.x - this.body.pos.x, near.z - this.body.pos.z);
          inp.yaw = toL;
          inp.moveZ = 0.5;
          room.pickup(this);
        }
      }

      // aplica input
      // [BOT-PULO] travou num obstaculo (anda mas nao sai do lugar): pula
      if (inp.moveZ > 0.3) {
        const mexeu = Math.hypot(this.body.pos.x - this._travaX, this.body.pos.z - this._travaZ);
        if (mexeu < 0.12) this._travaT += dt;
        else this._travaT = 0;
      } else this._travaT = 0;
      this._travaX = this.body.pos.x;
      this._travaZ = this.body.pos.z;
      if (this._travaT > 0.45) {
        // [BOT-STUCK] travou contra parede: pula, gira ~70° e troca de destino (rua livre)
        inp.jump = true;
        this.body.yaw += (Math.random() < 0.5 ? 1 : -1) * (1.1 + Math.random() * 0.9);
        this.wanderT = 0;
        this._travaT = 0;
      }

      this._lastInput = inp;
      room._applyInput(this, inp);
    },
  };
}

export function pickBotName(rng) {
  return NOMES[Math.floor(rng() * NOMES.length)];
}
