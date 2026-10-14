# UI Patterns

## Layout Patterns

### Dashboard Layout

```
┌─────────────────────────────────────────────────┐
│ Header (64px)                                   │
├──────────┬──────────────────────────────────────┤
│ Sidebar  │ Main Content                         │
│ (240px)  │                                      │
│          │ ┌─────────────────────────────────┐  │
│          │ │ Page Header                     │  │
│          │ │ Title + Actions                 │  │
│          │ ├─────────────────────────────────┤  │
│          │ │ Content Area                    │  │
│          │ │                                 │  │
│          │ └─────────────────────────────────┘  │
└──────────┴──────────────────────────────────────┘
```

### Page Header

```tsx
<div className="flex items-center justify-between">
  <div>
    <h1 className="text-2xl font-semibold text-gray-900">Page Title</h1>
    <p className="mt-1 text-sm text-gray-500">Optional description</p>
  </div>
  <div className="flex items-center gap-3">
    <Button variant="secondary">Export</Button>
    <Button variant="primary">Create new</Button>
  </div>
</div>
```

### List View

```
┌─────────────────────────────────────────────────┐
│ Search | Filters | Sort           [Actions]     │
├─────────────────────────────────────────────────┤
│ ☐ | Item 1 | Detail | Detail | Status | •••    │
├─────────────────────────────────────────────────┤
│ ☐ | Item 2 | Detail | Detail | Status | •••    │
├─────────────────────────────────────────────────┤
│ ☐ | Item 3 | Detail | Detail | Status | •••    │
├─────────────────────────────────────────────────┤
│ Showing 1-10 of 100          [<] 1 2 3 ... [>]  │
└─────────────────────────────────────────────────┘
```

### Detail View

```
┌─────────────────────────────────────────────────┐
│ [← Back] | Entity Name              [Actions]   │
├─────────────────────────────────────────────────┤
│ Tab 1 | Tab 2 | Tab 3                           │
├──────────────────────────┬──────────────────────┤
│ Main Content             │ Sidebar Info         │
│ (8 cols)                 │ (4 cols)             │
│                          │                      │
│ Section 1                │ Status: Active       │
│ ───────────────          │ Created: Jan 1       │
│ Content...               │ Owner: John          │
│                          │                      │
│ Section 2                │                      │
│ ───────────────          │                      │
│ Content...               │                      │
└──────────────────────────┴──────────────────────┘
```

## Interaction Patterns

### Loading States

**Skeleton loaders** (preferred):
```tsx
<div className="animate-pulse">
  <div className="h-4 bg-gray-200 rounded w-3/4 mb-4" />
  <div className="h-4 bg-gray-200 rounded w-1/2" />
</div>
```

**Spinners** (for short operations only):
```tsx
<Spinner className="h-5 w-5 animate-spin text-gray-400" />
```

### Progress Indication

1. Determinate (known progress): Progress bar
2. Indeterminate (unknown): Spinner or pulse
3. Inline (in button): Small spinner + "Loading..."

### Search

```tsx
<div className="relative">
  <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
  <Input 
    className="pl-10" 
    placeholder="Search..."
    type="search"
  />
</div>
```

### Filtering

- **Simple:** Dropdown selects
- **Complex:** Filter panel (slide-out or inline)
- **Show active:** Filter chips/tags with remove

```tsx
<div className="flex items-center gap-2">
  <Select placeholder="Status" options={statusOptions} />
  <Select placeholder="Date" options={dateOptions} />
  <Button variant="ghost" size="sm">Clear all</Button>
</div>
```

### Sorting

- Click column header to sort
- Arrow icon indicates direction
- Single column at a time (unless advanced)

### Pagination

```tsx
<div className="flex items-center justify-between">
  <span className="text-sm text-gray-500">
    Showing 1-10 of 97 results
  </span>
  <div className="flex items-center gap-2">
    <Button variant="ghost" size="sm" disabled>Previous</Button>
    <span className="text-sm">Page 1 of 10</span>
    <Button variant="ghost" size="sm">Next</Button>
  </div>
</div>
```

### Bulk Actions

When items selected:
- Show count: "3 selected"
- Show bulk actions: Delete, Export, etc.
- Deselect all option

## Feedback Patterns

### Toast Notifications

```
Position: Top-right or bottom-right
Width: 350-400px
Duration: 3-5 seconds
Types: Success, Error, Warning, Info
Action: Optional button
Dismiss: X button or swipe
```

### Inline Alerts

```tsx
<Alert variant="warning">
  <AlertIcon />
  <AlertTitle>Warning</AlertTitle>
  <AlertDescription>Your session will expire in 5 minutes.</AlertDescription>
</Alert>
```

### Form Validation

1. **Real-time:** Validate on blur
2. **On submit:** Show all errors
3. **Focus first error:** Scroll and focus
4. **Clear on fix:** Remove error when corrected

### Confirmation Dialogs

For destructive actions:

```tsx
<Dialog>
  <DialogTitle>Delete item?</DialogTitle>
  <DialogDescription>
    This action cannot be undone. This will permanently delete the item.
  </DialogDescription>
  <DialogFooter>
    <Button variant="secondary">Cancel</Button>
    <Button variant="destructive">Delete</Button>
  </DialogFooter>
</Dialog>
```

## Mobile Patterns

### Bottom Sheet

For mobile actions instead of modals.

### Pull to Refresh

Native gesture for list refresh.

### Swipe Actions

Reveal actions on swipe (delete, archive).

### Sticky Headers

Table headers stick on scroll.

### Floating Action Button

Primary action, bottom-right, 56x56px.

## Data Display

### Numbers

- Use thousand separators: 1,234,567
- Currency with symbol: $1,234.56
- Percentages: 45.2%
- Align right in tables

### Dates

- Relative when recent: "2 hours ago"
- Absolute when older: "Jan 15, 2026"
- Full format on hover: "January 15, 2026 at 3:45 PM"

### Status

Use badge/chip with semantic color:

```tsx
<Badge variant="success">Active</Badge>
<Badge variant="warning">Pending</Badge>
<Badge variant="error">Failed</Badge>
<Badge variant="default">Draft</Badge>
```

### Truncation

- Single line: Ellipsis (`text-overflow: ellipsis`)
- Multi-line: Line clamp (`-webkit-line-clamp: 2`)
- Show full on hover/click

## Accessibility Patterns

### Focus Management

- Visible focus rings
- Logical tab order
- Focus trap in modals
- Return focus after modal close

### Keyboard Navigation

- Arrow keys in menus/lists
- Enter to select
- Escape to close
- Tab through interactive elements

### Screen Reader

- Proper heading hierarchy
- ARIA labels for icons
- Live regions for updates
- Descriptive link text
