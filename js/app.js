import { loadFirebaseConfig } from './firebase-config.js';
import { openFirebaseSettings } from './settings.js';
import { createTransport } from './transport.js';
import { allCategories, TOPICS_KEY, loadTopicAudioIDB, clampVolume01 } from './topics.js';
import {
  createInitialState, reduce, remainingOf, countdownRemainingOf, extractImageUrls,
  playerById, cellCount, currentQuestion, DUEL_MS, COUNTDOWN_MS, CELLS,
} from './engine.js';
import { Sfx } from './audio.js';
import { Fireworks } from './fx.js';
import { preloadImages, pruneCache, getCached, getProgress, onPreloadProgress, toCdnUrl } from './preload.js';

const $ = (id) => document.getElementById(id);
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
const requestedHost = params.get('role') === 'host';
const pinKey = `thefloor:pin:${room}`;

let role = 'view';
let controller = false; // được phép điều khiển (Host hoặc đã mở khóa PIN)
let state = null;
let transport = null;
let firstSnapshot = true;
let lastEventId = null;
let prevPhase = null;
let tickPending = false;
let goPending = false;
let lastCdSec = -1;
let cdDurationMs = Number(localStorage.getItem('thefloor:cdMs')) || COUNTDOWN_MS;
let lastPreloadSig = '';
let lastVictoryUrl = '';
let floorBuilt = false;
let artKey = '';
let fx = null;
let fxKey = '';

// ---------- Khởi động ----------
init();

async function init() {
  $('roomLabel').textContent = room;
  $('gateRoom').textContent = room;
  fx = new Fireworks($('fx'));
  bindStaticUi();
  transport = await createTransport(room, loadFirebaseConfig());
  transport.onStatus(onConnStatus);
  if (transport.mode === 'local') {
    onConnStatus({ type: 'local' });
    if (transport.fallbackReason) showConnError(`Firebase lỗi (${transport.fallbackReason}) — đang dùng chế độ cục bộ.`);
  }
  transport.subscribe(onSnapshot);
  requestAnimationFrame(frame);
}

const conn = { base: '…', latency: '', error: '' };
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

function onSnapshot(remote) {
  if (!remote) {
    if (requestedHost && firstSnapshot) {
      const fresh = createInitialState(sessionStorage.getItem(pinKey) || '');
      role = 'host';
      controller = true;
      state = fresh;
      transport.write(fresh);
      firstSnapshot = false;
      applyState(fresh);
    } else {
      showWaiting();
    }
    return;
  }
  if (firstSnapshot) {
    if (requestedHost) {
      const pin = sessionStorage.getItem(pinKey) || '';
      if (!remote.pin || remote.pin === pin) {
        role = 'host';
      } else {
        alert('PIN Host không đúng cho phòng này — bạn đang vào ở chế độ xem. Dùng bảng điều khiển mini để mở khóa.');
      }
    }
    controller = role === 'host' || (remote.pin && sessionStorage.getItem(`${pinKey}:unlocked`) === remote.pin);
  }
  state = normalize(remote);
  applyState(state, !firstSnapshot);
  firstSnapshot = false;
}

/** Firebase bỏ mảng/object rỗng — khôi phục các trường bắt buộc. */
function normalize(s) {
  s.players = s.players || [];
  s.floor = Array.from({ length: CELLS }, (_, i) => (s.floor || [])[i] || s.players[0]?.id);
  s.setup = s.setup || {};
  s.setup.preloadUrls = s.setup.preloadUrls || [];
  s.setup.victoryAudioUrl = s.setup.victoryAudioUrl || '';
  s.setup.victoryVoiceData = s.setup.victoryVoiceData || '';
  s.setup.victoryVoiceName = s.setup.victoryVoiceName || '';
  s.setup.localAudioVolume = clampVolume01(s.setup.localAudioVolume, 1.0);
  s.setup.onlineAudioVolume = clampVolume01(s.setup.onlineAudioVolume, 1.0);
  if (s.duel) {
    s.duel.queue = s.duel.queue || [];
    s.duel.items = s.duel.items || [];
    s.duel.changed = s.duel.changed || [];
    s.duel.cdTotal = s.duel.cdTotal || COUNTDOWN_MS;
    s.duel.cdEnd = s.duel.cdEnd || 0;
    s.duel.victoryAudioUrl = s.duel.victoryAudioUrl || '';
    s.duel.victoryVoiceData = s.duel.victoryVoiceData || '';
    s.duel.victoryVoiceName = s.duel.victoryVoiceName || '';
    s.duel.localAudioVolume = clampVolume01(s.duel.localAudioVolume, 1.0);
    s.duel.onlineAudioVolume = clampVolume01(s.duel.onlineAudioVolume, 1.0);
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
    const cat = s.duel.categoryId ? allCategories().find((c) => c.id === s.duel.categoryId) : null;
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
    const cat = allCategories().find((c) => c.id === s.setup.catId);
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
    return extractImageUrls(s.duel.items, s.duel.queue);
  }
  if (s.setup && s.setup.preloadUrls && s.setup.preloadUrls.length) {
    return s.setup.preloadUrls;
  }
  if (s.setup && s.setup.catId) {
    const cat = allCategories().find((c) => c.id === s.setup.catId);
    if (cat) return extractImageUrls(cat.items);
  }
  return [];
}

/** Giai đoạn 1 & 2: tự động kích hoạt preload ngầm ảnh + âm thanh chiến thắng kép trên cả máy Host và máy Xem. */
function syncPreload(s) {
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

function dispatch(type, arg) {
  if (!controller || !state) return;
  const prev = state;
  const next = structuredClone(state);
  const ev = reduce(next, type, arg, transport.serverNow());
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

// ---------- Áp dụng trạng thái ----------
function applyState(s, allowEvents = true) {
  $('waiting').classList.add('hidden');
  document.body.classList.toggle('host', role === 'host');
  $('linkCms').classList.toggle('hidden', role !== 'host');
  $('linkCms').href = `topics.html?room=${encodeURIComponent(room)}`;
  $('roleLabel').textContent = role === 'host' ? 'Host' : controller ? 'Màn hình · đã mở khóa Host' : 'Màn hình xem';

  // Sự kiện cũ có sẵn trong phòng khi mới vào sẽ không phát lại (allowEvents=false ở snapshot đầu).
  if (s.event && s.event.id !== lastEventId) {
    if (allowEvents) playEvent(s.event.type);
    lastEventId = s.event.id;
  }

  tickPending = false;
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
  $('waiting').classList.remove('hidden');
  ['viewFloor', 'viewArena', 'dock', 'miniPanel'].forEach((id) => $(id).classList.add('hidden'));
}

// ---------- Render ----------
function render(s) {
  const inDuel = s.phase !== 'floor';
  if (!inDuel) {
    document.documentElement.style.setProperty('--turn', 'transparent');
    if (artKey) {
      artKey = '';
      const content = $('qContent');
      if (content) content.innerHTML = '';
    }
  }
  $('viewFloor').classList.toggle('hidden', inDuel);
  $('viewArena').classList.toggle('hidden', !inDuel);
  renderFloor(s);
  if (inDuel) renderArena(s);
  renderControls(s);
  renderFireworks(s);
  syncMusic(s);
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
function buildFloor() {
  const grid = $('floorGrid');
  grid.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (let i = 0; i < CELLS; i++) {
    const el = document.createElement('div');
    el.className = 'cell';
    el.dataset.i = String(i);
    el.innerHTML = '<span class="cell-avatar"></span><span class="cell-name"></span>';
    frag.appendChild(el);
  }
  grid.appendChild(frag);
  if (!grid.dataset.bound) {
    grid.dataset.bound = '1';
    grid.addEventListener('click', (e) => {
      if (role !== 'host') return;
      const cell = e.target.closest('.cell');
      if (!cell) return;
      dispatch('selectCell', { cell: Number(cell.dataset.i) });
    });
  }
  floorBuilt = true;
}

function renderFloor(s) {
  if (!floorBuilt) buildFloor();
  const flipSet = new Set(prevPhase === 'finished' && s.phase === 'floor' && s.duel ? s.duel.changed : []);
  [...$('floorGrid').children].forEach((el, i) => {
    const owner = playerById(s, s.floor[i]);
    if (!owner) return;
    el.style.setProperty('--c', owner.color);
    el.firstChild.textContent = owner.avatar;
    el.lastChild.textContent = owner.name;
    el.classList.toggle('is-sel', s.setup.cell === i);
    el.classList.toggle('is-def', !!s.setup.defId && owner.id === s.setup.defId);
    el.classList.toggle('is-chal', !!s.setup.chalId && owner.id === s.setup.chalId);
    if (flipSet.has(i)) {
      el.classList.add('is-flip');
      setTimeout(() => el.classList.remove('is-flip'), 3300);
    }
  });

  const def = playerById(s, s.setup.defId);
  const chal = playerById(s, s.setup.chalId);
  $('floorHint').textContent = def
    ? `${chal ? chal.name : '???'}  vs  ${def.name}`
    : role === 'host' ? 'Chọn một ô đất để thách đấu' : 'Chờ trận đấu kế tiếp';

  // Bảng xếp hạng
  const board = $('board');
  const sorted = [...s.players].sort((a, b) => cellCount(s, b.id) - cellCount(s, a.id));
  board.innerHTML = '';
  const frag = document.createDocumentFragment();
  sorted.forEach((p) => {
    const n = cellCount(s, p.id);
    const row = document.createElement('div');
    row.innerHTML = `
      <div class="flex items-center gap-2 text-base font-semibold mb-1 ${n === 0 ? 'opacity-40' : ''}">
        <span>${p.avatar}</span>
        <span class="flex-1 truncate t-1">${esc(p.name)}</span>
        <span style="color:${p.color}">${n}</span>
      </div>
      <div class="h-1.5 rounded track overflow-hidden"><div style="width:${(n / CELLS) * 100}%;background:${p.color};border-radius:9999px;transition:width .6s" class="h-full"></div></div>`;
    frag.appendChild(row);
  });
  board.appendChild(frag);

  renderSetup(s);
}

function renderSetup(s) {
  const panel = $('setupPanel');
  const show = role === 'host' && s.phase === 'floor';
  panel.classList.toggle('hidden', !show);
  if (!show) return;

  const def = playerById(s, s.setup.defId);
  $('setupDef').textContent = def ? `${def.avatar} ${def.name} (${cellCount(s, def.id)} ô)` : '—';

  const chalSel = $('selChal');
  const chalSig = JSON.stringify([s.players.map((p) => [p.id, p.name, p.avatar]), s.setup.defId]);
  if (chalSel.dataset.sig !== chalSig) {
    chalSel.dataset.sig = chalSig;
    chalSel.innerHTML = '<option value="">— Chọn người thách đấu —</option>' +
      s.players.filter((p) => p.id !== s.setup.defId)
        .map((p) => `<option value="${p.id}">${p.avatar} ${esc(p.name)}</option>`).join('');
  }
  chalSel.value = s.setup.chalId || '';

  const cats = allCategories();
  const catSel = $('selCat');
  const catSig = JSON.stringify(cats.map((c) => [c.id, c.name, c.icon, c.items.length]));
  if (catSel.dataset.sig !== catSig) {
    catSel.dataset.sig = catSig;
    catSel.innerHTML = cats.map((c) => `<option value="${c.id}" ${c.items.length ? '' : 'disabled'}>${c.icon} ${esc(c.name)} (${c.items.length})</option>`).join('');
  }
  catSel.value = s.setup.catId || cats[0].id;
  const chosen = cats.find((c) => c.id === catSel.value);
  $('btnStartDuel').disabled = !(s.setup.defId && s.setup.chalId && chosen && chosen.items.length);

  // Roster editor (dùng event delegation trên #roster tránh gắn lại listener mỗi lần render)
  const roster = $('roster');
  if (!roster.dataset.bound) {
    roster.dataset.bound = '1';
    roster.addEventListener('change', (e) => {
      const inp = e.target.closest('[data-f]');
      const row = e.target.closest('[data-pid]');
      if (!inp || !row) return;
      const v = inp.value.trim();
      if (!v) return;
      dispatch('updatePlayer', { id: row.dataset.pid, patch: { [inp.dataset.f]: v } });
    });
  }
  const sig = JSON.stringify([s.players, cats.map((c) => c.id + c.name)]);
  if (roster.dataset.sig !== sig && !roster.contains(document.activeElement)) {
    roster.dataset.sig = sig;
    roster.innerHTML = '';
    const rFrag = document.createDocumentFragment();
    s.players.forEach((p) => {
      const row = document.createElement('div');
      row.dataset.pid = p.id;
      row.className = 'grid grid-cols-[2.2rem_1fr_2.2rem_1.7fr] gap-1 items-center';
      row.innerHTML = `
        <input class="input !p-1 text-center" data-f="avatar" value="${esc(p.avatar)}" maxlength="4" />
        <input class="input" data-f="name" value="${esc(p.name)}" maxlength="14" />
        <input type="color" data-f="color" value="${p.color}" class="w-8 h-8 bg-transparent" />
        <select class="input" data-f="categoryId">${cats.map((c) => `<option value="${c.id}" ${c.id === p.categoryId ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('')}</select>`;
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
      // Ưu tiên nạp trước 3 ảnh kế tiếp
      const upcoming = [1, 2, 3].map((off) => currentQuestion(d, off)).filter((x) => x && x.type === 'img').map((x) => x.src);
      if (upcoming.length) preloadImages(upcoming, { priority: true });
    }
  }
  $('qInner').classList.toggle('blurred', s.phase === 'paused');
  $('pauseOverlay').classList.toggle('hidden', s.phase !== 'paused');

  const fin = s.phase === 'finished';
  $('resultOverlay').classList.toggle('hidden', !fin);
  const vicCtrl = $('victoryAudioControls');
  if (vicCtrl) vicCtrl.classList.toggle('hidden', !(fin && controller));
  if (fin) {
    const w = playerById(s, d.winnerId);
    $('resultName').textContent = `${w.avatar} ${w.name.toUpperCase()}`;
    $('resultSub').textContent = `Chiếm ${d.changed.length} ô đất · tổng ${cellCount(s, w.id)} ô`;
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
    const cached = getCached(q.src);
    let img;
    if (cached && cached.img && cached.status === 'ok') {
      // Dùng lại trực tiếp bitmap đã decode trong cache → hiển thị tức thì 0ms
      img = cached.img.cloneNode(false);
    } else {
      img = document.createElement('img');
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.src = cached ? cached.cdn : toCdnUrl(q.src);
    }
    img.className = 'q-img';
    img.alt = 'Câu đố';
    img.addEventListener('error', () => {
      img.replaceWith(Object.assign(document.createElement('div'), {
        className: 'font-display text-4xl t-danger text-center px-4',
        textContent: '⚠️ Ảnh không tải được',
      }));
    }, { once: true });
    return img;
  }
  const div = document.createElement('div');
  div.className = 'q-emoji';
  div.textContent = q.emoji;
  return div;
}

// ----- Điều khiển -----
function renderControls(s) {
  const phase = s.phase;
  const inDuel = phase !== 'floor';
  const isHostScreen = role === 'host';

  // Dock (host) hoặc mini panel (xem)
  $('dock').classList.toggle('hidden', !(isHostScreen && inDuel));
  $('miniPanel').classList.toggle('hidden', isHostScreen);
  if (!isHostScreen) {
    $('miniLock').classList.toggle('hidden', controller);
    $('miniCtrl').classList.toggle('hidden', !controller);
    const bar = $('ctrlBar');
    if (bar.parentElement.id !== 'miniButtons') $('miniButtons').appendChild(bar);
    bar.classList.toggle('hidden', !(controller && inDuel));
  } else {
    const bar = $('ctrlBar');
    if (bar.parentElement.id !== 'dockInner') $('dockInner').appendChild(bar);
  }

  $('cdSelect').classList.toggle('hidden', phase !== 'ready');
  $('cBegin').classList.toggle('hidden', phase !== 'ready');
  $('cOk').classList.toggle('hidden', !(phase === 'playing' || phase === 'paused'));
  $('cPass').classList.toggle('hidden', !(phase === 'playing' || phase === 'paused'));
  $('cPause').classList.toggle('hidden', !(phase === 'playing' || phase === 'paused'));
  $('cOk').disabled = phase !== 'playing';
  $('cPass').disabled = phase !== 'playing';
  $('cPause').innerHTML = phase === 'paused' ? `${ICONS.play} Tiếp tục <kbd>T</kbd>` : `${ICONS.pause} Tạm dừng <kbd>T</kbd>`;
  $('cBack').classList.toggle('hidden', phase !== 'finished');
  $('cAbort').classList.toggle('hidden', phase === 'finished' || phase === 'floor');
  if (isHostScreen) $('dockInner').classList.toggle('hidden', !inDuel);

  // Đáp án nhắc bài (chỉ hiện khi đã vào câu hỏi)
  const q = s.duel && (phase === 'playing' || phase === 'paused') ? currentQuestion(s.duel) : null;
  $('answerWrap').classList.toggle('hidden', !(isHostScreen && q));
  $('answerText').textContent = q ? q.answer : '';
  $('answerAlias').textContent = q && q.aliases && q.aliases.length ? `(${q.aliases.join(' / ')})` : '';
  $('miniAnswer').textContent = q ? `Đáp án: ${q.answer}${q.aliases && q.aliases.length ? ' (' + q.aliases.join(' / ') + ')' : ''}` : '';
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
  }
}

// ---------- Vòng lặp đồng hồ (mượt, 60fps) ----------
function frame() {
  requestAnimationFrame(frame);
  if (!state || !state.duel || state.phase === 'floor') return;
  const d = state.duel;
  const now = transport.serverNow();
  const rem = { A: remainingOf(d, 'A', now), B: remainingOf(d, 'B', now) };

  ['A', 'B'].forEach((side) => {
    const ms = rem[side];
    const clock = $(`clock${side}`);
    const bar = $(`bar${side}`);
    const text = (ms / 1000).toFixed(1).padStart(4, '0');
    if (clock.textContent !== text) clock.textContent = text;
    const danger = ms > 0 && ms <= 10000 && (state.phase === 'playing' || state.phase === 'paused');
    clock.classList.toggle('danger', danger && d.turn === side && state.phase === 'playing');
    clock.classList.toggle('zero', ms <= 0);
    bar.classList.toggle('danger', danger);
    bar.style.width = `${(ms / DUEL_MS) * 100}%`;
    const ring = $(`ring${side}`);
    ring.style.strokeDashoffset = String(RING_LEN * (1 - ms / DUEL_MS));
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
      handleTimeUp();
    }
  }
}

// ---------- UI tĩnh & phím tắt ----------
function bindStaticUi() {
  const unlock = () => {
    Sfx.unlock();
    $('soundGate').classList.add('hidden');
  };
  $('soundGate').addEventListener('click', unlock);
  window.addEventListener('keydown', () => Sfx.unlock(), { once: true });

  window.addEventListener('storage', (e) => {
    if (e.key === TOPICS_KEY && state) render(state);
  });
  window.addEventListener('pageshow', () => { if (state) render(state); });

  $('btnFirebase').addEventListener('click', openFirebaseSettings);
  $('btnMute').addEventListener('click', () => {
    Sfx.setMuted(!Sfx.isMuted());
    $('btnMute').textContent = Sfx.isMuted() ? '🔇' : '🔊';
  });
  $('btnFull').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  });

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

  const press = (id, fn) => $(id).addEventListener('click', (e) => { fn(); e.currentTarget.blur(); });
  press('cBegin', () => dispatch('begin', { durationMs: cdDurationMs }));
  press('cOk', () => dispatch('correct'));
  press('cPass', () => dispatch('pass'));
  press('cPause', () => dispatch(state && state.phase === 'paused' ? 'resume' : 'pause'));
  press('cBack', () => dispatch('back'));
  press('cAbort', () => { if (confirm('Hủy trận đấu hiện tại? Ô đất sẽ không thay đổi.')) dispatch('abort'); });

  press('btnStartDuel', () => dispatch('startDuel'));
  press('btnShuffleFloor', () => { if (confirm('Chia lại toàn bộ sàn ngẫu nhiên?')) dispatch('shuffleFloor'); });
  press('btnResetAll', () => { if (confirm('Đặt lại thí sinh và sàn về mặc định?')) dispatch('resetAll'); });
  $('selChal').addEventListener('change', (e) => e.target.value && dispatch('setChallenger', { id: e.target.value }));
  $('selCat').addEventListener('change', (e) => dispatch('setCategory', { id: e.target.value }));

  // Mini panel
  $('miniToggle').addEventListener('click', () => {
    const c = $('miniPanel').classList.toggle('collapsed');
    $('miniArrow').textContent = c ? '▲' : '▼';
  });
  const tryUnlock = () => {
    const pin = $('miniPin').value;
    if (state && (!state.pin || state.pin === pin)) {
      sessionStorage.setItem(`${pinKey}:unlocked`, state.pin || '');
      controller = true;
      $('miniErr').classList.add('hidden');
      render(state);
      $('roleLabel').textContent = 'Màn hình · đã mở khóa Host';
    } else {
      $('miniErr').classList.remove('hidden');
    }
  };
  $('miniUnlock').addEventListener('click', tryUnlock);
  $('miniPin').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.stopPropagation(); tryUnlock(); } });

  window.addEventListener('keydown', (e) => {
    if (!controller || !state) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (['input', 'select', 'textarea'].includes(tag)) return;
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (state.phase === 'ready' && (k === ' ' || k === 'Enter')) {
      e.preventDefault();
      pulse('cBegin');
      dispatch('begin', { durationMs: cdDurationMs });
    } else if (state.phase === 'playing' && (k === ' ' || k === 'Enter')) {
      e.preventDefault();
      pulse('cOk');
      dispatch('correct');
    } else if (state.phase === 'playing' && (k === 'p' || k === 'P' || k === 'ArrowDown')) {
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
