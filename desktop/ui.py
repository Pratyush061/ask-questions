"""All OpenCV drawing for the quiz game.

Kept separate from the game logic so the visuals can be worked on
independently (and rendered offline for screenshots).
"""

import cv2
import numpy as np

from gestures import HAND_CONNECTIONS

# Palette (BGR)
BG_PANEL = (30, 30, 30)
TEXT_MAIN = (245, 245, 245)
ACCENT = (90, 170, 60)        # green
ACCENT_DIM = (45, 90, 30)
WRONG = (60, 60, 200)         # red
NEUTRAL = (180, 180, 180)
SKELETON = (60, 200, 60)
SKELETON_LOCKED = (30, 220, 250)  # yellow-ish when answer is locking in

FONT = cv2.FONT_HERSHEY_SIMPLEX


def _overlay(frame, alpha=0.55):
    """Dark translucent panel the full width of the frame."""
    panel = frame.copy()
    panel[:] = BG_PANEL
    return cv2.addWeighted(panel, alpha, frame, 1 - alpha, 0)


def wrap_text(text, font, scale, thickness, max_width):
    """Split text into lines that fit max_width pixels."""
    words, lines, line = text.split(), [], ""
    for w in words:
        trial = (line + " " + w).strip()
        if cv2.getTextSize(trial, font, scale, thickness)[0][0] <= max_width:
            line = trial
        else:
            if line:
                lines.append(line)
            line = w
    if line:
        lines.append(line)
    return lines


def draw_hand(frame, landmarks, color=SKELETON, highlight=None):
    """Draw the 21-point skeleton on the frame.

    `landmarks` have .x/.y normalised coords; `highlight` (bool) brightens
    the skeleton, e.g. while an answer is locking in.
    """
    h, w = frame.shape[:2]
    pts = [(int(lm.x * w), int(lm.y * h)) for lm in landmarks]
    color = SKELETON_LOCKED if highlight else color
    for a, b in HAND_CONNECTIONS:
        cv2.line(frame, pts[a], pts[b], color, 2, cv2.LINE_AA)
    for i, p in enumerate(pts):
        size = 5 if i in (4, 8, 12, 16, 20) else 3  # bigger fingertips
        cv2.circle(frame, p, size, (255, 255, 255), -1, cv2.LINE_AA)
        cv2.circle(frame, p, size, color, 1, cv2.LINE_AA)
    # bounding box
    x1, y1 = np.clip(min(p[0] for p in pts) - 12, 0, w), np.clip(min(p[1] for p in pts) - 12, 0, h)
    x2, y2 = np.clip(max(p[0] for p in pts) + 12, 0, w), np.clip(max(p[1] for p in pts) + 12, 0, h)
    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 1, cv2.LINE_AA)
    return pts


def _text(frame, text, org, scale, color, thickness=2, align="left"):
    x, y = org
    (tw, _), _ = cv2.getTextSize(text, FONT, scale, thickness)
    if align == "center":
        x -= tw // 2
    elif align == "right":
        x -= tw
    cv2.putText(frame, text, (x, y), FONT, scale, color, thickness, cv2.LINE_AA)


def draw_progress_bar(frame, x, y, w, h, progress, label=""):
    """Horizontal bar showing how close a held gesture is to being accepted."""
    cv2.rectangle(frame, (x, y), (x + w, y + h), (70, 70, 70), -1)
    filled = int(w * max(0.0, min(1.0, progress)))
    color = ACCENT if progress >= 1.0 else (200, 160, 40)
    cv2.rectangle(frame, (x, y), (x + filled, y + h), color, -1)
    cv2.rectangle(frame, (x, y), (x + w, y + h), NEUTRAL, 1, cv2.LINE_AA)
    if label:
        _text(frame, label, (x + w // 2, y + h + 18), 0.45, NEUTRAL, 1, "center")


def draw_frame(frame, game, finger_counts, landmarks_list=None, fps=None):
    """Render one complete game frame in-place.

    game          -- a quiz.QuizGame
    finger_counts -- list of per-hand finger counts this frame
    landmarks_list-- list of hands (each a list of 21 landmarks) to draw
    """
    h, w = frame.shape[:2]
    locked = game.lock_progress > 0.05

    # --- camera image + skeleton ------------------------------------------
    if landmarks_list:
        for lm in landmarks_list:
            draw_hand(frame, lm, highlight=locked)

    # --- top HUD bar -------------------------------------------------------
    bar = frame[:64, :]
    bar[:] = np.array(BG_PANEL, dtype=np.uint8)
    _text(frame, f"Score: {game.score}/{game.total}", (14, 42), 0.6, TEXT_MAIN)
    if fps is not None:
        _text(frame, f"{fps:.0f} FPS", (w - 14, 42), 0.55, NEUTRAL, 1, align="right")
    if game.current_question is not None:
        _text(frame, f"Q{min(game.index + 1, game.total)}/{game.total}", (w // 2, 42), 0.6,
              TEXT_MAIN, align="center")

    # --- bottom panel ------------------------------------------------------
    panel_h = 300
    frame[h - panel_h:, :] = _overlay(frame[h - panel_h:, :])
    px, py = 26, h - panel_h + 40
    max_w = w - 2 * px

    if game.phase == "intro":
        title = "HAND QUIZ"
        _text(frame, title, (w // 2, py + 30), 1.2, ACCENT, 3, "center")
        _text(frame, "Answer questions by holding up fingers (1-4)",
              (w // 2, py + 78), 0.6, TEXT_MAIN, 1, "center")
        _text(frame, "Show any fingers to begin ...",
              (w // 2, py + 120), 0.7, NEUTRAL, 1, "center")
        draw_progress_bar(frame, w // 2 - 150, py + 150, 300, 14,
                          game.lock_progress)

    elif game.phase == "question":
        q = game.current_question
        y = py
        for line in wrap_text(q.prompt, FONT, 0.75, 2, max_w)[:2]:
            _text(frame, line, (px, y), 0.75, TEXT_MAIN)
            y += 34
        y += 8
        for i, opt in enumerate(q.options, start=1):
            correct_row = game.held_count and i == game.held_count and game.lock_progress > 0.6
            col = ACCENT if correct_row else TEXT_MAIN
            prefix = f"{i}  " + "|" * i  # e.g. "3  |||" = show 3 fingers
            _text(frame, f"{prefix}   {opt}", (px, y), 0.62, col, 1)
            y += 34
        held = game.held_count
        if held:
            draw_progress_bar(frame, w - 260, py, 230, 16, game.lock_progress,
                             label=f"hold {held} finger(s)")
        else:
            _text(frame, "Hold up the right number of fingers", (w - 14, py + 14),
                  0.5, NEUTRAL, 1, align="right")

    elif game.phase == "feedback":
        q = game.current_question
        ok = game.last_correct
        msg = "CORRECT!" if ok else "WRONG"
        col = ACCENT if ok else WRONG
        _text(frame, msg, (w // 2, py + 20), 1.1, col, 3, "center")
        _text(frame, f"You showed {game.last_answer} finger(s) - answer: {q.answer}",
              (w // 2, py + 60), 0.6, TEXT_MAIN, 1, "center")
        _text(frame, q.correct_text, (w // 2, py + 95), 0.65, NEUTRAL, 1, "center")

    elif game.phase == "done":
        pct = int(100 * game.score / max(1, game.total))
        _text(frame, "QUIZ COMPLETE", (w // 2, py + 20), 1.1, ACCENT, 3, "center")
        _text(frame, f"Final score: {game.score}/{game.total}  ({pct}%)",
              (w // 2, py + 65), 0.8, TEXT_MAIN, 2, "center")
        _text(frame, "Show any fingers to play again  |  press R to restart, Q to quit",
              (w // 2, py + 110), 0.55, NEUTRAL, 1, "center")
