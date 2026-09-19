const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const { requireAuth, optionalAuth } = require('../middleware/authMiddleware');
const { bookingLimiter } = require('../middleware/rateLimiter');

router.post('/hold', bookingLimiter, optionalAuth, bookingController.holdSlot);

router.get('/my', requireAuth, bookingController.getMyBookings);
router.get('/:id', optionalAuth, bookingController.getBookingById);


module.exports = router;
