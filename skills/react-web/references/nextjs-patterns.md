# Next.js 15 App Router Patterns

> **Skill:** react-web | **Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS v4

## File System Conventions

### Special Files (in order of rendering precedence)

```
src/app/
├── layout.tsx          # Root layout — wraps all pages (required)
├── page.tsx            # Route UI — becomes the page content
├── loading.tsx         # Suspense boundary wrapper shown while page loads
├── error.tsx           # Error boundary wrapper (must be Client Component)
├── not-found.tsx       # 404 UI for the segment
├── global-error.tsx    # Error boundary for root layout (catch-all)
├── route.ts            # API route handler (mutually exclusive with page.tsx)
├── template.tsx        # Like layout but re-mounts on navigation (for animations)
└── default.tsx         # Parallel route fallback
```

**Key rule:** `layout.tsx` persists across navigations. `template.tsx` re-mounts. Use `template` when you need to re-run effects (animations, scroll restoration, analytics page-view tracking).

### Route Groups (parentheses)

```
src/app/
├── (marketing)/
│   ├── layout.tsx      # Marketing-specific layout (different header/footer)
│   ├── page.tsx        # Landing page at /
│   └── pricing/
│       └── page.tsx    # /pricing
└── (dashboard)/
    ├── layout.tsx      # Dashboard layout (sidebar + topbar)
    └── analytics/
        └── page.tsx    # /analytics
```

Route groups let you share layouts without affecting the URL. Perfect for auth walls vs. public pages.

### Dynamic Routes

```
src/app/
├── blog/
│   ├── [slug]/
│   │   └── page.tsx    # /blog/post-title
│   └── [...catchAll]/  # /blog/a/b/c
│       └── page.tsx
└── shop/
    └── [[...slug]]/    # /shop (optional catch-all — matches /shop too)
        └── page.tsx
```

### Parallel Routes & Intercepting Routes

```tsx
// Parallel routes — render two slots in one layout
// layout.tsx
export default function Layout({ children, analytics, metrics }: {
  children: React.ReactNode;
  analytics: React.ReactNode;
  metrics: React.ReactNode;
}) {
  return (
    <>
      {children}
      {analytics}
      {metrics}
    </>
  );
}

// Intercepting route: (.)photo captures navigation from same level
// src/app/feed/(.)photo/[id]/page.tsx — renders modal when navigating from feed
// src/app/photo/[id]/page.tsx — full page when navigating directly or refreshing
```

## Server Components vs. Client Components

In Next.js 15 + React 19, **all components are Server Components by default**.

### When to Add 'use client'

```tsx
// ADD 'use client' when you need:
// 1. Event handlers (onClick, onChange, onSubmit)
// 2. State & effects (useState, useEffect, useReducer)
// 3. Browser-only APIs (localStorage, navigator, window)
// 4. Custom hooks that use any of the above
// 5. React context (createContext, useContext)
// 6. Client-side data fetching (TanStack Query, SWR)

'use client';

import { useState } from 'react';

export function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}
```

### The Composition Pattern (most important)

**Push 'use client' as deep as possible.** Keep the boundary close to where interactivity lives:

```tsx
// ✅ GOOD: Interactive island pattern
// page.tsx (Server Component)
import { SearchBar } from './search-bar';       // Client
import { ResultsTable } from './results-table'; // Server
import { ThemeToggle } from './theme-toggle';   // Client

export default async function Page() {
  const data = await db.query('SELECT ...');   // Server-only code

  return (
    <div>
      <SearchBar />        {/* Interactive island */}
      <ResultsTable data={data} />
      <ThemeToggle />       {/* Interactive island */}
    </div>
  );
}
```

### Server Components Can Pass Server Data to Client Components

```tsx
// Page (Server Component)
import { ProductCard } from './product-card'; // Client Component

export default async function Page() {
  const products = await db.product.findMany();

  return (
    <div className="grid grid-cols-3 gap-4">
      {products.map(p => (
        <ProductCard key={p.id} product={p} />
      ))}
    </div>
  );
}

// ProductCard (Client Component)
'use client';
import { useCart } from '@/hooks/use-cart';

export function ProductCard({ product }: { product: SerializedProduct }) {
  const { addItem } = useCart();
  return (
    <div className="rounded-lg border p-4">
      <h3>{product.name}</h3>
      <button onClick={() => addItem(product.id)}>Add to Cart</button>
    </div>
  );
}
```

## Server Actions

Server Actions are async functions that run on the server but can be called from Client Components.

```tsx
// app/actions/subscribe.ts
'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

const schema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
});

export async function subscribe(formData: FormData) {
  const parsed = schema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  await db.subscriber.create({ data: parsed.data });
  revalidatePath('/newsletter');
  redirect('/thanks');
}

// usage in Client Component
'use client';
import { subscribe } from '@/actions/subscribe';

export function NewsletterForm() {
  return (
    <form action={subscribe}>
      <input name="email" type="email" required />
      <input name="name" type="text" required />
      <button type="submit">Subscribe</button>
    </form>
  );
}
```

### Server Action Patterns

- **`revalidatePath()`** — purge and re-render a route's cache
- **`revalidateTag()`** — purge all fetch calls tagged with a specific tag
- **`redirect()`** — server-side redirect (throws an error internally)
- **Return plain objects** — Dates, Maps, and non-serializable data will fail silently

## Metadata API

```tsx
import type { Metadata } from 'next';

// Static metadata
export const metadata: Metadata = {
  title: 'My App',
  description: 'Built with Next.js 15',
  openGraph: {
    images: ['/og-image.png'],
  },
};

// Dynamic metadata (access route params)
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = await db.post.findUnique({ where: { slug: params.slug } });

  return {
    title: post.title,
    description: post.excerpt,
    openGraph: {
      images: [post.ogImage],
    },
  };
}
```

## Route Handlers (API Routes)

```ts
// app/api/webhooks/stripe/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  try {
    const event = stripe.webhooks.constructEvent(body, signature!, secret);
    // handle event...
    return NextResponse.json({ received: true });
  } catch (err) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }
}

// Route Segment Config
export const dynamic = 'force-dynamic';      // Don't cache
export const revalidate = 3600;              // ISR: revalidate every hour
export const runtime = 'edge';               // Run on Edge runtime (limitations apply)
export const preferredRegion = 'iad1';       // Pin to specific region
```

## Middleware

```ts
// middleware.ts (root of project, not in src/app)
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const token = request.cookies.get('session');

  // Protect routes
  if (request.nextUrl.pathname.startsWith('/dashboard') && !token) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/admin/:path*'],
  // matcher: '/((?!api|_next/static|_next/image|favicon.ico).*)', // all except...
};
```

## Caching & ISR

```tsx
// Time-based revalidation
export const revalidate = 60; // Revalidate every 60 seconds

// On-demand revalidation
// app/api/revalidate/route.ts
import { revalidateTag, revalidatePath } from 'next/cache';

export async function POST(request: NextRequest) {
  const { tag } = await request.json();
  revalidateTag(tag);
  return NextResponse.json({ revalidated: true });
}

// Tag-based caching with fetch
const data = await fetch('https://api.example.com/posts', {
  next: { tags: ['posts'] },
});
```

## Gotchas

1. **`layout.tsx` does NOT re-render on navigation.** State persists. If you need a fresh mount per navigation, use `template.tsx`.
2. **Server Actions return values must be serializable.** No Dates, Maps, Sets, or class instances.
3. **`'use server'` at top of a file makes ALL exports server actions.** Only do this in `/app/actions/` files.
4. **Route handlers and pages cannot coexist in same segment.** `route.ts` and `page.tsx` at same level = conflict.
5. **Middleware runs on Edge runtime.** No Node.js APIs (no `fs`, `crypto` without Web Crypto subset).
6. **`cookies()` and `headers()` in Server Components** are dynamic — the page won't be statically rendered at build time. Use them deliberately.
