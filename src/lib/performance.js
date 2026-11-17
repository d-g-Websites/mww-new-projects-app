// Project page performance: pulls Search Console data into the local
// database and ranks published project pages worst-first so the admin
// can prune pages that don't earn their keep.
//
// Two data sources, refreshed by syncPerformance():
//   1. Search Analytics — clicks, impressions, CTR, average position
//      for the last 90 days (one API call, every page at once).
//   2. URL Inspection — indexed or not, and why. Google caps this at
//      2,000 checks/day per site, so each run checks pages never
//      checked first, then the stalest, and re-checks a page at most
//      once a week.
//
// A refresh runs in the background (button on the report page, plus
// an automatic daily run while the server is up).

import { db, getSetting, setSetting } from './db.js';
import {
  isConnected, getSiteUrl, projectPageStats, inspectUrl, inspectionUrlFor,
} from './search-console.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS page_metrics (
    project_id     INTEGER PRIMARY KEY,
    clicks         INTEGER,
    impressions    INTEGER,
    ctr            REAL,
    position       REAL,
    metrics_at     TEXT,
    index_verdict  TEXT,
    coverage_state TEXT,
    last_crawl     TEXT,
    inspection_link TEXT,
    inspected_at   TEXT,
    inspect_error  TEXT
  );
`);

const STATE_KEY = 'gsc_sync_state';
const WINDOW_DAYS = 90;
const REINSPECT_DAYS = 7;
const MAX_INSPECTIONS_PER_RUN = Number(process.env.GSC_MAX_INSPECTIONS_PER_RUN || 300);

// ── Sync state (shown on the report page) ────────────────────────────

export function getSyncState() {
  try { return JSON.parse(getSetting(STATE_KEY) || '{}'); } catch { return {}; }
}
function saveSyncState(patch) {
  setSetting(STATE_KEY, JSON.stringify({ ...getSyncState(), ...patch }));
}

// ── Helpers ──────────────────────────────────────────────────────────

// YYYY-MM-DD in Pacific time — Search Console's day boundary.
function pacificDate(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d);
}

// "/projects/<slug>" out of any URL variant Google reports
// (http/https, www/non-www, .html, trailing slash, query string).
export function slugFromPageUrl(pageUrl) {
  try {
    const m = new URL(pageUrl).pathname.match(/^\/projects\/([^/]+?)(?:\.html)?\/?$/);
    return m ? decodeURIComponent(m[1]) : null;
  } catch { return null; }
}

function publishedProjects() {
  return db.prepare(`
    SELECT id, slug FROM projects WHERE status = 'published'
  `).all();
}

// ── The sync ─────────────────────────────────────────────────────────

let running = null;

// Starts a refresh in the background; returns immediately. No-op if
// one is already running or Search Console isn't connected.
export function startSync({ reason = 'manual' } = {}) {
  if (running || !isConnected()) return false;
  running = syncPerformance({ reason })
    .catch(err => {
      console.error('[performance] sync failed:', err);
      saveSyncState({ running: false, finishedAt: new Date().toISOString(), error: err.message });
    })
    .finally(() => { running = null; });
  return true;
}

export function isSyncRunning() { return Boolean(running); }

export async function syncPerformance({ reason = 'manual', now = new Date() } = {}) {
  const siteUrl = getSiteUrl();
  if (!siteUrl) throw new Error('No Search Console property selected.');
  saveSyncState({
    running: true, reason, startedAt: now.toISOString(), finishedAt: null,
    error: null, inspected: 0, toInspect: 0, note: null,
  });

  // 1. Search Analytics for the last 90 days. Google's newest data is
  //    ~2 days behind, so end the window there.
  const end = new Date(now.getTime() - 2 * 86400000);
  const start = new Date(end.getTime() - (WINDOW_DAYS - 1) * 86400000);
  const rows = await projectPageStats(siteUrl, pacificDate(start), pacificDate(end));

  // Several URL variants can map to one page — add them up, weighting
  // average position by impressions.
  const bySlug = new Map();
  for (const r of rows) {
    const slug = slugFromPageUrl(r.page);
    if (!slug) continue;
    const a = bySlug.get(slug) || { clicks: 0, impressions: 0, posWeight: 0 };
    a.clicks += r.clicks;
    a.impressions += r.impressions;
    a.posWeight += r.position * r.impressions;
    bySlug.set(slug, a);
  }

  const projects = publishedProjects();
  const upsertMetrics = db.prepare(`
    INSERT INTO page_metrics (project_id, clicks, impressions, ctr, position, metrics_at)
    VALUES (@id, @clicks, @impressions, @ctr, @position, datetime('now'))
    ON CONFLICT(project_id) DO UPDATE SET
      clicks = excluded.clicks, impressions = excluded.impressions,
      ctr = excluded.ctr, position = excluded.position, metrics_at = excluded.metrics_at
  `);
  db.transaction(() => {
    for (const p of projects) {
      const a = bySlug.get(p.slug);
      upsertMetrics.run({
        id: p.id,
        clicks: a ? a.clicks : 0,
        impressions: a ? a.impressions : 0,
        ctr: a && a.impressions ? a.clicks / a.impressions : 0,
        position: a && a.impressions ? a.posWeight / a.impressions : null,
      });
    }
  })();

  // 2. URL Inspection — never-checked pages first, then the stalest.
  const due = db.prepare(`
    SELECT p.id, p.slug
      FROM projects p
      LEFT JOIN page_metrics m ON m.project_id = p.id
     WHERE p.status = 'published'
       AND (m.inspected_at IS NULL OR m.inspected_at < datetime('now', ?))
     ORDER BY m.inspected_at IS NOT NULL, m.inspected_at
     LIMIT ?
  `).all(`-${REINSPECT_DAYS} days`, MAX_INSPECTIONS_PER_RUN);
  saveSyncState({ toInspect: due.length });

  const saveInspection = db.prepare(`
    UPDATE page_metrics SET
      index_verdict = @verdict, coverage_state = @coverageState,
      last_crawl = @lastCrawlTime, inspection_link = @link,
      inspected_at = datetime('now'), inspect_error = NULL
    WHERE project_id = @id
  `);
  const saveInspectError = db.prepare(`
    UPDATE page_metrics SET inspect_error = ?, inspected_at = datetime('now') WHERE project_id = ?
  `);

  let inspected = 0;
  let note = null;
  for (const p of due) {
    try {
      const r = await inspectUrl(siteUrl, inspectionUrlFor(siteUrl, p.slug));
      saveInspection.run({ id: p.id, ...r });
    } catch (err) {
      if (err.quota) { note = 'Google\'s daily page-check limit was reached; the rest will be checked on the next refresh.'; break; }
      saveInspectError.run(err.message, p.id);
    }
    inspected += 1;
    if (inspected % 10 === 0) saveSyncState({ inspected });
    // Stay well under Google's 600 checks/minute limit.
    await new Promise(r => setTimeout(r, 150));
  }
  if (!note && due.length === MAX_INSPECTIONS_PER_RUN) {
    note = `Checked ${inspected} pages this run; the rest will be checked on the next refresh.`;
  }

  saveSyncState({
    running: false, finishedAt: new Date().toISOString(), inspected, note,
    pagesWithData: bySlug.size,
  });
}

// Refresh automatically about once a day while the server is running.
export function scheduleDailySync() {
  const check = () => {
    const last = getSyncState().finishedAt;
    if (!last || Date.now() - new Date(last).getTime() > 23 * 3600000) startSync({ reason: 'daily' });
  };
  setTimeout(check, 60 * 1000);            // a minute after boot
  setInterval(check, 60 * 60 * 1000).unref(); // then hourly checks
}

// ── The report ───────────────────────────────────────────────────────

export const CATEGORIES = {
  'not-indexed':    { order: 1, label: 'Not indexed',            tone: 'bad' },
  'no-impressions': { order: 2, label: 'Never shown in Google',  tone: 'bad' },
  'no-clicks':      { order: 3, label: 'Shown, no clicks',       tone: 'warn' },
  'getting-clicks': { order: 4, label: 'Getting clicks',         tone: 'good' },
  'unchecked':      { order: 5, label: 'Not checked yet',        tone: 'neutral' },
};

// Quick on-page quality checklist from the app's own data.
function qualityChecks(p) {
  const words = String(p.narrative || '').trim().split(/\s+/).filter(Boolean).length;
  let gallery = 0;
  try { gallery = JSON.parse(p.extra_photos || '[]').length; } catch {}
  let faq = 0;
  try { faq = JSON.parse(p.faq || '[]').length; } catch {}
  const checks = [
    { label: 'Extra photos', ok: gallery > 0 },
    { label: 'Video',        ok: Boolean(p.video_url) },
    { label: 'Review',       ok: Boolean(p.review_text && p.review_text.trim()) },
    { label: 'Narrative 150+ words', ok: words >= 150 },
    { label: 'FAQ',          ok: faq > 0 },
  ];
  return { checks, score: checks.filter(c => c.ok).length, words };
}

function categorize(r) {
  if (r.metrics_at == null && r.inspected_at == null) return 'unchecked';
  if (r.index_verdict && r.index_verdict !== 'PASS') return 'not-indexed';
  if (!r.impressions) return 'no-impressions';
  if (!r.clicks) return 'no-clicks';
  return 'getting-clicks';
}

export function buildReport({ minAgeDays = 30 } = {}) {
  const rows = db.prepare(`
    SELECT p.*, u.display_name AS submitted_by_name,
           CAST(julianday('now') - julianday(p.published_at) AS INTEGER) AS age_days,
           m.clicks, m.impressions, m.ctr, m.position, m.metrics_at,
           m.index_verdict, m.coverage_state, m.last_crawl, m.inspection_link,
           m.inspected_at, m.inspect_error
      FROM projects p
      LEFT JOIN users u ON u.id = p.submitted_by
      LEFT JOIN page_metrics m ON m.project_id = p.id
     WHERE p.status = 'published'
  `).all();

  const judged = [];
  const tooNew = [];
  for (const r of rows) {
    const category = categorize(r);
    const q = qualityChecks(r);
    const row = {
      ...r,
      category,
      categoryLabel: CATEGORIES[category].label,
      tone: CATEGORIES[category].tone,
      quality: q.checks,
      qualityScore: q.score,
      positionRounded: r.position != null ? Math.round(r.position * 10) / 10 : null,
      ctrPct: r.impressions ? Math.round((r.clicks / r.impressions) * 1000) / 10 : 0,
      lastCrawlDate: r.last_crawl ? String(r.last_crawl).slice(0, 10) : null,
    };
    (r.age_days != null && r.age_days < minAgeDays ? tooNew : judged).push(row);
  }

  // Worst first: by category, then within each category the weakest.
  judged.sort((a, b) => {
    const c = CATEGORIES[a.category].order - CATEGORIES[b.category].order;
    if (c) return c;
    if (a.category === 'no-clicks') return (b.position || 0) - (a.position || 0) || a.impressions - b.impressions;
    if (a.category === 'getting-clicks') return a.clicks - b.clicks || a.impressions - b.impressions;
    return (b.age_days || 0) - (a.age_days || 0); // oldest offenders first
  });
  tooNew.sort((a, b) => (a.age_days || 0) - (b.age_days || 0));

  const counts = {};
  for (const r of judged) counts[r.category] = (counts[r.category] || 0) + 1;
  const summary = Object.entries(CATEGORIES)
    .map(([key, c]) => ({ key, label: c.label, tone: c.tone, count: counts[key] || 0 }));

  return { rows: judged, tooNew, summary, total: rows.length };
}
