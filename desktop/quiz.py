"""Quiz questions and the game state machine.

Questions are multiple choice with up to four options. The player answers
by holding up the matching number of fingers (1-4) in front of the webcam.
An answer is only accepted once the same finger count has been stable for
STABLE_SECONDS (time-based, so it feels identical on fast/slow machines
and is forgiving for slow or trembling hands).

NOTE: the web version (quiz.mjs) uses the same questions in Hindi
(Devanagari); this desktop copy uses English translations because OpenCV's
built-in font cannot render Devanagari.

This module is pure Python (no cv2 / mediapipe), so the whole game flow can
be unit-tested without a camera.
"""

import random


class Question:
    def __init__(self, prompt, options, answer):
        self.prompt = prompt
        self.options = options
        self.answer = answer  # 1-based index into options

    @property
    def correct_text(self):
        return self.options[self.answer - 1]


# Answer with: 1 finger, 2 fingers, 3 fingers or 4 fingers.
# English translations of the Hindi question bank in quiz.mjs (web).
QUESTION_BANK = [
    Question("What is the capital of India?",
              ["Mumbai", "New Delhi", "Kolkata", "Chennai"], answer=2),
    Question("Which is the national bird of India?",
              ["Parrot", "Pigeon", "Swan", "Peacock"], answer=4),
    Question("In which city is the Taj Mahal located?",
              ["Jaipur", "Agra", "Delhi", "Lucknow"], answer=2),
    Question("Who had the Taj Mahal built?",
              ["Akbar", "Shah Jahan", "Aurangzeb", "Humayun"], answer=2),
    Question("What is the national anthem of India?",
              ["Vande Mataram", "Sare Jahan Se Achha", "Jana Gana Mana", "Jai Jawan Jai Kisan"], answer=3),
    Question("Which colour is at the top of the Indian flag?",
              ["Green", "White", "Saffron", "Blue"], answer=3),
    Question("Who was the first Prime Minister of India?",
              ["Mahatma Gandhi", "Sardar Patel", "Lal Bahadur Shastri", "Jawaharlal Nehru"], answer=4),
    Question("Which is the longest river of India?",
              ["Ganga", "Yamuna", "Godavari", "Kaveri"], answer=1),
    Question("Which is the national animal of India?",
              ["Lion", "Elephant", "Tiger", "Cow"], answer=3),
    Question("Diwali is the festival of what?",
              ["Colours", "Rakhi", "Kites", "Lamps and light"], answer=4),
    Question("How many balls are bowled in one over of cricket?",
              ["4", "5", "6", "8"], answer=3),
    Question("Sachin Tendulkar is a legend of which sport?",
              ["Hockey", "Football", "Tennis", "Cricket"], answer=4),
    Question("In which year did Chandrayaan-3 land on the Moon?",
              ["2019", "2021", "2022", "2023"], answer=4),
    Question("UPI is the digital payment system of which country?",
              ["Nepal", "India", "Sri Lanka", "Japan"], answer=2),
    Question("Holi is famous as the festival of what?",
              ["Colours", "Lamps", "Sweets", "Fasting"], answer=1),
    Question("Which is the highest mountain peak in the world?",
              ["K2", "Kangchenjunga", "Mount Everest", "Makalu"], answer=3),
    Question("In how many hours does the Earth complete one rotation?",
              ["12", "24", "36", "48"], answer=2),
    Question("Which is the largest ocean in the world?",
              ["Atlantic", "Indian", "Arctic", "Pacific"], answer=4),
    Question("In which direction does the sun rise?",
              ["East", "West", "North", "South"], answer=1),
    Question("Who discovered the law of gravity?",
              ["Albert Einstein", "Galileo", "Isaac Newton", "Charles Darwin"], answer=3),
]


# --- Game phases ------------------------------------------------------------
INTRO = "intro"        # waiting for the player to show a hand
QUESTION = "question"  # waiting for a stable finger count
FEEDBACK = "feedback"  # showing right/wrong for a moment
DONE = "done"         # final score screen

STABLE_SECONDS = 0.8   # seconds a finger count must be held (time-based)
FEEDBACK_SECONDS = 2.0


class QuizGame:
    """Drives the quiz; feed it detections, read out what to draw."""

    def __init__(self, questions=None, seed=None):
        self.rng = random.Random(seed)
        self.all_questions = list(questions if questions is not None else QUESTION_BANK)
        self.elapsed = 0.0
        self.restart()

    # -- setup / lifecycle ---------------------------------------------------
    def restart(self):
        self.questions = self.all_questions[:]
        self.rng.shuffle(self.questions)
        self.index = 0
        self.score = 0
        self.phase = INTRO
        self.elapsed = 0.0
        self._last_count = 0
        self._hold_time = 0.0

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
        if best == self._last_count:
            self._hold_time += dt
        else:
            self._last_count = best
            self._hold_time = 0.0
        stable = self._hold_time >= STABLE_SECONDS

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
    def _start_question(self):
        self.phase = QUESTION
        self.elapsed = 0.0
        self._last_count = 0
        self._hold_time = 0.0

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
        return self._last_count if self._last_count >= 1 else 0

    @property
    def lock_progress(self):
        """0.0 - 1.0, how close the held gesture is to being accepted."""
        if self._last_count < 1:
            return 0.0
        return min(1.0, self._hold_time / STABLE_SECONDS)
