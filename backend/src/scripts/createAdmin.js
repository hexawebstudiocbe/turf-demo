require('dotenv').config();

const bcrypt = require('bcryptjs');
const supabase = require('../config/supabase');

async function main() {
  const name = process.env.ADMIN_NAME;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!name || !email || !password) {
    throw new Error(
      'ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD are required.'
    );
  }

  if (password.length < 8) {
    throw new Error('Admin password must be at least 8 characters.');
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const { data, error } = await supabase
    .from('admin_users')
    .upsert(
      {
        name,
        email: email.trim().toLowerCase(),
        password_hash: passwordHash,
        role: 'ADMIN',
        is_active: true,
      },
      {
        onConflict: 'email',
      }
    )
    .select('id, name, email, role, is_active')
    .single();

  if (error) {
    throw error;
  }

  console.log('Admin created/updated successfully:');
  console.log(data);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
