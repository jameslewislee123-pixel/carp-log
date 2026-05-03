// Astronomical math for moon position, phase, illumination, transit times.
// Derived from Jean Meeus "Astronomical Algorithms" / Vladimir Agafonkin's SunCalc (BSD-2).
// Inlined verbatim-style for the BiteForecast / per-catch moon panels.

const PI = Math.PI;
const rad = PI / 180;
const dayMs = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const e = rad * 23.4397;

function toJulian(date: Date): number { return date.getTime() / dayMs - 0.5 + J1970; }
function fromJulian(j: number): Date { return new Date((j + 0.5 - J1970) * dayMs); }
function toDays(date: Date): number { return toJulian(date) - J2000; }

function rightAscension(l: number, b: number) { return Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l)); }
function declination(l: number, b: number) { return Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l)); }
function azimuth(H: number, phi: number, dec: number) { return Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)); }
function altitude(H: number, phi: number, dec: number) { return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)); }
function siderealTime(d: number, lw: number) { return rad * (280.16 + 360.9856235 * d) - lw; }
function astroRefraction(h: number) { if (h < 0) h = 0; return 0.0002967 / Math.tan(h + 0.00312536 / (h + 0.08901179)); }

function solarMeanAnomaly(d: number) { return rad * (357.5291 + 0.98560028 * d); }
function eclipticLongitude(M: number) {
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const P = rad * 102.9372;
  return M + C + P + PI;
}
function sunCoords(d: number) {
  const M = solarMeanAnomaly(d);
  const L = eclipticLongitude(M);
  return { dec: declination(L, 0), ra: rightAscension(L, 0) };
}

function moonCoords(d: number) {
  const L = rad * (218.316 + 13.176396 * d);
  const M = rad * (134.963 + 13.064993 * d);
  const F = rad * (93.272  + 13.229350 * d);
  const l = L + rad * 6.289 * Math.sin(M);
  const b = rad * 5.128 * Math.sin(F);
  const dt = 385001 - 20905 * Math.cos(M);
  return { ra: rightAscension(l, b), dec: declination(l, b), dist: dt };
}

export function getMoonPosition(date: Date, lat: number, lng: number) {
  const lw = rad * -lng;
  const phi = rad * lat;
  const d = toDays(date);
  const c = moonCoords(d);
  const H = siderealTime(d, lw) - c.ra;
  let h = altitude(H, phi, c.dec);
  const pa = Math.atan2(Math.sin(H), Math.tan(phi) * Math.cos(c.dec) - Math.sin(c.dec) * Math.cos(H));
  h = h + astroRefraction(h);
  return { azimuth: azimuth(H, phi, c.dec), altitude: h, distance: c.dist, parallacticAngle: pa };
}

export function getMoonIllumination(date: Date) {
  const d = toDays(date);
  const s = sunCoords(d);
  const m = moonCoords(d);
  const sdist = 149598000;
  const phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
  const inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi));
  const angle = Math.atan2(
    Math.cos(s.dec) * Math.sin(s.ra - m.ra),
    Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra)
  );
  const fraction = (1 + Math.cos(inc)) / 2;
  const phase = 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / Math.PI;
  return { fraction, phase, angle };
}

export function getMoonPhaseLabel(phase: number): { label: string; emoji: string } {
  // phase: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter
  if (phase < 0.03 || phase > 0.97) return { label: 'New Moon', emoji: '🌑' };
  if (phase < 0.22) return { label: 'Waxing Crescent', emoji: '🌒' };
  if (phase < 0.28) return { label: 'First Quarter', emoji: '🌓' };
  if (phase < 0.47) return { label: 'Waxing Gibbous', emoji: '🌔' };
  if (phase < 0.53) return { label: 'Full Moon', emoji: '🌕' };
  if (phase < 0.72) return { label: 'Waning Gibbous', emoji: '🌖' };
  if (phase < 0.78) return { label: 'Last Quarter', emoji: '🌗' };
  return { label: 'Waning Crescent', emoji: '🌘' };
}

function hoursLater(date: Date, h: number) { return new Date(date.getTime() + (h * dayMs) / 24); }

export function getMoonTimes(date: Date, lat: number, lng: number) {
  const t = new Date(date);
  t.setHours(0, 0, 0, 0);
  const hc = 0.133 * rad;
  let h0 = getMoonPosition(t, lat, lng).altitude - hc;
  let rise = 0, set = 0;
  let h1 = 0, h2 = 0, a = 0, b = 0, xe = 0, ye = 0, d = 0, roots = 0, x1 = 0, x2 = 0, dx = 0;
  for (let i = 1; i <= 24; i += 2) {
    h1 = getMoonPosition(hoursLater(t, i), lat, lng).altitude - hc;
    h2 = getMoonPosition(hoursLater(t, i + 1), lat, lng).altitude - hc;
    a = (h0 + h2) / 2 - h1;
    b = (h2 - h0) / 2;
    xe = -b / (2 * a);
    ye = (a * xe + b) * xe + h1;
    d = b * b - 4 * a * h1;
    roots = 0;
    if (d >= 0) {
      dx = Math.sqrt(d) / (Math.abs(a) * 2);
      x1 = xe - dx; x2 = xe + dx;
      if (Math.abs(x1) <= 1) roots++;
      if (Math.abs(x2) <= 1) roots++;
      if (x1 < -1) x1 = x2;
    }
    if (roots === 1) {
      if (h0 < 0) rise = i + x1; else set = i + x1;
    } else if (roots === 2) {
      rise = i + (ye < 0 ? x2 : x1);
      set  = i + (ye < 0 ? x1 : x2);
    }
    if (rise && set) break;
    h0 = h2;
  }
  const result: { rise: Date | null; set: Date | null; alwaysUp?: boolean; alwaysDown?: boolean } = { rise: null, set: null };
  if (rise) result.rise = hoursLater(t, rise);
  if (set)  result.set  = hoursLater(t, set);
  if (!rise && !set) (ye! > 0 ? result.alwaysUp = true : result.alwaysDown = true);
  return result;
}

// Find moon transit (highest altitude) and antitransit (lowest) for a given local day.
// Brute force scan in 5-minute steps, refine with parabolic interpolation.
export function getMoonTransits(date: Date, lat: number, lng: number) {
  const t0 = new Date(date); t0.setHours(0, 0, 0, 0);
  const stepMin = 10;
  const steps = (24 * 60) / stepMin;
  let best = -Infinity, bestIdx = 0;
  let worst = Infinity, worstIdx = 0;
  for (let i = 0; i <= steps; i++) {
    const dt = new Date(t0.getTime() + i * stepMin * 60000);
    const alt = getMoonPosition(dt, lat, lng).altitude;
    if (alt > best) { best = alt; bestIdx = i; }
    if (alt < worst) { worst = alt; worstIdx = i; }
  }
  const transit = new Date(t0.getTime() + bestIdx * stepMin * 60000);
  const antitransit = new Date(t0.getTime() + worstIdx * stepMin * 60000);
  return { transit, antitransit };
}

export type SolunarWindow = {
  kind: 'major' | 'minor';
  start: Date;
  end: Date;
  centerLabel: string;
};

// Major windows: ±2h around moon transit & antitransit.
// Minor windows: ±1h around moonrise & moonset.
export function getSolunarWindows(date: Date, lat: number, lng: number): SolunarWindow[] {
  const out: SolunarWindow[] = [];
  const { transit, antitransit } = getMoonTransits(date, lat, lng);
  out.push({ kind: 'major', start: new Date(transit.getTime() - 2 * 3600_000), end: new Date(transit.getTime() + 2 * 3600_000), centerLabel: 'Moon overhead' });
  out.push({ kind: 'major', start: new Date(antitransit.getTime() - 2 * 3600_000), end: new Date(antitransit.getTime() + 2 * 3600_000), centerLabel: 'Moon underfoot' });
  const times = getMoonTimes(date, lat, lng);
  if (times.rise) out.push({ kind: 'minor', start: new Date(times.rise.getTime() - 3600_000), end: new Date(times.rise.getTime() + 3600_000), centerLabel: 'Moonrise' });
  if (times.set)  out.push({ kind: 'minor', start: new Date(times.set.getTime()  - 3600_000), end: new Date(times.set.getTime()  + 3600_000), centerLabel: 'Moonset'  });
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function isInSolunarWindow(now: Date, windows: SolunarWindow[]) {
  return windows.find(w => now >= w.start && now <= w.end) || null;
}

// Bite rating heuristic: phase weight (full/new = best) × proximity to nearest window.
export function getBiteRating(date: Date, lat: number, lng: number): { stars: number; label: string; reason: string } {
  const ill = getMoonIllumination(date);
  const phaseWeight = 1 - 4 * Math.min(Math.abs(ill.phase - 0.5), Math.abs(ill.phase), Math.abs(ill.phase - 1)); // 1 at new/full, ~0 at quarters
  const norm = Math.max(0, Math.min(1, phaseWeight + 0.4));

  const windows = getSolunarWindows(date, lat, lng);
  const w = isInSolunarWindow(date, windows);
  let proximity = 0;
  if (w) proximity = w.kind === 'major' ? 1 : 0.6;
  else {
    const nearest = windows.reduce((m, x) => {
      const dist = Math.min(Math.abs(date.getTime() - x.start.getTime()), Math.abs(date.getTime() - x.end.getTime()));
      return dist < m.dist ? { dist, w: x } : m;
    }, { dist: Infinity, w: windows[0] });
    if (nearest.w) {
      const hrs = nearest.dist / 3600_000;
      if (hrs < 1) proximity = 0.5;
      else if (hrs < 3) proximity = 0.25;
    }
  }
  const score = 0.55 * norm + 0.45 * proximity;
  const stars = Math.max(1, Math.min(5, Math.round(score * 5)));
  const labels = ['Slow', 'Quiet', 'Fair', 'Good', 'Excellent', 'Peak'];
  const reason = w
    ? `In a ${w.kind} window — ${w.centerLabel.toLowerCase()}`
    : `Phase ${(ill.fraction * 100).toFixed(0)}% — next window soon`;
  return { stars, label: labels[stars] || 'Fair', reason };
}
