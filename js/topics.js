/**
 * Kho chủ đề: chủ đề có sẵn (data.js) + chủ đề tự tạo của Host (localStorage).
 * Chủ đề tự tạo: { id, name, icon, shuffle, victoryAudioUrl, custom:true, items:[{type,src|emoji,answer,aliases}] }
 */
import { CATEGORIES as BUILTIN } from './data.js';

export const MAX_ITEMS = 50;
export const TOPICS_KEY = 'thefloor:topics';
const DRIVE_KEY = 'thefloor:drive';
const AUDIO_OV_KEY = 'thefloor:victoryOverrides';
const IDB_NAME = 'thefloor_audio_db';
const IDB_STORE = 'voice_clips';
const MAX_VOICE_BYTES = 180000; // giới hạn an toàn cho chuỗi Base64 đồng bộ qua Firebase

// ---------- IndexedDB lưu trữ file âm thanh gốc trong máy ----------
let idbPromise = null;
function openAudioDb() {
  if (idbPromise) return idbPromise;
  idbPromise = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'topicId' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        idbPromise = null;
        reject(req.error || new Error('Không mở được IndexedDB'));
      };
    } catch (err) {
      idbPromise = null;
      reject(err);
    }
  });
  return idbPromise;
}

export async function saveTopicAudioIDB(topicId, dataOrRecord, name = '', extra = {}) {
  try {
    const db = await openAudioDb();
    const payload = typeof dataOrRecord === 'object' && dataOrRecord !== null
      ? { topicId, ...dataOrRecord, updatedAt: Date.now() }
      : { topicId, dataUrl: String(dataOrRecord || ''), name: String(name || ''), ...extra, updatedAt: Date.now() };
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(payload);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}

export async function loadTopicAudioIDB(topicId) {
  if (!topicId) return null;
  try {
    const db = await openAudioDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(topicId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function deleteTopicAudioIDB(topicId) {
  if (!topicId) return false;
  try {
    const db = await openAudioDb();
    await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(topicId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Đọc & nén file âm thanh tải từ máy:
 *  - Nếu file nhỏ (<= 110KB): giữ nguyên dataURL gốc.
 *  - Nếu file lớn hơn: giải mã bằng AudioContext, cắt tối đa 15 giây đầu, hạ tần số lấy mẫu 16kHz Mono 8-bit PCM WAV
 *    để đảm bảo dung lượng nhỏ gọn (~120KB - 200KB), vừa lưu được vào IndexedDB (bản gốc + bản nén) vừa đồng bộ qua Firebase.
 */
export async function encodeAudioFile(file) {
  if (!file) throw new Error('Chưa chọn file âm thanh.');
  const rawDataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('Không đọc được file âm thanh.'));
    r.readAsDataURL(file);
  });

  if (rawDataUrl.length <= MAX_VOICE_BYTES && /^data:audio\//i.test(rawDataUrl)) {
    return { name: file.name, dataUrl: rawDataUrl, rawBlob: file };
  }

  // Nén sang 16kHz Mono 8-bit WAV để đồng bộ mượt qua Firebase & localStorage
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      const ctx = new AC();
      const ab = await file.arrayBuffer();
      const audioBuf = await ctx.decodeAudioData(ab.slice(0));
      ctx.close().catch(() => {});
      const targetRate = 16000;
      const maxSec = Math.min(audioBuf.duration, 15);
      const numSamples = Math.max(1, Math.floor(maxSec * targetRate));
      const ch0 = audioBuf.getChannelData(0);
      const ch1 = audioBuf.numberOfChannels > 1 ? audioBuf.getChannelData(1) : null;
      const ratio = audioBuf.sampleRate / targetRate;

      const wavBuf = new ArrayBuffer(44 + numSamples);
      const view = new DataView(wavBuf);
      const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
      writeStr(0, 'RIFF');
      view.setUint32(4, 36 + numSamples, true);
      writeStr(8, 'WAVE');
      writeStr(12, 'fmt ');
      view.setUint32(16, 16, true); // PCM
      view.setUint16(20, 1, true);  // Linear PCM
      view.setUint16(22, 1, true);  // Mono
      view.setUint32(24, targetRate, true);
      view.setUint32(28, targetRate, true); // byte rate (8-bit mono)
      view.setUint16(32, 1, true);  // block align
      view.setUint16(34, 8, true);  // 8-bit unsigned
      writeStr(36, 'data');
      view.setUint32(40, numSamples, true);

      // Chuẩn hóa biên độ để giọng nói rõ ràng ở 100%
      let peak = 0.01;
      for (let i = 0; i < ch0.length; i += 8) {
        const v = Math.abs(ch1 ? 0.5 * (ch0[i] + ch1[i]) : ch0[i]);
        if (v > peak) peak = v;
      }
      const gain = Math.min(2.5, 0.96 / peak);
      for (let i = 0; i < numSamples; i++) {
        const srcIdx = Math.min(ch0.length - 1, Math.floor(i * ratio));
        const sample = (ch1 ? 0.5 * (ch0[srcIdx] + ch1[srcIdx]) : ch0[srcIdx]) * gain;
        const clamped = Math.max(-1, Math.min(1, sample));
        view.setUint8(44 + i, Math.round((clamped + 1) * 127.5));
      }

      const wavBlob = new Blob([wavBuf], { type: 'audio/wav' });
      const wavDataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ''));
        r.onerror = () => reject(new Error('Lỗi đóng gói WAV'));
        r.readAsDataURL(wavBlob);
      });
      return { name: file.name, dataUrl: wavDataUrl, rawBlob: file };
    }
  } catch { /* fallback sang rawDataUrl nếu nhỏ vừa phải */ }

  if (rawDataUrl.length > 2500000) {
    throw new Error('File âm thanh quá lớn (vui lòng chọn file dưới 15 giây hoặc dưới 2MB).');
  }
  return { name: file.name, dataUrl: rawDataUrl, rawBlob: file };
}

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

export function clampVolume01(v, fallback = 1.0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.max(0, Math.min(1, n)) * 100) / 100;
}

export function sanitizeTopic(t) {
  if (!t || typeof t !== 'object') return null;
  const name = str(t.name, 60);
  if (!name) return null;
  const items = (Array.isArray(t.items) ? t.items : []).map(sanitizeItem).filter(Boolean).slice(0, MAX_ITEMS);
  const voiceData = typeof t.victoryVoiceData === 'string' && /^data:audio\//i.test(t.victoryVoiceData)
    ? t.victoryVoiceData
    : '';
  return {
    id: str(t.id, 40) || newId(),
    name,
    icon: str(t.icon, 8) || '🖼️',
    shuffle: t.shuffle === true,
    victoryAudioUrl: normalizeVictoryAudioUrl(t.victoryAudioUrl),
    victoryVoiceName: voiceData ? (str(t.victoryVoiceName, 80) || 'Ghi âm chiến thắng') : str(t.victoryVoiceName, 80),
    victoryVoiceData: voiceData,
    localAudioVolume: clampVolume01(t.localAudioVolume, 1.0),
    onlineAudioVolume: clampVolume01(t.onlineAudioVolume, 1.0),
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
      victoryVoiceName: t.victoryVoiceName || '',
      victoryVoiceData: t.victoryVoiceData || '',
      localAudioVolume: clampVolume01(t.localAudioVolume, 1.0),
      onlineAudioVolume: clampVolume01(t.onlineAudioVolume, 1.0),
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
