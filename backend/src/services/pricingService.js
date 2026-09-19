const supabase = require('../config/supabase');
const {
  timeToMinutes,
  getDayOfWeekIndex,
  getConsecutiveSlotIntervals,
} = require('../utils/timeHelper');

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

const getPricingRules = async (turfId, dateStr) => {
  const { data, error } = await supabase
    .from('pricing_rules')
    .select('*')
    .eq('turf_id', turfId)
    .eq('is_active', true)
    .order('priority', { ascending: false });

  if (error) {
    throw new Error(`Unable to load pricing rules: ${error.message}`);
  }

  const date = new Date(`${dateStr}T00:00:00`);
  const dayOfWeek = date.getUTCDay();

  return (data || []).filter((rule) => {
    if (!rule.days_of_week || rule.days_of_week.length === 0) {
      return true;
    }

    return rule.days_of_week.includes(dayOfWeek);
  });
};

const getSingleSlotPrice = (turf, rules, startTime) => {
  const slotStartMins = timeToMinutes(startTime);

  let applicablePrice = 0;
  let appliedRule = 'Standard Rate';

  for (const rule of rules) {
    const ruleStart = timeToMinutes(rule.start_time);
    const ruleEnd = timeToMinutes(rule.end_time);

    if (
      slotStartMins >= ruleStart &&
      slotStartMins < ruleEnd
    ) {
      applicablePrice = Number(rule.price_per_hour);
      appliedRule = rule.name;
      break;
    }
  }

  // No pricing rule means no accidental price.
  // Admin must configure pricing.
  if (applicablePrice <= 0) {
    throw new Error(
      `No active pricing rule configured for ${startTime}`
    );
  }

  return {
    price: applicablePrice,
    appliedRule,
  };
};

const calculateMultiHourPrice = async (
  turfId,
  dateStr,
  startTime,
  durationHours = 1
) => {
  const turf = await getTurf(turfId);

  const hours = Number(durationHours);

  if (!Number.isInteger(hours) || hours < 1) {
    const error = new Error('Duration must be a whole number of hours');
    error.statusCode = 400;
    throw error;
  }

  const rules = await getPricingRules(turfId, dateStr);

  const {
    intervals,
    slotTimes,
    endTime,
  } = getConsecutiveSlotIntervals(
    startTime,
    hours,
    60
  );

  let totalAmount = 0;

  const slotBreakdown = [];

  for (const interval of intervals) {
    const {
      price,
      appliedRule,
    } = getSingleSlotPrice(
      turf,
      rules,
      interval.startTime
    );

    totalAmount += price;

    slotBreakdown.push({
      startTime: interval.startTime,
      endTime: interval.endTime,
      label: interval.label,
      price,
      appliedRule,
    });
  }

  const {
    data: settings,
    error: settingsError,
  } = await supabase
    .from('turf_settings')
    .select('advance_percentage')
    .eq('turf_id', turfId)
    .single();

  if (settingsError || !settings) {
    throw new Error('Turf payment settings not configured');
  }

  const advancePercentage =
    Number(settings.advance_percentage);

  const advanceAmount = Math.round(
    totalAmount * advancePercentage / 100
  );

  const remainingAmount =
    totalAmount - advanceAmount;

  return {
    totalAmount,
    advanceAmount,
    remainingAmount,
    advancePercentage,
    durationHours: hours,
    durationMinutes: hours * 60,
    startTime,
    endTime,
    slotTimes,
    slotBreakdown,
  };
};

const calculateSlotPrice = async (
  turfId,
  dateStr,
  startTime,
  endTime
) => {
  const result = await calculateMultiHourPrice(
    turfId,
    dateStr,
    startTime,
    1
  );

  return {
    totalAmount: result.totalAmount,
    advanceAmount: result.advanceAmount,
    remainingAmount: result.remainingAmount,
    appliedRule: result.slotBreakdown[0].appliedRule,
  };
};

module.exports = {
  calculateSlotPrice,
  calculateMultiHourPrice,
};
