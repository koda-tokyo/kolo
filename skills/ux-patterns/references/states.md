# State Handling Patterns

> **Rule of thumb**: Every screen exists in at least 4 states. Design all of them before writing code. Loading, empty, error, and ideal are non-negotiable.

## The States Matrix

Every screen or component should be designed for these states:

| State | When | User Needs |
|---|---|---|
| **Ideal** | Everything loaded, data present | Interact with content |
| **Loading** | Waiting for data | Know the system is working, estimate wait time |
| **Empty (first use)** | Zero data, new account | Understand what this screen is, what to do first |
| **Empty (cleared)** | Data was there, now it's gone | Know what happened, how to restore or move on |
| **No Results** | Search/filter returned nothing | Know why, adjust criteria |
| **Error** | Something went wrong | What happened, what to do, who to contact |
| **Partial** | Some data loaded, some failed | Use what's available, understand what's broken |
| **Edge Case** | Extreme data (very long text, minimum values) | Content doesn't break the layout |

## Loading States

### Skeleton Screens

**When to use**: Page-level loads > 500ms. Content-heavy pages with a predictable layout (cards, tables, lists).

**Do**:
- Match the skeleton shape to the actual content shape (card → skeleton card, not a generic block)
- Use subtle animation (shimmer/pulse) to indicate activity
- Show the skeleton immediately, no delay

**Don't**:
- Use skeletons for sub-200ms loads — a flash of skeleton is worse than a brief blank
- Animate aggressively — don't distract

### Spinners

**When to use**: Button actions, form submissions, any operation that disables the triggering element.

**Do**: Put the spinner inside the button that triggered the action. Replace the label: "Save" → "Saving..."

**Don't**: Use a full-page spinner overlay that blocks interaction. If the user can't do anything, that's a full-page spinner — but almost always they can still navigate or scroll.

### Shimmer (pulsing opacity)

**When to use**: Inline detail loading (a card's content loading within an already-loaded page). Less visually heavy than a skeleton.

**Decision Guide: Skeleton vs Spinner vs Shimmer**

```
Is the entire page loading?
├── Yes → Skeleton screen (layout-aware)
└── No → Is it a user action (button click)?
    ├── Yes → Spinner in the button
    └── No → Is it a specific component loading?
        ├── Yes → Shimmer on that component
        └── No → Show existing content + inline spinner
```

## Empty States

### First-Use Empty State (Onboarding)

The user has just signed up. There's nothing here. This is your moment to teach.

**Formula**: *What this screen is* + *What they'll see here* + *How to get started*

```
✓ "Your project dashboard
   Projects you create will appear here.
   [Create your first project →]"

✗ "No projects"
```

**Do**:
- Include a clear CTA button
- Show an illustration or icon (makes it feel intentional, not broken)
- Explain the benefit ("Track all your team's work" not "No data found")

**Don't**:
- Just say "No data" with no action — it's a dead end
- Link to documentation — users want to *do*, not *read*

### Empty State After Clearing

The user had items, now they don't (deleted all, completed all, archived all).

**Formula**: *Acknowledge completion* + *Next step*

```
✓ "All tasks completed! 🎉
   Create new tasks or review your completed ones.
   [Create task] [View completed]"

✗ "No tasks"
```

## No Results (Search/Filter)

The user searched or filtered and got zero results. This is not an empty state — they expected to find something.

**Formula**: *Why there are no results* + *What they can change*

```
✓ "No projects match 'q4-report'
   Try adjusting your search or clearing filters.
   [Clear filters]"

✗ "No results found"
```

**Do**:
- Show the search query so they can see what they typed
- Offer one-click "Clear filters"
- Suggest alternative searches if possible (typo correction)

## Error States

### The Error Message Formula

1. **What happened** — in plain language, no technical jargon
2. **Why it happened** — if known and helpful
3. **What to do next** — concrete action

```
✓ "We couldn't load your projects right now.
   This might be a temporary connection issue.
   [Try again] or [View offline projects]"

✗ "Error 503: Service Unavailable"
✗ "Something went wrong" (too vague — what? why? do what?)
```

**Never blame the user**:
- ❌ "You entered an invalid email"
- ✓ "That email address doesn't look right"

### Retry Logic

- Provide a one-click retry button
- If the error is likely transient, auto-retry once before showing the error
- For background operations, retry silently and only surface the error after 2-3 failures

## Partial State

Some data loaded, some didn't. Show what you have, clearly mark what's missing.

**Pattern**: Render the loaded content, show skeleton/shimmer on the failed sections with an individual retry button per section. Don't block the entire page because one widget failed.

## Edge Cases

Always test with:

| Data | Why |
|---|---|
| Very long strings (200+ chars) | Overflow, wrapping, truncation |
| Very short strings (1-2 chars) | Layout collapse |
| Zero values (0, $0.00) | Make sure 0 is shown, not hidden as "falsy" |
| Unicode/emoji in text fields | Rendering, database issues |
| Extremely large numbers | Formatting (99999999 → "Could not format") |
| Empty arrays, null values | Crashes from `.length` on null |
| Rapid double-clicks on buttons | Double submission |

## State Checklist (per screen)

Before shipping any screen, confirm these states are designed:

- [ ] Loading (skeleton, spinner, or shimmer chosen appropriately)
- [ ] Empty (first use — onboarding prompt)
- [ ] Empty (after data cleared)
- [ ] No results (search/filter returned nothing)
- [ ] Error (with retry action)
- [ ] Partial (some sections failed)
- [ ] Ideal (data present, everything working)
- [ ] Edge cases tested (long text, 0 values, rapid clicks)
