// Per-user authentication. Session stores userId; the middleware
// loads the row from `users` on every request and attaches it to
// req.user + res.locals.currentUser (so the layout can show the name).
//
// requireAuth bounces unauthenticated requests to /login.
// requireAdmin additionally rejects non-admin users.

import { getUser } from '../lib/db.js';

export function loadUser(req, res, next) {
  if (req.session?.userId) {
    const u = getUser(req.session.userId);
    if (u) {
      req.user = u;
      res.locals.currentUser = {
        id: u.id,
        username: u.username,
        display_name: u.display_name,
        role: u.role,
        photo_filename: u.photo_filename,
      };
    } else {
      // Session points at a user that no longer exists — drop it.
      req.session.userId = null;
    }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.method === 'GET') return res.redirect('/login');
  return res.status(401).json({ error: 'not authenticated' });
}

export function requireAdmin(req, res, next) {
  if (req.user?.role === 'admin') return next();
  return res.status(403).render('error', { message: 'Admin access required.' });
}
