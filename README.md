# Hand Quiz 🖐️ — answer questions with your fingers

A real-time computer-vision quiz game: your webcam feed is processed with
**MediaPipe** hand tracking, questions appear on screen, and you answer by
holding up **1–4 fingers**. An answer only counts once the finger count has
been stable for ~0.4 s, so flickers never register. **20 questions** per
round, shuffled every time.

Works on **desktop and mobile browsers** (responsive layout, front camera,
automatic GPU→CPU fallback for devices where WebGL tracking fails).

| Folder | Stack | Runs on |
|--------|-------|---------|
| `/` (root) | MediaPipe Tasks **JS** + plain HTML/CSS | **Any browser** — deployable on Vercel/Render |
| `desktop/` | Python + OpenCV + MediaPipe | Your laptop (local webcam + GUI window) |

> The Python desktop app needs a local webcam and opens an OpenCV GUI
> window, so it cannot run on a server (Vercel/Render have no webcams).
> The web version runs all tracking **in the visitor's browser**, which is
> what makes it deployable anywhere as a static site.

## 🚀 Deploy the web version

The root is already a static site (`index.html` + `app.js` + `style.css` +
`quiz.mjs`). No build step, no dependencies.

**Vercel**
1. Push this repo to GitHub.
2. [vercel.com/new](https://vercel.com/new) → Import the repository.
3. Framework Preset: **Other**. Leave everything else default. Deploy.
4. Open the generated `https://…vercel.app` URL.

**Render**
1. [dashboard.render.com](https://dashboard.render.com) → New → **Static Site**.
2. Connect the repo. Build command: *(leave empty)*. Publish directory: `.`.

**Netlify / GitHub Pages** work the same way — it's just static files.

> Note: browsers only allow camera access on **HTTPS** (or `localhost`).
> Vercel/Render serve HTTPS automatically, so it just works once deployed.

## 🧪 Tests (no camera / browser needed)

```bash
node quiz.test.mjs        # web quiz state machine (20 questions, flicker rejection, restart)
cd desktop && python test_logic.py   # desktop version
```

## 🖥️ Run the desktop version (Python + OpenCV)

```bash
cd desktop
pip install -r requirements.txt
python main.py            # options: --camera 0 --hands 2 --width 1280 --height 720
```

The MediaPipe model (`models/hand_landmarker.task`, ~8 MB) downloads
automatically on first run, or pre-fetch it with `python download_model.py`.

## How it works

1. **Hand tracking** — MediaPipe's HandLandmarker (VIDEO running mode,
   up to 2 hands) returns 21 3-D landmarks per hand. On the web it tries the
   fast WebGL delegate first and falls back to the CPU delegate if the
   device's GPU stack fails (common on some Android/iOS devices).
2. **Gesture recognition** — a rotation-invariant heuristic counts extended
   fingers: a finger is *up* when its fingertip is farther from the wrist
   than its middle knuckle; the thumb is *up* when its tip is farther from
   the pinky knuckle than the joint below it.
3. **Quiz state machine** (`quiz.mjs` / `desktop/quiz.py`) — intro → question
   → feedback → score. A finger count must stay identical for 12 consecutive
   frames (~0.4 s) before it is accepted, shown as a lock-in progress bar.
4. **UI** — mobile-first responsive layout: video and question panel stack
   vertically on phones, sit side by side in landscape / on desktop. The
   overlay canvas is kept pixel-aligned with the letterboxed video.

## Mobile notes & troubleshooting

- **Camera blocked** — make sure the URL starts with `https://` and you
  granted camera permission. The error message on screen says exactly
  what went wrong.
- **Front camera** — the app requests the user-facing camera; a plain
  retry without camera constraints happens automatically if the browser
  rejects them.
- **Slow start on phones** — the ~8 MB model + WASM download is shown with
  a spinner; on slow connections this can take a moment.
- **Tracking stops with an error** — rare device-specific WASM problems;
  the page shows the error text. Tap Restart to try again.
- **Answers trigger accidentally** — raise `STABLE_FRAMES` in `quiz.mjs`
  (or `desktop/quiz.py`); lower it for faster lock-in.

## Customizing

- **Questions** — edit the `QUESTIONS` array in `quiz.mjs` (web) or
  `QUESTION_BANK` in `desktop/quiz.py`. Up to 4 options each; `answer` is
  the 1-based index of the correct option.
- **Lock-in speed** — `STABLE_FRAMES` (12): lower = faster, more false
  positives.
- **Detection strictness** — the `HandLandmarker` options in `app.js` or
  `desktop/hand_tracker.py`.

## Repository layout

```
├── index.html        # web version — static, deployable as-is
├── app.js            # camera + MediaPipe JS tracking + drawing + UI glue
├── quiz.mjs          # question bank + game state machine (unit-tested)
├── quiz.test.mjs     # Node tests for the quiz logic
├── style.css         # mobile-first responsive styling
└── desktop/          # original Python + OpenCV desktop app
    ├── main.py         # webcam loop
    ├── hand_tracker.py # MediaPipe HandLandmarker wrapper
    ├── gestures.py     # landmarks -> finger count
    ├── quiz.py         # question bank + game state machine
    ├── ui.py           # OpenCV drawing
    ├── download_model.py
    ├── test_logic.py   # headless tests (no camera needed)
    └── requirements.txt
```

## License

MIT
