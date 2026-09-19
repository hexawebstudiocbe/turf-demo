const supabase = require('../config/supabase');
const reviewService = require('../services/reviewService');
const { sendSuccess, sendError } = require('../utils/response');

const getActiveTurf = async () => {
  const { data, error } = await supabase
    .from('turf')
    .select('*')
    .eq('active', true)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Unable to load turf: ${error.message}`
    );
  }

  return data;
};

const getTurf = async (req, res, next) => {
  try {
    const turf = await getActiveTurf();

    if (!turf) {
      return sendError(
        res,
        'Turf not configured',
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
        `Unable to load turf settings: ${settingsError.message}`
      );
    }

    const {
      data: businessHours,
      error: hoursError,
    } = await supabase
      .from('business_hours')
      .select('*')
      .eq('turf_id', turf.id)
      .order('day_of_week', {
        ascending: true,
      });

    if (hoursError) {
      throw new Error(
        `Unable to load business hours: ${hoursError.message}`
      );
    }

    /*
     * Keep the response compatible with the existing
     * frontend while the database is now PostgreSQL.
     */

    const openingHours =
      businessHours?.find(
        (day) => day.is_open
      );

    const responseTurf = {
      id: turf.id,
      _id: turf.id,

      name: turf.name,
      tagline: turf.tagline,
      description: turf.description,

      address: turf.address,
      city: turf.city,
      state: turf.state,
      country: turf.country,

      latitude: turf.latitude,
      longitude: turf.longitude,

      googleMapsUrl:
        turf.maps_url,

      mapsUrl:
        turf.maps_url,

      sports:
        turf.sports || [],

      amenities:
        turf.amenities || [],

      openingTime:
        turf.opening_time ||
        openingHours?.open_time ||
        null,

      closingTime:
        turf.closing_time ||
        openingHours?.close_time ||
        null,

      slotDuration:
        settings?.slot_duration_minutes ||
        60,

      defaultPrice:
        turf.default_price !== null
          ? Number(turf.default_price)
          : null,

      advanceType:
        'percentage',

      advanceValue:
        Number(
          settings?.advance_percentage || 30
        ),

      gallery:
        turf.gallery || [],

      contactPhone:
        turf.contact_phone,

      whatsappNumber:
        turf.whatsapp_phone,

      emergencyPhone:
        turf.emergency_phone,

      isActive:
        turf.active,

      settings,

      businessHours:
        businessHours || [],
    };

    return sendSuccess(
      res,
      {
        turf: responseTurf,
      },
      'Turf details retrieved'
    );
  } catch (error) {
    next(error);
  }
};

const getReviews = async (req, res, next) => {
  try {
    const result = await reviewService.getReviews();

    return sendSuccess(
      res,
      result,
      'Reviews retrieved successfully'
    );
  } catch (error) {
    next(error);
  }
};

const createReview = async (req, res, next) => {
  try {
    const { rating, comment, customerName } = req.body;

    if (!rating || !comment) {
      return sendError(
        res,
        'Rating and comment are required',
        400
      );
    }

    const review = await reviewService.createReview({
      rating,
      comment,
      customerName,
    });

    return sendSuccess(
      res,
      { review },
      'Thank you for your review!',
      201
    );
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getTurf,
  getReviews,
  createReview,
};
