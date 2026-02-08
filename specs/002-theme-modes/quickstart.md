# Quickstart: Theme Modes

**Feature**: 002-theme-modes
**Date**: 2026-02-07

## Overview

The Jump Ticketing Platform supports three theme modes: **Light**, **Dark**, and **Auto** (follows device settings). Theme preference is stored in the browser and persists across sessions.

## For Users

### Switching Themes

Click the **theme icon button** in the top-right area of the navigation bar. Each click cycles through the modes:

1. **Sun icon** = Light mode (always light background)
2. **Moon icon** = Dark mode (always dark background)
3. **Monitor icon** = Auto mode (follows your device/OS setting)

A tooltip shows the current mode name on hover.

### Default Behavior

- First-time visitors see **Auto** mode (matches your device preference)
- Your choice is saved in the browser -- it persists when you close and reopen the site
- Clearing browser data resets to Auto mode

## For Developers

### Architecture

```text
layout.tsx
  -> ThemeProvider.tsx (client component, wraps next-themes)
    -> Navbar.tsx
      -> ThemeToggle.tsx (cycling button with useTheme hook)
    -> Page content (all pages use dark: Tailwind variants)
```

### Key Files

| File                               | Purpose                                                                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `src/components/ThemeProvider.tsx` | Client-side wrapper for `next-themes` ThemeProvider. Configures `attribute="class"`, `defaultTheme="system"`, `enableSystem` |
| `src/components/ThemeToggle.tsx`   | Cycling icon button. Uses `useTheme()` hook. Handles hydration with mounted guard                                            |
| `src/app/layout.tsx`               | Root layout. Has `suppressHydrationWarning` on `<html>`. Wraps children with ThemeProvider                                   |
| `src/app/globals.css`              | CSS custom properties for `--background` and `--foreground` with `:root` and `.dark` blocks                                  |
| `tailwind.config.js`               | `darkMode: 'class'` enables Tailwind `dark:` variant                                                                         |

### Adding Dark Mode to a New Component

1. For every light-mode Tailwind class, add the corresponding `dark:` variant:

```tsx
// Before (light only)
<div className="bg-white text-gray-900 border-gray-200">

// After (light + dark)
<div className="bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 border-gray-200 dark:border-slate-700">
```

2. Reference the color mapping table in `research.md` (R5: Dark Mode Color Palette) for the standard mappings.

### Adding Dark Mode to a New Page

1. Follow the same pattern as existing pages
2. Key elements that need `dark:` variants:
   - Page background (`bg-gray-50 dark:bg-slate-900`)
   - Cards and surfaces (`bg-white dark:bg-slate-800`)
   - Text colors (primary, secondary, muted)
   - Borders and dividers
   - Form inputs and buttons
   - Shadows

### Accessing Theme in Code

```tsx
"use client";
import { useTheme } from "next-themes";

function MyComponent() {
  const { theme, resolvedTheme, setTheme } = useTheme();

  // theme: 'light' | 'dark' | 'system' (what user selected)
  // resolvedTheme: 'light' | 'dark' (actual applied theme)
  // setTheme: function to change theme
}
```

**Important**: Always use the mounted guard pattern to avoid hydration mismatch:

```tsx
const [mounted, setMounted] = useState(false);
useEffect(() => setMounted(true), []);
if (!mounted) return null; // or a placeholder skeleton
```

### Testing

E2E tests use Playwright with system preference emulation:

```bash
cd frontend
npx playwright test e2e/theme-modes.spec.ts
```

Key Playwright APIs:

- `page.emulateMedia({ colorScheme: 'dark' })` -- emulate OS dark mode
- `page.evaluate(() => localStorage.getItem('theme'))` -- check persisted preference
- `page.locator('html').getAttribute('class')` -- verify applied theme class

### Dependencies

| Package       | Version | Purpose                                        |
| ------------- | ------- | ---------------------------------------------- |
| `next-themes` | ^0.4.x  | SSR-safe theme management with FOUC prevention |

## API Contracts

**N/A** -- This is a frontend-only feature. No backend API changes are required. No new endpoints, no modified responses, no database schema changes.
