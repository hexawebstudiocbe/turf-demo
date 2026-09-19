const mockProvider = require('./mock');
const razorpayProvider = require('./razorpay');

const getProvider = () => {
  const providerType = process.env.PAYMENT_PROVIDER || 'mock';
  if (providerType === 'razorpay') {
    return razorpayProvider;
  }
  return mockProvider;
};

module.exports = getProvider();
