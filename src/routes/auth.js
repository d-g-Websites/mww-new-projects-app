import { Router } from 'express';
import { getUserByUsername, countUsers, createUser } from '../lib/db.js';
import { hashPassword, verifyPassword } from '../lib/auth.js';

const router = Router();

// One-time bootstrap of an admin account from DASHBOARD_PASSWORD on
// the very first boot when the users table is empty. Lets existing
// installs migrate without manual SQL — once the admin logs in, they
// can add techs from the dashboard. After the bootstrap completes,
// DASHBOARD_PASSWORD has no further effect.
async function ensureBootstrapAdmin() {
  if (countUsers() > 0) return;
  const pw = process.env.DASHBOARD_PASSWORD;
  if (!pw) {
    console.warn('[auth] users table empty + DASHBOARD_PASSWORD not set — no bootstrap admin will be created. Set the env var and restart to bootstrap.');
    return;
  }
  await createUser({
    username: 'admin',
    display_name: 'Admin',
    role: 'admin',
    password_hash: await hashPassword(pw),
  });
  console.log('[auth] bootstrapped admin user from DASHBOARD_PASSWORD');
}
ensureBootstrapAdmin().catch(err => console.error('[auth] bootstrap failed:', err));

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { layout: false, error: null });
});

router.post('/login', async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!username || !password) {
    return res.status(400).render('login', { layout: false, error: 'Username and password required' });
  }
  const user = getUserByUsername(username);
  if (!user) {
    return res.status(401).render('login', { layout: false, error: 'Wrong username or password' });
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    return res.status(401).render('login', { layout: false, error: 'Wrong username or password' });
  }
  req.session.userId = user.id;
  res.redirect('/');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

export default router;
