---
name: Memory System
description: Search and manage agent memory with local semantic embeddings. Triggers: memory search, memory embed, memory maintain, recall.
---

# Memory System Skill

Search and manage agent memory with local semantic embeddings.

## Quick Reference

```bash
# Search memory (semantic + keyword fallback)
python3 $SKILL_DIR/../workspace-iris/tools/memory_search.py "query" --top 5

# Rebuild embeddings (after major updates)
python3 $SKILL_DIR/../workspace-iris/tools/memory_embed.py --force

# Full maintenance (compress, rollup, prune, mood)
python3 $SKILL_DIR/../workspace-iris/tools/memory_maintain.py

# Individual tools
python3 $SKILL_DIR/../workspace-iris/tools/memory_compress.py   # Diary → digest
python3 $SKILL_DIR/../workspace-iris/tools/memory_rollup.py     # Archive old notes
python3 $SKILL_DIR/../workspace-iris/tools/memory_people.py     # Manage people
python3 $SKILL_DIR/../workspace-iris/tools/memory_topic.py      # Manage topics
```

## When to Use

- **Search**: When you need to recall something from memory (people, events, decisions)
- **Embed**: After adding significant new content (new files, major updates)
- **Maintain**: Daily via cron, or manually if backlog builds up

## Search Modes

1. **Semantic (default)** — Uses sentence-transformers embeddings, finds conceptually related content
2. **Keyword fallback** — If embeddings fail, falls back to grep-style search

## Output Format

All tools support `--json` for machine-readable output:

```json
{
  "query": "Dubai",
  "mode": "semantic",
  "results": [
    {
      "score": 0.47,
      "source": "MEMORY.md",
      "type": "workspace",
      "preview": "Owner: Dubai, UAE — staying at..."
    }
  ]
}
```

## Error Handling

- **No embeddings**: Falls back to keyword search
- **Model load fails**: Returns error with suggestion to rebuild
- **Empty results**: Check if embeddings are stale (run `memory_embed.py --force`)

## File Locations

```
workspace-iris/
├── memory/
│   ├── embeddings/
│   │   ├── config.json      # Model config, last updated
│   │   ├── chunks.jsonl     # Text chunks with metadata
│   │   └── vectors.npy      # Embedding vectors
│   ├── diary/
│   │   ├── YYYY-MM-DD.md    # Raw daily diary (tick logs)
│   │   └── digests/         # Compressed summaries
│   ├── people/              # Per-person notes
│   ├── topics/              # Long-running topics
│   ├── archive/             # Monthly rollups
│   └── HEALTH_REPORT.md     # Last maintenance report
├── MEMORY.md                # Long-term curated memory
└── tools/
    └── memory_*.py          # Memory management scripts
```

## Retention Policy

| Type | Retention | Action |
|------|-----------|--------|
| Daily notes | 30 days | Roll up to monthly summary |
| Diary | 24h raw | Compress to digest |
| Topics/People | Forever | Manual curation |
| Embeddings | Rebuild on change | Or weekly |

## Integration Notes

- No API key required — uses local `all-MiniLM-L6-v2` model
- First search is slow (~3s model load), subsequent searches are fast
- Embeddings are ~170KB for ~170 chunks (scales linearly)
