const Ticket = require('../models/Ticket');
const Comment = require('../models/Comment');
const User = require('../models/User');
const PDFDocument = require('pdfkit');

const createTicket = async (req, res) => {
  try {
    const { title, description, priority = 'medium' } = req.body;
    
    // Calculate SLA deadline (24 hours from now)
    const slaDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000);
    
    // Find an available agent to assign the ticket
    const availableAgents = await User.find({ 
      role: 'agent', 
      isActive: true 
    });
    
    let assignedAgent = null;
    if (availableAgents.length > 0) {
      // Simple round-robin assignment - find agent with least tickets
      const agentTicketCounts = await Promise.all(
        availableAgents.map(async (agent) => {
          const ticketCount = await Ticket.countDocuments({ 
            assignedTo: agent._id,
            status: { $in: ['open', 'in_progress'] }
          });
          return { agent, count: ticketCount };
        })
      );
      
      // Sort by ticket count and assign to agent with least tickets
      agentTicketCounts.sort((a, b) => a.count - b.count);
      assignedAgent = agentTicketCounts[0].agent._id;
    }
    
    const ticket = new Ticket({
      title,
      description,
      priority,
      createdBy: req.user._id,
      assignedTo: assignedAgent, // Assign to agent if available
      slaDeadline
    });

    await ticket.save();
    await ticket.populate([
      { path: 'createdBy', select: 'name email role' },
      { path: 'assignedTo', select: 'name email role' }
    ]);

    res.status(201).json({
      message: 'Ticket created successfully',
      ticket
    });
  } catch (error) {
    console.error('Create ticket error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to create ticket'
      }
    });
  }
};

const getTickets = async (req, res) => {
  try {
    const { 
      limit = 10, 
      offset = 0, 
      q, 
      status, 
      priority, 
      breached,
      assigned 
    } = req.query;

    // Build query based on user role
    let query = {};
    
    if (req.user.role === 'user') {
      query.createdBy = req.user._id;
    } else if (req.user.role === 'agent') {
      query.assignedTo = req.user._id;
    }
    // Admin can see all tickets

    // Apply filters
    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (assigned) query.assignedTo = assigned;
    
    if (breached === 'true') {
      query.isSlaBreached = true;
    }

    // Text search
    if (q) {
      query.$or = [
        { title: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } }
      ];
    }

    // First fetch tickets without comments to avoid population errors
    const tickets = await Ticket.find(query)
      .populate('createdBy', 'name email role')
      .populate('assignedTo', 'name email role')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset));

    // Then populate comments for each ticket individually with error handling
    for (let ticket of tickets) {
      try {
        await ticket.populate({
          path: 'comments',
          populate: { path: 'author', select: 'name email role' }
        });
      } catch (commentError) {
        console.error('Error populating comments for ticket:', ticket._id, commentError);
        // If comment population fails, set comments to empty array
        ticket.comments = [];
      }
    }

    const total = await Ticket.countDocuments(query);
    const nextOffset = parseInt(offset) + parseInt(limit) < total 
      ? parseInt(offset) + parseInt(limit) 
      : null;

    res.json({
      items: tickets,
      total,
      limit: parseInt(limit),
      offset: parseInt(offset),
      next_offset: nextOffset
    });
  } catch (error) {
    console.error('Get tickets error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch tickets'
      }
    });
  }
};

const getTicket = async (req, res) => {
  try {
    const { id } = req.params;
    
    let query = { _id: id };
    
    // Role-based access control
    if (req.user.role === 'user') {
      query.createdBy = req.user._id;
    } else if (req.user.role === 'agent') {
      query.assignedTo = req.user._id;
    }
    // Admin can see all tickets

    const ticket = await Ticket.findOne(query)
      .populate('createdBy', 'name email role')
      .populate('assignedTo', 'name email role');

    // Populate comments with error handling
    if (ticket) {
      try {
        await ticket.populate({
          path: 'comments',
          populate: { path: 'author', select: 'name email role' }
        });
      } catch (commentError) {
        console.error('Error populating comments for ticket:', ticket._id, commentError);
        // If comment population fails, set comments to empty array
        ticket.comments = [];
      }
    }

    if (!ticket) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Ticket not found'
        }
      });
    }

    // Get comments
    const comments = await Comment.find({ ticket: id })
      .populate('author', 'name email role')
      .sort({ createdAt: 1 });

    res.json({
      ticket,
      comments
    });
  } catch (error) {
    console.error('Get ticket error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch ticket'
      }
    });
  }
};

const updateTicket = async (req, res) => {
  try {
    const { id } = req.params;
    let updates = req.body;
    
    let query = { _id: id };
    
    // Role-based access control
    if (req.user.role === 'user') {
      query.createdBy = req.user._id;
      // Users can only update their own tickets and only certain fields
      const allowedFields = ['title', 'description', 'priority'];
      updates = Object.keys(updates)
        .filter(key => allowedFields.includes(key))
        .reduce((obj, key) => {
          obj[key] = updates[key];
          return obj;
        }, {});
    } else if (req.user.role === 'agent') {
      query.assignedTo = req.user._id;
    }
    // Admin can update any ticket

    const ticket = await Ticket.findOne(query);
    if (!ticket) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Ticket not found'
        }
      });
    }

    // Optimistic locking check
    if (updates.version && updates.version !== ticket.version) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'Ticket has been modified by another user'
        }
      });
    }

    // Increment version for optimistic locking
    updates.version = ticket.version + 1;

    // Update ticket
    Object.assign(ticket, updates);
    await ticket.save();
    await ticket.populate('createdBy', 'name email role');
    await ticket.populate('assignedTo', 'name email role');

    res.json({
      message: 'Ticket updated successfully',
      ticket
    });
  } catch (error) {
    console.error('Update ticket error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to update ticket'
      }
    });
  }
};

const addComment = async (req, res) => {
  try {
    const { id } = req.params;
    const { content, isInternal = false } = req.body;
    
    // Check if user has access to this ticket
    let query = { _id: id };
    
    if (req.user.role === 'user') {
      query.createdBy = req.user._id;
    } else if (req.user.role === 'agent') {
      query.assignedTo = req.user._id;
    }
    // Admin can comment on any ticket

    const ticket = await Ticket.findOne(query);
    if (!ticket) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Ticket not found'
        }
      });
    }

    const comment = new Comment({
      ticket: id,
      author: req.user._id,
      content,
      isInternal
    });

    await comment.save();
    await comment.populate('author', 'name email role');

    res.status(201).json({
      message: 'Comment added successfully',
      comment
    });
  } catch (error) {
    console.error('Add comment error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to add comment'
      }
    });
  }
};

const getSlaBreachedTickets = async (req, res) => {
  try {
    const tickets = await Ticket.find({ isSlaBreached: true })
      .populate('createdBy', 'name email role')
      .populate('assignedTo', 'name email role')
      .sort({ slaDeadline: 1 });

    res.json({
      tickets,
      count: tickets.length
    });
  } catch (error) {
    console.error('Get SLA breached tickets error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch SLA breached tickets'
      }
    });
  }
};

// Generate PDF report for tickets
const exportTicketReport = async (req, res) => {
  try {
    const tickets = await Ticket.find({})
      .populate('createdBy', 'name email role')
      .populate('assignedTo', 'name email role')
      .sort({ createdAt: -1 });

    // Create PDF document
    const doc = new PDFDocument();
    const buffers = [];

    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {
      const pdfData = Buffer.concat(buffers);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="ticket-report.pdf"');
      res.send(pdfData);
    });

    // Add title
    doc.fontSize(20).text('Ticket Report', { align: 'center' });
    doc.moveDown();

    // Add generation date
    doc.fontSize(10).text(`Generated on: ${new Date().toLocaleDateString()}`, { align: 'right' });
    doc.moveDown();

    // Add summary
    doc.fontSize(12).text(`Total Tickets: ${tickets.length}`);
    doc.moveDown();

    // Define table headers
    const headers = ['ID', 'Title', 'Status', 'Priority', 'Created By', 'Assigned To', 'Created Date', 'SLA Breached'];
    const columnWidths = [80, 120, 60, 60, 80, 80, 80, 70];

    // Function to draw table row
    const drawRow = (y, data, isHeader = false) => {
      let x = 50;
      doc.fontSize(isHeader ? 10 : 8);

      if (isHeader) {
        doc.font('Helvetica-Bold');
      } else {
        doc.font('Helvetica');
      }

      data.forEach((cell, index) => {
        // Draw cell border
        doc.rect(x, y, columnWidths[index], 20).stroke();

        // Add cell text with padding
        doc.text(cell, x + 2, y + 5, {
          width: columnWidths[index] - 4,
          height: 15,
          ellipsis: true
        });

        x += columnWidths[index];
      });
    };

    // Draw header row
    drawRow(150, headers, true);

    // Draw data rows
    let y = 170;
    tickets.forEach((ticket, index) => {
      if (y > 700) { // New page if needed
        doc.addPage();
        y = 50;
      }

      const createdDate = new Date(ticket.createdAt).toLocaleDateString();
      const rowData = [
        ticket._id.toString().substring(0, 8) + '...',
        ticket.title.length > 15 ? ticket.title.substring(0, 15) + '...' : ticket.title,
        ticket.status,
        ticket.priority,
        ticket.createdBy?.name || 'Unknown',
        ticket.assignedTo?.name || 'Unassigned',
        createdDate,
        ticket.isSlaBreached ? 'Yes' : 'No'
      ];

      drawRow(y, rowData);
      y += 20;
    });

    doc.end();
  } catch (error) {
    console.error('Export ticket report error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to export ticket report'
      }
    });
  }
};

// Generate CSV report for users
const exportUserReport = async (req, res) => {
  try {
    const users = await User.find({})
      .select('name email role isActive createdAt')
      .sort({ createdAt: -1 });

    // Create CSV header
    const csvHeader = 'ID,Name,Email,Role,Status,Created Date\n';

    // Create CSV rows
    const csvRows = users.map(user => {
      const createdDate = new Date(user.createdAt).toISOString().split('T')[0];
      return [
        user._id,
        `"${user.name.replace(/"/g, '""')}"`,
        user.email,
        user.role,
        user.isActive ? 'Active' : 'Inactive',
        createdDate
      ].join(',');
    }).join('\n');

    const csvContent = csvHeader + csvRows;

    // Set headers for file download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="user-report.csv"');
    res.send(csvContent);
  } catch (error) {
    console.error('Export user report error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to export user report'
      }
    });
  }
};

// Generate performance report
const exportPerformanceReport = async (req, res) => {
  try {
    const allTickets = await Ticket.find({});
    const allUsers = await User.find({ role: 'agent', isActive: true });

    // Calculate performance metrics
    const performanceData = [];

    for (const agent of allUsers) {
      const agentTickets = allTickets.filter(ticket => ticket.assignedTo?.toString() === agent._id.toString());
      const resolvedTickets = agentTickets.filter(ticket => ticket.status === 'resolved');

      const totalResolutionTime = resolvedTickets.reduce((total, ticket) => {
        const created = new Date(ticket.createdAt);
        const resolved = new Date(ticket.updatedAt);
        return total + (resolved - created);
      }, 0);

      const avgResolutionTime = resolvedTickets.length > 0
        ? Math.round(totalResolutionTime / resolvedTickets.length / (1000 * 60 * 60)) // hours
        : 0;

      const slaCompliant = resolvedTickets.filter(ticket => {
        const created = new Date(ticket.createdAt);
        const resolved = new Date(ticket.updatedAt);
        const resolutionTime = resolved - created;
        const slaTime = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
        return resolutionTime <= slaTime;
      }).length;

      const slaCompliance = resolvedTickets.length > 0 ? Math.round((slaCompliant / resolvedTickets.length) * 100) : 0;

      performanceData.push({
        agent: agent.name,
        totalTickets: agentTickets.length,
        resolvedTickets: resolvedTickets.length,
        avgResolutionTime,
        slaCompliance
      });
    }

    // Create CSV header
    const csvHeader = 'Agent Name,Total Tickets,Resolved Tickets,Avg Resolution Time (hours),SLA Compliance (%)\n';

    // Create CSV rows
    const csvRows = performanceData.map(data => [
      `"${data.agent.replace(/"/g, '""')}"`,
      data.totalTickets,
      data.resolvedTickets,
      data.avgResolutionTime,
      data.slaCompliance
    ].join(',')).join('\n');

    const csvContent = csvHeader + csvRows;

    // Set headers for file download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="performance-report.csv"');
    res.send(csvContent);
  } catch (error) {
    console.error('Export performance report error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to export performance report'
      }
    });
  }
};

// Generate SLA report
const exportSlaReport = async (req, res) => {
  try {
    const allTickets = await Ticket.find({})
      .populate('createdBy', 'name email role')
      .populate('assignedTo', 'name email role')
      .sort({ createdAt: -1 });

    const resolvedTickets = allTickets.filter(ticket => ticket.status === 'resolved');

    // Create CSV header
    const csvHeader = 'ID,Title,Created By,Assigned To,Created Date,Resolved Date,Resolution Time (hours),SLA Deadline,SLA Breached\n';

    // Create CSV rows
    const csvRows = resolvedTickets.map(ticket => {
      const created = new Date(ticket.createdAt);
      const resolved = new Date(ticket.updatedAt);
      const resolutionTime = Math.round((resolved - created) / (1000 * 60 * 60)); // hours
      const createdDate = created.toISOString().split('T')[0];
      const resolvedDate = resolved.toISOString().split('T')[0];
      const slaDeadline = new Date(ticket.slaDeadline).toISOString().split('T')[0];

      return [
        ticket._id,
        `"${ticket.title.replace(/"/g, '""')}"`,
        ticket.createdBy?.name || 'Unknown',
        ticket.assignedTo?.name || 'Unassigned',
        createdDate,
        resolvedDate,
        resolutionTime,
        slaDeadline,
        ticket.isSlaBreached ? 'Yes' : 'No'
      ].join(',');
    }).join('\n');

    const csvContent = csvHeader + csvRows;

    // Set headers for file download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="sla-report.csv"');
    res.send(csvContent);
  } catch (error) {
    console.error('Export SLA report error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to export SLA report'
      }
    });
  }
};

module.exports = {
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
};
