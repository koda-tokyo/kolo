# React Server Components (RSC) Patterns

> **Skill:** react-web | **Stack:** React 19, Next.js 15, Server Components

## Mental Model: Server vs. Client Components

| Server Components | Client Components |
|---|---|
| Never sent to browser | Shipped as JavaScript bundle |
| Can access server resources directly (DB, filesystem, secrets) | Cannot access server resources |
| No interactivity (no useState, useEffect, event handlers) | Fully interactive |
| Can import Client Components | Cannot import Server Components |
| Async by default (can be `async function`) | Must be synchronous (can't be async) |
| Default in Next.js 15 | Must add `'use client'` directive |
| Sequential data fetching (await in component body) | Parallel data fetching (TanStack Query, useEffect) |
| Render once on server | Render on server (SSR) + client (hydration) |

## Decision Tree: When to Use Which

```
Component needs interactivity? (onClick, useState, useEffect)
├── YES → Client Component
└── NO  → Does it need server resources? (DB, fs, secrets)
           ├── YES → Server Component
           └── NO  → Does it have children that are Client Components?
                      ├── YES → Server Component (composition pattern)
                      └── NO  → Either works. Default to Server Component.
```

## Data Fetching in Server Components

This is the primary advantage of RSC — fetch data directly in components:

```tsx
// app/products/page.tsx — Server Component (no 'use client')
import { db } from '@/lib/db';
import { ProductCard } from './product-card'; // Client Component

export default async function ProductsPage() {
  // Direct DB access — no API route needed
  const products = await db.product.findMany({
    where: { published: true },
    include: { category: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {products.map(product => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}
```

### Parallel Data Fetching

```tsx
// Sequential (waterfall) — 🐌 slow
const user = await db.user.findUnique({ where: { id } });
const posts = await db.post.findMany({ where: { authorId: user.id } });
const comments = await db.comment.findMany({ where: { authorId: user.id } });

// Parallel — ⚡ fast
const [user, posts, comments] = await Promise.all([
  db.user.findUnique({ where: { id } }),
  db.post.findMany({ where: { authorId: id } }),
  db.comment.findMany({ where: { authorId: id } }),
]);
```

### Preloading Pattern (mitigates waterfall in nested components)

```tsx
// lib/data.ts
import { cache } from 'react';

export const getUser = cache(async (id: string) => {
  return db.user.findUnique({ where: { id } });
});

// app/users/[id]/page.tsx
import { getUser } from '@/lib/data';
import UserPosts from './posts';
import UserComments from './comments';

export default async function UserPage({ params }: { params: { id: string } }) {
  // Start fetching before rendering children
  const userPromise = getUser(params.id);

  return (
    <div>
      <UserInfo userPromise={userPromise} />
      {/* These won't re-fetch if they call getUser with same id */}
      <UserPosts userId={params.id} />
      <UserComments userId={params.id} />
    </div>
  );
}
```

## Suspense & Streaming

```tsx
import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

// Page shell renders immediately, data streams in
export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Dashboard</h1>

      {/* Each section loads independently */}
      <Suspense fallback={<StatsSkeleton />}>
        <StatsSection />
      </Suspense>

      <Suspense fallback={<ChartSkeleton />}>
        <RevenueChart />
      </Suspense>

      <Suspense fallback={<TableSkeleton />}>
        <RecentOrders />
      </Suspense>
    </div>
  );
}

// Each async component fetches its own data
async function StatsSection() {
  const stats = await db.getDashboardStats(); // Slow query
  return <StatsCards stats={stats} />;
}
```

### The `use()` Hook (React 19)

```tsx
'use client';

import { use } from 'react';

// Client components can unwrap promises passed from server
export function ProductDetails({ productPromise }: {
  productPromise: Promise<Product>;
}) {
  const product = use(productPromise); // Suspends until resolved

  const [quantity, setQuantity] = useState(1);

  return (
    <div>
      <h2>{product.name}</h2>
      <p>{product.description}</p>
      <input
        type="number"
        value={quantity}
        onChange={e => setQuantity(Number(e.target.value))}
      />
    </div>
  );
}
```

## Partial Prerendering (PPR) — Experimental

```tsx
// next.config.ts
const nextConfig = {
  experimental: {
    ppr: true,
  },
};

// app/page.tsx
import { Suspense } from 'react';

// Static shell is pre-rendered at build time
export default function Page() {
  return (
    <div>
      <Header /> {/* Static — pre-rendered */}
      <Suspense fallback={<Skeleton />}>
        <DynamicRecommendations /> {/* Dynamic — streamed */}
      </Suspense>
    </div>
  );
}
```

## `use server` vs. `use client` Directives

```tsx
// ❌ DON'T mix directives in same file
'use server';
'use client'; // Invalid

// ✅ DO: separate files
// actions/user.ts
'use server';
export async function updateUser(id: string, data: FormData) { ... }

// components/user-form.tsx
'use client';
import { updateUser } from '@/actions/user';
export function UserForm() { ... }
```

## The Boundary Rules

1. **Client Components CAN import other Client Components.**
2. **Client Components CANNOT import Server Components** (they'd try to bundle server code). But they CAN receive Server Components as children via props.
3. **Server Components CAN import both Server and Client Components.**
4. **'use server' files** (Server Actions) are not components — they're functions callable from Client Components.

```tsx
// ✅ Pattern: Server Component wraps Client Component with children
// app/layout.tsx (Server Component)
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <ClientProviders>
          {children} {/* These can be Server Components! */}
        </ClientProviders>
      </body>
    </html>
  );
}

// ✅ Pattern: Passing Server Components as children to Client Components
// page.tsx (Server Component)
import { InteractivePanel } from './interactive-panel'; // Client

export default function Page() {
  return (
    <InteractivePanel>
      <ServerFetchedContent /> {/* Server Component as child — works! */}
    </InteractivePanel>
  );
}

// interactive-panel.tsx (Client Component)
'use client';
export function InteractivePanel({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className={collapsed ? 'w-16' : 'w-64'}>
      <button onClick={() => setCollapsed(!collapsed)}>Toggle</button>
      {children} {/* Server components render fine here */}
    </div>
  );
}
```

## Gotchas

1. **"Cannot import Server Component in Client Component"** — the fix is almost always the composition pattern (pass as children or props).
2. **Suspense boundaries are your pagination.** Don't wrap everything in one Suspense — split by section to avoid blocking the entire page.
3. **Server Components can't use React Context.** Context requires `'use client'`. For sharing data, use `cache()` or pass data as props.
4. **`Date` objects from Server to Client Components** — they're serialized to strings. Deserialize on the client or use `toISOString()` before passing.
5. **Streaming is automatic** — you don't need to do anything special. When a Server Component uses `async/await`, Next.js streams the page. You only need Suspense to define fallback states.
6. **PPR is experimental** and changes the build output. Test thoroughly before deploying to production.
