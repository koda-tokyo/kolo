# Frontend Architecture — Engineering Mastery

## The Rendering Mindset

Frontend engineering is not "making things look right." It is orchestrating: network, parsing, rendering, layout, paint, composition, and interaction — all within a 16ms budget per frame (60fps).

### The Critical Rendering Path
```
HTML → DOM Tree
CSS  → CSSOM Tree
       ↓
    Render Tree
       ↓
    Layout (positions everything)
       ↓
    Paint (fills pixels)
       ↓
    Composite (layers together)
       ↓
    SCREEN (16ms deadline per frame)
```

**The optimization hierarchy:**
1. **Avoid work entirely** (don't render what isn't visible)
2. **Do work once** (cache, memoize)
3. **Do work in parallel** (workers, async)
4. **Do work faster** (optimized algorithms)
5. **Do work later** (defer, lazy load)

---

## Core Web Vitals — The Performance Trinity

### LCP (Largest Contentful Paint) — Loading
**Target:** < 2.5 seconds
**What it measures:** When the largest content element becomes visible. This is when the user perceives the page as "loaded."

**Optimization:**
- Server-render critical content (Next.js RSC, streaming SSR)
- Preload LCP image: `<link rel="preload" as="image" href="hero.jpg">`
- Minimize render-blocking resources (CSS, sync JS)
- Use CDN with edge caching

### INP (Interaction to Next Paint) — Responsiveness
**Target:** < 200ms
**What it measures:** Time from user interaction to next visual update. This is when the user perceives the page as "responsive."

**Optimization:**
- Break up long tasks (yield to main thread every 50ms)
- Use `requestIdleCallback` for non-critical work
- Debounce/throttle high-frequency events (scroll, resize, input)
- Offload computation to Web Workers

### CLS (Cumulative Layout Shift) — Visual Stability
**Target:** < 0.1
**What it measures:** How much the page layout shifts during loading. This is when the user perceives the page as "stable."

**Optimization:**
- Set explicit dimensions on all media (images, videos, embeds)
- Reserve space for dynamic content (skeleton loaders)
- Never insert content above existing content (ads, banners)
- Font loading: use `font-display: optional` or `swap` with size-adjust

---

## Rendering Architectures

### SSR (Server-Side Rendering)
```
Server renders HTML → Browser displays immediately → JS hydrates for interactivity
```
**When:** Content-heavy, SEO-critical, fast first paint needed.
**Cost:** Server CPU time. Hydration delay (page looks ready but isn't interactive).

### CSR (Client-Side Rendering)
```
Browser downloads JS → JS renders HTML → Page becomes visible
```
**When:** App-like experiences, authenticated dashboards, SPAs.
**Cost:** Slow first paint (blank page while JS loads). Poor SEO.

### Static Generation
```
Build time renders HTML → CDN serves static files → JS hydrates for interactivity
```
**When:** Content that doesn't change per-request (marketing pages, blogs, docs).
**Cost:** Build time. Can't personalize per-request without client-side augmentation.

### ISR (Incremental Static Regeneration)
```
Static pages + selective re-rendering at runtime
```
**When:** Mostly static content with occasional updates (product pages, article pages).

### Streaming SSR (React 18+ / Next.js App Router)
```
Server sends HTML in chunks as it's ready → Browser renders progressively
```
**When:** Pages with slow data dependencies. Fast shell renders immediately, slow content fills in.
**Key pattern:** `<Suspense>` boundaries. Wrap slow components, fast components render immediately.

### Partial Prerendering (Next.js 14+)
```
Static shell (instant) + dynamic holes (streamed in)
```
**When:** Hybrid pages — mostly static but with dynamic components (shopping cart count, user avatar).

---

## State Architecture

### The Five Types of State
1. **URL/Route state:** What page/view is the user on? (Next.js App Router params, searchParams). Serializable. Shareable.
2. **Server state:** What's the source of truth? (database, API). Async. Potentially stale. Owned by TanStack Query / SWR.
3. **Form state:** What's the user entering? (input values, validation). Ephemeral. Undo-able until submit.
4. **UI state:** What's the interface showing? (modal open, tab selected, sidebar expanded). Local. Not persisted by default.
5. **Client cache:** What's been fetched from the server? (derived from server state). Stale after TTL.

**Rule:** Keep state as close to where it's used as possible. URL state > server cache > component state > global state.

### State Machines (XState / Robot / Native)
For complex UI logic, state machines beat boolean flags:

```
Boolean-flag hell:
isLoading, isError, isEmpty, isEditing, isSaving, isDirty, isValid
→ 2^7 = 128 possible states, most invalid

State machine:
idle → loading → { loaded | empty | error }
loaded → editing → saving → loaded
error → retry → loading
→ 5 valid states, all transitions explicit
```

**When to use state machines:**
- Multi-step forms/wizards
- Authentication flows
- Media players
- Complex async flows with retry/error/recovery
- Any UI with more than 3 boolean flags interacting

---

## Cross-Platform Architecture

### The Shared-Code Spectrum
```
Fully shared                Split per platform            Fully separate
    |                              |                            |
  React Native Web          Shared logic only          Native Android/iOS
  (one codebase)            (business logic shared)    (separate teams)
```

### Architecture Patterns for Multi-Platform

**Pattern A: Monorepo with Platform Packages**
```
packages/
├── shared-core/        ← Types, utils, API client, business logic
├── shared-ui/          ← Shared components (Button, Input) if web+mobile similar
├── web/                ← react-web (Next.js)
└── mobile/             ← react-native-mobile (Expo)
```

**Pattern B: Single Codebase with Platform Extensions**
```
src/
├── components/
│   ├── Button.tsx      ← Platform-agnostic
│   ├── Button.web.tsx  ← Web-specific override
│   └── Button.native.tsx ← Mobile-specific override
```

**Pattern C: Design Tokens as Cross-Platform Source of Truth**
```
tokens/
├── tokens.json         ← Single source of truth (Style Dictionary format)
├── web.css             ← Generated: Tailwind @theme
├── mobile.js           ← Generated: NativeWind theme
├── ios.swift           ← Generated: SwiftUI colors
└── android.xml         ← Generated: Android resources
```

---

## Performance Patterns

### Optimistic UI
Update the UI BEFORE the server confirms. If the server rejects, roll back.
```
User clicks "like" → Heart fills red immediately → API call in background
  ├── Success: nothing to do
  └── Failure: unfill heart, show error toast
```

**When:** High-confidence operations (like, bookmark, mark-read). Low stakes.
**Never:** Financial transactions, destructive actions, medical decisions.

### Virtualization (Windowing)
Only render what's visible in the viewport:
- `react-window` / `react-virtuoso` / TanStack Virtual
- For lists > 50 items, virtualization is mandatory
- For lists > 1000 items, also virtualize the data (pagination, infinite scroll)

### Data Prefetching
Load data before the user asks for it:
- Prefetch on hover: load detail page data when user hovers over a link
- Prefetch on visibility: load next page data when user is near the bottom
- Prefetch on prediction: ML predicts likely next action, prefetch early

### Image Strategy
```
Unoptimized: <img src="hero-4000px.jpg">  ← 4MB download on mobile
Optimized:   <Image src="hero" width={800} height={600} 
              sizes="(max-width: 768px) 100vw, 800px"
              placeholder="blur" priority />
             ← Auto-generates: hero-400w.webp, hero-800w.webp, hero-1200w.webp
             ← Serves correct size for device
             ← Blur placeholder during load
             ← Priority preload for LCP
```

---

## The Frontend Engineering Mindset

### Ship incrementally
Not: "build the whole thing and launch."
But: "ship the smallest useful piece, measure, iterate."
- Feature flags for incomplete work
- Dark launches (deploy with 0% traffic, ramp up)
- Canary releases (1% → 10% → 50% → 100%)

### Measure everything
- Real User Monitoring (RUM): Core Web Vitals from actual users
- Error tracking: Sentry, LogRocket, Datadog
- Analytics: user flows, drop-off points, feature adoption
- Bundle analysis: what's taking up space?

### Design for failure
- Offline: gracefully degrade when network is lost
- Slow: progressive loading when on 3G
- Error: clear error states with recovery actions
- Empty: helpful empty states, not dead ends
- Timeout: cancel long-running operations, offer retry

### The performance budget
Set limits and enforce them with CI:
- JavaScript bundle: < 200KB (compressed) for initial load
- CSS: < 50KB (compressed)
- Images: < 100KB for above-fold images
- Fonts: < 100KB total
- Time to Interactive: < 3.5s on 3G
- Lighthouse score: > 90 Performance, > 90 Accessibility
