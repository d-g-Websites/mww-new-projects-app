// YouTube Data API v3 integration — OAuth connect + resumable upload.
//
// Auth model: the admin connects the company YouTube channel ONCE via
// /youtube/connect. Google hands back a refresh token which we store
// in the settings table. From then on every upload (by any logged-in
// user) runs under that channel — no per-tech YouTube logins.
//
// Upload model: the file lands on the VPS via multer, we open a
// resumable-upload session with YouTube, stream the file straight
// from disk, then delete the temp file. Nothing video-sized is kept.

import { createReadStream, statSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { getSetting, setSetting, deleteSetting } from './db.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth';
const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
const SCOPE = 'https://www.googleapis.com/auth/youtube.upload';

const SETTING_KEY = 'youtube_refresh_token';

function clientId()     { return process.env.YOUTUBE_CLIENT_ID; }
function clientSecret() { return process.env.YOUTUBE_CLIENT_SECRET; }
function redirectUri()  {
  return process.env.YOUTUBE_REDIRECT_URI
    || `${(process.env.DASHBOARD_BASE_URL || '').replace(/\/$/, '')}/youtube/callback`;
}

export function isConfigured() {
  return Boolean(clientId() && clientSecret());
}

export function isConnected() {
  return isConfigured() && Boolean(getSetting(SETTING_KEY));
}

export function disconnect() {
  deleteSetting(SETTING_KEY);
  cachedAccess = null;
}

// Step 1 of the connect flow: where to send the admin's browser.
// access_type=offline + prompt=consent forces Google to issue a
// refresh token even if the account approved this app before.
export function getAuthUrl() {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
  });
  return `${AUTH_URL}?${params}`;
}

// Step 2: Google redirected back with ?code= — trade it for tokens
// and persist the refresh token.
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
  if (!res.ok) {
    throw new Error(`YouTube token exchange failed: ${data.error_description || data.error || res.status}`);
  }
  if (!data.refresh_token) {
    throw new Error('Google did not return a refresh token. Remove the app at https://myaccount.google.com/permissions and connect again.');
  }
  setSetting(SETTING_KEY, data.refresh_token);
  cachedAccess = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
}

// Access tokens last ~1h; cache in memory and refresh on demand.
let cachedAccess = null;

async function getAccessToken() {
  if (cachedAccess && cachedAccess.expiresAt > Date.now()) return cachedAccess.token;
  const refreshToken = getSetting(SETTING_KEY);
  if (!refreshToken) throw new Error('YouTube is not connected. An admin needs to visit /youtube/connect first.');
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
    // invalid_grant = token revoked/expired — wipe it so the UI shows
    // "reconnect" instead of failing every upload the same way.
    if (data.error === 'invalid_grant') disconnect();
    throw new Error(`YouTube token refresh failed: ${data.error_description || data.error || res.status}`);
  }
  cachedAccess = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedAccess.token;
}

// Resumable upload: open the session (metadata first), then PUT the
// file bytes from disk. Returns { videoId, url }.
export async function uploadVideo({ filePath, mimeType, title, description, tags = [], privacyStatus = 'public' }) {
  const accessToken = await getAccessToken();
  const size = statSync(filePath).size;

  const metadata = {
    snippet: {
      title: String(title).slice(0, 100),       // YouTube hard limit
      description: String(description || '').slice(0, 5000),
      tags: tags.slice(0, 30),
      categoryId: '22',                          // People & Blogs (closest fit for local-service jobs)
    },
    status: {
      privacyStatus,
      selfDeclaredMadeForKids: false,
    },
  };

  const init = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(size),
      'X-Upload-Content-Type': mimeType || 'video/*',
    },
    body: JSON.stringify(metadata),
  });
  if (!init.ok) {
    const body = await init.text();
    throw new Error(`YouTube upload session failed (${init.status}): ${body.slice(0, 300)}`);
  }
  const sessionUrl = init.headers.get('location');
  if (!sessionUrl) throw new Error('YouTube did not return a resumable-upload URL.');

  // PUT the bytes with node:https directly — fetch() switches stream
  // bodies to chunked transfer-encoding, which Google's resumable
  // endpoint can reject. https.request sends the exact Content-Length.
  const put = await putFileStream(sessionUrl, filePath, size, mimeType || 'video/*');
  let result = {};
  try { result = JSON.parse(put.body); } catch { /* non-JSON error body */ }
  if (put.status < 200 || put.status >= 300 || !result.id) {
    throw new Error(`YouTube upload failed (${put.status}): ${put.body.slice(0, 300)}`);
  }
  return {
    videoId: result.id,
    url: `https://www.youtube.com/watch?v=${result.id}`,
  };
}

function putFileStream(sessionUrl, filePath, size, contentType) {
  return new Promise((resolve, reject) => {
    const u = new URL(sessionUrl);
    const req = httpsRequest({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'PUT',
      headers: {
        'Content-Length': size,
        'Content-Type': contentType,
      },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.pipe(req);
  });
}
