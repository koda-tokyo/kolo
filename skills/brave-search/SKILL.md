---
name: brave-search
description: "Search the web in real-time using the Brave Search API. Use for current events, news, prices, research, or anything requiring live internet data. Triggers for: search the web, look up, find online, current news, latest, what is happening."
homepage: https://brave.com/search/api/
metadata:
  {
    "KoLo":
      {
        "emoji": "🔍",
        "requires": { "bins": ["python3"], "env": ["BRAVE_API_KEY"] },
        "primaryEnv": "BRAVE_API_KEY",
      },
  }
---

# Brave Search

Search the web in real-time using the Brave Search API.

## Quick Start

```bash
python3 {baseDir}/scripts/search.py "latest AI news"
```

## Options

```bash
# Basic web search
python3 {baseDir}/scripts/search.py "query here"

# Limit results
python3 {baseDir}/scripts/search.py "query here" --count 5

# News search
python3 {baseDir}/scripts/search.py "oil market today" --type news

# Output as JSON
python3 {baseDir}/scripts/search.py "query here" --json

# Search with freshness filter (day/week/month)
python3 {baseDir}/scripts/search.py "query here" --freshness day
```

## API Key

Set `BRAVE_API_KEY` environment variable, or configure in `~/.kolo/kolo.json`:

```json
{
  "skills": {
    "brave-search": {
      "apiKey": "YOUR_BRAVE_API_KEY"
    }
  }
}
```

Get your key at: https://brave.com/search/api/
Free tier: 2,000 queries/month
Paid tier: $5/month = 10,000 queries/month
