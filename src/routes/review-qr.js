// Review-QR page — techs pick the closest hub from a dropdown and
// show a giant QR code on their phone screen for the customer to
// scan. The QR points at that hub's Google review URL so the
// review lands on the right Business Profile.
//
// /review-qr           main picker (any logged-in user)
// /review-qr/setup     admin: enter / edit the URL per hub
// /review-qr/setup     POST to save

import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { listHubsWithReviewUrls, setHubReviewUrl } from '../lib/review-qr.js';
import { db } from '../lib/db.js';

const router = Router();

// Pick the most recent project the current user filed and use its
// hub as the default selection — most of the time a tech ends up
// asking for a review for the job they just finished entering.
function lastUsedHub(userId) {
  if (!userId) return null;
  const row = db.prepare(`
    SELECT hub FROM projects WHERE submitted_by = ?
     ORDER BY created_at DESC LIMIT 1
  `).get(userId);
  return row ? row.hub : null;
}

router.get('/review-qr', requireAuth, (req, res) => {
  const hubs = listHubsWithReviewUrls();
  const defaultHub = lastUsedHub(req.user.id) || (hubs.find(h => h.configured) || hubs[0])?.key;
  res.render('review-qr', {
    hubs,
    defaultHub,
    anyConfigured: hubs.some(h => h.configured),
    isAdmin: req.user.role === 'admin',
  });
});

router.get('/review-qr/setup', requireAuth, requireAdmin, (req, res) => {
  res.render('review-qr-setup', {
    hubs: listHubsWithReviewUrls(),
    notice: req.query.notice,
  });
});

router.post('/review-qr/setup', requireAuth, requireAdmin, (req, res) => {
  const b = req.body || {};
  for (const hub of listHubsWithReviewUrls()) {
    const field = `url_${hub.key}`;
    if (Object.prototype.hasOwnProperty.call(b, field)) {
      setHubReviewUrl(hub.key, b[field]);
    }
  }
  res.redirect('/review-qr/setup?notice=' + encodeURIComponent('Saved.'));
});

export default router;
