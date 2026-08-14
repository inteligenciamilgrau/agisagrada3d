import * as THREE from '../../vendor/three.module.js';
import { mergeGeometries } from '../../vendor/jsm/utils/BufferGeometryUtils.js';
import { CURB_H, BLOCK_INNER, CABLE } from '../config.js';
import { makeRng, rngRange, clamp } from '../utils.js';
import { rockTexture, helipadTexture, glowTexture } from '../gfx/textures.js';
import { terrainHeight } from './terrain.js';
import { MountainRoad } from './mountainroad.js';

/** Onde ficam os marcos do Rio dentro do mapa. */
export const CORCOVADO = { x: -640, z: -300, r: 190, h: 165 };
/**
 * Mirante do Cristo.
 *
 * `DECK_R` (piso e parapeito) tem que ficar DENTRO da borda interna da estrada,
 * que passa a 27,4 do eixo. Com o parapeito em 29,4 ele nascia em cima da
 * pista e raspava o carro na última volta.
 *
 * `DECK_WALK_R` é um pouco maior que o piso visível só para encostar na
 * estrada e não sobrar um anel sem chão entre as duas superfícies.
 */
const DECK_R = 27;
const DECK_WALK_R = 28;
export const URCA = { x: 500, z: 250, r: 105, h: 78 };
export const PAO = { x: 700, z: 355, r: 130, h: 148 };

/**
 * Altura da encosta de um morro num ponto — o inverso do perfil usado em
 * `_mountain`, que é `r = R * (1 - t)^p`. Serve para apoiar no chão o que é
 * construído na montanha (os pilares da estação do bondinho).
 */
export function mountainSurfaceY(spec, roundness, x, z) {
  const r = Math.hypot(x - spec.x, z - spec.z);
  if (r >= spec.r) return spec.baseY;
  const p = 0.5 + roundness * 0.9;
  const t = 1 - Math.pow(r / spec.r, 1 / p);
  return spec.baseY + t * spec.h;
}

/**
 * [53] Corcovado + Cristo Redentor, [54] Pão de Açúcar com bondinho
 * e [43] o heliporto de onde o helicóptero decola.
 */
export class Landmarks {
  constructor(scene, collision, seed = 5150) {
    this.scene = scene;
    this.col = collision;
    this.rng = makeRng(seed);
    this.group = new THREE.Group();
    this.group.name = 'landmarks';
    scene.add(this.group);

    this.cableCabins = [];
    this.heliport = null;
  }

  build(city) {
    this.rockMat = new THREE.MeshStandardMaterial({
      map: rockTexture(), vertexColors: true, roughness: 0.95, metalness: 0.02,
    });
    this.rockMat.map.repeat.set(9, 9);

    // As cotas dos morros precisam existir ANTES de qualquer coisa: a estrada
    // do Corcovado é traçada a partir do perfil dele, e a colisão do morro é
    // traçada a partir da estrada.
    for (const s of [CORCOVADO, URCA, PAO]) {
      s.baseY = terrainHeight(s.x, s.z) - 6;
      s.topY = s.baseY + s.h;
    }

    this.road = new MountainRoad(this.scene, this.col, CORCOVADO, 0.55);   // [53]

    /*
     * No Corcovado o raio de colisão é a borda interna da pista, senão os
     * anéis do morro barrariam o carro no meio da subida.
     *
     * Do piso do mirante para cima nada bloqueia: lá o anel tinha justamente o
     * raio da borda interna da estrada e fechava a passagem da pista para o
     * mirante — o Cristo ficava inacessível a pé. Quem barra o miolo lá em
     * cima é o colisor da própria estátua.
     */
    const pisoMirante = CORCOVADO.topY - 4.5;
    this._mountain(CORCOVADO, 0.55, (t) => {
      const y = CORCOVADO.baseY + t * CORCOVADO.h;
      if (y >= pisoMirante) return 1;
      return this.road.collisionRadiusAt(t);
    });
    this._mountain(URCA, 0.85);
    this._mountain(PAO, 0.95);

    this._cristoRedentor();     // [53]
    this.road.build();          // depois da estátua: usa a cota do mirante
    this._cableCar();           // [54]
    this._heliport(city);       // [43]

    /*
     * A ROCHA vira chão — e isto vem por ÚLTIMO de propósito.
     *
     * Os morros só tinham anéis de colisão (que barram) e nenhuma
     * plataforma (que sustenta). Resultado: no topo do Pão de Açúcar,
     * fora do deck da estação, o chão respondia o terreno do nível do
     * mar — o jogador atravessava a pedra e despencava 150 m.
     *
     * `groundHeightAt` devolve a PRIMEIRA plataforma que responde, então
     * registrar a encosta depois de tudo faz o deck da estação, a
     * estrada e o mirante continuarem ganhando onde existem; a rocha só
     * atende onde não há nada construído.
     *
     * O Corcovado fica de fora: lá a colisão é amarrada à borda interna
     * da estrada em espiral, um equilíbrio que já custou caro para
     * fechar. Mexer nele para resolver um problema que é do Pão de
     * Açúcar seria trocar um bug por outro.
     */
    this._mountainFloor(URCA, 0.85);
    this._mountainFloor(PAO, 0.95);
  }

  /** Superfície caminhável de um morro (o inverso do perfil do cone). */
  _mountainFloor(spec, roundness) {
    this.col.addPlatform(
      spec.x - spec.r, spec.z - spec.r, spec.x + spec.r, spec.z + spec.r,
      (x, z, refY) => {
        const r = Math.hypot(x - spec.x, z - spec.z);
        if (r >= spec.r) return null;              // fora do morro: é o terreno
        /*
         * `max` com o terreno é obrigatório: na saia do morro o perfil
         * devolve `baseY`, que fica 6 m ABAIXO do relevo natural. Sem
         * isto o jogador afundaria no chão ao encostar na base.
         */
        const y = Math.max(mountainSurfaceY(spec, roundness, x, z), terrainHeight(x, z));
        // quem está bem abaixo da encosta está passando por fora dela
        if (refY != null && refY < y - 2.5) return null;
        return y;
      },
    );
  }

  // ------------------------------------------------------------------ montanhas
  /**
   * Morro de granito: cone deformado por ruído. `roundness` alto deixa a
   * silhueta arredondada (Pão de Açúcar), baixo deixa pontudo (Corcovado).
   */
  _mountain(spec, roundness, collisionRadiusFn = null) {
    const rng = this.rng;
    const geo = new THREE.ConeGeometry(spec.r, spec.h, 56, 22, false);
    geo.translate(0, spec.h / 2, 0);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const green = new THREE.Color(0x3f5f2e);
    const stone = new THREE.Color(0x9a938a);
    const dark = new THREE.Color(0x5e5a54);
    const v = new THREE.Vector3();

    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const t = clamp(v.y / spec.h, 0, 1);

      // perfil: arredondado no topo em vez de cônico
      const profile = Math.pow(1 - t, 0.5 + roundness * 0.9);
      const rXZ = Math.hypot(v.x, v.z);
      if (rXZ > 0.001) {
        const targetR = spec.r * profile;
        const curR = spec.r * (1 - t);
        const k = curR > 0.001 ? targetR / curR : 1;
        v.x *= k; v.z *= k;
      }

      // ruído de erosão
      const a = Math.atan2(v.z, v.x);
      const n =
        Math.sin(a * 5.0 + t * 9) * 0.055 +
        Math.sin(a * 11.0 - t * 15) * 0.028 +
        Math.sin(a * 2.0 + t * 4) * 0.075;
      v.x *= 1 + n; v.z *= 1 + n;
      v.y += Math.sin(a * 7 + t * 12) * spec.h * 0.012;

      pos.setXYZ(i, v.x, v.y, v.z);

      // mata na base, rocha nua no topo
      const c = green.clone().lerp(stone, clamp((t - 0.25) / 0.45, 0, 1));
      c.lerp(dark, Math.abs(n) * 2.2);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, this.rockMat);
    mesh.position.set(spec.x, spec.baseY, spec.z);
    mesh.castShadow = true;          // [44]
    mesh.receiveShadow = true;
    mesh.name = 'mountain';
    this.group.add(mesh);

    /*
     * Colisão por anéis de cilindro. Muitos anéis finos, porque cada anel usa
     * o raio da sua base: com poucos anéis, o degrau entre um e outro avança
     * por cima da estrada e trava o carro na subida.
     */
    const RINGS = 28;
    for (let i = 0; i < RINGS; i++) {
      /*
       * O raio vem do TOPO da faixa, não da base. Cada anel é um cilindro que
       * sobe até o fim da sua faixa; usando o raio da base ele fica gordo
       * demais lá em cima e avança por cima da estrada, travando o carro.
       * O raio do topo é o menor da faixa, então o anel nunca invade a pista.
       */
      const tTopo = (i + 1) / RINGS;
      const rr = collisionRadiusFn
        ? collisionRadiusFn(tTopo)
        : spec.r * Math.pow(Math.max(0, 1 - tTopo), 0.5 + roundness * 0.9) * 0.85;
      this.col.addCircle(spec.x, spec.z, Math.max(1, rr), spec.baseY + spec.h * tTopo, 'mountain');
    }
  }

  // ------------------------------------------------------------------ [53] Cristo
  _cristoRedentor() {
    const g = new THREE.Group();
    const stoneParts = [];

    /*
     * --- pedestal e mirante
     * O piso vai até o raio 30 para encostar na borda interna da estrada
     * (que passa a 27,4 do eixo): sem isso havia um vão entre a pista e o
     * mirante e não dava para chegar a pé no Cristo.
     * A base é MAIS ESTREITA que o topo (30 em cima, 24 embaixo) para o
     * cone do pedestal não engolir a pista, que passa rente a 32.
     */
    const deck = new THREE.CylinderGeometry(DECK_R, 21, 3, 40);
    deck.translate(0, 1.5, 0);
    stoneParts.push(deck);

    const ped = new THREE.BoxGeometry(15, 8, 11);
    ped.translate(0, 7, 0);
    stoneParts.push(ped);
    const cap = new THREE.BoxGeometry(11.5, 1.6, 8.5);
    cap.translate(0, 11.8, 0);
    stoneParts.push(cap);

    // --- manto (corpo) — cone truncado, mais largo embaixo
    const robe = new THREE.CylinderGeometry(2.2, 5.2, 17, 20, 1);
    robe.translate(0, 21, 0);
    stoneParts.push(robe);
    // pregas do manto
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const f = new THREE.BoxGeometry(0.5, 15, 0.5);
      f.translate(Math.cos(a) * 4.1, 20.5, Math.sin(a) * 4.1);
      stoneParts.push(f);
    }

    // --- tronco e ombros
    const torso = new THREE.BoxGeometry(7.4, 6.5, 3.6);
    torso.translate(0, 32, 0);
    stoneParts.push(torso);
    const shoulder = new THREE.CylinderGeometry(1.85, 1.85, 8.6, 14);
    shoulder.rotateZ(Math.PI / 2);
    shoulder.translate(0, 34.2, 0);
    stoneParts.push(shoulder);

    // --- braços abertos (a marca do monumento)
    for (const s of [-1, 1]) {
      const arm = new THREE.BoxGeometry(11.5, 1.9, 2.2);
      arm.translate(s * 9.8, 34.2, 0);
      stoneParts.push(arm);
      const fore = new THREE.BoxGeometry(6.2, 1.5, 1.8);
      fore.translate(s * 18.4, 34.0, 0);
      stoneParts.push(fore);
      const hand = new THREE.BoxGeometry(1.8, 1.5, 1.9);
      hand.translate(s * 22.0, 33.8, 0);
      stoneParts.push(hand);
      // manga do manto caindo
      const sleeve = new THREE.BoxGeometry(9, 3.4, 2.4);
      sleeve.translate(s * 8.5, 31.6, 0);
      stoneParts.push(sleeve);
    }

    // --- pescoço e cabeça
    const neck = new THREE.CylinderGeometry(1.0, 1.2, 1.8, 12);
    neck.translate(0, 36.2, 0);
    stoneParts.push(neck);
    const head = new THREE.SphereGeometry(1.95, 20, 16);
    head.scale(1, 1.18, 1.05);
    head.translate(0, 38.4, 0.15);
    stoneParts.push(head);
    const hair = new THREE.SphereGeometry(2.05, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.62);
    hair.translate(0, 38.5, -0.05);
    stoneParts.push(hair);
    const beard = new THREE.ConeGeometry(1.0, 1.8, 10);
    beard.rotateX(Math.PI);
    beard.translate(0, 36.9, 1.0);
    stoneParts.push(beard);

    const soapstone = new THREE.MeshStandardMaterial({
      color: 0xc8c4ba, roughness: 0.86, metalness: 0.02,
      envMapIntensity: 0.7,
    });
    const statue = new THREE.Mesh(mergeGeometries(stoneParts, false), soapstone);
    statue.castShadow = true;
    statue.receiveShadow = true;
    g.add(statue);

    /*
     * Guarda-corpo do mirante COM ENTRADA.
     *
     * O grupo da estátua é girado em GRUPO_ROT, e girar em Y por θ leva um
     * ângulo local `a` para `a - θ` no mundo. Então o ângulo local da abertura
     * é o ângulo onde a estrada termina MAIS a rotação do grupo.
     */
    const GRUPO_ROT = Math.PI * 0.15;
    const entradaLocal = (this.road ? this.road.thetaEnd : 0) + GRUPO_ROT;
    const MEIA_ABERTURA = 0.30;                 // ~18 m de vão no raio do parapeito
    const RAIL_R = DECK_R - 0.6;
    const N = 44;

    const naEntrada = (a) => {
      const d = Math.atan2(Math.sin(a - entradaLocal), Math.cos(a - entradaLocal));
      return Math.abs(d) < MEIA_ABERTURA;
    };

    const railMat = new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.5, metalness: 0.8 });
    const rails = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      if (naEntrada(a)) continue;

      const p = new THREE.BoxGeometry(0.14, 1.1, 0.14);
      p.translate(Math.cos(a) * RAIL_R, 3.5, Math.sin(a) * RAIL_R);
      rails.push(p);

      // barra até o próximo poste, pulando o trecho da abertura
      const a2 = ((i + 1) / N) * Math.PI * 2;
      if (naEntrada(a2)) continue;
      const x1 = Math.cos(a) * RAIL_R, z1 = Math.sin(a) * RAIL_R;
      const x2 = Math.cos(a2) * RAIL_R, z2 = Math.sin(a2) * RAIL_R;
      const barra = new THREE.BoxGeometry(0.09, 0.09, Math.hypot(x2 - x1, z2 - z1));
      barra.rotateY(Math.atan2(x2 - x1, z2 - z1));
      barra.translate((x1 + x2) / 2, 4.05, (z1 + z2) / 2);
      rails.push(barra);
    }
    const railMesh = new THREE.Mesh(mergeGeometries(rails, false), railMat);
    railMesh.castShadow = true;
    g.add(railMesh);

    /*
     * Colisão do parapeito — o desenho sozinho não segura ninguém, e sem isso
     * dava para andar para fora e cair do mirante.
     *
     * Vai muito mais denso que os postes visíveis (a cada ~1,2 m, com raio
     * 0,7) para os colisores se sobreporem: com o espaçamento dos postes o
     * jogador passaria pela fresta. E respeita a mesma abertura da entrada.
     *
     * A base fica logo abaixo do piso do mirante para não barrar as voltas da
     * estrada que passam por baixo.
     */
    const pisoY = CORCOVADO.topY - 1;
    const M = 160;
    for (let i = 0; i < M; i++) {
      const a = (i / M) * Math.PI * 2;
      if (naEntrada(a)) continue;
      // ângulo local -> ângulo no mundo (o grupo é girado em GRUPO_ROT)
      const w = a - GRUPO_ROT;
      this.col.addCircle(
        CORCOVADO.x + Math.cos(w) * RAIL_R,
        CORCOVADO.z + Math.sin(w) * RAIL_R,
        0.7, pisoY + 1.2, 'rail', pisoY - 0.6,
      );
    }

    // refletores que iluminam a estátua à noite
    this.cristoLights = [];
    for (const s of [-1, 1]) {
      const spot = new THREE.SpotLight(0xfff0d0, 0, 90, Math.PI / 7, 0.6, 1.2);
      spot.position.set(s * 16, 4, 14);
      spot.target.position.set(0, 32, 0);
      g.add(spot, spot.target);
      this.cristoLights.push(spot);
    }

    g.position.set(CORCOVADO.x, CORCOVADO.topY - 4, CORCOVADO.z);
    g.rotation.y = Math.PI * 0.15;      // de costas pro morro, olhando pra cidade
    this.group.add(g);
    this.cristo = g;

    this.col.addCircle(CORCOVADO.x, CORCOVADO.z, 6, CORCOVADO.topY + 40, 'statue');

    /*
     * [53] Piso do mirante: é onde a estrada termina, então precisa ser
     * caminhável — senão quem sobe de carro cai ao chegar.
     *
     * A checagem de ALTURA é obrigatória. A espiral dá voltas em torno do
     * pináculo bem abaixo daqui; sem o teste de `refY`, qualquer ponto dessas
     * voltas cairia nesta plataforma e receberia a cota do mirante, jogando o
     * carro lá para cima e impedindo a descida.
     */
    const deckY = CORCOVADO.topY - 1;
    this.col.addPlatform(
      CORCOVADO.x - DECK_WALK_R, CORCOVADO.z - DECK_WALK_R,
      CORCOVADO.x + DECK_WALK_R, CORCOVADO.z + DECK_WALK_R,
      (x, z, refY) => {
        if (Math.hypot(x - CORCOVADO.x, z - CORCOVADO.z) > DECK_WALK_R) return null;
        if (refY != null && Math.abs(refY - deckY) > 6) return null;
        return deckY;
      },
    );
  }

  // ------------------------------------------------------------------ [54] bondinho
  /**
   * [54] Bondinho do Pão de Açúcar — e agora dá para subir na estação a pé e
   * viajar dentro da cabine até o topo do morro.
   *
   * São três estações (praia -> Morro da Urca -> Pão de Açúcar) e dois vãos,
   * como no bondinho de verdade: quem vai ao topo baldeia na Urca.
   *
   * Cada estação é um prédio SÓLIDO cujo telhado é a plataforma de embarque.
   * Foi o jeito mais simples de ter um piso lá em cima sem inventar mezanino
   * interno: o miolo continua sendo um único bloco de colisão e a rampa sobe
   * por fora. O deck fica exatamente em `cabo - CABLE.cabinFloor`, então a
   * cabine encosta no piso e o passageiro entra sem degrau.
   */
  _cableCar() {
    const stationMat = new THREE.MeshStandardMaterial({ color: 0xd6d0c2, roughness: 0.88 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x3c434c, roughness: 0.4, metalness: 0.9 });
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x9fd8ee, roughness: 0.1, metalness: 0, transmission: 0.6,
      transparent: true, opacity: 0.5, thickness: 0.3,
    });

    const baseX = 330, baseZ = 165;
    const stations = [
      { x: baseX, z: baseZ, y: terrainHeight(baseX, baseZ), ramp: true },
      { x: URCA.x, z: URCA.z, y: URCA.topY - 3, mount: URCA, roundness: 0.85 },
      { x: PAO.x, z: PAO.z, y: PAO.topY - 3, mount: PAO, roundness: 0.95 },
    ];

    // rumo do cabo em cada estação (a do meio fica no meio dos dois vãos):
    // é ele que orienta o mastro e a viga que segura as duas linhas
    for (let i = 0; i < stations.length; i++) {
      const a = stations[Math.max(0, i - 1)];
      const b = stations[Math.min(stations.length - 1, i + 1)];
      stations[i].bearing = Math.atan2(b.x - a.x, b.z - a.z);
      stations[i].deckY = stations[i].y + CABLE.rise;
      stations[i].cableY = stations[i].deckY + CABLE.cabinFloor;
    }
    for (const st of stations) this._station(st, stationMat, steel, glassMat);
    this.cableStations = stations;

    // dois vãos: base -> Urca -> Pão de Açúcar
    this.cableSpans = [];
    for (let i = 0; i < stations.length - 1; i++) {
      const a = stations[i], b = stations[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const L = Math.hypot(dx, dz);
      const dir = new THREE.Vector3(dx / L, 0, dz / L);
      const perp = new THREE.Vector3(-dir.z, 0, dir.x);

      /*
       * A cabine para ANTES do centro da estação, e não em cima dele. Assim os
       * dois vãos que se encontram na Urca param em lados opostos da
       * plataforma em vez de ocuparem o mesmo ponto — e o passageiro atravessa
       * o deck para baldear, como no bondinho de verdade.
       *
       * As duas pontas ficam na cota do cabo, então a cabine parada tem o piso
       * exatamente na altura do deck.
       */
      const p0 = new THREE.Vector3(a.x + dir.x * CABLE.dock, a.cableY, a.z + dir.z * CABLE.dock);
      const p1 = new THREE.Vector3(b.x - dir.x * CABLE.dock, b.cableY, b.z - dir.z * CABLE.dock);
      const mid = p0.clone().add(p1).multiplyScalar(0.5);
      mid.y -= L * 0.085;                          // catenária
      const curve = new THREE.QuadraticBezierCurve3(p0, mid, p1);

      /*
       * Duas linhas paralelas, uma para cada cabine — é assim que elas se
       * cruzam no meio do vão sem se atravessar. O afastamento é
       * PERPENDICULAR ao vão; usar um deslocamento fixo em Z só funcionaria
       * para um vão que corresse na direção de X.
       */
      const pontos = curve.getPoints(40);
      for (const lado of [-1, 1]) {
        const desl = perp.clone().multiplyScalar(lado * CABLE.cableSep);
        const pts = [
          new THREE.Vector3(a.x, a.cableY, a.z).add(desl),       // entra na estação
          ...pontos.map((p) => p.clone().add(desl)),
          new THREE.Vector3(b.x, b.cableY, b.z).add(desl),
        ];
        const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 44, 0.075, 5, false);
        const cable = new THREE.Mesh(tube, steel);
        cable.castShadow = true;
        cable.name = 'bondinho-cabo';
        this.group.add(cable);
      }

      this.cableSpans.push({ curve, length: L, dir, perp, a, b });

      // duas cabines por vão, uma em cada ponta e em cada linha
      for (let k = 0; k < 2; k++) {
        const cabin = this._makeCabin();
        this.group.add(cabin);
        this.cableCabins.push({
          mesh: cabin, span: i, side: k === 0 ? -1 : 1,
          t: k, dir: k === 0 ? 1 : -1,
          state: 'dock', dwell: CABLE.dwell + k * 2.5, passenger: false,
        });
      }
    }
  }

  /**
   * [54] Uma estação: prédio sólido + deck de embarque no telhado + mastro.
   * A rampa de acesso a pé só existe na estação da praia — nas outras duas o
   * jogador chega pelo próprio bondinho.
   */
  _station(st, mat, steel, glassMat) {
    const { halfX, halfZ, rise, deckOver } = CABLE;
    const hx = halfX + deckOver, hz = halfZ + deckOver;

    const parts = [];
    const hall = new THREE.BoxGeometry(halfX * 2, rise, halfZ * 2);
    hall.translate(0, rise / 2, 0);
    parts.push(hall);
    // laje do deck: o topo dela É o piso caminhável, então ela fica ABAIXO da cota
    const slab = new THREE.BoxGeometry(hx * 2, 0.7, hz * 2);
    slab.translate(0, rise - 0.35, 0);
    parts.push(slab);

    // pilares até a rocha: no alto do morro o prédio nasce sobre um pináculo
    // estreito e ficaria pendurado no ar sem eles
    if (st.mount) {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const px = st.x + sx * (halfX - 1.5), pz = st.z + sz * (halfZ - 1.5);
          const solo = mountainSurfaceY(st.mount, st.roundness, px, pz);
          const h = st.y - solo;
          if (h <= 0.5) continue;
          const p = new THREE.CylinderGeometry(1.0, 1.4, h, 10);
          p.translate(px - st.x, solo - st.y + h / 2, pz - st.z);
          parts.push(p);
        }
      }
    }

    const mesh = new THREE.Mesh(mergeGeometries(parts, false), mat);
    mesh.position.set(st.x, st.y, st.z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.name = 'bondinho-estacao';
    this.group.add(mesh);

    // faixa de vidro do saguão
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(halfX * 2 + 0.25, rise * 0.4, halfZ * 2 + 0.25),
      glassMat,
    );
    glass.position.set(st.x, st.y + rise * 0.56, st.z);
    this.group.add(glass);

    // ---- mastro que segura o cabo, alinhado com o rumo do vão
    const mastH = st.cableY - st.y;
    const tw = [];
    for (const s of [-1, 1]) {
      const leg = new THREE.CylinderGeometry(0.4, 0.55, mastH, 8);
      leg.translate(s * 2.4, mastH / 2, 0);
      tw.push(leg);
    }
    const viga = new THREE.BoxGeometry(8, 0.8, 2.4);
    viga.translate(0, mastH, 0);
    tw.push(viga);
    for (let i = 1; i <= 2; i++) {
      const brace = new THREE.BoxGeometry(5, 0.26, 0.26);
      brace.translate(0, rise + (mastH - rise) * (i / 3), 0);
      tw.push(brace);
    }
    const mastro = new THREE.Mesh(mergeGeometries(tw, false), steel);
    mastro.position.set(st.x, st.y, st.z);
    mastro.rotation.y = st.bearing;
    mastro.castShadow = true;
    mastro.name = 'bondinho-mastro';
    this.group.add(mastro);

    // ---- colisão
    // prédio maciço até o deck
    this.col.addBox(st.x, st.z, hx, hz, st.deckY, 'station');
    // piso do deck
    this.col.addPlatform(st.x - hx, st.z - hz, st.x + hx, st.z + hz, () => st.deckY);
    // pernas do mastro (só atrapalham quem está no deck)
    for (const s of [-1, 1]) {
      this.col.addCircle(
        st.x + Math.cos(st.bearing) * s * 2.4, st.z - Math.sin(st.bearing) * s * 2.4,
        0.8, st.cableY, 'mast', st.deckY - 1,
      );
    }

    this._deckRail(st, steel, hx, hz);
    if (st.ramp) this._stationRamp(st, mat, steel);
  }

  /** [54] Guarda-corpo do deck, com um vão onde a rampa chega. */
  _deckRail(st, steel, hx, hz) {
    const RH = 1.15;
    const parts = [];
    const STEP = 1.5;
    const pontos = [];
    for (let x = -hx; x <= hx + 0.01; x += STEP) { pontos.push([x, -hz]); pontos.push([x, hz]); }
    for (let z = -hz + STEP; z <= hz - STEP + 0.01; z += STEP) { pontos.push([-hx, z]); pontos.push([hx, z]); }

    // a rampa encosta no meio da face -X: ali o parapeito abre
    /*
     * Vão da entrada, no meio da face -X, onde a rampa encosta.
     *
     * A folga é generosa de propósito: a rampa tem 4,8 m e cada montante do
     * parapeito bloqueia 0,6 m de raio, então uma abertura apertada deixava a
     * passagem mais estreita que a própria rampa.
     */
    const MEIO_VAO = CABLE.rampHalfW + 1.1;
    const naEntrada = ([x, z]) => st.ramp && x < -hx + 0.6 && Math.abs(z) < MEIO_VAO;

    for (const p of pontos) {
      if (naEntrada(p)) continue;
      const post = new THREE.BoxGeometry(0.14, RH, 0.14);
      post.translate(p[0], CABLE.rise + RH / 2, p[1]);
      parts.push(post);
      this.col.addCircle(st.x + p[0], st.z + p[1], 0.6, st.deckY + RH, 'rail', st.deckY - 0.6);
    }

    // corrimão contínuo nas faces ±Z
    for (const dz of [-hz, hz]) {
      const b = new THREE.BoxGeometry(hx * 2, 0.1, 0.12);
      b.translate(0, CABLE.rise + RH, dz);
      parts.push(b);
    }
    /*
     * Nas faces ±X o corrimão é emitido em TRECHOS, pulando o vão da entrada.
     * Uma barra única atravessando a face -X era exatamente a "barra
     * bloqueando a entrada": não tinha colisão nenhuma, mas passava na altura
     * do peito bem no meio da passagem, e a rampa parecia dar num corrimão.
     */
    for (const s of [-1, 1]) {
      const vaoAqui = st.ramp && s === -1;
      const trechos = vaoAqui
        ? [[-hz, -MEIO_VAO], [MEIO_VAO, hz]]
        : [[-hz, hz]];
      for (const [z0, z1] of trechos) {
        const comp = z1 - z0;
        if (comp <= 0.1) continue;
        const b = new THREE.BoxGeometry(0.12, 0.1, comp);
        b.translate(s * hx, CABLE.rise + RH, (z0 + z1) / 2);
        parts.push(b);
      }
    }
    // batentes marcando os dois lados da entrada
    if (st.ramp) {
      for (const s of [-1, 1]) {
        const bat = new THREE.BoxGeometry(0.3, RH + 0.35, 0.3);
        bat.translate(-hx, CABLE.rise + (RH + 0.35) / 2, s * MEIO_VAO);
        parts.push(bat);
      }
    }

    const rail = new THREE.Mesh(mergeGeometries(parts, false), steel);
    rail.position.set(st.x, st.y, st.z);
    rail.castShadow = true;
    rail.name = 'bondinho-parapeito';
    this.group.add(rail);
  }

  /**
   * [54] Rampa de acesso a pé: reta, 42 m, ~21% de inclinação, encostando na
   * face -X do deck (o lado voltado para a cidade).
   *
   * O piso é `max(rampa, terreno)`. Assim o pé da rampa encontra o chão
   * sozinho, sem degrau, seja qual for o relevo — não é preciso acertar na
   * mão a cota onde ela começa.
   *
   * O `refY` faz a rampa sumir para quem está EMBAIXO dela. Sem isso, andar
   * sob a parte alta jogaria o jogador lá para cima, que é exatamente o
   * problema que o mirante do Cristo já teve.
   */
  _stationRamp(st, mat, steel) {
    const { rampLen, rampHalfW, halfX, deckOver, rise } = CABLE;
    const x1 = st.x - halfX - deckOver;           // encosta na borda do deck
    const x0 = x1 - rampLen;
    /*
     * A subida termina PATAMAR antes da borda: o último trecho é plano, na
     * cota exata do deck.
     *
     * Sem esse patamar a rampa só alcançava a altura do deck exatamente em
     * cima da borda — e ali está a caixa de colisão do prédio da estação, cujo
     * topo é o próprio deck. Chegando com o pé 8 cm abaixo, o jogador era
     * barrado pela parede e não conseguia entrar: parava a meio metro da
     * plataforma, já quase na altura dela.
     */
    const PATAMAR = 3;
    const subida = rampLen - PATAMAR;
    const alturaEm = (x) => st.y + clamp((x - x0) / subida, 0, 1) * rise;

    const ang = Math.atan2(rise, rampLen);
    const parts = [];

    // tabuleiro inclinado
    const laje = new THREE.BoxGeometry(Math.hypot(rampLen, rise) + 0.6, 0.5, rampHalfW * 2);
    laje.rotateZ(ang);
    laje.translate((x0 + x1) / 2 - st.x, (st.y + st.deckY) / 2 - st.y - 0.25, 0);
    parts.push(laje);

    // pilares de apoio
    for (let x = x0 + 6; x < x1 - 1; x += 7) {
      const topo = alturaEm(x) - 0.5;
      const solo = terrainHeight(x, st.z);
      const h = topo - solo;
      if (h < 1.2) continue;
      for (const s of [-1, 1]) {
        const p = new THREE.CylinderGeometry(0.42, 0.55, h, 8);
        p.translate(x - st.x, solo - st.y + h / 2, s * (rampHalfW - 0.5));
        parts.push(p);
      }
    }

    const mesh = new THREE.Mesh(mergeGeometries(parts, false), mat);
    mesh.position.set(st.x, st.y, st.z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.name = 'bondinho-rampa';
    this.group.add(mesh);

    // piso caminhável
    this.col.addPlatform(x0, st.z - rampHalfW, x1, st.z + rampHalfW, (x, z, refY) => {
      const y = Math.max(alturaEm(x), terrainHeight(x, z));
      if (refY != null && refY < y - 1.3) return null;      // está passando por baixo
      return y;
    });

    /*
     * Parapeito: só a partir de onde a rampa já levantou do chão, para
     * dar para entrar nela pelos lados na parte baixa.
     *
     * ---- POR QUE A COLISÃO É BARRA E NÃO POSTE ----
     * Antes cada montante virava um círculo de 55 cm de raio. O poste
     * que se VÊ tem 14 cm; o que BARRA tinha 110 cm de diâmetro. Como
     * eles ficam nas duas bordas de uma rampa de 4,8 m, sobrava só
     * 2,86 m de passagem — e o jogador que encostasse na lateral era
     * parado por nada visível. Parede invisível, exatamente.
     *
     * Agora a colisão é uma barra FINA e contínua (20 cm), em trechos
     * curtos que acompanham a inclinação. Barra em vez de bolas mantém
     * o parapeito intransponível (bola espaçada deixaria passar pelo
     * meio) e devolve quase um metro de passagem: 3,76 m livres.
     */
    const guarda = [];
    for (let x = x0 + 11; x <= x1 - 0.5; x += 1.5) {
      const y = alturaEm(x);
      for (const s of [-1, 1]) {
        const post = new THREE.BoxGeometry(0.14, 1.05, 0.14);
        post.translate(x - st.x, y - st.y + 0.52, s * rampHalfW);
        guarda.push(post);
      }
    }
    const TRECHO = 3;
    for (let x = x0 + 11; x < x1; x += TRECHO) {
      const xa = x, xb = Math.min(x1, x + TRECHO);
      const ya = alturaEm(xa), yb = alturaEm(xb);
      for (const s of [-1, 1]) {
        this.col.addBox(
          (xa + xb) / 2, st.z + s * rampHalfW,
          (xb - xa) / 2, 0.1,
          Math.max(ya, yb) + 1.05, 'rail', Math.min(ya, yb) - 0.7,
        );
      }
    }
    const rail = new THREE.Mesh(mergeGeometries(guarda, false), steel);
    rail.position.set(st.x, st.y, st.z);
    rail.name = 'bondinho-rampa-parapeito';
    this.group.add(rail);
  }

  // ------------------------------------------------------------------ [54] embarque
  /** Cabine parada numa estação e ao alcance de quem está em (x,z,y). */
  cabinAtPlatform(x, z, y) {
    for (const c of this.cableCabins) {
      if (c.state !== 'dock' || c.passenger) continue;
      const p = c.mesh.position;
      if (Math.abs(p.y - CABLE.cabinFloor - y) > 2.2) continue;
      if (Math.hypot(p.x - x, p.z - z) > CABLE.boardRange) continue;
      return c;
    }
    return null;
  }

  /** Onde o passageiro fica de pé dentro da cabine. */
  cabinSeat(c, out = new THREE.Vector3()) {
    const p = c.mesh.position;
    return out.set(p.x, p.y - CABLE.cabinFloor, p.z);
  }

  /**
   * Ponto do deck onde o passageiro desce: ao lado da cabine, na direção
   * contrária ao centro da estação — a parte do deck que está sempre livre.
   */
  cabinExit(c, out = new THREE.Vector3()) {
    const span = this.cableSpans[c.span];
    const st = c.t < 0.5 ? span.a : span.b;
    const fora = c.t < 0.5 ? 1 : -1;
    const p = c.mesh.position;
    return out.set(p.x + span.dir.x * fora * 3.0, st.deckY, p.z + span.dir.z * fora * 3.0);
  }

  /** true quando a cabine está parada numa estação (só aí dá para descer). */
  cabinDocked(c) { return c.state === 'dock'; }

  _makeCabin() {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xe8402c, roughness: 0.45, metalness: 0.25 });
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x9fd8ee, roughness: 0.08, metalness: 0, transmission: 0.72,
      transparent: true, opacity: 0.55, thickness: 0.4,
    });

    const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 3.0, 3.4), bodyMat);
    body.position.y = -3.6;
    body.castShadow = true;
    g.add(body);

    // faixa de vidro em volta
    const glass = new THREE.Mesh(new THREE.BoxGeometry(4.3, 1.5, 3.5), glassMat);
    glass.position.y = -3.4;
    g.add(glass);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.25, 3.7), bodyMat);
    roof.position.y = -2.0;
    g.add(roof);

    // braço de suspensão + roldana
    const arm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, 2.2, 8),
      new THREE.MeshStandardMaterial({ color: 0x3c434c, roughness: 0.4, metalness: 0.9 }),
    );
    arm.position.y = -1.0;
    g.add(arm);
    const pulley = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.13, 8, 16),
      new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.35, metalness: 0.95 }),
    );
    pulley.rotation.y = Math.PI / 2;
    g.add(pulley);

    return g;
  }

  // ------------------------------------------------------------------ [43] heliporto
  _heliport(city) {
    // quarteirão reservado na geração da cidade: plano, sem prédio e sem árvore
    const block = city.heliportBlock || city.blocks[0];
    const x = block.cx, z = block.cz;
    const R = BLOCK_INNER / 2 - 2;

    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, 0.35, 40),
      new THREE.MeshStandardMaterial({ map: helipadTexture(), roughness: 0.86, metalness: 0.06 }),
    );
    pad.position.set(x, CURB_H + 0.17, z);
    pad.receiveShadow = true;
    this.group.add(pad);

    /*
     * [43][46] O disco é um degrau de VERDADE, não só pintura.
     *
     * Sem esta plataforma o piso ali continuava sendo a calçada, 35 cm abaixo
     * do topo do disco — e o helicóptero pousava afundado no concreto. Vira
     * plataforma (e não caixa sólida) de propósito: caixa bloquearia o
     * jogador em vez de deixá-lo subir no heliponto.
     */
    const padY = CURB_H + 0.35;
    this.col.addPlatform(x - R, z - R, x + R, z + R,
      (px, pz) => (Math.hypot(px - x, pz - z) <= R ? padY : null), true);

    // luzes de balizamento
    const lightGeo = new THREE.SphereGeometry(0.22, 8, 6);
    this.padLightMat = new THREE.MeshStandardMaterial({
      color: 0x221100, emissive: 0xff8c00, emissiveIntensity: 1.2,
    });
    const lights = new THREE.InstancedMesh(lightGeo, this.padLightMat, 12);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      m.setPosition(x + Math.cos(a) * (R - 0.6), CURB_H + 0.4, z + Math.sin(a) * (R - 0.6));
      lights.setMatrixAt(i, m);
    }
    lights.instanceMatrix.needsUpdate = true;
    this.group.add(lights);

    // biruta
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.6, metalness: 0.4 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 6, 8), poleMat);
    pole.position.set(x + R + 1.6, CURB_H + 3, z);
    pole.castShadow = true;
    this.group.add(pole);
    const sockMat = new THREE.MeshStandardMaterial({
      color: 0xff5a1f, roughness: 0.9, side: THREE.DoubleSide,
    });
    this.windsock = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.4, 10, 1, true), sockMat);
    this.windsock.rotation.z = -Math.PI / 2;
    this.windsock.position.set(x + R + 2.8, CURB_H + 5.6, z);
    this.group.add(this.windsock);

    // halo no chão para achar o heliporto de longe
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xffa030, transparent: true,
      opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    halo.scale.set(26, 26, 1);
    halo.position.set(x, CURB_H + 1, z);
    this.group.add(halo);
    this.heliportHalo = halo;

    this.heliport = { x, z, y: padY, r: R };
  }

  // ------------------------------------------------------------------ animação
  update(dt, nightFactor) {
    /*
     * [54] Cabines percorrendo os cabos, agora com PARADA nas estações — sem
     * ela não haveria como embarcar a pé. Cada cabine anda numa das duas
     * linhas paralelas, então as duas se cruzam no meio do vão sem colidir.
     */
    for (const c of this.cableCabins) {
      const span = this.cableSpans[c.span];

      if (c.state === 'dock') {
        c.dwell -= dt;
        if (c.dwell <= 0) {
          c.state = 'run';
          c.dir = c.t <= 0.5 ? 1 : -1;
        }
      } else {
        c.t += (dt * CABLE.speed / span.length) * c.dir;
        if (c.t >= 1) { c.t = 1; c.state = 'dock'; c.dwell = CABLE.dwell; }
        else if (c.t <= 0) { c.t = 0; c.state = 'dock'; c.dwell = CABLE.dwell; }
      }

      span.curve.getPoint(c.t, c.mesh.position);
      c.mesh.position.addScaledVector(span.perp, c.side * CABLE.cableSep);

      const ahead = span.curve.getPoint(Math.min(1, c.t + 0.01));
      const behind = span.curve.getPoint(Math.max(0, c.t - 0.01));
      c.mesh.rotation.y = Math.atan2(ahead.x - behind.x, ahead.z - behind.z);
    }

    // biruta balançando
    if (this.windsock) {
      this.windsock.rotation.y = Math.sin(performance.now() * 0.0011) * 0.5;
    }

    // refletores do Cristo e balizamento acendem à noite
    const on = Math.pow(Math.max(0, (nightFactor - 0.2) / 0.8), 0.8);
    if (this.cristoLights) {
      for (const l of this.cristoLights) l.intensity = on * 900;
    }
    if (this.padLightMat) this.padLightMat.emissiveIntensity = 0.6 + on * 3.2;
    if (this.heliportHalo) this.heliportHalo.material.opacity = 0.18 + on * 0.5;
  }
}
