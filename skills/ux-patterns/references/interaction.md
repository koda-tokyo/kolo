# Interaction Patterns

> **Rule of thumb**: Every interaction should provide immediate feedback, respect the user's intent, and be reversible when destructive.

## 1. Progressive Disclosure

Show only what the user needs now. Reveal complexity on demand.

**Do**: Show basic options first, advanced options behind a "Show advanced" toggle or collapsible section.

**Don't**: Dump every option onto one screen. Users scan, they don't read — if there are 20 fields they'll miss half of them.

**Pattern**: Use a "Show advanced options" button that expands inline. Don't navigate away.

## 2. Optimistic Updates

Update the UI immediately (optimistically), then reconcile with the server. If the server rejects, roll back and show an error.

**When to use**: High-confidence actions where the server usually succeeds and latency hurts perceived performance. Like toggles, checkboxes, quick actions.

**When NOT to use**: Financial transactions, destructive actions, or anything where the user might act on the optimistic state before it's confirmed.

**Do**:
- Show the optimistic change instantly
- If the server fails, revert the UI AND show a toast explaining what happened
- Allow the user to retry

**Don't**:
- Use long animations for the optimistic update — the speed is the point
- Leave the UI in an inconsistent state if the tab is closed mid-update
- Apply to payment, deletion, or permission changes

## 3. Inline Editing vs Modal

**Inline editing**: Edit content where it's displayed. Best for single-field changes (renaming, updating a value, status changes).

**Modal editing**: Open an overlay for complex edits. Best for multi-field forms, settings pages, or anything where validation across fields is needed.

| Criterion | Inline Edit | Modal |
|---|---|---|
| Number of fields | 1-3 | 4+ |
| Validation complexity | Single-field | Cross-field dependent |
| User context needed | Minimal | Needs full form to understand |
| Frequency | High (daily action) | Low (setup/configuration) |
| Risk of data loss | Low | Medium+ (needs explicit save/cancel) |

**Do**: For inline editing — Enter to save, Escape to cancel, click-outside to save (if no validation errors).

**Don't**: Use modals inside modals. Nesting modals creates focus traps and confuses users.

## 4. Drag and Drop

**When to use**: Reordering items, moving items between containers, file upload.

**Do**:
- Show a drag handle (⠿ or ⠿ icon) — never rely on users discovering drag functionality
- Provide keyboard alternative (cut/paste, move up/down buttons)
- Highlight the drop target as the item is dragged over it
- Make the dragged item partially transparent

**Don't**:
- Require drag-and-drop as the *only* way to reorder — always provide keyboard or tap alternatives
- Use drag-and-drop on mobile without clear affordances (it conflicts with scroll)

## 5. Infinite Scroll vs Pagination

| Criterion | Infinite Scroll | Pagination |
|---|---|---|
| Content type | Feeds, social, discovery | Search results, tables, data |
| User goal | Browse casually | Find something specific |
| Need to jump to end? | No | Yes |
| Need to reference "page 3"? | No | Yes |
| Footer navigation | None needed | Pages + first/last |
| SEO | Worse (no distinct URLs) | Better (distinct page URLs) |

**Decision rule**: If users browse → infinite scroll. If users search/find → pagination. If both, use "Load more" button as a compromise.

**Do for infinite scroll**:
- Pre-fetch the next page when the user is 70% scrolled
- Persist scroll position when navigating back
- Show a "Back to top" button after 3+ pages

**Do for pagination**:
- Show "Previous" and "Next" (not just numbers)
- Highlight the current page
- Show total page count when it's known

## 6. Pull-to-Refresh

**Mobile only**. Pull down at the top of a scrollable list to refresh.

**Do**: Show a loading indicator during the pull and during refresh. Include haptic feedback when the threshold is reached.

**Don't**: Block the UI during refresh — let the user scroll while data loads.

## 7. Swipe Actions

**When to use**: Lists where each item has 1-2 primary actions (delete, archive, mark read).

**Do**:
- Full swipe (iOS) or swipe + button reveal (Android) — use platform convention
- Show the action label + icon
- Use colour coding: red for destructive, blue/neutral for other actions
- Provide an undo option after swipe-to-delete (toast with "Undo")

**Don't**:
- Put more than 2 actions per swipe direction
- Make swipe the only way to access these actions (always provide a long-press or ⋮ menu alternative)

## 8. Long-Press (Mobile)

**When to use**: Context menus, preview (iOS Peek), drag initiation.

**Do**: Show a subtle scale animation on press to preview. Show a haptic bump.

**Don't**: Hide critical functionality only behind long-press — it's undiscoverable.

## 9. Keyboard Shortcuts

**Do**:
- Support standard shortcuts: ⌘Z undo, ⌘S save, Esc close, Enter submit, Tab navigate
- Show shortcuts in tooltips and command palette
- Make shortcuts configurable for power users

**Don't**:
- Override browser shortcuts (⌘L for address bar, ⌘T for new tab)
- Require multi-key chords (3+ modifiers) — too complex

## 10. Focus Management

**After navigation**: Move focus to the heading of the new content (not the top of the page).

**After modal open**: Trap focus inside the modal. The first focusable element should receive focus.

**After modal close**: Return focus to the element that opened the modal.

**After form submit error**: Move focus to the first field with an error.

**Do**: Use `aria-live` regions for dynamically updating content so screen readers announce changes.

## 11. Motion and Transitions

**Purposeful only**. Every animation should serve a function:

| Purpose | Example | Duration |
|---|---|---|
| Context change | Page transition | 200-300ms |
| Feedback | Button press, toggle | 100-200ms |
| Spatial relationship | Modal opening, panel sliding | 200-400ms |
| Attention | Notification badge | 300-500ms |

**Do**:
- Respect `prefers-reduced-motion` — disable all non-essential animations
- Use easing: `ease-out` for entering (decelerating), `ease-in` for exiting (accelerating)

**Don't**:
- Animate everything — animations lose meaning when overused
- Exceed 500ms for any transition — users wait, they don't admire
- Use `linear` easing — it looks mechanical
