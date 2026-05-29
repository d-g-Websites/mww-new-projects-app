// Single shared password — MVP per the handoff. Per-user accounts are
// out of scope; we just want the crew to log in once on their phone and
// stay logged in for the day.

export function requireAuth(req, res, next) {
  if (req.session?.authed) return next();
  if (req.method === 'GET') return res.redirect('/login');
  return res.status(401).json({ error: 'not authenticated' });
}
