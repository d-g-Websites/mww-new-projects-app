import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import Handlebars from 'handlebars';
import { getService, getHub, getCity } from './slug.js';
import { relatedProjects, listPublished } from './db.js';

const TEMPLATE_PATH = join(process.cwd(), 'templates', 'project-page.hbs');
let TEMPLATE_FN = null;
function getTemplate() {
  if (!TEMPLATE_FN) {
    const src = readFileSync(TEMPLATE_PATH, 'utf8');
    TEMPLATE_FN = Handlebars.compile(src, { noEscape: false });
  }
  return TEMPLATE_FN;
}

const SITE_ROOT = 'https://www.mywindowwashing.com';

function initialOf(name) {
  return (name || '?').trim().charAt(0).toUpperCase();
}

function monthYear(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// Build the JSON-LD @graph the SOP requires (Service, Breadcrumb,
// optionally Review, two ImageObjects). Stored as a raw string so the
// template emits it inside the <script> tag without HTML-escaping.
// The Review block is included only when we have BOTH a customer name
// and review body — Google rejects schema Review blocks missing
// either, so a URL-only "read on Google" entry doesn't qualify.
function buildSchema(p, service, city, hub) {
  const canonical = `${SITE_ROOT}/projects/${p.slug}`;
  const beforeUrl = `${SITE_ROOT}/projects/img/${p.slug}-before.webp`;
  const afterUrl  = `${SITE_ROOT}/projects/img/${p.slug}-after.webp`;
  const graph = [
    {
      '@type': 'Service',
      '@id': `${canonical}#service`,
      name: `${service.label} — ${city.name}, IL`,
      description: p.serviceDescription,
      provider: { '@id': hub.parentOrgUrl },
      areaServed: {
        '@type': 'City',
        name: city.name,
        containedInPlace: { '@type': 'State', name: 'Illinois' },
      },
      serviceType: service.schemaType,
      offers: { '@type': 'Offer', priceCurrency: 'USD', priceRange: '$140-$290' },
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home',     item: `${SITE_ROOT}/` },
        { '@type': 'ListItem', position: 2, name: 'Projects', item: `${SITE_ROOT}/projects/` },
        { '@type': 'ListItem', position: 3, name: `${service.label} — ${city.name}, IL`, item: canonical },
      ],
    },
  ];
  if (p.customer_name && p.review_text) {
    graph.push({
      '@type': 'Review',
      '@id': `${canonical}#review`,
      author:        { '@type': 'Person', name: p.customer_name },
      datePublished: p.review_date,
      reviewBody:    p.review_text,
      reviewRating:  { '@type': 'Rating', ratingValue: '5', bestRating: '5' },
      itemReviewed:  { '@id': hub.parentOrgUrl },
    });
  }
  graph.push(
    {
      '@type': 'ImageObject',
      name: `${service.label} before — ${city.name} IL ${p.home_type || ''}`.trim(),
      url: beforeUrl,
      description: p.beforeCaption,
    },
    {
      '@type': 'ImageObject',
      name: `${service.label} after — ${city.name} IL ${p.home_type || ''}`.trim(),
      url: afterUrl,
      description: p.afterCaption,
    },
  );
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 2);
}

// Detect Google vs Yelp from the URL so the "Read full review" button
// has the right label + brand color.
function reviewPlatform(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.host.toLowerCase();
    if (/(^|\.)google\./.test(host) || /goo\.gl|g\.page|maps\.app\.goo\.gl/.test(host)) return 'Google';
    if (/(^|\.)yelp\./.test(host) || /yelp\.to/.test(host)) return 'Yelp';
    return 'External';
  } catch { return null; }
}

// Map a project row → the {{view}} the Handlebars template expects.
function buildView(project, opts = {}) {
  const service = getService(project.service);
  // If the address city has its own spoke page, use the rich record
  // from cities.json (canonical name, lat/lng, etc.). Otherwise fall
  // back to the columns we stored on the project itself — the
  // resolver still picked a hub for it, so the page just won't have
  // a matching spoke to patch (which is correct behavior).
  const city = getCity(project.city_slug) || {
    slug: project.city_slug,
    name: project.city_name,
    hub:  project.hub,
  };
  const hub = getHub(project.hub);
  if (!service || !city || !hub) {
    throw new Error(`Missing service/city/hub: ${project.service}/${project.city_slug}/${project.hub}`);
  }

  const dateLabel  = monthYear(project.review_date);
  const metricVal  = project.metric_value || '';
  const metricLab  = project.metric_label || metricForService(service.value);
  const homeType   = project.home_type || 'Residential';

  const heroSub = opts.heroSub
    || `${service.label} at a ${homeType.toLowerCase()} in ${city.name}. ${metricVal ? metricVal + ' ' + metricLab.toLowerCase() + '. ' : ''}Completed by our ${hub.name} team.`;

  const beforeCaption = opts.beforeCaption
    || `${homeType} in ${city.name}, IL before ${service.label.toLowerCase()} — grime and buildup visible from typical seasonal exposure.`;
  const afterCaption = opts.afterCaption
    || `${homeType} in ${city.name}, IL after ${service.label.toLowerCase()} — completed by our ${hub.name} team, no mess left behind.`;
  const beforeAfterSub = opts.beforeAfterSub
    || (project.challenge || `Showing the home's condition before our team arrived, and the result after the ${service.label.toLowerCase()} was complete.`);

  const seoTitle = `${service.label} in ${city.name}, IL — ${dateLabel} Project | My Window Washing`;
  const seoDescBase = `${service.label} at a ${homeType.toLowerCase()} in ${city.name}, IL. ${metricVal ? metricVal + ' ' + metricLab.toLowerCase() + '. ' : ''}Completed ${dateLabel} by My Window Washing.`;
  const seoDesc = seoDescBase.length > 155 ? seoDescBase.slice(0, 152).trimEnd() + '...' : seoDescBase;

  // 3 related — fetched from DB if not provided. Pad with placeholders.
  const related = buildRelated(project);

  const footerRecent = buildFooterRecent(project);

  const view = {
    slug:      project.slug,
    service,
    city,
    hub,
    homeType,
    dateLabel,
    metric: {
      value:   metricVal,
      label:   metricLab,
      statBar: metricVal ? `${metricVal} ${shortStatVerb(service.value)}` : metricLab,
    },
    hooks: {
      serviceLevel: opts.serviceLevel || defaultServiceLevel(service.value),
    },
    heroSub,
    beforeAfterSub,
    beforeCaption,
    afterCaption,
    beforeAlt: `${service.label} before — ${city.name} IL ${homeType.toLowerCase()}`,
    afterAlt:  `${service.label} after — ${city.name} IL ${homeType.toLowerCase()}`,
    review: {
      hasText:     !!(project.customer_name && project.review_text),
      hasUrl:      !!project.review_url,
      hasAny:      !!(project.customer_name || project.review_text || project.review_url),
      text:        project.review_text,
      customerName: project.customer_name,
      initial:     initialOf(project.customer_name),
      url:         project.review_url,
      platform:    reviewPlatform(project.review_url),
    },
    // Kept for backwards-compat with anything that read these directly.
    reviewText:      project.review_text,
    customerName:    project.customer_name,
    customerInitial: initialOf(project.customer_name),
    narrativeParagraphs: parseNarrative(project.narrative),
    serviceTags: defaultServiceTags(service.value),
    related,
    footerRecent,
    map: buildMap(hub),
    // The optional extra photos. First one becomes the hero
    // background, all of them populate the in-page gallery section.
    gallery:   galleryFilenames(project),
    heroImage: galleryFilenames(project)[0] || null,
    seo: {
      title:         seoTitle,
      description:   seoDesc,
      ogDescription: seoDesc,
      canonical:     `${SITE_ROOT}/projects/${project.slug}`,
      ogImage:       `${SITE_ROOT}/projects/img/${project.slug}-after.webp`,
    },
  };

  // Schema JSON-LD wants a few extra strings derived above.
  view.schemaJson = buildSchema(
    { ...project, serviceDescription: heroSub, beforeCaption, afterCaption },
    service, city, hub
  );
  return view;
}

function shortStatVerb(serviceVal) {
  if (serviceVal === 'window-cleaning') return 'Cleaned';
  if (serviceVal === 'gutter-cleaning') return 'Ft Cleared';
  if (serviceVal === 'power-washing')   return 'Sq Ft Washed';
  return 'Completed';
}

function metricForService(serviceVal) {
  if (serviceVal === 'window-cleaning') return 'Windows Cleaned';
  if (serviceVal === 'gutter-cleaning') return 'Linear Feet';
  if (serviceVal === 'power-washing')   return 'Sq Ft Washed';
  if (serviceVal === 'solar-panel-cleaning') return 'Panels Cleaned';
  return 'Project Scope';
}

function defaultServiceLevel(serviceVal) {
  if (serviceVal === 'window-cleaning') return 'Interior & Exterior';
  if (serviceVal === 'gutter-cleaning') return 'Hand-Cleared & Flushed';
  if (serviceVal === 'power-washing')   return 'Soft & Pressure Wash';
  return '';
}

function defaultServiceTags(serviceVal) {
  if (serviceVal === 'window-cleaning') {
    return ['Interior Window Cleaning', 'Exterior Window Cleaning', 'Screen Washing & Replacement', 'Frame & Track Cleaning'];
  }
  if (serviceVal === 'gutter-cleaning') {
    return ['Gutter Hand-Clearing', 'Downspout Flushing', 'Debris Bagging & Removal', 'Photo Documentation'];
  }
  if (serviceVal === 'power-washing') {
    return ['Soft Washing', 'Driveway Cleaning', 'Siding Wash', 'Algae & Mildew Treatment'];
  }
  if (serviceVal === 'solar-panel-cleaning') {
    return ['Deionized Water Rinse', 'Soft-Brush Wash', 'Panel Inspection', 'Edge Detailing'];
  }
  return [];
}

// If the hub has a real Google Business Profile embed URL configured,
// use that (rich card with reviews + photos). Otherwise fall back to
// the Maps Embed API with the hub's address as a place query, which
// just shows a marker. Returns null when neither is possible — the
// template hides the section in that case.
function buildMap(hub) {
  if (hub.gbpEmbedUrl) {
    return { src: hub.gbpEmbedUrl, kind: 'gbp' };
  }
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key || !hub.mapEmbedQuery) return null;
  const q = encodeURIComponent(hub.mapEmbedQuery);
  return {
    src: `https://www.google.com/maps/embed/v1/place?key=${key}&q=${q}`,
    kind: 'embed',
  };
}

// Returns just the basenames so the template can produce relative
// `img/...` URLs that work from the /projects/ subfolder.
function galleryFilenames(project) {
  if (!project.extra_photos) return [];
  if (Array.isArray(project.extra_photos)) {
    return project.extra_photos.map(p => basename(p));
  }
  // Fallback: column is a JSON string (happens if a caller forgot to
  // pass through parseExtras). Try to parse.
  try {
    const arr = JSON.parse(project.extra_photos);
    return Array.isArray(arr) ? arr.map(p => basename(p)) : [];
  } catch { return []; }
}

function parseNarrative(raw) {
  if (!raw) return [];
  return raw.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
}

function buildRelated(project) {
  const rows = relatedProjects({
    excludeId: project.id || -1,
    citySlug:  project.city_slug,
    service:   project.service,
    limit:     3,
  });
  const out = rows.map(r => {
    const svc = getService(r.service);
    const city = getCity(r.city_slug);
    return {
      href:  r.slug,
      tag:   svc?.spokeTag || r.service,
      title: `${svc?.label || r.service} — ${city?.name || r.city_name}, IL`,
      meta:  monthYear(r.review_date) || 'Recent project',
    };
  });
  while (out.length < 3) {
    out.push({ href: '#', tag: 'Coming Soon', title: 'More projects coming soon', meta: 'Check back soon' });
  }
  return out;
}

// Footer "Recent Projects" column — 3 most recent across the whole site.
function buildFooterRecent(project) {
  const recent = listPublished({ limit: 3, excludeId: project.id || -1 });
  const items = recent.map(r => {
    const svc = getService(r.service);
    const city = getCity(r.city_slug);
    return { slug: r.slug, label: `${svc?.label || r.service} — ${city?.name || r.city_name}` };
  });
  // Top of the list: the page itself, mirroring the canonical template.
  items.unshift({
    slug: project.slug,
    label: `${getService(project.service)?.label} — ${getCity(project.city_slug)?.name}`,
  });
  return items.slice(0, 4);
}

export function renderProjectHtml(project, opts = {}) {
  const view = buildView(project, opts);
  return getTemplate()(view);
}

// Write the rendered project page into the static site repo. Returns
// the absolute file path that was written.
export function writeProjectPage(siteRepoPath, project, opts = {}) {
  const html = renderProjectHtml(project, opts);
  const outDir = join(siteRepoPath, 'projects');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${project.slug}.html`);
  writeFileSync(outPath, html, 'utf8');
  return outPath;
}
