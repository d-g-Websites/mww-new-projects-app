#!/usr/bin/env node
// Scan the static-site repo's spoke pages, look at which hub each
// spoke links to (`href="hubname"`), geocode each spoke + hub, and
// write data/cities.json.
//
// Hub detection is link-based, not phone-based: some hubs (Lisle +
// Bloomingdale) share a phone number, but every spoke page has a
// "Served by Our X Office" link to exactly one hub. The link wins.
//
// Idempotent: re-running merges into the existing cities.json so
// lat/lng + gbpEmbedUrl manual edits survive. hub assignment is always
// taken fresh from the scan, since the link detection is authoritative.
//
// Geocoding runs only if GOOGLE_MAPS_API_KEY is set and the "Geocoding
// API" is enabled in Google Cloud. Without it, the nearest-spoke
// fallback won't have lat/lng to compare against.

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

const GOOGLE_KEY = process.env.GOOGLE_GEOCODING_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';
const KEY_SOURCE = process.env.GOOGLE_GEOCODING_API_KEY ? 'GOOGLE_GEOCODING_API_KEY' : 'GOOGLE_MAPS_API_KEY';

// All 8 hubs in operation. Phone numbers are kept for reference but
// hub-of-spoke detection is by link, not phone. parentOrgUrl follows
// the SOP convention of `[hub]#localbusiness` even if existing pages
// don't always emit per-hub identifiers — project pages should.
// gbpEmbedUrl is left blank; paste the Google Business Profile "Share
// → Embed a map" iframe src URL per hub to get the rich card on
// project pages. Without it, the project page falls back to the Maps
// Embed API if a Google key is configured, else hides the section.
const HUBS = {
  chicago: {
    hubSlug: 'chicago',
    name: 'Chicago',
    phone: '(773) 377-4600',
    phoneDigits: '7733774600',
    address: '4747 W Peterson Ave Ste 407, Chicago IL 60646',
    addressShort: '4747 W Peterson Ave Ste 407',
    addressCity: 'Chicago, IL 60646',
    parentOrgUrl: 'https://www.mywindowwashing.com/chicago#localbusiness',
    mapEmbedQuery: 'My Window Washing, 4747 W Peterson Ave, Chicago, IL 60646',
    lat: 41.9896354, lng: -87.7480264,
    gbpEmbedUrl: 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2965.4957316778646!2d-87.7480264!3d41.989635400000004!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x880fcdc8b0b00001%3A0xbda12800f8b81a61!2sMy%20Window%20Washing%20and%20Gutter%20Cleaning!5e0!3m2!1sen!2sus!4v1780336269172!5m2!1sen!2sus',
  },
  'chicago-downtown': {
    hubSlug: 'chicago-downtown',
    name: 'Chicago Downtown',
    phone: '(773) 377-4600',
    phoneDigits: '7733774600',
    address: '1 N State St, Chicago IL 60602',
    addressShort: '1 N State St',
    addressCity: 'Chicago, IL 60602',
    parentOrgUrl: 'https://www.mywindowwashing.com/chicago-downtown#localbusiness',
    mapEmbedQuery: 'My Window Washing and Gutter Cleaning, 1 N State St, Chicago, IL 60602',
    lat: 41.8823461, lng: -87.6271218,
    gbpEmbedUrl: 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2970.488693859754!2d-87.62712180000001!3d41.8823461!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x880e2d687b140b97%3A0x9ee6a2e41c7ce4d5!2sMy%20Window%20Washing%20and%20Gutter%20Cleaning!5e0!3m2!1sen!2sus!4v1780336126566!5m2!1sen!2sus',
  },
  lisle: {
    hubSlug: 'lisle',
    name: 'Lisle',
    phone: '(630) 425-0678',
    phoneDigits: '6304250678',
    address: '3030 Warrenville Rd Unit 100, Lisle IL 60532',
    addressShort: '3030 Warrenville Rd Unit 100',
    addressCity: 'Lisle, IL 60532',
    parentOrgUrl: 'https://www.mywindowwashing.com/lisle#localbusiness',
    mapEmbedQuery: 'My Window Washing, 3030 Warrenville Rd, Lisle, IL 60532',
    lat: 41.8103262, lng: -88.1126692,
    gbpEmbedUrl: 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2973.8344692705614!2d-88.1126692!3d41.8103262!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x88ea3bee3f1d059b%3A0x99c27efdee0e9341!2sMy%20Window%20Washing!5e0!3m2!1sen!2sus!4v1780336091358!5m2!1sen!2sus',
  },
  'clarendon-hills': {
    hubSlug: 'clarendon-hills',
    name: 'Clarendon Hills',
    phone: '(708) 332-0096',
    phoneDigits: '7083320096',
    address: '223 Burlington Ave Ste 2, Clarendon Hills IL 60514',
    addressShort: '223 Burlington Ave Ste 2',
    addressCity: 'Clarendon Hills, IL 60514',
    parentOrgUrl: 'https://www.mywindowwashing.com/clarendon-hills#localbusiness',
    mapEmbedQuery: 'My Window Washing, 223 Burlington Ave, Clarendon Hills, IL 60514',
    lat: 41.797031, lng: -87.9561133,
    gbpEmbedUrl: 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2974.4516009721688!2d-87.9561133!3d41.797031!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x880e386ec06555b1%3A0xe8778d28539ead87!2sMy%20Window%20Washing%20and%20Gutter%20Cleaning!5e0!3m2!1sen!2sus!4v1780336303237!5m2!1sen!2sus',
  },
  bloomingdale: {
    hubSlug: 'bloomingdale',
    name: 'Bloomingdale',
    phone: '(630) 425-0678',
    phoneDigits: '6304250678',
    address: '127 E Lake St Suite 203A, Bloomingdale IL 60108',
    addressShort: '127 E Lake St Suite 203A',
    addressCity: 'Bloomingdale, IL 60108',
    parentOrgUrl: 'https://www.mywindowwashing.com/bloomingdale#localbusiness',
    mapEmbedQuery: 'My Window Washing, 127 E Lake St, Bloomingdale, IL 60108',
    lat: 41.9590252, lng: -88.0785491,
    gbpEmbedUrl: 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2966.9213108853833!2d-88.07854909999999!3d41.9590252!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x880fad57d613c9b3%3A0xe075991b3ccc0135!2sMy%20Window%20Washing!5e0!3m2!1sen!2sus!4v1780336191168!5m2!1sen!2sus',
  },
  barrington: {
    hubSlug: 'barrington',
    name: 'Barrington',
    phone: '(847) 715-9493',
    phoneDigits: '8477159493',
    address: '118 Barrington Commons Ct Ste 222, Barrington IL 60010',
    addressShort: '118 Barrington Commons Ct Ste 222',
    addressCity: 'Barrington, IL 60010',
    parentOrgUrl: 'https://www.mywindowwashing.com/barrington#localbusiness',
    mapEmbedQuery: 'My Window Washing, 118 Barrington Commons Ct, Barrington, IL 60010',
    lat: 42.1553509, lng: -88.13528,
    gbpEmbedUrl: 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2957.763339794153!2d-88.13528!3d42.155350899999995!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x880fb0b18093ae07%3A0x7646a2e32facc8c7!2sMy%20Window%20Washing%20and%20Gutter%20Cleaning!5e0!3m2!1sen!2sus!4v1780336241164!5m2!1sen!2sus',
  },
  'arlington-heights': {
    hubSlug: 'arlington-heights',
    name: 'Arlington Heights',
    phone: '(847) 807-1454',
    phoneDigits: '8478071454',
    address: '3401 N Kennicott Ave Suite A/B, Arlington Heights IL 60004',
    addressShort: '3401 N Kennicott Ave Suite A/B',
    addressCity: 'Arlington Heights, IL 60004',
    parentOrgUrl: 'https://www.mywindowwashing.com/arlington-heights#localbusiness',
    mapEmbedQuery: 'My Window Washing, 3401 N Kennicott Ave, Arlington Heights, IL 60004',
    lat: 42.1370898, lng: -87.995657,
    gbpEmbedUrl: 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2958.6166286809944!2d-87.995657!3d42.1370898!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x880fbc22b36815ad%3A0xc04d993f17cfcdc4!2sMy%20Window%20Washing!5e0!3m2!1sen!2sus!4v1780336157317!5m2!1sen!2sus',
  },
  northbrook: {
    hubSlug: 'northbrook',
    name: 'Northbrook',
    phone: '(847) 297-4492',
    phoneDigits: '8472974492',
    address: '2970 Maria Ave Suite 229, Northbrook IL 60062',
    addressShort: '2970 Maria Ave Suite 229',
    addressCity: 'Northbrook, IL 60062',
    parentOrgUrl: 'https://www.mywindowwashing.com/northbrook#localbusiness',
    mapEmbedQuery: 'My Window Washing, 2970 Maria Ave Suite 229, Northbrook, IL 60062',
    lat: 42.14585599, lng: -87.8526241,
    gbpEmbedUrl: 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2958.207046771161!2d-87.8526241!3d42.14585599999999!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x880fc0a81b642971%3A0x944979ffa928abd9!2sMy%20Window%20Washing!5e0!3m2!1sen!2sus!4v1780336214097!5m2!1sen!2sus',
  },
  'round-lake': {
    hubSlug: 'round-lake',
    name: 'Round Lake',
    phone: '(847) 807-1455',
    phoneDigits: '8478071455',
    address: '56 E Lakeview Ave, Round Lake IL 60073',
    addressShort: '56 E Lakeview Ave',
    addressCity: 'Round Lake, IL 60073',
    parentOrgUrl: 'https://www.mywindowwashing.com/round-lake#localbusiness',
    mapEmbedQuery: 'My Window Washing, 56 E Lakeview Ave, Round Lake, IL 60073',
    lat: 42.3694968, lng: -88.0811504,
    gbpEmbedUrl: 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2947.7345179539743!2d-88.0811504!3d42.36949679999999!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x880f9b503bf808d5%3A0x4782882ba172e8d0!2sMy%20Window%20Washing%20and%20Gutter%20Cleaning!5e0!3m2!1sen!2sus!4v1780336324837!5m2!1sen!2sus',
  },
};

const HUB_KEYS = Object.keys(HUBS);

// Hub pages themselves shouldn't be treated as spokes.
const HUB_SLUGS = new Set(HUB_KEYS);

// Non-spoke pages — service pages, legal, etc.
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

// Link-based hub detection. For each spoke page, find which hub key it
// links to via `href="hubkey"` (the existing "Served by Our X Office"
// CTAs all match this). If a spoke links to multiple hubs, the one with
// the most occurrences wins (typically there's one).
function detectHubByLink(html) {
  const counts = {};
  for (const key of HUB_KEYS) {
    const re = new RegExp(`href="${key}(?:[#?][^"]*)?"`, 'g');
    const matches = html.match(re);
    if (matches) counts[key] = matches.length;
  }
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return ranked.length ? ranked[0][0] : null;
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

async function enrichCoords(items, addressFor, label) {
  if (!GOOGLE_KEY) {
    console.log(`${label}: GOOGLE_MAPS_API_KEY not set — skipping geocode.`);
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
      console.warn(`  geocode failed: ${addressFor(item)} → ${result?.error || 'no result'}${result?.message ? ' (' + result.message + ')' : ''}`);
    }
    await new Promise(r => setTimeout(r, 50));
  }
  console.log(`${label}: ${geocoded} new, ${skipped} kept, ${failed} failed`);
}

if (GOOGLE_KEY) {
  console.log(`Geocoding key in use: ${KEY_SOURCE}`);
}

// ── Scan spoke pages ──────────────────────────────────────────────────
const files = readdirSync(SITE).filter(f =>
  f.endsWith('.html') && !NON_SPOKE.has(f) && !f.startsWith('_')
);

const scanned = [];
const unmapped = [];

for (const file of files) {
  const slug = file.replace(/\.html$/, '');
  // Skip the hub pages themselves — they aren't spokes.
  if (HUB_SLUGS.has(slug)) continue;
  const html = readFileSync(join(SITE, file), 'utf8');
  const hubKey = detectHubByLink(html);
  if (!hubKey) {
    unmapped.push(slug);
    continue;
  }
  scanned.push({ slug, name: slugToCity(slug), hub: hubKey });
}

// ── Merge with existing cities.json ──────────────────────────────────
// hub is ALWAYS overwritten by the fresh link-based scan (link is
// authoritative). lat/lng are preserved if already present. Same for
// hub.gbpEmbedUrl / hub.lat / hub.lng — preserved across reruns.
const outPath = join(repoRoot, 'data', 'cities.json');
const existing = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : { cities: [], hubs: {} };
const existingBySlug = new Map((existing.cities || []).map(c => [c.slug, c]));

const merged = scanned.map(s => {
  const prev = existingBySlug.get(s.slug);
  return {
    slug: s.slug,
    name: s.name,
    hub: s.hub,
    lat: prev?.lat,
    lng: prev?.lng,
  };
});
merged.sort((a, b) => a.name.localeCompare(b.name));

const mergedHubs = {};
for (const [key, def] of Object.entries(HUBS)) {
  const prev = existing.hubs?.[key] || {};
  mergedHubs[key] = {
    ...def,
    lat: prev.lat ?? def.lat,
    lng: prev.lng ?? def.lng,
    // Use `||` so a previously-empty string in cities.json gets
    // replaced by the new value baked into HUBS; once it's populated
    // here, ad-hoc edits to cities.json win on the next rebuild.
    gbpEmbedUrl: prev.gbpEmbedUrl || def.gbpEmbedUrl,
  };
}

// ── Geocode missing coords ───────────────────────────────────────────
console.log(`Scanned ${merged.length} cities across ${HUB_KEYS.length} hubs.`);
if (unmapped.length) {
  console.log(`\n${unmapped.length} pages had no recognizable hub link:`);
  for (const s of unmapped) console.log(`  - ${s}`);
}

await enrichCoords(merged, c => `${c.name}, IL, USA`, 'spokes');

const hubArr = Object.values(mergedHubs);
await enrichCoords(hubArr, h => h.address, 'hubs');
for (const h of hubArr) mergedHubs[h.hubSlug] = h;

// ── Write ────────────────────────────────────────────────────────────
const out = {
  generatedAt: new Date().toISOString(),
  hubs: mergedHubs,
  cities: merged,
  unmapped,
};

mkdirSync(join(repoRoot, 'data'), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`\nWrote ${merged.length} cities + ${HUB_KEYS.length} hubs to ${outPath}`);

// Per-hub spoke count summary for sanity
const perHub = {};
for (const c of merged) { perHub[c.hub] = (perHub[c.hub] || 0) + 1; }
console.log('\nSpokes per hub:');
for (const k of HUB_KEYS) console.log(`  ${k}: ${perHub[k] || 0}`);
