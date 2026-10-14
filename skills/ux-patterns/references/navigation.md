# Navigation Patterns

> **Rule of thumb**: The navigation should answer three questions at all times: *Where am I? Where can I go? How do I get back?*

## Pattern Catalog

### 1. Top Navigation (Horizontal Bar)

**When to use**: Apps with ≤7 top-level sections. Desktop-first. Good for discoverability — users see everything at a glance.

**Do**:
- Highlight the current section with a distinct visual state (not just colour — add underline or weight)
- Keep labels short (1-2 words max)
- Use dropdowns for secondary items, but limit depth to 2 levels

**Don't**:
- Overflow items into a scroll — if you have more items, use a sidebar instead
- Nest dropdowns inside dropdowns (fly-out of fly-out) — breaks keyboard nav and accessibility

**Mobile fallback**: Collapse into a hamburger menu or bottom tabs.

### 2. Sidebar (Vertical Navigation)

Two variants:

**Persistent Sidebar**: Always visible. Best for complex apps with many sections (dashboards, admin panels, IDEs). Supports nesting up to 3 levels with collapsible groups.

**Collapsible Sidebar** (mini variant): Collapses to icons on narrow screens. Users toggle between icon-only (48-64px wide) and full (240-280px wide). Good for content-heavy apps where screen real estate matters.

**When to use sidebar over top nav**:
- More than 7 top-level sections
- Deep hierarchy (3+ levels)
- Users frequently switch between sections
- Long labels that don't fit in a horizontal bar

**Depth limit**: 3 levels maximum. If you need more, restructure your IA — users get lost beyond 3.

**Do**:
- Group related items with section headers (non-clickable)
- Persist collapse state across sessions
- Highlight both the active item AND its parent group

**Don't**:
- Use nested fly-out menus in a sidebar
- Make the toggle button hard to find (place it at the bottom, not the top)

### 3. Bottom Tabs (Mobile)

**When to use**: 3-5 top-level destinations on mobile. iOS and Android both support this natively.

**Do**:
- Use 3-5 tabs (never more than 5)
- Use concise labels with clear icons
- Highlight the active tab
- Persist state per tab (if user is scrolled in tab A, switching to B and back should restore scroll position)

**Don't**:
- Use "More" tab on iOS — Apple rejects this pattern. If you have more than 5 items, restructure
- Scroll tabs horizontally — undiscoverable, frustrating
- Use bottom tabs on desktop — feels out of place

### 4. Breadcrumbs

**When to use**: Hierarchical content where users navigate deeper levels (file systems, product catalogues, settings pages). Only show if depth > 1.

**Do**:
- Place at top of content area, below the primary nav
- Make every crumb except the last one a link
- Use `>` or `/` as separators (not `→` — avoid unicode that voice readers stumble on)
- Truncate the middle if the trail is too long: Home > ... > Current Page

**Don't**:
- Use breadcrumbs as the *only* navigation — they're supplementary
- Make the current page a link (it should be inert text)
- Replace a proper back button with breadcrumbs on mobile

### 5. Command Palette (⌘K / Ctrl+K)

**When to use**: Apps with 20+ possible actions. Power-user feature.

**Do**:
- Open with ⌘K (Mac) / Ctrl+K (Windows/Linux)
- Show recently used actions first
- Include fuzzy search
- Group results by category (Pages, Actions, Settings, Recent)
- Show keyboard shortcut hints inline

**Don't**:
- Make this the *only* way to access certain features — it supplements, not replaces
- Slow it down — must feel instant (debounce at 50ms)

### 6. Search Bar

**When to use**: Content-heavy apps where browsing the nav isn't sufficient.

**Do**:
- Place in a consistent, prominent location (header or sidebar top)
- Support keyboard shortcut (`/` or ⌘K)
- Show recent searches and suggestions
- Autocomplete with categories (not just a flat list)

**Don't**:
- Require users to click into the search bar — make it a visible input, not a magnifying-glass icon that expands
- Clear the query when the user pauses — let them refine

### 7. Mega Menu

**When to use**: E-commerce or content-heavy sites with deep category trees. Shows everything at once in a large dropdown panel.

**Do**:
- Show 2 levels of hierarchy in the panel
- Group with clear visual sections
- Close on second click outside or Escape

**Don't**:
- Use for apps — mega menus are for browsing/discovery, not productivity
- Make the panel taller than the viewport
- Open on hover alone (add click or a delay to avoid accidental triggering)

### 8. Hamburger Menu

**When to use**: Mobile only (or as fallback on narrow desktop). Hides navigation behind a ☰ icon.

**Do**:
- Slide from the side (left for LTR, right for RTL) — not a dropdown
- Close on backdrop tap or Escape
- Show the current page name next to the hamburger icon when possible

**Don't**:
- Use hamburger on desktop — it hides navigation and hurts discoverability (Nielsen Norman Group: hidden navigation is used less and remembered less)
- Nest scrolling inside the hamburger panel — if your nav is that deep, restructure

## Desktop vs Mobile — Decision Guide

| Context | Desktop | Mobile |
|---|---|---|
| ≤5 top-level items | Top nav or sidebar | Bottom tabs |
| 6-7 top-level items | Sidebar | Hamburger or bottom tabs (max 5) + hamburger for rest |
| 8+ top-level items | Sidebar with collapsible groups | Hamburger only |
| Deep hierarchy (3+ levels) | Sidebar + breadcrumbs | Hamburger + breadcrumbs |
| Power users | Command palette (⌘K) | Command palette (long-press or pull-down on iOS) |

## Back Button Behaviour

**Web**: The browser back button must always work. Do not break it with SPA routing. Every navigation that feels like a "page change" should push a history entry.

**Mobile (iOS)**: System back gesture (swipe from left edge) should work. If you're in a modal or sheet, swipe to dismiss, not navigate back.

**Android**: System back button must work predictably. If showing a sheet, back dismisses the sheet, not the screen behind it.

**Cross-platform rule**: The deepest open layer closes first. Back never skips a layer.

## Common Mistakes

- **Too many items in top nav** → items overflow or wrap → use a sidebar instead
- **Hamburger on desktop** → kills discoverability → use persistent navigation
- **Breadcrumbs as primary nav on mobile** → no one uses them → use a back arrow + page title
- **No current-location indicator** → user feels lost → always highlight "you are here"
