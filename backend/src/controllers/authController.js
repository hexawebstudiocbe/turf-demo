const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const supabase = require('../config/supabase');
const { sendSuccess, sendError } = require('../utils/response');

const generateToken = (admin) => {
  const secret =
    process.env.JWT_SECRET ||
    'turfbook_super_secret_jwt_key_2026';

  return jwt.sign(
    {
      id: admin.id,
      role: admin.role,
      email: admin.email,
    },
    secret,
    {
      expiresIn: '1d',
    }
  );
};

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return sendError(
        res,
        'Please provide email and password',
        400
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

    const { data, error } = await supabase.rpc(
      'get_admin_for_login',
      {
        p_email: normalizedEmail,
      }
    );

    if (error) {
      console.error('[Admin Login] Supabase error:', error);
      return sendError(res, 'Unable to login', 500);
    }

    const admin = data?.[0];

    if (!admin) {
      return sendError(
        res,
        'Invalid email or password',
        401
      );
    }

    const passwordMatches = await bcrypt.compare(
      password,
      admin.password_hash
    );

    if (!passwordMatches) {
      return sendError(
        res,
        'Invalid email or password',
        401
      );
    }

    const { error: loginRecordError } = await supabase.rpc(
      'record_admin_login',
      {
        p_admin_id: admin.id,
      }
    );

    if (loginRecordError) {
      // Do not fail an otherwise successful login because
      // recording the login timestamp failed.
      console.error(
        '[Admin Login] Failed to record login:',
        loginRecordError
      );
    }

    const token = generateToken(admin);

    return sendSuccess(
      res,
      {
        admin: {
          id: admin.id,
          name: admin.name,
          email: admin.email,
          role: admin.role,
        },
        token,
      },
      'Login successful'
    );
  } catch (error) {
    next(error);
  }
};

module.exports = {
  login,
};
