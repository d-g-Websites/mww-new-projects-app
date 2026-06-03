// Admin-only user management: list techs, add a tech, edit details,
// upload their photo (which gets resized + committed to the static
// site so it's reachable from project pages on mywindowwashing.com).

import { Router } from 'express';
import multer from 'multer';
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import {
  listUsers, getUser, getUserByUsername,
  createUser, updateUser, deleteUser,
} from '../lib/db.js';
import { hashPassword } from '../lib/auth.js';
import { resizeAvatar } from '../lib/photos.js';
import { commitAndPush, syncSiteRepo } from '../lib/git.js';

const router = Router();

const TMP_DIR = join(process.cwd(), 'tmp', 'user-uploads');
mkdirSync(TMP_DIR, { recursive: true });
const upload = multer({
  dest: TMP_DIR,
  limits: { fileSize: 15 * 1024 * 1024 },
});

router.use(requireAuth);

// Everything in this router needs admin role.
router.use((req, res, next) => {
  // Allow techs to view their own profile? For v1 keep it admin-only.
  return requireAdmin(req, res, next);
});

const usernameRe = /^[a-z][a-z0-9_-]{1,30}$/;

router.get('/users', (req, res) => {
  res.render('users-list', { users: listUsers() });
});

router.get('/users/new', (req, res) => {
  res.render('user-form', { mode: 'new', user: null, error: null });
});

router.post('/users/new', upload.single('photo'), async (req, res, next) => {
  try {
    const b = req.body;
    const username = String(b.username || '').trim().toLowerCase();
    const display_name = String(b.display_name || '').trim();
    const role = b.role === 'admin' ? 'admin' : 'tech';
    const bio = b.bio ? String(b.bio).trim() : null;
    const password = String(b.password || '');

    if (!usernameRe.test(username)) {
      return renderError('Username must be lowercase letters, digits, hyphens, or underscores. Min 2 characters, max 31.');
    }
    if (!display_name) return renderError('Display name is required.');
    if (password.length < 8) return renderError('Password must be at least 8 characters.');
    if (getUserByUsername(username)) return renderError('That username is already taken.');

    const password_hash = await hashPassword(password);
    const id = createUser({ username, display_name, role, password_hash, bio });

    if (req.file && req.file.size > 0) {
      const filename = await processAndPushPhoto(username, req.file.path);
      updateUser(id, { photo_filename: filename });
    }
    return res.redirect('/users');

    function renderError(message) {
      return res.status(400).render('user-form', {
        mode: 'new',
        user: { username, display_name, role, bio },
        error: message,
      });
    }
  } catch (err) {
    next(err);
  }
});

router.get('/users/:id/edit', (req, res) => {
  const user = getUser(Number(req.params.id));
  if (!user) return res.status(404).render('error', { message: 'User not found.' });
  res.render('user-form', { mode: 'edit', user, error: null });
});

router.post('/users/:id', upload.single('photo'), async (req, res, next) => {
  try {
    const user = getUser(Number(req.params.id));
    if (!user) return res.status(404).render('error', { message: 'User not found.' });

    const b = req.body;
    const patch = {};
    const display_name = String(b.display_name || '').trim();
    if (display_name) patch.display_name = display_name;
    if (b.role && (b.role === 'admin' || b.role === 'tech')) patch.role = b.role;
    if (typeof b.bio === 'string') patch.bio = b.bio.trim() || null;
    if (b.password) {
      if (String(b.password).length < 8) {
        return res.status(400).render('user-form', { mode: 'edit', user, error: 'Password must be at least 8 characters.' });
      }
      patch.password_hash = await hashPassword(b.password);
    }
    if (Object.keys(patch).length) updateUser(user.id, patch);

    if (req.file && req.file.size > 0) {
      const filename = await processAndPushPhoto(user.username, req.file.path);
      updateUser(user.id, { photo_filename: filename });
    }
    res.redirect('/users');
  } catch (err) {
    next(err);
  }
});

router.post('/users/:id/delete', (req, res) => {
  const user = getUser(Number(req.params.id));
  if (!user) return res.status(404).render('error', { message: 'User not found.' });
  if (user.id === req.user.id) {
    return res.status(400).render('error', { message: "You can't delete the account you're logged in with." });
  }
  deleteUser(user.id);
  res.redirect('/users');
});

// Resize the uploaded image, drop into the static-site repo at
// images/team/<username>.webp, commit + push so the avatar is
// reachable from project pages immediately. Returns the filename so
// the DB column tracks what's currently on the live site.
async function processAndPushPhoto(username, srcPath) {
  const siteRepo = process.env.SITE_REPO_PATH;
  const branch   = process.env.SITE_REPO_BRANCH || 'master';
  const push     = process.env.SITE_REPO_PUSH !== 'false';
  if (!siteRepo) throw new Error('SITE_REPO_PATH is not set');

  await syncSiteRepo({ siteRepoPath: siteRepo, branch });

  const filename = `${username}.webp`;
  const destDir  = join(siteRepo, 'images', 'team');
  mkdirSync(destDir, { recursive: true });
  const destPath = join(destDir, filename);
  await resizeAvatar(srcPath, destPath);

  await commitAndPush({
    siteRepoPath: siteRepo,
    branch,
    files: [`images/team/${filename}`],
    message: `Update team photo: ${username}`,
    push,
  });
  return filename;
}

export default router;
