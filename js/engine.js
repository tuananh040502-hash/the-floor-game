/**
 * Logic trận đấu thuần (không đụng DOM). Mọi hành động đi qua reduce().
 * Đồng hồ dùng mô hình: remA/remB (ms còn lại tại thời điểm tStamp) + running/turn,
 * nhờ vậy mọi màn hình tự tính đồng hồ mượt mà từ cùng một trạng thái.
 */
import { allCategories, getCategory, clampVolume01 } from './topics.js';

export const DUEL_MS = 60000;
export const DEFAULT_DURATION_SEC = 60;
export const PENALTY_MS = 2000;
export const COUNTDOWN_MS = 10000;
export const PRELOAD_WINDOW = 3; // Chỉ preload tối đa 3 ảnh tiếp theo (currentIndex + 1, + 2, + 3)
export const PRELOAD_TIMEOUT_MS = 5000;
export const PRELOAD_RETRY_COUNT = 1;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const DEFAULT_PLAYER_COUNT = 4;

/** Ảnh thay thế (SVG Data URI gọn nhẹ) hiển thị mượt mà khi ảnh gốc bị lỗi mạng sau khi đã thử lại. */
export const FALLBACK_IMAGE_DATA_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" width="800" height="500">'
  + '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
  + '<stop offset="0%" stop-color="#1e293b"/><stop offset="100%" stop-color="#0f172a"/>'
  + '</linearGradient></defs>'
  + '<rect width="800" height="500" rx="24" fill="url(#g)"/>'
  + '<rect x="260" y="130" width="280" height="190" rx="18" fill="none" stroke="#475569" stroke-width="6"/>'
  + '<circle cx="335" cy="195" r="22" fill="#64748b"/>'
  + '<path d="M285 295 l65-65 l50 45 l55-60 l60 80 z" fill="#475569"/>'
  + '<text x="400" y="380" text-anchor="middle" fill="#94a3b8" font-family="sans-serif" font-size="24" font-weight="600">Ảnh câu hỏi đang dùng bản dự phòng</text>'
  + '</svg>',
)}`;

const DEFAULT_PLAYERS = [
  { id: 'p1', name: 'Minh', avatar: '🦁', color: '#06b6d4', categoryId: 'flags', durationSec: 60 },
  { id: 'p2', name: 'Lan', avatar: '🐯', color: '#eab308', categoryId: 'animals', durationSec: 60 },
  { id: 'p3', name: 'Hùng', avatar: '🦊', color: '#a855f7', categoryId: 'food', durationSec: 60 },
  { id: 'p4', name: 'Mai', avatar: '🐼', color: '#22c55e', categoryId: 'vehicles', durationSec: 60 },
  { id: 'p5', name: 'Tuấn', avatar: '🦄', color: '#ec4899', categoryId: 'sports', durationSec: 60 },
  { id: 'p6', name: 'Vy', avatar: '🐲', color: '#f97316', categoryId: 'nature', durationSec: 60 },
];

export function clampDurationSec(sec) {
  const v = Math.round(Number(sec));
  if (!Number.isFinite(v)) return DEFAULT_DURATION_SEC;
  return Math.max(10, Math.min(600, v));
}

export function clampPlayerCount(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return DEFAULT_PLAYER_COUNT;
  return Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, v));
}

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Mỗi người chơi sở hữu đúng 1 ô lúc đầu: số ô của sàn = số người chơi (2..6). */
function dealFloor(players) {
  return shuffle(players.map((p) => p.id));
}

export function createInitialState(pin, playerCount = DEFAULT_PLAYER_COUNT) {
  const n = clampPlayerCount(playerCount);
  const players = DEFAULT_PLAYERS.slice(0, n).map((p) => ({ ...p }));
  return {
    pin: pin || '',
    phase: 'floor', // floor | ready | countdown | playing | paused | finished
    players,
    floor: dealFloor(players),
    setup: {},
    duel: null,
    championId: '',
    event: null,
  };
}

export function playerById(state, id) {
  return state.players.find((p) => p.id === id) || null;
}

export function cellCount(state, id) {
  return state.floor.reduce((n, o) => n + (o === id ? 1 : 0), 0);
}

/** Người chơi còn sở hữu ít nhất 1 ô (còn trong cuộc). */
export function alivePlayers(state) {
  return state.players.filter((p) => cellCount(state, p.id) > 0);
}

/** Id người vô địch nếu một người đã sở hữu toàn bộ sàn; ngược lại ''. */
export function findChampion(state) {
  const first = state.floor[0];
  return first && state.floor.every((o) => o === first) ? first : '';
}

let activeDuelRef = null;
let preloadSeqId = 0;

/** Trích xuất Google Drive File ID từ mọi biến thể link (/d/{ID}, ?id={ID}, &id={ID}). */
export function extractDriveFileId(raw) {
  if (typeof raw !== 'string') return '';
  const s = raw.trim();
  if (!s || s.startsWith('data:')) return '';
  const byPath = /\/(?:file\/)?d\/([a-zA-Z0-9_-]{10,})/i.exec(s);
  if (byPath && byPath[1]) return byPath[1];
  const byQuery = /[?&]id=([a-zA-Z0-9_-]{10,})/i.exec(s);
  if (byQuery && byQuery[1]) return byQuery[1];
  if (/^[a-zA-Z0-9_-]{25,}$/.test(s)) return s;
  return '';
}

/** Link fallback Google Drive Thumbnail khi link CDN lh3 gặp sự cố. */
export function driveFallbackUrl(raw) {
  const id = extractDriveFileId(raw);
  return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w1280` : '';
}

/**
 * Chuẩn hóa URL ảnh:
 * - Giữ nguyên toàn bộ chuỗi data:image/... (WebP/JPEG/PNG Base64) không cắt xén.
 * - Nếu là link Google Drive có File ID (/d/{ID} hoặc ?id={ID} / &id={ID}), chuyển về
 *   CDN ổn định nhất: https://lh3.googleusercontent.com/d/${ID}=w1280.
 * - Với các URL http/https khác: giữ nguyên đầy đủ cả phần query string (?...&...).
 */
export function normalizeImageUrl(url) {
  if (typeof url !== 'string') return '';
  const s = url.trim();
  if (!s) return '';
  if (s.startsWith('data:image/')) {
    const comma = s.indexOf(',');
    if (comma < 0) return '';
    const head = s.slice(0, comma + 1);
    const body = s.slice(comma + 1).replace(/\s+/g, '');
    return body ? `${head}${body}` : '';
  }
  const driveId = extractDriveFileId(s);
  if (driveId && /(?:drive\.google\.com|docs\.google\.com|googleusercontent\.com)/i.test(s)) {
    return `https://lh3.googleusercontent.com/d/${driveId}=w1280`;
  }
  if (driveId && /^[a-zA-Z0-9_-]{25,}$/.test(s)) {
    return `https://lh3.googleusercontent.com/d/${driveId}=w1280`;
  }
  if (/^https?:\/\//i.test(s)) return s;
  return '';
}

/** Giữ tương thích với tên hàm cleanImageSrc: luôn bảo toàn query string & chuẩn hóa link Drive. */
export function cleanImageSrc(raw) {
  return normalizeImageUrl(raw);
}

function compactDuelItem(it) {
  if (!it || typeof it !== 'object') return null;
  const answer = String(it.answer || '').trim();
  const aliases = Array.isArray(it.aliases) ? it.aliases.map((a) => String(a || '').trim()).filter(Boolean) : [];
  if (it.type === 'emoji') {
    return { type: 'emoji', emoji: String(it.emoji || '❓').trim(), answer, aliases };
  }
  const src = normalizeImageUrl(it.src) || String(it.src || '').trim();
  if (!src) return null;
  return { type: 'img', src, answer, aliases };
}

/**
 * Trích xuất danh sách URL ảnh gọn gàng trong cửa sổ trượt:
 * Chỉ lấy ảnh hiện tại + tối đa `PRELOAD_WINDOW` (3) ảnh tiếp theo (`currentIndex + 1, + 2, + 3`)
 * để tránh tải ồ ạt 100 ảnh gây lỗi 429 Too Many Requests.
 */
export function extractImageUrls(items = [], queue = null, startIndex = null, maxNext = PRELOAD_WINDOW) {
  if (!Array.isArray(items) || !items.length) return [];
  const hasQueue = Array.isArray(queue) && queue.length > 0;
  const order = hasQueue ? queue : items.map((_, i) => i);
  if (!order.length) return [];

  let currentIndex = 0;
  if (Number.isFinite(startIndex) && startIndex >= 0) {
    currentIndex = startIndex;
  } else if (activeDuelRef && (activeDuelRef.items === items || activeDuelRef.queue === queue)) {
    currentIndex = Math.max(0, Number(activeDuelRef.qPos) || 0);
  }

  // Cửa sổ gồm ảnh đang hiển thị (currentIndex) + tối đa 3 ảnh kế tiếp (currentIndex + 1, + 2, + 3)
  const windowCount = Math.min(order.length, Math.max(1, Number(maxNext) + 1));
  const urls = [];
  for (let offset = 0; offset < windowCount; offset++) {
    const it = items[order[(currentIndex + offset) % order.length]];
    if (it && it.type === 'img' && it.src) {
      const clean = normalizeImageUrl(it.src);
      if (clean && !urls.includes(clean)) urls.push(clean);
    }
  }
  return urls;
}

function buildRetryUrl(url) {
  if (!url || url.startsWith('data:')) return url;
  const thumb = driveFallbackUrl(url);
  if (thumb && url !== thumb) return thumb;
  return `${url}${url.includes('?') ? '&' : '?'}retry=1`;
}

function loadSingleImageWithTimeout(entry, targetUrl, timeoutMs = PRELOAD_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const img = entry.img;
    // Tuyệt đối không đặt crossOrigin="anonymous" vì Google Drive CDN chặn CORS
    img.removeAttribute('crossorigin');
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      img.onload = null;
      img.onerror = null;
      resolve(false);
    }, timeoutMs);

    img.onload = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      entry.resolvedUrl = targetUrl;
      if (typeof img.decode === 'function') {
        img.decode().catch(() => {}).finally(() => resolve(true));
      } else {
        resolve(true);
      }
    };
    img.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      console.error('Lỗi tải ảnh:', img.src || targetUrl);
      resolve(false);
    };
    img.src = targetUrl;
  });
}

/**
 * Tải tuần tự thông minh (Queue / Batch Preload):
 * - Chỉ preload ảnh hiện tại (`currentIndex`) và tối đa 3 ảnh tiếp theo (`currentIndex + 1, + 2, + 3`).
 * - Tải tuần tự từng ảnh với Timeout 5 giây + Retry 1 lần (fallback sang drive.google.com/thumbnail).
 * - Không đặt crossOrigin để tránh lỗi CORS từ Google Drive CDN.
 */
export function preloadWindow(duel, windowSize = PRELOAD_WINDOW) {
  activeDuelRef = duel || null;
  const urls = [];
  if (duel && Array.isArray(duel.items) && duel.items.length) {
    const queue = Array.isArray(duel.queue) && duel.queue.length
      ? duel.queue
      : duel.items.map((_, i) => i);
    const currentIndex = Math.max(0, Number(duel.qPos) || 0);
    // currentIndex + tối đa 3 ảnh tiếp theo (currentIndex + 1, + 2, + 3)
    const maxWindow = Math.min(queue.length, Math.max(1, Number(windowSize) + 1));
    for (let offset = 0; offset < maxWindow; offset++) {
      const it = duel.items[queue[(currentIndex + offset) % queue.length]];
      if (it && it.type === 'img' && it.src) {
        const clean = normalizeImageUrl(it.src);
        if (clean) {
          it.src = clean;
          if (!urls.includes(clean)) urls.push(clean);
        }
      }
    }
  }

  if (typeof window !== 'undefined') {
    const cache = window.__imageCache || (window.__imageCache = {});
    const keep = new Set(urls);
    Object.keys(cache).forEach((key) => {
      if (!keep.has(key)) {
        const entry = cache[key];
        if (entry && entry.img) {
          try {
            entry.img.onload = null;
            entry.img.onerror = null;
            entry.img.src = '';
          } catch { /* ignore */ }
        }
        delete cache[key];
      }
    });

    if (typeof Image !== 'undefined' && urls.length) {
      const mySeq = ++preloadSeqId;
      (async () => {
        for (const url of urls) {
          if (mySeq !== preloadSeqId) return;
          const existing = cache[url];
          if (existing && (existing.ready || existing.loading)) continue;

          const img = new Image();
          img.decoding = 'async';
          img.referrerPolicy = 'no-referrer';
          img.removeAttribute('crossorigin');
          const entry = { img, url, resolvedUrl: url, ready: false, loading: true, failed: false, status: 'loading' };
          cache[url] = entry;

          let ok = await loadSingleImageWithTimeout(entry, url, PRELOAD_TIMEOUT_MS);
          if (!ok && mySeq === preloadSeqId && PRELOAD_RETRY_COUNT > 0) {
            const retryUrl = buildRetryUrl(url);
            ok = await loadSingleImageWithTimeout(entry, retryUrl, PRELOAD_TIMEOUT_MS);
          }

          if (mySeq !== preloadSeqId) return;
          entry.loading = false;
          if (ok) {
            entry.ready = true;
            entry.status = 'ok';
            entry.cdn = entry.resolvedUrl || url;
          } else {
            entry.failed = true;
            entry.ready = true;
            entry.status = 'error';
            entry.cdn = FALLBACK_IMAGE_DATA_URL;
            entry.img.src = FALLBACK_IMAGE_DATA_URL;
          }
        }
      })();
    }
  }
  return urls;
}

/** Thời gian đếm ngược chuẩn bị trận còn lại (ms) tại thời điểm `now`. */
export function countdownRemainingOf(duel, now) {
  if (duel) activeDuelRef = duel;
  if (!duel || !duel.cdEnd) return 0;
  return Math.max(0, duel.cdEnd - now);
}

/** Thời gian còn lại (ms) của một phía tại thời điểm `now` (giờ server). */
export function remainingOf(duel, side, now) {
  if (duel) activeDuelRef = duel;
  const base = side === 'A' ? duel.remA : duel.remB;
  if (duel.running && duel.turn === side) return Math.max(0, base - (now - duel.tStamp));
  return Math.max(0, base);
}

export function currentQuestion(duel, offset = 0) {
  if (!duel) return null;
  activeDuelRef = duel;
  const queue = duel.queue || [];
  const items = duel.items || [];
  if (!queue.length || !items.length) return null;
  const pos = Math.max(0, Number(duel.qPos) || 0);
  const it = items[queue[(pos + offset) % queue.length]] || null;
  if (it && it.type === 'img' && it.src) {
    const normalized = normalizeImageUrl(it.src);
    if (normalized) it.src = normalized;
  }
  return it;
}

function setRem(duel, side, ms) {
  if (side === 'A') duel.remA = ms;
  else duel.remB = ms;
}

function finish(s, loserSide) {
  const d = s.duel;
  const winnerSide = loserSide === 'A' ? 'B' : 'A';
  setRem(d, loserSide, 0);
  d.running = false;
  d.passUntil = 0;
  d.passRem = 0;
  d.passAnswer = '';
  d.loserSide = loserSide;
  d.winnerId = winnerSide === 'A' ? d.aId : d.bId;
  d.loserId = loserSide === 'A' ? d.aId : d.bId;
  d.changed = [];
  s.floor = s.floor.map((owner, i) => {
    if (owner === d.loserId) {
      d.changed.push(i);
      return d.winnerId;
    }
    return owner;
  });
  s.championId = findChampion(s);
  s.phase = 'finished';
  preloadWindow(null);
  return 'finish';
}

/**
 * Áp dụng hành động lên `s` (đã clone). Trả về:
 *  - false: hành động không hợp lệ
 *  - string: tên sự kiện âm thanh cần phát
 *  - null: hợp lệ, không có sự kiện
 */
export function reduce(s, type, arg = {}, now) {
  const d = s.duel;
  switch (type) {
    case 'selectCell': {
      if (s.phase !== 'floor' || s.championId) return false;
      const owner = s.floor[arg.cell];
      if (!owner) return false;
      s.setup = { ...s.setup, cell: arg.cell, defId: owner };
      if (s.setup.chalId === owner) delete s.setup.chalId;
      const cat = getCategory(playerById(s, owner).categoryId);
      s.setup.catId = cat.id;
      s.setup.preloadUrls = extractImageUrls(cat.items, null, 0, PRELOAD_WINDOW);
      s.setup.victoryAudioUrl = cat.victoryAudioUrl || '';
      s.setup.victoryVoiceData = cat.victoryVoiceData || '';
      s.setup.victoryVoiceName = cat.victoryVoiceName || '';
      s.setup.localAudioVolume = clampVolume01(cat.localAudioVolume, 1.0);
      s.setup.onlineAudioVolume = clampVolume01(cat.onlineAudioVolume, 1.0);
      return 'click';
    }
    case 'setChallenger':
      if (s.phase !== 'floor' || arg.id === s.setup.defId) return false;
      if (!playerById(s, arg.id) || cellCount(s, arg.id) < 1) return false; // người đã mất hết ô không thể thách đấu
      s.setup = { ...s.setup, chalId: arg.id };
      return 'click';
    case 'setCategory': {
      if (s.phase !== 'floor' || !allCategories().some((c) => c.id === arg.id)) return false;
      const cat = getCategory(arg.id);
      s.setup = {
        ...s.setup,
        catId: arg.id,
        preloadUrls: extractImageUrls(cat.items, null, 0, PRELOAD_WINDOW),
        victoryAudioUrl: cat.victoryAudioUrl || '',
        victoryVoiceData: cat.victoryVoiceData || '',
        victoryVoiceName: cat.victoryVoiceName || '',
        localAudioVolume: clampVolume01(cat.localAudioVolume, 1.0),
        onlineAudioVolume: clampVolume01(cat.onlineAudioVolume, 1.0),
      };
      return null;
    }
    case 'startDuel': {
      const { chalId, defId, catId } = s.setup;
      if (s.phase !== 'floor' || s.championId || !chalId || !defId || !catId) return false;
      if (chalId === defId || cellCount(s, chalId) < 1 || cellCount(s, defId) < 1) return false;
      const cat = arg.cat || getCategory(catId);
      if (!cat || !cat.items || !cat.items.length) return false;
      const pA = playerById(s, chalId);
      const pB = playerById(s, defId);
      const durA = clampDurationSec(pA?.durationSec) * 1000;
      const durB = clampDurationSec(pB?.durationSec) * 1000;
      const compactItems = cat.items.map(compactDuelItem).filter(Boolean);
      if (!compactItems.length) return false;
      // Chụp lại bộ câu hỏi gọn gàng + âm thanh chiến thắng kép vào trận để mọi màn hình đồng bộ mượt mà.
      const order = compactItems.map((_, i) => i);
      const queue = cat.shuffle === false ? order : shuffle(order);
      s.duel = {
        items: compactItems,
        catName: cat.name,
        catIcon: cat.icon,
        victoryAudioUrl: cat.victoryAudioUrl || '',
        victoryVoiceData: cat.victoryVoiceData || s.setup.victoryVoiceData || '',
        victoryVoiceName: cat.victoryVoiceName || s.setup.victoryVoiceName || '',
        localAudioVolume: clampVolume01(cat.localAudioVolume ?? s.setup.localAudioVolume, 1.0),
        onlineAudioVolume: clampVolume01(cat.onlineAudioVolume ?? s.setup.onlineAudioVolume, 1.0),
        aId: chalId,
        bId: defId,
        categoryId: catId,
        queue,
        qPos: 0,
        turn: 'A',
        running: false,
        tStamp: 0,
        totalA: durA,
        totalB: durB,
        remA: durA,
        remB: durB,
        passUntil: 0,
        passRem: 0,
        passAnswer: '',
        cdTotal: COUNTDOWN_MS,
        cdEnd: 0,
      };
      s.setup.preloadUrls = extractImageUrls(compactItems, queue, 0, PRELOAD_WINDOW);
      s.phase = 'ready';
      preloadWindow(s.duel);
      return 'ready';
    }
    case 'setVictoryVolumes': {
      if (!d) return false;
      if (arg.localAudioVolume !== undefined) {
        d.localAudioVolume = clampVolume01(arg.localAudioVolume, d.localAudioVolume ?? 1.0);
      }
      if (arg.onlineAudioVolume !== undefined) {
        d.onlineAudioVolume = clampVolume01(arg.onlineAudioVolume, d.onlineAudioVolume ?? 1.0);
      }
      return null;
    }
    case 'begin': {
      if (s.phase !== 'ready') return false;
      const dur = Number(arg.durationMs) > 0 ? Number(arg.durationMs) : COUNTDOWN_MS;
      d.cdTotal = dur;
      d.cdEnd = now + dur;
      d.running = false;
      s.phase = 'countdown';
      return 'countdown';
    }
    case 'go':
      if (s.phase !== 'countdown') return false;
      d.running = true;
      d.tStamp = now;
      d.cdEnd = 0;
      d.passUntil = 0;
      d.passRem = 0;
      d.passAnswer = '';
      s.phase = 'playing';
      preloadWindow(d);
      return 'start';
    case 'correct': {
      if (s.phase !== 'playing') return false;
      if (d.passUntil && now < d.passUntil) return false;
      const cur = remainingOf(d, d.turn, now);
      if (cur <= 0) return finish(s, d.turn);
      setRem(d, d.turn, cur);
      d.turn = d.turn === 'A' ? 'B' : 'A';
      d.tStamp = now;
      d.passUntil = 0;
      d.passRem = 0;
      d.passAnswer = '';
      d.qPos += 1;
      preloadWindow(d);
      return 'ding';
    }
    case 'pass': {
      if (s.phase !== 'playing') return false;
      if (d.passUntil && now < d.passUntil) return false;
      const cur = remainingOf(d, d.turn, now);
      if (cur <= 0) return finish(s, d.turn);
      // Không trừ thẳng 2s: giữ nguyên đồng hồ chạy tự nhiên, mở đáp án trong 2 giây
      const q = currentQuestion(d);
      d.passUntil = now + PENALTY_MS;
      d.passRem = 0;
      d.passAnswer = q ? q.answer : '';
      return 'buzz';
    }
    case 'passComplete': {
      if (s.phase !== 'playing' || !d || !d.passUntil) return false;
      const cur = remainingOf(d, d.turn, now);
      if (cur <= 0) return finish(s, d.turn);
      d.passUntil = 0;
      d.passRem = 0;
      d.passAnswer = '';
      d.qPos += 1;
      preloadWindow(d);
      return null;
    }
    case 'pause': {
      if (s.phase !== 'playing') return false;
      setRem(d, d.turn, remainingOf(d, d.turn, now));
      if (d.passUntil && d.passUntil > now) {
        d.passRem = d.passUntil - now;
      } else {
        d.passRem = 0;
      }
      d.passUntil = 0;
      d.running = false;
      s.phase = 'paused';
      return 'pause';
    }
    case 'resume':
      if (s.phase !== 'paused') return false;
      d.running = true;
      d.tStamp = now;
      if (d.passRem && d.passRem > 0) {
        d.passUntil = now + d.passRem;
        d.passRem = 0;
      }
      s.phase = 'playing';
      return 'pause';
    case 'tick': {
      if (s.phase !== 'playing') return false;
      if (remainingOf(d, d.turn, now) <= 0) return finish(s, d.turn);
      return false;
    }
    case 'back':
      if (s.phase !== 'finished') return false;
      s.phase = 'floor';
      s.setup = {};
      preloadWindow(null);
      return 'click';
    case 'abort':
      if (!['ready', 'countdown', 'playing', 'paused'].includes(s.phase)) return false;
      s.phase = 'floor';
      s.duel = null;
      s.setup = {};
      preloadWindow(null);
      return 'click';
    case 'updatePlayer': {
      const p = playerById(s, arg.id);
      if (!p || !arg.patch) return false;
      const patch = { ...arg.patch };
      if (patch.durationSec !== undefined) {
        patch.durationSec = clampDurationSec(patch.durationSec);
      }
      Object.assign(p, patch);
      return null;
    }
    case 'setAllPlayerTime': {
      if (s.phase !== 'floor') return false;
      const sec = clampDurationSec(arg.durationSec);
      s.players.forEach((p) => { p.durationSec = sec; });
      return null;
    }
    case 'shuffleFloor':
      if (s.phase !== 'floor') return false;
      s.floor = dealFloor(s.players);
      s.setup = {};
      s.duel = null;
      s.championId = '';
      return 'click';
    case 'setPlayerCount': {
      if (s.phase !== 'floor') return false;
      const n = clampPlayerCount(arg.count);
      if (n === s.players.length) return false;
      const keep = s.players.slice(0, n);
      for (let i = keep.length; i < n; i++) {
        const base = DEFAULT_PLAYERS[i];
        const usedCats = new Set(keep.map((p) => p.categoryId));
        keep.push({
          ...base,
          durationSec: clampDurationSec(s.players[0]?.durationSec ?? base.durationSec),
          categoryId: usedCats.has(base.categoryId) ? s.players[0].categoryId : base.categoryId,
        });
      }
      s.players = keep;
      s.floor = dealFloor(keep);
      s.setup = {};
      s.duel = null;
      s.championId = '';
      return 'click';
    }
    case 'resetAll': {
      const fresh = createInitialState(s.pin, s.players.length);
      Object.keys(s).forEach((k) => delete s[k]);
      Object.assign(s, fresh);
      return 'click';
    }
    default:
      return false;
  }
}
