const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

// The webhook must read the raw body for signature verification in real Razorpay,
// but for standard body parser it's usually handled in a middleware.
// For now, standard express json body parser is fine for mock tests.
router.post('/webhook', paymentController.handleWebhook);
router.post('/verify', paymentController.verifyPaymentAndConfirm);

module.exports = router;
