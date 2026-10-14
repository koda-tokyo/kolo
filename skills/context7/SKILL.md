---
name: context7
description: "Fetch live, version-specific library documentation for any npm/Python package. Use when writing code that uses a library, framework or API — prevents hallucinated or stale API references. Triggers for: docs for, documentation, how do I use, what is the API for, library reference, framework docs, check the docs, latest version of."
homepage: https://context7.com
metadata:
  {
    "KoLo":
      {
        "emoji": "📚",
        "requires": { "bins": ["python3"] },
        "primaryEnv": "",
      },
  }
---

# Context7 — Live Library Documentation

Fetches real-time, version-accurate documentation directly from source repositories. Eliminates hallucinated or outdated API references when writing code.

## Quick Start

```bash
# Resolve a library ID
python3 {baseDir}/scripts/context7.py resolve "react"

# Get documentation for a library
python3 {baseDir}/scripts/context7.py docs /facebook/react

# Get docs for a specific topic
python3 {baseDir}/scripts/context7.py docs /facebook/react --topic "hooks"

# Get docs for a Python package
python3 {baseDir}/scripts/context7.py docs /anthropics/anthropic-sdk-python --topic "streaming"
```

## Workflow

1. First `resolve` the library name to get its Context7-compatible ID
2. Then `docs` to fetch current documentation, optionally filtered by topic
3. Use the returned documentation to write accurate code

## No API Key Required

Context7 is free, no authentication needed.
