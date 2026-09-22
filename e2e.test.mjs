/* End-to-end (headless) simulation of the whole gameplay pipeline, the same
   code path the browser runs minus the DOM/camera/MediaPipe itself:
   spawn waves -> fruit physics -> hand landmarks (30fps cadence, with
   tracking dropouts) -> One-Euro smoothing -> blade -> coasting -> cutting
   -> combos. Run:  node e2e.test.mjs */

import assert from "node:assert/strict";
import {
  Fruit, spawnFruit, Blade, ComboTracker, OneEuro2,
  SLICE_SPEED, COAST_MS, BLADE_EXTEND,
} from "./logic.mjs";

const W = 480;
const H = 360;
const RENDER_DT = 1 / 60;   // render/physics tick
const DETECT_DT = 33 / 1000; // detection cadence (~30fps, like the worker)
const SPAWN_MIN = 0.55, SPAWN_MAX = 1.5, BURST_CHANCE = 0.3;

// deterministic rng (mulberry32)
let seed = 0x9e3779b9;
function rand() {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/* The engine harness — mirrors game.js's handleLandmarks exactly (no
   sound/DOM). */
function makeEngine() {
  const NUM_HANDS = 2;
  const blades = [new Blade(), new Blade()];
  const combo = new ComboTracker();
  const wristFilters = [new OneEuro2(), new OneEuro2()];
  const pinkyFilters = [new OneEuro2(), new OneEuro2()];
  const st = {
    fruits: [], score: 0, cuts: 0, comboBonuses: 0,
    handSeen: [false, false], lastHandTs: [-1e9, -1e9],
  };

  function handle(hands, now) {
    for (let i = 0; i < NUM_HANDS; i++) {
      const hand = hands && hands[i];
      const blade = blades[i];

      if (hand && hand.length) {
        const wr = wristFilters[i].filter((1 - hand[0].x) * W, hand[0].y * H, now);
        const pk = pinkyFilters[i].filter((1 - hand[17].x) * W, hand[17].y * H, now);
        blade.addSample(wr.x, wr.y, pk.x, pk.y, now);
        st.handSeen[i] = true;
        st.lastHandTs[i] = now;
      } else if (now - st.lastHandTs[i] < COAST_MS) {
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
        st.handSeen[i] = false;
      }

      if (st.handSeen[i]) {
        if (blade.speed() >= SLICE_SPEED) {
          for (const f of st.fruits) {
            if (!f.dead && blade.cuts(f)) {
              f.dead = true;
              st.cuts += 1;
              st.score += f.points;
              combo.registerCut(now);
            }
          }
        }
      }
    }
  }

  function tickCombos(now) {
    const done = combo.poll(now);
    if (done) {
      st.score += done.bonus;
      st.comboBonuses += 1;
      return done;
    }
    return null;
  }

  return { blades, combo, st, handle, tickCombos };
}

function spawnInto(st, count = 1) {
  for (let i = 0; i < count; i++) st.fruits.push(spawnFruit(W, rand));
}

function stepPhysics(st, dt) {
  for (const f of st.fruits) f.update(dt, W, H);
  st.fruits = st.fruits.filter((f) => !f.dead);
}

/* Hand model: mostly hovering, with a fast horizontal chop every 2s that
   sweeps the middle of the screen. `dropout(t)` decides when the tracker
   loses the hand (simulating blur dropouts during swings). */
function handAt(t, chop) {
  // returns a 21-landmark array (only 0=wrist and 17=pinky knuckle matter)
  const y = 0.5;
  let x = 0.3;
  if (chop) {
    const p = Math.min(1, Math.max(0, (t - chop.t0) / chop.dur));
    x = chop.x0 + (chop.x1 - chop.x0) * p;
  }
  const hand = new Array(21).fill(null);
  hand[0] = { x, y };
  hand[17] = { x, y: y + 90 / H }; // pinky knuckle ~90px below the wrist
  return hand;
}

// ---------------------------------------------------------------------------
// Scenario 1: a 60-second zen session with periodic fast chops and random
// dropouts — the pipeline must stay healthy and cut fruit throughout.
// ---------------------------------------------------------------------------
{
  const { st, handle, tickCombos } = makeEngine();
  let spawnTimer = 1.0;
  let ms = 0;
  let frame = 0;
  let detMs = 0;
  let chops = 0;
  while (ms < 60000) {
    ms = frame * RENDER_DT * 1000;
    // physics + spawning at render rate
    spawnTimer -= RENDER_DT;
    if (spawnTimer <= 0) {
      spawnInto(st, rand() < BURST_CHANCE ? 2 + Math.floor(rand() * 2) : 1);
      spawnTimer = SPAWN_MIN + rand() * (SPAWN_MAX - SPAWN_MIN);
    }
    stepPhysics(st, RENDER_DT);
    tickCombos(ms);
    // detection at its own cadence, with a chop every 2s
    while (detMs <= ms) {
      const t = detMs;
      const chopStart = Math.floor(t / 2000) * 2000;
      const inChop = t >= chopStart && t < chopStart + 150;
      const chop = inChop ? { t0: chopStart, dur: 150, x0: 0.15, x1: 0.85 } : null;
      if (inChop && t === chopStart) chops++;
      // the last stretch of each chop is a tracking dropout (motion blur)
      const dropout = inChop && t >= chopStart + 100;
      const h = dropout ? null : handAt(t, chop);
      handle(h ? [h] : [], t);
      detMs += DETECT_DT * 1000;
    }
    frame++;
  }
  assert.ok(st.cuts > 10, `pipeline cuts fruit over a session (got ${st.cuts} cuts, ${chops} chop starts)`);
  assert.ok(st.fruits.length < 40, `fruit array stays bounded (got ${st.fruits.length})`);
  console.log(`scenario 1 (60s session): ${st.cuts} cuts, ${st.comboBonuses} combo bonuses, ${st.fruits.length} fruits on screen at end — OK`);
}

// ---------------------------------------------------------------------------
// Scenario 2: a stationary hand next to a fruit must NOT cut it (speed gate),
// no matter how long it hovers.
// ---------------------------------------------------------------------------
{
  const { st, handle } = makeEngine();
  st.fruits.push(new Fruit({ x: (1 - 0.3) * W, y: 0.5 * H + 45, vx: 0, vy: 0, r: 30,
                             size: 70, emoji: "🍎", juice: "#f00", points: 10, spin: 0 }));
  for (let t = 0; t <= 2000; t += 33) {
    handle([handAt(t, null)], t);
    stepPhysics(st, 33 / 1000);
  }
  assert.equal(st.cuts, 0, "hovering hand never cuts");
  assert.equal(st.fruits[0].dead, false);
  console.log("scenario 2 (hover never cuts): OK");
}

// ---------------------------------------------------------------------------
// Scenario 3: fast chop with a dropout in the MIDDLE of the swing — coasting
// must carry the blade through and cut the fruit in the path.
// ---------------------------------------------------------------------------
{
  const { st, handle } = makeEngine();
  // fruit right in the middle of the chop path
  st.fruits.push(new Fruit({ x: 0.5 * W, y: 0.5 * H + 45, vx: 0, vy: 0, r: 30,
                             size: 70, emoji: "🍉", juice: "#f50", points: 10, spin: 0 }));
  // warm up the filters with a still hand first (so the filter doesn't eat the swing)
  for (let t = 0; t <= 1000; t += 33) handle([handAt(t, null)], t);
  // chop from x=0.15 to 0.85 over 150ms, with detection dropping out from 40ms..120ms
  const chop = { t0: 1100, dur: 150, x0: 0.15, x1: 0.85 };
  for (let t = 1100; t <= 1300; t += 33) {
    const dropout = t >= 1140 && t < 1220; // mid-swing dropout
    const h = dropout ? null : handAt(t, chop);
    handle(h ? [h] : [], t);
    stepPhysics(st, 33 / 1000);
  }
  assert.ok(st.cuts >= 1, `coasting cuts through a mid-swing dropout (got ${st.cuts} cuts)`);
  console.log("scenario 3 (coast through dropout): OK");
}

// ---------------------------------------------------------------------------
// Scenario 4: one swing through three fruits = a combo bonus.
// ---------------------------------------------------------------------------
{
  const { st, handle, tickCombos } = makeEngine();
  for (const x of [0.35, 0.5, 0.65]) {
    st.fruits.push(new Fruit({ x: x * W, y: 0.5 * H + 45, vx: 0, vy: 0, r: 30,
                               size: 70, emoji: "🍊", juice: "#fa0", points: 10, spin: 0 }));
  }
  for (let t = 0; t <= 1000; t += 33) handle([handAt(t, null)], t);
  const chop = { t0: 1100, dur: 150, x0: 0.15, x1: 0.85 };
  let comboResult = null;
  for (let t = 1100; t <= 2000; t += 33) {
    const h = handAt(t, t <= 1300 ? chop : null);
    handle([h], t);
    stepPhysics(st, 33 / 1000);
    comboResult = tickCombos(t) || comboResult;
  }
  assert.equal(st.cuts, 3, "one swing cuts all three fruits");
  assert.ok(comboResult, "combo bonus registered");
  assert.equal(comboResult.count, 3);
  assert.equal(comboResult.bonus, 15);
  console.log("scenario 4 (multi-fruit combo): OK");
}

// ---------------------------------------------------------------------------
// Scenario 5: stress — continuous heavy spawning (fruit storm). The pipeline
// must stay correct and bounded while slicing continues.
// ---------------------------------------------------------------------------
{
  const { st, handle } = makeEngine();
  let ms = 0;
  let frame = 0;
  let detMs = 0;
  let peakFruits = 0;
  let spawnTimer = 0;
  while (ms < 15000) {
    ms = frame * RENDER_DT * 1000;
    // 4x the game's spawn rate — a heavy but plausible fruit storm
    spawnTimer -= RENDER_DT;
    if (spawnTimer <= 0) {
      spawnInto(st, 4);
      spawnTimer = 0.25;
    }
    peakFruits = Math.max(peakFruits, st.fruits.length);
    stepPhysics(st, RENDER_DT);
    while (detMs <= ms) {
      const t = detMs;
      const chop = (t % 2500 < 200) ? { t0: Math.floor(t / 2500) * 2500, dur: 150, x0: 0.1, x1: 0.9 } : null;
      handle([handAt(t, chop)], t);
      detMs += DETECT_DT * 1000;
    }
    frame++;
  }
  assert.ok(st.fruits.length < 120, `stress: fruit array bounded (peak ${peakFruits}, end ${st.fruits.length})`);
  assert.ok(st.cuts > 0, `stress: still cutting under fruit storm (${st.cuts} cuts)`);
  console.log(`scenario 5 (fruit storm, 15s): peak ${peakFruits} fruits, ${st.cuts} cuts — OK`);
}

// blade edge extension is active
assert.ok(BLADE_EXTEND > 0, "blade edge extension enabled");

console.log("\nAll end-to-end scenarios passed.");
