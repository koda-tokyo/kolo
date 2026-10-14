#!/usr/bin/env python3
"""Context7 — Live library documentation for KoLo agents."""

import argparse, json, sys, urllib.request, urllib.error, urllib.parse

BASE = "https://context7.com/api/v1"

def api_json(path, params=None):
    url = f"{BASE}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        print(f"ERROR {e.code}: {e.read().decode()}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

def api_text(path, params=None):
    url = f"{BASE}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Accept": "text/plain"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.read().decode()
    except urllib.error.HTTPError as e:
        print(f"ERROR {e.code}: {e.read().decode()}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

def resolve(name):
    data = api_json("/search", {"query": name, "limit": 5})
    results = data.get("results", [])
    if not results:
        print(f"No libraries found for '{name}'")
        return
    print(f"Libraries matching '{name}':\n")
    for r in results:
        print(f"  ID:          {r.get('id', '')}")
        print(f"  Name:        {r.get('title', r.get('name', ''))}")
        print(f"  Description: {r.get('description', '')[:120]}")
        print(f"  Stars:       {r.get('stars', 0):,}")
        print()

def docs(lib_id, topic=None, tokens=8000):
    params = {"tokens": tokens}
    if topic:
        params["topic"] = topic
    if not lib_id.startswith("/"):
        lib_id = "/" + lib_id
    content = api_text(lib_id, params)
    print(content or "(No documentation returned)")

def main():
    p = argparse.ArgumentParser(description="Context7 live library docs")
    sub = p.add_subparsers(dest="cmd")

    r = sub.add_parser("resolve", help="Find a library ID by name")
    r.add_argument("name", help="Library name (e.g. 'react', 'fastapi')")

    d = sub.add_parser("docs", help="Get documentation for a library")
    d.add_argument("id", help="Context7 library ID (e.g. /facebook/react)")
    d.add_argument("--topic", help="Filter to a specific topic (e.g. 'hooks')")
    d.add_argument("--tokens", type=int, default=8000, help="Max tokens to return")

    args = p.parse_args()
    if args.cmd == "resolve":
        resolve(args.name)
    elif args.cmd == "docs":
        docs(args.id, args.topic, args.tokens)
    else:
        p.print_help()

if __name__ == "__main__":
    main()
