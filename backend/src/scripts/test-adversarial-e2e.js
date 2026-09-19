require('dotenv').config();
const supabase = require('../config/supabase');
const { createOfflineBooking, extendBooking } = require('../services/adminBookingService');

async function runAdversarialTests() {
  console.log('--- Adversarial E2E Tests ---');
  let passCount = 0;
  let failCount = 0;

  // 1. Get an admin
  const { data: admin } = await supabase.from('admin_users').select('*').limit(1).single();
  const adminId = admin ? admin.id : '00000000-0000-0000-0000-000000000000';
  console.log('Using adminId:', adminId);

  // 2. Get the active turf
  const { data: turf } = await supabase.from('turf').select('*').eq('active', true).limit(1).single();
  if (!turf) {
    console.error('No active turf found to test against. Exiting.');
    return;
  }
  console.log('Using turf:', turf.name, 'Open:', turf.opening_time, 'Close:', turf.closing_time);

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  const expectError = async (name, promiseFn, expectedMsgMatches) => {
    try {
      await promiseFn();
      console.log(`❌ FAIL: [${name}] - Operation succeeded but should have failed.`);
      failCount++;
    } catch (err) {
      if (!expectedMsgMatches || expectedMsgMatches.some(msg => err.message.includes(msg))) {
         console.log(`✅ PASS: [${name}] - Rejected correctly: ${err.message}`);
         passCount++;
      } else {
         console.log(`❌ FAIL: [${name}] - Failed for wrong reason. Expected ~[${expectedMsgMatches}], got: ${err.message}`);
         failCount++;
      }
    }
  };

  // 1. Past offline booking
  await expectError('Past offline booking', () => createOfflineBooking({
    date: yesterdayStr,
    startTime: '14:00',
    durationHours: 1,
    customerName: 'Adversary',
    customerPhone: '9999999999',
    paymentAmount: 1500,
    paymentMethod: 'CASH',
    adminId
  }), ['past', 'Cannot create bookings in the past']);

  // 2. Booking before opening time
  await expectError('Booking before opening time', () => createOfflineBooking({
    date: todayStr,
    startTime: '01:00', // Assuming it's closed at 1 AM
    durationHours: 1,
    customerName: 'Adversary',
    customerPhone: '9999999999',
    paymentAmount: 1500,
    paymentMethod: 'CASH',
    adminId
  }), ['outside of operating hours', 'falls outside']);

  // 3. Booking past closing time
  await expectError('Booking past closing time', () => createOfflineBooking({
    date: todayStr,
    startTime: '23:00', 
    durationHours: 5, // Definitely past closing
    customerName: 'Adversary',
    customerPhone: '9999999999',
    paymentAmount: 1500,
    paymentMethod: 'CASH',
    adminId
  }), ['outside of operating hours', 'falls outside']);

  // 4. Invalid duration
  await expectError('Invalid duration', () => createOfflineBooking({
    date: todayStr,
    startTime: '10:00', 
    durationHours: 0, 
    customerName: 'Adversary',
    customerPhone: '9999999999',
    paymentAmount: 1500,
    paymentMethod: 'CASH',
    adminId
  }), ['Duration must be', 'whole number', 'at least 1']);

  // 5. Advance > total
  // Not testing via service since service calculates pricing. But we can test payment > total.
  await expectError('Payment > total', () => createOfflineBooking({
    date: todayStr,
    startTime: '10:00', 
    durationHours: 1, 
    customerName: 'Adversary',
    customerPhone: '9999999999',
    paymentAmount: 9999999,
    paymentMethod: 'CASH',
    adminId
  }), ['cannot exceed booking total']);

  // 6. Negative/invalid payment
  await expectError('Negative payment', () => createOfflineBooking({
    date: todayStr,
    startTime: '10:00', 
    durationHours: 1, 
    customerName: 'Adversary',
    customerPhone: '9999999999',
    paymentAmount: -500,
    paymentMethod: 'CASH',
    adminId
  }), ['must be at least']);

  // 7. Invalid/inactive admin
  await expectError('Invalid/inactive admin', () => createOfflineBooking({
    date: todayStr,
    startTime: '10:00', 
    durationHours: 1, 
    customerName: 'Adversary',
    customerPhone: '9999999999',
    paymentAmount: 1500,
    paymentMethod: 'CASH',
    adminId: '00000000-0000-0000-0000-000000000000'
  }), ['Invalid or inactive admin ID', 'admin ID']);

  // Next, we need a real booking to test extensions.
  let realBookingId = null;
  try {
     const res = await createOfflineBooking({
        date: todayStr,
        startTime: '12:00', 
        durationHours: 1, 
        customerName: 'Adversary',
        customerPhone: '9999999999',
        paymentAmount: 1500,
        paymentMethod: 'CASH',
        adminId
     });
     realBookingId = res.booking.id;
     console.log('✅ Created real booking to test extensions:', realBookingId);
  } catch(e) {
     console.error('Failed to create setup booking:', e.message);
  }

  if (realBookingId) {
      // 8. Extension of completed booking (if date is today, and it's 12:00 to 13:00, it might be in the past depending on current time)
      // We will skip this exact test unless we know the current time, but let's test extension beyond closing.
      
      // 9. Extension beyond closing
      await expectError('Extension beyond closing', () => extendBooking({
        bookingId: realBookingId,
        addedHours: 20,
        adminId
      }), ['exceeds turf closing time', 'outside']);

      // 10. Extension into occupied slot
      // Let's create another booking at 13:00
      try {
          await createOfflineBooking({
            date: todayStr,
            startTime: '13:00', 
            durationHours: 1, 
            customerName: 'Adversary 2',
            customerPhone: '9999999998',
            paymentAmount: 1500,
            paymentMethod: 'CASH',
            adminId
         });
      } catch(e) {}
      
      await expectError('Extension into occupied slot', () => extendBooking({
        bookingId: realBookingId,
        addedHours: 1,
        adminId
      }), ['unavailable', 'occupied', 'already']);
  }

  // 11-13 Blocking
  await expectError('Blocking a past slot', () => supabase.rpc('block_booking_slots', {
      p_turf_id: turf.id,
      p_date: yesterdayStr,
      p_start_time: '14:00',
      p_duration_hours: 1,
      p_reason: 'Testing',
      p_created_by_admin_id: adminId
  }).then(r => { if(r.error) throw r.error; return r; }), ['past', 'Cannot block time slots']);

  await expectError('Blocking outside business hours', () => supabase.rpc('block_booking_slots', {
      p_turf_id: turf.id,
      p_date: todayStr,
      p_start_time: '01:00',
      p_duration_hours: 1,
      p_reason: 'Testing',
      p_created_by_admin_id: adminId
  }).then(r => { if(r.error) throw r.error; return r; }), ['outside', 'business hours', 'operating hours']);

  await expectError('Blocking an already-booked slot', () => supabase.rpc('block_booking_slots', {
      p_turf_id: turf.id,
      p_date: todayStr,
      p_start_time: '12:00',
      p_duration_hours: 1,
      p_reason: 'Testing',
      p_created_by_admin_id: adminId
  }).then(r => { if(r.error) throw r.error; return r; }), ['unavailable', 'occupied']);

  console.log(`\nRESULTS: ${passCount} Passed, ${failCount} Failed.`);
}

runAdversarialTests().catch(console.error);
