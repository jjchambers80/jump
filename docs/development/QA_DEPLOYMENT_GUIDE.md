# QA & Deployment Guide - Jump Tickets

## Quick Start - Local Testing

### 1. Environment Setup

```bash
# Backend
cd backend
cp .env.example .env

# Update .env with real test credentials:
# - STRIPE_SECRET_KEY=sk_test_... (get from Stripe dashboard)
# - SENDGRID_API_KEY=SG.... (get from SendGrid)
# - JWT_SECRET=<generate random 32+ char string>

npm install
npx prisma migrate deploy
npm run seed
npm start
```

```bash
# Frontend (new terminal)
cd frontend
npm install
npm run dev
```

### 2. Access Points

- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3000
- **Health Check**: http://localhost:3000/health
- **Metrics**: http://localhost:3000/metrics

---

## QA Test Scenarios

### Test 1: Browse Events (Happy Path)

**Steps:**

1. Open http://localhost:5173/events
2. Verify you see published events (Summer Music Festival, Startup Pitch Night)
3. Check that Tech Conference 2024 is NOT shown (it's a draft)
4. Verify pagination controls appear if > 12 events
5. Click on "Summer Music Festival" card

**Expected:**

- Grid layout with event cards
- Each card shows: name, date, venue, price, availability
- Responsive design (test mobile view with DevTools)
- Loading spinner appears briefly
- No errors in console

---

### Test 2: View Event Details

**Steps:**

1. From event list, click any event
2. Verify event details page loads
3. Check quantity selector (-, +, buttons)
4. Try selecting 1-10 tickets
5. Verify total price updates in real-time
6. Click "Continue to Checkout"

**Expected:**

- Full event description visible
- Date formatted nicely (e.g., "Saturday, July 15, 2026 at 7:00 PM")
- Availability status shows (e.g., "4,995 tickets available")
- Quantity selector works (disabled at 1 and 10/max)
- "Back to Events" navigation works

---

### Test 3: Ticket Purchase (End-to-End)

**Steps:**

1. Navigate to event detail
2. Select quantity: 2 tickets
3. Click "Continue to Checkout"
4. Enter email: your-test-email@gmail.com
5. Click "Proceed to Payment"
6. **Stripe Test Card**: Use `4242 4242 4242 4242`
   - Expiry: Any future date (e.g., 12/28)
   - CVC: Any 3 digits (e.g., 123)
   - ZIP: Any 5 digits (e.g., 12345)
7. Complete Stripe checkout
8. Wait for redirect to confirmation page

**Expected:**

- Checkout page shows event summary
- Email validation works (try invalid email first)
- Redirects to Stripe hosted checkout
- After payment, redirects to `/confirmation?session_id=...`
- Confirmation page shows:
  - Success message
  - 2 tickets with QR codes
  - Email sent notification
  - Print button works

**Email Check:**

- Check your email inbox
- Should receive email with tickets and QR codes
- QR codes should be embedded as images

---

### Test 4: Error Handling - Sold Out Event

**Steps:**

1. Create event with capacity=1 via Prisma Studio or seed
2. Purchase 1 ticket (follow Test 3)
3. Try to purchase another ticket from same event
4. Click "Continue to Checkout"

**Expected:**

- Should see "insufficient capacity" error
- Or 409 Conflict response from API
- User-friendly error message displayed
- Link to return to events

---

### Test 5: Error Handling - Invalid Input

**Test 5a: Invalid Email**

1. Go to checkout
2. Enter invalid email: "notanemail"
3. Click submit

**Expected:**

- Red error message: "Please enter a valid email address"
- Button remains enabled after fixing

**Test 5b: Invalid Event ID**

1. Navigate to http://localhost:5173/events/invalid-uuid

**Expected:**

- Error page or 400 Bad Request
- "Event not found" message

**Test 5c: Draft Event**

1. Find draft event ID from database
2. Navigate to http://localhost:5173/events/{draft-event-id}

**Expected:**

- 404 Not Found
- "Event not found" message

---

### Test 6: Pagination

**Setup:**

1. Seed database with 30+ events (modify seed script)
2. Navigate to event list

**Steps:**

1. Verify page 1 shows first 12 events
2. Click "Next" button
3. Verify page 2 shows next 12 events
4. Click "Previous" button
5. Verify back on page 1

**Expected:**

- Shows "Page X of Y"
- Previous disabled on page 1
- Next disabled on last page
- URL updates with ?page=2

---

### Test 7: Mobile Responsiveness

**Steps:**

1. Open DevTools (F12)
2. Toggle device toolbar (Ctrl+Shift+M)
3. Select iPhone 12 Pro
4. Test all pages:
   - Event list (1 column on mobile)
   - Event detail (readable layout)
   - Checkout (form fits screen)
   - Confirmation (tickets readable)

**Expected:**

- No horizontal scroll
- Text is readable (not too small)
- Buttons are tappable (not too small)
- Cards stack vertically on mobile

---

### Test 8: Backend API Testing

**Test via cURL or Postman:**

```bash
# List events
curl http://localhost:3000/events

# Get single event
curl http://localhost:3000/events/{EVENT_ID}

# Purchase tickets (will fail without valid Stripe in production)
curl -X POST http://localhost:3000/tickets/purchase \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "EVENT_ID",
    "quantity": 2,
    "email": "test@example.com"
  }'

# Health check
curl http://localhost:3000/health

# Metrics
curl http://localhost:3000/metrics
```

**Expected:**

- Events endpoint returns JSON with events array
- Single event returns event object or 404
- Purchase returns sessionId and checkoutUrl
- Health returns {"status": "ok", ...}
- Metrics returns Prometheus format

---

### Test 9: Database Verification

**Using Prisma Studio:**

```bash
cd backend
npx prisma studio
```

**Verify:**

1. After purchase, check `Ticket` table for new tickets
2. Check `PaymentTransaction` table for transaction records
3. Check ticket `qrCodeJwt` field is populated
4. Check ticket `status` is "VALID"

---

### Test 10: Error Recovery

**Test 10a: Backend Down**

1. Stop backend server
2. Try to load event list

**Expected:**

- Error message appears
- "Try Again" button works
- No app crash

**Test 10b: Network Error During Purchase**

1. Open DevTools Network tab
2. Set throttling to "Offline"
3. Try to submit checkout form

**Expected:**

- Error message about network failure
- Form remains in error state
- Can retry when back online

---

## Performance Testing

### Load Testing (Optional)

```bash
# Install Apache Bench
brew install ab  # macOS
# or
sudo apt install apache2-utils  # Linux

# Test event listing (10 concurrent, 100 requests)
ab -n 100 -c 10 http://localhost:3000/events

# Expected: < 100ms average response time
```

### Database Query Analysis

```bash
# Enable query logging in .env
DATABASE_URL="postgresql://...?connection_limit=20&query_timeout=5000"

# Watch logs for slow queries
tail -f backend/logs/combined.log | grep "query took"
```

---

## Pre-Deployment Checklist

### Environment Variables

**Backend (.env):**

```bash
# Required for Production
✅ NODE_ENV=production
✅ PORT=3000
✅ DATABASE_URL=postgresql://... (production database)
✅ REDIS_URL=redis://... (production Redis)
✅ JWT_SECRET=... (32+ char random string, ROTATE REGULARLY)
✅ STRIPE_SECRET_KEY=sk_live_... (PRODUCTION KEY)
✅ STRIPE_WEBHOOK_SECRET=whsec_... (from Stripe dashboard)
✅ SENDGRID_API_KEY=SG.... (verified sender)
✅ SENDGRID_FROM_EMAIL=tickets@yourdomain.com (verified)
✅ FRONTEND_URL=https://yourdomain.com
✅ CORS_ORIGIN=https://yourdomain.com

# Optional but Recommended
✅ LOG_LEVEL=info
✅ METRICS_ENABLED=true
```

**Frontend:**

```bash
# Update API base URL in src/services/api.ts
const API_BASE_URL = 'https://api.yourdomain.com'
```

### Database

```bash
# Run migrations on production database
DATABASE_URL="postgresql://..." npx prisma migrate deploy

# DO NOT run seed in production!
# Create admin accounts manually via Prisma Studio
```

### Security Checklist

- [ ] JWT_SECRET is strong and secure (not the test value)
- [ ] Stripe production keys configured
- [ ] SendGrid sender email verified
- [ ] CORS configured for production domain only
- [ ] HTTPS/TLS enabled (Stripe requires HTTPS for webhooks)
- [ ] Database credentials secured (not in code)
- [ ] Redis password protected
- [ ] Rate limiting enabled (add express-rate-limit)
- [ ] Helmet.js installed for security headers

### Stripe Configuration

1. **Stripe Dashboard** → Developers → Webhooks
2. Add endpoint: `https://api.yourdomain.com/webhooks/stripe`
3. Select events:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
4. Copy webhook signing secret to `STRIPE_WEBHOOK_SECRET`

### SendGrid Configuration

1. **SendGrid** → Settings → Sender Authentication
2. Verify domain (recommended) or single sender email
3. Configure SPF and DKIM records in DNS
4. Test email delivery:
   ```bash
   curl -X POST http://localhost:3000/api/test-email
   ```

---

## Deployment Options

### Option 1: Traditional Server (VPS)

**Setup:**

```bash
# On server (Ubuntu 22.04)
sudo apt update
sudo apt install nodejs npm postgresql redis-server nginx

# Clone repository
git clone <repo-url>
cd jump

# Backend
cd backend
npm install --production
npm run build
DATABASE_URL="..." npx prisma migrate deploy

# Use PM2 for process management
npm install -g pm2
pm2 start npm --name "jump-api" -- start
pm2 save
pm2 startup

# Frontend
cd ../frontend
npm install
npm run build

# Copy dist/ to nginx web root
sudo cp -r dist/* /var/www/html/
```

**Nginx Config:**

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    # Frontend
    location / {
        root /var/www/html;
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Option 2: Docker (Recommended)

**Create docker-compose.yml:**

```yaml
version: "3.8"
services:
  backend:
    build: ./backend
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://postgres:password@db:5432/jump_tickets
      - REDIS_URL=redis://redis:6379
    depends_on:
      - db
      - redis

  frontend:
    build: ./frontend
    ports:
      - "80:80"

  db:
    image: postgres:15
    environment:
      POSTGRES_DB: jump_tickets
      POSTGRES_PASSWORD: password
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

**Deploy:**

```bash
docker-compose up -d
```

### Option 3: Cloud Platform (Easiest)

**Vercel (Frontend) + Railway/Render (Backend):**

1. **Frontend on Vercel:**

   ```bash
   npm install -g vercel
   cd frontend
   vercel
   ```

2. **Backend on Railway:**
   - Connect GitHub repo
   - Add PostgreSQL and Redis services
   - Set environment variables
   - Deploy

### Option 4: Kubernetes (Production-Grade)

See `deployment/kubernetes/` for manifests (future work).

---

## Monitoring Setup

### Application Monitoring

```bash
# Install monitoring tools
npm install --save @sentry/node  # Error tracking
npm install --save newrelic      # APM

# Add to backend/src/api/server.js
import * as Sentry from '@sentry/node';
Sentry.init({ dsn: 'YOUR_SENTRY_DSN' });
```

### Metrics Visualization

1. **Prometheus** scrapes `/metrics` endpoint
2. **Grafana** visualizes metrics

**Docker Compose with Monitoring:**

```yaml
prometheus:
  image: prom/prometheus
  ports:
    - "9090:9090"
  volumes:
    - ./prometheus.yml:/etc/prometheus/prometheus.yml

grafana:
  image: grafana/grafana
  ports:
    - "3001:3000"
```

### Uptime Monitoring

**Free Options:**

- UptimeRobot: https://uptimerobot.com
- Pingdom: https://www.pingdom.com
- Better Uptime: https://betteruptime.com

**Setup:**

- Monitor: https://yourdomain.com/health
- Alert via email/SMS on downtime

---

## Backup & Recovery

### Database Backups

**Automated Backup Script:**

```bash
#!/bin/bash
# backup.sh
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
pg_dump $DATABASE_URL > backups/jump_$TIMESTAMP.sql
gzip backups/jump_$TIMESTAMP.sql

# Delete backups older than 30 days
find backups/ -name "*.sql.gz" -mtime +30 -delete
```

**Cron Job:**

```cron
0 2 * * * /path/to/backup.sh  # Daily at 2 AM
```

### Disaster Recovery

**Restore from Backup:**

```bash
gunzip backup.sql.gz
psql $DATABASE_URL < backup.sql
```

---

## Common Issues & Solutions

### Issue: Stripe Webhook Fails

**Symptoms:** Payments succeed but tickets not issued

**Solution:**

1. Check webhook signing secret matches
2. Verify HTTPS is enabled (Stripe requires it)
3. Check server logs for webhook errors
4. Use Stripe CLI for local testing:
   ```bash
   stripe listen --forward-to localhost:3000/webhooks/stripe
   ```

### Issue: Email Not Received

**Symptoms:** Purchase succeeds but no email

**Solutions:**

1. Check SendGrid sender is verified
2. Check spam folder
3. Verify SENDGRID_API_KEY is correct
4. Check SendGrid logs in dashboard
5. Test email delivery manually:
   ```bash
   node backend/scripts/test-email.js
   ```

### Issue: QR Code Invalid

**Symptoms:** QR code doesn't scan or verify fails

**Solutions:**

1. Check JWT_SECRET is same in all instances
2. Verify QR expiration (event_date + 24h)
3. Check QR image generation:
   ```bash
   node backend/scripts/test-qr.js
   ```

### Issue: Database Connection Pool Exhausted

**Symptoms:** "too many connections" errors

**Solution:**

```javascript
// backend/src/config/database.js
datasources: {
  db: {
    url: env("DATABASE_URL");
    connectionLimit: 10; // Adjust based on load
  }
}
```

### Issue: High Memory Usage

**Solution:**

```bash
# Limit Node.js memory
NODE_OPTIONS="--max-old-space-size=512" npm start

# Or use PM2 limits
pm2 start app.js --max-memory-restart 500M
```

---

## Post-Deployment Verification

### Smoke Tests (Run Immediately After Deploy)

```bash
# 1. Health check
curl https://yourdomain.com/health
# Expected: {"status":"ok","timestamp":"..."}

# 2. Events listing
curl https://yourdomain.com/api/events
# Expected: {"events":[...],"total":X}

# 3. Frontend loads
curl -I https://yourdomain.com
# Expected: 200 OK

# 4. Metrics endpoint
curl https://yourdomain.com/metrics
# Expected: Prometheus metrics
```

### Test Purchase with Real Stripe

1. Use Stripe test mode initially
2. Test card: 4242 4242 4242 4242
3. Verify full flow works
4. Switch to live mode only when confident

---

## Success Metrics

**Track these KPIs:**

- **Conversion Rate**: Purchases / Event views
- **Payment Success Rate**: Successful payments / Attempts
- **Email Delivery Rate**: Emails sent / Tickets issued
- **QR Generation Success**: QR codes generated / Tickets
- **Response Time**: p95 API response time < 500ms
- **Uptime**: 99.9% availability (8.76 hours downtime/year)

**Dashboard Example:**

```
Today's Stats:
- Events viewed: 1,234
- Tickets purchased: 89
- Revenue: $4,450
- Avg response time: 127ms
- Error rate: 0.2%
```

---

## Support & Maintenance

### Log Monitoring

```bash
# Watch logs in real-time
pm2 logs jump-api

# Or with Docker
docker-compose logs -f backend

# Filter for errors
pm2 logs jump-api --err
```

### Weekly Maintenance Tasks

- [ ] Review error logs
- [ ] Check disk space
- [ ] Review security alerts
- [ ] Update dependencies (npm audit)
- [ ] Backup database
- [ ] Review performance metrics

### Monthly Tasks

- [ ] Security patches (OS, Node.js, packages)
- [ ] SSL certificate renewal (if not auto-renew)
- [ ] Review and rotate secrets
- [ ] Load testing
- [ ] Cost optimization review

---

## Need Help?

**Documentation:**

- Backend: `backend/README.md`
- Frontend: `frontend/README.md`
- Architecture: `docs/architecture/ARCHITECTURE.md`

**Support:**

- Create issue on GitHub
- Email: dev@yourdomain.com
- Slack: #jump-support

---

**Good luck with deployment! 🚀**
