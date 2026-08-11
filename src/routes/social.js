// Social-post helper page — for a published project, generates
// per-platform captions + hashtags + a photo picker, then surfaces
// "copy & open" buttons that put the text on the admin's clipboard
// and open the platform's compose page. Posting itself stays manual.

import { Router } from 'express';
import express from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { getProject } from '../lib/db.js';
import { generateSocialPosts } from '../lib/social-post.js';
import { publishToFacebook, publishToInstagram, publishToLinkedIn } from '../lib/zernio.js';

const router = Router();

// Build the list of photos available for this project. Filenames
// follow the convention set in lib/photos.js: <slug>-before.webp,
// <slug>-after.webp, <slug>-extra-<N>.webp. They're served from the
// static-site repo on the public domain.
function photosFor(project) {
  const base = `https://www.mywindowwashing.com/projects/img/${project.slug}`;
  // Before + After are pre-selected since the canonical social post
  // for a cleaning company is a before/after pair. Extras start
  // unchecked — admin can add them by tapping.
  const list = [
    { label: 'Before', url: `${base}-before.webp`, defaultPick: true },
    { label: 'After',  url: `${base}-after.webp`,  defaultPick: true },
  ];
  const extras = Array.isArray(project.extra_photos) ? project.extra_photos.length : 0;
  for (let i = 1; i <= extras; i++) {
    list.push({ label: `Photo ${i}`, url: `${base}-extra-${i}.webp`, defaultPick: false });
  }
  return list;
}

router.get('/projects/:id/social', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const project = getProject(Number(req.params.id));
    if (!project) return res.status(404).render('error', { message: 'Project not found.' });
    if (project.status !== 'published') {
      return res.status(400).render('error', { message: 'Social posts can only be generated for published projects.' });
    }
    res.render('social-post', {
      project,
      photos: photosFor(project),
      pageUrl: `https://www.mywindowwashing.com/projects/${project.slug}`,
    });
  } catch (err) { next(err); }
});

// AJAX endpoint the client calls on page load (or via "Regenerate")
// to fetch fresh AI-written captions.
router.post('/projects/:id/social/generate', requireAuth, requireAdmin, express.json(), async (req, res) => {
  try {
    const project = getProject(Number(req.params.id));
    if (!project) return res.status(404).json({ error: 'project not found' });
    const posts = await generateSocialPosts(project);
    res.json(posts);
  } catch (err) {
    console.error('[social] generate failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// Build the per-platform post text from generated copy — matches the
// "copy" buttons in the UI: Facebook + Instagram append hashtags,
// LinkedIn does not.
function buildContent(platform, posts) {
  const tags = (posts.hashtags || []).map(h => '#' + h).join(' ');
  if (platform === 'linkedin') return posts.linkedin;
  const base = platform === 'instagram' ? posts.instagram : posts.facebook;
  return base + (tags ? '\n\n' + tags : '');
}

// One route per platform. The client sends the final `content` string
// (as the admin edited it) + chosen public photo URLs; falls back to
// freshly generated copy when `content` is omitted (server-side caller).
function makePublishRoute(platform, publishFn, envHint) {
  return async (req, res) => {
    try {
      const project = getProject(Number(req.params.id));
      if (!project) return res.status(404).json({ error: 'project not found' });

      let { content, photoUrls } = req.body || {};
      if (!content) {
        const posts = await generateSocialPosts(project);
        content = buildContent(platform, posts);
      }

      const result = await publishFn(content, Array.isArray(photoUrls) ? photoUrls : []);
      if (result.skipped) {
        return res.status(400).json({ error: `Zernio ${platform} is not configured on the server (${envHint}).` });
      }
      if (!result.ok) return res.status(502).json({ error: result.error });
      res.json({ ok: true, id: result.id });
    } catch (err) {
      console.error(`[social] publish-${platform} failed:`, err);
      res.status(500).json({ error: err.message });
    }
  };
}

router.post('/projects/:id/social/publish-facebook',  requireAuth, requireAdmin, express.json(),
  makePublishRoute('facebook',  publishToFacebook,  'set ZERNIO_API_KEY + ZERNIO_ACCOUNT_ID'));
router.post('/projects/:id/social/publish-instagram', requireAuth, requireAdmin, express.json(),
  makePublishRoute('instagram', publishToInstagram, 'set ZERNIO_INSTAGRAM_ACCOUNT_ID'));
router.post('/projects/:id/social/publish-linkedin',  requireAuth, requireAdmin, express.json(),
  makePublishRoute('linkedin',  publishToLinkedIn,  'set ZERNIO_LINKEDIN_ACCOUNT_ID'));

export default router;
