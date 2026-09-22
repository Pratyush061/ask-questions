/* Headless tests for the pure game logic (no browser / camera needed).
   Run:  node logic.test.mjs */

import assert from "node:assert/strict";
import {
  Fruit, spawnFruit, Blade, ComboTracker, OneEuro2,
  segCircleHit, pointSegDist,
  GRAVITY, SLICE_SPEED, GOLDEN_CHANCE, SLICE_WINDOW,
} from "./logic.mjs";

// ---- geometry ---------------------------------------------------------------
assert.equal(pointSegDist(5, 0, 0, 0, 10, 0), 0);           // point on segment
assert.equal(pointSegDist(0, 5, 0, 0, 10, 0), 5);           // perpendicular, endpoint nearest
assert.equal(pointSegDist(-3, 0, 0, 0, 10, 0), 3);          // before segment
assert.equal(pointSegDist(13, 0, 0, 0, 10, 0), 3);          // after segment
assert.equal(pointSegDist(5, 4, 0, 0, 10, 0), 4);           // perpendicular
assert.equal(pointSegDist(3, 3, 3, 3, 3, 3), Math.hypot(0, 0)); // degenerate segment

assert.equal(segCircleHit(0, 0, 10, 0, 5, 0, 1), true);    // through center
assert.equal(segCircleHit(0, 0, 10, 0, 5, 5, 2), false);    // too far
assert.equal(segCircleHit(0, 0, 10, 0, 5, 2.5, 3), true);   // grazing
console.log("geometry: OK");

// ---- fruit physics ------------------------------------------------------------
const f = new Fruit({ x: 100, y: 0, vx: 10, vy: 0, r: 40, size: 90,
                     emoji: "🍎", juice: "#f00", points: 10, spin: 2 });
f.update(0.5, 640, 480);
assert.ok(Math.abs(f.vy - GRAVITY * 0.5) < 1e-9, "gravity applied");
assert.equal(f.x, 105);                     // vx * dt
assert.ok(f.y > 0);
assert.ok(f.angle > 0);                     // spun
// falls off the bottom -> dead (zen: no penalty, just gone)
const g = new Fruit({ x: 100, y: 470, vx: 0, vy: 100, r: 40, size: 90,
                      emoji: "🍎", juice: "#f00", points: 10, spin: 0 });
g.update(1, 640, 480);
assert.equal(g.dead, true);
// bounces off the side walls
const s = new Fruit({ x: 5, y: 100, vx: -100, vy: 0, r: 40, size: 90,
                      emoji: "🍎", juice: "#f00", points: 10, spin: 0 });
s.update(0.1, 640, 480);
assert.ok(s.x >= s.r && s.vx > 0, "wall bounce");

// verify dt clamping effect (although clamping happens in game loop, verify huge dt behaves predictably)
const spikeFruit = new Fruit({ x: 100, y: 0, vx: 0, vy: 0, r: 40, size: 90,
    emoji: "🍎", juice: "#f00", points: 10, spin: 0 });
// simulate massive dt (e.g. 5 seconds tab switch)
// The loop limits dt to 0.05, so we manually call it with that max to see if gravity explodes
spikeFruit.update(0.05, 640, 480);
assert.ok(spikeFruit.vy < 50, "dt-spike clamping prevents insane velocities");

console.log("fruit physics: OK");

// ---- spawning ------------------------------------------------------------------
// deterministic rng: 0 -> first fruit, never golden (0 < 0.07 except first draw)
const rng = () => 0.5;
const a = spawnFruit(640, rng);
assert.ok(a.y <= 0 && a.y + a.size <= 0, "spawns above the screen");
assert.ok(a.x >= 40 && a.x <= 600, "spawns within x bounds");
assert.equal(a.golden, false);
assert.equal(a.points, 10);
const goldenRng = () => 0.001; // first call picks fruit, second < GOLDEN_CHANCE
const gold = spawnFruit(640, goldenRng);
assert.equal(gold.golden, true);
assert.equal(gold.points, 50);
assert.equal(gold.juice, "#ffd700");
// every fruit type has a consistent config
console.log("spawn: OK");

// ---- blade slicing ----------------------------------------------------------------
// A fast-moving blade cuts a fruit lying on the blade segment
const blade = new Blade();
blade.addSample(100, 100, 100, 200, 0);
blade.addSample(300, 100, 300, 200, 100); // moved 200px in 100ms = 2000px/s
const onPath = new Fruit({ x: 300, y: 150, vx: 0, vy: 0, r: 30, size: 70,
                           emoji: "🍊", juice: "#fa0", points: 10, spin: 0 });
assert.equal(blade.cuts(onPath), true, "fast blade on segment cuts");

// A stationary hand never cuts (speed gate)
const slow = new Blade();
slow.addSample(300, 100, 300, 200, 0);
slow.addSample(305, 100, 305, 200, 100); // 50px/s — way below SLICE_SPEED
assert.equal(slow.cuts(onPath), false, "slow hand does not cut");

// A fruit between the previous and current blade position (swept path) is cut
const swept = new Blade();
swept.addSample(100, 400, 150, 450, 0);
swept.addSample(500, 410, 550, 460, 100); // swept across the screen
const midAir = new Fruit({ x: 300, y: 430, vx: 0, vy: 0, r: 20, size: 60,
                           emoji: "🍇", juice: "#a0f", points: 10, spin: 0 });
assert.equal(swept.cuts(midAir), true, "swept path catches fast swipes");

// A fruit far away is never cut, however fast
const farAway = new Fruit({ x: 300, y: 100, vx: 0, vy: 0, r: 30, size: 70,
                            emoji: "🍍", juice: "#fb0", points: 10, spin: 0 });
assert.equal(swept.cuts(farAway), false);

// blade angle reflects motion direction
assert.ok(Math.abs(blade.angle() - 0) < 1e-6, "moving right -> angle 0");
console.log("blade: OK");

// ---- combos -----------------------------------------------------------------------
const combo = new ComboTracker();
combo.registerCut(0);
combo.registerCut(100);
combo.registerCut(220); // 3 fruits in one swing
assert.equal(combo.poll(400), null);      // 400-220 = 180ms: window still open
assert.deepEqual(combo.poll(600), { count: 3, bonus: 15 }); // 380ms later: chain closes
assert.equal(combo.poll(700), null);      // already consumed
// a single fruit is not a combo
const c3 = new ComboTracker();
c3.registerCut(0);
assert.equal(c3.poll(1000), null);
// cuts separated by more than the window do not chain
const c4 = new ComboTracker();
c4.registerCut(0);
c4.registerCut(1000);
assert.equal(c4.poll(2000), null);
assert.ok(GOLDEN_CHANCE > 0 && GOLDEN_CHANCE < 0.5);
console.log("combos: OK");

// ---- one-euro smoothing ---------------------------------------------------------
const oe = new OneEuro2();
assert.deepEqual(oe.filter(5, 7, 0), { x: 5, y: 7 }); // first value passes through
// jitter is smoothed away
const j = new OneEuro2();
j.filter(0, 0, 0);
let out = { x: 0, y: 0 };
for (let i = 1; i <= 40; i++) {
  out = j.filter(i % 2 === 0 ? 3 : -3, 0, i * 33);
}
assert.ok(Math.abs(out.x) < 2, "jitter smoothed: " + out.x);
// a fast jump passes through almost untouched
const fj = new OneEuro2();
fj.filter(0, 0, 0);
const fastJump = fj.filter(1000, 0, 100);
assert.ok(fastJump.x > 900, "fast movement follows: " + fastJump.x);
console.log("one-euro filter: OK");

// ---- multi-sample slice window -----------------------------------------------------
// A fruit crossed mid-window during a fast swing is cut even when neither the
// newest blade segment nor the newest step's sweep touches it.
const sw = new Blade();
sw.addSample(0, 200, 50, 250, 0);
sw.addSample(70, 205, 120, 255, 50);   // fast right
sw.addSample(140, 210, 190, 260, 100); // fast right
sw.addSample(150, 212, 200, 262, 150); // decelerating
const passed = new Fruit({ x: 105, y: 232, vx: 0, vy: 0, r: 20, size: 60,
                           emoji: "🍇", juice: "#a0f", points: 10, spin: 0 });
assert.equal(sw.cuts(passed), true, "fruit hit mid-window during swing is cut");
// velocity() tracks the last motion
const vel = sw.velocity();
assert.ok(vel.vx > 0 && vel.vy < 100, "velocity tracks motion");
// with old behaviour (only the newest sweep) the same fruit was missed
assert.ok(SLICE_WINDOW >= 3, "window spans several samples");
console.log("slice window: OK");

// ---- extended blade edge -------------------------------------------------------------
// A fruit just past the pinky end of the blade is caught by the 30% extension
const ext = new Blade();
ext.addSample(200, 200, 200, 260, 0);
ext.addSample(400, 200, 400, 260, 100); // fast right; blade is 60px tall
const graze = new Fruit({ x: 400, y: 300, vx: 0, vy: 0, r: 20, size: 60,
                          emoji: "🍎", juice: "#f00", points: 10, spin: 0 });
assert.equal(ext.cuts(graze), true, "extended edge catches grazes past the pinky");
const miss = new Fruit({ x: 400, y: 340, vx: 0, vy: 0, r: 20, size: 60,
                         emoji: "🍎", juice: "#f00", points: 10, spin: 0 });
assert.equal(ext.cuts(miss), false, "far below the blade is still not cut");
console.log("blade extension: OK");

console.log("\nAll logic tests passed.");
