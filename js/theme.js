/**
 * Hệ thống Thư viện Giao diện Lễ Hội Động (Multi-Theme Library: Giáng Sinh / Mặc định / Tự tạo).
 * - Lưu trữ nhiều hồ sơ theme độc lập trong `shared_themes` (Firebase), `thefloor_themes.json` (Google Drive) và `localStorage['thefloor:themeLibrary']`.
 * - Hỗ trợ 4 nhóm màu Đơn sắc / Chuyển sắc (cardStyle, borderStyle, textStyle, titleStyle) và hiệu ứng Tuyết / Emoji rơi tối ưu GPU.
 * - Quản lý lớp nền chuẩn Retina `#seasonalBgLayer` (`=w2560`) và lớp rơi tối ưu GPU `#seasonalSnowLayer`.
 */
import { loadFirebaseConfig } from './firebase-config.js?v=2026v1';
import {
  THEME_CONFIG_KEY,
  THEMES_LIBRARY_KEY,
  THEME_PRESET_DEFAULTS,
  BUILTIN_THEMES,
  sanitizeColorStyle,
  colorStyleToCss,
  normalizeThemeAssetUrl,
  sanitizeThemeLibrary,
  readThemeLibraryCache,
  writeThemeLibraryCache,
  createSharedThemeLibrarySync,
} from './transport.js?v=2026v1';

const KEY = 'thefloor:theme';
const SEASON_INIT_KEY = 'thefloor:themeSeasonInit';
const SEASON_INIT_VER = 'xmas2026';
const DEFAULT_MOBILE_BG = THEME_PRESET_DEFAULTS.christmas.bgMobileUrl;

let activeLibrary = readThemeLibraryCache();
let themeLibSync = null;
let lastSyncedUpdatedAt = activeLibrary.updatedAt || 0;
let lastSyncedActiveId = activeLibrary.activeThemeId || 'builtin_christmas';
let lastSnowSig = '';

export function getThemeLibrary() {
  return activeLibrary;
}

export function getActiveTheme() {
  if (!activeLibrary || !activeLibrary.themes) {
    activeLibrary = readThemeLibraryCache();
  }
  return activeLibrary.themes[activeLibrary.activeThemeId]
    || activeLibrary.themes.builtin_christmas
    || BUILTIN_THEMES.builtin_christmas;
}

export function getThemeConfig() {
  return getActiveTheme();
}

function ensureDefaultSeasonInit() {
  try {
    if (localStorage.getItem(SEASON_INIT_KEY) !== SEASON_INIT_VER) {
      localStorage.setItem(SEASON_INIT_KEY, SEASON_INIT_VER);
      const active = getActiveTheme();
      const preset = active && active.basePreset !== 'default' ? active.basePreset : 'christmas';
      localStorage.setItem(KEY, preset);
    }
  } catch { /* ignore */ }
}

ensureDefaultSeasonInit();

function stored() {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'christmas' || v === 'light' || v === 'dark') return v;
    if (v === 'tet') return 'christmas';
  } catch { /* ignore */ }
  return null;
}

export function getSeasonalPreset() {
  return 'christmas';
}

export function currentTheme() {
  const s = stored();
  if (s) return s;
  const active = getActiveTheme();
  if (active && active.basePreset === 'default') return 'dark';
  return 'christmas';
}

function detectPageSlot() {
  const isArena = Boolean(document.body && document.body.classList.contains('in-arena'));
  if (isArena) return 'bg3';
  const pageAttr = document.body && document.body.dataset ? document.body.dataset.page : '';
  if (pageAttr === 'index') return 'bg1';
  if (pageAttr === 'game' || pageAttr === 'topics') return 'bg2';
  const path = (window.location.pathname || '').toLowerCase();
  if (path.endsWith('game.html') || path.endsWith('topics.html') || document.getElementById('viewFloor')) {
    return 'bg2';
  }
  return 'bg1';
}

function isPortraitMobileViewport() {
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(max-width: 900px) and (orientation: portrait)').matches;
}

function isTopicsPage() {
  return Boolean(document.body && document.body.dataset && document.body.dataset.page === 'topics');
}

export function syncSnowMotionState() {
  const paused = Boolean(
    document.hidden
    || document.visibilityState === 'hidden'
    || document.documentElement.classList.contains('shell-frame-active')
    || (document.body && document.body.classList.contains('in-arena'))
    || isTopicsPage(),
  );
  document.documentElement.classList.toggle('snow-paused', paused);
  const snowLayer = document.getElementById('seasonalSnowLayer');
  if (snowLayer) {
    snowLayer.classList.toggle('is-paused', paused);
  }
}

function splitEmojiGraphemes(raw) {
  const str = String(raw || '').trim();
  if (!str) return ['❄️', '🎄', '⭐'];
  let parts = [];
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      const seg = new Intl.Segmenter('vi', { granularity: 'grapheme' });
      parts = [...seg.segment(str)].map((s) => s.segment.trim()).filter(Boolean);
    } else {
      parts = Array.from(str).map((ch) => ch.trim()).filter(Boolean);
    }
  } catch {
    parts = Array.from(str).map((ch) => ch.trim()).filter(Boolean);
  }
  return parts.length ? parts.slice(0, 24) : ['❄️', '🎄', '⭐'];
}

function isSameColorStyle(a, b) {
  if (!a || !b) return false;
  if (a.mode !== b.mode || a.c1 !== b.c1) return false;
  if (a.mode === 'gradient') {
    return a.c2 === b.c2 && Number(a.angle) === Number(b.angle);
  }
  return true;
}

function syncSnowParticles(effect, emojiStr) {
  if (!document.body || isTopicsPage()) {
    const old = document.getElementById('seasonalSnowLayer');
    if (old) old.remove();
    lastSnowSig = '';
    return;
  }
  const snowLayer = document.getElementById('seasonalSnowLayer');
  if (!snowLayer) return;

  const sig = effect === 'emoji' ? `emoji|${emojiStr}` : effect;
  if (sig === lastSnowSig) return;
  lastSnowSig = sig;
  snowLayer.innerHTML = '';

  if (effect !== 'snow' && effect !== 'emoji') return;

  const frag = document.createDocumentFragment();
  if (effect === 'emoji') {
    const emojis = splitEmojiGraphemes(emojiStr);
    const count = 14;
    for (let i = 0; i < count; i++) {
      const el = document.createElement('span');
      el.className = 'snow-flake snow-emoji';
      el.textContent = emojis[i % emojis.length];
      const x = Math.round(((i * 6.9) + 3 + (i % 3) * 1.9) % 92) + 3;
      const size = 16 + ((i * 3) % 11); // 16px – 26px
      const dur = (10.5 + (i % 6) * 1.35).toFixed(2);
      const delay = (-((i * 1.73) % 15)).toFixed(2);
      const drift = ((i % 2 === 0 ? 1 : -1) * (18 + (i % 5) * 8));
      const op = (0.78 + (i % 3) * 0.08).toFixed(2);
      el.style.setProperty('--snow-x', `${x}vw`);
      el.style.setProperty('--snow-size', `${size}px`);
      el.style.setProperty('--snow-dur', `${dur}s`);
      el.style.setProperty('--snow-delay', `${delay}s`);
      el.style.setProperty('--snow-drift', `${drift}px`);
      el.style.setProperty('--snow-op', op);
      frag.appendChild(el);
    }
  } else {
    const count = 12;
    for (let i = 0; i < count; i++) {
      const flake = document.createElement('i');
      flake.className = 'snow-flake';
      const x = Math.round(((i * 8.1) + 4 + (i % 3) * 1.8) % 94) + 3;
      const size = 4 + (i % 4);
      const dur = (10 + (i % 6) * 1.4).toFixed(2);
      const delay = (-((i * 1.85) % 14)).toFixed(2);
      const drift = ((i % 2 === 0 ? 1 : -1) * (16 + (i % 4) * 7));
      const op = (0.72 + (i % 3) * 0.09).toFixed(2);
      flake.style.setProperty('--snow-x', `${x}vw`);
      flake.style.setProperty('--snow-size', `${size}px`);
      flake.style.setProperty('--snow-dur', `${dur}s`);
      flake.style.setProperty('--snow-delay', `${delay}s`);
      flake.style.setProperty('--snow-drift', `${drift}px`);
      flake.style.setProperty('--snow-op', op);
      frag.appendChild(flake);
    }
  }
  snowLayer.appendChild(frag);
}

export function ensureSeasonalLayers() {
  if (!document.body) return;
  const oldFx = document.getElementById('seasonalFxLayer');
  if (oldFx) oldFx.remove();
  const oldStickers = document.getElementById('seasonalStickerLayer');
  if (oldStickers) oldStickers.remove();

  let bgLayer = document.getElementById('seasonalBgLayer');
  if (!bgLayer) {
    bgLayer = document.createElement('div');
    bgLayer.id = 'seasonalBgLayer';
    bgLayer.setAttribute('aria-hidden', 'true');
    document.body.prepend(bgLayer);
  }

  let snowLayer = document.getElementById('seasonalSnowLayer');
  if (isTopicsPage()) {
    if (snowLayer) snowLayer.remove();
    return;
  }
  if (!snowLayer) {
    snowLayer = document.createElement('div');
    snowLayer.id = 'seasonalSnowLayer';
    snowLayer.className = 'seasonal-snow-layer';
    snowLayer.setAttribute('aria-hidden', 'true');
    bgLayer.after(snowLayer);
  }
}

export function upgradeDriveBgToS0(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return '';
  const trimmed = rawUrl.trim();
  if (/^https:\/\/lh3\.googleusercontent\.com\/d\/[a-zA-Z0-9_-]+=(?:w\d+|s\d+)/i.test(trimmed)) {
    return trimmed.replace(/(https:\/\/lh3\.googleusercontent\.com\/d\/[a-zA-Z0-9_-]+)=(?:w\d+|s\d+)/i, '$1=w2560');
  }
  if (/^https:\/\/lh3\.googleusercontent\.com\/d\/[a-zA-Z0-9_-]+$/i.test(trimmed)) {
    return `${trimmed}=w2560`;
  }
  return trimmed;
}

function applyThemeColorCssVars(active, t, showCustomAssets) {
  const root = document.documentElement;
  const factory = BUILTIN_THEMES[active.id]
    || THEME_PRESET_DEFAULTS[active.basePreset]
    || THEME_PRESET_DEFAULTS.default;
  const isCustomProfile = !active.isBuiltIn;

  const cardStyle = sanitizeColorStyle(active.cardStyle || active.cardBg, factory.cardStyle);
  const borderStyle = sanitizeColorStyle(active.borderStyle || active.borderColor, factory.borderStyle);
  const textStyle = sanitizeColorStyle(active.textStyle, factory.textStyle);
  const titleStyle = sanitizeColorStyle(active.titleStyle, factory.titleStyle);
  const accentStyle = sanitizeColorStyle(active.accentStyle || active.accentColor, factory.accentStyle);

  const applyCard = showCustomAssets && (isCustomProfile || !isSameColorStyle(cardStyle, factory.cardStyle));
  const applyBorder = showCustomAssets && (isCustomProfile || !isSameColorStyle(borderStyle, factory.borderStyle));
  const applyText = showCustomAssets && (isCustomProfile || !isSameColorStyle(textStyle, factory.textStyle));
  const applyTitle = showCustomAssets && (isCustomProfile || !isSameColorStyle(titleStyle, factory.titleStyle));
  const applyAccent = showCustomAssets && (isCustomProfile || !isSameColorStyle(accentStyle, factory.accentStyle));

  root.style.setProperty('--seasonal-card-bg', cardStyle.c1);
  root.style.setProperty('--seasonal-border', borderStyle.c1);
  root.style.setProperty('--seasonal-accent', accentStyle.c1);

  const cardFill = colorStyleToCss(cardStyle, factory.cardStyle.c1);
  // Giữ độ bán trong suốt (0.88) của thẻ Noel khi chỉ bật viền gradient mà chưa đổi màu nền thẻ
  const defaultCardLayer = (t === 'christmas' && !applyCard)
    ? 'linear-gradient(0deg, rgba(251, 246, 236, 0.88), rgba(251, 246, 236, 0.88))'
    : `linear-gradient(0deg, ${cardStyle.c1}, ${cardStyle.c1})`;
  const cardLayer = cardStyle.mode === 'gradient' ? cardFill : defaultCardLayer;

  root.style.setProperty('--tf-card-fill', cardFill);
  root.style.setProperty('--tf-card-layer', cardLayer);
  root.style.setProperty('--tf-border-color', borderStyle.c1);
  root.style.setProperty('--tf-border-grad', colorStyleToCss(borderStyle, factory.borderStyle.c1));
  root.style.setProperty('--tf-text-color', textStyle.c1);
  root.style.setProperty('--tf-text-grad', colorStyleToCss(textStyle, factory.textStyle.c1));
  root.style.setProperty('--tf-title-color', titleStyle.c1);
  root.style.setProperty('--tf-title-grad', colorStyleToCss(titleStyle, factory.titleStyle.c1));
  root.style.setProperty('--tf-accent-c1', accentStyle.c1);
  root.style.setProperty('--tf-accent-fill', colorStyleToCss(accentStyle, factory.accentStyle.c1));

  root.dataset.customCard = applyCard ? cardStyle.mode : 'none';
  root.dataset.customBorder = applyBorder ? borderStyle.mode : 'none';
  root.dataset.customText = applyText ? textStyle.mode : 'none';
  root.dataset.customTitle = applyTitle ? titleStyle.mode : 'none';
  root.dataset.customAccent = applyAccent ? accentStyle.mode : 'none';
}

/** Xem trước trực tiếp màu & gradient trên DOM (0 localStorage / 0 BroadcastChannel -> mượt 120Hz). */
export function previewThemeColorsLive(themeProfile) {
  if (!themeProfile || typeof themeProfile !== 'object') return;
  applyThemeColorCssVars(themeProfile, currentTheme(), true);
}

function notifyBgmThemePlaylist(activeTheme) {
  if (!activeTheme || typeof activeTheme !== 'object') return;
  const themeId = activeTheme.id || '';
  const bgmList = Array.isArray(activeTheme.bgmList)
    ? activeTheme.bgmList.map((tr) => (tr && typeof tr === 'object' ? { ...tr } : tr)).filter(Boolean)
    : [];
  try {
    const topWin = getTopWinSafe();
    if (topWin && topWin.__theFloorBgmController && typeof topWin.__theFloorBgmController.setThemePlaylist === 'function') {
      topWin.__theFloorBgmController.setThemePlaylist(themeId, bgmList);
      return;
    }
    if (isInChildFrame() && window.top) {
      window.top.postMessage({ type: 'THEFLOOR_BGM_THEME', themeId, bgmList }, '*');
    }
  } catch { /* ignore */ }
}

function notifyBgmScene(scene) {
  const nextScene = scene === 'arena' ? 'arena' : scene === 'topics' ? 'topics' : 'lobby';
  try {
    const topWin = getTopWinSafe();
    if (topWin && topWin.__theFloorBgmController && typeof topWin.__theFloorBgmController.setScene === 'function') {
      topWin.__theFloorBgmController.setScene(nextScene);
      return;
    }
    if (isInChildFrame() && window.top) {
      window.top.postMessage({ type: 'THEFLOOR_BGM_SCENE', scene: nextScene }, '*');
    }
  } catch { /* ignore */ }
}

export function updateSeasonalBackground() {
  ensureSeasonalLayers();
  const root = document.documentElement;
  const t = currentTheme();
  const active = getActiveTheme();
  const factory = BUILTIN_THEMES[active.id]
    || THEME_PRESET_DEFAULTS[active.basePreset]
    || THEME_PRESET_DEFAULTS.default;

  const cardStyle = sanitizeColorStyle(active.cardStyle || active.cardBg, factory.cardStyle);
  const borderStyle = sanitizeColorStyle(active.borderStyle || active.borderColor, factory.borderStyle);
  const textStyle = sanitizeColorStyle(active.textStyle, factory.textStyle);
  const titleStyle = sanitizeColorStyle(active.titleStyle, factory.titleStyle);
  const accentStyle = sanitizeColorStyle(active.accentStyle || active.accentColor, factory.accentStyle);

  const isSeasonal = t === 'christmas';
  const isCustomProfile = !active.isBuiltIn;
  const hasCustomBg = Boolean(active.bg1Url || active.bg2Url || active.bg3Url || active.bgMobileUrl);
  const hasCustomColor = !isSameColorStyle(cardStyle, factory.cardStyle)
    || !isSameColorStyle(borderStyle, factory.borderStyle)
    || !isSameColorStyle(textStyle, factory.textStyle)
    || !isSameColorStyle(titleStyle, factory.titleStyle)
    || !isSameColorStyle(accentStyle, factory.accentStyle);
  const matchesActiveThemeBase = (active.basePreset === 'default' && (t === 'dark' || t === 'light')) || isSeasonal;
  const showCustomAssets = isSeasonal || (matchesActiveThemeBase && (isCustomProfile || hasCustomBg || hasCustomColor || active.effect === 'snow' || active.effect === 'emoji'));

  const bg1 = upgradeDriveBgToS0(normalizeThemeAssetUrl(active.bg1Url, ''));
  const bg2 = upgradeDriveBgToS0(normalizeThemeAssetUrl(active.bg2Url, bg1));
  const bg3 = upgradeDriveBgToS0(normalizeThemeAssetUrl(active.bg3Url, bg1));
  const bgMob = upgradeDriveBgToS0(normalizeThemeAssetUrl(active.bgMobileUrl, ''));

  applyThemeColorCssVars(active, t, showCustomAssets);

  const resolvedEffect = showCustomAssets
    ? (active.effect === 'snow' || active.effect === 'emoji' ? active.effect : 'none')
    : 'none';
  root.dataset.effect = resolvedEffect;
  root.dataset.activeThemeId = active.id || 'builtin_christmas';

  const slot = detectPageSlot();
  const bgLayer = document.getElementById('seasonalBgLayer');
  let chosenUrl = '';
  if (bgLayer) {
    if (!showCustomAssets) {
      bgLayer.style.backgroundImage = 'none';
    } else {
      chosenUrl = slot === 'bg3' ? bg3 : slot === 'bg2' ? bg2 : bg1;
      const isCustomSlotUrl = chosenUrl && !chosenUrl.startsWith('assets/christmas/bg-');
      const isCustomMobileUrl = bgMob && bgMob !== DEFAULT_MOBILE_BG;
      if (isPortraitMobileViewport() && bgMob && (isCustomMobileUrl || !isCustomSlotUrl)) {
        chosenUrl = bgMob;
      }
      bgLayer.dataset.slot = slot;
      bgLayer.style.backgroundImage = chosenUrl ? `url("${chosenUrl}")` : 'none';
    }
  }
  root.dataset.hasCustomBg = chosenUrl ? '1' : '0';

  syncSnowParticles(resolvedEffect, active.effectEmojis || '❄️ 🎄 ⭐');
  syncSnowMotionState();
  notifyBgmThemePlaylist(active);
}

function paint() {
  const t = currentTheme();
  document.documentElement.dataset.theme = t;
  updateSeasonalBackground();
  document.querySelectorAll('[data-theme-toggle]').forEach((b) => {
    if (t === 'christmas') {
      b.textContent = '★';
      b.title = 'Giao diện Lễ hội / Tùy chỉnh (Bấm để chuyển Sáng / Tối / Lễ hội)';
    } else if (t === 'light') {
      b.textContent = '☀︎';
      b.title = 'Giao diện Sáng (Bấm để chuyển Tối / Lễ hội)';
    } else {
      b.textContent = '☾';
      b.title = 'Giao diện Tối (Bấm để chuyển Lễ hội / Sáng)';
    }
  });
}

export function applyThemeLibrary(newLib, { switchActiveTheme = false } = {}) {
  activeLibrary = writeThemeLibraryCache(newLib);
  lastSyncedUpdatedAt = activeLibrary.updatedAt || Date.now();
  lastSyncedActiveId = activeLibrary.activeThemeId || 'builtin_christmas';
  if (switchActiveTheme) {
    const active = getActiveTheme();
    const nextTheme = active.basePreset === 'default' ? 'dark' : active.basePreset;
    try { localStorage.setItem(KEY, nextTheme); } catch { /* ignore */ }
  }
  paint();
}

export function applyThemeConfig(newCfg, { switchActiveTheme = false } = {}) {
  const nextLib = sanitizeThemeLibrary(activeLibrary);
  const targetId = (newCfg && newCfg.id && nextLib.themes[newCfg.id])
    ? newCfg.id
    : nextLib.activeThemeId;
  nextLib.themes[targetId] = {
    ...nextLib.themes[targetId],
    ...newCfg,
    id: targetId,
    updatedAt: Date.now(),
  };
  nextLib.activeThemeId = targetId;
  nextLib.updatedAt = Date.now();
  applyThemeLibrary(nextLib, { switchActiveTheme });
}

const WANT_FS_KEY = 'thefloor:wantFs';
let lastKnownFsState = false;
let shellRootUrl = '';
let shellInitialized = false;

function getTopWinSafe() {
  try {
    if (window.top && window.top.document) return window.top;
  } catch { /* cross-origin */ }
  return window;
}

function isInChildFrame() {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function safeSetWantFs(want) {
  try { sessionStorage.setItem(WANT_FS_KEY, want ? '1' : '0'); } catch { /* ignore */ }
}

function safeGetWantFs() {
  try { return sessionStorage.getItem(WANT_FS_KEY) === '1'; } catch { return false; }
}

export function isFullscreenActive() {
  const topWin = getTopWinSafe();
  const topDoc = topWin.document;
  return Boolean(
    (topDoc && (topDoc.fullscreenElement || topDoc.webkitFullscreenElement))
    || document.fullscreenElement
    || document.webkitFullscreenElement,
  );
}

export function enterFullscreen() {
  safeSetWantFs(true);
  const topWin = getTopWinSafe();
  const docEl = topWin.document && topWin.document.documentElement;
  if (!docEl) return;
  try {
    if (typeof docEl.requestFullscreen === 'function') {
      const p = docEl.requestFullscreen();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } else if (typeof docEl.webkitRequestFullscreen === 'function') {
      docEl.webkitRequestFullscreen();
    }
  } catch { /* ignore */ }
}

export function exitFullscreen() {
  safeSetWantFs(false);
  const topWin = getTopWinSafe();
  const topDoc = topWin.document;
  if (!topDoc) return;
  try {
    if (typeof topDoc.exitFullscreen === 'function') {
      const p = topDoc.exitFullscreen();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } else if (typeof topDoc.webkitExitFullscreen === 'function') {
      topDoc.webkitExitFullscreen();
    }
  } catch { /* ignore */ }
}

export function toggleFullscreen() {
  if (isFullscreenActive()) exitFullscreen();
  else enterFullscreen();
}

function broadcastFsSyncToFrame(active) {
  const frame = document.getElementById('appViewportFrame');
  if (frame && frame.contentWindow) {
    try {
      frame.contentWindow.postMessage({ type: 'THEFLOOR_FS_SYNC', active: Boolean(active) }, '*');
    } catch { /* ignore */ }
  }
}

function syncFullscreenButtons(forcedState) {
  const full = typeof forcedState === 'boolean' ? forcedState : isFullscreenActive();
  // Nếu người dùng thoát Fullscreen bằng phím Esc (true -> false), cập nhật wantFs = '0'
  if (!isInChildFrame() && lastKnownFsState && !full) {
    safeSetWantFs(false);
  }
  lastKnownFsState = full;

  ['btnFullscreenHome', 'btnFull'].forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.textContent = full ? '🗗' : '⛶';
    btn.title = full ? 'Thoát toàn màn hình (Esc)' : 'Toàn màn hình';
    btn.setAttribute('aria-pressed', full ? 'true' : 'false');
    btn.classList.toggle('is-fs-active', full);
  });
  document.querySelectorAll('[data-fullscreen-toggle]').forEach((btn) => {
    btn.textContent = full ? '🗗' : '⛶';
    btn.title = full ? 'Thoát toàn màn hình (Esc)' : 'Toàn màn hình';
    btn.setAttribute('aria-pressed', full ? 'true' : 'false');
    btn.classList.toggle('is-fs-active', full);
  });

  if (!isInChildFrame()) {
    broadcastFsSyncToFrame(full);
  }
}

function resolveInternalUrl(rawUrl) {
  if (!rawUrl) return null;
  try {
    const resolved = new URL(rawUrl, window.location.href);
    if (window.location.origin !== 'null' && resolved.origin !== window.location.origin) {
      return null;
    }
    return resolved.pathname + resolved.search + resolved.hash;
  } catch {
    return null;
  }
}

function getPageName(urlStr) {
  try {
    const u = new URL(urlStr, window.location.href);
    const seg = (u.pathname || '').split('/').pop() || '';
    return seg.toLowerCase() || 'index.html';
  } catch {
    return 'index.html';
  }
}

function setShellFrameActive(active) {
  document.documentElement.classList.toggle('shell-frame-active', Boolean(active));
  if (document.body) {
    document.body.classList.toggle('shell-frame-active', Boolean(active));
    if (!active) document.body.classList.remove('page-exiting');
  }
  syncSnowMotionState();
}

function closeViewportFrame() {
  const frame = document.getElementById('appViewportFrame');
  if (frame) {
    try { frame.src = 'about:blank'; } catch { /* ignore */ }
    frame.remove();
  }
  setShellFrameActive(false);
  notifyBgmScene(isTopicsPage() ? 'topics' : 'lobby');
  notifyBgmThemePlaylist(getActiveTheme());
  paint();
}

function openInViewportFrame(relUrl) {
  let frame = document.getElementById('appViewportFrame');
  if (!frame) {
    frame = document.createElement('iframe');
    frame.id = 'appViewportFrame';
    frame.className = 'app-viewport-frame';
    frame.setAttribute('allow', 'autoplay; fullscreen');
    frame.setAttribute('allowfullscreen', '');
    frame.addEventListener('load', () => {
      broadcastFsSyncToFrame(isFullscreenActive());
    });
    document.body.appendChild(frame);
  }
  setShellFrameActive(true);
  const targetPage = getPageName(relUrl);
  if (targetPage === 'topics.html') {
    // Khóa tự động tắt nhạc nền ngay lập tức khi mở trang Soạn chủ đề
    notifyBgmScene('topics');
  } else {
    notifyBgmScene('lobby');
    try {
      if (window.__theFloorBgmController && typeof window.__theFloorBgmController.setAutoPlayAllowed === 'function') {
        window.__theFloorBgmController.setAutoPlayAllowed(true);
      }
    } catch { /* ignore */ }
    notifyBgmThemePlaylist(getActiveTheme());
  }
  frame.src = relUrl;
}

export function navigateApp(targetUrl, { pushHistory = true } = {}) {
  if (!targetUrl) return;
  const relUrl = resolveInternalUrl(targetUrl);
  if (!relUrl) {
    window.location.href = targetUrl;
    return;
  }

  // Nếu đang chạy bên trong #appViewportFrame -> gửi yêu cầu về window.top để không thoát Fullscreen
  if (isInChildFrame()) {
    try {
      window.top.postMessage({ type: 'THEFLOOR_NAVIGATE', url: relUrl }, '*');
      return;
    } catch {
      window.location.href = relUrl;
      return;
    }
  }

  // Đang ở window.top: kiểm tra xem có quay về đúng trang gốc không
  const rootPage = getPageName(shellRootUrl || window.location.href);
  const destPage = getPageName(relUrl);

  // Nếu window.top đang là game.html hoặc topics.html (do F5 sau pushState) mà quay về index.html:
  // dùng location.href để giải phóng sạch toàn bộ kết nối Firebase phòng cũ, tránh chồng 2 phòng song song.
  if (destPage === 'index.html' && rootPage !== 'index.html') {
    window.location.href = relUrl;
    return;
  }

  const isReturningToRoot = (destPage === rootPage)
    && (destPage === 'index.html' || relUrl === shellRootUrl);

  if (isReturningToRoot) {
    closeViewportFrame();
    if (pushHistory) {
      try {
        window.history.pushState({ shellUrl: relUrl, isRoot: true }, '', relUrl);
      } catch { /* ignore */ }
    }
    return;
  }

  openInViewportFrame(relUrl);
  if (pushHistory) {
    try {
      window.history.pushState({ shellUrl: relUrl, isRoot: false }, '', relUrl);
    } catch { /* ignore */ }
  }
}

function initNavigationAndFullscreenShell() {
  if (shellInitialized) return;
  shellInitialized = true;
  shellRootUrl = window.location.pathname + window.location.search + window.location.hash;

  window.__theFloorNavigate = navigateApp;
  window.__theFloorToggleFullscreen = toggleFullscreen;

  const bindFsBtn = (btn) => {
    if (!btn || btn.dataset.fsBound) return;
    btn.dataset.fsBound = '1';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleFullscreen();
    });
  };
  bindFsBtn(document.getElementById('btnFullscreenHome'));
  bindFsBtn(document.getElementById('btnFull'));
  document.querySelectorAll('[data-fullscreen-toggle]').forEach(bindFsBtn);

  lastKnownFsState = isFullscreenActive();

  // Chỉ window.top mới gắn listener fullscreenchange (iframe con chỉ nhận qua THEFLOOR_FS_SYNC -> 0 memory leak trên topDoc)
  if (!isInChildFrame()) {
    const onFsChange = () => syncFullscreenButtons();
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
  }
  syncFullscreenButtons();

  // Nhận thông điệp đồng bộ Fullscreen & điều hướng không reload giữa window.top và #appViewportFrame
  window.addEventListener('message', (ev) => {
    if (!ev || !ev.data || typeof ev.data !== 'object') return;
    if (window.location.origin !== 'null' && ev.origin && ev.origin !== 'null' && ev.origin !== window.location.origin) {
      return;
    }
    if (ev.data.type === 'THEFLOOR_FS_SYNC') {
      syncFullscreenButtons(Boolean(ev.data.active));
    } else if (!isInChildFrame() && ev.data.type === 'THEFLOOR_NAVIGATE' && ev.data.url) {
      navigateApp(ev.data.url, { pushHistory: true });
    } else if (!isInChildFrame() && ev.data.type === 'THEFLOOR_FS_TOGGLE') {
      toggleFullscreen();
    }
  });

  if (!isInChildFrame()) {
    try {
      window.history.replaceState({ shellUrl: shellRootUrl, isRoot: true }, '', shellRootUrl);
    } catch { /* ignore */ }

    window.addEventListener('popstate', (ev) => {
      const target = (ev && ev.state && ev.state.shellUrl)
        || (window.location.pathname + window.location.search + window.location.hash);
      navigateApp(target, { pushHistory: false });
    });

    // Dự phòng khôi phục nhanh sau khi F5 / Cmd+R nếu trước đó người dùng đang bật Fullscreen
    if (safeGetWantFs() && !isFullscreenActive()) {
      const restoreFsOnFirstTap = (e) => {
        if (!safeGetWantFs() || isFullscreenActive()) return;
        const t = e && e.target;
        if (t && typeof t.closest === 'function' && t.closest('#btnFullscreenHome, #btnFull, [data-fullscreen-toggle]')) {
          return;
        }
        enterFullscreen();
      };
      document.addEventListener('pointerdown', restoreFsOnFirstTap, { once: true, capture: true });
    }
  }
}

export function initTheme() {
  activeLibrary = readThemeLibraryCache();
  ensureSeasonalLayers();
  paint();
  initNavigationAndFullscreenShell();
  if (isTopicsPage()) {
    notifyBgmScene('topics');
  }

  document.querySelectorAll('[data-theme-toggle]').forEach((b) => {
    if (b.dataset.themeBound) return;
    b.dataset.themeBound = '1';
    b.addEventListener('click', () => {
      const cur = currentTheme();
      let next = 'christmas';
      if (cur === 'christmas') next = 'light';
      else if (cur === 'light') next = 'dark';
      else next = 'christmas';
      try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
      paint();
    });
  });

  let bodyObs = null;
  if (document.body && typeof MutationObserver === 'function') {
    bodyObs = new MutationObserver(() => {
      updateSeasonalBackground();
    });
    bodyObs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  window.addEventListener('resize', () => {
    updateSeasonalBackground();
  }, { passive: true });

  document.addEventListener('visibilitychange', syncSnowMotionState);
  syncSnowMotionState();

  window.addEventListener('pageshow', () => {
    activeLibrary = readThemeLibraryCache();
    paint();
  });

  window.addEventListener('storage', (e) => {
    if (!e.key || e.key === THEMES_LIBRARY_KEY || e.key === THEME_CONFIG_KEY || e.key === KEY) {
      activeLibrary = readThemeLibraryCache();
      paint();
      window.dispatchEvent(new CustomEvent('thefloor:theme-library-updated', { detail: activeLibrary }));
    }
  });

  let themeBc = null;
  try {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      themeBc = new BroadcastChannel('thefloor:shared_themes');
      themeBc.onmessage = (ev) => {
        activeLibrary = ev && ev.data ? sanitizeThemeLibrary(ev.data) : readThemeLibraryCache();
        paint();
        window.dispatchEvent(new CustomEvent('thefloor:theme-library-updated', { detail: activeLibrary }));
      };
    }
  } catch { /* ignore */ }

  // Dọn sạch MutationObserver, BroadcastChannel và Firebase listener khi đóng trang / unload iframe
  window.addEventListener('pagehide', () => {
    if (bodyObs) { try { bodyObs.disconnect(); } catch { /* ignore */ } bodyObs = null; }
    if (themeBc) { try { themeBc.close(); } catch { /* ignore */ } themeBc = null; }
    if (themeLibSync && typeof themeLibSync.dispose === 'function') {
      try { themeLibSync.dispose(); } catch { /* ignore */ }
      themeLibSync = null;
    }
  });

  // Iframe con nhận theme từ window.top qua BroadcastChannel; trang topics.html do cms.js quản lý shared_themes -> tránh mở 2 kết nối trùng lặp
  if (!isInChildFrame() && !isTopicsPage()) {
    try {
      const fbCfg = loadFirebaseConfig();
      createSharedThemeLibrarySync(fbCfg).then((sync) => {
        themeLibSync = sync;
        sync.subscribe((cloudLib) => {
          if (!cloudLib) return;
          const clean = sanitizeThemeLibrary(cloudLib);
          const switched = clean.activeThemeId !== lastSyncedActiveId
            && clean.updatedAt && clean.updatedAt !== lastSyncedUpdatedAt;
          lastSyncedUpdatedAt = clean.updatedAt || 0;
          lastSyncedActiveId = clean.activeThemeId || 'builtin_christmas';
          activeLibrary = clean;
          if (switched) {
            const active = getActiveTheme();
            const nextTheme = active.basePreset === 'default' ? 'dark' : active.basePreset;
            try { localStorage.setItem(KEY, nextTheme); } catch { /* ignore */ }
          }
          paint();
          window.dispatchEvent(new CustomEvent('thefloor:theme-library-updated', { detail: clean }));
        });
      }).catch(() => {});
    } catch { /* ignore */ }
  }
}

initTheme();
