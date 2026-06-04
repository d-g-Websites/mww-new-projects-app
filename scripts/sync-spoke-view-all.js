#!/usr/bin/env node
// One-shot script to add (or refresh) the "View all N projects in
// [City] →" link on every spoke page in the static-site repo.
//
// The per-publish flow already keeps this link updated for spokes
// that have received a project — but spokes that haven't get no
// link until their first publish. Run this script once now (and
// again whenever new spoke pages are added to the site) to backfill
// every spoke with the right link.
//
// Usage:
//   npm run sync-spoke-links
//
// Counts come from the local SQLite DB. Spokes with 0 projects get
// a "Browse all our completed projects →" link pointing at the
// master archive instead of a non-existent per-spoke archive page.

import 'dotenv/config';
import { loadCities } from '../src/lib/slug.js';
import { listPublishedBySpoke } from '../src/lib/db.js';
import { updateSpokeViewAllOnly } from '../src/lib/spoke-update.js';
import { commitAndPush, syncSiteRepo } from '../src/lib/git.js';

const siteRepo = process.env.SITE_REPO_PATH;
const branch   = process.env.SITE_REPO_BRANCH || 'master';
const pushFlag = process.env.SITE_REPO_PUSH !== 'false';

if (!siteRepo) {
  console.error('SITE_REPO_PATH is not set in .env');
  process.exit(1);
}

console.log(`Site repo: ${siteRepo}`);
console.log(`Branch:    ${branch}`);
console.log(`Will push: ${pushFlag ? 'yes' : 'no (SITE_REPO_PUSH=false)'}\n`);

console.log('Syncing site repo to origin...');
await syncSiteRepo({ siteRepoPath: siteRepo, branch });

const cities = loadCities().cities;
console.log(`Walking ${cities.length} spoke pages...\n`);

const changedFiles = [];
let touched = 0, skipped = 0;

for (const city of cities) {
  const count = listPublishedBySpoke(city.slug).length;
  const result = updateSpokeViewAllOnly(siteRepo, city.slug, count);
  if (result.updated) {
    touched++;
    changedFiles.push(`${city.slug}.html`);
    console.log(`  ✓ ${city.slug.padEnd(28)}  ${count} project${count === 1 ? '' : 's'}`);
  } else {
    skipped++;
    if (process.env.VERBOSE) {
      console.log(`  - ${city.slug.padEnd(28)}  skipped (${result.reason || 'no change'})`);
    }
  }
}

console.log(`\nUpdated ${touched} spoke pages, skipped ${skipped}.`);

if (touched === 0) {
  console.log('Nothing to commit.');
  process.exit(0);
}

if (!pushFlag) {
  console.log('SITE_REPO_PUSH=false — leaving changes uncommitted.');
  process.exit(0);
}

console.log('\nCommitting and pushing...');
const git = await commitAndPush({
  siteRepoPath: siteRepo,
  branch,
  files: changedFiles,
  message: `Backfill View All projects link on ${touched} spoke pages`,
  push: pushFlag,
});
console.log(`Commit: ${git.sha}`);
console.log('Done.');
