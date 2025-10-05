const express = require('express');
const router = express.Router();
const { auth, requireRole } = require('../middleware/auth');
const { generalLimiter, ticketCreationLimiter } = require('../middleware/rateLimiter');
const idempotencyMiddleware = require('../middleware/idempotency');
const { 
  validateTicket, 
  validateComment, 
  validateTicketUpdate 
} = require('../middleware/validation');
const {
  createTicket,
  getTickets,
  getTicket,
  updateTicket,
  addComment,
  getSlaBreachedTickets,
  exportTicketReport,
  exportUserReport,
  exportPerformanceReport,
  exportSlaReport
} = require('../controllers/ticketController');

// All routes require authentication
router.use(auth);

// Ticket creation with idempotency
router.post('/', 
  ticketCreationLimiter, 
  idempotencyMiddleware, 
  validateTicket, 
  createTicket
);

// Get tickets with pagination and filters
router.get('/', generalLimiter, getTickets);

// Get specific ticket
router.get('/:id', generalLimiter, getTicket);

// Update ticket with optimistic locking
router.patch('/:id', generalLimiter, validateTicketUpdate, updateTicket);

// Add comment to ticket
router.post('/:id/comments', generalLimiter, validateComment, addComment);

// Admin-only route for SLA breached tickets
router.get('/admin/breached', requireRole('admin'), getSlaBreachedTickets);

// Admin-only export routes
router.get('/admin/export/tickets', requireRole('admin'), exportTicketReport);
router.get('/admin/export/users', requireRole('admin'), exportUserReport);
router.get('/admin/export/performance', requireRole('admin'), exportPerformanceReport);
router.get('/admin/export/sla', requireRole('admin'), exportSlaReport);

module.exports = router;
