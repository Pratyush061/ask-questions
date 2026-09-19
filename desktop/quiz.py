"""Quiz questions and the game state machine.

Questions are multiple choice with up to four options. The player answers
by holding up the matching number of fingers (1-4) in front of the webcam.
An answer is only accepted once the same finger count has been stable for
`STABLE_FRAMES` consecutive frames, which stops accidental flickers from
being read as answers.

Questions sourced from the Open Trivia DB (opentdb.com) — free, open, no
API key. Regenerate with: python scripts/generate_questions.py

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
    Question("What is the most frequently used letter in the English alphabet?",
              ["I", "A", "O", "E"], answer=4),
    Question("How many colors are there in a rainbow?",
              ["10", "9", "7", "8"], answer=3),
    Question("What do the letters in the GMT time zone stand for?",
              ["Global Meridian Time", "Glasgow Man Time", "General Median Time", "Greenwich Mean Time"], answer=4),
    Question("What are Panama hats made out of?",
              ["Silk", "Hemp", "Straw", "Flax"], answer=3),
    Question("Which country has the Union Jack in its flag?",
              ["South Africa", "Canada", "Hong Kong", "New Zealand"], answer=4),
    Question("Which of these colours is NOT featured in the logo for Google?",
              ["Yellow", "Green", "Blue", "Pink"], answer=4),
    Question("What is H2O more commonly known as?",
              ["Hydrogen", "Oxygen", "Water", "Salt"], answer=3),
    Question("How many moons does the Earth have?",
              ["0", "3", "1", "2"], answer=3),
    Question("Who discovered the Law of Gravity?",
              ["Sir Isaac Newton", "Charles Darwin", "Galileo Galilei", "Albert Einstein"], answer=1),
    Question("The human heart has how many chambers?",
              ["6", "3", "4", "2"], answer=3),
    Question("Which Apollo mission was the first one to land on the Moon?",
              ["Apollo 9", "Apollo 10", "Apollo 13", "Apollo 11"], answer=4),
    Question("Which element has the chemical symbol 'Fe'?",
              ["Tin", "Silver", "Gold", "Iron"], answer=4),
    Question("About how many countries are there in the world?",
              ["500", "100", "200", "300"], answer=3),
    Question("In which country is the city of Rio de Janeiro?",
              ["Chile", "Venezuela", "Peru", "Brazil"], answer=4),
    Question("Which of the following Japanese islands is the biggest?",
              ["Honshu", "Hokkaido", "Kyushu", "Shikoku"], answer=1),
    Question("How long did World War II last?",
              ["7 years", "6 years", "5 years", "4 years"], answer=2),
    Question("What was the name commonly given to the ancient trade routes that connected the East and West of Eurasia?",
              ["Spice Road", "Salt Road", "Clay Road", "Silk Road"], answer=4),
    Question("What year did World War I begin?",
              ["1905", "1925", "1914", "1919"], answer=3),
    Question("How do you answer a question in this quiz?",
              ["Blink twice", "Type it", "Say it out loud", "Hold up fingers"], answer=4),
    Question("How many questions does this quiz have?",
              ["20", "8", "12", "16"], answer=1),
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
