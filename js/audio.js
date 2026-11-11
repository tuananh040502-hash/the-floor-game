/**
 * Âm thanh gameshow tổng hợp hoàn toàn bằng Web Audio API (không cần file mp3):
 *  - Nhạc nền đếm ngược dồn dập (nhịp tăng dần theo thời gian còn lại)
 *  - Ding! / Buzzer / còi kết thúc / còi hú / nhạc chiến thắng
 */
let ctx = null;
let master = null;
let noiseBuf = null;
let muted = false;
let sirenTimers = [];
let music = null;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
  }
  return ctx;
}

function noise() {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

/** Phát một nốt tại thời điểm tuyệt đối `t` (giây của AudioContext). */
function toneAt(t, { freq, type = 'sine', dur = 0.3, vol = 0.3, slideTo = null, detune = 0, lowpass = 0, attack = 0.012 }) {
  const c = ac();
  if (!c || muted) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.detune.value = detune;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(slideTo, 1), t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = osc;
  if (lowpass) {
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lowpass;
    node.connect(f);
    node = f;
  }
  node.connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function tone(opts) {
  const c = ac();
  if (!c) return;
  toneAt(c.currentTime + (opts.start || 0), opts);
}

function noiseAt(t, { dur = 0.05, vol = 0.2, hp = 6000, lp = 0 }) {
  const c = ac();
  if (!c || muted) return;
  const src = c.createBufferSource();
  src.buffer = noise();
  const f = c.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = hp;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f);
  let last = f;
  if (lp) {
    const l = c.createBiquadFilter();
    l.type = 'lowpass';
    l.frequency.value = lp;
    f.connect(l);
    last = l;
  }
  last.connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.05);
}

function kickAt(t, vol = 0.5) {
  toneAt(t, { freq: 160, slideTo: 42, type: 'sine', dur: 0.22, vol, attack: 0.004 });
}

// ---------- Nhạc nền đếm ngược ----------
const BASS = [55, 55, 65.41, 55, 73.42, 55, 65.41, 49];

function playMusicStep(step, t, stepDur, ms) {
  const urgent = ms <= 10000;
  const final = ms <= 5000;
  const s8 = step % 8;
  // Kick: mỗi phách, dồn dập hơn ở giai đoạn cuối
  if (s8 % 2 === 0 || (urgent && s8 % 2 === 1)) kickAt(t, urgent ? 0.55 : 0.42);
  // Hi-hat/tick
  noiseAt(t + (s8 % 2 ? 0 : stepDur * 0.5), { dur: 0.03, vol: urgent ? 0.16 : 0.09, hp: 7000 });
  // Bass lặp
  toneAt(t, { freq: BASS[s8] * (urgent ? 2 : 1), type: 'sawtooth', dur: stepDur * 0.9, vol: 0.13, lowpass: 380 + (1 - Math.min(ms, 60000) / 60000) * 900 });
  // Giai đoạn cuối: xung cao vút tăng dần
  if (urgent) {
    const k = 1 - ms / 10000; // 0 → 1
    toneAt(t, { freq: 880 + k * 900, type: 'square', dur: stepDur * 0.4, vol: 0.05 + k * 0.05 });
  }
  if (final && s8 % 4 === 0) {
    noiseAt(t, { dur: 0.25, vol: 0.12, hp: 2500 });
  }
}

function scheduleMusic(m) {
  const c = ctx;
  if (!c) return;
  while (m.next < c.currentTime + 0.18) {
    const ms = Math.max(0, m.getMs());
    const frac = 1 - Math.min(1, ms / 60000);
    let bpm = 84 + frac * 66; // 84 → 150 BPM theo thời gian
    if (ms <= 10000) bpm += (1 - ms / 10000) * 70; // nước rút: đến ~220 BPM
    const stepDur = 60 / bpm / 2; // nốt móc đơn
    playMusicStep(m.step, m.next, stepDur, ms);
    m.next += stepDur;
    m.step += 1;
  }
}

export const Sfx = {
  unlock() {
    const c = ac();
    if (c && c.state === 'suspended') c.resume();
    return !!c && c.state !== 'closed';
  },
  isUnlocked: () => !!ctx && ctx.state === 'running',
  setMuted(m) {
    muted = m;
    if (m) this.stopSiren();
  },
  isMuted: () => muted,

  /** Bắt đầu nhạc nền; getMs() trả về ms còn lại để điều chỉnh nhịp. */
  musicStart(getMs) {
    const c = ac();
    if (!c || music) return;
    music = { getMs, step: 0, next: c.currentTime + 0.05, timer: null };
    music.timer = setInterval(() => scheduleMusic(music), 40);
  },
  musicStop() {
    if (music) clearInterval(music.timer);
    music = null;
  },
  isMusicOn: () => !!music,

  /** "Ding!" trong trẻo */
  ding() {
    tone({ freq: 1318, dur: 1.0, vol: 0.34 });
    tone({ freq: 1976, start: 0.08, dur: 1.2, vol: 0.28 });
    tone({ freq: 2637, start: 0.08, dur: 0.7, vol: 0.12 });
    tone({ freq: 3951, start: 0.08, dur: 0.4, vol: 0.05 });
  },
  /** Buzzer trầm, giật (hai nhịp rung) */
  buzz() {
    const c = ac();
    if (!c) return;
    const t = c.currentTime;
    [0, 0.26].forEach((o) => {
      toneAt(t + o, { freq: 98, type: 'sawtooth', dur: 0.22, vol: 0.42, lowpass: 900 });
      toneAt(t + o, { freq: 104, type: 'square', dur: 0.22, vol: 0.22, lowpass: 700 });
      toneAt(t + o, { freq: 49, type: 'sawtooth', dur: 0.22, vol: 0.3 });
    });
    toneAt(t + 0.52, { freq: 92, type: 'sawtooth', dur: 0.5, vol: 0.4, lowpass: 800, slideTo: 70 });
    toneAt(t + 0.52, { freq: 46, type: 'sawtooth', dur: 0.5, vol: 0.3 });
  },
  tick() {
    tone({ freq: 1000, type: 'square', dur: 0.07, vol: 0.12 });
  },
  /** Nhịp đếm ngược chuẩn bị trận (sec = 10..1); 3-2-1 cao và dày hơn */
  countdownBeat(sec) {
    const c = ac();
    if (!c) return;
    const t = c.currentTime;
    if (sec <= 3) {
      const f = sec === 1 ? 880 : sec === 2 ? 740 : 659;
      kickAt(t, 0.45);
      toneAt(t, { freq: f, type: 'triangle', dur: 0.28, vol: 0.32 });
      toneAt(t, { freq: f * 2, type: 'sine', dur: 0.18, vol: 0.14 });
    } else {
      kickAt(t, 0.28);
      toneAt(t, { freq: 440, type: 'triangle', dur: 0.12, vol: 0.16 });
    }
  },
  click() {
    tone({ freq: 640, type: 'triangle', dur: 0.08, vol: 0.15 });
  },
  /** Tín hiệu GO! khi hết đếm ngược và bắt đầu chạy đồng hồ 60s */
  start() {
    const c = ac();
    if (!c) return;
    const t = c.currentTime;
    kickAt(t, 0.55);
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      toneAt(t + i * 0.055, { freq: f, type: 'triangle', dur: 0.45, vol: 0.26 });
    });
    toneAt(t + 0.18, { freq: 1567.98, type: 'sine', dur: 0.65, vol: 0.22 });
  },
  ready() {
    tone({ freq: 330, type: 'triangle', dur: 0.25, vol: 0.2 });
    tone({ freq: 495, type: 'triangle', start: 0.12, dur: 0.4, vol: 0.2 });
  },
  /** Còi kết thúc trận (air horn) */
  horn() {
    const c = ac();
    if (!c) return;
    const t = c.currentTime;
    [220, 277, 330].forEach((f, i) => {
      toneAt(t, { freq: f, type: 'sawtooth', dur: 1.5, vol: 0.2, detune: (i - 1) * 8, lowpass: 2200, attack: 0.03 });
      toneAt(t, { freq: f * 2, type: 'square', dur: 1.5, vol: 0.07, lowpass: 2600, attack: 0.03 });
    });
    noiseAt(t, { dur: 0.35, vol: 0.1, hp: 1500 });
  },
  /** Còi hú */
  siren(wails = 2, delay = 0) {
    this.stopSiren();
    const c = ac();
    if (!c || muted) return;
    for (let i = 0; i < wails; i++) {
      const id = setTimeout(() => {
        tone({ freq: 500, type: 'sawtooth', dur: 0.55, vol: 0.22, slideTo: 1100 });
        tone({ freq: 1100, type: 'sawtooth', start: 0.55, dur: 0.55, vol: 0.22, slideTo: 500 });
      }, delay + i * 1100);
      sirenTimers.push(id);
    }
  },
  stopSiren() {
    sirenTimers.forEach(clearTimeout);
    sirenTimers = [];
  },
  /** Nhạc chiến thắng hoành tráng: hợp âm + giai điệu + cymbal */
  fanfare(delay = 0) {
    const c = ac();
    if (!c) return;
    const t = c.currentTime + delay;
    const melody = [
      [523, 0], [659, 0.16], [784, 0.32], [1047, 0.5], [784, 0.74], [1047, 0.9], [1319, 1.1], [1568, 1.5],
    ];
    melody.forEach(([f, o], i) => {
      toneAt(t + o, { freq: f, type: 'triangle', dur: i === melody.length - 1 ? 1.8 : 0.4, vol: 0.28 });
      toneAt(t + o, { freq: f / 2, type: 'sawtooth', dur: i === melody.length - 1 ? 1.8 : 0.4, vol: 0.09, lowpass: 1400 });
    });
    // hợp âm cuối C major
    [262, 330, 392, 523, 659, 784].forEach((f) => {
      toneAt(t + 1.5, { freq: f, type: 'sawtooth', dur: 2.2, vol: 0.09, lowpass: 2000, attack: 0.02 });
    });
    kickAt(t + 1.5, 0.6);
    noiseAt(t + 1.5, { dur: 1.6, vol: 0.18, hp: 5000 });
    // trống roll dẫn vào hợp âm cuối
    for (let i = 0; i < 12; i++) noiseAt(t + 0.9 + i * 0.05, { dur: 0.05, vol: 0.05 + i * 0.01, hp: 3000 });
  },
  /** Chuỗi kết thúc: còi → còi hú → nhạc chiến thắng */
  finishSequence() {
    this.musicStop();
    this.horn();
    this.siren(2, 1300);
    this.fanfare(3.0);
  },
  boom() {
    tone({ freq: 160, type: 'sine', dur: 0.35, vol: 0.25, slideTo: 40 });
  },
};
