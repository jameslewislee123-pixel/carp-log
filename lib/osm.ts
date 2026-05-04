// OSM Overpass helpers — extracted from DiscoverVenues so AddLakeModal
// can reuse the same fetch/cache/dedupe machinery without duplicating
// the mirror-fanout logic.

export type OSMVenue = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: string;
  distanceKm: number;
  added?: boolean;
};

export const RADIUS_OPTIONS = [25, 50, 100] as const;
export type Radius = typeof RADIUS_OPTIONS[number];

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const COOLDOWN_MS = 30 * 1000;

// Fired in parallel via Promise.any — first 2xx wins and the rest are
// aborted. Kumi (community mirror) is consistently fastest for our small
// queries; main and mail.ru are fallbacks with independent capacity.
const OVERPASS_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
] as const;

export function osmCacheKey(lat: number, lng: number, radius: Radius) {
  return `osm_venues_${lat.toFixed(2)}_${lng.toFixed(2)}_${radius}`;
}

export function readOsmCache(key: string): OSMVenue[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.timestamp !== 'number') return null;
    if (Date.now() - parsed.timestamp > CACHE_TTL_MS) return null;
    if (!Array.isArray(parsed.results)) return null;
    return parsed.results as OSMVenue[];
  } catch { return null; }
}

export function writeOsmCache(key: string, results: OSMVenue[]) {
  try {
    localStorage.setItem(key, JSON.stringify({ results, timestamp: Date.now() }));
  } catch {}
}

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function buildOverpassQuery(center: { lat: number; lng: number }, radiusKm: Radius): string {
  const r = radiusKm * 1000;
  const { lat, lng } = center;
  return `[out:json][timeout:15];
(
  node["leisure"="fishing"](around:${r},${lat},${lng});
  node["sport"="fishing"](around:${r},${lat},${lng});
  way["leisure"="fishing"](around:${r},${lat},${lng});
  way["sport"="fishing"](around:${r},${lat},${lng});
);
out center;`;
}

async function callOverpass(query: string, signal: AbortSignal): Promise<any> {
  const body = 'data=' + encodeURIComponent(query);
  const attempts = OVERPASS_ENDPOINTS.map((url) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal,
    }).then(async (res) => {
      if (!res.ok) {
        let detail = '';
        try { detail = (await res.text()).slice(0, 200); } catch {}
        throw new Error(`${url}: ${res.status} ${res.statusText}${detail ? ` — ${detail.replace(/\s+/g, ' ').trim()}` : ''}`);
      }
      return res.json();
    }).catch((e) => {
      if (e?.name === 'AbortError') throw e;
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(msg.startsWith('http') ? msg : `${url}: ${msg}`);
    })
  );
  try {
    return await Promise.any(attempts);
  } catch (e: any) {
    if (e instanceof AggregateError) {
      const msgs = e.errors.map((er: any) => er instanceof Error ? er.message : String(er)).join('\n');
      throw new Error(`All Overpass mirrors failed:\n${msgs}`);
    }
    throw e;
  }
}

export async function fetchOverpassVenues(center: { lat: number; lng: number }, radiusKm: Radius): Promise<OSMVenue[]> {
  const query = buildOverpassQuery(center, radiusKm);
  const controller = new AbortController();
  let json: any;
  try {
    json = await callOverpass(query, controller.signal);
  } finally {
    controller.abort();
  }

  const elements: any[] = json?.elements || [];
  const seen = new Set<string>();
  const venues: OSMVenue[] = [];
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    const id = `${el.type}-${el.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const name = (el.tags?.name as string | undefined)?.trim()
      || `Unnamed venue (${lat.toFixed(3)},${lng.toFixed(3)})`;
    const type = el.tags?.leisure || el.tags?.sport || el.tags?.natural || 'venue';
    venues.push({
      id, name, lat, lng, type,
      distanceKm: distanceKm(center, { lat, lng }),
    });
  }
  venues.sort((a, b) => a.distanceKm - b.distanceKm);
  return venues;
}

export function openDirections(v: { lat: number; lng: number }) {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const url = isIOS
    ? `https://maps.apple.com/?daddr=${v.lat},${v.lng}`
    : `https://www.google.com/maps/dir/?api=1&destination=${v.lat},${v.lng}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}
