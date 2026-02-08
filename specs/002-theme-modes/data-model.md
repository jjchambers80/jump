# Data Model: Theme Modes

**Feature**: 002-theme-modes
**Date**: 2026-02-07

## Overview

This feature is frontend-only with no database changes. All state is managed client-side via localStorage and React context (provided by `next-themes`).

## Entities

### ThemePreference (Client-Side)

**Storage**: localStorage (key: `theme`)
**Managed by**: `next-themes` library (automatic)

| Field | Type   | Values                          | Default    | Description                |
| ----- | ------ | ------------------------------- | ---------- | -------------------------- |
| theme | string | `"light"`, `"dark"`, `"system"` | `"system"` | User's selected theme mode |

**Notes**:

- Stored as plain string in `localStorage.getItem('theme')`
- `"system"` means follow OS/browser `prefers-color-scheme` preference
- When no value exists in localStorage, `next-themes` defaults to `defaultTheme` prop (configured as `"system"`)
- `next-themes` handles read/write automatically -- no manual localStorage calls needed

### ResolvedTheme (Runtime)

**Storage**: In-memory (React context via `useTheme()` hook)
**Managed by**: `next-themes` library (automatic)

| Field         | Type   | Values                           | Description                                                         |
| ------------- | ------ | -------------------------------- | ------------------------------------------------------------------- |
| theme         | string | `"light"`, `"dark"`, `"system"`  | Currently selected theme (may be "system")                          |
| resolvedTheme | string | `"light"`, `"dark"`              | Actual applied theme after resolving "system" against OS preference |
| systemTheme   | string | `"light"`, `"dark"`, `undefined` | Current OS/browser color scheme preference                          |

**Notes**:

- `resolvedTheme` is always either `"light"` or `"dark"` -- never `"system"`
- When `theme === "system"`, `resolvedTheme` equals `systemTheme`
- Use `resolvedTheme` for conditional rendering (e.g., themed images)
- Use `theme` for displaying the current mode name in UI

## State Transitions

```text
User clicks toggle    User clicks toggle    User clicks toggle
  [light] ---------> [dark] ------------> [system] ----------> [light]
     ^                                                            |
     |____________________________________________________________|

OS preference changes (only affects resolved theme when theme === "system"):
  [system] + OS=dark  => resolvedTheme="dark"
  [system] + OS=light => resolvedTheme="light"
```

## DOM State

`next-themes` manages the `class` attribute on `<html>`:

| Theme Setting     | resolvedTheme | HTML class     | Tailwind dark: active? |
| ----------------- | ------------- | -------------- | ---------------------- |
| light             | light         | (no class)     | No                     |
| dark              | dark          | `class="dark"` | Yes                    |
| system (OS=light) | light         | (no class)     | No                     |
| system (OS=dark)  | dark          | `class="dark"` | Yes                    |

## Validation Rules

- Theme value MUST be one of: `"light"`, `"dark"`, `"system"`
- Invalid localStorage values are treated as `"system"` (default)
- Cleared localStorage results in `"system"` (default)
- No server-side validation needed (frontend-only)

## Relationships

- **No database entities** are affected by this feature
- **No API contracts** change
- Theme preference is completely independent of user authentication state
- Theme works identically for authenticated and unauthenticated users
