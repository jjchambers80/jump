// Structured logging with Winston
// Correlation IDs and JSON logging per FR-016, FR-026

import winston from 'winston';

const { combine, timestamp, json, errors } = winston.format;

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(errors({ stack: true }), timestamp(), json()),
  defaultMeta: { service: 'jump-backend' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
    }),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

// Create child logger with correlation ID
export const createLogger = (correlationId) => {
  return logger.child({ correlationId });
};

// Log ticket purchase audit trail (FR-016)
export const logTicketPurchase = (data) => {
  logger.info('TICKET_PURCHASE', {
    event: 'ticket_purchase',
    timestamp: new Date().toISOString(),
    customerId: data.customerId,
    eventId: data.eventId,
    ticketIds: data.ticketIds,
    amount: data.amount,
    stripeTxId: data.stripeTxId,
    correlationId: data.correlationId,
  });
};

// Log capacity enforcement events (FR-016)
export const logCapacityEvent = (eventType, data) => {
  logger.info('CAPACITY_EVENT', {
    event: eventType, // 'capacity_check', 'lock_acquired', 'inventory_decremented'
    timestamp: new Date().toISOString(),
    eventId: data.eventId,
    requestedQuantity: data.requestedQuantity,
    availableCapacity: data.availableCapacity,
    correlationId: data.correlationId,
  });
};

// Log admin operations
export const logAdminOperation = (operation, data) => {
  logger.info('ADMIN_OPERATION', {
    event: operation, // 'event_created', 'event_published', 'event_updated'
    timestamp: new Date().toISOString(),
    adminId: data.adminId,
    eventId: data.eventId,
    correlationId: data.correlationId,
  });
};

export default logger;
