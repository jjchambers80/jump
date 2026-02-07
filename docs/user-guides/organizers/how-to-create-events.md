# How to Create Events

A step-by-step guide for event organizers using the Jump Tickets admin portal.

## Overview

As an event organizer (admin), you can create events, set capacity and pricing, publish events for customers to purchase tickets, and monitor sales in real time through your admin dashboard.

## Prerequisites

- An admin account (created by a system administrator)
- Login credentials (email and password)

## Step 1: Log In to the Admin Portal

1. Navigate to the Jump Tickets site
2. Click **"Sign In"** in the navigation bar
3. Enter your admin email and password
4. Click **"Sign In"**
5. You'll be redirected to the **Admin Dashboard**

## Step 2: Create a New Event

1. From the Admin Dashboard, click **"Create Event"**
2. Fill in the event details:

| Field            | Description                         | Requirements                    |
| ---------------- | ----------------------------------- | ------------------------------- |
| **Event Name**   | Name displayed to customers         | Required, max 255 characters    |
| **Date & Time**  | When the event takes place          | Required, must be in the future |
| **Venue**        | Location of the event               | Required, max 500 characters    |
| **Capacity**     | Maximum number of tickets available | Required, 1–100,000             |
| **Ticket Price** | Price per ticket in USD             | Required, minimum $0.00         |

3. Click **"Create Event"**
4. Your event will be created in **Draft** status

> **Important**: Draft events are NOT visible to customers. You must publish an event before tickets can be purchased.

## Step 3: Publish the Event

1. On the Admin Dashboard, find your event in the event list
2. Click the **"Publish"** button next to the event
3. The event status will change from **Draft** to **Published**
4. The event is now visible on the public events page and customers can purchase tickets

> **Note**: Once published, the event will appear in the customer-facing event listing immediately.

## Step 4: Monitor Sales

The Admin Dashboard provides real-time metrics that auto-refresh every 5 seconds:

### Dashboard Stats

| Metric                 | Description                               |
| ---------------------- | ----------------------------------------- |
| **Total Events**       | Number of events you've created           |
| **Total Capacity**     | Combined capacity across all your events  |
| **Total Tickets Sold** | Number of tickets purchased across events |
| **Remaining Tickets**  | Available tickets across all events       |

### Event List

Each event in your dashboard shows:

- Event name and status (Draft/Published)
- Date and venue
- Tickets sold vs. total capacity
- Action buttons (Edit, Publish)

## Event Management

### Editing Events

1. Click **"Edit"** next to an event on the dashboard
2. Modify the event details as needed
3. Save your changes

> **Restriction**: You can only edit events that you created (organizer ownership is enforced).

### Event Statuses

| Status        | Visibility | Can Sell Tickets? |
| ------------- | ---------- | ----------------- |
| **Draft**     | Admin only | No                |
| **Published** | Everyone   | Yes               |

## Access Control

- Only admin accounts can access the admin portal
- Customers attempting to access admin routes will receive a 403 Forbidden error
- Each admin can only manage their own events

## Troubleshooting

### Can't See My Events

- Ensure you're logged in with your admin account
- The dashboard only shows events you created

### Event Not Appearing for Customers

- Verify the event status is **Published** (not Draft)
- Check that the event date is in the future

### Dashboard Not Updating

- The dashboard auto-refreshes every 5 seconds
- If metrics seem stale, try refreshing the page manually

## Need Help?

Contact your system administrator for account issues or technical support.
