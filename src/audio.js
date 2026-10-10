// 全程序化音频：风声、雨声、氛围长音、振翅、光环、雷声……没有任何音频文件
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.brownBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const b = this.brownBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      b[i] = last * 3.5;
    }

    // 风
    this.windFilter = this._filter('bandpass', 450, 0.6);
    this.windGain = this._gain(0);
    this._loop(this.noiseBuf).connect(this.windFilter);
    this.windFilter.connect(this.windGain).connect(this.master);
    // 风暴低吼
    this.howlFilter = this._filter('lowpass', 260, 1.2);
    this.howlGain = this._gain(0);
    this._loop(this.brownBuf).connect(this.howlFilter);
    this.howlFilter.connect(this.howlGain).connect(this.master);
    // 雨
    const hp = this._filter('highpass', 1200, 0.5);
    const lp = this._filter('lowpass', 7000, 0.5);
    this.rainGain = this._gain(0);
    this._loop(this.noiseBuf).connect(hp);
    hp.connect(lp).connect(this.rainGain).connect(this.master);
    // 氛围长音
    this.padFilter = this._filter('lowpass', 800, 0.5);
    this.padGain = this._gain(0);
    [146.83, 220, 293.66, 329.63, 440].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = i % 2 ? 'triangle' : 'sine';
      o.frequency.value = f;
      o.detune.value = (i - 2) * 4;
      const g = this._gain(0.18 / (1 + i * 0.3));
      o.connect(g).connect(this.padFilter);
      o.start();
    });
    this.padFilter.connect(this.padGain).connect(this.master);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoGain = this._gain(350);
    lfo.connect(lfoGain).connect(this.padFilter.frequency);
    lfo.start();
    this.ready = true;
  }

  _gain(v) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }
  _filter(type, f, q) {
    const n = this.ctx.createBiquadFilter();
    n.type = type;
    n.frequency.value = f;
    n.Q.value = q;
    return n;
  }
  _loop(buf) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start();
    return s;
  }
  _env(g, t, attack, peak, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }
  _noiseShot(buf, filterType, freq, q, t, attack, peak, decay) {
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this._filter(filterType, freq, q);
    const g = this._gain(0);
    src.connect(f).connect(g).connect(this.master);
    this._env(g, t, attack, peak, decay);
    src.start(t, Math.random() * 1.0, attack + decay + 0.1);
    return f;
  }
  _tone(type, f0, f1, t, attack, peak, decay) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + attack + decay);
    const g = this._gain(0);
    o.connect(g).connect(this.master);
    this._env(g, t, attack, peak, decay);
    o.start(t);
    o.stop(t + attack + decay + 0.1);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  update(speedNorm, storm, inFlight) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const k = inFlight ? 1 : 0.55;
    this.windGain.gain.setTargetAtTime((0.04 + speedNorm * 0.24 + storm * 0.16) * k, t, 0.2);
    this.windFilter.frequency.setTargetAtTime(300 + speedNorm * 1100 + storm * 200, t, 0.3);
    this.howlGain.gain.setTargetAtTime(storm * 0.4, t, 0.6);
    this.rainGain.gain.setTargetAtTime(storm * storm * 0.2, t, 0.5);
    this.padGain.gain.setTargetAtTime(0.06 * (1 - storm * 0.6), t, 1.0);
  }

  flap(power) {
    if (!this.ready) return;
    this._noiseShot(this.brownBuf, 'lowpass', 320, 0.8, this.ctx.currentTime, 0.03, 0.35 * power, 0.22);
  }

  chime(n) {
    if (!this.ready) return;
    const notes = [659.25, 739.99, 880, 987.77, 1108.73, 1318.51];
    const f = notes[n % notes.length];
    const t = this.ctx.currentTime;
    [1, 1.5, 2].forEach((m, k) => this._tone('sine', f * m, f * m, t + k * 0.045, 0.01, 0.12 / (k + 1), 1.1));
    this._tone('triangle', f * 4, f * 4, t, 0.005, 0.03, 0.4);
  }

  lapChime() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    [587.33, 739.99, 880, 1174.66].forEach((f, i) => this._tone('sine', f, f, t + i * 0.09, 0.01, 0.13, 1.4));
  }

  fanfare() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    [440, 554.37, 659.25, 880, 1108.73, 1318.51].forEach((f, i) => {
      this._tone('triangle', f, f, t + i * 0.11, 0.02, 0.12, 1.8);
      this._tone('sine', f / 2, f / 2, t + i * 0.11, 0.02, 0.08, 2.2);
    });
  }

  beep(high) {
    if (!this.ready) return;
    const f = high ? 880 : 440;
    this._tone('sine', f, f, this.ctx.currentTime, 0.01, 0.2, high ? 0.6 : 0.25);
  }

  thunder(dist) {
    if (!this.ready) return;
    const delay = Math.min(3, dist / 600);
    const vol = clamp(1.4 - dist / 900, 0.15, 1.2);
    const t = this.ctx.currentTime + delay;
    const f = this._noiseShot(this.brownBuf, 'lowpass', 900, 0.7, t, 0.05 + dist / 4000, vol, 3.2 + Math.random());
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(110, t + 2.5);
    this._tone('sine', 55, 32, t, 0.1, vol * 0.4, 2.5);
    if (dist < 260) this._noiseShot(this.noiseBuf, 'highpass', 1500, 0.5, t, 0.005, 0.6, 0.18);
  }

  charge() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._tone('sawtooth', 120, 900, t, 0.8, 0.07, 0.25);
    this._noiseShot(this.noiseBuf, 'bandpass', 3000, 2, t, 0.6, 0.12, 0.3);
  }

  zap() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._tone('sawtooth', 1800, 120, t, 0.005, 0.35, 0.45);
    this._noiseShot(this.noiseBuf, 'highpass', 900, 0.5, t, 0.005, 0.8, 0.35);
  }

  hit(strength) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._tone('sine', 110, 40, t, 0.005, 0.5 * strength, 0.35);
    this._noiseShot(this.brownBuf, 'lowpass', 400, 0.7, t, 0.005, 0.6 * strength, 0.4);
  }

  gust() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const f = this._noiseShot(this.noiseBuf, 'bandpass', 300, 1.2, t, 0.6, 0.35, 1.4);
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(1300, t + 0.7);
    f.frequency.exponentialRampToValueAtTime(400, t + 2.0);
  }

  whoosh() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const f = this._noiseShot(this.noiseBuf, 'bandpass', 500, 1.5, t, 0.15, 0.25, 0.5);
    f.frequency.setValueAtTime(500, t);
    f.frequency.exponentialRampToValueAtTime(2200, t + 0.5);
  }
}
