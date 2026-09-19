/* Hand Quiz — question bank + game state machine.
   Questions sourced from the Open Trivia DB (opentdb.com) — free, open, no API key.
   Regenerate a fresh set with: python scripts/generate_questions.py
   No DOM / CDN dependencies, so it can be unit-tested with plain Node:
   node quiz.test.mjs */

export const STABLE_FRAMES = 12; // frames a finger count must hold to be accepted
export const FEEDBACK_SECONDS = 1.6;

export const QUESTIONS = [
  { prompt: "What is the most frequently used letter in the English alphabet?",
    options: ["I", "A", "O", "E"], answer: 4 },
  { prompt: "How many colors are there in a rainbow?",
    options: ["10", "9", "7", "8"], answer: 3 },
  { prompt: "What do the letters in the GMT time zone stand for?",
    options: ["Global Meridian Time", "Glasgow Man Time", "General Median Time", "Greenwich Mean Time"], answer: 4 },
  { prompt: "What are Panama hats made out of?",
    options: ["Silk", "Hemp", "Straw", "Flax"], answer: 3 },
  { prompt: "Which country has the Union Jack in its flag?",
    options: ["South Africa", "Canada", "Hong Kong", "New Zealand"], answer: 4 },
  { prompt: "Which of these colours is NOT featured in the logo for Google?",
    options: ["Yellow", "Green", "Blue", "Pink"], answer: 4 },
  { prompt: "What is H2O more commonly known as?",
    options: ["Hydrogen", "Oxygen", "Water", "Salt"], answer: 3 },
  { prompt: "How many moons does the Earth have?",
    options: ["0", "3", "1", "2"], answer: 3 },
  { prompt: "Who discovered the Law of Gravity?",
    options: ["Sir Isaac Newton", "Charles Darwin", "Galileo Galilei", "Albert Einstein"], answer: 1 },
  { prompt: "The human heart has how many chambers?",
    options: ["6", "3", "4", "2"], answer: 3 },
  { prompt: "Which Apollo mission was the first one to land on the Moon?",
    options: ["Apollo 9", "Apollo 10", "Apollo 13", "Apollo 11"], answer: 4 },
  { prompt: "Which element has the chemical symbol 'Fe'?",
    options: ["Tin", "Silver", "Gold", "Iron"], answer: 4 },
  { prompt: "About how many countries are there in the world?",
    options: ["500", "100", "200", "300"], answer: 3 },
  { prompt: "In which country is the city of Rio de Janeiro?",
    options: ["Chile", "Venezuela", "Peru", "Brazil"], answer: 4 },
  { prompt: "Which of the following Japanese islands is the biggest?",
    options: ["Honshu", "Hokkaido", "Kyushu", "Shikoku"], answer: 1 },
  { prompt: "How long did World War II last?",
    options: ["7 years", "6 years", "5 years", "4 years"], answer: 2 },
  { prompt: "What was the name commonly given to the ancient trade routes that connected the East and West of Eurasia?",
    options: ["Spice Road", "Salt Road", "Clay Road", "Silk Road"], answer: 4 },
  { prompt: "What year did World War I begin?",
    options: ["1905", "1925", "1914", "1919"], answer: 3 },
  { prompt: "How do you answer a question in this quiz?",
    options: ["Blink twice", "Type it", "Say it out loud", "Hold up fingers"], answer: 4 },
  { prompt: "How many questions does this quiz have?",
    options: ["20", "8", "12", "16"], answer: 1 },
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
