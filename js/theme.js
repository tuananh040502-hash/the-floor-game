/**
 * Hệ thống Giao diện Lễ Hội Động (Seasonal Theme Studio: Giáng Sinh - Noel / Tết Nguyên Đán / Apple Sáng - Tối).
 * - Mặc định kích hoạt giao diện 'christmas' (Noel) hoặc preset đang cấu hình trên nhánh `shared_theme` (Firebase).
 * - Đồng bộ thời gian thực qua `shared_theme`, `BroadcastChannel` và `localStorage['thefloor:themeConfig']`.
 * - Quản lý lớp nền động `#seasonalBgLayer` (Trang 1: bg1Url, Trang 2 Sàn đấu: bg2Url, Trang 3 Đấu trường: bg3Url)
 *   cùng lớp tuyết rơi 60fps `#seasonalSnowLayer` (rõ nét trên nền kem sáng, tự ẩn ở Trang 3 Đấu trường).
 */
import { loadFirebaseConfig } from './firebase-config.js?v=iosfix15';
import {
  THEME_CONFIG_KEY,
  THEME_PRESET_DEFAULTS,
  normalizeThemeAssetUrl,
  sanitizeCloudThemeConfig,
  readThemeConfigCache,
  writeThemeConfigCache,
  createSharedThemeSync,
} from './transport.js?v=bgm1';

const KEY = 'thefloor:theme';
const SEASON_INIT_KEY = 'thefloor:themeSeasonInit';
const SEASON_INIT_VER = 'xmas2026';
const DEFAULT_MOBILE_BG = THEME_PRESET_DEFAULTS.christmas.bgMobileUrl;

let activeConfig = readThemeConfigCache();
let themeSync = null;
let lastSyncedUpdatedAt = activeConfig.updatedAt || 0;

function ensureDefaultSeasonInit() {
  try {
    if (localStorage.getItem(SEASON_INIT_KEY) !== SEASON_INIT_VER) {
      localStorage.setItem(SEASON_INIT_KEY, SEASON_INIT_VER);
      const preset = activeConfig && activeConfig.preset !== 'default' ? activeConfig.preset : 'christmas';
      localStorage.setItem(KEY, preset);
    }
  } catch { /* ignore */ }
}

ensureDefaultSeasonInit();

function stored() {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'christmas' || v === 'tet' || v === 'light' || v === 'dark') return v;
  } catch { /* ignore */ }
  return null;
}

export function getSeasonalPreset() {
  if (activeConfig && (activeConfig.preset === 'christmas' || activeConfig.preset === 'tet')) {
    return activeConfig.preset;
  }
  return 'christmas';
}

export function currentTheme() {
  const s = stored();
  if (s) return s;
  if (activeConfig && activeConfig.preset === 'tet') return 'tet';
  if (activeConfig && activeConfig.preset === 'default') return 'dark';
  return 'christmas';
}

export function getThemeConfig() {
  return activeConfig;
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

export function ensureSeasonalLayers() {
  if (!document.body) return;
  const oldFx = document.getElementById('seasonalFxLayer');
  if (oldFx) oldFx.remove();

  let bgLayer = document.getElementById('seasonalBgLayer');
  if (!bgLayer) {
    bgLayer = document.createElement('div');
    bgLayer.id = 'seasonalBgLayer';
    bgLayer.setAttribute('aria-hidden', 'true');
    document.body.prepend(bgLayer);
  }

  let snowLayer = document.getElementById('seasonalSnowLayer');
  if (!snowLayer) {
    snowLayer = document.createElement('div');
    snowLayer.id = 'seasonalSnowLayer';
    snowLayer.className = 'seasonal-snow-layer';
    snowLayer.setAttribute('aria-hidden', 'true');
    const frag = document.createDocumentFragment();
    const count = 32;
    for (let i = 0; i < count; i++) {
      const flake = document.createElement('i');
      flake.className = 'snow-flake';
      const x = ((i * 29 + 11) % 98) + 1;
      const size = 4 + (i % 5); // 4px - 8px
      const dur = (8.5 + (i % 8) * 1.15).toFixed(2);
      const delay = (-((i * 1.37) % 15)).toFixed(2);
      const drift = ((i % 2 === 0 ? 1 : -1) * (18 + (i % 6) * 7));
      const op = (0.72 + (i % 4) * 0.08).toFixed(2);
      flake.style.setProperty('--snow-x', `${x}vw`);
      flake.style.setProperty('--snow-size', `${size}px`);
      flake.style.setProperty('--snow-dur', `${dur}s`);
      flake.style.setProperty('--snow-delay', `${delay}s`);
      flake.style.setProperty('--snow-drift', `${drift}px`);
      flake.style.setProperty('--snow-op', op);
      frag.appendChild(flake);
    }
    snowLayer.appendChild(frag);
    bgLayer.after(snowLayer);
  }
}

export function upgradeDriveBgToS0(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return '';
  return rawUrl.trim().replace(/(https:\/\/lh3\.googleusercontent\.com\/d\/[a-zA-Z0-9_-]+)=(?:w\d+|s\d+)/i, '$1=s0');
}

export function updateSeasonalBackground() {
  ensureSeasonalLayers();
  const root = document.documentElement;
  const t = currentTheme();
  const cfg = sanitizeCloudThemeConfig(activeConfig);
  const isSeasonal = t === 'christmas' || t === 'tet';
  const defXmas = THEME_PRESET_DEFAULTS.christmas;

  const bg1 = upgradeDriveBgToS0(normalizeThemeAssetUrl(cfg.bg1Url, t === 'christmas' ? defXmas.bg1Url : ''));
  const bg2 = upgradeDriveBgToS0(normalizeThemeAssetUrl(cfg.bg2Url, t === 'christmas' ? defXmas.bg2Url : bg1));
  const bg3 = upgradeDriveBgToS0(normalizeThemeAssetUrl(cfg.bg3Url, t === 'christmas' ? defXmas.bg3Url : bg1));
  const bgMob = upgradeDriveBgToS0(normalizeThemeAssetUrl(cfg.bgMobileUrl, ''));

  if (cfg.cardBg) root.style.setProperty('--seasonal-card-bg', cfg.cardBg);
  if (cfg.borderColor) root.style.setProperty('--seasonal-border', cfg.borderColor);
  if (cfg.accentColor) root.style.setProperty('--seasonal-accent', cfg.accentColor);

  root.dataset.borderStyle = isSeasonal ? (cfg.borderStyle || 'solid') : 'solid';
  root.dataset.effect = isSeasonal ? (cfg.effect || (t === 'tet' ? 'blossom' : 'snow')) : 'none';

  const bgLayer = document.getElementById('seasonalBgLayer');
  if (bgLayer) {
    if (!isSeasonal) {
      bgLayer.style.backgroundImage = 'none';
    } else {
      const slot = detectPageSlot();
      let chosenUrl = slot === 'bg3' ? bg3 : slot === 'bg2' ? bg2 : bg1;
      const isCustomSlotUrl = chosenUrl && !chosenUrl.startsWith('assets/christmas/bg-');
      const isCustomMobileUrl = bgMob && bgMob !== DEFAULT_MOBILE_BG;
      if (isPortraitMobileViewport() && bgMob && (isCustomMobileUrl || !isCustomSlotUrl)) {
        chosenUrl = bgMob;
      }
      bgLayer.dataset.slot = slot;
      bgLayer.style.backgroundImage = chosenUrl ? `url("${chosenUrl}")` : 'none';
    }
  }
}

function paint() {
  const t = currentTheme();
  document.documentElement.dataset.theme = t;
  updateSeasonalBackground();
  document.querySelectorAll('[data-theme-toggle]').forEach((b) => {
    if (t === 'christmas') {
      b.textContent = '★';
      b.title = 'Giao diện Giáng Sinh (Bấm để chuyển Sáng / Tối / Lễ hội)';
    } else if (t === 'tet') {
      b.textContent = '🧧';
      b.title = 'Giao diện Tết Nguyên Đán (Bấm để chuyển Sáng / Tối / Lễ hội)';
    } else if (t === 'light') {
      b.textContent = '☀︎';
      b.title = 'Giao diện Sáng (Bấm để chuyển Tối / Lễ hội)';
    } else {
      b.textContent = '☾';
      b.title = 'Giao diện Tối (Bấm để chuyển Lễ hội / Sáng)';
    }
  });
}

export function applyThemeConfig(newCfg, { switchActiveTheme = false } = {}) {
  activeConfig = writeThemeConfigCache(newCfg);
  if (switchActiveTheme) {
    const nextTheme = activeConfig.preset === 'default' ? 'dark' : activeConfig.preset;
    try { localStorage.setItem(KEY, nextTheme); } catch { /* ignore */ }
  }
  paint();
}

function isFullscreenActive() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}

function toggleFullscreen() {
  const docEl = document.documentElement;
  if (isFullscreenActive()) {
    if (typeof document.exitFullscreen === 'function') {
      document.exitFullscreen().catch(() => {});
    } else if (typeof document.webkitExitFullscreen === 'function') {
      try { document.webkitExitFullscreen(); } catch { /* ignore */ }
    }
  } else if (docEl) {
    if (typeof docEl.requestFullscreen === 'function') {
      docEl.requestFullscreen().catch(() => {});
    } else if (typeof docEl.webkitRequestFullscreen === 'function') {
      try { docEl.webkitRequestFullscreen(); } catch { /* ignore */ }
    }
  }
}

function syncFullscreenButtons() {
  const full = isFullscreenActive();
  ['btnFullscreenHome', 'btnFull'].forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.textContent = full ? '🗗' : '⛶';
    btn.title = full ? 'Thoát toàn màn hình (Esc)' : 'Toàn màn hình';
    btn.setAttribute('aria-pressed', full ? 'true' : 'false');
  });
}

function initFullscreenHome() {
  const btnHome = document.getElementById('btnFullscreenHome');
  if (btnHome && !btnHome.dataset.fsBound) {
    btnHome.dataset.fsBound = '1';
    btnHome.addEventListener('click', toggleFullscreen);
  }
  document.addEventListener('fullscreenchange', syncFullscreenButtons);
  document.addEventListener('webkitfullscreenchange', syncFullscreenButtons);
  syncFullscreenButtons();
}

export function initTheme() {
  activeConfig = readThemeConfigCache();
  ensureSeasonalLayers();
  paint();
  initFullscreenHome();

  document.querySelectorAll('[data-theme-toggle]').forEach((b) => {
    if (b.dataset.themeBound) return;
    b.dataset.themeBound = '1';
    b.addEventListener('click', () => {
      const cur = currentTheme();
      const seasonal = getSeasonalPreset();
      let next = seasonal;
      if (cur === seasonal || cur === 'christmas' || cur === 'tet') next = 'light';
      else if (cur === 'light') next = 'dark';
      else next = seasonal;
      try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
      paint();
    });
  });

  if (document.body && typeof MutationObserver === 'function') {
    const obs = new MutationObserver(() => {
      updateSeasonalBackground();
    });
    obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  window.addEventListener('resize', () => {
    updateSeasonalBackground();
  }, { passive: true });

  window.addEventListener('pageshow', () => {
    activeConfig = readThemeConfigCache();
    paint();
  });

  window.addEventListener('storage', (e) => {
    if (!e.key || e.key === THEME_CONFIG_KEY || e.key === KEY) {
      activeConfig = readThemeConfigCache();
      paint();
    }
  });

  try {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      const bc = new BroadcastChannel('thefloor:shared_theme');
      bc.onmessage = (ev) => {
        activeConfig = ev && ev.data ? sanitizeCloudThemeConfig(ev.data) : readThemeConfigCache();
        paint();
      };
    }
  } catch { /* ignore */ }

  try {
    const fbCfg = loadFirebaseConfig();
    createSharedThemeSync(fbCfg).then((sync) => {
      themeSync = sync;
      sync.subscribe((cloudCfg, rawVal) => {
        if (!cloudCfg) return;
        const clean = sanitizeCloudThemeConfig(cloudCfg);
        const changedPreset = clean.updatedAt && clean.updatedAt !== lastSyncedUpdatedAt && clean.preset !== activeConfig.preset;
        lastSyncedUpdatedAt = clean.updatedAt || 0;
        activeConfig = clean;
        if (changedPreset) {
          const nextTheme = clean.preset === 'default' ? 'dark' : clean.preset;
          try { localStorage.setItem(KEY, nextTheme); } catch { /* ignore */ }
        }
        paint();
        window.dispatchEvent(new CustomEvent('thefloor:theme-config-updated', { detail: clean }));
      });
    }).catch(() => {});
  } catch { /* ignore */ }
}

initTheme();
