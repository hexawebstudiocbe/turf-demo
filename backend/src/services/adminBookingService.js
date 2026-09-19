const supabase = require('../config/supabase');

const {
  calculateMultiHourPrice,
} = require('./pricingService');

const {
  getConsecutiveSlotIntervals,
} = require('../utils/timeHelper');

const generateBookingId = (dateStr) => {
  const cleanDate =
    dateStr.replace(/-/g, '');

  const random =
    Math.floor(
      10000 +
      Math.random() * 90000
    );

  return `TB-${cleanDate}-${random}`;
};


const getActiveTurf = async () => {
  const {
    data,
    error,
  } = await supabase
    .from('turf')
    .select('*')
    .eq('active', true)
    .single();

  if (error || !data) {
    throw new Error(
      'Turf not found'
    );
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
    throw new Error(
      'Customer name and phone are required'
    );
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
      lookupError.message
    );
  }

  if (existing) {
    if (
      existing.name !== cleanName
    ) {
      const {
        data: updated,
        error,
      } = await supabase
        .from('customers')
        .update({
          name: cleanName,
        })
        .eq(
          'id',
          existing.id
        )
        .select()
        .single();

      if (error) {
        throw new Error(
          error.message
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
      error.message
    );
  }

  return customer;
};


const createOfflineBooking = async ({
  date,
  startTime,
  durationHours,
  customerName,
  customerPhone,
  paymentAmount,
  paymentMethod,
  paymentReference,
  notes,
  adminId,
}) => {

  const turf =
    await getActiveTurf();

  const hours =
    Number(durationHours);

  if (
    !Number.isInteger(hours) ||
    hours < 1
  ) {
    throw new Error(
      'Duration must be a whole number of hours'
    );
  }

  const customer =
    await getOrCreateCustomer({
      name: customerName,
      phone: customerPhone,
    });

  const pricing =
    await calculateMultiHourPrice(
      turf.id,
      date,
      startTime,
      hours
    );

  const bookingNumber =
    generateBookingId(date);

  const {
    data: bookingId,
    error,
  } = await supabase.rpc(
    'create_offline_booking',
    {
      p_turf_id:
        turf.id,

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

      p_payment_amount:
        Number(paymentAmount),

      p_payment_method:
        paymentMethod,

      p_payment_reference:
        paymentReference ||
        null,

      p_notes:
        notes || null,
        
      p_created_by_admin_id:
        adminId,
    }
  );

  if (error) {
    const conflict =
      new Error(
        error.message
      );

    conflict.statusCode = 409;

    throw conflict;
  }

  const {
    data: booking,
    error: bookingError,
  } = await supabase
    .from('bookings')
    .select(`
      *,
      customer:customer_id(*),
      turf:turf_id(*)
    `)
    .eq(
      'id',
      bookingId
    )
    .single();

  if (bookingError) {
    throw new Error(
      bookingError.message
    );
  }

  return {
    booking,
    pricing,
  };
};


const extendBooking = async ({
  bookingId,
  addedHours,
  adminId,
}) => {

  const {
    data: booking,
    error,
  } = await supabase
    .from('bookings')
    .select(`
      *,
      customer:customer_id(*)
    `)
    .eq(
      'id',
      bookingId
    )
    .single();

  if (error || !booking) {
    throw new Error(
      'Booking not found'
    );
  }

  if (
    booking.booking_status !==
    'CONFIRMED'
  ) {
    throw new Error(
      'Only confirmed bookings can be extended'
    );
  }

  const hours =
    Number(addedHours);

  if (
    !Number.isInteger(hours) ||
    hours < 1
  ) {
    throw new Error(
      'Extension must be a whole number of hours'
    );
  }

  const pricing =
    await calculateMultiHourPrice(
      booking.turf_id,
      booking.booking_date,
      booking.end_time.slice(0, 5),
      hours
    );

  const {
    data: extensionId,
    error: extensionError,
  } = await supabase.rpc(
    'extend_booking',
    {
      p_booking_id:
        bookingId,

      p_added_hours:
        hours,

      p_added_amount:
        pricing.totalAmount,

      p_created_by_admin_id:
        adminId,
    }
  );

  if (extensionError) {
    const conflict =
      new Error(
        extensionError.message
      );

    conflict.statusCode = 409;

    throw conflict;
  }

  const {
    data: updatedBooking,
    error: reloadError,
  } = await supabase
    .from('bookings')
    .select(`
      *,
      customer:customer_id(*),
      turf:turf_id(*)
    `)
    .eq(
      'id',
      bookingId
    )
    .single();

  if (reloadError) {
    throw new Error(
      reloadError.message
    );
  }

  return {
    booking:
      updatedBooking,

    extensionId,

    addedHours:
      hours,

    addedAmount:
      pricing.totalAmount,

    slotBreakdown:
      pricing.slotBreakdown,
  };
};


module.exports = {
  createOfflineBooking,
  extendBooking,
};
