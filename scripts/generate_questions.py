#!/usr/bin/env python3
"""Generate a fresh question bank for Hand Quiz from the Open Trivia DB.

The Open Trivia DB (https://opentdb.com) is a free, open API that needs no
API key. This script fetches multiple-choice questions, decodes HTML
entities, shuffles the answer position, and prints ready-to-paste banks for
both the web version (quiz.mjs) and the desktop version (desktop/quiz.py).

Usage:
    python scripts/generate_questions.py                       # 20 general-knowledge questions
    python scripts/generate_questions.py --amount 30 --category 17   # Science & Nature
    python scripts/generate_questions.py --difficulty medium

Popular categories: 9 General Knowledge, 17 Science & Nature, 18 Computers,
20 Mythology, 21 Sports, 22 Geography, 23 History, 27 Animals.

Note: the API occasionally serves region-specific or dated questions —
review the output before pasting it into the app.
"""

import argparse
import base64
import json
import random
import urllib.request

API = "https://opentdb.com/api.php"


def fetch(amount, category, difficulty):
    params = f"?amount={amount}&type=multiple&encode=base64"
    if category:
        params += f"&category={category}"
    if difficulty:
        params += f"&difficulty={difficulty}"
    with urllib.request.urlopen(API + params, timeout=30) as r:
        data = json.load(r)
    if data.get("response_code") != 0:
        raise SystemExit(f"Open Trivia DB error (code {data.get('response_code')})")
    # base64 encoding avoids HTML-entity headaches
    def dec(s):
        return base64.b64decode(s).decode("utf-8")
    out = []
    for q in data["results"]:
        out.append({
            "prompt": dec(q["question"]),
            "options": [dec(a) for a in q["incorrect_answers"]] + [dec(q["correct_answer"])],
            "correct": dec(q["correct_answer"]),
        })
    return out


def build_bank(questions, seed=42):
    rng = random.Random(seed)
    bank = []
    for q in questions:
        rng.shuffle(q["options"])
        bank.append({
            "prompt": q["prompt"],
            "options": q["options"],
            "answer": q["options"].index(q["correct"]) + 1,
        })
    return bank


def js_bank(bank):
    lines = ["export const QUESTIONS = ["]
    for q in bank:
        lines.append(f"  {{ prompt: {json.dumps(q['prompt'])},")
        lines.append(f"    options: {json.dumps(q['options'])}, answer: {q['answer']} }},")
    lines.append("];")
    return "\n".join(lines)


def py_bank(bank):
    lines = ["QUESTION_BANK = ["]
    for q in bank:
        lines.append(f"    Question({json.dumps(q['prompt'])},")
        lines.append(f"              {json.dumps(q['options'])}, answer={q['answer']}),")
    lines.append("]")
    return "\n".join(lines)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--amount", type=int, default=20)
    p.add_argument("--category", type=int, default=None)
    p.add_argument("--difficulty", choices=["easy", "medium", "hard"], default=None)
    p.add_argument("--seed", type=int, default=42)
    args = p.parse_args()

    bank = build_bank(fetch(args.amount, args.category, args.difficulty), args.seed)

    print("=" * 30, "quiz.mjs", "=" * 30)
    print(js_bank(bank))
    print("=" * 30, "desktop/quiz.py", "=" * 30)
    print(py_bank(bank))
