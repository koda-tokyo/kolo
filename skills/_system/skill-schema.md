# Skill Schema (Operative Contract)

This file defines the required and optional fields for a KoLo skill (`SKILL.md`).
It is the operative contract — what `validate.sh` checks mechanically.
The "why" lives in `../skill-creator/SKILL.md` (the skill that builds skills).

## Required frontmatter fields

Every SKILL.md MUST carry these fields in its YAML frontmatter:

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Human-readable skill name |
| `description` | string | What the skill does, when to use it, and trigger keywords |

These fields are present in 98/104 skills. The 6 skills without frontmatter
are errors. The 6 skills missing `name` or `description` are errors.

## Strongly recommended fields

| Field | Type | Description |
|-------|------|-------------|
| `location` | path | Relative path from skills root (e.g., `skills/cso/`). Ground-truth: the actual directory. |

`location` is the `id` equivalent in IB-OS — it disambiguates the skill and
anchors cross-references. Currently 92/104 skills are missing this field.

## Common optional fields

| Field | Type | Frequency | Description |
|-------|------|-----------|-------------|
| `emoji` | string | 59/104 | Icon for this skill |
| `metadata` | map | 69/104 | Additional structured metadata |
| `requires` | map | 60/104 | Runtime dependencies (bins, packages, etc.) |
| `homepage` | url | 41/104 | Project homepage |
| `bins` | array | 41/104 | Required binaries |
| `install` | map | 37/104 | Installation instructions |
| `id` | string | 46/104 | Unique skill identifier |
| `kind` | string | 46/104 | Skill category |
| `label` | string | 46/104 | Display label |

## Skill classification tags (in description)

The `description` field conventionally includes trigger keywords at the end
after "Triggers:" or "Triggers for". These are not enforced by the validator
but are recommended for retrieval routing.

Example: `"...Triggers: agent loop, operational loop, quality streak..."`

## Body structure recommendations

A well-formed SKILL.md beyond frontmatter:

1. `# Title` — matches `name` field
2. Overview section — expands on description
3. `## References` or `## Knowledge Architecture` — domain-specific structure
4. Tool usage instructions (if CLI/tool skill)
5. Cross-references to related skills

## Lifecycle states

Skills are not formally lifecycle-tracked yet. Proposed:

| State | Meaning |
|-------|---------|
| `active` | In use, maintained |
| `deprecated` | Still works, heading toward removal |
| `broken` | Known non-functional, needs repair |
| `experimental` | New, not yet proven stable |

A `lifecycle` field is proposed but not yet required.

## What validate.sh checks

- SKILL.md exists in every skill directory
- YAML frontmatter is present (opens and closes with `---`)
- `name` and `description` fields exist and are non-empty
- `location` field matches the actual directory path (warning if missing)
- No duplicate `name` values across skills
- Resolvable cross-references between skills (future)
