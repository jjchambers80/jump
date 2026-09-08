# Org Switcher

**Status:** Implemented
**Last Updated:** 2026-09-07

## Overview

Global organization context selector in the admin header. Users with access to multiple organizations can switch context, which determines which events, venues, and settings are displayed across all admin views. Includes a user menu with sign-out.

## Key Files

| File | Purpose |
|------|---------|
| `frontend/src/components/admin/` | Admin header components including org switcher and user menu |

## How It Works

1. On admin page load, the user's accessible organizations are fetched.
2. The org switcher dropdown in the admin header shows all available organizations.
3. User selects an organization to set it as the active context.
4. All admin views (events, venues, settings) filter data based on the selected org.
5. User menu provides sign-out and account options.

## Gotchas

- Org context affects all admin views — switching orgs changes the entire admin data scope.
- Data must refresh when the org changes; stale data from a previous org can cause confusion.
- Users with only one org may still see the switcher but cannot change context.

## Related Features

- [RBAC](rbac.md) — org membership and roles determine which orgs appear in the switcher.
- [Theme System](theme-system.md) — ThemeToggle coexists in the admin header.
