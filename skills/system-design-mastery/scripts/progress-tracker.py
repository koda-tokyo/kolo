#!/usr/bin/env python3
"""System Design Mastery — Learning Progress Tracker."""
import json, sys, os

PROGRESS_FILE = os.path.expanduser("~/.system-design-progress.json")

MODULES = ["foundations", "api-design", "databases", "caching", "big-data", "production-infra"]
STATUSES = ["not-started", "in-progress", "complete"]
STATUS_ICONS = {"not-started": "⬜", "in-progress": "🟡", "complete": "✅"}

def load():
    if os.path.exists(PROGRESS_FILE):
        with open(PROGRESS_FILE) as f:
            return json.load(f)
    return {m: "not-started" for m in MODULES}

def save(progress):
    with open(PROGRESS_FILE, "w") as f:
        json.dump(progress, f, indent=2)

def cmd_status():
    progress = load()
    print("=" * 50)
    print("  SYSTEM DESIGN MASTERY — LEARNING PROGRESS")
    print("=" * 50)
    for i, mod in enumerate(MODULES, 1):
        status = progress.get(mod, "not-started")
        icon = STATUS_ICONS.get(status, "❓")
        print(f"  {i}. {icon} {mod:25s} {status}")
    completed = sum(1 for m in MODULES if progress.get(m) == "complete")
    print(f"\n  {completed}/{len(MODULES)} modules complete")

def cmd_mark(module, status):
    if module not in MODULES:
        print(f"Unknown module: {module}")
        print(f"Available: {', '.join(MODULES)}")
        return
    if status not in STATUSES:
        print(f"Invalid status: {status}")
        print(f"Available: {', '.join(STATUSES)}")
        return
    progress = load()
    progress[module] = status
    save(progress)
    icon = STATUS_ICONS[status]
    print(f"  {icon} {module} → {status}")

def cmd_summary():
    progress = load()
    completed = sum(1 for m in MODULES if progress.get(m) == "complete")
    in_prog = sum(1 for m in MODULES if progress.get(m) == "in-progress")
    pct = completed * 100 // len(MODULES)
    bar = "█" * (pct // 5) + "░" * (20 - pct // 5)
    print(f"\n  [{bar}] {pct}% complete")
    print(f"  ✅ {completed} done  🟡 {in_prog} in progress  ⬜ {len(MODULES) - completed - in_prog} remaining")

def main():
    if len(sys.argv) < 2:
        print("Usage: progress-tracker.py <command> [args]")
        print("Commands: status, mark MODULE STATUS, summary")
        print("Modules: " + ", ".join(MODULES))
        print("Statuses: " + ", ".join(STATUSES))
        return
    cmd = sys.argv[1]
    if cmd == "status":
        cmd_status()
    elif cmd == "mark" and len(sys.argv) >= 4:
        cmd_mark(sys.argv[2], sys.argv[3])
    elif cmd == "summary":
        cmd_summary()
    else:
        print(f"Unknown command: {cmd}")
        print("Commands: status, mark MODULE STATUS, summary")

if __name__ == "__main__":
    main()
