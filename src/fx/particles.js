import * as THREE from 'three';

function canvasTexture(draw, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function heartPath(g, s) {
  g.beginPath();
  g.moveTo(s * 0.5, s * 0.86);
  g.bezierCurveTo(s * 0.1, s * 0.6, s * 0.02, s * 0.32, s * 0.24, s * 0.2);
  g.bezierCurveTo(s * 0.38, s * 0.12, s * 0.48, s * 0.22, s * 0.5, s * 0.32);
  g.bezierCurveTo(s * 0.52, s * 0.22, s * 0.62, s * 0.12, s * 0.76, s * 0.2);
  g.bezierCurveTo(s * 0.98, s * 0.32, s * 0.9, s * 0.6, s * 0.5, s * 0.86);
  g.closePath();
}

const TEXTURES = {
  heart: () => canvasTexture((g, s) => {
    heartPath(g, s);
    g.fillStyle = '#ff6fa6';
    g.fill();
    g.lineWidth = s * 0.06;
    g.strokeStyle = '#ffffff';
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.beginPath();
    g.ellipse(s * 0.3, s * 0.33, s * 0.07, s * 0.045, -0.6, 0, Math.PI * 2);
    g.fill();
  }),
  star: () => canvasTexture((g, s) => {
    const c = s / 2;
    const grad = g.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0, 'rgba(255,255,240,1)');
    grad.addColorStop(0.25, 'rgba(255,236,150,0.9)');
    grad.addColorStop(1, 'rgba(255,220,120,0)');
    g.fillStyle = grad;
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const r = i % 2 === 0 ? c : c * 0.22;
      g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
  }),
  puff: () => canvasTexture((g, s) => {
    const c = s / 2;
    const grad = g.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.6)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  }),
};

const rand = (a, b) => a + Math.random() * (b - a);

export class Particles {
  constructor(parent) {
    this.parent = parent;
    this.tex = {};
    this.live = [];
    this.pool = [];
  }

  _sprite(kind) {
    if (!this.tex[kind]) this.tex[kind] = TEXTURES[kind]();
    let s = this.pool.pop();
    if (!s) {
      s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
      s.renderOrder = 5;
    }
    s.material.map = this.tex[kind];
    s.material.rotation = 0;
    s.material.opacity = 1;
    s.material.needsUpdate = true;
    s.visible = true;
    this.parent.add(s);
    return s;
  }

  /** pos — в координатах parent; dir — направление выброса (для чиха). */
  spawn(kind, pos, n = 1, dir = null) {
    for (let i = 0; i < n; i++) {
      const s = this._sprite(kind);
      s.position.copy(pos);
      const p = { s, kind, age: 0, vel: new THREE.Vector3(), spin: 0, size: 0.15, life: 1 };
      if (kind === 'heart') {
        s.position.x += rand(-0.15, 0.15);
        p.vel.set(rand(-0.12, 0.12), rand(0.45, 0.7), rand(-0.05, 0.05));
        p.life = rand(1.2, 1.6);
        p.size = rand(0.13, 0.19);
        p.wobble = rand(0, 6);
      } else if (kind === 'star') {
        const a = rand(0, Math.PI * 2);
        const e = rand(-0.4, 1);
        const sp = rand(0.5, 1.1);
        p.vel.set(Math.cos(a) * sp, e * sp, Math.sin(a) * sp);
        p.life = rand(0.5, 0.9);
        p.size = rand(0.08, 0.15);
        p.spin = rand(-6, 6);
      } else if (kind === 'puff') {
        const d = dir ? dir.clone() : new THREE.Vector3(0, 0, 1);
        d.x += rand(-0.35, 0.35);
        d.y += rand(-0.2, 0.3);
        p.vel.copy(d.normalize().multiplyScalar(rand(0.7, 1.3)));
        p.life = rand(0.45, 0.7);
        p.size = rand(0.05, 0.09);
      }
      s.scale.setScalar(0.001);
      this.live.push(p);
    }
  }

  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.age += dt;
      const k = p.age / p.life;
      const s = p.s;
      if (k >= 1) {
        s.visible = false;
        this.parent.remove(s);
        this.pool.push(s);
        this.live.splice(i, 1);
        continue;
      }
      s.position.addScaledVector(p.vel, dt);
      if (p.kind === 'heart') {
        s.position.x += Math.sin(p.age * 5 + p.wobble) * 0.15 * dt;
        s.scale.setScalar(p.size * Math.min(1, k * 6));
        s.material.opacity = k > 0.7 ? (1 - k) / 0.3 : 1;
      } else if (p.kind === 'star') {
        p.vel.multiplyScalar(1 - 2.5 * dt);
        s.material.rotation += p.spin * dt;
        s.scale.setScalar(p.size * Math.sin(Math.PI * k));
      } else {
        p.vel.multiplyScalar(1 - 3 * dt);
        s.scale.setScalar(p.size * (1 + k * 2.5));
        s.material.opacity = 1 - k;
      }
    }
  }
}
