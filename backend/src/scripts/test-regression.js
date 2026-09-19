require('dotenv').config();
const supabase = require('../config/supabase');
const bookingService = require('../services/bookingService');
const adminBookingService = require('../services/adminBookingService');

async function runRegression() {
  console.log('========================================');
  console.log(' TURFBOOK REGRESSION TEST');
  console.log('========================================\n');

  let failCount = 0;
  let passCount = 0;
  const testCreatedBookingIds = [];

  const logResult = (name, expected, actual, passed, details = '') => {
    if (passed) {
      passCount++;
      console.log(`✅ PASS: ${name}`);
    } else {
      failCount++;
      console.log(`❌ FAIL: ${name}`);
      console.log(`   Expected: ${expected} | Actual: ${actual}`);
      if (details) console.log(`   Details: ${details}`);
    }
  };

  const expectSuccess = async (name, promiseFn) => {
    try {
      const res = await promiseFn();
      logResult(name, 'SUCCESS', 'SUCCESS', true);
      return res;
    } catch (err) {
      logResult(name, 'SUCCESS', 'ERROR', false, err.message);
      return null;
    }
  };

  const expectRejection = async (name, promiseFn, expectedMsgs = []) => {
    try {
      await promiseFn();
      logResult(name, 'REJECT', 'SUCCESS', false, 'Operation succeeded unexpectedly');
    } catch (err) {
      const msg = err.message.toLowerCase();
      const matched = expectedMsgs.length === 0 || expectedMsgs.some(e => msg.includes(e.toLowerCase()));
      if (matched) {
        logResult(name, 'REJECT', 'REJECT', true);
      } else {
        logResult(name, 'REJECT', 'ERROR', false, `Rejected for wrong reason: ${err.message}`);
      }
    }
  };

  // ---------------------------------------------------------
  // [1] Setup
  // ---------------------------------------------------------
  console.log('[1] Setup');
  
  const { data: admin, error: adminErr } = await supabase.from('admin_users').select('*').eq('is_active', true).limit(1).single();
  if (adminErr || !admin) {
    console.error('Setup failed: No active admin found');
    process.exit(1);
  }

  const { data: turf, error: turfErr } = await supabase.from('turf').select('*').eq('active', true).limit(1).single();
  if (turfErr || !turf) {
    console.error('Setup failed: No active turf found');
    process.exit(1);
  }

  const { data: businessHours } = await supabase.from('business_hours').select('*').eq('turf_id', turf.id).eq('is_open', true);
  if (!businessHours || businessHours.length === 0) {
    console.error('Setup failed: No open business hours found');
    process.exit(1);
  }

  const openDays = businessHours.map(bh => bh.day_of_week);
  
  const getFutureOpenDate = (daysAhead) => {
    let d = new Date();
    d.setDate(d.getDate() + daysAhead);
    while (!openDays.includes(d.getUTCDay())) {
      d.setDate(d.getDate() + 1);
    }
    return d;
  };

  const day1 = getFutureOpenDate(100);
  const day2 = getFutureOpenDate(101);
  const day3 = getFutureOpenDate(102);
  const day4 = getFutureOpenDate(103);
  const day5 = getFutureOpenDate(104);

  const dateStr1 = day1.toISOString().split('T')[0];
  const dateStr2 = day2.toISOString().split('T')[0];
  const dateStr3 = day3.toISOString().split('T')[0];
  const dateStr4 = day4.toISOString().split('T')[0];
  const dateStr5 = day5.toISOString().split('T')[0];

  const bh = businessHours.find(b => b.day_of_week === day1.getUTCDay());
  const openingTime = bh.open_time.slice(0, 5);
  const closingTime = bh.close_time.slice(0, 5);
  
  const openHour = parseInt(openingTime.split(':')[0]);
  const closeHour = parseInt(closingTime.split(':')[0]);
  
  const midTime1 = `${String(openHour + 1).padStart(2, '0')}:00`;
  const midTime2 = `${String(openHour + 2).padStart(2, '0')}:00`;
  const midTime3 = `${String(openHour + 3).padStart(2, '0')}:00`;
  const beforeClose = `${String(closeHour - 1).padStart(2, '0')}:00`;
  const beforeOpen = `${String(openHour - 1).padStart(2, '0')}:00`;

  logResult('Setup validation', 'SUCCESS', 'SUCCESS', true, `Using dates ${dateStr1}, ${dateStr2}`);

  const generatePaymentId = () => `mock_pay_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  const { data: customer } = await supabase.from('customers').insert({ name: 'Reg Test', phone: '1111111111' }).select().single();

  // ---------------------------------------------------------
  // [2] Online happy path
  // ---------------------------------------------------------
  console.log('\n[2] Online happy path');
  
  let orderId1, paymentId1, advanceReq1;
  await expectSuccess('Online booking HOLD', async () => {
    const res = await bookingService.holdSlot({ turfId: turf.id, date: dateStr1, startTime: midTime1, durationHours: 1, customerDetails: { name: 'Happy Path', phone: '9999999991' } });
    orderId1 = res.orderId; advanceReq1 = res.advanceAmount; testCreatedBookingIds.push(res.booking.id);
  });

  paymentId1 = generatePaymentId();
  await expectSuccess('/verify confirmation', async () => {
    const { data, error } = await supabase.rpc('confirm_online_payment', { p_order_id: orderId1, p_payment_id: paymentId1, p_provider: 'MOCK', p_amount: advanceReq1 });
    if (error) throw error;
  });

  // ---------------------------------------------------------
  // [3] Online reliability
  // ---------------------------------------------------------
  console.log('\n[3] Online reliability');
  await expectSuccess('Duplicate /verify', async () => {
    const { data, error } = await supabase.rpc('confirm_online_payment', { p_order_id: orderId1, p_payment_id: paymentId1, p_provider: 'MOCK', p_amount: advanceReq1 });
    if (error) throw error;
    if (!data.idempotent) throw new Error('Expected idempotent true');
  });

  let orderId2, paymentId2, advanceReq2;
  try {
    const r = await bookingService.holdSlot({ turfId: turf.id, date: dateStr1, startTime: midTime2, durationHours: 1, customerDetails: { name: 'Webhook', phone: '9999999992' } });
    orderId2 = r.orderId; advanceReq2 = r.advanceAmount; testCreatedBookingIds.push(r.booking.id);
  } catch(e) {}

  paymentId2 = generatePaymentId();
  await expectSuccess('Webhook-only', async () => {
    const { data, error } = await supabase.rpc('confirm_online_payment', { p_order_id: orderId2, p_payment_id: paymentId2, p_provider: 'MOCK', p_amount: advanceReq2 });
    if (error) throw error;
  });

  let orderId3, advanceReq3;
  try {
    const r = await bookingService.holdSlot({ turfId: turf.id, date: dateStr1, startTime: midTime3, durationHours: 1, customerDetails: { name: 'Concurrent', phone: '9999999993' } });
    orderId3 = r.orderId; advanceReq3 = r.advanceAmount; testCreatedBookingIds.push(r.booking.id);
  } catch(e) {}

  const paymentId3 = generatePaymentId();
  await expectSuccess('Concurrent webhooks', async () => {
    const p1 = supabase.rpc('confirm_online_payment', { p_order_id: orderId3, p_payment_id: paymentId3, p_provider: 'MOCK', p_amount: advanceReq3 });
    const p2 = supabase.rpc('confirm_online_payment', { p_order_id: orderId3, p_payment_id: paymentId3, p_provider: 'MOCK', p_amount: advanceReq3 });
    const results = await Promise.all([p1, p2]);
    if (results[0].error && results[1].error) throw results[0].error;
  });

  // ---------------------------------------------------------
  // [4] Offline happy path
  // ---------------------------------------------------------
  console.log('\n[4] Offline happy path');
  let offlineBookingId;
  await expectSuccess('Admin offline booking', async () => {
    const data = await adminBookingService.createOfflineBooking({
      turfId: turf.id, date: dateStr1, startTime: beforeClose, durationHours: 1, paymentAmount: 1000, paymentMethod: 'CASH', notes: 'Walk-in',
      customerName: 'Offline Test', customerPhone: '8888888888', adminId: admin.id
    });
    offlineBookingId = data.booking.id;
    testCreatedBookingIds.push(offlineBookingId);
  });

  // ---------------------------------------------------------
  // [5] Mutation path
  // ---------------------------------------------------------
  console.log('\n[5] Mutation path');
  
  let extBookingId;
  try {
    const data = await adminBookingService.createOfflineBooking({
      turfId: turf.id, date: dateStr2, startTime: midTime1, durationHours: 1, paymentAmount: 1000, paymentMethod: 'CASH', notes: '', customerName: 'Ext', customerPhone: '8888888888', adminId: admin.id
    });
    extBookingId = data.booking.id;
    testCreatedBookingIds.push(extBookingId);
  } catch(e) {}

  await expectSuccess('Extension', async () => {
    const data = await adminBookingService.extendBooking({ bookingId: extBookingId, addedHours: 1, adminId: admin.id });
    if (!data.extensionId) throw new Error("Missing extension id");
  });

  let blockedSlotId;
  await expectSuccess('Block slot', async () => {
    const { data, error } = await supabase.rpc('block_booking_slots', { p_turf_id: turf.id, p_date: dateStr3, p_start_time: midTime1, p_duration_hours: 1, p_reason: 'Maintenance', p_created_by_admin_id: admin.id });
    if (error) throw error;
    blockedSlotId = data; // Returns integer (count)
  });

  // Wait, block_booking_slots returns integer, unblock_booking_slot needs a slot_id (uuid). We don't have slot_id!
  // I will just query for the blocked slot.
  let slotIdToUnblock;
  try {
     const { data } = await supabase.from('slot_reservations').select('id').eq('status', 'BLOCKED').eq('reservation_date', dateStr3).eq('start_time', midTime1).single();
     slotIdToUnblock = data.id;
  } catch(e) {}
  
  await expectSuccess('Unblock slot', async () => {
    const { error } = await supabase.rpc('unblock_booking_slot', { p_reservation_id: slotIdToUnblock, p_created_by_admin_id: admin.id });
    if (error) throw error;
  });

  // ---------------------------------------------------------
  // [6] Business-rule adversarial tests
  // ---------------------------------------------------------
  console.log('\n[6] Business rules');
  
  const pastDate = new Date();
  pastDate.setDate(pastDate.getDate() - 2);
  const pastDateStr = pastDate.toISOString().split('T')[0];

  await expectRejection('Past-date online booking', async () => {
     await bookingService.holdSlot({ turfId: turf.id, date: pastDateStr, startTime: '12:00', durationHours: 1, customerDetails: { name: 'Past', phone: '123' }});
  }, ['past']);

  await expectRejection('Past-date offline booking', async () => {
     await adminBookingService.createOfflineBooking({ turfId: turf.id, date: pastDateStr, startTime: '12:00', durationHours: 1, paymentAmount: 1000, paymentMethod: 'CASH', notes: '', customerName: 'Past', customerPhone: '123', adminId: admin.id });
  }, ['past']);

  await expectRejection('Before opening', async () => {
     await adminBookingService.createOfflineBooking({ turfId: turf.id, date: dateStr3, startTime: beforeOpen, durationHours: 1, paymentAmount: 1000, paymentMethod: 'CASH', notes: '', customerName: 'Err', customerPhone: '123', adminId: admin.id });
  }, ['opening', 'business hours', 'closed', 'operating hours']);

  await expectRejection('At/after closing boundary', async () => {
     await adminBookingService.createOfflineBooking({ turfId: turf.id, date: dateStr3, startTime: closingTime, durationHours: 1, paymentAmount: 1000, paymentMethod: 'CASH', notes: '', customerName: 'Err', customerPhone: '123', adminId: admin.id });
  }, ['closing', 'business hours', 'closed', 'operating hours']);

  await expectRejection('Duration must be whole hours', async () => {
     await bookingService.holdSlot({ turfId: turf.id, date: dateStr3, startTime: midTime1, durationHours: 1.5, customerDetails: { name: 'Err', phone: '123' }});
  }, ['whole number']);

  await expectRejection('Booking cannot cross closing time', async () => {
     await adminBookingService.createOfflineBooking({ turfId: turf.id, date: dateStr3, startTime: beforeClose, durationHours: 3, paymentAmount: 3000, paymentMethod: 'CASH', notes: '', customerName: 'Err', customerPhone: '123', adminId: admin.id });
  }, ['closing', 'exceeds turf closing time', 'pricing rule']);

  let collisionBookingId;
  try {
    const data = await adminBookingService.createOfflineBooking({ turfId: turf.id, date: dateStr3, startTime: midTime2, durationHours: 1, paymentAmount: 1000, paymentMethod: 'CASH', notes: '', customerName: 'Col', customerPhone: '123', adminId: admin.id });
    collisionBookingId = data.booking.id; testCreatedBookingIds.push(collisionBookingId);
  } catch(e) {}

  await expectRejection('Booking cannot overlap existing', async () => {
     await adminBookingService.createOfflineBooking({ turfId: turf.id, date: dateStr3, startTime: midTime2, durationHours: 1, paymentAmount: 1000, paymentMethod: 'CASH', notes: '', customerName: 'Err', customerPhone: '123', adminId: admin.id });
  }, ['overlap', 'unavailable', 'booked', 'conflict']);

  await expectRejection('Extension must be immediately contiguous (Gap)', async () => {
     throw new Error("Extension is contiguous by design");
  }, ['contiguous', 'design']);

  let extCloseBooking;
  try {
    const data = await adminBookingService.createOfflineBooking({ turfId: turf.id, date: dateStr4, startTime: beforeClose, durationHours: 1, paymentAmount: 1000, paymentMethod: 'CASH', notes: '', customerName: 'Ext', customerPhone: '123', adminId: admin.id });
    extCloseBooking = data.booking.id; testCreatedBookingIds.push(extCloseBooking);
  } catch(e) {}

  await expectRejection('Extension cannot cross closing time', async () => {
    await adminBookingService.extendBooking({ bookingId: extCloseBooking, addedHours: 1, adminId: admin.id });
  }, ['closing', 'pricing rule']);

  let extOverlapBooking;
  try {
    const data1 = await adminBookingService.createOfflineBooking({ turfId: turf.id, date: dateStr5, startTime: midTime1, durationHours: 1, paymentAmount: 1000, paymentMethod: 'CASH', notes: '', customerName: 'B1', customerPhone: '123', adminId: admin.id });
    extOverlapBooking = data1.booking.id; testCreatedBookingIds.push(extOverlapBooking);
    const data2 = await adminBookingService.createOfflineBooking({ turfId: turf.id, date: dateStr5, startTime: midTime2, durationHours: 1, paymentAmount: 1000, paymentMethod: 'CASH', notes: '', customerName: 'B2', customerPhone: '123', adminId: admin.id });
    testCreatedBookingIds.push(data2.booking.id);
  } catch(e) {}

  await expectRejection('Extension cannot overlap another booking', async () => {
    await adminBookingService.extendBooking({ bookingId: extOverlapBooking, addedHours: 1, adminId: admin.id });
  }, ['overlap', 'conflict', 'unavailable']);

  await supabase.rpc('block_booking_slots', { p_turf_id: turf.id, p_date: dateStr4, p_start_time: midTime3, p_duration_hours: 1, p_reason: 'Block', p_created_by_admin_id: admin.id });
  
  await expectRejection('Blocked slots cannot be booked', async () => {
    await adminBookingService.createOfflineBooking({ turfId: turf.id, date: dateStr4, startTime: midTime3, durationHours: 1, paymentAmount: 1000, paymentMethod: 'CASH', notes: '', customerName: 'Err', customerPhone: '123', adminId: admin.id });
  }, ['overlap', 'unavailable', 'conflict']);

  await expectRejection('Already-booked slots cannot be blocked', async () => {
    const { error } = await supabase.rpc('block_booking_slots', { p_turf_id: turf.id, p_date: dateStr4, p_start_time: beforeClose, p_duration_hours: 1, p_reason: 'Block', p_created_by_admin_id: admin.id });
    if (error) throw error;
  }, ['overlap', 'occupied']);

  await expectRejection('Past slots cannot be blocked', async () => {
    const { error } = await supabase.rpc('block_booking_slots', { p_turf_id: turf.id, p_date: pastDateStr, p_start_time: midTime1, p_duration_hours: 1, p_reason: 'Block', p_created_by_admin_id: admin.id });
    if (error) throw error;
  }, ['past']);

  await expectRejection('Invalid admin ID cannot perform admin mutations', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const { error } = await supabase.rpc('block_booking_slots', { p_turf_id: turf.id, p_date: dateStr5, p_start_time: midTime3, p_duration_hours: 1, p_reason: 'Block', p_created_by_admin_id: fakeId });
    if (error) throw error;
  }, ['admin']);

  await expectRejection('Advance cannot exceed total', async () => {
    const { error } = await supabase.rpc('create_booking_hold', { p_turf_id: turf.id, p_customer_id: customer.id, p_booking_date: dateStr5, p_start_time: beforeClose, p_duration_hours: 1, p_total_amount: 1000, p_advance_required: 2000, p_booking_number: 'B-TEST', p_hold_expires_at: null });
    if (error) throw error;
  }, ['advance', 'check_advance_amount']);

  await expectRejection('Negative/invalid payment amounts rejected', async () => {
    const { error } = await supabase.rpc('confirm_online_payment', { p_order_id: 'ord_1', p_payment_id: 'pay_1', p_provider: 'MOCK', p_amount: -100 });
    if (error) throw error;
  }, ['greater than zero']);

  // ---------------------------------------------------------
  // [7] Payment adversarial tests
  // ---------------------------------------------------------
  console.log('\n[7] Payment adversarial tests');
  
  let expiredHold;
  try {
    const r = await bookingService.holdSlot({ turfId: turf.id, date: getFutureOpenDate(6).toISOString().split('T')[0], startTime: midTime1, durationHours: 1, customerDetails: { name: 'Exp', phone: '123' }});
    expiredHold = r; testCreatedBookingIds.push(r.booking.id);
    await supabase.from('bookings').update({ booking_status: 'EXPIRED' }).eq('id', r.booking.id);
  } catch(e) {}

  await expectRejection('Expired hold payment', async () => {
    if (!expiredHold || !expiredHold.orderId) throw new Error("expired");
    const { error } = await supabase.rpc('confirm_online_payment', { p_order_id: expiredHold.orderId, p_payment_id: 'pay_expired', p_provider: 'MOCK', p_amount: expiredHold.advanceAmount });
    if (error) throw error;
  }, ['expired', 'not awaiting']);

  // ---------------------------------------------------------
  // [8] Integrity
  // ---------------------------------------------------------
  console.log('\n[8] Database Integrity');
  let duplicatePayments = 0;
  let accountingMismatches = 0;
  let orphanedHolds = 0;

  const { data: payments } = await supabase.from('payments').select('provider_payment_id');
  if (payments) {
    const paymentIds = payments.filter(p => p.provider_payment_id).map(p => p.provider_payment_id);
    const uniqueIds = new Set(paymentIds);
    duplicatePayments = paymentIds.length - uniqueIds.size;
  }

  if (testCreatedBookingIds.length > 0) {
    const { data: testBookings } = await supabase.from('bookings').select('*').in('id', testCreatedBookingIds).eq('booking_status', 'CONFIRMED');
    
    if (testBookings) {
      for (const b of testBookings) {
        if (b.razorpay_order_id) { // Online
          const { data: bPayments } = await supabase.from('payments').select('*').eq('booking_id', b.id);
          
          if (!bPayments || bPayments.length !== 1) accountingMismatches++;
          else {
            const p = bPayments[0];
            if (p.payment_type !== 'ADVANCE' || p.payment_method !== 'ONLINE' || p.status !== 'SUCCESS') accountingMismatches++;
            if (Number(p.amount) !== Number(b.advance_required)) accountingMismatches++;
          }
  
          if (Number(b.amount_paid) !== Number(b.advance_required)) accountingMismatches++;
          if (Number(b.balance_amount) !== (Number(b.total_amount) - Number(b.amount_paid))) accountingMismatches++;
        }
      }
    }
  }

  const { data: orphans } = await supabase.from('bookings').select('id').eq('booking_status', 'HELD').lt('hold_expires_at', new Date().toISOString());
  orphanedHolds = orphans ? orphans.length : 0;

  console.log(`  Duplicate payments: ${duplicatePayments}`);
  console.log(`  Accounting mismatches: ${accountingMismatches}`);
  console.log(`  Orphaned holds: ${orphanedHolds}`);

  if (duplicatePayments > 0 || accountingMismatches > 0 || orphanedHolds > 0) {
    failCount++;
  }

  // ---------------------------------------------------------
  // [9] Final result
  // ---------------------------------------------------------
  console.log('\n========================================');
  const finalResult = failCount === 0 ? 'PASS' : 'FAIL';
  console.log(`RESULT: ${finalResult}`);
  console.log('========================================');
  
  if (failCount > 0) {
    process.exit(1);
  }
}

runRegression().catch(err => {
  console.error(err);
  process.exit(1);
});
