#!/bin/bash
# Refresh Codex OAuth token in kolo.json whenever it's about to expire.
# Run via cron: 0 */6 * * * bash ~/.local/bin/refresh_codex_token.sh

KOLO_JSON="$HOME/.kolo/kolo.json"
CODEX_AUTH="$HOME/.codex/auth.json"
HELPER="$(find $HOME/kolo/skills -name codex_auth.py 2>/dev/null | head -1)"

if [ -z "$HELPER" ]; then
  echo "codex_auth.py not found" >&2; exit 1
fi

NEW_TOKEN=$(python3 "$HELPER" 2>/dev/null)
if [ -z "$NEW_TOKEN" ]; then
  echo "Failed to get Codex token" >&2; exit 1
fi

python3 - <<EOF
import json
with open("$KOLO_JSON") as f:
    cfg = json.load(f)
token = """$NEW_TOKEN"""
cfg.setdefault("skills", {})
cfg["skills"].setdefault("openai-image-gen", {})["apiKey"] = token
cfg["skills"].setdefault("openai-whisper-api", {})["apiKey"] = token
with open("$KOLO_JSON", "w") as f:
    json.dump(cfg, f, indent=2)
print("kolo.json refreshed with new Codex OAuth token")
EOF
