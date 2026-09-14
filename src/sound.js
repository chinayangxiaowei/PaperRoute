/**
 * 音效模块 —— 对齐原作 paperroute.lol 的声音设计：
 *  - 大部分音效是 WebAudio 实时合成的（振荡器 + 噪声，参数 1:1 取自原作脚本）
 *  - 玻璃碎裂是采样 /audio/glass-breaking.mp3（音量 0.2）
 * 浏览器自动播放限制：必须在用户手势里调用 unlock()。
 */

//  MIDI 音高 → 频率（与原作相同）
const f_ = (m) => 440 * 2 ** ((m - 69) / 12);
// 原作简写：p_(midi, delay, duration, volume = .15, type = 'square')
const p_ = (m, t, d, v = 0.15, type = 'square') =>
  ({ frequency: f_(m), delay: t, duration: d, volume: v, type });

// 原作各种音效的合成参数（throw/delivery/miss/pickup/crash/bark/warning/splash）
const VOICES = {
  throw: [
    { noise: true, delay: 0, duration: 0.24, volume: 0.25, attack: 0.035, filter: 'bandpass', cutoff: 700, endCutoff: 4100 },
    { frequency: 330, endFrequency: 120, duration: 0.15, volume: 0.05, type: 'triangle', delay: 0.025 },
  ],
  delivery: [p_(60, 0, 0.11, 0.18, 'triangle'), p_(72, 0.075, 0.13), p_(79, 0.14, 0.24, 0.12), p_(76, 0.14, 0.22, 0.055, 'triangle')],
  miss: [p_(54, 0, 0.13, 0.105), p_(49, 0.115, 0.21, 0.09), p_(48, 0.12, 0.19, 0.035, 'triangle')],
  pickup: [p_(72, 0, 0.12, 0.1), p_(76, 0.07, 0.13, 0.1), p_(79, 0.14, 0.2, 0.11)],
  crash: [
    { noise: true, delay: 0, duration: 0.27, volume: 0.24, cutoff: 1200 },
    { frequency: 150, endFrequency: 38, duration: 0.4, volume: 0.2, type: 'triangle', delay: 0 },
  ],
  bark: [0, 0.17].map((d) => ({ frequency: 180, endFrequency: 85, delay: d, duration: 0.13, volume: 0.095, type: 'sawtooth', cutoff: 850 })),
  warning: [p_(67, 0, 0.09, 0.07, 'triangle'), p_(64, 0.12, 0.11, 0.06, 'triangle')],
  splash: [{ noise: true, delay: 0, duration: 0.37, volume: 0.16, filter: 'bandpass', cutoff: 1800, endCutoff: 350 }],
};

const GLASS_URL = '/audio/glass-breaking.mp3';
const GLASS_VOL = 0.2;

export class SoundFX {
  constructor() {
    this.ctx = null;
    this.glassBuf = null;
    this.lastPlay = new Map(); // kind → 时间，原作同款 70ms 去抖
  }

  /** 在用户手势（开始按钮）里调用：建 AudioContext + 预取玻璃采样 */
  unlock() {
    if (this.ctx) { this.ctx.resume().catch(() => {}); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.ctx.resume().catch(() => {});
      fetch(GLASS_URL)
        .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
        .then((b) => this.ctx.decodeAudioData(b))
        .then((buf) => { this.glassBuf = buf; })
        .catch(() => {}); // 采样缺失时静默降级（玻璃音跳过）
    } catch { this.ctx = null; }
  }

  play(kind) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (now - (this.lastPlay.get(kind) ?? -Infinity) < 0.07) return;
    this.lastPlay.set(kind, now);

    if (kind === 'glass') {
      if (!this.glassBuf) return;
      const src = ctx.createBufferSource();
      src.buffer = this.glassBuf;
      const g = ctx.createGain();
      g.gain.value = GLASS_VOL;
      src.connect(g).connect(ctx.destination);
      src.start(now);
      return;
    }
    for (const v of VOICES[kind] || []) this._voice(v, now + (v.delay ?? 0));
  }

  /** 单个合成声部：振荡器或噪声 + 可选滤波扫频 + 音量包络 */
  _voice(v, at) {
    const ctx = this.ctx;
    const dur = v.duration;
    let src;
    if (v.noise) {
      const len = Math.max(1, Math.ceil(ctx.sampleRate * dur));
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      src = ctx.createBufferSource();
      src.buffer = buf;
    } else {
      src = ctx.createOscillator();
      src.type = v.type || 'square';
      src.frequency.setValueAtTime(v.frequency, at);
      if (v.endFrequency) src.frequency.exponentialRampToValueAtTime(Math.max(1, v.endFrequency), at + dur);
    }

    let node = src;
    if (v.cutoff) {
      const flt = ctx.createBiquadFilter();
      flt.type = v.filter || 'lowpass';
      flt.frequency.setValueAtTime(v.cutoff, at);
      if (v.endCutoff) flt.frequency.exponentialRampToValueAtTime(Math.max(10, v.endCutoff), at + dur);
      node.connect(flt);
      node = flt;
    }

    const g = ctx.createGain();
    const atk = v.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, v.volume), at + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    node.connect(g).connect(ctx.destination);

    src.start(at);
    src.stop(at + dur + 0.05);
  }
}
