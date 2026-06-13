// Social-post helper page — for a published project, generates
// per-platform captions + hashtags + a photo picker, then surfaces
// "copy & open" buttons that put the text on the admin's clipboard
// and open the platform's compose page. Posting itself stays manual.

import { Router } from 'express';
import express from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { getProject } from '../lib/db.js';
import { generateSocialPosts } from '../lib/social-post.js';

const router = Router();

// Build the list of photos available for this project. Filenames
// follow the convention set in lib/photos.js: <slug>-before.webp,
// <slug>-after.webp, <slug>-extra-<N>.webp. They're served from the
// static-site repo on the public domain.
function photosFor(project) {
  const base = `https://www.mywindowwashing.com/projects/img/${project.slug}`;
  const list = [
    { label: 'Before', url: `${base}-before.webp` },
    { label: 'After',  url: `${base}-after.webp` },
  ];
  const extras = Array.isArray(project.extra_photos) ? project.extra_photos.length : 0;
  for (let i = 1; i <= extras; i++) {
    list.push({ label: `Photo ${i}`, url: `${base}-extra-${i}.webp` });
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

export default router;
