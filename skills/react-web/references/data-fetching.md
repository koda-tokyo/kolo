# Data Fetching Patterns

> **Skill:** react-web | **Stack:** Next.js 15, React 19, TanStack Query v5

## Which Fetching Strategy to Use

| Strategy | When | Example |
|---|---|---|
| **Server Component fetch** | Data needed at render time, no interactivity | Product listing, blog post |
| **Server Actions** | Mutations (create/update/delete) from forms | Contact form, profile update |
| **Route Handlers** | External webhooks, 3rd-party API proxy | Stripe webhook, file upload |
| **TanStack Query** | Client-side data with reactivity | Real-time feed, autocomplete |
| **React cache()** | Deduplicate DB calls across components in same render | Any multi-component page |

## Pattern 1: Server Component Direct Fetch

```tsx
// app/posts/page.tsx — no 'use client' needed
async function getPosts() {
  const res = await fetch('https://api.example.com/posts', {
    next: { revalidate: 3600 }, // ISR: refresh every hour
    // next: { tags: ['posts'] }, // For on-demand revalidation
  });

  if (!res.ok) throw new Error('Failed to fetch posts');
  return res.json();
}

export default async function PostsPage() {
  const posts = await getPosts();

  return (
    <ul>
      {posts.map((post: Post) => (
        <li key={post.id}>{post.title}</li>
      ))}
    </ul>
  );
}
```

### Direct Database Access (Prisma/Drizzle)

```tsx
// No API route needed — Server Components can query DB directly
import { db } from '@/lib/db';

async function getDashboardData(userId: string) {
  const [profile, recentOrders, stats] = await Promise.all([
    db.user.findUnique({ where: { id: userId } }),
    db.order.findMany({ where: { userId }, take: 5, orderBy: { createdAt: 'desc' } }),
    db.$queryRaw`SELECT count(*), sum(total) FROM orders WHERE user_id = ${userId}`,
  ]);

  return { profile, recentOrders, stats };
}
```

## Pattern 2: Server Actions (Mutations)

```tsx
// app/actions/posts.ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

const createPostSchema = z.object({
  title: z.string().min(3).max(200),
  content: z.string().min(10),
  published: z.boolean().default(false),
});

export async function createPost(formData: FormData) {
  const raw = Object.fromEntries(formData);
  const parsed = createPostSchema.safeParse({
    ...raw,
    published: raw.published === 'on',
  });

  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  try {
    const post = await db.post.create({ data: parsed.data });
    revalidatePath('/posts');      // Invalidate the posts list cache
    redirect(`/posts/${post.id}`); // Redirect to new post (throws NEXT_REDIRECT internally)
  } catch {
    return { error: { _form: 'Failed to create post' } };
  }
}

// Usage in Client Component
'use client';
import { createPost } from '@/actions/posts';
import { useActionState } from 'react'; // React 19

export function CreatePostForm() {
  const [state, formAction, isPending] = useActionState(createPost, null);

  return (
    <form action={formAction}>
      <input name="title" required />
      {state?.error?.title && <p className="text-red-500">{state.error.title}</p>}
      <textarea name="content" required />
      <button type="submit" disabled={isPending}>
        {isPending ? 'Creating...' : 'Create Post'}
      </button>
    </form>
  );
}
```

## Pattern 3: Route Handlers (External APIs + Webhooks)

```ts
// app/api/upload/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get('file') as File;

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  const blob = await put(file.name, file, { access: 'public' });

  return NextResponse.json({ url: blob.url });
}
```

## Pattern 4: TanStack Query (Client-Side)

```tsx
// lib/query-client.ts
import { QueryClient } from '@tanstack/react-query';

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,       // Data is fresh for 1 minute
        gcTime: 5 * 60 * 1000,       // Cache garbage collection: 5 minutes
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}

// hooks/use-posts.ts
'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

async function fetchPosts() {
  const res = await fetch('/api/posts');
  if (!res.ok) throw new Error('Failed to fetch');
  return res.json();
}

export function usePosts() {
  return useQuery({
    queryKey: ['posts'],
    queryFn: fetchPosts,
  });
}

export function useCreatePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreatePost) => {
      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to create');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] });
    },
  });
}
```

## Optimistic Updates

```tsx
// Using TanStack Query's built-in optimistic updates
const mutation = useMutation({
  mutationFn: toggleTodo,
  onMutate: async (todoId) => {
    // Cancel outgoing refetches
    await queryClient.cancelQueries({ queryKey: ['todos'] });

    // Snapshot previous value
    const previousTodos = queryClient.getQueryData(['todos']);

    // Optimistically update
    queryClient.setQueryData(['todos'], (old: Todo[]) =>
      old.map(t => t.id === todoId ? { ...t, completed: !t.completed } : t)
    );

    return { previousTodos }; // Rollback context
  },
  onError: (_err, _todoId, context) => {
    // Rollback on error
    queryClient.setQueryData(['todos'], context?.previousTodos);
    toast.error('Failed to update todo');
  },
  onSettled: () => {
    // Always refetch to sync with server
    queryClient.invalidateQueries({ queryKey: ['todos'] });
  },
});
```

## Caching Strategy

```
┌─────────────────────────────────────────────────┐
│  Full Route Cache (static HTML)                 │
│  → Rebuild on next deploy unless revalidated     │
├─────────────────────────────────────────────────┤
│  Data Cache (fetch() results)                   │
│  → revalidate: 3600 | tags: ['posts']            │
├─────────────────────────────────────────────────┤
│  React cache() (per-request dedup)              │
│  → Same args = same result within one render     │
├─────────────────────────────────────────────────┤
│  TanStack Query Cache (client-side)             │
│  → staleTime, gcTime, manual invalidation        │
└─────────────────────────────────────────────────┘
```

### React cache() for Deduplication

```tsx
// lib/data.ts
import { cache } from 'react';

// Without cache(): each component that calls getUser(userId)
// fires a separate DB query
// With cache(): same userId returns memoized promise
export const getUser = cache(async (userId: string) => {
  console.log('DB query for user:', userId); // Only logs once per request
  return db.user.findUnique({ where: { id: userId } });
});
```

## Error Handling Patterns

```tsx
// Async Server Component with error handling
export default async function ProductPage({ params }: { params: { id: string } }) {
  try {
    const product = await getProduct(params.id);
    if (!product) notFound(); // Triggers not-found.tsx
    return <ProductDetail product={product} />;
  } catch (error) {
    // Caught by error.tsx boundary
    throw new Error(`Failed to load product ${params.id}`);
  }
}

// Client-side with TanStack Query
const { data, error, isLoading } = useQuery({
  queryKey: ['product', id],
  queryFn: () => fetchProduct(id),
});

if (isLoading) return <Skeleton />;
if (error) return <ErrorState message={error.message} onRetry={() => refetch()} />;
return <ProductDetail product={data} />;
```

## Gotchas

1. **Waterfall requests** — fetch sequentially, render blocks on slowest. Fix with `Promise.all()` at the top of your component.
2. **Over-fetching in Server Components** — every component that `await`s a DB call adds latency. Use `cache()` to deduplicate.
3. **Client components can't use `async/await`** — use TanStack Query or SWR instead.
4. **`redirect()` throws an error internally** — don't wrap it in try/catch (it's implemented via `NEXT_REDIRECT`, which you should let propagate).
5. **`revalidatePath` only works for paths rendered on the server.** It won't refresh client-side Query caches.
6. **Don't mix `fetch()` for external APIs with `cache()`** — `cache()` is for same-request deduplication of any async function. `fetch()` caching (tags, revalidate) is a Next.js feature.
