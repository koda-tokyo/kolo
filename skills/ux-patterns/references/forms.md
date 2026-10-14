# Form UX Patterns

> **Rule of thumb**: Forms are conversations. Every field is a question. Make it easy to answer and hard to make mistakes.

## Layout

### Single-Column Layout

**Always**. Multi-column forms cause users to miss fields, misinterpret field grouping, and scan incorrectly.

**Do**: One field per row, labels on top. This works on every screen size and is the most scannable pattern.

**Don't**: Place fields side by side except for logically atomic pairs (first/last name, city/state, start date/end date). Even then, stack on mobile.

### Top-Aligned Labels

Labels above the field — not to the left. Eye-tracking studies consistently show faster completion times with top-aligned labels.

**Exception**: If the form is extremely long and vertical space is precious (dense data entry), left-aligned labels can work — but the trade-off is slower scanning.

### Field Width Should Hint at Expected Input

- Postcode field → narrow (the width of a postcode)
- Description field → wide (full width)
- Credit card number → 16-19 characters wide

Don't make every field full-width. Use width to communicate expected input length.

## Validation

### Inline Validation (On Blur)

Validate as the user leaves each field (`onBlur`), not on every keystroke and not only on submit.

**On keystroke**: Annoying — tells users they're wrong before they're done typing.

**On submit only**: Too late — makes users hunt for errors after the fact.

**On blur with delayed keystroke**: ✓ Best — validates at the right moment. For fields like username availability checks, validate after the user pauses typing (500ms debounce).

**Do**:
- Show the error message directly below the field, not in a banner at the top
- Use a red border on the field + a red error icon + a clear text message
- Remove the error state as soon as the user starts fixing it

**Don't**:
- Show all errors in a top-of-page banner (users must scroll up to see them, then scroll back down to fix)
- Just highlight the field red with no message — say *what* to fix and *how*
- Validate email with regex that rejects valid emails like `user+tag@domain.com`

**Error message formula**: *What went wrong* → *How to fix it*
- ❌ "Invalid input"
- ✓ "Email address is missing an @ symbol"

### Smart Defaults

Pre-fill every field where you can predict the answer. Saves time, reduces errors.

- Country → detect from IP or browser locale, but let them change it
- Currency → derive from locale
- Today's date → for date fields where it's likely relevant
- Previously entered values → remember across sessions

**Don't**: Default to the first option in a dropdown if it's not a safe guess. Use a placeholder like "Select..." instead.

## Multi-Step Wizards

For forms with 8+ fields, or when fields are logically grouped into stages.

**Structure**:
1. Show a progress indicator at the top (steps, not percentage)
2. Each step should be self-contained — user can understand all fields without seeing other steps
3. Allow going back to previous steps without losing data
4. "Save draft" button for forms that take >5 minutes

**Progress bar**: Label each step ("Account → Details → Confirm" not "Step 1 of 3"). Show completed steps distinctly.

**Do**:
- Validate the current step before allowing "Next"
- Show a summary on the final step before submitting
- Allow saving a draft at any step

**Don't**:
- Force linear progression when steps aren't dependent
- Lose data when the user clicks "Back"

## Auto-Save

Auto-save after every meaningful change with a debounce (1-2 seconds).

**Do**:
- Show a subtle "Saved" indicator (checkmark + timestamp)
- Save to local storage as a fallback (survives tab close)
- Detect conflicts (another user/device edited the same data)

**Don't**:
- Save on every keystroke — wastes bandwidth, feels jittery
- Auto-save without telling the user — they may think it hasn't saved and re-do the work

## Undo

Every destructive action needs an undo path.

**Pattern**: After deleting, show a toast: "Item deleted. [Undo]" — the undo action is inline in the toast, not a separate flow. Toast times out after 6-8 seconds.

**Do**: Undo should be one tap/click. Don't make the user navigate to a "trash" folder unless for bulk recovery.

## Password UX

- Show/hide toggle (eye icon) in the password field — never force users to type passwords blindly
- Show password requirements *before* the user types (not as errors after)
- Check off requirements as they're met in real time
- Never require password re-typing on the same device/flows where you can show/hide
- Use password managers: don't disable paste in password fields — this breaks password managers and reduces security

## Submit Button States

The submit button must have 4 distinct states:

| State | Visual | Behaviour |
|---|---|---|
| **Idle** | Normal button | Submits form |
| **Loading** | Button shows spinner + "Saving..." or "Submitting..." | Disabled, prevents double-submit |
| **Success** | Button shows ✓ + "Saved" or "Sent" | Briefly shown, then reset or navigate |
| **Error** | Button returns to idle state + error message near relevant field | User can re-submit |

**Placement**: Submit button at the bottom, aligned left (for forms where the user moves down the page) — NOT centred. Centred buttons are less scannable because the eye must track from left-aligned labels.

## Conditional Fields

Show/hide fields based on previous answers. Reveal inline, not in a popover.

**Do**:
- Animate the reveal (slide or fade, 150-200ms) so the user notices the change
- Keep the revealed fields in the same visual flow — don't scroll-jump
- Focus the first field in the revealed section if it's an input

**Don't**:
- Reveal fields below the fold without scrolling to them — user may miss them
- Show/hide based on field value alone AND also require a "refresh" button — the reveal should be automatic

## Common Mistakes

- **No inline validation** → user submits, gets 8 errors at once, gives up
- **Overly aggressive validation** → rejects valid data (names with hyphens, international phone numbers, `+` in emails)
- **Clearing the form on error** → user's work is gone; they leave
- **"Reset" button** → almost never needed; if present, make it subtle and add a confirmation dialog
- **Placeholder text as labels** → disappears on focus, users forget what the field is; always use a real `<label>`
