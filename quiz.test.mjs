/* Headless tests for the quiz state machine (no browser / camera needed).
   Run:  node quiz.test.mjs */

import assert from "node:assert/strict";
import { QuizGame, QUESTIONS, STABLE_SECONDS, FEEDBACK_SECONDS } from "./quiz.mjs";

const DT = 1 / 30; // simulated frame time

function hold(game, count, secs) {
  const frames = Math.ceil(secs / DT);
  for (let i = 0; i < frames; i++) {
    game.update(count ? [count] : [], DT);
  }
}

// --- question bank sanity ---------------------------------------------------
assert.equal(QUESTIONS.length, 20, "expected 20 questions");
for (const q of QUESTIONS) {
  assert.ok(q.prompt.length > 0, "empty prompt");
  assert.ok(q.options.length >= 2 && q.options.length <= 4, q.prompt);
  assert.ok(q.answer >= 1 && q.answer <= q.options.length, q.prompt);
}
console.log("question bank: OK (20 Hindi questions)");

// --- full game flow ----------------------------------------------------------
const game = new QuizGame(QUESTIONS);
assert.equal(game.phase, "intro");

hold(game, 0, 2); // no hand -> nothing happens
assert.equal(game.phase, "intro");

hold(game, 2, STABLE_SECONDS + 0.3); // hold 2 fingers -> starts
assert.equal(game.phase, "question");

// flickering counts must NOT submit an answer (each change resets the timer)
for (const c of [1, 2, 3, 4, 1, 2, 3, 4]) hold(game, c, 0.15);
assert.equal(game.phase, "question");

const q1 = game.currentQuestion;
const wrong = (q1.answer % q1.options.length) + 1; // always wrong
hold(game, wrong, STABLE_SECONDS + 0.3);
assert.equal(game.phase, "feedback");
assert.equal(game.lastCorrect, false);
assert.equal(game.score, 0);

hold(game, 0, FEEDBACK_SECONDS + 0.5); // feedback timer -> next question
assert.equal(game.phase, "question");
assert.equal(game.index, 1);

while (game.phase === "question") { // answer the rest correctly
  hold(game, game.currentQuestion.answer, STABLE_SECONDS + 0.3);
  hold(game, 0, FEEDBACK_SECONDS + 0.5);
}
assert.equal(game.phase, "done");
assert.equal(game.score, game.total - 1);

hold(game, 3, STABLE_SECONDS + 0.3); // gesture restart
assert.equal(game.phase, "intro");
assert.equal(game.score, 0);
console.log("game flow: OK");

// --- progress helpers --------------------------------------------------------
hold(game, 2, STABLE_SECONDS + 0.3); // start a question again
assert.equal(game.phase, "question");
hold(game, 3, STABLE_SECONDS / 2); // hold 3 fingers for half the time
assert.equal(game.heldCount(), 3);
assert.ok(Math.abs(game.lockProgress() - 0.5) < 0.05);
hold(game, 0, 0.2); // hand dropped -> progress resets
assert.equal(game.heldCount(), 0);
assert.equal(game.lockProgress(), 0);
console.log("progress helpers: OK");

console.log("\nAll quiz tests passed.");
