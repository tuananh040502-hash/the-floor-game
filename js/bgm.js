import { loadFirebaseConfig } from './firebase-config.js?v=iosfix15';
import { loadDrive } from './topics.js?v=iosfix15';
import {
  BGM_CACHE_KEY,
  createSharedBgmSync,
  parseCloudBgmSnapshot,
  normalizeScriptUrl,
  normalizeFolderId,
  extractYouTubeId,
  canIdentityModifyBgm,
} from './transport.js?v=bgm1';

const SCRIPT_URL_RE = /^https:\/\/script\.google\.com\/(macros\/s\/|a\/)/;
const BGM_MUTE_KEY = 'thefloor:bgmMuted';
const BGM_VOL_KEY = 'thefloor:bgmVolume';
const AUDIO_EXT_RE = /\.(mp3|m4a|wav|ogg)$/i;
const MAX_AUDIO_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB an toàn cho Apps Script doPost

const MIME_BY_EXT = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
};

function safeGetLocal(key, fallback = '') {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const v = localStorage.getItem(key);
    return v !== null ? v : fallback;
  } catch {
    return fallback;
  }
}

function safeSetLocal(key, val) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, val);
  } catch { /* ignore */ }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function clamp01(v, fallback = 0.45) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function cleanAudioTitle(filename) {
  return String(filename || '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'Nhạc nền Drive';
}

function inferAudioMime(file) {
  const rawType = String(file && file.type || '').trim();
  if (rawType && rawType.startsWith('audio/')) return rawType;
  const m = /\.([a-z0-9]{2,5})$/i.exec(String(file && file.name || ''));
  const ext = m && m[1] ? m[1].toLowerCase() : '';
  return MIME_BY_EXT[ext] || 'audio/mpeg';
}

function readBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const raw = String(r.result || '');
      const commaIdx = raw.indexOf(',');
      const b64 = (commaIdx >= 0 ? raw.slice(commaIdx + 1) : raw).replace(/[^A-Za-z0-9+/=]/g, '');
      if (!b64) {
        reject(new Error('Dữ liệu âm thanh rỗng hoặc không hợp lệ.'));
        return;
      }
      resolve(b64);
    };
    r.onerror = () => reject(new Error('Không đọc được file âm thanh.'));
    r.readAsDataURL(blob);
  });
}

async function fetchYouTubeTitle(youtubeId) {
  if (typeof fetch !== 'function' || !youtubeId) return '';
  let timer = null;
  try {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    if (ctrl) timer = setTimeout(() => ctrl.abort(), 1800);
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${youtubeId}`)}&format=json`;
    const res = await fetch(oembedUrl, ctrl ? { signal: ctrl.signal } : undefined);
    if (!res.ok) return '';
    const json = await res.json();
    return String(json && json.title || '').trim().slice(0, 120);
  } catch {
    return '';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function readCachedTracks() {
  try {
    return parseCloudBgmSnapshot(JSON.parse(safeGetLocal(BGM_CACHE_KEY, '[]') || '[]'));
  } catch {
    return [];
  }
}

export function initBgm(options = {}) {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return {
      setArenaPaused() {},
      openModal() {},
      closeModal() {},
      pausePreview() {},
      refreshDriveIdentity() {},
      dispose() {},
    };
  }

  // Tránh khởi tạo trùng trên cùng 1 trang
  if (window.__theFloorBgmController) {
    return window.__theFloorBgmController;
  }

  // Nếu đang chạy trong #appViewportFrame và window.top đã có trình phát BGM:
  // Ủy quyền toàn bộ điều khiển về window.top để giữ nhạc liền mạch 100% và không phát trùng 2 bản.
  let topBgm = null;
  try {
    if (window.self !== window.top && window.top && window.top.__theFloorBgmController) {
      topBgm = window.top.__theFloorBgmController;
    }
  } catch { /* cross-origin */ }

  if (topBgm) {
    if (options.autoPlay !== false && typeof topBgm.setAutoPlayAllowed === 'function') {
      topBgm.setAutoPlayAllowed(true);
    }
    const syncProxyButtons = () => {
      const snap = typeof topBgm.getUiSnapshot === 'function'
        ? topBgm.getUiSnapshot()
        : { muted: Boolean(topBgm.isMuted && topBgm.isMuted()), isPlaying: false, arenaPaused: false, count: 0 };
      document.querySelectorAll('#btnBgmMute, [data-bgm-mute]').forEach((btn) => {
        btn.textContent = snap.muted ? '🔇' : '🎵';
        btn.title = snap.muted
          ? 'Đang tắt nhạc nền — Bấm để bật'
          : (snap.isPlaying ? 'Đang phát nhạc nền — Bấm để tắt tiếng' : 'Bật / tắt tiếng nhạc nền');
        btn.setAttribute('aria-pressed', String(!snap.muted));
        btn.classList.toggle('is-muted', snap.muted);
        btn.classList.toggle('is-playing', !snap.muted && snap.isPlaying && !snap.arenaPaused);
      });
      const countEl = document.getElementById('bgmCountChip');
      if (countEl) countEl.textContent = `${snap.count || 0} bài`;
    };
    document.querySelectorAll('#btnBgmMute, [data-bgm-mute]').forEach((btn) => {
      if (btn.dataset.bgmBound) return;
      btn.dataset.bgmBound = '1';
      btn.addEventListener('click', () => {
        topBgm.setMuted(!topBgm.isMuted());
        syncProxyButtons();
      });
    });
    document.querySelectorAll('#btnBgmModal, [data-open-bgm-modal]').forEach((btn) => {
      if (btn.dataset.bgmBound) return;
      btn.dataset.bgmBound = '1';
      btn.addEventListener('click', () => {
        topBgm.openModal();
      });
    });
    const unsub = typeof topBgm.onUiChange === 'function' ? topBgm.onUiChange(syncProxyButtons) : () => {};
    syncProxyButtons();

    const proxyApi = {
      setArenaPaused: (inDuel) => topBgm.setArenaPaused(inDuel),
      pausePreview: () => topBgm.pausePreview(),
      refreshDriveIdentity: () => topBgm.refreshDriveIdentity(),
      openModal: () => topBgm.openModal(),
      closeModal: () => topBgm.closeModal(),
      setMuted: (m) => { topBgm.setMuted(m); syncProxyButtons(); },
      isMuted: () => topBgm.isMuted(),
      dispose: () => { try { unsub(); } catch { /* ignore */ } },
    };
    window.addEventListener('pagehide', proxyApi.dispose);
    window.__theFloorBgmController = proxyApi;
    return proxyApi;
  }

  let autoPlayAllowed = options.autoPlay !== false;
  const uiListeners = new Set();
  const externalGetIdentity = typeof options.getDriveIdentity === 'function'
    ? options.getDriveIdentity
    : null;

  let tracks = readCachedTracks();
  let currentId = '';
  let lastPlayedId = '';
  let muted = safeGetLocal(BGM_MUTE_KEY, '0') === '1';
  let volume = clamp01(safeGetLocal(BGM_VOL_KEY, '0.45'), 0.45);
  let arenaPaused = false;
  let manualPreviewing = false;
  let unlocked = false;
  let isPlaying = false;
  let errorStreak = 0;
  let activeTab = 'drive';
  let uploading = false;
  let syncStatus = { state: 'syncing', message: 'Đang đồng bộ…' };
  let bgmSync = null;
  let disposed = false;

  // Audio Drive element
  const audioEl = new Audio();
  audioEl.preload = 'auto';
  audioEl.setAttribute('playsinline', '');
  audioEl.playsInline = true;
  audioEl.volume = muted ? 0 : volume;
  let triedDriveFallback = false;

  // YouTube lazy API + 1x1px hidden player
  let ytApiPromise = null;
  let ytPlayer = null;
  let ytCreating = false;
  let ytReady = false;
  let desiredYtVideoId = '';

  function getDriveIdentity() {
    if (externalGetIdentity) {
      const ext = externalGetIdentity() || {};
      return {
        scriptUrl: normalizeScriptUrl(ext.scriptUrl),
        folderId: normalizeFolderId(ext.folderId),
      };
    }
    const cfg = loadDrive();
    const inpUrl = document.getElementById('driveUrl');
    const inpFolder = document.getElementById('driveFolder');
    return {
      scriptUrl: normalizeScriptUrl((inpUrl && inpUrl.value) || cfg.url),
      folderId: normalizeFolderId((inpFolder && inpFolder.value) || cfg.folderId),
    };
  }

  function hasValidDriveKey() {
    const id = getDriveIdentity();
    return Boolean(id.scriptUrl && id.folderId && SCRIPT_URL_RE.test(id.scriptUrl));
  }

  function currentTrack() {
    return tracks.find((t) => t.id === currentId) || null;
  }

  function shouldPlay() {
    if (disposed || muted || arenaPaused || !tracks.length) return false;
    return manualPreviewing || autoPlayAllowed;
  }

  function pickRandomTrack(excludeId = '') {
    if (!tracks.length) return null;
    if (tracks.length === 1) return tracks[0];
    const pool = excludeId ? tracks.filter((t) => t.id !== excludeId) : tracks;
    const list = pool.length ? pool : tracks;
    const idx = Math.floor(Math.random() * list.length);
    return list[idx] || list[0];
  }

  function ensureYouTubeApi() {
    if (window.YT && typeof window.YT.Player === 'function') {
      return Promise.resolve(window.YT);
    }
    if (ytApiPromise) return ytApiPromise;

    ytApiPromise = new Promise((resolve, reject) => {
      const finish = () => {
        if (window.YT && typeof window.YT.Player === 'function') {
          resolve(window.YT);
          return true;
        }
        return false;
      };
      if (finish()) return;

      const prevReady = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof prevReady === 'function') {
          try { prevReady(); } catch { /* ignore */ }
        }
        finish();
      };

      const existing = document.querySelector('script[src*="youtube.com/iframe_api"]');
      if (!existing) {
        const s = document.createElement('script');
        s.src = 'https://www.youtube.com/iframe_api';
        s.async = true;
        s.onerror = () => {
          ytApiPromise = null;
          reject(new Error('Không tải được YouTube IFrame API.'));
        };
        document.head.appendChild(s);
      } else {
        // Trường hợp script đã có sẵn (ví dụ từ audio.js) và tải xong trước đó
        let tries = 0;
        const poll = setInterval(() => {
          tries += 1;
          if (finish()) {
            clearInterval(poll);
          } else if (tries > 80) {
            clearInterval(poll);
          }
        }, 125);
      }
    });
    return ytApiPromise;
  }

  function maybeLazyLoadYouTube() {
    if (tracks.some((t) => t.type === 'youtube')) {
      ensureYouTubeApi().catch(() => {});
    }
  }

  function pauseYouTube() {
    if (ytPlayer && typeof ytPlayer.pauseVideo === 'function') {
      try { ytPlayer.pauseVideo(); } catch { /* ignore */ }
    }
  }

  function pauseDrive() {
    try {
      if (!audioEl.paused) audioEl.pause();
    } catch { /* ignore */ }
  }

  function pauseAllInternal() {
    pauseDrive();
    pauseYouTube();
    isPlaying = false;
    updateUiState();
  }

  function startYouTubeTrack(track) {
    pauseDrive();
    desiredYtVideoId = track.youtubeId;
    ensureYouTubeApi().then((YT) => {
      if (disposed) return;
      const active = currentTrack();
      if (!active || active.id !== track.id || active.type !== 'youtube') return;

      let host = document.getElementById('bgmYtHost');
      if (!host) {
        host = document.createElement('div');
        host.id = 'bgmYtHost';
        host.setAttribute('aria-hidden', 'true');
        host.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;z-index:-1;';
        const inner = document.createElement('div');
        inner.id = 'bgmYtPlayer';
        host.appendChild(inner);
        document.body.appendChild(host);
      }

      if (ytPlayer && ytReady && typeof ytPlayer.loadVideoById === 'function') {
        try {
          ytPlayer.setVolume(Math.round(volume * 100));
          if (muted) ytPlayer.mute(); else ytPlayer.unMute();
          if (shouldPlay()) ytPlayer.loadVideoById(track.youtubeId);
          else ytPlayer.cueVideoById(track.youtubeId);
        } catch { /* ignore */ }
        return;
      }
      if (ytCreating || ytPlayer) return;
      ytCreating = true;

      ytPlayer = new YT.Player('bgmYtPlayer', {
        width: '1',
        height: '1',
        videoId: track.youtubeId,
        playerVars: {
          autoplay: shouldPlay() ? 1 : 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          playsinline: 1,
          rel: 0,
        },
        events: {
          onReady(ev) {
            ytCreating = false;
            ytReady = true;
            try {
              ev.target.setVolume(Math.round(volume * 100));
              if (muted) ev.target.mute(); else ev.target.unMute();
              const cur = currentTrack();
              if (cur && cur.type === 'youtube') {
                if (shouldPlay()) {
                  if (cur.youtubeId !== track.youtubeId) {
                    desiredYtVideoId = cur.youtubeId;
                    ev.target.loadVideoById(cur.youtubeId);
                  } else {
                    ev.target.playVideo();
                  }
                } else {
                  ev.target.pauseVideo();
                }
              } else {
                ev.target.pauseVideo();
              }
            } catch { /* ignore */ }
          },
          onStateChange(ev) {
            const cur = currentTrack();
            if (ev.data === YT.PlayerState.PLAYING) {
              if (!shouldPlay() || !cur || cur.type !== 'youtube') {
                pauseYouTube();
                isPlaying = false;
              } else {
                isPlaying = true;
                errorStreak = 0;
              }
              updateUiState();
            } else if (ev.data === YT.PlayerState.PAUSED) {
              isPlaying = false;
              updateUiState();
            } else if (ev.data === YT.PlayerState.ENDED) {
              isPlaying = false;
              errorStreak = 0;
              updateUiState();
              if (shouldPlay() && cur && cur.type === 'youtube') {
                playRandomNext(false);
              }
            }
          },
          onError() {
            const cur = currentTrack();
            isPlaying = false;
            updateUiState();
            if (shouldPlay() && cur && cur.type === 'youtube') {
              errorStreak += 1;
              if (errorStreak < tracks.length) {
                playRandomNext(true);
              } else {
                setModalNotice('Không thể phát bài YouTube hiện tại.', true);
              }
            }
          },
        },
      });
    }).catch(() => {
      if (shouldPlay() && tracks.length > 1) {
        errorStreak += 1;
        if (errorStreak < tracks.length) playRandomNext(true);
      }
    });
  }

  function startDriveTrack(track) {
    pauseYouTube();
    if (!track || !track.fileId) return;
    const primaryUrl = `https://drive.google.com/uc?export=open&id=${encodeURIComponent(track.fileId)}`;
    triedDriveFallback = false;
    audioEl.volume = muted ? 0 : volume;
    if (audioEl.src !== primaryUrl) {
      audioEl.src = primaryUrl;
    }
    if (shouldPlay()) {
      const p = audioEl.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          // Bị trình duyệt chặn autoplay trước khi chạm: giữ nguyên currentId để mở khóa ở cú chạm đầu tiên
          isPlaying = false;
          updateUiState();
        });
      }
    }
  }

  function playTrack(track, { resetStreak = false } = {}) {
    if (!track) return;
    if (resetStreak) errorStreak = 0;
    if (currentId && currentId !== track.id) {
      lastPlayedId = currentId;
    }
    currentId = track.id;
    updateUiState();

    if (!shouldPlay()) return;

    if (track.type === 'drive') {
      startDriveTrack(track);
    } else if (track.type === 'youtube') {
      startYouTubeTrack(track);
    }
  }

  function playRandomNext(fromError = false) {
    if (!tracks.length) return;
    if (tracks.length === 1) {
      const only = tracks[0];
      if (fromError) return;
      currentId = only.id;
      if (!shouldPlay()) return;
      if (only.type === 'drive') {
        try { audioEl.currentTime = 0; } catch { /* ignore */ }
        startDriveTrack(only);
      } else if (only.type === 'youtube') {
        if (ytPlayer && ytReady && typeof ytPlayer.seekTo === 'function') {
          try {
            ytPlayer.seekTo(0, true);
            ytPlayer.playVideo();
          } catch {
            startYouTubeTrack(only);
          }
        } else {
          startYouTubeTrack(only);
        }
      }
      return;
    }
    const next = pickRandomTrack(currentId || lastPlayedId);
    if (next) playTrack(next);
  }

  function resumeOrStartRandom() {
    if (!shouldPlay()) return;
    const cur = currentTrack();
    if (!cur) {
      const picked = pickRandomTrack(lastPlayedId);
      if (picked) playTrack(picked, { resetStreak: true });
      return;
    }
    if (cur.type === 'drive') {
      const expectedOpen = `https://drive.google.com/uc?export=open&id=${encodeURIComponent(cur.fileId)}`;
      const expectedDl = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(cur.fileId)}`;
      if (audioEl.src !== expectedOpen && audioEl.src !== expectedDl) {
        startDriveTrack(cur);
      } else {
        audioEl.volume = muted ? 0 : volume;
        const p = audioEl.play();
        if (p && typeof p.catch === 'function') {
          p.catch(() => {
            isPlaying = false;
            updateUiState();
          });
        }
      }
    } else if (cur.type === 'youtube') {
      if (ytPlayer && ytReady && typeof ytPlayer.playVideo === 'function') {
        try {
          ytPlayer.setVolume(Math.round(volume * 100));
          if (muted) ytPlayer.mute(); else ytPlayer.unMute();
          ytPlayer.playVideo();
        } catch {
          startYouTubeTrack(cur);
        }
      } else {
        startYouTubeTrack(cur);
      }
    }
  }

  // Lắng nghe sự kiện trên <audio> Drive
  audioEl.addEventListener('playing', () => {
    const cur = currentTrack();
    if (!shouldPlay() || !cur || cur.type !== 'drive') {
      pauseDrive();
      isPlaying = false;
      updateUiState();
      return;
    }
    isPlaying = true;
    errorStreak = 0;
    updateUiState();
  });

  audioEl.addEventListener('pause', () => {
    const cur = currentTrack();
    if (!cur || cur.type === 'drive') {
      isPlaying = false;
      updateUiState();
    }
  });

  audioEl.addEventListener('ended', () => {
    const cur = currentTrack();
    isPlaying = false;
    errorStreak = 0;
    updateUiState();
    if (shouldPlay() && cur && cur.type === 'drive') {
      playRandomNext(false);
    }
  });

  audioEl.addEventListener('error', () => {
    const cur = currentTrack();
    if (!cur || cur.type !== 'drive') return;
    if (!triedDriveFallback && cur.fileId) {
      triedDriveFallback = true;
      const dlUrl = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(cur.fileId)}`;
      audioEl.src = dlUrl;
      if (shouldPlay()) {
        audioEl.play().catch(() => {
          isPlaying = false;
          updateUiState();
        });
      }
      return;
    }
    isPlaying = false;
    updateUiState();
    if (shouldPlay()) {
      errorStreak += 1;
      if (errorStreak < tracks.length) {
        playRandomNext(true);
      } else {
        setModalNotice('Không phát được file âm thanh Drive (kiểm tra quyền chia sẻ file).', true);
      }
    }
  });

  // Mở khóa Autoplay âm thầm ngay cú chạm / bấm phím đầu tiên
  function handleFirstUnlock(e) {
    unlocked = true;
    const t = e && e.target;
    if (t && typeof t.closest === 'function' && t.closest('#btnBgmMute, [data-bgm-mute]')) {
      return;
    }
    if (shouldPlay() && !isPlaying) {
      resumeOrStartRandom();
    }
  }
  document.addEventListener('pointerdown', handleFirstUnlock, { once: true, capture: true });
  document.addEventListener('keydown', handleFirstUnlock, { once: true, capture: true });

  // ---------- Giao diện Modal Quản lý Nhạc nền ----------
  let modalEl = null;

  function setModalNotice(msg = '', isError = false) {
    if (!modalEl) return;
    const el = modalEl.querySelector('#bgmModalNotice');
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('hidden', !msg);
    el.classList.toggle('is-error', Boolean(isError));
  }

  function ensureModal() {
    if (modalEl) return modalEl;
    const wrap = document.createElement('div');
    wrap.id = 'bgmModal';
    wrap.className = 'bgm-modal-backdrop hidden';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'bgmModalTitle');
    wrap.innerHTML = `
      <div class="bgm-modal-card">
        <div class="bgm-modal-head">
          <div class="bgm-modal-title-row">
            <div class="min-w-0">
              <h2 id="bgmModalTitle" class="bgm-modal-title">Nhạc nền phòng chờ</h2>
              <p id="bgmModalSub" class="bgm-modal-sub">Tự động phát ngẫu nhiên ở Trang chủ &amp; Sàn đấu · Tự dừng khi vào trận</p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <span id="bgmModalSyncBadge" class="chip">0 bài</span>
              <button id="btnCloseBgmModal" type="button" class="topic-modal-close" aria-label="Đóng">✕</button>
            </div>
          </div>

          <div class="bgm-player-bar">
            <div class="bgm-now-playing min-w-0">
              <span id="bgmNowDot" class="bgm-now-dot" aria-hidden="true"></span>
              <div class="min-w-0">
                <div id="bgmNowTitle" class="bgm-now-title">Chưa chọn bài hát</div>
                <div id="bgmNowState" class="bgm-now-state">Sẵn sàng</div>
              </div>
            </div>
            <div class="bgm-player-controls">
              <button id="btnBgmModalTogglePlay" type="button" class="btn btn-ghost btn-sm" title="Phát / Tạm dừng">▶ Phát</button>
              <button id="btnBgmModalNext" type="button" class="btn btn-ghost btn-sm" title="Đổi sang bài ngẫu nhiên khác">🔀 Đổi bài</button>
              <div class="bgm-vol-wrap" title="Âm lượng nhạc nền">
                <button id="btnBgmModalMute" type="button" class="bgm-vol-btn" aria-label="Bật/tắt tiếng nhạc nền">🎵</button>
                <input id="bgmModalVol" type="range" min="0" max="100" step="1" class="vol-range vol-range-mini" />
                <span id="bgmModalVolLabel" class="bgm-vol-pct font-num">45%</span>
              </div>
            </div>
          </div>
        </div>

        <div class="bgm-modal-body">
          <div id="bgmModalNotice" class="bgm-notice hidden" role="status"></div>

          <div id="bgmReadOnlyNotice" class="bgm-readonly-box hidden">
            🔒 <span>Chế độ chỉ xem &amp; nghe nhạc — Cần cấu hình <b>Apps Script Web App URL</b> và <b>Folder ID</b> hợp lệ tại trang <b>Chủ đề</b> để thêm hoặc xóa bài hát của bạn.</span>
          </div>

          <div id="bgmAddSection" class="bgm-add-card hidden">
            <div class="bgm-add-head">
              <span class="eyebrow !mb-0">Thêm nhạc nền mới</span>
              <div class="seg bgm-tabs" role="tablist" aria-label="Nguồn nhạc nền">
                <button id="btnBgmTabDrive" type="button" role="tab" aria-selected="true" class="active">⬆ File lên Drive</button>
                <button id="btnBgmTabYoutube" type="button" role="tab" aria-selected="false">🔗 Link YouTube</button>
              </div>
            </div>

            <div id="bgmPanelDrive" class="bgm-add-panel">
              <div class="bgm-form-grid">
                <input id="bgmDriveTitle" type="text" class="input" maxlength="120" placeholder="Tên bài hát (để trống sẽ lấy tên file)…" />
                <div class="flex items-center gap-2">
                  <button id="btnBgmPickAudio" type="button" class="btn btn-ok btn-sm flex-1">⬆ Chọn file (.mp3, .m4a, .wav, .ogg)</button>
                  <input id="bgmDriveFileInput" type="file" accept=".mp3,.m4a,.wav,.ogg,audio/mpeg,audio/mp4,audio/wav,audio/ogg" class="hidden" />
                </div>
              </div>
              <p id="bgmDriveHint" class="bgm-hint">File được tải lên thư mục Google Drive của bạn qua Apps Script và đồng bộ cho mọi thiết bị.</p>
            </div>

            <div id="bgmPanelYoutube" class="bgm-add-panel hidden">
              <div class="bgm-form-grid">
                <input id="bgmYtTitle" type="text" class="input" maxlength="120" placeholder="Tên bài hát (tùy chọn — tự lấy tên video nếu bỏ trống)…" />
                <div class="flex items-center gap-2">
                  <input id="bgmYtUrl" type="url" class="input flex-1" placeholder="Dán link YouTube (watch?v=, youtu.be/, shorts/)…" />
                  <button id="btnBgmAddYoutube" type="button" class="btn btn-ok btn-sm shrink-0">Thêm</button>
                </div>
              </div>
              <p class="bgm-hint">Hỗ trợ mọi định dạng link YouTube. Phát âm thanh ẩn, tự chuyển bài khi kết thúc.</p>
            </div>
          </div>

          <div class="bgm-list-wrap">
            <div class="flex items-center justify-between gap-2 mb-2.5">
              <span class="eyebrow !mb-0">Danh sách nhạc nền (<span id="bgmListCount">0</span>)</span>
              <span id="bgmSyncModeText" class="bgm-sync-meta"></span>
            </div>
            <div id="bgmTrackList" class="bgm-track-list"></div>
          </div>
        </div>
      </div>`;

    document.body.appendChild(wrap);
    modalEl = wrap;
    bindModalEvents(wrap);
    return wrap;
  }

  function bindModalEvents(wrap) {
    wrap.addEventListener('mousedown', (e) => {
      if (e.target === wrap) closeModal();
    });
    const closeBtn = wrap.querySelector('#btnCloseBgmModal');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    const tabDrive = wrap.querySelector('#btnBgmTabDrive');
    const tabYt = wrap.querySelector('#btnBgmTabYoutube');
    const switchTab = (tab) => {
      activeTab = tab;
      if (tabDrive) {
        tabDrive.classList.toggle('active', tab === 'drive');
        tabDrive.setAttribute('aria-selected', String(tab === 'drive'));
      }
      if (tabYt) {
        tabYt.classList.toggle('active', tab === 'youtube');
        tabYt.setAttribute('aria-selected', String(tab === 'youtube'));
      }
      const pDrive = wrap.querySelector('#bgmPanelDrive');
      const pYt = wrap.querySelector('#bgmPanelYoutube');
      if (pDrive) pDrive.classList.toggle('hidden', tab !== 'drive');
      if (pYt) pYt.classList.toggle('hidden', tab !== 'youtube');
      setModalNotice('');
    };
    if (tabDrive) tabDrive.addEventListener('click', () => switchTab('drive'));
    if (tabYt) tabYt.addEventListener('click', () => switchTab('youtube'));

    const togglePlayBtn = wrap.querySelector('#btnBgmModalTogglePlay');
    if (togglePlayBtn) {
      togglePlayBtn.addEventListener('click', () => {
        unlocked = true;
        if (arenaPaused) {
          setModalNotice('Đang ở trong trận đấu — nhạc nền tự động tạm dừng.', false);
          return;
        }
        if (!tracks.length) {
          setModalNotice('Danh sách nhạc nền đang trống.', true);
          return;
        }
        if (muted) {
          setMuted(false);
        }
        if (isPlaying) {
          manualPreviewing = false;
          pauseAllInternal();
        } else {
          manualPreviewing = true;
          resumeOrStartRandom();
        }
      });
    }

    const nextBtn = wrap.querySelector('#btnBgmModalNext');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        unlocked = true;
        if (arenaPaused) {
          setModalNotice('Đang ở trong trận đấu — nhạc nền tự động tạm dừng.', false);
          return;
        }
        if (!tracks.length) return;
        if (muted) setMuted(false);
        manualPreviewing = true;
        errorStreak = 0;
        playRandomNext(false);
      });
    }

    const modalMuteBtn = wrap.querySelector('#btnBgmModalMute');
    if (modalMuteBtn) {
      modalMuteBtn.addEventListener('click', () => {
        unlocked = true;
        setMuted(!muted);
      });
    }

    const volSlider = wrap.querySelector('#bgmModalVol');
    if (volSlider) {
      volSlider.value = String(Math.round(volume * 100));
      volSlider.addEventListener('input', (e) => {
        const pct = Math.max(0, Math.min(100, Number(e.target.value) || 0));
        setVolume(pct / 100);
      });
    }

    // Upload file lên Drive
    const pickBtn = wrap.querySelector('#btnBgmPickAudio');
    const fileInp = wrap.querySelector('#bgmDriveFileInput');
    if (pickBtn && fileInp) {
      pickBtn.addEventListener('click', () => {
        if (!hasValidDriveKey() || uploading) return;
        fileInp.click();
      });
      fileInp.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;
        await handleDriveAudioUpload(file);
      });
    }

    // Thêm link YouTube
    const addYtBtn = wrap.querySelector('#btnBgmAddYoutube');
    const ytUrlInp = wrap.querySelector('#bgmYtUrl');
    if (addYtBtn) addYtBtn.addEventListener('click', handleAddYouTube);
    if (ytUrlInp) {
      ytUrlInp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleAddYouTube();
        }
      });
    }

    // Event delegation cho danh sách bài hát (Nghe / Xóa)
    const listEl = wrap.querySelector('#bgmTrackList');
    if (listEl) {
      listEl.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-bgm-act]');
        if (!btn) return;
        const row = btn.closest('[data-bgm-id]');
        if (!row) return;
        const id = row.dataset.bgmId;
        const track = tracks.find((t) => t.id === id);
        if (!track) return;
        const act = btn.dataset.bgmAct;

        if (act === 'play') {
          unlocked = true;
          if (arenaPaused) {
            setModalNotice('Đang ở trong trận đấu — nhạc nền tạm khóa cho tới khi về sàn.', false);
            return;
          }
          if (currentId === track.id && isPlaying) {
            manualPreviewing = false;
            pauseAllInternal();
            return;
          }
          if (muted) setMuted(false);
          manualPreviewing = true;
          playTrack(track, { resetStreak: true });
        } else if (act === 'delete') {
          await handleDeleteTrack(track, btn);
        }
      });
    }
  }

  async function handleDriveAudioUpload(file) {
    if (uploading) return;
    const identity = getDriveIdentity();
    if (!hasValidDriveKey()) {
      setModalNotice('Chưa có Apps Script Web App URL và Folder ID hợp lệ.', true);
      return;
    }
    const mime = inferAudioMime(file);
    if (!AUDIO_EXT_RE.test(file.name || '') && !String(file.type || '').startsWith('audio/')) {
      setModalNotice('Chỉ hỗ trợ file âm thanh .mp3, .m4a, .wav, .ogg.', true);
      return;
    }
    if (file.size > MAX_AUDIO_UPLOAD_BYTES) {
      setModalNotice('File quá lớn (> 25MB). Vui lòng nén nhỏ hơn hoặc dùng link YouTube.', true);
      return;
    }

    const pickBtn = modalEl && modalEl.querySelector('#btnBgmPickAudio');
    const titleInp = modalEl && modalEl.querySelector('#bgmDriveTitle');
    const customTitle = titleInp ? titleInp.value.trim() : '';

    uploading = true;
    if (pickBtn) {
      pickBtn.disabled = true;
      pickBtn.textContent = '⏳ Đang tải lên Drive…';
    }
    setModalNotice(`Đang tải “${file.name}” lên Google Drive…`);

    try {
      const data = await readBase64(file);
      const res = await fetch(identity.scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          folderId: identity.folderId,
          name: `bgm_${Date.now()}_${file.name}`,
          mime,
          data,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json || !json.ok || !json.id) {
        throw new Error((json && json.error) || 'Apps Script từ chối tải file lên.');
      }

      const fileId = String(json.id).trim();
      const track = {
        id: `bgm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        title: customTitle || cleanAudioTitle(file.name),
        type: 'drive',
        url: `https://drive.google.com/uc?export=open&id=${fileId}`,
        fileId,
        youtubeId: '',
        ownerScriptUrl: identity.scriptUrl,
        ownerFolderId: identity.folderId,
        createdAt: Date.now(),
      };

      const saved = bgmSync ? await bgmSync.putBgm(track, identity) : false;
      if (!saved) throw new Error('Không lưu được bài hát lên Firebase.');

      if (titleInp) titleInp.value = '';
      setModalNotice(`✅ Đã tải lên & đồng bộ “${track.title}”.`);
    } catch (err) {
      setModalNotice(`❌ Lỗi tải file: ${err && err.message ? err.message : err}`, true);
    } finally {
      uploading = false;
      if (pickBtn) {
        pickBtn.disabled = false;
        pickBtn.textContent = '⬆ Chọn file (.mp3, .m4a, .wav, .ogg)';
      }
    }
  }

  async function handleAddYouTube() {
    const identity = getDriveIdentity();
    if (!hasValidDriveKey()) {
      setModalNotice('Chưa có Apps Script Web App URL và Folder ID hợp lệ.', true);
      return;
    }
    const urlInp = modalEl && modalEl.querySelector('#bgmYtUrl');
    const titleInp = modalEl && modalEl.querySelector('#bgmYtTitle');
    const addBtn = modalEl && modalEl.querySelector('#btnBgmAddYoutube');
    const rawUrl = urlInp ? urlInp.value.trim() : '';
    const ytId = extractYouTubeId(rawUrl);
    if (!ytId) {
      setModalNotice('Link YouTube không hợp lệ (hỗ trợ watch?v=, youtu.be/, shorts/).', true);
      return;
    }

    if (addBtn) {
      addBtn.disabled = true;
      addBtn.textContent = 'Đang thêm…';
    }
    try {
      let title = titleInp ? titleInp.value.trim() : '';
      if (!title) {
        title = (await fetchYouTubeTitle(ytId)) || `YouTube (${ytId})`;
      }
      const track = {
        id: `bgm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        title,
        type: 'youtube',
        url: `https://www.youtube.com/watch?v=${ytId}`,
        fileId: '',
        youtubeId: ytId,
        ownerScriptUrl: identity.scriptUrl,
        ownerFolderId: identity.folderId,
        createdAt: Date.now(),
      };
      const saved = bgmSync ? await bgmSync.putBgm(track, identity) : false;
      if (!saved) throw new Error('Không lưu được bài hát lên Firebase.');
      if (urlInp) urlInp.value = '';
      if (titleInp) titleInp.value = '';
      setModalNotice(`✅ Đã thêm “${track.title}” vào danh sách nhạc nền.`);
    } catch (err) {
      setModalNotice(`❌ ${err && err.message ? err.message : err}`, true);
    } finally {
      if (addBtn) {
        addBtn.disabled = false;
        addBtn.textContent = 'Thêm';
      }
    }
  }

  async function handleDeleteTrack(track, btnEl) {
    const identity = getDriveIdentity();
    if (!hasValidDriveKey() || !canIdentityModifyBgm(track, identity)) {
      setModalNotice('🔒 Bạn không phải chủ sở hữu bài hát này.', true);
      return;
    }
    if (btnEl) btnEl.disabled = true;

    let driveWarn = '';
    if (track.type === 'drive' && track.fileId) {
      setModalNotice(`Đang xóa file “${track.title}” trên Google Drive…`);
      try {
        const res = await fetch(identity.scriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'deleteTopicFolder',
            folderId: identity.folderId,
            fileIds: [track.fileId],
          }),
        });
        if (!res.ok) driveWarn = `HTTP ${res.status}`;
      } catch (err) {
        driveWarn = (err && err.message) || 'Không gọi được Apps Script';
      }
    }

    if (currentId === track.id) {
      pauseAllInternal();
      currentId = '';
    }
    if (bgmSync) {
      await bgmSync.removeBgm(track.id);
    }
    setModalNotice(
      driveWarn
        ? `Đã xóa khỏi danh sách (lưu ý Drive: ${driveWarn}).`
        : `Đã xóa “${track.title}”.`,
      Boolean(driveWarn),
    );
  }

  function renderModal() {
    if (!modalEl || modalEl.classList.contains('hidden')) return;
    const canAdd = hasValidDriveKey();
    const identity = getDriveIdentity();

    const addSec = modalEl.querySelector('#bgmAddSection');
    const roNotice = modalEl.querySelector('#bgmReadOnlyNotice');
    if (addSec) addSec.classList.toggle('hidden', !canAdd);
    if (roNotice) roNotice.classList.toggle('hidden', canAdd);

    const listCountEl = modalEl.querySelector('#bgmListCount');
    if (listCountEl) listCountEl.textContent = String(tracks.length);

    const badgeEl = modalEl.querySelector('#bgmModalSyncBadge');
    if (badgeEl) badgeEl.textContent = `${tracks.length} bài`;

    const modeEl = modalEl.querySelector('#bgmSyncModeText');
    if (modeEl) {
      modeEl.textContent = syncStatus.state === 'synced'
        ? '☁️ Đồng bộ shared_bgm'
        : (syncStatus.message || '');
    }

    const cur = currentTrack();
    const nowTitle = modalEl.querySelector('#bgmNowTitle');
    const nowState = modalEl.querySelector('#bgmNowState');
    const nowDot = modalEl.querySelector('#bgmNowDot');
    if (nowTitle) nowTitle.textContent = cur ? cur.title : (tracks.length ? 'Sẵn sàng phát ngẫu nhiên' : 'Chưa có bài hát');
    if (nowState) {
      nowState.textContent = arenaPaused
        ? 'Tạm dừng trong trận đấu'
        : muted
          ? 'Đang tắt tiếng'
          : isPlaying
            ? `Đang phát · ${cur && cur.type === 'youtube' ? 'YouTube' : 'Google Drive'}`
            : (cur ? 'Đang chờ phát' : 'Chờ thêm nhạc nền');
    }
    if (nowDot) nowDot.classList.toggle('active', Boolean(isPlaying && !muted && !arenaPaused));

    const playBtn = modalEl.querySelector('#btnBgmModalTogglePlay');
    if (playBtn) {
      playBtn.textContent = isPlaying ? '⏸ Tạm dừng' : '▶ Phát';
      playBtn.disabled = !tracks.length || arenaPaused;
    }
    const nextBtn = modalEl.querySelector('#btnBgmModalNext');
    if (nextBtn) nextBtn.disabled = tracks.length < 1 || arenaPaused;

    const muteBtn = modalEl.querySelector('#btnBgmModalMute');
    if (muteBtn) {
      muteBtn.textContent = muted ? '🔇' : '🎵';
      muteBtn.classList.toggle('is-muted', muted);
    }
    const volInp = modalEl.querySelector('#bgmModalVol');
    const volLbl = modalEl.querySelector('#bgmModalVolLabel');
    const pct = Math.round((muted ? 0 : volume) * 100);
    if (volInp && document.activeElement !== volInp) volInp.value = String(Math.round(volume * 100));
    if (volLbl) volLbl.textContent = muted ? 'Tắt' : `${pct}%`;

    const listEl = modalEl.querySelector('#bgmTrackList');
    if (!listEl) return;
    if (!tracks.length) {
      listEl.innerHTML = '<div class="bgm-empty">Chưa có bài nhạc nền nào trong <code>shared_bgm</code>.</div>';
      return;
    }

    const frag = document.createDocumentFragment();
    tracks.forEach((tr) => {
      const isCur = tr.id === currentId;
      const playingThis = isCur && isPlaying;
      const canDel = canAdd && canIdentityModifyBgm(tr, identity);
      const row = document.createElement('div');
      row.className = `bgm-track-row${isCur ? ' is-current' : ''}${playingThis ? ' is-playing' : ''}`;
      row.dataset.bgmId = tr.id;
      row.innerHTML = `
        <button type="button" data-bgm-act="play" class="bgm-row-play" title="${playingThis ? 'Tạm dừng' : 'Phát bài này'}">${playingThis ? '⏸' : '▶'}</button>
        <div class="bgm-row-info min-w-0">
          <div class="bgm-row-title">${esc(tr.title)}</div>
          <div class="bgm-row-meta">
            <span class="bgm-type-pill">${tr.type === 'youtube' ? 'YouTube' : 'Drive Audio'}</span>
            ${isCur ? `<span class="bgm-cur-pill">${playingThis ? 'Đang phát' : 'Đã chọn'}</span>` : ''}
          </div>
        </div>
        <div class="bgm-row-actions">
          ${canDel
            ? '<button type="button" data-bgm-act="delete" class="btn btn-pass btn-sm bgm-del-btn" title="Xóa bài hát">✕</button>'
            : '<span class="bgm-lock-tag" title="Chỉ chủ sở hữu Drive key đã đăng mới có quyền xóa">🔒</span>'}
        </div>`;
      frag.appendChild(row);
    });
    listEl.innerHTML = '';
    listEl.appendChild(frag);
  }

  function updateHeaderButtons() {
    const muteBtns = document.querySelectorAll('#btnBgmMute, [data-bgm-mute]');
    muteBtns.forEach((btn) => {
      btn.textContent = muted ? '🔇' : '🎵';
      btn.title = muted
        ? 'Đang tắt nhạc nền — Bấm để bật'
        : (isPlaying ? 'Đang phát nhạc nền — Bấm để tắt tiếng' : 'Bật / tắt tiếng nhạc nền');
      btn.setAttribute('aria-pressed', String(!muted));
      btn.classList.toggle('is-muted', muted);
      btn.classList.toggle('is-playing', !muted && isPlaying && !arenaPaused);
    });
    const countEl = document.getElementById('bgmCountChip');
    if (countEl) countEl.textContent = `${tracks.length} bài`;
  }

  function updateUiState() {
    updateHeaderButtons();
    renderModal();
    uiListeners.forEach((cb) => {
      try { cb(); } catch { /* ignore */ }
    });
  }

  function setMuted(nextMuted) {
    muted = Boolean(nextMuted);
    safeSetLocal(BGM_MUTE_KEY, muted ? '1' : '0');
    audioEl.volume = muted ? 0 : volume;
    if (ytPlayer && ytReady && typeof ytPlayer.mute === 'function') {
      try {
        if (muted) ytPlayer.mute();
        else {
          ytPlayer.unMute();
          ytPlayer.setVolume(Math.round(volume * 100));
        }
      } catch { /* ignore */ }
    }
    if (muted) {
      pauseAllInternal();
    } else if (shouldPlay()) {
      resumeOrStartRandom();
    }
    updateUiState();
  }

  function setVolume(nextVol01) {
    volume = clamp01(nextVol01, 0.45);
    safeSetLocal(BGM_VOL_KEY, String(volume));
    if (volume > 0 && muted) {
      muted = false;
      safeSetLocal(BGM_MUTE_KEY, '0');
    }
    audioEl.volume = muted ? 0 : volume;
    if (ytPlayer && ytReady && typeof ytPlayer.setVolume === 'function') {
      try {
        ytPlayer.setVolume(Math.round(volume * 100));
        if (!muted) ytPlayer.unMute();
      } catch { /* ignore */ }
    }
    updateUiState();
  }

  function openModal() {
    const m = ensureModal();
    setModalNotice('');
    m.classList.remove('hidden');
    renderModal();
  }

  function closeModal() {
    if (modalEl) modalEl.classList.add('hidden');
  }

  function bindTriggers() {
    document.querySelectorAll('#btnBgmMute, [data-bgm-mute]').forEach((btn) => {
      if (btn.dataset.bgmBound) return;
      btn.dataset.bgmBound = '1';
      btn.addEventListener('click', () => {
        unlocked = true;
        setMuted(!muted);
      });
    });
    document.querySelectorAll('#btnBgmModal, [data-open-bgm-modal]').forEach((btn) => {
      if (btn.dataset.bgmBound) return;
      btn.dataset.bgmBound = '1';
      btn.addEventListener('click', () => {
        unlocked = true;
        openModal();
      });
    });
  }

  function applyTracks(nextList) {
    tracks = Array.isArray(nextList) ? nextList : [];
    safeSetLocal(BGM_CACHE_KEY, JSON.stringify(tracks));
    maybeLazyLoadYouTube();

    const stillExists = currentId && tracks.some((t) => t.id === currentId);
    if (!stillExists) {
      if (isPlaying) pauseAllInternal();
      currentId = '';
      if (tracks.length) {
        const picked = pickRandomTrack(lastPlayedId);
        if (picked) {
          currentId = picked.id;
          if (shouldPlay() && (unlocked || picked.type === 'drive' || picked.type === 'youtube')) {
            playTrack(picked, { resetStreak: true });
          }
        }
      }
    } else if (shouldPlay() && unlocked && !isPlaying && autoPlayAllowed) {
      resumeOrStartRandom();
    }
    updateUiState();
  }

  // Khởi tạo đồng bộ Firebase `shared_bgm`
  async function connectSync() {
    let fbCfg = options.firebaseConfig || null;
    if (!fbCfg) {
      try { fbCfg = loadFirebaseConfig(); } catch { fbCfg = null; }
    }
    try {
      bgmSync = await createSharedBgmSync(fbCfg);
      if (disposed) {
        bgmSync.dispose();
        return;
      }
      bgmSync.onStatus((st) => {
        syncStatus = st || syncStatus;
        renderModal();
      });
      bgmSync.subscribe((list) => {
        applyTracks(list);
      });
    } catch (err) {
      console.warn('Không khởi tạo được shared_bgm:', err);
    }
  }

  function onStorage(e) {
    if (!e || !e.key) return;
    if (e.key === BGM_MUTE_KEY) {
      const nextMuted = safeGetLocal(BGM_MUTE_KEY, '0') === '1';
      if (nextMuted !== muted) setMuted(nextMuted);
    } else if (e.key === BGM_VOL_KEY) {
      const nextVol = clamp01(safeGetLocal(BGM_VOL_KEY, '0.45'), 0.45);
      if (Math.abs(nextVol - volume) > 0.005) setVolume(nextVol);
    } else if (e.key === BGM_CACHE_KEY) {
      applyTracks(readCachedTracks());
    } else if (e.key === 'thefloor:drive') {
      renderModal();
    }
  }

  function onKeydown(e) {
    if (e.key === 'Escape' && modalEl && !modalEl.classList.contains('hidden')) {
      e.preventDefault();
      closeModal();
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    pauseAllInternal();
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('keydown', onKeydown);
    window.removeEventListener('pagehide', dispose);
    if (bgmSync && typeof bgmSync.dispose === 'function') {
      bgmSync.dispose();
    }
    if (window.__theFloorBgmController === api) {
      delete window.__theFloorBgmController;
    }
  }

  bindTriggers();
  window.addEventListener('storage', onStorage);
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('pagehide', dispose);

  // Nạp trước cache cục bộ ngay lập tức (0ms)
  if (tracks.length) {
    applyTracks(tracks);
  } else {
    updateUiState();
  }
  connectSync();

  const api = {
    /**
     * Điều khiển tạm dừng / tiếp tục theo trạng thái Đấu trường (Trang 2 vs Trang 3).
     * Khi `inDuel === true` -> dừng hẳn (`pause`) nhạc nền ngay lập tức.
     * Khi `inDuel === false` -> tự động phát tiếp nếu không bị tắt tiếng.
     */
    setArenaPaused(inDuel) {
      const nextPaused = Boolean(inDuel);
      if (nextPaused === arenaPaused) return;
      arenaPaused = nextPaused;
      if (arenaPaused) {
        pauseAllInternal();
      } else if (shouldPlay()) {
        resumeOrStartRandom();
      } else {
        updateUiState();
      }
    },
    pausePreview() {
      manualPreviewing = false;
      pauseAllInternal();
    },
    refreshDriveIdentity() {
      renderModal();
    },
    setAutoPlayAllowed(allowed) {
      autoPlayAllowed = Boolean(allowed);
      if (autoPlayAllowed && shouldPlay() && !isPlaying) {
        resumeOrStartRandom();
      }
    },
    getUiSnapshot() {
      return { muted, isPlaying, arenaPaused, count: tracks.length };
    },
    onUiChange(cb) {
      if (typeof cb !== 'function') return () => {};
      uiListeners.add(cb);
      return () => uiListeners.delete(cb);
    },
    openModal,
    closeModal,
    setMuted,
    isMuted: () => muted,
    dispose,
  };

  window.__theFloorBgmController = api;
  return api;
}
