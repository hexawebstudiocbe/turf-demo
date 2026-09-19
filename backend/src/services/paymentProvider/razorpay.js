const Razorpay = require('razorpay');
const crypto = require('crypto');

const getRazorpayInstance = () => {
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
};

const createOrder = async ({ amount, receipt, notes }) => {
  const rzp = getRazorpayInstance();
  const options = {
    amount: Math.round(amount * 100), // amount in the smallest currency unit
    currency: 'INR',
    receipt,
    notes
  };
  return await rzp.orders.create(options);
};

const verifyPayment = ({ order_id, payment_id, signature }) => {
  const body = order_id + '|' + payment_id;
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body.toString())
    .digest('hex');
  return expectedSignature === signature;
};

const verifyWebhook = (body, signature, secret) => {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  return expectedSignature === signature;
};

module.exports = {
  createOrder,
  verifyPayment,
  verifyWebhook
};
