import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { writeProjectPage } from '../lib/render.js';
import { updateSpokePage } from '../lib/spoke-update.js';
import { updateSitemap } from '../lib/sitemap.js';
import { commitAndPush } from '../lib/git.js';
import { markPublished } from '../lib/db.js';

// Run the four side-effects in order:
//   1. Write projects/<slug>.html
//   2. Move staged before/after webps into projects/img/
//   3. Patch the matching spoke page (tile + footer)
//   4. Patch sitemap.xml
//   5. Commit + push to the deploy branch
// Then flip the DB row to status=published.
export async function publishProject(project) {
  const siteRepo = process.env.SITE_REPO_PATH;
  const branch   = process.env.SITE_REPO_BRANCH || 'master';
  const pushFlag = process.env.SITE_REPO_PUSH !== 'false';
  if (!siteRepo) throw new Error('SITE_REPO_PATH is not set');

  const imgDir = join(siteRepo, 'projects', 'img');
  mkdirSync(imgDir, { recursive: true });

  // 1. Render and write the project HTML.
  const projectPath = writeProjectPage(siteRepo, project);

  // 2. Copy the resized webps into projects/img/.
  const beforeDest = join(imgDir, `${project.slug}-before.webp`);
  const afterDest  = join(imgDir, `${project.slug}-after.webp`);
  if (project.before_photo && existsSync(project.before_photo)) {
    copyFileSync(project.before_photo, beforeDest);
  }
  if (project.after_photo && existsSync(project.after_photo)) {
    copyFileSync(project.after_photo, afterDest);
  }

  // 3. Patch the matching spoke page.
  const spokeResult = updateSpokePage(siteRepo, project.city_slug, project);
  const spokePath = join(siteRepo, `${project.city_slug}.html`);

  // 4. Patch sitemap.xml.
  const today = new Date().toISOString().slice(0, 10);
  updateSitemap(siteRepo, project, today);
  const sitemapPath = join(siteRepo, 'sitemap.xml');

  // 5. Stage and commit. Paths are relative to the repo root for git.
  const files = [
    relTo(siteRepo, projectPath),
    relTo(siteRepo, beforeDest),
    relTo(siteRepo, afterDest),
    relTo(siteRepo, sitemapPath),
  ];
  if (!spokeResult.skipped) files.push(relTo(siteRepo, spokePath));

  const message = `Add project: ${project.slug}`;
  const git = await commitAndPush({
    siteRepoPath: siteRepo,
    branch,
    files,
    message,
    push: pushFlag,
  });

  markPublished(project.id);

  return {
    projectPath:  basename(projectPath),
    spoke:        spokeResult,
    sitemapDate:  today,
    git,
    pushed:       pushFlag,
  };
}

function relTo(repo, abs) {
  return abs.startsWith(repo) ? abs.slice(repo.length + 1) : abs;
}
