# Hand Ninja 🥷🍉 — slice fruit with your hand

A zen Fruit-Ninja-style browser game: your webcam feed is processed with
**MediaPipe** hand tracking, fruit falls from the top of the screen, and the
**edge of your hand** (wrist to pinky knuckle) is the blade. Chop through
fruit to score. No timer, no losing — just relaxing fruit cutting.

## Features

- **Hand-edge blade** — hold your hand like a karate chop; the tracking
  follows the line from your wrist to your pinky knuckle and slices any
  fruit you swipe through fast enough. Hovering never cuts.
- **Zen mode** — fruits fall endlessly; missing them costs nothing.
- **Combos** — cut several fruits in one swing for bonus points.
- **Golden fruit** — rare (about 1 in 14), falls faster, worth 50 points
  with a sparkle sound.
- **Juice splatter, flying halves and a glowing slice trail.**
- **Synthesized sound** — swoosh, juicy splat and sparkle generated live
  with the Web Audio API (no audio files, mute with 🔊 button).
- **Best score** is remembered between visits.

## How it works

1. **Hand tracking** — MediaPipe's HandLandmarker (VIDEO mode, one hand)
   runs in a **Web Worker** on its own thread (`detector.worker.js`), so
   heavy rendering can never starve detection: the main thread renders at
   60fps while the worker owns the model and infers on every frame it is
   sent (exactly one frame in flight — always busy, never a queue). If the
   worker cannot run, the game falls back to a yielding main-thread loop
   that loads the model lazily. Inference runs on a downscaled offscreen
   copy of the frame. Tracking thresholds are relaxed (0.4 instead of the
   default 0.5) so fast chops with motion blur keep the light tracker
   engaged instead of falling back to slow re-detection, and landmarks
   pass through a One-Euro filter — steady when the hand is still,
   essentially no lag when it swings.
2. **Blade** — the segment from the wrist to the pinky knuckle, extended
   30% past both ends so grazes still cut. During the brief dropouts of a
   fast swing the blade *coasts*: it keeps gliding in its last direction
   with decaying speed for up to 160 ms instead of blinking out, so a chop
   that outpaces the camera still lands. A fruit is cut when the blade
   segment, or its swept path over the last few motion samples, touches the
   fruit while moving faster than the slice threshold.
3. **Rendering** — fruits and halves are pre-rendered into cached sprites
   (emoji + glow drawn once) and blitted with drawImage; per-frame
   shadowBlur — the most expensive canvas operation — is gone entirely.
4. **Physics** — fruits fall with gentle gravity (tuned so a real hand can
   comfortably outrun them), drift sideways, bounce off the side walls and
   spin. Halves and juice particles fly apart from the cut line.
5. All game logic (geometry, physics, combos, spawning) is pure and lives in
   `logic.mjs` — unit-tested with plain Node.

## Run locally

Just open `index.html` over `localhost` (browsers only allow camera access
on HTTPS or localhost), e.g.:

```bash
python3 -m http.server
# open http://localhost:8000
```

## Deploy

It's a static site — import the repo on
[Vercel](https://vercel.com/new) or Render (Static Site, publish
directory `.`) and it works out of the box. A `vercel.json` pins Vercel
to a plain static deploy (no framework, no build step) — if the import
wizard asks for a framework preset, choose **Other**.

## Tests (no camera / browser needed)

```bash
node logic.test.mjs   # geometry, physics, blade slicing, combos, filters
node e2e.test.mjs    # full-pipeline simulation: spawn -> detection (with
                     # dropouts) -> smoothing -> coasting -> cuts -> combos
```

## Repository layout

```
├── index.html          # page + HUD
├── game.js             # camera, worker plumbing, rendering, sound, particles
├── detector.worker.js  # MediaPipe hand tracking on its own thread
├── logic.mjs           # pure game logic: physics, slicing geometry, combos
├── logic.test.mjs      # Node unit tests for the logic
├── e2e.test.mjs        # headless full-pipeline simulation
└── style.css           # dark zen theme
```

## License

MIT
