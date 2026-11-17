// Google Search Console API — OAuth connect + the two reads the
// performance report needs: Search Analytics (clicks / impressions /
// position per page) and URL Inspection (is the page indexed?).
//
// A separate connection from YouTube: YouTube is tied to the company's
// brand channel, which has no Search Console access. This one is made
// by an admin signed in with the Google account that owns the site in
// Search Console. Same Google Cloud OAuth client; the callback comes
// back through /youtube/callback (already an authorized redirect URI)
// and is routed here by the `state` value.

import { randomBytes } from 'node:crypto';
import { getSetting, setSetting, deleteSetting } from './db.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPE     = 'https://www.googleapis.com/auth/webmasters.readonly';
const API_V3    = 'https://www.googleapis.com/webmasters/v3';
const INSPECT   = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect';

const TOKEN_KEY = 'gsc_refresh_token';
const SITE_KEY  = 'gsc_site_url';
export const STATE_PREFIX = 'gsc.';

// The public site the project pages live on. Used to pick the right
// Search Console property and to build URLs to inspect.
export const PUBLIC_SITE_URL = (process.env.PUBLIC_SITE_URL || 'https://www.mywindowwashing.com').replace(/\/$/, '');
const SITE_HOST = new URL(PUBLIC_SITE_URL).hostname.replace(/^www\./, '');

function clientId()     { return process.env.YOUTUBE_CLIENT_ID; }
function clientSecret() { return process.env.YOUTUBE_CLIENT_SECRET; }
function redirectUri()  {
  return process.env.YOUTUBE_REDIRECT_URI
    || `${(process.env.DASHBOARD_BASE_URL || '').replace(/\/$/, '')}/youtube/callback`;
}

export function isConfigured() { return Boolean(clientId() && clientSecret()); }
export function isConnected()  { return isConfigured() && Boolean(getSetting(TOKEN_KEY)); }
export function getSiteUrl()   { return getSetting(SITE_KEY); }
export function setSiteUrl(u)  { setSetting(SITE_KEY, u); }

export function disconnect() {
  deleteSetting(TOKEN_KEY);
  deleteSetting(SITE_KEY);
  cachedAccess = null;
}

// Returns { url, state }. The caller stores `state` in the session and
// checks it on the way back, so a forged callback can't attach someone
// else's Google account.
export function getAuthUrl() {
  const state = STATE_PREFIX + randomBytes(16).toString('hex');
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent select_account',
    state,
  });
  return { url: `${AUTH_URL}?${params}`, state };
}

export async function exchangeCode(code) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Search Console sign-in failed: ${data.error_description || data.error || res.status}`);
  if (!data.refresh_token) {
    throw new Error('Google did not return a refresh token. Remove the app at https://myaccount.google.com/permissions and connect again.');
  }
  setSetting(TOKEN_KEY, data.refresh_token);
  cachedAccess = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };

  // Pick the property for the public site automatically.
  const sites = await listSites();
  const site = pickSite(sites);
  if (!site) {
    disconnect();
    throw new Error(`This Google account has no Search Console access to ${SITE_HOST}. Connect with the account that owns the site in Search Console.`);
  }
  setSiteUrl(site);
}

let cachedAccess = null;

async function getAccessToken() {
  if (cachedAccess && cachedAccess.expiresAt > Date.now()) return cachedAccess.token;
  const refreshToken = getSetting(TOKEN_KEY);
  if (!refreshToken) throw new Error('Search Console is not connected.');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId(),
      client_secret: clientSecret(),
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    if (data.error === 'invalid_grant') disconnect();
    throw new Error(`Search Console token refresh failed: ${data.error_description || data.error || res.status}`);
  }
  cachedAccess = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedAccess.token;
}

async function api(url, { method = 'GET', body } = {}) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    // One stuck request must not freeze a whole refresh.
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Search Console request failed (${res.status})`);
    err.status = res.status;
    err.quota = res.status === 429 || /quota/i.test(data?.error?.message || '');
    throw err;
  }
  return data;
}

// Properties this Google account can read, usable ones only.
export async function listSites() {
  const data = await api(`${API_V3}/sites`);
  return (data.siteEntry || [])
    .filter(s => s.permissionLevel !== 'siteUnverifiedUser')
    .map(s => s.siteUrl);
}

// Prefer the Domain property (covers http/https and www/non-www), then
// the exact URL-prefix property, then anything on the same host.
export function pickSite(sites) {
  const host = SITE_HOST;
  return sites.find(s => s === `sc-domain:${host}`)
      || sites.find(s => s === `${PUBLIC_SITE_URL}/`)
      || sites.find(s => s.includes(host))
      || null;
}

// The URL Google should inspect for a project page. Must sit inside the
// property, so a URL-prefix property's own origin wins.
export function inspectionUrlFor(siteUrl, slug) {
  const origin = siteUrl && !siteUrl.startsWith('sc-domain:')
    ? siteUrl.replace(/\/$/, '')
    : PUBLIC_SITE_URL;
  return `${origin}/projects/${slug}`;
}

// Clicks / impressions / CTR / average position for every /projects/
// page between two dates (YYYY-MM-DD, Pacific time, inclusive).
export async function projectPageStats(siteUrl, startDate, endDate) {
  const rows = [];
  const pageSize = 25000;
  for (let startRow = 0; ; startRow += pageSize) {
    const data = await api(`${API_V3}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
      method: 'POST',
      body: {
        startDate, endDate,
        dimensions: ['page'],
        dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'contains', expression: '/projects/' }] }],
        rowLimit: pageSize,
        startRow,
      },
    });
    const batch = data.rows || [];
    rows.push(...batch.map(r => ({
      page: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position,
    })));
    if (batch.length < pageSize) break;
  }
  return rows;
}

// Google's index status for one URL.
export async function inspectUrl(siteUrl, inspectionUrl) {
  const data = await api(INSPECT, {
    method: 'POST',
    body: { inspectionUrl, siteUrl },
  });
  const r = data.inspectionResult || {};
  const s = r.indexStatusResult || {};
  return {
    verdict: s.verdict || null,            // PASS | NEUTRAL | FAIL | ...
    coverageState: s.coverageState || null, // e.g. "Crawled - currently not indexed"
    lastCrawlTime: s.lastCrawlTime || null,
    link: r.inspectionResultLink || null,
  };
}
