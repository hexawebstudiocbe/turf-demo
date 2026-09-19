require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');


// Route imports
const authRoutes = require('./routes/authRoutes');
const turfRoutes = require('./routes/turfRoutes');
const slotRoutes = require('./routes/slotRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const adminRoutes = require('./routes/adminRoutes');

// Middleware imports
const { notFound, errorHandler } = require('./middleware/errorMiddleware');
const { globalLimiter } = require('./middleware/rateLimiter');

const app = express();

// 1. Security & Headers Middleware
app.use(helmet());

// 2. CORS Configuration
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, server-to-server)
      if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
        return callback(null, true);
      }
      return callback(new Error('CORS not allowed for this origin'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })
);

// 3. Request Logging & Body Parsers
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 4. Rate Limiting
app.use(globalLimiter);

// 5. Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'TurfBook API',
    uptime: process.uptime(),
  });
});

// 6. API Route Mounting
app.use('/api/auth', authRoutes);
app.use('/api/turf', turfRoutes);
app.use('/api/slots', slotRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);

// 7. Error Handling Middleware
app.use(notFound);
app.use(errorHandler);

// 8. Server Listen & Lifecycle
const PORT = process.env.PORT || 5001;

let server = null;
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(PORT, () => {
    console.log(`[TurfBook API] Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
    console.log(`[TurfBook API] Health check at http://localhost:${PORT}/api/health`);
  });
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  if (server) {
    server.close(() => {
      console.log('HTTP server closed');
    });
  }
});

module.exports = app;
