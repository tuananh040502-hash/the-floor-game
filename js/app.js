import { loadFirebaseConfig } from './firebase-config.js';
import { openFirebaseSettings } from './settings.js';
import { createTransport, createSharedTopicsSync, sanitizeCloudTopic } from './transport.js';
import { allCategories, TOPICS_KEY, loadTopicAudioIDB, clampVolume01 } from './topics.js';
import {
  createInitialState, reduce, remainingOf, countdownRemainingOf, extractImageUrls,
  playerById, cellCount, currentQuestion, DUEL_MS, COUNTDOWN_MS, alivePlayers,
  clampPlayerCount, DEFAULT_PLAYER_COUNT, clampDurationSec,
  normalizeImageUrl, driveFallbackUrl, preloadWindow, safeAllCategories,
} from './engine.js?v=fixfloor3';
import { Sfx } from './audio.js';
import { Fireworks } from './fx.js';
import { preloadImages, pruneCache, getCached, getProgress, onPreloadProgress, toCdnUrl } from './preload.js';

const $ = (id) => document.getElementById(id);
const MAX_TOPIC_IMAGES = 100;
const SIDE_COLOR = { A: '#0a84ff', B: '#ff7a59' };
const RING_LEN = 552.92;
const GRACE_WAIT_MS = 2000; // giữ thêm tối đa 2s nếu ảnh câu đầu chưa tải xong
const ICONS = {
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
};

// ---------- Tham số trang ----------
const params = new URLSearchParams(location.search);
const room = (params.get('room') || 'FLOOR').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20) || 'FLOOR';
const roleParam = (params.get('role') || 'host').toLowerCase();
const requestedHost = roleParam !== 'view' && roleParam !== 'viewer';
const pinKey = `thefloor:pin:${room}`;

let role = requestedHost ? 'host' : 'view';
let controller = requestedHost; // được phép điều khiển (Host hoặc đã mở khóa PIN)
let state = null;
let transport = null;
let firstSnapshot = true;
let lastEventId = null;
let prevPhase = null;
let tickPending = false;
let passCompletePending = false;
let goPending = false;
let lastCdSec = -1;
let cdDurationMs = Number(localStorage.getItem('thefloor:cdMs')) || COUNTDOWN_MS;
let lastPreloadSig = '';
let lastVictoryUrl = '';
let floorBuilt = false;
let floorBuiltCount = 0;
let uiTimer = null;
let artKey = '';
let fx = null;
let fxKey = '';
let topicsSync = null;
let sharedCustomTopics = null;
let initialTopicsMigrated = false;
const conn = { base: '…', latency: '', error: '' };
const ANIM_CLASSES = [
  'stagger-item', 'anim-from-top', 'anim-from-bottom', 'anim-from-left',
  'anim-from-right', 'anim-zoom-center', 'anim-d0', 'anim-d1', 'anim-d2', 'anim-d3',
];
const STAGGER_SELECTOR = [
  'header.appbar',
  '.floor-header',
  '.floor-stage',
  '.floor-grid > .cell',
  '#viewFloor aside > .panel:not(.hidden)',
  '#setupPanel:not(.hidden) > *',
  '.arena-top-bar',
  '#qWrap',
  '#cardA',
  '#dock:not(.hidden)',
  '#cardB',
  '.window-side > *',
  '.window-main > div:not(.hidden)',
  '.group',
  '.dropzone',
  '.topic-item',
  '.photo-card',
].join(', ');

// ---------- Khởi động ----------
async function init() {
  if (document.body) document.body.classList.remove('page-exiting');
  window.__unlockFloorAudio = () => {
    try { Sfx.unlock(); } catch { /* ignore */ }
  };
  if ($('roomLabel')) $('roomLabel').textContent = room;
  if ($('gateRoom')) $('gateRoom').textContent = room;
  if ($('fx')) fx = new Fireworks($('fx'));
  bindStaticUi();

  // Khởi tạo và hiển thị ngay bàn cờ cục bộ để giao diện phía sau luôn sẵn sàng tức thì
  const initialLocal = createInitialState(
    sessionStorage.getItem(pinKey) || '',
    clampPlayerCount(localStorage.getItem('thefloor:playerCount') || DEFAULT_PLAYER_COUNT),
  );
  const savedDur = localStorage.getItem('thefloor:defaultDurationSec');
  if (savedDur) {
    const sec = clampDurationSec(savedDur);
    initialLocal.players.forEach((p) => { p.durationSec = sec; });
  }
  if (requestedHost) {
    role = 'host';
    controller = true;
  }
  state = initialLocal;
  applyState(state, false);

  const fbCfg = loadFirebaseConfig();
  transport = await createTransport(room, fbCfg);
  transport.onStatus(onConnStatus);
  if (transport.mode === 'local') {
    onConnStatus({ type: 'local' });
    if (transport.fallbackReason) showConnError(`Firebase lỗi (${transport.fallbackReason}) — đang dùng chế độ cục bộ.`);
  }
  initSharedTopics(fbCfg);
  transport.subscribe(onSnapshot);
  startUiTimer();
}

async function initSharedTopics(fbCfg) {
  try {
    topicsSync = await createSharedTopicsSync(fbCfg);
    topicsSync.onStatus((st) => {
      const badge = $('gameTopicsCloudBadge');
      if (!badge) return;
      if (st.state === 'synced') {
        const n = Array.isArray(sharedCustomTopics) ? sharedCustomTopics.length : (st.count ?? 0);
        badge.textContent = `☁️ Kho dùng chung (${n} chủ đề riêng)`;
      } else if (st.state === 'syncing') {
        badge.textContent = '⏳ Đang đồng bộ chủ đề…';
      } else if (st.state === 'local') {
        badge.textContent = '💻 Chủ đề cục bộ';
      } else {
        badge.textContent = '⚠️ Dùng bản lưu tạm';
      }
    });
    topicsSync.subscribe(async (cloudList) => {
      const cloudById = new Map((cloudList || []).map((t) => [t.id, t]));
      if (!initialTopicsMigrated) {
        initialTopicsMigrated = true;
        try {
          const localRaw = JSON.parse(localStorage.getItem(TOPICS_KEY) || '[]');
          if (Array.isArray(localRaw) && topicsSync.mode === 'firebase') {
            const missing = localRaw.filter((lt) => lt && lt.id && !cloudById.has(lt.id));
            if (missing.length) {
              missing.forEach((lt) => {
                const clean = sanitizeCloudTopic(lt, MAX_TOPIC_IMAGES);
                if (clean) cloudById.set(clean.id, clean);
              });
              await topicsSync.putMany(missing);
            }
          }
        } catch { /* ignore */ }
      }
      sharedCustomTopics = [...cloudById.values()].map((t) => ({
        ...t,
        items: Array.isArray(t?.items) ? t.items : [],
      }));
      try {
        localStorage.setItem(TOPICS_KEY, JSON.stringify(sharedCustomTopics));
      } catch { /* ignore */ }
      const badge = $('gameTopicsCloudBadge');
      if (badge && topicsSync.mode === 'firebase') {
        badge.textContent = `☁️ Kho dùng chung (${sharedCustomTopics.length} chủ đề riêng)`;
      }
      if (state) {
        if (state.phase === 'floor' || state.phase === 'lobby') renderFloor(state);
        syncPreload(state);
        updatePreloadBadges();
      }
    });
  } catch (err) {
    console.warn('Không khởi tạo được shared_topics:', err);
  }
}

/** Đồng hồ giao diện: cập nhật DOM mỗi 100ms (10fps) thay vì 60-120fps để giảm tải CPU/nhiệt. */
function startUiTimer() {
  if (uiTimer) clearInterval(uiTimer);
  uiTimer = setInterval(frame, 100);
  window.addEventListener('pagehide', () => {
    clearInterval(uiTimer);
    if (fx) fx.destroy();
    if (transport && transport.dispose) transport.dispose();
    if (topicsSync && topicsSync.dispose) topicsSync.dispose();
  });
}

function paintConn() {
  $('connLabel').textContent = `${conn.base}${conn.latency ? ` · ${conn.latency}` : ''}`;
  $('connLabel').title = conn.error || '';
  $('connLabel').style.borderColor = conn.error ? '#ef4444' : '';
}
function showConnError(message) {
  conn.error = message;
  conn.base = '● Lỗi kết nối';
  paintConn();
}
function onConnStatus(ev) {
  if (ev.type === 'online') { conn.base = '● Realtime'; conn.error = ''; }
  else if (ev.type === 'offline') { conn.base = '● Mất kết nối'; conn.latency = ''; }
  else if (ev.type === 'local') { conn.base = '● Cục bộ'; }
  else if (ev.type === 'latency') { conn.latency = `${ev.ms}ms`; $('connLabel').title = `Khứ hồi ${ev.rtt}ms`; }
  else if (ev.type === 'error') return showConnError(ev.message);
  paintConn();
  if (ev.type === 'latency') $('connLabel').title = `Khứ hồi ${ev.rtt}ms`;
}

function buildDefaultState() {
  const fresh = createInitialState(
    sessionStorage.getItem(pinKey) || '',
    clampPlayerCount(localStorage.getItem('thefloor:playerCount') || DEFAULT_PLAYER_COUNT),
  );
  const savedDur = localStorage.getItem('thefloor:defaultDurationSec');
  if (savedDur) {
    const sec = clampDurationSec(savedDur);
    fresh.players.forEach((p) => { p.durationSec = sec; });
  }
  return fresh;
}

function onSnapshot(remote) {
  try {
    if (!remote || typeof remote !== 'object') {
      const fresh = normalize(state || buildDefaultState());
      if (requestedHost) {
        role = 'host';
        controller = true;
        state = fresh;
        if (transport && typeof transport.write === 'function') {
          try { transport.write(fresh); } catch { /* ignore */ }
        }
        firstSnapshot = false;
        applyState(fresh, false);
      } else {
        state = fresh;
        applyState(fresh, false);
      }
      return;
    }
    if (firstSnapshot) {
      if (requestedHost) {
        role = 'host';
        controller = true;
      } else {
        controller = Boolean(remote.pin && sessionStorage.getItem(`${pinKey}:unlocked`) === remote.pin);
      }
    }
    state = normalize(remote);
    applyState(state, !firstSnapshot);
    firstSnapshot = false;
  } catch (err) {
    console.error('Lỗi xử lý onSnapshot:', err);
    if (!state) state = buildDefaultState();
    try { render(state); } catch { /* ignore */ }
  }
}

/** Firebase bỏ mảng/object rỗng — khôi phục các trường bắt buộc & chuẩn hóa trạng thái phòng chờ. */
function normalize(raw) {
  const fallback = buildDefaultState();
  const s = (raw && typeof raw === 'object') ? raw : fallback;

  const validPlayers = Array.isArray(s.players)
    ? s.players.filter((p) => p && typeof p === 'object' && p.id)
    : [];
  const basePlayers = validPlayers.length >= 2 ? validPlayers : fallback.players;
  s.players = basePlayers.slice(0, 6).map((p, idx) => ({
    id: String(p.id || `p${idx + 1}`),
    name: String(p.name || `Người chơi ${idx + 1}`),
    avatar: String(p.avatar || '🦁'),
    color: String(p.color || '#06b6d4'),
    categoryId: String(p.categoryId || 'flags'),
    durationSec: clampDurationSec(p.durationSec),
  }));

  const validIds = new Set(s.players.map((p) => p.id));
  const cellTotal = Math.max(2, s.players.length);
  const rawFloor = Array.isArray(s.floor) ? s.floor : [];
  s.floor = Array.from({ length: cellTotal }, (_, i) => {
    const owner = rawFloor[i];
    return (owner && validIds.has(owner)) ? owner : s.players[i % s.players.length].id;
  });

  s.championId = (s.championId && validIds.has(s.championId)) ? s.championId : '';
  s.setup = (s.setup && typeof s.setup === 'object') ? s.setup : {};
  s.setup.preloadUrls = (Array.isArray(s.setup.preloadUrls) ? s.setup.preloadUrls : [])
    .map((u) => normalizeImageUrl(u) || u)
    .filter(Boolean);
  s.setup.victoryAudioUrl = s.setup.victoryAudioUrl || '';
  s.setup.victoryVoiceData = s.setup.victoryVoiceData || '';
  s.setup.victoryVoiceName = s.setup.victoryVoiceName || '';
  s.setup.localAudioVolume = clampVolume01(s.setup.localAudioVolume, 1.0);
  s.setup.onlineAudioVolume = clampVolume01(s.setup.onlineAudioVolume, 1.0);

  const validPhases = new Set(['floor', 'ready', 'countdown', 'playing', 'paused', 'finished']);
  if (!s.phase || s.phase === 'lobby' || !validPhases.has(s.phase)) {
    s.phase = 'floor';
  }

  if (s.duel && typeof s.duel === 'object') {
    s.duel.queue = Array.isArray(s.duel.queue) ? s.duel.queue : [];
    s.duel.items = (Array.isArray(s.duel.items) ? s.duel.items : []).map((it) => {
      if (!it || typeof it !== 'object') return null;
      if (it.type === 'img' && it.src) {
        return { ...it, src: normalizeImageUrl(it.src) || it.src, aliases: Array.isArray(it.aliases) ? it.aliases : [] };
      }
      return { ...it, aliases: Array.isArray(it.aliases) ? it.aliases : [] };
    }).filter(Boolean);
    s.duel.changed = Array.isArray(s.duel.changed) ? s.duel.changed : [];
    s.duel.totalA = s.duel.totalA || DUEL_MS;
    s.duel.totalB = s.duel.totalB || DUEL_MS;
    s.duel.passUntil = s.duel.passUntil || 0;
    s.duel.passRem = s.duel.passRem || 0;
    s.duel.passAnswer = s.duel.passAnswer || '';
    s.duel.cdTotal = s.duel.cdTotal || COUNTDOWN_MS;
    s.duel.cdEnd = s.duel.cdEnd || 0;
    s.duel.victoryAudioUrl = s.duel.victoryAudioUrl || '';
    s.duel.victoryVoiceData = s.duel.victoryVoiceData || '';
    s.duel.victoryVoiceName = s.duel.victoryVoiceName || '';
    s.duel.localAudioVolume = clampVolume01(s.duel.localAudioVolume, 1.0);
    s.duel.onlineAudioVolume = clampVolume01(s.duel.onlineAudioVolume, 1.0);
    if (!s.duel.aId || !s.duel.bId || !validIds.has(s.duel.aId) || !validIds.has(s.duel.bId)) {
      s.phase = 'floor';
      s.duel = null;
    }
  } else {
    s.duel = null;
    s.phase = 'floor';
  }
  return s;
}

/** Cấu hình âm thanh chiến thắng kép của chủ đề hiện tại (từ duel hoặc setup). */
function activeVictorySpec(s) {
  if (!s) {
    return {
      url: '', topicId: '', voiceData: '', voiceName: '',
      localAudioVolume: 1.0, onlineAudioVolume: 1.0,
    };
  }
  if (s.duel) {
    const cat = s.duel.categoryId ? getCategories100().find((c) => c.id === s.duel.categoryId) : null;
    return {
      url: s.duel.victoryAudioUrl || (cat && cat.victoryAudioUrl) || '',
      topicId: s.duel.categoryId || '',
      voiceData: s.duel.victoryVoiceData || (cat && cat.victoryVoiceData) || '',
      voiceName: s.duel.victoryVoiceName || (cat && cat.victoryVoiceName) || '',
      localAudioVolume: clampVolume01(s.duel.localAudioVolume ?? cat?.localAudioVolume, 1.0),
      onlineAudioVolume: clampVolume01(s.duel.onlineAudioVolume ?? cat?.onlineAudioVolume, 1.0),
    };
  }
  if (s.setup && s.setup.catId) {
    const cat = getCategories100().find((c) => c.id === s.setup.catId);
    return {
      url: s.setup.victoryAudioUrl || (cat && cat.victoryAudioUrl) || '',
      topicId: s.setup.catId || '',
      voiceData: s.setup.victoryVoiceData || (cat && cat.victoryVoiceData) || '',
      voiceName: s.setup.victoryVoiceName || (cat && cat.victoryVoiceName) || '',
      localAudioVolume: clampVolume01(s.setup.localAudioVolume ?? cat?.localAudioVolume, 1.0),
      onlineAudioVolume: clampVolume01(s.setup.onlineAudioVolume ?? cat?.onlineAudioVolume, 1.0),
    };
  }
  return {
    url: '', topicId: '', voiceData: '', voiceName: '',
    localAudioVolume: 1.0, onlineAudioVolume: 1.0,
  };
}

/** Danh sách URL ảnh cần tải ngầm của trạng thái hiện tại (ưu tiên ảnh theo thứ tự ra câu hỏi). */
function activeUrls(s) {
  if (!s) return [];
  if (s.duel && s.duel.items && s.duel.items.length) {
    return extractImageUrls(s.duel.items, s.duel.queue, s.duel.qPos);
  }
  if (s.setup && s.setup.preloadUrls && s.setup.preloadUrls.length) {
    return s.setup.preloadUrls;
  }
  if (s.setup && s.setup.catId) {
    const cat = getCategories100().find((c) => c.id === s.setup.catId);
    if (cat) return extractImageUrls(cat.items.slice(0, MAX_TOPIC_IMAGES));
  }
  return [];
}

/** Giai đoạn 1 & 2: tự động kích hoạt preload ngầm ảnh + âm thanh chiến thắng kép trên cả máy Host và máy Xem. */
function syncPreload(s) {
  if (s.duel && s.duel.items && s.duel.items.length) {
    preloadWindow(s.duel);
  }
  const urls = activeUrls(s);
  if (urls.length) {
    const inArena = s.phase !== 'floor';
    const sig = `${inArena ? 'P' : 'S'}:${urls.join('|')}`;
    if (sig !== lastPreloadSig) {
      lastPreloadSig = sig;
      // Chỉ giữ trong window.__imageCache ảnh của chủ đề đang thi đấu, giải phóng ảnh chủ đề cũ
      preloadImages(urls, { priority: inArena, evictOthers: true });
    }
  } else if (s.phase === 'floor' && !s.setup?.catId && lastPreloadSig) {
    lastPreloadSig = '';
    pruneCache([]);
  }

  const spec = activeVictorySpec(s);
  // Luôn đồng bộ âm lượng thời gian thực cho cả 2 nguồn
  Sfx.setVolumes({
    localAudioVolume: spec.localAudioVolume,
    onlineAudioVolume: spec.onlineAudioVolume,
  });

  const vicSig = `${spec.topicId}|${spec.url}|${spec.voiceData ? spec.voiceData.length : 0}|${spec.voiceName}`;
  if (vicSig !== lastVictoryUrl) {
    lastVictoryUrl = vicSig;
    Sfx.preloadVictory(spec);
    // Nếu trên máy Host có lưu file âm thanh trong IndexedDB mà chưa đồng bộ vào state, tự động nạp bổ sung
    if (controller && spec.topicId && !spec.voiceData) {
      loadTopicAudioIDB(spec.topicId).then((rec) => {
        if (rec && rec.dataUrl && state) {
          if (state.setup && state.setup.catId === spec.topicId && !state.setup.victoryVoiceData) {
            state.setup.victoryVoiceData = rec.dataUrl;
            state.setup.victoryVoiceName = rec.name || '';
          }
          if (state.duel && state.duel.categoryId === spec.topicId && !state.duel.victoryVoiceData) {
            state.duel.victoryVoiceData = rec.dataUrl;
            state.duel.victoryVoiceName = rec.name || '';
          }
        }
      }).catch(() => {});
    }
  }
}

function updatePreloadBadges() {
  if (!state) return;
  const urls = activeUrls(state);
  const { loaded, total, first } = getProgress(urls);
  const pct = total ? Math.round((loaded / total) * 100) : 100;

  const setupBox = $('setupPreload');
  if (setupBox) {
    const show = role === 'host' && state.phase === 'floor' && total > 0;
    setupBox.classList.toggle('hidden', !show);
    if (show) {
      $('setupPreloadText').textContent = loaded >= total ? 'Đã nạp sẵn toàn bộ ảnh' : 'Đang nạp ngầm ảnh câu hỏi…';
      $('setupPreloadCount').textContent = `${loaded}/${total} ảnh`;
      $('setupPreloadBar').style.width = `${pct}%`;
    }
  }

  const cdText = $('cdLoadText');
  if (cdText) {
    cdText.textContent = total
      ? loaded >= total
        ? `Đã sẵn sàng (${loaded}/${total} ảnh)`
        : `Đang nạp dữ liệu câu hỏi... (${loaded}/${total} ảnh)`
      : 'Bộ câu hỏi đã sẵn sàng';
  }
  const cdDot = $('cdLoadDot');
  if (cdDot) cdDot.classList.toggle('ready', !total || (loaded >= total && first));
  const cdBar = $('cdLoadBar');
  if (cdBar) cdBar.style.width = `${pct}%`;
}

// ---------- Dispatch ----------
/** Id sự kiện: kết thúc trận dùng id xác định để mọi máy tự tính cùng một sự kiện (không phát âm thanh 2 lần). */
function makeEvent(next, type) {
  const d = next.duel;
  const id = type === 'finish' && d
    ? `fin-${d.aId}-${d.bId}-${d.tStamp}-${d.qPos}`
    : `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return { id, type };
}

/** Lấy toàn bộ chủ đề (mặc định + `shared_topics` từ Firebase + dự phòng `localStorage`) và giữ tối đa MAX_TOPIC_IMAGES (100) ảnh. */
function getCategories100() {
  const cats = safeAllCategories();
  try {
    const localRaw = JSON.parse(localStorage.getItem(TOPICS_KEY) || 'null');
    const sourceList = Array.isArray(sharedCustomTopics)
      ? sharedCustomTopics
      : (Array.isArray(localRaw) ? localRaw : []);
    if (sourceList.length) {
      const byId = new Map(sourceList.filter(Boolean).map((t) => [t.id, t]));
      const existingIds = new Set(cats.map((c) => c.id));
      sourceList.forEach((t) => {
        if (t && t.id && !existingIds.has(t.id)) {
          existingIds.add(t.id);
          cats.push({
            ...t,
            id: String(t.id),
            name: String(t.name || 'Chủ đề riêng'),
            icon: String(t.icon || '🖼️'),
            custom: true,
            items: Array.isArray(t.items) ? t.items.filter(Boolean) : [],
          });
        }
      });
      cats.forEach((c) => {
        if (!Array.isArray(c.items)) c.items = [];
        const src = byId.get(c.id);
        if (src && Array.isArray(src.items) && src.items.length > c.items.length) {
          c.items = src.items.filter(Boolean).slice(0, MAX_TOPIC_IMAGES);
        }
        c.items = c.items.map((it) => {
          if (!it || typeof it !== 'object') return null;
          if (it.type === 'img' && it.src) {
            return { ...it, src: normalizeImageUrl(it.src) || it.src };
          }
          return it;
        }).filter(Boolean);
      });
    }
  } catch (err) {
    console.warn('Lỗi đọc danh sách chủ đề mở rộng:', err);
  }
  return cats.map((c) => ({
    ...c,
    items: Array.isArray(c.items) ? c.items : [],
  }));
}

/** Gán thông tin chủ đề, danh sách preload ảnh và âm thanh chiến thắng vào setup */
function applyCategoryToSetup(setup, catId) {
  setup.catId = catId;
  const cats = getCategories100();
  const cat = cats.find((c) => c.id === catId);
  if (cat) {
    setup.preloadUrls = extractImageUrls(cat.items.slice(0, MAX_TOPIC_IMAGES));
    setup.victoryAudioUrl = cat.victoryAudioUrl || '';
    setup.victoryVoiceData = cat.victoryVoiceData || '';
    setup.victoryVoiceName = cat.victoryVoiceName || '';
    setup.localAudioVolume = clampVolume01(cat.localAudioVolume, 1.0);
    setup.onlineAudioVolume = clampVolume01(cat.onlineAudioVolume, 1.0);
  }
}

function dispatch(type, arg) {
  if (!controller || !state) return;
  const prev = state;
  const next = structuredClone(state);

  if (type === 'setPair') {
    next.setup = next.setup || {};
    next.setup.chalId = arg.chalId || null;
    next.setup.defId = arg.defId || null;
    if (arg.cell !== undefined) next.setup.cell = arg.cell;
    const catToUse = arg.catId || next.setup.catId;
    if (catToUse) applyCategoryToSetup(next.setup, catToUse);
    state = normalize(next);
    applyState(state, true);
    transport.write(state, prev);
    return;
  }
  if (type === 'swapPair') {
    next.setup = next.setup || {};
    const oldChal = next.setup.chalId;
    const oldDef = next.setup.defId;
    next.setup.chalId = oldDef || null;
    next.setup.defId = oldChal || null;
    if (next.setup.defId) {
      const newDef = playerById(next, next.setup.defId);
      if (newDef && newDef.categoryId) {
        applyCategoryToSetup(next.setup, newDef.categoryId);
      }
    }
    state = normalize(next);
    applyState(state, true);
    transport.write(state, prev);
    return;
  }
  if (type === 'setCategory') {
    next.setup = next.setup || {};
    applyCategoryToSetup(next.setup, arg.id);
    state = normalize(next);
    applyState(state, true);
    transport.write(state, prev);
    return;
  }

  let reduceArg = arg;
  if (type === 'startDuel' && next.setup && next.setup.catId) {
    const fullCat = getCategories100().find((c) => c.id === next.setup.catId);
    if (fullCat) reduceArg = { ...(arg || {}), cat: fullCat };
  }
  const ev = reduce(next, type, reduceArg, transport.serverNow());
  if (ev === false) return;
  if (ev) next.event = makeEvent(next, ev);
  state = normalize(next);
  applyState(state, true);
  transport.write(state, prev); // chỉ gửi phần thay đổi
}

/**
 * Hết giờ: mọi máy (Host lẫn Xem) tự phát hiện đồng hồ về 0 theo giờ server và kích hoạt
 * còi/pháo hoa/lật ô cùng lúc. Chỉ máy có quyền điều khiển mới ghi kết quả lên cloud;
 * máy Xem tính cục bộ (kết quả xác định) và sẽ khớp với dữ liệu Host gửi tới.
 */
function handleTimeUp() {
  if (controller) {
    dispatch('tick');
    return;
  }
  const next = structuredClone(state);
  const ev = reduce(next, 'tick', {}, transport.serverNow());
  if (!ev) return;
  next.event = makeEvent(next, ev);
  state = normalize(next);
  applyState(state, true);
}

/** Kết thúc 2 giây hiện đáp án khi Bỏ qua: chuyển sang câu tiếp theo và mở khóa nút. */
function handlePassComplete() {
  if (controller) {
    dispatch('passComplete');
    return;
  }
  const next = structuredClone(state);
  const ev = reduce(next, 'passComplete', {}, transport.serverNow());
  if (ev === false) return;
  if (ev) next.event = makeEvent(next, ev);
  state = normalize(next);
  applyState(state, true);
}

/** Kiểm tra xem trận đấu có đang trong 2 giây chờ hiển thị đáp án Bỏ qua hay không. */
function isPassWaiting(s, now = transport ? transport.serverNow() : Date.now()) {
  if (!s || !s.duel) return false;
  const d = s.duel;
  if (s.phase === 'playing' && d.passUntil && now < d.passUntil) return true;
  if (s.phase === 'paused' && d.passRem && d.passRem > 0) return true;
  return false;
}

// ---------- Áp dụng trạng thái ----------
function applyState(s, allowEvents = true) {
  if (!s) return;
  if ($('waiting')) $('waiting').classList.add('hidden');
  if (document.body) document.body.classList.toggle('host', role === 'host');
  if ($('linkCms')) {
    $('linkCms').classList.toggle('hidden', role !== 'host');
    $('linkCms').href = `topics.html?room=${encodeURIComponent(room)}`;
  }
  if ($('roleLabel')) {
    $('roleLabel').textContent = role === 'host' ? 'Host' : controller ? 'Màn hình · đã mở khóa Host' : 'Màn hình xem';
  }

  // Sự kiện cũ có sẵn trong phòng khi mới vào sẽ không phát lại (allowEvents=false ở snapshot đầu).
  if (s.event && s.event.id !== lastEventId) {
    if (allowEvents) playEvent(s.event.type);
    lastEventId = s.event.id;
  }

  tickPending = false;
  passCompletePending = false;
  if (s.phase !== 'countdown') {
    goPending = false;
    lastCdSec = -1;
  }
  syncPreload(s);
  render(s);
  updatePreloadBadges();
  prevPhase = s.phase;
}

function playEvent(type) {
  switch (type) {
    case 'ding': Sfx.ding(); break;
    case 'buzz': Sfx.buzz(); break;
    case 'start': Sfx.start(); break;
    case 'ready':
    case 'countdown': Sfx.ready(); break;
    case 'pause':
    case 'click': Sfx.click(); break;
    case 'finish': Sfx.finishSequence(activeVictorySpec(state)); break;
    default: break;
  }
}

function showWaiting() {
  if ($('waiting')) $('waiting').classList.remove('hidden');
  ['viewFloor', 'viewArena', 'dock', 'miniPanel'].forEach((id) => {
    const el = $(id);
    if (el) el.classList.add('hidden');
  });
}

// ---------- Render ----------
function render(s) {
  if (!s) return;
  const isLobbyOrFloor = !s.phase || s.phase === 'floor' || s.phase === 'lobby' || !s.duel;
  const inDuel = !isLobbyOrFloor;
  const phaseSwitch = prevPhase === null || (prevPhase === 'floor' || prevPhase === 'lobby') !== isLobbyOrFloor;
  if (document.body) document.body.classList.toggle('in-arena', inDuel);
  if (!inDuel) {
    document.documentElement.style.setProperty('--turn', 'transparent');
    if (artKey) {
      artKey = '';
      const content = $('qContent');
      if (content) content.innerHTML = '';
    }
  }
  if ($('viewFloor')) $('viewFloor').classList.toggle('hidden', inDuel);
  if ($('viewArena')) $('viewArena').classList.toggle('hidden', !inDuel);

  try { renderFloor(s); } catch (err) { console.error('Lỗi renderFloor:', err); }
  if (inDuel) {
    try { renderArena(s); } catch (err) { console.error('Lỗi renderArena:', err); }
  }
  try { renderControls(s); } catch (err) { console.error('Lỗi renderControls:', err); }
  if (phaseSwitch) {
    try { initStaggeredEntrance(inDuel ? $('viewArena') : $('viewFloor')); } catch { /* ignore */ }
  }
  try { renderFireworks(s); } catch (err) { console.error('Lỗi renderFireworks:', err); }
  try { syncMusic(s); } catch (err) { console.error('Lỗi syncMusic:', err); }
}

// Nhạc nền đếm ngược: chỉ chạy khi đang đấu (dừng khi tạm dừng / kết thúc), nhịp tăng theo thời gian còn lại.
function syncMusic(s) {
  if (s.phase === 'playing' && s.duel) {
    if (!Sfx.isMusicOn()) {
      Sfx.musicStart(() => {
        if (!state || !state.duel) return 60000;
        const now = transport.serverNow();
        return Math.min(remainingOf(state.duel, 'A', now), remainingOf(state.duel, 'B', now));
      });
    }
  } else if (Sfx.isMusicOn()) {
    Sfx.musicStop();
  }
}

// ----- Sàn -----
function handleFloorCellClick(cellIndex) {
  if (role !== 'host' || !state || state.phase !== 'floor') return;
  const ownerId = state.floor[cellIndex];
  if (!ownerId) return;

  // Người chơi đã bị loại (0 ô chiếm) thì bị vô hiệu hóa
  if (cellCount(state, ownerId) <= 0) return;

  let chalId = state.setup?.chalId || null;
  let defId = state.setup?.defId || null;

  if (ownerId === chalId) {
    // Click vào ô Người thách đấu -> Hủy chọn; đẩy Người bị thách lên làm Người thách đấu
    chalId = defId;
    defId = null;
  } else if (ownerId === defId) {
    // Click vào ô Người bị thách đấu -> Hủy chọn Người bị thách đấu
    defId = null;
  } else if (!chalId) {
    // Click 1 (chưa có ai được chọn): Gán làm Người thách đấu
    chalId = ownerId;
  } else {
    // Click 2 (đã có Người thách đấu, click người khác) hoặc bấm người thứ 3:
    // Gán / Thay thế Người bị thách đấu
    defId = ownerId;
  }

  // Tự động chọn sẵn chủ đề của Người bị thách đấu (theo luật The Floor)
  let catId = state.setup?.catId;
  if (defId) {
    const defP = playerById(state, defId);
    if (defP && defP.categoryId) {
      const cats = getCategories100();
      if (cats.some((c) => c.id === defP.categoryId && c.items.length > 0)) {
        catId = defP.categoryId;
      }
    }
  }

  dispatch('setPair', { chalId, defId, cell: cellIndex, catId });
}

function buildFloor(count) {
  const grid = $('floorGrid');
  grid.innerHTML = '';
  grid.dataset.count = String(count);
  floorBuiltCount = count;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'cell';
    el.dataset.i = String(i);
    el.innerHTML =
      '<div class="cell-top"><span class="cell-badge"></span></div>' +
      '<div class="cell-mid"><span class="cell-avatar"></span><span class="cell-name"></span></div>' +
      '<div class="cell-bot"><span class="cell-topic"></span><span class="cell-territory"></span></div>';
    frag.appendChild(el);
  }
  grid.appendChild(frag);
  if (!grid.dataset.bound) {
    grid.dataset.bound = '1';
    grid.addEventListener('click', (e) => {
      if (role !== 'host') return;
      const cell = e.target.closest('.cell');
      if (!cell) return;
      handleFloorCellClick(Number(cell.dataset.i));
    });
  }
  floorBuilt = true;
}

function renderFloor(s) {
  const setup = s.setup || {};
  const cats = getCategories100();
  const catMap = new Map(cats.map((c) => [c.id, c]));
  const countMap = new Map();
  (s.players || []).forEach((p) => countMap.set(p.id, cellCount(s, p.id)));

  // 1. Render lưới bàn cờ chính & tiêu đề gợi ý
  try {
    const grid = $('floorGrid');
    if (grid) {
      if (!floorBuilt || floorBuiltCount !== s.floor.length) buildFloor(s.floor.length);
      const flipSet = new Set(prevPhase === 'finished' && (s.phase === 'floor' || s.phase === 'lobby') && s.duel ? (s.duel.changed || []) : []);
      [...grid.children].forEach((el, i) => {
        const owner = playerById(s, s.floor[i]) || s.players[i % s.players.length];
        if (!owner) return;
        const owned = countMap.get(owner.id) || 0;
        const isElim = owned <= 0;
        const isDef = !isElim && !!setup.defId && owner.id === setup.defId;
        const isChal = !isElim && !!setup.chalId && owner.id === setup.chalId;
        const cat = catMap.get(owner.categoryId);

        el.style.setProperty('--c', owner.color || '#0071e3');
        el.style.opacity = isElim ? '0.36' : '1';
        el.style.visibility = 'visible';

        const badgeEl = el.querySelector('.cell-badge');
        const avatarEl = el.querySelector('.cell-avatar');
        const nameEl = el.querySelector('.cell-name');
        const topicEl = el.querySelector('.cell-topic');
        const territoryEl = el.querySelector('.cell-territory');

        if (badgeEl) badgeEl.textContent = isChal ? '⚔️ THÁCH ĐẤU' : isDef ? '🛡️ BỊ THÁCH' : '';
        if (avatarEl) avatarEl.textContent = owner.avatar || '🦁';
        if (nameEl) nameEl.textContent = owner.name || `Người chơi ${i + 1}`;
        if (topicEl) topicEl.textContent = cat ? `${cat.icon} ${cat.name}` : (owner.categoryId || '—');
        if (territoryEl) territoryEl.textContent = `${owned} ô`;

        el.classList.toggle('is-eliminated', isElim);
        el.classList.toggle('is-sel', setup.cell === i);
        el.classList.toggle('is-def', isDef);
        el.classList.toggle('is-chal', isChal);
        if (flipSet.has(i)) {
          el.classList.add('is-flip');
          setTimeout(() => el.classList.remove('is-flip'), 3300);
        }
      });
    }

    const def = playerById(s, setup.defId);
    const chal = playerById(s, setup.chalId);
    const champ = playerById(s, s.championId);
    if ($('floorHint')) {
      $('floorHint').textContent = champ
        ? `🏆 ${champ.name} vô địch The Floor!`
        : chal && def
          ? `${chal.name}  ⚔️  ${def.name}`
          : chal
            ? `${chal.name} đang chọn đối thủ…`
            : def
              ? `Chờ chọn người thách đấu vs ${def.name}`
              : (role === 'host' || controller)
                ? 'Chạm 2 ô trên sàn để chọn cặp đấu'
                : 'Chờ trận đấu kế tiếp';
    }
  } catch (err) {
    console.error('Lỗi render lưới bàn cờ:', err);
  }

  // 2. Render Bảng xếp hạng
  try {
    const board = $('board');
    if (board) {
      const sorted = [...(s.players || [])].sort((a, b) => cellCount(s, b.id) - cellCount(s, a.id));
      board.innerHTML = '';
      const frag = document.createDocumentFragment();
      const totalCells = Math.max(1, (s.floor || []).length);
      sorted.forEach((p) => {
        const n = cellCount(s, p.id);
        const pct = Math.round((n / totalCells) * 100);
        const row = document.createElement('div');
        row.className = 'board-row';
        row.innerHTML = `
          <div class="board-row-head" style="${n === 0 ? 'opacity:0.45' : 'opacity:1'}">
            <span>${esc(p.avatar || '🦁')}</span>
            <span class="board-row-name">${esc(p.name || '')}</span>
            <span class="font-num" style="color:${esc(p.color || '#2997ff')}">${n} ô</span>
          </div>
          <div class="board-bar"><div class="board-bar-fill" style="width:${pct}%;background:${esc(p.color || '#2997ff')}"></div></div>`;
        frag.appendChild(row);
      });
      board.appendChild(frag);
    }
  } catch (err) {
    console.error('Lỗi render Bảng xếp hạng:', err);
  }

  // 3. Render khu vực cấu hình của Host (người chơi, chủ đề, thời gian, nút bắt đầu)
  try {
    renderSetup(s, cats);
  } catch (err) {
    console.error('Lỗi render khu vực thiết lập Host:', err);
  }
}

function renderSetup(s, preloadedCats = null) {
  const panel = $('setupPanel');
  if (!panel) return;
  const isLobbyPhase = !s.phase || s.phase === 'floor' || s.phase === 'lobby' || !s.duel;
  const show = (role === 'host' || controller || requestedHost) && isLobbyPhase;
  panel.classList.toggle('hidden', !show);
  if (!show) return;
  panel.style.opacity = '1';
  panel.style.visibility = 'visible';

  const setup = s.setup || {};
  const chal = playerById(s, setup.chalId);
  const def = playerById(s, setup.defId);
  const chalAlive = chal && cellCount(s, chal.id) > 0;
  const defAlive = def && cellCount(s, def.id) > 0;
  const validChal = chalAlive ? chal : null;
  const validDef = defAlive ? def : null;

  const chalNameEl = $('pairChalName');
  if (chalNameEl) {
    chalNameEl.innerHTML = validChal
      ? `<span class="mr-1">${esc(validChal.avatar)}</span><span style="color:${esc(validChal.color)}">${esc(validChal.name)}</span>`
      : '<span class="t-3 text-xs font-normal italic">Chạm ô để chọn</span>';
  }
  const chalTimeWrap = $('pairChalTimeWrap');
  const chalSecInp = $('pairChalSec');
  if (chalTimeWrap && chalSecInp) {
    chalTimeWrap.classList.toggle('hidden', !validChal);
    if (validChal && document.activeElement !== chalSecInp) {
      chalSecInp.value = String(clampDurationSec(validChal.durationSec));
    }
  }

  const defNameEl = $('pairDefName');
  if (defNameEl) {
    defNameEl.innerHTML = validDef
      ? `<span class="mr-1">${esc(validDef.avatar)}</span><span style="color:${esc(validDef.color)}">${esc(validDef.name)}</span>`
      : '<span class="t-3 text-xs font-normal italic">Chạm ô để chọn</span>';
  }
  const defTimeWrap = $('pairDefTimeWrap');
  const defSecInp = $('pairDefSec');
  if (defTimeWrap && defSecInp) {
    defTimeWrap.classList.toggle('hidden', !validDef);
    if (validDef && document.activeElement !== defSecInp) {
      defSecInp.value = String(clampDurationSec(validDef.durationSec));
    }
  }

  const swapBtn = $('btnSwapPair');
  if (swapBtn) {
    swapBtn.disabled = !(validChal && validDef);
  }
  const vsRow = $('pairVsRow');
  const vsText = $('pairVsText');
  if (vsRow && vsText) {
    const hasBoth = !!(validChal && validDef);
    vsRow.classList.toggle('hidden', !hasBoth);
    if (hasBoth) {
      vsText.textContent = `${validChal.name} (${clampDurationSec(validChal.durationSec)}s) ⚔️ ${validDef.name} (${clampDurationSec(validDef.durationSec)}s)`;
    }
  }

  const cats = Array.isArray(preloadedCats) && preloadedCats.length ? preloadedCats : getCategories100();
  const catSel = $('selCat');
  if (catSel) {
    const catSig = JSON.stringify(cats.map((c) => [c.id, c.name, c.icon, (c.items || []).length]));
    if (catSel.dataset.sig !== catSig) {
      catSel.dataset.sig = catSig;
      catSel.innerHTML = cats.map((c) => {
        const count = Array.isArray(c.items) ? c.items.length : 0;
        return `<option value="${esc(c.id)}" ${count ? '' : 'disabled'}>${esc(c.icon || '🖼️')} ${esc(c.name || c.id)} (${count})</option>`;
      }).join('');
    }
    const preferredCat = setup.catId || (validDef && validDef.categoryId) || (cats[0] ? cats[0].id : '');
    if (preferredCat && cats.some((c) => c.id === preferredCat)) {
      catSel.value = preferredCat;
    } else if (cats[0]) {
      catSel.value = cats[0].id;
    }
    const chosen = cats.find((c) => c.id === catSel.value);
    if ($('btnStartDuel')) {
      $('btnStartDuel').disabled = !(validChal && validDef && chosen && Array.isArray(chosen.items) && chosen.items.length) || !!s.championId;
    }
  }

  document.querySelectorAll('#playerCountSeg [data-pc]').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.pc) === s.players.length);
  });

  // Roster editor (dùng event delegation trên #roster tránh gắn lại listener mỗi lần render)
  const roster = $('roster');
  if (!roster) return;
  if (!roster.dataset.bound) {
    roster.dataset.bound = '1';
    roster.addEventListener('change', (e) => {
      const inp = e.target.closest('[data-f]');
      const row = e.target.closest('[data-pid]');
      if (!inp || !row) return;
      const field = inp.dataset.f;
      const raw = inp.value.trim();
      if (!raw) return;
      const val = field === 'durationSec' ? clampDurationSec(raw) : raw;
      if (field === 'durationSec') inp.value = String(val);
      dispatch('updatePlayer', { id: row.dataset.pid, patch: { [field]: val } });
    });
  }
  const sig = JSON.stringify([s.players, cats.map((c) => `${c.id}:${c.name}`)]);
  if (roster.dataset.sig !== sig && !roster.contains(document.activeElement)) {
    roster.dataset.sig = sig;
    roster.innerHTML = '';
    const rFrag = document.createDocumentFragment();
    s.players.forEach((p, idx) => {
      const row = document.createElement('div');
      row.dataset.pid = p.id;
      row.className = 'roster-grid roster-row';
      row.style.opacity = '1';
      row.style.visibility = 'visible';
      row.innerHTML = `
        <div class="roster-col-id">
          <span class="roster-num" style="background:${esc(p.color)}">${idx + 1}</span>
          <input type="color" data-f="color" value="${esc(p.color)}" class="roster-color" title="Màu đại diện" />
          <input class="input roster-avatar-inp" data-f="avatar" value="${esc(p.avatar)}" maxlength="4" title="Biểu tượng" />
        </div>
        <input class="input" data-f="name" value="${esc(p.name)}" maxlength="14" title="Tên người chơi" placeholder="Tên…" />
        <select class="input" data-f="categoryId" title="Chủ đề sở trường">${cats.map((c) => `<option value="${esc(c.id)}" ${c.id === p.categoryId ? 'selected' : ''}>${esc(c.icon || '🖼️')} ${esc(c.name)}</option>`).join('')}</select>
        <input type="number" min="10" max="600" step="5" class="input text-center font-num" data-f="durationSec" value="${clampDurationSec(p.durationSec)}" title="Thời gian thi đấu (giây)" />`;
      rFrag.appendChild(row);
    });
    roster.appendChild(rFrag);
  }
}

// ----- Đấu trường -----
function renderArena(s) {
  const d = s.duel;
  if (!d) return;
  const A = playerById(s, d.aId);
  const B = playerById(s, d.bId);
  [['A', A], ['B', B]].forEach(([side, p]) => {
    $(`avatar${side}`).textContent = p.avatar;
    $(`avatar${side}`).style.setProperty('--pc', p.color);
    $(`name${side}`).textContent = p.name;
    $(`cells${side}`).textContent = cellCount(s, p.id);
    const card = $(`card${side}`);
    const active = s.phase === 'playing' && d.turn === side;
    const finished = s.phase === 'finished';
    card.classList.toggle('active', active);
    card.classList.toggle('idle', (s.phase === 'playing' || s.phase === 'paused') && d.turn !== side);
    card.classList.toggle('out', finished && d.loserSide === side);
    card.classList.toggle('win', finished && d.loserSide !== side);
  });

  // Viền LED & banner lượt
  let led = '#64d2ff';
  let banner = 'SẴN SÀNG';
  if (s.phase === 'countdown') {
    led = '#ffd60a';
    banner = 'CHUẨN BỊ VÀO TRẬN';
  } else if (s.phase === 'playing' || s.phase === 'paused') {
    led = SIDE_COLOR[d.turn];
    banner = `LƯỢT: ${(d.turn === 'A' ? A : B).name.toUpperCase()}`;
  } else if (s.phase === 'finished') {
    led = '#ffd60a';
    banner = 'KẾT THÚC';
  }
  $('qWrap').style.setProperty('--led', led);
  document.documentElement.style.setProperty('--turn', led);
  $('qWrap').classList.toggle('paused', s.phase === 'paused');
  $('turnBanner').textContent = banner;
  $('catBadge').textContent = `${d.catIcon || '🖼️'} ${d.catName || ''}`;

  // Nội dung câu đố / màn chuẩn bị / màn đếm ngược
  const key = `${s.phase}-${d.categoryId}-${d.qPos}`;
  if (key !== artKey) {
    artKey = key;
    const content = $('qContent');
    content.innerHTML = '';
    if (s.phase === 'ready') {
      content.innerHTML = `
        <div class="cd-stage">
          <div class="eyebrow">${esc(d.catIcon || '🖼️')} ${esc(d.catName || '')}</div>
          <div class="font-display text-5xl md:text-7xl t-1">SẴN SÀNG?</div>
          <div class="t-2 text-base md:text-lg">Chờ Host bấm <b>Bắt đầu trận</b></div>
          <div class="cd-status"><span id="cdLoadDot" class="cd-dot"></span><span id="cdLoadText">Đang nạp dữ liệu câu hỏi...</span></div>
          <div class="cd-bar"><div id="cdLoadBar" class="cd-bar-fill"></div></div>
        </div>`;
      updatePreloadBadges();
    } else if (s.phase === 'countdown') {
      content.innerHTML = `
        <div class="cd-stage">
          <div class="eyebrow">Trận đấu bắt đầu sau</div>
          <div class="cd-ring-wrap">
            <svg viewBox="0 0 200 200"><circle class="cd-ring-track" cx="100" cy="100" r="88"/><circle id="cdRing" class="cd-ring-fill" cx="100" cy="100" r="88"/></svg>
            <div id="cdNum" class="cd-num">10</div>
          </div>
          <div class="cd-status"><span id="cdLoadDot" class="cd-dot"></span><span id="cdLoadText">Đang nạp dữ liệu câu hỏi...</span></div>
          <div class="cd-bar"><div id="cdLoadBar" class="cd-bar-fill"></div></div>
        </div>`;
      updatePreloadBadges();
    } else if (s.phase === 'playing' || s.phase === 'paused') {
      const q = currentQuestion(d);
      if (q) content.appendChild(buildArt(q));
      // Ưu tiên nạp tuần tự 3 ảnh kế tiếp qua preloadWindow
      preloadWindow(d);
    }
  }
  syncHostAnswer(s);
  $('qInner').classList.toggle('blurred', s.phase === 'paused');
  $('pauseOverlay').classList.toggle('hidden', s.phase !== 'paused');

  const fin = s.phase === 'finished';
  $('resultOverlay').classList.toggle('hidden', !fin);
  const vicCtrl = $('victoryAudioControls');
  if (vicCtrl) vicCtrl.classList.toggle('hidden', !(fin && controller));
  if (fin) {
    if ($('passOverlay')) $('passOverlay').classList.add('hidden');
    if ($('passRevealBox')) $('passRevealBox').classList.add('hidden');
    const w = playerById(s, d.winnerId);
    $('resultName').textContent = `${w.avatar} ${w.name.toUpperCase()}`;
    $('resultSub').textContent = s.championId
      ? `🏆 VÔ ĐỊCH CHUNG CUỘC · sở hữu toàn bộ ${s.floor.length} ô`
      : `Chiếm ${d.changed.length} ô đất · tổng ${cellCount(s, w.id)}/${s.floor.length} ô`;
    paintVictoryButtons();
  }
}

function paintVictoryButtons() {
  const st = Sfx.getVictoryState();
  const btn = $('btnVicToggle');
  if (btn) btn.textContent = st.playing ? '⏸ Tạm dừng nhạc' : '▶ Phát tiếp nhạc';

  const lPct = Math.round(clampVolume01(st.localAudioVolume, 1.0) * 100);
  const oPct = Math.round(clampVolume01(st.onlineAudioVolume, 1.0) * 100);

  const lSlider = $('liveLocalVol');
  const lLabel = $('liveLocalVolLabel');
  const lMute = $('btnLiveLocalMute');
  if (lSlider && document.activeElement !== lSlider) lSlider.value = String(lPct);
  if (lLabel) lLabel.textContent = `${lPct}%`;
  if (lMute) {
    lMute.textContent = lPct === 0 ? '🔇' : '🎙️';
    lMute.classList.toggle('muted', lPct === 0);
  }

  const oSlider = $('liveOnlineVol');
  const oLabel = $('liveOnlineVolLabel');
  const oMute = $('btnLiveOnlineMute');
  if (oSlider && document.activeElement !== oSlider) oSlider.value = String(oPct);
  if (oLabel) oLabel.textContent = `${oPct}%`;
  if (oMute) {
    oMute.textContent = oPct === 0 ? '🔇' : '🎵';
    oMute.classList.toggle('muted', oPct === 0);
  }
}

function buildArt(q) {
  if (q.type === 'img') {
    const src = normalizeImageUrl(q.src) || q.src;
    const cached = (typeof window !== 'undefined' && window.__imageCache && window.__imageCache[src]) || getCached(src);
    const img = document.createElement('img');
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    // Tuyệt đối không đặt crossOrigin="anonymous" để tránh bị Google Drive CDN chặn CORS
    img.removeAttribute('crossorigin');
    img.className = 'q-img';
    img.alt = 'Câu đố';

    let retried = false;
    img.addEventListener('error', () => {
      console.error('Lỗi tải ảnh:', img.src);
      if (!retried && src) {
        retried = true;
        const fallback = driveFallbackUrl(src);
        if (fallback && img.src !== fallback) {
          img.src = fallback;
          return;
        }
        if (!src.startsWith('data:')) {
          img.src = `${src}${src.includes('?') ? '&' : '?'}retry=1`;
          return;
        }
      }
      img.replaceWith(Object.assign(document.createElement('div'), {
        className: 'font-display text-4xl t-danger text-center px-4',
        textContent: '⚠️ Ảnh không tải được',
      }));
    });

    img.src = (cached && cached.status === 'ok' && cached.resolvedUrl) ? cached.resolvedUrl : src;
    return img;
  }
  const div = document.createElement('div');
  div.className = 'q-emoji';
  div.textContent = q.emoji;
  return div;
}

// ----- Điều khiển -----
function syncPassUi(s, now = transport ? transport.serverNow() : Date.now()) {
  const d = s && s.duel;
  const waiting = isPassWaiting(s, now);
  const ans = waiting && d ? (d.passAnswer || (currentQuestion(d) ? currentQuestion(d).answer : '')) : '';

  const overlay = $('passOverlay');
  const overlayAns = $('passOverlayAnswer');
  if (overlay) {
    overlay.classList.toggle('hidden', !waiting);
    if (waiting && overlayAns && overlayAns.textContent !== ans) {
      overlayAns.textContent = ans;
    }
  }

  const box = $('passRevealBox');
  const txt = $('passRevealText');
  if (box && txt) {
    const showBottomBox = waiting && role !== 'host';
    box.classList.toggle('hidden', !showBottomBox);
    if (showBottomBox && txt.textContent !== ans) txt.textContent = ans;
  }

  const canAct = Boolean(s && s.phase === 'playing' && !waiting);
  if ($('cOk')) $('cOk').disabled = !canAct;
  if ($('cPass')) $('cPass').disabled = !canAct;
}

function clearAnswerBlurStyles(el) {
  if (!el) return;
  el.classList.remove('blurred', 'blur', 'is-blurred', 'spoiler', 'obscure', 'hidden-answer');
  el.style.filter = 'none';
  el.style.webkitFilter = 'none';
  el.style.opacity = '1';
  el.style.visibility = 'visible';
}

/**
 * Đồng bộ tức thì khung đáp án góc trên bên phải cho Host (luôn hiển thị rõ nét, không làm mờ),
 * đồng thời ẩn hoàn toàn đáp án trên màn hình Người xem (role === 'view' / 'viewer').
 */
function syncHostAnswer(s) {
  const phase = s ? s.phase : 'floor';
  const isHostScreen = role === 'host';
  const isViewer = !isHostScreen && !controller;
  const q = s && s.duel && (phase === 'playing' || phase === 'paused') ? currentQuestion(s.duel) : null;

  const wrap = $('answerWrap');
  const ansText = $('answerText');
  const ansAlias = $('answerAlias');
  if (wrap) {
    const showWrap = Boolean(isHostScreen && q);
    wrap.classList.toggle('hidden', !showWrap);
    if (showWrap) clearAnswerBlurStyles(wrap);
  }
  if (ansText) {
    clearAnswerBlurStyles(ansText);
    ansText.textContent = isHostScreen && q ? (q.answer || '') : '';
  }
  if (ansAlias) {
    clearAnswerBlurStyles(ansAlias);
    ansAlias.textContent = isHostScreen && q && q.aliases && q.aliases.length
      ? `(${q.aliases.join(' / ')})`
      : '';
  }

  const miniAns = $('miniAnswer');
  if (miniAns) {
    clearAnswerBlurStyles(miniAns);
    miniAns.textContent = !isViewer && q
      ? `Đáp án: ${q.answer}${q.aliases && q.aliases.length ? ` (${q.aliases.join(' / ')})` : ''}`
      : '';
  }
}

function renderControls(s) {
  const phase = s.phase;
  const inDuel = phase !== 'floor';
  const isHostScreen = role === 'host';
  const now = transport ? transport.serverNow() : Date.now();
  const passWaiting = isPassWaiting(s, now);

  // Dock (host) hoặc mini panel (xem)
  if ($('dock')) $('dock').classList.toggle('hidden', !(isHostScreen && inDuel));
  if ($('miniPanel')) $('miniPanel').classList.toggle('hidden', isHostScreen);
  if (!isHostScreen) {
    if ($('miniLock')) $('miniLock').classList.toggle('hidden', controller);
    if ($('miniCtrl')) $('miniCtrl').classList.toggle('hidden', !controller);
    const bar = $('ctrlBar');
    const miniBtns = $('miniButtons');
    if (bar && miniBtns && bar.parentElement !== miniBtns) miniBtns.appendChild(bar);
    if (bar) bar.classList.toggle('hidden', !(controller && inDuel));
  } else {
    const bar = $('ctrlBar');
    const dockIn = $('dockInner');
    if (bar && dockIn && bar.parentElement !== dockIn) dockIn.appendChild(bar);
    if (bar) bar.classList.remove('hidden');
  }

  if ($('cdSelect')) $('cdSelect').classList.toggle('hidden', phase !== 'ready');
  if ($('cBegin')) $('cBegin').classList.toggle('hidden', phase !== 'ready');
  if ($('cOk')) {
    $('cOk').classList.toggle('hidden', !(phase === 'playing' || phase === 'paused'));
    $('cOk').disabled = phase !== 'playing' || passWaiting;
  }
  if ($('cPass')) {
    $('cPass').classList.toggle('hidden', !(phase === 'playing' || phase === 'paused'));
    $('cPass').disabled = phase !== 'playing' || passWaiting;
  }
  if ($('cPause')) {
    $('cPause').classList.toggle('hidden', !(phase === 'playing' || phase === 'paused'));
    $('cPause').innerHTML = phase === 'paused' ? `${ICONS.play} Tiếp tục <kbd>T</kbd>` : `${ICONS.pause} Tạm dừng <kbd>T</kbd>`;
  }
  if ($('cBack')) $('cBack').classList.toggle('hidden', phase !== 'finished');
  if ($('cAbort')) $('cAbort').classList.toggle('hidden', phase === 'finished' || phase === 'floor');
  if (isHostScreen && $('dockInner')) $('dockInner').classList.toggle('hidden', !inDuel);

  // Cập nhật tức thì đáp án nhắc bài của Host (luôn sắc nét, bảo mật phía Người xem)
  syncHostAnswer(s);

  syncPassUi(s, now);
}

// ----- Pháo hoa liên tục (Continuous Fireworks Loop) -----
function renderFireworks(s) {
  const d = s.duel;
  if (s.phase === 'finished' && d) {
    const winnerSide = d.loserSide === 'A' ? 'B' : 'A';
    const key = `${d.winnerId}-${winnerSide}-${d.changed.join(',')}`;
    if (key === fxKey && fx && fx.running) return;
    fxKey = key;
    const w = playerById(s, d.winnerId);
    const zone = window.innerWidth >= 1024 ? (winnerSide === 'A' ? [0.04, 0.42] : [0.58, 0.96]) : [0.08, 0.92];
    fx.start(zone, [
      SIDE_COLOR[winnerSide],
      w ? w.color : '#ffd60a',
      '#ffd60a',
      '#0a84ff',
      '#ff7a59',
      '#30d158',
      '#bf5af2',
      '#ffffff',
    ]);
    Sfx.boom();
  } else if (fxKey || (fx && fx.running)) {
    fxKey = '';
    fx.stop();
    Sfx.stopVictory();
    // Rời màn vinh danh: hủy iframe YouTube/SoundCloud ẩn, thu hồi Blob URL & AudioBuffer để giải phóng RAM
    Sfx.releaseVictoryMedia();
    lastVictoryUrl = '';
  }
}

// ---------- Vòng lặp đồng hồ (mượt, 10fps) ----------
function frame() {
  if (!state || !state.duel || state.phase === 'floor') return;
  const d = state.duel;
  const now = transport.serverNow();
  const rem = { A: remainingOf(d, 'A', now), B: remainingOf(d, 'B', now) };

  ['A', 'B'].forEach((side) => {
    const ms = rem[side];
    const totalMs = (side === 'A' ? d.totalA : d.totalB) || DUEL_MS;
    const ratio = Math.max(0, Math.min(1, ms / totalMs));
    const clock = $(`clock${side}`);
    const bar = $(`bar${side}`);
    const text = (ms / 1000).toFixed(1).padStart(4, '0');
    if (clock.textContent !== text) clock.textContent = text;
    const danger = ms > 0 && ms <= 10000 && (state.phase === 'playing' || state.phase === 'paused');
    clock.classList.toggle('danger', danger && d.turn === side && state.phase === 'playing');
    clock.classList.toggle('zero', ms <= 0);
    bar.classList.toggle('danger', danger);
    bar.style.width = `${ratio * 100}%`;
    const ring = $(`ring${side}`);
    ring.style.strokeDashoffset = String(RING_LEN * (1 - ratio));
    ring.classList.toggle('danger', danger);
  });

  if (state.phase === 'countdown') {
    const total = d.cdTotal || COUNTDOWN_MS;
    const cdRem = countdownRemainingOf(d, now);
    const overdue = now - (d.cdEnd || now);
    const sec = Math.ceil(cdRem / 1000);
    const numEl = $('cdNum');
    const ringEl = $('cdRing');

    if (ringEl) {
      ringEl.style.strokeDashoffset = String(RING_LEN * (1 - cdRem / total));
      ringEl.classList.toggle('final', sec <= 3);
    }

    if (sec >= 1 && sec !== lastCdSec) {
      lastCdSec = sec;
      Sfx.countdownBeat(sec);
      if (numEl) {
        numEl.textContent = String(sec);
        numEl.classList.toggle('final', sec <= 3);
        numEl.classList.remove('beat');
        void numEl.offsetWidth;
        numEl.classList.add('beat');
      }
    }

    // Chạm mốc 0: kiểm tra ảnh câu hỏi đầu tiên đã nạp xong chưa; nếu chưa, giữ thêm tối đa 2s.
    if (cdRem <= 0) {
      const q0 = currentQuestion(d, 0);
      const firstReady = !q0 || q0.type !== 'img' || (getCached(q0.src) && getCached(q0.src).status !== 'loading');
      if (firstReady || overdue >= GRACE_WAIT_MS) {
        if (controller && !goPending) {
          goPending = true;
          dispatch('go');
        } else if (numEl && numEl.textContent !== 'GO!') {
          numEl.textContent = 'GO!';
          numEl.classList.add('final');
        }
      } else if (numEl) {
        numEl.textContent = '…';
        const cdText = $('cdLoadText');
        if (cdText) cdText.textContent = 'Mạng chậm — đang đợi ảnh đầu tiên sẵn sàng…';
      }
    }
    return;
  }

  if (state.phase === 'playing') {
    const cur = rem[d.turn];
    if (cur <= 0 && !tickPending) {
      tickPending = true;
      if ($('passOverlay')) $('passOverlay').classList.add('hidden');
      if ($('passRevealBox')) $('passRevealBox').classList.add('hidden');
      handleTimeUp();
      return;
    }
    if (d.passUntil && now >= d.passUntil && !passCompletePending) {
      passCompletePending = true;
      if ($('passOverlay')) $('passOverlay').classList.add('hidden');
      if ($('passRevealBox')) $('passRevealBox').classList.add('hidden');
      handlePassComplete();
      return;
    }
    syncPassUi(state, now);
  }
}

// ---------- Điều phối chuyển trang mượt, Staggered Cascade & Chế độ máy cấu hình thấp ----------
export function detectLowPowerMotion() {
  const lowCores = Boolean(navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2);
  const smartTv = /SmartTV|Tizen|Web0S|BRAVIA|AFT|CrKey|HbbTV/i.test(navigator.userAgent || '');
  const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lowPower = lowCores || smartTv || reducedMotion;
  if (document.body) {
    document.body.classList.toggle('low-power-motion', lowPower);
  }
  return lowPower;
}

function clearStaggerProps(el) {
  if (!el || !el.classList) return;
  ANIM_CLASSES.forEach((cls) => el.classList.remove(cls));
  el.style.removeProperty('--stagger-index');
  el.style.removeProperty('--stagger-step');
  el.style.removeProperty('--stagger-delay');
}

export function initStaggeredEntrance(root = document) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const candidates = [...root.querySelectorAll(STAGGER_SELECTOR)];
  if (root !== document && root.matches && root.matches(STAGGER_SELECTOR)) {
    candidates.unshift(root);
  }
  const visible = [];
  candidates.forEach((el) => {
    if (!el || el.classList.contains('hidden') || el.closest('#soundGate')) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    visible.push({ el, top: Math.round(rect.top), left: Math.round(rect.left) });
  });
  if (!visible.length) return;

  // Sắp xếp từ trên xuống dưới theo getBoundingClientRect().top (nếu ngang hàng thì theo left)
  visible.sort((a, b) => (a.top - b.top) || (a.left - b.left));

  const isLongListOrGrid = visible.length > 7;
  const stepMs = isLongListOrGrid ? 35 : 55;

  visible.forEach(({ el }, index) => {
    const staggerIdx = Math.min(index, 10);
    const delayMs = staggerIdx * stepMs;
    el.style.setProperty('--stagger-index', String(staggerIdx));
    el.style.setProperty('--stagger-step', `${stepMs}ms`);
    el.style.setProperty('--stagger-delay', `${delayMs}ms`);
    el.classList.remove('stagger-item');
    void el.offsetWidth;
    el.classList.add('stagger-item');
    setTimeout(() => clearStaggerProps(el), delayMs + 560);
  });
}
window.initStaggeredEntrance = initStaggeredEntrance;

export function navigateSmoothly(url) {
  if (!url) return;
  if (document.body) {
    document.body.classList.add('page-exiting');
  }
  setTimeout(() => {
    window.location.href = url;
  }, 180);
}
window.navigateSmoothly = navigateSmoothly;

function setupPageTransitions() {
  if (document.body) document.body.classList.remove('page-exiting');
  detectLowPowerMotion();
  initStaggeredEntrance(document);
  document.addEventListener('animationend', (e) => {
    clearStaggerProps(e.target);
  });
  window.addEventListener('pageshow', () => {
    if (document.body) document.body.classList.remove('page-exiting');
    initStaggeredEntrance(document);
  });
  document.querySelectorAll('a[href="index.html"], #linkCms').forEach((link) => {
    link.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      navigateSmoothly(link.href);
    });
  });
}

// ---------- UI tĩnh & phím tắt ----------
function bindStaticUi() {
  const unlock = (e) => {
    if (e) e.stopPropagation();
    const gate = $('soundGate');
    if (gate) {
      gate.classList.add('hidden');
      gate.style.display = 'none';
      gate.style.pointerEvents = 'none';
    }
    try { Sfx.unlock(); } catch { /* ignore */ }
    if (state) render(state);
  };
  ['soundGate', 'btnSoundGate'].forEach((id) => {
    const el = $(id);
    if (el) {
      el.addEventListener('pointerdown', unlock);
      el.addEventListener('click', unlock);
    }
  });
  window.addEventListener('keydown', () => {
    try { Sfx.unlock(); } catch { /* ignore */ }
  }, { once: true });

  setupPageTransitions();

  window.addEventListener('storage', (e) => {
    if (e.key === TOPICS_KEY && state) render(state);
  });
  window.addEventListener('pageshow', () => { if (state) render(state); });

  if ($('btnFirebase')) $('btnFirebase').addEventListener('click', openFirebaseSettings);
  if ($('btnMute')) {
    $('btnMute').addEventListener('click', () => {
      Sfx.setMuted(!Sfx.isMuted());
      $('btnMute').textContent = Sfx.isMuted() ? '🔇' : '🔊';
    });
  }
  if ($('btnFull')) {
    $('btnFull').addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
    });
  }

  onPreloadProgress(updatePreloadBadges);
  Sfx.onVictoryAudioChange(paintVictoryButtons);

  // Mở khóa AudioContext & phần tử media tùy chỉnh ngay khi người dùng tương tác
  ['click', 'keydown'].forEach((ev) => {
    window.addEventListener(ev, () => Sfx.unlock(), { passive: true });
  });

  if ($('btnVicToggle')) {
    $('btnVicToggle').addEventListener('click', (e) => {
      e.stopPropagation();
      Sfx.unlock();
      Sfx.toggleVictory();
    });
  }
  if ($('btnVicReplay')) {
    $('btnVicReplay').addEventListener('click', (e) => {
      e.stopPropagation();
      Sfx.unlock();
      Sfx.replayVictory();
    });
  }

  // Cụm thanh trượt kính mờ (frosted glass) chỉnh âm lượng trực tiếp trên màn hình Chiến thắng
  let lastSavedLocalVol = 1.0;
  let lastSavedOnlineVol = 1.0;
  if ($('liveLocalVol')) {
    $('liveLocalVol').addEventListener('input', (e) => {
      e.stopPropagation();
      const pct = Math.max(0, Math.min(100, Number(e.target.value) || 0));
      const vol01 = clampVolume01(pct / 100, 1.0);
      if (vol01 > 0) lastSavedLocalVol = vol01;
      Sfx.setLocalVolume(vol01);
    });
    $('liveLocalVol').addEventListener('change', (e) => {
      e.stopPropagation();
      const pct = Math.max(0, Math.min(100, Number(e.target.value) || 0));
      const vol01 = clampVolume01(pct / 100, 1.0);
      dispatch('setVictoryVolumes', { localAudioVolume: vol01 });
    });
  }
  if ($('btnLiveLocalMute')) {
    $('btnLiveLocalMute').addEventListener('click', (e) => {
      e.stopPropagation();
      const curVol = Sfx.getVictoryState().localAudioVolume;
      const nextVol = curVol > 0 ? 0 : (lastSavedLocalVol || 1.0);
      if (curVol > 0) lastSavedLocalVol = curVol;
      Sfx.setLocalVolume(nextVol);
      dispatch('setVictoryVolumes', { localAudioVolume: nextVol });
    });
  }
  if ($('liveOnlineVol')) {
    $('liveOnlineVol').addEventListener('input', (e) => {
      e.stopPropagation();
      const pct = Math.max(0, Math.min(100, Number(e.target.value) || 0));
      const vol01 = clampVolume01(pct / 100, 1.0);
      if (vol01 > 0) lastSavedOnlineVol = vol01;
      Sfx.setOnlineVolume(vol01);
    });
    $('liveOnlineVol').addEventListener('change', (e) => {
      e.stopPropagation();
      const pct = Math.max(0, Math.min(100, Number(e.target.value) || 0));
      const vol01 = clampVolume01(pct / 100, 1.0);
      dispatch('setVictoryVolumes', { onlineAudioVolume: vol01 });
    });
  }
  if ($('btnLiveOnlineMute')) {
    $('btnLiveOnlineMute').addEventListener('click', (e) => {
      e.stopPropagation();
      const curVol = Sfx.getVictoryState().onlineAudioVolume;
      const nextVol = curVol > 0 ? 0 : (lastSavedOnlineVol || 1.0);
      if (curVol > 0) lastSavedOnlineVol = curVol;
      Sfx.setOnlineVolume(nextVol);
      dispatch('setVictoryVolumes', { onlineAudioVolume: nextVol });
    });
  }

  // Nút chọn thời lượng đếm ngược (5s / 10s)
  const syncCdButtons = () => {
    document.querySelectorAll('#cdSelect [data-cd]').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.cd) === cdDurationMs);
    });
  };
  syncCdButtons();
  document.querySelectorAll('#cdSelect [data-cd]').forEach((b) => {
    b.addEventListener('click', () => {
      cdDurationMs = Number(b.dataset.cd) || COUNTDOWN_MS;
      localStorage.setItem('thefloor:cdMs', String(cdDurationMs));
      syncCdButtons();
    });
  });

  const press = (id, fn) => {
    const el = $(id);
    if (el) el.addEventListener('click', (e) => { fn(); e.currentTarget.blur(); });
  };
  press('cBegin', () => dispatch('begin', { durationMs: cdDurationMs }));
  press('cOk', () => dispatch('correct'));
  press('cPass', () => dispatch('pass'));
  press('cPause', () => dispatch(state && state.phase === 'paused' ? 'resume' : 'pause'));
  press('cBack', () => dispatch('back'));
  press('cAbort', () => { if (confirm('Hủy trận đấu hiện tại? Ô đất sẽ không thay đổi.')) dispatch('abort'); });

  press('btnStartDuel', () => dispatch('startDuel'));
  press('btnShuffleFloor', () => { if (confirm('Chia lại toàn bộ sàn ngẫu nhiên?')) dispatch('shuffleFloor'); });
  press('btnResetAll', () => { if (confirm('Đặt lại thí sinh và sàn về mặc định?')) dispatch('resetAll'); });
  document.querySelectorAll('#playerCountSeg [data-pc]').forEach((b) => {
    b.addEventListener('click', () => {
      const n = clampPlayerCount(b.dataset.pc);
      localStorage.setItem('thefloor:playerCount', String(n));
      dispatch('setPlayerCount', { count: n });
      b.blur();
    });
  });
  if ($('btnSwapPair')) $('btnSwapPair').addEventListener('click', () => dispatch('swapPair'));
  if ($('pairChalSec')) {
    $('pairChalSec').addEventListener('change', (e) => {
      if (!state || !state.setup || !state.setup.chalId) return;
      const sec = clampDurationSec(e.target.value);
      e.target.value = String(sec);
      dispatch('updatePlayer', { id: state.setup.chalId, patch: { durationSec: sec } });
    });
  }
  if ($('pairDefSec')) {
    $('pairDefSec').addEventListener('change', (e) => {
      if (!state || !state.setup || !state.setup.defId) return;
      const sec = clampDurationSec(e.target.value);
      e.target.value = String(sec);
      dispatch('updatePlayer', { id: state.setup.defId, patch: { durationSec: sec } });
    });
  }
  const applyBulkTime = () => {
    const inp = $('bulkTimeInput');
    if (!inp) return;
    const sec = clampDurationSec(inp.value);
    inp.value = String(sec);
    dispatch('setAllPlayerTime', { durationSec: sec });
  };
  if ($('btnBulkTime')) $('btnBulkTime').addEventListener('click', applyBulkTime);
  if ($('bulkTimeInput')) {
    $('bulkTimeInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyBulkTime();
      }
    });
  }
  if ($('selChal')) $('selChal').addEventListener('change', (e) => e.target.value && dispatch('setChallenger', { id: e.target.value }));
  if ($('selCat')) $('selCat').addEventListener('change', (e) => dispatch('setCategory', { id: e.target.value }));

  // Mini panel
  if ($('miniToggle')) {
    $('miniToggle').addEventListener('click', () => {
      const c = $('miniPanel') && $('miniPanel').classList.toggle('collapsed');
      if ($('miniArrow')) $('miniArrow').textContent = c ? '▲' : '▼';
    });
  }
  const tryUnlock = () => {
    const pin = $('miniPin') ? $('miniPin').value : '';
    if (state && (!state.pin || state.pin === pin)) {
      sessionStorage.setItem(`${pinKey}:unlocked`, state.pin || '');
      controller = true;
      if ($('miniErr')) $('miniErr').classList.add('hidden');
      render(state);
      if ($('roleLabel')) $('roleLabel').textContent = 'Màn hình · đã mở khóa Host';
    } else if ($('miniErr')) {
      $('miniErr').classList.remove('hidden');
    }
  };
  if ($('miniUnlock')) $('miniUnlock').addEventListener('click', tryUnlock);
  if ($('miniPin')) $('miniPin').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.stopPropagation(); tryUnlock(); } });

  window.addEventListener('keydown', (e) => {
    if (!controller || !state) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (['input', 'select', 'textarea'].includes(tag)) return;
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    const passWaiting = isPassWaiting(state);
    if (state.phase === 'ready' && (k === ' ' || k === 'Enter')) {
      e.preventDefault();
      pulse('cBegin');
      dispatch('begin', { durationMs: cdDurationMs });
    } else if (state.phase === 'playing' && !passWaiting && (k === ' ' || k === 'Enter')) {
      e.preventDefault();
      pulse('cOk');
      dispatch('correct');
    } else if (state.phase === 'playing' && !passWaiting && (k === 'p' || k === 'P' || k === 'ArrowDown')) {
      e.preventDefault();
      pulse('cPass');
      dispatch('pass');
    } else if ((state.phase === 'playing' || state.phase === 'paused') && (k === 't' || k === 'T')) {
      pulse('cPause');
      dispatch(state.phase === 'paused' ? 'resume' : 'pause');
    }
  });
}

/** Phản hồi xúc giác: nút co lại 0.95 rồi nảy ra khi dùng phím tắt. */
function pulse(id) {
  const el = $(id);
  if (!el || el.disabled) return;
  el.classList.add('pressed');
  setTimeout(() => el.classList.remove('pressed'), 150);
}

function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Khởi chạy ứng dụng sau khi toàn bộ biến const/let và hàm đã khai báo đầy đủ
init();
