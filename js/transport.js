/**
 * Lớp truyền tải trạng thái phòng & đồng bộ kho chủ đề dùng chung (`shared_topics`).
 *  - Firebase Realtime Database (WebSocket) nếu có cấu hình hợp lệ.
 *  - Chế độ cục bộ (localStorage + BroadcastChannel) nếu không.
 *
 * API phòng: { mode, subscribe(cb), write(state, prevState), serverNow(), onStatus(cb) }
 * API kho chủ đề: createSharedTopicsSync(config) -> { mode, subscribe, fetchAll, putTopic, putMany, removeTopic, onStatus, dispose }
 */
const FB_VERSION = '10.12.2';
const FB_BASE = `https://www.gstatic.com/firebasejs/${FB_VERSION}`;
export const SHARED_TOPICS_PATH = 'shared_topics';
const MAX_CLOUD_IMAGES = 100;
const MAX_INLINE_STR_LEN = 2048;

export async function createTransport(room, config) {
  if (config && config.databaseURL) {
    try {
      return await firebaseTransport(room, config);
    } catch (err) {
      console.error('Firebase lỗi, chuyển sang chế độ cục bộ:', err);
      const t = localTransport(room);
      t.fallbackReason = err.message || String(err);
      return t;
    }
  }
  return localTransport(room);
}

/**
 * Làm sạch dữ liệu chủ đề trước khi đẩy lên Firebase (`shared_topics`):
 *  - Chỉ giữ tên, biểu tượng, cờ xáo trộn, cấu hình âm thanh, danh sách URL ảnh Drive/HTTP và đáp án.
 *  - Loại bỏ chuỗi Base64 thô (`data:...`) hoặc chuỗi quá lớn để tránh nghẽn Firebase.
 */
export function sanitizeCloudTopic(raw, maxImages = MAX_CLOUD_IMAGES) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim().replace(/[.#$/[\]]/g, '_');
  const name = String(raw.name || '').trim().slice(0, 60);
  if (!id || !name) return null;

  const items = [];
  if (Array.isArray(raw.items)) {
    for (const it of raw.items) {
      if (items.length >= maxImages) break;
      if (!it || typeof it !== 'object') continue;
      const answer = String(it.answer || '').trim().slice(0, 120);
      if (!answer) continue;
      const aliases = Array.isArray(it.aliases)
        ? it.aliases.map((a) => String(a || '').trim().slice(0, 80)).filter(Boolean).slice(0, 12)
        : [];
      if (it.type === 'emoji' && it.emoji) {
        items.push({ type: 'emoji', emoji: String(it.emoji).slice(0, 8), answer, aliases });
      } else if (it.src && typeof it.src === 'string') {
        const src = it.src.trim();
        // Lọc bỏ chuỗi Base64 thô hoặc URL quá dài gây nghẽn Firebase
        if (/^data:/i.test(src) || src.length > MAX_INLINE_STR_LEN) continue;
        if (!/^https?:\/\//i.test(src)) continue;
        items.push({ type: 'img', src, answer, aliases });
      }
    }
  }

  const audioUrl = typeof raw.victoryAudioUrl === 'string' && !/^data:/i.test(raw.victoryAudioUrl) && raw.victoryAudioUrl.length <= MAX_INLINE_STR_LEN
    ? raw.victoryAudioUrl.trim()
    : '';
  const localVol = Number.isFinite(Number(raw.localAudioVolume))
    ? Math.max(0, Math.min(1, Number(raw.localAudioVolume)))
    : 1.0;
  const onlineVol = Number.isFinite(Number(raw.onlineAudioVolume))
    ? Math.max(0, Math.min(1, Number(raw.onlineAudioVolume)))
    : 1.0;

  return {
    id,
    name,
    icon: String(raw.icon || '🖼️').trim().slice(0, 8) || '🖼️',
    shuffle: !!raw.shuffle,
    victoryAudioUrl: audioUrl,
    victoryVoiceName: String(raw.victoryVoiceName || '').trim().slice(0, 80),
    localAudioVolume: localVol,
    onlineAudioVolume: onlineVol,
    updatedAt: Number(raw.updatedAt) || Date.now(),
    items,
  };
}

export function parseCloudTopicsSnapshot(val) {
  if (!val || typeof val !== 'object') return [];
  const rawList = Array.isArray(val) ? val : Object.values(val);
  const out = [];
  const seen = new Set();
  rawList.forEach((item) => {
    const clean = sanitizeCloudTopic(item);
    if (clean && !seen.has(clean.id)) {
      seen.add(clean.id);
      out.push(clean);
    }
  });
  return out;
}

// ---------- Diff để chỉ gửi phần thay đổi (Delta Update) ----------
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isEmpty = (v) => v === undefined || v === null || (Array.isArray(v) && v.length === 0) || (isPlain(v) && !Object.keys(v).length);
const DUEL_STATIC_KEYS = new Set([
  'items',
  'queue',
  'victoryVoiceData',
  'victoryAudioUrl',
  'victoryVoiceName',
  'catName',
  'catIcon',
]);

const same = (a, b) => {
  if (a === b) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};

function diffPaths(prev, next, base, out) {
  const sameDuelSession = base === 'duel'
    && prev && next
    && prev.categoryId === next.categoryId
    && prev.aId === next.aId
    && prev.bId === next.bId;
  const keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]);
  keys.forEach((k) => {
    if (sameDuelSession && DUEL_STATIC_KEYS.has(k) && prev[k] !== undefined && next[k] !== undefined) {
      return;
    }
    const pv = prev ? prev[k] : undefined;
    const nv = next ? next[k] : undefined;
    if (pv === nv) return;
    const path = base ? `${base}/${k}` : k;
    if (isPlain(pv) && isPlain(nv)) diffPaths(pv, nv, path, out);
    else if (!same(pv, nv)) out[path] = isEmpty(nv) ? null : nv;
  });
  return out;
}

// ---------- Firebase ----------
let sdkPromise = null;
async function loadSdk() {
  if (!sdkPromise) {
    sdkPromise = Promise.all([
      import(`${FB_BASE}/firebase-app.js`),
      import(`${FB_BASE}/firebase-database.js`),
    ]).then(([appMod, db]) => ({ appMod, db })).catch((err) => {
      sdkPromise = null;
      throw err;
    });
  }
  return sdkPromise;
}

function getOrInitApp(appMod, config) {
  const existing = appMod.getApps().find((a) => a.options && a.options.databaseURL === config.databaseURL);
  if (existing) return existing;
  const name = appMod.getApps().length === 0 ? '[DEFAULT]' : `app-${Date.now()}`;
  return appMod.initializeApp(config, name);
}

async function firebaseTransport(room, config) {
  const { appMod, db } = await loadSdk();
  const app = getOrInitApp(appMod, config);
  const database = db.getDatabase(app);
  const stateRef = db.ref(database, `rooms/${room}/state`);
  let offset = 0;
  const listeners = [];
  const emit = (ev) => listeners.forEach((cb) => cb(ev));

  // Mọi listener đều lưu hàm hủy (off) để gỡ sạch trước khi gắn lại / khi đóng trang.
  const unsubs = [];
  let stateUnsub = null;
  let disposed = false;
  let lastState = null;
  unsubs.push(db.onValue(db.ref(database, '.info/serverTimeOffset'), (snap) => {
    offset = snap.val() || 0;
  }));
  unsubs.push(db.onValue(db.ref(database, '.info/connected'), (snap) => {
    emit({ type: snap.val() ? 'online' : 'offline' });
  }));

  // Đo độ trễ thật: get() trên đường dẫn không được lắng nghe buộc phải đi tới server.
  const rttRef = db.ref(database, `rooms/${room}/_rtt`);
  const measure = async () => {
    if (disposed || document.visibilityState === 'hidden') return;
    const t0 = performance.now();
    try {
      await db.get(rttRef);
      const rtt = performance.now() - t0;
      emit({ type: 'latency', ms: Math.round(rtt / 2), rtt: Math.round(rtt) });
    } catch (err) {
      emit({ type: 'error', message: err.message });
    }
  };
  const firstMeasure = setTimeout(measure, 1500);
  const measureTimer = setInterval(measure, 5000);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(firstMeasure);
    clearInterval(measureTimer);
    if (stateUnsub) { try { stateUnsub(); } catch { /* ignore */ } stateUnsub = null; }
    unsubs.splice(0).forEach((u) => { try { u(); } catch { /* ignore */ } });
  };
  window.addEventListener('pagehide', dispose);

  return {
    mode: 'firebase',
    serverNow: () => Date.now() + offset,
    subscribe(cb) {
      // Gỡ listener cũ (off) trước khi gắn listener mới → không nhân bản luồng xử lý ngầm.
      if (stateUnsub) { try { stateUnsub(); } catch { /* ignore */ } stateUnsub = null; }
      stateUnsub = db.onValue(stateRef, (snap) => {
        const val = snap.val();
        if (val) lastState = val;
        try { cb(val); } catch (e) { console.error(e); }
      }, (err) => {
        emit({ type: 'error', message: `Không đọc được dữ liệu: ${err.message}` });
      });
    },
    dispose,
    write(state, prev) {
      const handle = (err) => emit({ type: 'error', message: `Không ghi được dữ liệu: ${err?.message || err}` });
      try {
        const baseState = prev || lastState;
        lastState = state;
        if (baseState) {
          const patch = diffPaths(baseState, state, '', {});
          if (!Object.keys(patch).length) return Promise.resolve();
          return db.update(stateRef, patch).catch(handle);
        }
        return db.set(stateRef, state).catch(handle);
      } catch (err) {
        handle(err);
        return Promise.resolve();
      }
    },
    onStatus: (cb) => listeners.push(cb),
  };
}

/**
 * Kết nối nhánh `shared_topics` trên Firebase Realtime Database để đồng bộ chủ đề giữa mọi máy Host.
 */
export async function createSharedTopicsSync(config) {
  if (config && config.databaseURL) {
    try {
      return await firebaseSharedTopics(config);
    } catch (err) {
      console.error('Không kết nối được shared_topics trên Firebase, chuyển sang chế độ cục bộ:', err);
      const local = localSharedTopics();
      local.fallbackReason = err.message || String(err);
      return local;
    }
  }
  return localSharedTopics();
}

async function firebaseSharedTopics(config) {
  const { appMod, db } = await loadSdk();
  const app = getOrInitApp(appMod, config);
  const database = db.getDatabase(app);
  const topicsRef = db.ref(database, SHARED_TOPICS_PATH);

  const statusListeners = [];
  let currentStatus = { state: 'syncing', message: 'Đang kết nối kho chủ đề…' };
  const emitStatus = (st) => {
    currentStatus = st;
    statusListeners.forEach((cb) => {
      try { cb(st); } catch (e) { console.error(e); }
    });
  };

  let topicsUnsub = null;
  let connUnsub = null;
  let disposed = false;

  connUnsub = db.onValue(db.ref(database, '.info/connected'), (snap) => {
    if (snap.val()) {
      emitStatus({ state: 'synced', message: 'Kho chủ đề dùng chung (Đã đồng bộ)' });
    } else {
      emitStatus({ state: 'offline', message: 'Mất kết nối Cloud — đang dùng bản lưu tạm' });
    }
  });

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (topicsUnsub) { try { topicsUnsub(); } catch { /* ignore */ } topicsUnsub = null; }
    if (connUnsub) { try { connUnsub(); } catch { /* ignore */ } connUnsub = null; }
  };
  window.addEventListener('pagehide', dispose);

  return {
    mode: 'firebase',
    onStatus(cb) {
      statusListeners.push(cb);
      try { cb(currentStatus); } catch { /* ignore */ }
    },
    subscribe(cb) {
      if (topicsUnsub) { try { topicsUnsub(); } catch { /* ignore */ } topicsUnsub = null; }
      emitStatus({ state: 'syncing', message: 'Đang đồng bộ kho chủ đề…' });
      topicsUnsub = db.onValue(topicsRef, (snap) => {
        const list = parseCloudTopicsSnapshot(snap.val());
        emitStatus({ state: 'synced', message: 'Kho chủ đề dùng chung (Đã đồng bộ)', count: list.length });
        try { cb(list, snap.val()); } catch (e) { console.error(e); }
      }, (err) => {
        emitStatus({ state: 'error', message: `Lỗi đọc shared_topics: ${err.message}` });
      });
    },
    async fetchAll() {
      emitStatus({ state: 'syncing', message: 'Đang tải kho chủ đề…' });
      try {
        const snap = await db.get(topicsRef);
        const list = parseCloudTopicsSnapshot(snap.val());
        emitStatus({ state: 'synced', message: 'Kho chủ đề dùng chung (Đã đồng bộ)', count: list.length });
        return list;
      } catch (err) {
        emitStatus({ state: 'error', message: `Lỗi tải shared_topics: ${err.message}` });
        throw err;
      }
    },
    async putTopic(topic) {
      const clean = sanitizeCloudTopic(topic);
      if (!clean) return false;
      emitStatus({ state: 'syncing', message: 'Đang lưu lên Cloud…' });
      try {
        await db.set(db.ref(database, `${SHARED_TOPICS_PATH}/${clean.id}`), clean);
        emitStatus({ state: 'synced', message: 'Kho chủ đề dùng chung (Đã đồng bộ)' });
        return true;
      } catch (err) {
        emitStatus({ state: 'error', message: `Lỗi lưu Cloud: ${err.message}` });
        return false;
      }
    },
    async putMany(topicsList) {
      if (!Array.isArray(topicsList) || !topicsList.length) return 0;
      const patch = {};
      let count = 0;
      topicsList.forEach((t) => {
        const clean = sanitizeCloudTopic(t);
        if (clean) {
          patch[clean.id] = clean;
          count += 1;
        }
      });
      if (!count) return 0;
      emitStatus({ state: 'syncing', message: `Đang đồng bộ ${count} chủ đề lên Cloud…` });
      try {
        await db.update(topicsRef, patch);
        emitStatus({ state: 'synced', message: 'Kho chủ đề dùng chung (Đã đồng bộ)' });
        return count;
      } catch (err) {
        emitStatus({ state: 'error', message: `Lỗi đồng bộ Cloud: ${err.message}` });
        return 0;
      }
    },
    async replaceAll(topicsList) {
      const nextMap = {};
      (topicsList || []).forEach((t) => {
        const clean = sanitizeCloudTopic(t);
        if (clean) nextMap[clean.id] = clean;
      });
      emitStatus({ state: 'syncing', message: 'Đang cập nhật toàn bộ kho chủ đề…' });
      try {
        await db.set(topicsRef, Object.keys(nextMap).length ? nextMap : null);
        emitStatus({ state: 'synced', message: 'Kho chủ đề dùng chung (Đã đồng bộ)' });
        return true;
      } catch (err) {
        emitStatus({ state: 'error', message: `Lỗi cập nhật Cloud: ${err.message}` });
        return false;
      }
    },
    async removeTopic(topicId) {
      const cleanId = String(topicId || '').trim().replace(/[.#$/[\]]/g, '_');
      if (!cleanId) return false;
      emitStatus({ state: 'syncing', message: 'Đang xóa chủ đề trên Cloud…' });
      try {
        await db.remove(db.ref(database, `${SHARED_TOPICS_PATH}/${cleanId}`));
        emitStatus({ state: 'synced', message: 'Kho chủ đề dùng chung (Đã đồng bộ)' });
        return true;
      } catch (err) {
        emitStatus({ state: 'error', message: `Lỗi xóa trên Cloud: ${err.message}` });
        return false;
      }
    },
    dispose,
  };
}

function localSharedTopics() {
  const key = 'thefloor:topics:v1';
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel('thefloor:shared_topics') : null;
  const statusListeners = [];
  const currentStatus = { state: 'local', message: 'Chế độ cục bộ (Chưa kết nối Cloud)' };
  const read = () => {
    try {
      return parseCloudTopicsSnapshot(JSON.parse(localStorage.getItem(key) || '[]'));
    } catch {
      return [];
    }
  };
  return {
    mode: 'local',
    onStatus(cb) {
      statusListeners.push(cb);
      try { cb(currentStatus); } catch { /* ignore */ }
    },
    subscribe(cb) {
      const emit = () => {
        const list = read();
        try { cb(list, list); } catch (e) { console.error(e); }
      };
      if (channel) channel.onmessage = emit;
      window.addEventListener('storage', (e) => {
        if (e.key === key) emit();
      });
      setTimeout(emit, 0);
    },
    async fetchAll() {
      return read();
    },
    async putTopic() {
      if (channel) channel.postMessage(1);
      return true;
    },
    async putMany(list) {
      if (channel) channel.postMessage(1);
      return Array.isArray(list) ? list.length : 0;
    },
    async replaceAll() {
      if (channel) channel.postMessage(1);
      return true;
    },
    async removeTopic() {
      if (channel) channel.postMessage(1);
      return true;
    },
    dispose() {
      if (channel) channel.close();
    },
  };
}

/**
 * Kiểm tra cấu hình: kết nối, đo độ trễ, thử đọc dữ liệu.
 * Trả về { ok, message, rtt }.
 */
export async function testFirebase(config) {
  let appMod;
  let db;
  try {
    ({ appMod, db } = await loadSdk());
  } catch {
    return { ok: false, message: 'Không tải được Firebase SDK (kiểm tra mạng).' };
  }
  const app = appMod.initializeApp(config, `test-${Date.now()}`);
  try {
    const database = db.getDatabase(app);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Hết thời gian chờ — sai databaseURL hoặc bị chặn mạng.')), 9000);
      db.onValue(db.ref(database, '.info/connected'), (snap) => {
        if (snap.val()) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    const t0 = performance.now();
    try {
      await db.get(db.ref(database, 'rooms/_rtt'));
    } catch (err) {
      return { ok: false, message: `Đã kết nối nhưng bị từ chối đọc: ${err.message}. Hãy mở Rules cho đường dẫn rooms (xem README).` };
    }
    const rtt = Math.round(performance.now() - t0);
    return { ok: true, rtt, message: `✅ Kết nối thành công · độ trễ khứ hồi ${rtt}ms (một chiều ≈ ${Math.round(rtt / 2)}ms).` };
  } catch (err) {
    return { ok: false, message: `❌ ${err.message}` };
  } finally {
    appMod.deleteApp(app).catch(() => {});
  }
}

// ---------- Cục bộ ----------
function localTransport(room) {
  const key = `thefloor:${room}`;
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel(key) : null;
  const listeners = [];
  let storageHandler = null;
  const read = () => {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  };
  return {
    mode: 'local',
    serverNow: () => Date.now(),
    subscribe(cb) {
      const handler = () => cb(read());
      if (channel) channel.onmessage = handler;
      if (storageHandler) window.removeEventListener('storage', storageHandler);
      storageHandler = (e) => {
        if (e.key === key) handler();
      };
      window.addEventListener('storage', storageHandler);
      setTimeout(handler, 0);
      setTimeout(() => listeners.forEach((s) => s({ type: 'local' })), 0);
    },
    write(state) {
      try {
        localStorage.setItem(key, JSON.stringify(state));
        if (channel) channel.postMessage(1);
      } catch (err) {
        console.warn('localStorage write error:', err);
      }
      return Promise.resolve();
    },
    onStatus: (cb) => listeners.push(cb),
  };
}
