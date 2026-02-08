# Theme System — Developer Guide

**Feature**: 002-theme-modes  
**Status**: Implemented  
**Impact**: Frontend only — no backend changes

---

## Overview

The Jump Ticketing Platform supports three visual themes:

| Mode               | Behavior                                                                   |
| ------------------ | -------------------------------------------------------------------------- |
| **Light**          | Always uses the light color palette                                        |
| **Dark**           | Always uses the dark color palette                                         |
| **Auto** (default) | Follows the user's OS/browser preference and responds to real-time changes |

Theme preference is persisted in `localStorage` under the key `theme` and survives browser restarts.

---

## Architecture

```text
layout.tsx
  └─ ThemeProvider.tsx (client component, wraps next-themes)
       └─ Navbar.tsx
            └─ ThemeToggle.tsx (cycling button, useTheme hook)
       └─ Page content (all pages use Tailwind dark: variants)
```

### How It Works

1. **`next-themes`** injects a blocking `<script>` into `<head>` that reads `localStorage.theme` and sets the `class` attribute on `<html>` before first paint — this prevents Flash of Unstyled Content (FOUC).
2. **`ThemeProvider`** wraps the entire app with `attribute="class"`, `defaultTheme="system"`, and `enableSystem`.
3. **Tailwind CSS** `darkMode: 'class'` makes all `dark:` utility variants activate when `<html class="dark">`.
4. **`ThemeToggle`** uses a mounted guard pattern to avoid SSR hydration mismatch, then cycles: light → dark → auto → light.

---

## Key Files

| File                               | Purpose                                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `src/components/ThemeProvider.tsx` | Client wrapper for `next-themes`. Configures `attribute="class"`, `defaultTheme="system"`, `enableSystem` |
| `src/components/ThemeToggle.tsx`   | Cycling icon button (sun/moon/monitor). Uses `useTheme()` with mounted guard                              |
| `src/app/layout.tsx`               | Root layout. `suppressHydrationWarning` on `<html>`, wraps children with ThemeProvider                    |
| `src/app/globals.css`              | CSS custom properties (`--background`, `--foreground`) with `:root` and `.dark` blocks                    |
| `tailwind.config.js`               | `darkMode: 'class'` enables the `dark:` variant                                                           |
| `e2e/theme-modes.spec.ts`          | Playwright E2E tests for all three user stories + FOUC                                                    |
| `e2e/wcag-contrast.spec.ts`        | Axe-core WCAG AA color contrast verification                                                              |

---

## Color Palette Mapping

When adding dark mode to any component, use these standard mappings:

| Element          | Light Class             | Dark Class                            |
| ---------------- | ----------------------- | ------------------------------------- |
| Page background  | `bg-gray-50`            | `dark:bg-slate-900`                   |
| Card / surface   | `bg-white`              | `dark:bg-slate-800`                   |
| Elevated surface | `bg-white`              | `dark:bg-slate-700`                   |
| Primary text     | `text-gray-900`         | `dark:text-slate-100`                 |
| Secondary text   | `text-gray-600`         | `dark:text-slate-400`                 |
| Muted text       | `text-gray-400`         | `dark:text-slate-500`                 |
| Border           | `border-gray-200`       | `dark:border-slate-700`               |
| Input border     | `border-gray-300`       | `dark:border-slate-600`               |
| Brand accent     | `text-indigo-600`       | `dark:text-indigo-400`                |
| Hover accent     | `hover:text-indigo-700` | `dark:hover:text-indigo-500`          |
| Danger           | `text-red-600`          | `dark:text-red-400`                   |
| Success          | `text-green-600`        | `dark:text-green-400`                 |
| Warning bg       | `bg-yellow-50`          | `dark:bg-yellow-900/20`               |
| Shadow           | `shadow-md`             | `dark:shadow-lg dark:shadow-black/20` |

---

## Adding Dark Mode to a New Component

```tsx
// ❌ Before (light only)
<div className="bg-white text-gray-900 border-gray-200 shadow-md">

// ✅ After (light + dark)
<div className="bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 border-gray-200 dark:border-slate-700 shadow-md dark:shadow-lg dark:shadow-black/20">
```

For form inputs, also add background and placeholder colors:

```tsx
<input className="border-gray-300 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-100 dark:placeholder-slate-500" />
```

---

## Adding Dark Mode to a New Page

Follow the same pattern as existing pages. Key elements that need `dark:` variants:

1. **Page wrapper**: `bg-gray-50 dark:bg-slate-900`
2. **Cards and surfaces**: `bg-white dark:bg-slate-800`
3. **All text colors**: primary, secondary, muted — use table above
4. **Borders and dividers**: `border-gray-200 dark:border-slate-700`
5. **Form inputs**: background, border, text, placeholder
6. **Badges**: e.g. `bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400`
7. **Shadows**: `shadow-md dark:shadow-lg dark:shadow-black/20`

---

## Accessing Theme Programmatically

```tsx
"use client";
import { useTheme } from "next-themes";
import { useState, useEffect } from "react";

function MyComponent() {
  const [mounted, setMounted] = useState(false);
  const { theme, resolvedTheme, setTheme } = useTheme();

  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  // theme: 'light' | 'dark' | 'system' (what the user selected)
  // resolvedTheme: 'light' | 'dark' (actual applied theme, resolves 'system')
  // setTheme('dark') — programmatically set theme
}
```

> **Important**: Always use the mounted guard pattern (`useState` + `useEffect`) to avoid Next.js SSR hydration mismatch. The theme is only known on the client.

---

## Testing

### E2E Tests

```bash
cd frontend
npx playwright test e2e/theme-modes.spec.ts    # Theme toggle, persistence, FOUC
npx playwright test e2e/wcag-contrast.spec.ts   # WCAG AA contrast checks
npx playwright test e2e/                         # All E2E tests
```

### Key Playwright APIs

| API                                                  | Purpose                          |
| ---------------------------------------------------- | -------------------------------- |
| `page.emulateMedia({ colorScheme: 'dark' })`         | Emulate OS dark mode preference  |
| `page.evaluate(() => localStorage.getItem('theme'))` | Check persisted theme preference |
| `page.locator('html').getAttribute('class')`         | Verify applied `.dark` class     |
| `AxeBuilder({ page }).withRules(['color-contrast'])` | Run WCAG contrast scan           |

### Test Coverage

| Test File                    | User Story                | Tests   |
| ---------------------------- | ------------------------- | ------- |
| `theme-modes.spec.ts` — US1  | Toggle cycling            | 7 tests |
| `theme-modes.spec.ts` — US2  | Auto mode / OS preference | 4 tests |
| `theme-modes.spec.ts` — US3  | Keyboard a11y / tooltip   | 5 tests |
| `theme-modes.spec.ts` — FOUC | Flash of Unstyled Content | 3 tests |
| `wcag-contrast.spec.ts`      | WCAG AA contrast          | 6 tests |

---

## Dependencies

| Package                | Version | Purpose                                        |
| ---------------------- | ------- | ---------------------------------------------- |
| `next-themes`          | ^0.4.x  | SSR-safe theme management with FOUC prevention |
| `@axe-core/playwright` | (dev)   | WCAG AA color contrast automated testing       |

---

## FAQ

**Q: Why `darkMode: 'class'` instead of `'media'`?**  
A: The `class` strategy allows users to override their OS preference (e.g., choose light mode even if OS is dark). The `media` strategy only follows OS preference with no user control.

**Q: Why `suppressHydrationWarning` on `<html>`?**  
A: `next-themes` injects a blocking script that sets the `class` attribute before React hydrates. Without this attribute, React would warn about the server/client mismatch.

**Q: Why the mounted guard pattern in ThemeToggle?**  
A: During SSR, `useTheme()` returns `undefined` because `localStorage` doesn't exist on the server. Rendering theme-dependent UI before mount would cause a hydration mismatch error.

**Q: Does this affect the backend?**  
A: No. Theme mode is entirely a frontend concern. No API endpoints, database columns, or backend logic is involved.
