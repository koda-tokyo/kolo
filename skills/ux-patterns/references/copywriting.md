# UX Copywriting Patterns

> **Rule of thumb**: Every word in the UI should earn its place. If you can remove a word and the meaning doesn't change, remove it.

## Error Messages

### The Formula

**What happened + Why (if helpful) + How to fix it.**

```
✓ "We couldn't save your changes.
   The server is temporarily unreachable.
   [Try again]"

✗ "Error 500: Internal Server Error" (jargon, no action)
✗ "Something went wrong" (too vague)
✗ "Invalid input" (what? why? fix how?)
```

### No Blame

Errors are system problems, not user failures. Language should reflect this.

- ❌ "You entered the wrong password"
- ✓ "That password doesn't match this account"

- ❌ "You forgot to fill in the address field"
- ✓ "Address is required"

- ❌ "Invalid email format"
- ✓ "Enter an email address with an @ sign, like name@example.com"

### No Jargon

- ❌ "500 Internal Server Error — the server encountered an unexpected condition"
- ✓ "There's a temporary issue on our end. Please try again."

- ❌ "Request timed out — the upstream server failed to respond"
- ✓ "This is taking longer than expected. Check your connection and try again."

## Empty States

### First-Use Empty State

**Formula**: *What this is + What you'll get + How to start*

```
✓ "Your team dashboard
   Track projects, deadlines, and team progress all in one place.
   [Create your first project →]"

✗ "No data found"
✗ "Your dashboard is empty"
```

### No Results (Search/Filter)

This is different from empty — the user expected to find something.

```
✓ "No results for "marketing report"
   Try different keywords or clear your filters.
   [Clear filters]"

✗ "0 results"
```

**Do**: Show the search query so the user can see what they typed. One-click clear-filters.

## Button Labels

### Predict the Action

Button labels should tell the user what will happen when they click. "OK" or "Yes" never does this well.

| ❌ Don't | ✓ Do |
|---|---|
| OK | Save changes |
| Yes | Delete project |
| No | Keep project |
| Submit | Send message |
| Confirm | Schedule meeting |
| Cancel | Don't save |
| Close | Close without saving (if data loss is possible) |

**Specific beats generic every time**:
- ❌ "Download" → ✓ "Download report (PDF)"
- ❌ "Share" → ✓ "Share with team"
- ❌ "Edit" → ✓ "Edit profile"

### Destructive Actions

Make the consequence explicit in the button label:
- ✓ "Delete account" (not "OK" in a dialog)
- ✓ "Remove teammate" (not "Confirm")

### Case

Use sentence case for buttons: "Save changes" not "Save Changes" or "SAVE CHANGES". Capitalization slows reading.

## Loading Messages

### Be Specific

Tell the user *what* is loading. A generic "Loading..." creates uncertainty — is it loading the page, the data, or did it freeze?

- ❌ "Loading..."
- ✓ "Loading your projects..."
- ❌ "Please wait"
- ✓ "Generating your report..."
- ❌ "Processing"
- ✓ "Uploading 3 files..."

### For Long Operations

If it takes >5 seconds:
- Show a progress indicator (percentage or step count)
- Tell them what's happening: "Optimizing images..." → "Generating thumbnails..." → "Almost done..."
- Offer a background option: "We'll notify you when it's ready"

## Confirmations

### Clear Consequences

Every confirmation dialog must state *exactly* what will happen:

```
✓ "Delete "Q4 Marketing Plan"?
   This project and all 12 tasks in it will be permanently deleted.
   [Cancel] [Delete project]"

✗ "Are you sure?"
✗ "Delete this item?"
```

### Success States

Confirm that the action worked:

- ✓ "Project created" (with a link to it)
- ✓ "Changes saved" (with timestamp)
- ✓ "3 files uploaded" (with list preview)

**Do**: Include an undo path: "Project deleted. [Undo]"

**Don't**: Show success toasts for every minor action — "Settings saved" after every toggle change gets annoying. Reserve toasts for significant or non-obvious confirmations.

## Placeholder Text

### Examples, Not Labels

Placeholders should show an example of valid input, not repeat the label.

```
✓ Label: "Email"
   Placeholder: "name@company.com"

✗ Label: "Email"
   Placeholder: "Enter your email" (redundant — the label already says "Email")
```

**Do**: Make examples realistic. If it's a date field, use a real date format the user would type: "2026-05-19" not "YYYY-MM-DD".

**Don't**: Use placeholder text as the only label. When the user types, the placeholder disappears. Use a real `<label>`.

## Notifications and Toasts

### When to Use Toasts

- Confirming a non-obvious action (saved, sent, deleted with undo)
- Background operation completed
- Error that doesn't block the current task

### When NOT to Use Toasts

- Replacing form validation errors (errors should be inline near the field)
- For every minor action (too many toasts = noise)
- For critical errors that need a decision (use a modal instead)

### Toast Content

- **Keep it to one line** (ideally under 40 characters)
- **Include an action** if relevant: "File uploaded. [View]"
- **Auto-dismiss**: 4-6 seconds for success/info, longer or manual dismiss for errors

## Tone Guidelines

### Professional, Helpful, Human

| Too Formal | Too Casual | Just Right |
|---|---|---|
| "An error has occurred. Please contact your system administrator." | "Oopsie! Something broke 🤷‍♀️" | "That didn't work. Try again or contact support." |
| "Authentication credentials are invalid." | "Wrong password, buddy!" | "That password doesn't match. [Reset password]" |
| "Your request has been processed successfully." | "Nailed it! 🎉" | "Your order is confirmed. We'll email you a receipt." |

**Do**:
- Write like a helpful colleague, not a manual or a friend
- Use contractions ("can't" not "cannot") — more natural
- Use "we" for the product/company, "you" for the user: "We couldn't process your payment"

**Don't**:
- Use humour in error messages — the user is already frustrated
- Use exclamation marks in errors ("Upload failed!") — it reads as excitement
- Write in all caps — it reads as yelling

## Do / Don't Summary

| Context | Don't | Do |
|---|---|---|
| Error | "Error 404" | "We couldn't find that page. [Go home]" |
| Empty | "No data" | "Your library is empty. [Add your first book →]" |
| Button | "OK" | "Save changes" |
| Loading | "Loading..." | "Loading your invoices..." |
| Delete confirm | "Are you sure?" | "Delete "Report.pdf"? This can't be undone." |
| Placeholder | "Enter name" | "Jane Smith" |
| Success | "Success!" | "Team created. [Invite members →]" |
