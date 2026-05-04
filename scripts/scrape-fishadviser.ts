/* eslint-disable no-console */
// One-time scraper for FishAdviser UK fishery directory.
//
// Two-phase, resumable:
//   Phase 1 — walk county index pages (1..MAX_COUNTY) collecting fishery
//             IDs. Progress checkpointed to .scrape/county-ids.json.
//   Phase 2 — visit each /fishery/{id}/ page, parse fields, append to
//             fisheries_uk.csv. Progress checkpointed to
//             .scrape/visited-ids.json so re-running picks up where it
//             stopped after a crash or rate-limit.
//
// Etiquette:
//   - Identifying User-Agent + Accept-Language
//   - DELAY_MS pause between pages (default 2000ms = ~30 req/min)
//   - 1 browser context, 1 page at a time. Bump CONCURRENCY only if
//     you've confirmed FishAdviser is OK with it.
//
// Run:
//   npm install playwright
//   npx playwright install chromium
//   npx tsx scripts/scrape-fishadviser.ts
//
// USE AT YOUR OWN DISCRETION. Check FishAdviser's terms / robots.txt
// before running. This is intended for personal/private use only.

import { chromium, type Browser, type Page } from 'playwright';
import fs from 'fs/promises';
import path from 'path';

const BASE = 'https://fishadviser.co.uk';
const STATE_DIR = '.scrape';
const COUNTY_IDS_FILE = path.join(STATE_DIR, 'county-ids.json');
const VISITED_FILE = path.join(STATE_DIR, 'visited-ids.json');
const OUTPUT_CSV = 'fisheries_uk.csv';

const COUNTY_RANGE = { from: 1, to: 65 };
const DELAY_MS = 2000;
const NAVIGATION_TIMEOUT_MS = 30_000;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 CarpLog/1.0 (private use)';

type FisheryRow = {
  fishery_id: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  species_info: string;
  website: string;
  county: string;
  country: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ensureStateDir() {
  await fs.mkdir(STATE_DIR, { recursive: true });
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, data: unknown) {
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

async function appendRow(row: FisheryRow) {
  const line = [
    row.fishery_id, row.name, row.address,
    row.latitude ?? '', row.longitude ?? '',
    row.species_info, row.website, row.county, row.country,
  ].map(csvEscape).join(',') + '\n';
  await fs.appendFile(OUTPUT_CSV, line);
}

async function ensureCsvHeader() {
  try {
    await fs.access(OUTPUT_CSV);
  } catch {
    const header = [
      'fishery_id', 'name', 'address',
      'latitude', 'longitude',
      'species_info', 'website', 'county', 'country',
    ].join(',') + '\n';
    await fs.writeFile(OUTPUT_CSV, header);
  }
}

// Phase 1 — find every fishery id linked from each county page (with pagination).
async function collectCountyIds(browser: Browser): Promise<Record<string, string[]>> {
  const cached = await readJson<Record<string, string[]>>(COUNTY_IDS_FILE, {});
  const ctx = await browser.newContext({ userAgent: USER_AGENT, locale: 'en-GB', viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);

  for (let countyId = COUNTY_RANGE.from; countyId <= COUNTY_RANGE.to; countyId++) {
    if (cached[String(countyId)]) {
      console.log(`County ${countyId}: cached (${cached[String(countyId)].length} ids)`);
      continue;
    }
    const ids = new Set<string>();
    let countyName = `county-${countyId}`;
    for (let pageNum = 1; pageNum <= 30; pageNum++) {
      const url = `${BASE}/fisheries/${countyId}/x?page=${pageNum}`;
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
      } catch (e: any) {
        console.warn(`  ${url} — ${e?.message || e}`);
        break;
      }
      // Try to capture county name from the canonical URL (redirects rewrite the slug).
      const canonical = page.url();
      const slugMatch = canonical.match(/\/fisheries\/\d+\/([^?#]+)/);
      if (slugMatch) countyName = decodeURIComponent(slugMatch[1]).replace(/-/g, ' ');

      const pageIds = await page.$$eval('a[href*="/fishery/"]', (links) =>
        Array.from(new Set(
          links.map((l) => (l as HTMLAnchorElement).href.match(/\/fishery\/(\d+)/)?.[1]).filter(Boolean) as string[]
        ))
      );
      const before = ids.size;
      pageIds.forEach((id) => ids.add(id));
      if (pageIds.length === 0 || ids.size === before) break; // no new ids → end of pagination
      await sleep(DELAY_MS);
    }
    cached[String(countyId)] = Array.from(ids);
    cached[`__name__${countyId}`] = [countyName] as any;
    await writeJson(COUNTY_IDS_FILE, cached);
    console.log(`County ${countyId} (${countyName}): ${ids.size} fisheries`);
    await sleep(DELAY_MS);
  }

  await ctx.close();
  return cached;
}

// Phase 2 — visit each fishery detail page and extract structured data.
async function scrapeFishery(page: Page, fisheryId: string): Promise<Omit<FisheryRow, 'county' | 'country'> | null> {
  const url = `${BASE}/fishery/${fisheryId}/x`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  } catch (e: any) {
    console.warn(`  ${fisheryId}: navigation failed — ${e?.message || e}`);
    return null;
  }

  const data = await page.evaluate(() => {
    const text = document.body.innerText || '';

    // Name: prefer the explicit fishery-name element, fall back to first H1/H4.
    const named = document.querySelector('#fishery-name, .fishery-name')?.textContent?.trim();
    const heading = document.querySelector('h1')?.textContent?.trim() ||
                    document.querySelector('h4')?.textContent?.trim();
    const name = (named || heading || '').replace(/\s+/g, ' ');

    // Coords: extract from any Google Maps directions link (daddr=lat,lng).
    let lat: number | null = null;
    let lng: number | null = null;
    document.querySelectorAll<HTMLAnchorElement>('a[href*="maps.google"], a[href*="google.com/maps"], a[href*="maps.app.goo.gl"]').forEach((a) => {
      const m = a.href.match(/daddr=([\-\d.]+),([\-\d.]+)/) ||
                a.href.match(/[?&]q=([\-\d.]+),([\-\d.]+)/) ||
                a.href.match(/@([\-\d.]+),([\-\d.]+)/);
      if (m && lat == null) {
        lat = parseFloat(m[1]);
        lng = parseFloat(m[2]);
      }
    });

    // Address: look for explicit "Address:" label, then capture the rest of that line
    // and any subsequent indented lines until the next section.
    let address = '';
    const addrIdx = text.search(/^\s*Address\s*:/im);
    if (addrIdx >= 0) {
      const slice = text.slice(addrIdx).split('\n').slice(0, 6).join('\n');
      const m = slice.match(/Address\s*:\s*([^\n]*(?:\n(?!\s*(Website|Phone|Email|Stock|Species|Tickets|Facilities))[^\n]*)*)/i);
      if (m) address = m[1].replace(/\s+/g, ' ').trim();
    }

    // Species/stock info — anything starting with "Carp to / Specimen / Pike to"
    let species_info = '';
    const stockMatch = text.match(/(Carp to[^\n]+|Pike to[^\n]+|Tench to[^\n]+|Specimen[^\n]+|Stocked with[^\n]+)/i);
    if (stockMatch) species_info = stockMatch[1].replace(/\s+/g, ' ').trim();

    // Website: pick the first external http(s) link that isn't social or a map service.
    const SKIP = ['fishadviser', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'youtube.com', 'youtu.be', 'tiktok.com', 'google.com', 'maps.app.goo.gl', 'wa.me', 'whatsapp.com'];
    let website = '';
    document.querySelectorAll<HTMLAnchorElement>('a[href^="http"]').forEach((a) => {
      if (website) return;
      const href = a.href;
      if (!href || SKIP.some((s) => href.includes(s))) return;
      website = href;
    });

    return { name, address, lat, lng, species_info, website };
  });

  if (!data.name) return null;
  return {
    fishery_id: fisheryId,
    name: data.name,
    address: data.address,
    latitude: data.lat,
    longitude: data.lng,
    species_info: data.species_info,
    website: data.website,
  };
}

async function main() {
  await ensureStateDir();
  await ensureCsvHeader();

  const browser = await chromium.launch({ headless: true });

  console.log('--- Phase 1: collect county ids ---');
  const byCounty = await collectCountyIds(browser);

  // Build {fisheryId -> countyName} map.
  const idToCounty: Record<string, string> = {};
  for (const [k, v] of Object.entries(byCounty)) {
    if (k.startsWith('__name__')) continue;
    const countyName = (byCounty[`__name__${k}`] as any)?.[0] || `county-${k}`;
    (v as string[]).forEach((id) => { if (!idToCounty[id]) idToCounty[id] = countyName; });
  }
  const allIds = Object.keys(idToCounty);
  console.log(`Total unique fisheries: ${allIds.length}`);

  console.log('--- Phase 2: scrape detail pages ---');
  const visited = new Set(await readJson<string[]>(VISITED_FILE, []));
  console.log(`Resuming — ${visited.size}/${allIds.length} already visited.`);

  const ctx = await browser.newContext({ userAgent: USER_AGENT, locale: 'en-GB', viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);

  let count = 0;
  for (const id of allIds) {
    if (visited.has(id)) continue;
    count++;
    try {
      const row = await scrapeFishery(page, id);
      if (row && row.latitude != null && row.longitude != null) {
        await appendRow({ ...row, county: idToCounty[id] || '', country: 'United Kingdom' });
      } else if (row) {
        console.log(`  ${id} ${row.name}: no coords, skipped`);
      } else {
        console.log(`  ${id}: parse failed, skipped`);
      }
    } catch (e: any) {
      console.warn(`  ${id}: ${e?.message || e}`);
    }
    visited.add(id);
    if (count % 25 === 0) {
      await writeJson(VISITED_FILE, Array.from(visited));
      console.log(`Checkpoint — ${visited.size}/${allIds.length}`);
    }
    await sleep(DELAY_MS);
  }
  await writeJson(VISITED_FILE, Array.from(visited));

  await ctx.close();
  await browser.close();
  console.log(`Done. CSV at ${OUTPUT_CSV}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
