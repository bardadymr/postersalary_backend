// backend/src/server.js

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const salaryController = require('./controllers/salaryController');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*'
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 хвилин
  max: 100, // максимум 100 запитів з одного IP
  message: 'Too many requests from this IP, please try again later.'
});

app.use('/api/', limiter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// API Routes
app.post('/api/salary/calculate', (req, res) => 
  salaryController.calculateSalary(req, res)
);

app.get('/api/locations', (req, res) => 
  salaryController.getLocations(req, res)
);

app.get('/api/salary/history/:locationId', (req, res) => 
  salaryController.getSalaryHistory(req, res)
);

app.get('/api/salary/export/:reportId', (req, res) => 
  salaryController.exportReport(req, res)
);

app.get('/api/auth/poster', (req, res) => 
  salaryController.getAuthUrl(req, res)
);

app.post('/api/locations/connect', (req, res) => 
  salaryController.connectLocation(req, res)
);

// Telegram WebApp validation middleware
const validateTelegramWebApp = (req, res, next) => {
  const initData = req.headers['x-telegram-init-data'];
  
  // TODO: Implement Telegram WebApp data validation
  // https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
  
  if (!initData && process.env.NODE_ENV === 'production') {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid Telegram WebApp data'
    });
  }
  
  next();
};

// Використовувати для захищених роутів
// app.use('/api/salary', validateTelegramWebApp);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════╗
║   Salary Calculator API Server                ║
║   Port: ${PORT}                                    ║
║   Environment: ${process.env.NODE_ENV || 'development'}               ║
║   Status: ✅ Running                           ║
╚═══════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

module.exports = app;
