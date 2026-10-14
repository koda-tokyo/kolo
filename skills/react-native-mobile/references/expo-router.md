# Expo Router v4 — File-Based Routing

Expo Router v4 (SDK 52+) is a file-based routing framework for React Native, inspired by Next.js App Router. Routes are defined by the file structure under `app/`.

## Core Concepts

### File Conventions

| File | Purpose |
|------|---------|
| `app/_layout.tsx` | Root layout — wraps all routes |
| `app/index.tsx` | Home route (`/`) |
| `app/about.tsx` | `/about` |
| `app/settings/index.tsx` | `/settings` |
| `app/settings/profile.tsx` | `/settings/profile` |
| `app/[id].tsx` | Dynamic segment — `/123`, `/abc` |
| `app/+not-found.tsx` | 404 fallback |
| `app/+html.tsx` | Custom HTML shell (web only) |

### Layout Groups — `(group)/`

Groups in parentheses don't affect the URL. Useful for auth vs main, or different navigator types.

```
app/
├── (auth)/
│   ├── _layout.tsx      # Stack navigator
│   ├── login.tsx         # /login
│   └── register.tsx      # /register
├── (tabs)/
│   ├── _layout.tsx       # Tab navigator
│   ├── index.tsx          # /
│   └── profile.tsx        # /profile
└── _layout.tsx            # Root — chooses (auth) or (tabs)
```

### Shared Routes — `(group)/` with same name

Groups can share routes. Both `(auth)/settings.tsx` and `(tabs)/settings.tsx` map to `/settings` — the root layout decides which renders.

---

## Stack Navigator

```tsx
// app/_layout.tsx
import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="modal"
        options={{
          presentation: 'modal',
          animation: 'slide_from_bottom',
        }}
      />
    </Stack>
  );
}
```

### Stack Screen Options

```tsx
<Stack.Screen
  name="detail"
  options={{
    title: 'Details',
    headerStyle: { backgroundColor: '#fff' },
    headerTintColor: '#000',
    headerTitleStyle: { fontWeight: 'bold' },
    // iOS: slide_from_right (default), modal, fade, flip
    animation: 'slide_from_right',
    // Gesture-enabled back (iOS)
    gestureEnabled: true,
    // Prevent swipe-back
    gestureEnabled: false,
  }}
/>
```

---

## Tab Navigator

```tsx
// app/(tabs)/_layout.tsx
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function TabLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: '#2563eb' }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: 'Search',
          href: null,  // Hide tab from tab bar, still navigable
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="search" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
```

### Hide a Tab from the Bar

```tsx
<Tabs.Screen name="hidden" options={{ href: null }} />
```

The route still exists (accessible via `router.push('/hidden')`) but won't show in the tab bar.

---

## Drawer Navigator

```tsx
// app/(drawer)/_layout.tsx
import { Drawer } from 'expo-router/drawer';
import { DrawerContentScrollView, DrawerItemList } from '@react-navigation/drawer';

function CustomDrawerContent(props: any) {
  return (
    <DrawerContentScrollView {...props}>
      <DrawerItemList {...props} />
    </DrawerContentScrollView>
  );
}

export default function DrawerLayout() {
  return (
    <Drawer
      drawerContent={(props) => <CustomDrawerContent {...props} />}
      screenOptions={{
        drawerActiveTintColor: '#2563eb',
        drawerStyle: { backgroundColor: '#fff' },
      }}
    >
      <Drawer.Screen name="index" options={{ title: 'Home' }} />
      <Drawer.Screen name="settings" options={{ title: 'Settings' }} />
    </Drawer>
  );
}
```

---

## Navigation API

### Imperative Navigation

```tsx
import { router } from 'expo-router';

// Push a new screen
router.push('/profile/123');

// Push with params
router.push({ pathname: '/profile/[id]', params: { id: '123' } });

// Replace current screen
router.replace('/login');

// Go back
router.back();

// Go back N screens
router.dismiss(2);

// Navigate to root
router.dismissAll();
router.replace('/');

// Navigate and clear history (like reset)
router.replace('/dashboard');
// For full stack reset:
router.dismissAll();
router.replace('/dashboard');
```

### `useNavigation` hook

```tsx
import { useNavigation } from 'expo-router';
import { useEffect } from 'react';

function MyScreen() {
  const navigation = useNavigation();

  useEffect(() => {
    // Prevent going back (e.g., after form submission)
    navigation.addListener('beforeRemove', (e) => {
      e.preventDefault();
      // Show confirmation dialog
    });
  }, [navigation]);
}
```

---

## Passing Parameters

### Sending params

```tsx
router.push({
  pathname: '/user/[id]',
  params: { id: '42', name: 'Alice', mode: 'edit' },
});
```

### Receiving params

```tsx
// app/user/[id].tsx
import { useLocalSearchParams, useGlobalSearchParams } from 'expo-router';

export default function UserScreen() {
  // useLocalSearchParams — params for the current route only
  const { id, name, mode } = useLocalSearchParams<{
    id: string;
    name: string;
    mode: string;
  }>();

  // useGlobalSearchParams — includes search/query params from URL
  const global = useGlobalSearchParams();

  return <Text>User: {id} — {name}</Text>;
}
```

---

## Deep Linking

Expo Router handles deep linking automatically based on file structure.

### Configure scheme

```json
// app.json
{
  "expo": {
    "scheme": "myapp"
  }
}
```

This creates `myapp://` links. For universal links, configure associated domains.

### Deep link format

```
myapp://profile/123          → app/profile/[id].tsx
myapp://settings/notifications → app/settings/notifications.tsx
myapp://product?id=42&ref=web → app/product.tsx (params via search)
```

### Testing deep links

```bash
# iOS simulator
npx uri-scheme open "myapp://profile/123" --ios

# Android emulator
npx uri-scheme open "myapp://profile/123" --android

# Physical device
npx uri-scheme open "myapp://profile/123"
```

### Handling deep links programmatically

```tsx
import { useLinking } from 'expo-router';

// In root _layout.tsx
export default function RootLayout() {
  const linking = useLinking({
    prefixes: ['myapp://', 'https://myapp.com'],
    config: {
      screens: {
        '(tabs)': {
          screens: {
            index: '',
            profile: 'profile/:id',
          },
        },
        'product': 'product/:id',
      },
    },
  });

  return <Stack linking={linking}>...</Stack>;
}
```

---

## Typed Routes (SDK 52+)

Expo Router v4 supports auto-generated typed routes via `expo-router/typed-routes`.

```bash
npx expo customize tsconfig.json
```

```tsx
// This generates type-safe Href values
import { Href } from 'expo-router';

const route: Href = '/profile/123'; // TypeScript validates this exists!

// With params — fully typed
import { router } from 'expo-router';
router.push({
  pathname: '/user/[id]',
  params: { id: 'abc' }, // id is typed as string
});
```

---

## Modals and Presentations

```tsx
// Present as modal
<Stack.Screen name="compose" options={{ presentation: 'modal' }} />

// iOS form sheet
<Stack.Screen name="filter" options={{ presentation: 'formSheet' }} />

// Full-screen modal
<Stack.Screen name="camera" options={{ presentation: 'fullScreenModal' }} />

// Transparent modal (iOS)
<Stack.Screen
  name="overlay"
  options={{
    presentation: 'transparentModal',
    animation: 'fade',
  }}
/>
```

### Dismissing modals

```tsx
import { router } from 'expo-router';

// Inside a modal screen
router.back(); // Slides it away
router.dismissAll(); // Dismiss all modals
```

---

## Redirects

```tsx
// app/index.tsx — redirect based on auth state
import { Redirect } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';

export default function Index() {
  const { session, isLoading } = useAuth();

  if (isLoading) return <SplashScreen />;

  if (!session) {
    return <Redirect href="/(auth)/login" />;
  }

  return <Redirect href="/(tabs)" />;
}
```

### Catch-all redirects

```tsx
// app/[...unmatched].tsx
import { Redirect } from 'expo-router';

export default function Unmatched() {
  return <Redirect href="/" />;
}
```

---

## Platform-Specific Routes

Expo Router supports platform-specific file extensions:

```
app/settings.tsx          → shared, all platforms
app/settings.ios.tsx      → iOS only
app/settings.android.tsx  → Android only
app/settings.web.tsx      → Web only
```

---

## Best Practices

1. **Keep layouts thin** — Layout files (`_layout.tsx`) should only configure navigators. Business logic goes in screens.
2. **Use layout groups** for auth gating: a root layout that conditionally renders `(auth)` or `(tabs)`.
3. **Typed routes** — enable with `expo customize tsconfig.json` for compile-time navigation safety.
4. **Avoid deeply nested `router.push()`** — prefer relative paths when possible.
5. **Modal screens** should be at the root stack level, not inside tabs.
