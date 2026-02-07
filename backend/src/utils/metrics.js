// Prometheus metrics collection
// Tracking sales rate, payment success, API response times, QR generation, sessions per FR-025, FR-026

import promClient from 'prom-client';

// Create a Registry
const register = new promClient.Registry();

// Add default metrics (CPU, memory, etc.)
promClient.collectDefaultMetrics({ register });

// Custom metrics

// Ticket sales rate (tickets/minute)
export const ticketSalesCounter = new promClient.Counter({
  name: 'jump_tickets_sold_total',
  help: 'Total number of tickets sold',
  labelNames: ['event_id'],
  registers: [register],
});

// Payment success/failure rate
export const paymentStatusCounter = new promClient.Counter({
  name: 'jump_payments_total',
  help: 'Total number of payment attempts',
  labelNames: ['status'], // 'succeeded' or 'failed'
  registers: [register],
});

// API endpoint response times
export const httpRequestDuration = new promClient.Histogram({
  name: 'jump_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10],
  registers: [register],
});

// QR code generation success rate
export const qrGenerationCounter = new promClient.Counter({
  name: 'jump_qr_generation_total',
  help: 'Total QR code generation attempts',
  labelNames: ['status'], // 'success' or 'failure'
  registers: [register],
});

// Active session count
export const activeSessionsGauge = new promClient.Gauge({
  name: 'jump_active_sessions',
  help: 'Number of active user sessions',
  registers: [register],
});

// Helper function to record HTTP request metrics
export const recordHttpMetric = (method, route, statusCode, duration) => {
  httpRequestDuration.labels(method, route, statusCode.toString()).observe(duration);
};

// Helper function to increment ticket sales
export const recordTicketSale = (eventId, quantity = 1) => {
  ticketSalesCounter.labels(eventId).inc(quantity);
};

// Helper function to record payment status
export const recordPaymentStatus = (status) => {
  paymentStatusCounter.labels(status).inc();
};

// Helper function to record QR generation
export const recordQRGeneration = (status) => {
  qrGenerationCounter.labels(status).inc();
};

// Helper function to update active sessions count
export const updateActiveSessionsCount = async (prisma) => {
  const count = await prisma.session.count({
    where: {
      expiresAt: {
        gt: new Date(),
      },
    },
  });
  activeSessionsGauge.set(count);
};

// Expose metrics endpoint
export const metricsHandler = async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
};

export { register };
