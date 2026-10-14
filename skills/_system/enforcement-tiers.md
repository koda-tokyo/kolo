# Enforcement Tiers

This file governs which checks are blocking (ERROR, exit 1) and which are
advisory (WARNING, exit 0). Checks graduate from warning to error after the
operator confirms the check is stable and desired.

## Current tiers

### ERROR (blocking — exit 1)

| Check | Since | Rationale |
|-------|-------|-----------|
| SKILL.md exists in every skill directory | 2026-06-25 | Structural contract — a skill without SKILL.md is not a skill |
| YAML frontmatter present (`---` delimiters) | 2026-06-25 | Required for machine-readability |
| `name` field present and non-empty | 2026-06-25 | Skills must be identifiable |
| `description` field present and non-empty | 2026-06-25 | Skills must be discoverable |

### WARNING (advisory — exit 0)

| Check | Since | Promotion criteria |
|-------|-------|--------------------|
| `location` field present | 2026-06-25 | Promote after 80% of skills have it |
| `location` matches actual directory | 2026-06-25 | Promote after location field is widespread |
| `emoji` field present | 2026-06-25 | Promote if emoji becomes canonical |
| Duplicate `name` values | 2026-06-25 | Promote immediately if any duplicates found |

## Promotion process

1. Operator proposes promotion of a check from WARNING to ERROR
2. All existing skills are brought into compliance
3. The check is moved to the ERROR section above
4. `validate.sh` is updated in the same change

## History

- 2026-06-25: Initial tiers established. 4 ERROR checks, 4 WARNING checks.
  Based on survey of 104 skills: 98 with frontmatter, 6 without.
