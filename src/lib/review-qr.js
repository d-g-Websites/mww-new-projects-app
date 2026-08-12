// Hub Google-review URLs live in the settings table so the admin can
// edit them through the UI without a deploy. Key shape:
//   review_url_<hubKey>   e.g.  review_url_arlington-heights

import { getSetting, setSetting } from './db.js';
import { loadCities } from './slug.js';

function key(hubKey) { return `review_url_${hubKey}`; }

export function getHubReviewUrl(hubKey) {
  return getSetting(key(hubKey)) || '';
}

export function setHubReviewUrl(hubKey, url) {
  setSetting(key(hubKey), (url || '').trim());
}

// Returns [{ key, name, url, configured }] for every configured hub,
// in display order (alphabetical, matching the cities.json order).
export function listHubsWithReviewUrls() {
  const hubs = loadCities().hubs;
  return Object.entries(hubs).map(([k, h]) => {
    const url = getHubReviewUrl(k);
    return {
      key: k,
      name: h.name,
      city: h.addressCity || '',
      url,
      configured: Boolean(url),
    };
  });
}
