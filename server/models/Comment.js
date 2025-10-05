const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  ticket: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ticket',
    required: true
  },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    required: true,
    trim: true,
    maxlength: 1000
  },
  isInternal: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Index for better query performance
commentSchema.index({ ticket: 1, createdAt: -1 });
commentSchema.index({ author: 1 });

// Populate author details when querying
commentSchema.pre(/^find/, function(next) {
  this.populate({
    path: 'author',
    select: 'name email role'
  });
  next();
});

module.exports = mongoose.model('Comment', commentSchema);
