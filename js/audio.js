/**
 * Âm thanh gameshow tổng hợp bằng Web Audio API + Bộ phát Nhạc chiến thắng tùy chỉnh (Custom Victory Audio):
 *  - Nhạc nền đếm ngược dồn dập (nhịp tăng dần theo thời gian còn lại)
 *  - Ding! / Buzzer / còi kết thúc / còi hú / nhạc chiến thắng mặc định (WebAudio fallback)
 *  - Pre-buffer 0ms cho nhạc chiến thắng tùy chỉnh: Direct Audio (.mp3/.wav/Google Drive), YouTube IFrame API (1x1 ẩn), SoundCloud Widget API.
 */
import { parseVictoryAudio } from './topics.js';

let ctx = null;
let master = null;
let noiseBuf = null;
let muted = false;
let sirenTimers = [];
let music = null;

// Trạng thái nhạc chiến thắng tùy chỉnh
window.isVictoryAudioReady = false;
const victoryListeners = new Set();
const victory = {
  rawUrl: '',
  parsed: null,
  status: 'idle', // idle | loading | ready | error
  playing: false,
  usingFallback: false,
  audioEl: null,
  ytPlayer: null,
  ytReady: false,
  ytPendingVideoId: null,
  scWidget: null,
  scIframe: null,
};

function notifyVictory() {
  window.isVictoryAudioReady = victory.status === 'ready';
  victoryListeners.forEach((cb) => cb(getVictoryState()));
}

export function onVictoryAudioChange(cb) {
  victoryListeners.add(cb);
  return () => victoryListeners.delete(cb);
}

export function getVictoryState() {
  return {
    hasCustom: !!victory.parsed,
    kind: victory.parsed ? victory.parsed.kind : 'default',
    rawUrl: victory.rawUrl,
    status: victory.status,
    ready: victory.status === 'ready',
    playing: victory.playing,
    usingFallback: victory.usingFallback,
  };
}

// ---------- Vùng chứa ẩn 1x1 cho YouTube / SoundCloud ----------
function ensureHiddenHost() {
  let box = document.getElementById('__victoryMediaHost');
  if (!box) {
    box = document.createElement('div');
    box.id = '__victoryMediaHost';
    box.style.cssText = 'position:fixed;left:-9999px;bottom:0;width:1px;height:1px;opacity:0.001;pointer-events:none;overflow:hidden;z-index:-1;';
    document.body.appendChild(box);
  }
  return box;
}

// ---------- Nạp SDK YouTube IFrame API ----------
let ytApiPromise = null;
function loadYouTubeApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    const timer = setTimeout(() => reject(new Error('YouTube API timeout')), 12000);
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timer);
      if (typeof prev === 'function') prev();
      resolve(window.YT);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => {
      clearTimeout(timer);
      ytApiPromise = null;
      reject(new Error('Không tải được YouTube IFrame API'));
    };
    document.head.appendChild(s);
  });
  return ytApiPromise;
}

// ---------- Nạp SDK SoundCloud Widget API ----------
let scApiPromise = null;
function loadSoundCloudApi() {
  if (window.SC && window.SC.Widget) return Promise.resolve(window.SC);
  if (scApiPromise) return scApiPromise;
  scApiPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SoundCloud API timeout')), 12000);
    const s = document.createElement('script');
    s.src = 'https://w.soundcloud.com/player/api.js';
    s.async = true;
    s.onload = () => {
      clearTimeout(timer);
      if (window.SC && window.SC.Widget) resolve(window.SC);
      else reject(new Error('SoundCloud Widget không khả dụng'));
    };
    s.onerror = () => {
      clearTimeout(timer);
      scApiPromise = null;
      reject(new Error('Không tải được SoundCloud Widget API'));
    };
    document.head.appendChild(s);
  });
  return scApiPromise;
}

function stopCustomMedia() {
  victory.playing = false;
  if (victory.audioEl) {
    try {
      victory.audioEl.pause();
      victory.audioEl.currentTime = 0;
    } catch { /* ignore */ }
  }
  if (victory.ytPlayer && victory.ytReady) {
    try {
      victory.ytPlayer.pauseVideo();
    } catch { /* ignore */ }
  }
  if (victory.scWidget) {
    try {
      victory.scWidget.pause();
    } catch { /* ignore */ }
  }
}

/**
 * Preload chống trễ cho nhạc chiến thắng của chủ đề.
 * Gọi ngay khi chọn chủ đề, vào phòng chờ (ready) hoặc bắt đầu đếm ngược (countdown).
 */
async function preloadVictoryAudio(rawUrl) {
  const parsed = parseVictoryAudio(rawUrl);
  const nextRaw = parsed ? parsed.raw : '';

  if (nextRaw === victory.rawUrl && (victory.status === 'ready' || victory.status === 'loading')) {
    return;
  }

  stopCustomMedia();
  victory.rawUrl = nextRaw;
  victory.parsed = parsed;
  victory.usingFallback = false;

  if (!parsed) {
    victory.status = 'idle';
    notifyVictory();
    return;
  }

  victory.status = 'loading';
  notifyVictory();

  // 1. File âm thanh trực tiếp (.mp3, .wav, Google Drive audio)
  if (parsed.kind === 'direct') {
    const candidates = [parsed.playUrl];
    if (parsed.driveId) {
      candidates.push(
        `https://drive.google.com/uc?export=download&id=${parsed.driveId}`,
        `https://lh3.googleusercontent.com/d/${parsed.driveId}`,
      );
    }
    let idx = 0;
    const tryLoad = () => {
      if (victory.rawUrl !== nextRaw) return;
      const src = candidates[idx];
      const a = new Audio();
      a.preload = 'auto';
      a.crossOrigin = 'anonymous';
      a.volume = muted ? 0 : 1;
      let settled = false;
      const done = (ok) => {
        if (settled || victory.rawUrl !== nextRaw) return;
        settled = true;
        if (ok) {
          victory.audioEl = a;
          victory.status = 'ready';
          notifyVictory();
        } else if (idx + 1 < candidates.length) {
          idx += 1;
          tryLoad();
        } else {
          // Thử lại không có crossOrigin (một số CDN/Drive redirect chặn CORS nhưng vẫn phát được qua HTMLAudioElement)
          const fallbackAudio = new Audio();
          fallbackAudio.preload = 'auto';
          fallbackAudio.volume = muted ? 0 : 1;
          fallbackAudio.oncanplaythrough = () => {
            if (victory.rawUrl !== nextRaw) return;
            victory.audioEl = fallbackAudio;
            victory.status = 'ready';
            notifyVictory();
          };
          fallbackAudio.onloadeddata = () => {
            if (victory.rawUrl !== nextRaw || victory.status === 'ready') return;
            victory.audioEl = fallbackAudio;
            victory.status = 'ready';
            notifyVictory();
          };
          fallbackAudio.onerror = () => {
            if (victory.rawUrl !== nextRaw) return;
            victory.status = 'error';
            notifyVictory();
          };
          fallbackAudio.onended = () => {
            victory.playing = false;
            notifyVictory();
          };
          fallbackAudio.src = parsed.playUrl;
          fallbackAudio.load();
        }
      };
      a.oncanplaythrough = () => done(true);
      a.onloadeddata = () => done(true);
      a.onerror = () => done(false);
      a.onended = () => {
        victory.playing = false;
        notifyVictory();
      };
      a.src = src;
      a.load();
    };
    tryLoad();
    return;
  }

  // 2. YouTube IFrame API (1x1 ẩn, cueVideoById + pre-buffer)
  if (parsed.kind === 'youtube') {
    try {
      const YT = await loadYouTubeApi();
      if (victory.rawUrl !== nextRaw) return;
      const host = ensureHiddenHost();
      let slot = document.getElementById('__ytVictorySlot');
      if (!slot) {
        slot = document.createElement('div');
        slot.id = '__ytVictorySlot';
        host.appendChild(slot);
      }

      const cueAndPrime = (player) => {
        try {
          player.setVolume(muted ? 0 : 100);
          if (muted) player.mute();
          else player.unMute();
          player.cueVideoById({ videoId: parsed.videoId, startSeconds: parsed.startSec || 0, suggestedQuality: 'small' });
          victory.status = 'ready';
          notifyVictory();
        } catch {
          victory.status = 'error';
          notifyVictory();
        }
      };

      if (victory.ytPlayer && victory.ytReady) {
        cueAndPrime(victory.ytPlayer);
      } else if (!victory.ytPlayer) {
        victory.ytPendingVideoId = parsed.videoId;
        victory.ytPlayer = new YT.Player('__ytVictorySlot', {
          width: '1',
          height: '1',
          videoId: parsed.videoId,
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            playsinline: 1,
            rel: 0,
            start: parsed.startSec || 0,
            origin: location.origin,
          },
          events: {
            onReady: (e) => {
              victory.ytReady = true;
              if (victory.parsed && victory.parsed.kind === 'youtube') {
                cueAndPrime(e.target);
              }
            },
            onStateChange: (e) => {
              // YT.PlayerState: PLAYING = 1, PAUSED = 2, ENDED = 0, CUED = 5
              if (e.data === 1) {
                victory.playing = true;
                notifyVictory();
              } else if (e.data === 0 || e.data === 2) {
                victory.playing = false;
                notifyVictory();
              } else if (e.data === 5 && victory.status === 'loading') {
                victory.status = 'ready';
                notifyVictory();
              }
            },
            onError: () => {
              victory.status = 'error';
              victory.playing = false;
              notifyVictory();
            },
          },
        });
      }
    } catch {
      if (victory.rawUrl === nextRaw) {
        victory.status = 'error';
        notifyVictory();
      }
    }
    return;
  }

  // 3. SoundCloud Widget API
  if (parsed.kind === 'soundcloud') {
    try {
      const SC = await loadSoundCloudApi();
      if (victory.rawUrl !== nextRaw) return;
      const host = ensureHiddenHost();
      if (!victory.scIframe) {
        const ifr = document.createElement('iframe');
        ifr.id = '__scVictorySlot';
        ifr.width = '1';
        ifr.height = '1';
        ifr.allow = 'autoplay';
        ifr.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(parsed.playUrl)}&auto_play=false& buying=false&liking=false&download=false&sharing=false&show_artwork=false&show_comments=false&show_playcount=false&show_user=false`;
        host.appendChild(ifr);
        victory.scIframe = ifr;
        const widget = SC.Widget(ifr);
        victory.scWidget = widget;
        widget.bind(SC.Widget.Events.READY, () => {
          widget.setVolume(muted ? 0 : 100);
          victory.status = 'ready';
          notifyVictory();
        });
        widget.bind(SC.Widget.Events.PLAY, () => {
          victory.playing = true;
          notifyVictory();
        });
        widget.bind(SC.Widget.Events.PAUSE, () => {
          victory.playing = false;
          notifyVictory();
        });
        widget.bind(SC.Widget.Events.FINISH, () => {
          victory.playing = false;
          notifyVictory();
        });
        widget.bind(SC.Widget.Events.ERROR, () => {
          victory.status = 'error';
          victory.playing = false;
          notifyVictory();
        });
      } else if (victory.scWidget) {
        victory.scWidget.load(parsed.playUrl, {
          auto_play: false,
          show_artwork: false,
          callback: () => {
            if (victory.rawUrl !== nextRaw) return;
            victory.scWidget.setVolume(muted ? 0 : 100);
            victory.status = 'ready';
            notifyVictory();
          },
        });
      }
    } catch {
      if (victory.rawUrl === nextRaw) {
        victory.status = 'error';
        notifyVictory();
      }
    }
  }
}

/**
 * Mở khóa (warm-up) các phần tử media trong sự kiện click/keydown của người dùng
 * để trình duyệt cho phép phát tự động khi trận đấu kết thúc.
 */
function unlockCustomMedia() {
  if (victory.audioEl && !victory.playing) {
    try {
      const prevMuted = victory.audioEl.muted;
      victory.audioEl.muted = true;
      const p = victory.audioEl.play();
      if (p && typeof p.then === 'function') {
        p.then(() => {
          victory.audioEl.pause();
          victory.audioEl.currentTime = 0;
          victory.audioEl.muted = prevMuted;
        }).catch(() => {
          victory.audioEl.muted = prevMuted;
        });
      }
    } catch { /* ignore */ }
  }
}

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
    unlockCustomMedia();
    return !!c && c.state !== 'closed';
  },
  isUnlocked: () => !!ctx && ctx.state === 'running',
  setMuted(m) {
    muted = m;
    if (m) {
      this.stopSiren();
      if (victory.audioEl) victory.audioEl.volume = 0;
      if (victory.ytPlayer && victory.ytReady) {
        try { victory.ytPlayer.mute(); } catch { /* ignore */ }
      }
      if (victory.scWidget) {
        try { victory.scWidget.setVolume(0); } catch { /* ignore */ }
      }
    } else {
      if (victory.audioEl) victory.audioEl.volume = 1;
      if (victory.ytPlayer && victory.ytReady) {
        try { victory.ytPlayer.unMute(); victory.ytPlayer.setVolume(100); } catch { /* ignore */ }
      }
      if (victory.scWidget) {
        try { victory.scWidget.setVolume(100); } catch { /* ignore */ }
      }
    }
  },
  isMuted: () => muted,

  /** Preload nhạc chiến thắng tùy chỉnh cho chủ đề */
  preloadVictory(url) {
    return preloadVictoryAudio(url);
  },
  getVictoryState,
  onVictoryAudioChange,

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
  /**
   * Chuỗi kết thúc trận đấu:
   *  - Ngắt ngay nhạc nền đếm ngược (BGM nhịp tim).
   *  - Phát còi kết thúc trận (horn) + kích hoạt ngay nhạc chiến thắng đã nạp sẵn (nếu có).
   *  - Nếu không cài nhạc riêng hoặc nhạc ngoài gặp lỗi / bị chặn: tự động phát còi hú + fanfare WebAudio mặc định.
   */
  finishSequence(customUrl) {
    this.musicStop();
    this.stopSiren();
    this.horn();

    if (typeof customUrl === 'string' && customUrl.trim() !== victory.rawUrl) {
      preloadVictoryAudio(customUrl);
    }

    if (victory.parsed && victory.status !== 'error') {
      this.playVictoryCustom({ fromStart: true });
    } else {
      victory.usingFallback = true;
      victory.playing = true;
      notifyVictory();
      this.siren(2, 1300);
      this.fanfare(3.0);
    }
  },

  /** Phát nguồn nhạc chiến thắng tùy chỉnh; nếu thất bại thì chuyển sang bộ WebAudio mặc định. */
  playVictoryCustom({ fromStart = false } = {}) {
    if (!victory.parsed) {
      this.fanfare(0);
      return;
    }
    const triggerFallback = () => {
      victory.usingFallback = true;
      victory.playing = false;
      notifyVictory();
      this.siren(1, 200);
      this.fanfare(1.2);
    };

    const p = victory.parsed;
    victory.usingFallback = false;

    if (p.kind === 'direct' && victory.audioEl) {
      try {
        if (fromStart) victory.audioEl.currentTime = 0;
        victory.audioEl.muted = false;
        victory.audioEl.volume = muted ? 0 : 1;
        const playPromise = victory.audioEl.play();
        victory.playing = true;
        notifyVictory();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(() => triggerFallback());
        }
        return;
      } catch {
        triggerFallback();
        return;
      }
    }

    if (p.kind === 'youtube' && victory.ytPlayer && victory.ytReady) {
      try {
        if (muted) victory.ytPlayer.mute();
        else {
          victory.ytPlayer.unMute();
          victory.ytPlayer.setVolume(100);
        }
        if (fromStart) victory.ytPlayer.seekTo(p.startSec || 0, true);
        victory.ytPlayer.playVideo();
        victory.playing = true;
        notifyVictory();
        return;
      } catch {
        triggerFallback();
        return;
      }
    }

    if (p.kind === 'soundcloud' && victory.scWidget && victory.status === 'ready') {
      try {
        victory.scWidget.setVolume(muted ? 0 : 100);
        if (fromStart) victory.scWidget.seekTo(0);
        victory.scWidget.play();
        victory.playing = true;
        notifyVictory();
        return;
      } catch {
        triggerFallback();
        return;
      }
    }

    // Nếu tài nguyên chưa kịp ready hoặc lỗi → dùng ngay fanfare mặc định để không bị im lặng
    triggerFallback();
  },

  /** Tạm dừng nhạc chiến thắng (dành cho nút điều khiển của Host ở màn kết thúc). */
  pauseVictory() {
    this.stopSiren();
    stopCustomMedia();
    notifyVictory();
  },

  /** Chuyển đổi Tạm dừng / Tiếp tục phát nhạc chiến thắng. */
  toggleVictory() {
    if (victory.playing) {
      this.pauseVictory();
    } else if (victory.parsed && !victory.usingFallback && victory.status === 'ready') {
      this.playVictoryCustom({ fromStart: false });
    } else {
      this.fanfare(0);
    }
  },

  /** Phát lại từ đầu bài nhạc chiến thắng (custom hoặc fanfare mặc định). */
  replayVictory() {
    this.stopSiren();
    if (victory.parsed && victory.status === 'ready') {
      this.playVictoryCustom({ fromStart: true });
    } else {
      this.fanfare(0);
    }
  },

  /** Dừng toàn bộ âm thanh chiến thắng khi rời màn kết thúc về sàn. */
  stopVictory() {
    this.stopSiren();
    stopCustomMedia();
    notifyVictory();
  },

  boom() {
    tone({ freq: 160, type: 'sine', dur: 0.35, vol: 0.25, slideTo: 40 });
  },
};
