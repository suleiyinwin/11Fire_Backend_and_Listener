import jwt from 'jsonwebtoken';

const COOKIE_NAME = 'sid';

export function issueSession(res, payload) {
  // payload shape: { uid, ms: { oid, tid }, activeSwarm? }
  const token = jwt.sign(payload, process.env.APP_JWT_SECRET, { expiresIn: '12h' });
  
  const cookieOptions = {
    httpOnly: true,
    secure: true, // Required for SameSite=None
    sameSite: 'none', // Required for cross-site requests (Azure + Vercel)
    path: '/',
    maxAge: 12 * 60 * 60 * 1000,
  };
  
  // Only add domain if it's a valid non-empty string
  if (process.env.COOKIE_DOMAIN && process.env.COOKIE_DOMAIN.trim()) {
    cookieOptions.domain = process.env.COOKIE_DOMAIN.trim();
  }
  
  // Set the primary cookie
  res.cookie(COOKIE_NAME, token, cookieOptions);
  
  // Also set with SameSite=lax as fallback for some mobile browsers
  res.cookie(`${COOKIE_NAME}_alt`, token, {
    ...cookieOptions,
    sameSite: 'lax', // Alternative for mobile browsers that don't support 'none'
  });
}

export function updateSession(res, prevPayload, patch) {
  const next = { ...prevPayload, ...patch };
  issueSession(res, next);
}

export function clearSession(res) {
  const cookieOptions = {
    httpOnly: true,
    secure: true, // Required for SameSite=None
    sameSite: 'none', // Required for cross-site requests (Azure + Vercel)
    path: '/',
  };
  
  // Only add domain if it's a valid non-empty string
  if (process.env.COOKIE_DOMAIN && process.env.COOKIE_DOMAIN.trim()) {
    cookieOptions.domain = process.env.COOKIE_DOMAIN.trim();
  }
  
  res.clearCookie(COOKIE_NAME, cookieOptions);
}