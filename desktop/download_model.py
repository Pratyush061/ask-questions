"""Standalone helper: download the MediaPipe hand landmarker model.

The tracker downloads it automatically on first run; this script exists
so you can pre-fetch it (e.g. on a machine without internet later).
"""

from hand_tracker import MODEL_PATH, MODEL_URL, ensure_model

if __name__ == "__main__":
    path = ensure_model()
    print(f"Model ready: {path}")
    print(f"Source: {MODEL_URL}")
