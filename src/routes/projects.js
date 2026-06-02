import { Router } from 'express';
import multer from 'multer';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { requireAuth } from '../middleware/auth.js';
import { SERVICES, getService, buildSlug, isSlugAvailable, resolveCityFromLocality } from '../lib/slug.js';
import { insertDraft, updateDraft, getProject, listPublished, listPending, markPending, deleteProject } from '../lib/db.js';
import { notifyNewProject } from '../lib/telegram.js';
import { processBeforeAfter, processExtras } from '../lib/photos.js';
import { generateNarrative } from '../lib/narrative.js';
import { renderProjectHtml } from '../lib/render.js';
import { publishProject } from './publish.js';

const router = Router();

const TMP_DIR = join(process.cwd(), 'tmp', 'uploads');
mkdirSync(TMP_DIR, { recursive: true });
const upload = multer({
  dest: TMP_DIR,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB per phone photo
});

router.use(requireAuth);

// ── Dashboard home: pending approvals + recently published ──
router.get('/', (req, res) => {
  const pending = listPending();
  const recent  = listPublished({ limit: 10 });
  res.render('index', { pending, recent });
});

// ── Step 1 of new-project flow: pick a service. ──
router.get('/new', (req, res) => {
  res.render('pick-service', { services: SERVICES });
});

// Maps service.value → the Details-section partial to render. Services
// without a tailored partial fall back to the generic one — keeps
// gutter + power working unchanged until they get their own.
const DETAILS_PARTIALS = {
  'window-cleaning': 'details-window-cleaning',
  'gutter-cleaning': 'details-generic',
  'power-washing':   'details-generic',
};

// ── Step 2: fill in the actual details for the chosen service. ──
router.get('/new/details', (req, res) => {
  const service = getService(req.query.service);
  if (!service) return res.redirect('/new');
  res.render('new-project', {
    service,
    detailsPartial: DETAILS_PARTIALS[service.value] || 'details-generic',
    today: new Date().toISOString().slice(0, 10),
    googleMapsKey: process.env.GOOGLE_MAPS_API_KEY || '',
  });
});

// Pulls service-specific fields out of the form body and packs them
// into a single `extras` object that gets JSON-serialized to the DB.
// Keep this in lock-step with the partials in src/views/partials/.
function collectExtras(serviceValue, b) {
  if (serviceValue === 'window-cleaning') {
    const arr = v => v == null ? [] : (Array.isArray(v) ? v : [v]);
    const intOrNull = v => (v && /^\d+$/.test(String(v))) ? parseInt(v, 10) : null;
    return {
      serviceType:  b.service_type || null,
      windowTypes:  arr(b.window_types),
      screens:       b.screens        ? intOrNull(b.screens_count)        : null,
      stormWindows:  b.storm_windows  ? intOrNull(b.storm_windows_count)  : null,
      skylights:     b.skylights      ? intOrNull(b.skylights_count)      : null,
      windowWells:   b.window_wells   ? intOrNull(b.window_wells_count)   : null,
      tracksFrames:  !!b.tracks_frames,
    };
  }
  return {};
}

// ── Submit form: validate, save photos, save draft, generate narrative,
//    show preview ─────────────────────────────────────────────────────
router.post('/new',
  upload.fields([
    { name: 'before', maxCount: 1 },
    { name: 'after',  maxCount: 1 },
    { name: 'extras', maxCount: 5 },
  ]),
  async (req, res, next) => {
    try {
      const b = req.body;
      const service = getService(b.service);
      if (!service) {
        return res.status(400).render('error', { message: 'Pick a valid service.' });
      }
      // City comes from the Google Places locality we extracted client-
      // side. resolveCityFromLocality matches against known spokes; if
      // no spoke exists, it picks the nearest one by lat/lng and
      // inherits that hub.
      const lat = b.lat ? parseFloat(b.lat) : null;
      const lng = b.lng ? parseFloat(b.lng) : null;
      const city = resolveCityFromLocality(b.city, { lat, lng });
      if (!city) {
        return res.status(400).render('error', {
          message: 'Pick a valid street address — we need the city to build the project page.',
        });
      }

      const slug = buildSlug({
        service: service.value,
        citySlug: city.slug,
        descriptor: b.descriptor || '',
      });

      // Collision check covers DB + existing static-site repo.
      const siteRepo = process.env.SITE_REPO_PATH;
      if (!isSlugAvailable(slug, siteRepo)) {
        return res.status(409).render('new-project', {
          service,
          detailsPartial: DETAILS_PARTIALS[service.value] || 'details-generic',
          today: b.review_date,
          formValues: b,
          googleMapsKey: process.env.GOOGLE_MAPS_API_KEY || '',
          collision: {
            slug,
            message: `A page already exists for "${slug}". Add a one-word descriptor (e.g. "colonial") and try again.`,
          },
        });
      }

      // Resize uploads → webp into tmp/<slug>/img.
      const beforeUpload = req.files?.before?.[0];
      const afterUpload  = req.files?.after?.[0];
      if (!beforeUpload || !afterUpload) {
        return res.status(400).render('error', { message: 'Both before and after photos are required.' });
      }
      const stagedDir = join(process.cwd(), 'tmp', 'staged', slug);
      mkdirSync(stagedDir, { recursive: true });
      const { beforeOut, afterOut } = await processBeforeAfter({
        before: beforeUpload.path,
        after:  afterUpload.path,
        slug,
        outDir: stagedDir,
      });

      // Optional: up to 5 additional photos for the in-page gallery
      // and the hero background. Empty input slots are silently
      // skipped — no required count.
      const extraUploads = req.files?.extras || [];
      const extraOuts = await processExtras({
        files: extraUploads,
        slug,
        outDir: stagedDir,
        max: 5,
      });

      const extras = collectExtras(service.value, b);

      // Generate narrative via Claude.
      const paragraphs = await generateNarrative({
        service: service.label,
        city:    `${city.name}, IL`,
        homeType: b.home_type,
        metric:   `${b.metric_value || ''} ${b.metric_label || ''}`.trim(),
        challenge: b.challenge,
        bulletFacts: b.bullet_facts,
        customerNote: b.customer_note,
        extras,
      });
      const narrative = paragraphs.join('\n\n');

      const id = insertDraft({
        slug,
        service: service.value,
        service_label: service.label,
        city_slug: city.slug,
        city_name: city.name,
        hub: city.hub,
        address: b.address || null,
        home_type: b.home_type || null,
        metric_value: b.metric_value || null,
        metric_label: b.metric_label || null,
        price: b.price || null,
        challenge: b.challenge || null,
        review_text: b.review_text || null,
        customer_name: b.customer_name || null,
        review_date: b.review_date || new Date().toISOString().slice(0, 10),
        review_url: b.review_url || null,
        narrative,
        before_photo: beforeOut,
        after_photo:  afterOut,
        extras,
        extra_photos: extraOuts,
      });

      res.redirect(`/projects/${id}/preview`);
    } catch (err) {
      next(err);
    }
  });

// ── Preview the generated HTML before publishing ──
router.get('/projects/:id/preview', (req, res) => {
  const p = getProject(Number(req.params.id));
  if (!p) return res.status(404).render('error', { message: 'Project not found.' });
  // Render with the in-progress narrative, even though the photos are
  // still in tmp/ (the page will show 404s for the <img> tags — that's
  // fine, the tech is reviewing copy, not the photos).
  const html = renderProjectHtml(p);
  res.render('preview', { project: p, html });
});

// Edit the narrative in-place before publishing.
router.post('/projects/:id/narrative', (req, res) => {
  const p = getProject(Number(req.params.id));
  if (!p) return res.status(404).render('error', { message: 'Project not found.' });
  updateDraft(p.id, { narrative: req.body.narrative || '' });
  res.redirect(`/projects/${p.id}/preview`);
});

// Render preview HTML to be inlined into an <iframe srcdoc>.
router.get('/projects/:id/preview/iframe', (req, res) => {
  const p = getProject(Number(req.params.id));
  if (!p) return res.status(404).send('not found');
  res.type('html').send(renderProjectHtml(p));
});

// Tech's "Save" button — moves the project from draft to pending and
// pings the admin via Telegram. No git operations yet.
router.post('/projects/:id/save', async (req, res, next) => {
  try {
    const p = getProject(Number(req.params.id));
    if (!p) return res.status(404).render('error', { message: 'Project not found.' });
    if (p.status === 'published') {
      return res.status(409).render('error', { message: 'This project is already published.' });
    }
    markPending(p.id);
    // Fire-and-forget the Telegram ping so a flaky Telegram doesn't
    // block the tech from finishing the submission.
    notifyNewProject({ ...p, status: 'pending' }).catch(err =>
      console.error('[telegram] notify failed:', err)
    );
    res.render('saved', { project: p });
  } catch (err) {
    next(err);
  }
});

// Admin's "Publish" button — write artifacts to the site repo, patch
// spoke + sitemap, commit + push.
router.post('/projects/:id/publish', async (req, res, next) => {
  try {
    const p = getProject(Number(req.params.id));
    if (!p) return res.status(404).render('error', { message: 'Project not found.' });
    if (p.status === 'published') {
      return res.status(409).render('error', { message: 'This project is already published.' });
    }
    const result = await publishProject(p);
    res.render('published', { project: p, result });
  } catch (err) {
    next(err);
  }
});

// Admin's "Delete" button — drops the draft/pending project. We don't
// allow deleting already-published rows (those would need to be
// reverted via the static-site repo instead).
router.post('/projects/:id/delete', (req, res, next) => {
  try {
    const p = getProject(Number(req.params.id));
    if (!p) return res.status(404).render('error', { message: 'Project not found.' });
    if (p.status === 'published') {
      return res.status(409).render('error', {
        message: 'Already-published projects can\'t be deleted from the dashboard. Remove the file from the mywindowwashing repo directly.',
      });
    }
    deleteProject(p.id);
    res.redirect('/');
  } catch (err) {
    next(err);
  }
});

export default router;
