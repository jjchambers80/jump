# Frontend - Jump Tickets

React + TypeScript frontend for the Jump online ticket sales platform.

## Overview

Customer-facing web application for browsing events and purchasing tickets with QR code delivery.

## Tech Stack

- **React 18** - UI framework
- **TypeScript** - Type safety
- **React Router** - Client-side routing
- **Tailwind CSS** - Utility-first styling
- **Vite** - Build tool and dev server

## Project Structure

```
frontend/src/
├── components/          # Reusable UI components
│   ├── EventCard.tsx   # Event summary card
│   ├── TicketDisplay.tsx # Ticket with QR code
│   ├── PaymentForm.tsx  # Checkout form
│   └── index.ts        # Component exports
├── pages/              # Route pages
│   ├── customer/       # Customer-facing pages
│   │   ├── EventList.tsx      # Browse events
│   │   ├── EventDetail.tsx    # Event details
│   │   ├── Checkout.tsx       # Payment checkout
│   │   ├── Confirmation.tsx   # Post-purchase
│   │   └── index.ts
│   ├── admin/          # Admin pages (future)
│   └── auth/           # Auth pages (future)
├── services/           # API clients
│   ├── api.ts          # Base API client
│   └── ...             # Service wrappers (future)
├── hooks/              # Custom React hooks
│   └── useAuth.ts      # Authentication hook
└── App.tsx             # Root component

```

## Components

### EventCard

Displays event summary with:

- Event name, date, time, venue
- Ticket price
- Availability status (available, almost sold out, sold out)
- Link to event details

**Props:**

```typescript
event: {
  id: string;
  name: string;
  description: string;
  venue: string;
  eventDate: string;
  ticketPrice: number;
  availableTickets: number;
  totalTickets: number;
}
```

### TicketDisplay

Shows purchased ticket with QR code:

- Event details (name, date, time, venue)
- QR code image for venue entry
- Ticket ID and customer email
- Security notices

**Props:**

```typescript
ticket: {
  id: string;
  qrCodeImage?: string;
  event: { name, venue, eventDate };
  customer: { email };
}
```

### PaymentForm

Checkout form for ticket purchase:

- Order summary (event, quantity, total)
- Email input with validation
- Stripe payment integration notice
- Loading states

**Props:**

```typescript
event: { id, name, ticketPrice };
quantity: number;
onSubmit: (data: { email: string }) => Promise<void>;
isLoading?: boolean;
```

## Pages

### EventList (`/events`)

Browse all published events:

- Grid layout (responsive: 1/2/3 columns)
- Pagination controls
- Loading and error states
- Links to event details

### EventDetail (`/events/:eventId`)

View single event:

- Full event description
- Date, time, venue info
- Quantity selector (1-10 tickets)
- Real-time price calculation
- "Continue to Checkout" button
- Availability indicators

### Checkout (`/checkout/:eventId?quantity=N`)

Complete purchase:

- Event summary
- Payment form (email collection)
- Security notices
- Redirects to Stripe Checkout
- Error handling for sold-out events

### Confirmation (`/confirmation?session_id=XXX`)

Post-purchase success:

- Success message
- Display all purchased tickets with QR codes
- Email confirmation notice
- Print tickets button
- Next steps guidance

## User Flow

1. **Browse Events**
   - User lands on `/events`
   - Views list of published events
   - Clicks event card to see details

2. **Select Tickets**
   - User views event details at `/events/:id`
   - Selects quantity (1-10)
   - Clicks "Continue to Checkout"

3. **Checkout**
   - User lands on `/checkout/:id?quantity=2`
   - Reviews order summary
   - Enters email address
   - Clicks "Proceed to Payment"
   - Redirected to Stripe Checkout

4. **Payment**
   - User completes payment on Stripe hosted page
   - Stripe redirects to `/confirmation?session_id=XXX`

5. **Confirmation**
   - System fetches tickets via `/tickets/confirm`
   - User sees QR codes
   - Receives email with tickets
   - Can print tickets

## API Integration

All pages use the `api` service from `services/api.ts`:

```typescript
import { api } from '../../services/api';

// List events
const response = await api.get<EventListResponse>('/events?page=1&limit=12');

// Get event details
const response = await api.get<{ event: Event }>(`/events/${eventId}`);

// Purchase tickets (creates Stripe session)
const response = await api.post<{ sessionId; checkoutUrl }>('/tickets/purchase', {
  eventId,
  quantity,
  email,
});

// Confirm purchase (issues tickets)
const response = await api.get<{ tickets: Ticket[] }>(`/tickets/confirm?session_id=${sessionId}`);
```

## Styling

Built with **Tailwind CSS** utility classes:

- **Responsive**: Mobile-first with `sm:`, `md:`, `lg:` breakpoints
- **Colors**: Blue primary (`blue-600`), gray neutrals
- **Status Colors**:
  - Green for available (`green-600`)
  - Yellow for almost sold out (`yellow-600`)
  - Red for sold out (`red-600`)

## Development

```bash
# Install dependencies
cd frontend
npm install

# Start dev server
npm run dev
# Opens http://localhost:5173

# Build for production
npm run build

# Preview production build
npm run preview
```

## Environment Variables

Frontend uses the API client's base URL configuration (see `services/api.ts`).

For local development, backend should run on `http://localhost:3000`.

## Testing

### Unit Tests

```bash
npm test
```

### E2E Tests (Playwright)

```bash
npm run test:e2e
```

The E2E test covers the full customer journey:

1. Browse events
2. Select event
3. Choose quantity
4. Checkout
5. Stripe payment simulation
6. Ticket confirmation with QR codes

## Error Handling

All pages implement:

- **Loading States**: Spinners while fetching data
- **Error States**: User-friendly error messages with retry
- **Form Validation**: Real-time validation with error feedback
- **Network Errors**: Graceful handling with error boundaries

## Accessibility

- Semantic HTML (`<button>`, `<nav>`, `<main>`)
- ARIA labels on interactive elements
- Keyboard navigation support
- Focus states on interactive elements

**Future Enhancements:**

- Screen reader announcements
- ARIA live regions for dynamic content
- High contrast mode support
- Reduced motion support

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Production Deployment

```bash
# Build optimized bundle
npm run build

# Output in dist/ directory
# Deploy dist/ to CDN or static hosting
```

**Recommended hosting:**

- Vercel (automatic CI/CD)
- Netlify (automatic CI/CD)
- AWS S3 + CloudFront
- Azure Static Web Apps

## Future Enhancements

### Customer Features

- **Event Search**: Filter by date, venue, price
- **Event Categories**: Music, Sports, Theater, etc.
- **Favorites**: Save events to wishlist
- **Customer Dashboard**: View past purchases
- **Ticket Transfer**: Send tickets to friends
- **Mobile App**: React Native version

### Admin Features

- **Event Management**: Create, edit, delete events
- **Analytics Dashboard**: Sales, revenue, attendance
- **Customer Management**: View customer list
- **Ticket Scanning**: QR code verification app

### Technical Enhancements

- **State Management**: Redux or Zustand for complex state
- **Code Splitting**: React.lazy for route-based splitting
- **PWA**: Service workers for offline support
- **i18n**: Multi-language support
- **Dark Mode**: Theme toggle

## Contributing

Follow the project's Constitution principles:

- Write tests FIRST (TDD)
- Use TypeScript for type safety
- Follow responsive design patterns
- Add error handling and loading states

## Support

For questions or issues:

- Email: support@jump.com
- Documentation: See `/docs` in project root
