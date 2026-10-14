#!/usr/bin/env bash
# validate.sh — KoLo Skill Contract Validator
# Adapted from Infinite Brain OS _system/validate.sh pattern.
# Run from the skills root: bash _system/validate.sh
# Exit 0 = all checks pass. Exit 1 = one or more ERRORS.
# Warnings never change the exit code.

set -euo pipefail

SKILLS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAIL=0
CHECKED=0
ERRORS=()
WARNINGS=()

# Directories that are not skills (plumbing, system, templates)
PLUMBING_DIRS=(
  "_system"
  "public"
  ".git"
)

# Required frontmatter fields for every SKILL.md
REQUIRED_FIELDS=(
  "name:"
  "description:"
)

# Strongly recommended fields (warning if missing)
RECOMMENDED_FIELDS=(
  "location:"
)

# ─── Helpers ───────────────────────────────────────────────────────────

is_plumbing() {
  local dirname="$1"
  for pd in "${PLUMBING_DIRS[@]}"; do
    [[ "$dirname" == "$pd" ]] && return 0
  done
  return 1
}

extract_frontmatter() {
  local filepath="$1"
  local line first_line=1 in_frontmatter=0
  local frontmatter_lines=()

  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ $first_line -eq 1 ]]; then
      first_line=0
      if [[ "$line" != "---" ]]; then
        return 1
      fi
      in_frontmatter=1
      continue
    fi
    if [[ $in_frontmatter -eq 1 && "$line" == "---" ]]; then
      printf '%s\n' "${frontmatter_lines[@]}"
      return 0
    fi
    frontmatter_lines+=("$line")
  done < "$filepath"
  return 1
}

fm_has_key() {
  local frontmatter="$1"
  local key="$2"
  while IFS= read -r line; do
    [[ "$line" == "$key"* ]] && return 0
  done <<< "$frontmatter"
  return 1
}

fm_value() {
  local frontmatter="$1"
  local key="$2"
  while IFS= read -r line; do
    [[ "$line" == "$key"* ]] || continue
    local value="${line#$key}"
    value="${value#"${value%%[![:space:]]*}"}"
    # Trim wrapping quotes
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    printf '%s\n' "$value"
    return 0
  done <<< "$frontmatter"
  return 1
}

# ─── Checks ────────────────────────────────────────────────────────────

echo "=== KoLo Skill Validator ==="
echo "Skills root: $SKILLS_ROOT"
echo ""

# CHECK 1: Every skill directory has a SKILL.md
echo "--- Check 1: SKILL.md presence ---"
for skill_dir in "$SKILLS_ROOT"/*/; do
  [[ -d "$skill_dir" ]] || continue
  dirname="$(basename "$skill_dir")"
  is_plumbing "$dirname" && continue

  CHECKED=$((CHECKED + 1))
  skill_file="${skill_dir}SKILL.md"

  if [[ ! -f "$skill_file" ]]; then
    ERRORS+=("MISSING SKILL.md: $dirname/ has no SKILL.md")
    FAIL=1
  fi
done

# CHECK 2: Frontmatter presence and required fields
echo "--- Check 2: Frontmatter and required fields ---"
declare -A SKILL_NAMES=()
for skill_dir in "$SKILLS_ROOT"/*/; do
  [[ -d "$skill_dir" ]] || continue
  dirname="$(basename "$skill_dir")"
  is_plumbing "$dirname" && continue

  skill_file="${skill_dir}SKILL.md"
  [[ ! -f "$skill_file" ]] && continue

  if ! frontmatter="$(extract_frontmatter "$skill_file")"; then
    ERRORS+=("MISSING FRONTMATTER: $dirname/SKILL.md has no YAML frontmatter (must start with ---)")
    FAIL=1
    continue
  fi

  for key in "${REQUIRED_FIELDS[@]}"; do
    if ! fm_has_key "$frontmatter" "$key"; then
      ERRORS+=("MISSING KEY '$key': $dirname/SKILL.md")
      FAIL=1
    fi
  done

  # Check name is non-empty
  name_val="$(fm_value "$frontmatter" "name:")"
  if [[ -z "$name_val" ]]; then
    ERRORS+=("EMPTY name: $dirname/SKILL.md — name field is empty")
    FAIL=1
  else
    # Check for duplicate names
    if [[ -n "${SKILL_NAMES[$name_val]:-}" ]]; then
      WARNINGS+=("DUPLICATE NAME: '$name_val' in $dirname/ and ${SKILL_NAMES[$name_val]}")
    fi
    SKILL_NAMES["$name_val"]="$dirname/"
  fi

  # Check description is non-empty
  desc_val="$(fm_value "$frontmatter" "description:")"
  if [[ -z "$desc_val" ]]; then
    ERRORS+=("EMPTY description: $dirname/SKILL.md — description field is empty")
    FAIL=1
  fi

  # Check recommended fields
  for key in "${RECOMMENDED_FIELDS[@]}"; do
    if ! fm_has_key "$frontmatter" "$key"; then
      WARNINGS+=("MISSING RECOMMENDED '$key': $dirname/SKILL.md")
    fi
  done
done

# CHECK 3: location field matches actual directory
echo "--- Check 3: Location field accuracy ---"
for skill_dir in "$SKILLS_ROOT"/*/; do
  [[ -d "$skill_dir" ]] || continue
  dirname="$(basename "$skill_dir")"
  is_plumbing "$dirname" && continue

  skill_file="${skill_dir}SKILL.md"
  [[ ! -f "$skill_file" ]] && continue

  frontmatter="$(extract_frontmatter "$skill_file")" || continue
  location_val="$(fm_value "$frontmatter" "location:")" || continue

  if [[ -n "$location_val" ]]; then
    expected="skills/$dirname/"
    if [[ "$location_val" != "$expected" && "$location_val" != "$expected"* && "$location_val" != *"$dirname"* ]]; then
      WARNINGS+=("LOCATION MISMATCH: $dirname/SKILL.md declares location='$location_val' but lives at $expected")
    fi
  fi
done

# CHECK 4: Skills without emoji
echo "--- Check 4: Emoji presence ---"
for skill_dir in "$SKILLS_ROOT"/*/; do
  [[ -d "$skill_dir" ]] || continue
  dirname="$(basename "$skill_dir")"
  is_plumbing "$dirname" && continue

  skill_file="${skill_dir}SKILL.md"
  [[ ! -f "$skill_file" ]] && continue

  frontmatter="$(extract_frontmatter "$skill_file")" || continue
  if ! fm_has_key "$frontmatter" "emoji:"; then
    WARNINGS+=("NO EMOJI: $dirname/SKILL.md has no emoji field")
  fi
done

# ─── Report ────────────────────────────────────────────────────────────

echo ""
echo "========================================="
echo "Checked $CHECKED skill directories."
echo "========================================="

if [[ ${#WARNINGS[@]} -gt 0 ]]; then
  echo ""
  echo "WARNINGS (${#WARNINGS[@]}):"
  for warning in "${WARNINGS[@]}"; do
    echo "  ⚠️  $warning"
  done
fi

if [[ ${#ERRORS[@]} -gt 0 ]]; then
  echo ""
  echo "ERRORS (${#ERRORS[@]}):"
  for error in "${ERRORS[@]}"; do
    echo "  ❌ $error"
  done
  echo ""
  echo "Validation FAILED with ${#ERRORS[@]} error(s)."
  exit 1
fi

echo ""
echo "✅ All checks passed."
