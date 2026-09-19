const fs = require('fs');
let b = fs.readFileSync('src/services/bookingService.js', 'utf8');

// Replace razorpay import with paymentProvider
b = b.replace(
  /const \s*\{\s*createOrder,\s*verifyPaymentSignature,\s*\}\s*=\s*require\('\.\.\/config\/razorpay'\);/,
  "const paymentProvider = require('./paymentProvider');"
);

// Replace createOrder call
b = b.replace(/await createOrder\(\{/g, 'await paymentProvider.createOrder({');

fs.writeFileSync('src/services/bookingService.js', b);
console.log('Fixed bookingService.js');
