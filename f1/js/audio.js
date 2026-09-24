// WebAudio로 합성한 엔진음과 효과음 (샘플 파일 없음)

import { clamp } from './util.js';

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.8;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    // 노이즈 버퍼
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    this.engine = this.makeEngine(0.34);
    this.others = this.makeEngine(0.0);

    const mkNoise = (type, freq, q) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      src.start();
      return { src, f, g };
    };
    this.wind = mkNoise('lowpass', 700, 0.5);
    this.squeal = mkNoise('bandpass', 1500, 6);
    this.rumble = mkNoise('lowpass', 180, 1);
  }

  makeEngine(level) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = level;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 2.2);
    }
    shaper.curve = curve;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    lp.Q.value = 2.5;
    const mix = ctx.createGain();
    mix.gain.value = 0.5;
    const oscs = [
      ['sawtooth', 1, 0.5],
      ['square', 0.5, 0.35],
      ['sawtooth', 2, 0.18],
      ['triangle', 3, 0.1],
    ].map(([type, mult, gain]) => {
      const o = ctx.createOscillator();
      o.type = type;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(mix);
      o.start();
      return { o, mult };
    });
    mix.connect(shaper).connect(lp).connect(out).connect(this.master);
    return { out, lp, oscs, level };
  }

  setEngine(e, rpm, load, level) {
    const t = this.ctx.currentTime;
    // V6 4행정: 점화 주파수 = rpm/60*3
    const f = (rpm / 60) * 3 * 0.5;
    for (const { o, mult } of e.oscs) o.frequency.setTargetAtTime(f * mult, t, 0.03);
    e.lp.frequency.setTargetAtTime(900 + load * 3200 + rpm * 0.1, t, 0.05);
    e.out.gain.setTargetAtTime(level, t, 0.05);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  // 매 프레임: 플레이어 차량과 주변 차량
  update(S, player, running) {
    if (!this.ctx || !this.engine) return;
    const t = this.ctx.currentTime;
    if (!running || !player) {
      this.engine.out.gain.setTargetAtTime(0, t, 0.1);
      this.others.out.gain.setTargetAtTime(0, t, 0.1);
      this.wind.g.gain.setTargetAtTime(0, t, 0.1);
      this.squeal.g.gain.setTargetAtTime(0, t, 0.1);
      this.rumble.g.gain.setTargetAtTime(0, t, 0.1);
      return;
    }
    const rev = player.revving ? 6000 + player.revving * 5500 + Math.random() * 400 : 0;
    const rpm = Math.max(player.rpm, rev);
    const load = Math.max(player.throttle, player.revving || 0);
    this.setEngine(this.engine, rpm, load, 0.16 + load * 0.2);
    const v = Math.abs(player.v);
    this.wind.g.gain.setTargetAtTime(clamp(v / 90, 0, 1) * 0.1, t, 0.1);
    this.squeal.g.gain.setTargetAtTime(player.sliding > 0.1 && v > 8 ? 0.05 + player.sliding * 0.1 : 0, t, 0.05);
    this.rumble.g.gain.setTargetAtTime(player.surface >= 1 && v > 5 ? (player.surface === 1 ? 0.25 : 0.4) : 0, t, 0.04);
    this.rumble.f.frequency.setTargetAtTime(player.surface === 1 ? 90 + v : 220, t, 0.05);

    // 가장 가까운 상대 차량
    let best = null;
    let bd = 1e9;
    for (const c of S.cars) {
      if (c === player) continue;
      const d = Math.hypot(c.x - player.x, c.z - player.z);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    if (best && bd < 120) {
      const lvl = clamp(1 - bd / 120, 0, 1) ** 2 * 0.22;
      this.setEngine(this.others, best.rpm * (1 + (best.v - player.v) * 0.002), 0.8, lvl);
    } else this.others.out.gain.setTargetAtTime(0, t, 0.1);
  }

  beep(freq = 880, dur = 0.12, vol = 0.25, type = 'sine') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  thud(strength = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500 + strength * 400;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(clamp(0.2 + strength * 0.15, 0, 0.8), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.4);
  }

  shift() {
    if (!this.ctx || !this.engine) return;
    const t = this.ctx.currentTime;
    const g = this.engine.out.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value * 0.35, t);
    g.linearRampToValueAtTime(g.value, t + 0.07);
  }
}
