/* Hand Quiz — browser version.
   MediaPipe Tasks Vision runs locally in the visitor's browser.
   The quiz state machine and gesture heuristics are ports of the tested
   desktop/ Python implementation. */

import {
  HandLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";

const STABLE_FRAMES = 12; // frames a finger count must hold to be accepted
const FEEDBACK_SECONDS = 1.6;

const QUESTIONS = [
  { prompt: "What does this app use to find your hand in the camera feed?",
    options: ["MediaPipe", "TensorFlow.js", "PyTorch", "scikit-learn"], answer: 1 },
  { prompt: "How many landmarks does MediaPipe track per hand?",
    options: ["10", "21", "35", "50"], answer: 2 },
  { prompt: "How many hands can this tracker watch at the same time?",
    options: ["Exactly 1", "2 (both hands)", "5", "Only webcams with depth sensors"], answer: 2 },
  { prompt: "OpenCV stores color images in which channel order by default?",
    options: ["RGB", "RGBA", "BGR", "HSV"], answer: 3 },
  { prompt: "Which landmark index is the tip of the index finger?",
    options: ["4", "8", "12", "20"], answer: 2 },
  { prompt: "Roughly how fast does MediaPipe hand tracking run on a laptop CPU?",
    options: ["~1 frame per minute", "~1 frame per second", "Real time (30+ FPS)", "It needs a GPU cluster"], answer: 3 },
  { prompt: "What colour does this app draw on a locked-in correct answer?",
    options: ["Green", "Blue", "Red", "Yellow"], answer: 1 },
  { prompt: "How do you answer a question in this quiz?",
    options: ["Say it out loud", "Type it", "Hold up fingers", "Blink twice"], answer: 3 },
];

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

let landmarker = null;
let running = false;
let lastT = 0;
let lastVideoTime = -1;
let lastCounts = [];
let fpsAvg = null;
let renderedIndex = -1;
const game = new QuizGame(QUESTIONS);

/* ---------- quiz state machine (port of desktop/quiz.py) ---------- */
class QuizGame {
  constructor(questions) {
    this.allQuestions = questions;
    this.restart();
  }

  restart() {
    this.questions = [...this.allQuestions].sort(() => Math.random() - 0.5);
    this.index = 0;
    this.score = 0;
    this.phase = "intro";
    this.buffer = [];
    this.elapsed = 0;
    this.lastAnswer = null;
    this.lastCorrect = null;
  }

  get currentQuestion() {
    return this.questions[this.index];
  }

  update(counts, dt) {
    this.elapsed += dt;
    const best = counts.length ? Math.max(...counts) : 0;
    const stable = this._isStable(best);

    if (this.phase === "intro") {
      if (best >= 1 && stable) this._startQuestion();
    } else if (this.phase === "question") {
      if (best >= 1 && best <= 4 && stable) this._submit(best);
    } else if (this.phase === "feedback") {
      if (this.elapsed >= FEEDBACK_SECONDS) {
        this.index += 1;
        this.elapsed = 0;
        if (this.index >= this.questions.length) {
          this.phase = "done";
        } else {
          this._startQuestion();
        }
      }
    } else if (this.phase === "done") {
      if (best >= 1 && stable) this.restart();
    }
  }

  _isStable(count) {
    if (this.buffer.length < STABLE_FRAMES) {
      this.buffer.push(count);
      if (this.buffer.length > STABLE_FRAMES) this.buffer.shift();
      return false;
    }
    if (this.buffer.every((c) => c === count)) return true;
    this.buffer.push(count);
    if (this.buffer.length > STABLE_FRAMES) this.buffer.shift();
    return false;
  }

  _startQuestion() {
    this.phase = "question";
    this.buffer = [];
    this.elapsed = 0;
  }

  _submit(answer) {
    this.lastAnswer = answer;
    this.lastCorrect = answer === this.currentQuestion.answer;
    if (this.lastCorrect) this.score += 1;
    this.phase = "feedback";
    this.elapsed = 0;
  }

  heldCount() {
    if (!this.buffer.length) return 0;
    const last = this.buffer[this.buffer.length - 1];
    return last >= 1 && this.buffer.every((c) => c === last) ? last : 0;
  }

  lockProgress() {
    if (!this.buffer.length) return 0;
    const last = this.buffer[this.buffer.length - 1];
    if (last < 1) return 0;
    let run = 0;
    for (let i = this.buffer.length - 1; i >= 0 && this.buffer[i] === last; i--) run++;
    return Math.min(1, run / STABLE_FRAMES);
  }
}

/* ---------- gestures (port of desktop/gestures.py) ---------- */
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

/* ---------- startup ---------- */
$("startBtn").addEventListener("click", async () => {
  $("startBtn").disabled = true;
  $("status").textContent = "Loading hand-tracking model…";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720 },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();

    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 2,
    });

    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    $("stage").style.aspectRatio = `${canvas.width} / ${canvas.height}`;

    $("startBtn").classList.add("hidden");
    $("status").textContent = "";
    running = true;
    lastT = performance.now();
    requestAnimationFrame(loop);
  } catch (err) {
    $("startBtn").disabled = false;
    $("status").textContent =
      "Could not start: " + err.message +
      " — camera access needs HTTPS (or localhost) and permission.";
  }
});

/* ---------- main loop ---------- */
function loop(now) {
  if (!running) return;
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  fpsAvg = fpsAvg === null ? 1 / dt : 0.9 * fpsAvg + 0.1 * (1 / dt);

  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const result = landmarker.detectForVideo(video, now);
    lastCounts = result.landmarks.map(countFingers);
    drawHands(result.landmarks);
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
    ctx.strokeStyle = locked ? "#f4d03f" : "#3cb043";
    ctx.lineWidth = 3;
    for (const [a, b] of HAND_CONNECTIONS) {
      ctx.beginPath();
      ctx.moveTo(pts[a][0], pts[a][1]);
      ctx.lineTo(pts[b][0], pts[b][1]);
      ctx.stroke();
    }
    pts.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p[0], p[1], i % 4 === 0 ? 6 : 4, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
    });
  }
}

/* ---------- UI rendering ---------- */
function render() {
  const total = game.questions.length;
  $("score").textContent = `Score: ${game.score}/${total}`;
  $("qnum").textContent = `Q${Math.min(game.index + 1, total)}/${total}`;
  $("fps").textContent = fpsAvg ? `${Math.round(fpsAvg)} FPS` : "";

  $("intro").classList.toggle("hidden", game.phase !== "intro");
  $("question").classList.toggle("hidden", game.phase !== "question");
  $("done").classList.toggle("hidden", game.phase !== "done");
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
        ? `hold ${held} finger${held > 1 ? "s" : ""}…`
        : "hold up the right number of fingers";
  }

  const fb = $("feedback");
  if (game.phase === "feedback") {
    fb.classList.remove("hidden", "correct", "wrong");
    fb.classList.add(game.lastCorrect ? "correct" : "wrong");
    $("feedbackText").textContent = game.lastCorrect ? "CORRECT!" : "WRONG";
    const q = game.currentQuestion;
    $("feedbackSub").textContent =
      `You showed ${game.lastAnswer} finger${game.lastAnswer > 1 ? "s" : ""} — ` +
      `answer: ${q.answer} (${q.options[q.answer - 1]})`;
  } else {
    fb.classList.add("hidden");
  }

  if (game.phase === "done") {
    const pct = Math.round((100 * game.score) / total);
    $("finalScore").textContent = `Final score: ${game.score}/${total} (${pct}%)`;
  }
}
