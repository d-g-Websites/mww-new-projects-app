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
