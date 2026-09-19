require('dotenv').config();
const supabase = require('../config/supabase');

async function testReviews() {
  try {
    const baseUrl = 'http://localhost:5001/api';

    // 1. Post a review
    console.log('Testing POST /api/turf/reviews...');
    const postRes = await fetch(`${baseUrl}/turf/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Test Player',
        rating: 5,
        comment: 'Great turf!'
      })
    });
    
    if (!postRes.ok) {
      const err = await postRes.text();
      throw new Error('POST failed: ' + err);
    }
    const postData = await postRes.json();
    console.log('POST Success:', postData.message);

    // 2. Get reviews
    console.log('Testing GET /api/turf/reviews...');
    const getRes = await fetch(`${baseUrl}/turf/reviews`);
    if (!getRes.ok) {
      throw new Error('GET failed');
    }
    const getData = await getRes.json();
    console.log(`GET Success: retrieved ${getData.data.reviews.length} reviews. Average rating: ${getData.data.averageRating}`);

    // 3. Check DB
    console.log('Testing PostgreSQL directly...');
    const { data: dbReviews, error } = await supabase.from('reviews').select('*').limit(1);
    if (error) throw error;
    console.log('DB Check Success:', dbReviews.length > 0 ? 'Found review in DB' : 'No reviews in DB');

  } catch (err) {
    console.error('Test failed:', err.message);
  }
}

testReviews();
