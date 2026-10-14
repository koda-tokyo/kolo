# Mobile UX Patterns

> **Rule of thumb**: Design mobile-first. If it works on a 320px-wide screen with one thumb, it works everywhere.

## Touch Targets

### Size Requirements

- **Minimum**: 44×44px (Apple HIG) or 48×48dp (Material Design) — use **48×48px** as the safe minimum
- **Recommended**: 48×48px with at least 8px spacing between adjacent targets
- **Inline links in text**: At least 28px tall (harder to enforce, but line-height helps)

**Do**: Make the tap area larger than the visual element if needed. Use padding, not margin, to extend the hit region.

**Don't**: Use 24px icon buttons — they're impossible to tap accurately. If the icon is small, wrap it in a 48×48 invisible tap zone.

### Thumb Zone (One-Handed Use)

The screen divides into three zones when held in one hand:

| Zone | Reachability | Place Here |
|---|---|---|
| **Green (bottom half)** | Easy, natural | Primary actions, navigation, frequently tapped elements |
| **Amber (middle)** | Requires stretch | Content, secondary actions |
| **Red (top)** | Requires grip adjustment | Display-only info, rarely-used actions |

**Do**:
- Place primary CTAs and bottom tabs in the green zone
- Put navigation controls at the bottom of the screen (tab bar, not hamburger in top-left)
- On larger phones (6"+), consider reachability — Apple's "Reachability" feature exists for a reason

## Gestures

### Standard Gesture Set

| Gesture | iOS | Android | Use For |
|---|---|---|---|
| Tap | ✓ | ✓ | Primary action |
| Long-press | ✓ (context menu, preview) | ✓ (context menu) | Secondary actions, preview |
| Swipe left on list item | ✓ (action) | Not native (use ⋮ menu) | Delete, archive, more |
| Swipe right on list item | ✓ (back nav edge) | ✓ (back nav) | System back |
| Swipe down | ✓ (dismiss sheet, refresh) | ✓ (refresh) | Dismiss, refresh |
| Pinch-to-zoom | ✓ | ✓ | Images, maps |
| Two-finger swipe | Not standard | Not standard | Avoid — undiscoverable |

**Do**: Follow platform conventions. iOS users expect swipe-to-delete. Android users expect long-press for context menus. Don't swap them.

**Don't**: Override system gestures (edge swipe for back navigation, swipe up for home, swipe down for notifications).

### Haptic Feedback

**Do**:
- Light haptic on successful actions (toggle on, item saved)
- Strong haptic on errors or destructive action confirmation
- Haptic on pull-to-refresh threshold reached
- Haptic on long-press activation

**Don't**: Haptic for every tap — it's noise. Use sparingly: 2-3 haptic moments per screen max.

## Bottom Sheets vs Modals vs New Screens

| Pattern | When | Example |
|---|---|---|
| **Bottom Sheet** | Quick action, supplementary info, doesn't require full context | Share sheet, picker, filter options |
| **Modal (Centered)** | Important decision, needs full attention, confirm/cancel | Confirm delete, sign-in prompt |
| **New Screen** | Complex workflow, needs back navigation, part of a flow | Settings page, create new item |

**Bottom sheet rules**:
- Draggable handle at top
- Swipe down or tap backdrop to dismiss
- Max height: 50-70% of screen (don't go full-screen unless it's a map or media)
- Don't nest scrolling sheets — if you need another sheet, push a new screen instead

## Safe Areas

Account for hardware elements that overlap your layout:

| Element | iOS | Android |
|---|---|---|
| Notch / Dynamic Island | `safe-area-inset-top` | `statusBarHeight` |
| Home Indicator | `safe-area-inset-bottom` | `navigationBarHeight` (gesture nav) |
| Rounded corners | `safe-area-inset-*` handles this | Handle with corner radius awareness |

**Do**:
- Use `env(safe-area-inset-*)` in CSS or `SafeAreaView` in React Native
- Extend background colours into safe areas so there are no white bars
- Keep interactive elements out of the home indicator zone (bottom ~34px on iOS)

**Don't**: Hard-code padding values — safe area sizes vary between devices.

## Orientation

**Do**:
- Support portrait as the primary orientation
- Support landscape for media consumption (video, images) and data input (spreadsheets)
- Lock to portrait for flows that break in landscape (onboarding, forms with image previews)

**Don't**: Force landscape for the entire app unless it's a game or video player.

## Keyboard Avoidance

When the keyboard opens:
- Scroll the focused input into view
- Don't hide the input behind the keyboard
- iOS: Use `KeyboardAvoidingView` or `react-native-keyboard-aware-scroll-view`
- Android: Usually handled by `adjustResize` in the manifest

**Do**: Keep the submit/send button above the keyboard (accessory view on iOS, fixed bar on Android).

**Don't**: Leave inputs hidden behind the keyboard — user can't see what they're typing.

## Platform Conventions

| Pattern | iOS | Android |
|---|---|---|
| Back navigation | Swipe from left edge OR top-left arrow | System back button OR top-left arrow |
| Destructive actions | Red text in action sheet | Red text in dialog |
| Tab navigation | Bottom tab bar (translucent) | Bottom nav bar (elevated) |
| Settings gear | Top-right | In overflow menu (⋮) |
| Pull-to-refresh | Native, expected | Supported but less common than Refresh button |
| Date picker | Wheel picker | Calendar picker |
| Confirm action | Swipe left on item | Long-press → menu |
| Share | System share sheet | System share sheet |

**Do**: Test on both platforms. A design that looks great on iOS may feel "wrong" on Android, and vice versa.

## Mobile-First Process

1. **Design for 320px wide first** (smallest still-in-use phone: iPhone SE)
2. Get the core flow working for one thumb
3. Add complexity for larger screens as enhancements, not requirements
4. Test on a real device, not just the simulator — touch targets feel different with a real finger

**The mobile-first litmus test**: Can a distracted user, on a moving train, holding their phone in one hand, complete the primary task without frustration? If no, simplify.
