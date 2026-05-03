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

// ============================================================
// Extended forecast for the carousel weather card.
// 30-min localStorage cache keyed by rounded coords.
// ============================================================
export type ForecastBundle = {
  current: {
    temp: number | null;
    apparent: number | null;
    humidity: number | null;
    pressure: number | null;
    windSpeed: number | null;
    windDir: string | null;
    code: number | null;
    isDay: boolean;
  };
  hourly: {
    time: Date[];
    temp: number[];
    pop: number[];          // precipitation probability %
    code: number[];
    pressure: number[];
  };
  daily: {
    time: Date[];
    code: number[];
    tMax: number[];
    tMin: number[];
    pop: number[];
    sunrise: Date[];
    sunset: Date[];
  };
  fetchedAt: number;
};

export function weatherCodeEmoji(code: number, isDay = true): string {
  if (code === 0)        return isDay ? '☀️' : '🌙';
  if (code <= 2)         return isDay ? '🌤️' : '☁️';
  if (code === 3)        return '☁️';
  if (code >= 45 && code <= 48) return '🌫️';
  if (code >= 51 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 77) return '🌨️';
  if (code >= 80 && code <= 86) return '🌧️';
  if (code >= 95) return '⛈️';
  return '☁️';
}
export function weatherCodeLabel(code: number): string {
  if (code === 0) return 'Clear';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code >= 45 && code <= 48) return 'Mist';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 86) return 'Showers';
  if (code >= 95) return 'Thunderstorm';
  return '—';
}

const CACHE_KEY = 'carp_log_weather_cache_v1';
const CACHE_TTL = 30 * 60 * 1000; // 30 min
type CacheEntry = { lat: number; lng: number; data: any; ts: number };

function readCache(lat: number, lng: number): any | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const entries: CacheEntry[] = JSON.parse(raw);
    const r = entries.find(e =>
      Math.abs(e.lat - lat) < 0.05 && Math.abs(e.lng - lng) < 0.05 &&
      Date.now() - e.ts < CACHE_TTL
    );
    return r?.data || null;
  } catch { return null; }
}
function writeCache(lat: number, lng: number, data: any) {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const entries: CacheEntry[] = raw ? JSON.parse(raw) : [];
    const next = [{ lat, lng, data, ts: Date.now() }, ...entries.filter(e => !(Math.abs(e.lat - lat) < 0.05 && Math.abs(e.lng - lng) < 0.05))].slice(0, 6);
    localStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch {}
}

export async function fetchExtendedForecast(lat: number, lng: number): Promise<ForecastBundle | null> {
  const cached = readCache(lat, lng);
  if (cached) return parseForecast(cached);
  try {
    const url = `${FORECAST}?latitude=${lat}&longitude=${lng}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,pressure_msl,wind_speed_10m,wind_direction_10m` +
      `&hourly=temperature_2m,precipitation_probability,weather_code,pressure_msl` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max` +
      `&past_hours=24&forecast_hours=48&forecast_days=7&timezone=auto`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    writeCache(lat, lng, j);
    return parseForecast(j);
  } catch { return null; }
}

function parseForecast(j: any): ForecastBundle | null {
  if (!j?.current || !j?.hourly || !j?.daily) return null;
  const c = j.current;
  return {
    current: {
      temp: c.temperature_2m != null ? Math.round(c.temperature_2m) : null,
      apparent: c.apparent_temperature != null ? Math.round(c.apparent_temperature) : null,
      humidity: c.relative_humidity_2m != null ? Math.round(c.relative_humidity_2m) : null,
      pressure: c.pressure_msl != null ? Math.round(c.pressure_msl) : null,
      windSpeed: c.wind_speed_10m != null ? Math.round(c.wind_speed_10m) : null,
      windDir: c.wind_direction_10m != null ? degToCompass(c.wind_direction_10m) : null,
      code: c.weather_code ?? null,
      isDay: c.is_day === 1,
    },
    hourly: {
      time:     (j.hourly.time || []).map((t: string) => new Date(t)),
      temp:     j.hourly.temperature_2m || [],
      pop:      j.hourly.precipitation_probability || [],
      code:     j.hourly.weather_code || [],
      pressure: j.hourly.pressure_msl || [],
    },
    daily: {
      time:    (j.daily.time || []).map((t: string) => new Date(t)),
      code:    j.daily.weather_code || [],
      tMax:    j.daily.temperature_2m_max || [],
      tMin:    j.daily.temperature_2m_min || [],
      pop:     j.daily.precipitation_probability_max || [],
      sunrise: (j.daily.sunrise || []).map((t: string) => new Date(t)),
      sunset:  (j.daily.sunset || []).map((t: string) => new Date(t)),
    },
    fetchedAt: Date.now(),
  };
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
