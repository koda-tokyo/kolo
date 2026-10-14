#!/usr/bin/env python3
"""
Brave Search API — KoLo skill script
Usage: python3 search.py "your query" [--count N] [--type web|news] [--json] [--freshness day|week|month]
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.parse
import urllib.error

def get_api_key():
    """Try env var first, then kolo.json config."""
    key = os.environ.get("BRAVE_API_KEY")
    if key:
        return key
    # Try kolo.json
    config_path = os.path.expanduser("~/.kolo/kolo.json")
    try:
        with open(config_path) as f:
            cfg = json.load(f)
        key = cfg.get("skills", {}).get("brave-search", {}).get("apiKey")
        if key:
            return key
    except Exception:
        pass
    return None


def search(query, count=10, search_type="search", freshness=None, as_json=False):
    api_key = get_api_key()
    if not api_key:
        print("ERROR: No BRAVE_API_KEY found.", file=sys.stderr)
        print("Set it via: export BRAVE_API_KEY=your_key", file=sys.stderr)
        print("Or add to ~/.kolo/kolo.json under skills.brave-search.apiKey", file=sys.stderr)
        sys.exit(1)

    params = {
        "q": query,
        "count": min(count, 20),
    }
    if freshness:
        params["freshness"] = freshness

    if search_type == "news":
        endpoint = "https://api.search.brave.com/res/v1/news/search"
    else:
        endpoint = "https://api.search.brave.com/res/v1/web/search"

    url = endpoint + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": api_key,
    })

    try:
        with urllib.request.urlopen(req) as resp:
            import gzip
            raw = resp.read()
            if resp.info().get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            data = json.loads(raw)
    except urllib.error.HTTPError as e:
        print(f"HTTP Error {e.code}: {e.reason}", file=sys.stderr)
        sys.exit(1)

    if as_json:
        print(json.dumps(data, indent=2, ensure_ascii=False))
        return

    # Pretty print results
    results = []
    if search_type == "news":
        results = data.get("results", [])
    else:
        results = data.get("web", {}).get("results", [])

    if not results:
        print(f"No results for: {query}")
        return

    print(f"\n=== Brave Search: {query!r} ===\n")
    for i, r in enumerate(results, 1):
        title = r.get("title", "")
        url_r = r.get("url", "")
        desc = r.get("description", r.get("extra_snippets", [""])[0] if r.get("extra_snippets") else "")
        age = r.get("age", "")
        print(f"[{i}] {title}")
        print(f"    {url_r}")
        if desc:
            # Wrap description
            words = desc.split()
            line = "    "
            for w in words:
                if len(line) + len(w) > 90:
                    print(line)
                    line = "    " + w + " "
                else:
                    line += w + " "
            if line.strip():
                print(line)
        if age:
            print(f"    [{age}]")
        print()


def main():
    parser = argparse.ArgumentParser(description="Search the web with Brave Search API")
    parser.add_argument("query", nargs="+", help="Search query")
    parser.add_argument("--count", type=int, default=10, help="Number of results (max 20)")
    parser.add_argument("--type", choices=["web", "news"], default="web", dest="search_type")
    parser.add_argument("--json", action="store_true", help="Output raw JSON")
    parser.add_argument("--freshness", choices=["day", "week", "month"], help="Filter by recency")
    args = parser.parse_args()

    query = " ".join(args.query)
    search(query, count=args.count, search_type=args.search_type,
           freshness=args.freshness, as_json=args.json)


if __name__ == "__main__":
    main()
