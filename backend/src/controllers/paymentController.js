const supabase = require('../config/supabase');
const paymentProvider = require('../services/paymentProvider');
const { sendSuccess, sendError } = require('../utils/response');

const confirmPayment = async (orderId, paymentId, provider, amount) => {
  const { data, error } = await supabase.rpc('confirm_online_payment', {
    p_order_id: orderId,
    p_payment_id: paymentId,
    p_provider: provider,
    p_amount: amount
  });

  if (error) {
    throw new Error(error.message);
  }
  return data;
};

// Invoked by the frontend immediately after Razorpay checkout
const verifyPaymentAndConfirm = async (req, res, next) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return sendError(res, 'Missing payment identifiers or signature', 400);
    }

    // 1. Verify Signature
    const valid = paymentProvider.verifyPayment({
      order_id: razorpayOrderId,
      payment_id: razorpayPaymentId,
      signature: razorpaySignature
    });

    if (!valid) {
      return sendError(res, 'Invalid payment signature', 400);
    }

    // 2. Fetch booking to get the required advance amount
    const { data: booking, error: bError } = await supabase
      .from('bookings')
      .select('advance_required')
      .eq('razorpay_order_id', razorpayOrderId)
      .single();
      
    if (bError || !booking) {
      return sendError(res, 'Booking not found', 404);
    }

    // 3. Confirm via RPC
    const provider = process.env.PAYMENT_PROVIDER === 'mock' ? 'MOCK' : 'RAZORPAY';
    const result = await confirmPayment(razorpayOrderId, razorpayPaymentId, provider, booking.advance_required);

    return sendSuccess(res, { booking: { id: result.booking_id, ...result } }, 'Payment verified and booking confirmed!');
  } catch (error) {
    if (error.message.includes('Booking not found') || error.message.includes('expired') || error.message.includes('mismatch')) {
       return sendError(res, error.message, 400);
    }
    next(error);
  }
};

// Invoked by Razorpay Webhook
const handleWebhook = async (req, res, next) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || 'mock_secret';

    // 1. Verify Webhook Signature
    const valid = paymentProvider.verifyWebhook(req.rawBody || JSON.stringify(req.body), signature, secret);
    
    if (!valid) {
      return sendError(res, 'Invalid webhook signature', 400);
    }

    const { event, payload } = req.body;

    if (event === 'order.paid' || event === 'payment.captured') {
      const paymentEntity = payload.payment.entity;
      const orderId = paymentEntity.order_id;
      const paymentId = paymentEntity.id;
      const amount = paymentEntity.amount / 100; // Assuming amount is in paise

      const provider = process.env.PAYMENT_PROVIDER === 'mock' ? 'MOCK' : 'RAZORPAY';
      
      // We don't fetch advance_required first here because the webhook payload HAS the actual paid amount.
      // The RPC will reject it if amount != advance_required.
      
      try {
         await confirmPayment(orderId, paymentId, provider, amount);
      } catch (err) {
         console.error('Webhook confirmation error:', err.message);
         // Return 200 even on expected errors (like expired or mismatch) so Razorpay doesn't aggressively retry.
         // Real errors should ideally be logged or alerted.
      }
    }

    // Always return 200 OK to the provider
    res.status(200).json({ status: 'ok' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  verifyPaymentAndConfirm,
  handleWebhook
};
