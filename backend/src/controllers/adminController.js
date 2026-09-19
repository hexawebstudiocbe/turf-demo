const supabase = require('../config/supabase');
const adminBookingService = require('../services/adminBookingService');
const { getSlotsForDate } = require('../services/slotService');
const { sendSuccess, sendError } = require('../utils/response');

const getDashboardStats = async (req, res, next) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Get active turf
    const { data: turf, error: turfError } = await supabase
      .from('turf')
      .select('id')
      .eq('active', true)
      .limit(1)
      .maybeSingle();

    if (turfError) {
      throw new Error(`Failed to load turf: ${turfError.message}`);
    }

    // 1. Today's bookings
    const { data: todayBookings, error: todayBookingsError } = await supabase
      .from('bookings')
      .select('*')
      .eq('booking_date', today)
      .in('status', ['CONFIRMED', 'COMPLETED']);

    if (todayBookingsError) {
      throw new Error(
        `Failed to load today's bookings: ${todayBookingsError.message}`
      );
    }

    const todayBookingRows = todayBookings || [];

    const todayBookingsCount = todayBookingRows.length;

    const todayAdvanceRevenue = todayBookingRows.reduce(
      (sum, b) => sum + Number(b.advance_required || 0),
      0
    );

    const todayTotalBookingValue = todayBookingRows.reduce(
      (sum, b) => sum + Number(b.total_amount || 0),
      0
    );

    const todayPendingBalance = todayBookingRows.reduce(
      (sum, b) => sum + Number(b.balance_amount || 0),
      0
    );

    // 2. All-time confirmed/completed bookings
    const { data: allConfirmed, error: allConfirmedError } = await supabase
      .from('bookings')
      .select('*')
      .in('status', ['CONFIRMED', 'COMPLETED']);

    if (allConfirmedError) {
      throw new Error(
        `Failed to load booking statistics: ${allConfirmedError.message}`
      );
    }

    const allConfirmedRows = allConfirmed || [];

    const totalRevenue = allConfirmedRows.reduce(
      (sum, b) => sum + Number(b.advance_required || 0),
      0
    );

    const totalBookingsCount = allConfirmedRows.length;

    // Customers do not have accounts, so count customers table.
    const { count: totalCustomersCount, error: customersError } =
      await supabase
        .from('customers')
        .select('id', { count: 'exact', head: true });

    if (customersError) {
      throw new Error(
        `Failed to load customer count: ${customersError.message}`
      );
    }

    // 3. Today's turf occupancy
    const slotsData = turf
      ? await getSlotsForDate(turf.id, today)
      : { totalSlots: 17, slots: [] };

    const totalDaySlots = slotsData.totalSlots || 17;

    const occupancyRate =
      totalDaySlots > 0
        ? Math.round((todayBookingsCount / totalDaySlots) * 100)
        : 0;

    // 4. Active blocked slots
    const { count: activeBlockedSlots, error: blockedSlotsError } =
      await supabase
        .from('slot_reservations')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'BLOCKED')
        .eq('turf_id', turf?.id || '');

    if (blockedSlotsError) {
      throw new Error(
        `Failed to load blocked slot count: ${blockedSlotsError.message}`
      );
    }

    // 5. Recent / upcoming bookings
    const { data: upcomingRows, error: upcomingError } = await supabase
      .from('bookings')
      .select(`
        *,
        customers (
          id,
          name,
          phone
        )
      `)
      .in('status', ['CONFIRMED', 'HELD'])
      .order('booking_date', { ascending: true })
      .order('start_time', { ascending: true })
      .limit(8);

    if (upcomingError) {
      throw new Error(
        `Failed to load upcoming bookings: ${upcomingError.message}`
      );
    }

    const upcomingBookings = (upcomingRows || []).map((booking) => ({
      id: booking.id,
      bookingId: booking.booking_number,
      bookingNumber: booking.booking_number,

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

      customerDetails: booking.customers
        ? {
            name: booking.customers.name,
            phone: booking.customers.phone,
          }
        : null,

      createdAt: booking.created_at,
    }));

    return sendSuccess(
      res,
      {
        today: {
          date: today,
          bookingsCount: todayBookingsCount,
          advanceRevenue: todayAdvanceRevenue,
          totalBookingValue: todayTotalBookingValue,
          pendingBalance: todayPendingBalance,
          occupancyRate,
        },

        overview: {
          totalRevenue,
          totalBookingsCount,
          totalCustomersCount: totalCustomersCount || 0,
          activeBlockedSlots: activeBlockedSlots || 0,
        },

        upcomingBookings,
      },
      'Dashboard stats retrieved'
    );
  } catch (error) {
    next(error);
  }
};

const getAdminBookings = async (req, res, next) => {
  try {
    const {
      search,
      status,
      date,
      page = 1,
      limit = 25,
    } = req.query;

    const pageNumber = Math.max(Number(page) || 1, 1);
    const limitNumber = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const offset = (pageNumber - 1) * limitNumber;

    let customerIds = null;

    // Search customer name/phone separately because those fields
    // live in the customers table.
    if (search) {
      const { data: matchingCustomers, error: customerSearchError } =
        await supabase
          .from('customers')
          .select('id')
          .or(`name.ilike.%${search}%,phone.ilike.%${search}%`);

      if (customerSearchError) {
        throw new Error(
          `Failed to search customers: ${customerSearchError.message}`
        );
      }

      customerIds = (matchingCustomers || []).map((customer) => customer.id);
    }

    let query = supabase
      .from('bookings')
      .select(
        `
          *,
          customers (
            id,
            name,
            phone
          ),
          turf (
            id,
            name
          )
        `,
        { count: 'exact' }
      );

    if (status && status !== 'ALL') {
      query = query.eq('status', status);
    }

    if (date) {
      query = query.eq('booking_date', date);
    }

    if (search) {
      const searchParts = [];

      // Booking number search.
      searchParts.push(`booking_number.ilike.%${search}%`);

      // Customer search.
      if (customerIds && customerIds.length > 0) {
        searchParts.push(`customer_id.in.(${customerIds.join(',')})`);
      }

      query = query.or(searchParts.join(','));
    }

    const {
      data: bookings,
      error: bookingsError,
      count,
    } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNumber - 1);

    if (bookingsError) {
      throw new Error(
        `Failed to load admin bookings: ${bookingsError.message}`
      );
    }

    const mappedBookings = (bookings || []).map((booking) => ({
      id: booking.id,

      bookingId: booking.booking_number,
      bookingNumber: booking.booking_number,

      turfId: booking.turf_id,
      turf: booking.turf
        ? {
            id: booking.turf.id,
            name: booking.turf.name,
          }
        : null,

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

      createdAt: booking.created_at,
      updatedAt: booking.updated_at,
    }));

    return sendSuccess(
      res,
      {
        bookings: mappedBookings,
        pagination: {
          total: count || 0,
          page: pageNumber,
          limit: limitNumber,
          pages: Math.ceil((count || 0) / limitNumber),
        },
      },
      'Bookings retrieved'
    );
  } catch (error) {
    next(error);
  }
};

const updateBookingStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['CONFIRMED', 'COMPLETED', 'NO_SHOW'].includes(status)) {
      return sendError(res, 'Invalid status', 400);
    }

    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (bookingError) {
      throw new Error(
        `Failed to load booking: ${bookingError.message}`
      );
    }

    if (!booking) {
      return sendError(res, 'Booking not found', 404);
    }

    const updateData = {
      status,
    };

    // Preserve the existing behavior of marking payment as paid
    // when an admin marks the booking COMPLETED.
    if (status === 'COMPLETED') {
      updateData.payment_status = 'PAID';
    }

    const { data: updatedBooking, error: updateError } = await supabase
      .from('bookings')
      .update(updateData)
      .eq('id', id)
      .select(`
        *,
        customers (
          id,
          name,
          phone
        ),
        turf (
          id,
          name
        )
      `)
      .single();

    if (updateError) {
      throw new Error(
        `Failed to update booking status: ${updateError.message}`
      );
    }

    const mappedBooking = {
      id: updatedBooking.id,

      bookingId: updatedBooking.booking_number,
      bookingNumber: updatedBooking.booking_number,

      turfId: updatedBooking.turf_id,
      turf: updatedBooking.turf || null,

      date: updatedBooking.booking_date,
      bookingDate: updatedBooking.booking_date,

      startTime: updatedBooking.start_time,
      endTime: updatedBooking.end_time,
      duration: updatedBooking.duration_hours,

      bookingStatus: updatedBooking.status,
      status: updatedBooking.status,

      paymentStatus: updatedBooking.payment_status,

      totalAmount: Number(updatedBooking.total_amount || 0),
      advanceAmount: Number(updatedBooking.advance_required || 0),
      amountPaid: Number(updatedBooking.amount_paid || 0),
      remainingAmount: Number(updatedBooking.balance_amount || 0),

      customerId: updatedBooking.customer_id,
      customerDetails: updatedBooking.customers
        ? {
            name: updatedBooking.customers.name,
            phone: updatedBooking.customers.phone,
          }
        : null,

      source: updatedBooking.source,

      createdAt: updatedBooking.created_at,
      updatedAt: updatedBooking.updated_at,
    };

    return sendSuccess(
      res,
      { booking: mappedBooking },
      `Booking marked as ${status}`
    );
  } catch (error) {
    next(error);
  }
};

const createOfflineBooking = async (
  req,
  res,
  next
) => {
  try {
    const {
      date,
      startTime,
      durationHours,
      customerName,
      customerPhone,
      paymentAmount,
      paymentMethod,
      paymentReference,
      notes,
    } = req.body;

    if (
      !date ||
      !startTime ||
      !durationHours ||
      !customerName ||
      !customerPhone ||
      paymentAmount === undefined ||
      !paymentMethod
    ) {
      return sendError(
        res,
        'Date, start time, duration, customer name, customer phone, advance amount and payment method are required',
        400
      );
    }

    const result =
      await adminBookingService
        .createOfflineBooking({
          date,
          startTime,
          durationHours,
          customerName,
          customerPhone,
          paymentAmount,
          paymentMethod,
          paymentReference,
          notes,
          adminId: req.admin.id,
        });

    return sendSuccess(
      res,
      result,
      'Offline booking created successfully',
      201
    );
  } catch (error) {
    next(error);
  }
};


const extendBooking = async (
  req,
  res,
  next
) => {
  try {
    const {
      id,
    } = req.params;

    const {
      addedHours,
    } = req.body;

    if (!addedHours) {
      return sendError(
        res,
        'addedHours is required',
        400
      );
    }

    const result =
      await adminBookingService
        .extendBooking({
          bookingId: id,
          addedHours,
          adminId: req.admin.id,
        });

    return sendSuccess(
      res,
      result,
      'Booking extended successfully'
    );
  } catch (error) {
    next(error);
  }
};

const getAdminSlots = async (req, res, next) => {
  try {
    const { date } = req.query;

    if (!date) {
      return sendError(res, 'Date is required', 400);
    }

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
      return sendError(res, 'Turf not found', 404);
    }

    const slotsData = await getSlotsForDate(turf.id, date);

    return sendSuccess(
      res,
      slotsData,
      'Admin slots retrieved'
    );
  } catch (error) {
    next(error);
  }
};

const blockSlot = async (
  req,
  res,
  next
) => {
  try {
    const {
      date,
      startTime,
      durationHours,
      reason,
    } = req.body;

    if (
      !date ||
      !startTime ||
      !durationHours
    ) {
      return sendError(
        res,
        'Date, startTime, and durationHours are required',
        400
      );
    }

    const {
      data: turf,
      error: turfError,
    } = await supabase
      .from('turf')
      .select('id')
      .eq('active', true)
      .single();

    if (turfError || !turf) {
      return sendError(
        res,
        'Turf not found',
        404
      );
    }

    const {
      data: blockedCount,
      error,
    } = await supabase.rpc(
      'block_booking_slots',
      {
        p_turf_id:
          turf.id,

        p_date:
          date,

        p_start_time:
          startTime,

        p_duration_hours:
          Number(
            durationHours
          ),

        p_reason:
          reason ||
          'Maintenance',
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

    return sendSuccess(
      res,
      {
        blockedSlots:
          blockedCount,
      },
      'Slots blocked successfully',
      201
    );
  } catch (error) {
    next(error);
  }
};

const unblockSlot = async (
  req,
  res,
  next
) => {
  try {
    const {
      id,
    } = req.params;

    const {
      data,
      error,
    } = await supabase.rpc(
      'unblock_booking_slot',
      {
        p_reservation_id:
          id,
      }
    );

    if (error) {
      const err =
        new Error(
          error.message
        );

      err.statusCode = 404;

      throw err;
    }

    return sendSuccess(
      res,
      {
        unblocked:
          data === true,
      },
      'Slot unblocked successfully'
    );
  } catch (error) {
    next(error);
  }
};

const getPricingConfig = async (req, res, next) => {
  try {
    const {
      data: turf,
      error: turfError,
    } = await supabase
      .from('turf')
      .select('*')
      .eq('active', true)
      .single();

    if (turfError || !turf) {
      return sendError(
        res,
        'Turf not found',
        404
      );
    }

    const {
      data: settings,
      error: settingsError,
    } = await supabase
      .from('turf_settings')
      .select('*')
      .eq('turf_id', turf.id)
      .single();

    if (settingsError) {
      throw new Error(
        settingsError.message
      );
    }

    const {
      data: rules,
      error: rulesError,
    } = await supabase
      .from('pricing_rules')
      .select('*')
      .eq('turf_id', turf.id)
      .order('priority', {
        ascending: false,
      });

    if (rulesError) {
      throw new Error(
        rulesError.message
      );
    }

    return sendSuccess(
      res,
      {
        defaultPrice:
          turf.default_price !== null
            ? Number(
                turf.default_price
              )
            : null,

        advanceType:
          'percentage',

        advanceValue:
          Number(
            settings.advance_percentage
          ),

        onlineHoldMinutes:
          settings.online_hold_minutes,

        rules:
          (rules || []).map(
            (rule) => ({
              id: rule.id,
              _id: rule.id,
              name: rule.name,
              daysOfWeek:
                rule.days_of_week,
              startTime:
                rule.start_time,
              endTime:
                rule.end_time,
              price:
                Number(
                  rule.price_per_hour
                ),
              priority:
                rule.priority,
              isActive:
                rule.is_active,
            })
          ),
      },
      'Pricing config retrieved'
    );
  } catch (error) {
    next(error);
  }
};

const updatePricingConfig = async (
  req,
  res,
  next
) => {
  try {
    const {
      defaultPrice,
      advanceValue,
      rules,
    } = req.body;

    const {
      data: turf,
      error: turfError,
    } = await supabase
      .from('turf')
      .select('id')
      .eq('active', true)
      .single();

    if (turfError || !turf) {
      return sendError(
        res,
        'Turf not found',
        404
      );
    }

    // ------------------------------------------------------
    // Update default/display price
    // ------------------------------------------------------

    if (
      defaultPrice !== undefined
    ) {
      const {
        error,
      } = await supabase
        .from('turf')
        .update({
          default_price:
            Number(defaultPrice),
        })
        .eq(
          'id',
          turf.id
        );

      if (error) {
        throw new Error(
          error.message
        );
      }
    }

    // ------------------------------------------------------
    // Update 30% advance configuration
    // ------------------------------------------------------

    if (
      advanceValue !== undefined
    ) {
      const percentage =
        Number(advanceValue);

      if (
        percentage < 0 ||
        percentage > 100
      ) {
        return sendError(
          res,
          'Advance percentage must be between 0 and 100',
          400
        );
      }

      const {
        error,
      } = await supabase
        .from('turf_settings')
        .update({
          advance_percentage:
            percentage,
        })
        .eq(
          'turf_id',
          turf.id
        );

      if (error) {
        throw new Error(
          error.message
        );
      }
    }

    // ------------------------------------------------------
    // Replace pricing rules
    // ------------------------------------------------------

    if (
      Array.isArray(rules)
    ) {
      const {
        error: deleteError,
      } = await supabase
        .from('pricing_rules')
        .delete()
        .eq(
          'turf_id',
          turf.id
        );

      if (deleteError) {
        throw new Error(
          deleteError.message
        );
      }

      const rows =
        rules.map(
          (rule) => ({
            turf_id:
              turf.id,

            name:
              rule.name,

            days_of_week:
              rule.daysOfWeek ||
              [],

            start_time:
              rule.startTime,

            end_time:
              rule.endTime,

            price_per_hour:
              Number(
                rule.price
              ),

            priority:
              Number(
                rule.priority ||
                1
              ),

            is_active:
              rule.isActive !== false,
          })
        );

      if (rows.length > 0) {
        const {
          error: insertError,
        } = await supabase
          .from(
            'pricing_rules'
          )
          .insert(rows);

        if (insertError) {
          throw new Error(
            insertError.message
          );
        }
      }
    }

    return sendSuccess(
      res,
      {
        updated: true,
      },
      'Pricing configuration updated successfully'
    );
  } catch (error) {
    next(error);
  }
};

const updateTurf = async (
  req,
  res,
  next
) => {
  try {
    const {
      name,
      tagline,
      description,
      address,
      city,
      state,
      country,
      latitude,
      longitude,
      googleMapsUrl,
      mapsUrl,
      sports,
      amenities,
      openingTime,
      closingTime,
      defaultPrice,
      gallery,
      contactPhone,
      whatsappNumber,
      emergencyPhone,
    } = req.body;

    const {
      data: turf,
      error: findError,
    } = await supabase
      .from('turf')
      .select('*')
      .eq('active', true)
      .single();

    if (findError || !turf) {
      return sendError(
        res,
        'Turf not found',
        404
      );
    }

    const updates = {};

    if (name !== undefined)
      updates.name = name;

    if (tagline !== undefined)
      updates.tagline = tagline;

    if (description !== undefined)
      updates.description =
        description;

    if (address !== undefined)
      updates.address =
        address;

    if (city !== undefined)
      updates.city = city;

    if (state !== undefined)
      updates.state = state;

    if (country !== undefined)
      updates.country =
        country;

    if (latitude !== undefined)
      updates.latitude =
        Number(latitude);

    if (longitude !== undefined)
      updates.longitude =
        Number(longitude);

    if (
      googleMapsUrl !== undefined
    ) {
      updates.maps_url =
        googleMapsUrl;
    } else if (
      mapsUrl !== undefined
    ) {
      updates.maps_url =
        mapsUrl;
    }

    if (sports !== undefined)
      updates.sports = sports;

    if (amenities !== undefined)
      updates.amenities =
        amenities;

    if (
      openingTime !== undefined
    ) {
      updates.opening_time =
        openingTime;
    }

    if (
      closingTime !== undefined
    ) {
      updates.closing_time =
        closingTime;
    }

    if (
      defaultPrice !== undefined
    ) {
      updates.default_price =
        Number(defaultPrice);
    }

    if (gallery !== undefined)
      updates.gallery = gallery;

    if (
      contactPhone !== undefined
    ) {
      updates.contact_phone =
        contactPhone;
    }

    if (
      whatsappNumber !== undefined
    ) {
      updates.whatsapp_phone =
        whatsappNumber;
    }

    if (
      emergencyPhone !== undefined
    ) {
      updates.emergency_phone =
        emergencyPhone;
    }

    const {
      data: updatedTurf,
      error: updateError,
    } = await supabase
      .from('turf')
      .update(updates)
      .eq(
        'id',
        turf.id
      )
      .select()
      .single();

    if (updateError) {
      throw new Error(
        updateError.message
      );
    }

    // ------------------------------------------------------
    // Keep business hours synchronized for all open days.
    //
    // Individual closed days will be handled separately.
    // ------------------------------------------------------

    if (
      openingTime !== undefined ||
      closingTime !== undefined
    ) {
      const hourUpdate = {};

      if (
        openingTime !== undefined
      ) {
        hourUpdate.open_time =
          openingTime;
      }

      if (
        closingTime !== undefined
      ) {
        hourUpdate.close_time =
          closingTime;
      }

      const {
        error: hoursError,
      } = await supabase
        .from('business_hours')
        .update(hourUpdate)
        .eq(
          'turf_id',
          turf.id
        )
        .eq(
          'is_open',
          true
        );

      if (hoursError) {
        throw new Error(
          hoursError.message
        );
      }
    }

    return sendSuccess(
      res,
      {
        turf:
          updatedTurf,
      },
      'Turf profile updated successfully'
    );
  } catch (error) {
    next(error);
  }
};

const getCustomers = async (req, res, next) => {
  try {
    const { data: customers, error: customersError } = await supabase
      .from('customers')
      .select('id, name, phone, created_at, updated_at')
      .order('created_at', { ascending: false });

    if (customersError) {
      throw new Error(
        `Failed to load customers: ${customersError.message}`
      );
    }

    const customerRows = customers || [];

    // Get booking counts for the customers.
    const customerIds = customerRows.map((customer) => customer.id);

    let bookingRows = [];

    if (customerIds.length > 0) {
      const { data, error: bookingsError } = await supabase
        .from('bookings')
        .select('id, customer_id, total_amount, amount_paid, created_at')
        .in('customer_id', customerIds);

      if (bookingsError) {
        throw new Error(
          `Failed to load customer bookings: ${bookingsError.message}`
        );
      }

      bookingRows = data || [];
    }

    const bookingsByCustomer = new Map();

    for (const booking of bookingRows) {
      const existing = bookingsByCustomer.get(booking.customer_id) || {
        bookingsCount: 0,
        totalBookingValue: 0,
        amountPaid: 0,
      };

      existing.bookingsCount += 1;
      existing.totalBookingValue += Number(booking.total_amount || 0);
      existing.amountPaid += Number(booking.amount_paid || 0);

      bookingsByCustomer.set(booking.customer_id, existing);
    }

    const result = customerRows.map((customer) => {
      const stats = bookingsByCustomer.get(customer.id) || {
        bookingsCount: 0,
        totalBookingValue: 0,
        amountPaid: 0,
      };

      return {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,

        bookingsCount: stats.bookingsCount,
        totalBookingValue: stats.totalBookingValue,
        amountPaid: stats.amountPaid,

        createdAt: customer.created_at,
        updatedAt: customer.updated_at,
      };
    });

    return sendSuccess(
      res,
      { customers: result },
      'Customers retrieved'
    );
  } catch (error) {
    next(error);
  }
};

const getPayments = async (req, res, next) => {
  try {
    const payments = await Payment.find().populate('bookingId').populate('userId', 'name email phone').sort({ createdAt: -1 }).limit(100);
    return sendSuccess(res, { payments }, 'Payments retrieved');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getDashboardStats,
  getAdminBookings,
  updateBookingStatus,
  getAdminSlots,
  blockSlot,
  unblockSlot,
  getPricingConfig,
  updatePricingConfig,
  updateTurf,
  getCustomers,
  getPayments,
  createOfflineBooking,
  extendBooking,
};
