#!/usr/bin/env python3
"""Helper: read and refresh the Codex OAuth token from ~/.codex/auth.json"""
import json, os, time, urllib.request, urllib.parse

AUTH_FILE = os.path.expanduser("~/.codex/auth.json")

def get_token():
    with open(AUTH_FILE) as f:
        data = json.load(f)
    tokens = data.get("tokens", {})
    access_token = tokens.get("access_token", "")
    # Decode exp from JWT payload (no verification)
    try:
        import base64
        payload = access_token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        claims = json.loads(base64.urlsafe_b64decode(payload))
        exp = claims.get("exp", 0)
        if exp - time.time() < 300:  # refresh if <5min left
            return refresh_token(tokens.get("refresh_token"), data)
    except Exception:
        pass
    return access_token

def refresh_token(refresh_tok, data):
    url = "https://auth.openai.com/oauth/token"
    payload = json.dumps({
        "grant_type": "refresh_token",
        "client_id": "app_EMoamEEZ73f0CkXaXp7hrann",
        "refresh_token": refresh_tok,
    }).encode()
    req = urllib.request.Request(url, data=payload,
                                  headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as resp:
            new_tokens = json.loads(resp.read())
        data["tokens"].update(new_tokens)
        data["last_refresh"] = __import__("datetime").datetime.utcnow().isoformat()
        with open(AUTH_FILE, "w") as f:
            json.dump(data, f, indent=2)
        return new_tokens.get("access_token", data["tokens"]["access_token"])
    except Exception:
        return data["tokens"]["access_token"]

if __name__ == "__main__":
    print(get_token())
