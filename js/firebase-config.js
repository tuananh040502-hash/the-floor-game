/**
 * Cấu hình Firebase Realtime Database.
 *
 * Thứ tự ưu tiên khi game khởi động:
 *  1. Cấu hình Host đã lưu trong trình duyệt qua popup "⚙️ Cấu hình Firebase & Đám Mây" (localStorage).
 *  2. DEFAULT_FIREBASE_CONFIG bên dưới.
 *  3. Không có cấu hình hợp lệ (hoặc Host chọn "Chế độ cục bộ") → fallback BroadcastChannel/localStorage,
 *     đồng bộ giữa các tab cùng trình duyệt để thử nghiệm.
 *
 * Lưu ý: apiKey của Firebase Web KHÔNG phải bí mật (nó chỉ định danh dự án). An toàn dữ liệu nằm ở
 * Database Rules — xem README.
 */
export const DEFAULT_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAZOQY1DgLxi0EYQi07G_sbxE_UuSqs5R8',
  authDomain: 'friendsmimibirthday.firebaseapp.com',
  databaseURL: 'https://friendsmimibirthday-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'friendsmimibirthday',
  storageBucket: 'friendsmimibirthday.firebasestorage.app',
  messagingSenderId: '280571876047',
  appId: '1:280571876047:web:a1ec9f8b249156b5bf5dba',
};

export const CONFIG_FIELDS = [
  'apiKey', 'authDomain', 'databaseURL', 'projectId', 'storageBucket', 'messagingSenderId', 'appId',
];

const STORAGE_KEY = 'thefloor:fbconfig';
const DB_URL_RE = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.(firebaseio\.com|firebasedatabase\.app)$/i;

/** Chuẩn hóa & kiểm tra. Trả về { ok, error, config }. */
export function validateConfig(input) {
  const cfg = {};
  CONFIG_FIELDS.forEach((k) => {
    const v = input && typeof input[k] === 'string' ? input[k].trim() : '';
    if (v) cfg[k] = v;
  });
  if (cfg.databaseURL) cfg.databaseURL = cfg.databaseURL.replace(/\/+$/, '');
  if (!cfg.databaseURL) return { ok: false, error: 'Thiếu databaseURL (bắt buộc).', config: cfg };
  if (!DB_URL_RE.test(cfg.databaseURL)) {
    return { ok: false, error: 'databaseURL phải dạng https://….firebaseio.com hoặc https://….firebasedatabase.app', config: cfg };
  }
  return { ok: true, error: '', config: cfg };
}

/**
 * Tự nhận diện cấu hình từ đoạn văn bản dán vào: JSON, object JS (const firebaseConfig = {...}),
 * hoặc chỉ một URL databaseURL. Suy ra projectId/authDomain nếu thiếu.
 */
export function parseConfigText(text) {
  const out = {};
  const src = String(text || '');
  CONFIG_FIELDS.forEach((k) => {
    const m = src.match(new RegExp(`["']?${k}["']?\\s*:\\s*["'\`]([^"'\`]+)["'\`]`));
    if (m) out[k] = m[1].trim();
  });
  if (!out.databaseURL) {
    const u = src.match(/https:\/\/[a-z0-9.-]+\.(?:firebaseio\.com|firebasedatabase\.app)/i);
    if (u) out.databaseURL = u[0];
  }
  if (!out.projectId && out.databaseURL) {
    const m = out.databaseURL.match(/^https:\/\/([a-z0-9-]+?)(?:-default-rtdb)?\./i);
    if (m) out.projectId = m[1];
  }
  if (!out.authDomain && out.projectId) out.authDomain = `${out.projectId}.firebaseapp.com`;
  return out;
}

function readStored() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

/** 'local' (Host chọn cục bộ) | 'custom' (đã lưu qua popup) | 'default' (trong file) | 'none' */
export function getConfigSource() {
  const s = readStored();
  if (s && s.mode === 'local') return 'local';
  if (s && s.mode === 'firebase' && validateConfig(s.config).ok) return 'custom';
  return validateConfig(DEFAULT_FIREBASE_CONFIG).ok ? 'default' : 'none';
}

/** Trả về cấu hình đang dùng, hoặc null nếu phải chạy chế độ cục bộ. */
export function loadFirebaseConfig() {
  const source = getConfigSource();
  if (source === 'custom') return validateConfig(readStored().config).config;
  if (source === 'default') return validateConfig(DEFAULT_FIREBASE_CONFIG).config;
  return null;
}

export function saveFirebaseConfig(cfg) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: 'firebase', config: cfg }));
}

export function useLocalMode() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: 'local' }));
}

export function resetFirebaseConfig() {
  localStorage.removeItem(STORAGE_KEY);
}
