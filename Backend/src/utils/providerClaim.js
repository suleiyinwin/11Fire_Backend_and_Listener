import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import Auth from '../models/Auth.js';

/**
 * Generate a strong token, store only bcrypt hash on the user doc.
 * Returns { token, expiresAt } – the plaintext token is NOT stored.
 */
export async function generateProviderClaimForUser(userId, { ttlMs = 24*60*60*1000 } = {}) {
  const token = `11fire_ptok_${crypto.randomBytes(32).toString('base64url')}`;
  const tokenHash = await bcrypt.hash(token, 10);
  const expiresAt = new Date(Date.now() + ttlMs);

  const user = await Auth.findById(userId);
  if (!user) throw new Error('User not found');

  user.providerClaim = { tokenHash, expiresAt, usedAt: null };
  await user.save();

  return { token, expiresAt };
}
