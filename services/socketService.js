'use strict';

let ioInstance = null;

function initSocket(io) {
  ioInstance = io;

  io.use(async (socket, next) => {
    try {
      // Cookie-based or handshake auth
      const cookie = socket.handshake.headers.cookie || '';
      const match = cookie.match(/(?:^|;\s*)authToken=([^;]+)/);
      const token =
        socket.handshake.auth?.token ||
        (match ? decodeURIComponent(match[1]) : null);

      if (!token) {
        // Allow anonymous connect but no rooms
        socket.data.user = null;
        return next();
      }

      const jwt = require('jsonwebtoken');
      const env = require('../config/env');
      const User = require('../models/User');
      const decoded = jwt.verify(token, env.JWT_SECRET);
      const user = await User.findById(decoded.userId);
      if (!user || user.Status !== 'active') {
        socket.data.user = null;
        return next();
      }
      const tv = typeof decoded.tokenVersion === 'number' ? decoded.tokenVersion : 0;
      if (tv !== (user.tokenVersion || 0)) {
        socket.data.user = null;
        return next();
      }
      socket.data.user = {
        userId: user._id.toString(),
        role: user.Role,
      };
      return next();
    } catch {
      socket.data.user = null;
      return next();
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    if (user) {
      socket.join(`user:${user.userId}`);
      if (user.role === 'host') socket.join(`host:${user.userId}`);
      if (user.role === 'admin') socket.join('admin');
    }

    socket.on('disconnect', () => {});
  });
}

function getIO() {
  return ioInstance;
}

function emitBookingUpdate({ bookingId, newStatus, hostId, customerId }) {
  if (!ioInstance) return;
  const payload = { bookingId, newStatus };
  if (hostId) ioInstance.to(`host:${hostId}`).emit('booking_status_updated', payload);
  if (customerId) ioInstance.to(`user:${customerId}`).emit('booking_status_updated', payload);
}

function emitAuditLog(payload) {
  if (!ioInstance) return;
  ioInstance.to('admin').emit('new_audit_log_created', payload);
}

module.exports = {
  initSocket,
  getIO,
  emitBookingUpdate,
  emitAuditLog,
};
