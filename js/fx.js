/**
 * Pháo hoa liên tục toàn màn hình (Continuous Multi-Zone Fireworks):
 *  - Bắn liên tục từ 2 bên màn hình và khu vực trung tâm suốt màn ăn mừng chiến thắng.
 *  - Hỗ trợ dọn dẹp hoàn toàn: cancelAnimationFrame + clearRect giải phóng 100% RAM/CPU khi về sàn.
 */
const DEFAULT_PALETTE = [
  '#ffd60a', '#0a84ff', '#ff7a59', '#30d158',
  '#bf5af2', '#64d2ff', '#ff375f', '#ffffff',
];

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
    this.burstSeq = 0;
    this.resize = this.resize.bind(this);
    this.loop = this.loop.bind(this);
    window.addEventListener('resize', this.resize, { passive: true });
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  start(zone, colors) {
    if (Array.isArray(zone) && zone.length === 2) this.zone = zone;
    const custom = Array.isArray(colors) && colors.length ? colors : [];
    this.colors = [...new Set([...custom, ...DEFAULT_PALETTE])];
    if (this.running) return;
    this.running = true;
    this.lastLaunch = 0;
    this.burstSeq = 0;
    this.resize();
    // Khởi đầu bằng loạt pháo hoa đồng loạt từ trái, giữa và phải
    this.launchAt(0.14);
    this.launchAt(0.5);
    this.launchAt(0.86);
    this.rafId = requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.rockets.length = 0;
    this.particles.length = 0;
    if (this.ctx) {
      this.ctx.globalCompositeOperation = 'source-over';
      this.ctx.globalAlpha = 1;
      this.ctx.clearRect(0, 0, this.w, this.h);
    }
  }

  launchAt(normX) {
    const x = this.w * Math.min(0.96, Math.max(0.04, normX));
    const color = this.colors[Math.floor(Math.random() * this.colors.length)];
    const altColor = this.colors[Math.floor(Math.random() * this.colors.length)];
    this.rockets.push({
      x,
      y: this.h + 6,
      vx: (Math.random() - 0.5) * 2.2,
      vy: -(10 + Math.random() * 5.5),
      targetY: this.h * (0.1 + Math.random() * 0.38),
      color,
      altColor,
    });
  }

  launch() {
    // Luân phiên bắn từ 3 khu vực: Cánh trái, Trung tâm, Cánh phải + ưu tiên phía người chiến thắng
    const [z0, z1] = this.zone;
    const mode = this.burstSeq % 4;
    this.burstSeq += 1;
    let normX;
    if (mode === 0) {
      // Cánh trái
      normX = 0.05 + Math.random() * 0.22;
    } else if (mode === 1) {
      // Cánh phải
      normX = 0.73 + Math.random() * 0.22;
    } else if (mode === 2) {
      // Trung tâm đấu trường
      normX = 0.32 + Math.random() * 0.36;
    } else {
      // Khu vực người thắng
      normX = z0 + Math.random() * (z1 - z0);
    }
    this.launchAt(normX);
    // Thỉnh thoảng bắn đôi đối xứng 2 bên
    if (Math.random() < 0.35) {
      this.launchAt(1 - normX);
    }
  }

  burst(x, y, color, altColor) {
    const count = 68 + Math.floor(Math.random() * 36);
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.15;
      const sp = 1.2 + Math.random() * 6.2;
      const pick = Math.random();
      const pColor = pick < 0.2 ? '#ffffff' : pick < 0.65 ? color : (altColor || color);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 1,
        decay: 0.01 + Math.random() * 0.013,
        color: pColor,
        size: 1.6 + Math.random() * 2.2,
      });
    }
  }

  loop(ts) {
    if (!this.running) {
      this.rafId = null;
      return;
    }
    const g = this.ctx;
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = 'rgba(0, 0, 0, 0.2)';
    g.fillRect(0, 0, this.w, this.h);
    g.globalCompositeOperation = 'lighter';

    if (!this.lastLaunch || ts - this.lastLaunch > 220) {
      this.launch();
      this.lastLaunch = ts;
    }

    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.x += r.vx;
      r.y += r.vy;
      r.vy += 0.14;
      g.fillStyle = r.color;
      g.beginPath();
      g.arc(r.x, r.y, 2.8, 0, Math.PI * 2);
      g.fill();
      if (r.vy >= -1 || r.y <= r.targetY) {
        this.burst(r.x, r.y, r.color, r.altColor);
        this.rockets.splice(i, 1);
      }
    }

    // Giới hạn tối đa hạt để giữ 60fps ổn định trên máy yếu
    if (this.particles.length > 900) {
      this.particles.splice(0, this.particles.length - 900);
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.984;
      p.vy = p.vy * 0.984 + 0.048;
      p.life -= p.decay;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      g.globalAlpha = Math.max(p.life, 0);
      g.fillStyle = p.color;
      g.beginPath();
      g.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;

    this.rafId = requestAnimationFrame(this.loop);
  }
}
