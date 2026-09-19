const supabase = require('../config/supabase');

const {
  calculateMultiHourPrice,
} = require('./pricingService');

const {
  isDateInPast,
  isSlotInPast,
  getConsecutiveSlotIntervals,
  timeToMinutes,
} = require('../utils/timeHelper');

const paymentProvider = require('./paymentProvider');

const {
  generateBookingQRToken,
} = require('../utils/qrHelper');

const generateBookingId = (
  dateStr
) => {
  const cleanDate =
    dateStr.replace(/-/g, '');

  const randomSuffix =
    Math.floor(
      10000 +
      Math.random() * 90000
    );

  return `TB-${cleanDate}-${randomSuffix}`;
};

const getTurf = async (turfId) => {
  const { data, error } = await supabase
    .from('turf')
    .select('*')
    .eq('id', turfId)
    .eq('active', true)
    .single();

  if (error || !data) {
    const err =
      new Error('Turf not found');

    err.statusCode = 404;

    throw err;
  }

  return data;
};

const getOrCreateCustomer = async ({
  name,
  phone,
}) => {
  const cleanName =
    String(name || '').trim();

  const cleanPhone =
    String(phone || '').trim();

  if (!cleanName || !cleanPhone) {
    const error =
      new Error(
        'Customer name and phone are required'
      );

    error.statusCode = 400;

    throw error;
  }

  const {
    data: existing,
    error: lookupError,
  } = await supabase
    .from('customers')
    .select('*')
    .eq('phone', cleanPhone)
    .order('created_at', {
      ascending: true,
    })
    .limit(1)
    .maybeSingle();

  if (lookupError) {
    throw new Error(
      `Unable to find customer: ${lookupError.message}`
    );
  }

  if (existing) {
    if (
      existing.name !==
      cleanName
    ) {
      const {
        data: updated,
        error: updateError,
      } = await supabase
        .from('customers')
        .update({
          name: cleanName,
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (updateError) {
        throw new Error(
          `Unable to update customer: ${updateError.message}`
        );
      }

      return updated;
    }

    return existing;
  }

  const {
    data: customer,
    error,
  } = await supabase
    .from('customers')
    .insert({
      name: cleanName,
      phone: cleanPhone,
    })
    .select()
    .single();

  if (error) {
    throw new Error(
      `Unable to create customer: ${error.message}`
    );
  }

  return customer;
};

const holdSlot = async ({
  turfId,
  date,
  startTime,
  durationHours = 1,
  customerDetails,
  sport,
}) => {
  if (
    !turfId ||
    !date ||
    !startTime ||
    !customerDetails
  ) {
    const error =
      new Error(
        'Missing required booking details'
      );

    error.statusCode = 400;

    throw error;
  }

  // --------------------------------------------------------
  // Customer = name + phone only
  // --------------------------------------------------------

  if (
    !customerDetails.name ||
    !customerDetails.phone
  ) {
    const error =
      new Error(
        'Customer name and phone number are required'
      );

    error.statusCode = 400;

    throw error;
  }

  const turf =
    await getTurf(turfId);

  const hours =
    Number(durationHours);

  if (
    !Number.isInteger(hours) ||
    hours < 1
  ) {
    const error =
      new Error(
        'Duration must be a whole number of hours'
      );

    error.statusCode = 400;

    throw error;
  }

  if (
    isDateInPast(date)
  ) {
    const error =
      new Error(
        'Cannot book slots for past dates'
      );

    error.statusCode = 400;

    throw error;
  }

  if (
    isSlotInPast(
      date,
      startTime
    )
  ) {
    const error =
      new Error(
        'This time slot has already passed for today'
      );

    error.statusCode = 400;

    throw error;
  }

  const {
    intervals,
    slotTimes,
    endTime,
  } =
    getConsecutiveSlotIntervals(
      startTime,
      hours,
      60
    );

  const closingMins =
    timeToMinutes(
      turf.closing_time ||
      '23:00'
    );

  const endMins =
    timeToMinutes(endTime);

  if (
    endMins >
    closingMins
  ) {
    const error =
      new Error(
        `Requested duration exceeds turf closing time (${turf.closing_time || '23:00'})`
      );

    error.statusCode = 400;

    throw error;
  }

  // --------------------------------------------------------
  // Business hours check
  // --------------------------------------------------------

  const dayOfWeek =
    new Date(
      `${date}T00:00:00`
    ).getUTCDay();

  const {
    data: businessHours,
    error: hoursError,
  } = await supabase
    .from('business_hours')
    .select('*')
    .eq('turf_id', turfId)
    .eq('day_of_week', dayOfWeek)
    .single();

  if (
    hoursError ||
    !businessHours ||
    !businessHours.is_open
  ) {
    const error =
      new Error(
        'The turf is closed on the selected date'
      );

    error.statusCode = 409;

    throw error;
  }

  // --------------------------------------------------------
  // Calculate server-side price
  // --------------------------------------------------------

  const pricing =
    await calculateMultiHourPrice(
      turfId,
      date,
      startTime,
      hours
    );

  const bookingNumber =
    generateBookingId(date);

  const holdExpiresAt =
    new Date(
      Date.now() +
      10 * 60 * 1000
    );

  // --------------------------------------------------------
  // Customer
  // --------------------------------------------------------

  const customer =
    await getOrCreateCustomer({
      name:
        customerDetails.name,
      phone:
        customerDetails.phone,
    });

  // --------------------------------------------------------
  // IMPORTANT:
  // Reserve slots FIRST through PostgreSQL RPC.
  //
  // We don't create a Razorpay order before the DB hold.
  // Otherwise an order could exist for a slot that failed
  // to reserve.
  // --------------------------------------------------------

  let bookingId;

  try {
    const {
      data,
      error,
    } = await supabase.rpc(
      'create_booking_hold',
      {
        p_turf_id: turfId,
        p_customer_id:
          customer.id,
        p_booking_date:
          date,
        p_start_time:
          startTime,
        p_duration_hours:
          hours,
        p_total_amount:
          pricing.totalAmount,
        p_advance_required:
          pricing.advanceAmount,
        p_booking_number:
          bookingNumber,
        p_hold_expires_at:
          holdExpiresAt.toISOString(),
      }
    );

    if (error) {
      const conflict =
        new Error(
          error.message.includes(
            'unavailable'
          )
            ? 'One or more requested slots are unavailable'
            : error.message
        );

      conflict.statusCode = 409;

      throw conflict;
    }

    bookingId = data;
  } catch (error) {
    throw error;
  }

  // --------------------------------------------------------
  // Create Razorpay order
  // --------------------------------------------------------

  let razorpayOrder;

  try {
    razorpayOrder =
      await paymentProvider.createOrder({
        amount:
          pricing.advanceAmount,
        receipt:
          bookingNumber,
        notes: {
          bookingId:
            bookingNumber,
          turfId:
            String(turfId),
          date,
          startTime,
          endTime,
          durationHours:
            hours,
          customerName:
            customer.name,
          customerPhone:
            customer.phone,
        },
      });
  } catch (error) {
    // If Razorpay creation fails, release the DB hold.
    await supabase
      .from(
        'slot_reservations'
      )
      .delete()
      .eq(
        'booking_id',
        bookingId
      );

    await supabase
      .from('bookings')
      .update({
        booking_status:
          'PAYMENT_FAILED',
        payment_status:
          'FAILED',
      })
      .eq(
        'id',
        bookingId
      );

    throw error;
  }

  // --------------------------------------------------------
  // Attach Razorpay order to booking
  // --------------------------------------------------------

  const {
    data: booking,
    error: updateError,
  } = await supabase
    .from('bookings')
    .update({
      razorpay_order_id:
        razorpayOrder.id,
    })
    .eq('id', bookingId)
    .select()
    .single();

  if (updateError) {
    throw new Error(
      `Unable to save payment order: ${updateError.message}`
    );
  }

  return {
    bookingId:
      booking.booking_number,

    orderId:
      razorpayOrder.id,

    currency: 'INR',

    startTime,
    endTime,

    durationHours:
      hours,

    slotTimes,

    slotBreakdown:
      pricing.slotBreakdown,

    totalAmount:
      pricing.totalAmount,

    advanceAmount:
      pricing.advanceAmount,

    remainingAmount:
      pricing.remainingAmount,

    holdExpiresAt,

    isMockPayment:
      razorpayOrder.isMock ||
      false,

    keyId:
      process.env.RAZORPAY_KEY_ID ||
      'rzp_test_placeholder',

    customerDetails: {
      name:
        customer.name,
      phone:
        customer.phone,
    },

    booking,
  };
};

module.exports = {
  holdSlot,
};
