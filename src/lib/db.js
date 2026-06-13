import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = process.env.DATABASE_PATH || 'data/projects.db';
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    slug            TEXT UNIQUE NOT NULL,
    service         TEXT NOT NULL,         -- "window-washing" | "gutter-cleaning" | ...
    service_label   TEXT NOT NULL,         -- "Window Washing"
    city_slug       TEXT NOT NULL,         -- "northbrook"
    city_name       TEXT NOT NULL,         -- "Northbrook"
    hub             TEXT NOT NULL,         -- "northbrook" | "chicago"
    address         TEXT,                  -- street address (job site, internal)
    home_type       TEXT,                  -- "Two-Story Colonial"
    metric_value    TEXT,                  -- "24"
    metric_label    TEXT,                  -- "Windows Cleaned"
    price           TEXT,                  -- "$290"
    challenge       TEXT,                  -- short notable challenge
    review_text     TEXT,
    customer_name   TEXT,
    review_date     TEXT,                  -- YYYY-MM-DD
    narrative       TEXT,                  -- full HTML/text of 2 paragraphs
    before_photo    TEXT,                  -- relative path under projects/img/
    after_photo     TEXT,
    extras          TEXT,                  -- service-specific JSON (window types, screen counts, etc.)
    status          TEXT NOT NULL DEFAULT 'draft', -- draft | published
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    published_at    TEXT
  );

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    display_name  TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'tech',     -- 'admin' | 'tech'
    password_hash TEXT NOT NULL,
    photo_filename TEXT,                            -- e.g. "mike.webp"; URL constructed from this
    bio           TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_projects_status_pub
    ON projects(status, published_at DESC);
  CREATE INDEX IF NOT EXISTS idx_projects_city
    ON projects(city_slug);
  CREATE INDEX IF NOT EXISTS idx_projects_service
    ON projects(service);
`);

// Idempotent migrations for installs that predate later columns.
function ensureColumn(name, decl) {
  const cols = db.prepare('PRAGMA table_info(projects)').all().map(c => c.name);
  if (!cols.includes(name)) {
    db.exec(`ALTER TABLE projects ADD COLUMN ${name} ${decl}`);
  }
}
ensureColumn('extras', 'TEXT');
ensureColumn('extra_photos', 'TEXT');  // JSON array of full webp paths under tmp/staged
ensureColumn('review_url', 'TEXT');    // Google / Yelp link if review text isn't pasted
ensureColumn('bullet_facts', 'TEXT');  // raw notes the tech typed (kept for narrative retries)
ensureColumn('customer_note', 'TEXT');
ensureColumn('street', 'TEXT');        // route (street name only, no house number) from Places
ensureColumn('spoke_slug', 'TEXT');    // which spoke page to patch (differs from city_slug when nearest-spoke fallback fired)
ensureColumn('address_lat', 'REAL');   // job address lat/lng from Google Places, for nearby-town context
ensureColumn('address_lng', 'REAL');
ensureColumn('video_url', 'TEXT');     // optional YouTube / Vimeo URL the tech pastes
ensureColumn('faq', 'TEXT');           // JSON array of {q, a} pairs for FAQPage schema + on-page section
ensureColumn('submitted_by', 'INTEGER'); // FK to users.id — who entered this project

export function insertDraft(row) {
  // extras can come in as a plain object — JSON-stringify here so callers
  // don't have to remember.
  const extras = row.extras && typeof row.extras === 'object'
    ? JSON.stringify(row.extras)
    : (row.extras || null);
  const extraPhotos = Array.isArray(row.extra_photos)
    ? JSON.stringify(row.extra_photos)
    : (row.extra_photos || null);
  const stmt = db.prepare(`
    INSERT INTO projects (
      slug, service, service_label, city_slug, city_name, hub,
      address, home_type, metric_value, metric_label, price, challenge,
      review_text, customer_name, review_date, review_url,
      narrative, before_photo, after_photo, extras, extra_photos,
      bullet_facts, customer_note, street, spoke_slug,
      address_lat, address_lng, video_url, submitted_by
    ) VALUES (
      @slug, @service, @service_label, @city_slug, @city_name, @hub,
      @address, @home_type, @metric_value, @metric_label, @price, @challenge,
      @review_text, @customer_name, @review_date, @review_url,
      @narrative, @before_photo, @after_photo, @extras, @extra_photos,
      @bullet_facts, @customer_note, @street, @spoke_slug,
      @address_lat, @address_lng, @video_url, @submitted_by
    )
  `);
  const info = stmt.run({
    bullet_facts: null,
    customer_note: null,
    street: null,
    spoke_slug: null,
    address_lat: null,
    address_lng: null,
    video_url: null,
    submitted_by: null,
    ...row,
    extras,
    extra_photos: extraPhotos,
  });
  return info.lastInsertRowid;
}

// Parse JSON columns back to objects on read. Returns {} / [] when
// missing so callers can dereference without null checks.
export function parseExtras(row) {
  if (!row) return row;
  const out = { ...row };
  out.extras = row.extras ? safeParse(row.extras, {}) : {};
  out.extra_photos = row.extra_photos ? safeParse(row.extra_photos, []) : [];
  out.faq = row.faq ? safeParse(row.faq, []) : [];
  return out;
}

function safeParse(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

export function updateDraft(id, patch) {
  const fields = Object.keys(patch);
  if (fields.length === 0) return;
  const set = fields.map(f => `${f} = @${f}`).join(', ');
  db.prepare(`UPDATE projects SET ${set} WHERE id = @id`).run({ ...patch, id });
}

export function getProject(id) {
  return parseExtras(db.prepare('SELECT * FROM projects WHERE id = ?').get(id));
}

export function getProjectBySlug(slug) {
  return parseExtras(db.prepare('SELECT * FROM projects WHERE slug = ?').get(slug));
}

export function markPending(id) {
  db.prepare(`
    UPDATE projects
       SET status = 'pending'
     WHERE id = ?
  `).run(id);
}

export function markPublished(id) {
  db.prepare(`
    UPDATE projects
       SET status = 'published',
           published_at = datetime('now')
     WHERE id = ?
  `).run(id);
}

export function deleteProject(id) {
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
}

export function listPending({ limit = 50 } = {}) {
  return db.prepare(`
    SELECT projects.*, users.display_name AS submitted_by_name
      FROM projects
      LEFT JOIN users ON users.id = projects.submitted_by
     WHERE projects.status = 'pending'
     ORDER BY projects.created_at DESC
     LIMIT ?
  `).all(limit).map(parseExtras);
}

export function listDrafts({ limit = 50 } = {}) {
  return db.prepare(`
    SELECT projects.*, users.display_name AS submitted_by_name
      FROM projects
      LEFT JOIN users ON users.id = projects.submitted_by
     WHERE projects.status = 'draft'
     ORDER BY projects.created_at DESC
     LIMIT ?
  `).all(limit).map(parseExtras);
}

export function listPublished({ limit = 20, excludeId = null } = {}) {
  if (excludeId) {
    return db.prepare(`
      SELECT projects.*, users.display_name AS submitted_by_name
        FROM projects
        LEFT JOIN users ON users.id = projects.submitted_by
       WHERE projects.status = 'published' AND projects.id != ?
       ORDER BY projects.published_at DESC
       LIMIT ?
    `).all(excludeId, limit).map(parseExtras);
  }
  return db.prepare(`
    SELECT projects.*, users.display_name AS submitted_by_name
      FROM projects
      LEFT JOIN users ON users.id = projects.submitted_by
     WHERE projects.status = 'published'
     ORDER BY projects.published_at DESC
     LIMIT ?
  `).all(limit).map(parseExtras);
}

// Every published project, newest first. Powers /projects/index.html.
export function listPublishedAll() {
  return db.prepare(`
    SELECT * FROM projects
     WHERE status = 'published'
     ORDER BY published_at DESC
  `).all().map(parseExtras);
}

// Every published project for a given spoke (matching spoke_slug, or
// matching city_slug for drafts that predate the spoke_slug column).
// Powers /projects/<spoke>.html.
export function listPublishedBySpoke(spokeSlug) {
  return db.prepare(`
    SELECT * FROM projects
     WHERE status = 'published'
       AND (spoke_slug = ? OR (spoke_slug IS NULL AND city_slug = ?))
     ORDER BY published_at DESC
  `).all(spokeSlug, spokeSlug).map(parseExtras);
}

// Every published project for a given service value (window-cleaning,
// gutter-cleaning, power-washing). Powers /projects/<service>.html.
export function listPublishedByService(serviceValue) {
  return db.prepare(`
    SELECT * FROM projects
     WHERE status = 'published' AND service = ?
     ORDER BY published_at DESC
  `).all(serviceValue).map(parseExtras);
}

// Distinct spoke slugs that have at least one published project. Used
// to know which per-spoke archive pages should currently exist.
export function listSpokesWithPublished() {
  return db.prepare(`
    SELECT DISTINCT COALESCE(spoke_slug, city_slug) AS spoke_slug
      FROM projects
     WHERE status = 'published'
       AND COALESCE(spoke_slug, city_slug) IS NOT NULL
  `).all().map(r => r.spoke_slug);
}

// Distinct service values that have at least one published project.
export function listServicesWithPublished() {
  return db.prepare(`
    SELECT DISTINCT service
      FROM projects
     WHERE status = 'published'
  `).all().map(r => r.service);
}

// 3 most-recent published projects from a different city OR different service.
// Used for the "Related Projects" section on a new page.
export function relatedProjects({ excludeId, citySlug, service, limit = 3 }) {
  return db.prepare(`
    SELECT * FROM projects
     WHERE status = 'published'
       AND id != ?
       AND (city_slug != ? OR service != ?)
     ORDER BY published_at DESC
     LIMIT ?
  `).all(excludeId, citySlug, service, limit);
}

export function slugExists(slug) {
  return !!db.prepare('SELECT 1 FROM projects WHERE slug = ?').get(slug);
}

// ── Users ────────────────────────────────────────────────────────────

export function listUsers() {
  return db.prepare('SELECT id, username, display_name, role, photo_filename, bio, created_at FROM users ORDER BY display_name').all();
}

export function getUser(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

export function createUser({ username, display_name, role, password_hash, photo_filename = null, bio = null }) {
  const info = db.prepare(`
    INSERT INTO users (username, display_name, role, password_hash, photo_filename, bio)
    VALUES (@username, @display_name, @role, @password_hash, @photo_filename, @bio)
  `).run({ username, display_name, role, password_hash, photo_filename, bio });
  return info.lastInsertRowid;
}

export function updateUser(id, patch) {
  const fields = Object.keys(patch);
  if (fields.length === 0) return;
  const set = fields.map(f => `${f} = @${f}`).join(', ');
  db.prepare(`UPDATE users SET ${set}, updated_at = datetime('now') WHERE id = @id`).run({ ...patch, id });
}

export function deleteUser(id) {
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

export function countUsers() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

// ── Settings (key/value) ─────────────────────────────────────────────
// Small server-side config that shouldn't live in .env because the app
// writes it at runtime — e.g. the YouTube OAuth refresh token.

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(key, value);
}

export function deleteSetting(key) {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}
