#!/usr/bin/env node
// Scan the static-site repo's spoke pages, look at which hub phone they
// use, and write data/cities.json. Run once whenever new spoke pages are
// added to the site (or hub assignments change).

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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

// SOP-defined hubs. Phone numbers are how we detect which hub a spoke
// belongs to; address + parentOrganization come straight from the SOP.
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
  // e.g. "lake-forest" → "Lake Forest", "st-charles-il" → "St Charles IL"
  return slug.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

function detectHub(html) {
  if (html.includes(HUBS.northbrook.phone) || html.includes(HUBS.northbrook.phoneDigits)) return 'northbrook';
  if (html.includes(HUBS.chicago.phone)    || html.includes(HUBS.chicago.phoneDigits))    return 'chicago';
  return null;
}

const files = readdirSync(SITE).filter(f =>
  f.endsWith('.html') && !NON_SPOKE.has(f) && !f.startsWith('_')
);

const cities = [];
const unmapped = [];

for (const file of files) {
  const slug = file.replace(/\.html$/, '');
  const html = readFileSync(join(SITE, file), 'utf8');
  const hubKey = detectHub(html);
  if (!hubKey) {
    // City uses a phone we don't recognize — needs a manual decision.
    unmapped.push(slug);
    continue;
  }
  cities.push({
    slug,
    name: slugToCity(slug),
    hub: hubKey,
  });
}

cities.sort((a, b) => a.name.localeCompare(b.name));

const out = {
  generatedAt: new Date().toISOString(),
  hubs: HUBS,
  cities,
  unmapped,
};

mkdirSync(join(repoRoot, 'data'), { recursive: true });
const outPath = join(repoRoot, 'data', 'cities.json');
writeFileSync(outPath, JSON.stringify(out, null, 2));

console.log(`Wrote ${cities.length} cities to ${outPath}`);
if (unmapped.length) {
  console.log(`\n${unmapped.length} pages did not match a known hub phone:`);
  for (const s of unmapped) console.log(`  - ${s}`);
  console.log('\nEdit data/cities.json by hand to assign these to a hub, or update HUBS in this script.');
}
