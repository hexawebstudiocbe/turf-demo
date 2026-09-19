const supabase = require('../config/supabase');

const {
  generateSlots,
  isDateInPast,
  isSlotInPast,
} = require('../utils/timeHelper');

const {
  calculateSlotPrice,
} = require('./pricingService');

const cleanupExpiredHolds = async (
  turfId,
  dateStr
) => {
  const { error } = await supabase.rpc(
    'expire_booking_holds'
  );

  if (error) {
    console.error(
      '[Slots] Hold cleanup failed:',
      error.message
    );
  }
};

const getTurf = async (turfId) => {
  const { data, error } = await supabase
    .from('turf')
    .select('*')
    .eq('id', turfId)
    .eq('active', true)
    .single();

  if (error || !data) {
    const err = new Error('Turf not found');
    err.statusCode = 404;
    throw err;
  }

  return data;
};

const getSlotsForDate = async (
  turfId,
  dateStr
) => {
  const turf = await getTurf(turfId);

  await cleanupExpiredHolds(
    turfId,
    dateStr
  );

  const isPastDate =
    isDateInPast(dateStr);

  // --------------------------------------------------------
  // Business hours
  // --------------------------------------------------------

  const dayOfWeek =
    new Date(`${dateStr}T00:00:00`).getUTCDay();

  const {
    data: businessHours,
    error: hoursError,
  } = await supabase
    .from('business_hours')
    .select('*')
    .eq('turf_id', turfId)
    .eq('day_of_week', dayOfWeek)
    .single();

  if (hoursError || !businessHours) {
    throw new Error(
      'Business hours are not configured for this day'
    );
  }

  if (!businessHours.is_open) {
    return {
      date: dateStr,
      turfId,
      turfName: turf.name,
      totalSlots: 0,
      availableSlotsCount: 0,
      closed: true,
      slots: [],
    };
  }

  // --------------------------------------------------------
  // Generate hourly slots
  // --------------------------------------------------------

  const baseSlots = generateSlots(
    businessHours.open_time.slice(0, 5),
    businessHours.close_time.slice(0, 5),
    60
  );

  // --------------------------------------------------------
  // Existing reservations
  // --------------------------------------------------------

  const {
    data: reservations,
    error: reservationError,
  } = await supabase
    .from('slot_reservations')
    .select('*')
    .eq('turf_id', turfId)
    .eq('reservation_date', dateStr);

  if (reservationError) {
    throw new Error(
      `Unable to load reservations: ${reservationError.message}`
    );
  }

  const now = new Date();

  const slots = await Promise.all(
    baseSlots.map(async (slot) => {
      const reservation =
        (reservations || []).find(
          (r) =>
            r.start_time.slice(0, 5) ===
            slot.startTime
        );

      let status = 'AVAILABLE';
      let holdRemainingSeconds = 0;
      let bookingId;

      if (reservation) {
        if (
          reservation.status === 'BLOCKED'
        ) {
          status = 'BLOCKED';
        } else if (
          reservation.status === 'BOOKED'
        ) {
          status = 'BOOKED';
          bookingId =
            reservation.booking_id;
        } else if (
          reservation.status === 'HOLD'
        ) {
          const expiry =
            new Date(
              reservation.hold_expires_at
            );

          if (expiry > now) {
            status = 'HELD';

            holdRemainingSeconds =
              Math.max(
                0,
                Math.floor(
                  (expiry - now) / 1000
                )
              );

            bookingId =
              reservation.booking_id;
          } else {
            status = 'AVAILABLE';
          }
        }
      }

      if (
        isPastDate ||
        isSlotInPast(
          dateStr,
          slot.startTime
        )
      ) {
        if (status === 'AVAILABLE') {
          status = 'PAST';
        }
      }

      let price = null;
      let advanceAmount = null;
      let remainingAmount = null;
      let appliedRule = null;

      if (status !== 'BLOCKED') {
        try {
          const pricing =
            await calculateSlotPrice(
              turfId,
              dateStr,
              slot.startTime,
              slot.endTime
            );

          price = pricing.totalAmount;
          advanceAmount =
            pricing.advanceAmount;
          remainingAmount =
            pricing.remainingAmount;
          appliedRule =
            pricing.appliedRule;
        } catch (error) {
          console.error(
            '[Slots] Pricing error:',
            error.message
          );
        }
      }

      return {
        ...slot,
        status,
        bookingId,
        holdRemainingSeconds,
        price,
        advanceAmount,
        remainingAmount,
        appliedRule,
        durationHours: 1,
      };
    })
  );

  // --------------------------------------------------------
  // Calculate consecutive availability
  // --------------------------------------------------------

  const slotsWithConsecutive =
    slots.map((slot, index) => {
      if (
        slot.status !== 'AVAILABLE'
      ) {
        return {
          ...slot,
          maxConsecutiveHours: 0,
        };
      }

      let consecutive = 1;

      for (
        let i = index + 1;
        i < slots.length;
        i++
      ) {
        if (
          slots[i].status ===
          'AVAILABLE'
        ) {
          consecutive++;
        } else {
          break;
        }
      }

      return {
        ...slot,
        maxConsecutiveHours:
          consecutive,
      };
    });

  return {
    date: dateStr,
    turfId,
    turfName: turf.name,
    totalSlots:
      slotsWithConsecutive.length,
    availableSlotsCount:
      slotsWithConsecutive.filter(
        (slot) =>
          slot.status ===
          'AVAILABLE'
      ).length,
    closed: false,
    slots:
      slotsWithConsecutive,
  };
};

module.exports = {
  getSlotsForDate,
  cleanupExpiredHolds,
};
