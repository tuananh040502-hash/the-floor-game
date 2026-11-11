/**
 * Tải ngầm ảnh câu hỏi vào bộ nhớ đệm cục bộ: window.__imageCache = { [urlGốc]: { img, status, cdn } }.
 *  - Link Google Drive được đổi sang CDN nhanh: https://lh3.googleusercontent.com/d/{FILE_ID}
 *  - Mỗi ảnh được decode() sẵn nên khi hiển thị không bị chớp/giật.
 *  - Hàng đợi có ưu tiên (ảnh câu đầu tiên tải trước) và giới hạn số kết nối song song.
 */
window.__imageCache = window.__imageCache || {};
const cache = window.__imageCache;

const CONCURRENCY = 6;
const TIMEOUT_MS = 15000;
const listeners = new Set();
let pending = [];
let active = 0;

/** Đổi mọi dạng link Google Drive về CDN lh3; link khác giữ nguyên. */
export function toCdnUrl(url) {
  const raw = String(url || '');
  const m =
    raw.match(/drive\.google\.com\/file\/d\/([\w-]+)/) ||
    raw.match(/drive\.google\.com\/(?:open|uc|thumbnail)\?(?:[^#]*&)?id=([\w-]+)/) ||
    raw.match(/lh3\.googleusercontent\.com\/d\/([\w-]+)/);
  return m ? `https://lh3.googleusercontent.com/d/${m[1]}` : raw;
}

export function onPreloadProgress(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify() {
  listeners.forEach((cb) => cb());
}

export function getCached(url) {
  return cache[url] || null;
}

/** Ảnh đã xong (thành công hoặc lỗi — lỗi không được chặn trận đấu). */
export function isSettled(url) {
  const e = cache[url];
  return !!e && e.status !== 'loading';
}

export function getProgress(urls) {
  const list = [...new Set(urls || [])];
  const loaded = list.filter(isSettled).length;
  return { loaded, total: list.length, first: urls && urls.length ? isSettled(urls[0]) : true };
}

function load(url, attempt = 0) {
  const entry = cache[url] || (cache[url] = { img: null, status: 'loading', cdn: toCdnUrl(url) });
  const img = new Image();
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  entry.img = img;
  entry.status = 'loading';
  return new Promise((resolve) => {
    let done = false;
    const finish = (status) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (status === 'err' && attempt < 1) {
        setTimeout(() => load(url, attempt + 1).then(resolve), 600);
        return;
      }
      entry.status = status;
      notify();
      resolve();
    };
    const timer = setTimeout(() => finish('err'), TIMEOUT_MS);
    img.onload = async () => {
      try {
        await img.decode();
      } catch { /* decode lỗi vẫn hiển thị được */ }
      finish('ok');
    };
    img.onerror = () => finish('err');
    img.src = entry.cdn;
  });
}

function pump() {
  while (active < CONCURRENCY && pending.length) {
    const url = pending.shift();
    if (cache[url] && cache[url].status !== 'loading') continue;
    if (cache[url] && cache[url].img) continue; // đang tải
    active += 1;
    load(url).finally(() => {
      active -= 1;
      pump();
    });
  }
}

/**
 * Giải phóng bộ nhớ đệm hình ảnh của các chủ đề cũ:
 * Chỉ giữ lại trong window.__imageCache danh sách URL của chủ đề đang thi đấu hiện tại.
 */
export function pruneCache(keepUrls = []) {
  const keep = new Set((keepUrls || []).filter(Boolean));
  pending = pending.filter((u) => keep.has(u));
  Object.keys(cache).forEach((u) => {
    if (!keep.has(u)) {
      const entry = cache[u];
      if (entry && entry.img) {
        try {
          entry.img.onload = null;
          entry.img.onerror = null;
          entry.img.src = '';
        } catch { /* ignore */ }
        entry.img = null;
      }
      delete cache[u];
    }
  });
}

/**
 * Xếp hàng tải các URL theo thứ tự.
 *  - priority=true: đẩy các ảnh chưa bắt đầu tải lên đầu hàng đợi (dùng khi vào trận).
 *  - evictOthers=true: dọn sạch ảnh của các chủ đề trước đó khỏi window.__imageCache để tiết kiệm RAM.
 */
export function preloadImages(urls, { priority = false, evictOthers = false } = {}) {
  const unique = [...new Set((urls || []).filter(Boolean))];
  if (evictOthers) {
    pruneCache(unique);
  }
  const toQueue = unique.filter((u) => {
    const e = cache[u];
    return !e || (e.status === 'loading' && !e.img);
  });
  const set = new Set(toQueue);
  pending = priority
    ? [...toQueue, ...pending.filter((u) => !set.has(u))]
    : [...pending.filter((u) => !set.has(u)), ...toQueue];
  // Đánh dấu "đang chờ" để getProgress tính đúng tổng số
  unique.forEach((u) => {
    if (!cache[u]) cache[u] = { img: null, status: 'loading', cdn: toCdnUrl(u) };
  });
  pump();
  notify();
}
