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
import ticketsRouter from './routes/tickets.js';
import webhooksRouter from './routes/webhooks.js';
import adminRouter from './routes/admin.js';
import customersRouter from './routes/customers.js';
import organizationsRouter from './routes/organizations.js';
import venuesRouter from './routes/venues.js';
import ordersRouter, { eventOrdersRouter } from './routes/orders.js';
import usersRouter from './routes/users.js';

const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3001',
    credentials: true,
  })
);

app.use(express.json());
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
app.use('/events', eventsRouter);
app.use('/organizations', organizationsRouter);
app.use('/organizations/:orgId/venues', venuesRouter);
app.use('/organizations/:orgId/events', orgEventsRouter);
app.use('/organizations/:orgId/events/:eventId/price-tiers', priceTiersRouter);
app.use('/orders', ordersRouter);
app.use('/organizations/:orgId/events/:eventId/orders', eventOrdersRouter);
app.use('/tickets', ticketsRouter);
app.use('/users', usersRouter);
app.use('/webhooks', webhooksRouter);

// Error handling (must be last)
app.use(errorHandler);

// Start server only if not imported as module (not in test environment)
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    logger.info(`Server started on port ${PORT}`);
    console.log(`🚀 Jump Backend API running on http://localhost:${PORT}`);
    console.log(`📊 Metrics available at http://localhost:${PORT}/metrics`);
    console.log(`💚 Health check at http://localhost:${PORT}/health`);
  });
}

export default app;
