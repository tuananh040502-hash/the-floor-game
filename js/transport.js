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
export const DELETED_TOPICS_KEY = 'deleted_topic_ids';
export const SHARED_BGM_PATH = 'shared_bgm';
export const BGM_CACHE_KEY = 'thefloor:bgm';
export const SHARED_THEME_PATH = 'shared_theme';
export const SHARED_THEMES_PATH = 'shared_themes';
export const THEME_CONFIG_KEY = 'thefloor:themeConfig';
export const THEMES_LIBRARY_KEY = 'thefloor:themeLibrary';
export const DELETED_THEMES_KEY = 'thefloor:deletedThemeIds';
const MAX_CLOUD_IMAGES = 100;
const MAX_INLINE_STR_LEN = 2048;

export function sanitizeColorStyle(raw, fallback = { mode: 'solid', c1: '#181D24', c2: '#242B35', angle: 135 }) {
  const fb = fallback || { mode: 'solid', c1: '#181D24', c2: '#242B35', angle: 135 };
  const cleanHex = (val, defHex) => {
    const s = String(val || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toUpperCase();
    if (/^#[0-9a-fA-F]{3}$/.test(s)) {
      return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toUpperCase();
    }
    return String(defHex || '#181D24').toUpperCase();
  };
  const clampAngle = (v, defA) => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return Number.isFinite(Number(defA)) ? Number(defA) : 135;
    return Math.max(0, Math.min(360, n));
  };
  if (typeof raw === 'string') {
    const hex = cleanHex(raw, fb.c1);
    return {
      mode: 'solid',
      c1: hex,
      c2: cleanHex(fb.c2, hex),
      angle: clampAngle(fb.angle, 135),
    };
  }
  if (!raw || typeof raw !== 'object') {
    return {
      mode: fb.mode === 'gradient' ? 'gradient' : 'solid',
      c1: cleanHex(fb.c1, '#181D24'),
      c2: cleanHex(fb.c2, fb.c1 || '#242B35'),
      angle: clampAngle(fb.angle, 135),
    };
  }
  return {
    mode: raw.mode === 'gradient' ? 'gradient' : 'solid',
    c1: cleanHex(raw.c1, fb.c1),
    c2: cleanHex(raw.c2, fb.c2 || fb.c1),
    angle: clampAngle(raw.angle, fb.angle),
  };
}

export function colorStyleToCss(st, fallbackHex = '#181D24') {
  const s = sanitizeColorStyle(st, { mode: 'solid', c1: fallbackHex, c2: fallbackHex, angle: 135 });
  return s.mode === 'gradient'
    ? `linear-gradient(${s.angle}deg, ${s.c1}, ${s.c2})`
    : s.c1;
}

export const THEME_PRESET_DEFAULTS = {
  christmas: {
    preset: 'christmas',
    bg1Url: 'assets/christmas/bg-1.webp',
    bg2Url: 'assets/christmas/bg-2.webp',
    bg3Url: 'assets/christmas/bg-3.webp',
    bgMobileUrl: 'assets/christmas/bg-mobile.webp',
    cardBg: '#FBF6EC',
    borderColor: '#D8B979',
    accentColor: '#B91C2C',
    cardStyle: { mode: 'solid', c1: '#FBF6EC', c2: '#F2E5C9', angle: 135 },
    borderStyle: { mode: 'solid', c1: '#D8B979', c2: '#B91C2C', angle: 135 },
    textStyle: { mode: 'solid', c1: '#2C1E14', c2: '#7A4B2A', angle: 90 },
    titleStyle: { mode: 'solid', c1: '#2C1E14', c2: '#B91C2C', angle: 90 },
    accentStyle: { mode: 'solid', c1: '#B91C2C', c2: '#D8B979', angle: 135 },
    effect: 'snow',
    effectEmojis: '❄️ 🎄 ⭐',
    bgmList: [],
  },
  default: {
    preset: 'default',
    bg1Url: '',
    bg2Url: '',
    bg3Url: '',
    bgMobileUrl: '',
    cardBg: '#181D24',
    borderColor: '#30353B',
    accentColor: '#0071E3',
    cardStyle: { mode: 'solid', c1: '#181D24', c2: '#242B35', angle: 135 },
    borderStyle: { mode: 'solid', c1: '#30353B', c2: '#0071E3', angle: 135 },
    textStyle: { mode: 'solid', c1: '#F5F9FE', c2: '#9BA0A6', angle: 90 },
    titleStyle: { mode: 'solid', c1: '#F5F9FE', c2: '#2997FF', angle: 90 },
    accentStyle: { mode: 'solid', c1: '#0071E3', c2: '#2997FF', angle: 135 },
    effect: 'none',
    effectEmojis: '❄️ 🎄 ⭐',
    bgmList: [],
  },
};

export const BUILTIN_THEMES = {
  builtin_christmas: {
    id: 'builtin_christmas',
    name: 'Giáng Sinh - Noel',
    isBuiltIn: true,
    basePreset: 'christmas',
    bg1Url: 'assets/christmas/bg-1.webp',
    bg1FileId: '',
    bg2Url: 'assets/christmas/bg-2.webp',
    bg2FileId: '',
    bg3Url: 'assets/christmas/bg-3.webp',
    bg3FileId: '',
    bgMobileUrl: 'assets/christmas/bg-mobile.webp',
    bgMobileFileId: '',
    cardBg: '#FBF6EC',
    borderColor: '#D8B979',
    accentColor: '#B91C2C',
    cardStyle: { mode: 'solid', c1: '#FBF6EC', c2: '#F2E5C9', angle: 135 },
    borderStyle: { mode: 'solid', c1: '#D8B979', c2: '#B91C2C', angle: 135 },
    textStyle: { mode: 'solid', c1: '#2C1E14', c2: '#7A4B2A', angle: 90 },
    titleStyle: { mode: 'solid', c1: '#2C1E14', c2: '#B91C2C', angle: 90 },
    accentStyle: { mode: 'solid', c1: '#B91C2C', c2: '#D8B979', angle: 135 },
    effect: 'snow',
    effectEmojis: '❄️ 🎄 ⭐',
    bgmList: [],
    ownerScriptUrl: '',
    ownerFolderId: '',
    updatedAt: 0,
  },
  builtin_default: {
    id: 'builtin_default',
    name: 'Mặc định (Apple)',
    isBuiltIn: true,
    basePreset: 'default',
    bg1Url: '',
    bg1FileId: '',
    bg2Url: '',
    bg2FileId: '',
    bg3Url: '',
    bg3FileId: '',
    bgMobileUrl: '',
    bgMobileFileId: '',
    cardBg: '#181D24',
    borderColor: '#30353B',
    accentColor: '#0071E3',
    cardStyle: { mode: 'solid', c1: '#181D24', c2: '#242B35', angle: 135 },
    borderStyle: { mode: 'solid', c1: '#30353B', c2: '#0071E3', angle: 135 },
    textStyle: { mode: 'solid', c1: '#F5F9FE', c2: '#9BA0A6', angle: 90 },
    titleStyle: { mode: 'solid', c1: '#F5F9FE', c2: '#2997FF', angle: 90 },
    accentStyle: { mode: 'solid', c1: '#0071E3', c2: '#2997FF', angle: 135 },
    effect: 'none',
    effectEmojis: '❄️ 🎄 ⭐',
    bgmList: [],
    ownerScriptUrl: '',
    ownerFolderId: '',
    updatedAt: 0,
  },
};

export function sanitizeThemeProfile(raw, fallbackId = '') {
  const rawId = String((raw && raw.id) || fallbackId || '').trim().replace(/[.#$/[\]]/g, '_').slice(0, 64);
  if (!rawId || rawId === 'builtin_tet') return null;
  const builtInTemplate = BUILTIN_THEMES[rawId] || null;
  const isBuiltIn = Boolean(builtInTemplate || (raw && raw.isBuiltIn && BUILTIN_THEMES[rawId]));
  const rawBase = raw && (raw.basePreset || raw.preset);
  const basePreset = rawBase === 'christmas'
    ? 'christmas'
    : (rawBase === 'default' ? 'default' : (builtInTemplate ? builtInTemplate.basePreset : 'default'));
  const def = builtInTemplate || THEME_PRESET_DEFAULTS[basePreset] || THEME_PRESET_DEFAULTS.default;

  const cleanColor = (val, fb) => {
    const s = String(val || '').trim();
    return /^#[0-9a-fA-F]{3,8}$/.test(s) ? s.toUpperCase() : fb;
  };
  const resolveSlotUrl = (field) => {
    if (raw && raw[field] !== undefined && raw[field] !== null) {
      const s = String(raw[field]).trim();
      if (!s) return '';
      return normalizeThemeAssetUrl(s, '');
    }
    return builtInTemplate ? (builtInTemplate[field] || '') : '';
  };
  const resolveSlotFileId = (idField, urlVal) => {
    const explicit = raw && typeof raw[idField] === 'string' ? raw[idField].trim().slice(0, 128) : '';
    if (explicit) return explicit;
    return extractDriveId(urlVal || '');
  };

  const bg1Url = resolveSlotUrl('bg1Url');
  const bg2Url = resolveSlotUrl('bg2Url');
  const bg3Url = resolveSlotUrl('bg3Url');
  const bgMobileUrl = resolveSlotUrl('bgMobileUrl');

  const cardStyle = sanitizeColorStyle(
    (raw && raw.cardStyle && typeof raw.cardStyle === 'object') ? raw.cardStyle : (raw && raw.cardBg ? raw.cardBg : def.cardStyle),
    def.cardStyle,
  );
  const borderStyle = sanitizeColorStyle(
    (raw && raw.borderStyle && typeof raw.borderStyle === 'object') ? raw.borderStyle : (raw && raw.borderColor ? raw.borderColor : def.borderStyle),
    def.borderStyle,
  );
  const textStyle = sanitizeColorStyle(
    (raw && (raw.textStyle || raw.textColor)) ? (raw.textStyle || raw.textColor) : def.textStyle,
    def.textStyle,
  );
  const titleStyle = sanitizeColorStyle(
    (raw && (raw.titleStyle || raw.titleColor)) ? (raw.titleStyle || raw.titleColor) : def.titleStyle,
    def.titleStyle,
  );
  const accentStyle = sanitizeColorStyle(
    (raw && raw.accentStyle && typeof raw.accentStyle === 'object') ? raw.accentStyle : (raw && raw.accentColor ? raw.accentColor : def.accentStyle),
    def.accentStyle,
  );

  const rawEffect = raw && raw.effect;
  const effect = rawEffect === 'snow'
    ? 'snow'
    : (rawEffect === 'emoji' || rawEffect === 'blossom')
      ? 'emoji'
      : (rawEffect === 'none' ? 'none' : (def.effect || 'none'));
  const rawEmojis = raw && typeof raw.effectEmojis === 'string' ? raw.effectEmojis.trim().slice(0, 80) : '';
  const effectEmojis = rawEmojis || (rawEffect === 'blossom' ? '🌸 🌼 ✨' : (def.effectEmojis || '❄️ 🎄 ⭐'));

  const name = String((raw && raw.name) || (builtInTemplate ? builtInTemplate.name : 'Theme mới')).trim().slice(0, 60)
    || (builtInTemplate ? builtInTemplate.name : 'Theme mới');

  const bgmSeen = new Set();
  const bgmList = [];
  for (const tr of asArr(raw && raw.bgmList)) {
    if (bgmList.length >= 20) break;
    const cleanTr = sanitizeCloudBgm(tr);
    if (cleanTr && !bgmSeen.has(cleanTr.id)) {
      bgmSeen.add(cleanTr.id);
      bgmList.push({ ...cleanTr });
    }
  }

  return {
    id: rawId,
    name,
    isBuiltIn,
    basePreset,
    preset: basePreset,
    bg1Url,
    bg1FileId: resolveSlotFileId('bg1FileId', bg1Url),
    bg2Url,
    bg2FileId: resolveSlotFileId('bg2FileId', bg2Url),
    bg3Url,
    bg3FileId: resolveSlotFileId('bg3FileId', bg3Url),
    bgMobileUrl,
    bgMobileFileId: resolveSlotFileId('bgMobileFileId', bgMobileUrl),
    cardBg: cardStyle.c1,
    borderColor: borderStyle.c1,
    accentColor: accentStyle.c1,
    cardStyle,
    borderStyle,
    textStyle,
    titleStyle,
    accentStyle,
    effect,
    effectEmojis,
    bgmList,
    ownerScriptUrl: normalizeScriptUrl(raw && raw.ownerScriptUrl).slice(0, MAX_INLINE_STR_LEN),
    ownerFolderId: normalizeFolderId(raw && raw.ownerFolderId).slice(0, 128),
    updatedAt: Number(raw && raw.updatedAt) || 0,
  };
}

export function extractThemeDriveFileIds(theme) {
  if (!theme || typeof theme !== 'object') return [];
  const ids = new Set();
  const addId = (raw) => {
    const id = extractDriveId(String(raw || ''));
    if (id) ids.add(id);
  };
  ['bg1FileId', 'bg2FileId', 'bg3FileId', 'bgMobileFileId'].forEach((k) => addId(theme[k]));
  ['bg1Url', 'bg2Url', 'bg3Url', 'bgMobileUrl'].forEach((k) => addId(theme[k]));
  asArr(theme.bgmList).forEach((tr) => {
    if (!tr || typeof tr !== 'object') return;
    addId(tr.fileId);
    if (tr.type === 'drive') addId(tr.url);
  });
  asArr(theme.stickers).forEach((st) => {
    if (!st || typeof st !== 'object') return;
    addId(st.fileId);
    addId(st.url);
  });
  return [...ids];
}

export function createDefaultThemeLibrary() {
  return {
    activeThemeId: 'builtin_christmas',
    themes: {
      builtin_christmas: sanitizeThemeProfile(BUILTIN_THEMES.builtin_christmas, 'builtin_christmas'),
      builtin_default: sanitizeThemeProfile(BUILTIN_THEMES.builtin_default, 'builtin_default'),
    },
    updatedAt: 0,
  };
}

export function sanitizeThemeLibrary(raw) {
  const lib = createDefaultThemeLibrary();
  if (!raw || typeof raw !== 'object') return lib;

  // Hỗ trợ tự động chuyển đổi từ cấu trúc cũ (chỉ 1 object đơn lẻ có preset/bg1Url)
  if (!raw.themes && (raw.preset || raw.bg1Url || raw.cardBg)) {
    const legacy = sanitizeCloudThemeConfig(raw);
    const targetId = legacy.preset === 'default'
      ? 'builtin_default'
      : 'builtin_christmas';
    lib.themes[targetId] = sanitizeThemeProfile({
      ...BUILTIN_THEMES[targetId],
      ...legacy,
      id: targetId,
      isBuiltIn: true,
      basePreset: legacy.preset,
    }, targetId);
    lib.activeThemeId = targetId;
    lib.updatedAt = legacy.updatedAt || 0;
    return lib;
  }

  const rawThemes = raw.themes;
  const entries = Array.isArray(rawThemes)
    ? rawThemes.map((t) => [t && t.id, t])
    : (rawThemes && typeof rawThemes === 'object' ? Object.entries(rawThemes) : []);

  entries.forEach(([keyId, item]) => {
    if (!item || typeof item !== 'object' || keyId === 'builtin_tet' || item.id === 'builtin_tet') return;
    const clean = sanitizeThemeProfile(item, keyId);
    if (clean) lib.themes[clean.id] = clean;
  });

  const reqActive = String(raw.activeThemeId || '').trim();
  lib.activeThemeId = (reqActive && lib.themes[reqActive]) ? reqActive : 'builtin_christmas';
  lib.updatedAt = Number(raw.updatedAt) || 0;
  return lib;
}

export function getDeletedThemeIds() {
  try {
    const raw = JSON.parse(localStorage.getItem(DELETED_THEMES_KEY) || '[]');
    if (Array.isArray(raw)) return new Set(raw.map((x) => String(x || '').trim()).filter(Boolean));
  } catch { /* ignore */ }
  return new Set();
}

export function markThemeDeleted(themeId) {
  const cleanId = String(themeId || '').trim();
  if (!cleanId || BUILTIN_THEMES[cleanId]) return;
  try {
    const set = getDeletedThemeIds();
    set.add(cleanId);
    localStorage.setItem(DELETED_THEMES_KEY, JSON.stringify([...set]));
  } catch { /* ignore */ }
}

export function mergeThemeLibraries(localRaw, remoteRaw, deletedIds = null) {
  const localLib = sanitizeThemeLibrary(localRaw);
  const remoteLib = sanitizeThemeLibrary(remoteRaw);
  const delSet = deletedIds instanceof Set ? deletedIds : getDeletedThemeIds();
  const merged = createDefaultThemeLibrary();
  const allIds = new Set([...Object.keys(localLib.themes), ...Object.keys(remoteLib.themes)]);

  allIds.forEach((id) => {
    if (!BUILTIN_THEMES[id] && delSet.has(id)) return;
    const lt = localLib.themes[id];
    const rt = remoteLib.themes[id];
    const picked = (lt && rt)
      ? ((rt.updatedAt || 0) >= (lt.updatedAt || 0) ? rt : lt)
      : (rt || lt || null);
    if (picked) {
      merged.themes[id] = sanitizeThemeProfile(picked, id);
    }
  });

  const preferRemote = (remoteLib.updatedAt || 0) >= (localLib.updatedAt || 0);
  const candActive = preferRemote ? remoteLib.activeThemeId : localLib.activeThemeId;
  merged.activeThemeId = merged.themes[candActive] ? candActive : 'builtin_christmas';
  merged.updatedAt = Math.max(localLib.updatedAt || 0, remoteLib.updatedAt || 0);
  return merged;
}

export function canIdentityModifyThemeProfile(theme, identity) {
  const scriptUrl = normalizeScriptUrl(identity && identity.scriptUrl);
  const folderId = normalizeFolderId(identity && identity.folderId);
  if (!scriptUrl || !folderId) return false;
  if (!theme || typeof theme !== 'object') return true;
  if (theme.isBuiltIn) return true;
  const ownerUrl = normalizeScriptUrl(theme.ownerScriptUrl);
  const ownerFolder = normalizeFolderId(theme.ownerFolderId);
  if (!ownerUrl || !ownerFolder) return true;
  return scriptUrl === ownerUrl && folderId === ownerFolder;
}

export function normalizeThemeAssetUrl(rawUrl, fallback = '') {
  if (typeof rawUrl !== 'string') return fallback;
  const s = rawUrl.trim();
  if (!s) return fallback;
  if (/^data:/i.test(s) || s.length > MAX_INLINE_STR_LEN) return fallback;
  const driveId = extractDriveId(s);
  if (driveId && (/(?:drive\.google\.com|docs\.google\.com|googleusercontent\.com)/i.test(s) || /^[a-zA-Z0-9_-]{25,}$/.test(s))) {
    return `https://lh3.googleusercontent.com/d/${driveId}=s0`;
  }
  if (/^https?:\/\//i.test(s) || /^assets\//i.test(s) || /^\.?\//i.test(s)) {
    return s.replace(/(https:\/\/lh3\.googleusercontent\.com\/d\/[a-zA-Z0-9_-]+)=(?:w\d+|s\d+)/i, '$1=s0');
  }
  return fallback;
}

export function sanitizeCloudThemeConfig(raw) {
  const basePreset = (raw && raw.preset === 'default') ? 'default' : 'christmas';
  const def = THEME_PRESET_DEFAULTS[basePreset] || THEME_PRESET_DEFAULTS.christmas;
  if (!raw || typeof raw !== 'object') {
    return {
      ...def,
      ownerScriptUrl: '',
      ownerFolderId: '',
      updatedAt: 0,
    };
  }
  const cleanColor = (val, fb) => {
    const s = String(val || '').trim();
    return /^#[0-9a-fA-F]{3,8}$/.test(s) ? s.toUpperCase() : fb;
  };
  const cardStyle = sanitizeColorStyle(raw.cardStyle || raw.cardBg, def.cardStyle);
  const borderStyle = sanitizeColorStyle(
    (raw.borderStyle && typeof raw.borderStyle === 'object') ? raw.borderStyle : raw.borderColor,
    def.borderStyle,
  );
  const textStyle = sanitizeColorStyle(raw.textStyle || raw.textColor, def.textStyle);
  const titleStyle = sanitizeColorStyle(raw.titleStyle || raw.titleColor, def.titleStyle);
  const accentStyle = sanitizeColorStyle(
    (raw.accentStyle && typeof raw.accentStyle === 'object') ? raw.accentStyle : raw.accentColor,
    def.accentStyle,
  );
  const effect = raw.effect === 'snow'
    ? 'snow'
    : (raw.effect === 'emoji' || raw.effect === 'blossom')
      ? 'emoji'
      : (raw.effect === 'none' ? 'none' : def.effect);
  const effectEmojis = (typeof raw.effectEmojis === 'string' && raw.effectEmojis.trim())
    ? raw.effectEmojis.trim().slice(0, 80)
    : def.effectEmojis;
  return {
    preset: basePreset,
    bg1Url: normalizeThemeAssetUrl(raw.bg1Url, def.bg1Url),
    bg2Url: normalizeThemeAssetUrl(raw.bg2Url, def.bg2Url),
    bg3Url: normalizeThemeAssetUrl(raw.bg3Url, def.bg3Url),
    bgMobileUrl: normalizeThemeAssetUrl(raw.bgMobileUrl, def.bgMobileUrl),
    cardBg: cardStyle.c1,
    borderColor: borderStyle.c1,
    accentColor: accentStyle.c1,
    cardStyle,
    borderStyle,
    textStyle,
    titleStyle,
    accentStyle,
    effect,
    effectEmojis,
    ownerScriptUrl: normalizeScriptUrl(raw.ownerScriptUrl).slice(0, MAX_INLINE_STR_LEN),
    ownerFolderId: normalizeFolderId(raw.ownerFolderId).slice(0, 128),
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
}

export function canIdentityModifyTheme(themeCfg, identity) {
  const scriptUrl = normalizeScriptUrl(identity && identity.scriptUrl);
  const folderId = normalizeFolderId(identity && identity.folderId);
  if (!scriptUrl || !folderId) return false;
  if (!themeCfg || typeof themeCfg !== 'object') return true;
  const ownerUrl = normalizeScriptUrl(themeCfg.ownerScriptUrl);
  const ownerFolder = normalizeFolderId(themeCfg.ownerFolderId);
  if (!ownerUrl || !ownerFolder) return true;
  return scriptUrl === ownerUrl && folderId === ownerFolder;
}

export function normalizeScriptUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

export function normalizeFolderId(id) {
  return String(id || '').trim();
}

/** Kiểm tra danh tính Drive (Apps Script URL + Folder ID) có quyền sửa/xóa chủ đề hay không. */
export function canIdentityModifyTopic(topic, identity) {
  if (!topic || typeof topic !== 'object') return false;
  const scriptUrl = normalizeScriptUrl(identity && identity.scriptUrl);
  const folderId = normalizeFolderId(identity && identity.folderId);
  if (!scriptUrl || !folderId) return false;
  const ownerUrl = normalizeScriptUrl(topic.ownerScriptUrl);
  const ownerFolder = normalizeFolderId(topic.ownerFolderId);
  if (!ownerUrl || !ownerFolder) return true;
  return scriptUrl === ownerUrl && folderId === ownerFolder;
}

/** Kiểm tra danh tính Drive có khớp chính xác chủ sở hữu bài nhạc nền hay không. */
export function canIdentityModifyBgm(bgm, identity) {
  if (!bgm || typeof bgm !== 'object') return false;
  const scriptUrl = normalizeScriptUrl(identity && identity.scriptUrl);
  const folderId = normalizeFolderId(identity && identity.folderId);
  if (!scriptUrl || !folderId) return false;
  const ownerUrl = normalizeScriptUrl(bgm.ownerScriptUrl);
  const ownerFolder = normalizeFolderId(bgm.ownerFolderId);
  if (!ownerUrl || !ownerFolder) return false;
  return scriptUrl === ownerUrl && folderId === ownerFolder;
}

export function getDeletedTopicIds() {
  try {
    const raw = JSON.parse(localStorage.getItem(DELETED_TOPICS_KEY) || '[]');
    if (Array.isArray(raw)) {
      return new Set(raw.map((x) => String(x || '').trim()).filter(Boolean));
    }
  } catch { /* ignore */ }
  return new Set();
}

export function markTopicDeleted(topicId) {
  const cleanId = String(topicId || '').trim();
  if (!cleanId) return;
  try {
    const set = getDeletedTopicIds();
    set.add(cleanId);
    localStorage.setItem(DELETED_TOPICS_KEY, JSON.stringify([...set]));
  } catch { /* ignore */ }
}

export async function createTransport(room, config, options = {}) {
  if (config && config.databaseURL) {
    try {
      return await firebaseTransport(room, config, options);
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
 * Trích xuất Google Drive File ID từ URL hoặc chuỗi ID.
 */
export function extractDriveId(raw) {
  if (typeof raw !== 'string') return '';
  const s = raw.trim();
  if (!s || /^data:/i.test(s)) return '';
  const byPath = /\/(?:file\/)?d\/([a-zA-Z0-9_-]{10,})/i.exec(s);
  if (byPath && byPath[1]) return byPath[1];
  const byQuery = /[?&]id=([a-zA-Z0-9_-]{10,})/i.exec(s);
  if (byQuery && byQuery[1]) return byQuery[1];
  if (/^[a-zA-Z0-9_-]{25,}$/.test(s)) return s;
  return '';
}

export function asArr(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') return Object.values(v);
  return [];
}

/**
 * Trích xuất toàn bộ danh sách Google Drive File ID duy nhất từ coverUrl, items và fileIds của chủ đề.
 */
export function extractTopicDriveFileIds(topic) {
  if (!topic || typeof topic !== 'object') return [];
  const ids = new Set();
  asArr(topic.fileIds).forEach((fid) => {
    const clean = extractDriveId(String(fid || ''));
    if (clean) ids.add(clean);
  });
  if (typeof topic.coverUrl === 'string' && topic.coverUrl.trim()) {
    const coverId = extractDriveId(topic.coverUrl);
    if (coverId) ids.add(coverId);
  }
  asArr(topic.items).forEach((it) => {
    if (it && typeof it === 'object' && it.type !== 'emoji' && typeof it.src === 'string') {
      const fid = extractDriveId(it.src);
      if (fid) ids.add(fid);
    }
  });
  return [...ids];
}

/**
 * Chuẩn hóa URL ảnh bìa (Drive -> lh3.googleusercontent.com/d/{ID}=w1280 hoặc giữ nguyên URL http/https).
 */
export function normalizeCoverUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return '';
  const s = rawUrl.trim();
  if (!s || /^data:/i.test(s) || s.length > MAX_INLINE_STR_LEN) return '';
  const driveId = extractDriveId(s);
  if (driveId && (/(?:drive\.google\.com|docs\.google\.com|googleusercontent\.com)/i.test(s) || /^[a-zA-Z0-9_-]{25,}$/.test(s))) {
    return `https://lh3.googleusercontent.com/d/${driveId}=w1280`;
  }
  if (/^https?:\/\//i.test(s)) return s;
  return '';
}

/**
 * Chuyển URL ảnh sang dạng thumbnail siêu nhẹ (=w400 cho Google Drive CDN).
 */
export function toThumbUrl400(rawUrl) {
  if (typeof rawUrl !== 'string') return '';
  const s = rawUrl.trim();
  if (!s) return '';
  if (/^data:image\//i.test(s)) return s;
  const driveId = extractDriveId(s);
  if (driveId && (/(?:drive\.google\.com|docs\.google\.com|googleusercontent\.com)/i.test(s) || /^[a-zA-Z0-9_-]{25,}$/.test(s))) {
    return `https://lh3.googleusercontent.com/d/${driveId}=w400`;
  }
  if (/^https?:\/\//i.test(s)) return s;
  return '';
}

/**
 * Lấy URL ảnh bìa thu nhỏ (thumbnail) cho một chủ đề:
 *  - Ưu tiên `topic.coverUrl`.
 *  - Nếu trống, lấy URL của ảnh hợp lệ đầu tiên trong `topic.items`.
 *  - Tự động chuyển link Google Drive sang kích thước `=w400` siêu nhẹ.
 */
export function getTopicCoverThumb(topic) {
  if (!topic || typeof topic !== 'object') return '';
  if (typeof topic.coverUrl === 'string' && topic.coverUrl.trim()) {
    const coverThumb = toThumbUrl400(topic.coverUrl);
    if (coverThumb) return coverThumb;
  }
  if (Array.isArray(topic.items)) {
    for (const it of topic.items) {
      if (it && typeof it === 'object' && it.type !== 'emoji' && typeof it.src === 'string' && it.src.trim()) {
        const itemThumb = toThumbUrl400(it.src);
        if (itemThumb) return itemThumb;
      }
    }
  }
  return '';
}

/**
 * Làm sạch dữ liệu chủ đề trước khi đẩy lên Firebase (`shared_topics`):
 *  - Chỉ giữ tên, biểu tượng, ảnh bìa (`coverUrl`), cờ xáo trộn, cấu hình âm thanh, danh sách URL ảnh Drive/HTTP và đáp án.
 *  - Loại bỏ chuỗi Base64 thô (`data:...`) hoặc chuỗi quá lớn để tránh nghẽn Firebase.
 */
export function sanitizeCloudTopic(raw, maxImages = MAX_CLOUD_IMAGES) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim().replace(/[.#$/[\]]/g, '_');
  const name = String(raw.name || '').trim().slice(0, 60);
  if (!id || !name) return null;

  const items = [];
  for (const it of asArr(raw.items)) {
    if (items.length >= maxImages) break;
    if (!it || typeof it !== 'object') continue;
    const answer = String(it.answer || '').trim().slice(0, 120);
    if (!answer) continue;
    const aliases = asArr(it.aliases)
      .map((a) => String(a || '').trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, 12);
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

  const coverUrl = normalizeCoverUrl(raw.coverUrl);
  const ownerScriptUrl = normalizeScriptUrl(raw.ownerScriptUrl).slice(0, MAX_INLINE_STR_LEN);
  const ownerFolderId = normalizeFolderId(raw.ownerFolderId).slice(0, 128);
  const driveFolderId = normalizeFolderId(raw.driveFolderId).slice(0, 128);
  const fileIds = extractTopicDriveFileIds({ coverUrl, items, fileIds: raw.fileIds });

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
    icon: '',
    coverUrl,
    ownerScriptUrl,
    ownerFolderId,
    driveFolderId,
    fileIds,
    shuffle: true,
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

/** Trích xuất YouTube Video ID từ mọi định dạng link (watch?v=, youtu.be/, shorts/, embed/, live/). */
export function extractYouTubeId(raw) {
  if (typeof raw !== 'string') return '';
  const s = raw.trim();
  if (!s) return '';
  const m = /(?:^|\/\/)(?:www\.|m\.|music\.)?(?:youtu\.be\/([a-zA-Z0-9_-]{6,32})|(?:youtube\.com|youtube-nocookie\.com)\/(?:watch\/?\?(?:[^#\s]*&)?v=([a-zA-Z0-9_-]{6,32})|(?:shorts|embed|live|v)\/([a-zA-Z0-9_-]{6,32})))/i.exec(s);
  const id = (m && (m[1] || m[2] || m[3]) ? (m[1] || m[2] || m[3]) : '').trim();
  return /^[a-zA-Z0-9_-]{6,32}$/.test(id) ? id : '';
}

/** Làm sạch dữ liệu 1 bài nhạc nền trước khi đồng bộ `shared_bgm` và cache cục bộ. */
export function sanitizeCloudBgm(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim().replace(/[.#$/[\]]/g, '_');
  if (!id) return null;

  const rawUrl = typeof raw.url === 'string' && !/^data:/i.test(raw.url) && raw.url.length <= MAX_INLINE_STR_LEN
    ? raw.url.trim()
    : '';
  let fileId = String(raw.fileId || '').trim().slice(0, 128);
  let youtubeId = String(raw.youtubeId || '').trim().slice(0, 32);
  let type = raw.type === 'youtube' ? 'youtube' : raw.type === 'drive' ? 'drive' : '';

  if (!type) {
    if (youtubeId || extractYouTubeId(rawUrl)) type = 'youtube';
    else if (fileId || extractDriveId(rawUrl)) type = 'drive';
  }
  if (type === 'youtube') {
    youtubeId = youtubeId || extractYouTubeId(rawUrl);
    if (!youtubeId) return null;
    fileId = '';
  } else if (type === 'drive') {
    fileId = fileId || extractDriveId(rawUrl);
    if (!fileId) return null;
    youtubeId = '';
  } else {
    return null;
  }

  const url = type === 'youtube'
    ? (rawUrl || `https://www.youtube.com/watch?v=${youtubeId}`)
    : `https://drive.google.com/uc?export=open&id=${fileId}`;
  const title = String(raw.title || '').trim().slice(0, 120)
    || (type === 'youtube' ? `YouTube (${youtubeId})` : `Nhạc Drive (${fileId.slice(0, 8)})`);
  const ownerScriptUrl = normalizeScriptUrl(raw.ownerScriptUrl).slice(0, MAX_INLINE_STR_LEN);
  const ownerFolderId = normalizeFolderId(raw.ownerFolderId).slice(0, 128);
  const createdAt = Number(raw.createdAt) || Date.now();

  return {
    id,
    title,
    type,
    url,
    fileId,
    youtubeId,
    ownerScriptUrl,
    ownerFolderId,
    createdAt,
  };
}

export function parseCloudBgmSnapshot(val) {
  if (!val || typeof val !== 'object') return [];
  const rawList = Array.isArray(val) ? val : Object.values(val);
  const out = [];
  const seen = new Set();
  rawList.forEach((item) => {
    const clean = sanitizeCloudBgm(item);
    if (clean && !seen.has(clean.id)) {
      seen.add(clean.id);
      out.push(clean);
    }
  });
  out.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
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

const MAX_VOICE_CLOUD_LEN = 30000;

/** Loại bỏ chuỗi Base64 lớn (`victoryVoiceData`) trước khi ghi state phòng lên Firebase. */
function stripHeavyRoomFields(rawState) {
  if (!rawState || typeof rawState !== 'object') return rawState;
  const needStripSetup = rawState.setup
    && typeof rawState.setup.victoryVoiceData === 'string'
    && (rawState.setup.victoryVoiceData.length > MAX_VOICE_CLOUD_LEN || /^data:/i.test(rawState.setup.victoryVoiceData));
  const needStripDuel = rawState.duel
    && typeof rawState.duel.victoryVoiceData === 'string'
    && (rawState.duel.victoryVoiceData.length > MAX_VOICE_CLOUD_LEN || /^data:/i.test(rawState.duel.victoryVoiceData));
  if (!needStripSetup && !needStripDuel) return rawState;
  const copy = { ...rawState };
  if (needStripSetup) copy.setup = { ...rawState.setup, victoryVoiceData: '' };
  if (needStripDuel) copy.duel = { ...rawState.duel, victoryVoiceData: '' };
  return copy;
}

function diffPaths(prev, next, base, out) {
  const sameDuelSession = base === 'duel'
    && prev && next
    && (prev.duelId || 0) === (next.duelId || 0)
    && (prev.mode || '1v1') === (next.mode || '1v1')
    && prev.categoryId === next.categoryId
    && prev.aId === next.aId
    && prev.bId === next.bId;
  const keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]);
  keys.forEach((k) => {
    if (k === 'victoryVoiceData') {
      const val = next ? next[k] : undefined;
      if (typeof val === 'string' && (val.length > MAX_VOICE_CLOUD_LEN || /^data:/i.test(val))) {
        return;
      }
    }
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
const SDK_LOAD_TIMEOUT_MS = 6500;
async function loadSdk() {
  if (!sdkPromise) {
    let timer = null;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Hết thời gian tải Firebase SDK')), SDK_LOAD_TIMEOUT_MS);
    });
    const importPromise = Promise.all([
      import(`${FB_BASE}/firebase-app.js`),
      import(`${FB_BASE}/firebase-database.js`),
    ]).then(([appMod, db]) => ({ appMod, db }));

    sdkPromise = Promise.race([importPromise, timeoutPromise])
      .finally(() => { if (timer) clearTimeout(timer); })
      .catch((err) => {
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

/** Gộp chung 1 listener `.info/connected` duy nhất trên mỗi instance `database`. */
const sharedConnHubs = new WeakMap();
function subscribeConnected(db, database, cb) {
  let hub = sharedConnHubs.get(database);
  if (!hub) {
    const subs = new Set();
    let lastVal = null;
    const unsub = db.onValue(db.ref(database, '.info/connected'), (snap) => {
      lastVal = Boolean(snap.val());
      subs.forEach((fn) => {
        try { fn(lastVal); } catch (e) { console.error(e); }
      });
    });
    hub = {
      subs,
      get lastVal() { return lastVal; },
      unsub,
    };
    sharedConnHubs.set(database, hub);
  }
  hub.subs.add(cb);
  if (hub.lastVal !== null) {
    try { cb(hub.lastVal); } catch { /* ignore */ }
  }
  return () => {
    hub.subs.delete(cb);
  };
}

async function firebaseTransport(room, config, options = {}) {
  const { appMod, db } = await loadSdk();
  const app = getOrInitApp(appMod, config);
  const database = db.getDatabase(app);
  const stateRef = db.ref(database, `rooms/${room}/state`);
  const isViewOnly = options && options.role === 'view';
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
  unsubs.push(subscribeConnected(db, database, (connected) => {
    emit({ type: connected ? 'online' : 'offline' });
  }));

  // Đo độ trễ thật trên máy Host (giãn chu kỳ 25000ms); tắt hoàn toàn trên máy Xem (role === 'view').
  let firstMeasure = null;
  let measureTimer = null;
  if (!isViewOnly) {
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
    firstMeasure = setTimeout(measure, 2000);
    measureTimer = setInterval(measure, 25000);
  }
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (firstMeasure) clearTimeout(firstMeasure);
    if (measureTimer) clearInterval(measureTimer);
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
        const cleanNext = stripHeavyRoomFields(state);
        const baseState = stripHeavyRoomFields(prev || lastState);
        lastState = cleanNext;
        if (baseState) {
          const patch = diffPaths(baseState, cleanNext, '', {});
          if (!Object.keys(patch).length) return Promise.resolve();
          return db.update(stateRef, patch).catch(handle);
        }
        return db.set(stateRef, cleanNext).catch(handle);
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

  connUnsub = subscribeConnected(db, database, (connected) => {
    if (connected) {
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
    async putTopic(topic, identity = null) {
      const clean = sanitizeCloudTopic(topic);
      if (!clean) return false;
      if (identity && !canIdentityModifyTopic(clean, identity)) {
        emitStatus({ state: 'error', message: 'Từ chối ghi đè: Không khớp quyền sở hữu chủ đề.' });
        return false;
      }
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
    async putMany(topicsList, identity = null) {
      if (!Array.isArray(topicsList) || !topicsList.length) return 0;
      const patch = {};
      let count = 0;
      topicsList.forEach((t) => {
        const clean = sanitizeCloudTopic(t);
        if (clean && (!identity || canIdentityModifyTopic(clean, identity))) {
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
  const key = 'thefloor:topics';
  let channel = null;
  try {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      channel = new BroadcastChannel('thefloor:shared_topics');
    }
  } catch { /* ignore */ }
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
 * Kết nối nhánh `shared_bgm` trên Firebase Realtime Database & cache `thefloor:bgm`.
 */
export async function createSharedBgmSync(config) {
  if (config && config.databaseURL) {
    try {
      return await firebaseSharedBgm(config);
    } catch (err) {
      console.error('Không kết nối được shared_bgm trên Firebase, chuyển sang chế độ cục bộ:', err);
      const local = localSharedBgm();
      local.fallbackReason = err.message || String(err);
      return local;
    }
  }
  return localSharedBgm();
}

function writeBgmCache(list) {
  try {
    localStorage.setItem(BGM_CACHE_KEY, JSON.stringify(list));
  } catch { /* ignore */ }
}

function readBgmCache() {
  try {
    return parseCloudBgmSnapshot(JSON.parse(localStorage.getItem(BGM_CACHE_KEY) || '[]'));
  } catch {
    return [];
  }
}

async function firebaseSharedBgm(config) {
  const { appMod, db } = await loadSdk();
  const app = getOrInitApp(appMod, config);
  const database = db.getDatabase(app);
  const bgmRef = db.ref(database, SHARED_BGM_PATH);

  const statusListeners = [];
  let currentStatus = { state: 'syncing', message: 'Đang kết nối nhạc nền…' };
  const emitStatus = (st) => {
    currentStatus = st;
    statusListeners.forEach((cb) => {
      try { cb(st); } catch (e) { console.error(e); }
    });
  };

  let bgmUnsub = null;
  let connUnsub = null;
  let disposed = false;

  connUnsub = subscribeConnected(db, database, (connected) => {
    if (connected) {
      emitStatus({ state: 'synced', message: 'Đã đồng bộ Cloud' });
    } else {
      emitStatus({ state: 'offline', message: 'Mất kết nối — dùng cache trên máy' });
    }
  });

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (bgmUnsub) { try { bgmUnsub(); } catch { /* ignore */ } bgmUnsub = null; }
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
      if (bgmUnsub) { try { bgmUnsub(); } catch { /* ignore */ } bgmUnsub = null; }
      emitStatus({ state: 'syncing', message: 'Đang đồng bộ nhạc nền…' });
      bgmUnsub = db.onValue(bgmRef, (snap) => {
        const list = parseCloudBgmSnapshot(snap.val());
        writeBgmCache(list);
        emitStatus({ state: 'synced', message: 'Đã đồng bộ Cloud', count: list.length });
        try { cb(list, snap.val()); } catch (e) { console.error(e); }
      }, (err) => {
        emitStatus({ state: 'error', message: `Lỗi đọc shared_bgm: ${err.message}` });
      });
    },
    async fetchAll() {
      const snap = await db.get(bgmRef);
      const list = parseCloudBgmSnapshot(snap.val());
      writeBgmCache(list);
      return list;
    },
    async putBgm(item, identity = null) {
      const clean = sanitizeCloudBgm(item);
      if (!clean) return false;
      if (!identity || !canIdentityModifyBgm(clean, identity)) {
        emitStatus({ state: 'error', message: 'Từ chối ghi: Không khớp quyền Drive.' });
        return false;
      }
      await db.set(db.ref(database, `${SHARED_BGM_PATH}/${clean.id}`), clean);
      return true;
    },
    async removeBgm(bgmId) {
      const cleanId = String(bgmId || '').trim().replace(/[.#$/[\]]/g, '_');
      if (!cleanId) return false;
      await db.remove(db.ref(database, `${SHARED_BGM_PATH}/${cleanId}`));
      return true;
    },
    dispose,
  };
}

function localSharedBgm() {
  let channel = null;
  try {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      channel = new BroadcastChannel('thefloor:shared_bgm');
    }
  } catch { /* ignore */ }
  const statusListeners = [];
  const dataListeners = new Set();
  const currentStatus = { state: 'local', message: 'Chế độ cục bộ' };
  const emitAll = () => {
    const list = readBgmCache();
    dataListeners.forEach((cb) => {
      try { cb(list, list); } catch (e) { console.error(e); }
    });
  };
  let storageHandler = null;
  return {
    mode: 'local',
    onStatus(cb) {
      statusListeners.push(cb);
      try { cb(currentStatus); } catch { /* ignore */ }
    },
    subscribe(cb) {
      dataListeners.add(cb);
      if (channel) channel.onmessage = emitAll;
      if (!storageHandler) {
        storageHandler = (e) => {
          if (e.key === BGM_CACHE_KEY) emitAll();
        };
        window.addEventListener('storage', storageHandler);
      }
      setTimeout(emitAll, 0);
    },
    async fetchAll() {
      return readBgmCache();
    },
    async putBgm(item, identity = null) {
      const clean = sanitizeCloudBgm(item);
      if (!clean || !identity || !canIdentityModifyBgm(clean, identity)) return false;
      const list = readBgmCache().filter((x) => x.id !== clean.id);
      list.push(clean);
      list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      writeBgmCache(list);
      if (channel) channel.postMessage(1);
      emitAll();
      return true;
    },
    async removeBgm(bgmId) {
      const cleanId = String(bgmId || '').trim();
      const list = readBgmCache().filter((x) => x.id !== cleanId);
      writeBgmCache(list);
      if (channel) channel.postMessage(1);
      emitAll();
      return true;
    },
    dispose() {
      dataListeners.clear();
      if (storageHandler) {
        window.removeEventListener('storage', storageHandler);
        storageHandler = null;
      }
      if (channel) channel.close();
    },
  };
}

/**
 * Thư viện nhiều Theme độc lập (`shared_themes` trên Firebase + cache `thefloor:themeLibrary`).
 */
export function readThemeLibraryCache() {
  try {
    const rawLib = JSON.parse(localStorage.getItem(THEMES_LIBRARY_KEY) || 'null');
    if (rawLib && typeof rawLib === 'object') {
      return sanitizeThemeLibrary(rawLib);
    }
    const legacy = JSON.parse(localStorage.getItem(THEME_CONFIG_KEY) || 'null');
    if (legacy && typeof legacy === 'object') {
      return sanitizeThemeLibrary(legacy);
    }
  } catch { /* ignore */ }
  return createDefaultThemeLibrary();
}

export function writeThemeLibraryCache(libRaw, { emitBroadcast = true } = {}) {
  const clean = sanitizeThemeLibrary(libRaw);
  try {
    localStorage.setItem(THEMES_LIBRARY_KEY, JSON.stringify(clean));
  } catch { /* ignore */ }
  const active = clean.themes[clean.activeThemeId] || clean.themes.builtin_christmas;
  if (active) {
    try {
      localStorage.setItem(THEME_CONFIG_KEY, JSON.stringify(sanitizeCloudThemeConfig(active)));
    } catch { /* ignore */ }
  }
  if (emitBroadcast) {
    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        const bc = new BroadcastChannel('thefloor:shared_themes');
        bc.postMessage(clean);
        bc.close();
      }
    } catch { /* ignore */ }
  }
  return clean;
}

export async function createSharedThemeLibrarySync(config) {
  if (config && config.databaseURL) {
    try {
      return await firebaseSharedThemeLibrary(config);
    } catch (err) {
      console.error('Không kết nối được shared_themes trên Firebase, chuyển sang chế độ cục bộ:', err);
      const local = localSharedThemeLibrary();
      local.fallbackReason = err.message || String(err);
      return local;
    }
  }
  return localSharedThemeLibrary();
}

async function firebaseSharedThemeLibrary(config) {
  const { appMod, db } = await loadSdk();
  const app = getOrInitApp(appMod, config);
  const database = db.getDatabase(app);
  const libRef = db.ref(database, SHARED_THEMES_PATH);
  const legacyRef = db.ref(database, SHARED_THEME_PATH);

  const statusListeners = [];
  let currentStatus = { state: 'syncing', message: 'Đang kết nối Thư viện Theme…' };
  const emitStatus = (st) => {
    currentStatus = st;
    statusListeners.forEach((cb) => {
      try { cb(st); } catch (e) { console.error(e); }
    });
  };

  let unsub = null;
  let connUnsub = null;
  let channel = null;
  let storageHandler = null;
  let disposed = false;

  try {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      channel = new BroadcastChannel('thefloor:shared_themes');
    }
  } catch { /* ignore */ }

  connUnsub = subscribeConnected(db, database, (connected) => {
    if (connected) {
      emitStatus({ state: 'synced', message: 'Đã đồng bộ Thư viện Theme Cloud' });
    } else {
      emitStatus({ state: 'offline', message: 'Mất kết nối — dùng Thư viện Theme trên máy' });
    }
  });

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (unsub) { try { unsub(); } catch { /* ignore */ } unsub = null; }
    if (connUnsub) { try { connUnsub(); } catch { /* ignore */ } connUnsub = null; }
    if (storageHandler) {
      window.removeEventListener('storage', storageHandler);
      storageHandler = null;
    }
    if (channel) { try { channel.close(); } catch { /* ignore */ } channel = null; }
  };
  window.addEventListener('pagehide', dispose);

  return {
    mode: 'firebase',
    onStatus(cb) {
      statusListeners.push(cb);
      try { cb(currentStatus); } catch { /* ignore */ }
    },
    subscribe(cb) {
      if (unsub) { try { unsub(); } catch { /* ignore */ } unsub = null; }
      emitStatus({ state: 'syncing', message: 'Đang đồng bộ Thư viện Theme…' });
      const emitLocal = () => {
        const cached = readThemeLibraryCache();
        try { cb(cached, cached); } catch (e) { console.error(e); }
      };
      if (channel) channel.onmessage = emitLocal;
      if (!storageHandler) {
        storageHandler = (e) => {
          if (e.key === THEMES_LIBRARY_KEY) emitLocal();
        };
        window.addEventListener('storage', storageHandler);
      }
      unsub = db.onValue(libRef, async (snap) => {
        let val = snap.val();
        if (!val) {
          try {
            const legacySnap = await db.get(legacyRef);
            if (legacySnap && legacySnap.val()) val = legacySnap.val();
          } catch { /* ignore */ }
        }
        const localCached = readThemeLibraryCache();
        let nextLib = localCached;
        if (val && typeof val === 'object') {
          const remoteClean = sanitizeThemeLibrary(val);
          nextLib = writeThemeLibraryCache(mergeThemeLibraries(localCached, remoteClean), { emitBroadcast: false });
        }
        emitStatus({ state: 'synced', message: 'Đã đồng bộ Thư viện Theme Cloud' });
        try { cb(nextLib, val || nextLib); } catch (e) { console.error(e); }
      }, (err) => {
        emitStatus({ state: 'error', message: `Đang dùng Thư viện Theme trên máy (${err.message})` });
        emitLocal();
      });
    },
    async fetchLibrary() {
      try {
        const snap = await db.get(libRef);
        const val = snap.val();
        if (val && typeof val === 'object') {
          return writeThemeLibraryCache(mergeThemeLibraries(readThemeLibraryCache(), val));
        }
        return readThemeLibraryCache();
      } catch {
        return readThemeLibraryCache();
      }
    },
    async putLibrary(rawLib) {
      const clean = sanitizeThemeLibrary(rawLib);
      clean.updatedAt = Date.now();
      writeThemeLibraryCache(clean);
      emitStatus({ state: 'syncing', message: 'Đang đồng bộ Thư viện Theme lên Cloud…' });
      try {
        await db.set(libRef, clean);
        const active = clean.themes[clean.activeThemeId] || clean.themes.builtin_christmas;
        if (active) {
          db.set(legacyRef, sanitizeCloudThemeConfig(active)).catch(() => {});
        }
        emitStatus({ state: 'synced', message: 'Đã đồng bộ Thư viện Theme Cloud' });
        return true;
      } catch (err) {
        emitStatus({ state: 'local', message: `Đã lưu trên máy (Cloud: ${err.message})` });
        return true;
      }
    },
    dispose,
  };
}

function localSharedThemeLibrary() {
  let channel = null;
  try {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      channel = new BroadcastChannel('thefloor:shared_themes');
    }
  } catch { /* ignore */ }
  const statusListeners = [];
  const dataListeners = new Set();
  const currentStatus = { state: 'local', message: 'Chế độ cục bộ' };
  const emitAll = () => {
    const lib = readThemeLibraryCache();
    dataListeners.forEach((cb) => {
      try { cb(lib, lib); } catch (e) { console.error(e); }
    });
  };
  let storageHandler = null;
  return {
    mode: 'local',
    onStatus(cb) {
      statusListeners.push(cb);
      try { cb(currentStatus); } catch { /* ignore */ }
    },
    subscribe(cb) {
      dataListeners.add(cb);
      if (channel) channel.onmessage = emitAll;
      if (!storageHandler) {
        storageHandler = (e) => {
          if (e.key === THEMES_LIBRARY_KEY) emitAll();
        };
        window.addEventListener('storage', storageHandler);
      }
      setTimeout(emitAll, 0);
    },
    async fetchLibrary() {
      return readThemeLibraryCache();
    },
    async putLibrary(rawLib) {
      const clean = sanitizeThemeLibrary(rawLib);
      clean.updatedAt = Date.now();
      writeThemeLibraryCache(clean);
      emitAll();
      return true;
    },
    dispose() {
      dataListeners.clear();
      if (storageHandler) {
        window.removeEventListener('storage', storageHandler);
        storageHandler = null;
      }
      if (channel) channel.close();
    },
  };
}

/**
 * Kết nối nhánh `shared_theme` trên Firebase Realtime Database & cache `thefloor:themeConfig`.
 */
export function readThemeConfigCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(THEME_CONFIG_KEY) || 'null');
    return sanitizeCloudThemeConfig(raw);
  } catch {
    return sanitizeCloudThemeConfig(null);
  }
}

export function writeThemeConfigCache(cfg) {
  const clean = sanitizeCloudThemeConfig(cfg);
  try {
    localStorage.setItem(THEME_CONFIG_KEY, JSON.stringify(clean));
  } catch { /* ignore */ }
  return clean;
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
  let channel = null;
  try {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      channel = new BroadcastChannel(key);
    }
  } catch { /* ignore */ }
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
