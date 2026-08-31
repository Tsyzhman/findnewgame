export function validTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format();
    return zone.length <= 80;
  } catch {
    return false;
  }
}
export function localDate(now: number, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function nextLocalMidnight(now: number, zone: string): number {
  const date = localDate(now, zone);
  let lo = now,
    hi = now + 30 * 60 * 60 * 1000;
  // Binary search handles DST and half-/quarter-hour zones without offset assumptions.
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (localDate(mid, zone) === date) lo = mid;
    else hi = mid;
  }
  return hi;
}
export function previousDate(date: string): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) - 86400000)
    .toISOString()
    .slice(0, 10);
}
export function streaks(
  completedDates: string[],
  today: string,
): { current: number; best: number } {
  const dates = [...new Set(completedDates)].sort();
  let best = 0,
    run = 0,
    last = '';
  for (const date of dates) {
    run = previousDate(date) === last ? run + 1 : 1;
    best = Math.max(best, run);
    last = date;
  }
  let current = 0,
    cursor = dates.includes(today) ? today : previousDate(today);
  const set = new Set(dates);
  while (set.has(cursor)) {
    current++;
    cursor = previousDate(cursor);
  }
  return { current, best };
}
