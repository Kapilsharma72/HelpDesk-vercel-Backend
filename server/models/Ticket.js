const mongoose = require('mongoose');

const ticketSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    required: true,
    trim: true,
    maxlength: 2000
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  status: {
    type: String,
    enum: ['open', 'in_progress', 'resolved'],
    default: 'open'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  slaDeadline: {
    type: Date,
    required: true
  },
  isSlaBreached: {
    type: Boolean,
    default: false
  },
  version: {
    type: Number,
    default: 1
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Index for better query performance
ticketSchema.index({ createdBy: 1, status: 1 });
ticketSchema.index({ assignedTo: 1, status: 1 });
ticketSchema.index({ slaDeadline: 1, isSlaBreached: 1 });
ticketSchema.index({ title: 'text', description: 'text' });

// Virtual for comments
ticketSchema.virtual('comments', {
  ref: 'Comment',
  localField: '_id',
  foreignField: 'ticket',
  options: { sort: { createdAt: -1 } }
});

// Virtual for SLA status
ticketSchema.virtual('slaStatus').get(function() {
  if (this.status === 'resolved') return 'resolved';
  if (this.isSlaBreached) return 'breached';
  if (new Date() > this.slaDeadline) return 'breached';
  return 'active';
});

// Method to check and update SLA breach status
ticketSchema.methods.checkSlaBreach = function() {
  if (this.status !== 'resolved' && new Date() > this.slaDeadline) {
    this.isSlaBreached = true;
    return true;
  }
  return false;
};

// Pre-save middleware to check SLA breach
ticketSchema.pre('save', function(next) {
  this.checkSlaBreach();
  next();
});

module.exports = mongoose.model('Ticket', ticketSchema);
