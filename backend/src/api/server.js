// Express API server
// Main application entry point

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import { errorHandler } from '../middleware/errorHandler.js';
import { metricsHandler, recordHttpMetric } from '../utils/metrics.js';
import logger from '../utils/logger.js';
import eventsRouter from './routes/events.js';
import ticketsRouter from './routes/tickets.js';
import webhooksRouter from './routes/webhooks.js';
import authRouter from './routes/auth.js';
import adminRouter from './routes/admin.js';
import customersRouter from './routes/customers.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3001',
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());

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
app.use('/auth', authRouter);
app.use('/admin', adminRouter);
app.use('/customers', customersRouter);
app.use('/events', eventsRouter);
app.use('/tickets', ticketsRouter);
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
