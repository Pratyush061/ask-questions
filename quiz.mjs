/* Hand Quiz — question bank + game state machine.
   No DOM / CDN dependencies, so it can be unit-tested with plain Node:
   node quiz.test.mjs */

export const STABLE_FRAMES = 12; // frames a finger count must hold to be accepted
export const FEEDBACK_SECONDS = 1.6;

export const QUESTIONS = [
  { prompt: "What does this app use to find your hand in the camera feed?",
    options: ["MediaPipe", "TensorFlow.js", "PyTorch", "scikit-learn"], answer: 1 },
  { prompt: "How many landmarks does MediaPipe track per hand?",
    options: ["10", "21", "35", "50"], answer: 2 },
  { prompt: "Which body part does this app track with your camera?",
    options: ["Your hand", "Your foot", "Your face", "Your ear"], answer: 1 },
  { prompt: "OpenCV stores color images in which channel order by default?",
    options: ["RGB", "RGBA", "BGR", "HSV"], answer: 3 },
  { prompt: "Which landmark index is the tip of the index finger?",
    options: ["4", "8", "12", "20"], answer: 2 },
  { prompt: "Roughly how fast does MediaPipe run on a laptop CPU?",
    options: ["~1 frame per minute", "~1 frame per second", "Real time (30+ FPS)", "It needs a GPU cluster"], answer: 3 },
  { prompt: "What colour does this app use for a locked-in answer?",
    options: ["Green", "Blue", "Red", "Yellow"], answer: 1 },
  { prompt: "How do you answer a question in this quiz?",
    options: ["Say it out loud", "Type it", "Hold up fingers", "Blink twice"], answer: 3 },
  { prompt: "How many fingers does one human hand usually have?",
    options: ["3", "4", "5", "6"], answer: 3 },
  { prompt: "Which company maintains MediaPipe?",
    options: ["Meta", "Google", "Microsoft", "Apple"], answer: 2 },
  { prompt: "In tech, what does \"ML\" stand for?",
    options: ["Machine Language", "Machine Learning", "Multi-Layer", "Media Loop"], answer: 2 },
  { prompt: "Which of these is a computer-vision task?",
    options: ["Sorting files", "Object detection", "Sending email", "Playing audio"], answer: 2 },
  { prompt: "The RGB colour model mixes which three colours?",
    options: ["Red, Green, Blue", "Red, Grey, Black", "Cyan, Magenta, Yellow", "Hue, Saturation, Value"], answer: 1 },
  { prompt: "How many bones are in an adult human hand?",
    options: ["19", "27", "33", "42"], answer: 2 },
  { prompt: "Which sensor type converts light into digital data inside cameras?",
    options: ["CMOS", "RADAR", "LIDAR", "SONAR"], answer: 1 },
  { prompt: "A single point of a digital image is called a…",
    options: ["Pixel", "Polygon", "Vector", "Photon"], answer: 1 },
  { prompt: "Which fingers make the \"peace\" sign?",
    options: ["Thumb only", "Index + middle", "All five", "None — a fist"], answer: 2 },
  { prompt: "NumPy is a Python library mainly used for…",
    options: ["Arrays and math", "Web servers", "Sending email", "Databases"], answer: 1 },
  { prompt: "What does this quiz need from you before it can start?",
    options: ["Camera permission", "A mouse", "A printer", "Speakers"], answer: 1 },
  { prompt: "How many questions does this quiz have?",
    options: ["8", "12", "16", "20"], answer: 4 },
];

export class QuizGame {
  constructor(questions = QUESTIONS) {
    this.allQuestions = questions;
    this.restart();
  }

  restart() {
    this.questions = [...this.allQuestions].sort(() => Math.random() - 0.5);
    this.index = 0;
    this.score = 0;
    this.phase = "intro"; // intro -> question -> feedback -> done
    this.buffer = [];
    this.elapsed = 0;
    this.lastAnswer = null;
    this.lastCorrect = null;
  }

  get currentQuestion() {
    return this.questions[this.index];
  }

  get total() {
    return this.questions.length;
  }

  update(counts, dt) {
    this.elapsed += dt;
    const best = counts.length ? Math.max(...counts) : 0;
    const stable = this._isStable(best);

    if (this.phase === "intro") {
      if (best >= 1 && stable) this._startQuestion();
    } else if (this.phase === "question") {
      if (best >= 1 && best <= 4 && stable) this._submit(best);
    } else if (this.phase === "feedback") {
      if (this.elapsed >= FEEDBACK_SECONDS) {
        this.index += 1;
        this.elapsed = 0;
        if (this.index >= this.questions.length) {
          this.phase = "done";
        } else {
          this._startQuestion();
        }
      }
    } else if (this.phase === "done") {
      if (best >= 1 && stable) this.restart();
    }
  }

  _isStable(count) {
    if (this.buffer.length < STABLE_FRAMES) {
      this.buffer.push(count);
      if (this.buffer.length > STABLE_FRAMES) this.buffer.shift();
      return false;
    }
    if (this.buffer.every((c) => c === count)) return true;
    this.buffer.push(count);
    if (this.buffer.length > STABLE_FRAMES) this.buffer.shift();
    return false;
  }

  _startQuestion() {
    this.phase = "question";
    this.buffer = [];
    this.elapsed = 0;
  }

  _submit(answer) {
    this.lastAnswer = answer;
    this.lastCorrect = answer === this.currentQuestion.answer;
    if (this.lastCorrect) this.score += 1;
    this.phase = "feedback";
    this.elapsed = 0;
  }

  heldCount() {
    if (!this.buffer.length) return 0;
    const last = this.buffer[this.buffer.length - 1];
    return last >= 1 && this.buffer.every((c) => c === last) ? last : 0;
  }

  lockProgress() {
    if (!this.buffer.length) return 0;
    const last = this.buffer[this.buffer.length - 1];
    if (last < 1) return 0;
    let run = 0;
    for (let i = this.buffer.length - 1; i >= 0 && this.buffer[i] === last; i--) run++;
    return Math.min(1, run / STABLE_FRAMES);
  }
}
