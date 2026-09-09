# Jump Tickets - System Architecture

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CUSTOMER BROWSER                        │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────┐  │
│  │  EventList   │  │ EventDetail  │  │     Checkout        │  │
│  │  Component   │→ │  Component   │→ │     Component       │  │
│  └──────────────┘  └──────────────┘  └─────────────────────┘  │
│                                              ↓                  │
│                                       ┌──────────────────────┐ │
│                                       │  Stripe Checkout     │ │
│                                       │  (Hosted Payment)    │ │
│                                       └──────────────────────┘ │
│                                              ↓                  │
│                                       ┌──────────────────────┐ │
│                                       │  Confirmation        │ │
│                                       │  Component           │ │
│                                       └──────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                            ↕ HTTP/HTTPS
┌─────────────────────────────────────────────────────────────────┐
│                        EXPRESS API SERVER                       │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                      API ROUTES                           │ │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │ │
│  │  │   Events    │  │   Tickets    │  │   Webhooks     │  │ │
│  │  │  GET /      │  │ POST /purchase│ │ POST /stripe   │  │ │
│  │  │  GET /:id   │  │ GET /confirm │  │                │  │ │
│  │  └─────────────┘  └──────────────┘  └────────────────┘  │ │
│  └───────────────────────────────────────────────────────────┘ │
│                            ↓                                    │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                  MIDDLEWARE LAYER                         │ │
│  │  • Request Validation                                     │ │
│  │  • Error Handling                                         │ │
│  │  • Logging (Winston + Correlation IDs)                    │ │
│  │  • Metrics (Prometheus)                                   │ │
│  └───────────────────────────────────────────────────────────┘ │
│                            ↓                                    │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                    SERVICE LAYER                          │ │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │ │
│  │  │   Event     │  │   Payment    │  │    Ticket      │  │ │
│  │  │  Service    │  │   Service    │  │   Service      │  │ │
│  │  └─────────────┘  └──────────────┘  └────────────────┘  │ │
│  │  ┌─────────────┐  ┌──────────────┐                      │ │
│  │  │     QR      │  │    Email     │                      │ │
│  │  │  Service    │  │   Service    │                      │ │
│  │  └─────────────┘  └──────────────┘                      │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
         ↓                ↓                 ↓                ↓
    ┌────────┐      ┌─────────┐       ┌────────┐      ┌──────────┐
    │ Prisma │      │ Stripe  │       │SendGrid│      │  Redis   │
    │  ORM   │      │   API   │       │  API   │      │  Cache   │
    └────────┘      └─────────┘       └────────┘      └──────────┘
         ↓
    ┌────────────────────────────────────────┐
    │         PostgreSQL Database            │
    │  ┌──────────────────────────────────┐  │
    │  │ Tables:                          │  │
    │  │ • Admin                          │  │
    │  │ • Customer                       │  │
    │  │ • Event                          │  │
    │  │ • Ticket                         │  │
    │  │ • PaymentTransaction             │  │
    │  │ • Session                        │  │
    │  └──────────────────────────────────┘  │
    └────────────────────────────────────────┘
```

## Request Flow: Ticket Purchase

```
1. BROWSE EVENTS
   Customer → GET /events
   ↓
   EventService.listPublishedEvents()
   ↓
   Prisma query: SELECT * FROM Event WHERE status='PUBLISHED'
   ↓
   Response: [{events with availability}]

2. VIEW EVENT DETAILS
   Customer → GET /events/:id
   ↓
   EventService.getEventById()
   ↓
   Prisma query: SELECT * FROM Event WHERE id=? AND status='PUBLISHED'
   ↓
   Response: {event with ticket count}

3. INITIATE PURCHASE
   Customer → POST /tickets/purchase {eventId, quantity, email}
   ↓
   Validation: quantity (1-10), email format, UUID
   ↓
   PaymentService.createStripeCheckoutSession()
   ↓
   Check capacity: EventService.getEventWithTicketCount()
   ↓
   Create Stripe session: stripe.checkout.sessions.create()
   ↓
   Save PaymentTransaction: status=PENDING
   ↓
   Response: {sessionId, checkoutUrl}
   ↓
   Redirect to Stripe Checkout

4. STRIPE PAYMENT
   Customer enters card details on Stripe hosted page
   ↓
   Stripe processes payment
   ↓
   Stripe webhook → POST /webhooks/stripe
   ↓
   Verify signature: stripe.webhooks.constructEvent()
   ↓
   PaymentService.updatePaymentStatus()
   ↓
   Update PaymentTransaction: status=SUCCEEDED
   ↓
   Stripe redirects customer → /confirmation?session_id=XXX

5. ISSUE TICKETS
   Customer → GET /tickets/confirm?session_id=XXX
   ↓
   PaymentService.getPaymentBySessionId()
   ↓
   Check if tickets already issued (idempotency)
   ↓
   TicketService.createTicketsAfterPayment()
   ↓
   BEGIN TRANSACTION
     Lock event row: SELECT * FROM Event WHERE id=? FOR UPDATE
     Check capacity
     Loop for quantity:
       INSERT INTO Ticket (customerId, eventId, status=VALID)
   COMMIT TRANSACTION
   ↓
   For each ticket:
     QRService.generateQRCodeJWT()
     ↓
     Create JWT payload: {ticket_id, event_id, email, ...}
     Sign with HMAC-SHA256
     ↓
     QRService.generateQRCodeImage()
     ↓
     Convert JWT to QR code PNG (base64)
     ↓
     TicketService.updateTicketQRCode()
   ↓
   EmailService.sendTicketEmail()
   ↓
   Try 3 times:
     Build HTML email with QR codes embedded
     SendGrid.send()
   ↓
   Response: {tickets: [...]} with QR code images
```

## Data Flow: QR Code Generation

```
Ticket Data
    ↓
┌───────────────────────────────────────┐
│         QRService                     │
│                                       │
│  1. Create JWT Payload                │
│     {                                 │
│       ticket_id: "uuid",              │
│       event_id: "uuid",               │
│       customer_email: "email",        │
│       event_name: "name",             │
│       event_date: "ISO",              │
│       venue: "location",              │
│       issued_at: timestamp            │
│     }                                 │
│                                       │
│  2. Calculate Expiration              │
│     expiration = event_date + 24h     │
│                                       │
│  3. Sign with HMAC-SHA256             │
│     jwt.sign(payload, JWT_SECRET)     │
│                                       │
│  4. Generate QR Image                 │
│     QRCode.toDataURL(jwt)             │
│                                       │
└───────────────────────────────────────┘
    ↓
JWT Token (Signed)
    ↓
Base64 PNG Image
    ↓
Embedded in Email + Stored in DB
```

## Database Schema (Simplified)

```
┌─────────────────┐
│     Admin       │
│─────────────────│
│ id (PK)         │
│ email           │
│ passwordHash    │
│ createdAt       │
└─────────────────┘

┌─────────────────┐
│    Customer     │
│─────────────────│
│ id (PK)         │
│ email           │
│ name            │
│ createdAt       │
└─────────────────┘
        │
        │ 1:N
        ↓
┌─────────────────┐
│     Ticket      │
│─────────────────│
│ id (PK)         │
│ customerId (FK) │───→ Customer
│ eventId (FK)    │───→ Event
│ qrCodeJwt       │
│ status          │ (VALID, REDEEMED, CANCELLED)
│ redeemedAt      │
│ createdAt       │
└─────────────────┘
        │
        │ N:1
        ↓
┌─────────────────┐
│      Event      │
│─────────────────│
│ id (PK)         │
│ name            │
│ description     │
│ venue           │
│ eventDate       │
│ capacity        │
│ ticketPrice     │
│ status          │ (DRAFT, PUBLISHED, CANCELLED)
│ createdBy (FK)  │───→ Admin
│ createdAt       │
└─────────────────┘

┌──────────────────────┐
│ PaymentTransaction   │
│──────────────────────│
│ id (PK)              │
│ eventId (FK)         │───→ Event
│ customerId (FK)      │───→ Customer
│ stripeSessionId      │
│ amount               │
│ status               │ (PENDING, SUCCEEDED, FAILED)
│ createdAt            │
│ updatedAt            │
└──────────────────────┘
```

## Security Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      SECURITY LAYERS                        │
│                                                             │
│  1. INPUT VALIDATION                                        │
│     • Email format validation                               │
│     • UUID format validation                                │
│     • Quantity range check (1-10)                           │
│     • XSS prevention (sanitization)                         │
│                                                             │
│  2. AUTHENTICATION                                          │
│     • Session-based auth (Redis)                            │
│     • JWT tokens for QR codes (HS256)                       │
│     • Bcrypt password hashing                               │
│                                                             │
│  3. AUTHORIZATION                                           │
│     • Role-based access control (Admin/Customer)            │
│     • Event ownership checks                                │
│     • Ticket ownership verification                         │
│                                                             │
│  4. DATA INTEGRITY                                          │
│     • HMAC-SHA256 QR code signing                           │
│     • Stripe webhook signature verification                 │
│     • Database constraints (foreign keys, unique)           │
│     • Atomic transactions (ACID)                            │
│                                                             │
│  5. ENCRYPTION                                              │
│     • HTTPS/TLS for all traffic                             │
│     • Password hashing (Bcrypt)                             │
│     • JWT secret rotation (recommended)                     │
│     • Environment variable protection                       │
│                                                             │
│  6. RATE LIMITING (Future)                                  │
│     • API rate limits (per IP)                              │
│     • Brute force protection                                │
│     • DDoS mitigation                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Technology Stack

```
┌─────────────────────────────────────────────────────────────┐
│                        FRONTEND                             │
│  • React 18 (UI Framework)                                  │
│  • TypeScript (Type Safety)                                 │
│  • React Router (Client Routing)                            │
│  • Tailwind CSS (Styling)                                   │
│  • Vite (Build Tool)                                        │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                        BACKEND                              │
│  • Node.js 18+ (Runtime)                                    │
│  • Express.js (Web Framework)                               │
│  • Prisma 5 (ORM)                                           │
│  • Winston (Logging)                                        │
│  • Prometheus (Metrics)                                     │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                      EXTERNAL SERVICES                      │
│  • Stripe (Payment Processing)                              │
│  • SendGrid (Email Delivery)                                │
│  • Redis (Session Storage)                                  │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                       DATABASE                              │
│  • PostgreSQL 15+ (Relational Database)                     │
│  • Prisma Migrations (Schema Management)                    │
└─────────────────────────────────────────────────────────────┘
```

## Deployment Architecture (Future)

```
┌─────────────────────────────────────────────────────────────┐
│                         CDN                                 │
│         (CloudFront / Azure CDN / Cloudflare)               │
│  • Frontend static assets                                   │
│  • HTTPS termination                                        │
│  • DDoS protection                                          │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    LOAD BALANCER                            │
│         (ALB / Azure Load Balancer / Nginx)                 │
│  • Health checks                                            │
│  • SSL termination                                          │
│  • Request distribution                                     │
└─────────────────────────────────────────────────────────────┘
                            ↓
        ┌──────────────────────────────────┐
        ↓                                  ↓
┌───────────────┐                  ┌───────────────┐
│  API Server 1 │                  │  API Server 2 │
│  (Container)  │                  │  (Container)  │
│  • Express    │                  │  • Express    │
│  • Node.js    │                  │  • Node.js    │
└───────────────┘                  └───────────────┘
        ↓                                  ↓
┌─────────────────────────────────────────────────────────────┐
│                   MANAGED DATABASE                          │
│         (RDS PostgreSQL / Azure Database)                   │
│  • Read replicas for scaling                                │
│  • Automated backups                                        │
│  • High availability                                        │
└─────────────────────────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────────────────────────┐
│                   MANAGED REDIS                             │
│         (ElastiCache / Azure Cache for Redis)               │
│  • Session storage                                          │
│  • Caching layer                                            │
└─────────────────────────────────────────────────────────────┘
```

## Monitoring & Observability

```
┌─────────────────────────────────────────────────────────────┐
│                    APPLICATION                              │
│  • Winston logs → CloudWatch / Application Insights         │
│  • Correlation IDs for request tracing                      │
│  • Prometheus metrics → Grafana                             │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    MONITORING STACK                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐    │
│  │  Grafana    │  │ Prometheus  │  │  CloudWatch /   │    │
│  │ (Dashboards)│  │ (Metrics)   │  │  App Insights   │    │
│  └─────────────┘  └─────────────┘  └─────────────────┘    │
│                                                             │
│  • Request rate (req/s)                                     │
│  • Error rate (%)                                           │
│  • Response time (p50, p95, p99)                            │
│  • Database query time                                      │
│  • Payment success rate                                     │
│  • Email delivery rate                                      │
│  • QR generation success rate                               │
└─────────────────────────────────────────────────────────────┘
```

---

**Legend:**

- `→` = HTTP Request
- `↓` = Data Flow
- `(PK)` = Primary Key
- `(FK)` = Foreign Key
- `1:N` = One-to-Many Relationship
- `N:1` = Many-to-One Relationship
