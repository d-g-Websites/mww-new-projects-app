// Video uploader — standalone dashboard page that pushes a job video
// to the company YouTube channel with AI-written title/description,
// and optionally drops the resulting URL onto a project.
//
// /videos                 form (any logged-in user)
// /videos/generate-meta   AJAX: AI title/description/tags
// /videos/upload          multipart POST → YouTube → optional project link
// /youtube/connect        admin: start Google OAuth
// /youtube/callback       Google redirects back here with ?code=
// /youtube/disconnect     admin: forget the stored refresh token

import { Router } from 'express';
import express from 'express';
import multer from 'multer';
import { mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { getProject, updateDraft, listDrafts, listPending, listPublished } from '../lib/db.js';
import { isConfigured, isConnected, getAuthUrl, exchangeCode, disconnect, uploadVideo } from '../lib/youtube.js';
import { generateVideoMeta } from '../lib/video-meta.js';
import { republishProject } from './publish.js';

const router = Router();

const VIDEO_TMP = join(process.cwd(), 'tmp', 'videos');
mkdirSync(VIDEO_TMP, { recursive: true });
const upload = multer({
  dest: VIDEO_TMP,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB — covers long 4K phone clips
});

// Projects offered in the "attach to project" dropdown: everything
// unpublished plus the 30 most recent published ones.
function projectChoices() {
  const tag = (p, status) => ({
    id: p.id,
    label: `${p.service_label} — ${p.city_name}, IL (${status})`,
    hasVideo: Boolean(p.video_url),
  });
  return [
    ...listPending().map(p => tag(p, 'pending')),
    ...listDrafts().map(p => tag(p, 'draft')),
    ...listPublished({ limit: 30 }).map(p => tag(p, 'published')),
  ];
}

router.get('/videos', requireAuth, (req, res) => {
  res.render('videos', {
    configured: isConfigured(),
    connected: isConnected(),
    isAdmin: req.user.role === 'admin',
    projects: projectChoices(),
    defaultPrivacy: process.env.YOUTUBE_DEFAULT_PRIVACY || 'public',
    error: req.query.error,
    notice: req.query.notice,
  });
});

// AI metadata. Body: { project_id } or { manual_context }.
router.post('/videos/generate-meta', requireAuth, express.json(), async (req, res) => {
  try {
    const project = req.body.project_id ? getProject(Number(req.body.project_id)) : null;
    const meta = await generateVideoMeta({ project, manualContext: req.body.manual_context });
    res.json(meta);
  } catch (err) {
    console.error('[videos] generate-meta failed:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/videos/upload', requireAuth, upload.single('video'), async (req, res, next) => {
  const file = req.file;
  try {
    if (!isConnected()) throw new Error('YouTube is not connected yet — an admin needs to click "Connect YouTube channel" first.');
    if (!file) throw new Error('No video file was attached.');
    const title = (req.body.title || '').trim();
    if (!title) throw new Error('Title is required.');

    const tags = (req.body.tags || '')
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);
    const privacy = ['public', 'unlisted', 'private'].includes(req.body.privacy)
      ? req.body.privacy : 'public';

    const { url } = await uploadVideo({
      filePath: file.path,
      mimeType: file.mimetype,
      title,
      description: req.body.description || '',
      tags,
      privacyStatus: privacy,
    });

    // Attach to a project if one was selected. Published projects get
    // re-rendered so the embed goes live in the same step.
    let attached = null;
    let republished = false;
    const projectId = Number(req.body.project_id) || null;
    if (projectId) {
      const project = getProject(projectId);
      if (project) {
        updateDraft(projectId, { video_url: url });
        attached = project;
        if (project.status === 'published') {
          await republishProject(getProject(projectId));
          republished = true;
        }
      }
    }

    res.render('video-uploaded', {
      url,
      title,
      privacy,
      attached,
      republished,
    });
  } catch (err) {
    next(err);
  } finally {
    if (file) { try { unlinkSync(file.path); } catch { /* already gone */ } }
  }
});

// ── OAuth connect flow (admin only) ──────────────────────────────────

router.get('/youtube/connect', requireAuth, requireAdmin, (req, res) => {
  if (!isConfigured()) {
    return res.redirect('/videos?error=' + encodeURIComponent('YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET are not set in .env yet.'));
  }
  res.redirect(getAuthUrl());
});

router.get('/youtube/callback', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (req.query.error) throw new Error(`Google returned: ${req.query.error}`);
    if (!req.query.code) throw new Error('No authorization code in callback.');
    await exchangeCode(String(req.query.code));
    res.redirect('/videos?notice=' + encodeURIComponent('YouTube channel connected. Uploads are ready.'));
  } catch (err) {
    console.error('[youtube] connect failed:', err);
    res.redirect('/videos?error=' + encodeURIComponent(err.message));
  }
});

router.post('/youtube/disconnect', requireAuth, requireAdmin, (req, res) => {
  disconnect();
  res.redirect('/videos?notice=' + encodeURIComponent('YouTube disconnected.'));
});

export default router;
