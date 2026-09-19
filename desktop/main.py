"""Hand Quiz — answer questions with your fingers.

Webcam + MediaPipe hand tracking + OpenCV visuals.

Controls:
    q / Esc : quit
    r       : restart the quiz
    f       : toggle fullscreen
Run:
    python main.py [--camera 0] [--hands 2] [--width 1280] [--height 720]
"""

import argparse
import time

import cv2

from gestures import finger_count, gesture_name
from hand_tracker import HandTracker
from quiz import QuizGame
import ui


def parse_args():
    p = argparse.ArgumentParser(description="Gesture quiz game")
    p.add_argument("--camera", type=int, default=0, help="webcam index (default 0)")
    p.add_argument("--hands", type=int, default=2, help="max hands to track")
    p.add_argument("--width", type=int, default=1280, help="capture width")
    p.add_argument("--height", type=int, default=720, help="capture height")
    p.add_argument("--window", type=int, default=1280, help="window width")
    return p.parse_args()


def main():
    args = parse_args()

    cap = cv2.VideoCapture(args.camera)
    if not cap.isOpened():
        raise SystemExit(
            f"Could not open camera {args.camera}. "
            "Check it is connected and not used by another app."
        )
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, args.width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, args.height)

    tracker = HandTracker(num_hands=args.hands)
    game = QuizGame()
    fullscreen = False

    print("Hand Quiz running — press Q or Esc to quit.")
    last_t = time.monotonic()
    fps_avg = None

    while True:
        ok, frame = cap.read()
        if not ok:
            print("Camera returned no frame; exiting.")
            break

        # Mirror for a natural "looking at a mirror" feel.
        frame = cv2.flip(frame, 1)

        # --- detect ---------------------------------------------------------
        hands = tracker.process(frame)
        counts = [finger_count(lm) for lm in hands]

        # --- game update ------------------------------------------------------
        now = time.monotonic()
        dt = now - last_t
        last_t = now
        fps_avg = (1.0 / dt) if fps_avg is None else 0.9 * fps_avg + 0.1 * (1.0 / dt)
        game.update(counts, dt)

        # --- draw ---------------------------------------------------------
        scale = args.window / frame.shape[1]
        if scale != 1.0:
            frame = cv2.resize(frame, None, fx=scale, fy=scale)
        ui.draw_frame(frame, game, counts, hands, fps=fps_avg)
        if hands:
            g = gesture_name(hands[0])
            cv2.putText(frame, g, (14, 92), cv2.FONT_HERSHEY_SIMPLEX,
                        0.55, ui.ACCENT, 1, cv2.LINE_AA)

        cv2.imshow("Hand Quiz", frame)
        key = cv2.waitKey(1) & 0xFF
        if key in (ord("q"), 27):
            break
        if key == ord("r"):
            game.restart()
        if key == ord("f"):
            fullscreen = not fullscreen
            cv2.setWindowProperty(
                "Hand Quiz", cv2.WND_PROP_FULLSCREEN,
                cv2.WINDOW_FULLSCREEN if fullscreen else cv2.WINDOW_NORMAL,
            )

    cap.release()
    cv2.destroyAllWindows()
    tracker.close()


if __name__ == "__main__":
    main()
