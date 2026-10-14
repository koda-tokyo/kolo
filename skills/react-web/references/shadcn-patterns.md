# shadcn/ui Patterns

> **Skill:** react-web | **Stack:** shadcn/ui, Radix UI, React 19, Tailwind v4

## Architecture

shadcn/ui is NOT a component library — it's a collection of copy-pasteable components built on Radix UI primitives. Every component lives in your project at `src/components/ui/`. You own the code.

```bash
# Initialize shadcn/ui in a Next.js project
npx shadcn@latest init

# Add individual components
npx shadcn@latest add button card dialog dropdown-menu

# The components are copied to src/components/ui/
```

## Component Composition

shadcn/ui components compose through props, not magic. The pattern:

```tsx
// ✅ GOOD: Composition pattern
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';

export function ProductCard({ product }: { product: Product }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{product.name}</CardTitle>
        <CardDescription>{product.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold">${product.price}</p>
      </CardContent>
      <CardFooter>
        <Button variant="default" size="sm">
          Add to Cart
        </Button>
      </CardFooter>
    </Card>
  );
}
```

### Adding Custom Variants

```tsx
// components/ui/button.tsx — extend with your own variants
import { cva, type VariantProps } from 'class-variance-authority';

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border bg-background hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        // Custom variant
        gradient: 'bg-gradient-to-r from-primary to-accent text-white hover:opacity-90',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
        xl: 'h-14 rounded-lg px-10 text-lg', // Custom size
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);
```

## Theme Customization (CSS Variables)

shadcn/ui theming is driven by CSS variables. Change them once in `globals.css` and all components follow:

```css
/* globals.css */
@import "tailwindcss";

@theme {
  /* Light mode tokens */
  --color-background: oklch(1 0 0);
  --color-foreground: oklch(0.15 0.005 285);
  --color-primary: oklch(0.55 0.2 265);     /* Purple */
  --color-primary-foreground: oklch(0.98 0 0);
  --color-secondary: oklch(0.96 0.005 285);
  --color-secondary-foreground: oklch(0.2 0.01 285);
  --color-muted: oklch(0.97 0.001 285);
  --color-muted-foreground: oklch(0.55 0.01 285);
  --color-accent: oklch(0.96 0.01 285);
  --color-accent-foreground: oklch(0.15 0.01 285);
  --color-destructive: oklch(0.58 0.24 27);
  --color-destructive-foreground: oklch(0.98 0 0);
  --color-border: oklch(0.92 0.005 285);
  --color-input: oklch(0.92 0.005 285);
  --color-ring: oklch(0.55 0.2 265);
  --radius: 0.5rem;
}

.dark {
  --color-background: oklch(0.15 0.005 285);
  --color-foreground: oklch(0.95 0 0);
  --color-primary: oklch(0.65 0.2 265);
  --color-primary-foreground: oklch(0.15 0.01 285);
  /* ... remaining dark overrides */
}
```

## Form Patterns (React Hook Form + Zod)

```tsx
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';

const formSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters'),
  email: z.string().email('Invalid email address'),
  bio: z.string().max(500, 'Bio must be 500 characters or less').optional(),
});

type FormValues = z.infer<typeof formSchema>;

export function ProfileForm() {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { username: '', email: '', bio: '' },
  });

  async function onSubmit(values: FormValues) {
    // Call Server Action or API
    const result = await updateProfile(values);
    if (result?.error) {
      form.setError('root', { message: result.error });
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="username"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Username</FormLabel>
              <FormControl>
                <Input placeholder="johndoe" {...field} />
              </FormControl>
              <FormDescription>Your public display name.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" placeholder="john@example.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Saving...' : 'Save Profile'}
        </Button>
      </form>
    </Form>
  );
}
```

## Dialog / Sheet Patterns

```tsx
'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export function EditUserDialog({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Edit User</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
          <DialogDescription>
            Make changes to the user profile. Click save when done.
          </DialogDescription>
        </DialogHeader>
        {/* Form content here */}
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit">Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

**Sheet (slide-in panel):** Same pattern as Dialog but slides from side. Use for mobile menus, filters, and detail panels.

## Toast / Sonner Patterns

```tsx
// Install sonner (preferred for shadcn/ui projects)
// npm install sonner

// providers.tsx
import { Toaster } from '@/components/ui/sonner';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Toaster richColors position="bottom-right" />
    </>
  );
}

// Usage anywhere
import { toast } from 'sonner';

function handleDelete() {
  toast.promise(deleteItem(id), {
    loading: 'Deleting...',
    success: 'Item deleted',
    error: 'Failed to delete',
  });
}

// Custom toast with actions
toast('New message', {
  description: 'You have a new message from Alice',
  action: { label: 'View', onClick: () => router.push('/messages') },
});
```

## Table / Data Patterns

```tsx
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface Column<T> {
  header: string;
  accessor: keyof T | ((row: T) => React.ReactNode);
  className?: string;
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
}

export function DataTable<T extends { id: string }>({ data, columns }: DataTableProps<T>) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map(col => (
            <TableHead key={col.header} className={col.className}>
              {col.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.length === 0 ? (
          <TableRow>
            <TableCell colSpan={columns.length} className="text-center text-muted-foreground">
              No data found.
            </TableCell>
          </TableRow>
        ) : (
          data.map(row => (
            <TableRow key={row.id}>
              {columns.map(col => (
                <TableCell key={col.header} className={col.className}>
                  {typeof col.accessor === 'function'
                    ? col.accessor(row)
                    : String(row[col.accessor] ?? '')}
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
```

## Command Palette (⌘K)

```tsx
'use client';

import { useState, useEffect } from 'react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';

export function CommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(open => !open);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Pages">
          <CommandItem onSelect={() => router.push('/dashboard')}>
            Dashboard
          </CommandItem>
          <CommandItem onSelect={() => router.push('/settings')}>
            Settings
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => setTheme('dark')}>
            Toggle Dark Mode
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
```

## Gotchas

1. **Components live in your codebase.** Don't `import { Button } from 'shadcn/ui'`. Always `@/components/ui/button`.
2. **Don't modify Radix directly.** shadcn/ui wraps Radix. Customize via the copied component files, not Radix props.
3. **`cn()` is your friend.** Always use the `cn()` utility from `@/lib/utils` for conditional classes. It merges Tailwind classes properly.
4. **Form validation belongs in Zod schemas, not JSX.** The Zod schema is the single source of truth for validation rules.
5. **Always use `asChild` on trigger components** (`<DialogTrigger asChild>`) when wrapping with your own button — avoids nesting `<button>` inside `<button>`.
6. **Sonner is preferred over the built-in toast.** It handles animations, stacking, and promise-based states better.
