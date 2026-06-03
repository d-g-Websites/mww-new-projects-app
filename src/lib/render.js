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

// Build the JSON-LD @graph for a project page. Project pages are
// leaf documentation — one instance of a Service delivered by a
// LocalBusiness in a Place — so the graph is organized as:
//
//   WebPage (the page itself)
//     ├─ BreadcrumbList
//     ├─ Article (narrative + photos)  ← mainEntity
//     │   ├─ about → Service instance
//     │   ├─ image → ImageObjects
//     │   └─ author/publisher → hub LocalBusiness (defined on hub page)
//     ├─ Service instance (thin — provider + areaServed)
//     ├─ Review (only when both name + text present) → itemReviewed = Service
//     └─ ImageObjects (before/after + any extras)
//
// Review.itemReviewed points at the Service instance, NOT the
// LocalBusiness, so per-project 5-star reviews don't artificially
// inflate the hub's aggregateRating across dozens of project pages.
function buildSchema(p, service, city, hub) {
  const canonical = `${SITE_ROOT}/projects/${p.slug}`;
  const beforeUrl = `${SITE_ROOT}/projects/img/${p.slug}-before.webp`;
  const afterUrl  = `${SITE_ROOT}/projects/img/${p.slug}-after.webp`;
  const extraUrls = (p.galleryFilenames || []).map(fn => `${SITE_ROOT}/projects/img/${fn}`);

  const webpageId  = `${canonical}#webpage`;
  const articleId  = `${canonical}#article`;
  const serviceId  = `${canonical}#service-instance`;
  const beforeId   = `${canonical}#before-image`;
  const afterId    = `${canonical}#after-image`;
  const videoId    = `${canonical}#video`;
  const breadcrumbId = `${canonical}#breadcrumb`;
  const dateISO    = p.review_date || new Date().toISOString().slice(0, 10);
  const hasVideo   = !!(p.video && p.video.src);

  const imageRefs = [
    { '@id': beforeId },
    { '@id': afterId },
    ...extraUrls.map((_, i) => ({ '@id': `${canonical}#extra-${i + 1}-image` })),
  ];

  const graph = [
    {
      '@type': 'WebPage',
      '@id':   webpageId,
      url:     canonical,
      name:    p.seoTitle || `${service.label} in ${city.name}, IL`,
      description: p.seoDescription || p.serviceDescription,
      datePublished: dateISO,
      dateModified:  dateISO,
      inLanguage: 'en-US',
      isPartOf:           { '@id': `${SITE_ROOT}#website` },
      breadcrumb:         { '@id': breadcrumbId },
      primaryImageOfPage: { '@id': afterId },
      mainEntity:         { '@id': articleId },
    },
    {
      '@type': 'BreadcrumbList',
      '@id':   breadcrumbId,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home',     item: `${SITE_ROOT}/` },
        { '@type': 'ListItem', position: 2, name: 'Projects', item: `${SITE_ROOT}/projects/` },
        { '@type': 'ListItem', position: 3, name: `${service.label} — ${city.name}, IL`, item: canonical },
      ],
    },
    {
      '@type': 'Article',
      '@id':   articleId,
      headline:    `${service.label} in ${city.name}, IL${p.dateLabel ? ` — ${p.dateLabel}` : ''}`,
      description: p.serviceDescription,
      datePublished: dateISO,
      dateModified:  dateISO,
      image:     imageRefs,
      ...(hasVideo ? { video: { '@id': videoId } } : {}),
      articleBody: (p.narrative || '').replace(/\s+/g, ' ').trim(),
      author:    { '@id': hub.parentOrgUrl },
      publisher: { '@id': hub.parentOrgUrl },
      mainEntityOfPage: { '@id': webpageId },
      about:     { '@id': serviceId },
      locationCreated: {
        '@type': 'Place',
        address: {
          '@type': 'PostalAddress',
          addressLocality: city.name,
          addressRegion:   'IL',
          addressCountry:  'US',
        },
      },
    },
    {
      '@type': 'Service',
      '@id':   serviceId,
      name:        service.label,
      serviceType: service.schemaType,
      description: p.serviceDescription,
      provider:    { '@id': hub.parentOrgUrl },
      areaServed: {
        '@type': 'City',
        name: city.name,
        containedInPlace: { '@type': 'State', name: 'Illinois' },
      },
    },
    {
      '@type': 'ImageObject',
      '@id':   beforeId,
      url:        beforeUrl,
      contentUrl: beforeUrl,
      caption:    p.beforeCaption,
      width:  1200,
      height: 800,
    },
    {
      '@type': 'ImageObject',
      '@id':   afterId,
      url:        afterUrl,
      contentUrl: afterUrl,
      caption:    p.afterCaption,
      width:  1200,
      height: 800,
    },
    ...extraUrls.map((u, i) => ({
      '@type': 'ImageObject',
      '@id':   `${canonical}#extra-${i + 1}-image`,
      url:        u,
      contentUrl: u,
      caption:    `${service.label} project photo — ${city.name}, IL`,
      width:  1200,
      height: 800,
    })),
  ];

  if (hasVideo) {
    const videoBlock = {
      '@type': 'VideoObject',
      '@id':   videoId,
      name:    `${service.label} project video — ${city.name}, IL`,
      description: p.video.descriptionText || p.serviceDescription,
      uploadDate: dateISO,
      embedUrl:    p.video.src,
      contentUrl:  p.video.contentUrl || p.video.src,
      publisher:   { '@id': hub.parentOrgUrl },
    };
    // YouTube exposes a predictable thumbnail URL; Vimeo doesn't, so
    // we fall back to the project's after-image when no platform
    // thumbnail is available — gives Google a frame to use either way.
    videoBlock.thumbnailUrl = p.video.thumbnailUrl || afterUrl;
    graph.push(videoBlock);
  }

  if (p.customer_name && p.review_text) {
    graph.push({
      '@type': 'Review',
      '@id':   `${canonical}#review`,
      itemReviewed:  { '@id': serviceId },
      author:        { '@type': 'Person', name: p.customer_name },
      datePublished: dateISO,
      reviewBody:    p.review_text,
      reviewRating:  { '@type': 'Rating', ratingValue: '5', bestRating: '5' },
    });
  }

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
  const streetPart = project.street ? ` on ${project.street}` : '';

  const heroSub = opts.heroSub
    || `${service.label} at a ${homeType.toLowerCase()} in ${city.name}${streetPart}. ${metricVal ? metricVal + ' ' + metricLab.toLowerCase() + '. ' : ''}Completed by our ${hub.name} team.`;

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
    // Surface the window-cleaning service type ("In & Out" / "Out
    // Only") next to the metric pill + in the stats bar. Empty for
    // other services until they grow their own form extras.
    serviceTypeLabel: (project.extras && project.extras.serviceType) || '',
    priceLabel:       formatPriceLabel(project.price),
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
    serviceTags: scopeTagsFor(service.value, project.extras || {}),
    related,
    footerRecent,
    map: buildMap(hub),
    video: buildVideo(project, service, city, hub, homeType, metricVal, metricLab),
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
    {
      ...project,
      serviceDescription: heroSub,
      beforeCaption,
      afterCaption,
      narrative: project.narrative,
      galleryFilenames: view.gallery,
      dateLabel,
      seoTitle:       view.seo.title,
      seoDescription: view.seo.description,
      video:          view.video,
    },
    service, city, hub
  );
  return view;
}

function shortStatVerb(serviceVal) {
  if (serviceVal === 'window-cleaning') return 'Cleaned';
  if (serviceVal === 'gutter-cleaning') return 'Sq Ft';
  if (serviceVal === 'power-washing')   return 'Sq Ft Washed';
  return 'Completed';
}

function metricForService(serviceVal) {
  if (serviceVal === 'window-cleaning') return 'Windows Cleaned';
  if (serviceVal === 'gutter-cleaning') return 'Sq Ft';
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

// Window-cleaning gets its Scope of Work built from the actual extras
// the tech ticked on the form — interior/exterior, the window types
// present, and counted items like screens, storm windows, skylights,
// window wells. Other services still use static defaults until they
// grow their own service-specific form.
function scopeTagsFor(serviceVal, extras) {
  if (serviceVal === 'window-cleaning') return windowScopeTags(extras);
  if (serviceVal === 'gutter-cleaning') return gutterScopeTags(extras);
  // Power-washing starts as a clone of window-cleaning's logic until
  // we tailor its form (surface types, soft-vs-pressure split, etc.).
  if (serviceVal === 'power-washing')   return windowScopeTags(extras);
  if (serviceVal === 'solar-panel-cleaning') {
    return ['Deionized Water Rinse', 'Soft-Brush Wash', 'Panel Inspection', 'Edge Detailing'];
  }
  return [];
}

function gutterScopeTags(extras = {}) {
  const tags = [];
  // The chosen service type drives the lead tag.
  if (extras.serviceType === 'Repair') {
    tags.push('Gutter Repair');
  } else if (extras.serviceType === 'Gutter Guard Installation') {
    tags.push('Gutter Guard Installation');
  } else {
    // Cleaning (default) — always includes hand-clearing + downspout flush.
    tags.push('Gutter Hand-Clearing', 'Downspout Flushing');
  }
  if (extras.gutterGuards)     tags.push('Gutter Guards');
  if (extras.roofCleaning)     tags.push('Roof Cleaning');
  if (extras.gutterRepairs) {
    tags.push('Gutter Repairs');
    if (Array.isArray(extras.gutterRepairTypes)) {
      for (const t of extras.gutterRepairTypes) tags.push(t);
    }
  }
  if (extras.extraWideGutters) tags.push('Extra-Wide Gutter Cleaning');
  if (extras.cloggedElbows)    tags.push('Clogged Elbow Clearing');
  if (extras.undergroundClogs) tags.push('Underground Clog Clearing');
  return tags;
}

function windowScopeTags(extras = {}) {
  const tags = [];
  // Service type → which side(s) of the glass we cleaned.
  const st = extras.serviceType;
  if (st === 'Out Only') {
    tags.push('Exterior Window Cleaning');
  } else {
    // Default to both when serviceType is missing (older drafts) or 'In & Out'.
    tags.push('Interior Window Cleaning', 'Exterior Window Cleaning');
  }
  // Window types present.
  if (Array.isArray(extras.windowTypes)) {
    for (const wt of extras.windowTypes) {
      tags.push(`${wt} Windows`);
    }
  }
  // Counted extras. Skip anything that's 0 / missing.
  if (extras.screens)      tags.push(`${extras.screens} ${plur(extras.screens, 'Screen')} Cleaned`);
  if (extras.stormWindows) tags.push(`${extras.stormWindows} ${plur(extras.stormWindows, 'Storm Window')} Cleaned`);
  if (extras.skylights)    tags.push(`${extras.skylights} ${plur(extras.skylights, 'Skylight')} Cleaned`);
  if (extras.windowWells)  tags.push(`${extras.windowWells} ${plur(extras.windowWells, 'Window Well')} Cleaned`);
  if (extras.tracksFrames) tags.push('Tracks & Frames Cleaned');
  return tags;
}

function plur(n, singular) {
  return n === 1 ? singular : `${singular}s`;
}

// Normalize a YouTube / Vimeo URL to its iframe-embed form. Returns
// null for anything we don't recognize so the section stays hidden
// rather than embedding a broken iframe. Also returns the platform's
// stable video id (when we can extract one) so VideoObject schema can
// reference a thumbnail URL.
function videoEmbed(rawUrl) {
  if (!rawUrl) return null;
  let u;
  try { u = new URL(rawUrl); } catch { return null; }
  const host = u.host.toLowerCase();

  if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
    if (u.pathname === '/watch') {
      const id = u.searchParams.get('v');
      return id ? ytEmbed(id) : null;
    }
    if (u.pathname.startsWith('/shorts/')) {
      const id = u.pathname.replace('/shorts/', '').split('/')[0];
      return id ? ytEmbed(id) : null;
    }
    if (u.pathname.startsWith('/embed/')) {
      const id = u.pathname.replace('/embed/', '').split('/')[0];
      return ytEmbed(id, u.toString());
    }
  }
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1).split('/')[0];
    return id ? ytEmbed(id) : null;
  }
  if (host.endsWith('vimeo.com') && host !== 'player.vimeo.com') {
    const m = u.pathname.match(/^\/(\d+)/);
    return m ? vimeoEmbed(m[1]) : null;
  }
  if (host === 'player.vimeo.com') {
    const m = u.pathname.match(/^\/video\/(\d+)/);
    return m ? vimeoEmbed(m[1], u.toString()) : null;
  }
  return null;
}

function ytEmbed(id, srcOverride) {
  return {
    platform: 'YouTube',
    videoId:  id,
    src:      srcOverride || `https://www.youtube.com/embed/${id}`,
    // YouTube's maxresdefault is the highest-quality thumbnail; falls
    // back to hqdefault if the channel didn't upload a HD frame.
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
    contentUrl:   `https://www.youtube.com/watch?v=${id}`,
  };
}
function vimeoEmbed(id, srcOverride) {
  return {
    platform: 'Vimeo',
    videoId:  id,
    src:      srcOverride || `https://player.vimeo.com/video/${id}`,
    // Vimeo thumbnail URLs aren't directly derivable without an
    // oEmbed call; leave undefined and let the VideoObject omit it.
    thumbnailUrl: null,
    contentUrl:   `https://vimeo.com/${id}`,
  };
}

// Compose the video section's view data: embed + right-column copy.
// The copy uses the project's own facts so each page reads
// specifically rather than generically.
function buildVideo(project, service, city, hub, homeType, metricVal, metricLab) {
  const embed = videoEmbed(project.video_url);
  if (!embed) return null;
  const lines = [];
  lines.push(`Our ${hub.name} crew filmed this ${service.label.toLowerCase()} on site at a ${homeType.toLowerCase()} in ${city.name}, IL.`);
  if (metricVal && metricLab) {
    lines.push(`You'll see the workflow across all ${metricVal} ${metricLab.toLowerCase()} — interior and exterior approach, screen and frame detail, the rhythm of how we work through a property like this without leaving a mess.`);
  } else {
    lines.push(`The clip walks through how we approached the property — equipment setup, method on each side of the glass, and the tidy-up at the end.`);
  }
  return {
    src: embed.src,
    platform: embed.platform,
    heading: 'See the Work',
    body: lines,
    // Forward the bits VideoObject schema needs.
    videoId:      embed.videoId,
    thumbnailUrl: embed.thumbnailUrl,
    contentUrl:   embed.contentUrl,
    descriptionText: lines.join(' '),
  };
}

// Normalize the price string the tech typed: accept "$290", "290",
// "290.00" → render as "$290". Empty / non-numeric → empty so the
// template hides the price element.
function formatPriceLabel(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (s.startsWith('$')) return s;
  if (/^\d+(\.\d+)?$/.test(s)) return `$${s}`;
  return s;
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
