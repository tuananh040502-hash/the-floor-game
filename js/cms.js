import { CATEGORIES } from './data.js';
import { loadFirebaseConfig } from './firebase-config.js';
import { createSharedTopicsSync, sanitizeCloudTopic } from './transport.js';
import {
  TOPICS_KEY, loadCustom, saveCustom, newId, loadDrive, saveDrive,
  parseVictoryAudio, normalizeVictoryAudioUrl,
  saveTopicAudioIDB, loadTopicAudioIDB, deleteTopicAudioIDB, encodeAudioFile,
  clampVolume01, sanitizeItem, sanitizeTopic, exportPayload, parseImport,
} from './topics.js';
import { normalizeImageUrl, driveFallbackUrl } from './engine.js';
import { Sfx } from './audio.js';

export const MAX_TOPIC_IMAGES = 100;

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const room = params.get('room');
$('backLink').href = room ? `game.html?role=host&room=${encodeURIComponent(room)}` : 'index.html';

function loadTopicsUpToLimit() {
  const base = loadCustom();
  try {
    const raw = JSON.parse(localStorage.getItem(TOPICS_KEY) || 'null');
    if (Array.isArray(raw)) {
      const byId = new Map(raw.map((t) => [t && t.id, t]));
      base.forEach((t) => {
        const src = byId.get(t.id);
        if (src && Array.isArray(src.items) && src.items.length > t.items.length) {
          t.items = src.items.map(sanitizeItem).filter(Boolean).slice(0, MAX_TOPIC_IMAGES);
        }
      });
    }
  } catch { /* ignore */ }
  return base;
}

let topics = loadTopicsUpToLimit();
let currentId = topics[0] ? topics[0].id : null;
let uploading = false;
let cloudSync = null;
let initialMigrationDone = false;
let pendingDeleteId = null;

const cur = () => topics.find((t) => t.id === currentId) || null;

/** Lưu bản đệm cục bộ vào localStorage (giữ tối đa 100 ảnh mỗi chủ đề). */
function persistLocalCache() {
  saveCustom(topics);
  try {
    const saved = JSON.parse(localStorage.getItem(TOPICS_KEY) || 'null');
    if (Array.isArray(saved)) {
      const byId = new Map(topics.map((t) => [t.id, t]));
      let changed = false;
      saved.forEach((st) => {
        const src = byId.get(st && st.id);
        if (src && Array.isArray(src.items) && src.items.length > (st.items?.length || 0)) {
          st.items = src.items.slice(0, MAX_TOPIC_IMAGES);
          changed = true;
        }
      });
      if (changed) localStorage.setItem(TOPICS_KEY, JSON.stringify(saved));
    }
  } catch { /* ignore */ }
}

/**
 * Lưu thay đổi vào localStorage cache và ghi trực tiếp lên nhánh `shared_topics` (Firebase).
 * @param {object|'all'|null} target - Chủ đề cần đẩy lên Cloud, hoặc 'all' để đồng bộ toàn bộ.
 */
function persist(target = cur()) {
  persistLocalCache();
  updateCloudCountBadge();
  if (!cloudSync || cloudSync.mode !== 'firebase') return;
  if (target === 'all') {
    cloudSync.putMany(topics);
  } else if (target && typeof target === 'object' && target.id) {
    target.updatedAt = Date.now();
    cloudSync.putTopic(target);
  }
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

  const cloudById = new Map((cloudList || []).map((t) => [t.id, t]));

  // Auto-Migration ngay khi khởi tạo: đẩy các chủ đề cục bộ chưa có trên shared_topics lên Firebase
  if (!initialMigrationDone) {
    initialMigrationDone = true;
    const missingOnCloud = localBefore.filter((lt) => lt && lt.id && !cloudById.has(lt.id));
    if (missingOnCloud.length && cloudSync && cloudSync.mode === 'firebase') {
      missingOnCloud.forEach((lt) => {
        const clean = sanitizeCloudTopic(lt, MAX_TOPIC_IMAGES);
        if (clean) cloudById.set(clean.id, clean);
      });
      const count = await cloudSync.putMany(missingOnCloud);
      if (count > 0) {
        toast(`☁️ Đã tự động đồng bộ ${count} chủ đề cũ từ máy lên Kho dùng chung.`);
      }
    }
  }

  const merged = [...cloudById.values()].map((ct) => {
    const sanitized = sanitizeTopic({ ...ct, items: [] });
    if (!sanitized) return null;
    sanitized.items = (ct.items || []).map(sanitizeItem).filter(Boolean).slice(0, MAX_TOPIC_IMAGES);
    sanitized.updatedAt = ct.updatedAt || 0;
    const vc = voiceCache.get(sanitized.id);
    if (vc) {
      if (vc.victoryVoiceData) sanitized.victoryVoiceData = vc.victoryVoiceData;
      if (!sanitized.victoryVoiceName && vc.victoryVoiceName) sanitized.victoryVoiceName = vc.victoryVoiceName;
    }
    return sanitized;
  }).filter(Boolean);

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
    const remoteList = await cloudSync.fetchAll();
    const remoteIds = new Set(remoteList.map((r) => r.id));
    const localUnsynced = topics.filter((t) => t && t.id && !remoteIds.has(t.id));
    if (localUnsynced.length) {
      await cloudSync.putMany(localUnsynced);
    }
    if (cur()) {
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
    el.innerHTML = `<span class="topic-icon">${esc(t.icon)}</span><span class="flex-1 truncate font-semibold">${esc(t.name)}</span>${audioDots}<span class="text-xs t-3 font-semibold">${t.items.length}/${MAX_TOPIC_IMAGES}</span>`;
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

function render() {
  renderTopics();
  updateCloudCountBadge();
  const t = cur();
  $('emptyState').classList.toggle('hidden', !!t);
  $('editorBody').classList.toggle('hidden', !t);
  if (!t) return;
  hydrateTopicVoice(t);
  if (document.activeElement !== $('tName')) $('tName').value = t.name;
  if (document.activeElement !== $('tIcon')) $('tIcon').value = t.icon;
  if (document.activeElement !== $('tVictoryAudio')) $('tVictoryAudio').value = t.victoryAudioUrl || '';
  renderAudioBadges(t);
  $('tShuffle').checked = !!t.shuffle;
  $('countNow').textContent = t.items.length;
  $('countMax').textContent = MAX_TOPIC_IMAGES;
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
  const frag = document.createDocumentFragment();
  t.items.forEach((it, i) => {
    if (it.type === 'img' && it.src) {
      it.src = normalizeImageUrl(it.src) || it.src;
    }
    const card = document.createElement('div');
    card.className = 'photo-card';
    card.draggable = true;
    card.dataset.idx = String(i);
    const art = it.type === 'emoji'
      ? `<div class="photo-emoji">${esc(it.emoji)}</div>`
      : `<img loading="lazy" referrerpolicy="no-referrer" src="${esc(it.src)}" alt="">`;
    card.innerHTML = `
      <div class="photo-frame" title="Kéo để đổi thứ tự">
        ${art}
        <span class="photo-num">${i + 1}</span>
        <div class="photo-actions">
          <button type="button" data-a="up" title="Lên trước" ${i === 0 ? 'disabled' : ''}>‹</button>
          <button type="button" data-a="down" title="Xuống sau" ${i === t.items.length - 1 ? 'disabled' : ''}>›</button>
          <button type="button" data-a="del" class="danger" title="Xóa ảnh">✕</button>
        </div>
      </div>
      <input class="photo-input" data-f="answer" value="${esc(it.answer)}" maxlength="120" placeholder="Đáp án chuẩn" />
      <input class="photo-input sub" data-f="aliases" value="${esc((it.aliases || []).join(', '))}" placeholder="Đáp án phụ (cách nhau bằng dấu phẩy)" />`;

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
      persist(t);
      ok += 1;
      render();
    } catch (err) {
      failed.push(`${f.name} (${err.message})`);
    }
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
  const url = $('driveUrl').value.trim();
  const folderId = $('driveFolder').value.trim();
  if (url && !/^https:\/\/script\.google\.com\/(macros\/s\/|a\/)/.test(url)) {
    toast('URL phải bắt đầu bằng https://script.google.com/macros/s/…/exec', true);
    return;
  }
  saveDrive({ url, folderId });
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
          if (rawT && Array.isArray(rawT.items) && rawT.items.length > t.items.length) {
            t.items = rawT.items.map(sanitizeItem).filter(Boolean).slice(0, MAX_TOPIC_IMAGES);
          }
        });
      } catch { /* ignore */ }
      const replace = topics.length && confirm(`Tìm thấy ${incoming.length} chủ đề.\nOK = THAY THẾ toàn bộ chủ đề trên Kho dùng chung\nHủy = GỘP thêm vào danh sách hiện có`);
      if (replace) topics = [];
      const used = new Set(topics.map((t) => t.id));
      incoming.forEach((t) => {
        if (used.has(t.id)) t.id = newId();
        used.add(t.id);
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

// ---------- Xác nhận xóa chủ đề (Chống xóa nhầm trên Cloud) ----------
function openDeleteModal(t) {
  if (!t) return;
  const modal = $('deleteConfirmModal');
  if (!modal) {
    // Fallback an toàn nếu thiếu modal
    if (confirm(`Xác nhận xóa chủ đề dùng chung “${t.name}” (${t.items.length} ảnh) khỏi tất cả thiết bị?`)) {
      executeDeleteTopic(t.id);
    }
    return;
  }
  pendingDeleteId = t.id;
  if ($('delModalTopicName')) $('delModalTopicName').textContent = `${t.icon || '🖼️'} ${t.name}`;
  if ($('delModalTopicCount')) $('delModalTopicCount').textContent = `Gồm ${t.items.length} câu hỏi ảnh · Nhánh shared_topics`;
  if ($('delConfirmCheck')) $('delConfirmCheck').checked = false;
  if ($('btnConfirmDeleteTopic')) $('btnConfirmDeleteTopic').disabled = true;
  modal.classList.remove('hidden');
}

function closeDeleteModal() {
  pendingDeleteId = null;
  const modal = $('deleteConfirmModal');
  if (modal) modal.classList.add('hidden');
}

async function executeDeleteTopic(targetId) {
  const t = topics.find((x) => x.id === targetId);
  if (!t) {
    closeDeleteModal();
    return;
  }
  const removedName = t.name;
  Sfx.stopVictory();
  closeDeleteModal();
  await deleteTopicAudioIDB(t.id);
  topics = topics.filter((x) => x.id !== t.id);
  currentId = topics[0] ? topics[0].id : null;
  persistLocalCache();
  updateCloudCountBadge();
  render();
  if (cloudSync && cloudSync.mode === 'firebase') {
    await cloudSync.removeTopic(t.id);
  }
  toast(`Đã xóa chủ đề “${removedName}” khỏi Kho chủ đề dùng chung.`);
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
    const i = Number(card.dataset.idx);
    const a = actBtn.dataset.a;
    if (a === 'up') move(i, i - 1);
    else if (a === 'down') move(i, i + 1);
    else if (a === 'del') {
      t.items.splice(i, 1);
      persist(t);
      render();
    }
  });
  box.addEventListener('dragstart', (e) => {
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
    const card = e.target.closest('.photo-card');
    if (!card) return;
    e.preventDefault();
    e.stopPropagation();
    card.classList.remove('row-over');
    move(dragIndex, Number(card.dataset.idx));
  });

  $('btnNew').addEventListener('click', () => {
    const name = prompt('Tên chủ đề mới (ví dụ: Cầu thủ bóng đá):');
    if (!name || !name.trim()) return;
    const t = sanitizeTopic({ id: newId(), name, icon: '🖼️', shuffle: false, items: [] });
    topics.push(t);
    currentId = t.id;
    persist(t);
    render();
    toast(`Đã tạo chủ đề “${t.name}” trên Kho dùng chung.`);
  });

  $('btnClone').addEventListener('click', () => {
    const menu = CATEGORIES.map((c, i) => `${i + 1}. ${c.icon} ${c.name} (${c.items.length})`).join('\n');
    const n = parseInt(prompt(`Nhân bản chủ đề nào? Nhập số:\n${menu}`), 10);
    const src = CATEGORIES[n - 1];
    if (!src) return;
    const t = sanitizeTopic({
      id: newId(), name: `${src.name} (bản sao)`, icon: src.icon, shuffle: true,
      items: src.items.slice(0, MAX_TOPIC_IMAGES),
    });
    topics.push(t);
    currentId = t.id;
    persist(t);
    render();
    toast(`Đã nhân bản “${src.name}” lên Kho dùng chung.`);
  });

  $('tName').addEventListener('change', () => {
    const t = cur();
    const v = $('tName').value.trim();
    if (!t || !v) return render();
    t.name = v;
    persist(t);
    renderTopics();
  });
  $('tIcon').addEventListener('change', () => {
    const t = cur();
    const v = $('tIcon').value.trim();
    if (!t || !v) return render();
    t.icon = v.slice(0, 8);
    persist(t);
    renderTopics();
  });
  $('tShuffle').addEventListener('change', () => {
    const t = cur();
    if (!t) return;
    t.shuffle = $('tShuffle').checked;
    persist(t);
  });

  // --- Kênh 1: Tải file âm thanh từ máy (.mp3, .m4a, .wav) + Thanh trượt âm lượng 1 ---
  $('btnPickVoiceAudio').addEventListener('click', () => $('fileVoiceAudio').click());
  $('fileVoiceAudio').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    const t = cur();
    if (!file || !t) return;
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
    const pct = Math.max(0, Math.min(100, Number(e.target.value) || 0));
    $('tLocalAudioVolLabel').textContent = `${pct}%`;
    const vol01 = clampVolume01(pct / 100, 1.0);
    Sfx.setLocalVolume(vol01);
    if (t) {
      t.localAudioVolume = vol01;
      renderAudioBadges(t);
    }
  });
  $('tLocalAudioVol').addEventListener('change', async (e) => {
    const t = cur();
    if (!t) return;
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
    if (!t) return;
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
    const pct = Math.max(0, Math.min(100, Number(e.target.value) || 0));
    $('tOnlineAudioVolLabel').textContent = `${pct}%`;
    const vol01 = clampVolume01(pct / 100, 1.0);
    Sfx.setOnlineVolume(vol01);
    if (t) {
      t.onlineAudioVolume = vol01;
      renderAudioBadges(t);
    }
  });
  $('tOnlineAudioVol').addEventListener('change', async (e) => {
    const t = cur();
    if (!t) return;
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
    Sfx.unlock();
    const raw = $('tVictoryAudio').value.trim();
    if (raw && !parseVictoryAudio(raw)) {
      toast('Link nhạc không hợp lệ.', true);
      return;
    }
    if (raw !== (t.victoryAudioUrl || '')) {
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
    Sfx.unlock();
    const raw = $('tVictoryAudio').value.trim();
    if (raw !== (t.victoryAudioUrl || '')) {
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
    if (!t || !t.items.length || !confirm(`Xóa tất cả ${t.items.length} ảnh trong chủ đề “${t.name}” trên Kho dùng chung?`)) return;
    t.items = [];
    persist(t);
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
render();
initCloudSync();
