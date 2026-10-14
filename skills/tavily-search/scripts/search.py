#!/usr/bin/env python3
"""Tavily Search API — KoLo skill. Built for AI agents."""

import argparse, json, os, sys, urllib.request, urllib.error

def get_key():
    key = os.environ.get("TAVILY_API_KEY", "").strip()
    if key: return key
    try:
        with open(os.path.expanduser("~/.kolo/kolo.json")) as f:
            return json.load(f).get("skills", {}).get("tavily-search", {}).get("apiKey", "")
    except Exception:
        return ""

def search(query, depth="basic", max_results=5, topic="general", as_json=False):
    key = get_key()
    if not key:
        print("ERROR: No TAVILY_API_KEY found.", file=sys.stderr)
        sys.exit(1)

    payload = json.dumps({
        "api_key": key,
        "query": query,
        "search_depth": depth,
        "max_results": max_results,
        "topic": topic,
        "include_answer": True,
        "include_raw_content": False,
    }).encode()

    req = urllib.request.Request(
        "https://api.tavily.com/search",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode()}", file=sys.stderr)
        sys.exit(1)

    if as_json:
        print(json.dumps(data, indent=2, ensure_ascii=False))
        return

    # Pretty output
    answer = data.get("answer", "")
    results = data.get("results", [])

    print(f"\n=== Tavily: {query!r} ===\n")
    if answer:
        print(f"ANSWER: {answer}\n")
    for i, r in enumerate(results, 1):
        print(f"[{i}] {r.get('title','')}")
        print(f"    {r.get('url','')}")
        content = r.get("content", "")
        if content:
            print(f"    {content[:200]}{'...' if len(content)>200 else ''}")
        print()

def main():
    p = argparse.ArgumentParser()
    p.add_argument("query", nargs="+")
    p.add_argument("--depth", choices=["basic","advanced"], default="basic")
    p.add_argument("--max", type=int, default=5, dest="max_results")
    p.add_argument("--topic", choices=["general","news"], default="general")
    p.add_argument("--json", action="store_true")
    args = p.parse_args()
    search(" ".join(args.query), args.depth, args.max_results, args.topic, args.json)

if __name__ == "__main__":
    main()
