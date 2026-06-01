#!/usr/bin/env node
// Scan the static-site repo's spoke pages, look at which hub phone they
// use, geocode each spoke + hub, and write data/cities.json.
//
// Idempotent: re-running merges into the existing cities.json so manual
// edits (city → hub overrides, lat/lng tweaks) are preserved. Only
// missing fields are filled.
//
// Geocoding step runs only if GOOGLE_MAPS_API_KEY is set in .env and
// the "Geocoding API" is enabled in Google Cloud. Without a key, the
// script still emits a usable cities.json but without lat/lng — the
// nearest-city fallback will then have nothing to work with.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const SITE = process.env.SITE_REPO_PATH;
if (!SITE) {
  console.error('SITE_REPO_PATH is not set. Add it to .env first.');
  process.exit(1);
}

const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY || '';

// SOP-defined hubs. Phone numbers detect which hub a spoke belongs to.
// `mapEmbedQuery` feeds the Maps Embed API on project pages; replace
// with a proper Google Business Profile embed URL by setting
// `gbpEmbedUrl` on the hub if you want the rich card with reviews.
const HUBS = {
  northbrook: {
    name: 'Northbrook',
    phone: '(847) 297-4492',
    phoneDigits: '8472974492',
    address: '2970 Maria Ave Suite 229, Northbrook IL 60062',
    addressShort: '2970 Maria Ave Suite 229',
    addressCity: 'Northbrook, IL 60062',
    parentOrgUrl: 'https://www.mywindowwashing.com/northbrook#localbusiness',
    hubSlug: 'northbrook',
    mapEmbedQuery: 'My Window Washing, 2970 Maria Ave Suite 229, Northbrook, IL 60062',
    gbpEmbedUrl: '',  // paste a full "Share → Embed a map" URL from the hub's GBP listing to override
  },
  chicago: {
    name: 'Chicago',
    phone: '(773) 377-4600',
    phoneDigits: '7733774600',
    address: 'Chicago, IL',
    addressShort: '',
    addressCity: 'Chicago, IL',
    parentOrgUrl: 'https://www.mywindowwashing.com/chicago#localbusiness',
    hubSlug: 'chicago',
    mapEmbedQuery: 'My Window Washing Chicago, IL',
    gbpEmbedUrl: '',
  },
};

// Pages that aren't city spokes — skip when scanning.
const NON_SPOKE = new Set([
  '404.html', 'index.html', 'contact-us.html', 'reviews.html', 'coupons.html',
  'feedback.html', 'thank-you.html', 'privacy-policy.html',
  'terms-and-conditions.html', 'window-washing.html', 'gutter-cleaning.html',
  'power-washing.html', 'commercial-window-cleaning.html',
  'solar-panel-cleaning.html', 'ice-dam-removal.html',
  'googlea55b0dac0348bb36.html', '_form-snippet.html',
]);

function slugToCity(slug) {
  return slug.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

function detectHub(html) {
  if (html.includes(HUBS.northbrook.phone) || html.includes(HUBS.northbrook.phoneDigits)) return 'northbrook';
  if (html.includes(HUBS.chicago.phone)    || html.includes(HUBS.chicago.phoneDigits))    return 'chicago';
  return null;
}

async function geocode(address) {
  if (!GOOGLE_KEY) return null;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status === 'OK' && data.results[0]) {
    const { lat, lng } = data.results[0].geometry.location;
    return { lat, lng };
  }
  return { error: data.status, message: data.error_message };
}

async function enrichCoords(items, addressFor) {
  if (!GOOGLE_KEY) {
    console.log('GOOGLE_MAPS_API_KEY not set — skipping geocoding. nearest-city fallback will be disabled.');
    return;
  }
  let geocoded = 0, skipped = 0, failed = 0;
  for (const item of items) {
    if (item.lat != null && item.lng != null) { skipped++; continue; }
    const result = await geocode(addressFor(item));
    if (result && result.lat != null) {
      item.lat = result.lat;
      item.lng = result.lng;
      geocoded++;
    } else {
      failed++;
      console.warn(`  geocode failed: ${addressFor(item)} → ${result?.error || 'no result'}${result?.message ? ' ('+result.message+')' : ''}`);
    }
    // Light rate limit — Google allows 50 QPS but we don't need that.
    await new Promise(r => setTimeout(r, 50));
  }
  console.log(`geocode: ${geocoded} new, ${skipped} already had coords, ${failed} failed`);
}

// ── Scan spoke pages ──────────────────────────────────────────────────
const files = readdirSync(SITE).filter(f =>
  f.endsWith('.html') && !NON_SPOKE.has(f) && !f.startsWith('_')
);

const scanned = [];
const unmapped = [];

for (const file of files) {
  const slug = file.replace(/\.html$/, '');
  const html = readFileSync(join(SITE, file), 'utf8');
  const hubKey = detectHub(html);
  if (!hubKey) {
    unmapped.push(slug);
    continue;
  }
  scanned.push({ slug, name: slugToCity(slug), hub: hubKey });
}

// Merge with existing cities.json so manual hub overrides + lat/lng
// survive reruns. Existing entries keep their hub; new spokes get the
// auto-detected hub. Anything in `unmapped` falls back to Northbrook,
// matching the user decision earlier in development.
const outPath = join(repoRoot, 'data', 'cities.json');
const existing = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : { cities: [], hubs: {} };
const existingByslug = new Map((existing.cities || []).map(c => [c.slug, c]));

const merged = [];
for (const s of scanned) {
  const prev = existingByslug.get(s.slug);
  merged.push({
    slug: s.slug,
    name: prev?.name || s.name,
    // Trust the existing hub if a human already set it; otherwise use
    // the freshly detected one.
    hub: prev?.hub || s.hub,
    lat: prev?.lat,
    lng: prev?.lng,
  });
}
// Pages that didn't match a hub phone — keep the existing hub if we
// already had one (likely the manual northbrook default), else default.
for (const slug of unmapped) {
  const prev = existingByslug.get(slug);
  merged.push({
    slug,
    name: prev?.name || slugToCity(slug),
    hub: prev?.hub || 'northbrook',
    lat: prev?.lat,
    lng: prev?.lng,
  });
}
merged.sort((a, b) => a.name.localeCompare(b.name));

// Merge hub overrides (so manual gbpEmbedUrl edits aren't wiped)
const mergedHubs = {};
for (const [key, def] of Object.entries(HUBS)) {
  const prev = existing.hubs?.[key] || {};
  mergedHubs[key] = {
    ...def,
    lat: prev.lat ?? def.lat,
    lng: prev.lng ?? def.lng,
    // gbpEmbedUrl is human-supplied; keep whatever was there.
    gbpEmbedUrl: prev.gbpEmbedUrl ?? def.gbpEmbedUrl,
  };
}

// ── Geocode ──────────────────────────────────────────────────────────
console.log(`Scanned ${merged.length} cities (${unmapped.length} via fallback). Geocoding…`);
await enrichCoords(merged, c => `${c.name}, IL, USA`);

const hubList = Object.values(mergedHubs);
await enrichCoords(hubList, h => h.address);
// Re-bind in case enrichCoords mutated nested objects
for (const h of hubList) {
  mergedHubs[h.hubSlug] = h;
}

// ── Write ────────────────────────────────────────────────────────────
const out = {
  generatedAt: new Date().toISOString(),
  hubs: mergedHubs,
  cities: merged,
  unmapped, // kept for diagnostics; resolveCityFromLocality doesn't use this
};

mkdirSync(join(repoRoot, 'data'), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`Wrote ${merged.length} cities to ${outPath}`);
