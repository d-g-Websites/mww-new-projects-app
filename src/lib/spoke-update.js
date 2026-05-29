import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as cheerio from 'cheerio';
import { getService } from './slug.js';

// Update the spoke page's "Recent Projects" tile block and footer
// "Recent Projects" list. Strategy from the handoff:
//   1. Inside .project-cards, find the FIRST .project-card whose tag
//      matches the new project's service AND whose body still says
//      "Coming soon" — replace it with a real tile linking to the new
//      page.
//   2. If none match, prepend a new card and drop the oldest of 3.
//   3. Also append the project to the footer column "Recent Projects".

export function updateSpokePage(siteRepoPath, citySlug, project) {
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
