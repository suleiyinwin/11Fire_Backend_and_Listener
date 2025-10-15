import bcrypt from 'bcryptjs';
import Auth from '../models/Auth.js';
import { emitProviderClaimed } from '../utils/eventSystem.js';


/**
 * POST /providers/claim   (no cookie auth – called by headless binary)
 * Body: { token, peerId }
 * Returns: { ok, userId }
 *
 * Matches the provided token against any active, un-used claim stored on users.
 * On success: sets Auth.peerId and marks the claim as used.
 */
export async function claimPeerId(req, res) {
  try {
    const { token, peerId } = req.body || {};
    if (!token || !peerId) return res.status(400).json({ error: 'token and peerId are required' });

    const now = new Date();
    const candidates = await Auth.find({
      providerClaim: { $ne: null },
      'providerClaim.usedAt': null,
      'providerClaim.expiresAt': { $gt: now },
    }).select('providerClaim').lean();

    let userDoc = null;
    for (const cand of candidates) {
      if (await bcrypt.compare(token, cand.providerClaim.tokenHash)) {
        userDoc = await Auth.findById(cand._id);
        break;
      }
    }
    if (!userDoc) return res.status(401).json({ error: 'Invalid or expired token' });

    userDoc.peerId = peerId;                 
    // userDoc.providerClaim.usedAt = now;      // make the token one-time
    await userDoc.save();

    // Emit provider claimed event
    emitProviderClaimed(String(userDoc._id), peerId, userDoc.username, token);

    return res.json({ ok: true, userId: String(userDoc._id) });
  } catch (err) {
    console.error('claimPeerId failed:', err);
    res.status(500).json({ error: 'Failed to claim peerId' });
  }
}
