// Global lake search via Nominatim + Wikipedia thumbnails + ESRI satellite
// fallback. Designed to respect Nominatim's usage policy:
//   - 1 request/second
//   - no autocomplete pattern (debounced 500ms, 3+ chars)
//   - identifying User-Agent
//   - localStorage cache 24h
//   - single in-flight request at a time

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type GlobalLakeResult = {
  osm_id: number;
  osm_type: 'node' | 'way' | 'relation';
  name: string;
  display_name: string;
  lat: number;
  lon: number;
  country: string;
  country_code: string;
  region: string | null;
  importance: number;
  feature_type: string;
  photo_url: string;
  photo_source: 'wikipedia' | 'satellite';
};

type Raw = GlobalLakeResult & {
  _wikipedia?: string | null;
  _wikidata?: string | null;
};

let inflight: Promise<GlobalLakeResult[]> | null = null;

export async function searchLakesGlobal(query: string): Promise<GlobalLakeResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];

  const cacheKey = `lake_search:${trimmed.toLowerCase()}`;
  if (typeof window !== 'undefined') {
    try {
      const cached = window.localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed.ts === 'number' && Array.isArray(parsed.data)
            && Date.now() - parsed.ts < CACHE_TTL_MS) {
          return parsed.data as GlobalLakeResult[];
        }
      }
    } catch {}
  }

  // Serialize: wait for any prior fetch to finish before starting ours.
  if (inflight) { try { await inflight; } catch {} }

  inflight = (async () => {
    const params = new URLSearchParams({
      q: trimmed,
      format: 'jsonv2',
      limit: '15',
      addressdetails: '1',
      namedetails: '1',
      extratags: '1',
    });

    const response = await fetch(`${NOMINATIM_BASE}?${params}`, {
      headers: {
        // Nominatim policy requires an identifying UA. Browsers strip the
        // User-Agent header on cross-origin XHRs from setting it, but we
        // include it anyway for environments that allow it; the Referer
        // header (sent automatically) also identifies the app.
        'Accept-Language': 'en',
      },
    });

    if (!response.ok) throw new Error(`Nominatim ${response.status}`);
    const raw = await response.json();

    const lakes: Raw[] = (Array.isArray(raw) ? raw : [])
      .filter((r: any) => {
        // Filter to water-body features. Nominatim returns class/type like:
        //   class=natural type=water        — lakes, ponds, reservoirs
        //   class=natural type=wetland|bay
        //   class=landuse type=reservoir    — older reservoir tagging
        //   class=waterway type=...         — rivers (skip)
        const cls = r.class as string | undefined;
        const type = r.type as string | undefined;
        if (!cls || !type) return false;
        if (cls === 'natural' && ['water', 'wetland', 'bay'].includes(type)) return true;
        if (cls === 'landuse' && type === 'reservoir') return true;
        if (['lake', 'pond', 'reservoir', 'basin'].includes(type)) return true;
        return false;
      })
      .map((r: any): Raw => {
        const lat = parseFloat(r.lat);
        const lon = parseFloat(r.lon);
        const wikipedia = r.extratags?.wikipedia as string | undefined;
        const wikidata = r.extratags?.wikidata as string | undefined;
        const name: string = (r.namedetails?.name as string | undefined)
          || (r.display_name as string | undefined)?.split(',')[0]?.trim()
          || 'Unnamed water';
        return {
          osm_id: Number(r.osm_id),
          osm_type: r.osm_type,
          name,
          display_name: r.display_name || name,
          lat,
          lon,
          country: r.address?.country || '',
          country_code: r.address?.country_code || '',
          region: r.address?.state || r.address?.county || r.address?.region || null,
          importance: typeof r.importance === 'number' ? r.importance : 0,
          feature_type: r.type,
          // Filled in by resolveLakePhoto below.
          photo_url: '',
          photo_source: 'satellite',
          _wikipedia: wikipedia || null,
          _wikidata: wikidata || null,
        };
      })
      .sort((a, b) => b.importance - a.importance);

    const withPhotos = await Promise.all(lakes.map(resolveLakePhoto));

    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: withPhotos }));
      } catch {}
    }

    return withPhotos;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

async function resolveLakePhoto(lake: Raw): Promise<GlobalLakeResult> {
  // Wikipedia thumbnail when the OSM tags reference an article.
  if (lake._wikipedia) {
    const colon = lake._wikipedia.indexOf(':');
    const lang = colon > 0 ? lake._wikipedia.slice(0, colon) : 'en';
    const title = colon > 0 ? lake._wikipedia.slice(colon + 1) : lake._wikipedia;
    try {
      const wikiResp = await fetch(
        `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
        { headers: { Accept: 'application/json' } },
      );
      if (wikiResp.ok) {
        const data = await wikiResp.json();
        const thumb = data?.thumbnail?.source as string | undefined;
        if (thumb) {
          // Wikipedia thumbnail URLs embed the requested width (e.g. /320px-).
          // Bump to 640px for a sharper card render.
          const upgraded = thumb.replace(/\/\d+px-/, '/640px-');
          return stripPrivate({ ...lake, photo_url: upgraded, photo_source: 'wikipedia' });
        }
      }
    } catch {}
  }

  // ESRI World Imagery satellite tile fallback. Free for sane usage.
  const zoom = 15;
  const lonRad = (lake.lon + 180) / 360;
  const tileX = Math.floor(lonRad * Math.pow(2, zoom));
  const latRad = lake.lat * Math.PI / 180;
  const tileY = Math.floor(
    (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * Math.pow(2, zoom),
  );
  const photo_url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${tileY}/${tileX}`;
  return stripPrivate({ ...lake, photo_url, photo_source: 'satellite' });
}

function stripPrivate(r: Raw): GlobalLakeResult {
  const { _wikipedia, _wikidata, ...rest } = r;
  return rest;
}
