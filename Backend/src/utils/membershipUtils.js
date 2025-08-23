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