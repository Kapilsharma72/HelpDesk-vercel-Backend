const { v4: uuidv4 } = require('uuid');

// In-memory store for idempotency keys (in production, use Redis)
const idempotencyStore = new Map();

const idempotencyMiddleware = (req, res, next) => {
  const idempotencyKey = req.headers['idempotency-key'];
  
  if (!idempotencyKey) {
    return next();
  }

  // Check if we've seen this key before
  if (idempotencyStore.has(idempotencyKey)) {
    const cachedResponse = idempotencyStore.get(idempotencyKey);
    return res.status(cachedResponse.status).json(cachedResponse.data);
  }

  // Store original res.json method
  const originalJson = res.json;
  
  // Override res.json to cache the response
  res.json = function(data) {
    // Cache the response for successful POST requests
    if (req.method === 'POST' && res.statusCode >= 200 && res.statusCode < 300) {
      idempotencyStore.set(idempotencyKey, {
        status: res.statusCode,
        data: data
      });
      
      // Clean up old entries (keep only last 1000)
      if (idempotencyStore.size > 1000) {
        const firstKey = idempotencyStore.keys().next().value;
        idempotencyStore.delete(firstKey);
      }
    }
    
    // Call original json method
    return originalJson.call(this, data);
  };

  next();
};

module.exports = idempotencyMiddleware;
