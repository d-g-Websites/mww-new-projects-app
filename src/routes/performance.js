// Admin-only "Worst performing projects" report + the Search Console
// connection it runs on.
//
// /performance                    the report
// /performance/refresh            POST: pull fresh data from Google (background)
// /performance/site               POST: switch Search Console property
// /search-console/connect         start Google sign-in
// /search-console/disconnect      POST: forget the connection
// The sign-in returns through /youtube/callback (see handleGscCallback).

import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as gsc from '../lib/search-console.js';
import { buildReport, getSyncState, startSync, isSyncRunning } from '../lib/performance.js';
import { youtubeIdFromUrl } from '../lib/youtube.js';

const router = Router();
router.use(['/performance', '/search-console'], requireAuth, requireAdmin);

const AGE_CHOICES = [14, 30, 60, 90];

router.get('/performance', async (req, res, next) => {
  try {
    const minAgeDays = AGE_CHOICES.includes(Number(req.query.age)) ? Number(req.query.age) : 30;
    const view = req.query.view === 'all' ? 'all' : 'worst';

    if (!gsc.isConfigured() || !gsc.isConnected()) {
      return res.render('performance', {
        configured: gsc.isConfigured(),
        connected: false,
        error: req.query.error,
        notice: req.query.notice,
      });
    }

    const report = buildReport({ minAgeDays });
    // "Worst" view hides pages that are earning clicks.
    const rows = (view === 'all' ? report.rows : report.rows.filter(r => r.category !== 'getting-clicks'))
      .map(r => ({ ...r, has_youtube_video: Boolean(youtubeIdFromUrl(r.video_url)) }));

    let sites = [];
    try { sites = await gsc.listSites(); } catch { /* shown as just the saved one */ }

    const sync = getSyncState();
    res.render('performance', {
      configured: true,
      connected: true,
      siteUrl: gsc.getSiteUrl(),
      sites: sites.length > 1 ? sites : [],
      sync,
      lastRefreshed: sync.finishedAt ? String(sync.finishedAt).slice(0, 16).replace('T', ' ') : null,
      syncRunning: isSyncRunning(),
      neverSynced: !sync.finishedAt && !isSyncRunning(),
      summary: report.summary,
      rows,
      tooNew: report.tooNew,
      total: report.total,
      minAgeDays,
      ageChoices: AGE_CHOICES.map(n => ({ n, selected: n === minAgeDays })),
      view,
      error: req.query.error,
      notice: req.query.notice,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/performance/refresh', (req, res) => {
  const started = startSync({ reason: 'manual' });
  const msg = started
    ? 'Refreshing from Google Search Console — this takes a few minutes. Reload the page to see progress.'
    : 'A refresh is already running.';
  res.redirect('/performance?notice=' + encodeURIComponent(msg));
});

router.post('/performance/site', async (req, res) => {
  try {
    const sites = await gsc.listSites();
    if (!sites.includes(req.body.site)) throw new Error('That property isn\'t available to the connected Google account.');
    gsc.setSiteUrl(req.body.site);
    startSync({ reason: 'property changed' });
    res.redirect('/performance?notice=' + encodeURIComponent(`Switched to ${req.body.site}. Refreshing data…`));
  } catch (err) {
    res.redirect('/performance?error=' + encodeURIComponent(err.message));
  }
});

router.get('/search-console/connect', (req, res) => {
  if (!gsc.isConfigured()) {
    return res.redirect('/performance?error=' + encodeURIComponent('YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET are not set in .env.'));
  }
  const { url, state } = gsc.getAuthUrl();
  req.session.gscState = state;
  res.redirect(url);
});

router.post('/search-console/disconnect', (req, res) => {
  gsc.disconnect();
  res.redirect('/performance?notice=' + encodeURIComponent('Search Console disconnected.'));
});

// Called from /youtube/callback when the `state` says this sign-in was
// for Search Console.
export async function handleGscCallback(req, res) {
  try {
    const expected = req.session.gscState;
    req.session.gscState = null;
    if (!expected || req.query.state !== expected) throw new Error('Sign-in link expired or didn\'t match — please click Connect again.');
    if (req.query.error) throw new Error(`Google returned: ${req.query.error}`);
    if (!req.query.code) throw new Error('No authorization code in callback.');
    await gsc.exchangeCode(String(req.query.code));
    startSync({ reason: 'connected' });
    res.redirect('/performance?notice=' + encodeURIComponent(`Search Console connected (${gsc.getSiteUrl()}). Pulling data now — reload in a few minutes.`));
  } catch (err) {
    console.error('[search-console] connect failed:', err);
    res.redirect('/performance?error=' + encodeURIComponent(err.message));
  }
}

export default router;
