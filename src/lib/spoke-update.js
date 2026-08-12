import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as cheerio from 'cheerio';
import { getService, getCity } from './slug.js';

// Update the spoke page's "Recent Projects" tile block and footer
// "Recent Projects" list. Strategy from the handoff:
//   1. Inside .project-cards, find the FIRST .project-card whose tag
//      matches the new project's service AND whose body still says
//      "Coming soon" — replace it with a real tile linking to the new
//      page.
//   2. If none match, prepend a new card and drop the oldest of 3.
//   3. Also append the project to the footer column "Recent Projects".

export function updateSpokePage(siteRepoPath, citySlug, project, opts = {}) {
  const spokePath = join(siteRepoPath, `${citySlug}.html`);
  if (!existsSync(spokePath)) {
    return { skipped: true, reason: `no spoke page at ${spokePath}` };
  }
  const html = readFileSync(spokePath, 'utf8');
  // Use loadBuffer/xmlMode:false; preserve as much of original markup as
  // possible (no decodeEntities munging on hrefs etc.).
  const $ = cheerio.load(html, { decodeEntities: false });

  const service = getService(project.service);
  const tagText = service?.spokeTag || project.service_label;
  const projectHref = `projects/${project.slug}`;
  const archiveHref = `projects/${citySlug}`;

  const cards = $('.project-cards .project-card');
  if (cards.length === 0) {
    return { skipped: true, reason: 'no .project-cards section' };
  }

  let replacedIndex = -1;
  cards.each((i, el) => {
    if (replacedIndex !== -1) return;
    const $el = $(el);
    const cardTag = $el.find('.project-card-tag').first().text().trim();
    const isComingSoon = /coming soon/i.test($el.text());
    if (cardTag.toLowerCase() === tagText.toLowerCase() && isComingSoon) {
      $el.replaceWith(renderCard(project, service, projectHref));
      replacedIndex = i;
    }
  });

  if (replacedIndex === -1) {
    // No matching placeholder. Prepend a new tile, drop the oldest of 3.
    $('.project-cards').prepend(renderCard(project, service, projectHref));
    const all = $('.project-cards .project-card');
    if (all.length > 3) {
      all.last().remove();
    }
  }

  // Insert or refresh the "View all N projects in [City] →" link
  // below the tile grid. Always present so older projects displaced
  // from the tile grid stay reachable, and so the per-spoke archive
  // gets an internal link from the spoke page itself.
  const cityName = (project.city_name || resolveCityName(citySlug));
  const count    = opts.projectCount ?? 0;
  injectViewAllLink($, citySlug, cityName, count);

  // Footer "Recent Projects" column — find the <ul> following the
  // <h4>Recent Projects</h4> header and prepend a list item (after the
  // "All Projects" entry if present).
  $('.lp-footer-col h4').each((_, h) => {
    const $h = $(h);
    if ($h.text().trim().toLowerCase() === 'recent projects') {
      const $ul = $h.next('ul');
      if (!$ul.length) return;
      const label = `${service?.label || project.service_label} — ${project.city_name}`;
      const newLi = `<li><a href="${projectHref}">${escapeHtml(label)}</a></li>`;
      // Insert after the "All Projects" item if it exists, else at top.
      const $first = $ul.children('li').first();
      if ($first.length && /all projects/i.test($first.text())) {
        $first.after(newLi);
      } else {
        $ul.prepend(newLi);
      }
      // Keep the column to 4 items max (All Projects + 3 recent).
      const lis = $ul.children('li');
      if (lis.length > 4) lis.slice(4).remove();
    }
  });

  writeFileSync(spokePath, $.html(), 'utf8');
  return { skipped: false, replacedIndex };
}

// Reverse of updateSpokePage — used when an admin deletes a
// published project. Strips the tile from .project-cards, removes
// the footer Recent Projects entry, and refreshes the
// 'View all N projects' link with the lower count.
export function unpublishFromSpoke(siteRepoPath, citySlug, projectSlug, newProjectCount) {
  const spokePath = join(siteRepoPath, `${citySlug}.html`);
  if (!existsSync(spokePath)) {
    return { skipped: true, reason: `no spoke page at ${spokePath}` };
  }
  const html = readFileSync(spokePath, 'utf8');
  const $ = cheerio.load(html, { decodeEntities: false });
  const projectHref = `projects/${projectSlug}`;

  // Remove the project-card tile linking to this project.
  let tilesRemoved = 0;
  $('.project-cards .project-card').each((_, el) => {
    const $el = $(el);
    // Anchor may be the .project-card itself or a child
    const href = $el.attr('href') || $el.find('a').first().attr('href');
    if (href === projectHref) {
      $el.remove();
      tilesRemoved++;
    }
  });

  // Remove footer "Recent Projects" list entry linking to this project.
  $('.lp-footer-col h4').each((_, h) => {
    const $h = $(h);
    if ($h.text().trim().toLowerCase() === 'recent projects') {
      const $ul = $h.next('ul');
      if (!$ul.length) return;
      $ul.find(`a[href="${projectHref}"]`).closest('li').remove();
    }
  });

  // Refresh the 'View all' link with the new count.
  if ($('.project-cards').length) {
    injectViewAllLink($, citySlug, resolveCityName(citySlug), newProjectCount);
  }

  writeFileSync(spokePath, $.html(), 'utf8');
  return { updated: true, tilesRemoved, newProjectCount };
}

// Standalone "View all" link refresher — runs without touching the
// tile grid or the footer column. Used by the sync-spoke-view-all
// script to backfill spoke pages that have never received a project
// publish (where the link wouldn't otherwise be present).
export function updateSpokeViewAllOnly(siteRepoPath, citySlug, projectCount) {
  const spokePath = join(siteRepoPath, `${citySlug}.html`);
  if (!existsSync(spokePath)) {
    return { skipped: true, reason: `no spoke page at ${spokePath}` };
  }
  const html = readFileSync(spokePath, 'utf8');
  const $ = cheerio.load(html, { decodeEntities: false });
  if ($('.project-cards').length === 0) {
    return { skipped: true, reason: 'no .project-cards section' };
  }
  const cityName = resolveCityName(citySlug);
  injectViewAllLink($, citySlug, cityName, projectCount);
  const next = $.html();
  if (next === html) return { skipped: true, reason: 'unchanged' };
  writeFileSync(spokePath, next, 'utf8');
  return { updated: true, projectCount, cityName };
}

function resolveCityName(citySlug) {
  const known = getCity(citySlug);
  return known?.name || titleCase(citySlug);
}

// Render + insert/replace the "View all" link block. When projectCount
// is 0 (spoke has nothing in the dashboard yet), point at the master
// archive instead of the per-spoke archive page (which doesn't exist
// when there are no projects to populate it).
function injectViewAllLink($, citySlug, cityName, count) {
  const href  = count > 0 ? `projects/${citySlug}` : `projects/`;
  const label = count > 0
    ? `View all ${count} completed project${count === 1 ? '' : 's'} in ${cityName}`
    : `Browse all our completed projects`;
  const html = `
    <div class="projects-view-all" style="margin-top:24px;text-align:center;">
      <a href="${escapeAttr(href)}" style="display:inline-flex;align-items:center;gap:8px;font-size:15px;font-weight:700;color:#133047;text-decoration:none;padding:10px 22px;border:2px solid #133047;border-radius:8px;transition:background .15s,color .15s;"
         onmouseover="this.style.background='#133047';this.style.color='#fff';"
         onmouseout="this.style.background='';this.style.color='#133047';">
        ${escapeHtml(label)}
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      </a>
    </div>`;
  const $existing = $('.project-cards').nextAll('.projects-view-all').first();
  if ($existing.length) {
    $existing.replaceWith(html);
  } else {
    $('.project-cards').after(html);
  }
}

function renderCard(project, service, href) {
  const tag = service?.spokeTag || project.service_label;
  const title = `${service?.label || project.service_label} Project — ${project.city_name}, IL`;
  const desc  = project.heroSub
    || `${service?.label || ''} at a ${(project.home_type || 'home').toLowerCase()} in ${project.city_name}. See the full project page for photos and details.`;
  const imgPath = `projects/img/${project.slug}-after.webp`;
  return `
      <a href="${href}" class="project-card" style="text-decoration:none;color:inherit;">
        <img src="${imgPath}" alt="${escapeAttr(title)}" class="project-card-img" style="width:100%;height:200px;object-fit:cover;display:block;">
        <div class="project-card-body">
          <span class="project-card-tag">${escapeHtml(tag)}</span>
          <h3 class="project-card-title">${escapeHtml(title)}</h3>
          <p class="project-card-desc">${escapeHtml(desc)}</p>
          <span class="project-card-coming" style="color:#4caf50;">View project →</span>
        </div>
      </a>`;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}
function titleCase(slug) {
  return String(slug).split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}
