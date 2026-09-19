const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error('[Supabase] SUPABASE_URL is missing.');
}

if (!supabaseServiceRoleKey) {
  throw new Error('[Supabase] SUPABASE_SERVICE_ROLE_KEY is missing.');
}

// IMPORTANT:
// This client uses the service-role key.
// It must ONLY be used by the backend.
// Never expose this key to the React frontend.
const supabase = createClient(
  supabaseUrl,
  supabaseServiceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

module.exports = supabase;
