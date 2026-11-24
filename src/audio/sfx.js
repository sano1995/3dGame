// Все звуки синтезируются на лету через Web Audio: никаких файлов, работает без интернета.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.purr = null;
  }

  /** Браузер разрешает звук только после касания экрана. Зовём на каждом касании. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  tone({ f0 = 800, f1 = f0, dur = 0.15, type = 'sine', vol = 0.3, delay = 0, vib = 0, vibRate = 18, attack = 0.012 }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (vib) {
      const l = ctx.createOscillator();
      const lg = ctx.createGain();
      l.frequency.value = vibRate;
      lg.gain.value = vib;
      l.connect(lg).connect(o.frequency);
      l.start(t);
      l.stop(t + dur + 0.05);
    }
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  hiss({ dur = 0.2, vol = 0.3, type = 'bandpass', freq = 2000, f1 = freq, q = 1, delay = 0 }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  play(name) {
    if (!this.ctx) return;
    const T = (o) => this.tone(o);
    switch (name) {
      case 'appear':
        [660, 880, 1100, 1320].forEach((f, i) => T({ f0: f, f1: f * 1.05, dur: 0.14, vol: 0.18, delay: i * 0.08 }));
        this.hiss({ dur: 0.5, vol: 0.06, type: 'highpass', freq: 4000, f1: 8000 });
        break;
      case 'boing':
        T({ f0: 230, f1: 560, dur: 0.28, vol: 0.32, vib: 25, vibRate: 22 });
        break;
      case 'giggle':
        for (let i = 0; i < 6; i++) {
          T({ f0: 1150 - i * 45, f1: 880 - i * 45, dur: 0.075, type: 'triangle', vol: 0.24, delay: i * 0.105 });
        }
        break;
      case 'sneezeAh':
        T({ f0: 430, f1: 680, dur: 0.38, type: 'triangle', vol: 0.16, vib: 12 });
        T({ f0: 470, f1: 800, dur: 0.38, type: 'triangle', vol: 0.18, vib: 14, delay: 0.5 });
        break;
      case 'sneezeChoo':
        this.hiss({ dur: 0.24, vol: 0.5, freq: 3200, f1: 1800, q: 0.7 });
        T({ f0: 950, f1: 380, dur: 0.18, type: 'triangle', vol: 0.22 });
        break;
      case 'hmph':
        T({ f0: 430, f1: 330, dur: 0.12, type: 'triangle', vol: 0.26 });
        T({ f0: 370, f1: 260, dur: 0.17, type: 'triangle', vol: 0.26, delay: 0.16 });
        this.hiss({ dur: 0.2, vol: 0.08, type: 'lowpass', freq: 900, delay: 0.12 });
        break;
      case 'oops':
        T({ f0: 1150, f1: 620, dur: 0.22, type: 'triangle', vol: 0.28 });
        break;
      case 'pip':
        T({ f0: 1500, f1: 1950, dur: 0.07, vol: 0.22 });
        break;
      case 'brr':
        T({ f0: 190, f1: 150, dur: 0.6, type: 'sawtooth', vol: 0.07, vib: 40, vibRate: 32 });
        break;
      case 'yawn':
        T({ f0: 720, f1: 260, dur: 1.1, type: 'triangle', vol: 0.18, attack: 0.25, vib: 8, vibRate: 6 });
        break;
      case 'poof':
        this.hiss({ dur: 0.4, vol: 0.25, type: 'highpass', freq: 1500, f1: 6000 });
        [700, 940, 1250].forEach((f, i) => T({ f0: f, f1: f * 1.2, dur: 0.12, vol: 0.16, delay: 0.1 + i * 0.07 }));
        break;
      case 'purrChirp':
        T({ f0: 380, f1: 560, dur: 0.2, type: 'triangle', vol: 0.2, vib: 40, vibRate: 28 });
        break;
      case 'blush':
        T({ f0: 1250, f1: 1650, dur: 0.12, vol: 0.2 });
        T({ f0: 1550, f1: 1200, dur: 0.14, vol: 0.2, delay: 0.13 });
        break;
      case 'chirp':
        T({ f0: 520, f1: 920, dur: 0.22, type: 'triangle', vol: 0.18, vib: 30, vibRate: 24 });
        break;
      case 'tap':
        T({ f0: 900, f1: 1200, dur: 0.06, vol: 0.15 });
        break;
      default:
        break;
    }
  }

  /** Мурчание: громкость 0..1, плавно. */
  setPurr(level) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.purr) {
      if (level < 0.02) return;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 650;
      const am = ctx.createGain();
      am.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 23;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.5;
      lfo.connect(lfoGain).connect(am.gain);
      const out = ctx.createGain();
      out.gain.value = 0;
      src.connect(lp).connect(am).connect(out).connect(this.master);
      src.start();
      lfo.start();
      this.purr = out;
    }
    this.purr.gain.setTargetAtTime(level * 0.45, ctx.currentTime, 0.12);
  }
}
