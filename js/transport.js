/**
 * Lớp truyền tải trạng thái phòng.
 *  - Firebase Realtime Database (WebSocket) nếu có cấu hình hợp lệ.
 *  - Chế độ cục bộ (localStorage + BroadcastChannel) nếu không.
 *
 * API: { mode, subscribe(cb), write(state, prevState), serverNow(), onStatus(cb) }
 * Sự kiện trạng thái: { type: 'online'|'offline'|'local'|'error'|'latency', ms?, rtt?, message? }
 *
 * Tối ưu độ trễ:
 *  - write() chỉ gửi phần thay đổi (multi-path update) thay vì cả phòng → payload vài chục byte
 *    cho mỗi lần bấm Đúng/Pass/Tạm dừng/Đếm ngược.
 *  - Không recurse vào mảng như `setup.preloadUrls` hay `duel.items` để đồng bộ danh sách tải ngầm nguyên vẹn.
 *  - Mọi mốc thời gian dùng giờ server Firebase (Date.now() + serverTimeOffset) nên đồng hồ đếm ngược
 *    và đồng hồ 60s giữa 2 máy không lệch dù đồng hồ hệ thống khác nhau.
 */
const FB_VERSION = '10.12.2';
const FB_BASE = `https://www.gstatic.com/firebasejs/${FB_VERSION}`;

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

// ---------- Diff để chỉ gửi phần thay đổi ----------
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isEmpty = (v) => v === undefined || v === null || (Array.isArray(v) && v.length === 0) || (isPlain(v) && !Object.keys(v).length);
const same = (a, b) => {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};

function diffPaths(prev, next, base, out) {
  const keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]);
  keys.forEach((k) => {
    const pv = prev ? prev[k] : undefined;
    const nv = next ? next[k] : undefined;
    const path = base ? `${base}/${k}` : k;
    if (isPlain(pv) && isPlain(nv)) diffPaths(pv, nv, path, out);
    else if (!same(pv, nv)) out[path] = isEmpty(nv) ? null : nv;
  });
  return out;
}

// ---------- Firebase ----------
async function loadSdk() {
  const [appMod, db] = await Promise.all([
    import(`${FB_BASE}/firebase-app.js`),
    import(`${FB_BASE}/firebase-database.js`),
  ]);
  return { appMod, db };
}

async function firebaseTransport(room, config) {
  const { appMod, db } = await loadSdk();
  const app = appMod.initializeApp(config);
  const database = db.getDatabase(app);
  const stateRef = db.ref(database, `rooms/${room}/state`);
  let offset = 0;
  const listeners = [];
  const emit = (ev) => listeners.forEach((cb) => cb(ev));

  db.onValue(db.ref(database, '.info/serverTimeOffset'), (snap) => {
    offset = snap.val() || 0;
  });
  db.onValue(db.ref(database, '.info/connected'), (snap) => {
    emit({ type: snap.val() ? 'online' : 'offline' });
  });

  // Đo độ trễ thật: get() trên đường dẫn không được lắng nghe buộc phải đi tới server.
  const rttRef = db.ref(database, `rooms/${room}/_rtt`);
  const measure = async () => {
    const t0 = performance.now();
    try {
      await db.get(rttRef);
      const rtt = performance.now() - t0;
      emit({ type: 'latency', ms: Math.round(rtt / 2), rtt: Math.round(rtt) });
    } catch (err) {
      emit({ type: 'error', message: err.message });
    }
  };
  setTimeout(measure, 1500);
  setInterval(measure, 5000);

  return {
    mode: 'firebase',
    serverNow: () => Date.now() + offset,
    subscribe(cb) {
      db.onValue(stateRef, (snap) => cb(snap.val()), (err) => {
        emit({ type: 'error', message: `Không đọc được dữ liệu: ${err.message}` });
      });
    },
    write(state, prev) {
      const handle = (err) => emit({ type: 'error', message: `Không ghi được dữ liệu: ${err?.message || err}` });
      try {
        if (prev) {
          const patch = diffPaths(prev, state, '', {});
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
      window.addEventListener('storage', (e) => {
        if (e.key === key) handler();
      });
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
