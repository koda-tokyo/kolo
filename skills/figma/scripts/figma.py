#!/usr/bin/env python3
"""Figma design context fetcher — KoLo skill."""

import argparse, json, os, re, sys, urllib.request, urllib.error, urllib.parse

BASE = "https://api.figma.com/v1"

def get_token():
    token = os.environ.get("FIGMA_TOKEN", "").strip()
    if token: return token
    try:
        with open(os.path.expanduser("~/.kolo/kolo.json")) as f:
            d = json.load(f)
            # Try skills.entries.figma.apiKey (canonical KoLo schema)
            api_key = d.get("skills", {}).get("entries", {}).get("figma", {}).get("apiKey", "")
            if api_key:
                return api_key
            # Fallback: legacy skills.figma.token path
            return d.get("skills", {}).get("figma", {}).get("token", "")
    except Exception:
        return ""

def parse_url(url):
    """Extract file_key and optional node_id from a Figma URL."""
    m = re.search(r'/(?:file|design)/([A-Za-z0-9]+)', url)
    if not m:
        print("ERROR: Could not parse Figma file key from URL", file=sys.stderr)
        sys.exit(1)
    file_key = m.group(1)
    node_id = None
    qs = urllib.parse.urlparse(url).query
    params = urllib.parse.parse_qs(qs)
    if "node-id" in params:
        node_id = params["node-id"][0].replace("-", ":")
    return file_key, node_id

def api_get(path, token):
    req = urllib.request.Request(
        f"{BASE}{path}",
        headers={"X-Figma-Token": token, "Accept": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"ERROR {e.code}: {body}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

def extract_styles(node):
    """Extract key design properties from a node."""
    styles = {}
    if node.get("absoluteBoundingBox"):
        bb = node["absoluteBoundingBox"]
        styles["size"] = f"{bb.get('width', 0):.0f}x{bb.get('height', 0):.0f}"
    if node.get("fills"):
        fills = [f for f in node["fills"] if f.get("visible", True) and f.get("type") == "SOLID"]
        if fills:
            c = fills[0].get("color", {})
            r, g, b = int(c.get("r",0)*255), int(c.get("g",0)*255), int(c.get("b",0)*255)
            styles["fill"] = f"#{r:02x}{g:02x}{b:02x}"
    if node.get("style"):
        s = node["style"]
        styles["font"] = s.get("fontFamily", "")
        styles["fontSize"] = s.get("fontSize", "")
        styles["fontWeight"] = s.get("fontWeight", "")
        styles["lineHeight"] = s.get("lineHeightPx", "")
    if node.get("cornerRadius"):
        styles["borderRadius"] = node["cornerRadius"]
    if node.get("paddingLeft") is not None:
        styles["padding"] = f"{node.get('paddingTop',0)} {node.get('paddingRight',0)} {node.get('paddingBottom',0)} {node.get('paddingLeft',0)}"
    return {k: v for k, v in styles.items() if v}

def summarize_node(node, depth=0, max_depth=4):
    """Recursively summarize a node tree."""
    if depth > max_depth:
        return
    indent = "  " * depth
    name = node.get("name", "")
    ntype = node.get("type", "")
    chars = node.get("characters", "")
    styles = extract_styles(node)

    line = f"{indent}[{ntype}] {name}"
    if chars:
        preview = chars[:60].replace("\n", " ")
        line += f' — "{preview}"'
    if styles:
        style_str = ", ".join(f"{k}:{v}" for k, v in list(styles.items())[:4])
        line += f" ({style_str})"
    print(line)

    for child in node.get("children", []):
        summarize_node(child, depth + 1, max_depth)

def cmd_context(url, as_json=False):
    token = get_token()
    if not token:
        print("ERROR: No FIGMA_TOKEN found. Set it or add to ~/.kolo/kolo.json", file=sys.stderr)
        sys.exit(1)
    file_key, node_id = parse_url(url)
    path = f"/files/{file_key}"
    if node_id:
        path += f"?ids={urllib.parse.quote(node_id)}&geometry=paths"
    data = api_get(path, token)

    if as_json:
        if node_id and data.get("nodes"):
            print(json.dumps(data["nodes"], indent=2))
        else:
            print(json.dumps(data.get("document", {}), indent=2))
        return

    name = data.get("name", "Unknown")
    print(f"# Figma File: {name}")
    print(f"  Last modified: {data.get('lastModified', '')}")
    print(f"  Version: {data.get('version', '')}\n")

    if node_id and data.get("nodes"):
        for nid, node_data in data["nodes"].items():
            doc = node_data.get("document", {})
            print(f"## Frame: {doc.get('name', nid)}")
            summarize_node(doc)
    else:
        doc = data.get("document", {})
        for page in doc.get("children", []):
            print(f"\n## Page: {page.get('name', '')}")
            for frame in page.get("children", [])[:10]:
                summarize_node(frame, depth=1)

def cmd_list(url):
    token = get_token()
    if not token:
        print("ERROR: No FIGMA_TOKEN found.", file=sys.stderr)
        sys.exit(1)
    file_key, _ = parse_url(url)
    data = api_get(f"/files/{file_key}?depth=1", token)
    print(f"# {data.get('name', 'Figma File')}\n")
    for page in data.get("document", {}).get("children", []):
        print(f"Page: {page.get('name', '')}")
        for frame in page.get("children", []):
            bb = frame.get("absoluteBoundingBox", {})
            size = f"{bb.get('width',0):.0f}x{bb.get('height',0):.0f}" if bb else ""
            print(f"  [{frame.get('type','?')}] {frame.get('name','')}  {size}")
            print(f"    node-id: {frame.get('id','').replace(':','-')}")

def main():
    p = argparse.ArgumentParser(description="Figma design context for KoLo agents")
    sub = p.add_subparsers(dest="cmd")

    c = sub.add_parser("context", help="Get design context from a Figma URL")
    c.add_argument("url", help="Figma file or frame URL")
    c.add_argument("--json", action="store_true", help="Output raw JSON")

    l = sub.add_parser("list", help="List all pages and frames in a Figma file")
    l.add_argument("url", help="Figma file URL")

    args = p.parse_args()
    if args.cmd == "context":
        cmd_context(args.url, getattr(args, "json", False))
    elif args.cmd == "list":
        cmd_list(args.url)
    else:
        p.print_help()

if __name__ == "__main__":
    main()
