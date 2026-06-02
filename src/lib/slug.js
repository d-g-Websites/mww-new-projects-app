import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { slugExists } from './db.js';

// Catalog of services techs can pick from. Slug fragment is what goes
// into the URL; label is the human-readable name; tag is what spoke-page
// tiles use; servicePage is the link target for the "Services Performed"
// buttons on the project page. icon is a small SVG path used on the
// pick-service buttons.
export const SERVICES = [
  {
    value: 'window-cleaning',
    label: 'Window Washing',
    schemaType: 'Window Washing',
    spokeTag:  'Window Washing',
    servicePage: 'window-washing',
    iconSvg: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
  },
  {
    value: 'gutter-cleaning',
    label: 'Gutter Cleaning',
    schemaType: 'Gutter Cleaning',
    spokeTag:  'Gutter Cleaning',
    servicePage: 'gutter-cleaning',
    iconSvg: '<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  },
  {
    value: 'power-washing',
    label: 'Power Washing',
    schemaType: 'Power Washing',
    spokeTag:  'Power Washing',
    servicePage: 'power-washing',
    iconSvg: '<path d="M18 8h1a4 4 0 010 8h-1"/><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>',
  },
];

export function getService(value) {
  return SERVICES.find(s => s.value === value);
}

let CITIES = null;
export function loadCities() {
  if (CITIES) return CITIES;
  const path = join(process.cwd(), 'data', 'cities.json');
  CITIES = JSON.parse(readFileSync(path, 'utf8'));
  return CITIES;
}
export function getCity(slug) {
  return loadCities().cities.find(c => c.slug === slug);
}
export function getHub(key) {
  return loadCities().hubs[key];
}

// Take Google's locality string (e.g. "Highland Park") and return a
// city object the page renders against. Strategy:
//
//   1. If the locality is an existing spoke (e.g. "Highland Park",
//      "Naperville") → use it directly.
//   2. Otherwise — and this is the common case for any Chicago
//      address (Google returns "Chicago", not the neighborhood) and
//      for suburbs we don't have a spoke for (e.g. "Romeoville") —
//      pick the geographically nearest spoke by lat/lng and ANCHOR
//      THE PROJECT TO THAT SPOKE: its slug, its name, and its hub.
//      The published URL, breadcrumb, and "Recent Projects" tile on
//      the matched spoke page all reflect the nearest spoke. The
//      real customer address is still stored on the project row,
//      it's just internal — the public page is the SEO-anchored
//      version pointing at a real spoke.
//   3. If there are no coords (shouldn't happen since Places gives
//      lat/lng), keep the literal city name and fall back to the
//      Northbrook hub so the page still renders.
//
// `originalLocality` is returned for diagnostics (the preview screen
// can show "Bound to <spoke> based on this address" if we want it).
export function resolveCityFromLocality(locality, { lat, lng, fallbackHub = 'northbrook' } = {}) {
  if (!locality) return null;
  const slug = slugifyCity(locality);
  const known = getCity(slug);
  if (known) return { ...known, source: 'cities.json' };

  if (lat != null && lng != null) {
    const nearest = findNearestCity(lat, lng);
    if (nearest) {
      return {
        slug: nearest.slug,
        name: nearest.name,
        hub:  nearest.hub,
        lat:  nearest.lat,
        lng:  nearest.lng,
        source: 'nearest-by-coords',
        originalLocality: locality.trim(),
        nearestDistanceMiles: nearest.distanceMiles,
      };
    }
  }
  return {
    slug,
    name: locality.trim(),
    hub: fallbackHub,
    source: 'fallback-no-coords',
    originalLocality: locality.trim(),
  };
}

function slugifyCity(locality) {
  return locality.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Haversine distance between two lat/lng points, in miles.
function haversineMiles(lat1, lng1, lat2, lng2) {
  const toRad = x => x * Math.PI / 180;
  const R = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function findNearestCity(lat, lng) {
  if (lat == null || lng == null) return null;
  const cities = loadCities().cities.filter(c => c.lat != null && c.lng != null);
  if (cities.length === 0) return null;
  let best = null, bestDist = Infinity;
  for (const c of cities) {
    const d = haversineMiles(lat, lng, c.lat, c.lng);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best ? { ...best, distanceMiles: bestDist } : null;
}

// New URL pattern (per operational decision, overrides the SOP's "no
// year in URL" rule):
//   [service]-in-[city]-[mm-dd-yy]            e.g. window-cleaning-in-round-lake-beach-06-01-26
//   [service]-in-[city]-[mm-dd-yy]-[descriptor]   when same city + service publishes more than once on the same day
// The date is the day the project is submitted (today), not the job
// completion date — gives a near-zero collision rate without forcing
// the tech to think about uniqueness.
export function buildSlug({ service, citySlug, descriptor = '', date }) {
  const dateStr = formatDateMMDDYY(date);
  const parts = [service, 'in', citySlug, dateStr];
  if (descriptor) {
    const d = descriptor.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    if (d) parts.push(d);
  }
  return parts.join('-').replace(/-+/g, '-');
}

function formatDateMMDDYY(date) {
  const d = date instanceof Date ? date : (date ? new Date(date) : new Date());
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}-${dd}-${yy}`;
}

// Returns the slug if free, otherwise null. The route layer handles the
// "ask for descriptor" prompt — this just checks both DB + the static
// site repo so we never collide with a hand-built page.
export function isSlugAvailable(slug, siteRepoPath) {
  if (slugExists(slug)) return false;
  if (siteRepoPath) {
    const target = join(siteRepoPath, 'projects', `${slug}.html`);
    try {
      readFileSync(target);
      return false;
    } catch { /* missing file = available */ }
  }
  return true;
}
