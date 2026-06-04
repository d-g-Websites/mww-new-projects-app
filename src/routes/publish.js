import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { writeProjectPage } from '../lib/render.js';
import { updateSpokePage } from '../lib/spoke-update.js';
import { updateSitemap, updateSitemapArchives } from '../lib/sitemap.js';
import { commitAndPush, syncSiteRepo } from '../lib/git.js';
import { markPublished, getProject, listPublishedBySpoke } from '../lib/db.js';
import { writeAffectedArchives, currentArchiveUrls } from '../lib/archive.js';

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

  // 0. Sync the local clone to origin so spoke + sitemap patches are
  //    based on the latest published state, not whatever's been
  //    sitting on the VPS since last publish.
  await syncSiteRepo({ siteRepoPath: siteRepo, branch });

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

  // Plus any optional gallery photos. Stored as an array of staged
  // paths; copy each to projects/img/ under the same basename.
  const extraDests = [];
  const extraPaths = Array.isArray(project.extra_photos) ? project.extra_photos : [];
  for (const p of extraPaths) {
    if (p && existsSync(p)) {
      const dest = join(imgDir, basename(p));
      copyFileSync(p, dest);
      extraDests.push(dest);
    }
  }

  // 3. Mark published in DB BEFORE archive regeneration so the new
  //    project is included in listPublishedAll() / -BySpoke() / -ByService()
  //    queries that the archive pages build from. Slight ordering wart
  //    (we mark published before the git push completes), but the
  //    push itself is idempotent — if it fails we revert below.
  markPublished(project.id);

  // 4. Patch the matching spoke page. spoke_slug is what
  //    resolveCityFromLocality picked as the nearest spoke — equals
  //    city_slug when the city is itself a spoke, but differs when
  //    the city has no spoke page (e.g. Romeoville → Lemont). Fall
  //    back to city_slug for drafts created before spoke_slug existed.
  const spokeToPatch = project.spoke_slug || project.city_slug;
  const freshProject = getProject(project.id);
  // Count of published projects for this spoke — used to build the
  // "View all N completed projects in [City] →" footer link on the
  // spoke's Recent Projects section.
  const spokeProjectCount = listPublishedBySpoke(spokeToPatch).length;
  const spokeResult = updateSpokePage(siteRepo, spokeToPatch, freshProject, {
    projectCount: spokeProjectCount,
  });
  const spokePath = join(siteRepo, `${spokeToPatch}.html`);

  // 5. Regenerate the master + service + spoke archive pages so the
  //    new project shows up everywhere it belongs and the oldest
  //    truncated from the spoke tile grid still has a home.
  const archivePaths = writeAffectedArchives(siteRepo, freshProject);

  // 6. Patch sitemap.xml — both the new project's URL and the
  //    archive URLs (some of which may be new this publish).
  const today = new Date().toISOString().slice(0, 10);
  updateSitemap(siteRepo, project, today);
  updateSitemapArchives(siteRepo, currentArchiveUrls(), today);
  const sitemapPath = join(siteRepo, 'sitemap.xml');

  // 7. Stage and commit. Paths are relative to the repo root for git.
  const files = [
    relTo(siteRepo, projectPath),
    relTo(siteRepo, beforeDest),
    relTo(siteRepo, afterDest),
    relTo(siteRepo, sitemapPath),
    ...extraDests.map(d => relTo(siteRepo, d)),
    ...archivePaths.map(p => relTo(siteRepo, p)),
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

  return {
    projectPath:  basename(projectPath),
    spoke:        spokeResult,
    archives:     archivePaths.map(p => basename(p)),
    sitemapDate:  today,
    git,
    pushed:       pushFlag,
  };
}

function relTo(repo, abs) {
  return abs.startsWith(repo) ? abs.slice(repo.length + 1) : abs;
}

// Re-render + re-publish an already-published project after an admin
// edit. Same pipeline as publishProject minus two things:
//   - no spoke-page tile patch (tile is already there from the
//     original publish; re-patching would prepend a duplicate)
//   - no markPublished (status is already 'published' and we want to
//     preserve the original published_at)
// Newly uploaded photos (passed as { before, after, extras } absolute
// paths) get copied over the existing files at the same filenames.
export async function republishProject(project, { replacedPhotos = {} } = {}) {
  const siteRepo = process.env.SITE_REPO_PATH;
  const branch   = process.env.SITE_REPO_BRANCH || 'master';
  const pushFlag = process.env.SITE_REPO_PUSH !== 'false';
  if (!siteRepo) throw new Error('SITE_REPO_PATH is not set');

  await syncSiteRepo({ siteRepoPath: siteRepo, branch });

  // Re-render the project HTML — picks up every edited field.
  const projectPath = writeProjectPage(siteRepo, project);

  // Copy any replacement photos over the live ones. Unchanged photo
  // slots stay as-is in the static site repo.
  const imgDir = join(siteRepo, 'projects', 'img');
  mkdirSync(imgDir, { recursive: true });
  const touchedPhotos = [];
  if (replacedPhotos.before && existsSync(replacedPhotos.before)) {
    const dest = join(imgDir, `${project.slug}-before.webp`);
    copyFileSync(replacedPhotos.before, dest);
    touchedPhotos.push(dest);
  }
  if (replacedPhotos.after && existsSync(replacedPhotos.after)) {
    const dest = join(imgDir, `${project.slug}-after.webp`);
    copyFileSync(replacedPhotos.after, dest);
    touchedPhotos.push(dest);
  }

  // Regenerate archives that reference this project's content (the
  // hero card thumb + title might have changed; price + service-type
  // updates flow into the archive cards' meta too).
  const archivePaths = writeAffectedArchives(siteRepo, project);

  // Refresh the sitemap lastmod for this project + archive URLs.
  const today = new Date().toISOString().slice(0, 10);
  updateSitemap(siteRepo, project, today);
  updateSitemapArchives(siteRepo, currentArchiveUrls(), today);
  const sitemapPath = join(siteRepo, 'sitemap.xml');

  const files = [
    relTo(siteRepo, projectPath),
    relTo(siteRepo, sitemapPath),
    ...touchedPhotos.map(p => relTo(siteRepo, p)),
    ...archivePaths.map(p => relTo(siteRepo, p)),
  ];

  const git = await commitAndPush({
    siteRepoPath: siteRepo,
    branch,
    files,
    message: `Edit project: ${project.slug}`,
    push: pushFlag,
  });

  return { projectPath: basename(projectPath), archives: archivePaths.map(p => basename(p)), git, pushed: pushFlag };
}
