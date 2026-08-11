// Publishes captions + photos to connected social accounts via the
// Zernio API (https://docs.zernio.com). Wired for Facebook, Instagram,
// and LinkedIn. Silent no-op per-platform when that platform's account
// id isn't configured, mirroring lib/telegram.js so dev environments
// don't need Zernio credentials.

const API  = 'https://zernio.com/api/v1';
const KEY  = () => process.env.ZERNIO_API_KEY || '';
const FB_ACCT = () => process.env.ZERNIO_ACCOUNT_ID || '';            // Facebook (kept name for back-compat)
const IG_ACCT = () => process.env.ZERNIO_INSTAGRAM_ACCOUNT_ID || '';
const LI_ACCT = () => process.env.ZERNIO_LINKEDIN_ACCOUNT_ID || '';
const FB_PAGE = () => process.env.ZERNIO_FACEBOOK_PAGE_ID || '';

// Core call: publish `content` (+ optional photos) to one connected
// account. Returns { ok } / { skipped } / { ok:false, error } — never
// throws. photoUrls are public HTTPS image URLs (<=4MB each, no
// redirects; Zernio auto-converts WebP -> JPEG); up to 10 per post.
async function postToZernio({ platform, accountId, content, photoUrls = [], platformSpecificData }) {
  if (!KEY() || !accountId) {
    console.log(`[zernio] not configured for ${platform} (need ZERNIO_API_KEY + account id), skipping`);
    return { skipped: true };
  }

  const p = { platform, accountId };
  if (platformSpecificData) p.platformSpecificData = platformSpecificData;

  const body = { content, publishNow: true, platforms: [p] };
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
      console.error(`[zernio] ${platform} publish failed:`, res.status, JSON.stringify(data));
      return { ok: false, status: res.status, error: data.error || data.message || `HTTP ${res.status}` };
    }
    return { ok: true, id: data.id || data._id, data };
  } catch (err) {
    console.error(`[zernio] ${platform} error:`, err.message);
    return { ok: false, error: err.message };
  }
}

export async function publishToFacebook(content, photoUrls = []) {
  return postToZernio({
    platform: 'facebook',
    accountId: FB_ACCT(),
    content,
    photoUrls,
    platformSpecificData: FB_PAGE() ? { pageId: FB_PAGE() } : undefined,
  });
}

export async function publishToInstagram(content, photoUrls = []) {
  // Instagram requires at least one image — there is no text-only post.
  if (!(photoUrls || []).filter(Boolean).length) {
    return { ok: false, error: 'Instagram needs at least one photo.' };
  }
  return postToZernio({ platform: 'instagram', accountId: IG_ACCT(), content, photoUrls });
}

export async function publishToLinkedIn(content, photoUrls = []) {
  return postToZernio({ platform: 'linkedin', accountId: LI_ACCT(), content, photoUrls });
}
