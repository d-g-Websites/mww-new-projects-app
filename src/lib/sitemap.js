import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// SOP §10: project pages are added at priority 0.6, monthly changefreq,
// matching the existing single-line format already used in sitemap.xml.
// We append the new entry just before </urlset> so it shows up at the
// bottom — no need to interleave by section.

export function updateSitemap(siteRepoPath, project, isoDate) {
  const path = join(siteRepoPath, 'sitemap.xml');
  let xml = readFileSync(path, 'utf8');
  const loc = `https://www.mywindowwashing.com/projects/${project.slug}`;

  // If this URL is already present, just refresh the lastmod date.
  const existingRe = new RegExp(
    `<url>\\s*<loc>${escapeRegex(loc)}</loc>[\\s\\S]*?</url>`,
    'i'
  );
  const entry = `<url><loc>${loc}</loc><lastmod>${isoDate}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>`;

  if (existingRe.test(xml)) {
    xml = xml.replace(existingRe, entry);
  } else {
    xml = xml.replace(
      /<\/urlset>\s*$/,
      `  ${entry}\n\n</urlset>\n`
    );
  }
  writeFileSync(path, xml, 'utf8');
  return loc;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Refresh (or append) entries for each archive URL. Archive pages are
// page-level aggregators, so they sit at priority 0.7 — above project
// pages (0.6) but below spoke pages (0.8). Idempotent: existing
// entries have their lastmod updated, new ones get appended.
export function updateSitemapArchives(siteRepoPath, paths, isoDate) {
  const file = join(siteRepoPath, 'sitemap.xml');
  let xml = readFileSync(file, 'utf8');
  for (const path of paths) {
    const url = `https://www.mywindowwashing.com${path.startsWith('/') ? path : '/' + path}`;
    const entry = `<url><loc>${url}</loc><lastmod>${isoDate}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`;
    const existingRe = new RegExp(
      `<url>\\s*<loc>${escapeRegex(url)}</loc>[\\s\\S]*?</url>`,
      'i'
    );
    if (existingRe.test(xml)) {
      xml = xml.replace(existingRe, entry);
    } else {
      xml = xml.replace(/<\/urlset>\s*$/, `  ${entry}\n\n</urlset>\n`);
    }
  }
  writeFileSync(file, xml, 'utf8');
}
