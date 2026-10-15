---
name: tavily-search
description: "Search the web in real-time using Tavily — built for AI agents. Use for current events, news, research, prices, company info, or any live internet data. Triggers for: search the web, look up, find online, current news, latest, what is happening, research."
homepage: https://tavily.com
metadata:
  {
    "Kurahi":
      {
        "emoji": "🔍",
        "requires": { "bins": ["python3"], "env": ["TAVILY_API_KEY"] },
        "primaryEnv": "TAVILY_API_KEY",
      },
  }
---

# Tavily Search

Real-time web search built specifically for AI agents.

## Quick Start

```bash
python3 {baseDir}/scripts/search.py "latest AI news"
```

## Options

```bash
python3 {baseDir}/scripts/search.py "query" --depth advanced --max 10
python3 {baseDir}/scripts/search.py "query" --topic news
python3 {baseDir}/scripts/search.py "query" --json
```

## API Key

Set `TAVILY_API_KEY` or configure in `~/.kolo/kolo.json`:

```json
{ "skills": { "tavily-search": { "apiKey": "tvly-..." } } }
```
