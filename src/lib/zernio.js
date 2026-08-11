// Publishes captions + photos to connected social accounts via the
// Zernio API (https://docs.zernio.com). Wired for the Facebook Page.
// Silent no-op when unconfigured, mirroring lib/telegram.js so dev
// environments don't need Zernio credentials.

const API  = 'https://zernio.com/api/v1';
const KEY  = () => process.env.ZERNIO_API_KEY || '';
const ACCT = () => process.env.ZERNIO_ACCOUNT_ID || '';
const PAGE = () => process.env.ZERNIO_FACEBOOK_PAGE_ID || '';

// Publish a post to the connected Facebook Page.
//   content   : full post text (caption + hashtags)
//   photoUrls : public HTTPS image URLs (<=4MB each, no redirects; Zernio
//               auto-converts WebP -> JPEG). Up to 10 per post.
// Returns { ok } / { skipped } / { ok:false, error } — never throws.
export async function publishToFacebook(content, photoUrls = []) {
  if (!KEY() || !ACCT()) {
    console.log('[zernio] not configured (set ZERNIO_API_KEY + ZERNIO_ACCOUNT_ID), skipping');
    return { skipped: true };
  }

  const platform = { platform: 'facebook', accountId: ACCT() };
  if (PAGE()) platform.platformSpecificData = { pageId: PAGE() };

  const body = { content, publishNow: true, platforms: [platform] };
  const media = (photoUrls || []).filter(Boolean).map(url => ({ type: 'image', url }));
  if (media.length) body.mediaItems = media;

  try {
    const res = await fetch(`${API}/posts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${KEY()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[zernio] publish failed:', res.status, JSON.stringify(data));
      return { ok: false, status: res.status, error: data.error || data.message || `HTTP ${res.status}` };
    }
    return { ok: true, id: data.id || data._id, data };
  } catch (err) {
    console.error('[zernio] error:', err.message);
    return { ok: false, error: err.message };
  }
}
