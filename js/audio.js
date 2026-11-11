/**
 * Hệ thống âm thanh gameshow (Web Audio API) + Âm thanh kép tùy chỉnh độc lập (Dual Volume Sliders):
 *  - Nguồn 1 (Local Voice / SFX): File ghi âm giọng nói hoặc hiệu ứng do Host tải lên từ máy (IndexedDB / Base64 DataURL).
 *    Áp dụng chính xác mức âm lượng `localAudioVolume` (0.0 đến 1.0). Nếu bằng 0 thì ngắt tiếng hoàn toàn.
 *  - Nguồn 2 (External BGM): Link YouTube / SoundCloud / Direct MP3 / Google Drive audio.
 *    Áp dụng chính xác mức âm lượng `onlineAudioVolume` (0.0 đến 1.0):
 *      + YouTube IFrame: player.setVolume(onlineAudioVolume * 100)
 *      + SoundCloud Widget: widget.setVolume(onlineAudioVolume * 100)
 *      + Thẻ Audio MP3: audio.volume = onlineAudioVolume
 *  - Cả 2 nguồn đều được nạp sẵn (pre-buffer) ngay từ lúc chọn chủ đề / đếm ngược để phát tức thì 0ms,
 *    và hỗ trợ kéo thanh trượt chỉnh âm lượng trực tiếp (on-the-fly) ngay khi đang phát.
 */
import { parseVictoryAudio, loadTopicAudioIDB, clampVolume01 } from './topics.js';

let ctx = null;
let master = null;
let noiseBuf = null;
let muted = false;
let sirenTimers = [];
let music = null;

// Cờ toàn cục báo hiệu âm thanh chiến thắng đã nạp sẵn
window.isVictoryAudioReady = false;

const victoryListeners = new Set();

const victory = {
  // Nguồn 2: Nhạc nền ngoài (YouTube / SoundCloud / Direct URL)
  rawUrl: '',
  parsed: null,
  status: 'idle', // idle | loading | ready | error
  onlineVol: 1.0, // 0.0 .. 1.0 (onlineAudioVolume)
  extTargetVol: 1.0,
  audioEl: null,
  ytPlayer: null,
  ytReady: false,
  scWidget: null,
  scIframe: null,

  // Nguồn 1: File ghi âm / SFX tải từ máy (IndexedDB / Base64)
  topicId: '',
  voiceSrc: '',
  voiceName: '',
  voiceStatus: 'idle', // idle | loading | ready | error
  localVol: 1.0, // 0.0 .. 1.0 (localAudioVolume)
  voiceEl: null,
  voiceBuf: null,
  voiceNode: null,
  voiceGain: null,
  voiceBlobUrl: '',

  playing: false,
  usingFallback: false,
};

function computeReady() {
  const extOk = !victory.parsed || victory.status === 'ready';
  const voiceOk = !victory.voiceSrc || victory.voiceStatus === 'ready';
  return (!!victory.parsed || !!victory.voiceSrc) && extOk && voiceOk;
}

function notifyVictory() {
  window.isVictoryAudioReady = computeReady();
  const snapshot = getVictoryState();
  victoryListeners.forEach((cb) => {
    try { cb(snapshot); } catch { /* ignore listener error */ }
  });
}

export function onVictoryAudioChange(cb) {
  victoryListeners.add(cb);
  return () => victoryListeners.delete(cb);
}

export function getVictoryState() {
  const hasExt = !!victory.parsed && victory.status !== 'error';
  const hasVoice = !!victory.voiceSrc && victory.voiceStatus !== 'error';
  return {
    hasCustom: hasExt || hasVoice,
    hasExternal: hasExt,
    hasVoice,
    kind: victory.parsed ? victory.parsed.kind : 'default',
    rawUrl: victory.rawUrl,
    voiceName: victory.voiceName,
    status: victory.status,
    voiceStatus: victory.voiceStatus,
    localAudioVolume: victory.localVol,
    onlineAudioVolume: victory.onlineVol,
    ready: computeReady(),
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
    try {
      const prev = window.onYouTubeIframeAPIReady;
      const timer = setTimeout(() => {
        ytApiPromise = null;
        reject(new Error('YouTube API timeout'));
      }, 12000);
      window.onYouTubeIframeAPIReady = () => {
        clearTimeout(timer);
        try { if (typeof prev === 'function') prev(); } catch { /* ignore */ }
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
    } catch (err) {
      ytApiPromise = null;
      reject(err);
    }
  });
  return ytApiPromise;
}

// ---------- Nạp SDK SoundCloud Widget API ----------
let scApiPromise = null;
function loadSoundCloudApi() {
  if (window.SC && window.SC.Widget) return Promise.resolve(window.SC);
  if (scApiPromise) return scApiPromise;
  scApiPromise = new Promise((resolve, reject) => {
    try {
      const timer = setTimeout(() => {
        scApiPromise = null;
        reject(new Error('SoundCloud API timeout'));
      }, 12000);
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
    } catch (err) {
      scApiPromise = null;
      reject(err);
    }
  });
  return scApiPromise;
}

/** Áp dụng mức âm lượng cho Nguồn 1 (File ghi âm / âm thanh tải lên từ máy, 0.0 -> 1.0). */
function applyLocalVolume(vol01) {
  const v = clampVolume01(vol01, victory.localVol);
  victory.localVol = v;
  const eff = muted || v <= 0 ? 0 : v;
  if (victory.voiceGain && ctx) {
    try {
      victory.voiceGain.gain.setValueAtTime(eff, ctx.currentTime);
    } catch {
      victory.voiceGain.gain.value = eff;
    }
  }
  if (victory.voiceEl) {
    try {
      victory.voiceEl.muted = eff <= 0;
      victory.voiceEl.volume = eff;
    } catch { /* ignore */ }
  }
}

/** Áp dụng mức âm lượng cho Nguồn 2 (Nhạc ngoài: YouTube / SoundCloud / Direct MP3, 0.0 -> 1.0). */
function applyExternalVolume(vol01) {
  const v = clampVolume01(vol01, victory.onlineVol);
  victory.onlineVol = v;
  victory.extTargetVol = v;
  const eff = muted || v <= 0 ? 0 : v;
  const pct = Math.round(eff * 100);
  if (victory.audioEl) {
    try {
      victory.audioEl.muted = eff <= 0;
      victory.audioEl.volume = eff;
    } catch { /* ignore */ }
  }
  if (victory.ytPlayer && victory.ytReady) {
    try {
      victory.ytPlayer.setVolume(pct);
      if (eff <= 0) victory.ytPlayer.mute();
      else victory.ytPlayer.unMute();
    } catch { /* ignore */ }
  }
  if (victory.scWidget) {
    try { victory.scWidget.setVolume(pct); } catch { /* ignore */ }
  }
}

function stopVoiceStream() {
  if (victory.voiceNode) {
    try { victory.voiceNode.stop(); } catch { /* ignore */ }
    try { victory.voiceNode.disconnect(); } catch { /* ignore */ }
    victory.voiceNode = null;
  }
  if (victory.voiceGain) {
    try { victory.voiceGain.disconnect(); } catch { /* ignore */ }
    victory.voiceGain = null;
  }
  if (victory.voiceEl) {
    try {
      victory.voiceEl.pause();
      victory.voiceEl.currentTime = 0;
    } catch { /* ignore */ }
  }
}

function stopExternalStream() {
  if (victory.audioEl) {
    try {
      victory.audioEl.pause();
      victory.audioEl.currentTime = 0;
    } catch { /* ignore */ }
  }
  if (victory.ytPlayer && victory.ytReady) {
    try { victory.ytPlayer.pauseVideo(); } catch { /* ignore */ }
  }
  if (victory.scWidget) {
    try { victory.scWidget.pause(); } catch { /* ignore */ }
  }
}

function stopCustomMedia() {
  victory.playing = false;
  stopVoiceStream();
  stopExternalStream();
}

/**
 * Nạp sẵn (pre-buffer) Luồng 1: File ghi âm / SFX trong máy (từ IndexedDB hoặc chuỗi Base64).
 * Giải mã sẵn sang WebAudio AudioBuffer (phát 0ms không bao giờ bị chặn) + HTMLAudioElement dự phòng.
 */
async function preloadVoiceStream({ topicId = '', voiceData = '', voiceName = '' } = {}) {
  let resolvedData = typeof voiceData === 'string' ? voiceData.trim() : '';
  let resolvedName = voiceName || '';

  // Nếu có topicId, ưu tiên kiểm tra bản gốc chất lượng cao trong IndexedDB của máy hiện tại
  if (topicId) {
    try {
      const rec = await loadTopicAudioIDB(topicId);
      if (rec) {
        if (rec.rawBlob instanceof Blob) {
          if (victory.voiceBlobUrl) {
            try { URL.revokeObjectURL(victory.voiceBlobUrl); } catch { /* ignore */ }
          }
          victory.voiceBlobUrl = URL.createObjectURL(rec.rawBlob);
          resolvedData = victory.voiceBlobUrl;
        } else if (typeof rec.dataUrl === 'string' && rec.dataUrl) {
          resolvedData = rec.dataUrl;
        }
        if (rec.name) resolvedName = rec.name;
      }
    } catch { /* ignore IDB error */ }
  }

  const sig = `${topicId}::${resolvedData.slice(0, 120)}::${resolvedData.length}`;
  if (sig === victory.voiceSrc && (victory.voiceStatus === 'ready' || victory.voiceStatus === 'loading')) {
    return;
  }

  stopVoiceStream();
  victory.topicId = topicId || '';
  victory.voiceSrc = sig;
  victory.voiceName = resolvedName;
  victory.voiceBuf = null;

  if (!resolvedData) {
    victory.voiceSrc = '';
    victory.voiceStatus = 'idle';
    notifyVictory();
    return;
  }

  victory.voiceStatus = 'loading';
  notifyVictory();

  // Giải mã sẵn AudioBuffer cho WebAudio (độ trễ 0ms)
  try {
    const c = ac();
    if (c) {
      const res = await fetch(resolvedData);
      const ab = await res.arrayBuffer();
      const buf = await c.decodeAudioData(ab.slice(0));
      if (victory.voiceSrc === sig) {
        victory.voiceBuf = buf;
        victory.voiceStatus = 'ready';
        notifyVictory();
      }
    }
  } catch { /* fallback sang HTMLAudioElement bên dưới */ }

  // Luôn chuẩn bị thêm HTMLAudioElement dự phòng
  try {
    const a = new Audio();
    a.preload = 'auto';
    const eff = muted || victory.localVol <= 0 ? 0 : victory.localVol;
    a.muted = eff <= 0;
    a.volume = eff;
    a.oncanplaythrough = () => {
      if (victory.voiceSrc !== sig) return;
      victory.voiceEl = a;
      victory.voiceStatus = 'ready';
      notifyVictory();
    };
    a.onloadeddata = () => {
      if (victory.voiceSrc !== sig) return;
      victory.voiceEl = a;
      victory.voiceStatus = 'ready';
      notifyVictory();
    };
    a.onerror = () => {
      if (victory.voiceSrc !== sig) return;
      if (!victory.voiceBuf) {
        victory.voiceStatus = 'error';
        notifyVictory();
      }
    };
    a.onended = () => {
      if (!victory.parsed || victory.status !== 'ready') {
        victory.playing = false;
      }
      notifyVictory();
    };
    a.src = resolvedData;
    a.load();
    victory.voiceEl = a;
  } catch {
    if (!victory.voiceBuf) {
      victory.voiceStatus = 'error';
      notifyVictory();
    }
  }
}

/**
 * Nạp sẵn (pre-buffer) Luồng 2: Nhạc nền ngoài (YouTube / SoundCloud / Direct MP3)
 */
async function preloadExternalStream(rawUrl) {
  const parsed = parseVictoryAudio(rawUrl);
  const nextRaw = parsed ? parsed.raw : '';

  if (nextRaw === victory.rawUrl && (victory.status === 'ready' || victory.status === 'loading')) {
    return;
  }

  stopExternalStream();
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
      a.volume = muted ? 0 : victory.extTargetVol;
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
          try {
            const fallbackAudio = new Audio();
            fallbackAudio.preload = 'auto';
            fallbackAudio.volume = muted ? 0 : victory.extTargetVol;
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
          } catch {
            victory.status = 'error';
            notifyVictory();
          }
        }
      };
      a.oncanplaythrough = () => done(true);
      a.onloadeddata = () => done(true);
      a.onerror = () => done(false);
      a.onended = () => {
        victory.playing = false;
        notifyVictory();
      };
      try {
        a.src = src;
        a.load();
      } catch {
        done(false);
      }
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
          const vol = muted ? 0 : Math.round(victory.extTargetVol * 100);
          player.setVolume(vol);
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
        ifr.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(parsed.playUrl)}&auto_play=false&buying=false&liking=false&download=false&sharing=false&show_artwork=false&show_comments=false&show_playcount=false&show_user=false`;
        host.appendChild(ifr);
        victory.scIframe = ifr;
        const widget = SC.Widget(ifr);
        victory.scWidget = widget;
        widget.bind(SC.Widget.Events.READY, () => {
          try { widget.setVolume(muted ? 0 : Math.round(victory.extTargetVol * 100)); } catch { /* ignore */ }
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
            try { victory.scWidget.setVolume(muted ? 0 : Math.round(victory.extTargetVol * 100)); } catch { /* ignore */ }
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
 * Hàm tổng hợp nạp sẵn cả 2 luồng âm thanh chiến thắng (Link ngoài + File ghi âm trong máy) kèm âm lượng.
 * Có thể truyền vào chuỗi URL hoặc object { url, topicId, voiceData, voiceName, localAudioVolume, onlineAudioVolume }.
 */
async function preloadVictoryAudio(input) {
  const opts = typeof input === 'string'
    ? { url: input, topicId: victory.topicId, voiceData: '', voiceName: '' }
    : (input || {});
  if (opts.localAudioVolume !== undefined) {
    applyLocalVolume(opts.localAudioVolume);
  }
  if (opts.onlineAudioVolume !== undefined) {
    applyExternalVolume(opts.onlineAudioVolume);
  }
  await Promise.all([
    preloadExternalStream(opts.url || ''),
    preloadVoiceStream({
      topicId: opts.topicId || '',
      voiceData: opts.voiceData || '',
      voiceName: opts.voiceName || '',
    }),
  ]);
}

/**
 * Mở khóa (warm-up) các phần tử media trong sự kiện click/keydown của người dùng
 * để trình duyệt cho phép phát tự động khi trận đấu kết thúc.
 */
function unlockCustomMedia() {
  [victory.audioEl, victory.voiceEl].forEach((el) => {
    if (el && !victory.playing) {
      try {
        const prevMuted = el.muted;
        el.muted = true;
        const p = el.play();
        if (p && typeof p.then === 'function') {
          p.then(() => {
            el.pause();
            el.currentTime = 0;
            el.muted = prevMuted;
          }).catch(() => {
            el.muted = prevMuted;
          });
        }
      } catch { /* ignore */ }
    }
  });
}

function ac() {
  if (!ctx) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.9;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp).connect(ctx.destination);
    } catch {
      return null;
    }
  }
  return ctx;
}

function noise() {
  if (!noiseBuf && ctx) {
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
  try {
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
  } catch { /* ignore audio node error */ }
}

function tone(opts) {
  const c = ac();
  if (!c) return;
  toneAt(c.currentTime + (opts.start || 0), opts);
}

function noiseAt(t, { dur = 0.05, vol = 0.2, hp = 6000, lp = 0 }) {
  const c = ac();
  if (!c || muted) return;
  try {
    const buf = noise();
    if (!buf) return;
    const src = c.createBufferSource();
    src.buffer = buf;
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
  } catch { /* ignore */ }
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
  if (s8 % 2 === 0 || (urgent && s8 % 2 === 1)) kickAt(t, urgent ? 0.55 : 0.42);
  noiseAt(t + (s8 % 2 ? 0 : stepDur * 0.5), { dur: 0.03, vol: urgent ? 0.16 : 0.09, hp: 7000 });
  toneAt(t, { freq: BASS[s8] * (urgent ? 2 : 1), type: 'sawtooth', dur: stepDur * 0.9, vol: 0.13, lowpass: 380 + (1 - Math.min(ms, 60000) / 60000) * 900 });
  if (urgent) {
    const k = 1 - ms / 10000;
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
    let bpm = 84 + frac * 66;
    if (ms <= 10000) bpm += (1 - ms / 10000) * 70;
    const stepDur = 60 / bpm / 2;
    playMusicStep(m.step, m.next, stepDur, ms);
    m.next += stepDur;
    m.step += 1;
  }
}

/** Phát Nguồn 1 (File ghi âm / SFX trong máy) với mức âm lượng `vol01` (0.0 -> 1.0). Trả về true nếu phát thành công. */
function playVoiceWithVolume(vol01, { fromStart = true } = {}) {
  if (!victory.voiceSrc || victory.voiceStatus === 'error') return false;
  applyLocalVolume(vol01);
  if (victory.localVol <= 0) {
    stopVoiceStream();
    return true;
  }

  // Ưu tiên phát qua WebAudio AudioBuffer (0ms, không bị chặn autoplay)
  const c = ac();
  if (c && victory.voiceBuf) {
    try {
      stopVoiceStream();
      if (c.state === 'suspended') c.resume();
      const src = c.createBufferSource();
      src.buffer = victory.voiceBuf;
      const g = c.createGain();
      const eff = muted || victory.localVol <= 0 ? 0 : victory.localVol;
      g.gain.value = eff;
      src.connect(g).connect(master);
      victory.voiceNode = src;
      victory.voiceGain = g;
      src.onended = () => {
        if (victory.voiceNode === src) {
          victory.voiceNode = null;
          victory.voiceGain = null;
        }
        if (!victory.parsed || victory.status !== 'ready') {
          victory.playing = false;
        }
        notifyVictory();
      };
      src.start(0);
      victory.playing = true;
      notifyVictory();
      return true;
    } catch { /* fallback sang HTMLAudioElement */ }
  }

  if (victory.voiceEl) {
    try {
      if (fromStart) victory.voiceEl.currentTime = 0;
      const eff = muted || victory.localVol <= 0 ? 0 : victory.localVol;
      victory.voiceEl.muted = eff <= 0;
      victory.voiceEl.volume = eff;
      const p = victory.voiceEl.play();
      victory.playing = true;
      notifyVictory();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {});
      }
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** Phát Nguồn 2 (Nhạc ngoài: YouTube / SoundCloud / Direct MP3) với mức âm lượng `vol01` (0.0 -> 1.0). */
function playExternalWithVolume(vol01, { fromStart = true, onFail = null } = {}) {
  const p = victory.parsed;
  if (!p || victory.status === 'error') {
    if (typeof onFail === 'function') onFail();
    return false;
  }

  applyExternalVolume(vol01);
  if (victory.onlineVol <= 0) {
    stopExternalStream();
    return true;
  }
  const eff = muted ? 0 : victory.onlineVol;
  const pct = Math.round(eff * 100);

  if (p.kind === 'direct' && victory.audioEl) {
    try {
      if (fromStart) victory.audioEl.currentTime = 0;
      victory.audioEl.muted = eff <= 0;
      victory.audioEl.volume = eff;
      const playPromise = victory.audioEl.play();
      victory.playing = true;
      notifyVictory();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => { if (typeof onFail === 'function') onFail(); });
      }
      return true;
    } catch {
      if (typeof onFail === 'function') onFail();
      return false;
    }
  }

  if (p.kind === 'youtube' && victory.ytPlayer && victory.ytReady) {
    try {
      victory.ytPlayer.setVolume(pct);
      if (eff <= 0) victory.ytPlayer.mute();
      else victory.ytPlayer.unMute();
      if (fromStart) victory.ytPlayer.seekTo(p.startSec || 0, true);
      victory.ytPlayer.playVideo();
      victory.playing = true;
      notifyVictory();
      return true;
    } catch {
      if (typeof onFail === 'function') onFail();
      return false;
    }
  }

  if (p.kind === 'soundcloud' && victory.scWidget && victory.status === 'ready') {
    try {
      victory.scWidget.setVolume(pct);
      if (fromStart) victory.scWidget.seekTo(0);
      victory.scWidget.play();
      victory.playing = true;
      notifyVictory();
      return true;
    } catch {
      if (typeof onFail === 'function') onFail();
      return false;
    }
  }

  if (typeof onFail === 'function') onFail();
  return false;
}

export const Sfx = {
  unlock() {
    const c = ac();
    if (c && c.state === 'suspended') {
      try { c.resume(); } catch { /* ignore */ }
    }
    unlockCustomMedia();
    return !!c && c.state !== 'closed';
  },
  isUnlocked: () => !!ctx && ctx.state === 'running',
  setMuted(m) {
    muted = m;
    if (m) this.stopSiren();
    applyLocalVolume(victory.localVol);
    applyExternalVolume(victory.onlineVol);
  },
  isMuted: () => muted,

  /** Điều chỉnh trực tiếp âm lượng 2 kênh (0.0 -> 1.0) theo thời gian thực */
  setLocalVolume(vol01) {
    applyLocalVolume(vol01);
    notifyVictory();
  },
  setOnlineVolume(vol01) {
    applyExternalVolume(vol01);
    notifyVictory();
  },
  setVolumes({ localAudioVolume, onlineAudioVolume } = {}) {
    if (localAudioVolume !== undefined) applyLocalVolume(localAudioVolume);
    if (onlineAudioVolume !== undefined) applyExternalVolume(onlineAudioVolume);
    notifyVictory();
  },

  /** Preload cả 2 luồng âm thanh chiến thắng (link nhạc ngoài + file ghi âm trong máy) */
  preloadVictory(input) {
    return preloadVictoryAudio(input);
  },
  /** Nghe thử riêng file ghi âm trong máy theo mức localAudioVolume */
  async previewVoiceOnly(opts = {}) {
    this.unlock();
    this.stopVictory();
    const vol = opts.localAudioVolume !== undefined ? clampVolume01(opts.localAudioVolume, 1.0) : victory.localVol;
    await preloadVoiceStream(opts);
    return playVoiceWithVolume(vol, { fromStart: true });
  },
  /** Nghe thử riêng link nhạc ngoài theo mức onlineAudioVolume */
  async previewExternalOnly(url, vol01) {
    this.unlock();
    this.stopVictory();
    const vol = vol01 !== undefined ? clampVolume01(vol01, 1.0) : victory.onlineVol;
    await preloadExternalStream(url);
    return playExternalWithVolume(vol, {
      fromStart: true,
      onFail: () => this.fanfare(0, vol),
    });
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
  /** Nhạc chiến thắng hoành tráng: hợp âm + giai điệu + cymbal (volScale cho phép hạ nhỏ khi làm nền cho giọng nói) */
  fanfare(delay = 0, volScale = 1.0) {
    const c = ac();
    if (!c) return;
    const t = c.currentTime + delay;
    const s = Math.max(0.1, Math.min(1, volScale));
    const melody = [
      [523, 0], [659, 0.16], [784, 0.32], [1047, 0.5], [784, 0.74], [1047, 0.9], [1319, 1.1], [1568, 1.5],
    ];
    melody.forEach(([f, o], i) => {
      toneAt(t + o, { freq: f, type: 'triangle', dur: i === melody.length - 1 ? 1.8 : 0.4, vol: 0.28 * s });
      toneAt(t + o, { freq: f / 2, type: 'sawtooth', dur: i === melody.length - 1 ? 1.8 : 0.4, vol: 0.09 * s, lowpass: 1400 });
    });
    [262, 330, 392, 523, 659, 784].forEach((f) => {
      toneAt(t + 1.5, { freq: f, type: 'sawtooth', dur: 2.2, vol: 0.09 * s, lowpass: 2000, attack: 0.02 });
    });
    kickAt(t + 1.5, 0.6 * s);
    noiseAt(t + 1.5, { dur: 1.6, vol: 0.18 * s, hp: 5000 });
    for (let i = 0; i < 12; i++) noiseAt(t + 0.9 + i * 0.05, { dur: 0.05, vol: (0.05 + i * 0.01) * s, hp: 3000 });
  },

  /**
   * KÍCH HOẠT ÂM THANH CHIẾN THẮNG KÉP (DUAL VOLUME SLIDERS):
   *  - Nguồn 1 (File ghi âm / âm thanh từ máy): Áp dụng chính xác `localAudioVolume` (0.0 đến 1.0).
   *  - Nguồn 2 (Nhạc YouTube / SoundCloud / link MP3 ngoài): Áp dụng chính xác `onlineAudioVolume` (0.0 đến 1.0).
   *  - Nếu một thanh kéo về 0%, nguồn đó tự động ngắt tiếng (mute hoàn toàn).
   *  - Nếu chỉ có 1 trong 2 nguồn được thiết lập, nguồn đó phát đúng theo mức % trên thanh trượt của nó.
   */
  finishSequence(opts) {
    this.musicStop();
    this.stopSiren();
    this.horn();

    if (opts) {
      if (opts.localAudioVolume !== undefined) applyLocalVolume(opts.localAudioVolume);
      if (opts.onlineAudioVolume !== undefined) applyExternalVolume(opts.onlineAudioVolume);
      preloadVictoryAudio(opts);
    }

    this.playVictoryCustom({ fromStart: true });
  },

  playVictoryCustom({ fromStart = false } = {}) {
    const hasVoice = !!victory.voiceSrc && victory.voiceStatus !== 'error' && (!!victory.voiceBuf || !!victory.voiceEl);
    const hasExt = !!victory.parsed && victory.status !== 'error';
    const localVol = clampVolume01(victory.localVol, 1.0);
    const onlineVol = clampVolume01(victory.onlineVol, 1.0);

    victory.usingFallback = false;

    // 1. Có CẢ file âm thanh gốc trong máy VÀ link nhạc ngoài -> phát đồng thời theo đúng localAudioVolume & onlineAudioVolume
    if (hasVoice && hasExt) {
      playVoiceWithVolume(localVol, { fromStart });
      playExternalWithVolume(onlineVol, {
        fromStart,
        onFail: () => {
          if (onlineVol > 0) this.fanfare(0.4, onlineVol * 0.5);
        },
      });
      return;
    }

    // 2. CHỈ CÓ link nhạc ngoài -> phát đúng theo mức onlineAudioVolume
    if (!hasVoice && hasExt) {
      playExternalWithVolume(onlineVol, {
        fromStart,
        onFail: () => {
          victory.usingFallback = true;
          victory.playing = false;
          notifyVictory();
          this.siren(1, 200);
          if (onlineVol > 0) this.fanfare(1.2, onlineVol);
        },
      });
      return;
    }

    // 3. CHỈ CÓ file ghi âm trong máy -> phát đúng theo mức localAudioVolume kết hợp hiệu ứng chiến thắng
    if (hasVoice && !hasExt) {
      playVoiceWithVolume(localVol, { fromStart });
      if (onlineVol > 0) {
        this.fanfare(0.35, Math.min(0.45, onlineVol));
      }
      return;
    }

    // Mặc định (không cài cả hai hoặc cả hai đều lỗi)
    victory.usingFallback = true;
    victory.playing = true;
    notifyVictory();
    this.siren(2, 900);
    this.fanfare(2.2, 1.0);
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
    } else {
      this.playVictoryCustom({ fromStart: false });
    }
  },

  /** Phát lại từ đầu bài nhạc chiến thắng (kép / đơn / mặc định). */
  replayVictory() {
    this.stopSiren();
    stopCustomMedia();
    this.playVictoryCustom({ fromStart: true });
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
