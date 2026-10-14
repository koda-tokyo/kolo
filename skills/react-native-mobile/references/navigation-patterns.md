# Navigation Patterns — React Native + Expo Router

Production navigation goes beyond basic stacks and tabs. This guide covers the patterns you'll need for real apps: auth flows, onboarding, nested navigators, deep linking, gesture handling, and back-button behavior.

---

## Choosing the Right Navigator

| Pattern | Use When | Navigator |
|---------|----------|-----------|
| **Bottom tabs** | 3–5 primary sections, always visible | `Tabs` from expo-router |
| **Drawer** | Many sections, less-frequent access | `Drawer` from expo-router/drawer |
| **Stack** | Sequential flows, drill-down | `Stack` from expo-router |
| **Top tabs** | Filter/category switching within one screen | `MaterialTopTabs` |
| **Modal** | Interruptions: compose, filter, confirm | Stack with `presentation: 'modal'` |

---

## Authentication Flow

The gold standard: a root layout that conditionally renders `(auth)` or `(tabs)` based on session state.

```
app/
├── _layout.tsx            # Root — auth gate
├── (auth)/
│   ├── _layout.tsx        # Auth stack
│   ├── login.tsx
│   ├── register.tsx
│   └── forgot-password.tsx
├── (tabs)/
│   ├── _layout.tsx        # Main tab navigator
│   ├── index.tsx
│   ├── profile.tsx
│   └── settings.tsx
└── index.tsx              # Splash / redirect
```

```tsx
// app/_layout.tsx
import { Stack } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';

export default function RootLayout() {
  const { session, isLoading } = useAuth();

  if (isLoading) return null; // Or a SplashScreen

  return (
    <Stack screenOptions={{ headerShown: false }}>
      {session ? (
        <Stack.Screen name="(tabs)" />
      ) : (
        <Stack.Screen name="(auth)" />
      )}
    </Stack>
  );
}
```

```tsx
// app/(auth)/login.tsx — on successful login
import { router } from 'expo-router';

async function handleLogin(email: string, password: string) {
  await signIn(email, password);
  // Navigate to main — resets the auth stack
  router.replace('/(tabs)');
}
```

```tsx
// On logout (from settings/profile)
async function handleLogout() {
  await signOut();
  router.replace('/(auth)/login');
}
```

### Auth state hook

```tsx
// hooks/useAuth.ts
import { createContext, useContext, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

interface Session {
  userId: string;
  token: string;
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Load persisted session
    SecureStore.getItemAsync('session')
      .then((data) => {
        if (data) setSession(JSON.parse(data));
      })
      .finally(() => setIsLoading(false));
  }, []);

  return { session, isLoading };
}
```

---

## Onboarding Flow

New users get an onboarding sequence before the main app.

```tsx
// app/_layout.tsx
export default function RootLayout() {
  const { session, hasCompletedOnboarding } = useAuth();

  if (!session) return <Stack.Screen name="(auth)" />;
  if (!hasCompletedOnboarding) return <Stack.Screen name="(onboarding)" />;
  return <Stack.Screen name="(tabs)" />;
}
```

```
app/
├── (onboarding)/
│   ├── _layout.tsx        # Stack — no swipe-back
│   ├── welcome.tsx
│   ├── permissions.tsx
│   └── complete.tsx
```

```tsx
// app/(onboarding)/_layout.tsx
import { Stack } from 'expo-router';

export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ gestureEnabled: false, headerShown: false }}>
      <Stack.Screen name="welcome" />
      <Stack.Screen name="permissions" />
      <Stack.Screen name="complete" />
    </Stack>
  );
}
```

---

## Nested Navigators

### Stack inside Tab

Each tab can have its own nested stack:

```tsx
// app/(tabs)/_layout.tsx — the tab navigator
<Tabs>
  <Tabs.Screen name="home" options={{ headerShown: false }} />
  <Tabs.Screen name="search" />
  <Tabs.Screen name="profile" options={{ headerShown: false }} />
</Tabs>
```

```tsx
// app/(tabs)/home/_layout.tsx — nested stack inside Home tab
import { Stack } from 'expo-router';

export default function HomeStack() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Home' }} />
      <Stack.Screen name="[id]" options={{ title: 'Post' }} />
      <Stack.Screen name="compose" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
```

Folder structure:

```
app/(tabs)/home/
├── _layout.tsx     # Stack navigator
├── index.tsx       # Feed list
└── [id].tsx        # Post detail
```

### Tab inside Stack (rare but possible)

Useful when a modal/stack covers the tab bar:

```tsx
// app/_layout.tsx
<Stack>
  <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
  <Stack.Screen name="video-player" options={{ presentation: 'fullScreenModal' }} />
</Stack>
```

---

## Back Button Handling

### Custom back button

```tsx
import { Stack, router } from 'expo-router';
import { Pressable, Text } from 'react-native';

<Stack.Screen
  name="detail"
  options={{
    headerLeft: () => (
      <Pressable onPress={() => router.back()} className="pr-4">
        <Text className="text-blue-500 text-base">← Back</Text>
      </Pressable>
    ),
  }}
/>
```

### Prevent back (confirmation dialog)

```tsx
import { useNavigation } from 'expo-router';
import { useEffect } from 'react';
import { Alert } from 'react-native';

function EditScreen() {
  const navigation = useNavigation();
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (!hasUnsavedChanges) return; // Allow back

      e.preventDefault();
      Alert.alert(
        'Discard changes?',
        'You have unsaved changes. Are you sure you want to leave?',
        [
          { text: "Don't leave", style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
        ],
      );
    });

    return unsubscribe;
  }, [navigation, hasUnsavedChanges]);
}
```

### Android hardware back button

```tsx
import { BackHandler } from 'react-native';
import { useEffect } from 'react';

useEffect(() => {
  const onBack = () => {
    // Return true to prevent default
    if (shouldPreventBack) {
      showDialog();
      return true;
    }
    return false;
  };
  BackHandler.addEventListener('hardwareBackPress', onBack);
  return () => BackHandler.removeEventListener('hardwareBackPress', onBack);
}, []);
```

---

## Gesture Navigation

### Swipe-back (iOS default)

Enabled by default on Stack navigators. To disable:

```tsx
<Stack.Screen name="checkout" options={{ gestureEnabled: false }} />
```

### Swipe between tabs

Not built into `Tabs` — use `react-native-pager-view` or `@react-navigation/material-top-tabs`:

```bash
npx expo install react-native-pager-view
```

### Gesture Handler integration

For custom gestures (swipe-to-delete, drag-to-dismiss):

```bash
npx expo install react-native-gesture-handler react-native-reanimated
```

```tsx
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';

function SwipeableRow({ children, onDelete }: { children: React.ReactNode; onDelete: () => void }) {
  const translateX = useSharedValue(0);

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      translateX.value = Math.min(e.translationX, 0);
    })
    .onEnd(() => {
      if (translateX.value < -100) {
        translateX.value = withSpring(-200);
      } else {
        translateX.value = withSpring(0);
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View style={animatedStyle}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}
```

---

## Deep Linking Patterns

### Notification → specific screen

```tsx
// In root _layout, handle incoming links:
import { useLinking } from 'expo-router';
import * as Notifications from 'expo-notifications';

// Subscribe to notification-triggered navigation
Notifications.addNotificationResponseReceivedListener((response) => {
  const postId = response.notification.request.content.data.postId;
  if (postId) {
    router.push(`/post/${postId}`);
  }
});
```

### Universal links (associated domains)

```json
// app.json
{
  "expo": {
    "ios": {
      "associatedDomains": ["applinks:myapp.com"]
    },
    "android": {
      "intentFilters": [
        {
          "action": "VIEW",
          "autoVerify": true,
          "data": [{ "scheme": "https", "host": "myapp.com" }],
          "category": ["BROWSABLE", "DEFAULT"]
        }
      ]
    }
  }
}
```

---

## Common Patterns Summary

| Pattern | Implementation |
|---------|---------------|
| Auth gate | Root layout conditional on session |
| Onboarding | Separate layout group, gesture-disabled stack |
| Tab + nested stack | Each tab folder has its own `_layout.tsx` |
| Full-screen modal | `presentation: 'fullScreenModal'` at root stack |
| Prevent back | `beforeRemove` event listener with confirmation |
| Notification deep link | `useLinking` + notification response listener |
| Swipe gestures | `react-native-gesture-handler` + `react-native-reanimated` |
