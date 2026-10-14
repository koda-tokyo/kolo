# Component Design

## Buttons

### Hierarchy

1. **Primary** — One per section. Main action. Solid fill.
2. **Secondary** — Supporting actions. Outlined or muted fill.
3. **Tertiary/Ghost** — Minimal actions. Text only with hover state.
4. **Destructive** — Delete, remove. Red.

### Specifications

```
Height: 36px (sm) / 40px (md) / 48px (lg)
Padding: 8px 12px (sm) / 10px 16px (md) / 14px 24px (lg)
Border radius: 6px
Font weight: 500 (medium)
Text: Sentence case
```

### States

- Default
- Hover (darken 10%)
- Active/Pressed (darken 15%)
- Focus (ring outline, 2px offset)
- Disabled (50% opacity, no pointer events)
- Loading (spinner, text "Loading...")

### Code Pattern

```tsx
<Button variant="primary" size="md">
  Save changes
</Button>

<Button variant="secondary" size="md">
  Cancel
</Button>

<Button variant="ghost" size="sm">
  Learn more
</Button>
```

## Forms

### Input Fields

```
Height: 40px
Padding: 10px 12px
Border: 1px solid Gray-300
Border radius: 6px
Focus: Primary color ring
Error: Red-500 border + message
```

### Labels

- Position: Above input
- Gap: 4px
- Font: 14px, medium weight
- Required: Red asterisk after label

### Help Text

- Position: Below input
- Color: Gray-500
- Font: 12px

### Error Messages

- Position: Below input
- Color: Red-600
- Icon: Optional (warning icon)

### Pattern

```tsx
<div className="space-y-1.5">
  <Label htmlFor="email">Email *</Label>
  <Input id="email" type="email" placeholder="you@example.com" />
  <p className="text-sm text-gray-500">We'll never share your email.</p>
</div>
```

## Cards

### Structure

```
Border radius: 8px (sm) / 12px (md)
Border: 1px solid Gray-200 OR shadow-sm
Padding: 16px (compact) / 24px (default)
Background: White
```

### Variants

1. **Outlined** — Border, no shadow
2. **Elevated** — Shadow, no border
3. **Filled** — Gray-50 background

### Hover (if clickable)

- Subtle shadow increase
- Background tint
- Border color change

## Tables

### Header

```
Background: Gray-50
Font weight: 500 or 600
Text: Uppercase or Sentence (consistent)
Border bottom: 1px
```

### Rows

```
Height: 52px (default) / 40px (compact)
Padding: 12px 16px
Alternating: Optional (Gray-50 even rows)
Border: 1px bottom OR alternating
Hover: Gray-50 background
```

### Actions Column

- Right-aligned
- Icon buttons or dropdown menu
- Ghost/tertiary style

## Navigation

### Top Navigation

```
Height: 64px
Background: White
Border bottom: 1px Gray-200
Logo: Left
Nav items: Center or right
Actions: Right
```

### Sidebar Navigation

```
Width: 240px (collapsed: 64px)
Background: White or Gray-50
Item height: 44px
Item padding: 12px 16px
Active: Primary-50 background, Primary-600 text
Hover: Gray-100 background
Icons: 20px, 12px gap from text
```

### Breadcrumbs

```
Separator: / or > or chevron icon
Font: 14px, Gray-500
Current page: Gray-900, no link
```

## Modals / Dialogs

### Structure

```
Border radius: 12px
Padding: 24px
Background: White
Overlay: Black @ 50% opacity
Shadow: xl
Max width: 500px (varies)
```

### Header

- Title: 18px, semibold
- Close button: Top right, X icon
- Divider: Optional

### Footer

- Buttons right-aligned
- Primary action rightmost
- Cancel on left

## Tooltips

```
Background: Gray-900
Text: White, 12px
Padding: 6px 10px
Border radius: 4px
Arrow: 6px
Delay: 300-500ms
Max width: 250px
```

## Badges / Tags

```
Font: 12px
Padding: 2px 8px
Border radius: 9999px (pill) or 4px (square)
Background: Light tint of semantic color
Text: Darker shade of same color
```

## Empty States

### Structure

1. **Illustration** — 48-64px icon or simple SVG
2. **Headline** — What's empty
3. **Description** — Why and what to do
4. **Action** — Primary button to resolve

### Example

```tsx
<div className="text-center py-12">
  <InboxIcon className="mx-auto h-12 w-12 text-gray-400" />
  <h3 className="mt-4 text-lg font-medium text-gray-900">No messages</h3>
  <p className="mt-2 text-sm text-gray-500">
    Get started by composing a new message.
  </p>
  <Button className="mt-6">New message</Button>
</div>
```
