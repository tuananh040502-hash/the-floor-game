import { loadFirebaseConfig } from './firebase-config.js?v=2026v1';
import {
  asArr, createSharedTopicsSync, sanitizeCloudTopic, sanitizeCloudBgm, extractYouTubeId,
  getTopicCoverThumb, normalizeCoverUrl, toThumbUrl400,
  normalizeScriptUrl, normalizeFolderId, extractTopicDriveFileIds, extractDriveId,
  canIdentityModifyTopic, getDeletedTopicIds, markTopicDeleted,
  THEME_PRESET_DEFAULTS, BUILTIN_THEMES, sanitizeThemeProfile, sanitizeThemeLibrary,
  sanitizeColorStyle, colorStyleToCss,
  extractThemeDriveFileIds, mergeThemeLibraries, markThemeDeleted,
  readThemeLibraryCache, writeThemeLibraryCache, createSharedThemeLibrarySync,
  canIdentityModifyThemeProfile, normalizeThemeAssetUrl,
} from './transport.js?v=2026v1';
import { applyThemeLibrary, previewThemeColorsLive } from './theme.js?v=2026v1';
import {
  TOPICS_KEY, loadCustom, newId, loadDrive, saveDrive,
  deleteTopicAudioIDB,
  sanitizeItem, sanitizeTopic, exportPayload, parseImport,
} from './topics.js?v=2026v1';
import {
  normalizeImageUrl, driveFallbackUrl, isLegacyEmojiSampleTopic,
  purgeEmptyAndDefaultTopics,
} from './engine.js?v=2026v1';
import { initBgm, uploadDriveAudioFile, fetchYouTubeTitle } from './bgm.js?v=2026v1';

export const MAX_TOPIC_IMAGES = 100;

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const room = params.get('room');
$('backLink').href = room ? `game.html?role=host&room=${encodeURIComponent(room)}` : 'index.html';

const DELETE_DENIED_MSG = 'Không thể xóa: Bạn cần nhập đúng Apps Script Web App URL và Folder ID đã dùng để đăng chủ đề này.';
const EDIT_DENIED_MSG = '🔒 Chủ đề của người khác (Chỉ xem) — Cần nhập đúng Apps Script Web App URL và Folder ID đã đăng chủ đề này để sửa hoặc xóa.';
const SCRIPT_URL_RE = /^https:\/\/script\.google\.com\/(macros\/s\/|a\/)/;

function getCurrentDriveIdentity() {
  const cfg = loadDrive();
  const inpUrl = $('driveUrl') ? $('driveUrl').value : '';
  const inpFolder = $('driveFolder') ? $('driveFolder').value : '';
  return {
    scriptUrl: normalizeScriptUrl(inpUrl || cfg.url),
    folderId: normalizeFolderId(inpFolder || cfg.folderId),
  };
}

function hasValidDriveIdentity() {
  const { scriptUrl, folderId } = getCurrentDriveIdentity();
  return Boolean(scriptUrl && folderId && SCRIPT_URL_RE.test(scriptUrl));
}

/** Gắn thông tin quyền sở hữu (ownerScriptUrl, ownerFolderId) & danh sách fileIds Drive cho chủ đề. */
function stampOwnership(topic) {
  if (!topic || typeof topic !== 'object') return topic;
  const { scriptUrl, folderId } = getCurrentDriveIdentity();
  const existingUrl = normalizeScriptUrl(topic.ownerScriptUrl);
  const existingFolder = normalizeFolderId(topic.ownerFolderId);
  topic.ownerScriptUrl = existingUrl || scriptUrl || '';
  topic.ownerFolderId = existingFolder || folderId || '';
  topic.driveFolderId = normalizeFolderId(topic.driveFolderId || '');
  topic.fileIds = extractTopicDriveFileIds(topic);
  return topic;
}

/**
 * Kiểm tra quyền sở hữu thống nhất:
 *  - Trình duyệt phải cấu hình đủ Apps Script Web App URL hợp lệ + Folder ID.
 *  - Nếu chủ đề đã gắn ownerScriptUrl & ownerFolderId -> phải khớp chính xác cả 2 trường.
 *  - Nếu chủ đề cũ chưa gắn owner -> cho phép nhận quyền & sửa khi trình duyệt đang có đủ cấu hình Drive hợp lệ.
 */
function canEditTopic(topic) {
  if (!topic || typeof topic !== 'object') return false;
  const identity = getCurrentDriveIdentity();
  if (!identity.scriptUrl || !identity.folderId || !SCRIPT_URL_RE.test(identity.scriptUrl)) return false;
  return canIdentityModifyTopic(topic, identity);
}

/** Chỉ cho phép xóa khi trùng khớp quyền sở hữu với `canEditTopic(topic)`. */
function canDeleteTopic(topic) {
  return canEditTopic(topic);
}

/** Gửi yêu cầu xóa các file ảnh Drive bị gỡ khỏi chủ đề (không chạm thư mục nếu còn câu hỏi khác). */
function deleteDriveItemFiles(topic, removedItems) {
  if (!topic || !canEditTopic(topic) || !Array.isArray(removedItems) || !removedItems.length) return;
  const { scriptUrl, folderId: currentFolderId } = getCurrentDriveIdentity();
  if (!scriptUrl || !currentFolderId) return;

  const stillUsedIds = new Set(extractTopicDriveFileIds(topic));
  const idsToDelete = [];
  const seen = new Set();
  removedItems.forEach((it) => {
    if (!it || typeof it !== 'object' || it.type === 'emoji' || typeof it.src !== 'string') return;
    const fid = extractDriveId(it.src);
    if (fid && !stillUsedIds.has(fid) && !seen.has(fid)) {
      seen.add(fid);
      idsToDelete.push(fid);
    }
  });
  if (!idsToDelete.length) return;

  fetch(scriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      action: 'deleteTopicFolder',
      folderId: currentFolderId,
      fileIds: idsToDelete,
    }),
  }).catch((err) => {
    console.warn('Không xóa được file ảnh thừa trên Drive:', err);
  });
}

const sessionDraftIds = new Set();

function loadTopicsUpToLimit() {
  const base = loadCustom();
  const deletedIds = getDeletedTopicIds();
  try {
    const raw = JSON.parse(localStorage.getItem(TOPICS_KEY) || 'null');
    if (Array.isArray(raw)) {
      const byId = new Map(raw.map((t) => [t && t.id, t]));
      base.forEach((t) => {
        const src = byId.get(t.id);
        if (src) {
          if (Array.isArray(src.items) && src.items.length > t.items.length) {
            t.items = src.items.map(sanitizeItem).filter(Boolean).slice(0, MAX_TOPIC_IMAGES);
          }
          t.coverUrl = normalizeCoverUrl(src.coverUrl) || normalizeImageUrl(src.coverUrl) || '';
          t.ownerScriptUrl = normalizeScriptUrl(src.ownerScriptUrl);
          t.ownerFolderId = normalizeFolderId(src.ownerFolderId);
          t.driveFolderId = normalizeFolderId(src.driveFolderId);
          t.fileIds = extractTopicDriveFileIds(src);
        } else {
          t.coverUrl = normalizeCoverUrl(t.coverUrl) || normalizeImageUrl(t.coverUrl) || '';
          t.ownerScriptUrl = normalizeScriptUrl(t.ownerScriptUrl);
          t.ownerFolderId = normalizeFolderId(t.ownerFolderId);
          t.driveFolderId = normalizeFolderId(t.driveFolderId);
          t.fileIds = extractTopicDriveFileIds(t);
        }
      });
    }
  } catch { /* ignore */ }
  const { kept, purgedIds } = purgeEmptyAndDefaultTopics(base, {
    keepIds: sessionDraftIds,
    deletedIds,
  });
  if (purgedIds.length) {
    purgedIds.forEach((pid) => markTopicDeleted(pid));
    try { localStorage.setItem(TOPICS_KEY, JSON.stringify(kept)); } catch { /* ignore */ }
  }
  return kept;
}

let topics = loadTopicsUpToLimit();
let currentId = topics[0] ? topics[0].id : null;
let uploading = false;
let deletingTopic = false;
let cloudSync = null;
let initialMigrationDone = false;
let pendingDeleteId = null;
let bgm = null;
const cleanedLegacyCloudIds = new Set();
const ownerBackfilledIds = new Set();

const cur = () => topics.find((t) => t.id === currentId) || null;

/** Lưu bản đệm cục bộ vào localStorage bằng 1 lần JSON.stringify duy nhất (giữ tối đa 100 ảnh, bảo toàn coverUrl, ownerScriptUrl, ownerFolderId, driveFolderId, fileIds). */
function persistLocalCache() {
  try {
    const cleanList = (Array.isArray(topics) ? topics : []).map((src) => {
      if (!src || typeof src !== 'object') return null;
      const base = sanitizeTopic({ ...src, shuffle: true, items: [] });
      if (!base) return null;
      base.icon = '';
      base.shuffle = true;
      base.items = (Array.isArray(src.items) ? src.items : [])
        .map(sanitizeItem)
        .filter(Boolean)
        .slice(0, MAX_TOPIC_IMAGES);
      base.coverUrl = normalizeCoverUrl(src.coverUrl) || normalizeImageUrl(src.coverUrl) || '';
      base.ownerScriptUrl = normalizeScriptUrl(src.ownerScriptUrl);
      base.ownerFolderId = normalizeFolderId(src.ownerFolderId);
      base.driveFolderId = normalizeFolderId(src.driveFolderId);
      base.fileIds = extractTopicDriveFileIds({
        coverUrl: base.coverUrl,
        items: base.items,
        fileIds: src.fileIds,
      });
      base.updatedAt = Number(src.updatedAt) || Date.now();
      return base;
    }).filter(Boolean);
    localStorage.setItem(TOPICS_KEY, JSON.stringify(cleanList));
  } catch (err) {
    console.warn('Không lưu được cache localStorage:', err);
  }
}

/**
 * Lưu thay đổi vào localStorage cache và ghi trực tiếp lên nhánh `shared_topics` (Firebase).
 * Chặn tuyệt đối mọi thao tác ghi đè nếu trình duyệt không khớp quyền sở hữu (`canEditTopic`).
 * @param {object|'all'|null} target - Chủ đề cần đẩy lên Cloud, hoặc 'all' để đồng bộ toàn bộ.
 */
function persist(target = cur()) {
  const identity = getCurrentDriveIdentity();
  if (target === 'all') {
    const editable = topics.filter((t) => canEditTopic(t));
    if (!editable.length) {
      toast(EDIT_DENIED_MSG, true);
      return false;
    }
    editable.forEach((t) => stampOwnership(t));
    persistLocalCache();
    updateCloudCountBadge();
    if (cloudSync && cloudSync.mode === 'firebase') {
      cloudSync.putMany(editable, identity);
    }
    return true;
  }

  if (target && typeof target === 'object' && target.id) {
    if (!canEditTopic(target)) {
      if ($('drivePanel')) $('drivePanel').open = true;
      toast(EDIT_DENIED_MSG, true);
      return false;
    }
    stampOwnership(target);
    persistLocalCache();
    updateCloudCountBadge();
    if (cloudSync && cloudSync.mode === 'firebase') {
      target.updatedAt = Date.now();
      cloudSync.putTopic(target, identity);
    }
    return true;
  }

  persistLocalCache();
  updateCloudCountBadge();
  return true;
}

function updateCloudCountBadge() {
  const countEl = $('cloudTopicCountBadge');
  if (countEl) {
    countEl.textContent = `${topics.length} chủ đề dùng chung`;
  }
}

function renderCloudStatus(st) {
  const state = st?.state || 'syncing';
  let label = '⏳ Đang đồng bộ...';
  let ready = false;
  if (state === 'synced') {
    label = '☁️ Kho chủ đề dùng chung (Đã đồng bộ)';
    ready = true;
  } else if (state === 'syncing') {
    label = `⏳ ${st?.message || 'Đang đồng bộ...'}`;
  } else if (state === 'offline') {
    label = '⚠️ Mất kết nối Cloud (Lưu tạm trên máy)';
  } else if (state === 'local') {
    label = '💻 Chế độ cục bộ (Chưa cấu hình Firebase)';
  } else if (state === 'error') {
    label = `⚠️ ${st?.message || 'Lỗi đồng bộ Cloud'}`;
  }

  ['cloudSyncText', 'cloudTopLabel'].forEach((id) => {
    const el = $(id);
    if (el) el.textContent = label;
  });
  ['cloudSyncDot', 'cloudTopDot'].forEach((id) => {
    const dot = $(id);
    if (dot) dot.classList.toggle('ready', ready);
  });
  updateCloudCountBadge();
}

/**
 * Gộp danh sách chủ đề từ `shared_topics` trên Firebase với dữ liệu âm thanh lưu trong IndexedDB máy hiện tại,
 * và tự động di trú (Auto-Migration) các chủ đề cũ chỉ có ở localStorage lên Firebase trong lần đầu khởi tạo.
 */
async function handleCloudSnapshot(cloudList) {
  const localBefore = loadTopicsUpToLimit();
  const voiceCache = new Map();
  [...localBefore, ...topics].forEach((t) => {
    if (t && t.id && (t.victoryVoiceData || t.victoryVoiceName)) {
      voiceCache.set(t.id, {
        victoryVoiceData: t.victoryVoiceData || '',
        victoryVoiceName: t.victoryVoiceName || '',
      });
    }
  });

  const deletedIds = getDeletedTopicIds();
  const { kept: keptCloud, purgedIds: purgedCloudIds } = purgeEmptyAndDefaultTopics(cloudList || [], {
    keepIds: sessionDraftIds,
    deletedIds,
  });
  const cloudById = new Map(keptCloud.map((t) => [t.id, t]));
  const legacyToRemove = [];
  purgedCloudIds.forEach((pid) => {
    markTopicDeleted(pid);
    if (!cleanedLegacyCloudIds.has(pid)) {
      cleanedLegacyCloudIds.add(pid);
      legacyToRemove.push(pid);
    }
  });

  if (legacyToRemove.length && cloudSync && cloudSync.mode === 'firebase') {
    legacyToRemove.forEach((legacyId) => {
      cloudSync.removeTopic(legacyId).catch(() => {});
    });
  }

  // Auto-Migration & bảo toàn chủ đề mới tạo trên máy chưa kịp phản hồi từ Cloud
  const latestDeleted = getDeletedTopicIds();
  const localCandidates = [...topics, ...localBefore];
  const seenCandidateIds = new Set();
  const missingOnCloud = [];
  localCandidates.forEach((lt) => {
    if (!lt || typeof lt !== 'object' || !lt.id) return;
    const id = String(lt.id).trim();
    if (!id || seenCandidateIds.has(id)) return;
    seenCandidateIds.add(id);
    if (latestDeleted.has(id) && !sessionDraftIds.has(id)) return;
    if (isLegacyEmojiSampleTopic(lt)) return;
    if (!cloudById.has(id) && (!initialMigrationDone || sessionDraftIds.has(id))) {
      stampOwnership(lt);
      const clean = sanitizeCloudTopic(lt, MAX_TOPIC_IMAGES);
      if (clean) {
        cloudById.set(clean.id, clean);
        missingOnCloud.push(lt);
      }
    }
  });
  const wasFirstMigration = !initialMigrationDone;
  initialMigrationDone = true;
  if (missingOnCloud.length && cloudSync && cloudSync.mode === 'firebase') {
    const count = await cloudSync.putMany(missingOnCloud);
    if (wasFirstMigration && count > 0) {
      toast(`☁️ Đã tự động đồng bộ ${count} chủ đề từ máy lên Kho dùng chung.`);
    }
  }

  const { scriptUrl: curScriptUrl, folderId: curFolderId } = getCurrentDriveIdentity();
  const toBackfillOwner = [];

  const merged = [...cloudById.values()].map((ct) => {
    const sanitized = sanitizeTopic({ ...ct, shuffle: true, items: [] });
    if (!sanitized) return null;
    sanitized.icon = '';
    sanitized.shuffle = true;
    sanitized.items = (ct.items || []).map(sanitizeItem).filter(Boolean).slice(0, MAX_TOPIC_IMAGES);
    sanitized.coverUrl = normalizeCoverUrl(ct.coverUrl) || normalizeImageUrl(ct.coverUrl) || '';
    sanitized.ownerScriptUrl = normalizeScriptUrl(ct.ownerScriptUrl);
    sanitized.ownerFolderId = normalizeFolderId(ct.ownerFolderId);
    sanitized.driveFolderId = normalizeFolderId(ct.driveFolderId);
    sanitized.fileIds = extractTopicDriveFileIds({
      coverUrl: sanitized.coverUrl,
      items: sanitized.items,
      fileIds: ct.fileIds,
    });
    sanitized.updatedAt = ct.updatedAt || 0;

    // Tự động bổ sung ownerScriptUrl / ownerFolderId cho chủ đề cũ trên Cloud nếu máy hiện tại có cấu hình Drive hợp lệ
    if ((!sanitized.ownerScriptUrl || !sanitized.ownerFolderId) && curScriptUrl && curFolderId) {
      if (!sanitized.ownerScriptUrl) sanitized.ownerScriptUrl = curScriptUrl;
      if (!sanitized.ownerFolderId) sanitized.ownerFolderId = curFolderId;
      if (!ownerBackfilledIds.has(sanitized.id)) {
        ownerBackfilledIds.add(sanitized.id);
        toBackfillOwner.push(sanitized);
      }
    }

    const vc = voiceCache.get(sanitized.id);
    if (vc) {
      if (vc.victoryVoiceData) sanitized.victoryVoiceData = vc.victoryVoiceData;
      if (!sanitized.victoryVoiceName && vc.victoryVoiceName) sanitized.victoryVoiceName = vc.victoryVoiceName;
    }
    return sanitized;
  }).filter(Boolean);

  if (toBackfillOwner.length && cloudSync && cloudSync.mode === 'firebase') {
    cloudSync.putMany(toBackfillOwner, { scriptUrl: curScriptUrl, folderId: curFolderId }).catch(() => {});
  }

  topics = merged;
  if (!topics.some((t) => t.id === currentId)) {
    currentId = topics[0] ? topics[0].id : null;
  }
  persistLocalCache();
  updateCloudCountBadge();
  render();
}

async function initCloudSync() {
  renderCloudStatus({ state: 'syncing', message: 'Đang đồng bộ...' });
  cloudSync = await createSharedTopicsSync(loadFirebaseConfig());
  cloudSync.onStatus(renderCloudStatus);
  cloudSync.subscribe((cloudList) => {
    handleCloudSnapshot(cloudList);
  });
}

async function manualSyncCloud() {
  if (!cloudSync) return;
  if (cloudSync.mode !== 'firebase') {
    toast('Chưa kết nối Firebase — dữ liệu đang lưu cục bộ trên trình duyệt.', true);
    return;
  }
  try {
    renderCloudStatus({ state: 'syncing', message: 'Đang đồng bộ thủ công...' });
    const deletedIds = getDeletedTopicIds();
    const remoteList = await cloudSync.fetchAll();
    const remoteIds = new Set(remoteList.map((r) => r.id));
    const localUnsynced = topics.filter((t) => t && t.id && !deletedIds.has(t.id) && !isLegacyEmojiSampleTopic(t) && !remoteIds.has(t.id));
    localUnsynced.forEach((t) => stampOwnership(t));
    if (localUnsynced.length) {
      await cloudSync.putMany(localUnsynced);
    }
    if (cur() && !deletedIds.has(cur().id)) {
      stampOwnership(cur());
      await cloudSync.putTopic(cur());
    }
    const latest = await cloudSync.fetchAll();
    await handleCloudSnapshot(latest);
    toast(`☁️ Đã đồng bộ xong (${topics.length} chủ đề dùng chung).`);
  } catch (err) {
    toast(`Không đồng bộ được: ${err.message || err}`, true);
  }
}

function toast(msg, bad = false) {
  const el = $('toast');
  el.textContent = msg;
  el.style.borderColor = bad ? 'var(--red)' : 'var(--glass-border)';
  el.classList.remove('hidden');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.add('hidden'), 3500);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Danh sách chủ đề ----------
function renderTopics() {
  const list = $('topicList');
  if (!list) return;
  list.innerHTML = '';
  if (!topics.length) {
    list.innerHTML = '<div class="text-sm t-3 px-2 py-3">Chưa có chủ đề tự tạo.</div>';
    return;
  }
  const frag = document.createDocumentFragment();
  topics.forEach((t) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.dataset.topicId = t.id;
    el.className = `topic-item ${t.id === currentId ? 'active' : ''}`;
    el.innerHTML = `<span class="flex-1 truncate font-semibold">${esc(t.name)}</span><span class="text-xs t-3 font-semibold">${t.items.length}/${MAX_TOPIC_IMAGES}</span>`;
    frag.appendChild(el);
  });
  list.appendChild(frag);
}

function renderCoverEditor(t) {
  const imgEl = $('coverPreviewImg');
  const fallbackEl = $('coverPreviewFallback');
  const emojiEl = $('coverPreviewEmoji');
  const badgeEl = $('coverSourceBadge');
  const urlInp = $('tCoverUrl');
  const clearBtn = $('btnClearCoverUrl');

  const explicitCover = t && typeof t.coverUrl === 'string' ? t.coverUrl.trim() : '';
  const thumbUrl = getTopicCoverThumb(t);

  if (emojiEl) emojiEl.textContent = (t && t.icon) || '🖼️';
  if (urlInp && document.activeElement !== urlInp) {
    urlInp.value = explicitCover;
  }
  if (clearBtn) {
    clearBtn.classList.toggle('hidden', !explicitCover);
  }
  if (badgeEl) {
    if (explicitCover) {
      badgeEl.textContent = '⭐ Ảnh bìa riêng';
    } else if (thumbUrl) {
      badgeEl.textContent = 'Tự động (Ảnh #1)';
    } else {
      badgeEl.textContent = 'Chưa có ảnh';
    }
  }

  if (imgEl && fallbackEl) {
    if (thumbUrl) {
      imgEl.classList.remove('hidden');
      fallbackEl.classList.add('hidden');
      if (imgEl.dataset.src !== thumbUrl) {
        imgEl.dataset.src = thumbUrl;
        imgEl.removeAttribute('crossorigin');
        imgEl.onload = () => {
          imgEl.classList.remove('hidden');
          fallbackEl.classList.add('hidden');
        };
        imgEl.onerror = () => {
          const fb = driveFallbackUrl(thumbUrl);
          if (fb && imgEl.src !== fb) {
            imgEl.src = fb;
            return;
          }
          imgEl.classList.add('hidden');
          fallbackEl.classList.remove('hidden');
        };
        imgEl.src = thumbUrl;
      }
    } else {
      imgEl.dataset.src = '';
      imgEl.removeAttribute('src');
      imgEl.classList.add('hidden');
      fallbackEl.classList.remove('hidden');
    }
  }
}

function render() {
  renderTopics();
  updateCloudCountBadge();
  const t = cur();
  if ($('emptyState')) $('emptyState').classList.toggle('hidden', !!t);
  if ($('editorBody')) $('editorBody').classList.toggle('hidden', !t);
  if (!t) return;
  t.shuffle = true;
  const editable = canEditTopic(t);

  if ($('topicReadOnlyNotice')) {
    $('topicReadOnlyNotice').classList.toggle('hidden', editable);
  }
  if ($('tName')) {
    if (document.activeElement !== $('tName')) $('tName').value = t.name;
    $('tName').readOnly = !editable;
    $('tName').disabled = !editable;
  }
  if ($('tIcon') && document.activeElement !== $('tIcon')) $('tIcon').value = '';
  renderCoverEditor(t);
  if ($('countNow')) $('countNow').textContent = t.items.length;
  if ($('countMax')) $('countMax').textContent = MAX_TOPIC_IMAGES;

  if ($('tCoverUrl')) {
    $('tCoverUrl').readOnly = !editable;
    $('tCoverUrl').disabled = !editable;
  }
  ['btnApplyCoverUrl', 'btnPickCoverFile', 'btnClearItems', 'btnDeleteTopic'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.disabled = !editable;
    el.classList.toggle('hidden', !editable);
  });
  if ($('btnClearCoverUrl') && !editable) {
    $('btnClearCoverUrl').classList.add('hidden');
  }
  if ($('addImagesSection')) {
    $('addImagesSection').classList.toggle('hidden', !editable);
  }
  if ($('btnPick')) $('btnPick').disabled = !editable;

  renderItems();
}

// ---------- Bảng ảnh (Event Delegation chống rò rỉ bộ nhớ) ----------
let dragIndex = null;

function renderItems() {
  const t = cur();
  const box = $('itemList');
  box.innerHTML = '';
  if (!t.items.length) {
    box.innerHTML = '<div class="t-3 text-center py-10" style="grid-column:1/-1">Chưa có ảnh nào. Hãy tải ảnh trực tiếp từ máy lên Google Drive.</div>';
    return;
  }
  const editable = canEditTopic(t);
  const explicitCoverNorm = t.coverUrl ? (normalizeImageUrl(t.coverUrl) || t.coverUrl.trim()) : '';
  let firstImgIndex = -1;
  for (let idx = 0; idx < t.items.length; idx++) {
    if (t.items[idx] && t.items[idx].type === 'img' && t.items[idx].src) {
      firstImgIndex = idx;
      break;
    }
  }
  const frag = document.createDocumentFragment();
  t.items.forEach((it, i) => {
    if (it.type === 'img' && it.src) {
      it.src = normalizeImageUrl(it.src) || it.src;
    }
    const itemNorm = it.type === 'img' && it.src ? (normalizeImageUrl(it.src) || it.src.trim()) : '';
    const isExplicitCover = Boolean(explicitCoverNorm && itemNorm && explicitCoverNorm === itemNorm);
    const isAutoCover = Boolean(!explicitCoverNorm && i === firstImgIndex && itemNorm);
    const card = document.createElement('div');
    card.className = `photo-card${isExplicitCover ? ' is-cover-card' : ''}`;
    card.draggable = editable;
    card.dataset.idx = String(i);
    const thumbSrc = it.type === 'img' && it.src ? (toThumbUrl400(it.src) || it.src) : '';
    const art = it.type === 'emoji'
      ? `<div class="photo-emoji">${esc(it.emoji)}</div>`
      : `<img loading="lazy" decoding="async" referrerpolicy="no-referrer" src="${esc(thumbSrc)}" alt="">`;
    const coverBtnHtml = editable && it.type === 'img' && it.src
      ? `<button type="button" data-a="cover" class="photo-cover-btn${isExplicitCover ? ' is-active' : isAutoCover ? ' is-auto' : ''}" title="${isExplicitCover ? 'Đang là ảnh bìa chủ đề' : 'Đặt ảnh này làm ảnh bìa chủ đề'}">${isExplicitCover ? '⭐ Ảnh bìa' : isAutoCover ? '⭐ Ảnh bìa (#1)' : '☆ Ảnh bìa'}</button>`
      : '';
    const actionsHtml = editable
      ? `<div class="photo-actions">
          <button type="button" data-a="up" title="Lên trước" ${i === 0 ? 'disabled' : ''}>‹</button>
          <button type="button" data-a="down" title="Xuống sau" ${i === t.items.length - 1 ? 'disabled' : ''}>›</button>
          <button type="button" data-a="del" class="danger" title="Xóa ảnh">✕</button>
        </div>`
      : '';
    const roAttrs = editable ? '' : 'readonly disabled';
    card.innerHTML = `
      <div class="photo-frame" title="${editable ? 'Kéo để đổi thứ tự' : 'Chỉ xem'}">
        ${art}
        <span class="photo-num">${i + 1}</span>
        ${coverBtnHtml}
        ${actionsHtml}
      </div>
      <input class="photo-input" data-f="answer" value="${esc(it.answer)}" maxlength="120" placeholder="Đáp án chuẩn" ${roAttrs} />
      <input class="photo-input sub" data-f="aliases" value="${esc((it.aliases || []).join(', '))}" placeholder="Đáp án phụ (cách nhau bằng dấu phẩy)" ${roAttrs} />`;

    const img = card.querySelector('img');
    if (img) {
      img.removeAttribute('crossorigin');
      let retried = false;
      img.addEventListener('error', () => {
        console.error('Lỗi tải ảnh:', img.src);
        if (!retried && it.src) {
          retried = true;
          const fallback = driveFallbackUrl(it.src);
          img.src = fallback && img.src !== fallback
            ? fallback
            : `${it.src}${it.src.includes('?') ? '&' : '?'}retry=1`;
          return;
        }
        img.replaceWith(Object.assign(document.createElement('div'), {
          className: 'photo-emoji', textContent: '⚠️', title: 'Ảnh lỗi / không tải được — hãy xóa hoặc thay link',
        }));
      });
    }
    frag.appendChild(card);
  });
  box.appendChild(frag);
}

function move(from, to) {
  const t = cur();
  if (!t || !canEditTopic(t)) {
    toast(EDIT_DENIED_MSG, true);
    return;
  }
  if (from === to || to < 0 || to >= t.items.length) return;
  const [it] = t.items.splice(from, 1);
  t.items.splice(to, 0, it);
  persist(t);
  render();
}

function cleanName(filename) {
  const base = filename.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return /^(img|image|dsc|photo|screenshot)[\s\d]*$/i.test(base) ? '' : base.slice(0, 120);
}

// ---------- Tải ảnh lên Google Drive ----------
function readBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const raw = String(r.result || '');
      const commaIdx = raw.indexOf(',');
      const b64 = (commaIdx >= 0 ? raw.slice(commaIdx + 1) : raw).replace(/[^A-Za-z0-9+/=]/g, '');
      if (!b64) {
        reject(new Error('Dữ liệu Base64 rỗng hoặc không hợp lệ.'));
        return;
      }
      resolve(b64);
    };
    r.onerror = () => reject(new Error('Không đọc được file.'));
    r.readAsDataURL(blob);
  });
}

function loadBitmapOrImage(file) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file).catch(() => loadHtmlImage(file));
  }
  return loadHtmlImage(file);
}

function loadHtmlImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Không giải mã được ảnh.'));
    };
    img.src = url;
  });
}

function dataUrlToBlob(dataUrl) {
  const [meta, rawB64] = String(dataUrl || '').split(',');
  const b64 = (rawB64 || '').replace(/[^A-Za-z0-9+/=]/g, '');
  if (!b64) return null;
  const mimeMatch = /data:([^;]+)/i.exec(meta || '');
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function canvasExportBlob(canvas, mime, quality) {
  return new Promise((resolve) => {
    try {
      if (typeof canvas.toBlob === 'function') {
        canvas.toBlob((blob) => {
          if (blob && blob.size > 0) {
            resolve(blob);
            return;
          }
          try {
            resolve(dataUrlToBlob(canvas.toDataURL(mime, quality)));
          } catch {
            resolve(null);
          }
        }, mime, quality);
      } else {
        resolve(dataUrlToBlob(canvas.toDataURL(mime, quality)));
      }
    } catch {
      resolve(null);
    }
  });
}

/** Thu nhỏ ảnh (cạnh dài tối đa 1280px) và nén sang WebP (chất lượng 0.82, tự động fallback JPEG 0.82) trước khi gửi lên Drive. GIF/SVG giữ nguyên. */
async function prepareImage(file) {
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return { blob: file, name: file.name };
  try {
    const bmp = await loadBitmapOrImage(file);
    const srcW = bmp.width || bmp.naturalWidth || 1;
    const srcH = bmp.height || bmp.naturalHeight || 1;
    const scale = Math.min(1, 1280 / Math.max(srcW, srcH));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(srcW * scale));
    canvas.height = Math.max(1, Math.round(srcH * scale));
    const g = canvas.getContext('2d');
    g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    if (typeof bmp.close === 'function') bmp.close();

    // Ưu tiên xuất định dạng image/webp chất lượng 0.82
    let blob = await canvasExportBlob(canvas, 'image/webp', 0.82);
    let ext = '.webp';
    if (!blob || blob.type !== 'image/webp' || blob.size <= 0) {
      // Fallback an toàn sang image/jpeg chất lượng 0.82 (vẽ nền trắng cho ảnh trong suốt)
      g.globalCompositeOperation = 'destination-over';
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, canvas.width, canvas.height);
      blob = await canvasExportBlob(canvas, 'image/jpeg', 0.82);
      ext = '.jpg';
    }
    canvas.width = 0;
    canvas.height = 0;
    if (!blob || blob.size <= 0) throw new Error('toBlob');
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';
    return { blob, name: `${baseName}${ext}` };
  } catch {
    return { blob: file, name: file.name };
  }
}

async function uploadToDrive(cfg, blob, name) {
  const data = await readBase64(blob);
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // tránh preflight CORS với Apps Script
    body: JSON.stringify({ folderId: cfg.folderId, name, mime: blob.type || 'image/webp', data }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Apps Script từ chối yêu cầu.');
  return json.id;
}

async function handleFiles(fileList) {
  const t = cur();
  if (!t || uploading) return;
  if (!canEditTopic(t)) {
    if ($('drivePanel')) $('drivePanel').open = true;
    toast(EDIT_DENIED_MSG, true);
    return;
  }
  let files = [...fileList].filter((f) => f.type.startsWith('image/'));
  if (!files.length) {
    toast('Không có file ảnh hợp lệ.', true);
    return;
  }
  const cfg = loadDrive();
  if (!cfg.url || !cfg.folderId) {
    if ($('drivePanel')) $('drivePanel').open = true;
    toast('Hãy nhập Web App URL và Folder ID Google Drive trước khi tải ảnh.', true);
    return;
  }
  const roomLeft = MAX_TOPIC_IMAGES - t.items.length;
  if (roomLeft <= 0) {
    toast(`Chủ đề đã đủ ${MAX_TOPIC_IMAGES} ảnh.`, true);
    return;
  }
  if (files.length > roomLeft) {
    toast(`Chỉ còn chỗ cho ${roomLeft} ảnh — các ảnh dư sẽ bị bỏ qua.`, true);
    files = files.slice(0, roomLeft);
  }

  uploading = true;
  $('progressWrap').classList.remove('hidden');
  const total = files.length;
  let ok = 0;
  const failed = [];
  for (let i = 0; i < total; i++) {
    const f = files[i];
    $('progressText').textContent = `Đang tải ảnh ${i + 1}/${total}: ${f.name}`;
    $('progressBar').style.width = `${(i / total) * 100}%`;
    try {
      const { blob, name } = await prepareImage(f);
      let id;
      try {
        id = await uploadToDrive(cfg, blob, name);
      } catch {
        id = await uploadToDrive(cfg, blob, name); // thử lại 1 lần
      }
      t.items.push({
        type: 'img',
        src: normalizeImageUrl(`https://lh3.googleusercontent.com/d/${id}=w1280`),
        answer: cleanName(f.name) || `Ảnh ${t.items.length + 1}`,
        aliases: [],
      });
      ok += 1;
      if ($('countNow')) $('countNow').textContent = t.items.length;
    } catch (err) {
      failed.push(`${f.name} (${err.message})`);
    }
  }
  if (ok > 0) {
    persist(t);
    render();
  }
  $('progressBar').style.width = '100%';
  $('progressText').textContent = `Hoàn tất: ${ok}/${total} ảnh đã tải lên${failed.length ? `, ${failed.length} lỗi` : ''}.`;
  uploading = false;
  if (failed.length) toast(`Lỗi: ${failed.slice(0, 3).join('; ')}${failed.length > 3 ? '…' : ''}`, true);
  else toast(`Đã tải lên ${ok} ảnh & đồng bộ lên Kho chủ đề dùng chung.`);
  setTimeout(() => { if (!uploading) $('progressWrap').classList.add('hidden'); }, 6000);
}

// ---------- Cấu hình Drive ----------
async function testDrive() {
  const url = $('driveUrl').value.trim();
  const folderId = $('driveFolder').value.trim();
  const st = $('driveStatus');
  if (!url) {
    st.textContent = 'Nhập Web App URL trước.';
    return;
  }
  st.textContent = 'Đang kiểm tra…';
  try {
    const u = new URL(url);
    if (folderId) u.searchParams.set('folderId', folderId);
    const res = await fetch(u.toString());
    const json = await res.json();
    st.textContent = json.ok
      ? json.folderName ? `✅ Kết nối OK. Thư mục: “${json.folderName}”.` : '✅ Web App hoạt động (chưa kiểm tra thư mục — nhập Folder ID).'
      : `❌ ${json.error}`;
  } catch (e) {
    st.textContent = `❌ Không kết nối được: ${e.message}. Kiểm tra URL /exec và quyền truy cập “Bất kỳ ai”.`;
  }
}

function saveDriveCfg() {
  const url = normalizeScriptUrl($('driveUrl').value);
  const folderId = normalizeFolderId($('driveFolder').value);
  if (url && !SCRIPT_URL_RE.test(url)) {
    toast('URL phải bắt đầu bằng https://script.google.com/macros/s/…/exec', true);
    return;
  }
  $('driveUrl').value = url;
  $('driveFolder').value = folderId;
  saveDrive({ url, folderId });
  // Nếu có chủ đề cũ chưa gắn thông tin chủ sở hữu, tự động bổ sung ngay khi người dùng lưu cấu hình Drive hợp lệ
  if (url && folderId) {
    const backfilled = [];
    topics.forEach((t) => {
      if (t && (!t.ownerScriptUrl || !t.ownerFolderId)) {
        stampOwnership(t);
        backfilled.push(t);
      }
    });
    if (backfilled.length) {
      persistLocalCache();
      if (cloudSync && cloudSync.mode === 'firebase') {
        cloudSync.putMany(backfilled, { scriptUrl: url, folderId }).catch(() => {});
      }
    }
  }
  render();
  renderThemeStudio();
  if (url && folderId) {
    loadThemesFromDrive();
  }
  if (bgm) bgm.refreshDriveIdentity();
  toast('Đã lưu cấu hình Google Drive.');
}

// ---------- Thư viện Theme (Google Drive thefloor_themes.json + Firebase shared_themes) ----------
let themeLibrary = readThemeLibraryCache();
let selectedThemeId = themeLibrary.activeThemeId || 'builtin_christmas';
let themeLibrarySync = null;
let driveThemesLoadedForKey = '';
let activeColorKey = null;

const COLOR_STYLE_KEYS = ['cardStyle', 'borderStyle', 'textStyle', 'titleStyle', 'accentStyle'];
const COLOR_STYLE_LABELS = {
  cardStyle: 'Nền thẻ',
  borderStyle: 'Viền khung',
  textStyle: 'Chữ nội dung',
  titleStyle: 'Chữ “The Floor” Trang 1',
  accentStyle: 'Nút nổi bật',
};

function syncThemeStudioToggleUi() {
  const panel = $('themeStudioPanel');
  const btn = $('btnOpenThemeStudio');
  if (!panel || !btn) return;
  const isOpen = Boolean(panel.open);
  btn.classList.toggle('is-open', isOpen);
  btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

function getSelectedTheme() {
  if (!themeLibrary || !themeLibrary.themes) themeLibrary = readThemeLibraryCache();
  if (!themeLibrary.themes[selectedThemeId]) {
    selectedThemeId = themeLibrary.activeThemeId && themeLibrary.themes[themeLibrary.activeThemeId]
      ? themeLibrary.activeThemeId
      : 'builtin_christmas';
  }
  return themeLibrary.themes[selectedThemeId] || themeLibrary.themes.builtin_christmas;
}

function canEditSelectedTheme(theme = getSelectedTheme()) {
  if (!hasValidDriveIdentity()) return false;
  return canIdentityModifyThemeProfile(theme, getCurrentDriveIdentity());
}

function setThemeDriveStatus(text, isError = false) {
  const el = $('themeDriveStatus');
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? 'var(--red)' : '';
}

function collectUnusedDriveFileIds(candidateIds, excludeThemeId = '') {
  const stillUsed = new Set();
  Object.values(themeLibrary.themes || {}).forEach((th) => {
    if (!th || th.id === excludeThemeId) return;
    extractThemeDriveFileIds(th).forEach((fid) => stillUsed.add(fid));
  });
  return [...new Set((candidateIds || []).filter((fid) => fid && !stillUsed.has(fid)))];
}

async function trashDriveFilesSafe(fileIds) {
  if (!Array.isArray(fileIds) || !fileIds.length) return;
  const { scriptUrl, folderId } = getCurrentDriveIdentity();
  if (!scriptUrl || !folderId || !SCRIPT_URL_RE.test(scriptUrl)) return;
  try {
    await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'deleteTopicFolder', folderId, fileIds }),
    });
  } catch (err) {
    console.warn('Không xóa được file thừa của theme trên Drive:', err);
  }
}

async function parseAppsScriptJson(res, actionName) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 80);
    throw new Error(`Phản hồi không phải JSON khi gọi ${actionName}${snippet ? ` (${snippet})` : ''}`);
  }
}

function formatDriveThemeError(prefix, err) {
  const raw = (err && err.message) ? String(err.message).trim() : String(err || 'Lỗi không xác định');
  const needsUpgrade = /chưa hỗ trợ|base64|invalid argument|không phải json|từ chối|unexpected token|405/i.test(raw);
  const shortMsg = raw.length > 72 ? `${raw.slice(0, 72)}…` : raw;
  return needsUpgrade
    ? `${prefix}: ${shortMsg} — Dán Code.gs mới & Triển khai phiên bản mới`
    : `${prefix}: ${shortMsg}`;
}

async function saveThemesToDrive(lib) {
  const { scriptUrl, folderId } = getCurrentDriveIdentity();
  if (!scriptUrl || !folderId || !SCRIPT_URL_RE.test(scriptUrl)) {
    setThemeDriveStatus('Drive: Chưa cấu hình');
    return false;
  }
  setThemeDriveStatus('Đang lưu lên Drive…');
  try {
    const res = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'saveThemes',
        folderId,
        data: JSON.stringify(sanitizeThemeLibrary(lib), null, 2),
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await parseAppsScriptJson(res, 'saveThemes');
    if (!json || json.ok === false) {
      throw new Error((json && json.error) || 'Apps Script từ chối saveThemes');
    }
    if (json.saved !== true) {
      throw new Error('Apps Script bản cũ chưa hỗ trợ saveThemes');
    }
    setThemeDriveStatus('Đã lưu vào Drive ✓');
    return true;
  } catch (err) {
    setThemeDriveStatus(formatDriveThemeError('Lỗi lưu Drive', err), true);
    console.warn('saveThemesToDrive lỗi:', err);
    return false;
  }
}

async function loadThemesFromDrive() {
  const { scriptUrl, folderId } = getCurrentDriveIdentity();
  if (!scriptUrl || !folderId || !SCRIPT_URL_RE.test(scriptUrl)) {
    setThemeDriveStatus('Drive: Chưa cấu hình');
    return false;
  }
  const key = `${scriptUrl}|${folderId}`;
  setThemeDriveStatus('Đang đọc từ Drive…');
  try {
    let json = null;
    let getErr = null;

    // Ưu tiên GET (?folderId=...&action=loadThemes) để phản hồi nhanh qua Apps Script
    try {
      const sep = scriptUrl.includes('?') ? '&' : '?';
      const getUrl = `${scriptUrl}${sep}folderId=${encodeURIComponent(folderId)}&action=loadThemes`;
      const resGet = await fetch(getUrl, { method: 'GET' });
      if (!resGet.ok) throw new Error(`HTTP ${resGet.status}`);
      const parsedGet = await parseAppsScriptJson(resGet, 'loadThemes (GET)');
      if (!parsedGet || parsedGet.ok === false) {
        throw new Error((parsedGet && parsedGet.error) || 'Apps Script lỗi loadThemes');
      }
      if ('found' in parsedGet) {
        json = parsedGet;
      } else {
        getErr = new Error('Apps Script bản cũ chưa hỗ trợ action loadThemes');
      }
    } catch (err) {
      getErr = err;
    }

    // Tự động fallback sang POST nếu GET chưa được hỗ trợ hoặc bị lỗi
    if (!json) {
      const resPost = await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'loadThemes', folderId }),
      });
      if (!resPost.ok) throw new Error(`HTTP ${resPost.status}`);
      const parsedPost = await parseAppsScriptJson(resPost, 'loadThemes (POST)');
      if (!parsedPost || parsedPost.ok === false) {
        throw new Error((parsedPost && parsedPost.error) || (getErr && getErr.message) || 'Apps Script lỗi loadThemes');
      }
      if (!('found' in parsedPost)) {
        throw new Error('Apps Script bản cũ chưa hỗ trợ loadThemes');
      }
      json = parsedPost;
    }

    driveThemesLoadedForKey = key;
    if (json.found && json.data) {
      const parsed = typeof json.data === 'string' ? JSON.parse(json.data) : json.data;
      const merged = mergeThemeLibraries(themeLibrary, parsed);
      themeLibrary = writeThemeLibraryCache(merged);
      applyThemeLibrary(themeLibrary);
      if (themeLibrarySync) {
        themeLibrarySync.putLibrary(themeLibrary).catch(() => {});
      }
      renderThemeStudio();
      setThemeDriveStatus('Đã nạp từ Drive ✓');
      return true;
    }
    setThemeDriveStatus('Drive sẵn sàng (chưa có file)');
    return false;
  } catch (err) {
    setThemeDriveStatus(formatDriveThemeError('Chưa đồng bộ Drive', err), true);
    console.warn('loadThemesFromDrive lỗi:', err);
    return false;
  }
}

async function persistThemeLibrary(nextLib, { switchActive = false, msg = '', syncDrive = true } = {}) {
  const clean = sanitizeThemeLibrary(nextLib);
  clean.updatedAt = Date.now();
  themeLibrary = writeThemeLibraryCache(clean);
  applyThemeLibrary(themeLibrary, { switchActiveTheme: switchActive });
  renderThemeStudio();

  if (themeLibrarySync) {
    await themeLibrarySync.putLibrary(themeLibrary);
  }
  if (syncDrive && hasValidDriveIdentity()) {
    await saveThemesToDrive(themeLibrary);
  }
  if (msg) toast(msg);
  return true;
}

function renderBgThumbPreview(boxId, url, emptyText) {
  const box = $(boxId);
  if (!box) return;
  const clean = (url || '').trim();
  if (clean) {
    box.style.backgroundImage = `url("${clean}")`;
    box.classList.add('has-img');
    box.innerHTML = '';
  } else {
    box.style.backgroundImage = 'none';
    box.classList.remove('has-img');
    box.innerHTML = `<span class="ts-bg-empty">${esc(emptyText)}</span>`;
  }
}

function renderColorControls(theme, editable) {
  const def = BUILTIN_THEMES[theme.id]
    || THEME_PRESET_DEFAULTS[theme.basePreset]
    || THEME_PRESET_DEFAULTS.default;

  COLOR_STYLE_KEYS.forEach((key) => {
    const st = sanitizeColorStyle(theme[key], def[key]);
    const chip = $(`swatchPreview_${key}`);
    const sub = $(`swatchSub_${key}`);
    const card = document.querySelector(`#tsColorCards [data-color-key="${key}"]`);
    if (chip) chip.style.background = colorStyleToCss(st, def[key].c1);
    if (sub) {
      sub.textContent = st.mode === 'gradient'
        ? `Gradient ${st.angle}°`
        : st.c1;
    }
    if (card) {
      card.classList.toggle('is-active', activeColorKey === key);
      card.disabled = !editable;
    }
  });

  const insp = $('tsColorInspector');
  if (!insp) return;
  if (!activeColorKey || !COLOR_STYLE_KEYS.includes(activeColorKey)) {
    insp.classList.add('hidden');
    return;
  }
  insp.classList.remove('hidden');

  const curStyle = sanitizeColorStyle(theme[activeColorKey], def[activeColorKey]);
  const isGrad = curStyle.mode === 'gradient';
  if ($('tsCiTargetTitle')) {
    $('tsCiTargetTitle').textContent = `Đang chỉnh: ${COLOR_STYLE_LABELS[activeColorKey] || activeColorKey}`;
  }
  document.querySelectorAll('#tsCiModeSeg [data-color-mode]').forEach((b) => {
    b.classList.toggle('active', b.dataset.colorMode === curStyle.mode);
    b.disabled = !editable;
  });
  if ($('tsSolidPane')) $('tsSolidPane').classList.toggle('hidden', isGrad);
  if ($('tsGradPane')) $('tsGradPane').classList.toggle('hidden', !isGrad);

  const setIfIdle = (id, val) => {
    const el = $(id);
    if (!el) return;
    if (document.activeElement !== el) el.value = val;
    el.disabled = !editable;
  };
  setIfIdle('tsSolidColor', curStyle.c1);
  setIfIdle('tsSolidHex', curStyle.c1);
  setIfIdle('tsGradC1', curStyle.c1);
  setIfIdle('tsGradHex1', curStyle.c1);
  setIfIdle('tsGradC2', curStyle.c2);
  setIfIdle('tsGradHex2', curStyle.c2);
  setIfIdle('tsGradAngleRange', String(curStyle.angle));
  if ($('tsGradAngleVal')) $('tsGradAngleVal').textContent = `${curStyle.angle}°`;
  if ($('tsGradPreviewBar')) {
    $('tsGradPreviewBar').style.background = `linear-gradient(${curStyle.angle}deg, ${curStyle.c1}, ${curStyle.c2})`;
  }
  if ($('btnTsGradSwap')) $('btnTsGradSwap').disabled = !editable;
  document.querySelectorAll('#tsQuickSwatches .ts-qswatch, .ts-angle-presets .ts-ang-btn').forEach((b) => {
    b.disabled = !editable;
  });
}

let colorLivePreviewRaf = null;

function updateActiveColorStyle(patch, commit = false) {
  if (!activeColorKey || !COLOR_STYLE_KEYS.includes(activeColorKey)) return;
  const curTheme = getSelectedTheme();
  if (!curTheme || !canEditSelectedTheme(curTheme)) return;
  const def = BUILTIN_THEMES[curTheme.id]
    || THEME_PRESET_DEFAULTS[curTheme.basePreset]
    || THEME_PRESET_DEFAULTS.default;
  const prev = sanitizeColorStyle(curTheme[activeColorKey], def[activeColorKey]);
  const nextStyle = sanitizeColorStyle({ ...prev, ...patch }, prev);
  curTheme[activeColorKey] = nextStyle;
  if (activeColorKey === 'cardStyle') curTheme.cardBg = nextStyle.c1;
  if (activeColorKey === 'borderStyle') curTheme.borderColor = nextStyle.c1;
  if (activeColorKey === 'accentStyle') curTheme.accentColor = nextStyle.c1;

  renderColorControls(curTheme, true);

  if (commit) {
    if (colorLivePreviewRaf !== null) {
      cancelAnimationFrame(colorLivePreviewRaf);
      colorLivePreviewRaf = null;
    }
    saveSelectedThemeEdits('🎨 Đã lưu bảng màu theme lên Drive & Cloud ✓');
  } else if (themeLibrary.activeThemeId === curTheme.id && colorLivePreviewRaf === null) {
    // Chỉ cập nhật biến CSS trên DOM trong 1 rAF (0 localStorage / 0 BroadcastChannel ở 120Hz)
    colorLivePreviewRaf = requestAnimationFrame(() => {
      colorLivePreviewRaf = null;
      previewThemeColorsLive(curTheme);
    });
  }
}

// ---------- List nhạc nền riêng theo từng Theme ----------
let themePreviewAudio = null;
let themePreviewTrackId = '';
let themePreviewType = '';

function setThemeBgmNotice(msg = '', isError = false) {
  const el = $('themeBgmNotice');
  if (!el) return;
  if (!msg) {
    el.textContent = '';
    el.classList.add('hidden');
    return;
  }
  el.textContent = msg;
  el.style.color = isError ? 'var(--red)' : '';
  el.classList.remove('hidden');
}

function syncThemeBgmPreviewRows() {
  const listEl = $('themeBgmList');
  if (!listEl) return;
  listEl.querySelectorAll('.ts-bgm-row').forEach((row) => {
    const isThis = Boolean(themePreviewTrackId) && row.dataset.thbgmId === themePreviewTrackId;
    row.classList.toggle('is-previewing', isThis);
    const btn = row.querySelector('[data-thbgm-act="play"]');
    if (btn) {
      btn.textContent = isThis ? '⏹' : '▶';
      btn.title = isThis ? 'Dừng nghe thử' : 'Nghe thử bài này';
    }
  });
}

function stopThemeBgmPreview() {
  if (themePreviewAudio) {
    try {
      themePreviewAudio.pause();
      themePreviewAudio.removeAttribute('src');
      themePreviewAudio.load();
    } catch { /* ignore */ }
    themePreviewAudio = null;
  }
  if (themePreviewType === 'youtube' && bgm && typeof bgm.pausePreview === 'function') {
    try { bgm.pausePreview(); } catch { /* ignore */ }
  }
  themePreviewTrackId = '';
  themePreviewType = '';
  syncThemeBgmPreviewRows();
}

function toggleThemeBgmPreview(track) {
  if (!track || !track.id) return;
  if (themePreviewTrackId === track.id) {
    stopThemeBgmPreview();
    setThemeBgmNotice('');
    return;
  }
  stopThemeBgmPreview();
  themePreviewTrackId = track.id;
  themePreviewType = track.type === 'youtube' ? 'youtube' : 'drive';

  if (themePreviewType === 'youtube') {
    if (bgm && typeof bgm.previewTrack === 'function') {
      bgm.previewTrack(track);
      syncThemeBgmPreviewRows();
      setThemeBgmNotice(`▶ Đang nghe thử YouTube: “${track.title}” (bấm ⏹ để dừng).`);
    } else {
      themePreviewTrackId = '';
      themePreviewType = '';
      setThemeBgmNotice('Trình phát YouTube chưa sẵn sàng.', true);
    }
    return;
  }

  const fid = extractDriveId(track.fileId || track.url || '');
  const primaryUrl = fid
    ? `https://drive.google.com/uc?export=open&id=${fid}`
    : String(track.url || '').trim();
  const fallbackUrl = fid
    ? `https://drive.google.com/uc?export=download&id=${fid}`
    : '';
  if (!primaryUrl) {
    themePreviewTrackId = '';
    themePreviewType = '';
    setThemeBgmNotice('Không tìm thấy liên kết âm thanh hợp lệ.', true);
    return;
  }

  const audio = new Audio();
  audio.preload = 'auto';
  audio.volume = 0.65;
  let triedFallback = false;
  audio.addEventListener('ended', () => {
    if (themePreviewAudio === audio) {
      stopThemeBgmPreview();
      setThemeBgmNotice('');
    }
  });
  audio.addEventListener('error', () => {
    if (themePreviewAudio !== audio) return;
    if (!triedFallback && fallbackUrl && audio.src !== fallbackUrl) {
      triedFallback = true;
      audio.src = fallbackUrl;
      audio.play().catch(() => {
        if (themePreviewAudio === audio) {
          stopThemeBgmPreview();
          setThemeBgmNotice(`❌ Không phát được “${track.title}” — kiểm tra quyền chia sẻ công khai trên Drive.`, true);
        }
      });
      return;
    }
    stopThemeBgmPreview();
    setThemeBgmNotice(`❌ Không phát được “${track.title}”.`, true);
  });

  themePreviewAudio = audio;
  audio.src = primaryUrl;
  syncThemeBgmPreviewRows();
  setThemeBgmNotice(`▶ Đang nghe thử: “${track.title}” (bấm ⏹ để dừng).`);
  audio.play().catch(() => {
    if (themePreviewAudio !== audio) return;
    if (!triedFallback && fallbackUrl) {
      triedFallback = true;
      audio.src = fallbackUrl;
      audio.play().catch(() => {
        if (themePreviewAudio === audio) {
          stopThemeBgmPreview();
          setThemeBgmNotice('❌ Trình duyệt chặn phát thử hoặc file Drive chưa chia sẻ công khai.', true);
        }
      });
    } else {
      stopThemeBgmPreview();
    }
  });
}

function resetThemeBgmInputs() {
  ['themeBgmDriveTitle', 'themeBgmYtUrl', 'themeBgmYtTitle'].forEach((id) => {
    const el = $(id);
    if (el) el.value = '';
  });
}

function selectTheme(themeId) {
  if (!themeId || !themeLibrary || !themeLibrary.themes || !themeLibrary.themes[themeId]) return;
  const changed = selectedThemeId !== themeId;
  selectedThemeId = themeId;
  if (changed) {
    stopThemeBgmPreview();
    setThemeBgmNotice('');
    resetThemeBgmInputs();
  }
  renderThemeStudio();
}

function renderThemeBgmList(theme, editable) {
  const curTheme = theme || getSelectedTheme();
  if (!curTheme) return;
  const bgmList = asArr(curTheme.bgmList)
    .map(sanitizeCloudBgm)
    .filter(Boolean)
    .map((tr) => ({ ...tr }))
    .slice(0, 20);

  const badge = $('themeBgmCountBadge');
  if (badge) {
    badge.textContent = bgmList.length
      ? `${bgmList.length} bài riêng`
      : '0 bài (dùng nhạc chung)';
  }
  if ($('themeBgmAddGrid')) {
    $('themeBgmAddGrid').classList.toggle('hidden', !editable);
  }
  [
    'themeBgmDriveTitle',
    'btnThemeBgmPickAudio',
    'themeBgmYtUrl',
    'themeBgmYtTitle',
    'btnThemeBgmAddYoutube',
  ].forEach((id) => {
    const el = $(id);
    if (el) el.disabled = !editable;
  });

  const listEl = $('themeBgmList');
  if (!listEl) return;
  // Luôn xóa trắng toàn bộ DOM danh sách bài hát cũ trước khi vẽ danh sách của Theme đang chọn
  listEl.innerHTML = '';
  listEl.dataset.renderedThemeId = curTheme.id || '';
  if (!bgmList.length) {
    listEl.innerHTML = '<div class="t-3 text-xs py-2">Theme này chưa có nhạc riêng (đang dùng nhạc mặc định chung).</div>';
    return;
  }

  const frag = document.createDocumentFragment();
  bgmList.forEach((tr) => {
    const isPlaying = themePreviewTrackId === tr.id;
    const row = document.createElement('div');
    row.className = `ts-bgm-row${isPlaying ? ' is-previewing' : ''}`;
    row.dataset.thbgmId = tr.id;
    row.dataset.thbgmThemeId = curTheme.id || '';
    row.innerHTML = `
      <button type="button" data-thbgm-act="play" class="bgm-row-play" title="${isPlaying ? 'Dừng nghe thử' : 'Nghe thử bài này'}">${isPlaying ? '⏹' : '▶'}</button>
      <div class="bgm-row-info min-w-0 flex-1">
        <div class="bgm-row-title truncate">${esc(tr.title)}</div>
        <div class="bgm-row-meta">
          <span class="bgm-type-pill">${tr.type === 'youtube' ? 'YouTube' : 'Drive Audio'}</span>
        </div>
      </div>
      ${editable
        ? '<button type="button" data-thbgm-act="delete" class="btn btn-pass btn-sm bgm-del-btn" title="Xóa bài này khỏi Theme">✕</button>'
        : '<span class="bgm-lock-tag" title="Cần đúng Drive Key để chỉnh sửa nhạc Theme">🔒</span>'}`;
    frag.appendChild(row);
  });
  listEl.appendChild(frag);
}

async function handleThemeBgmDriveUpload(file) {
  const curTheme = getSelectedTheme();
  if (!curTheme || !file || uploading) return;
  const targetThemeId = curTheme.id;
  if (!canEditSelectedTheme(curTheme)) {
    if ($('drivePanel')) $('drivePanel').open = true;
    setThemeBgmNotice('Vui lòng nhập đúng Apps Script Web App URL và Folder ID để tải nhạc cho Theme.', true);
    return;
  }
  const identity = getCurrentDriveIdentity();
  if (!hasValidDriveIdentity()) {
    if ($('drivePanel')) $('drivePanel').open = true;
    setThemeBgmNotice('Vui lòng nhập Apps Script Web App URL và Folder ID hợp lệ trước khi tải nhạc lên Drive.', true);
    return;
  }
  if (asArr(curTheme.bgmList).length >= 20) {
    setThemeBgmNotice('Mỗi Theme chỉ hỗ trợ tối đa 20 bài nhạc nền riêng.', true);
    return;
  }

  const pickBtn = $('btnThemeBgmPickAudio');
  const titleInp = $('themeBgmDriveTitle');
  const customTitle = titleInp ? titleInp.value.trim() : '';

  uploading = true;
  if (pickBtn) {
    pickBtn.disabled = true;
    pickBtn.textContent = '⏳ Đang tải nhạc lên Drive…';
  }
  setThemeBgmNotice(`Đang tải “${file.name}” lên Google Drive…`);
  try {
    const track = await uploadDriveAudioFile(identity, file, {
      prefix: `thbgm_${targetThemeId}`,
      customTitle,
    });
    // Luôn đọc lại đúng hồ sơ Theme đích theo targetThemeId để tránh lẫn sang Theme khác nếu người dùng chuyển tab trong lúc tải lên
    const latestTarget = (themeLibrary.themes && themeLibrary.themes[targetThemeId]) || curTheme;
    const nextBgmList = [
      ...asArr(latestTarget.bgmList).map(sanitizeCloudBgm).filter(Boolean).map((tr) => ({ ...tr })),
      { ...track },
    ].slice(0, 20);
    const updatedTarget = sanitizeThemeProfile({
      ...latestTarget,
      bgmList: nextBgmList,
      updatedAt: Date.now(),
    }, targetThemeId);
    if (titleInp && selectedThemeId === targetThemeId) titleInp.value = '';
    const nextLib = {
      ...themeLibrary,
      themes: { ...themeLibrary.themes, [targetThemeId]: updatedTarget },
    };
    await persistThemeLibrary(nextLib, {
      switchActive: themeLibrary.activeThemeId === targetThemeId,
      msg: `🎵 Đã thêm “${track.title}” vào nhạc nền của Theme “${updatedTarget.name}”.`,
    });
    if (selectedThemeId === targetThemeId) {
      setThemeBgmNotice(`✅ Đã thêm “${track.title}” & đồng bộ lên Drive + Cloud.`);
    }
  } catch (err) {
    setThemeBgmNotice(`❌ Lỗi tải nhạc: ${err && err.message ? err.message : err}`, true);
  } finally {
    uploading = false;
    if (pickBtn) {
      pickBtn.disabled = false;
      pickBtn.textContent = '⬆ Chọn file nhạc từ máy';
    }
  }
}

async function handleThemeBgmAddYoutube() {
  const curTheme = getSelectedTheme();
  if (!curTheme) return;
  const targetThemeId = curTheme.id;
  if (!canEditSelectedTheme(curTheme)) {
    if ($('drivePanel')) $('drivePanel').open = true;
    setThemeBgmNotice('Vui lòng nhập đúng Apps Script Web App URL và Folder ID để thêm nhạc cho Theme.', true);
    return;
  }
  if (asArr(curTheme.bgmList).length >= 20) {
    setThemeBgmNotice('Mỗi Theme chỉ hỗ trợ tối đa 20 bài nhạc nền riêng.', true);
    return;
  }
  const urlInp = $('themeBgmYtUrl');
  const titleInp = $('themeBgmYtTitle');
  const addBtn = $('btnThemeBgmAddYoutube');
  const rawUrl = urlInp ? urlInp.value.trim() : '';
  const ytId = extractYouTubeId(rawUrl);
  if (!ytId) {
    setThemeBgmNotice('Link YouTube không hợp lệ (hỗ trợ watch?v=, youtu.be/, shorts/).', true);
    return;
  }
  if (addBtn) {
    addBtn.disabled = true;
    addBtn.textContent = 'Đang thêm…';
  }
  try {
    let title = titleInp ? titleInp.value.trim() : '';
    if (!title) {
      title = (await fetchYouTubeTitle(ytId)) || `YouTube (${ytId})`;
    }
    const identity = getCurrentDriveIdentity();
    const track = sanitizeCloudBgm({
      id: `thbgm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      title,
      type: 'youtube',
      url: `https://www.youtube.com/watch?v=${ytId}`,
      fileId: '',
      youtubeId: ytId,
      ownerScriptUrl: identity.scriptUrl,
      ownerFolderId: identity.folderId,
      createdAt: Date.now(),
    });
    if (!track) throw new Error('Dữ liệu bài nhạc YouTube không hợp lệ.');
    const latestTarget = (themeLibrary.themes && themeLibrary.themes[targetThemeId]) || curTheme;
    const nextBgmList = [
      ...asArr(latestTarget.bgmList).map(sanitizeCloudBgm).filter(Boolean).map((tr) => ({ ...tr })),
      { ...track },
    ].slice(0, 20);
    const updatedTarget = sanitizeThemeProfile({
      ...latestTarget,
      bgmList: nextBgmList,
      updatedAt: Date.now(),
    }, targetThemeId);
    if (selectedThemeId === targetThemeId) {
      if (urlInp) urlInp.value = '';
      if (titleInp) titleInp.value = '';
    }
    const nextLib = {
      ...themeLibrary,
      themes: { ...themeLibrary.themes, [targetThemeId]: updatedTarget },
    };
    await persistThemeLibrary(nextLib, {
      switchActive: themeLibrary.activeThemeId === targetThemeId,
      msg: `🎵 Đã thêm “${track.title}” vào nhạc nền của Theme “${updatedTarget.name}”.`,
    });
    if (selectedThemeId === targetThemeId) {
      setThemeBgmNotice(`✅ Đã thêm “${track.title}” & đồng bộ lên Drive + Cloud.`);
    }
  } catch (err) {
    setThemeBgmNotice(`❌ ${err && err.message ? err.message : err}`, true);
  } finally {
    if (addBtn) {
      addBtn.disabled = false;
      addBtn.textContent = 'Thêm';
    }
  }
}

async function handleThemeBgmDelete(trackId) {
  const curTheme = getSelectedTheme();
  if (!curTheme || !trackId) return;
  const targetThemeId = curTheme.id;
  if (!canEditSelectedTheme(curTheme)) {
    if ($('drivePanel')) $('drivePanel').open = true;
    toast('Vui lòng nhập đúng Drive Key để xóa nhạc của Theme này.', true);
    return;
  }
  const list = asArr(curTheme.bgmList).map(sanitizeCloudBgm).filter(Boolean).map((tr) => ({ ...tr }));
  const removed = list.find((x) => x && x.id === trackId);
  if (!removed) return;
  if (themePreviewTrackId === trackId) {
    stopThemeBgmPreview();
  }
  const nextBgmList = list.filter((x) => x && x.id !== trackId);
  const updatedTarget = sanitizeThemeProfile({
    ...curTheme,
    bgmList: nextBgmList,
    updatedAt: Date.now(),
  }, targetThemeId);
  const nextLib = {
    ...themeLibrary,
    themes: { ...themeLibrary.themes, [targetThemeId]: updatedTarget },
  };
  await persistThemeLibrary(nextLib, {
    switchActive: themeLibrary.activeThemeId === targetThemeId,
    msg: `Đã xóa “${removed.title}” khỏi nhạc nền của “${updatedTarget.name}”.`,
  });
  if (selectedThemeId === targetThemeId) {
    setThemeBgmNotice(`Đã xóa “${removed.title}” khỏi Theme.`);
  }

  if (removed.type === 'drive' && removed.fileId && hasValidDriveIdentity()) {
    const fid = extractDriveId(removed.fileId);
    if (fid) {
      const unused = collectUnusedDriveFileIds([fid]);
      if (unused.length) {
        trashDriveFilesSafe(unused).catch(() => {});
      }
    }
  }
}

async function createNewTheme() {
  if (!hasValidDriveIdentity()) {
    if ($('drivePanel')) $('drivePanel').open = true;
    toast('Vui lòng nhập Drive Key hợp lệ.', true);
    return;
  }
  const name = ($('newThemeName') && $('newThemeName').value.trim()) || '';
  if (!name) {
    toast('Hãy nhập tên cho theme mới.', true);
    if ($('newThemeName')) $('newThemeName').focus();
    return;
  }
  const baseChoice = ($('newThemeBase') && $('newThemeBase').value) || 'blank';
  const identity = getCurrentDriveIdentity();
  const newThemeId = `theme_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  let seed = {
    ...BUILTIN_THEMES.builtin_default,
    id: newThemeId,
    name,
    isBuiltIn: false,
    bgmList: [],
  };
  if (baseChoice === 'christmas') {
    seed = { ...BUILTIN_THEMES.builtin_christmas, id: newThemeId, name, isBuiltIn: false, bgmList: [] };
  } else if (baseChoice === 'default') {
    seed = { ...BUILTIN_THEMES.builtin_default, id: newThemeId, name, isBuiltIn: false, bgmList: [] };
  }
  const cleanNew = sanitizeThemeProfile({
    ...seed,
    bgmList: [],
    ownerScriptUrl: identity.scriptUrl,
    ownerFolderId: identity.folderId,
    updatedAt: Date.now(),
  }, newThemeId);
  if ($('newThemeBox')) $('newThemeBox').classList.add('hidden');
  stopThemeBgmPreview();
  setThemeBgmNotice('');
  resetThemeBgmInputs();
  selectedThemeId = cleanNew.id;
  const nextLib = {
    ...themeLibrary,
    themes: { ...themeLibrary.themes, [cleanNew.id]: cleanNew },
  };
  await persistThemeLibrary(nextLib, {
    switchActive: false,
    msg: `🎨 Đã tạo theme mới “${cleanNew.name}” & lưu vào Drive.`,
  });
}

async function duplicateTheme() {
  if (!hasValidDriveIdentity()) {
    if ($('drivePanel')) $('drivePanel').open = true;
    toast('Vui lòng nhập Drive Key hợp lệ trước khi nhân bản theme.', true);
    return;
  }
  const src = getSelectedTheme();
  const identity = getCurrentDriveIdentity();
  const cloneId = `theme_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const clonedBgmList = asArr(src.bgmList)
    .map(sanitizeCloudBgm)
    .filter(Boolean)
    .map((track) => ({ ...track }))
    .slice(0, 20);
  const cloned = sanitizeThemeProfile({
    ...src,
    id: cloneId,
    name: `${src.name} (Bản sao)`.slice(0, 60),
    isBuiltIn: false,
    bgmList: clonedBgmList,
    ownerScriptUrl: identity.scriptUrl,
    ownerFolderId: identity.folderId,
    updatedAt: Date.now(),
  }, cloneId);
  stopThemeBgmPreview();
  setThemeBgmNotice('');
  resetThemeBgmInputs();
  selectedThemeId = cloned.id;
  const nextLib = {
    ...themeLibrary,
    themes: { ...themeLibrary.themes, [cloned.id]: cloned },
  };
  await persistThemeLibrary(nextLib, {
    switchActive: false,
    msg: `🎨 Đã nhân bản thành “${cloned.name}” & lưu vào Drive.`,
  });
}

function renderThemeStudio() {
  const hasDrive = hasValidDriveIdentity();
  const lockNotice = $('themeStudioLockNotice');
  if (lockNotice) lockNotice.classList.toggle('hidden', hasDrive);

  const theme = getSelectedTheme();
  const activeGlobal = themeLibrary.themes[themeLibrary.activeThemeId] || theme;
  const editable = canEditSelectedTheme(theme);
  const isActive = themeLibrary.activeThemeId === theme.id;

  if ($('themeSideActiveBadge')) {
    $('themeSideActiveBadge').textContent = (activeGlobal && activeGlobal.name) ? activeGlobal.name.slice(0, 14) : 'Noel';
  }
  syncThemeStudioToggleUi();

  // Render danh sách thẻ Theme đã lưu
  const libList = $('themeLibraryList');
  if (libList) {
    libList.innerHTML = '';
    const ordered = [
      ...['builtin_christmas', 'builtin_default']
        .map((id) => themeLibrary.themes[id])
        .filter(Boolean),
      ...Object.values(themeLibrary.themes)
        .filter((t) => t && !t.isBuiltIn)
        .sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0)),
    ];
    const frag = document.createDocumentFragment();
    ordered.forEach((th) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.themePickId = th.id;
      const activeTag = th.id === themeLibrary.activeThemeId;
      const editingTag = th.id === theme.id;
      btn.className = `theme-lib-pill${editingTag ? ' is-editing' : ''}${activeTag ? ' is-active-theme' : ''}`;
      const dotBg = th.cardStyle ? colorStyleToCss(th.cardStyle, th.accentColor || '#B91C2C') : (th.accentColor || '#B91C2C');
      const dotBorder = (th.borderStyle && th.borderStyle.c1) || th.borderColor || '#D8B979';
      btn.innerHTML = `
        <span class="theme-lib-dot" style="background:${esc(dotBg)};border-color:${esc(dotBorder)}"></span>
        <span class="theme-lib-name">${esc(th.name)}</span>
        ${activeTag ? '<span class="theme-lib-live">Đang dùng</span>' : ''}`;
      frag.appendChild(btn);
    });
    libList.appendChild(frag);
  }

  if ($('themeEditBadge')) {
    $('themeEditBadge').textContent = isActive
      ? '✓ Đang áp dụng'
      : (theme.isBuiltIn ? 'Theme gốc' : 'Tự tạo');
  }

  const setValIfNotFocused = (id, val) => {
    const el = $(id);
    if (el && document.activeElement !== el) el.value = val ?? '';
  };
  setValIfNotFocused('themeNameInput', theme.name || '');
  setValIfNotFocused('themeBg1Url', theme.bg1Url || '');
  setValIfNotFocused('themeBg2Url', theme.bg2Url || '');
  setValIfNotFocused('themeBg3Url', theme.bg3Url || '');
  setValIfNotFocused('themeBgMobileUrl', theme.bgMobileUrl || '');
  const effVal = theme.effect === 'snow' || theme.effect === 'emoji' ? theme.effect : 'none';
  setValIfNotFocused('themeEffect', effVal);
  setValIfNotFocused('themeEffectEmojis', theme.effectEmojis || '❄️ 🎄 ⭐');
  if ($('themeEmojiBox')) {
    $('themeEmojiBox').classList.toggle('hidden', effVal !== 'emoji');
  }

  renderBgThumbPreview('bgPreview1', theme.bg1Url, 'Chưa có ảnh nền Trang 1');
  renderBgThumbPreview('bgPreview2', theme.bg2Url, 'Chưa có ảnh nền Trang 2');
  renderBgThumbPreview('bgPreview3', theme.bg3Url, 'Chưa có ảnh nền Trang 3');
  renderBgThumbPreview('bgPreviewMobile', theme.bgMobileUrl, 'Chưa có ảnh nền dọc');

  renderColorControls(theme, editable);

  if ($('btnResetThemePreset')) {
    $('btnResetThemePreset').classList.toggle('hidden', !theme.isBuiltIn);
    $('btnResetThemePreset').disabled = !editable;
  }
  if ($('btnDeleteTheme')) {
    $('btnDeleteTheme').classList.toggle('hidden', Boolean(theme.isBuiltIn));
    $('btnDeleteTheme').disabled = !editable;
  }
  if ($('btnApplyThemeActive')) {
    $('btnApplyThemeActive').disabled = !hasDrive;
    $('btnApplyThemeActive').textContent = isActive ? '✓ Đang dùng' : 'Áp dụng';
  }
  if ($('btnSaveThemeDrive')) $('btnSaveThemeDrive').disabled = !editable;
  if ($('btnNewTheme')) $('btnNewTheme').disabled = !hasDrive;
  if ($('btnCloneTheme')) $('btnCloneTheme').disabled = !hasDrive;

  [
    'themeNameInput',
    'themeBg1Url', 'themeBg2Url', 'themeBg3Url', 'themeBgMobileUrl',
    'btnUploadBg1', 'btnUploadBg2', 'btnUploadBg3', 'btnUploadBgMobile',
    'btnClearBg1', 'btnClearBg2', 'btnClearBg3', 'btnClearBgMobile',
    'themeEffect', 'themeEffectEmojis',
  ].forEach((id) => {
    const el = $(id);
    if (el) el.disabled = !editable;
  });
  document.querySelectorAll('.ts-emoji-preset-btn').forEach((b) => {
    b.disabled = !editable;
  });

  renderThemeBgmList(theme, editable);
}

function collectSelectedThemeDraft() {
  const current = getSelectedTheme();
  const basePreset = current.basePreset === 'christmas' ? 'christmas' : 'default';
  const nameVal = ($('themeNameInput') ? $('themeNameInput').value.trim() : current.name) || current.name;

  const readUrlSlot = (inputId, curUrl, curFileId) => {
    const el = $(inputId);
    if (!el) return { url: curUrl || '', fileId: curFileId || '' };
    const raw = el.value.trim();
    if (!raw) return { url: '', fileId: '' };
    const norm = normalizeThemeAssetUrl(raw, '');
    if (!norm) return { url: curUrl || '', fileId: curFileId || '' };
    const fid = extractDriveId(norm) || (norm === curUrl ? (curFileId || '') : '');
    return { url: norm, fileId: fid };
  };

  const s1 = readUrlSlot('themeBg1Url', current.bg1Url, current.bg1FileId);
  const s2 = readUrlSlot('themeBg2Url', current.bg2Url, current.bg2FileId);
  const s3 = readUrlSlot('themeBg3Url', current.bg3Url, current.bg3FileId);
  const sMob = readUrlSlot('themeBgMobileUrl', current.bgMobileUrl, current.bgMobileFileId);

  const identity = getCurrentDriveIdentity();
  const rawEff = $('themeEffect') ? $('themeEffect').value : current.effect;
  const rawEmojis = $('themeEffectEmojis') ? $('themeEffectEmojis').value.trim() : (current.effectEmojis || '❄️ 🎄 ⭐');
  return sanitizeThemeProfile({
    ...current,
    name: nameVal,
    basePreset,
    bg1Url: s1.url,
    bg1FileId: s1.fileId,
    bg2Url: s2.url,
    bg2FileId: s2.fileId,
    bg3Url: s3.url,
    bg3FileId: s3.fileId,
    bgMobileUrl: sMob.url,
    bgMobileFileId: sMob.fileId,
    cardStyle: current.cardStyle,
    borderStyle: current.borderStyle,
    textStyle: current.textStyle,
    titleStyle: current.titleStyle,
    accentStyle: current.accentStyle,
    cardBg: (current.cardStyle && current.cardStyle.c1) || current.cardBg,
    borderColor: (current.borderStyle && current.borderStyle.c1) || current.borderColor,
    accentColor: (current.accentStyle && current.accentStyle.c1) || current.accentColor,
    effect: rawEff,
    effectEmojis: rawEmojis || '❄️ 🎄 ⭐',
    bgmList: asArr(current.bgmList).map(sanitizeCloudBgm).filter(Boolean).map((tr) => ({ ...tr })).slice(0, 20),
    ownerScriptUrl: current.ownerScriptUrl || identity.scriptUrl,
    ownerFolderId: current.ownerFolderId || identity.folderId,
    updatedAt: Date.now(),
  }, current.id);
}

async function saveSelectedThemeEdits(msg = '🎨 Đã lưu theme & đồng bộ lên Drive + Cloud.') {
  const curTheme = getSelectedTheme();
  if (!canEditSelectedTheme(curTheme)) {
    if ($('drivePanel')) $('drivePanel').open = true;
    toast('Vui lòng nhập đúng Apps Script Web App URL và Folder ID để chỉnh sửa theme này.', true);
    renderThemeStudio();
    return false;
  }
  const updated = collectSelectedThemeDraft();
  const nextLib = {
    ...themeLibrary,
    themes: {
      ...themeLibrary.themes,
      [updated.id]: updated,
    },
  };
  return persistThemeLibrary(nextLib, {
    switchActive: themeLibrary.activeThemeId === updated.id,
    msg,
  });
}

async function uploadThemeBgSlot(urlKey, fileIdKey, fileInputId, urlInputId, label) {
  const fileInp = $(fileInputId);
  const file = fileInp && fileInp.files && fileInp.files[0];
  if (fileInp) fileInp.value = '';
  if (!file || uploading) return;
  const curTheme = getSelectedTheme();
  if (!canEditSelectedTheme(curTheme)) {
    if ($('drivePanel')) $('drivePanel').open = true;
    toast('Cần nhập Apps Script Web App URL và Folder ID hợp lệ trước khi tải ảnh nền.', true);
    return;
  }
  if (!file.type.startsWith('image/')) {
    toast('Vui lòng chọn file hình ảnh hợp lệ.', true);
    return;
  }
  const cfg = loadDrive();
  try {
    uploading = true;
    toast(`Đang tải ảnh nền ${label} (100% chất lượng gốc) lên Google Drive…`);
    const origName = `theme_${curTheme.id}_${urlKey}_${file.name || 'background.webp'}`;
    let rawId;
    try {
      rawId = await uploadToDrive(cfg, file, origName);
    } catch {
      rawId = await uploadToDrive(cfg, file, origName);
    }
    const cleanId = extractDriveId(String(rawId || '')) || String(rawId || '').trim();
    const cdnUrl = normalizeThemeAssetUrl(`https://lh3.googleusercontent.com/d/${cleanId}=s0`);
    const oldFileId = curTheme[fileIdKey] || extractDriveId(curTheme[urlKey] || '');
    if ($(urlInputId)) $(urlInputId).value = cdnUrl;
    const draft = collectSelectedThemeDraft();
    draft[urlKey] = cdnUrl;
    draft[fileIdKey] = cleanId;
    const nextLib = {
      ...themeLibrary,
      themes: { ...themeLibrary.themes, [draft.id]: draft },
    };
    await persistThemeLibrary(nextLib, {
      switchActive: themeLibrary.activeThemeId === draft.id,
      msg: `🎨 Đã tải ảnh nền ${label} (=s0) cho “${draft.name}” & lưu Drive.`,
    });
    if (oldFileId && oldFileId !== cleanId) {
      const unused = collectUnusedDriveFileIds([oldFileId]);
      if (unused.length) trashDriveFilesSafe(unused);
    }
  } catch (err) {
    toast(`Lỗi tải ảnh nền ${label}: ${err.message || err}`, true);
  } finally {
    uploading = false;
  }
}

async function initThemeStudioSync() {
  try {
    themeLibrarySync = await createSharedThemeLibrarySync(loadFirebaseConfig());
    themeLibrarySync.onStatus((st) => {
      const el = $('themeStudioStatus');
      if (el && st && st.message) el.textContent = `☁️ ${st.message}`;
    });
    // Nếu đang nằm trong #appViewportFrame thì window.top đã subscribe shared_themes và phát BroadcastChannel xuống; chỉ subscribe trực tiếp khi mở độc lập
    let isChildFrame = false;
    try { isChildFrame = window.self !== window.top; } catch { isChildFrame = true; }
    if (!isChildFrame) {
      themeLibrarySync.subscribe((cloudLib) => {
        if (cloudLib) {
          themeLibrary = sanitizeThemeLibrary(cloudLib);
          applyThemeLibrary(themeLibrary);
        }
        renderThemeStudio();
      });
    } else if ($('themeStudioStatus')) {
      $('themeStudioStatus').textContent = '☁️ Đã liên kết đồng bộ Theme với Shell';
    }
    if (hasValidDriveIdentity()) {
      await loadThemesFromDrive();
    }
  } catch { /* ignore */ }
}

// ---------- Xuất / Nhập ----------
function download(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function importFile(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const rawText = String(reader.result);
      const incoming = parseImport(rawText);
      try {
        const parsed = JSON.parse(rawText);
        const rawList = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.topics) ? parsed.topics : []);
        incoming.forEach((t, idx) => {
          const rawT = rawList.find((r) => r && ((r.id && r.id === t.id) || r.name === t.name)) || rawList[idx];
          if (rawT) {
            if (Array.isArray(rawT.items) && rawT.items.length > t.items.length) {
              t.items = rawT.items.map(sanitizeItem).filter(Boolean).slice(0, MAX_TOPIC_IMAGES);
            }
            t.coverUrl = normalizeCoverUrl(rawT.coverUrl) || normalizeImageUrl(rawT.coverUrl) || '';
          }
        });
      } catch { /* ignore */ }
      const replace = topics.length && confirm(`Tìm thấy ${incoming.length} chủ đề.\nOK = THAY THẾ toàn bộ chủ đề trên Kho dùng chung\nHủy = GỘP thêm vào danh sách hiện có`);
      if (replace) topics = [];
      const used = new Set(topics.map((t) => t.id));
      incoming.forEach((t) => {
        if (used.has(t.id)) t.id = newId();
        used.add(t.id);
        t.icon = '';
        t.shuffle = true;
        stampOwnership(t);
        topics.push(t);
      });
      currentId = incoming[0].id;
      persistLocalCache();
      if (cloudSync && cloudSync.mode === 'firebase') {
        if (replace) await cloudSync.replaceAll(topics);
        else await cloudSync.putMany(incoming);
      }
      render();
      toast(`Đã nhập & đồng bộ ${incoming.length} chủ đề lên Cloud.`);
    } catch (e) {
      toast(e.message, true);
    }
  };
  reader.readAsText(file);
}

// ---------- Xác nhận xóa chủ đề (Kiểm tra quyền sở hữu & Xóa đồng bộ Drive + Firebase + localStorage) ----------
function setDeleteModalBusy(busy, statusText = '') {
  const statusEl = $('delModalStatus');
  const confirmBtn = $('btnConfirmDeleteTopic');
  const cancelBtn = $('btnCancelDeleteTopic');
  const checkEl = $('delConfirmCheck');
  if (statusEl) {
    statusEl.textContent = statusText || '';
    statusEl.classList.toggle('hidden', !statusText);
  }
  if (confirmBtn) {
    confirmBtn.disabled = busy || !(checkEl && checkEl.checked);
    confirmBtn.textContent = busy ? 'Đang xóa…' : 'Xóa vĩnh viễn';
  }
  if (cancelBtn) cancelBtn.disabled = busy;
  if (checkEl) checkEl.disabled = busy;
}

function openDeleteModal(t) {
  if (!t || deletingTopic) return;
  if (!canDeleteTopic(t)) {
    if ($('drivePanel')) $('drivePanel').open = true;
    toast(DELETE_DENIED_MSG, true);
    return;
  }
  const modal = $('deleteConfirmModal');
  const fileCount = extractTopicDriveFileIds(t).length;
  if (!modal) {
    if (confirm(`Xác nhận xóa vĩnh viễn chủ đề “${t.name}” (${t.items.length} ảnh) khỏi Google Drive, Firebase và máy?`)) {
      executeDeleteTopic(t.id);
    }
    return;
  }
  pendingDeleteId = t.id;
  if ($('delModalTopicName')) $('delModalTopicName').textContent = t.name;
  if ($('delModalTopicCount')) {
    $('delModalTopicCount').textContent = `Gồm ${t.items.length} câu hỏi · ${fileCount} ảnh Drive · Nhánh shared_topics`;
  }
  if ($('delConfirmCheck')) {
    $('delConfirmCheck').checked = false;
    $('delConfirmCheck').disabled = false;
  }
  setDeleteModalBusy(false, '');
  modal.classList.remove('hidden');
}

function closeDeleteModal() {
  if (deletingTopic) return;
  pendingDeleteId = null;
  setDeleteModalBusy(false, '');
  const modal = $('deleteConfirmModal');
  if (modal) modal.classList.add('hidden');
}

async function executeDeleteTopic(targetId) {
  if (deletingTopic) return;
  const t = topics.find((x) => x.id === targetId);
  if (!t) {
    closeDeleteModal();
    return;
  }
  if (!canDeleteTopic(t)) {
    closeDeleteModal();
    if ($('drivePanel')) $('drivePanel').open = true;
    toast(DELETE_DENIED_MSG, true);
    return;
  }

  const { scriptUrl, folderId: currentFolderId } = getCurrentDriveIdentity();
  const extractedDriveFileIds = extractTopicDriveFileIds(t);
  const removedName = t.name;

  deletingTopic = true;
  setDeleteModalBusy(true, '⏳ Đang xóa ảnh trên Drive và dữ liệu...');
  toast('Đang xóa ảnh trên Drive và dữ liệu...');

  // 1. Gửi yêu cầu POST tới Apps Script để xóa thư mục / các file ảnh của chủ đề trên Google Drive
  let driveWarning = '';
  try {
    const res = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'deleteTopicFolder',
        folderId: currentFolderId,
        topicFolderId: t.driveFolderId || '',
        topicName: t.name,
        fileIds: extractedDriveFileIds,
      }),
    });
    if (!res.ok) {
      driveWarning = `HTTP ${res.status}`;
    } else {
      try {
        const json = await res.json();
        if (json && json.ok === false) {
          driveWarning = json.error || 'Apps Script báo lỗi';
        }
      } catch { /* ignore non-JSON body */ }
    }
  } catch (err) {
    driveWarning = err?.message || 'Không gọi được Apps Script';
  }

  // 2. Lưu tombstone chống hồi sinh trước khi xóa trên Firebase & localStorage
  markTopicDeleted(t.id);

  // 3. Xóa hẳn node trên Firebase Realtime Database (`shared_topics/<topicId>`)
  if (cloudSync && cloudSync.mode === 'firebase') {
    await cloudSync.removeTopic(t.id);
  }

  // 4. Xóa âm thanh IndexedDB và ghi đè mảng sạch vào localStorage ngay lập tức
  await deleteTopicAudioIDB(t.id);
  topics = topics.filter((x) => x.id !== t.id);
  currentId = topics[0] ? topics[0].id : null;
  try {
    localStorage.setItem(TOPICS_KEY, JSON.stringify(topics));
  } catch { /* ignore */ }
  persistLocalCache();

  deletingTopic = false;
  closeDeleteModal();
  updateCloudCountBadge();
  render();

  if (driveWarning) {
    toast(`Đã xóa “${removedName}” trên Firebase & máy (Lưu ý Drive: ${driveWarning}).`, true);
  } else {
    toast(`Đã xóa vĩnh viễn “${removedName}” khỏi Google Drive, Firebase và bộ nhớ máy.`);
  }
}

// ---------- Chạy thử ----------
let pvI = 0;
function showPreview() {
  const t = cur();
  if (!t || !t.items.length) return;
  pvI = (pvI + t.items.length) % t.items.length;
  const it = t.items[pvI];
  const box = $('pvImg');
  box.innerHTML = '';
  if (it.type === 'emoji') {
    box.innerHTML = `<div style="font-size:12rem;line-height:1">${esc(it.emoji)}</div>`;
  } else {
    const src = normalizeImageUrl(it.src) || it.src;
    const img = document.createElement('img');
    img.referrerPolicy = 'no-referrer';
    img.removeAttribute('crossorigin');
    img.style.cssText = 'max-height:55vh;max-width:100%;border-radius:8px';
    img.alt = '';
    let retried = false;
    img.addEventListener('error', () => {
      console.error('Lỗi tải ảnh:', img.src);
      if (!retried && src) {
        retried = true;
        const fallback = driveFallbackUrl(src);
        img.src = fallback && img.src !== fallback
          ? fallback
          : `${src}${src.includes('?') ? '&' : '?'}retry=1`;
        return;
      }
      img.replaceWith(Object.assign(document.createElement('div'), {
        className: 'font-display text-3xl t-danger text-center px-4',
        textContent: '⚠️ Ảnh không tải được',
      }));
    });
    img.src = src;
    box.appendChild(img);
  }
  $('pvAnswer').textContent = it.answer;
  $('pvIdx').textContent = `${pvI + 1}/${t.items.length}`;
}

// ---------- Gắn sự kiện ----------
function bind() {
  ['btnSyncCloud', 'btnSyncCloudTop'].forEach((id) => {
    const btn = $(id);
    if (btn) btn.addEventListener('click', manualSyncCloud);
  });

  // Event delegation cho danh sách chủ đề
  if ($('topicList')) {
    $('topicList').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-topic-id]');
      if (!btn) return;
      currentId = btn.dataset.topicId;
      render();
    });
  }

  // Event delegation cho bảng ảnh (tránh gắn nhiều listener gây rò rỉ bộ nhớ)
  const box = $('itemList');
  box.addEventListener('change', (e) => {
    const card = e.target.closest('.photo-card');
    const t = cur();
    if (!card || !t) return;
    if (!canEditTopic(t)) {
      toast(EDIT_DENIED_MSG, true);
      render();
      return;
    }
    const i = Number(card.dataset.idx);
    const it = t.items[i];
    if (!it) return;
    const f = e.target.dataset.f;
    if (f === 'answer') {
      const v = e.target.value.trim();
      if (!v) {
        toast('Đáp án không được để trống.', true);
        e.target.value = it.answer;
        return;
      }
      it.answer = v;
      persist(t);
      toast('Đã lưu & đồng bộ đáp án.');
    } else if (f === 'aliases') {
      it.aliases = e.target.value.split(',').map((x) => x.trim()).filter(Boolean);
      persist(t);
    }
  });
  box.addEventListener('click', (e) => {
    const actBtn = e.target.closest('[data-a]');
    if (!actBtn) return;
    const card = actBtn.closest('.photo-card');
    const t = cur();
    if (!card || !t) return;
    if (!canEditTopic(t)) {
      if ($('drivePanel')) $('drivePanel').open = true;
      toast(EDIT_DENIED_MSG, true);
      return;
    }
    const i = Number(card.dataset.idx);
    const a = actBtn.dataset.a;
    if (a === 'up') move(i, i - 1);
    else if (a === 'down') move(i, i + 1);
    else if (a === 'cover') {
      const it = t.items[i];
      if (!it || it.type !== 'img' || !it.src) return;
      const cleanSrc = normalizeCoverUrl(it.src) || normalizeImageUrl(it.src) || it.src;
      t.coverUrl = cleanSrc;
      persist(t);
      render();
      toast(`⭐ Đã chọn ảnh #${i + 1} làm ảnh bìa chủ đề & đồng bộ Cloud.`);
    } else if (a === 'del') {
      const removed = t.items[i];
      t.items.splice(i, 1);
      if (removed && removed.src && t.coverUrl && normalizeImageUrl(removed.src) === normalizeImageUrl(t.coverUrl)) {
        t.coverUrl = '';
      }
      if (persist(t) && removed) {
        deleteDriveItemFiles(t, [removed]);
      }
      render();
    }
  });
  box.addEventListener('dragstart', (e) => {
    const t = cur();
    if (!t || !canEditTopic(t)) {
      e.preventDefault();
      return;
    }
    const card = e.target.closest('.photo-card');
    if (!card) return;
    dragIndex = Number(card.dataset.idx);
    card.classList.add('row-drag');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(dragIndex));
  });
  box.addEventListener('dragend', (e) => {
    const card = e.target.closest('.photo-card');
    dragIndex = null;
    if (card) card.classList.remove('row-drag');
    box.querySelectorAll('.row-over').forEach((el) => el.classList.remove('row-over'));
  });
  box.addEventListener('dragover', (e) => {
    if (dragIndex === null) return;
    const card = e.target.closest('.photo-card');
    if (!card) return;
    e.preventDefault();
    card.classList.add('row-over');
  });
  box.addEventListener('dragleave', (e) => {
    const card = e.target.closest('.photo-card');
    if (card) card.classList.remove('row-over');
  });
  box.addEventListener('drop', (e) => {
    if (dragIndex === null) return;
    const t = cur();
    if (!t || !canEditTopic(t)) {
      dragIndex = null;
      return;
    }
    const card = e.target.closest('.photo-card');
    if (!card) return;
    e.preventDefault();
    e.stopPropagation();
    card.classList.remove('row-over');
    move(dragIndex, Number(card.dataset.idx));
  });

  $('btnNew').addEventListener('click', () => {
    if (!hasValidDriveIdentity()) {
      if ($('drivePanel')) $('drivePanel').open = true;
      toast('Vui lòng nhập đầy đủ Apps Script Web App URL và Folder ID Google Drive trước khi tạo chủ đề mới.', true);
      return;
    }
    const name = prompt('Tên chủ đề mới (ví dụ: Cầu thủ bóng đá):');
    if (!name || !name.trim()) return;
    const { scriptUrl, folderId } = getCurrentDriveIdentity();
    const t = sanitizeTopic({ id: newId(), name: name.trim(), icon: '', shuffle: true, items: [] });
    if (!t) return;
    t.icon = '';
    t.ownerScriptUrl = scriptUrl;
    t.ownerFolderId = folderId;
    t.updatedAt = Date.now();
    stampOwnership(t);
    sessionDraftIds.add(t.id);
    topics.push(t);
    currentId = t.id;
    persistLocalCache();
    render();
    persist(t);
    if ($('tName')) {
      try { $('tName').focus(); } catch { /* ignore */ }
    }
    toast(`Đã tạo chủ đề “${t.name}” — hãy thêm ảnh câu hỏi bên dưới.`);
  });

  $('btnClone').addEventListener('click', () => {
    if (!topics.length) {
      toast('Chưa có chủ đề nào để nhân bản. Hãy tạo chủ đề mới trước.', true);
      return;
    }
    if (!hasValidDriveIdentity()) {
      if ($('drivePanel')) $('drivePanel').open = true;
      toast('Vui lòng nhập đầy đủ Apps Script Web App URL và Folder ID Google Drive trước khi nhân bản chủ đề.', true);
      return;
    }
    const menu = topics.map((c, i) => `${i + 1}. ${c.name} (${(c.items || []).length})`).join('\n');
    const n = parseInt(prompt(`Nhân bản chủ đề nào? Nhập số:\n${menu}`), 10);
    const src = topics[n - 1];
    if (!src) return;
    const { scriptUrl, folderId } = getCurrentDriveIdentity();
    const t = sanitizeTopic({
      id: newId(), name: `${src.name} (bản sao)`, icon: '', shuffle: true,
      items: (src.items || []).slice(0, MAX_TOPIC_IMAGES),
    });
    t.icon = '';
    t.coverUrl = src.coverUrl || '';
    t.ownerScriptUrl = scriptUrl;
    t.ownerFolderId = folderId;
    stampOwnership(t);
    sessionDraftIds.add(t.id);
    topics.push(t);
    currentId = t.id;
    persist(t);
    render();
    toast(`Đã nhân bản “${src.name}” lên Kho dùng chung.`);
  });

  if ($('tName')) {
    $('tName').addEventListener('change', () => {
      const t = cur();
      const v = $('tName').value.trim();
      if (!t || !v) return render();
      if (!canEditTopic(t)) {
        toast(EDIT_DENIED_MSG, true);
        return render();
      }
      t.name = v;
      t.icon = '';
      persist(t);
      renderTopics();
    });
  }
  if ($('tIcon')) {
    $('tIcon').addEventListener('change', () => {
      const t = cur();
      if (!t || !canEditTopic(t)) return;
      t.icon = '';
      persist(t);
      renderTopics();
    });
  }
  // --- Ảnh bìa chủ đề (Cover Image: tải file riêng lên Drive hoặc dán URL trực tiếp) ---
  const applyCoverUrlInput = () => {
    const t = cur();
    if (!t || !$('tCoverUrl')) return;
    if (!canEditTopic(t)) {
      toast(EDIT_DENIED_MSG, true);
      render();
      return;
    }
    const raw = $('tCoverUrl').value.trim();
    if (!raw) {
      t.coverUrl = '';
      persist(t);
      render();
      toast('Đã đặt ảnh bìa về chế độ tự động (Ảnh #1).');
      return;
    }
    const normalized = normalizeCoverUrl(raw) || normalizeImageUrl(raw);
    if (!normalized) {
      toast('Link ảnh bìa không hợp lệ (hãy dán link Google Drive hoặc URL http/https).', true);
      return;
    }
    t.coverUrl = normalized;
    $('tCoverUrl').value = normalized;
    persist(t);
    render();
    toast('⭐ Đã cập nhật ảnh bìa chủ đề & đồng bộ Cloud.');
  };
  if ($('btnApplyCoverUrl')) {
    $('btnApplyCoverUrl').addEventListener('click', applyCoverUrlInput);
  }
  if ($('tCoverUrl')) {
    $('tCoverUrl').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyCoverUrlInput();
      }
    });
  }
  if ($('btnClearCoverUrl')) {
    $('btnClearCoverUrl').addEventListener('click', () => {
      const t = cur();
      if (!t || !canEditTopic(t)) {
        toast(EDIT_DENIED_MSG, true);
        return;
      }
      t.coverUrl = '';
      if ($('tCoverUrl')) $('tCoverUrl').value = '';
      persist(t);
      render();
      toast('Đã đặt lại ảnh bìa về tự động (Ảnh #1).');
    });
  }
  if ($('btnPickCoverFile') && $('fileCoverPick')) {
    $('btnPickCoverFile').addEventListener('click', () => {
      const t = cur();
      if (!t || !canEditTopic(t)) {
        toast(EDIT_DENIED_MSG, true);
        return;
      }
      $('fileCoverPick').click();
    });
    $('fileCoverPick').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      const t = cur();
      if (!file || !t || uploading) return;
      if (!canEditTopic(t)) {
        toast(EDIT_DENIED_MSG, true);
        return;
      }
      if (!file.type.startsWith('image/')) {
        toast('Vui lòng chọn một file hình ảnh hợp lệ.', true);
        return;
      }
      const cfg = loadDrive();
      if (!cfg.url || !cfg.folderId) {
        $('drivePanel').open = true;
        toast('Hãy nhập Web App URL và Folder ID Google Drive trước (hoặc dán link ảnh bìa).', true);
        return;
      }
      try {
        uploading = true;
        toast(`Đang nén WebP & tải ảnh bìa “${file.name}” lên Google Drive…`);
        const { blob, name } = await prepareImage(file);
        let id;
        try {
          id = await uploadToDrive(cfg, blob, `cover_${name}`);
        } catch {
          id = await uploadToDrive(cfg, blob, `cover_${name}`);
        }
        const coverSrc = normalizeImageUrl(`https://lh3.googleusercontent.com/d/${id}=w1280`);
        t.coverUrl = coverSrc;
        persist(t);
        render();
        toast('⭐ Đã tải ảnh bìa riêng lên Drive & đồng bộ lên Kho dùng chung.');
      } catch (err) {
        toast(`Lỗi tải ảnh bìa: ${err.message || err}`, true);
      } finally {
        uploading = false;
      }
    });
  }

  // Bảo vệ xóa nhầm chủ đề dùng chung
  if ($('btnDeleteTopic')) {
    $('btnDeleteTopic').addEventListener('click', () => {
      const t = cur();
      if (!t) return;
      openDeleteModal(t);
    });
  }
  if ($('delConfirmCheck')) {
    $('delConfirmCheck').addEventListener('change', (e) => {
      if ($('btnConfirmDeleteTopic')) $('btnConfirmDeleteTopic').disabled = !e.target.checked;
    });
  }
  if ($('btnCancelDeleteTopic')) {
    $('btnCancelDeleteTopic').addEventListener('click', closeDeleteModal);
  }
  if ($('btnConfirmDeleteTopic')) {
    $('btnConfirmDeleteTopic').addEventListener('click', () => {
      if (pendingDeleteId && (!$('delConfirmCheck') || $('delConfirmCheck').checked)) {
        executeDeleteTopic(pendingDeleteId);
      }
    });
  }
  if ($('deleteConfirmModal')) {
    $('deleteConfirmModal').addEventListener('mousedown', (e) => {
      if (e.target === $('deleteConfirmModal')) closeDeleteModal();
    });
  }

  $('btnClearItems').addEventListener('click', () => {
    const t = cur();
    if (!t) return;
    if (!canEditTopic(t)) {
      if ($('drivePanel')) $('drivePanel').open = true;
      toast(EDIT_DENIED_MSG, true);
      return;
    }
    if (!t.items.length || !confirm(`Xóa tất cả ${t.items.length} ảnh trong chủ đề “${t.name}” trên Kho dùng chung?`)) return;
    const removedItems = [...t.items];
    t.items = [];
    if (persist(t)) {
      deleteDriveItemFiles(t, removedItems);
    }
    render();
  });

  const dz = $('dropzone');
  if ($('btnPick') && $('filePick')) {
    $('btnPick').addEventListener('click', () => $('filePick').click());
    $('filePick').addEventListener('change', (e) => {
      handleFiles(e.target.files);
      e.target.value = '';
    });
  }
  if (dz) {
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.add('over');
    }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.remove('over');
    }));
    dz.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));
  }
  // Chặn trình duyệt mở ảnh khi thả trượt vùng
  window.addEventListener('dragover', (e) => { if (dragIndex === null) e.preventDefault(); });
  window.addEventListener('drop', (e) => { if (dragIndex === null) e.preventDefault(); });

  $('btnExportAll').addEventListener('click', () => {
    if (!topics.length) return toast('Chưa có chủ đề để xuất.', true);
    download(`the-floor-topics-${new Date().toISOString().slice(0, 10)}.json`, exportPayload(topics));
  });
  $('btnExportOne').addEventListener('click', () => {
    const t = cur();
    if (!t) return toast('Chưa chọn chủ đề.', true);
    download(`the-floor-${t.name.replace(/[^\p{L}\p{N}]+/gu, '-')}.json`, exportPayload([t]));
  });
  $('btnImport').addEventListener('click', () => $('fileImport').click());
  $('fileImport').addEventListener('change', (e) => {
    if (e.target.files[0]) importFile(e.target.files[0]);
    e.target.value = '';
  });

  const d = loadDrive();
  $('driveUrl').value = d.url;
  $('driveFolder').value = d.folderId;
  if (!d.url) $('drivePanel').open = true;
  $('btnDriveSave').addEventListener('click', saveDriveCfg);
  $('btnDriveTest').addEventListener('click', testDrive);
  fetch('apps-script/Code.gs').then((r) => r.text()).then((txt) => { $('scriptCode').textContent = txt; })
    .catch(() => { $('scriptCode').textContent = '(Không tải được mã — xem file apps-script/Code.gs)'; });
  $('btnCopyScript').addEventListener('click', () => {
    navigator.clipboard.writeText($('scriptCode').textContent).then(() => toast('Đã sao chép mã Apps Script.'));
  });

  // --- Gắn sự kiện Thư viện Theme (Google Drive + Firebase) ---
  if ($('themeLibraryList')) {
    $('themeLibraryList').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-theme-pick-id]');
      if (!btn) return;
      const pickId = btn.dataset.themePickId;
      if (!pickId || !themeLibrary.themes[pickId]) return;
      selectTheme(pickId);
    });
  }

  if ($('btnNewTheme') && $('newThemeBox')) {
    $('btnNewTheme').addEventListener('click', () => {
      if (!hasValidDriveIdentity()) {
        if ($('drivePanel')) $('drivePanel').open = true;
        toast('Vui lòng nhập Drive Key hợp lệ trước khi tạo theme mới.', true);
        return;
      }
      $('newThemeBox').classList.toggle('hidden');
      if (!$('newThemeBox').classList.contains('hidden') && $('newThemeName')) {
        $('newThemeName').value = '';
        $('newThemeName').focus();
      }
    });
  }
  if ($('btnCancelNewTheme') && $('newThemeBox')) {
    $('btnCancelNewTheme').addEventListener('click', () => {
      $('newThemeBox').classList.add('hidden');
    });
  }
  if ($('btnConfirmNewTheme')) {
    $('btnConfirmNewTheme').addEventListener('click', () => {
      createNewTheme();
    });
  }

  if ($('btnCloneTheme')) {
    $('btnCloneTheme').addEventListener('click', () => {
      duplicateTheme();
    });
  }

  if ($('btnApplyThemeActive')) {
    $('btnApplyThemeActive').addEventListener('click', async () => {
      if (!hasValidDriveIdentity()) {
        if ($('drivePanel')) $('drivePanel').open = true;
        toast('Vui lòng nhập Drive Key hợp lệ để áp dụng theme cho phòng chơi.', true);
        return;
      }
      const curTheme = getSelectedTheme();
      const nextLib = {
        ...themeLibrary,
        activeThemeId: curTheme.id,
      };
      await persistThemeLibrary(nextLib, {
        switchActive: true,
        msg: `✨ Đã áp dụng “${curTheme.name}” lên toàn bộ màn hình game!`,
      });
    });
  }

  if ($('btnSaveThemeDrive')) {
    $('btnSaveThemeDrive').addEventListener('click', () => {
      saveSelectedThemeEdits('💾 Đã lưu theme vào Google Drive & đồng bộ Cloud ✓');
    });
  }

  if ($('btnResetThemePreset')) {
    $('btnResetThemePreset').addEventListener('click', async () => {
      const curTheme = getSelectedTheme();
      if (!curTheme.isBuiltIn || !canEditSelectedTheme(curTheme)) return;
      if (!confirm(`Khôi phục “${curTheme.name}” về thông số mặc định ban đầu?`)) return;
      stopThemeBgmPreview();
      setThemeBgmNotice('');
      resetThemeBgmInputs();
      const factory = BUILTIN_THEMES[curTheme.id];
      if (!factory) return;
      const resetProfile = sanitizeThemeProfile({
        ...factory,
        bgmList: [],
        updatedAt: Date.now(),
      }, curTheme.id);
      const nextLib = {
        ...themeLibrary,
        themes: { ...themeLibrary.themes, [resetProfile.id]: resetProfile },
      };
      await persistThemeLibrary(nextLib, {
        switchActive: themeLibrary.activeThemeId === resetProfile.id,
        msg: `↺ Đã khôi phục “${resetProfile.name}” về mặc định gốc.`,
      });
    });
  }

  if ($('btnDeleteTheme')) {
    $('btnDeleteTheme').addEventListener('click', async () => {
      const curTheme = getSelectedTheme();
      if (!curTheme || curTheme.isBuiltIn) {
        toast('Không thể xóa theme mặc định gốc (hãy dùng Khôi phục gốc).', true);
        return;
      }
      if (!canEditSelectedTheme(curTheme)) {
        if ($('drivePanel')) $('drivePanel').open = true;
        toast('Bạn cần đúng Drive Key đã tạo theme này để xóa.', true);
        return;
      }
      const themeFiles = extractThemeDriveFileIds(curTheme);
      if (!confirm(`Xóa vĩnh viễn theme “${curTheme.name}”${themeFiles.length ? ` và dọn ${themeFiles.length} file ảnh/nhạc trên Google Drive` : ''}?`)) {
        return;
      }
      stopThemeBgmPreview();
      setThemeBgmNotice('');
      resetThemeBgmInputs();
      const filesToDelete = collectUnusedDriveFileIds(themeFiles, curTheme.id);
      if (filesToDelete.length) {
        toast(`Đang dọn ${filesToDelete.length} file của theme trên Google Drive…`);
        await trashDriveFilesSafe(filesToDelete);
      }
      markThemeDeleted(curTheme.id);
      const nextThemes = { ...themeLibrary.themes };
      delete nextThemes[curTheme.id];
      const nextActive = themeLibrary.activeThemeId === curTheme.id ? 'builtin_christmas' : themeLibrary.activeThemeId;
      selectedThemeId = nextActive;
      await persistThemeLibrary({
        ...themeLibrary,
        activeThemeId: nextActive,
        themes: nextThemes,
      }, {
        switchActive: themeLibrary.activeThemeId === curTheme.id,
        msg: `🗑 Đã xóa theme “${curTheme.name}” và dọn sạch Drive.`,
      });
    });
  }

  [
    ['bg1Url', 'bg1FileId', 'btnUploadBg1', 'btnClearBg1', 'fileBg1', 'themeBg1Url', 'Trang 1'],
    ['bg2Url', 'bg2FileId', 'btnUploadBg2', 'btnClearBg2', 'fileBg2', 'themeBg2Url', 'Trang 2'],
    ['bg3Url', 'bg3FileId', 'btnUploadBg3', 'btnClearBg3', 'fileBg3', 'themeBg3Url', 'Trang 3'],
    ['bgMobileUrl', 'bgMobileFileId', 'btnUploadBgMobile', 'btnClearBgMobile', 'fileBgMobile', 'themeBgMobileUrl', 'Mobile dọc'],
  ].forEach(([urlKey, fileIdKey, btnId, clearId, fileId, urlId, label]) => {
    if ($(btnId) && $(fileId)) {
      $(btnId).addEventListener('click', () => {
        if (!canEditSelectedTheme()) {
          if ($('drivePanel')) $('drivePanel').open = true;
          toast('Vui lòng nhập Apps Script Web App URL và Folder ID để tải ảnh nền.', true);
          return;
        }
        $(fileId).click();
      });
      $(fileId).addEventListener('change', () => {
        uploadThemeBgSlot(urlKey, fileIdKey, fileId, urlId, label);
      });
    }
    if ($(clearId)) {
      $(clearId).addEventListener('click', async () => {
        const curTheme = getSelectedTheme();
        if (!canEditSelectedTheme(curTheme)) return;
        const oldFid = curTheme[fileIdKey] || extractDriveId(curTheme[urlKey] || '');
        if ($(urlId)) $(urlId).value = '';
        const draft = collectSelectedThemeDraft();
        draft[urlKey] = '';
        draft[fileIdKey] = '';
        await persistThemeLibrary({
          ...themeLibrary,
          themes: { ...themeLibrary.themes, [draft.id]: draft },
        }, {
          switchActive: themeLibrary.activeThemeId === draft.id,
          msg: `Đã xóa ảnh nền ${label} khỏi “${draft.name}”.`,
        });
        if (oldFid) {
          const unused = collectUnusedDriveFileIds([oldFid]);
          if (unused.length) trashDriveFilesSafe(unused);
        }
      });
    }
    if ($(urlId)) {
      $(urlId).addEventListener('change', () => {
        if (!canEditSelectedTheme()) return;
        saveSelectedThemeEdits(`🎨 Đã cập nhật ảnh nền ${label} & lưu vào Drive.`);
      });
    }
  });

  // Nút Bật / Tắt (Toggle) Studio Giao diện từ Sidebar + đồng bộ với <details>
  if ($('btnOpenThemeStudio') && $('themeStudioPanel')) {
    $('btnOpenThemeStudio').addEventListener('click', () => {
      const panel = $('themeStudioPanel');
      const willOpen = !panel.open;
      panel.open = willOpen;
      syncThemeStudioToggleUi();
      if (willOpen) {
        requestAnimationFrame(() => {
          try { panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { /* ignore */ }
        });
      }
    });
  }
  if ($('themeStudioPanel')) {
    $('themeStudioPanel').addEventListener('toggle', () => {
      syncThemeStudioToggleUi();
    });
  }

  // 4 ô chọn màu kiểu Photoshop -> Mở / Đóng bảng Inspector
  if ($('tsColorCards')) {
    $('tsColorCards').addEventListener('click', (e) => {
      const card = e.target.closest('[data-color-key]');
      if (!card || card.disabled) return;
      const key = card.dataset.colorKey;
      if (!COLOR_STYLE_KEYS.includes(key)) return;
      activeColorKey = activeColorKey === key ? null : key;
      renderColorControls(getSelectedTheme(), canEditSelectedTheme());
    });
  }
  if ($('btnTsCiClose')) {
    $('btnTsCiClose').addEventListener('click', () => {
      activeColorKey = null;
      renderColorControls(getSelectedTheme(), canEditSelectedTheme());
    });
  }
  if ($('tsCiModeSeg')) {
    $('tsCiModeSeg').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-color-mode]');
      if (!btn || btn.disabled) return;
      updateActiveColorStyle({ mode: btn.dataset.colorMode }, true);
    });
  }

  // Đơn sắc (Color Picker + Hex + 8 màu mẫu nhanh)
  const isFullHex = (v) => /^#[0-9a-fA-F]{6}$/.test(String(v || '').trim());
  if ($('tsSolidColor')) {
    $('tsSolidColor').addEventListener('input', (e) => {
      const hex = String(e.target.value || '').toUpperCase();
      if ($('tsSolidHex')) $('tsSolidHex').value = hex;
      updateActiveColorStyle({ mode: 'solid', c1: hex }, false);
    });
    $('tsSolidColor').addEventListener('change', (e) => {
      updateActiveColorStyle({ mode: 'solid', c1: String(e.target.value || '').toUpperCase() }, true);
    });
  }
  if ($('tsSolidHex')) {
    $('tsSolidHex').addEventListener('input', (e) => {
      const raw = String(e.target.value || '').trim();
      const normalized = raw.startsWith('#') ? raw : `#${raw}`;
      if (isFullHex(normalized)) {
        updateActiveColorStyle({ mode: 'solid', c1: normalized.toUpperCase() }, false);
      }
    });
    $('tsSolidHex').addEventListener('change', (e) => {
      const raw = String(e.target.value || '').trim();
      const normalized = raw.startsWith('#') ? raw : `#${raw}`;
      if (isFullHex(normalized)) {
        updateActiveColorStyle({ mode: 'solid', c1: normalized.toUpperCase() }, true);
      } else {
        renderColorControls(getSelectedTheme(), canEditSelectedTheme());
      }
    });
  }
  if ($('tsQuickSwatches')) {
    $('tsQuickSwatches').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-qhex]');
      if (!btn || btn.disabled) return;
      updateActiveColorStyle({ mode: 'solid', c1: btn.dataset.qhex }, true);
    });
  }

  // Chuyển sắc (Màu 1 + Màu 2 + Đảo chiều + Góc xoay 0-360°)
  if ($('tsGradC1')) {
    $('tsGradC1').addEventListener('input', (e) => {
      const hex = String(e.target.value || '').toUpperCase();
      if ($('tsGradHex1')) $('tsGradHex1').value = hex;
      updateActiveColorStyle({ mode: 'gradient', c1: hex }, false);
    });
    $('tsGradC1').addEventListener('change', (e) => {
      updateActiveColorStyle({ mode: 'gradient', c1: String(e.target.value || '').toUpperCase() }, true);
    });
  }
  if ($('tsGradHex1')) {
    $('tsGradHex1').addEventListener('input', (e) => {
      const raw = String(e.target.value || '').trim();
      const norm = raw.startsWith('#') ? raw : `#${raw}`;
      if (isFullHex(norm)) updateActiveColorStyle({ mode: 'gradient', c1: norm.toUpperCase() }, false);
    });
    $('tsGradHex1').addEventListener('change', (e) => {
      const raw = String(e.target.value || '').trim();
      const norm = raw.startsWith('#') ? raw : `#${raw}`;
      if (isFullHex(norm)) updateActiveColorStyle({ mode: 'gradient', c1: norm.toUpperCase() }, true);
      else renderColorControls(getSelectedTheme(), canEditSelectedTheme());
    });
  }
  if ($('tsGradC2')) {
    $('tsGradC2').addEventListener('input', (e) => {
      const hex = String(e.target.value || '').toUpperCase();
      if ($('tsGradHex2')) $('tsGradHex2').value = hex;
      updateActiveColorStyle({ mode: 'gradient', c2: hex }, false);
    });
    $('tsGradC2').addEventListener('change', (e) => {
      updateActiveColorStyle({ mode: 'gradient', c2: String(e.target.value || '').toUpperCase() }, true);
    });
  }
  if ($('tsGradHex2')) {
    $('tsGradHex2').addEventListener('input', (e) => {
      const raw = String(e.target.value || '').trim();
      const norm = raw.startsWith('#') ? raw : `#${raw}`;
      if (isFullHex(norm)) updateActiveColorStyle({ mode: 'gradient', c2: norm.toUpperCase() }, false);
    });
    $('tsGradHex2').addEventListener('change', (e) => {
      const raw = String(e.target.value || '').trim();
      const norm = raw.startsWith('#') ? raw : `#${raw}`;
      if (isFullHex(norm)) updateActiveColorStyle({ mode: 'gradient', c2: norm.toUpperCase() }, true);
      else renderColorControls(getSelectedTheme(), canEditSelectedTheme());
    });
  }
  if ($('btnTsGradSwap')) {
    $('btnTsGradSwap').addEventListener('click', () => {
      if (!activeColorKey) return;
      const curTheme = getSelectedTheme();
      const cur = sanitizeColorStyle(curTheme[activeColorKey]);
      updateActiveColorStyle({ mode: 'gradient', c1: cur.c2, c2: cur.c1 }, true);
    });
  }
  if ($('tsGradAngleRange')) {
    $('tsGradAngleRange').addEventListener('input', (e) => {
      updateActiveColorStyle({ mode: 'gradient', angle: Number(e.target.value) || 0 }, false);
    });
    $('tsGradAngleRange').addEventListener('change', (e) => {
      updateActiveColorStyle({ mode: 'gradient', angle: Number(e.target.value) || 0 }, true);
    });
  }
  document.querySelectorAll('.ts-angle-presets [data-qangle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      updateActiveColorStyle({ mode: 'gradient', angle: Number(btn.dataset.qangle) || 0 }, true);
    });
  });

  // Hiệu ứng rơi (Tắt / Tuyết rơi / Emoji rơi + 4 bộ emoji mẫu 1 chạm)
  if ($('themeEffect')) {
    $('themeEffect').addEventListener('change', (e) => {
      if ($('themeEmojiBox')) {
        $('themeEmojiBox').classList.toggle('hidden', e.target.value !== 'emoji');
      }
      if (!canEditSelectedTheme()) return;
      saveSelectedThemeEdits('✨ Đã cập nhật hiệu ứng rơi & lưu vào Drive ✓');
    });
  }
  if ($('themeEffectEmojis')) {
    $('themeEffectEmojis').addEventListener('change', () => {
      if (!canEditSelectedTheme()) return;
      saveSelectedThemeEdits('✨ Đã cập nhật bộ Emoji rơi & lưu vào Drive ✓');
    });
  }
  document.querySelectorAll('.ts-emoji-preset-btn[data-emoji-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!canEditSelectedTheme()) return;
      if ($('themeEffect')) $('themeEffect').value = 'emoji';
      if ($('themeEffectEmojis')) $('themeEffectEmojis').value = btn.dataset.emojiPreset;
      if ($('themeEmojiBox')) $('themeEmojiBox').classList.remove('hidden');
      saveSelectedThemeEdits(`✨ Đã chọn bộ emoji rơi ${btn.dataset.emojiPreset}`);
    });
  });

  if ($('themeNameInput')) {
    $('themeNameInput').addEventListener('change', () => {
      if (!canEditSelectedTheme()) return;
      saveSelectedThemeEdits('🎨 Đã đổi tên theme & lưu vào Drive ✓');
    });
  }
  ['driveUrl', 'driveFolder'].forEach((id) => {
    if ($(id)) $(id).addEventListener('input', () => renderThemeStudio());
  });
  window.addEventListener('thefloor:theme-library-updated', (e) => {
    if (e && e.detail) {
      themeLibrary = sanitizeThemeLibrary(e.detail);
      renderThemeStudio();
    }
  });

  // Gắn sự kiện List nhạc nền riêng theo từng Theme
  if ($('btnThemeBgmPickAudio') && $('fileThemeBgmAudio')) {
    $('btnThemeBgmPickAudio').addEventListener('click', () => {
      const curTheme = getSelectedTheme();
      if (!curTheme || !canEditSelectedTheme(curTheme)) {
        if ($('drivePanel')) $('drivePanel').open = true;
        setThemeBgmNotice('Vui lòng nhập đúng Apps Script Web App URL và Folder ID để tải nhạc cho Theme.', true);
        return;
      }
      if (!hasValidDriveIdentity()) {
        if ($('drivePanel')) $('drivePanel').open = true;
        setThemeBgmNotice('Vui lòng nhập Apps Script Web App URL và Folder ID hợp lệ trước khi tải nhạc.', true);
        return;
      }
      $('fileThemeBgmAudio').click();
    });
    $('fileThemeBgmAudio').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (file) handleThemeBgmDriveUpload(file);
    });
  }
  if ($('btnThemeBgmAddYoutube')) {
    $('btnThemeBgmAddYoutube').addEventListener('click', () => handleThemeBgmAddYoutube());
  }
  if ($('themeBgmYtUrl')) {
    $('themeBgmYtUrl').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleThemeBgmAddYoutube();
      }
    });
  }
  if ($('themeBgmList')) {
    $('themeBgmList').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-thbgm-act]');
      if (!btn) return;
      const row = btn.closest('[data-thbgm-id]');
      if (!row) return;
      const id = row.dataset.thbgmId;
      const rowThemeId = row.dataset.thbgmThemeId || '';
      const curTheme = getSelectedTheme();
      if (!curTheme) return;
      if (rowThemeId && rowThemeId !== curTheme.id) return;
      const track = asArr(curTheme.bgmList).find((x) => x && x.id === id);
      if (!track) return;
      if (btn.dataset.thbgmAct === 'play') {
        toggleThemeBgmPreview(track);
      } else if (btn.dataset.thbgmAct === 'delete') {
        handleThemeBgmDelete(id);
      }
    });
  }

  window.addEventListener('pagehide', () => {
    stopThemeBgmPreview();
    if (themeLibrarySync && typeof themeLibrarySync.dispose === 'function') {
      try { themeLibrarySync.dispose(); } catch { /* ignore */ }
      themeLibrarySync = null;
    }
  });

  $('btnPreviewAll').addEventListener('click', () => {
    if (!cur() || !cur().items.length) return toast('Chủ đề chưa có ảnh.', true);
    pvI = 0;
    $('previewModal').classList.remove('hidden');
    showPreview();
  });
  $('pvClose').addEventListener('click', () => $('previewModal').classList.add('hidden'));
  $('pvNext').addEventListener('click', () => { pvI += 1; showPreview(); });
  $('pvPrev').addEventListener('click', () => { pvI -= 1; showPreview(); });
  window.addEventListener('keydown', (e) => {
    if ($('deleteConfirmModal') && !$('deleteConfirmModal').classList.contains('hidden')) {
      if (e.key === 'Escape') closeDeleteModal();
      return;
    }
    if ($('previewModal').classList.contains('hidden')) return;
    if (e.key === 'ArrowRight') { pvI += 1; showPreview(); }
    if (e.key === 'ArrowLeft') { pvI -= 1; showPreview(); }
    if (e.key === 'Escape') $('previewModal').classList.add('hidden');
  });
}

window.addEventListener('beforeunload', (e) => {
  if (uploading) {
    e.preventDefault();
    e.returnValue = '';
  }
});

bind();
bgm = initBgm({ autoPlay: false, page: 'topics', getDriveIdentity: getCurrentDriveIdentity });
render();
renderThemeStudio();
initCloudSync();
initThemeStudioSync();
