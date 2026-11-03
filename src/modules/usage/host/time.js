/**
 * Local-calendar helpers shared by the usage scan and snapshot assembly.
 *
 * Token consumption is bucketed by the machine's natural local day, so a
 * day must be derived from a `Date` in the host time zone, never from UTC
 * arithmetic (that would shift buckets around midnight or DST changes).
 */

/** Milliseconds in one nominal day; only used for fallbacks. */
export const DAY_MS = 86_400_000;

/**
 * Epoch milliseconds of the local 00:00 that starts the day containing `input`.
 * @param {number|Date} input epoch ms or Date.
 * @returns {number} epoch ms of the local midnight.
 */
export function localDayStart(input) {
  const date = input instanceof Date ? input : new Date(Number(input));
  if (!Number.isFinite(date.getTime())) return localDayStart(new Date());
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Shift a local midnight by whole local days, staying on a natural day boundary
 * even across DST transitions.
 * @param {number} dayStart epoch ms of a local midnight.
 * @param {number} delta number of days to add (may be negative).
 * @returns {number} epoch ms of the shifted local midnight.
 */
export function addLocalDays(dayStart, delta) {
  const date = new Date(dayStart);
  date.setDate(date.getDate() + delta);
  return localDayStart(date);
}

/**
 * Epoch milliseconds of the local 00:00 on the first day of the month containing `input`.
 * @param {number|Date} input epoch ms or Date.
 * @returns {number} epoch ms of the local month start.
 */
export function localMonthStart(input) {
  const date = input instanceof Date ? input : new Date(Number(input));
  if (!Number.isFinite(date.getTime())) return localMonthStart(new Date());
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}
