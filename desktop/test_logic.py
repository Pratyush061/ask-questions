"""Tests that run headless (no camera / no mediapipe native lib).

Run:  python test_logic.py
"""

from types import SimpleNamespace as LM

import numpy as np

from gestures import finger_count, fingers_up, gesture_name
from quiz import QuizGame, STABLE_FRAMES, QUESTION_BANK


# --------------------------------------------------------------------------
# Synthetic hands: wrist near the bottom, fingers point up. A finger is
# "extended" when its tip is much farther from the wrist than its knuckle.
# --------------------------------------------------------------------------
def make_hand(extended=(1, 1, 1, 1, 1)):
    """Build 21 fake landmarks. `extended` = (thumb, index, middle, ring, pinky)."""
    lm = [None] * 21

    def put(i, x, y):
        lm[i] = LM(x=x, y=y)

    put(0, 0.50, 0.90)                    # wrist
    # thumb (right side)
    put(1, 0.58, 0.86); put(2, 0.64, 0.80); put(3, 0.70, 0.74)
    put(4, 0.86, 0.60 if extended[0] else 0.70)  # tip wide out = extended
    # index
    put(5, 0.60, 0.72); put(6, 0.62, 0.60)
    put(8, 0.63, 0.30 if extended[1] else 0.62); put(7, (0.62 + 0.63) / 2, 0.45 if extended[1] else 0.61)
    # middle
    put(9, 0.68, 0.70); put(10, 0.70, 0.58)
    put(12, 0.71, 0.25 if extended[2] else 0.60); put(11, (0.70 + 0.71) / 2, 0.42 if extended[2] else 0.59)
    # ring
    put(13, 0.76, 0.72); put(14, 0.78, 0.60)
    put(16, 0.79, 0.30 if extended[3] else 0.62); put(15, (0.78 + 0.79) / 2, 0.45 if extended[3] else 0.61)
    # pinky
    put(17, 0.84, 0.78); put(18, 0.86, 0.68)
    put(20, 0.88, 0.45 if extended[4] else 0.70); put(19, (0.86 + 0.88) / 2, 0.56 if extended[4] else 0.69)
    return lm


def test_gestures():
    cases = {
        (0, 0, 0, 0, 0): 0,  # fist
        (1, 1, 1, 1, 1): 5,  # open palm
        (0, 1, 0, 0, 0): 1,  # pointing
        (0, 1, 1, 0, 0): 2,  # peace
        (0, 1, 1, 1, 0): 3,
        (0, 1, 1, 1, 1): 4,
        (1, 0, 0, 0, 0): 1,  # thumbs up
    }
    for pattern, expected in cases.items():
        hand = make_hand(pattern)
        got = finger_count(hand)
        assert got == expected, f"fingers {pattern}: expected {expected}, got {got}"
    assert gesture_name(make_hand((0, 1, 1, 0, 0))) == "peace"
    assert gesture_name(make_hand((0, 0, 0, 0, 0))) == "fist"
    assert fingers_up(make_hand((0, 1, 1, 1, 1))) == [0, 1, 1, 1, 1]
    print("gestures: OK")


def hold(game, count, frames, dt=1 / 30):
    for _ in range(frames):
        game.update([count] if count else [], dt)


def test_quiz_flow():
    # Fixed seed and a known question so we can assert the right answer.
    game = QuizGame(seed=42)
    assert game.phase == "intro"

    # No hand -> nothing happens
    hold(game, 0, 30)
    assert game.phase == "intro"

    # Hold 2 fingers -> game starts
    hold(game, 2, STABLE_FRAMES + 2)
    assert game.phase == "question"

    # Flickering counts must NOT submit an answer
    for c in (1, 2, 3, 1, 2, 4, 1):
        hold(game, c, 3)
    assert game.phase == "question"

    # Submit a wrong answer (index 0 => always wrong, answer is >= 1)
    q = game.current_question
    wrong = q.answer % len(q.options) + 1
    hold(game, wrong, STABLE_FRAMES + 2)
    assert game.phase == "feedback"
    assert game.last_correct is False
    assert game.score == 0

    # Feedback timer advances to the next question
    hold(game, 0, 60)
    assert game.phase == "question"
    assert game.index == 1

    # Now answer every remaining question correctly and finish the quiz
    while game.phase == "question":
        hold(game, game.current_question.answer, STABLE_FRAMES + 2)
        hold(game, 0, 60)
    assert game.phase == "done"
    assert game.score == game.total - 1, f"score {game.score}/{game.total}"

    # Restart gesture -> back to a fresh intro screen
    hold(game, 3, STABLE_FRAMES + 2)
    assert game.phase == "intro"
    assert game.index == 0
    assert game.score == 0
    print("quiz flow: OK")


def test_ui_renders():
    import cv2
    import ui

    game = QuizGame(seed=1)
    hold(game, 2, 13)  # stability needs maxlen+1 frames to first return True
    # partially lock in a "3 finger" answer so the progress bar shows
    for _ in range(7):
        game.update([3], 1 / 30)
    assert game.phase == "question"
    frame = np.zeros((720, 1280, 3), np.uint8)
    hand = make_hand((0, 1, 1, 0, 0))
    ui.draw_frame(frame, game, [3], [hand], fps=29.7)
    import os
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mock_frame.png")
    cv2.imwrite(out, frame)
    print("ui render: OK (mock_frame.png)")


def test_question_bank():
    for q in QUESTION_BANK:
        assert 2 <= len(q.options) <= 4, q.prompt
        assert 1 <= q.answer <= len(q.options), q.prompt
    print(f"question bank: OK ({len(QUESTION_BANK)} questions)")


if __name__ == "__main__":
    test_question_bank()
    test_gestures()
    test_quiz_flow()
    test_ui_renders()
    print("\nAll logic tests passed.")
