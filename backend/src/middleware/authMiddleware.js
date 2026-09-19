const jwt = require('jsonwebtoken');

const supabase = require('../config/supabase');
const { sendError } = require('../utils/response');

const getTokenFromRequest = (req) => {
  const authorization = req.headers.authorization;

  if (
    !authorization ||
    !authorization.startsWith('Bearer ')
  ) {
    return null;
  }

  return authorization.split(' ')[1];
};

const verifyToken = (token) => {
  const secret =
    process.env.JWT_SECRET ||
    'turfbook_super_secret_jwt_key_2026';

  return jwt.verify(token, secret);
};

const requireAdmin = async (req, res, next) => {
  try {
    const token = getTokenFromRequest(req);

    if (!token) {
      return sendError(
        res,
        'Authentication required. Please login.',
        401
      );
    }

    const decoded = verifyToken(token);

    if (!decoded?.id) {
      return sendError(
        res,
        'Invalid authentication token',
        401
      );
    }

    if (
      decoded.role !== 'ADMIN' &&
      decoded.role !== 'SUPER_ADMIN'
    ) {
      return sendError(
        res,
        'Access denied. Administrator privileges required.',
        403
      );
    }

    const { data: admin, error } = await supabase
      .from('admin_users')
      .select(
        'id, name, email, role, is_active'
      )
      .eq('id', decoded.id)
      .maybeSingle();

    if (error) {
      console.error('[Admin Auth] Supabase error:', error);

      return sendError(
        res,
        'Unable to verify administrator account',
        500
      );
    }

    if (!admin || !admin.is_active) {
      return sendError(
        res,
        'Administrator session is no longer valid',
        401
      );
    }

    req.admin = admin;

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return sendError(
        res,
        'Session expired. Please login again.',
        401
      );
    }

    console.error('[Admin Auth]', error);

    return sendError(
      res,
      'Invalid authentication token',
      401
    );
  }
};

const optionalAuth = (req, res, next) => {
  req.user = null;
  next();
};

const requireAuth = (req, res) => {
  return sendError(res, 'Customer authentication is deprecated', 401);
};

module.exports = {
  requireAdmin,
  optionalAuth,
  requireAuth,
};
