import * as THREE from '../../vendor/three.module.js';
import { mergeGeometries } from '../../vendor/jsm/utils/BufferGeometryUtils.js';
import { GRID, CURB_H, TRAFFIC, SIGNAL_OFF, NIGHT } from '../config.js';
import { nodeCoord } from '../utils.js';

/**
 * [4] Semáforos controlando o trânsito e os pedestres.
 *
 * Ciclo por cruzamento:
 *   0 NS verde -> 1 NS amarelo -> 2 tudo vermelho
 *   3 LO verde -> 4 LO amarelo -> 5 tudo vermelho
 *
 * O sinal de pedestre é sempre o inverso do sinal de carro do mesmo poste:
 * quem atravessa a rua N-S só anda quando o eixo L-O está verde.
 */

const PHASE_TIMES = [
  TRAFFIC.greenTime, TRAFFIC.yellowTime, TRAFFIC.allRedTime,
  TRAFFIC.greenTime, TRAFFIC.yellowTime, TRAFFIC.allRedTime,
];
const CYCLE = PHASE_TIMES.reduce((a, b) => a + b, 0);

// posições locais das lentes (poste com a face voltada para +Z)
const LENS = {
  red: [0, 3.35, 1.66],
  yellow: [0, 3.05, 1.66],
  green: [0, 2.75, 1.66],
  pedRed: [0.40, 2.13, 0],
  pedGreen: [0.40, 1.87, 0],
};

export class TrafficSystem {
  constructor(scene, collision) {
    this.scene = scene;
    this.col = collision;
    this.time = 0;

    this.lights = [];      // por cruzamento: {i,j,offset}
    this.poles = [];       // {x,z,rot,i,j,axis}
    this.group = new THREE.Group();
    this.group.name = 'traffic-lights';
    scene.add(this.group);
  }

  build() {
    // estado por cruzamento — cruzamentos vizinhos ficam defasados (onda verde)
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        this.lights.push({ i, j, offset: ((i + j) % 2) * (CYCLE / 2) });
      }
    }

    // um poste por aproximação existente
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const nx = nodeCoord(i), nz = nodeCoord(j);
        const O = SIGNAL_OFF;
        // vindo do sul (anda em +Z): canto próximo à direita = (-O,-O), lente para -Z
        if (j > 0) this._addPole(nx - O, nz - O, Math.PI, i, j, 'z');
        // vindo do norte (anda em -Z)
        if (j < GRID - 1) this._addPole(nx + O, nz + O, 0, i, j, 'z');
        // vindo do oeste (anda em +X)
        if (i > 0) this._addPole(nx - O, nz + O, -Math.PI / 2, i, j, 'x');
        // vindo do leste (anda em -X)
        if (i < GRID - 1) this._addPole(nx + O, nz - O, Math.PI / 2, i, j, 'x');
      }
    }

    this._buildMeshes();
  }

  _addPole(x, z, rot, i, j, axis) {
    this.poles.push({ x, z, rot, i, j, axis });
    this.col.addCircle(x, z, 0.22, CURB_H + 3.6, 'trafficlight');   // [31]
  }

  _buildMeshes() {
    const n = this.poles.length;

    // ---------------------------------------------------------- estrutura
    const parts = [];
    const pole = new THREE.CylinderGeometry(0.085, 0.13, 3.6, 8);
    pole.translate(0, 1.8, 0);
    parts.push(pole);
    const base = new THREE.CylinderGeometry(0.2, 0.26, 0.3, 8);
    base.translate(0, 0.15, 0);
    parts.push(base);
    const arm = new THREE.BoxGeometry(0.085, 0.085, 1.55);
    arm.translate(0, 3.32, 0.78);
    parts.push(arm);
    const brace = new THREE.BoxGeometry(0.07, 0.5, 0.5);
    brace.translate(0, 3.05, 0.3);
    parts.push(brace);
    // caixa dos três focos
    const housing = new THREE.BoxGeometry(0.36, 1.02, 0.3);
    housing.translate(0, 3.05, 1.55);
    parts.push(housing);
    // pala de cada foco
    for (const y of [3.35, 3.05, 2.75]) {
      const visor = new THREE.BoxGeometry(0.3, 0.06, 0.16);
      visor.translate(0, y + 0.12, 1.68);
      parts.push(visor);
    }
    // caixa do sinal de pedestre
    const ped = new THREE.BoxGeometry(0.24, 0.62, 0.3);
    ped.translate(0.3, 2.0, 0);
    parts.push(ped);

    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x272b31, roughness: 0.55, metalness: 0.6,
    });
    const poleMesh = new THREE.InstancedMesh(mergeGeometries(parts, false), bodyMat, n);
    poleMesh.castShadow = true;
    poleMesh.receiveShadow = true;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    this.poleMatrices = [];

    for (let k = 0; k < n; k++) {
      const p = this.poles[k];
      q.setFromAxisAngle(up, p.rot);
      m.compose(new THREE.Vector3(p.x, CURB_H, p.z), q, one);
      poleMesh.setMatrixAt(k, m);
      this.poleMatrices.push(m.clone());
    }
    poleMesh.instanceMatrix.needsUpdate = true;
    this.group.add(poleMesh);

    // ---------------------------------------------------------- lentes
    const lensGeo = new THREE.SphereGeometry(0.095, 10, 8);
    lensGeo.scale(1, 1, 0.65);
    const pedGeo = new THREE.BoxGeometry(0.14, 0.19, 0.1);

    const mk = (color, emissive, geo) => {
      const mat = new THREE.MeshStandardMaterial({
        color, emissive, emissiveIntensity: 2.6, roughness: 0.28, metalness: 0.0,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return { mesh, mat };
    };

    this.lens = {
      red: mk(0x3a0000, 0xff2418, lensGeo),
      yellow: mk(0x3a2a00, 0xffb300, lensGeo),
      green: mk(0x00330f, 0x2bff5e, lensGeo),
      pedRed: mk(0x3a0000, 0xff3b2a, pedGeo),
      pedGreen: mk(0x00330f, 0x3bff72, pedGeo),
    };
    this._lensState = {};
    for (const k of Object.keys(this.lens)) this._lensState[k] = new Array(n).fill(-1);

    this._refreshLenses(true);
  }

  // ------------------------------------------------------------------ estado
  _lightAt(i, j) {
    return this.lights[i * GRID + j];
  }

  _phaseOf(light) {
    let t = (this.time + light.offset) % CYCLE;
    for (let p = 0; p < PHASE_TIMES.length; p++) {
      if (t < PHASE_TIMES[p]) return p;
      t -= PHASE_TIMES[p];
    }
    return 0;
  }

  /** 'green' | 'yellow' | 'red' para veículos que trafegam no eixo dado. */
  carSignal(i, j, axis) {
    if (i < 0 || j < 0 || i >= GRID || j >= GRID) return 'green';
    const p = this._phaseOf(this._lightAt(i, j));
    if (axis === 'z') return p === 0 ? 'green' : p === 1 ? 'yellow' : 'red';
    return p === 3 ? 'green' : p === 4 ? 'yellow' : 'red';
  }

  /**
   * O pedestre pode atravessar? `moveAxis` é o eixo em que ele caminha:
   * andar em X significa cruzar a rua N-S, o que exige o eixo L-O verde.
   */
  pedSignal(i, j, moveAxis) {
    if (i < 0 || j < 0 || i >= GRID || j >= GRID) return 'walk';
    const p = this._phaseOf(this._lightAt(i, j));
    if (moveAxis === 'x') return p === 3 ? 'walk' : 'stop';
    return p === 0 ? 'walk' : 'stop';
  }

  update(dt, nightFactor = 0) {
    this.time += dt;
    this._refreshLenses(false);

    // à noite as lentes brilham um pouco mais (o bloom faz o resto)
    const boost = 2.2 + nightFactor * NIGHT.trafficLens;
    for (const k of Object.keys(this.lens)) this.lens[k].mat.emissiveIntensity = boost;
  }

  /** Liga/desliga cada lente escalando a instância (custo quase zero). */
  _refreshLenses(force) {
    const m = new THREE.Matrix4();
    const off = new THREE.Matrix4().makeScale(0.0001, 0.0001, 0.0001);
    const dirty = {};

    for (let k = 0; k < this.poles.length; k++) {
      const p = this.poles[k];
      const car = this.carSignal(p.i, p.j, p.axis);
      // o pedestre daquele poste cruza a rua do eixo oposto
      const pedMove = p.axis === 'z' ? 'x' : 'z';
      const ped = this.pedSignal(p.i, p.j, pedMove);

      const want = {
        red: car === 'red', yellow: car === 'yellow', green: car === 'green',
        pedRed: ped === 'stop', pedGreen: ped === 'walk',
      };

      for (const key of Object.keys(want)) {
        const on = want[key] ? 1 : 0;
        if (!force && this._lensState[key][k] === on) continue;
        this._lensState[key][k] = on;
        dirty[key] = true;

        if (on) {
          const L = LENS[key];
          m.copy(this.poleMatrices[k]);
          m.multiply(new THREE.Matrix4().makeTranslation(L[0], L[1], L[2]));
          this.lens[key].mesh.setMatrixAt(k, m);
        } else {
          this.lens[key].mesh.setMatrixAt(k, off);
        }
      }
    }

    for (const key of Object.keys(dirty)) {
      this.lens[key].mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
