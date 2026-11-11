/**
 * Popup "⚙️ Cấu hình Firebase & Đám Mây" — dùng chung cho index.html và game.html.
 * Tự dựng DOM (cần Tailwind + css/style.css đã nạp trên trang).
 */
import {
  CONFIG_FIELDS, DEFAULT_FIREBASE_CONFIG, getConfigSource, loadFirebaseConfig, parseConfigText,
  resetFirebaseConfig, saveFirebaseConfig, useLocalMode, validateConfig,
} from './firebase-config.js';
import { testFirebase } from './transport.js';

const LABELS = {
  apiKey: 'apiKey',
  authDomain: 'authDomain',
  databaseURL: 'databaseURL *',
  projectId: 'projectId',
  storageBucket: 'storageBucket',
  messagingSenderId: 'messagingSenderId',
  appId: 'appId',
};

let modal = null;

function build() {
  modal = document.createElement('div');
  modal.className = 'hidden fixed inset-0 z-[70] scrim grid place-items-center p-4';
  modal.innerHTML = `
    <div class="glass w-full max-w-xl p-6 space-y-4 max-h-[92vh] overflow-auto" style="border-radius:32px">
      <div class="flex items-center justify-between">
        <div><div class="eyebrow">Kết nối</div><h2 class="font-display text-2xl">Firebase &amp; Đám mây</h2></div>
        <button data-x="close" class="btn btn-ghost btn-sm btn-icon">✕</button>
      </div>
      <div data-x="mode" class="text-sm"></div>
      <label class="block text-sm t-2">Dán nguyên đoạn <code>firebaseConfig</code> (hoặc chỉ databaseURL) — hệ thống tự nhận diện:
        <textarea data-x="paste" rows="4" class="input mt-1 font-mono text-xs" placeholder="const firebaseConfig = { apiKey: &quot;...&quot;, databaseURL: &quot;https://....firebasedatabase.app&quot;, ... };"></textarea>
      </label>
      <div data-x="fields" class="grid gap-2 sm:grid-cols-2"></div>
      <div data-x="msg" class="text-sm min-h-[1.5rem]"></div>
      <div class="grid grid-cols-2 gap-2">
        <button data-x="test" class="btn btn-ghost btn-sm">Kiểm tra kết nối</button>
        <button data-x="save" class="btn btn-ok btn-sm">Lưu &amp; áp dụng</button>
        <button data-x="local" class="btn btn-ghost btn-sm">Chế độ cục bộ</button>
        <button data-x="reset" class="btn btn-ghost btn-sm">Khôi phục mặc định</button>
      </div>
      <p class="text-xs t-3">Cấu hình lưu trong trình duyệt này. Nhớ cấu hình giống nhau trên cả máy Host và máy Xem (hoặc dùng cấu hình mặc định trong <code>js/firebase-config.js</code>).</p>
    </div>`;
  document.body.appendChild(modal);

  const fields = modal.querySelector('[data-x="fields"]');
  CONFIG_FIELDS.forEach((k) => {
    const wrap = document.createElement('label');
    wrap.className = `block text-xs t-2 ${k === 'databaseURL' || k === 'apiKey' ? 'sm:col-span-2' : ''}`;
    wrap.innerHTML = `${LABELS[k]}<input data-k="${k}" class="input mt-0.5 font-mono text-xs" autocomplete="off" spellcheck="false" />`;
    fields.appendChild(wrap);
  });

  const $x = (n) => modal.querySelector(`[data-x="${n}"]`);
  const msg = (text, bad = false) => {
    const el = $x('msg');
    el.textContent = text;
    el.className = `text-sm min-h-[1.5rem] ${bad ? 't-danger' : 't-accent'}`;
  };
  const read = () => {
    const cfg = {};
    modal.querySelectorAll('[data-k]').forEach((i) => { cfg[i.dataset.k] = i.value; });
    return validateConfig(cfg);
  };

  $x('close').onclick = () => modal.classList.add('hidden');
  modal.addEventListener('mousedown', (e) => { if (e.target === modal) modal.classList.add('hidden'); });

  $x('paste').addEventListener('input', (e) => {
    const parsed = parseConfigText(e.target.value);
    let n = 0;
    modal.querySelectorAll('[data-k]').forEach((i) => {
      if (parsed[i.dataset.k]) {
        i.value = parsed[i.dataset.k];
        n += 1;
      }
    });
    if (n) msg(`Đã nhận diện ${n} trường cấu hình.`);
  });

  $x('test').onclick = async () => {
    const v = read();
    if (!v.ok) return msg(v.error, true);
    msg('Đang kiểm tra kết nối…');
    const r = await testFirebase(v.config);
    msg(r.message, !r.ok);
  };
  $x('save').onclick = () => {
    const v = read();
    if (!v.ok) return msg(v.error, true);
    saveFirebaseConfig(v.config);
    msg('Đã lưu. Đang tải lại trang…');
    setTimeout(() => location.reload(), 400);
  };
  $x('local').onclick = () => {
    useLocalMode();
    location.reload();
  };
  $x('reset').onclick = () => {
    resetFirebaseConfig();
    location.reload();
  };
}

function fill() {
  const source = getConfigSource();
  const cfg = loadFirebaseConfig() || DEFAULT_FIREBASE_CONFIG;
  modal.querySelectorAll('[data-k]').forEach((i) => { i.value = cfg[i.dataset.k] || ''; });
  modal.querySelector('[data-x="paste"]').value = '';
  const text = {
    custom: '● Đang dùng cấu hình bạn đã lưu trong trình duyệt.',
    default: '● Đang dùng cấu hình mặc định trong js/firebase-config.js.',
    local: '● Đang ở chế độ cục bộ (chỉ đồng bộ giữa các tab cùng trình duyệt).',
    none: '● Chưa có cấu hình hợp lệ — đang ở chế độ cục bộ.',
  }[source];
  modal.querySelector('[data-x="mode"]').textContent = text;
  modal.querySelector('[data-x="msg"]').textContent = '';
}

export function openFirebaseSettings() {
  if (!modal) build();
  fill();
  modal.classList.remove('hidden');
}
