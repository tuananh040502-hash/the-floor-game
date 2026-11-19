import { loadFirebaseConfig } from './firebase-config.js?v=iosfix15';
import {
  createSharedTopicsSync, sanitizeCloudTopic, getTopicCoverThumb, normalizeCoverUrl, toThumbUrl400,
  normalizeScriptUrl, normalizeFolderId, extractTopicDriveFileIds, extractDriveId,
  canIdentityModifyTopic, getDeletedTopicIds, markTopicDeleted,
} from './transport.js?v=bgm1';
import {
  TOPICS_KEY, loadCustom, saveCustom, newId, loadDrive, saveDrive,
  parseVictoryAudio, normalizeVictoryAudioUrl,
  saveTopicAudioIDB, loadTopicAudioIDB, deleteTopicAudioIDB, encodeAudioFile,
  clampVolume01, sanitizeItem, sanitizeTopic, exportPayload, parseImport,
} from './topics.js?v=iosfix15';
import {
  normalizeImageUrl, driveFallbackUrl, isLegacyEmojiSampleTopic,
  purgeEmptyAndDefaultTopics,
} from './engine.js?v=iosfix15';
import { Sfx } from './audio.js?v=iosfix15';
import { initBgm } from './bgm.js?v=bgm1';

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
      const base = sanitizeTopic({ ...src, items: [] });
      if (!base) return null;
      base.icon = '';
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
    const sanitized = sanitizeTopic({ ...ct, items: [] });
    if (!sanitized) return null;
    sanitized.icon = '';
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
    const hasVoice = !!(t.victoryVoiceData || t.victoryVoiceName);
    const hasMusic = !!t.victoryAudioUrl;
    const audioDots = `${hasVoice ? '<span title="Có file ghi âm / SFX riêng">🎙️</span>' : ''}${hasMusic ? '<span title="Có link nhạc chiến thắng riêng">🎵</span>' : ''}`;
    el.innerHTML = `<span class="flex-1 truncate font-semibold">${esc(t.name)}</span>${audioDots}<span class="text-xs t-3 font-semibold">${t.items.length}/${MAX_TOPIC_IMAGES}</span>`;
    frag.appendChild(el);
  });
  list.appendChild(frag);
}

async function hydrateTopicVoice(t) {
  if (!t || t.victoryVoiceData) return;
  try {
    const rec = await loadTopicAudioIDB(t.id);
    if (rec && rec.dataUrl) {
      t.victoryVoiceData = rec.dataUrl;
      if (!t.victoryVoiceName && rec.name) t.victoryVoiceName = rec.name;
      if (rec.localAudioVolume !== undefined && t.localAudioVolume === undefined) {
        t.localAudioVolume = clampVolume01(rec.localAudioVolume, 1.0);
      }
      if (rec.onlineAudioVolume !== undefined && t.onlineAudioVolume === undefined) {
        t.onlineAudioVolume = clampVolume01(rec.onlineAudioVolume, 1.0);
      }
      renderAudioBadges(t);
    }
  } catch { /* ignore */ }
}

function renderAudioBadges(t) {
  const extUrl = t ? t.victoryAudioUrl : '';
  const hasVoice = !!(t && (t.victoryVoiceData || t.victoryVoiceName));
  const p = parseVictoryAudio(extUrl);
  const localPct = Math.round(clampVolume01(t?.localAudioVolume, 1.0) * 100);
  const onlinePct = Math.round(clampVolume01(t?.onlineAudioVolume, 1.0) * 100);

  const localSlider = $('tLocalAudioVol');
  const localLabel = $('tLocalAudioVolLabel');
  if (localSlider && document.activeElement !== localSlider) localSlider.value = String(localPct);
  if (localLabel) localLabel.textContent = `${localPct}%`;

  const onlineSlider = $('tOnlineAudioVol');
  const onlineLabel = $('tOnlineAudioVolLabel');
  if (onlineSlider && document.activeElement !== onlineSlider) onlineSlider.value = String(onlinePct);
  if (onlineLabel) onlineLabel.textContent = `${onlinePct}%`;

  const extBadge = $('victoryAudioBadge');
  if (extBadge) {
    if (!p) {
      extBadge.textContent = 'Không dùng';
    } else {
      const map = {
        youtube: 'YouTube',
        soundcloud: 'SoundCloud',
        direct: p.driveId ? 'Google Drive Audio' : 'Direct Audio',
      };
      extBadge.textContent = `✓ ${map[p.kind] || 'Tùy chỉnh'}`;
    }
  }

  const voiceBadge = $('voiceAudioBadge');
  if (voiceBadge) {
    voiceBadge.textContent = hasVoice ? `✓ ${t.victoryVoiceName || 'File ghi âm đã lưu'}` : 'Chưa có file';
  }
  const testVoiceBtn = $('btnTestVoiceOnly');
  if (testVoiceBtn) testVoiceBtn.classList.toggle('hidden', !hasVoice);
  const clearVoiceBtn = $('btnClearVoiceAudio');
  if (clearVoiceBtn) clearVoiceBtn.classList.toggle('hidden', !hasVoice);

  const dualBadge = $('dualAudioModeBadge');
  if (dualBadge) {
    if (hasVoice && p) {
      dualBadge.textContent = `Phối âm kép · File ${localPct}% + Nhạc ${onlinePct}%`;
    } else if (p) {
      dualBadge.textContent = `Nhạc ngoài · ${onlinePct}%`;
    } else if (hasVoice) {
      dualBadge.textContent = `File máy · ${localPct}% + Fanfare`;
    } else {
      dualBadge.textContent = 'Mặc định (Fanfare)';
    }
  }
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
  $('emptyState').classList.toggle('hidden', !!t);
  $('editorBody').classList.toggle('hidden', !t);
  if (!t) return;
  hydrateTopicVoice(t);
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
  if ($('tVictoryAudio')) {
    if (document.activeElement !== $('tVictoryAudio')) $('tVictoryAudio').value = t.victoryAudioUrl || '';
    $('tVictoryAudio').readOnly = !editable;
    $('tVictoryAudio').disabled = !editable;
  }
  renderCoverEditor(t);
  renderAudioBadges(t);
  $('tShuffle').checked = !!t.shuffle;
  $('tShuffle').disabled = !editable;
  $('countNow').textContent = t.items.length;
  $('countMax').textContent = MAX_TOPIC_IMAGES;

  if ($('tCoverUrl')) {
    $('tCoverUrl').readOnly = !editable;
    $('tCoverUrl').disabled = !editable;
  }
  ['btnApplyCoverUrl', 'btnPickCoverFile', 'btnPickVoiceAudio', 'btnClearItems', 'btnDeleteTopic'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.disabled = !editable;
    el.classList.toggle('hidden', !editable);
  });
  if ($('btnClearCoverUrl') && !editable) {
    $('btnClearCoverUrl').classList.add('hidden');
  }
  if ($('btnClearVoiceAudio') && !editable) {
    $('btnClearVoiceAudio').classList.add('hidden');
  }
  if ($('tLocalAudioVol')) $('tLocalAudioVol').disabled = !editable;
  if ($('tOnlineAudioVol')) $('tOnlineAudioVol').disabled = !editable;
  if ($('addImagesSection')) {
    $('addImagesSection').classList.toggle('hidden', !editable);
  }
  if ($('btnAddLinks')) $('btnAddLinks').disabled = !editable;
  if ($('btnPick')) $('btnPick').disabled = !editable;
  if ($('linkArea')) {
    $('linkArea').readOnly = !editable;
    $('linkArea').disabled = !editable;
  }

  renderItems();
}

// ---------- Bảng ảnh (Event Delegation chống rò rỉ bộ nhớ) ----------
let dragIndex = null;

function renderItems() {
  const t = cur();
  const box = $('itemList');
  box.innerHTML = '';
  if (!t.items.length) {
    box.innerHTML = '<div class="t-3 text-center py-10" style="grid-column:1/-1">Chưa có ảnh nào. Hãy tải ảnh lên hoặc dán link.</div>';
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

// ---------- Thêm ảnh qua link ----------
function addLinks() {
  const t = cur();
  if (!t) return;
  if (!canEditTopic(t)) {
    if ($('drivePanel')) $('drivePanel').open = true;
    toast(EDIT_DENIED_MSG, true);
    return;
  }
  const lines = $('linkArea').value.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return;
  let added = 0;
  let bad = 0;
  let full = 0;
  for (const line of lines) {
    if (t.items.length >= MAX_TOPIC_IMAGES) {
      full += 1;
      continue;
    }
    const [urlPart, ...rest] = line.split('|');
    const src = normalizeImageUrl(urlPart);
    if (!src) {
      bad += 1;
      continue;
    }
    const answer = rest.join('|').trim() || guessName(src) || `Ảnh ${t.items.length + 1}`;
    t.items.push({ type: 'img', src, answer, aliases: [] });
    added += 1;
  }
  persist(t);
  $('linkArea').value = '';
  render();
  toast(`Đã thêm ${added} ảnh.${bad ? ` ${bad} link không hợp lệ.` : ''}${full ? ` ${full} link bị bỏ vì chủ đề đã đủ ${MAX_TOPIC_IMAGES} ảnh.` : ''}`, bad || full);
}

function guessName(src) {
  try {
    const last = decodeURIComponent(new URL(src).pathname.split('/').pop() || '');
    return cleanName(last);
  } catch {
    return '';
  }
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
    $('drivePanel').open = true;
    toast('Hãy nhập Web App URL và Folder ID Google Drive trước (hoặc dùng “Dán link ảnh”).', true);
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
  if (bgm) bgm.refreshDriveIdentity();
  toast('Đã lưu cấu hình Google Drive.');
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
        stampOwnership(t);
        if (t.victoryVoiceData) {
          saveTopicAudioIDB(t.id, t.victoryVoiceData, t.victoryVoiceName || '');
        }
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
  Sfx.stopVictory();
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

function topicAudioSpec(t) {
  if (!t) {
    return {
      url: '', topicId: '', voiceData: '', voiceName: '',
      localAudioVolume: 1.0, onlineAudioVolume: 1.0,
    };
  }
  return {
    url: t.victoryAudioUrl || '',
    topicId: t.id || '',
    voiceData: t.victoryVoiceData || '',
    voiceName: t.victoryVoiceName || '',
    localAudioVolume: clampVolume01(t.localAudioVolume, 1.0),
    onlineAudioVolume: clampVolume01(t.onlineAudioVolume, 1.0),
  };
}

// ---------- Gắn sự kiện ----------
function bind() {
  ['btnSyncCloud', 'btnSyncCloudTop'].forEach((id) => {
    const btn = $(id);
    if (btn) btn.addEventListener('click', manualSyncCloud);
  });

  // Event delegation cho danh sách chủ đề
  $('topicList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-topic-id]');
    if (!btn) return;
    Sfx.stopVictory();
    currentId = btn.dataset.topicId;
    render();
  });

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
    const t = sanitizeTopic({ id: newId(), name: name.trim(), icon: '', shuffle: false, items: [] });
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
      id: newId(), name: `${src.name} (bản sao)`, icon: '', shuffle: !!src.shuffle,
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
  $('tShuffle').addEventListener('change', () => {
    const t = cur();
    if (!t) return;
    if (!canEditTopic(t)) {
      $('tShuffle').checked = !!t.shuffle;
      toast(EDIT_DENIED_MSG, true);
      return;
    }
    t.shuffle = $('tShuffle').checked;
    persist(t);
  });

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

  // --- Kênh 1: Tải file âm thanh từ máy (.mp3, .m4a, .wav) + Thanh trượt âm lượng 1 ---
  $('btnPickVoiceAudio').addEventListener('click', () => {
    const t = cur();
    if (!t || !canEditTopic(t)) {
      toast(EDIT_DENIED_MSG, true);
      return;
    }
    $('fileVoiceAudio').click();
  });
  $('fileVoiceAudio').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    const t = cur();
    if (!file || !t) return;
    if (!canEditTopic(t)) {
      toast(EDIT_DENIED_MSG, true);
      return;
    }
    try {
      toast(`Đang xử lý & lưu file âm thanh “${file.name}”…`);
      const { dataUrl, name } = await encodeAudioFile(file);
      t.victoryVoiceData = dataUrl;
      t.victoryVoiceName = name;
      if (t.localAudioVolume === undefined) t.localAudioVolume = 1.0;
      await saveTopicAudioIDB(t.id, dataUrl, name, {
        localAudioVolume: clampVolume01(t.localAudioVolume, 1.0),
        onlineAudioVolume: clampVolume01(t.onlineAudioVolume, 1.0),
      });
      persist(t);
      renderAudioBadges(t);
      renderTopics();
      await Sfx.preloadVictory(topicAudioSpec(t));
      toast(`Đã lưu file âm thanh “${name}” vào IndexedDB & đồng bộ cấu hình.`);
    } catch (err) {
      toast(err.message || 'Không thể đọc file âm thanh.', true);
    }
  });

  $('tLocalAudioVol').addEventListener('input', (e) => {
    const t = cur();
    if (!t || !canEditTopic(t)) return;
    const pct = Math.max(0, Math.min(100, Number(e.target.value) || 0));
    $('tLocalAudioVolLabel').textContent = `${pct}%`;
    const vol01 = clampVolume01(pct / 100, 1.0);
    Sfx.setLocalVolume(vol01);
    t.localAudioVolume = vol01;
    renderAudioBadges(t);
  });
  $('tLocalAudioVol').addEventListener('change', async (e) => {
    const t = cur();
    if (!t) return;
    if (!canEditTopic(t)) {
      toast(EDIT_DENIED_MSG, true);
      render();
      return;
    }
    const pct = Math.max(0, Math.min(100, Number(e.target.value) || 0));
    t.localAudioVolume = clampVolume01(pct / 100, 1.0);
    persist(t);
    if (t.victoryVoiceData) {
      await saveTopicAudioIDB(t.id, t.victoryVoiceData, t.victoryVoiceName || '', {
        localAudioVolume: t.localAudioVolume,
        onlineAudioVolume: clampVolume01(t.onlineAudioVolume, 1.0),
      });
    }
  });

  $('btnClearVoiceAudio').addEventListener('click', async () => {
    const t = cur();
    if (!t || !canEditTopic(t)) {
      toast(EDIT_DENIED_MSG, true);
      return;
    }
    Sfx.stopVictory();
    t.victoryVoiceData = '';
    t.victoryVoiceName = '';
    await deleteTopicAudioIDB(t.id);
    persist(t);
    renderAudioBadges(t);
    renderTopics();
    toast('Đã xóa file ghi âm khỏi chủ đề.');
  });

  $('btnTestVoiceOnly').addEventListener('click', async () => {
    const t = cur();
    if (!t || !(t.victoryVoiceData || t.victoryVoiceName)) {
      toast('Chưa có file âm thanh từ máy.', true);
      return;
    }
    if (bgm) bgm.pausePreview();
    Sfx.unlock();
    const spec = topicAudioSpec(t);
    const pct = Math.round(spec.localAudioVolume * 100);
    toast(`Đang phát thử file “${t.victoryVoiceName || 'Ghi âm'}” ở mức ${pct}%…`);
    const ok = await Sfx.previewVoiceOnly(spec);
    if (!ok) toast('Không phát được file âm thanh này.', true);
  });

  // --- Kênh 2: Link nhạc nền ngoài + Thanh trượt âm lượng 2 ---
  $('tVictoryAudio').addEventListener('change', () => {
    const t = cur();
    if (!t) return;
    if (!canEditTopic(t)) {
      toast(EDIT_DENIED_MSG, true);
      $('tVictoryAudio').value = t.victoryAudioUrl || '';
      return;
    }
    const raw = $('tVictoryAudio').value.trim();
    if (raw && !parseVictoryAudio(raw)) {
      toast('Link âm thanh không hợp lệ (hãy nhập URL http/https).', true);
      $('tVictoryAudio').value = t.victoryAudioUrl || '';
      return;
    }
    t.victoryAudioUrl = normalizeVictoryAudioUrl(raw);
    $('tVictoryAudio').value = t.victoryAudioUrl;
    persist(t);
    renderAudioBadges(t);
    renderTopics();
    if (t.victoryAudioUrl || t.victoryVoiceData) {
      Sfx.preloadVictory(topicAudioSpec(t));
      toast('Đã lưu cấu hình âm thanh chiến thắng & đồng bộ Cloud.');
    } else {
      Sfx.stopVictory();
      toast('Đã đặt về âm thanh chiến thắng mặc định.');
    }
  });

  $('tOnlineAudioVol').addEventListener('input', (e) => {
    const t = cur();
    if (!t || !canEditTopic(t)) return;
    const pct = Math.max(0, Math.min(100, Number(e.target.value) || 0));
    $('tOnlineAudioVolLabel').textContent = `${pct}%`;
    const vol01 = clampVolume01(pct / 100, 1.0);
    Sfx.setOnlineVolume(vol01);
    t.onlineAudioVolume = vol01;
    renderAudioBadges(t);
  });
  $('tOnlineAudioVol').addEventListener('change', async (e) => {
    const t = cur();
    if (!t) return;
    if (!canEditTopic(t)) {
      toast(EDIT_DENIED_MSG, true);
      render();
      return;
    }
    const pct = Math.max(0, Math.min(100, Number(e.target.value) || 0));
    t.onlineAudioVolume = clampVolume01(pct / 100, 1.0);
    persist(t);
    if (t.victoryVoiceData) {
      await saveTopicAudioIDB(t.id, t.victoryVoiceData, t.victoryVoiceName || '', {
        localAudioVolume: clampVolume01(t.localAudioVolume, 1.0),
        onlineAudioVolume: t.onlineAudioVolume,
      });
    }
  });

  $('btnTestExternalOnly').addEventListener('click', async () => {
    const t = cur();
    if (!t) return;
    if (bgm) bgm.pausePreview();
    Sfx.unlock();
    const raw = $('tVictoryAudio').value.trim();
    if (raw && !parseVictoryAudio(raw)) {
      toast('Link nhạc không hợp lệ.', true);
      return;
    }
    if (canEditTopic(t) && raw !== (t.victoryAudioUrl || '')) {
      t.victoryAudioUrl = normalizeVictoryAudioUrl(raw);
      persist(t);
      renderAudioBadges(t);
      renderTopics();
    }
    if (!t.victoryAudioUrl) {
      toast('Hãy dán link YouTube, SoundCloud hoặc MP3 trước.', true);
      return;
    }
    const spec = topicAudioSpec(t);
    const pct = Math.round(spec.onlineAudioVolume * 100);
    toast(`Đang nạp & phát thử link nhạc ngoài ở mức ${pct}%…`);
    await Sfx.previewExternalOnly(t.victoryAudioUrl, spec.onlineAudioVolume);
  });

  // --- Nghe thử phối âm (Dual Volume Sliders) ---
  $('btnTestVictoryAudio').addEventListener('click', async () => {
    const t = cur();
    if (!t) return;
    if (bgm) bgm.pausePreview();
    Sfx.unlock();
    const raw = $('tVictoryAudio').value.trim();
    if (canEditTopic(t) && raw !== (t.victoryAudioUrl || '')) {
      t.victoryAudioUrl = normalizeVictoryAudioUrl(raw);
      persist(t);
      renderAudioBadges(t);
      renderTopics();
    }
    const spec = topicAudioSpec(t);
    const hasVoice = !!(spec.voiceData || spec.voiceName);
    const hasExt = !!spec.url;
    const lPct = Math.round(spec.localAudioVolume * 100);
    const oPct = Math.round(spec.onlineAudioVolume * 100);
    if (hasVoice && hasExt) {
      toast(`Đang phát thử phối âm: File từ máy (${lPct}%) + Nhạc ngoài (${oPct}%).`);
    } else if (hasExt) {
      toast(`Đang phát thử nhạc ngoài ở mức ${oPct}%.`);
    } else if (hasVoice) {
      toast(`Đang phát thử file từ máy (${lPct}%) kết hợp nhạc chiến thắng.`);
    } else {
      toast('Đang phát thử nhạc chiến thắng mặc định (Fanfare).');
    }
    await Sfx.preloadVictory(spec);
    Sfx.finishSequence(spec);
  });

  $('btnStopVictoryAudio').addEventListener('click', () => {
    Sfx.stopVictory();
  });
  Sfx.onVictoryAudioChange((st) => {
    const stopBtn = $('btnStopVictoryAudio');
    if (stopBtn) stopBtn.classList.toggle('hidden', !st.playing);
  });

  // Bảo vệ xóa nhầm chủ đề dùng chung
  $('btnDeleteTopic').addEventListener('click', () => {
    const t = cur();
    if (!t) return;
    openDeleteModal(t);
  });
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

  $('btnAddLinks').addEventListener('click', addLinks);

  const dz = $('dropzone');
  $('btnPick').addEventListener('click', () => $('filePick').click());
  $('filePick').addEventListener('change', (e) => {
    handleFiles(e.target.files);
    e.target.value = '';
  });
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => {
    e.preventDefault();
    dz.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => {
    e.preventDefault();
    dz.classList.remove('over');
  }));
  dz.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));
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
initCloudSync();
