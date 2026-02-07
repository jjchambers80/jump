// Ticket Purchase Validators
// Request validation for ticket purchase endpoints

export function validatePurchaseRequest(req, res, next) {
  const { eventId, quantity, email } = req.body;

  const errors = [];

  // Validate eventId
  if (!eventId) {
    errors.push('eventId is required');
  } else {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(eventId)) {
      errors.push('eventId must be a valid UUID');
    }
  }

  // Validate quantity
  if (!quantity) {
    errors.push('quantity is required');
  } else if (typeof quantity !== 'number' || !Number.isInteger(quantity)) {
    errors.push('quantity must be an integer');
  } else if (quantity < 1 || quantity > 10) {
    errors.push('quantity must be between 1 and 10');
  }

  // Validate email
  if (!email) {
    errors.push('email is required');
  } else {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      errors.push('email must be a valid email address');
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({
      error: 'ValidationError',
      message: 'Invalid request',
      details: errors,
    });
  }

  next();
}

export function validateConfirmRequest(req, res, next) {
  const { session_id } = req.query;

  if (!session_id) {
    return res.status(400).json({
      error: 'ValidationError',
      message: 'session_id query parameter is required',
    });
  }

  next();
}
