# Data Model: Admin Area (004)

**Date**: 2025-02-15 | **Branch**: `004-admin-area`

## Overview

This feature introduces **no new entities or schema changes**. It is a frontend-only restructuring that consolidates existing admin pages under the `/admin` route, protected by the existing `UserRole` enum.

This document records the existing data model elements relevant to the admin area for reference.

## Existing Entities (No Changes)

### User

| Field | Type            | Description                               |
| ----- | --------------- | ----------------------------------------- |
| id    | String (CUID)   | Primary key                               |
| name  | String?         | Display name                              |
| email | String (unique) | Login identifier                          |
| role  | UserRole        | Access control role (default: CUSTOMER)   |
| ...   | ...             | Other fields not relevant to this feature |

**Source**: `packages/db/prisma/schema.prisma` → `model User`

### UserRole (Enum)

| Value       | Description                            | Admin Area Access |
| ----------- | -------------------------------------- | ----------------- |
| `CUSTOMER`  | Default role for ticket buyers         | **Denied** (403)  |
| `ORGANIZER` | Event organizers managing their events | **Allowed**       |
| `ADMIN`     | Platform administrators                | **Allowed**       |

**Source**: `packages/db/prisma/schema.prisma` → `enum UserRole`

## Authorization Flow

```text
User Request → Edge Middleware (auth check) → Admin Layout (role check) → Page

1. Edge Middleware (middleware.ts):
   - Checks: Is user authenticated?
   - Action: Redirect to /auth/signin if not
   - Note: Cannot check role (edge runtime, no DB)

2. Admin Layout (admin/layout.tsx → AdminRoute):
   - Checks: Is session.user.role === 'ADMIN' || 'ORGANIZER'?
   - Action: Show 403 page if role insufficient
   - Note: Client-side check, defense-in-depth

3. Backend API (independent):
   - Checks: Role-based middleware on each endpoint
   - Action: Returns 403 if unauthorized
   - Note: True enforcement layer, not affected by this feature
```

## State Transitions

No state transitions introduced. The `UserRole` enum is static — role changes are an existing admin operation not modified by this feature.

## Validation Rules

| Rule                                           | Source | Enforcement                   |
| ---------------------------------------------- | ------ | ----------------------------- |
| Only ADMIN and ORGANIZER can access `/admin/*` | FR-001 | AdminRoute component (client) |
| CUSTOMER sees 403 when accessing `/admin/*`    | FR-002 | AdminRoute component (client) |
| Unauthenticated users redirected to sign-in    | FR-003 | Edge middleware               |

## Relationships

No new relationships. The existing `User.role` field is the sole data point used by this feature.
