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
      review_text, customer_name, review_date,
      narrative, before_photo, after_photo, extras, extra_photos
    ) VALUES (
      @slug, @service, @service_label, @city_slug, @city_name, @hub,
      @address, @home_type, @metric_value, @metric_label, @price, @challenge,
      @review_text, @customer_name, @review_date,
      @narrative, @before_photo, @after_photo, @extras, @extra_photos
    )
  `);
  const info = stmt.run({ ...row, extras, extra_photos: extraPhotos });
  return info.lastInsertRowid;
}

// Parse JSON columns back to objects on read. Returns {} / [] when
// missing so callers can dereference without null checks.
export function parseExtras(row) {
  if (!row) return row;
  const out = { ...row };
  out.extras = row.extras ? safeParse(row.extras, {}) : {};
  out.extra_photos = row.extra_photos ? safeParse(row.extra_photos, []) : [];
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

export function markPublished(id) {
  db.prepare(`
    UPDATE projects
       SET status = 'published',
           published_at = datetime('now')
     WHERE id = ?
  `).run(id);
}

export function listPublished({ limit = 20, excludeId = null } = {}) {
  if (excludeId) {
    return db.prepare(`
      SELECT * FROM projects
       WHERE status = 'published' AND id != ?
       ORDER BY published_at DESC
       LIMIT ?
    `).all(excludeId, limit);
  }
  return db.prepare(`
    SELECT * FROM projects
     WHERE status = 'published'
     ORDER BY published_at DESC
     LIMIT ?
  `).all(limit);
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
