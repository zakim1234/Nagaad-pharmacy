// Arithmetic (tabular/civil) Hijri calendar conversion -- the standard
// approximation used by most software for DISPLAYING an Islamic year
// alongside a Gregorian date. It does not track actual moon-sighting, so it
// can be off by a day or two around a month boundary; callers must present
// it as approximate, never as an authoritative religious date.
function gregorianToJDN(y, m, d) {
  const a = Math.floor((14 - m) / 12);
  const y2 = y + 4800 - a;
  const m2 = m + 12 * a - 3;
  return d + Math.floor((153 * m2 + 2) / 5) + 365 * y2 + Math.floor(y2 / 4) - Math.floor(y2 / 100) + Math.floor(y2 / 400) - 32045;
}

const ISLAMIC_EPOCH_JDN = 1948440; // 1 Muharram 1 AH

export function gregorianToApproximateHijriYear(date) {
  const jdn = gregorianToJDN(date.getFullYear(), date.getMonth() + 1, date.getDate());
  const l = jdn - ISLAMIC_EPOCH_JDN + 10632;
  const n = Math.floor((l - 1) / 10631);
  const l2 = l - 10631 * n + 354;
  const j = Math.floor((10985 - l2) / 5316) * Math.floor((50 * l2) / 17719) + Math.floor(l2 / 5670) * Math.floor((43 * l2) / 15238);
  const year = 30 * n + j - 30;
  return year;
}
