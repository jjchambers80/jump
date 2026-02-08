# Research: Theme Modes (Dark, Light & Auto)

**Feature**: 002-theme-modes
**Date**: 2026-02-07
**Status**: Complete

## Research Tasks

### R1: SSR-Safe Theme Management Library

**Question**: What library should be used for SSR-safe theme switching in Next.js 14 App Router?

**Decision**: `next-themes` (^0.4.x) by pacocoursey

**Rationale**:

- Purpose-built for Next.js with first-class App Router support
- Prevents FOUC via inline script injection before first paint
- Handles localStorage persistence automatically
- Supports system preference detection with `enableSystem` prop
- Responds to real-time OS theme changes via `matchMedia` listener
- Minimal footprint (~2KB gzipped)
- 4,900+ GitHub stars, actively maintained
- "Perfect Next.js dark mode in 2 lines of code"

**Alternatives Considered**:

- **Manual implementation (React Context + matchMedia)**: Higher maintenance burden, must handle FOUC prevention manually (inline script in `_document` or `<head>`), must implement localStorage sync. Rejected for unnecessary complexity.
- **`use-dark-mode`**: Older library, no App Router support, no SSR script injection.
- **Tailwind `darkMode: 'media'` only**: No user toggle, only follows OS. Doesn't meet FR-001 (three modes).

### R2: Tailwind CSS Dark Mode Configuration

**Question**: How should Tailwind CSS be configured for class-based dark mode with next-themes?

**Decision**: Use `darkMode: 'class'` in `tailwind.config.js` with `next-themes` `attribute="class"` prop.

**Rationale**:

- Tailwind 3.4.1 supports both `'class'` and `'selector'` strategies
- `'class'` is the traditional approach: adds/removes `.dark` class on `<html>`
- `'selector'` (Tailwind 3.4.1+) uses `[data-mode="dark"]` selector -- more flexible but requires custom `next-themes` attribute config
- `'class'` is simpler, better documented, and is the standard `next-themes` integration pattern
- `next-themes` with `attribute="class"` adds `class="dark"` to `<html>`, which Tailwind's `dark:` prefix detects

**Configuration**:

```js
// tailwind.config.js
module.exports = {
  darkMode: "class",
  // ... rest of config
};
```

```tsx
// ThemeProvider wrapper
<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
  {children}
</ThemeProvider>
```

**Alternatives Considered**:

- **`darkMode: 'selector'`**: Works with Tailwind 3.4.1+ but requires `attribute="data-mode"` and custom selector config `['selector', '[data-mode="dark"]']`. More complex for no benefit in this use case.
- **`darkMode: 'media'`**: CSS-only, no class toggling. Cannot support manual light/dark override. Rejected because it doesn't support FR-001.

### R3: FOUC Prevention Strategy

**Question**: How to prevent flash of incorrect theme on page load?

**Decision**: Rely on `next-themes` built-in script injection + `suppressHydrationWarning` on `<html>`.

**Rationale**:

- `next-themes` injects an inline `<script>` before the page renders that reads localStorage and sets the `class` attribute on `<html>` synchronously
- This happens before React hydration, so the correct theme is applied from the first paint
- `suppressHydrationWarning` on `<html>` is required because the server renders without a theme class, but the client-side script adds it before hydration
- No additional configuration needed -- this is the default behavior of `next-themes`

**Implementation**:

```tsx
// app/layout.tsx
export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
```

**Alternatives Considered**:

- **Manual inline script in `<head>`**: Requires custom `_document.tsx` override (Pages Router pattern), doesn't work cleanly with App Router. `next-themes` handles this internally.
- **CSS `prefers-color-scheme` media query only**: Would prevent FOUC for system-theme users but not for users who manually selected a different theme.

### R4: Theme Toggle UX Pattern (Cycling Icon Button)

**Question**: How should the cycling icon button work for three theme modes?

**Decision**: Single icon button that cycles Light -> Dark -> Auto on click. Uses SVG icons: sun (light), moon (dark), monitor/auto indicator (system). Renders `null` until mounted to prevent hydration mismatch.

**Rationale**:

- Per spec clarification: cycling icon button was explicitly chosen over dropdown or segmented control
- Three-state cycle: `light` -> `dark` -> `system` -> `light` -> ...
- Must use `mounted` guard pattern (useState + useEffect) to avoid hydration mismatch since theme is unknown on server
- Tooltip shows current mode name for discoverability
- ARIA: `role="button"`, `aria-label` dynamically reflects current state (e.g., "Switch to dark mode")

**Implementation Pattern**:

```tsx
"use client";
import { useTheme } from "next-themes";
import { useState, useEffect } from "react";

export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => setMounted(true), []);
  if (!mounted) return null; // Prevent hydration mismatch

  const cycleTheme = () => {
    if (theme === "light") setTheme("dark");
    else if (theme === "dark") setTheme("system");
    else setTheme("light");
  };

  // Render appropriate icon based on theme
  return (
    <button onClick={cycleTheme} aria-label={`Current theme: ${theme}`}>
      {/* sun / moon / monitor icon */}
    </button>
  );
}
```

**Alternatives Considered**:

- **Dropdown select**: More accessible for discovering all options but takes more space. Rejected per clarification.
- **Segmented control (3 buttons)**: Clearest but uses too much navbar space. Rejected per clarification.

### R5: Dark Mode Color Palette

**Question**: What color palette should be used for dark mode backgrounds and surfaces?

**Decision**: Dark gray/slate tones with layered depth hierarchy. Not pure black (#000). Complements existing blue brand accents.

**Rationale**:

- Per spec clarification: dark gray/slate was explicitly chosen over pure black
- Pure black (#000) causes excessive contrast with white text and a "floating" effect on OLED screens
- Dark slate tones feel warmer and more professional

**Palette**:
| Surface Layer | Light Mode | Dark Mode | Tailwind Class |
|--------------|-----------|-----------|---------------|
| Page background | #f9fafb (gray-50) | #0f172a (slate-900) | `bg-gray-50 dark:bg-slate-900` |
| Card/Surface | #ffffff (white) | #1e293b (slate-800) | `bg-white dark:bg-slate-800` |
| Elevated surface | #ffffff (white) | #334155 (slate-700) | `bg-white dark:bg-slate-700` |
| Input/form fields | #ffffff (white) | #1e293b (slate-800) | `bg-white dark:bg-slate-800` |
| Primary text | #111827 (gray-900) | #f1f5f9 (slate-100) | `text-gray-900 dark:text-slate-100` |
| Secondary text | #4b5563 (gray-600) | #94a3b8 (slate-400) | `text-gray-600 dark:text-slate-400` |
| Muted text | #9ca3af (gray-400) | #64748b (slate-500) | `text-gray-400 dark:text-slate-500` |
| Border | #e5e7eb (gray-200) | #334155 (slate-700) | `border-gray-200 dark:border-slate-700` |
| Brand accent | #4f46e5 (indigo-600) | #818cf8 (indigo-400) | `text-indigo-600 dark:text-indigo-400` |
| Hover accent | #4338ca (indigo-700) | #6366f1 (indigo-500) | `hover:text-indigo-700 dark:hover:text-indigo-500` |
| Primary button bg | #4f46e5 (indigo-600) | #4f46e5 (indigo-600) | Same in both modes |
| Danger | #dc2626 (red-600) | #f87171 (red-400) | `text-red-600 dark:text-red-400` |
| Shadow | shadow-sm | shadow-lg (darker) | `shadow-sm dark:shadow-lg dark:shadow-black/20` |

**Alternatives Considered**:

- **Pure black (#000)**: Too harsh, poor depth perception. Rejected per clarification.
- **Custom hex palette (non-Tailwind)**: Would require custom theme config. Rejected for simplicity -- Tailwind's built-in slate/gray scale provides excellent dark mode colors out of the box.

### R6: CSS Custom Property Alignment

**Question**: The current globals.css defines `--foreground-rgb`, `--background-start-rgb`, `--background-end-rgb` but tailwind.config.js references `var(--background)` and `var(--foreground)`. How to reconcile?

**Decision**: Replace the mismatched CSS custom properties with a clean set that works for both light and dark modes, referenced consistently in both globals.css and tailwind.config.js.

**Rationale**:

- Current state is broken: tailwind config references variables that don't exist in CSS
- The `-rgb` suffix pattern and gradient backgrounds are unnecessarily complex for this app
- Simplify to straightforward CSS custom properties that `next-themes` + Tailwind `dark:` classes handle naturally
- Most components will use Tailwind utility classes directly (e.g., `bg-white dark:bg-slate-800`) rather than CSS variables

**Implementation**:

```css
/* globals.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --background: #f9fafb;
  --foreground: #111827;
}

.dark {
  --background: #0f172a;
  --foreground: #f1f5f9;
}

body {
  color: var(--foreground);
  background-color: var(--background);
  min-height: 100vh;
}
```

### R7: Theme Transition Animation

**Question**: How to implement smooth ~150ms transitions on theme change without applying them on initial page load?

**Decision**: Use CSS transitions on `background-color` and `color` with `transition-colors` Tailwind utility. Do NOT use `next-themes` `disableTransitionOnChange` prop (which removes all transitions). Instead, rely on `next-themes`' script injection which applies the theme class synchronously before paint, so CSS transitions naturally don't fire on load.

**Rationale**:

- `next-themes` applies the theme class via inline script before React renders, so there's no class change on initial load = no transition fires
- CSS transitions only fire when a class actually changes (user clicking toggle)
- Tailwind's `transition-colors` utility applies `transition-property: color, background-color, border-color, text-decoration-color, fill, stroke` with `duration-150` by default
- Adding `transition-colors duration-150` to key elements (body, cards, nav) gives the smooth feel
- No JS needed to conditionally enable/disable transitions

**Implementation**:

```css
/* On body or key wrapper elements */
body {
  @apply transition-colors duration-150;
}
```

**Alternatives Considered**:

- **`disableTransitionOnChange`**: This next-themes prop removes ALL transitions during theme switch. Opposite of what we want.
- **JS-based transition guard**: Add/remove a `no-transition` class on load via useEffect. Over-engineered when the script injection naturally prevents load-time transitions.

### R8: Playwright E2E Testing Strategy

**Question**: How to test theme modes with Playwright including system preference emulation?

**Decision**: Use Playwright's `page.emulateMedia({ colorScheme: 'dark' })` for system preference tests, `page.evaluate(() => localStorage.setItem('theme', 'dark'))` for persistence tests, and DOM assertions for class checking.

**Rationale**:

- Playwright natively supports `colorScheme` emulation (FR-003, FR-004)
- localStorage can be inspected/set via `page.evaluate` (FR-005)
- `document.documentElement.classList.contains('dark')` verifies theme application
- Visual regression is out of scope for MVP -- functional assertions are sufficient
- FOUC testing: measure time between navigation and correct theme class via performance marks or simple timing assertions

**Test Categories**:

1. **Toggle cycling**: Click button, verify class changes light -> dark -> system
2. **Persistence**: Set theme, reload page, verify same theme
3. **System preference**: Emulate dark/light OS preference with auto mode
4. **Real-time response**: Change emulated `colorScheme` while page is open
5. **Accessibility**: Verify `aria-label` on toggle button, keyboard operability
6. **No FOUC**: Navigate to page, verify correct class is present immediately (no intermediate wrong state)
