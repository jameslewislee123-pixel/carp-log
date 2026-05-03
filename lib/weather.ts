// Open-Meteo: no key required. Forecast API for recent dates (past_days=7), Archive API for older.
// Picks closest hourly value to the catch date and returns Weather shape.
import type { Weather } from './types';

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE  = 'https://archive-api.open-meteo.com/v1/archive';
const GEOCODE  = 'https://geocoding-api.open-meteo.com/v1/search';

const codeToCondition = (c: number): string => {
  if (c === 0)       return 'sunny';
  if (c <= 2)        return 'cloudy';
  if (c === 3)       return 'overcast';
  if (c >= 45 && c <= 48) return 'mist';
  if (c >= 51 && c <= 67) return 'rain';
  if (c >= 71 && c <= 77) return 'rain';
  if (c >= 80 && c <= 86) return 'rain';
  if (c >= 95)       return 'storm';
  return 'cloudy';
};

const degToCompass = (d: number): string => {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(d / 45) % 8];
};

export async function geocodeLake(q: string): Promise<{ lat: number; lng: number } | null> {
  if (!q?.trim()) return null;
  try {
    const r = await fetch(`${GEOCODE}?name=${encodeURIComponent(q)}&count=1`);
    if (!r.ok) return null;
    const j = await r.json();
    const hit = j?.results?.[0];
    if (!hit) return null;
    return { lat: hit.latitude, lng: hit.longitude };
  } catch { return null; }
}

export async function getCurrentLocation(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 4000, maximumAge: 600000 },
    );
  });
}

function pickClosest<T extends { time: string[] }>(data: T, target: Date, fields: string[]) {
  const tt = target.getTime();
  let bestIdx = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < data.time.length; i++) {
    const t = new Date(data.time[i] + 'Z').getTime();
    const diff = Math.abs(t - tt);
    if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
  }
  const out: Record<string, any> = {};
  fields.forEach(f => { out[f] = (data as any)[f]?.[bestIdx]; });
  return out;
}

export async function fetchWeatherFor(
  date: Date,
  lat: number,
  lng: number,
): Promise<Weather | null> {
  const now = Date.now();
  const ageMs = now - date.getTime();
  const sevenDays = 7 * 86400000;
  const isRecent = ageMs >= 0 && ageMs <= sevenDays;
  const isFuture = ageMs < 0;

  const isoDate = date.toISOString().slice(0, 10);
  const hourlyParams = ['temperature_2m', 'pressure_msl', 'wind_direction_10m', 'wind_speed_10m', 'weather_code'].join(',');
  let url: string;

  if (isRecent || isFuture) {
    url = `${FORECAST}?latitude=${lat}&longitude=${lng}&past_days=7&hourly=${hourlyParams}&timezone=UTC`;
  } else {
    url = `${ARCHIVE}?latitude=${lat}&longitude=${lng}&start_date=${isoDate}&end_date=${isoDate}&hourly=${hourlyParams}&timezone=UTC`;
  }

  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    const h = j?.hourly;
    if (!h?.time?.length) return null;
    const picked = pickClosest(h, date, ['temperature_2m', 'pressure_msl', 'wind_direction_10m', 'weather_code']);

    return {
      tempC:      picked.temperature_2m   != null ? Math.round(picked.temperature_2m) : null,
      pressure:   picked.pressure_msl     != null ? Math.round(picked.pressure_msl)   : null,
      wind:       picked.wind_direction_10m != null ? degToCompass(picked.wind_direction_10m) : null,
      conditions: picked.weather_code != null ? codeToCondition(picked.weather_code) : null,
    };
  } catch { return null; }
}
