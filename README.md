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

1. **Hand tracking** — MediaPipe's HandLandmarker (VIDEO mode, one hand,
   480×360 detection frames for fast inference, WebGL delegate with CPU
   fallback) returns 21 landmarks per hand. Detection runs in its own loop
   that yields a frame between detections, so a slow inference call never
   drags the rendering below 60fps, and the model is warmed up once at
   startup so the first cut isn't fighting shader compilation.
2. **Blade** — the segment from the wrist to the pinky knuckle. A fruit is
   cut when the blade segment (or the path its midpoint swept this frame)
   touches the fruit while moving faster than the slice threshold — so a
   still hand never slices, and fast swipes never "tunnel" through fruit.
3. **Physics** — fruits fall with gentle gravity (tuned so a real hand can
   comfortably outrun them), drift sideways, bounce off the side walls and
   spin. Halves and juice particles fly apart from the cut line.
4. All game logic (geometry, physics, combos, spawning) is pure and lives in
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
directory `.`) and it works out of the box.

## Tests (no camera / browser needed)

```bash
node logic.test.mjs   # geometry, physics, blade slicing, combos, spawning
```

## Repository layout

```
├── index.html      # page + HUD
├── game.js          # camera, MediaPipe tracking, rendering, sound, particles
├── logic.mjs        # pure game logic: physics, slicing geometry, combos
├── logic.test.mjs   # Node tests for the logic
└── style.css        # dark zen theme
```

## License

MIT
