# Theme System

**Status:** Implemented
**Last Updated:** 2026-09-07

## Overview

Three-mode theme system: Light, Dark, and Auto (follows OS preference). Built on the `next-themes` library. User preference is stored in localStorage. All pages use Tailwind `dark:` variants for styling. A cycling toggle button in the navbar switches between modes.

## Key Files

| File | Purpose |
|------|---------|
| `frontend/src/components/ThemeProvider.tsx` | next-themes provider wrapper |
| `frontend/src/components/ThemeToggle.tsx` | Cycling button (Light → Dark → Auto) |
| `frontend/src/app/layout.tsx` | ThemeProvider integration at app root |

## How It Works

1. `ThemeProvider` wraps the app in `layout.tsx`, enabling next-themes.
2. User clicks `ThemeToggle` to cycle through Light → Dark → Auto.
3. Selected preference is persisted to localStorage under the key `"theme"`.
4. In Auto mode, the theme follows the OS `prefers-color-scheme` media query in real time.
5. Tailwind `dark:` variants apply styles based on the active theme class on `<html>`.

## Gotchas

- Auto mode responds to real-time OS preference changes (e.g., macOS scheduled dark mode).
- No backend involvement — purely frontend, stored in localStorage.
- Flash of incorrect theme on initial load is handled by next-themes' script injection.

## Related Features

- [Org Switcher](org-switcher.md) — shares the admin header where ThemeToggle appears.
- [Organization Theme Mode](organization-theme-mode.md) — organizations can force light/dark/system on their public pages via `forcedTheme`.
