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
export const PRELOAD_WINDOW = 8;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const DEFAULT_PLAYER_COUNT = 4;

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

/** Trích xuất danh sách URL ảnh từ bộ items (theo thứ tự hàng đợi nếu có). */
export function extractImageUrls(items = [], queue = null) {
  const ordered = Array.isArray(queue) && queue.length ? queue.map((i) => items[i]).filter(Boolean) : items;
  return ordered.filter((it) => it && it.type === 'img' && it.src).map((it) => it.src);
}

/**
 * Cửa sổ trượt bộ nhớ đệm ảnh: chỉ giữ tối đa `windowSize` (mặc định 8) ảnh tiếp theo
 * được giải mã sẵn trong RAM, đồng thời giải phóng tham chiếu các ảnh đã qua.
 */
export function preloadWindow(duel, windowSize = PRELOAD_WINDOW) {
  const urls = [];
  if (duel && Array.isArray(duel.items) && duel.items.length) {
    const queue = Array.isArray(duel.queue) && duel.queue.length
      ? duel.queue
      : duel.items.map((_, i) => i);
    const start = Math.max(0, Number(duel.qPos) || 0);
    const limit = Math.min(windowSize, queue.length);
    for (let i = 0; i < limit; i++) {
      const it = duel.items[queue[(start + i) % queue.length]];
      if (it && it.type === 'img' && it.src && !urls.includes(it.src)) {
        urls.push(it.src);
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
          try { entry.img.src = ''; } catch { /* ignore */ }
        }
        delete cache[key];
      }
    });
    if (typeof Image !== 'undefined') {
      urls.forEach((url) => {
        if (cache[url]) return;
        const img = new Image();
        img.decoding = 'async';
        const entry = { img, url, ready: false };
        img.onload = () => { entry.ready = true; };
        img.onerror = () => { entry.ready = false; };
        img.src = url;
        if (typeof img.decode === 'function') {
          img.decode().then(() => { entry.ready = true; }).catch(() => {});
        }
        cache[url] = entry;
      });
    }
  }
  return urls;
}

/** Thời gian đếm ngược chuẩn bị trận còn lại (ms) tại thời điểm `now`. */
export function countdownRemainingOf(duel, now) {
  if (!duel || !duel.cdEnd) return 0;
  return Math.max(0, duel.cdEnd - now);
}

/** Thời gian còn lại (ms) của một phía tại thời điểm `now` (giờ server). */
export function remainingOf(duel, side, now) {
  const base = side === 'A' ? duel.remA : duel.remB;
  if (duel.running && duel.turn === side) return Math.max(0, base - (now - duel.tStamp));
  return Math.max(0, base);
}

export function currentQuestion(duel, offset = 0) {
  if (!duel) return null;
  const queue = duel.queue || [];
  const items = duel.items || [];
  if (!queue.length || !items.length) return null;
  return items[queue[(duel.qPos + offset) % queue.length]] || null;
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
      s.setup.preloadUrls = extractImageUrls(cat.items);
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
        preloadUrls: extractImageUrls(cat.items),
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
      const cat = getCategory(catId);
      if (!cat || !cat.items.length) return false;
      const pA = playerById(s, chalId);
      const pB = playerById(s, defId);
      const durA = clampDurationSec(pA?.durationSec) * 1000;
      const durB = clampDurationSec(pB?.durationSec) * 1000;
      // Chụp lại bộ câu hỏi + âm thanh chiến thắng kép vào trận để mọi màn hình đều đồng bộ.
      const order = cat.items.map((_, i) => i);
      s.duel = {
        items: cat.items.map((it) => ({ ...it, aliases: it.aliases || [] })),
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
        queue: cat.shuffle === false ? order : shuffle(order),
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
