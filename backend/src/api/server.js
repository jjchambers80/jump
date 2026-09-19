// Express API server
// Main application entry point

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { errorHandler } from '../middleware/errorHandler.js';
import { metricsHandler, recordHttpMetric } from '../utils/metrics.js';
import logger from '../utils/logger.js';
import eventsRouter from './routes/events.js';
import { orgEventsRouter } from './routes/events.js';
import priceTiersRouter from './routes/priceTiers.js';
import tierPresetsRouter from './routes/tierPresets.js';
import addOnsRouter from './routes/addOns.js';
import ticketsRouter from './routes/tickets.js';
import webhooksRouter from './routes/webhooks.js';
import { eventApplicationsRouter, applicationStatusRouter } from './routes/applications.js';
import adminRouter from './routes/admin.js';
import customersRouter from './routes/customers.js';
import organizationsRouter from './routes/organizations.js';
import signupRouter from './routes/signup.js';
import { billingEnabled } from '../config/billing.js';
import onboardingService from '../services/OnboardingService.js';
import venuesRouter, { orgVenuesRouter } from './routes/venues.js';
import ordersRouter, { eventOrdersRouter } from './routes/orders.js';
import usersRouter from './routes/users.js';
import imagesRouter from './routes/images.js';
import buyerRouter from './routes/buyerAuth.js';
import domainsRouter from './routes/domains.js';
import domainService from '../services/DomainService.js';
import applicationPaymentService from '../services/ApplicationPaymentService.js';
import applicationDigestService from '../services/ApplicationDigestService.js';

const app = express();
const PORT = process.env.PORT || 3002;

// Railway terminates TLS one hop in front of us. Trusting that hop gives
// req.ip the client address (needed for the per-IP buyer sign-in rate limit).
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// CORS: FRONTEND_URL may list several origins (comma-separated). Outside
// production any localhost/127.0.0.1 port is also allowed so a second dev
// frontend (e.g. a worktree running on another port) can reach this backend.
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3001')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function isAllowedOrigin(origin) {
  if (!origin) return true; // same-origin, curl, server-to-server
  if (allowedOrigins.includes(origin)) return true;
  return process.env.NODE_ENV !== 'production' && LOCAL_ORIGIN.test(origin);
}

// Middleware
app.use(
  cors({
    // Static allowlist first; then any ACTIVE organization storefront domain
    // (spec 007 phase 3), so browsers on custom hosts can call public endpoints.
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) return callback(null, true);
      domainService
        .isActiveOrigin(origin)
        .then((ok) => callback(null, ok))
        .catch(() => callback(null, false));
    },
    credentials: true,
  })
);

// Stripe webhooks verify the signature over the raw bytes; the JSON parser
// must not touch them (routes/webhooks.js applies express.raw itself).
app.use((req, res, next) => (req.path.startsWith('/webhooks/') ? next() : express.json()(req, res, next)));
app.use(cookieParser());

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, '../../uploads')));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Add correlation ID to requests
app.use((req, res, next) => {
  req.id = req.headers['x-correlation-id'] || randomUUID();
  res.setHeader('X-Correlation-ID', req.id);
  next();
});

// Request logging and metrics
app.use((req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    recordHttpMetric(req.method, req.route?.path || req.path, res.statusCode, duration);

    logger.info('HTTP Request', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}s`,
      correlationId: req.id,
    });
  });

  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Metrics endpoint
app.get('/metrics', metricsHandler);

// API routes
app.use('/admin', adminRouter);
app.use('/customers', customersRouter);
app.use('/events/:eventId/applications', eventApplicationsRouter);
app.use('/applications', applicationStatusRouter);
app.use('/events', eventsRouter);
app.use('/venues', venuesRouter);
app.use('/signup', signupRouter);
app.use('/organizations', organizationsRouter);
app.use('/organizations/:orgId/venues', orgVenuesRouter);
app.use('/organizations/:orgId/events', orgEventsRouter);
app.use('/organizations/:orgId/events/:eventId/price-tiers', priceTiersRouter);
app.use('/organizations/:orgId/tier-presets', tierPresetsRouter);
app.use('/organizations/:orgId/events/:eventId/add-ons', addOnsRouter);
app.use('/orders', ordersRouter);
app.use('/organizations/:orgId/events/:eventId/orders', eventOrdersRouter);
app.use('/tickets', ticketsRouter);
app.use('/buyer', buyerRouter);
app.use('/domains', domainsRouter);
app.use('/users', usersRouter);
app.use('/images', imagesRouter);
app.use('/webhooks', webhooksRouter);

// Error handling (must be last)
app.use(errorHandler);

// Start server only if not imported as module (not in test environment)
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    logger.info(`Server started on port ${PORT}`);
    // Which Stripe endpoints are verified — the platform and Connect secrets
    // are easy to swap, and a wrong one shows up here before it shows up as
    // "account status never updates" (spec 010 phase 2).
    logger.info('Stripe webhook configuration', {
      platformSecret: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
      connectSecret: Boolean(process.env.STRIPE_CONNECT_WEBHOOK_SECRET),
      connectEnabled: String(process.env.STRIPE_CONNECT_ENABLED || '').toLowerCase() === 'true',
      // Spec 022 phase 2: Jump subscriptions on POST /webhooks/stripe/billing
      billingSecret: Boolean(process.env.STRIPE_BILLING_WEBHOOK_SECRET),
      billingEnabled: billingEnabled(),
    });
    console.log(`🚀 Jump Backend API running on http://localhost:${PORT}`);
    console.log(`📊 Metrics available at http://localhost:${PORT}/metrics`);
    console.log(`💚 Health check at http://localhost:${PORT}/health`);
  });

  // Storefront domain sweep (spec 007 phase 3): re-check DNS/TLS for pending
  // domains every 10 minutes, active ones daily. unref so it never holds the
  // process open.
  const DOMAIN_SWEEP_MS = Number(process.env.DOMAIN_SWEEP_INTERVAL_MS) || 10 * 60 * 1000;
  setTimeout(() => domainService.checkAll().catch(() => {}), 15 * 1000).unref();
  setInterval(() => domainService.checkAll().catch(() => {}), DOMAIN_SWEEP_MS).unref();

  // Application overdue sweep (spec 011 phase 2): approved applications whose
  // pay-now deadline passed are withdrawn (WITHDRAW policy) or flagged (HOLD).
  const APPLICATION_SWEEP_MS = Number(process.env.APPLICATION_SWEEP_INTERVAL_MS) || 60 * 60 * 1000;
  // The same tick sends organizer daily digests of new submissions (phase 3);
  // ApplicationDigestService only sends once a ~day per organization.
  const applicationSweep = async () => {
    await applicationPaymentService.sweepOverdue().catch(() => {});
    await applicationDigestService.sendDue().catch(() => {});
  };
  setTimeout(applicationSweep, 30 * 1000).unref();
  setInterval(applicationSweep, APPLICATION_SWEEP_MS).unref();

  // Onboarding sweep (spec 022 phase 3): unfinished signups older than
  // ONBOARDING_ABANDON_AFTER_MS (7 d) with no events and no subscription are
  // deleted so pending organizations never pile up.
  const ONBOARDING_SWEEP_MS = Number(process.env.ONBOARDING_SWEEP_INTERVAL_MS) || 60 * 60 * 1000;
  setTimeout(() => onboardingService.sweepAbandoned().catch(() => {}), 45 * 1000).unref();
  setInterval(() => onboardingService.sweepAbandoned().catch(() => {}), ONBOARDING_SWEEP_MS).unref();
}

export default app;
