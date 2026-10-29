import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

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

// Strip a project URL from sitemap.xml entirely — used when an
// admin deletes a published project. The whole <url>...</url> block
// for that loc gets removed, leaving the rest of the sitemap intact.
export function removeFromSitemap(siteRepoPath, project) {
  const path = join(siteRepoPath, 'sitemap.xml');
  let xml = readFileSync(path, 'utf8');
  const loc = `https://www.mywindowwashing.com/projects/${project.slug}`;
  const re = new RegExp(
    `\\s*<url>\\s*<loc>${escapeRegex(loc)}</loc>[\\s\\S]*?</url>`,
    'gi'
  );
  xml = xml.replace(re, '');
  writeFileSync(path, xml, 'utf8');
}

// Site URL for a file in the site repo: projects/index.html → /projects/,
// projects/glenview.html → /projects/glenview, glenview.html → /glenview.
export function urlForSiteFile(siteRepoPath, absPath) {
  const rel = relative(siteRepoPath, absPath).split(sep).join('/');
  const path = rel.endsWith('index.html') ? rel.slice(0, -'index.html'.length) : rel.replace(/\.html$/, '');
  return `/${path}`;
}

// Refresh (or append) entries for each archive URL. Pass only the
// archives this publish actually rewrote: lastmod has to mean "this
// page changed", or Google stops trusting it for the whole sitemap.
// Archive pages are page-level aggregators, so new ones sit at
// priority 0.7 — above project pages (0.6) but below spoke pages (0.8).
// Existing entries keep their changefreq/priority; only lastmod moves.
export function updateSitemapArchives(siteRepoPath, paths, isoDate) {
  const file = join(siteRepoPath, 'sitemap.xml');
  let xml = readFileSync(file, 'utf8');
  for (const path of paths) {
    const url = `https://www.mywindowwashing.com${path.startsWith('/') ? path : '/' + path}`;
    const touched = touchLastmod(xml, url, isoDate);
    if (touched !== null) {
      xml = touched;
    } else {
      const entry = `<url><loc>${url}</loc><lastmod>${isoDate}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`;
      xml = xml.replace(/<\/urlset>\s*$/, `  ${entry}\n\n</urlset>\n`);
    }
  }
  writeFileSync(file, xml, 'utf8');
}

// Bump lastmod on pages already listed (e.g. the spoke page that just
// gained or lost a Recent Projects tile). Never adds entries.
export function touchSitemapLastmod(siteRepoPath, paths, isoDate) {
  const file = join(siteRepoPath, 'sitemap.xml');
  let xml = readFileSync(file, 'utf8');
  for (const path of paths) {
    const url = `https://www.mywindowwashing.com${path.startsWith('/') ? path : '/' + path}`;
    xml = touchLastmod(xml, url, isoDate) ?? xml;
  }
  writeFileSync(file, xml, 'utf8');
}

// Drop entries for pages that no longer exist (an archive emptied by
// a delete).
export function removeSitemapUrls(siteRepoPath, paths) {
  const file = join(siteRepoPath, 'sitemap.xml');
  let xml = readFileSync(file, 'utf8');
  for (const path of paths) {
    const url = `https://www.mywindowwashing.com${path.startsWith('/') ? path : '/' + path}`;
    xml = xml.replace(new RegExp(`\\s*<url>\\s*<loc>${escapeRegex(url)}</loc>[\\s\\S]*?</url>`, 'gi'), '');
  }
  writeFileSync(file, xml, 'utf8');
}

// Returns the xml with this url's lastmod set, or null if it isn't listed.
function touchLastmod(xml, url, isoDate) {
  const re = new RegExp(`<url>\\s*<loc>${escapeRegex(url)}</loc>[\\s\\S]*?</url>`, 'i');
  const m = xml.match(re);
  if (!m) return null;
  const block = /<lastmod>[^<]*<\/lastmod>/.test(m[0])
    ? m[0].replace(/<lastmod>[^<]*<\/lastmod>/, `<lastmod>${isoDate}</lastmod>`)
    : m[0].replace('</loc>', `</loc><lastmod>${isoDate}</lastmod>`);
  return xml.replace(m[0], () => block);
}
