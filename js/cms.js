import { CATEGORIES } from './data.js';
import {
  MAX_ITEMS, loadCustom, saveCustom, newId, loadDrive, saveDrive, driveThumb,
  normalizeImageUrl, parseVictoryAudio, normalizeVictoryAudioUrl,
  saveTopicAudioIDB, loadTopicAudioIDB, deleteTopicAudioIDB, encodeAudioFile,
  sanitizeItem, sanitizeTopic, exportPayload, parseImport,
} from './topics.js';
import { Sfx } from './audio.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const room = params.get('room');
$('backLink').href = room ? `game.html?role=host&room=${encodeURIComponent(room)}` : 'index.html';

let topics = loadCustom();
let currentId = topics[0] ? topics[0].id : null;
let uploading = false;

const cur = () => topics.find((t) => t.id === currentId) || null;
const persist = () => saveCustom(topics);

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
    el.innerHTML = `<span class="topic-icon">${esc(t.icon)}</span><span class="flex-1 truncate font-semibold">${esc(t.name)}</span>${audioDots}<span class="text-xs t-3 font-semibold">${t.items.length}/${MAX_ITEMS}</span>`;
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
      renderAudioBadges(t);
    }
  } catch { /* ignore */ }
}

function renderAudioBadges(t) {
  const extUrl = t ? t.victoryAudioUrl : '';
  const hasVoice = !!(t && (t.victoryVoiceData || t.victoryVoiceName));
  const p = parseVictoryAudio(extUrl);

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
      dualBadge.textContent = 'Kịch bản 1 · Kép (File 100% + Nhạc 20%)';
    } else if (p) {
      dualBadge.textContent = 'Kịch bản 2 · Nhạc ngoài (100%)';
    } else if (hasVoice) {
      dualBadge.textContent = 'Kịch bản 3 · File máy (100%) + Fanfare';
    } else {
      dualBadge.textContent = 'Mặc định (Fanfare)';
    }
  }
}

function render() {
  renderTopics();
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
  $('countMax').textContent = MAX_ITEMS;
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
      img.addEventListener('error', () => {
        img.replaceWith(Object.assign(document.createElement('div'), {
          className: 'photo-emoji', textContent: '⚠️', title: 'Ảnh lỗi / không tải được — hãy xóa hoặc thay link',
        }));
      }, { once: true });
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
  persist();
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
    if (t.items.length >= MAX_ITEMS) {
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
  persist();
  $('linkArea').value = '';
  render();
  toast(`Đã thêm ${added} ảnh.${bad ? ` ${bad} link không hợp lệ.` : ''}${full ? ` ${full} link bị bỏ vì chủ đề đã đủ ${MAX_ITEMS} ảnh.` : ''}`, bad || full);
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
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('Không đọc được file.'));
    r.readAsDataURL(blob);
  });
}

/** Thu nhỏ ảnh (cạnh dài tối đa 1280px, JPEG) để tải nhanh. GIF/SVG giữ nguyên. */
async function prepareImage(file) {
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return { blob: file, name: file.name };
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.86));
    if (!blob) throw new Error('toBlob');
    return { blob, name: file.name.replace(/\.[^.]+$/, '') + '.jpg' };
  } catch {
    return { blob: file, name: file.name };
  }
}

async function uploadToDrive(cfg, blob, name) {
  const data = await readBase64(blob);
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // tránh preflight CORS với Apps Script
    body: JSON.stringify({ folderId: cfg.folderId, name, mime: blob.type || 'image/jpeg', data }),
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
  const room = MAX_ITEMS - t.items.length;
  if (room <= 0) {
    toast(`Chủ đề đã đủ ${MAX_ITEMS} ảnh.`, true);
    return;
  }
  if (files.length > room) {
    toast(`Chỉ còn chỗ cho ${room} ảnh — các ảnh dư sẽ bị bỏ qua.`, true);
    files = files.slice(0, room);
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
      } catch (e1) {
        id = await uploadToDrive(cfg, blob, name); // thử lại 1 lần
      }
      t.items.push({
        type: 'img',
        src: driveThumb(id),
        answer: cleanName(f.name) || `Ảnh ${t.items.length + 1}`,
        aliases: [],
      });
      persist();
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
  else toast(`Đã tải lên ${ok} ảnh. Hãy kiểm tra và sửa đáp án trong bảng bên dưới.`);
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
  reader.onload = () => {
    try {
      const incoming = parseImport(String(reader.result));
      const replace = topics.length && confirm(`Tìm thấy ${incoming.length} chủ đề.\nOK = THAY THẾ toàn bộ chủ đề hiện có\nHủy = GỘP thêm vào danh sách`);
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
      persist();
      render();
      toast(`Đã nhập ${incoming.length} chủ đề.`);
    } catch (e) {
      toast(e.message, true);
    }
  };
  reader.readAsText(file);
}

// ---------- Chạy thử ----------
let pvI = 0;
function showPreview() {
  const t = cur();
  if (!t || !t.items.length) return;
  pvI = (pvI + t.items.length) % t.items.length;
  const it = t.items[pvI];
  $('pvImg').innerHTML = it.type === 'emoji'
    ? `<div style="font-size:12rem;line-height:1">${esc(it.emoji)}</div>`
    : `<img src="${esc(it.src)}" referrerpolicy="no-referrer" style="max-height:55vh;max-width:100%;border-radius:8px" alt="">`;
  $('pvAnswer').textContent = it.answer;
  $('pvIdx').textContent = `${pvI + 1}/${t.items.length}`;
}

function topicAudioSpec(t) {
  if (!t) return { url: '', topicId: '', voiceData: '', voiceName: '' };
  return {
    url: t.victoryAudioUrl || '',
    topicId: t.id || '',
    voiceData: t.victoryVoiceData || '',
    voiceName: t.victoryVoiceName || '',
  };
}

// ---------- Gắn sự kiện ----------
function bind() {
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
      persist();
      toast('Đã lưu đáp án.');
    } else if (f === 'aliases') {
      it.aliases = e.target.value.split(',').map((x) => x.trim()).filter(Boolean);
      persist();
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
      persist();
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
    persist();
    render();
  });

  $('btnClone').addEventListener('click', () => {
    const menu = CATEGORIES.map((c, i) => `${i + 1}. ${c.icon} ${c.name} (${c.items.length})`).join('\n');
    const n = parseInt(prompt(`Nhân bản chủ đề nào? Nhập số:\n${menu}`), 10);
    const src = CATEGORIES[n - 1];
    if (!src) return;
    const t = sanitizeTopic({
      id: newId(), name: `${src.name} (bản sao)`, icon: src.icon, shuffle: true,
      items: src.items.slice(0, MAX_ITEMS),
    });
    topics.push(t);
    currentId = t.id;
    persist();
    render();
    toast(`Đã nhân bản “${src.name}”.`);
  });

  $('tName').addEventListener('change', () => {
    const t = cur();
    const v = $('tName').value.trim();
    if (!t || !v) return render();
    t.name = v;
    persist();
    renderTopics();
  });
  $('tIcon').addEventListener('change', () => {
    const t = cur();
    const v = $('tIcon').value.trim();
    if (!t || !v) return render();
    t.icon = v.slice(0, 8);
    persist();
    renderTopics();
  });
  $('tShuffle').addEventListener('change', () => {
    const t = cur();
    if (!t) return;
    t.shuffle = $('tShuffle').checked;
    persist();
  });

  // --- Kênh 1: Tải file âm thanh từ máy (.mp3, .m4a, .wav) ---
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
      await saveTopicAudioIDB(t.id, dataUrl, name);
      persist();
      renderAudioBadges(t);
      renderTopics();
      await Sfx.preloadVictory(topicAudioSpec(t));
      toast(`Đã lưu file âm thanh “${name}” vào IndexedDB & đồng bộ chủ đề.`);
    } catch (err) {
      toast(err.message || 'Không thể đọc file âm thanh.', true);
    }
  });

  $('btnClearVoiceAudio').addEventListener('click', async () => {
    const t = cur();
    if (!t) return;
    Sfx.stopVictory();
    t.victoryVoiceData = '';
    t.victoryVoiceName = '';
    await deleteTopicAudioIDB(t.id);
    persist();
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
    toast(`Đang phát thử file “${t.victoryVoiceName || 'Ghi âm'}” (100% âm lượng)…`);
    const ok = await Sfx.previewVoiceOnly(topicAudioSpec(t));
    if (!ok) toast('Không phát được file âm thanh này.', true);
  });

  // --- Kênh 2: Link nhạc nền ngoài ---
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
    persist();
    renderAudioBadges(t);
    renderTopics();
    if (t.victoryAudioUrl || t.victoryVoiceData) {
      Sfx.preloadVictory(topicAudioSpec(t));
      toast('Đã lưu cấu hình âm thanh chiến thắng & nạp sẵn bộ đệm.');
    } else {
      Sfx.stopVictory();
      toast('Đã đặt về âm thanh chiến thắng mặc định.');
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
      persist();
      renderAudioBadges(t);
      renderTopics();
    }
    if (!t.victoryAudioUrl) {
      toast('Hãy dán link YouTube, SoundCloud hoặc MP3 trước.', true);
      return;
    }
    toast('Đang nạp & phát thử link nhạc ngoài (100% âm lượng)…');
    await Sfx.previewExternalOnly(t.victoryAudioUrl);
  });

  // --- Nghe thử tổng hợp (Dual Audio & Auto-Ducking) ---
  $('btnTestVictoryAudio').addEventListener('click', async () => {
    const t = cur();
    if (!t) return;
    Sfx.unlock();
    const raw = $('tVictoryAudio').value.trim();
    if (raw !== (t.victoryAudioUrl || '')) {
      t.victoryAudioUrl = normalizeVictoryAudioUrl(raw);
      persist();
      renderAudioBadges(t);
      renderTopics();
    }
    const spec = topicAudioSpec(t);
    const hasVoice = !!(spec.voiceData || spec.voiceName);
    const hasExt = !!spec.url;
    if (hasVoice && hasExt) {
      toast('Kịch bản 1: Phát song song — File ghi âm (100%) + Nhạc nền ngoài (20% Auto-Ducking)!');
    } else if (hasExt) {
      toast('Kịch bản 2: Phát nhạc ngoài với âm lượng tối đa (100%)!');
    } else if (hasVoice) {
      toast('Kịch bản 3: Phát file ghi âm (100%) kết hợp hiệu ứng chiến thắng!');
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
  $('btnDeleteTopic').addEventListener('click', async () => {
    const t = cur();
    if (!t || !confirm(`Xóa chủ đề “${t.name}” cùng ${t.items.length} ảnh? (Ảnh trên Drive không bị xóa)`)) return;
    Sfx.stopVictory();
    await deleteTopicAudioIDB(t.id);
    topics = topics.filter((x) => x.id !== t.id);
    currentId = topics[0] ? topics[0].id : null;
    persist();
    render();
  });
  $('btnClearItems').addEventListener('click', () => {
    const t = cur();
    if (!t || !t.items.length || !confirm('Xóa tất cả ảnh trong chủ đề này?')) return;
    t.items = [];
    persist();
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
