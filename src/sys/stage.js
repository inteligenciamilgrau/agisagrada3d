import * as THREE from '../../vendor/three.module.js';
import { Foe, FICHAS, CHEFES } from '../ent/foe.js';

/**
 * ============================================================
 *  O andamento de uma fase
 * ============================================================
 *
 * Encena a sequência que o jogo 2D fazia em `makeWaves`:
 *
 *   intro (diálogo) → ondas de capangas → diálogo do chefão
 *   → luta do chefão → diálogo de vitória → recompensa
 *
 * A diferença para o 2D é que lá as ondas nasciam quando a câmera
 * passava de um X; aqui a arena é fechada e a onda seguinte entra
 * quando a anterior cai. Em arena fechada isso lê melhor: o jogador
 * limpa o espaço, respira, e o próximo grupo chega.
 */

const ESTADOS = ['intro', 'ondas', 'chefeIntro', 'chefe', 'vitoria', 'fim'];

export class StageRunner {
  /**
   * @param {object} deps  { arena, dialogue, bullets, fx, hud, onDano, onFim }
   */
  constructor(deps) {
    Object.assign(this, deps);
    this.ativo = false;
    this.estado = 'fim';
    this.fase = null;
    this.foes = [];
    this.chefe = null;
    this.chefeIdx = 0;
    this.ondaIdx = 0;
    this.pausa = 0;
    this.tempo = 0;

    this.elBarra = document.getElementById('boss-bar');
    this.elNome = document.getElementById('boss-name');
    this.elFill = document.getElementById('boss-fill');
    this.elFase = document.getElementById('boss-phase');
    this.elCartao = document.getElementById('phase-card');
  }

  // ------------------------------------------------------------ começar
  iniciar(fase) {
    this.fase = fase;
    this.grupo = this.scene;
    this.ativo = true;
    this.foes = [];
    this.chefe = null;
    this.ondaIdx = 0;
    this.chefeIdx = 0;
    this.pausa = 0;
    this.tempo = 0;
    this.pontos = 0;

    this._cartao(fase);
    this.estado = 'intro';
    this.dialogue.tocar(fase.intro, () => {
      /*
       * Fase sem ondas (a invasão do Trunfo colossal) vai direto para o
       * diálogo do chefão: não há capangas para limpar, o gigante já
       * está entrando na cidade enquanto o Bob fala.
       */
      if (fase.semOndas) {
        this.estado = 'chefeIntro';
        this.dialogue.tocar(fase.bossDialog, () => {
          this.estado = 'chefe';
          this._soltarChefe();
        });
      } else {
        this.estado = 'ondas';
        this.pausa = 0.6;
      }
    });
  }

  /**
   * Fase a céu aberto: o chefão não nasce numa arena, e quem o cria é o
   * `game.js` (que tem a cidade, o helicóptero e o mundo de colisão).
   * O runner só recebe e conduz.
   */
  adotarChefe(foe) {
    this.chefe = foe;
    foe.onBola = this.onBola;
    this.foes.push(foe);
    this.elNome.textContent = foe.ficha.nome;
    this.elBarra.classList.remove('hidden');
    this._atualizarBarra();
  }

  /** Cartão com bandeira, título e lugar — o "FASE 1" do beat 'em up. */
  _cartao(fase) {
    document.getElementById('phase-flag').textContent = fase.flag;
    document.getElementById('phase-title').textContent = fase.title;
    document.getElementById('phase-place').textContent = fase.place;
    const el = this.elCartao;
    el.classList.remove('hidden', 'out');
    // reinicia a animação: sem isso o cartão da 2ª fase entra sem animar
    void el.offsetWidth;
    clearTimeout(this._cartaoT);
    this._cartaoT = setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.classList.add('hidden'), 520);
    }, 2600);
  }

  // ------------------------------------------------------------ ondas
  /**
   * Solta uma onda de capangas.
   *
   * A céu aberto eles SAEM DO MARCO: nascem num anel em volta do ponto
   * da fase — a boca da ponte, o vão do museu, o largo do pelourinho —
   * e caminham para cima do jogador. É o que faz a fase parecer uma
   * invasão daquele lugar, e não inimigos surgindo do nada.
   */
  _soltarOnda(onda) {
    for (const [tipo, qtd] of onda.spawn || []) {
      const ficha = FICHAS[tipo];
      if (!ficha) continue;
      for (let i = 0; i < qtd; i++) {
        const p = this._pontoDeEntrada(i, qtd);
        const f = new Foe(this.grupo, ficha, p);
        f.onBola = this.onBola;
        this.foes.push(f);
      }
    }
  }

  /** Um ponto na saída do marco daquela fase. */
  _pontoDeEntrada(i, total) {
    const L = this.fase.local || { x: 0, z: 0 };
    const col = this.col;
    // leque em volta do marco: espalha para não nascerem empilhados.
    // [FIX-prédios] tenta até achar um ponto na RUA: se cair dentro de um
    // prédio (isBlocked), o inimigo nascia preso dentro da caixa e não
    // conseguia sair — com o resolveCircle ativo ele ficaria espremido na
    // parede interna para sempre.
    for (let tent = 0; tent < 14; tent++) {
      const ang = (i / Math.max(1, total)) * Math.PI * 2 + Math.random() * 0.7 + tent * 0.9;
      const r = 16 + Math.random() * 14;
      const x = L.x + Math.cos(ang) * r, z = L.z + Math.sin(ang) * r;
      if (col && col.isBlocked(x, z, 0.9, 0.5)) continue;   // dentro de prédio/quarteirão
      return { x, z, y: col ? col.groundHeightAt(x, z, 5) : 0 };
    }
    return { x: L.x, z: L.z, y: col ? col.groundHeightAt(L.x, L.z, 5) : 0 };
  }

  /**
   * Põe o próximo chefão em cena.
   *
   * Numa fase comum é um só. Na final, `bossRush` traz os quatro em
   * fila: cada um que cai chama o seguinte, e a barra troca de nome.
   */
  _soltarChefe() {
    // a céu aberto quem constrói o chefão é o game.js (precisa da cidade)
    if (this.fase.aberta) {
      if (this.onChefeAberto) this.onChefeAberto(this.fase);
      return;
    }

    const fila = this.fase.bossRush;
    const chave = fila ? fila[this.chefeIdx] : this.fase.boss;
    const ficha = CHEFES[chave];
    if (!ficha) { this.estado = 'vitoria'; this.pausa = 0.8; return; }

    const p = this.arena.pontoChefe;
    this.chefe = new Foe(this.arena.group, ficha, p, true);
    this.foes.push(this.chefe);

    this.elNome.textContent = fila
      ? `${ficha.nome}   (${this.chefeIdx + 1}/${fila.length})`
      : ficha.nome;
    this.elBarra.classList.remove('hidden');
    this._atualizarBarra();
  }

  /** @returns {boolean} true se ainda há chefão na fila da final. */
  get temProximoChefe() {
    const fila = this.fase.bossRush;
    return !!fila && this.chefeIdx + 1 < fila.length;
  }

  /** Derruba todos os capangas ainda vivos (o chefe caiu). */
  _limparCapangas() {
    for (const f of this.foes) {
      if (!f.vivo || f === this.chefe) continue;
      f.dano(f.vida);
      if (this.fx) this.fx.explode(f.root.position, 0.7);
    }
  }

  _atualizarBarra() {
    if (!this.chefe) return;
    const f = this.chefe.fracaoVida;
    this.elFill.style.width = (f * 100).toFixed(1) + '%';
    this.elFill.classList.toggle('rage', f <= 0.25);
    const fase = this.chefe.faseAtual;
    this.elFase.textContent = fase ? fase.rotulo : '';
  }

  // ------------------------------------------------------------ laço
  /**
   * @param {THREE.Vector3} jogador
   * @returns {number} dano que o jogador levou neste quadro
   */
  update(dt, jogador, col) {
    if (!this.ativo) return 0;
    this.col = col;
    this.tempo += dt;
    let dano = 0;

    // ---- inimigos: andam, batem, morrem
    for (const f of this.foes) {
      const d = f.update(dt, jogador, col, null);
      if (d) dano += d;
    }
    // limpa os que já afundaram
    for (let i = this.foes.length - 1; i >= 0; i--) {
      const f = this.foes[i];
      if (!f.vivo && f.morteT > 3) { f.remover(); this.foes.splice(i, 1); }
    }

    /*
     * Cutscene na tela = jogador imune.
     *
     * Durante o diálogo ele não anda nem atira; deixar o dano passar
     * seria cobrar reação de quem está impedido de reagir. Os inimigos
     * continuam se mexendo (a cena não congela), só não machucam.
     */
    if (this.dialogue.ativo) return 0;
    const vivos = this.foes.filter((f) => f.vivo);

    switch (this.estado) {
      case 'ondas': {
        this.pausa -= dt;
        if (this.pausa > 0) break;
        const ondas = this.fase.waves.filter((w) => !w.boss);
        if (vivos.length === 0) {
          if (this.ondaIdx < ondas.length) {
            this._soltarOnda(ondas[this.ondaIdx++]);
            this.pausa = 0.4;
          } else {
            this.estado = 'chefeIntro';
            this.dialogue.tocar(this.fase.bossDialog, () => {
              this.estado = 'chefe';
              this._soltarChefe();
            });
          }
        }
        break;
      }

      case 'chefe': {
        if (!this.chefe) break;
        this._atualizarBarra();

        // o chefão chama reforço conforme a vida cai
        const fase = this.chefe.faseAtual;
        if (this.chefe.vivo && fase && fase.chama > 0) {
          this.chefe.chamaT -= dt;
          if (this.chefe.chamaT <= 0) {
            this.chefe.chamaT = fase.intervalo;
            // teto de capangas: sem isso a tela entope e vira injusto
            const capangas = vivos.length - 1;
            if (capangas < 7) {
              this._soltarOnda({ spawn: [[fase.tipo || 'drone', fase.chama]] });
            }
          }
        }

        if (!this.chefe.vivo) {
          // fila da fase final: o próximo entra em vez de acabar
          if (this.temProximoChefe) {
            this.chefeIdx++;
            this._limparCapangas();
            if (this.chefe.onMorreu) this.chefe.onMorreu();
            this.chefe = null;
            this.pausa = 1.2;
            this.estado = 'trocaChefe';
            break;
          }
          this.elBarra.classList.add('hidden');
          /*
           * Chefão caiu: os capangas caem junto.
           *
           * Sem isto o jogador morria LENDO o texto de vitória — os
           * drones que sobraram continuavam batendo com a tela presa no
           * diálogo, sem ele poder reagir. Beat 'em up clássico resolve
           * assim mesmo: cai o chefe, a capangada some.
           */
          this._limparCapangas();
          if (this.chefe.onMorreu) this.chefe.onMorreu();
          if (this.onLimparTiros) this.onLimparTiros();
          this.estado = 'vitoria';
          this.pausa = 1.1;
        }
        break;
      }

      case 'trocaChefe': {
        this.pausa -= dt;
        if (this.pausa > 0) break;
        this.estado = 'chefe';
        this._soltarChefe();
        break;
      }

      case 'vitoria': {
        this.pausa -= dt;
        if (this.pausa > 0) break;
        this.estado = 'fim';
        this.dialogue.tocar(this.fase.victory, () => {
          this.ativo = false;
          if (this.onFim) this.onFim(this.fase);
        });
        break;
      }
    }

    return dano;
  }

  // ------------------------------------------------------------ tiro
  /** Alvos para o sistema de balas. */
  get alvos() { return this.foes; }

  /**
   * A bala acertou um inimigo.
   * @returns {boolean} true se ele morreu
   */
  acertar(foe, ponto, dano = 12, deMissil = false) {
    const morreu = foe.dano(dano, deMissil);
    if (this.fx && ponto) this.fx.impact(ponto, new THREE.Vector3(0, 1, 0));
    if (morreu) {
      this.pontos += foe.ficha.pontos || 5;
      if (this.fx) this.fx.explode(foe.root.position, foe.chefe ? 1.5 : 0.8);
    }
    if (foe === this.chefe) this._atualizarBarra();
    return morreu;
  }

  abandonar() {
    for (const f of this.foes) f.remover();
    this.foes = [];
    this.chefe = null;
    this.ativo = false;
    this.estado = 'fim';
    this.elBarra.classList.add('hidden');
    this.elCartao.classList.add('hidden');
  }
}
