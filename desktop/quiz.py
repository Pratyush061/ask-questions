"""Quiz questions and the game state machine.

Questions are multiple choice with up to four options. The player answers
by holding up the matching number of fingers (1-4) in front of the webcam.
An answer is only accepted once the same finger count has been stable for
`STABLE_FRAMES` consecutive frames, which stops accidental flickers from
being read as answers.

This module is pure Python (no cv2 / mediapipe), so the whole game flow can
be unit-tested without a camera.
"""

import random
from collections import deque


class Question:
    def __init__(self, prompt, options, answer):
        self.prompt = prompt
        self.options = options
        self.answer = answer  # 1-based index into options

    @property
    def correct_text(self):
        return self.options[self.answer - 1]


# Answer with: 1 finger, 2 fingers, 3 fingers or 4 fingers.
# Kept in sync with the web version (quiz.mjs).
QUESTION_BANK = [
    Question("What does this app use to find your hand in the camera feed?",
              ["MediaPipe", "TensorFlow.js", "PyTorch", "scikit-learn"], answer=1),
    Question("How many landmarks does MediaPipe track per hand?",
              ["10", "21", "35", "50"], answer=2),
    Question("How many hands can this tracker watch at the same time?",
              ["Exactly 1", "2 (both hands)", "5", "Only webcams with depth sensors"], answer=2),
    Question("OpenCV stores color images in which channel order by default?",
              ["RGB", "RGBA", "BGR", "HSV"], answer=3),
    Question("Which landmark index is the tip of the index finger?",
              ["4", "8", "12", "20"], answer=2),
    Question("Roughly how fast does MediaPipe run on a laptop CPU?",
              ["~1 frame per minute", "~1 frame per second", "Real time (30+ FPS)", "It needs a GPU cluster"], answer=3),
    Question("What colour does this app use for a locked-in answer?",
              ["Green", "Blue", "Red", "Yellow"], answer=1),
    Question("How do you answer a question in this quiz?",
              ["Say it out loud", "Type it", "Hold up fingers", "Blink twice"], answer=3),
    Question("How many fingers does one human hand usually have?",
              ["3", "4", "5", "6"], answer=3),
    Question("Which company maintains MediaPipe?",
              ["Meta", "Google", "Microsoft", "Apple"], answer=2),
    Question('In tech, what does "ML" stand for?',
              ["Machine Language", "Machine Learning", "Multi-Layer", "Media Loop"], answer=2),
    Question("Which of these is a computer-vision task?",
              ["Sorting files", "Object detection", "Sending email", "Playing audio"], answer=2),
    Question("The RGB colour model mixes which three colours?",
              ["Red, Green, Blue", "Red, Grey, Black", "Cyan, Magenta, Yellow", "Hue, Saturation, Value"], answer=1),
    Question("How many bones are in an adult human hand?",
              ["19", "27", "33", "42"], answer=2),
    Question("Which sensor type converts light into digital data inside cameras?",
              ["CMOS", "RADAR", "LIDAR", "SONAR"], answer=1),
    Question("A single point of a digital image is called a…",
              ["Pixel", "Polygon", "Vector", "Photon"], answer=1),
    Question("Which fingers make the \"peace\" sign?",
              ["Thumb only", "Index + middle", "All five", "None — a fist"], answer=2),
    Question("NumPy is a Python library mainly used for…",
              ["Arrays and math", "Web servers", "Sending email", "Databases"], answer=1),
    Question("What does this quiz need from you before it can start?",
              ["Camera permission", "A mouse", "A printer", "Speakers"], answer=1),
    Question("How many questions does this quiz have?",
              ["8", "12", "16", "20"], answer=4),
]


# --- Game phases ------------------------------------------------------------
INTRO = "intro"        # waiting for the player to show a hand
QUESTION = "question"  # waiting for a stable finger count
FEEDBACK = "feedback"  # showing right/wrong for a moment
DONE = "done"         # final score screen

STABLE_FRAMES = 12    # frames a finger count must hold to count as an answer
FEEDBACK_SECONDS = 1.6


class QuizGame:
    """Drives the quiz; feed it detections, read out what to draw."""

    def __init__(self, questions=None, seed=None):
        self.rng = random.Random(seed)
        self.all_questions = list(questions if questions is not None else QUESTION_BANK)
        self.stable_buffer = deque(maxlen=STABLE_FRAMES)
        self.elapsed = 0.0
        self.restart()

    # -- setup / lifecycle ---------------------------------------------------
    def restart(self):
        self.questions = self.all_questions[:]
        self.rng.shuffle(self.questions)
        self.index = 0
        self.score = 0
        self.phase = INTRO
        self.stable_buffer.clear()
        self.elapsed = 0.0

    @property
    def current_question(self):
        if 0 <= self.index < len(self.questions):
            return self.questions[self.index]
        return None

    @property
    def total(self):
        return len(self.questions)

    # -- main update ----------------------------------------------------------
    def update(self, finger_counts, dt):
        """Advance the game one frame.

        finger_counts: list of per-hand finger counts detected this frame
                       (empty list when no hand is visible).
        dt: seconds since the previous frame.
        """
        self.elapsed += dt
        best = max(finger_counts) if finger_counts else 0
        stable = self._is_stable(best)

        if self.phase == INTRO:
            if best >= 1 and stable:
                self._start_question()

        elif self.phase == QUESTION:
            if 1 <= best <= 4 and stable:
                self._submit_answer(best)

        elif self.phase == FEEDBACK:
            if self.elapsed >= FEEDBACK_SECONDS:
                self.index += 1
                if self.index >= len(self.questions):
                    self.phase = DONE
                    self.elapsed = 0.0
                else:
                    self._start_question()

        elif self.phase == DONE:
            if best >= 1 and stable:
                self.restart()

    # -- helpers ---------------------------------------------------------------
    def _is_stable(self, count):
        """True when the buffer is full and every entry equals `count`."""
        if len(self.stable_buffer) < self.stable_buffer.maxlen:
            self.stable_buffer.append(count)
            return False
        if all(c == count for c in self.stable_buffer):
            return True
        self.stable_buffer.append(count)
        return False

    def _start_question(self):
        self.phase = QUESTION
        self.stable_buffer.clear()
        self.elapsed = 0.0

    def _submit_answer(self, answer):
        q = self.current_question
        self.last_answer = answer
        self.last_correct = (answer == q.answer)
        if self.last_correct:
            self.score += 1
        self.phase = FEEDBACK
        self.elapsed = 0.0

    # -- things the UI likes to know -------------------------------------------
    @property
    def held_count(self):
        """The finger count currently being held (for the progress bar)."""
        if not self.stable_buffer:
            return 0
        last = self.stable_buffer[-1]
        if last >= 1 and all(c == last for c in self.stable_buffer):
            return last
        return 0

    @property
    def lock_progress(self):
        """0.0 - 1.0, how close the held gesture is to being accepted."""
        if len(self.stable_buffer) == 0:
            return 0.0
        last = self.stable_buffer[-1]
        if last < 1:
            return 0.0
        run = 0
        for c in reversed(self.stable_buffer):
            if c == last:
                run += 1
            else:
                break
        return min(1.0, run / self.stable_buffer.maxlen)
