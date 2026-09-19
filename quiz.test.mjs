/* Headless tests for the quiz state machine (no browser / camera needed).
   Run:  node quiz.test.mjs */

import assert from "node:assert/strict";
import { QuizGame, QUESTIONS, STABLE_FRAMES } from "./quiz.mjs";

function hold(game, count, frames, dt = 1 / 30) {
  for (let i = 0; i < frames; i++) {
    game.update(count ? [count] : [], dt);
  }
}

// --- question bank sanity ---------------------------------------------------
assert.equal(QUESTIONS.length, 20, "expected 20 questions");
for (const q of QUESTIONS) {
  assert.ok(q.options.length >= 2 && q.options.length <= 4, q.prompt);
  assert.ok(q.answer >= 1 && q.answer <= q.options.length, q.prompt);
}
console.log("question bank: OK (20 questions)");

// --- full game flow ----------------------------------------------------------
const game = new QuizGame(QUESTIONS);
assert.equal(game.phase, "intro");

hold(game, 0, 30); // no hand -> nothing happens
assert.equal(game.phase, "intro");

hold(game, 2, STABLE_FRAMES + 2); // hold 2 fingers -> starts
assert.equal(game.phase, "question");

for (const c of [1, 2, 3, 1, 2, 4, 1]) hold(game, c, 3); // flicker -> ignored
assert.equal(game.phase, "question");

const q1 = game.currentQuestion;
const wrong = (q1.answer % q1.options.length) + 1; // always wrong
hold(game, wrong, STABLE_FRAMES + 2);
assert.equal(game.phase, "feedback");
assert.equal(game.lastCorrect, false);
assert.equal(game.score, 0);

hold(game, 0, 60); // feedback timer -> next question
assert.equal(game.phase, "question");
assert.equal(game.index, 1);

while (game.phase === "question") { // answer the rest correctly
  hold(game, game.currentQuestion.answer, STABLE_FRAMES + 2);
  hold(game, 0, 60);
}
assert.equal(game.phase, "done");
assert.equal(game.score, game.total - 1);

hold(game, 3, STABLE_FRAMES + 2); // gesture restart
assert.equal(game.phase, "intro");
assert.equal(game.score, 0);
console.log("game flow: OK");

// --- progress helpers --------------------------------------------------------
hold(game, 2, 13); // start a question again
assert.equal(game.phase, "question");
hold(game, 3, 7); // hold 3 fingers for 7 frames
assert.equal(game.heldCount(), 3);
assert.ok(Math.abs(game.lockProgress() - 7 / STABLE_FRAMES) < 1e-9);
hold(game, 0, 1); // hand dropped -> progress resets
assert.equal(game.heldCount(), 0);
assert.equal(game.lockProgress(), 0);
console.log("progress helpers: OK");

console.log("\nAll quiz tests passed.");
