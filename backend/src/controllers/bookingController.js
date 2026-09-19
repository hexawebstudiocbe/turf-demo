const bookingService = require('../services/bookingService');
const { sendSuccess, sendError } = require('../utils/response');
const supabase = require('../config/supabase');

const holdSlot = async (req, res, next) => {
  try {
    const { date, startTime, durationHours, duration, customerDetails, sport } = req.body;

    const { data: turf, error: turfError } = await supabase
      .from('turf')
      .select('id')
      .eq('active', true)
      .limit(1)
      .maybeSingle();

    if (turfError) {
      throw new Error(`Failed to load turf: ${turfError.message}`);
    }

    if (!turf) {
      throw new Error('No active turf configured');
    }

    if (
      !customerDetails ||
      !customerDetails.name ||
      !customerDetails.phone
    ) {
      return sendError(
        res,
        'Please provide customer name and phone number',
        400
      );
    }

    const holdResult = await bookingService.holdSlot({
      turfId: turf.id,
      date,
      startTime,
      durationHours: durationHours || (duration ? Math.round(duration / 60) : 1),
      customerDetails,
      sport,
      userId: req.user ? req.user._id : null,
    });

    return sendSuccess(res, holdResult, 'Slot(s) held successfully. Please complete payment within 10 minutes.', 201);
  } catch (error) {
    next(error);
  }
};

const verifyPaymentAndConfirm = async (req, res, next) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

    if (!razorpayOrderId) {
      return sendError(res, 'razorpayOrderId is required', 400);
    }

    const booking = await bookingService.confirmBooking({
      razorpayOrderId,
      razorpayPaymentId: razorpayPaymentId || `pay_mock_${Date.now()}`,
      razorpaySignature: razorpaySignature || 'mock_sig_verified',
    });

    return sendSuccess(
      res,
      {
        booking,
        message: 'Payment verified and booking confirmed!',
      },
      'Booking Confirmed'
    );
  } catch (error) {
    next(error);
  }
};

const getBookingById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select(`
        *,
        customers (
          id,
          name,
          phone
        ),
        turf (
          id,
          name,
          address,
          city,
          state
        )
      `)
      .eq(id.startsWith('TB-') ? 'booking_number' : 'id', id)
      .maybeSingle();

    if (bookingError) {
      throw new Error(
        `Failed to load booking: ${bookingError.message}`
      );
    }

    if (!booking) {
      return sendError(res, 'Booking not found', 404);
    }

    const result = {
      id: booking.id,

      bookingId: booking.booking_number,
      bookingNumber: booking.booking_number,

      turfId: booking.turf_id,
      turf: booking.turf || null,

      date: booking.booking_date,
      bookingDate: booking.booking_date,

      startTime: booking.start_time,
      endTime: booking.end_time,
      duration: booking.duration_hours,

      bookingStatus: booking.status,
      status: booking.status,

      paymentStatus: booking.payment_status,

      totalAmount: Number(booking.total_amount || 0),
      advanceAmount: Number(booking.advance_required || 0),
      amountPaid: Number(booking.amount_paid || 0),
      remainingAmount: Number(booking.balance_amount || 0),

      customerId: booking.customer_id,
      customerDetails: booking.customers
        ? {
            name: booking.customers.name,
            phone: booking.customers.phone,
          }
        : null,

      source: booking.source,

      holdExpiresAt: booking.hold_expires_at,

      razorpayOrderId: booking.razorpay_order_id,
      razorpayPaymentId: booking.razorpay_payment_id,

      qrToken: booking.qr_token,

      createdAt: booking.created_at,
      updatedAt: booking.updated_at,
    };

    return sendSuccess(
      res,
      { booking: result },
      'Booking retrieved'
    );
  } catch (error) {
    next(error);
  }
};

const getMyBookings = async (req, res, next) => {
  try {
    const phone =
      req.query.phone ||
      req.body?.phone ||
      req.user?.phone;

    if (!phone) {
      return sendError(res, 'Phone number is required', 400);
    }

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id, name, phone')
      .eq('phone', phone)
      .maybeSingle();

    if (customerError) {
      throw new Error(
        `Failed to find customer: ${customerError.message}`
      );
    }

    if (!customer) {
      return sendSuccess(
        res,
        { bookings: [] },
        'No bookings found'
      );
    }

    const { data: bookings, error: bookingsError } = await supabase
      .from('bookings')
      .select(`
        *,
        turf (
          id,
          name
        )
      `)
      .eq('customer_id', customer.id)
      .order('booking_date', { ascending: false })
      .order('start_time', { ascending: false });

    if (bookingsError) {
      throw new Error(
        `Failed to load customer bookings: ${bookingsError.message}`
      );
    }

    const result = (bookings || []).map((booking) => ({
      id: booking.id,

      bookingId: booking.booking_number,
      bookingNumber: booking.booking_number,

      turfId: booking.turf_id,
      turf: booking.turf || null,

      date: booking.booking_date,
      bookingDate: booking.booking_date,

      startTime: booking.start_time,
      endTime: booking.end_time,
      duration: booking.duration_hours,

      bookingStatus: booking.status,
      status: booking.status,

      paymentStatus: booking.payment_status,

      totalAmount: Number(booking.total_amount || 0),
      advanceAmount: Number(booking.advance_required || 0),
      amountPaid: Number(booking.amount_paid || 0),
      remainingAmount: Number(booking.balance_amount || 0),

      source: booking.source,

      createdAt: booking.created_at,
      updatedAt: booking.updated_at,
    }));

    return sendSuccess(
      res,
      {
        customer: {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
        },
        bookings: result,
      },
      'Bookings retrieved'
    );
  } catch (error) {
    next(error);
  }
};

const cancelCustomerBooking = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const result = await bookingService.cancelBooking(id, req.user, reason);
    return sendSuccess(res, result, result.message);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  holdSlot,
  
  getBookingById,
  getMyBookings,
  
};
