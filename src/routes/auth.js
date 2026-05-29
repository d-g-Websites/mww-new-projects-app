import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';

const router = Router();

router.get('/login', (req, res) => {
  res.render('login', { layout: false, error: null });
});

router.post('/login', (req, res) => {
  const expected = process.env.DASHBOARD_PASSWORD || '';
  const given = String(req.body.password || '');
  if (!expected) {
    return res.status(500).send('DASHBOARD_PASSWORD not configured');
  }
  if (safeEquals(given, expected)) {
    req.session.authed = true;
    return res.redirect('/');
  }
  res.status(401).render('login', { layout: false, error: 'Wrong password' });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// Constant-time compare to avoid trivial timing leaks on the shared password.
function safeEquals(a, b) {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  if (A.length !== B.length) return false;
  return timingSafeEqual(A, B);
}

export default router;
