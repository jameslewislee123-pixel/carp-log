/* eslint-disable no-console */
// One-time importer: read fisheries_uk.csv (output of scrape-fishadviser.ts)
// and upsert rows into the lakes table with source='seed'.
//
// Idempotent: relies on the lakes_name_coords_unique constraint added in
// migration 0012. Re-running picks up new rows without creating duplicates.
//
// Run:
//   npm install @supabase/supabase-js dotenv tsx
//   # Make sure .env.local has NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
//   npx tsx scripts/import-fisheries.ts fisheries_uk.csv

import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import 'dotenv/config';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!url || !serviceRole) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env. Aborting.');
  process.exit(1);
}

const sb = createClient(url, serviceRole, { auth: { persistSession: false } });

// Tiny RFC4180-ish parser: handles quoted fields with doubled-quote escapes
// and embedded commas/newlines. Splits a whole CSV string into rows of fields.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(cell); cell = '';
      } else if (ch === '\n' || ch === '\r') {
        if (cell.length > 0 || row.length > 0) {
          row.push(cell); rows.push(row); row = []; cell = '';
        }
        if (ch === '\r' && text[i + 1] === '\n') i++;
      } else {
        cell += ch;
      }
    }
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

async function main() {
  const csvPath = process.argv[2] || 'fisheries_uk.csv';
  const text = await fs.readFile(csvPath, 'utf-8');
  const rows = parseCsv(text);
  if (rows.length === 0) { console.error('Empty CSV'); process.exit(1); }
  const header = rows[0].map((h) => h.toLowerCase());
  const idx = (name: string) => header.indexOf(name);

  const iName = idx('name');
  const iLat = idx('latitude');
  const iLng = idx('longitude');
  const iAddress = idx('address');
  const iCounty = idx('county');
  const iCountry = idx('country');
  if (iName < 0 || iLat < 0 || iLng < 0) {
    console.error(`CSV missing required columns. Got: ${header.join(', ')}`);
    process.exit(1);
  }

  type LakeInsert = {
    name: string;
    latitude: number;
    longitude: number;
    region: string | null;
    country: string | null;
    source: 'seed';
    created_by: null;
  };

  const lakes: LakeInsert[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length < header.length) continue;
    const name = row[iName]?.trim();
    const lat = parseFloat(row[iLat]);
    const lng = parseFloat(row[iLng]);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const address = iAddress >= 0 ? row[iAddress]?.trim() : '';
    const county = iCounty >= 0 ? row[iCounty]?.trim() : '';
    const country = iCountry >= 0 ? row[iCountry]?.trim() : '';

    // Region heuristic: prefer the explicit county column from the scraper;
    // otherwise pull the second-to-last segment from the address (UK addresses
    // typically end with "..., County, Postcode").
    let region: string | null = county || null;
    if (!region && address) {
      const segs = address.split(',').map((s) => s.trim()).filter(Boolean);
      if (segs.length >= 2) region = segs[segs.length - 2] || null;
    }

    lakes.push({
      name,
      latitude: lat,
      longitude: lng,
      region,
      country: country || 'United Kingdom',
      source: 'seed',
      created_by: null,
    });
  }
  console.log(`Parsed ${lakes.length} valid rows from ${csvPath}`);

  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < lakes.length; i += CHUNK) {
    const chunk = lakes.slice(i, i + CHUNK);
    const { error } = await sb.from('lakes').upsert(chunk, {
      onConflict: 'name,latitude,longitude',
      ignoreDuplicates: true,
    });
    if (error) {
      console.error(`Chunk ${i}-${i + chunk.length} failed:`, error.message);
      continue;
    }
    inserted += chunk.length;
    console.log(`Upserted ${inserted}/${lakes.length}`);
  }
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
