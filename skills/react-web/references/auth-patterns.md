# Auth Patterns (Auth.js v5 / NextAuth)

> **Skill:** react-web | **Stack:** Auth.js v5, Next.js 15, Drizzle ORM

## Setup: Auth.js v5 in Next.js 15

```bash
npm install next-auth@beta @auth/drizzle-adapter
```

```ts
// auth.ts — root of the project
import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { db } from '@/lib/db';
import { compare } from 'bcrypt-ts';

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db),
  session: { strategy: 'jwt' }, // JWT for edge compatibility; 'database' for DB sessions
  pages: {
    signIn: '/login',
    error: '/auth/error',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
      }
      return session;
    },
  },
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID!,
      clientSecret: process.env.AUTH_GITHUB_SECRET!,
    }),
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    }),
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const user = await db.query.users.findFirst({
          where: (users, { eq }) => eq(users.email, credentials.email as string),
        });

        if (!user || !user.passwordHash) return null;

        const valid = await compare(
          credentials.password as string,
          user.passwordHash,
        );

        if (!valid) return null;
        return { id: user.id, email: user.email, name: user.name, role: user.role };
      },
    }),
  ],
});
```

## API Route Handler

```ts
// app/api/auth/[...nextauth]/route.ts
import { handlers } from '@/auth';
export const { GET, POST } = handlers;
```

## Middleware Protection

```ts
// middleware.ts
import { auth } from '@/auth';
import { NextResponse } from 'next/server';

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isAuthenticated = !!req.auth;
  const userRole = req.auth?.user?.role;

  // Redirect unauthenticated users
  if (!isAuthenticated && pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  // Role-based access
  if (pathname.startsWith('/admin') && userRole !== 'admin') {
    return NextResponse.redirect(new URL('/unauthorized', req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/dashboard/:path*', '/admin/:path*', '/api/protected/:path*'],
};
```

## Session Access

### Server Component (preferred)

```tsx
// app/dashboard/page.tsx
import { auth } from '@/auth';
import { redirect } from 'next/navigation';

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user) {
    redirect('/login');
  }

  return (
    <div>
      <h1>Welcome, {session.user.name}</h1>
      <p>Role: {session.user.role}</p>
    </div>
  );
}
```

### Client Component

```tsx
'use client';

import { useSession } from 'next-auth/react';

export function UserMenu() {
  const { data: session, status } = useSession();

  if (status === 'loading') return <Skeleton className="h-8 w-8 rounded-full" />;
  if (!session?.user) return <LoginButton />;

  return (
    <div>
      <span>{session.user.name}</span>
      <SignOutButton />
    </div>
  );
}
```

### API Route

```ts
import { auth } from '@/auth';
import { NextResponse } from 'next/server';

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ user: session.user });
}
```

## Role-Based Access Control (RBAC)

```ts
// lib/rbac.ts
export type Role = 'user' | 'editor' | 'admin';

const permissions = {
  'post:create': ['editor', 'admin'],
  'post:delete': ['admin'],
  'user:manage': ['admin'],
  'settings:edit': ['admin'],
} as const;

type Permission = keyof typeof permissions;

export function hasPermission(role: Role | undefined, permission: Permission): boolean {
  if (!role) return false;
  return permissions[permission].includes(role);
}

// Usage in Server Actions
'use server';
import { auth } from '@/auth';
import { hasPermission } from '@/lib/rbac';

export async function deletePost(postId: string) {
  const session = await auth();
  if (!hasPermission(session?.user?.role as Role, 'post:delete')) {
    throw new Error('Unauthorized');
  }
  await db.post.delete({ where: { id: postId } });
}
```

### Auth Guard Component

```tsx
// components/auth-guard.tsx
import { auth } from '@/auth';
import { hasPermission, type Permission } from '@/lib/rbac';
import { redirect } from 'next/navigation';

export async function AuthGuard({
  permission,
  fallback = '/login',
  children,
}: {
  permission: Permission;
  fallback?: string;
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user || !hasPermission(session.user.role, permission)) {
    redirect(fallback);
  }

  return <>{children}</>;
}
```

## Session Provider Setup

```tsx
// components/providers/session-provider.tsx
'use client';

import { SessionProvider } from 'next-auth/react';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
```

## JWT vs Database Sessions

| JWT | Database |
|---|---|
| No DB query per request | DB lookup per session check |
| Edge compatible | Node.js only (DB connection) |
| Limited data on token | Can store any data |
| Can't invalidate individually | Instant invalidation |
| Good for: most apps | Good for: enterprise/security-first |

### JWT with Refresh Token Rotation

```ts
// auth.ts — advanced JWT config
export const { handlers, auth } = NextAuth({
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 }, // 30 days
  jwt: {
    maxAge: 15 * 60, // JWT expires in 15 min (short-lived)
  },
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        // On sign in, store refresh token
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;
      }

      if (Date.now() < (token.expiresAt as number) * 1000) {
        return token; // Token still valid
      }

      // Token expired — refresh it
      try {
        const response = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          body: new URLSearchParams({
            client_id: process.env.AUTH_GOOGLE_ID!,
            client_secret: process.env.AUTH_GOOGLE_SECRET!,
            grant_type: 'refresh_token',
            refresh_token: token.refreshToken as string,
          }),
        });
        const tokens = await response.json();
        return { ...token, ...tokens };
      } catch {
        return { ...token, error: 'RefreshAccessTokenError' };
      }
    },
  },
});
```

## Environment Variables

```bash
# .env.local
AUTH_SECRET="your-secret-key"           # openssl rand -base64 32
AUTH_GITHUB_ID="github-oauth-app-id"
AUTH_GITHUB_SECRET="github-oauth-secret"
AUTH_GOOGLE_ID="google-client-id"
AUTH_GOOGLE_SECRET="google-client-secret"
AUTH_URL="http://localhost:3000"        # Required for Auth.js v5
```

## Gotchas

1. **`auth()` in Server Components is NOT cached** — each call reads the session. Call it once at the top of your component and pass the result down.
2. **Middleware `auth()` is NOT the same as server-side `auth()`** — middleware uses Edge runtime. Features requiring Node.js (DB adapter, bcrypt) won't work.
3. **Credentials provider requires `session: { strategy: 'jwt' }`** — database adapter doesn't work with credentials (no OAuth account to link).
4. **`useSession()` needs `<SessionProvider>`** — wrap your root layout with it, or use `auth()` on the server to avoid the provider entirely.
5. **Edge runtime limitations** — if you use a database adapter, your middleware `auth()` call may fail. Use JWT for middleware, adapter for API routes.
6. **`AUTH_SECRET` is critical** — without it, sessions won't persist across deployments and encryption will fail silently.
