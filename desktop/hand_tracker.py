"""MediaPipe hand tracking wrapper (modern Tasks API).

Downloads the hand landmarker model on first run, then detects hands in
video frames. Uses VIDEO running mode so MediaPipe can use temporal
smoothing across frames.
"""

import os
import time
import urllib.request

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
    "hand_landmarker/float16/1/hand_landmarker.task"
)
MODEL_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "models", "hand_landmarker.task"
)


def ensure_model(model_path=MODEL_PATH, url=MODEL_URL):
    """Download the model file if it is not present yet."""
    if os.path.exists(model_path):
        return model_path
    os.makedirs(os.path.dirname(model_path), exist_ok=True)
    print(f"Downloading hand landmarker model to {model_path} ...")
    tmp = model_path + ".part"
    urllib.request.urlretrieve(url, tmp)
    os.replace(tmp, model_path)
    print("Model downloaded.")
    return model_path


class HandTracker:
    """Detects hands frame-by-frame using MediaPipe's HandLandmarker."""

    def __init__(self, num_hands=2, model_path=None):
        model_path = model_path or ensure_model()
        options = vision.HandLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=model_path),
            running_mode=vision.RunningMode.VIDEO,
            num_hands=num_hands,
            min_hand_detection_confidence=0.5,
            min_hand_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self._landmarker = vision.HandLandmarker.create_from_options(options)
        self._last_ts = -1

    def process(self, frame_bgr):
        """Detect hands in one BGR frame.

        Returns a list of hands; each hand is a list of 21 landmarks with
        `.x`, `.y` (normalised 0-1) and `.z` attributes.
        """
        # VIDEO mode requires strictly increasing timestamps in ms.
        ts = int(time.monotonic() * 1000)
        if ts <= self._last_ts:
            ts = self._last_ts + 1
        self._last_ts = ts

        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = self._landmarker.detect_for_video(image, ts)
        return result.hand_landmarks or []

    def close(self):
        self._landmarker.close()
