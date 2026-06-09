// Juice systems (spec §3): particles, screen shake, praise callouts, flying score.
// Everything here is cosmetic — game state is already final when these run.

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number; // ms
  color: string;
  size: number;
}

export interface ScoreFlyer {
  x: number;
  y: number;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  points: number;
  born: number;
  duration: number;
}

export interface Callout {
  text: string;
  born: number;
  priority: number;
}

export class FxSystem {
  particles: Particle[] = [];
  flyers: ScoreFlyer[] = [];
  callout: Callout | null = null;
  private shakeAmp = 0;
  private shakeUntil = 0;
  private rand: () => number;

  constructor(rand: () => number = Math.random) {
    this.rand = rand;
  }

  /** 4–8 particles per cleared cell, fade ≤250ms (spec §3.3). */
  burst(cx: number, cy: number, color: string, now: number): void {
    const n = 4 + Math.floor(this.rand() * 5);
    for (let i = 0; i < n; i++) {
      const ang = this.rand() * Math.PI * 2;
      const speed = 60 + this.rand() * 160;
      this.particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed - 40,
        born: now,
        life: 160 + this.rand() * 90, // ≤250ms
        color,
        size: 3 + this.rand() * 4,
      });
    }
  }

  /** Screen shake scaling 2px → 6px max with chain step (spec §3.4). */
  shake(chainStep: number, now: number): void {
    this.shakeAmp = Math.min(2 + (chainStep - 1) * 1.5, 6);
    this.shakeUntil = now + 180;
  }

  shakeOffset(now: number): { x: number; y: number } {
    if (now >= this.shakeUntil || this.shakeAmp <= 0) return { x: 0, y: 0 };
    const falloff = (this.shakeUntil - now) / 180;
    const a = this.shakeAmp * falloff;
    return { x: (this.rand() * 2 - 1) * a, y: (this.rand() * 2 - 1) * a };
  }

  /** Centered praise text, ≤600ms, never stacking (spec §3.5) — higher priority replaces lower. */
  showCallout(text: string, priority: number, now: number): void {
    if (this.callout !== null && now - this.callout.born < 600 && this.callout.priority > priority) {
      return;
    }
    this.callout = { text, born: now, priority };
  }

  /** Points fly from cleared lines to the score counter (spec §3.7). */
  fly(sx: number, sy: number, tx: number, ty: number, points: number, now: number): void {
    this.flyers.push({ x: sx, y: sy, sx, sy, tx, ty, points, born: now, duration: 520 });
  }

  /** Returns total points that "arrived" at the score counter this frame. */
  update(now: number, dt: number): number {
    let arrived = 0;
    const dts = dt / 1000;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      if (!p) continue;
      if (now - p.born > p.life) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dts;
      p.y += p.vy * dts;
      p.vy += 600 * dts;
    }
    for (let i = this.flyers.length - 1; i >= 0; i--) {
      const f = this.flyers[i];
      if (!f) continue;
      const t = (now - f.born) / f.duration;
      if (t >= 1) {
        arrived += f.points;
        this.flyers.splice(i, 1);
        continue;
      }
      const e = 1 - Math.pow(1 - t, 3); // ease-out cubic
      f.x = f.sx + (f.tx - f.sx) * e;
      f.y = f.sy + (f.ty - f.sy) * e - Math.sin(t * Math.PI) * 30;
    }
    if (this.callout !== null && now - this.callout.born > 600) this.callout = null;
    return arrived;
  }

  draw(ctx: CanvasRenderingContext2D, now: number, centerX: number, calloutY: number): void {
    for (const p of this.particles) {
      const t = (now - p.born) / p.life;
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = p.color;
      const s = p.size * (1 - t * 0.5);
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;

    for (const f of this.flyers) {
      ctx.font = '700 18px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd43b';
      ctx.fillText(`+${f.points}`, f.x, f.y);
    }

    if (this.callout !== null) {
      const age = now - this.callout.born;
      const t = Math.min(age / 600, 1);
      const popIn = Math.min(age / 120, 1);
      const scale = 0.6 + 0.4 * (1 - Math.pow(1 - popIn, 3));
      const alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      ctx.save();
      ctx.translate(centerX, calloutY);
      ctx.scale(scale, scale);
      ctx.globalAlpha = Math.max(alpha, 0);
      ctx.font = '900 40px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 8;
      ctx.strokeStyle = 'rgba(7, 10, 26, 0.85)';
      ctx.strokeText(this.callout.text, 0, 0);
      ctx.fillStyle = '#ffd43b';
      ctx.fillText(this.callout.text, 0, 0);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  clearAll(): void {
    this.particles.length = 0;
    this.flyers.length = 0;
    this.callout = null;
    this.shakeAmp = 0;
  }
}

/** Spec §3.5 mapping. Returns null when no callout applies. */
export function calloutFor(
  linesThisStep: number,
  chainStep: number,
  strings: { nice: string; great: string; amazing: string; unbelievable: string },
): { text: string; priority: number } | null {
  if (chainStep >= 4) return { text: strings.unbelievable, priority: 4 };
  if (chainStep === 3) return { text: strings.amazing, priority: 3 };
  if (linesThisStep >= 3 || chainStep === 2) return { text: strings.great, priority: 2 };
  if (linesThisStep === 2) return { text: strings.nice, priority: 1 };
  return null;
}
