import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Общие ресурсы: одна геометрия на много деталей, чтобы бюджетный телефон не страдал.
// ---------------------------------------------------------------------------

const GRADIENT = (() => {
  const data = new Uint8Array([150, 210, 255]);
  const tex = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
})();

const SPHERE = new THREE.SphereGeometry(1, 28, 20);
const SPHERE_SMALL = new THREE.SphereGeometry(1, 14, 10);
const EAR = new THREE.LatheGeometry(
  [[0, 0], [0.15, 0.02], [0.17, 0.12], [0.15, 0.25], [0.1, 0.38], [0.045, 0.48], [0, 0.53]]
    .map(([x, y]) => new THREE.Vector2(x, y)),
  22,
);
const LEG = new THREE.CapsuleGeometry(0.065, 0.14, 6, 14);
const HAPPY_EYE = new THREE.TorusGeometry(0.058, 0.017, 8, 24, Math.PI);
const MOUTH_ARC = new THREE.TorusGeometry(0.022, 0.0075, 6, 16, Math.PI);

const toon = () => new THREE.MeshToonMaterial({ gradientMap: GRADIENT });
const basic = (color) => new THREE.MeshBasicMaterial({ color });

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const bell = (p) => Math.sin(Math.PI * clamp(p, 0, 1));
const easeOut = (p) => 1 - Math.pow(1 - clamp(p, 0, 1), 3);
const easeOutBack = (p) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
};
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const rand = (a, b) => a + Math.random() * (b - a);

// Части тела, которые можно гладить пальцем.
const PETTABLE = new Set(['head', 'body', 'belly', 'chest', 'earL', 'earR']);

// ---------------------------------------------------------------------------
// Действия: каждое — короткая анимация, которая пишет в «позу» P.
// p — прогресс 0..1, a — экземпляр действия (флаги, направление).
// ---------------------------------------------------------------------------

const ACTIONS = {
  appear: {
    dur: 1.0,
    start: (c) => { c.emit('sparkle', { at: 'center', n: 16 }); c.emit('sfx', 'appear'); },
    run: (c, p, P) => {
      P.scale = Math.max(0.001, easeOutBack(p));
      P.eyes = p < 0.55 ? 'closed' : 'open';
      P.earUp = 0.6 * bell(p);
    },
  },
  hop: {
    dur: 0.75,
    start: (c) => c.emit('sfx', 'boing'),
    run: (c, p, P) => {
      if (p < 0.18) P.squash = -0.16 * bell((p / 0.18) * 0.5);
      else if (p < 0.82) {
        const q = (p - 0.18) / 0.64;
        P.jump = 0.24 * Math.sin(Math.PI * q);
        P.squash = 0.09 * Math.abs(Math.cos(Math.PI * q));
        P.earBack = -0.25 * Math.sin(Math.PI * q);
        P.tailAmp = 0.8;
      } else P.squash = -0.14 * bell((p - 0.82) / 0.18);
      P.eyes = p > 0.25 && p < 0.75 ? 'happy' : 'open';
    },
  },
  sneeze: {
    dur: 1.8,
    react: true,
    run: (c, p, P, a) => {
      if (p < 0.55) {
        const q = p / 0.55;
        if (!a.ah) { a.ah = true; c.emit('sfx', 'sneezeAh'); }
        P.headPitch = -0.34 * easeOut(q);
        P.eyes = 'squint';
        P.mouth = 0.25 * q;
        P.headRoll = 0.035 * Math.sin(p * 70) * q;
        P.earBack = 0.25 * q;
      } else if (p < 0.7) {
        const q = (p - 0.55) / 0.15;
        if (!a.choo) {
          a.choo = true;
          c.emit('sfx', 'sneezeChoo');
          c.emit('puff', { at: 'nose', n: 10 });
        }
        P.headPitch = -0.34 + 0.72 * easeOut(q);
        P.squash = -0.16 * bell(q);
        P.eyes = 'closed';
        P.mouth = 0.6 * bell(q);
        P.earUp = 0.6 * bell(q);
        P.jump = 0.03 * bell(q);
      } else {
        const q = (p - 0.7) / 0.3;
        P.headPitch = 0.38 * (1 - easeOut(q));
        P.eyes = q < 0.45 ? 'closed' : 'open';
        P.headRoll = 0.08 * Math.sin(q * 18) * (1 - q);
      }
    },
  },
  giggle: {
    dur: 1.5,
    react: true,
    start: (c) => { c.emit('sfx', 'giggle'); c.emit('hearts', { n: 2 }); },
    run: (c, p, P) => {
      const k = bell(p);
      P.eyes = 'happy';
      P.bodyRoll = 0.1 * Math.sin(p * 46) * k;
      P.headRoll = -0.06 * Math.sin(p * 46) * k;
      P.mouth = (0.35 + 0.25 * Math.sin(p * 52)) * k;
      P.jump = 0.02 * Math.abs(Math.sin(p * 46)) * k;
      P.blush = 1;
      P.tailAmp = 0.7;
      P.tailSpeed = 12;
    },
  },
  earFlick: {
    dur: 0.7,
    react: true,
    start: (c, a) => { c.kickEar(a.side, 1); c.emit('sfx', 'pip'); },
    run: (c, p, P, a) => {
      if (p > 0.4 && !a.second) { a.second = true; c.kickEar(a.side, 0.7); }
      P.headRoll = a.side * 0.1 * bell(p);
      P.eyes = p < 0.3 ? 'squint' : 'open';
    },
  },
  hmph: {
    dur: 1.7,
    react: true,
    start: (c, a) => { a.dir = Math.random() < 0.5 ? -1 : 1; c.emit('sfx', 'hmph'); },
    run: (c, p, P, a) => {
      const k = bell(p);
      P.tailPuff = 1 + 0.45 * bell(Math.min(1, p * 1.3));
      if (p < 0.25) P.jump = 0.1 * bell(p / 0.25);
      P.bodyYaw = 0.45 * a.dir * k;
      P.headYaw = 0.5 * a.dir * k;
      P.headPitch = -0.18 * k;
      P.eyes = 'squint';
      P.blush = 1;
      P.earBack = 0.35 * k;
      P.tailAmp = 0.9;
      P.tailSpeed = 10;
    },
  },
  pat: {
    dur: 1.3,
    react: true,
    start: (c) => { c.emit('hearts', { n: 3 }); c.emit('sfx', 'purrChirp'); },
    run: (c, p, P) => {
      const k = bell(p);
      P.eyes = 'happy';
      P.earBack = 0.6 * k;
      P.headRoll = 0.16 * k;
      P.squash = -0.05 * k;
      P.blush = 0.9;
    },
  },
  oops: {
    dur: 0.9,
    react: true,
    start: (c) => c.emit('sfx', 'oops'),
    run: (c, p, P) => {
      const k = bell(p);
      P.eyes = p < 0.6 ? 'closed' : 'open';
      P.headPitch = -0.14 * k;
      P.earBack = 0.35 * k;
      P.headRoll = 0.05 * Math.sin(p * 30) * k;
    },
  },
  shake: {
    dur: 1.0,
    react: true,
    start: (c) => { c.emit('sfx', 'brr'); c.emit('sparkle', { at: 'center', n: 6 }); },
    run: (c, p, P) => {
      const k = bell(p);
      P.bodyRoll = 0.17 * Math.sin(p * 40) * k;
      P.headRoll = -0.22 * Math.sin(p * 40) * k;
      P.eyes = 'closed';
      P.earBack = -0.2 * Math.sin(p * 40) * k;
      P.tailAmp = 1;
      P.tailSpeed = 16;
    },
  },
  blushy: {
    dur: 1.3,
    react: true,
    start: (c) => { c.emit('sfx', 'blush'); c.emit('hearts', { n: 1 }); },
    run: (c, p, P) => {
      const k = bell(p);
      P.eyes = 'happy';
      P.blush = 1.3;
      P.headRoll = 0.22 * k;
      P.headPitch = 0.1 * k;
      P.earBack = 0.3 * k;
    },
  },
  poof: {
    dur: 0.9,
    start: (c) => { c.emit('sparkle', { at: 'center', n: 18 }); c.emit('sfx', 'poof'); },
    run: (c, p, P) => {
      P.scale = 1 + 0.12 * bell(p) - 0.12 * bell(p * 2);
      P.eyes = p < 0.4 ? 'closed' : 'happy';
      P.squash = 0.08 * Math.sin(p * 20) * (1 - p);
    },
  },
  // Спокойные «сами по себе» действия.
  headTilt: {
    dur: 1.9,
    start: (c, a) => { a.dir = Math.random() < 0.5 ? -1 : 1; if (Math.random() < 0.4) c.emit('sfx', 'chirp'); },
    run: (c, p, P, a) => {
      const k = Math.pow(bell(p), 0.6);
      P.headRoll = 0.32 * a.dir * k;
      P.earUp = 0.25 * k;
    },
  },
  lookAround: {
    dur: 2.4,
    start: (c, a) => { a.dir = Math.random() < 0.5 ? -1 : 1; },
    run: (c, p, P, a) => {
      P.headYaw = 0.6 * Math.sin(Math.PI * 2 * p) * a.dir;
      P.headPitch = -0.08 * bell(p);
    },
  },
  earTwitch: {
    dur: 0.4,
    start: (c) => c.kickEar(Math.random() < 0.5 ? -1 : 1, 0.6),
    run: () => {},
  },
  tailSwish: {
    dur: 1.4,
    run: (c, p, P) => { P.tailAmp = 0.75; P.tailSpeed = 9; },
  },
  yawn: {
    dur: 2.2,
    start: (c) => c.emit('sfx', 'yawn'),
    run: (c, p, P) => {
      const k = bell(p);
      P.mouth = Math.pow(k, 0.6);
      P.eyes = p > 0.18 && p < 0.82 ? 'closed' : 'open';
      P.headPitch = -0.28 * k;
      P.earBack = 0.4 * k;
      P.squash = 0.06 * k;
    },
  },
};

const IDLE = [
  ['wander', 0.45], ['headTilt', 0.3], ['lookAround', 0.18], ['earTwitch', 0.2],
  ['tailSwish', 0.12], ['hop', 0.1], ['yawn', 0.07],
];

const REACTIONS = {
  nose: 'sneeze', belly: 'giggle', chest: 'giggle', tail: 'hmph', paw: 'hop',
  head: 'pat', eye: 'oops', cheek: 'blushy', body: 'shake',
};

// ---------------------------------------------------------------------------

export class Creature {
  constructor(palette) {
    this.root = new THREE.Group();
    this.root.name = 'pet';
    this.hop = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.hop);
    this.hop.add(this.body);

    this.mats = {
      body: toon(), accent: toon(), inner: toon(), nose: toon(),
      outline: new THREE.MeshBasicMaterial({ side: THREE.BackSide }),
      eye: basic(0x22182c), iris: basic(0x5b3d93), pupil: basic(0x100a16), shine: basic(0xffffff),
      mouth: basic(0x6e2b3f), tongue: basic(0xff8fb1), line: basic(0x3a2a40),
      blush: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false }),
    };

    this._build();
    this.setPalette(palette);

    // Состояние.
    this.t = 0;
    this.listeners = [];
    this.action = null;
    this.idleTimer = 2.5;
    this.blinkTimer = 2;
    this.blinkLeft = 0;
    this.eyeOpen = 1;
    this.look = { yaw: 0, pitch: 0, sYaw: 0, sPitch: 0, sTimer: 1 };
    this.earSpring = [{ a: 0, v: 0 }, { a: 0, v: 0 }];
    this.lookTarget = new THREE.Vector3(0, 1, 3);
    this.faceTarget = null; // куда разворачиваться всем телом (в AR)
    this.facingBias = 0;
    this.turning = false;
    this.petting = false;
    this.petLevel = 0;
    this.talk = 0;
    this.listening = false;
    this.listenLevel = 0;
    // Ходьба. Координаты цели — в системе родителя (якоря).
    this.move = { target: null, run: false, speed: 0, phase: 0, gait: 0 };
    this.pickWanderPoint = null; // main.js решает, куда можно гулять в текущем режиме
    this.faceAfterMove = false;
  }

  // ----- ходьба -----------------------------------------------------------

  get moving() { return !!this.move.target; }

  goTo(point, { run = false } = {}) {
    if (this.action?.def.react) this.action = null;
    this.move.target = new THREE.Vector3(point.x, 0, point.z);
    this.move.run = run;
    this.turning = false;
  }

  stop() { this.move.target = null; }

  _updateMove(dt, P) {
    const m = this.move;
    m.gait = damp(m.gait, m.target ? 1 : 0, 8, dt);
    if (m.target) {
      const pos = this.root.position;
      const dx = m.target.x - pos.x, dz = m.target.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.03) {
        m.target = null;
        this.faceAfterMove = true;
        this.idleTimer = Math.max(this.idleTimer, rand(2, 4));
      } else {
        const diff = angleDiff(Math.atan2(dx, dz), this.root.rotation.y);
        this.root.rotation.y += Math.sign(diff) * Math.min(Math.abs(diff), 7 * dt);
        const facing = Math.abs(diff) < 0.7 ? 1 : 0.15;
        const top = m.run ? 1.9 : 0.85;
        m.speed = damp(m.speed, top * facing * Math.min(1, dist / 0.2 + 0.25), 6, dt);
        const step = Math.min(dist, m.speed * dt);
        pos.x += Math.sin(this.root.rotation.y) * step;
        pos.z += Math.cos(this.root.rotation.y) * step;
      }
    } else {
      m.speed = damp(m.speed, 0, 8, dt);
    }

    const g = m.gait;
    if (g < 0.01) return;
    m.phase += dt * (m.run ? 15 : 10) * Math.max(0.4, g);
    const s = Math.sin(m.phase);
    const bounce = Math.abs(s);
    P.jump += g * (m.run ? 0.08 : 0.045) * bounce;
    P.squash += g * 0.05 * (bounce - 0.55);
    P.bodyPitch += g * (m.run ? 0.2 : 0.1);
    P.headPitch += -g * (m.run ? 0.14 : 0.07);
    P.earBack += g * (0.15 + 0.12 * Math.sin(m.phase * 2));
    P.tailAmp = Math.max(P.tailAmp, 0.55 * g);
    P.tailSpeed = Math.max(P.tailSpeed, 8);
    P.legSwing = g * (m.run ? 0.75 : 0.5) * s;
  }

  // ----- построение -------------------------------------------------------

  _mesh(geo, mat, parent, { part = null, pos = [0, 0, 0], scale = [1, 1, 1], outline = 0, ext = [1, 1, 1] } = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    m.scale.set(...scale);
    if (part) m.userData.part = part;
    parent.add(m);
    if (outline > 0) {
      const o = new THREE.Mesh(geo, this.mats.outline);
      o.scale.set(
        1 + outline / (scale[0] * ext[0]),
        1 + outline / (scale[1] * ext[1]),
        1 + outline / (scale[2] * ext[2]),
      );
      o.raycast = () => {};
      m.add(o);
    }
    return m;
  }

  _blob(parent, mat, part, pos, r, s = [1, 1, 1], outline = 0.014) {
    return this._mesh(SPHERE, mat, parent, { part, pos, scale: [r * s[0], r * s[1], r * s[2]], outline });
  }

  _build() {
    const M = this.mats;
    const B = this.body;

    // Туловище: сидячая «груша».
    this._blob(B, M.body, 'body', [0, 0.37, 0], 1, [0.33, 0.36, 0.31]);
    this._blob(B, M.accent, 'belly', [0, 0.33, 0.19], 1, [0.21, 0.24, 0.13], 0.01);

    // Задние лапки и стопы.
    this.backFeet = [];
    for (const sx of [-1, 1]) {
      this._blob(B, M.body, 'body', [0.21 * sx, 0.14, -0.05], 1, [0.15, 0.14, 0.18]);
      const foot = this._blob(B, M.accent, 'paw', [0.21 * sx, 0.045, 0.12], 1, [0.085, 0.05, 0.12], 0.01);
      foot.userData.base = foot.position.clone();
      this.backFeet.push(foot);
    }
    // Передние лапки: шарнир в «плече», чтобы шагать.
    this.frontLegs = [];
    for (const sx of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(0.115 * sx, 0.27, 0.2);
      B.add(leg);
      this._mesh(LEG, M.body, leg, { part: 'paw', pos: [0, -0.11, 0], outline: 0.012, ext: [0.065, 0.135, 0.065] });
      this._blob(leg, M.accent, 'paw', [0, -0.22, 0.035], 1, [0.08, 0.055, 0.095], 0.01);
      this.frontLegs.push(leg);
    }

    // Пушистый воротник.
    const collar = new THREE.Group();
    B.add(collar);
    const n = 12;
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2;
      const front = Math.max(0, Math.cos(th));
      const r = 0.12 * (1 + 0.3 * front) * (Math.cos(th) < 0 ? 0.92 : 1);
      this._blob(collar, M.accent, 'chest',
        [Math.sin(th) * 0.24, 0.66 - 0.05 * front, Math.cos(th) * 0.24], r, [1, 0.85, 1], 0.012);
    }
    this._blob(collar, M.accent, 'chest', [0, 0.55, 0.22], 0.1, [1, 0.9, 1], 0.012);
    for (const sx of [-1, 1]) this._blob(collar, M.accent, 'chest', [0.08 * sx, 0.58, 0.21], 0.09, [1, 0.9, 1], 0.012);

    // Хвост-облачко: цепочка суставов, кончик светлый.
    this.tailRoot = new THREE.Group();
    this.tailRoot.position.set(0, 0.17, -0.27);
    B.add(this.tailRoot);
    this.tailJoints = [];
    const segs = [
      [0.05, 0.02, -0.07, 0.085], [0.08, 0.08, -0.09, 0.12], [0.09, 0.12, -0.05, 0.15],
      [0.07, 0.13, 0.0, 0.17], [0.04, 0.12, 0.05, 0.165], [0.02, 0.09, 0.07, 0.13],
    ];
    let parent = this.tailRoot;
    segs.forEach(([dx, dy, dz, r], i) => {
      const j = new THREE.Group();
      j.position.set(dx, dy, dz);
      parent.add(j);
      this._blob(j, i >= 4 ? M.accent : M.body, 'tail', [0, 0, 0], r, [1, 1, 1], 0.014);
      this.tailJoints.push(j);
      parent = j;
    });

    // Голова.
    this.headPivot = new THREE.Group();
    this.headPivot.position.set(0, 0.7, 0);
    this.headPivot.rotation.order = 'YXZ';
    B.add(this.headPivot);
    const H = new THREE.Group();
    H.position.set(0, 0.27, 0.03);
    this.headPivot.add(H);
    this.head = H;

    this._blob(H, M.body, 'head', [0, 0, 0], 1, [0.44, 0.38, 0.4]);
    for (const sx of [-1, 1]) this._blob(H, M.body, 'head', [0.36 * sx, -0.13, 0.04], 0.12, [1, 0.8, 0.9]);
    this._blob(H, M.accent, 'nose', [0, -0.12, 0.29], 1, [0.15, 0.1, 0.11], 0.01);
    this.nose = this._blob(H, M.nose, 'nose', [0, -0.075, 0.39], 1, [0.035, 0.025, 0.022], 0);

    // Ротик: закрытый «ω» и открытый овал.
    this.mouthClosed = new THREE.Group();
    H.add(this.mouthClosed);
    for (const sx of [-1, 1]) {
      const arc = this._mesh(MOUTH_ARC, M.line, this.mouthClosed, { part: 'nose', pos: [0.022 * sx, -0.128, 0.399] });
      arc.rotation.z = Math.PI;
    }
    this.mouthOpen = this._blob(H, M.mouth, 'nose', [0, -0.15, 0.382], 1, [0.045, 0.05, 0.03], 0);
    this._blob(this.mouthOpen, M.tongue, 'nose', [0, -0.45, 0.35], 1, [0.65, 0.4, 0.6], 0);
    this.mouthOpen.visible = false;

    // Глазки: ориентируем по нормали поверхности головы.
    const R = [0.44, 0.38, 0.4];
    const onHead = (x, y, inset) => {
      const z = R[2] * Math.sqrt(Math.max(0, 1 - (x / R[0]) ** 2 - (y / R[1]) ** 2));
      const nrm = new THREE.Vector3(x / R[0] ** 2, y / R[1] ** 2, z / R[2] ** 2).normalize();
      const pos = new THREE.Vector3(x, y, z).addScaledVector(nrm, -inset);
      return { pos, nrm };
    };
    this.eyes = [];
    this.happyEyes = [];
    for (const sx of [-1, 1]) {
      const { pos, nrm } = onHead(0.165 * sx, 0, 0.012);
      const g = new THREE.Group();
      g.position.copy(pos);
      g.lookAt(pos.clone().add(nrm));
      H.add(g);
      const inner = new THREE.Group(); // масштабируется при моргании
      g.add(inner);
      this._blob(inner, M.eye, 'eye', [0, 0, 0], 1, [0.085, 0.11, 0.035], 0);
      this._blob(inner, M.iris, 'eye', [0, -0.025, 0.012], 1, [0.065, 0.075, 0.03], 0);
      this._blob(inner, M.pupil, 'eye', [0, -0.03, 0.02], 1, [0.038, 0.048, 0.025], 0);
      this._mesh(SPHERE_SMALL, M.shine, inner, { part: 'eye', pos: [-0.028, 0.04, 0.034], scale: [0.03, 0.034, 0.012] });
      this._mesh(SPHERE_SMALL, M.shine, inner, { part: 'eye', pos: [0.03, -0.045, 0.03], scale: [0.014, 0.014, 0.01] });
      this.eyes.push(inner);

      const happy = this._mesh(HAPPY_EYE, M.line, g, { part: 'eye', pos: [0, -0.02, 0.02] });
      happy.visible = false;
      this.happyEyes.push(happy);

      const ch = onHead(0.26 * sx, -0.1, 0.0);
      const blush = this._mesh(SPHERE_SMALL, M.blush, H, { part: 'cheek', pos: ch.pos.toArray(), scale: [0.065, 0.04, 0.012] });
      blush.lookAt(ch.pos.clone().add(ch.nrm));
      blush.renderOrder = 2;
    }

    // Большие ушки.
    this.ears = [];
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0.21 * sx, 0.24, -0.03);
      H.add(pivot);
      const part = sx < 0 ? 'earL' : 'earR';
      this._mesh(EAR, M.body, pivot, { part, scale: [1, 1.12, 0.42], outline: 0.014, ext: [0.17, 0.53, 0.17] });
      this._mesh(EAR, M.inner, pivot, { part, pos: [0, 0.05, 0.035], scale: [0.6, 0.78, 0.25] });
      pivot.userData.side = sx;
      this.ears.push(pivot);
    }
  }

  setPalette(pal) {
    const M = this.mats;
    M.body.color.set(pal.body);
    M.accent.color.set(pal.accent);
    M.inner.color.set(pal.inner);
    M.nose.color.set(pal.nose);
    M.iris.color.set(pal.iris);
    M.blush.color.set(pal.blush);
    const hsl = {};
    new THREE.Color(pal.body).getHSL(hsl);
    M.outline.color.setHSL(hsl.h, Math.min(1, hsl.s * 0.6 + 0.15), Math.max(0.18, hsl.l * 0.42));
  }

  // ----- события ----------------------------------------------------------

  on(fn) { this.listeners.push(fn); }
  emit(type, data) { for (const fn of this.listeners) fn(type, data); }

  kickEar(side, strength) {
    const s = this.earSpring[side < 0 ? 0 : 1];
    s.v += 14 * strength;
  }

  // ----- управление -------------------------------------------------------

  play(name, opts = {}) {
    const def = ACTIONS[name];
    if (!def) return false;
    const cur = this.action;
    if (cur && cur.def.react && def.react && !opts.force) {
      const p = cur.t / cur.def.dur;
      if (p < 0.5) return false; // не сбиваем реакцию на середине — иначе чих никогда не случится
    }
    const a = { def, name, t: 0, ...opts };
    this.action = a;
    def.start?.(this, a);
    return true;
  }

  react(part) {
    this.stop();
    if (part === 'earL' || part === 'earR') return this.play('earFlick', { side: part === 'earL' ? -1 : 1 });
    const name = REACTIONS[part];
    if (name) return this.play(name);
    return false;
  }

  static isPettable(part) { return PETTABLE.has(part); }

  /** Точка на зверьке в координатах заданного предка (для частиц). */
  pointIn(target, which) {
    const v = new THREE.Vector3();
    if (which === 'nose') this.nose.getWorldPosition(v);
    else if (which === 'head') this.head.localToWorld(v.set(0, 0.45, 0));
    else this.body.localToWorld(v.set(0, 0.65, 0.1));
    return target.worldToLocal(v);
  }

  // ----- кадр -------------------------------------------------------------

  update(dt) {
    this.t += dt;
    const t = this.t;

    const P = {
      scale: 1, jump: 0, squash: 0, bodyRoll: 0, bodyYaw: 0, bodyPitch: 0,
      headYaw: 0, headPitch: 0, headRoll: 0, earBack: 0, earUp: 0, legSwing: 0,
      tailAmp: 0.25, tailSpeed: 2.6, tailPuff: 1, eyes: 'open', mouth: 0, blush: 0.45,
    };

    // Текущее действие.
    if (this.action) {
      const a = this.action;
      a.t += dt;
      const p = a.t / a.def.dur;
      if (p >= 1) this.action = null;
      else a.def.run(this, p, P, a);
    }

    // Спонтанное поведение, когда никто не трогает.
    const busy = this.action || this.petting || this.talk > 0.02 || this.listening || this.turning || this.moving;
    if (!busy) {
      this.idleTimer -= dt;
      if (this.idleTimer <= 0) {
        this.idleTimer = rand(2.8, 6.5);
        let r = Math.random() * IDLE.reduce((s, [, w]) => s + w, 0);
        for (const [name, w] of IDLE) {
          if ((r -= w) > 0) continue;
          if (name !== 'wander') this.play(name);
          else {
            const p = this.pickWanderPoint?.();
            if (p) this.goTo(p, { run: Math.random() < 0.2 });
          }
          break;
        }
      }
    }
    if (this.petting || this.listening) this.stop();
    this._updateMove(dt, P);

    // Поглаживание.
    this.petLevel = damp(this.petLevel, this.petting ? 1 : 0, this.petting ? 4 : 2.5, dt);
    const pl = this.petLevel;
    if (pl > 0.01) {
      if (pl > 0.3) P.eyes = 'happy';
      P.earBack = Math.max(P.earBack, 0.65 * pl);
      P.headRoll += 0.13 * pl * Math.sin(t * 1.7);
      P.squash += -0.03 * pl;
      P.blush = Math.max(P.blush, 0.45 + 0.5 * pl);
      P.tailAmp = Math.max(P.tailAmp, 0.5 * pl);
      P.tailSpeed = Math.max(P.tailSpeed, 4);
    }

    // Слушает (Повторялка записывает голос).
    this.listenLevel = damp(this.listenLevel, this.listening ? 1 : 0, 6, dt);
    if (this.listenLevel > 0.01) {
      P.earUp += 0.7 * this.listenLevel;
      P.headRoll += 0.2 * this.listenLevel;
    }

    // Говорит (Повторялка проигрывает голос).
    if (this.talk > 0.01) {
      P.mouth = Math.max(P.mouth, clamp(this.talk * 1.3, 0, 1));
      P.headPitch += -0.06 * this.talk;
      P.jump += 0.015 * this.talk;
    }

    this._updateFacing(dt, P);
    this._updateLook(dt);
    this._updateBlink(dt);
    this._apply(P, dt);
  }

  _updateFacing(dt, P) {
    if (!this.faceTarget || !this.root.parent || this.moving) { this.turning = false; return; }
    const local = this.root.parent.worldToLocal(this.faceTarget.clone());
    const want = Math.atan2(local.x - this.root.position.x, local.z - this.root.position.z) + this.facingBias;
    const diff = angleDiff(want, this.root.rotation.y);
    const threshold = this.faceAfterMove ? 0.2 : 0.85;
    if (!this.turning && Math.abs(diff) > threshold && !this.action) this.turning = true;
    if (!this.turning && Math.abs(diff) <= threshold) this.faceAfterMove = false;
    if (this.turning) {
      const step = Math.sign(diff) * Math.min(Math.abs(diff), 2.6 * dt);
      this.root.rotation.y += step;
      P.jump += 0.035 * Math.abs(Math.sin(this.t * 15));
      P.tailAmp = Math.max(P.tailAmp, 0.5);
      if (Math.abs(diff) < 0.12) { this.turning = false; this.faceAfterMove = false; }
    }
  }

  _updateLook(dt) {
    const L = this.look;
    // На ходу смотрит туда, куда идёт.
    const target = this.moving && this.root.parent
      ? this.root.parent.localToWorld(this.move.target.clone().setY(0.8))
      : this.lookTarget.clone();
    const v = this.body.worldToLocal(target).sub(this.headPivot.position);
    let yaw = Math.atan2(v.x, v.z);
    let pitch = Math.atan2(v.y - 0.27, Math.hypot(v.x, v.z));
    // Маленькие «взгляды по сторонам», чтобы не смотрел как робот.
    L.sTimer -= dt;
    if (L.sTimer <= 0) {
      L.sTimer = rand(0.8, 2.6);
      L.sYaw = rand(-0.12, 0.12);
      L.sPitch = rand(-0.06, 0.06);
    }
    yaw = clamp(yaw + L.sYaw, -0.85, 0.85);
    pitch = clamp(pitch + L.sPitch, -0.45, 0.5);
    L.yaw = damp(L.yaw, yaw, 5, dt);
    L.pitch = damp(L.pitch, pitch, 5, dt);
  }

  _updateBlink(dt) {
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blinkLeft = 0.13;
      this.blinkTimer = Math.random() < 0.2 ? 0.25 : rand(1.8, 5);
    }
    if (this.blinkLeft > 0) this.blinkLeft -= dt;
  }

  _apply(P, dt) {
    const t = this.t;

    this.hop.scale.setScalar(P.scale);
    this.hop.position.y = P.jump;

    const sq = P.squash + Math.sin(t * 2.4) * 0.012; // дыхание
    this.body.scale.set(1 - sq * 0.5, 1 + sq, 1 - sq * 0.5);
    this.body.rotation.set(P.bodyPitch, P.bodyYaw, P.bodyRoll);

    // Лапки на ходу: передние качаются, задние семенят.
    this.frontLegs.forEach((leg, i) => { leg.rotation.x = (i ? 1 : -1) * P.legSwing; });
    this.backFeet.forEach((foot, i) => {
      foot.position.z = foot.userData.base.z + (i ? -1 : 1) * 0.06 * P.legSwing;
    });

    const L = this.look;
    this.headPivot.rotation.set(-L.pitch + P.headPitch, L.yaw + P.headYaw, P.headRoll);

    // Ушки: базовый наклон + поза + пружинка от подёргивания.
    this.ears.forEach((pivot, i) => {
      const s = this.earSpring[i];
      s.v += (-90 * s.a - 9 * s.v) * dt;
      s.a += s.v * dt;
      const side = pivot.userData.side;
      pivot.rotation.x = -0.1 - P.earBack * 0.75 + P.earUp * 0.3 + s.a * 0.15;
      pivot.rotation.z = -side * (0.32 + P.earBack * 0.35 - P.earUp * 0.12 + s.a * 0.25);
    });

    // Хвост виляет волной от основания к кончику.
    this.tailRoot.scale.setScalar(damp(this.tailRoot.scale.x, P.tailPuff, 10, dt));
    this._tailPhase = (this._tailPhase || 0) + dt * P.tailSpeed;
    this._tailAmp = damp(this._tailAmp ?? 0.25, P.tailAmp, 4, dt);
    this.tailJoints.forEach((j, i) => {
      j.rotation.z = this._tailAmp * 0.32 * Math.sin(this._tailPhase - i * 0.7) * (i === 0 ? 0.5 : 1);
    });
    this.tailJoints[0].rotation.y = this._tailAmp * 0.5 * Math.sin(this._tailPhase);

    // Глазки.
    let mode = P.eyes;
    if (this.blinkLeft > 0 && mode === 'open') mode = 'closed';
    const happy = mode === 'happy';
    const target = mode === 'closed' ? 0.08 : mode === 'squint' ? 0.45 : 1;
    this.eyeOpen = damp(this.eyeOpen, target, 28, dt);
    this.eyes.forEach((e) => { e.visible = !happy; e.scale.y = this.eyeOpen; });
    this.happyEyes.forEach((e) => { e.visible = happy; });

    // Ротик.
    const open = clamp(P.mouth, 0, 1);
    this.mouthOpen.visible = open > 0.06;
    this.mouthOpen.scale.y = 0.05 * Math.max(0.1, open);
    this.mouthClosed.visible = open < 0.3;

    this.mats.blush.opacity = clamp(0.25 + 0.5 * P.blush, 0, 0.95);
  }
}
