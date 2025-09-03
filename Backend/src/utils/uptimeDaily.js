import ProviderUptimeDaily from "../models/ProviderUptimeDaily.js";

function dayStrUTC(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/**
 * Add a closed interval [start, end) to daily buckets.
 * state ∈ {"online","offline"} decides which column to increment.
 */
export async function addIntervalToDaily({
  userId,
  swarmId,
  state,
  start,
  end,
}) {
  const s = new Date(start),
    e = new Date(end);
  if (!Number.isFinite(+s) || !Number.isFinite(+e) || e <= s) return;

  // Walk days crossed by the interval
  let cursor = new Date(
    Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate())
  );
  if (s > cursor) cursor = new Date(s); // begin exactly at start if mid-day

  while (cursor < e) {
    const dayStart = new Date(
      Date.UTC(
        cursor.getUTCFullYear(),
        cursor.getUTCMonth(),
        cursor.getUTCDate()
      )
    );
    const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);

    const segStart = cursor;
    const segEnd = e < dayEnd ? e : dayEnd;
    const secs = Math.max(0, (segEnd - segStart) / 1000);

    if (secs > 0) {
      const day = dayStrUTC(segStart);
      const inc =
        state === "online" ? { onlineSeconds: secs } : { offlineSeconds: secs };

      // Important: avoid $setOnInsert on the same field we $inc
      const setOnInsert = {};
      if (state === "online") {
        setOnInsert.offlineSeconds = 0; // init the *other* field only
      } else {
        setOnInsert.onlineSeconds = 0; // init the *other* field only
      }

      await ProviderUptimeDaily.updateOne(
        { userId, swarm: swarmId, day },
        { $setOnInsert: setOnInsert, $inc: inc },
        { upsert: true }
      );
    }

    cursor = dayEnd; // next day
  }
}

/**
 * Accrue an OPEN interval from its start to now (without closing it).
 * Optional clampSince bounds how far back we accrue.
 */
export async function accrueOpenIntervalToNow({
  userId,
  swarmId,
  state,
  start,
  clampSince,
}) {
  const base = clampSince
    ? Math.max(new Date(start).getTime(), new Date(clampSince).getTime())
    : new Date(start).getTime();
  const s = new Date(base);
  const e = new Date();
  return addIntervalToDaily({ userId, swarmId, state, start: s, end: e });
}
