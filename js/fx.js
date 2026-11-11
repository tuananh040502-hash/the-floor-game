/** Pháo hoa trên canvas toàn màn hình, bắn trong một dải ngang [x0, x1] (0..1). */
export class Fireworks {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.rockets = [];
    this.running = false;
    this.zone = [0, 1];
    this.colors = ['#ffffff'];
    this.lastLaunch = 0;
    this.resize = this.resize.bind(this);
    this.loop = this.loop.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  start(zone, colors) {
    this.zone = zone;
    this.colors = colors;
    if (this.running) return;
    this.running = true;
    this.lastLaunch = 0;
    requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
    this.rockets = [];
    this.particles = [];
    this.ctx.clearRect(0, 0, this.w, this.h);
  }

  launch() {
    const [x0, x1] = this.zone;
    const x = this.w * (x0 + Math.random() * (x1 - x0));
    this.rockets.push({
      x,
      y: this.h,
      vx: (Math.random() - 0.5) * 1.5,
      vy: -(9 + Math.random() * 5),
      targetY: this.h * (0.12 + Math.random() * 0.4),
      color: this.colors[Math.floor(Math.random() * this.colors.length)],
    });
  }

  burst(x, y, color) {
    const count = 70 + Math.floor(Math.random() * 40);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 5.5;
      this.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 1,
        decay: 0.011 + Math.random() * 0.014,
        color: Math.random() < 0.25 ? '#ffffff' : color,
        size: 1.5 + Math.random() * 2,
      });
    }
  }

  loop(ts) {
    if (!this.running) return;
    const g = this.ctx;
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.fillRect(0, 0, this.w, this.h);
    g.globalCompositeOperation = 'lighter';

    if (ts - this.lastLaunch > 260) {
      this.launch();
      this.lastLaunch = ts;
    }

    this.rockets = this.rockets.filter((r) => {
      r.x += r.vx;
      r.y += r.vy;
      r.vy += 0.12;
      g.fillStyle = r.color;
      g.beginPath();
      g.arc(r.x, r.y, 2.5, 0, Math.PI * 2);
      g.fill();
      if (r.vy >= -1 || r.y <= r.targetY) {
        this.burst(r.x, r.y, r.color);
        return false;
      }
      return true;
    });

    this.particles = this.particles.filter((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.985;
      p.vy = p.vy * 0.985 + 0.045;
      p.life -= p.decay;
      if (p.life <= 0) return false;
      g.globalAlpha = Math.max(p.life, 0);
      g.fillStyle = p.color;
      g.beginPath();
      g.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      return true;
    });

    requestAnimationFrame(this.loop);
  }
}
