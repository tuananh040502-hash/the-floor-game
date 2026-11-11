/**
 * Chế độ hiển thị Apple Dark / Light.
 * Mặc định theo hệ thống; người dùng bấm nút [data-theme-toggle] để đổi và nhớ lại lựa chọn.
 */
const KEY = 'thefloor:theme';
const mq = window.matchMedia('(prefers-color-scheme: light)');

function stored() {
  const v = localStorage.getItem(KEY);
  return v === 'light' || v === 'dark' ? v : null;
}

export function currentTheme() {
  return stored() || (mq.matches ? 'light' : 'dark');
}

function paint() {
  const t = currentTheme();
  document.documentElement.dataset.theme = t;
  document.querySelectorAll('[data-theme-toggle]').forEach((b) => {
    b.textContent = t === 'dark' ? '☾' : '☀︎';
    b.title = t === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối';
  });
}

export function initTheme() {
  paint();
  mq.addEventListener('change', () => { if (!stored()) paint(); });
  document.querySelectorAll('[data-theme-toggle]').forEach((b) => {
    b.addEventListener('click', () => {
      localStorage.setItem(KEY, currentTheme() === 'dark' ? 'light' : 'dark');
      paint();
    });
  });
}

initTheme();
