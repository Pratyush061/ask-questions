/* Hand Ninja — pure game logic (no DOM / no camera), unit-tested with:
   node logic.test.mjs

   Zen fruit-slicing: fruits fall from the top of the screen; the player
   slices them with the edge of their hand (wrist -> pinky knuckle). */

// ---- tuning ----------------------------------------------------------------
export const GRAVITY = 90;          // px/s^2 — gentle, zen pace
export const SLICE_SPEED = 220;     // px/s the blade must move before it cuts
export const BLADE_WIDTH = 9;       // extra reach added to the fruit radius
export const COMBO_WINDOW_MS = 260; // cuts within this window chain together
export const COMBO_BONUS_PER = 5;   // bonus points per fruit in a combo
export const NORMAL_POINTS = 10;
export const GOLDEN_POINTS = 50;
export const GOLDEN_CHANCE = 0.07;  // ~1 fruit in 14 is golden

export const FRUITS = [
  { emoji: "🍉", juice: "#ff5470", size: 96 },
  { emoji: "🍊", juice: "#ffa62b", size: 84 },
  { emoji: "🍎", juice: "#ff6b6b", size: 84 },
  { emoji: "🍏", juice: "#9ae66e", size: 84 },
  { emoji: "🍇", juice: "#a55eea", size: 80 },
  { emoji: "🍌", juice: "#ffd32a", size: 88 },
  { emoji: "🥝", juice: "#8bc34a", size: 76 },
  { emoji: "🍍", juice: "#f6b93b", size: 92 },
  { emoji: "🍓", juice: "#ff4757", size: 72 },
  { emoji: "🍑", juice: "#ff9f7f", size: 84 },
];

// ---- geometry ---------------------------------------------------------------
export function pointSegDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function segCircleHit(x1, y1, x2, y2, cx, cy, r) {
  return pointSegDist(cx, cy, x1, y1, x2, y2) <= r;
}

// ---- fruits -------------------------------------------------------------------
export class Fruit {
  constructor(o) {
    this.x = o.x;
    this.y = o.y;
    this.vx = o.vx;
    this.vy = o.vy;
    this.r = o.r;
    this.size = o.size;
    this.emoji = o.emoji;
    this.juice = o.juice;
    this.points = o.points;
    this.golden = !!o.golden;
    this.angle = o.angle || 0;
    this.spin = o.spin;
    this.dead = false;
  }

  update(dt, w, h) {
    this.vy += GRAVITY * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.angle += this.spin * dt;
    if (this.x < this.r) { this.x = this.r; this.vx = Math.abs(this.vx); }
    if (this.x > w - this.r) { this.x = w - this.r; this.vx = -Math.abs(this.vx); }
    if (this.y - this.r > h) this.dead = true; // missed off the bottom (zen: no penalty)
  }
}

export function spawnFruit(w, rng = Math.random) {
  const type = FRUITS[Math.floor(rng() * FRUITS.length)];
  const golden = rng() < GOLDEN_CHANCE;
  const size = type.size * (0.9 + rng() * 0.25) * (golden ? 1.1 : 1);
  return new Fruit({
    x: 50 + rng() * Math.max(1, w - 100),
    y: -size,
    vx: (rng() - 0.5) * 80,
    vy: (golden ? 80 : 35) + rng() * 40,
    spin: (rng() - 0.5) * 3,
    r: size * 0.42,
    size,
    emoji: type.emoji,
    juice: golden ? "#ffd700" : type.juice,
    points: golden ? GOLDEN_POINTS : NORMAL_POINTS,
    golden,
  });
}

// ---- the hand blade -------------------------------------------------------------
/* The blade is the edge of the hand: the segment from the wrist to the pinky
   knuckle. A fruit is cut when the blade segment (or the path its midpoint
   swept since the last frame) touches the fruit while moving fast enough. */
export class Blade {
  constructor(maxSamples = 24) {
    this.samples = [];
    this.maxSamples = maxSamples;
  }

  addSample(ax, ay, bx, by, t) {
    this.samples.push({
      ax, ay, bx, by,
      mx: (ax + bx) / 2,
      my: (ay + by) / 2,
      t,
    });
    if (this.samples.length > this.maxSamples) this.samples.shift();
  }

  clear() { this.samples = []; }

  get last() { return this.samples[this.samples.length - 1] || null; }

  speed() {
    const n = this.samples.length;
    if (n < 2) return 0;
    const a = this.samples[n - 2];
    const b = this.samples[n - 1];
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0) return Infinity; // same timestamp: treat as infinitely fast
    return Math.hypot(b.mx - a.mx, b.my - a.my) / dt;
  }

  cuts(fruit) {
    if (this.samples.length < 2) return false;
    if (this.speed() < SLICE_SPEED) return false;
    const p = this.samples[this.samples.length - 2];
    const c = this.samples[this.samples.length - 1];
    return (
      segCircleHit(c.ax, c.ay, c.bx, c.by, fruit.x, fruit.y, fruit.r + BLADE_WIDTH) ||
      segCircleHit(p.mx, p.my, c.mx, c.my, fruit.x, fruit.y, fruit.r)
    );
  }

  /** Direction the blade midpoint is moving in, in radians (last motion). */
  angle() {
    const n = this.samples.length;
    if (n < 2) return 0;
    const a = this.samples[n - 2];
    const b = this.samples[n - 1];
    return Math.atan2(b.my - a.my, b.mx - a.mx);
  }

  trail() {
    return this.samples.map((s) => ({ x: s.mx, y: s.my }));
  }
}

// ---- combos ------------------------------------------------------------------
export class ComboTracker {
  constructor(windowMs = COMBO_WINDOW_MS) {
    this.windowMs = windowMs;
    this.count = 0;
    this.last = 0;
  }

  registerCut(t) {
    if (t - this.last <= this.windowMs) this.count += 1;
    else this.count = 1;
    this.last = t;
  }

  /** Call every frame: returns {count, bonus} when a chain closes, else null. */
  poll(t) {
    if (this.count >= 2 && t - this.last > this.windowMs) {
      const out = { count: this.count, bonus: this.count * COMBO_BONUS_PER };
      this.count = 0;
      return out;
    }
    return null;
  }
}
