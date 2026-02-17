# Admin Area User Guide

## Overview

The admin area is accessible at `/admin` and is restricted to users with **Admin** or **Organizer** roles. It provides a centralized interface for managing events, organizations, venues, analytics, ticket scanning, and user management.

## Accessing the Admin Area

1. Sign in to your account
2. Click the **Admin** link in the top navigation bar
3. You'll be redirected to the admin dashboard

> **Note**: The "Admin" link only appears for users with Admin or Organizer roles. Customer accounts cannot access the admin area.

## Navigation

### Sidebar

The sidebar appears on the left side of every admin page and provides quick navigation to all admin sections:

| Section       | Path                   | Description                        | Access           |
| ------------- | ---------------------- | ---------------------------------- | ---------------- |
| Dashboard     | `/admin/dashboard`     | Overview and quick actions         | Admin, Organizer |
| Organizations | `/admin/organizations` | Manage organizations               | Admin, Organizer |
| Venues        | `/admin/venues`        | Manage venues                      | Admin, Organizer |
| Events        | `/admin/events`        | Manage events and create new ones  | Admin, Organizer |
| Analytics     | `/admin/analytics`     | View ticket sales and revenue data | Admin, Organizer |
| Scan          | `/admin/scan`          | Scan and validate tickets at entry | Admin, Organizer |
| Users         | `/admin/users`         | Manage user accounts and roles     | **Admin only**   |

### Quick Actions

- **Create Event** button at the bottom of the sidebar for quick access to event creation

### Active State

The current page is highlighted in the sidebar with an indigo background, making it easy to see where you are.

## Role-Based Access

### Admin Role

- Full access to all admin sections
- Can manage users (assign roles, activate/deactivate accounts)
- Can access all organization, venue, and event management features

### Organizer Role

- Access to all admin sections **except User Management**
- The "Users" link is hidden from the sidebar
- Attempting to navigate directly to `/admin/users` shows an "Access Denied" message

### Customer Role

- **Cannot access the admin area**
- Navigating to `/admin` shows a 403 "Access Denied" page with a "Back to Events" button
- The "Admin" link does not appear in the navigation bar

## Mobile Usage

On mobile devices (screens narrower than 768px):

1. The sidebar is hidden by default
2. A **hamburger menu** (☰) appears in the top-left corner
3. Tap the hamburger menu to slide open the sidebar
4. Tap any link to navigate — the sidebar closes automatically
5. Tap the **X** button or the dark overlay to close the sidebar

## Key Pages

### Dashboard (`/admin/dashboard`)

The landing page when entering the admin area. Provides an overview of recent activity and quick access to common tasks.

### Events (`/admin/events`)

View all events for an organization. From here you can:

- Create a new event
- View event details
- Access per-event analytics

### Analytics (`/admin/analytics`)

A cross-event analytics view with:

- Date range filtering
- Aggregate statistics (total sold, revenue, remaining capacity)
- Per-event sell-through rates
- Links to detailed per-event analytics

### Scan (`/admin/scan`)

Ticket validation for event entry:

- Paste or scan a QR code payload
- See immediate pass/fail verdict
- View ticket details for valid scans
- See rejection reason for invalid/redeemed tickets

### Users (`/admin/users`) — Admin Only

User account management:

- View all registered users with pagination
- Filter by role (Customer, Organizer, Admin)
- Change user roles
- Activate/deactivate accounts
- Cannot modify your own account (safety guard)
