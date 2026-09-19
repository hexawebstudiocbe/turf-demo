const supabase = require('../config/supabase');

const getActiveTurf = async () => {
  const { data, error } = await supabase
    .from('turf')
    .select('id')
    .eq('active', true)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
};

const getReviews = async () => {
  const turf = await getActiveTurf();

  if (!turf) {
    return {
      reviews: [],
      averageRating: 5.0,
      totalReviews: 0,
    };
  }

  const { data, error } = await supabase
    .from('reviews')
    .select(
      'id, turf_id, customer_name, rating, comment, is_verified_booking, is_approved, created_at, updated_at'
    )
    .eq('turf_id', turf.id)
    .eq('is_approved', true)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    throw error;
  }

  const reviews = data || [];

  const totalRating = reviews.reduce(
    (sum, review) => sum + Number(review.rating),
    0
  );

  const averageRating =
    reviews.length > 0
      ? Number((totalRating / reviews.length).toFixed(1))
      : 5.0;

  return {
    reviews,
    averageRating,
    totalReviews: reviews.length,
  };
};

const createReview = async ({
  rating,
  comment,
  customerName,
}) => {
  const turf = await getActiveTurf();

  if (!turf) {
    const error = new Error('Turf not found');
    error.statusCode = 404;
    throw error;
  }

  const numericRating = Number(rating);

  if (!Number.isFinite(numericRating) || numericRating < 1 || numericRating > 5) {
    const error = new Error('Rating must be between 1 and 5');
    error.statusCode = 400;
    throw error;
  }

  if (!comment || !comment.trim()) {
    const error = new Error('Comment is required');
    error.statusCode = 400;
    throw error;
  }

  const name = customerName?.trim() || 'Player';

  const { data, error } = await supabase
    .from('reviews')
    .insert({
      turf_id: turf.id,
      customer_name: name,
      rating: Math.round(numericRating),
      comment: comment.trim(),
      is_verified_booking: true,
      is_approved: true,
    })
    .select(
      'id, turf_id, customer_name, rating, comment, is_verified_booking, is_approved, created_at, updated_at'
    )
    .single();

  if (error) {
    throw error;
  }

  return data;
};

module.exports = {
  getReviews,
  createReview,
};
