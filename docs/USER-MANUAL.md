# MWW Project-Page Dashboard

# User Manual

> A complete operator's guide for techs and admins using the dashboard
> at `project.mywindowwashing.com`. Covers every feature, every
> workflow, common errors, and the keyboard / phone tricks that make
> the day-to-day feel fast.

---

## Table of contents

1. [What the dashboard is for](#1-what-the-dashboard-is-for)
2. [Roles: tech vs admin](#2-roles-tech-vs-admin)
3. [Installing the dashboard on your phone (PWA)](#3-installing-the-dashboard-on-your-phone-pwa)
4. [Logging in](#4-logging-in)
5. [The dashboard home page](#5-the-dashboard-home-page)
6. [Tech workflow: submitting a completed job](#6-tech-workflow-submitting-a-completed-job)
   - 6.1 Picking the service
   - 6.2 Filling the form
   - 6.3 Photos
   - 6.4 Saving as a draft
   - 6.5 Sending for approval
7. [Admin workflow: reviewing and publishing](#7-admin-workflow-reviewing-and-publishing)
   - 7.1 The Telegram notification
   - 7.2 Previewing the page
   - 7.3 Publishing
   - 7.4 The cPanel deploy step
8. [Editing a published project](#8-editing-a-published-project)
9. [Deleting a published project](#9-deleting-a-published-project)
10. [Uploading a video to YouTube](#10-uploading-a-video-to-youtube)
    - 10.1 First-time YouTube channel connect
    - 10.2 The upload page
    - 10.3 Attaching the video to a project
11. [Creating social media posts](#11-creating-social-media-posts)
    - 11.1 Generating the captions
    - 11.2 Posting to Facebook
    - 11.3 Posting to Instagram
    - 11.4 Posting to LinkedIn
12. [Asking customers for Google reviews](#12-asking-customers-for-google-reviews)
    - 12.1 Setting up the review URLs (admin)
    - 12.2 Showing the QR code (tech)
13. [Managing the team](#13-managing-the-team)
14. [Common errors and what to do](#14-common-errors-and-what-to-do)
15. [Quick reference cheat sheet](#15-quick-reference-cheat-sheet)

---

## 1. What the dashboard is for

The dashboard exists for one purpose: **turning a finished job into a
polished project page on `mywindowwashing.com` in two minutes.**

Before the dashboard, every project page had to be hand-written, image-
edited, and committed to a repo — typically 30-60 minutes of office
time per job. Most jobs never became case studies because the cost was
too high.

The dashboard collapses that into:

- Tech fills a form on their phone after the job (90 seconds)
- Admin reviews the AI-written narrative + customer review and clicks
  Publish (60 seconds)
- The static-site repo gets a new HTML page, the spoke page (Naperville,
  Lisle, etc.) gets a fresh "Recent Projects" tile, the sitemap is
  updated, archive pages are regenerated, and everything is committed
  and pushed
- cPanel pulls the change with one deploy click and the page goes live

Add-on features built on top of that core flow:

- **YouTube video upload** with AI-written title and description, with
  the URL automatically embedded on the published project page.
- **Social media post helper** — AI writes Facebook, Instagram, and
  LinkedIn captions from the project's narrative; admin pastes and
  publishes.
- **Per-hub Google-review QR codes** — tech holds up the phone, customer
  scans, review lands on the right Business Profile.

Everything is mobile-first. Most of the work happens on phones.

---

## 2. Roles: tech vs admin

The dashboard has exactly two roles.

### Tech

A field technician who does jobs. On the dashboard a tech can:

- Submit new projects (forms 1-5, photos, customer review)
- See the drafts they personally filed and resume them
- See their submissions that are pending approval
- See the projects they submitted that have been published
- Upload videos to YouTube
- Create social-media post drafts (any published project)
- Show the per-hub Google-review QR code to customers

A tech **cannot**:

- See projects submitted by other techs
- Publish projects (only an admin can)
- Edit or delete projects after they're submitted
- Add or remove team members
- Connect the YouTube channel
- Set up the per-hub review URLs

### Admin

The office. On the dashboard an admin can do everything a tech can do
plus:

- See every project across the whole team
- Review tech submissions and publish them to the live site
- Edit a published project after the fact (narrative tweaks, photo
  swaps, video URL changes) and push the updates
- Delete a published project (removes the live page, photos, spoke
  tile, sitemap entry, archive entries — the whole footprint)
- Add and remove team members; set their photos
- Connect the company YouTube channel (one time)
- Set the Google-review short link for each hub (one time)
- Submit a project — **but only "on behalf of" a tech**, never under
  their own name. The form has a required dropdown at the top asking
  which tech did the job. The published page is then credited to that
  tech, not the admin.

### Why the "on behalf of" rule

Every published page shows a byline ("By Mike — Northbrook crew") with
that tech's photo. Customers reading the page want to see the human who
showed up at their house, not the office staff. The dashboard enforces
this so an admin can never accidentally publish a page with their own
name as the author.

---

## 3. Installing the dashboard on your phone (PWA)

The dashboard is a Progressive Web App — you can install it like a
native app, with its own icon on the home screen, no browser address bar,
and offline-friendly loading. **Do this first** if you'll be using the
dashboard in the field — it removes one tap on every visit.

### iPhone (Safari)

1. Open Safari and go to `project.mywindowwashing.com`
2. Tap the Share icon (square with up arrow) at the bottom of Safari
3. Scroll down and tap **Add to Home Screen**
4. Name it **MWW** (default) and tap **Add**

The MWW logo appears on your home screen. Launching it opens the
dashboard full-screen with no browser chrome.

### Android (Chrome)

1. Open Chrome and go to `project.mywindowwashing.com`
2. You'll see a banner: **Add MWW to Home screen** — tap it.
3. If you missed the banner, tap the three-dot menu (top right) →
   **Install app** or **Add to Home screen**

### Notes

- The icon is the My Window Washing brand logo with "PROJECTS" on top.
- iPhone respects the notch — the navy header bar sits below the
  Dynamic Island, no overlap.
- Login still uses your dashboard password (not your phone PIN). Once
  logged in, the session lasts 12 hours of activity.

---

## 4. Logging in

URL: `https://project.mywindowwashing.com/login`

Username + password are issued by the admin. Usernames are lowercase
(typically the tech's first name).

If you forget your password, ask the admin to reset it from the
team-management page. There is no "forgot password" email flow.

Sessions last 12 hours. If you've been logged in all day and the
dashboard suddenly bounces you to the login page, that's why.

---

## 5. The dashboard home page

After login, the home page (URL: `/`) is your starting point. It has
three or four cards stacked top to bottom:

### Submit a completed job (everyone)

Two buttons:
- **+ New project** — start a brand-new project submission
- **Upload a video to YouTube** — the standalone video uploader
- **Ask for a Google review** — opens the QR code page

### Your drafts (if any)

Projects you started filling out but haven't yet sent for approval.
Each shows the service, city, when you started, and two buttons:

- **Resume** — pick up where you left off
- **Discard** — delete the draft. Confirmation prompt prevents accidents.

### Pending approval

For techs: your submissions that are sitting in the admin's queue.
For admins: every tech submission across the team waiting for review.

Each row shows the service, city, hub, who submitted it, and when.
Admins see action buttons:

- **Preview / Edit** — open the preview page
- **Publish** — push it live
- **Delete** — discard it without publishing

### Recently published

The 10 most recently published projects.

For techs: yours only.
For admins: across the whole team. Each row links to the live page on
`mywindowwashing.com`. Admin-only buttons:

- **📣 Social** — generate social media posts for this project
- **Edit** — change something and push the update
- **Delete** — remove the live page entirely

### Top navigation bar

The navy header at the top has shortcuts:

- **MWW Dashboard** (left) — back to home
- **Hi, {name}** — your display name
- **Review** — Google-review QR codes
- **Videos** — YouTube uploader
- **Team** (admin only) — team management
- **Log out**

---

## 6. Tech workflow: submitting a completed job

The new-project flow is two pages so the form doesn't feel
overwhelming on a phone.

### 6.1 Picking the service

From the home page, tap **+ New project**. You'll see three big cards:

- **Window Washing**
- **Gutter Cleaning**
- **Power Washing**

Tap whichever you did. The details form for that service opens.

### 6.2 Filling the form

Every service form has the same five sections. Some sections look
different depending on the service.

**Submitting on behalf of (admins only)**

If you're logged in as admin, the very first card asks which tech did
the job. Pick from the dropdown. This is **required** — you can't
submit without it. The published page will credit that tech.

Techs never see this section — your name is used automatically.

**1. Address**

Start typing the customer's address. Google's autocomplete shows
suggestions. **Pick one from the dropdown** — don't just type and
move on. The autocomplete is how the app figures out:

- The city to show on the page (Romeoville, Lemont, etc.)
- Which spoke page to add a "Recent Projects" tile to
- Which hub binds to the project (phone number, office address shown on
  the page)
- The nearby towns to mention in the AI narrative

Once you pick an address from the dropdown, a green confirmation box
appears showing the resolved address.

**2. Details (per service)**

This section changes based on the service.

*Window cleaning:* Home type (1/2/3 story), how many windows, in &
out vs out only, window types (French / Double Hung / Casement),
extras with counts (screens, storm windows, skylights, window wells,
tracks & frames), and an **Other** free-text field at the bottom for
anything that doesn't fit the list (chandelier glass, mirrors, garage
windows, etc.).

*Gutter cleaning:* Home type, optional sq footage, service type
(Cleaning / Repair / Gutter Guard Installation), and an extras grid
covering gutter guards, roof cleaning, gutter repairs (with sub-types:
downspout reattachment, level corrections, elbow reattachment, loose
hangers, leak repair), extra-wide gutters, clogged elbows, underground
clogs, plus an **Other** description field.

*Power washing:* "What was cleaned?" surface checklist — House, Deck,
Patio, Driveway, Walkways, Playset, Outdoor furniture. Checking House,
Deck, Patio, Driveway, or Walkways opens material sub-checkboxes
(vinyl siding / wood siding / aluminum / brick / stone for the house;
wood / TREX for the deck; etc.). Also has an **Other** description
field at the bottom.

**Price (optional)**

Type the dollar amount with the dollar sign (`$290`). This shows on
the published page in the stats bar.

**Date completed**

Defaults to today. Change it if the job actually happened on a
different day.

**3. Photos**

Two required photos — **Before** and **After**. iPhones may shoot
HEIC; that's fine, the server auto-converts. The OS file picker shows
**Camera + Photo Library + Files**, so you can pick a photo you took
earlier or open the camera right then.

Optional: up to 5 additional gallery photos. The first one becomes the
hero image on the page; all of them appear in a "Project Photos"
gallery section.

After picking each photo, a thumbnail preview appears. HEIC files
can't preview in the browser, so you'll see a friendly note instead —
the upload still works.

**4. Customer review (optional but recommended)**

- **Customer name** — first name + last initial (e.g. "Sarah M.") is
  typical for privacy
- **Review link** — paste the Google or Yelp review URL if the customer
  already left one
- **Review text** — paste the actual text of the review here. Even if
  the review is also linked, pasting the text means it appears
  directly on the project page as a customer quote.

If the customer hasn't left a review yet, leave this blank. You can
ask for one right after handing back the phone using the QR code
(section 12).

**5. What we did (the narrative inputs)**

- **Challenges (checkboxes)** — common issues that came up. Per
  service. The AI uses these to write the work-paragraph of the
  narrative naturally ("...the north exposure had collected lake-effect
  grit through the spring..."). Don't over-think it — check what
  actually applied.
- **Bullet notes** — type a quick informal dump of what you did. The
  placeholder text shows a good example. The AI uses this as the
  source of truth for the second paragraph of the narrative.

### 6.3 Photos: tips for good ones

- Land in the same spot for before and after photos so the comparison
  is obvious.
- Shoot the **outside** for window-washing projects — outside windows
  are more visually impactful than inside.
- For gutter cleaning, a roof-line photo before + an angle showing the
  cleaned downspouts after works well.
- Don't include people without permission.
- Don't include house numbers, mailboxes, or anything that gives away
  the exact street address (the published page shows the city only,
  no full address).

### 6.4 Saving as a draft

If you're not done filling everything in, scroll to the bottom and
tap **Save draft**. The project disappears from this view and shows up
in your dashboard's "Your drafts" card. You can come back anytime to
finish it.

Drafts are private — no Telegram ping, no admin involvement until
you mark it ready.

### 6.5 Sending for approval

When the form is complete, tap **Save & Send for approval** at the
bottom. This:

1. Resizes the photos to 1200×800 .webp
2. Calls Claude to write the narrative (two paragraphs, voice-matched
   to past project pages)
3. Saves the row to the database with status = `pending`
4. Sends a Telegram ping to the admin: *"New project from Mike — Power
   Washing in Winnetka — Review & publish: https://..."*
5. Drops you on a confirmation screen

You're done. Admin takes it from here.

*Special case:* When an admin saves on behalf of a tech, the Telegram
ping is **skipped** — admins are the ones who'd receive it, no point
notifying themselves. Behavior is identical otherwise.

---

## 7. Admin workflow: reviewing and publishing

### 7.1 The Telegram notification

When a tech submits, a Telegram message arrives in the admin group:

> 🆕 New project from Mike
> *Power Washing in Winnetka, IL*
> Review & publish: https://project.mywindowwashing.com/projects/42/preview

Tap the link or open the dashboard manually.

### 7.2 Previewing the page

The preview page (`/projects/:id/preview`) shows:

- The Claude-written narrative in an editable textarea
- All the details the tech entered
- An iframe of the rendered project page (images won't load yet
  because they're not in the site repo — that's normal, ignore the
  broken-image icons)
- Bullet notes the tech entered (for narrative regeneration later)
- The customer review block

You can:

- **Edit the narrative** directly in the textarea
- **Regenerate the narrative** with one click — calls Claude again with
  the same inputs but a fresh temperature, useful if the first draft
  feels stale
- **Regenerate the FAQ** — picks four likely customer questions and
  Claude-answers them
- Scroll the iframe to see the full page rendering

If something is wrong — narrative names wrong city, photo is sideways,
review text has a typo — fix it here before publishing.

### 7.3 Publishing

Click **Publish to live site**. The dashboard then:

1. Renders the final HTML for the project page using the canonical
   template
2. Writes it to the static-site repo at
   `projects/<slug>.html`
3. Copies the staged .webp photos into `projects/img/`
4. Patches the matching spoke page (e.g. `winnetka.html`): replaces the
   first "Coming soon" project card with a real tile pointing to the
   new project, or — if all three slots are filled — prepends a new
   tile and drops the oldest
5. Updates the "View all N projects in [City]" link in the spoke
   page's footer with the new count
6. Patches the global "Recent Projects" footer column site-wide
7. Adds/refreshes the project's `<url>` entry in `sitemap.xml`
8. Regenerates three archive pages:
   - **Master** at `projects/index.html`
   - **Per-service** at `projects/window-cleaning.html`,
     `projects/gutter-cleaning.html`, `projects/power-washing.html`
   - **Per-spoke** at e.g. `projects/winnetka.html`
9. Commits as `MWW Dashboard <dashboard@mywindowwashing.com>` and
   pushes to the static-site repo on GitHub
10. Marks the row as `status='published'`

You'll land on a confirmation screen that lists every file that
changed.

### 7.4 The cPanel deploy step

GitHub now has the change but the live site **doesn't** until cPanel
pulls.

1. Log in to cPanel
2. **Git Version Control**
3. Find the `mywindowwashing` repository
4. Click the **Manage** button
5. Click **Update from Remote** (pulls the new commit)
6. Click **Deploy HEAD Commit** (copies files into `public_html`)

The live page should appear at
`https://www.mywindowwashing.com/projects/<slug>` within seconds.

You can do this batched at the end of the day — multiple publishes
stack into one cPanel deploy.

---

## 8. Editing a published project

Admin-only. After a project is published, you can change the narrative,
photos, customer review, video URL, price, etc., and push the update.

1. On the home page, find the project under **Recently Published**.
2. Click the **Edit** button (only visible to admins).
3. The edit page lets you change:
   - **Narrative** (the two paragraphs)
   - **Customer review** (name, link, text)
   - **Before / After photo** — upload a new file to replace; leave
     blank to keep the current one
   - **Video URL** (YouTube or Vimeo)
   - **Home type / Price / Street**
   - **Bullet notes** + **Challenges** (these feed into narrative
     regeneration)
4. Buttons at the top:
   - **⟳ Regenerate narrative** — rewrites with current inputs
   - **⟳ Regenerate FAQ** — rewrites the four FAQ items
5. Click **Save changes & update live site** at the bottom.

The dashboard re-renders the page, the spoke tile, the archive pages,
and pushes the lot. cPanel deploy still required for the changes to
appear live.

What you can't change here:
- The **slug** (URL of the page)
- The **service** (window vs gutter vs power)
- The **city** / hub
- The **date** (review_date)

If you need any of those changed, **delete the project** and
re-submit it.

---

## 9. Deleting a published project

Admin-only. Use carefully.

1. On the home page or the project's edit page, click **Delete**.
2. A confirmation prompt explains exactly what will be removed:
   *"This removes the live page, photos, spoke-page tile, sitemap
   entry, and DB row. cPanel still needs a deploy to remove it from
   the live site."*
3. Click **OK**.

The dashboard then:

- Removes `projects/<slug>.html` and every photo (`<slug>-before.webp`,
  `<slug>-after.webp`, `<slug>-extra-1.webp`, etc.)
- Removes the project tile from the spoke page and refreshes the
  "View all" count
- Removes the project's `<url>` entry from `sitemap.xml`
- Regenerates the affected archive pages (master, service, spoke)
- Deletes the row from the database

You land on a confirmation screen listing what was removed.

cPanel deploy is still required to remove the page from the live site.
Until then, the page is gone from GitHub but still cached in
`public_html`.

---

## 10. Uploading a video to YouTube

A standalone page (`/videos`) that uploads a job video to the company
YouTube channel with AI-written title and description, then optionally
attaches the URL to a project so it gets embedded on the published
page.

### 10.1 First-time YouTube channel connect

**Admin only, one-time.** Required before anyone can upload.

1. Make sure you're signed into the Gmail account that owns the
   company's YouTube brand account (for MWW, that's
   `ginolyp@gmail.com`).
2. On the dashboard, go to **Videos** in the top nav.
3. Click **▶ Connect YouTube channel**.
4. Google's account chooser opens. Pick the right Gmail.
5. You'll see a "Google hasn't verified this app" warning. This is
   expected since the app is private to MWW. Click **Advanced** → **Go
   to MWW Dashboard (unsafe)**.
6. The next screen is the brand-account chooser: it lists your personal
   YouTube channel **and** any brand channels you manage. **Pick the
   right one** — the MWW brand channel, not your personal channel.
   This step is critical; the wrong pick means all uploads go to the
   wrong channel until you disconnect and redo.
7. Click **Allow** to grant the upload permission.
8. You'll land back on `/videos` with a green **● Connected** banner.

If at any point you need to reset the connection:
- On `/videos`, click **Disconnect** next to the Connected banner.
- Open https://myaccount.google.com/permissions and revoke the **MWW
  Dashboard** app's access. This forces the brand-account chooser to
  reappear on the next connect.
- Then go through steps 3-8 again.

### 10.2 The upload page

Once connected, the upload page works the same for techs and admins:

1. **1. Video file** — pick an MP4 or MOV. Phone videos work as-is.
2. **2. Which project is this for?** (optional) — pick from the
   dropdown of pending / draft / published projects. If you pick one:
   - The AI uses that project's narrative as source material for the
     title and description.
   - The YouTube URL gets saved to that project's `video_url` field.
   - If the project is already published, the live page is re-rendered
     and pushed with the new embed (cPanel deploy still needed).
3. **3. Title & description** — click **✨ Generate with AI**. Claude
   writes a search-friendly title (with city + service in the lead),
   a description (grounded in the project narrative, with the
   project-page URL and the correct hub phone number in the contact
   block), and 10-15 tags. Review and edit as you like.
4. **Visibility** — Public (default), Unlisted, or Private.
5. Click **▶ Upload to YouTube**.

The upload streams the file directly to YouTube using the Data API v3
resumable protocol. For phone videos on cell signal this can take 1-3
minutes; keep the page open until it finishes. You'll land on a
confirmation screen with the YouTube URL.

### 10.3 Attaching the video to a project

If you skipped step 2 above (standalone video), the URL is shown on
the confirmation screen — copy it manually and paste into any
project's **Video URL** field via the edit page.

If you picked a project in step 2, attachment is automatic. For
published projects, the embed shows up on the live page right after
the cPanel deploy.

### Tips

- **Keep clips under 60 seconds.** Cell upload of a 20-second clip is
  ~20-50MB; a 4-minute clip is 400MB+ and takes far longer. iPhone
  Photos has a built-in trim — drag the handles at the bottom of any
  clip.
- **Test with Unlisted first.** When you're new to the upload flow,
  set visibility to Unlisted and double-check the video lands on the
  right channel (check at https://studio.youtube.com after switching
  to the MWW brand account). Once confident, switch to Public.
- **The video must be under 2 GB.** This is configured in nginx as
  well; if you hit a 413 error on upload, the server's
  `client_max_body_size` is too low — ask the admin to raise it.

---

## 11. Creating social media posts

A per-project page (admin-only) that generates ready-to-paste
Facebook, Instagram, and LinkedIn posts.

From the home page, on any published project tile, click **📣 Social**.

### 11.1 Generating the captions

The page automatically calls Claude to generate three captions tuned
per platform. While it's working you'll see "Writing captions for
Facebook, Instagram, and LinkedIn…".

What Claude produces:

- **Facebook caption** — 2-4 conversational sentences, includes the
  project-page link at the end. No hashtags in the body.
- **Instagram caption** — punchy opening line (hook), then a paragraph
  or two with line breaks. Often a closing line about booking. No
  hashtags in the body.
- **LinkedIn caption** — professional / craftsmanship-focused. No
  hashtags. Includes the project-page link.
- **Hashtag set** — 10-15 hashtags. Used for Facebook + Instagram.
  LinkedIn skips hashtags.

You can edit any caption directly in the textarea, or click
**⟳ Regenerate all captions** for a fresh draft (Claude returns
different wording each time).

### 11.2 Pick photos

Below the captions is a photo grid. Before + After are pre-selected.
You can:

- Click any extra to add it to the selection (green border = selected)
- Click before or after to deselect

The number selected drives the **Download photo(s)** button on each
platform card. Clicking that opens each selected photo in a new tab so
you can save them.

### 11.3 Posting to Facebook

On the Facebook platform card:

1. Click **📋 Copy caption + hashtags** — the text is on your clipboard.
2. Click **📷 Download photos** — each selected photo opens in a tab.
   Right-click → Save image for each one (or long-press → Save on
   mobile).
3. Click **↗ Open Facebook** — Facebook opens in a new tab.
4. Make sure you're posting **as the Page** (top-left of Facebook
   should show the Page logo, not your personal avatar).
5. Click **Create Post**.
6. Paste the caption.
7. Attach the photos.
8. Click Post.

**About the "Published by [your name]" label:** Facebook shows that to
other admins of the Page. To the general public it just shows "My
Window Washing". To hide it from admins too, change the
"Show admin name on posts" setting in Page settings → Privacy.

### 11.4 Posting to Instagram

Instagram posting is mobile-only (Instagram doesn't allow desktop
posting for the most part). The easiest flow:

1. Open the dashboard **on your phone** (it should be installed as a
   PWA on your home screen).
2. Go to the project → 📣 Social.
3. Tap **📋 Copy caption + hashtags**.
4. Tap **📷 Download photos** — each photo opens in Safari/Chrome;
   long-press → **Save to Photos** for each.
5. Open the Instagram app.
6. Tap +  → Post → pick the saved photos (multi-select for a carousel)
   → Next.
7. Paste the caption.
8. Tap Share.

### 11.5 Posting to LinkedIn

Similar to Facebook:

1. Click **📋 Copy caption** (no hashtags on LinkedIn).
2. Click **📷 Download photos**.
3. Click **↗ Open LinkedIn composer** — opens the share dialog.
4. Make sure the "Post as" picker shows the My Window Washing **Company
   Page**, not your personal profile (top of the composer).
5. Paste the caption.
6. Attach the photos.
7. Click Post.

### Character counters

Under each caption is a counter showing characters / platform limit:

- Facebook: 63,206 chars (effectively no limit)
- Instagram: 2,200 chars
- LinkedIn: 3,000 chars

The counter turns red if you exceed.

---

## 12. Asking customers for Google reviews

A per-hub QR code page (`/review-qr`) that lets the tech hand the
customer their phone to scan, landing them directly on the right
Google Business Profile's review page.

### 12.1 Setting up the review URLs (admin)

**One-time setup.** Required before the QR codes work.

1. On the dashboard, go to **Review** in the top nav.
2. Click **⚙️ Manage hub review URLs** at the bottom.
3. For each of the 9 hubs (Chicago, Chicago Downtown, Lisle,
   Clarendon Hills, Bloomingdale, Barrington, Arlington Heights,
   Northbrook, Round Lake):
   - Open https://business.google.com
   - Switch into that hub's profile (top-left dropdown)
   - **Read reviews** → **Get more reviews**
   - Google shows a short link like
     `https://g.page/r/CXxXxXxXxX/review`
   - Paste it into the field for that hub on the setup page.
4. Click **Save all**.

You only do this once. The URLs are stored on the server so the team
sees them everywhere.

### 12.2 Showing the QR code (tech)

After finishing a job:

1. On the dashboard, go to **Review** in the top nav (or **⭐ Ask for
   a Google review** on the home page).
2. The dropdown auto-picks the hub from your most recent project. If
   it's right (it usually is), skip to step 3. Otherwise pick the
   correct hub.
3. A large QR code appears.
4. Hand the customer your phone.
5. They open their phone's camera, point at the QR code on your screen
   — a banner appears at the top: *"Tap to open this Google review
   page."*
6. They tap, write the review, and submit.

The review lands on the correct Business Profile. Most reviews now
take 30 seconds from "would you mind?" to submitted.

### Why per-hub?

MWW has 9 GBP listings, one per office. Reviews are scored *per
listing*, not per company. A 5★ review for the Barrington listing
does nothing for the Lisle listing's score. Picking the right hub
matters.

---

## 13. Managing the team

Admin-only. URL: `/users`.

### Adding a user

Click **+ Add user**. Fill in:

- **Username** — lowercase, alphanumeric + hyphens/underscores. Used
  for login. Can't be changed later.
- **Display name** — what shows on the dashboard and project pages
  ("Mike J.", "Sarah from Lisle", etc.).
- **Role** — Tech or Admin.
- **Password** — at least 8 characters. The user can't change this
  themselves; admin resets via this page.
- **Photo** — optional. Will be resized to 600×600 .webp and pushed
  to the static-site repo at `images/team/<username>.webp`. This is
  the byline avatar shown on every project they submit.
- **Bio** — optional short paragraph that appears in the
  "Crew on this job" sidebar on the project page.

Click **Create user**.

### Editing a user

Click their row → change fields → Save changes.

Username can't be changed (it's the login). Password can be left blank
to keep the current one, or filled in to reset.

### Removing a user

On their edit page, click **Delete user**.

Important: the user's submitted projects **are kept** but their byline
becomes unattributed (no name, no photo). You'd need to manually
re-edit those projects via the edit-project page to re-attribute them
if you want.

---

## 14. Common errors and what to do

### "Pick a real street address from the dropdown"

You typed an address but didn't pick from Google's suggestion list.
Re-type the address, wait a second for suggestions to appear, **tap
one of them**. A green confirmation box appears when it worked.

### "A page already exists for [slug]. Add a one-word descriptor"

Two projects in the same city + service on the same day would collide.
Type a one-word descriptor in the field that appears (e.g. "colonial",
"corner-lot") and submit again — the slug becomes
`window-cleaning-in-naperville-06-12-26-colonial`.

### "Photo processing failed: ..."

The photo couldn't be resized. Try a different photo or take a fresh
one. HEIC is supported automatically — that's not the cause. Common
real causes: corrupt image, file is actually a video, file is over 20MB.

### "Both before and after photos are required"

Self-explanatory. Both file inputs need a photo.

### "Pick a team member to post as in the 'Submitting on behalf of' section"

Admin-only. You're trying to submit a form without picking which tech
the job belongs to. Scroll to the top of the form, pick from the
dropdown.

### "Cannot GET /videos" or "Cannot GET /review-qr"

The app server is running but the route didn't load. Almost always:
the VPS pulled the latest code but the server wasn't restarted. On
the VPS, run:
```
cd /var/www/mww-dashboard-app
git pull
sudo systemctl restart mww-dashboard
```

### "413 Request Entity Too Large" (video uploads)

The video file is bigger than nginx allows. Default is 25MB; videos
need 2GB. Admin edits
`/etc/nginx/sites-available/project.mywindowwashing.com` and changes
`client_max_body_size 25M;` to `client_max_body_size 2G;`. Then
`sudo nginx -t && sudo systemctl reload nginx`.

### "YouTube is not connected"

The Google OAuth grant was never done or has expired. Admin: go to
**Videos** → **▶ Connect YouTube channel** and complete the flow
(section 10.1).

### "Couldn't generate captions" or AI features stop working

Usually means Anthropic's API key in the .env file is missing, has run
out of credits, or the request hit a rate limit. Check the .env file
on the VPS and the Anthropic console for billing.

### Login bounces to login page right after submitting

Cookie/session issue. Try clearing your browser cookies for
`project.mywindowwashing.com`. If the problem persists, the
`SESSION_SECRET` env var on the server may have changed (it
invalidates all sessions).

### The project page on the live site is missing photos

The static-site repo was pushed but cPanel hasn't deployed. Do the
Update from Remote + Deploy HEAD Commit dance in cPanel.

### The wrong tech is credited on a published page

If the admin picked the wrong tech in the "Submitting on behalf of"
dropdown, fix it: go to the project's edit page, then re-attribute
manually by editing `submitted_by` in the database. There's no UI for
re-attribution after the fact — easiest is to delete and re-submit.

---

## 15. Quick reference cheat sheet

### Tech daily workflow

1. Finish a job
2. Open the MWW PWA on phone
3. Tap **+ New project** → pick service → fill the form → photos →
   customer review → Save & Send for approval
4. Hand customer the phone — tap **Ask for a Google review** → show
   QR code → customer scans → review submitted
5. Done

### Admin daily workflow

1. Telegram ping → tap link to preview the submission
2. Optionally tweak the narrative
3. Click **Publish to live site**
4. End of day: cPanel → Update from Remote → Deploy HEAD Commit
5. Done

### Adding a video to a project

1. **Videos** in nav → upload the file
2. Pick the project from the dropdown
3. Click **✨ Generate with AI** → review title/description
4. **▶ Upload to YouTube**
5. If the project was already published, do the cPanel deploy again
   to publish the embed

### Posting to social

1. Find the project under Recently Published → click **📣 Social**
2. Wait 5 seconds for AI captions
3. Pick photos
4. For each platform: Copy caption → Download photos → Open platform
   → Paste & post

### Restart the server (admin / dev)

```
cd /var/www/mww-dashboard-app
git pull
sudo systemctl restart mww-dashboard
```

### Check the server status

```
sudo systemctl status mww-dashboard --no-pager
sudo journalctl -u mww-dashboard -n 50 --no-pager
```

### Force-disconnect YouTube (admin)

1. https://myaccount.google.com/permissions → MWW Dashboard → Remove access
2. On `/videos`, click Disconnect
3. Re-do the connect flow

---

*This manual covers the dashboard as of the latest release. For
development / deployment instructions or to clone this stack onto a
different company, see the **Build Manual** (`docs/BUILD-MANUAL.md`).*
