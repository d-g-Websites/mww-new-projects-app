// Archive pages that aggregate published projects:
//   /projects/                  → master archive (every project, filterable)
//   /projects/<service>.html    → all projects for a service (window-cleaning, etc.)
//   /projects/<spoke>.html      → all projects for a spoke city (highland-park, etc.)
//
// Each archive page is regenerated on every publish so any newly-
// added project shows up everywhere it should. The dashboard's
// publishProject() calls writeAffectedArchives() to do the minimum
// set: master + the published project's service + the published
// project's spoke.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Handlebars from 'handlebars';
import {
  listPublishedAll, listPublishedBySpoke, listPublishedByService,
  listServicesWithPublished, listSpokesWithPublished,
} from './db.js';
import { SERVICES, getService, getCity, getHub } from './slug.js';

const SITE_ROOT = 'https://www.mywindowwashing.com';

// Handlebars helpers used inside templates/archive-page.hbs. We can't
// piggyback on the express-handlebars helpers because we compile this
// template directly with raw Handlebars (no view engine in the loop).
Handlebars.registerHelper('eq', function (a, b) { return a === b; });

// Generic "header" used on the master + per-service archives, since
// they span every hub. Per-spoke archives use the real hub.
const GENERIC_HUB = {
  name: 'My Window Washing',
  phone: '(800) 941-2790',
  phoneDigits: '8009412790',
  hubSlug: '',
};

let TEMPLATE_FN = null;
function getTemplate() {
  if (!TEMPLATE_FN) {
    const src = readFileSync(join(process.cwd(), 'templates', 'archive-page.hbs'), 'utf8');
    TEMPLATE_FN = Handlebars.compile(src);
  }
  return TEMPLATE_FN;
}

function monthYear(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// Cards live under /projects/, so each project page is a sibling
// reachable as just `${slug}` (no leading slash, no projects/ prefix).
function buildCard(project) {
  const service = getService(project.service);
  const dateLabel = monthYear(project.review_date);
  return {
    href:         project.slug,
    thumbnailUrl: `img/${project.slug}-after.webp`,
    title:        `${service?.label || project.service_label} — ${project.city_name}, IL`,
    serviceLabel: service?.label || project.service_label,
    service:      project.service,           // value for the filter buttons
    cityName:     project.city_name,
    dateLabel,
  };
}

function buildSchema({ kind, focus, view }) {
  const canonical = view.seo.canonical;
  const itemList = view.cards.map((c, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    url: `${SITE_ROOT}/projects/${c.href}`,
    name: c.title,
  }));
  const graph = [
    {
      '@type': 'CollectionPage',
      '@id':   `${canonical}#webpage`,
      url:     canonical,
      name:    view.seo.title,
      description: view.seo.description,
      inLanguage: 'en-US',
      isPartOf:  { '@id': `${SITE_ROOT}#website` },
      breadcrumb: { '@id': `${canonical}#breadcrumb` },
      mainEntity: { '@id': `${canonical}#itemlist` },
    },
    {
      '@type': 'BreadcrumbList',
      '@id':   `${canonical}#breadcrumb`,
      itemListElement: view.breadcrumb.map((b, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: b.name,
        item: i === view.breadcrumb.length - 1 ? canonical : (b.href.startsWith('/') ? `${SITE_ROOT}${b.href}` : b.href),
      })),
    },
    {
      '@type': 'ItemList',
      '@id':   `${canonical}#itemlist`,
      itemListOrder: 'https://schema.org/ItemListOrderDescending',
      numberOfItems: view.cards.length,
      itemListElement: itemList,
    },
  ];
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 2);
}

// Build the view object the archive template expects.
function buildView({ kind, focus, projects }) {
  const cards = projects.map(buildCard);

  let title, h1Html, intro, urlPath, breadcrumb, hub, ctaHeading, ctaSub;

  if (kind === 'master') {
    title = 'Completed Projects | My Window Washing';
    h1Html = 'Completed <span>Projects</span>';
    intro = 'Every window washing, gutter cleaning, and power washing job our crews have documented across Chicago and the suburbs.';
    urlPath = '/projects/';
    breadcrumb = [
      { name: 'Home', href: '/' },
      { name: 'Projects' },
    ];
    hub = GENERIC_HUB;
    ctaHeading = 'Ready to schedule yours?';
    ctaSub = 'Same-day and next-day appointments often available across Chicago and the suburbs.';
  } else if (kind === 'service') {
    const svc = getService(focus);
    title = `${svc.label} Projects | My Window Washing`;
    h1Html = `${svc.label} <span>Projects</span>`;
    intro = `Every ${svc.label.toLowerCase()} project our crews have documented across Chicago and the suburbs — real homes, real before/after, real customer reviews.`;
    urlPath = `/projects/${svc.value}`;
    breadcrumb = [
      { name: 'Home', href: '/' },
      { name: 'Projects', href: '/projects/' },
      { name: svc.label },
    ];
    hub = GENERIC_HUB;
    ctaHeading = `Ready to schedule your ${svc.label.toLowerCase()}?`;
    ctaSub = 'Same-day and next-day appointments often available across Chicago and the suburbs.';
  } else if (kind === 'spoke') {
    const cityObj = getCity(focus);
    const hubObj  = cityObj ? getHub(cityObj.hub) : GENERIC_HUB;
    const cityName = cityObj?.name || titleCase(focus);
    title = `Completed Projects in ${cityName}, IL | My Window Washing`;
    h1Html = `Projects in <span>${cityName}, IL</span>`;
    intro = `Window washing, gutter cleaning, and power washing completed at ${cityName} properties by our ${hubObj?.name || 'local'} team.`;
    urlPath = `/projects/${focus}`;
    breadcrumb = [
      { name: 'Home', href: '/' },
      { name: 'Projects', href: '/projects/' },
      { name: `${cityName}, IL` },
    ];
    hub = hubObj || GENERIC_HUB;
    ctaHeading = `Ready to schedule yours in ${cityName}?`;
    ctaSub = `Served by our ${hubObj?.name || 'local'} team — same-day and next-day appointments often available.`;
  }

  // Footer service links — always show all 3 service archives so
  // visitors can jump between them from any archive page.
  const footerServiceLinks = SERVICES.map(s => ({
    slug:  s.value,
    label: `${s.label} Projects`,
  }));

  const view = {
    kind, focus,
    h1Html,
    intro,
    count: cards.length,
    cards,
    breadcrumb,
    hub,
    showFilters: kind === 'master',
    services: SERVICES,
    cta: { heading: ctaHeading, sub: ctaSub },
    footerServiceLinks,
    seo: {
      title,
      description: intro,
      canonical: `${SITE_ROOT}${urlPath}`,
    },
  };
  view.schemaJson = buildSchema({ kind, focus, view });
  return view;
}

function titleCase(slug) {
  return slug.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

// ── Write helpers ────────────────────────────────────────────────────

function ensureProjectsDir(siteRepo) {
  const dir = join(siteRepo, 'projects');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeMasterArchive(siteRepo) {
  const projects = listPublishedAll();
  if (projects.length === 0) return null;
  const view = buildView({ kind: 'master', focus: null, projects });
  const outPath = join(ensureProjectsDir(siteRepo), 'index.html');
  writeFileSync(outPath, getTemplate()(view), 'utf8');
  return outPath;
}

export function writeServiceArchive(siteRepo, serviceValue) {
  const projects = listPublishedByService(serviceValue);
  if (projects.length === 0) return null;
  const view = buildView({ kind: 'service', focus: serviceValue, projects });
  const outPath = join(ensureProjectsDir(siteRepo), `${serviceValue}.html`);
  writeFileSync(outPath, getTemplate()(view), 'utf8');
  return outPath;
}

export function writeSpokeArchive(siteRepo, spokeSlug) {
  if (!spokeSlug) return null;
  const projects = listPublishedBySpoke(spokeSlug);
  if (projects.length === 0) return null;
  const view = buildView({ kind: 'spoke', focus: spokeSlug, projects });
  const outPath = join(ensureProjectsDir(siteRepo), `${spokeSlug}.html`);
  writeFileSync(outPath, getTemplate()(view), 'utf8');
  return outPath;
}

// The set of archive pages a single publish needs to regenerate:
//   - master (every publish touches it)
//   - this project's service archive
//   - this project's spoke archive
// Returns the list of absolute file paths written so they can be
// folded into the git commit's file list.
export function writeAffectedArchives(siteRepo, project) {
  const written = [];
  const m = writeMasterArchive(siteRepo);
  if (m) written.push(m);
  const s = writeServiceArchive(siteRepo, project.service);
  if (s) written.push(s);
  const sp = writeSpokeArchive(siteRepo, project.spoke_slug || project.city_slug);
  if (sp) written.push(sp);
  return written;
}

// Inventory of archive URLs that currently exist in the static site,
// so sitemap.js can add/refresh entries for each. Returns relative
// URL paths under the site root.
export function currentArchiveUrls() {
  const urls = ['/projects/'];
  for (const svc of listServicesWithPublished()) urls.push(`/projects/${svc}`);
  for (const spoke of listSpokesWithPublished()) urls.push(`/projects/${spoke}`);
  return urls;
}
