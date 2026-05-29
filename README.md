# MWW Project Page Dashboard

Mobile-first Node app that lets a tech submit a completed-job report
(address, photos, price, short description, customer review) and have it
turned into a SOP-compliant static project page, with the matching
spoke-page "Recent Projects" tile + the sitemap + the footer column all
updated and pushed to the `mywindowwashing` repo for cPanel to pull.

Built to be deployed on a separate VPS — it never serves the public site
itself, it only edits the static-site repo and runs `git push`.

---

## Stack

- Node 20+ / Express
- SQLite (`better-sqlite3`) for the project log
- Handlebars for both the dashboard UI and the project-page template
- `sharp` for phone-photo → 1200×800 .webp conversion
- `cheerio` for safe DOM edits to spoke pages
- `simple-git` for commit + push
- Anthropic SDK (Claude) for narrative generation from bullet notes
- One shared crew password (MVP) — session cookie

## Repo layout

```
src/
  server.js               Express bootstrap
  routes/
    auth.js               /login, /logout
    projects.js           dashboard, form, preview
    publish.js            render → spoke patch → sitemap → commit + push
  lib/
    db.js                 sqlite schema + queries
    slug.js               SERVICES, cities loader, slug builder
    photos.js             sharp resize to 1200×800 webp
    narrative.js          Claude API call w/ SOP-derived system prompt
    render.js             Handlebars view assembly + JSON-LD schema
    spoke-update.js       cheerio edits to <city>.html
    sitemap.js            append/refresh sitemap.xml entry
    git.js                simple-git commit + retrying push
  middleware/auth.js
  views/                  express-handlebars dashboard UI
templates/
  project-page.hbs        the canonical SOP project page, parameterised
scripts/
  build-cities.js         one-time scan of the static site → cities.json
data/
  cities.json             city → hub mapping (generated)
  projects.db             sqlite log (ignored from git)
tmp/                      working space for uploads + staged webps
```

## First-time setup

```bash
git clone <this repo>
cd mww-new-projects-app
cp .env.example .env
# edit .env — set DASHBOARD_PASSWORD, ANTHROPIC_API_KEY, SITE_REPO_PATH
npm install

# Clone the mywindowwashing repo somewhere SITE_REPO_PATH points at.
git clone git@github.com:d-g-websites/mywindowwashing.git /srv/mywindowwashing

# Build the city → hub lookup by scanning spoke pages for which hub
# phone number each one uses. Rerun whenever spoke pages are added or
# hub assignments change.
npm run build-cities

# Launch.
npm start
```

The app listens on `PORT` (default 3000). Put it behind a TLS reverse
proxy (caddy / nginx / cloudflare tunnel) so the crew can hit it from
their phones without staring at a cert warning.

## How a submission flows

1. `GET /login` → tech types the shared password.
2. `GET /new` → mobile-first form with `<input capture="environment">`
   for before / after photos.
3. `POST /new` →
   - validates service + city,
   - builds slug per SOP `[service]-[city]-il`,
   - checks the slug doesn't already exist in the DB or the static-site
     repo. On collision, the form re-renders with a prompt to add a
     one-word descriptor.
   - resizes both photos to 1200×800 `.webp` in `tmp/staged/<slug>/`,
   - calls Claude with the SOP narrative rules baked into the system
     prompt, returns two paragraphs,
   - writes a draft row to SQLite,
   - redirects to `/projects/:id/preview`.
4. `GET /projects/:id/preview` → the tech can edit the narrative
   inline and previews the rendered page in an iframe (images 404
   because they're not in the site repo yet — that's expected).
5. `POST /projects/:id/publish` →
   - renders the final `projects/<slug>.html` and writes it into the
     `mywindowwashing` repo,
   - copies the staged webps into `projects/img/`,
   - patches the matching spoke page: replaces the first
     `.project-card` whose tag matches the new service and still says
     "Coming soon", or prepends a new card and trims to 3,
   - patches the footer "Recent Projects" column,
   - appends/refreshes the sitemap.xml entry at priority 0.6,
   - commits as `MWW Dashboard <…>` and pushes to `SITE_REPO_BRANCH`,
   - flips the row to `status='published'`.

cPanel pulls from that branch on its own schedule, or via a webhook the
user sets up server-side.

## Decisions captured from the handoff

- **Single repo for the app**, separate from the static site.
- **Single shared crew password** — per-tech accounts are out of scope.
- **Phone-photo capture** via `<input type="file" accept="image/*"
  capture="environment">`. We resize server-side; we don't trust the
  client to ship the right dimensions.
- **City picker is a dropdown** of existing spoke pages — no geocoding.
- **Cities → hub mapping is derived** by scanning each spoke page for
  which hub phone number it uses (see `scripts/build-cities.js`). The
  SOP only documents Northbrook and Chicago hubs, so any spoke page
  that uses neither phone falls into `unmapped` in `cities.json` and
  needs a manual entry.
- **Slug collision** prompts the tech for a one-word descriptor and
  rebuilds the slug as `[service]-[city]-il-<descriptor>`.
- **Recent Projects tile update** uses cheerio DOM editing, not regex:
  first matching service + "Coming soon" placeholder gets replaced;
  otherwise prepend + drop oldest of 3.
- **Related Projects** on a new page = the 3 most-recently published
  projects from a different city or service, pulled from SQLite.
- **Narrative copy**: tech enters bullets → Claude expands per the SOP
  rules baked into the system prompt → tech reviews / edits before
  publishing. The Anthropic system prompt is `cache_control`-marked so
  we don't pay for the rulebook on every submission.

## cPanel side

The handoff says cPanel pulls from the branch via either a cron `git
pull` or a post-receive hook into `public_html`. That's out of scope for
this repo — it lives on the cPanel host.

## Env reference

See `.env.example`. The only two you _must_ set for the app to start
are `DASHBOARD_PASSWORD` and `SESSION_SECRET`. To actually publish you
also need `ANTHROPIC_API_KEY`, `SITE_REPO_PATH`, and a `cities.json`
generated by `npm run build-cities`.
