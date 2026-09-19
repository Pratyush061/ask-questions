/* Hand Quiz — browser version (mobile-friendly).
   MediaPipe Tasks Vision runs locally in the visitor's browser.
   The quiz state machine lives in quiz.mjs (unit-tested via quiz.test.mjs). */

import {
  HandLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
import { QuizGame, QUESTIONS } from "./quiz.mjs";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";

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
let fpsAvg = null;
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
  // thumb: tip farther from the pinky knuckle than the joint below it
  up.push(dist(lm[4], pinkyMcp) > dist(lm[3], pinkyMcp) ? 1 : 0);
  // other fingers: tip farther from the wrist than the middle knuckle
  for (const [tip, pip] of [[8, 6], [12, 10], [16, 14], [20, 18]]) {
    up.push(dist(lm[tip], wrist) > dist(lm[pip], wrist) * 1.15 ? 1 : 0);
  }
  return up;
}

function countFingers(lm) {
  return fingersUp(lm).reduce((a, b) => a + b, 0);
}

/* ---------- camera + model startup (hardened for mobile) ---------- */
async function openCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error(
      "This browser cannot access the camera. Open the page over HTTPS (or localhost)."
    );
  }
  // Mobile-safe constraints: front camera, *ideal* resolution (never exact),
  // because many phone cameras don't offer 1280x720 and exact values fail.
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
  } catch (err) {
    // Some mobile browsers reject facingMode/size constraints — plain retry.
    return await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
  }
}

async function createLandmarker() {
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO",
    numHands: 2,
  });
  try {
    return await HandLandmarker.createFromOptions(fileset, opts("GPU"));
  } catch (err) {
    // The GPU (WebGL) delegate crashes on some Android/iOS devices;
    // the CPU delegate is slower but always works.
    console.warn("GPU delegate failed, falling back to CPU:", err);
    return await HandLandmarker.createFromOptions(fileset, opts("CPU"));
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
    // Wait until real dimensions exist (metadata race on mobile).
    if (!video.videoWidth) {
      await new Promise((res) =>
        video.addEventListener("loadedmetadata", res, { once: true })
      );
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    // Fit the video's true aspect ratio inside the stage.
    stage.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
    layoutCanvas();

    showLoading(true, "Loading hand-tracking model…");
    landmarker = await createLandmarker();
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
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
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
  fpsAvg = fpsAvg === null ? 1 / dt : 0.9 * fpsAvg + 0.1 * (1 / dt);

  try {
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const result = landmarker.detectForVideo(video, now);
      lastCounts = result.landmarks.map(countFingers);
      drawHands(result.landmarks);
      detectErrors = 0;
    }
  } catch (err) {
    // Don't die silently — surface repeated tracking failures.
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

/* ---------- drawing ---------- */
function drawHands(hands) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const locked = game.lockProgress() > 0.05;
  for (const lm of hands) {
    // mirror x to match the mirrored <video>
    const pts = lm.map((p) => [(1 - p.x) * canvas.width, p.y * canvas.height]);
    ctx.strokeStyle = locked ? "#f4d03f" : "#34d058";
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
  }
}
