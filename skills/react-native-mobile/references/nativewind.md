# NativeWind v4 — Tailwind CSS for React Native

NativeWind v4 brings Tailwind CSS to React Native, sharing the same utility-class approach as web Tailwind. It works with the New Architecture (Fabric renderer) and supports React Native 0.76+ / Expo SDK 52+.

## Setup (Expo SDK 52+)

```bash
# Install
npm install nativewind tailwindcss
npx tailwindcss init
```

```ts
// tailwind.config.ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
```

```css
/* global.css */
@tailwind base;
@tailwind components;
@tailwind utilities;
```

```ts
// nativewind-env.d.ts
/// <reference types="nativewind/types" />
```

Import `global.css` in your root `_layout.tsx`:

```tsx
import '../global.css';
```

---

## Core Utility Classes (React Native equivalents)

| Tailwind Class | React Native Style |
|---------------|-------------------|
| `flex-1` | `{ flex: 1 }` |
| `flex-row` | `{ flexDirection: 'row' }` |
| `items-center` | `{ alignItems: 'center' }` |
| `justify-between` | `{ justifyContent: 'space-between' }` |
| `p-4` | `{ padding: 16 }` |
| `px-6` | `{ paddingHorizontal: 24 }` |
| `rounded-2xl` | `{ borderRadius: 16 }` |
| `bg-white` | `{ backgroundColor: '#fff' }` |
| `text-lg` | `{ fontSize: 18, lineHeight: 28 }` |
| `font-bold` | `{ fontWeight: '700' }` |
| `shadow-sm` | Platform shadow/elevation |
| `absolute` | `{ position: 'absolute' }` |
| `z-10` | `{ zIndex: 10 }` |
| `overflow-hidden` | `{ overflow: 'hidden' }` |
| `opacity-50` | `{ opacity: 0.5 }` |
| `gap-4` | `{ gap: 16 }` |

---

## Dark Mode

NativeWind supports both `class` and `media` strategies. `class` is recommended:

```ts
// tailwind.config.ts
export default { darkMode: 'class' } satisfies Config;
```

```tsx
import { useColorScheme } from '@/hooks/useColorScheme';

// In root layout, apply dark class:
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <View className={colorScheme === 'dark' ? 'dark' : ''} style={{ flex: 1 }}>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      <Stack />
    </View>
  );
}
```

With the `dark:` prefix:

```tsx
<View className="bg-white dark:bg-gray-950">
  <Text className="text-gray-900 dark:text-gray-100">
    Adapts to color scheme
  </Text>
</View>
```

---

## Theme Customization

Extend Tailwind's theme for brand colors, spacing, fonts:

```ts
// tailwind.config.ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          500: '#3b82f6',
          700: '#1d4ed8',
          900: '#1e3a5f',
        },
        surface: {
          DEFAULT: '#ffffff',
          dark: '#0f172a',
        },
      },
      fontFamily: {
        sans: ['Inter', 'System'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
      },
      borderRadius: {
        '4xl': '2rem',
      },
    },
  },
  plugins: [],
};

export default config;
```

Use custom values:

```tsx
<View className="bg-brand-500 rounded-4xl p-18">
  <Text className="text-white font-mono">Custom themed</Text>
</View>
```

---

## Platform-Specific Styles

Use Tailwind's platform variants (custom plugin or inline):

```tsx
// iOS-safe bottom padding
<View className="pb-4 ios:pb-8">
  {/* Safe area on iOS needs extra padding */}
</View>
```

For complex platform logic, combine NativeWind with the Platform API:

```tsx
import { Platform, View } from 'react-native';

<View
  className={Platform.select({
    ios: 'shadow-lg shadow-black/10',
    android: 'elevation-4',
    default: 'shadow-md',
  })}
>
  <Text className={Platform.OS === 'ios' ? 'text-base' : 'text-sm'}>
    Platform-aware text
  </Text>
</View>
```

---

## Safe Area Handling

Always use `react-native-safe-area-context` — not raw Tailwind padding:

```tsx
import { SafeAreaView } from 'react-native-safe-area-context';

export default function Screen() {
  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-gray-950" edges={['top']}>
      <View className="px-4 pt-2">
        <Text className="text-lg font-bold">Title</Text>
      </View>
      {/* Use SafeAreaView edges={['bottom']} for bottom tabs */}
    </SafeAreaView>
  );
}
```

**Never do this:**
```tsx
// BAD — hardcoded padding doesn't account for notch/Dynamic Island
<View className="pt-12">
```

---

## Responsive Design (Tablets)

NativeWind supports breakpoints — useful for iPad/tablet layouts:

| Breakpoint | Min Width | Typical Device |
|-----------|-----------|----------------|
| `sm:` | 640px | Phone landscape |
| `md:` | 768px | Tablet portrait |
| `lg:` | 1024px | Tablet landscape |
| `xl:` | 1280px | iPad Pro |

```tsx
{/* Single column on phone, two columns on tablet */}
<View className="flex-col md:flex-row">
  <View className="flex-1 p-4">
    <Text>Column 1</Text>
  </View>
  <View className="flex-1 p-4 md:border-l md:border-gray-200">
    <Text>Column 2</Text>
  </View>
</View>

{/* Hide/show elements */}
<Text className="hidden md:flex">Only visible on tablet+</Text>

{/* Grid layouts */}
<View className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
  {/* Cards */}
</View>
```

### useWindowDimensions alternative

```tsx
import { useWindowDimensions } from 'react-native';

function AdaptiveLayout() {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;

  return (
    <View className={isTablet ? 'flex-row' : 'flex-col'}>
      {/* ... */}
    </View>
  );
}
```

---

## Touch & Press States

React Native doesn't have CSS hover/focus, but NativeWind provides `active:` variant:

```tsx
import { Pressable, Text } from 'react-native';

<Pressable className="bg-blue-500 active:bg-blue-600 active:opacity-80 rounded-xl p-4">
  <Text className="text-white font-semibold text-center">Tap Me</Text>
</Pressable>
```

For disabled state:

```tsx
<Pressable
  disabled={isLoading}
  className="bg-blue-500 disabled:bg-gray-300 rounded-xl p-4"
>
  <Text className="text-white disabled:text-gray-500">Submit</Text>
</Pressable>
```

---

## Component Patterns

### Card with shadow

```tsx
<View className="bg-white dark:bg-gray-800 rounded-2xl p-5
                shadow-md shadow-black/5
                android:elevation-3">
  <Text className="text-lg font-semibold text-gray-900 dark:text-white">
    Card Title
  </Text>
</View>
```

### Input field

```tsx
<TextInput
  className="bg-gray-50 dark:bg-gray-800
             border border-gray-200 dark:border-gray-700
             rounded-xl px-4 py-3
             text-base text-gray-900 dark:text-white
             focus:border-blue-500"
  placeholder="Enter text..."
  placeholderTextColor="#9ca3af"
/>
```

### Button variants

```tsx
function Button({ variant = 'primary', label }: { variant: 'primary' | 'secondary'; label: string }) {
  const variants = {
    primary: 'bg-blue-500 active:bg-blue-600',
    secondary: 'bg-gray-100 dark:bg-gray-800 active:bg-gray-200',
  };

  return (
    <Pressable className={`rounded-xl px-6 py-3 ${variants[variant]}`}>
      <Text
        className={variant === 'primary'
          ? 'text-white font-semibold'
          : 'text-gray-900 dark:text-white font-semibold'}
      >
        {label}
      </Text>
    </Pressable>
  );
}
```

---

## Common Pitfalls

1. **`gap` works in RN 0.71+** — Expo SDK 52 uses RN 0.76+, so `gap-4` is fine.
2. **`shadow-*` uses `shadowColor`/`shadowOffset` etc. on iOS but `elevation` on Android** — use `android:elevation-N` for explicit Android shadows.
3. **Font weights over `font-bold`** — RN supports `font-extralight` through `font-black` natively.
4. **`sticky` doesn't work** — `position: sticky` has no RN equivalent. Use `ScrollView` with `stickyHeaderIndices` instead.
5. **Don't use `className` on custom non-RN components** — only RN primitives (View, Text, Pressable, TextInput, ScrollView, Image) accept className.
