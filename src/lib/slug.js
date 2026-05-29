import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { slugExists } from './db.js';

// Catalog of services techs can pick from. Slug fragment is what goes
// into the URL; label is the human-readable name; tag is what spoke-page
// tiles use; servicePage is the link target for the "Services Performed"
// buttons on the project page.
export const SERVICES = [
  { value: 'window-cleaning',  label: 'Window Cleaning',  schemaType: 'Window Washing',  spokeTag: 'Window Washing',  servicePage: 'window-washing' },
  { value: 'gutter-cleaning',  label: 'Gutter Cleaning',  schemaType: 'Gutter Cleaning', spokeTag: 'Gutter Cleaning', servicePage: 'gutter-cleaning' },
  { value: 'power-washing',    label: 'Power Washing',    schemaType: 'Power Washing',   spokeTag: 'Power Washing',   servicePage: 'power-washing' },
  { value: 'solar-panel-cleaning', label: 'Solar Panel Cleaning', schemaType: 'Solar Panel Cleaning', spokeTag: 'Solar Panel Cleaning', servicePage: 'solar-panel-cleaning' },
  { value: 'commercial-window-cleaning', label: 'Commercial Window Cleaning', schemaType: 'Commercial Window Washing', spokeTag: 'Commercial', servicePage: 'commercial-window-cleaning' },
  { value: 'ice-dam-removal',  label: 'Ice Dam Removal',  schemaType: 'Ice Dam Removal', spokeTag: 'Ice Dam Removal', servicePage: 'ice-dam-removal' },
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

// SOP §1: `[service]-[city]-il`, hyphens only, end with `-il`, descriptor
// goes at the tail (not a year). Returns lowercase, validated.
export function buildSlug({ service, citySlug, descriptor = '' }) {
  const parts = [service, citySlug];
  if (descriptor) {
    const d = descriptor.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    if (d) parts.push(d);
  }
  parts.push('il');
  return parts.join('-').replace(/-+/g, '-');
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
