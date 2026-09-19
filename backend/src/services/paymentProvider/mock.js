const crypto = require('crypto');

const createOrder = async ({ amount, receipt, notes }) => {
  const mockOrderId = `order_mock_${Date.now()}`;
  return {
    id: mockOrderId,
    amount,
    currency: 'INR',
    receipt,
    status: 'created',
    notes,
    isMock: true
  };
};

const verifyPayment = ({ order_id, payment_id, signature }) => {
  // In mock provider, we expect a deterministic signature or just "mock_sig_*"
  if (signature.startsWith('mock_sig_')) return true;
  return false;
};

const verifyWebhook = (body, signature, secret) => {
  // Expected secret is mock_secret
  // Expected signature is just "mock_webhook_sig"
  if (signature === 'mock_webhook_sig') return true;
  return false;
};

module.exports = {
  createOrder,
  verifyPayment,
  verifyWebhook
};
