/**
 * Pháo hoa nhẹ, tiết kiệm GPU/CPU (an toàn cho Smart TV & máy yếu):
 *  - devicePixelRatio của canvas giới hạn tối đa 1.5.
 *  - Tối đa 80 hạt cùng lúc; bắn theo nhịp từng chùm mỗi 0.9 giây.
 *  - Vẽ tối đa ~30fps, xóa canvas bằng clearRect (không lớp mờ dần tốn fill-rate).
 *  - Tự tạm dừng khi tab bị ẩn; stop() hủy requestAnimationFrame và xóa sạch canvas.
 */
const MAX_PARTICLES = 80;
const LAUNCH_EVERY_MS = 900;
const FRAME_MS = 33;
const MAX_DPR = 1.5;
const DEFAULT_PALETTE = ['#ffd60a', '#0a84ff', '#ff7a59', '#30d158', '#bf5af2', '#64d2ff', '#ff375f', '#ffffff'];

export class Fireworks {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.rockets = [];
    this.running = false;
    this.rafId = null;
    this.zone = [0.05, 0.95];
    this.colors = DEFAULT_PALETTE;
    this.lastLaunch = 0;
    this.lastFrame = 0;
    this.seq = 0;
    this.resize = this.resize.bind(this);
    this.loop = this.loop.bind(this);
    this.onVisibility = this.onVisibility.bind(this);
    window.addEventListener('resize', this.resize);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  onVisibility() {
    if (document.visibilityState === 'hidden') {
      this.cancelFrame();
    } else if (this.running && this.rafId === null) {
      this.lastFrame = 0;
      this.rafId = requestAnimationFrame(this.loop);
    }
  }

  cancelFrame() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  start(zone, colors) {
    if (Array.isArray(zone) && zone.length === 2) this.zone = zone;
    const custom = Array.isArray(colors) && colors.length ? colors : [];
    this.colors = custom.concat(DEFAULT_PALETTE).filter((c, i, a) => a.indexOf(c) === i);
    if (this.running) return;
    this.running = true;
    this.lastLaunch = 0;
    this.lastFrame = 0;
    this.seq = 0;
    this.resize();
    if (document.visibilityState !== 'hidden') this.rafId = requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
    this.cancelFrame();
    this.rockets.length = 0;
    this.particles.length = 0;
    this.ctx.globalAlpha = 1;
    this.ctx.clearRect(0, 0, this.w, this.h);
  }

  destroy() {
    this.stop();
    window.removeEventListener('resize', this.resize);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  pickColor() {
    return this.colors[Math.floor(Math.random() * this.colors.length)];
  }

  launchAt(normX) {
    this.rockets.push({
      x: this.w * Math.min(0.96, Math.max(0.04, normX)),
      y: this.h + 6,
      vx: (Math.random() - 0.5) * 2,
      vy: -(10 + Math.random() * 4.5),
      targetY: this.h * (0.14 + Math.random() * 0.34),
      color: this.pickColor(),
    });
  }

  /** Một chùm = 2 quả từ hai cánh + 1 quả khu vực người thắng/trung tâm luân phiên. */
  launchVolley() {
    const [z0, z1] = this.zone;
    this.launchAt(0.06 + Math.random() * 0.2);
    this.launchAt(0.74 + Math.random() * 0.2);
    this.launchAt(this.seq % 2 === 0 ? 0.35 + Math.random() * 0.3 : z0 + Math.random() * (z1 - z0));
    this.seq += 1;
  }

  burst(x, y, color) {
    const room = MAX_PARTICLES - this.particles.length;
    const count = Math.min(room, 24);
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 * i) / count;
      const sp = 1.6 + Math.random() * 3.6;
      this.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 1,
        decay: 0.02 + Math.random() * 0.015,
        color: Math.random() < 0.2 ? '#ffffff' : color,
        size: 2 + Math.random() * 1.8,
      });
    }
  }

  loop(ts) {
    if (!this.running) {
      this.rafId = null;
      return;
    }
    this.rafId = requestAnimationFrame(this.loop);
    if (ts - this.lastFrame < FRAME_MS) return;
    this.lastFrame = ts;

    if (!this.lastLaunch || ts - this.lastLaunch > LAUNCH_EVERY_MS) {
      this.launchVolley();
      this.lastLaunch = ts;
    }

    const g = this.ctx;
    g.clearRect(0, 0, this.w, this.h);

    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.x += r.vx * 2;
      r.y += r.vy * 2;
      r.vy += 0.28;
      g.globalAlpha = 1;
      g.fillStyle = r.color;
      g.fillRect(r.x - 2, r.y - 2, 4, 4);
      if (r.vy >= -1 || r.y <= r.targetY) {
        this.burst(r.x, r.y, r.color);
        this.rockets.splice(i, 1);
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * 2;
      p.y += p.vy * 2;
      p.vx *= 0.97;
      p.vy = p.vy * 0.97 + 0.09;
      p.life -= p.decay * 2;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      g.globalAlpha = p.life;
      g.fillStyle = p.color;
      g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    g.globalAlpha = 1;
  }
}
