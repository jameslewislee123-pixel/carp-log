-- ============================================================
-- Carp Log v2.8 — global lake search metadata
--
-- Adds the columns we need to store the rich metadata returned by
-- Nominatim + Wikipedia/ESRI photo resolution. All nullable so
-- existing rows keep working unchanged.
--
--   osm_id, osm_type   — OSM identifiers; (osm_id) indexed for dedupe
--                        when re-adding a lake the user already saved.
--   country, region    — display fields for the worldwide result card.
--   importance         — Nominatim's 0..1 ranking score; persisted so
--                        we can sort saved lakes by it later if useful.
--   photo_url          — resolved photo: Wikipedia thumbnail OR ESRI
--                        satellite tile fallback. Persisted so future
--                        renders skip Wikipedia/Wikidata roundtrips.
--   photo_source       — 'wikipedia' | 'satellite' | future values.
-- ============================================================

alter table public.lakes
  add column if not exists osm_id        bigint,
  add column if not exists osm_type      text,
  add column if not exists country       text,
  add column if not exists region        text,
  add column if not exists importance    numeric,
  add column if not exists photo_url     text,
  add column if not exists photo_source  text;

create index if not exists idx_lakes_osm_id on public.lakes (osm_id);
