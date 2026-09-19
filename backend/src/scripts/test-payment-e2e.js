require('dotenv').config();
const { createOfflineBooking } = require('../services/adminBookingService'); // or we just use holdSlot
const bookingService = require('../services/bookingService');
const paymentProvider = require('../services/paymentProvider');
const supabase = require('../config/supabase');

async function runPaymentTests() {
  console.log('--- Payment Reliability Tests ---');
  let passCount = 0;
  let failCount = 0;

  // Find active turf
  const { data: turf } = await supabase.from('turf').select('*').eq('active', true).limit(1).single();
  
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const todayStr = tomorrow.toISOString().split('T')[0];

  const expectSuccess = async (name, promiseFn) => {
    try {
      const result = await promiseFn();
      console.log(`✅ PASS: [${name}]`);
      passCount++;
      return result;
    } catch (err) {
      console.log(`❌ FAIL: [${name}] - ${err.message}`);
      failCount++;
      return null;
    }
  };

  const expectError = async (name, promiseFn, expectedMsgs) => {
    try {
      await promiseFn();
      console.log(`❌ FAIL: [${name}] - Operation succeeded but should have failed.`);
      failCount++;
    } catch (err) {
      if (!expectedMsgs || expectedMsgs.some(m => err.message.includes(m))) {
         console.log(`✅ PASS: [${name}] - Rejected correctly: ${err.message}`);
         passCount++;
      } else {
         console.log(`❌ FAIL: [${name}] - Failed for wrong reason: ${err.message}`);
         failCount++;
      }
    }
  };

  // 1. Normal Mock payment & /verify
  // We simulate what holdSlot does
  let holdResult;
  try {
     holdResult = await bookingService.holdSlot({
       turfId: turf.id,
       date: todayStr,
       startTime: '16:00', // Assume it's open
       durationHours: 1,
       customerDetails: { name: 'Test', phone: '9999999999' }
     });
  } catch (err) {
     console.error('Failed to create hold for test:', err.message);
     return;
  }

  const { orderId, advanceAmount } = holdResult;
  // create mock payment id
  const paymentId1 = `mock_pay_${Date.now()}`;

  // /verify equivalent
  await expectSuccess('Normal /verify confirmation', async () => {
     const { data, error } = await supabase.rpc('confirm_online_payment', {
        p_order_id: orderId,
        p_payment_id: paymentId1,
        p_provider: 'MOCK',
        p_amount: advanceAmount
     });
     if (error) throw error;
     if (!data.success) throw new Error('Not success');
     return data;
  });

  // /verify repeated
  await expectSuccess('Duplicate /verify (idempotent)', async () => {
     const { data, error } = await supabase.rpc('confirm_online_payment', {
        p_order_id: orderId,
        p_payment_id: paymentId1,
        p_provider: 'MOCK',
        p_amount: advanceAmount
     });
     if (error) throw error;
     if (!data.idempotent) throw new Error('Should be idempotent true');
     return data;
  });

  // 2. Webhook only
  let holdResult2;
  try {
     holdResult2 = await bookingService.holdSlot({
       turfId: turf.id,
       date: todayStr,
       startTime: '17:00',
       durationHours: 1,
       customerDetails: { name: 'Test 2', phone: '9999999999' }
     });
  } catch(e) {}

  const orderId2 = holdResult2.orderId;
  const paymentId2 = `mock_pay_${Date.now()}_2`;

  await expectSuccess('Webhook-only confirmation', async () => {
     const { data, error } = await supabase.rpc('confirm_online_payment', {
        p_order_id: orderId2,
        p_payment_id: paymentId2,
        p_provider: 'MOCK',
        p_amount: holdResult2.advanceAmount
     });
     if (error) throw error;
     return data;
  });

  // 3. Concurrent webhooks (Race condition simulation)
  let holdResult3;
  try {
     holdResult3 = await bookingService.holdSlot({
       turfId: turf.id,
       date: todayStr,
       startTime: '18:00',
       durationHours: 1,
       customerDetails: { name: 'Test 3', phone: '9999999999' }
     });
  } catch(e) {}

  const orderId3 = holdResult3.orderId;
  const paymentId3 = `mock_pay_${Date.now()}_3`;

  await expectSuccess('Concurrent webhooks', async () => {
     // Fire two promises simultaneously
     const p1 = supabase.rpc('confirm_online_payment', {
        p_order_id: orderId3, p_payment_id: paymentId3, p_provider: 'MOCK', p_amount: holdResult3.advanceAmount
     });
     const p2 = supabase.rpc('confirm_online_payment', {
        p_order_id: orderId3, p_payment_id: paymentId3, p_provider: 'MOCK', p_amount: holdResult3.advanceAmount
     });
     const results = await Promise.all([p1, p2]);
     
     if (results[0].error && results[1].error) throw results[0].error;
     
     // Check that there is EXACTLY ONE payment in the ledger
     const { data: payments } = await supabase.from('payments').select('*').eq('provider_order_id', orderId3);
     if (payments.length !== 1) {
         throw new Error(`Expected 1 ledger row, found ${payments.length}`);
     }
  });

  // 4. Expired Hold (simulating 15 minutes later by modifying the hold_expires_at manually)
  let holdResult4;
  try {
     holdResult4 = await bookingService.holdSlot({
       turfId: turf.id,
       date: todayStr,
       startTime: '19:00',
       durationHours: 1,
       customerDetails: { name: 'Test 4', phone: '9999999999' }
     });
  } catch(e) {}

  // Expire it manually in DB
  await supabase.from('bookings').update({ booking_status: 'EXPIRED' }).eq('razorpay_order_id', holdResult4.orderId);

  await expectError('Expired hold payment', async () => {
     const { data, error } = await supabase.rpc('confirm_online_payment', {
        p_order_id: holdResult4.orderId,
        p_payment_id: `mock_pay_${Date.now()}_4`,
        p_provider: 'MOCK',
        p_amount: holdResult4.advanceAmount
     });
     if (error) throw error;
  }, ['expired', 'Booking is not awaiting']);
  
  console.log(`\nRESULTS: ${passCount} Passed, ${failCount} Failed.`);
}

runPaymentTests().catch(console.error);
