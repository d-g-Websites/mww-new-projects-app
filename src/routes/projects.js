import { Router } from 'express';
import multer from 'multer';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { requireAuth } from '../middleware/auth.js';
import { SERVICES, getService, getHub, buildSlug, isSlugAvailable, resolveCityFromLocality, findNearestCities } from '../lib/slug.js';
import { insertDraft, updateDraft, getProject, listPublished, listPending, listDrafts, markPending, deleteProject } from '../lib/db.js';
import { notifyNewProject } from '../lib/telegram.js';

// Placeholder text shown when Claude narrative generation fails, so
// the tech can spot it immediately on the preview page and either
// retry or edit it manually.
const NARRATIVE_PLACEHOLDER = "⚠️ The automatic narrative generation didn't complete (the AI service may have timed out or hit a rate limit). Click \"Regenerate narrative\" below to retry, or replace this text with the two paragraphs you want to publish.";
import { processBeforeAfter, processExtras } from '../lib/photos.js';
import { generateNarrative } from '../lib/narrative.js';
import { generateFaq } from '../lib/faq.js';
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

// ── Dashboard home: drafts + pending approvals + recently published ──
router.get('/', (req, res) => {
  const drafts  = listDrafts();
  const pending = listPending();
  const recent  = listPublished({ limit: 10 });
  res.render('index', { drafts, pending, recent });
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
  'gutter-cleaning': 'details-gutter-cleaning',
  'power-washing':   'details-power-washing',
};

// Per-service common challenges. Surfaced as checkboxes in Section 5
// ("What we did"). Whatever the tech ticks is fed to the narrative as
// "challenges encountered" so the work paragraph names them naturally.
// Each entry is { label, extra? } — extra adds either a number or text
// input next to the checkbox (e.g. bag count, "specify which animal").
// Per-service placeholder text for the "Bullet notes" textarea on
// Section 5 — gives the tech a relevant set of examples instead of
// the window-cleaning sample on every form.
const BULLET_PLACEHOLDER = {
  'window-cleaning': `- arrived 9am
- 24 windows, 2 stories
- north side had salt residue
- screens washed and replaced
- frames and tracks wiped
- 4 hours total`,
  'gutter-cleaning': `- arrived 8am, 2-story home, 180 ft of gutter
- hand-cleared all gutters, 4 bags of leaves + debris
- flushed downspouts, found one clog at NE elbow
- reattached loose hanger on south side
- bagged + hauled off all debris
- 3 hours total`,
  'power-washing':   `- arrived 8am
- 2-car driveway plus front walk
- algae growth on north siding
- soft-washed siding, low-pressure
- standard rinse-and-go on concrete
- 4 hours total`,
};

const CHALLENGE_CHOICES = {
  'window-cleaning': [
    { label: 'Post-construction scraping' },
    { label: 'Hard water stain removal' },
    { label: 'Lots of bugs and spiders' },
    { label: 'Screen repair' },
    { label: 'Oversized windows' },
    { label: 'Very tall house' },
    { label: 'Bushes and trees by the windows' },
    { label: 'Deep window wells' },
    { label: 'Need to use ladder inside' },
  ],
  'gutter-cleaning': [
    { label: 'Very tall house' },
    { label: '36 foot ladder needed' },
    { label: 'Lots of bags collected',     extra: { type: 'number', name: 'bags_count',     prompt: 'how many?',    placeholder: 'bag count' } },
    { label: 'Clogged downspouts' },
    { label: 'Plants growing in the gutters' },
    { label: 'Animals in the gutters',     extra: { type: 'text',   name: 'animals_detail', prompt: 'specify what', placeholder: 'e.g. bird nest, raccoon, squirrels' } },
  ],
  'power-washing': [
    // Surface issues
    { label: 'Algae on house walls' },
    { label: 'Moss on the surface' },
    { label: 'Mildew and black streaks' },
    { label: 'Oxidized aluminum siding' },
    { label: 'Efflorescence on brick or concrete' },
    // Stains
    { label: 'Oil spots' },
    { label: 'Rust stains' },
    { label: 'Tire marks on driveway' },
    { label: 'Tree sap or pitch' },
    { label: 'Heavy pollen buildup' },
    // Conditions
    { label: 'Very dirty' },
    { label: 'Cracks holding embedded dirt' },
    { label: 'Rotted deck boards' },
    // Approach / handling
    { label: 'Tall house' },
    { label: 'Needed to use soap' },
    { label: 'Needed special chemicals to remove dirt' },
    { label: 'Delicate plants and landscaping nearby' },
  ],
};

// ── Step 2: fill in the actual details for the chosen service. ──
router.get('/new/details', (req, res) => {
  const service = getService(req.query.service);
  if (!service) return res.redirect('/new');
  res.render('new-project', {
    service,
    detailsPartial: DETAILS_PARTIALS[service.value] || 'details-generic',
    challengeChoices: CHALLENGE_CHOICES[service.value] || [],
    bulletPlaceholder: BULLET_PLACEHOLDER[service.value] || '',
    today: new Date().toISOString().slice(0, 10),
    googleMapsKey: process.env.GOOGLE_MAPS_API_KEY || '',
  });
});

// Augment the challenge label array with the count/specify text the
// tech filled in. The narrative prompt then sees the challenge with
// its context already inline ("Lots of bags collected (12 bags)")
// instead of needing to cross-reference fields.
function augmentChallenges(extras) {
  const challenges = Array.isArray(extras?.challenges) ? extras.challenges : [];
  return challenges.map(c => {
    if (c === 'Lots of bags collected' && extras.bagsCount) {
      return `${c} (${extras.bagsCount} bags)`;
    }
    if (c === 'Animals in the gutters' && extras.animalsDetail) {
      return `${c} (${extras.animalsDetail})`;
    }
    return c;
  });
}

// Pulls service-specific fields out of the form body and packs them
// into a single `extras` object that gets JSON-serialized to the DB.
// Keep this in lock-step with the partials in src/views/partials/.
function collectExtras(serviceValue, b) {
  const arr = v => v == null ? [] : (Array.isArray(v) ? v : [v]);
  const intOrNull = v => (v && /^\d+$/.test(String(v))) ? parseInt(v, 10) : null;
  const challenges = arr(b.challenges);

  if (serviceValue === 'window-cleaning') {
    return {
      serviceType:  b.service_type || null,
      windowTypes:  arr(b.window_types),
      screens:       b.screens        ? intOrNull(b.screens_count)        : null,
      stormWindows:  b.storm_windows  ? intOrNull(b.storm_windows_count)  : null,
      skylights:     b.skylights      ? intOrNull(b.skylights_count)      : null,
      windowWells:   b.window_wells   ? intOrNull(b.window_wells_count)   : null,
      tracksFrames:  !!b.tracks_frames,
      challenges,
    };
  }

  if (serviceValue === 'power-washing') {
    return {
      surfaces: {
        house:            !!b.surface_house,
        deck:             !!b.surface_deck,
        patio:            !!b.surface_patio,
        driveway:         !!b.surface_driveway,
        walkways:         !!b.surface_walkways,
        playset:          !!b.surface_playset,
        outdoorFurniture: !!b.surface_outdoor_furniture,
      },
      houseStories:      b.surface_house    ? (b.house_stories || null) : null,
      houseMaterials:    b.surface_house    ? arr(b.house_materials)    : [],
      deckMaterials:     b.surface_deck     ? arr(b.deck_materials)     : [],
      patioMaterials:    b.surface_patio    ? arr(b.patio_materials)    : [],
      drivewayMaterials: b.surface_driveway ? arr(b.driveway_materials) : [],
      walkwaysMaterials: b.surface_walkways ? arr(b.walkways_materials) : [],
      sqFootage:         intOrNull(b.metric_value),
      challenges,
    };
  }

  if (serviceValue === 'gutter-cleaning') {
    return {
      serviceType:        b.service_type || null,        // Cleaning | Repair | Gutter Guard Installation
      sqFootage:          intOrNull(b.metric_value),     // optional approximate home footprint
      gutterGuards:       !!b.gutter_guards,
      roofCleaning:       !!b.roof_cleaning,
      gutterRepairs:      !!b.gutter_repairs,
      gutterRepairTypes:  b.gutter_repairs ? arr(b.gutter_repair_types) : [],
      extraWideGutters:   !!b.extra_wide_gutters,
      cloggedElbows:      !!b.clogged_elbows,
      undergroundClogs:   !!b.underground_clogs,
      challenges,
      // Extra detail captured alongside specific challenge checkboxes.
      bagsCount:          intOrNull(b.bags_count),
      animalsDetail:      (b.animals_detail || '').trim() || null,
    };
  }

  return { challenges };
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
    const b = req.body;

    // Helper: re-render the form with everything the tech typed plus a
    // banner. Used for validation issues where there's no draft to
    // recover from yet (no DB row was created).
    const reRenderForm = (overrides = {}) => {
      const svc = getService(b.service) || SERVICES[0];
      return res.render('new-project', {
        service: svc,
        detailsPartial: DETAILS_PARTIALS[svc.value] || 'details-generic',
        challengeChoices: CHALLENGE_CHOICES[svc.value] || [],
        bulletPlaceholder: BULLET_PLACEHOLDER[svc.value] || '',
        today: new Date().toISOString().slice(0, 10),
        formValues: b,
        googleMapsKey: process.env.GOOGLE_MAPS_API_KEY || '',
        ...overrides,
      });
    };

    try {
      const service = getService(b.service);
      if (!service) {
        return res.redirect('/new');
      }

      const lat = b.lat ? parseFloat(b.lat) : null;
      const lng = b.lng ? parseFloat(b.lng) : null;
      const city = resolveCityFromLocality(b.city, { lat, lng });
      if (!city) {
        return reRenderForm({
          errorBanner: 'Pick a real street address from the dropdown — we need the city to build the project page.',
        });
      }

      const slug = buildSlug({
        service: service.value,
        citySlug: city.slug,
        descriptor: b.descriptor || '',
      });

      const siteRepo = process.env.SITE_REPO_PATH;
      if (!isSlugAvailable(slug, siteRepo)) {
        return res.status(409).render('new-project', {
          service,
          detailsPartial: DETAILS_PARTIALS[service.value] || 'details-generic',
          challengeChoices: CHALLENGE_CHOICES[service.value] || [],
          bulletPlaceholder: BULLET_PLACEHOLDER[service.value] || '',
          today: b.review_date,
          formValues: b,
          googleMapsKey: process.env.GOOGLE_MAPS_API_KEY || '',
          collision: {
            slug,
            message: `A page already exists for "${slug}". Add a one-word descriptor (e.g. "colonial") and try again.`,
          },
        });
      }

      const beforeUpload = req.files?.before?.[0];
      const afterUpload  = req.files?.after?.[0];
      if (!beforeUpload || !afterUpload) {
        return reRenderForm({ errorBanner: 'Both before and after photos are required.' });
      }

      // Resize photos. If this fails the tech has to re-upload — there's
      // no way to recover photo bytes after this handler ends — so we
      // bail back to the form with the bad-photo message.
      const stagedDir = join(process.cwd(), 'tmp', 'staged', slug);
      mkdirSync(stagedDir, { recursive: true });
      let beforeOut, afterOut, extraOuts;
      try {
        ({ beforeOut, afterOut } = await processBeforeAfter({
          before: beforeUpload.path,
          after:  afterUpload.path,
          slug,
          outDir: stagedDir,
        }));
        extraOuts = await processExtras({
          files: req.files?.extras || [],
          slug,
          outDir: stagedDir,
          max: 5,
        });
      } catch (err) {
        console.error('[photos] failed:', err);
        return reRenderForm({
          errorBanner: `Photo processing failed: ${err.message}. Try different photos.`,
        });
      }

      const extras = collectExtras(service.value, b);
      // For power-washing the form has no "Home type" dropdown.
      // Derive a reasonable home_type from what was checked so the
      // hero subtitle + stats bar + narrative all read naturally.
      if (service.value === 'power-washing') {
        if (b.surface_house && b.house_stories) {
          b.home_type = `${b.house_stories}-Story House`;
        } else if (b.surface_house) {
          b.home_type = 'House';
        } else {
          b.home_type = 'Property';
        }
      }

      // Save the draft NOW, before the narrative call. If Claude times
      // out, the tech doesn't lose anything — they can resume from the
      // dashboard's "Drafts" list and click "Regenerate narrative".
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
        narrative: NARRATIVE_PLACEHOLDER,
        before_photo: beforeOut,
        after_photo:  afterOut,
        extras,
        extra_photos: extraOuts,
        bullet_facts: b.bullet_facts || null,
        customer_note: b.customer_note || null,
        street: b.street || null,
        spoke_slug: city.spokeSlug || city.slug,
        address_lat: lat,
        address_lng: lng,
        video_url: b.video_url || null,
      });

      const nearbyTowns = findNearestCities(lat, lng, {
        count: 3,
        excludeSlugs: [city.slug, city.spokeSlug].filter(Boolean),
      }).map(c => c.name);

      // Try Claude — narrative + FAQ. Each is wrapped independently so
      // one failing doesn't take down the other. The draft is already
      // saved at this point, so either can be regenerated from the
      // preview screen.
      const hubObj = getHub(city.hub) || { name: city.hub, phone: '' };
      try {
        const paragraphs = await generateNarrative({
          service:  service.label,
          city:     `${city.name}, IL`,
          homeType: b.home_type,
          metric:   `${b.metric_value || ''} ${b.metric_label || ''}`.trim(),
          challenges:   augmentChallenges(extras),
          bulletFacts:  b.bullet_facts,
          extras,
          nearbyTowns,
        });
        updateDraft(id, { narrative: paragraphs.join('\n\n') });
      } catch (err) {
        console.error(`[narrative] failed for project ${id}:`, err.message);
      }
      try {
        const faq = await generateFaq({
          service:      service.label,
          city:         `${city.name}, IL`,
          homeType:     b.home_type,
          metric:       `${b.metric_value || ''} ${b.metric_label || ''}`.trim(),
          price:        b.price || null,
          hubName:      hubObj.name,
          hubPhone:     hubObj.phone || '',
          extras,
          challenges:   augmentChallenges(extras),
          serviceValue: service.value,
        });
        updateDraft(id, { faq: JSON.stringify(faq) });
      } catch (err) {
        console.error(`[faq] failed for project ${id}:`, err.message);
        // Empty array stays — preview surfaces a "Regenerate FAQ" button.
      }

      res.redirect(`/projects/${id}/preview`);
    } catch (err) {
      next(err);
    }
  });

// Re-run the FAQ generator on a stored project. Uses the same inputs
// as the original generation (city, hub, price, extras, challenges)
// pulled back from the DB.
router.post('/projects/:id/regenerate-faq', async (req, res, next) => {
  try {
    const p = getProject(Number(req.params.id));
    if (!p) return res.status(404).render('error', { message: 'Project not found.' });
    if (p.status === 'published') {
      return res.status(409).render('error', { message: 'Already published — cannot regenerate.' });
    }
    const hubObj = getHub(p.hub) || { name: p.hub, phone: '' };
    const faq = await generateFaq({
      service:      p.service_label,
      city:         `${p.city_name}, IL`,
      homeType:     p.home_type,
      metric:       `${p.metric_value || ''} ${p.metric_label || ''}`.trim(),
      price:        p.price || null,
      hubName:      hubObj.name,
      hubPhone:     hubObj.phone || '',
      extras:       p.extras,
      challenges:   augmentChallenges({ ...p.extras, challenges: (p.extras && p.extras.challenges) || [] }),
      serviceValue: p.service,
    });
    updateDraft(p.id, { faq: JSON.stringify(faq) });
    res.redirect(`/projects/${p.id}/preview`);
  } catch (err) {
    console.error(`[faq regen] failed for project ${req.params.id}:`, err.message);
    next(err);
  }
});

// Re-run Claude on a stored draft. Reads bullet_facts / extras / etc.
// back out of the DB so the retry uses whatever the tech originally
// typed, no need to refill the form.
router.post('/projects/:id/regenerate-narrative', async (req, res, next) => {
  try {
    const p = getProject(Number(req.params.id));
    if (!p) return res.status(404).render('error', { message: 'Project not found.' });
    if (p.status === 'published') {
      return res.status(409).render('error', { message: 'Already published — cannot regenerate.' });
    }
    const nearbyTowns = findNearestCities(p.address_lat, p.address_lng, {
      count: 3,
      excludeSlugs: [p.city_slug, p.spoke_slug].filter(Boolean),
    }).map(c => c.name);

    const baseChallenges = (p.extras && p.extras.challenges) || (p.challenge ? [p.challenge] : []);
    const paragraphs = await generateNarrative({
      service:  p.service_label,
      city:     `${p.city_name}, IL`,
      homeType: p.home_type,
      metric:   `${p.metric_value || ''} ${p.metric_label || ''}`.trim(),
      challenges:  augmentChallenges({ ...p.extras, challenges: baseChallenges }),
      bulletFacts: p.bullet_facts,
      extras:      p.extras,
      nearbyTowns,
    });
    updateDraft(p.id, { narrative: paragraphs.join('\n\n') });
    res.redirect(`/projects/${p.id}/preview`);
  } catch (err) {
    console.error(`[narrative regen] failed for project ${req.params.id}:`, err.message);
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
  const narrativeFailed = (p.narrative || '').trimStart().startsWith('⚠');
  const faqEmpty = !Array.isArray(p.faq) || p.faq.length === 0;
  res.render('preview', { project: p, html, narrativeFailed, faqEmpty });
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
