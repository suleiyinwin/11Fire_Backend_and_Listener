import jwt from 'jsonwebtoken';

const COOKIE_NAME = 'sid';

export function issueSession(res, payload) {
  // payload shape: { uid, ms: { oid, tid }, activeSwarm? }
  const token = jwt.sign(payload, process.env.APP_JWT_SECRET, { expiresIn: '2h' });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 2 * 60 * 60 * 1000,
  });
}

export function updateSession(res, prevPayload, patch) {
  const next = { ...prevPayload, ...patch };
  issueSession(res, next);
}

export function clearSession(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
  });
}