/* Hand Ninja — detection worker. Runs MediaPipe HandLandmarker on its own
   thread so heavy rendering (many fruits, particles, splatter) can never
   starve hand detection: the browser's main thread renders at 60fps while
   this worker owns the model and infers on every frame it is sent.

   Protocol (main thread -> worker):
     { type: "frame", bitmap: ImageBitmap, t: timestampMs }
   Protocol (worker -> main thread):
     { type: "result", t: timestampMs, hand: [{x,y}...] | null, error?: string }

   The main thread keeps exactly one frame in flight, so the worker is always
   busy but never builds a queue — detection latency stays minimal. */

import {
  HandLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";

// keep in sync with game.js (duplicated so the worker is self-contained)
const NUM_HANDS = 1;
const DETECT_WIDTH = 288;
const DETECT_HEIGHT = 216;

const off = new OffscreenCanvas(DETECT_WIDTH, DETECT_HEIGHT);
const offCtx = off.getContext("2d");

let initPromise = null;

function ensureLandmarker() {
  if (!initPromise) {
    initPromise = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      const opts = (delegate) => ({
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: "VIDEO",
        numHands: NUM_HANDS,
        // Relaxed thresholds: fast chops blur the hand; at 0.5 the tracker
        // falls back to slow palm re-detection exactly when a cut must land.
        minHandDetectionConfidence: 0.4,
        minHandPresenceConfidence: 0.4,
        minTrackingConfidence: 0.4,
      });
      try {
        return await HandLandmarker.createFromOptions(fileset, opts("GPU"));
      } catch (err) {
        return await HandLandmarker.createFromOptions(fileset, opts("CPU"));
      }
    })();
  }
  return initPromise;
}

self.onmessage = async (ev) => {
  const { type, bitmap, t } = ev.data || {};
  if (type !== "frame" || !bitmap) return;
  try {
    const landmarker = await ensureLandmarker();
    offCtx.drawImage(bitmap, 0, 0, DETECT_WIDTH, DETECT_HEIGHT);
    bitmap.close();
    const result = landmarker.detectForVideo(off, t);
    const hand = result.landmarks && result.landmarks[0];
    self.postMessage({
      type: "result",
      t,
      hand: hand ? hand.map((p) => ({ x: p.x, y: p.y })) : null,
    });
  } catch (err) {
    try { bitmap.close(); } catch (e) { /* already closed */ }
    self.postMessage({
      type: "result",
      t,
      hand: null,
      error: String((err && err.message) || err),
    });
  }
};
