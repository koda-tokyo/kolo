#!/usr/bin/env python3
"""System Design Mastery — Interactive Quiz."""
import json, sys, os, random

QUESTIONS_FILE = os.path.join(os.path.dirname(__file__), "..", "assets", "questions.json")

def load_questions(module=None):
    with open(QUESTIONS_FILE) as f:
        all_qs = json.load(f)
    if module:
        all_qs = [q for q in all_qs if q["module"] == module]
    random.shuffle(all_qs)
    return all_qs

def run_quiz(questions):
    if not questions:
        print("No questions found for that module.")
        return
    score = 0
    module_scores = {}
    for i, q in enumerate(questions, 1):
        mod = q["module"]
        module_scores.setdefault(mod, {"correct": 0, "total": 0})
        print(f"\n--- Question {i}/{len(questions)} [{mod}] ---")
        print(q["question"])
        for idx, opt in enumerate(q["options"]):
            print(f"  {idx+1}. {opt}")
        try:
            answer = int(input("Your answer (1-4): ").strip())
        except (ValueError, EOFError):
            answer = -1
        if answer - 1 == q["correct"]:
            print("✅ Correct!")
            score += 1
            module_scores[mod]["correct"] += 1
        else:
            correct = q["options"][q["correct"]]
            print(f"❌ Wrong. Correct: {correct}")
            if q.get("explanation"):
                print(f"   {q['explanation']}")
        module_scores[mod]["total"] += 1

    print("\n" + "="*50)
    print(f"FINAL SCORE: {score}/{len(questions)} ({score*100//len(questions)}%)")
    print("\nBy module:")
    for mod, s in sorted(module_scores.items()):
        pct = s["correct"] * 100 // s["total"] if s["total"] else 0
        bar = "█" * (pct // 10) + "░" * (10 - pct // 10)
        print(f"  {mod:20s} {bar} {s['correct']}/{s['total']} ({pct}%)")

if __name__ == "__main__":
    module = sys.argv[1] if len(sys.argv) > 1 else None
    if module and module not in ["foundations", "api-design", "databases", "caching", "big-data", "production-infra"]:
        print(f"Unknown module: {module}")
        print("Available: foundations, api-design, databases, caching, big-data, production-infra")
        sys.exit(1)
    questions = load_questions(module)
    run_quiz(questions)
