require('dotenv').config();
const supabase = require('../config/supabase');

async function seedTurf() {
  const { data, error } = await supabase.from('turf').insert([
    {
      name: 'Arena Turf',
      city: 'Coimbatore',
      state: 'Tamil Nadu',
      contact_phone: '9999999999',
      active: true,
      default_price: 1500,
      opening_time: '06:00',
      closing_time: '23:00'
    }
  ]).select();

  if (error) {
    console.error('Seed error:', error);
  } else {
    console.log('Turf seeded:', data[0].id);
    
    // Also seed some pricing rules so we don't get pricing not found
    await supabase.from('pricing_rules').insert([
      {
        turf_id: data[0].id,
        day_of_week: 1,
        start_time: '00:00',
        end_time: '23:59',
        hourly_rate: 1500,
        advance_percentage: 30
      },
      {
        turf_id: data[0].id,
        day_of_week: 2,
        start_time: '00:00',
        end_time: '23:59',
        hourly_rate: 1500,
        advance_percentage: 30
      },
      {
        turf_id: data[0].id,
        day_of_week: 3,
        start_time: '00:00',
        end_time: '23:59',
        hourly_rate: 1500,
        advance_percentage: 30
      },
      {
        turf_id: data[0].id,
        day_of_week: 4,
        start_time: '00:00',
        end_time: '23:59',
        hourly_rate: 1500,
        advance_percentage: 30
      },
      {
        turf_id: data[0].id,
        day_of_week: 5,
        start_time: '00:00',
        end_time: '23:59',
        hourly_rate: 1500,
        advance_percentage: 30
      },
      {
        turf_id: data[0].id,
        day_of_week: 6,
        start_time: '00:00',
        end_time: '23:59',
        hourly_rate: 1500,
        advance_percentage: 30
      },
      {
        turf_id: data[0].id,
        day_of_week: 0,
        start_time: '00:00',
        end_time: '23:59',
        hourly_rate: 1500,
        advance_percentage: 30
      }
    ]);
  }
}
seedTurf();
