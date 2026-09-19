"""Gesture recognition from MediaPipe hand landmarks.

MediaPipe's hand model tracks 21 landmarks per hand. The layout
(indices) is:

                    8   12  16  20
                    |   |   |   |
                7   11  15  19
                |   |   |   |
                6   10  14  18
            5   9   13  17
            |   |
        4   |   0 (wrist)
        |
    3
    |
    2
    1
    |
    0 (wrist)

This module converts those landmarks into simple gestures:
finger counts (1-5) used as quiz answers.

All logic is pure (no cv2 / mediapipe imports), so it is easy to test.
"""

import math

# --- MediaPipe landmark indices -------------------------------------------
WRIST = 0

THUMB_CMC, THUMB_MCP, THUMB_IP, THUMB_TIP = 1, 2, 3, 4
INDEX_MCP, INDEX_PIP, INDEX_TIP = 5, 6, 8
MIDDLE_MCP, MIDDLE_PIP, MIDDLE_TIP = 9, 10, 12
RING_MCP, RING_PIP, RING_TIP = 13, 14, 16
PINKY_MCP, PINKY_PIP, PINKY_TIP = 17, 18, 20

FINGERS = [
    ("Thumb", THUMB_TIP, THUMB_IP, THUMB_MCP),
    ("Index", INDEX_TIP, INDEX_PIP, INDEX_MCP),
    ("Middle", MIDDLE_TIP, MIDDLE_PIP, MIDDLE_MCP),
    ("Ring", RING_TIP, RING_PIP, RING_MCP),
    ("Pinky", PINKY_TIP, PINKY_PIP, PINKY_MCP),
]

# Bone connections used when drawing the hand skeleton.
HAND_CONNECTIONS = [
    (0, 1), (1, 2), (2, 3), (3, 4),            # thumb
    (0, 5), (5, 6), (6, 7), (7, 8),            # index
    (5, 9), (9, 10), (10, 11), (11, 12),       # middle
    (9, 13), (13, 14), (14, 15), (15, 16),     # ring
    (13, 17), (17, 18), (18, 19), (19, 20),    # pinky
    (0, 17),                                    # palm base
]


def _dist(a, b):
    """Euclidean distance between two landmarks."""
    return math.hypot(a.x - b.x, a.y - b.y)


def fingers_up(landmarks):
    """Return [thumb, index, middle, ring, pinky] with 1 = extended, 0 = folded.

    Rotation-invariant heuristic:
      * Thumb: the thumb tip is farther from the pinky knuckle than the
        joint below it.
      * Other fingers: the fingertip is farther from the wrist than the
        middle knuckle (PIP) by a small margin.
    """
    wrist = landmarks[WRIST]
    pinky_mcp = landmarks[PINKY_MCP]
    state = []

    # Thumb
    state.append(
        1 if _dist(landmarks[THUMB_TIP], pinky_mcp)
        > _dist(landmarks[THUMB_IP], pinky_mcp)
        else 0
    )

    # Remaining four fingers
    for _, tip, pip, _mcp in FINGERS[1:]:
        tip_d = _dist(landmarks[tip], wrist)
        pip_d = _dist(landmarks[pip], wrist)
        state.append(1 if tip_d > pip_d * 1.15 else 0)

    return state


def finger_count(landmarks):
    """Number of extended fingers (0-5)."""
    return sum(fingers_up(landmarks))


def gesture_name(landmarks):
    """A friendly name for a few common gestures."""
    state = fingers_up(landmarks)
    n = sum(state)
    if n == 0:
        return "fist"
    if n == 5:
        return "open palm"
    if state == [1, 0, 0, 0, 0]:
        return "thumbs up"
    if state == [0, 1, 0, 0, 0]:
        return "pointing"
    if state == [0, 1, 1, 0, 0]:
        return "peace"
    if state == [0, 0, 1, 1, 0]:
        return "rock on"
    return f"{n} fingers"
