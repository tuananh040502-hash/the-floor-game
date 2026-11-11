/**
 * Kho chủ đề: chủ đề có sẵn (data.js) + chủ đề tự tạo của Host (localStorage).
 * Chủ đề tự tạo: { id, name, icon, shuffle, custom:true, items:[{type,src|emoji,answer,aliases}] }
 */
import { CATEGORIES as BUILTIN } from './data.js';

export const MAX_ITEMS = 50;
export const TOPICS_KEY = 'thefloor:topics';
const DRIVE_KEY = 'thefloor:drive';

export function loadCustom() {
  try {
    const list = JSON.parse(localStorage.getItem(TOPICS_KEY));
    return Array.isArray(list) ? list.map(sanitizeTopic).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function saveCustom(list) {
  localStorage.setItem(TOPICS_KEY, JSON.stringify(list));
}

export function allCategories() {
  return [...BUILTIN, ...loadCustom()];
}

export function getCategory(id) {
  const all = allCategories();
  return all.find((c) => c.id === id) || all[0];
}

export function newId() {
  return `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function loadDrive() {
  try {
    return { url: '', folderId: '', ...JSON.parse(localStorage.getItem(DRIVE_KEY)) };
  } catch {
    return { url: '', folderId: '' };
  }
}

export function saveDrive(cfg) {
  localStorage.setItem(DRIVE_KEY, JSON.stringify(cfg));
}

// ---------- Link ảnh ----------
export function driveThumb(id) {
  return `https://lh3.googleusercontent.com/d/${id}`;
}

/** Chuyển link chia sẻ Google Drive về link ảnh CDN lh3; link thường giữ nguyên. Trả về null nếu không hợp lệ. */
export function normalizeImageUrl(input) {
  const raw = (input || '').trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  const m =
    raw.match(/drive\.google\.com\/file\/d\/([\w-]+)/) ||
    raw.match(/drive\.google\.com\/(?:open|uc|thumbnail)\?(?:[^#]*&)?id=([\w-]+)/) ||
    raw.match(/lh3\.googleusercontent\.com\/d\/([\w-]+)/);
  if (m) return driveThumb(m[1]);
  return raw;
}

// ---------- Làm sạch dữ liệu ----------
function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

export function sanitizeItem(it) {
  if (!it || typeof it !== 'object') return null;
  const answer = str(it.answer, 120);
  if (!answer) return null;
  const aliases = Array.isArray(it.aliases) ? it.aliases.map((a) => str(a, 120)).filter(Boolean).slice(0, 10) : [];
  if (it.type === 'emoji') {
    const emoji = str(it.emoji, 12);
    return emoji ? { type: 'emoji', emoji, answer, aliases } : null;
  }
  const src = normalizeImageUrl(it.src);
  return src ? { type: 'img', src, answer, aliases } : null;
}

export function sanitizeTopic(t) {
  if (!t || typeof t !== 'object') return null;
  const name = str(t.name, 60);
  if (!name) return null;
  const items = (Array.isArray(t.items) ? t.items : []).map(sanitizeItem).filter(Boolean).slice(0, MAX_ITEMS);
  return {
    id: str(t.id, 40) || newId(),
    name,
    icon: str(t.icon, 8) || '🖼️',
    shuffle: t.shuffle === true,
    custom: true,
    items,
  };
}

// ---------- Xuất / Nhập JSON ----------
export function exportPayload(topics) {
  return {
    app: 'the-floor',
    version: 1,
    exportedAt: new Date().toISOString(),
    topics: topics.map((t) => ({ id: t.id, name: t.name, icon: t.icon, shuffle: !!t.shuffle, items: t.items })),
  };
}

/** Trả về danh sách chủ đề hợp lệ từ chuỗi JSON; ném lỗi nếu sai định dạng. */
export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('File không phải JSON hợp lệ.');
  }
  const list = Array.isArray(data) ? data : data && Array.isArray(data.topics) ? data.topics : data && data.name ? [data] : null;
  if (!list) throw new Error('Không tìm thấy danh sách chủ đề trong file.');
  const topics = list.map(sanitizeTopic).filter(Boolean);
  if (!topics.length) throw new Error('File không chứa chủ đề hợp lệ nào.');
  return topics;
}
