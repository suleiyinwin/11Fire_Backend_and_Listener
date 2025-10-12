import jwt from 'jsonwebtoken';

const COOKIE_NAME = 'sid';

export function issueSession(res, payload) {
  // payload shape: { uid, ms: { oid, tid }, activeSwarm? }
  const token = jwt.sign(payload, process.env.APP_JWT_SECRET, { expiresIn: '12h' });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true, // Required for SameSite=None
    sameSite: 'none', // Required for cross-site requests (Azure + Vercel)
    path: '/',
    maxAge: 12 * 60 * 60 * 1000,
    // Additional Safari compatibility
    domain: process.env.COOKIE_DOMAIN || undefined,
  });
}

export function updateSession(res, prevPayload, patch) {
  const next = { ...prevPayload, ...patch };
  issueSession(res, next);
}

export function clearSession(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: true, // Required for SameSite=None
    sameSite: 'none', // Required for cross-site requests (Azure + Vercel)
    path: '/',
    // Additional Safari compatibility
    domain: process.env.COOKIE_DOMAIN || undefined, // Optional: set explicit domain
  });
}