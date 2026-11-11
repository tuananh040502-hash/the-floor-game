/**
 * Kho chủ đề: chủ đề có sẵn (data.js) + chủ đề tự tạo của Host (localStorage).
 * Chủ đề tự tạo: { id, name, icon, shuffle, victoryAudioUrl, custom:true, items:[{type,src|emoji,answer,aliases}] }
 */
import { CATEGORIES as BUILTIN } from './data.js';

export const MAX_ITEMS = 50;
export const TOPICS_KEY = 'thefloor:topics';
const DRIVE_KEY = 'thefloor:drive';
const AUDIO_OV_KEY = 'thefloor:victoryOverrides';

export function loadVictoryOverrides() {
  try {
    const obj = JSON.parse(localStorage.getItem(AUDIO_OV_KEY));
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

export function saveVictoryOverride(topicId, url) {
  const ov = loadVictoryOverrides();
  const clean = normalizeVictoryAudioUrl(url);
  if (clean) ov[topicId] = clean;
  else delete ov[topicId];
  localStorage.setItem(AUDIO_OV_KEY, JSON.stringify(ov));
}

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
  const ov = loadVictoryOverrides();
  const builtin = BUILTIN.map((c) => ({ ...c, victoryAudioUrl: ov[c.id] || c.victoryAudioUrl || '' }));
  return [...builtin, ...loadCustom()];
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

/**
 * Phân tích & chuẩn hóa URL âm thanh chiến thắng (YouTube, SoundCloud, Google Drive audio, hoặc link .mp3/.wav trực tiếp).
 * Trả về:
 *  - null nếu rỗng/không hợp lệ
 *  - { kind: 'youtube'|'soundcloud'|'direct', raw: string, playUrl: string, videoId?: string, startSec?: number }
 */
export function parseVictoryAudio(input) {
  const raw = (input || '').trim();
  if (!raw || !/^https?:\/\//i.test(raw)) return null;

  // 1. YouTube (youtube.com/watch?v=, youtu.be/, youtube.com/shorts/, youtube.com/embed/)
  const ytMatch =
    raw.match(/(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (ytMatch) {
    const tMatch = raw.match(/[?&](?:t|start)=(\d+)/);
    return {
      kind: 'youtube',
      raw,
      videoId: ytMatch[1],
      startSec: tMatch ? Number(tMatch[1]) || 0 : 0,
      playUrl: `https://www.youtube.com/watch?v=${ytMatch[1]}`,
    };
  }

  // 2. SoundCloud
  if (/(?:^https?:\/\/)?(?:www\.|m\.|on\.)?soundcloud\.com\//i.test(raw)) {
    return {
      kind: 'soundcloud',
      raw,
      playUrl: raw.split('#')[0],
    };
  }

  // 3. Google Drive chứa file audio → đổi sang direct stream URL
  const driveMatch =
    raw.match(/drive\.google\.com\/file\/d\/([\w-]+)/) ||
    raw.match(/drive\.google\.com\/(?:open|uc|thumbnail)\?(?:[^#]*&)?id=([\w-]+)/) ||
    raw.match(/docs\.google\.com\/uc\?(?:[^#]*&)?id=([\w-]+)/);
  if (driveMatch) {
    const id = driveMatch[1];
    return {
      kind: 'direct',
      raw,
      driveId: id,
      playUrl: `https://docs.google.com/uc?export=download&id=${id}`,
    };
  }

  // 4. Link âm thanh trực tiếp (.mp3, .wav, .ogg, .m4a, CDN...)
  return {
    kind: 'direct',
    raw,
    playUrl: raw,
  };
}

export function normalizeVictoryAudioUrl(input) {
  const p = parseVictoryAudio(input);
  return p ? p.raw.slice(0, 500) : '';
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
    victoryAudioUrl: normalizeVictoryAudioUrl(t.victoryAudioUrl),
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
    topics: topics.map((t) => ({
      id: t.id,
      name: t.name,
      icon: t.icon,
      shuffle: !!t.shuffle,
      victoryAudioUrl: t.victoryAudioUrl || '',
      items: t.items,
    })),
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
