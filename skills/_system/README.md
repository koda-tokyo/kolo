# _system/ — KoLo Skill Contract Layer

This directory holds the operative contract for KoLo skills: what must be true
and how it is checked. It is the `_system/` pattern from Infinite Brain OS,
adapted for the KoLo platform.

## What lives here

| File | Purpose |
|------|---------|
| `skill-schema.md` | Required and optional fields for SKILL.md |
| `validate.sh` | Mechanical enforcement of the schema |
| `checks/` | Individual check scripts (warn-only, promotable to blocking) |
| `README.md` | This file |

## The _system/ vs skill-creator split

- `_system/` answers: **what** must be true and **how** it is checked.
- `skill-creator/SKILL.md` answers: **why** and **how** to build a skill.

Neither restates the other. Each links across. If changing a file would change
what `validate.sh` accepts, it belongs here. If changing a file would change
how someone *thinks* about building a skill, it belongs in `skill-creator/`.

## How to use

```bash
# Validate all skills from the skills root
cd skills
bash _system/validate.sh
```

Exit 0 = all checks pass. Exit 1 = at least one ERROR.
Warnings never change the exit code.

## Enforcement tiers

Some checks are **errors** (blocking, exit 1), others are **warnings** (advisory,
exit 0). The tier is set in `_system/enforcement-tiers.md`. Checks graduate from
warning to error after the operator confirms the check is stable and desired.

## Contract evolution

This directory evolves with the skill architecture. When a new required field is
added to `skill-schema.md`, the validator must be updated in the same change.
Correction-to-structure: if the operator gives the same correction about skills
three times, it becomes a validator rule.
