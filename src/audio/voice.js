// «Повторялка»: слушаем микрофон, ловим фразу и проигрываем её тонким голоском.
// Запись живёт только в памяти и сразу забывается. Никуда не сохраняется и не отправляется.

const CHUNK = 2048;
const RATE = 1.6; // во сколько раз выше и быстрее голос зверька
const MAX_SEC = 6;

export class VoiceEcho {
  constructor(sfx) {
    this.sfx = sfx;
    this.state = 'off'; // off | idle | recording | playing
    this.inputLevel = 0;
    this.playLevel = 0;
    this.cooldownUntil = 0;
    this.onState = null;
  }

  get enabled() { return this.state !== 'off'; }

  async enable() {
    this.sfx.unlock();
    const ctx = this.sfx.ctx;
    if (!ctx || !navigator.mediaDevices?.getUserMedia) throw new Error('no-audio');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.src = ctx.createMediaStreamSource(this.stream);
    // ScriptProcessor устарел, но работает везде и не требует отдельного файла-воркера.
    this.proc = ctx.createScriptProcessor(CHUNK, 1, 1);
    this.sink = ctx.createGain();
    this.sink.gain.value = 0;
    this.src.connect(this.proc);
    this.proc.connect(this.sink).connect(ctx.destination);
    this.proc.onaudioprocess = (e) => this._chunk(e.inputBuffer.getChannelData(0));

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.connect(ctx.destination);
    this.abuf = new Float32Array(this.analyser.fftSize);

    this.chunkSec = CHUNK / ctx.sampleRate;
    this.floor = 0.01;
    this.pre = [];
    this.rec = [];
    this._set('idle');
  }

  disable() {
    this.stream?.getTracks().forEach((t) => t.stop());
    try { this.src?.disconnect(); this.proc?.disconnect(); this.sink?.disconnect(); } catch { /* уже отключено */ }
    if (this.proc) this.proc.onaudioprocess = null;
    this.rec = [];
    this.pre = [];
    this.inputLevel = 0;
    this._set('off');
  }

  _set(s) {
    if (this.state === s) return;
    this.state = s;
    this.onState?.(s);
  }

  _chunk(d) {
    let s = 0;
    for (let i = 0; i < d.length; i++) s += d[i] * d[i];
    const rms = Math.sqrt(s / d.length);
    this.inputLevel = rms;
    if (this.state === 'playing' || this.state === 'off' || performance.now() < this.cooldownUntil) return;

    const copy = new Float32Array(d);
    const startTh = Math.max(0.025, this.floor * 3.5);
    const stopTh = Math.max(0.014, this.floor * 2.2);

    if (this.state === 'idle') {
      this.floor = this.floor * 0.97 + Math.min(rms, 0.05) * 0.03; // подстраиваемся под шум комнаты
      this.pre.push(copy);
      if (this.pre.length > 4) this.pre.shift();
      if (rms > startTh) {
        this.rec = this.pre;
        this.pre = [];
        this.silence = 0;
        this.voiced = 0;
        this._set('recording');
      }
    } else if (this.state === 'recording') {
      this.rec.push(copy);
      if (rms < stopTh) this.silence += this.chunkSec;
      else { this.silence = 0; this.voiced += this.chunkSec; }
      if (this.silence > 0.7 || this.rec.length * this.chunkSec > MAX_SEC) this._finish();
    }
  }

  _finish() {
    const ctx = this.sfx.ctx;
    if (this.voiced < 0.2) { this.rec = []; this._set('idle'); return; }

    const dropTail = Math.floor(Math.max(0, this.silence - 0.15) / this.chunkSec);
    const chunks = this.rec.slice(0, Math.max(1, this.rec.length - dropTail));
    this.rec = [];
    const buf = ctx.createBuffer(1, chunks.length * CHUNK, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    chunks.forEach((c, i) => ch.set(c, i * CHUNK));
    let peak = 0;
    for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
    const k = peak > 0 ? Math.min(5, 0.9 / peak) : 1;
    for (let i = 0; i < ch.length; i++) ch[i] *= k;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = RATE;
    src.connect(this.analyser);
    src.onended = () => {
      this.playLevel = 0;
      this.cooldownUntil = performance.now() + 450; // чтобы не услышать самого себя
      if (this.state === 'playing') this._set('idle');
    };
    this._set('playing');
    src.start();
  }

  /** Громкость проигрываемого голоса для анимации ротика. */
  update() {
    if (this.state !== 'playing' || !this.analyser) { this.playLevel = 0; return; }
    this.analyser.getFloatTimeDomainData(this.abuf);
    let s = 0;
    for (let i = 0; i < this.abuf.length; i++) s += this.abuf[i] * this.abuf[i];
    this.playLevel = Math.min(1, Math.sqrt(s / this.abuf.length) * 4);
  }
}
