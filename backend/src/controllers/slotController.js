const { getSlotsForDate } = require('../services/slotService');
const { sendSuccess, sendError } = require('../utils/response');
const supabase = require('../config/supabase');

const getSlots = async (req, res, next) => {
  try {
    const { date } = req.query;

    if (!date) {
      return sendError(res, 'Date query parameter is required (YYYY-MM-DD)', 400);
    }

    // Validate date format YYYY-MM-DD
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return sendError(res, 'Invalid date format. Expected YYYY-MM-DD', 400);
    }

    const { data: turf, error: turfError } = await supabase
      .from('turf')
      .select('id')
      .eq('active', true)
      .limit(1)
      .maybeSingle();

    if (turfError || !turf) {
      return sendError(res, 'Turf not configured', 404);
    }

    const slotsData = await getSlotsForDate(turf.id, date);
    return sendSuccess(res, slotsData, 'Slots retrieved successfully');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getSlots,
};
