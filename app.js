/* Hand Quiz — browser version, tuned for mobile speed.
   MediaPipe Tasks Vision runs locally in the visitor's browser.

   Speed strategy:
   - The model + WASM download starts the moment the page loads (and
     index.html <link rel="preload"> usually already fetched the model).
   - Detection runs on a 640x480 frame: ~4x fewer pixels than 1280x720.
   - One hand only: roughly 2x faster than two.
   - GPU (WebGL) delegate with automatic CPU fallback.
   - A small median filter keeps finger counts steady without re-detecting. */

import {
  HandLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
import { QuizGame, QUESTIONS } from "./quiz.mjs";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";

// ---- performance tuning ----------------------------------------------------
const NUM_HANDS = 1;     // one hand: ~2x faster than two
const CAM_WIDTH = 640;   // small frames: ~4x fewer pixels than 1280x720
const CAM_HEIGHT = 480;
const SMOOTH_WINDOW = 5; // median-filter window for finger counts

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],           // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],           // index
  [5, 9], [9, 10], [10, 11], [11, 12],      // middle
  [9, 13], [13, 14], [14, 15], [15, 16],    // ring
  [13, 17], [17, 18], [18, 19], [19, 20],   // pinky
  [0, 17],                                  // palm base
];

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const video = $("cam");
const canvas = $("overlay");
const ctx = canvas.getContext("2d");
const stage = $("stage");

const game = new QuizGame(QUESTIONS);
let landmarker = null;
let running = false;
let lastT = 0;
let lastVideoTime = -1;
let lastCounts = [];
let renderedIndex = -1;
let detectErrors = 0;

/* ---------- gesture recognition (same heuristic as desktop/gestures.py) ---------- */
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function fingersUp(lm) {
  const wrist = lm[0];
  const pinkyMcp = lm[17];
  const up = [];
  up.push(dist(lm[4], pinkyMcp) > dist(lm[3], pinkyMcp) ? 1 : 0);
  for (const [tip, pip] of [[8, 6], [12, 10], [16, 14], [20, 18]]) {
    up.push(dist(lm[tip], wrist) > dist(lm[pip], wrist) * 1.15 ? 1 : 0);
  }
  return up;
}

function countFingers(lm) {
  return fingersUp(lm).reduce((a, b) => a + b, 0);
}

/* Median filter: kills single-frame flicker so counts feel rock solid. */
let countHistory = [];
function medianSmooth(count) {
  countHistory.push(count);
  if (countHistory.length > SMOOTH_WINDOW) countHistory.shift();
  const s = [...countHistory].sort((a, b) => a - b);
  return s[s.length >> 1];
}

/* ---------- model: start loading immediately, not on click ---------- */
async function createLandmarker() {
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO",
    numHands: NUM_HANDS,
  });
  try {
    return await HandLandmarker.createFromOptions(fileset, opts("GPU"));
  } catch (err) {
    // WebGL delegate crashes on some Android/iOS devices; CPU always works.
    console.warn("GPU delegate failed, falling back to CPU:", err);
    return await HandLandmarker.createFromOptions(fileset, opts("CPU"));
  }
}

let modelError = null;
const modelPromise = createLandmarker().catch((err) => {
  modelError = err;
  return null;
});

/* ---------- camera (mobile-safe constraints) ---------- */
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
    // Some mobile browsers reject facingMode/size constraints — plain retry.
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

    showLoading(true, "Loading hand-tracking model…");
    landmarker = await modelPromise;
    if (!landmarker) throw modelError || new Error("Model failed to load");
    showLoading(false);

    btn.classList.add("hidden");
    setStatus("");
    running = true;
    lastT = performance.now();
    requestAnimationFrame(loop);
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
$("restartBtn").addEventListener("click", () => {
  game.restart();
  renderedIndex = -1;
});

/* ---------- main loop ---------- */
function loop(now) {
  if (!running) return;
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;

  try {
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const result = landmarker.detectForVideo(video, now);
      const raw = result.landmarks.length ? countFingers(result.landmarks[0]) : 0;
      lastCounts = [medianSmooth(raw)];
      drawHands(result.landmarks);
      updateGestureChip(result.landmarks.length ? lastCounts[0] : null);
      detectErrors = 0;
    }
  } catch (err) {
    if (++detectErrors > 5) {
      running = false;
      setStatus("Tracking error: " + err.message);
      return;
    }
  }

  game.update(lastCounts, dt);
  render();
  requestAnimationFrame(loop);
}

function updateGestureChip(count) {
  const chip = $("gestureChip");
  if (count === null || count === 0) {
    chip.classList.add("hidden");
  } else {
    chip.classList.remove("hidden");
    chip.textContent = `✋ ${count}`;
  }
}

/* ---------- drawing ---------- */
function drawHands(hands) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const locked = game.lockProgress() > 0.05;
  ctx.lineCap = "round";
  for (const lm of hands) {
    const pts = lm.map((p) => [(1 - p.x) * canvas.width, p.y * canvas.height]);
    ctx.strokeStyle = locked ? "#fbbf24" : "#4ade80";
    ctx.lineWidth = 3;
    for (const [a, b] of HAND_CONNECTIONS) {
      ctx.beginPath();
      ctx.moveTo(pts[a][0], pts[a][1]);
      ctx.lineTo(pts[b][0], pts[b][1]);
      ctx.stroke();
    }
    for (let i = 0; i < pts.length; i++) {
      ctx.beginPath();
      ctx.arc(pts[i][0], pts[i][1], i % 4 === 0 ? 6 : 4, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
    }
  }
}

/* ---------- UI rendering ---------- */
function render() {
  const total = game.total;
  $("score").textContent = `Score ${game.score}/${total}`;
  $("qnum").textContent =
    game.phase === "intro" || game.phase === "done"
      ? "Hand Quiz"
      : `Q ${Math.min(game.index + 1, total)}/${total}`;
  $("quizProgressFill").style.width = `${Math.round((game.index / total) * 100)}%`;

  $("viewIntro").classList.toggle("hidden", game.phase !== "intro");
  $("viewQuestion").classList.toggle("hidden", game.phase !== "question");
  $("viewDone").classList.toggle("hidden", game.phase !== "done");
  if (game.phase !== "question") renderedIndex = -1;

  if (game.phase === "intro") {
    $("introFill").style.width = `${Math.round(game.lockProgress() * 100)}%`;
  }

  if (game.phase === "question" && renderedIndex !== game.index) {
    renderedIndex = game.index;
    const q = game.currentQuestion;
    $("prompt").textContent = q.prompt;
    const ul = $("options");
    ul.innerHTML = "";
    q.options.forEach((opt, i) => {
      const li = document.createElement("li");
      const num = document.createElement("span");
      num.className = "num";
      num.textContent = i + 1;
      const tally = document.createElement("span");
      tally.className = "tally";
      tally.textContent = "|".repeat(i + 1);
      const txt = document.createElement("span");
      txt.className = "txt";
      txt.textContent = opt;
      li.append(num, tally, txt);
      ul.appendChild(li);
    });
  }

  if (game.phase === "question") {
    const held = game.heldCount();
    const prog = game.lockProgress();
    [...$("options").children].forEach((li, i) => {
      li.classList.toggle("active", held === i + 1 && prog > 0.15);
    });
    $("answerFill").style.width = `${Math.round(prog * 100)}%`;
    $("holdLabel").textContent =
      held >= 1
        ? `Hold ${held} finger${held > 1 ? "s" : ""} steady…`
        : "Hold up the right number of fingers";
  }

  const fb = $("feedback");
  if (game.phase === "feedback") {
    fb.classList.remove("hidden", "correct", "wrong");
    fb.classList.add(game.lastCorrect ? "correct" : "wrong");
    $("feedbackEmoji").textContent = game.lastCorrect ? "✅" : "❌";
    $("feedbackText").textContent = game.lastCorrect ? "CORRECT!" : "WRONG";
    const q = game.currentQuestion;
    $("feedbackSub").textContent =
      `You showed ${game.lastAnswer} — answer: ${q.answer} (${q.options[q.answer - 1]})`;
  } else {
    fb.classList.add("hidden");
  }

  if (game.phase === "done") {
    const pct = Math.round((100 * game.score) / total);
    $("finalScore").textContent = `${game.score} / ${total} correct (${pct}%)`;
    $("quizProgressFill").style.width = "100%";
  }
}
