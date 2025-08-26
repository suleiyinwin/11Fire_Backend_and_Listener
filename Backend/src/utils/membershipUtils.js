import { gbToBytes } from './units.js';

export async function upsertMembershipForUser(user, { swarmId, role, quotaBytes }) {
  const existing = user.getMembership(swarmId);
  if (existing) {
    existing.role = role;
    if (quotaBytes !== undefined) existing.quotaBytes = quotaBytes;
  } else {
    user.memberships.push({ swarm: swarmId, role, quotaBytes: quotaBytes || null });
  }
  await user.save();
  return user;
}

export async function setQuotaForActiveSwarm(user, { quotaGB, quotaBytes }) {
  if (!user?.activeSwarm) {
    return { ok: false, status: 400, error: 'No active swarm set' };
  }
  const mem = user.getMembership(user.activeSwarm);
  if (!mem) return { ok: false, status: 403, error: 'Not a member of the active swarm' };
  if (mem.role !== 'provider') {
    return { ok: false, status: 403, error: 'Only providers can set quota' };
  }

  // Normalize input (GB takes precedence if present)
  let nextBytes;
  if (quotaGB !== undefined) {
    nextBytes = gbToBytes(quotaGB); 
  } else if (quotaBytes !== undefined) {
    const n = Number(quotaBytes);
    nextBytes = (!Number.isFinite(n) || n < 0) ? null : Math.round(n);
  } else {
    return { ok: false, status: 400, error: 'Missing quotaGB or quotaBytes' };
  }

  // Optional upper bound (env-configurable); default 10 TiB
  const MAX_GB = Number(process.env.MAX_QUOTA_GB || 10 * 1024);
  if (nextBytes !== null && nextBytes > MAX_GB * (1024 ** 3)) {
    return { ok: false, status: 400, error: 'Quota too large' };
  }

  mem.quotaBytes = nextBytes; 
  await user.save();
  return { ok: true, membership: mem };
}