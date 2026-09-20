/* Hand Ninja — zen fruit slicing with the edge of your hand.
   MediaPipe tracks one hand (VIDEO mode); the blade is the segment from the
   wrist to the pinky knuckle (the chopping edge of the hand). Fruits fall
   from the top of the screen; slice them fast to score. No timer, no losing.

   Pure game logic (physics, slicing geometry, combos) lives in logic.mjs
   and is unit-tested with node logic.test.mjs. */

import {
  HandLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
import {
  Fruit, spawnFruit, Blade, ComboTracker, OneEuro2,
  SLICE_SPEED, COAST_MS,
} from "./logic.mjs";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";

// ---- performance tuning ----------------------------------------------------
const NUM_HANDS = 1;     // the blade is one hand's edge
const CAM_WIDTH = 480;   // camera resolution for the on-screen preview
const CAM_HEIGHT = 360;

// Inference runs on a much smaller offscreen copy of the frame (the model
// resizes its input internally anyway, so accuracy barely changes but the
// per-detection upload cost drops hard).
const DETECT_WIDTH = 288;
const DETECT_HEIGHT = 216;

const SPAWN_MIN = 0.55;  // seconds between spawn waves (more fruit in play...)
const SPAWN_MAX = 1.5;   // (...but they fall slower, so it stays catchable)
const BURST_CHANCE = 0.3; // chance a wave drops 2-3 fruits at once

// ---- DOM --------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const video = $("cam");
const canvas = $("overlay");
const ctx = canvas.getContext("2d");
const stage = $("stage");

// ---- game state ----------------------------------------------------------------
const blade = new Blade();
const combo = new ComboTracker();
let fruits = [];       // Fruit[]
let halves = [];       // sliced fruit halves flying apart
let particles = [];   // juice splatter
let texts = [];       // floating score texts
let landmarker = null;
let running = false;
let lastT = 0;
let lastVideoTime = -1;
let detectErrors = 0;
let handSeen = false;
let score = 0;
let cuts = 0;
let best = 0;
try { best = parseInt(localStorage.getItem("hn-best") ?? "0", 10) || 0; } catch (e) { /* ignore */ }
let spawnTimer = 1.0;
let swooshWasFast = false;
let lastHandT = 0; // last time real landmarks were seen (for coasting)

// offscreen detection canvas + landmark smoothing
const detectCanvas = document.createElement("canvas");
detectCanvas.width = DETECT_WIDTH;
detectCanvas.height = DETECT_HEIGHT;
const detectCtx = detectCanvas.getContext("2d");
const wristFilter = new OneEuro2();
const pinkyFilter = new OneEuro2();

// ---- detection worker -----------------------------------------------------------
// MediaPipe runs in a Web Worker on its own thread: no matter how heavy the
// fruit/particle rendering gets, detection keeps its own budget and never
// starves. If the worker cannot start or keeps failing, we fall back to the
// main-thread detection loop, which loads the model lazily.
let detector = null;
let detectionMode = "none"; // "none" | "worker" | "main"
let frameInFlight = false;
let firstResultSeen = false;

const sfx = {
  ctx: null,
  enabled: true,
  lastSwoosh: 0,
  noise: null,

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    // shared white-noise buffer
    const len = this.ctx.sampleRate * 0.3;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  },

  ok() { return this.enabled && this.ctx; },

  splat() {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    // juicy noise burst
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.12);
    // low thump
    const o = this.ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.12);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.35, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.15);
  },

  swoosh() {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(350, t);
    bp.frequency.exponentialRampToValueAtTime(2400, t + 0.16);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.2);
  },

  sparkle() {
    if (!this.ok()) return;
    const t0 = this.ctx.currentTime;
    [880, 1174, 1568].forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = f;
      const g = this.ctx.createGain();
      const t = t0 + i * 0.06;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 0.14);
    });
  },
};

// ---- model + camera (same mobile-safe patterns as before) --------------------
async function createLandmarker() {
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO",
    numHands: NUM_HANDS,
    // Relaxed thresholds: at the default 0.5 a fast chop (motion blur)
    // makes tracking lose confidence and fall back to slow palm
    // re-detection — exactly when a cut must land. 0.4 keeps the light
    // tracker locked on through blur.
    minHandDetectionConfidence: 0.4,
    minHandPresenceConfidence: 0.4,
    minTrackingConfidence: 0.4,
  });
  try {
    return await HandLandmarker.createFromOptions(fileset, opts("GPU"));
  } catch (err) {
    console.warn("GPU delegate failed, falling back to CPU:", err);
    return await HandLandmarker.createFromOptions(fileset, opts("CPU"));
  }
}

let modelError = null;
let modelPromise = null;
/* The main-thread model is only created if the detection worker has to fall
   back; the worker loads its own copy. */
function getModel() {
  if (!modelPromise) {
    modelPromise = createLandmarker().catch((err) => {
      modelError = err;
      return null;
    });
  }
  return modelPromise;
}

async function openCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error(
      "This browser cannot access the camera. Open the page over HTTPS (or localhost)."
    );
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: CAM_WIDTH },
        height: { ideal: CAM_HEIGHT },
      },
    });
  } catch (err) {
    return await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
  }
}

function showLoading(on, msg = "") {
  $("loading").classList.toggle("hidden", !on);
  $("loadMsg").textContent = msg;
}

function setStatus(text) {
  $("status").textContent = text;
}

async function start() {
  const btn = $("startBtn");
  btn.disabled = true;
  try {
    showLoading(true, "Starting camera…");
    const stream = await openCamera();
    video.srcObject = stream;
    await video.play();
    if (!video.videoWidth) {
      await new Promise((res) =>
        video.addEventListener("loadedmetadata", res, { once: true })
      );
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    stage.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
    layoutCanvas();

    sfx.init();

    btn.classList.add("hidden");
    setStatus("");
    $("hint").classList.remove("hidden");
    running = true;
    lastT = performance.now();
    requestAnimationFrame(loop);
    // Detection prefers the worker (it loads the model itself and warms up
    // on the first frame it receives); if the worker cannot run, it falls
    // back to the main-thread loop, which loads the model lazily.
    startDetector();
  } catch (err) {
    console.error(err);
    showLoading(false);
    btn.disabled = false;
    setStatus("Could not start: " + err.message);
  }
}

/* Keep the overlay canvas exactly on top of the letterboxed video. */
function layoutCanvas() {
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;
  const sw = stage.clientWidth;
  const sh = stage.clientHeight;
  if (!sw || !sh) return;
  const scale = Math.min(sw / vw, sh / vh);
  const w = vw * scale;
  const h = vh * scale;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.style.left = `${(sw - w) / 2}px`;
  canvas.style.top = `${(sh - h) / 2}px`;
}
new ResizeObserver(layoutCanvas).observe(stage);

$("startBtn").addEventListener("click", start);
$("muteBtn").addEventListener("click", () => {
  sfx.enabled = !sfx.enabled;
  $("muteBtn").textContent = sfx.enabled ? "🔊" : "🔇";
});
$("resetBtn").addEventListener("click", () => {
  score = 0;
  cuts = 0;
  fruits = [];
  halves = [];
  particles = [];
  texts = [];
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) blade.clear(); // avoid a phantom mega-slice on return
});

// ---- spawning -----------------------------------------------------------------
function spawnWave() {
  const n = Math.random() < BURST_CHANCE ? 2 + Math.floor(Math.random() * 2) : 1;
  for (let i = 0; i < n; i++) fruits.push(spawnFruit(canvas.width));
}

// ---- slicing --------------------------------------------------------------------
function cutFruit(f) {
  f.dead = true;
  cuts += 1;
  score += f.points;

  const ang = blade.angle() + Math.PI / 2; // cut line perpendicular to motion
  const px = Math.cos(ang);
  const py = Math.sin(ang);
  // two halves fly apart along the cut
  for (const side of [-1, 1]) {
    halves.push({
      x: f.x, y: f.y,
      vx: f.vx + px * side * (60 + Math.random() * 60),
      vy: f.vy - 40 + py * side * (60 + Math.random() * 60),
      rot: ang, rotSpeed: (Math.random() - 0.5) * 6,
      cut: ang, emoji: f.emoji, size: f.size, side,
      life: 1.1,
    });
  }
  // juice splatter
  const n = f.golden ? 26 : 16;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 40 + Math.random() * 180;
    particles.push({
      x: f.x, y: f.y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
      r: 2 + Math.random() * (f.golden ? 6 : 4),
      life: 0.5 + Math.random() * 0.5,
      color: f.golden ? (Math.random() < 0.5 ? "#ffd700" : "#fff3b0") : f.juice,
    });
  }
  texts.push({
    x: f.x, y: f.y - f.r, vy: -55,
    life: 0.9, text: f.golden ? `+${f.points} ⭐` : `+${f.points}`,
    color: f.golden ? "#ffd700" : "#ffffff", big: f.golden,
  });

  combo.registerCut(performance.now());
  sfx.splat();
  if (f.golden) sfx.sparkle();

  if (score > best) {
    best = score;
    try { localStorage.setItem("hn-best", String(best)); } catch (e) { /* ignore */ }
  }
}

/* Shared handling of one detection result, whether it came from the worker
   or the main-thread fallback. `hand` is the array of normalized landmarks
   (or null), `now` the timestamp the frame was captured. */
function handleLandmarks(hand, now) {
  if (hand && hand.length) {
    const W = canvas.width;
    const H = canvas.height;
    // blade = wrist (0) -> pinky knuckle (17), mirrored to screen space
    // and smoothed with a One-Euro filter: steady when the hand is
    // still, essentially no lag when it swings
    const wr = wristFilter.filter((1 - hand[0].x) * W, hand[0].y * H, now);
    const pk = pinkyFilter.filter((1 - hand[17].x) * W, hand[17].y * H, now);
    blade.addSample(wr.x, wr.y, pk.x, pk.y, now);
    handSeen = true;
    lastHandT = now;
  } else if (now - lastHandT < COAST_MS) {
    // Tracking dropout during a swing: coast. The blade keeps gliding
    // in its last direction with decaying speed instead of blinking
    // out, so a chop that briefly outpaces the camera still lands.
    const l = blade.last;
    if (l) {
      const v = blade.velocity();
      const dt = (now - l.t) / 1000;
      const decay = Math.exp(-dt / 0.08);
      blade.addSample(
        l.ax + v.vx * dt * decay, l.ay + v.vy * dt * decay,
        l.bx + v.vx * dt * decay, l.by + v.vy * dt * decay,
        now
      );
    }
  } else {
    blade.clear();
    handSeen = false;
  }
  // Slice check runs on every fresh OR coasted sample: a swing that
  // happens entirely inside a dropout still cuts through its path.
  if (handSeen) {
    const fast = blade.speed() >= SLICE_SPEED;
    if (fast && !swooshWasFast && now - sfx.lastSwoosh > 220) {
      sfx.swoosh();
      sfx.lastSwoosh = now;
    }
    swooshWasFast = fast;
    if (fast) {
      for (const f of fruits) {
        if (!f.dead && blade.cuts(f)) cutFruit(f);
      }
    }
  }
}

function startDetector() {
  try {
    detector = new Worker("detector.worker.js", { type: "module" });
    detector.onmessage = (ev) => {
      const d = ev.data || {};
      if (d.type !== "result") return;
      frameInFlight = false;
      firstResultSeen = true;
      if (d.error && ++detectErrors > 10) {
        fallbackToMainThread();
        return;
      }
      handleLandmarks(d.hand, d.t ?? performance.now());
    };
    detector.onerror = () => fallbackToMainThread();
    detectionMode = "worker";
    // If nothing comes back in time (blocked workers, broken CDN import,
    // very slow network), quietly fall back to main-thread detection.
    setTimeout(() => {
      if (detectionMode === "worker" && !firstResultSeen) fallbackToMainThread();
    }, 6000);
  } catch (err) {
    fallbackToMainThread();
  }
}

function fallbackToMainThread() {
  if (detectionMode !== "worker") return; // never started, or already on main
  detectionMode = "main";
  try { detector && detector.terminate(); } catch (e) { /* ignore */ }
  detector = null;
  frameInFlight = false;
  (async () => {
    landmarker = await getModel();
    if (!landmarker) {
      setStatus("Tracking failed: " + (modelError && modelError.message ? modelError.message : "model failed to load"));
      return;
    }
    // Warm up the model once: the first detectForVideo compiles GPU
    // shaders and is much slower than every call after it.
    try {
      detectCtx.drawImage(video, 0, 0, DETECT_WIDTH, DETECT_HEIGHT);
      landmarker.detectForVideo(detectCanvas, performance.now());
      lastVideoTime = video.currentTime;
    } catch (err) { /* warm-up failure is not fatal */ }
    detectLoop();
  })();
}

/* Pump one camera frame to the worker whenever it is idle: exactly one
   frame in flight at a time means the worker is always busy but never
   queues up, so detection latency stays minimal even under heavy load. */
async function pumpWorker() {
  if (detectionMode !== "worker" || frameInFlight) return;
  if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
  const t = performance.now();
  lastVideoTime = video.currentTime;
  frameInFlight = true;
  try {
    const bmp = await createImageBitmap(video);
    if (detectionMode !== "worker") { // fell back while we were capturing
      bmp.close();
      frameInFlight = false;
      return;
    }
    detector.postMessage({ type: "frame", bitmap: bmp, t }, [bmp]);
  } catch (err) {
    frameInFlight = false;
    if (++detectErrors > 10) fallbackToMainThread();
  }
}

/* ---- main-thread detection fallback ---------------------------------------
   Only used when the worker cannot run. Same shape as the worker path:
   detectForVideo() is synchronous and blocks, so this loop yields a frame
   between detections to let rendering breathe. */
async function detectLoop() {
  while (running && detectionMode === "main") {
    try {
      if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const now = performance.now();
        detectCtx.drawImage(video, 0, 0, DETECT_WIDTH, DETECT_HEIGHT);
        const result = landmarker.detectForVideo(detectCanvas, now);
        handleLandmarks(result.landmarks && result.landmarks[0], now);
        detectErrors = 0;
      }
    } catch (err) {
      if (++detectErrors > 5) {
        running = false;
        setStatus("Tracking error: " + err.message);
        return;
      }
    }
    await new Promise((r) => requestAnimationFrame(r));
  }
}

// ---- main loop: physics + rendering only --------------------------------------------
function loop(now) {
  if (!running) return;
  pumpWorker();
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  const W = canvas.width;
  const H = canvas.height;

  // -- spawning --
  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnWave();
    spawnTimer = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
  }

  // -- physics --
  for (const f of fruits) f.update(dt, W, H);
  fruits = fruits.filter((f) => !f.dead);

  for (const h of halves) {
    h.vy += 500 * dt;
    h.x += h.vx * dt;
    h.y += h.vy * dt;
    h.rot += h.rotSpeed * dt;
    h.life -= dt;
  }
  halves = halves.filter((h) => h.life > 0 && h.y < H + 120);

  for (const p of particles) {
    p.vy += 700 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
  }
  particles = particles.filter((p) => p.life > 0);

  for (const t of texts) {
    t.y += t.vy * dt;
    t.life -= dt;
  }
  texts = texts.filter((t) => t.life > 0);

  // -- combos --
  const finished = combo.poll(now);
  if (finished) {
    score += finished.bonus;
    texts.push({
      x: W / 2, y: H / 2.4, vy: -40, life: 1.2,
      text: `COMBO x${finished.count}  +${finished.bonus}`,
      color: "#7df9ff", big: true,
    });
  }

  try {
    render();
  } catch (err) {
    console.error("render error:", err); // a UI glitch must never kill tracking
  }
  requestAnimationFrame(loop);
}

// ---- sprite cache ---------------------------------------------------------------
/* Fruits and halves are pre-rendered once (emoji + glow) into offscreen
   canvases and then blitted with drawImage. The old code redrew every fruit
   with shadowBlur — the most expensive canvas 2D operation — which stalled
   the frame whenever several fruits were on screen and starved the
   (then main-thread) detection loop. */
const spriteCache = new Map();

function spriteBucket(size) {
  return Math.max(8, Math.round(size / 8) * 8);
}

function fruitSprite(emoji, size, golden) {
  const s = spriteBucket(size);
  const key = `f|${emoji}|${s}|${golden ? 1 : 0}`;
  let c = spriteCache.get(key);
  if (!c) {
    const pad = Math.ceil(s * 0.4);
    c = document.createElement("canvas");
    c.width = s + pad * 2;
    c.height = s + pad * 2;
    const g = c.getContext("2d");
    g.font = `${s}px serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    if (golden) {
      g.shadowColor = "#ffd700";
      g.shadowBlur = 30;
    } else {
      g.shadowColor = "rgba(0, 0, 0, 0.55)";
      g.shadowBlur = 14;
    }
    g.fillText(emoji, c.width / 2, c.height / 2);
    spriteCache.set(key, c);
  }
  return c;
}

function halfSprite(emoji, size, side) {
  const s = spriteBucket(size);
  const key = `h|${emoji}|${s}|${side < 0 ? 0 : 1}`;
  let c = spriteCache.get(key);
  if (!c) {
    const pad = Math.ceil(s * 0.4);
    c = document.createElement("canvas");
    c.width = s + pad * 2;
    c.height = s + pad * 2;
    const g = c.getContext("2d");
    g.font = `${s}px serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.shadowColor = "rgba(0,0,0,0.5)";
    g.shadowBlur = 10;
    g.save();
    g.beginPath();
    if (side < 0) g.rect(0, 0, c.width / 2, c.height);      // left half
    else g.rect(c.width / 2, 0, c.width / 2, c.height);     // right half
    g.clip();
    g.fillText(emoji, c.width / 2, c.height / 2);
    g.restore();
    spriteCache.set(key, c);
  }
  return c;
}

// ---- rendering -----------------------------------------------------------------------
function render() {
  const W = canvas.width;
  const H = canvas.height;

  // mirrored camera as the backdrop, veiled for contrast
  ctx.save();
  ctx.translate(W, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, W, H);
  ctx.restore();
  ctx.fillStyle = "rgba(8, 10, 24, 0.45)";
  ctx.fillRect(0, 0, W, H);

  // soft blade edge so the player sees their blade even when still — drawn
  // at a lightly extrapolated position so it glides between detection frames
  const lastSample = blade.last;
  if (handSeen && lastSample) {
    const v = blade.velocity();
    const dt = Math.min(0.05, (performance.now() - lastSample.t) / 1000);
    const decay = Math.exp(-dt / 0.08);
    const ex = v.vx * dt * decay;
    const ey = v.vy * dt * decay;
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = "#7df9ff";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(lastSample.ax + ex, lastSample.ay + ey);
    ctx.lineTo(lastSample.bx + ex, lastSample.by + ey);
    ctx.stroke();
    ctx.restore();
  }

  // glowing slice trail
  const trail = blade.trail();
  if (handSeen && trail.length > 3) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 1; i < trail.length; i++) {
      const a = (i / trail.length) * 0.5;
      ctx.strokeStyle = `rgba(125, 249, 255, ${a})`;
      ctx.lineWidth = 2 + (i / trail.length) * 10;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
      ctx.lineTo(trail[i].x, trail[i].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // fruits (pre-rendered sprites — cheap blits, no per-frame shadowBlur)
  for (const f of fruits) {
    const s = fruitSprite(f.emoji, f.size, f.golden);
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.angle);
    ctx.drawImage(s, -s.width / 2, -s.height / 2);
    ctx.restore();
    if (f.golden) { // shimmering ring
      ctx.save();
      ctx.strokeStyle = "rgba(255, 215, 0, 0.85)";
      ctx.lineWidth = 2.5;
      ctx.setLineDash([9, 7]);
      ctx.lineDashOffset = -performance.now() / 50;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r + 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // sliced halves (pre-rendered half sprites, rotated per instance)
  for (const h of halves) {
    const s = halfSprite(h.emoji, h.size, h.side);
    ctx.save();
    ctx.globalAlpha = Math.min(1, h.life / 0.5);
    ctx.translate(h.x, h.y);
    ctx.rotate(h.rot);
    ctx.drawImage(s, -s.width / 2, -s.height / 2);
    ctx.restore();
  }

  // juice splatter
  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, p.life / 0.3);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // floating texts
  for (const t of texts) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, t.life / 0.4);
    ctx.fillStyle = t.color;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
    ctx.lineWidth = 4;
    ctx.font = `800 ${t.big ? 34 : 24}px Outfit, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeText(t.text, t.x, t.y);
    ctx.fillText(t.text, t.x, t.y);
    ctx.restore();
  }

  // HUD (DOM)
  $("score").textContent = score;
  $("cuts").textContent = `${cuts} cut`;
  $("best").textContent = `Best ${best}`;
}
