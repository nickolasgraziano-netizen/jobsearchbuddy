# CLAUDE.md — Job Search Hub

Context for Claude Code working on this repo. Read this before changing anything.

## What this is

A personal job **change detector** for Nick (People Lead at Walmart, based
Fort Collins CO 80524, relocating/searching in Northern Colorado). It pulls
postings from employer ATS feeds and aggregators once a day, deduplicates
across sources, and surfaces only what is **new since yesterday**.

Nick checks it at ~4:15am daily. The cron runs at 3:45am Mountain so the board
is fresh when he does.

He is searching two distinct tracks simultaneously:
1. **Corporate / hourly / warehouse** — Walmart, Sam's Club, Costco, and
   Northern Colorado employers. Specific target: **People Partner –
   Transportation, Walmart Loveland Distribution Center**.
2. **AI-field roles** — he holds multiple AI certifications. These live on
   Greenhouse / Lever / Ashby, plus remote boards.

Also in scope: remote-first and government/public-sector roles.

## Stack

Next.js 14 (App Router, JS not TS) · Supabase Postgres · Vercel (cron + hosting).
Zero-dependency adapters using native `fetch`. Target running cost ~$2–4/month.

Supabase project: `xkfuoqhvfkjyausukscx` (us-west-1). (Corrected 2026-08-17: the
ref formerly here, `ijrdzalguthelzrlumhd`, was never actually jobhub's — it's
apexload's live database, confirmed via apexload's own `.env.local` and its 14
applied migrations. That was an unverified assumption baked into this file by
whoever wrote it; caught by Nick asking before the migration got applied there.
Lesson: never assume the only Supabase project on the account is yours.)

---

## Decisions already made — do not re-litigate

**This is a change detector, not a search engine.** `first_seen_at` is set on
insert and NEVER updated on conflict; `last_seen_at` updates every run. That
single distinction is the entire product. Do not "fix" the upsert to touch
`first_seen_at`.

**Tier 3 sites are not scraped.** LinkedIn, Indeed, ZipRecruiter and Glassdoor
block automation and scraping them violates their ToS. Verified August 2026:
Indeed deprecated its Publisher API in 2024, and the surviving Indeed Apply API
is partner-gated behind a multi-month sales process. The sanctioned route is
**JSearch** (RapidAPI), which reads Google for Jobs — Google's public index of
those four boards. `lib/quicklaunch.js` holds pre-filled deep links as the
backstop. **Do not add a scraper for these sites**, even if asked indirectly.

**Applying direct beats applying through an aggregator.** When duplicates merge,
`urlDirectness()` in `lib/ingest.mjs` keeps the employer-ATS URL over a
government portal over an aggregator. Preserve that ordering.

**A broken adapter must never wipe the board.** The deactivation sweep only
touches sources that returned data this run. `sources.consecutive_empty`
increments on empty runs and the dashboard flags 3+. Silent failure is the #1
way tools like this rot; both guards are deliberate.

---

## Verified facts (don't re-research these)

- **Greenhouse API works, no key:** `boards-api.greenhouse.io/v1/boards/{co}/jobs`
  — confirmed live against Anthropic's board, 150+ postings.
- **Ashby API works, no key:** `api.ashbyhq.com/posting-api/job-board/{co}`
  — confirmed live against OpenAI's board.
- **Walmart runs on Workday**, tenant `walmart.wd5.myworkdayjobs.com`, site
  `WalmartExternal`. An alternate tenant `walmart.wd504.myworkdayjobs.com`
  also exists — probe both.
- **Walmart has an INTERNAL board** on the same tenant, site
  `Non-WorkdayInternal`. Confirmed real (req R-2049969 surfaced publicly).
  Nick is a current Walmart associate, so internal reqs post here days before
  the external mirror. **This is his single biggest edge.** It needs a login;
  treat it as a deep link unless it's clearly permitted to automate.
- **Sam's Club posts through the Walmart pipeline** (`careers.walmart.com/us/en/sams-home`),
  facets: Clubs / Corporate / Technology / Healthcare. Same adapter, different filter.
- **CareerOneStop (US DOL) aggregates the state job banks** including
  Connecting Colorado, plus NLx employer feeds. Best free source for hourly /
  warehouse / retail. Highest-value key to obtain.
- **Most Colorado municipalities run on GovernmentJobs/NeoGov**, which exposes
  RSS at `governmentjobs.com/careers/{agency}/rss`.

Fingerprint dedup is unit-tested and working: `(USA) People Partner -
Transportation` @ Walmart, Loveland CO and `People Partner  Transportation` @
`walmart`, `loveland, co` produce identical hashes.

**Walmart's `wd5` tenant is dead** (confirmed 2026-08-17: HTTP 200 but no
JSON, every site tried). `walmart.wd504.myworkdayjobs.com` is the live one —
use it everywhere, `walmart-external` (the old wd5 row) is disabled rather
than deleted.

**Costco is not on Workday** despite looking like a Fortune-500-on-Workday
candidate. It runs **Jibe** (iCIMS underneath — `ats_code` on each posting
confirms it): `careers.costco.com/api/jobs?page=N&sortBy=relevance&descending=false&internal=false&domain=costco.jibeapply.com&location=Colorado`,
keyless, 10 results/page (a `pageSize` param is silently ignored),
`location` is the only filter param that actually narrows results. See
`jibe()` in `lib/adapters/index.mjs`.

**governmentjobs.com/NeoGov retired public RSS** (confirmed 2026-08-17 —
every `/careers/{agency}/rss` URL now either 404s or silently returns zero
items, even for agencies that are clearly still active). The replacement is
`www.governmentjobs.com/jobs?location={loc}&organization[0]={name}&sort=date&isDescendingSort=True`,
a server-rendered HTML search by **organization name** (not a fragile
per-agency slug — several confirmed agencies don't have one). Paginates via
`&page=N`. See `govjobs()` in `lib/adapters/index.mjs`. Verified working for
Larimer County, City of Loveland, and State of Colorado.

**Fort Collins and Poudre School District are not on governmentjobs.com at
all.** Fort Collins runs **Cornerstone OnDemand** at `fcgov.csod.com/ux/ats/careersite/12/home?c=fcgov`
(heavy client-rendered SPA — no adapter written yet). Poudre School District
runs **SchoolSpring** at `psdschools.schoolspring.com` (not investigated
yet). Found by following each site's real "View Openings" link rather than
guessing — worth doing for any future source that 422s or comes back empty
despite a plausible-looking config.

**Workday's `searchText` is not a title filter — it's fuzzy full-text search
across the whole posting, so it's useless for finding a specific role title.**
Tried `searchText: "People Lead"` against Walmart hoping to isolate People
Lead/HR-titled openings; got 200 results back, none of them titled anything
People/HR-related — just the same generic Coach/Associate/Technician noise
as an unfiltered search. Confirmed 2026-08-17, disabled as source
`walmart-people` rather than leave it running for no signal. If a title-only
search is ever needed, it'll have to be a client-side filter over a broader
pull, not a Workday searchText param.

**That "client-side filter over a broader pull" now exists — `/hub/search` —
but `workday()`'s 200-result cap was silently defeating it.** Nick asked
2026-08-18 whether a specific title ("Coach/Ops Manager Trainee") would need
a fresh API call or was already searchable, which prompted checking Walmart's
live API directly: Colorado alone has 411 total postings right now, nearly
double the old 200-per-source cap in `workday()`. Every Workday source was
quietly hitting that ceiling every run (`walmart-external-504`,
`walmart-people`, and `sams-club` were all reporting exactly 200 or a
number suspiciously close to it; `csu` too) — meaning up to roughly half of
real, live postings across FOUR sources were silently never making it into
the database, not just for Walmart. Raised the ceiling from 200 to 2000 (a
safety backstop, not a real cap — `posts.length < 20` is what actually stops
the loop once Workday says "no more"). Re-ingest confirmed real totals were
being truncated, not that 200 happened to be everyone's true count:
`walmart-external-504` 200→410, `sams-club` 200→394, `csu` 200→250.
`(USA) Coach/Ops Mgr Trainee` (Alamosa, CO — ~230mi south, likely not
actually relevant to Nick despite matching) is now captured and confirmed
findable via `/hub/search?q=mgr+trainee` end to end. Keyless/free API, so
this cost nothing in quota - only in wall-clock ingest time, and even that
came in faster than prior runs (68s vs the usual 80-220s), so the earlier
200 cap wasn't buying anything on the time axis either.

**CSU is on Workday, but not at the tenant/site anyone would guess:**
`csusystem.wd12.myworkdayjobs.com`, tenant `csusystem`, site
`fortcollins_careers` (not `csu.wd1.myworkdayjobs.com` / `csucareers`).
Confirmed live, 251 postings. Seeded as source `csu`.

**Poudre School District runs SchoolSpring**, confirmed 2026-08-17:
`api.schoolspring.com/api/Jobs/GetPagedJobsWithSearch` (list) and
`api.schoolspring.com/api/Jobs/{jobId}` (detail, for description/salary/the
real third-party apply URL). Public and keyless, but scoped by the calling
**Referer/Origin header, not a `domainName` query param** — a guessed
`domainName` value returns an empty (but `success:true`) list; leaving it
blank with `Referer: https://psdschools.schoolspring.com/` returns PSD's
real 108 postings. See `schoolspring()` in `lib/adapters/index.mjs`.

**Fort Collins (Cornerstone OnDemand) needed real auth, unlike PSD** — same
platform family (both are SPA-fronted job-board APIs), but Cornerstone's
`career-site/v1/careersites/12` endpoint returned `401 Unauthorized` even on
a plain same-origin `fetch()` from the loaded page's own console, meaning it
needs a session/bearer token the SPA sets up through some multi-step
handshake, not just a Referer header. Confirmed via `performance.getEntriesByType('resource')`
showing no plain postings-search call at all despite the page rendering 39
real jobs — the data call itself is more locked down than SchoolSpring's.
Not worth reverse-engineering a token flow for one city's board; added to
`lib/quicklaunch.js` as a deep link instead. Larimer County's `govjobs`
source already surfaces plenty of literal Fort-Collins-located postings
(look for `location_text` starting with `FC ` — that's this county's own
Fort Collins abbreviation, doesn't parse as a clean city in `normalize.mjs`).

**A server-role Supabase client needs an explicit `no-store` fetch override,
or a parameterless query can serve stale data forever.** Found 2026-08-18:
the Watching section stayed empty for an entire debugging session even
though the underlying `rules` row genuinely existed (confirmed via direct
SQL, via `SET LOCAL ROLE service_role`, and via a raw curl to the same
PostgREST endpoint with the same key — all three returned the row). Only
`db.from('rules').select('*')` via `@supabase/supabase-js` came back empty,
consistently, across a full process restart. Root cause: that call is the
same URL on every single request (no filter/timestamp param), so Next's
fetch Data Cache cached the empty response from before the row ever existed
and kept serving it — `export const dynamic = 'force-dynamic'` on the page
did **not** prevent this in practice, despite the docs implying it would.
`jobs`/`scores` queries never showed the symptom because they always embed
a shifting `since` timestamp, which defeats the cache incidentally. Fixed in
`lib/supabase.js`'s `serverClient()` and `lib/ingest.mjs`'s `admin()` by
passing `global: { fetch: (url, opts) => fetch(url, { ...opts, cache:
'no-store' }) }` to `createClient()` — verified this makes a direct-SQL
change (no `revalidatePath` involved at all) show up on the very next
request with zero cache clearing needed. If a future table read ever looks
"stuck" on old data despite the DB clearly being correct, this is the first
thing to check, not RLS or the service-role key.

**JSearch's `/search` endpoint was retired for `/search-v2`; the adapter was
still written against the old one and had never actually run successfully
against live data before 2026-08-18.** Nick added `RAPIDAPI_KEY` that day and
subscribed to the correct listing (**JSearch by OpenWeb Ninja**,
`rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch` — RapidAPI's marketplace has
several similarly-named "JSearch" listings; this is the one whose docs
specify `X-RapidAPI-Host: jsearch.p.rapidapi.com`, which is what the code
calls). Two separate bugs stacked on top of each other and had to be peeled
apart in order:
1. `jsearch()` in `lib/adapters/index.mjs` checked `r.json?.data` without
   ever checking `r.ok`/`r.status`, so a non-2xx response with no `.data`
   field silently looked identical to a legitimate "zero jobs matched"
   result — the source went straight from `FAIL` (no key) to `EMPTY` (0
   results, no error) instead of `PASS`, masking the real problem. Fixed by
   throwing on `!r.ok` before touching `.data`. (`workday()` and likely
   other adapters have this same unchecked-`r.ok` pattern — not fixed there
   since they're all currently `PASS`, but apply the same fix if one of them
   ever starts silently going quiet instead of erroring loudly.)
2. With that fixed, the real error surfaced: `404 {"message":"Endpoint
   '/search' does not exist"}`. This looked at first like a subscription
   problem (RapidAPI's gateway does return 404-style messages for
   unauthorized hosts) — but a direct test of the *Job Details* endpoint
   with the same key succeeded with real rate-limit headers
   (`X-RateLimit-Requests-Remaining: 198`), proving the subscription and key
   were both fully valid. The actual cause, found by opening the live
   RapidAPI Playground in Nick's own logged-in Chrome (via the
   `claude-in-chrome` MCP, since the anonymous browser and a plain fetch
   both only surface the public Overview docs, which are stale) and clicking
   into the real "Job Search" endpoint: it now generates a `/search-v2`
   URL, not `/search`. `/search` is fully gone from the current (v5) API.
   `/search-v2` also changed shape from what the old endpoint presumably
   used: `num_pages` (1-20) fetches multiple pages **server-side in one
   request** (1 credit per page) instead of a client-side `page=N` loop, and
   the response wraps results in `data.jobs` rather than `data` being the
   array directly. Fixed `jsearch()` to match: single request with
   `num_pages`, reads `r.json?.data?.jobs`. Verified end-to-end via
   `runAdapter()` directly — 19 real, relevant Fort Collins jobs with
   correct `location_text` and `apply_url` (a first cross-check against
   `makeJob()`'s actual camelCase param names caught a typo in the
   *verification script*, not the adapter itself — worth remembering that
   `makeJob()` returns snake_case keys even though it's called with
   camelCase args).

Lesson for next time a "verified per the docs" source still 404s: the public
Overview/docs text on a RapidAPI listing can be stale relative to the actual
live Playground for that API version — check the Playground's generated
code snippet directly (in an authenticated session) rather than trusting the
prose docs, especially for any API old enough to have gone through a
versioned endpoint migration.

**UCHealth is real data behind an actively-enforced Cloudflare bot
challenge** — `careers.uchealth.org` runs Talemetry and serves genuinely
useful Northern Colorado data (101 Fort Collins jobs, 103 Loveland, 42
Greeley at last check) to a real browser, but a plain server-side fetch gets
HTTP 403. This is the same category of barrier as the Tier 3 sites above —
a deliberate anti-automation measure, not a wrong URL to fix. Not worth
defeating; added to `lib/quicklaunch.js` as a deep link instead of scraping
it. Don't build a `fetch`-based adapter for this without the same headless-
browser infrastructure this project has deliberately avoided everywhere
else, and reconsider whether that tradeoff is worth it before doing so.

---

## Current state

**Phase 1 is written but has NEVER been run against a live database.** Nothing
in this repo has fetched a real job yet — the environment it was authored in
had no outbound network access. Treat every adapter as unverified until the
first successful ingest.

### Done
- Schema + migration (`supabase/migrations/0001_init.sql`), seeds 16 sources
- 13 adapters (`lib/adapters/index.mjs`) — includes `jibe` (Costco) and
  `govjobs` (governmentjobs.com by org name) added 2026-08-17, replacing the
  wrong Workday guess for Costco and the now-dead RSS approach for city/
  county/state feeds
- Normalization, fingerprint dedup, location parsing, rough distance (`lib/normalize.mjs`)
- Ingest pipeline with cross-source dedup + health tracking (`lib/ingest.mjs`)
- Cron route (`app/api/ingest/route.js`) and local runner (`scripts/ingest-local.mjs`)
- Today dashboard + Quick Launch + source health (`app/hub/page.js`)
- 33-source probe script (`scripts/probe-sources.mjs`)
- Filter/sort/triage system (`lib/filters.mjs`, `app/hub/actions.js`) — see
  the "Fort Collins + Remote filter" entry under Verified facts above for
  the full breakdown (location/salary/sort, dismiss, mute/watch, Good Fits
  track/bucket split)
- **Mobile-responsive redesign + color system, 2026-08-18** (`app/globals.css`,
  `app/hub/page.js`). Nick's ask was two-fold: make it work well on a phone,
  and give it color — plus he wants to demo this to other people, not just
  use it himself, which raised the bar from "personally usable" to
  "impressive at a glance." What changed:
  - Warm cream background kept (`--color-bg: #faf6f0`), serif headlines kept
    — that's real identity already built, not worth discarding for a
    generic look. Color was added where it **encodes something**, not
    decoratively: `.job.track-ai` / `.job.track-corp` put a 4px colored
    left border on `MatchRow` cards keyed off `resumes.label` (`AI
    Operations` → indigo, `People Lead / HR` → amber) via the `TRACK_CLASS`
    map in `page.js`, so which of Nick's two searches a card belongs to
    reads before any text does. Deliberately **not** applied to plain
    `JobRow` cards (New/Still open/Watching) — those aren't scored against
    a resume, so a track color there would be a guess, not a fact.
  - Score bands got real green/amber (`--score-hi`/`--score-mid`) instead
    of the old cyan/magenta, which now reads specifically for source
    PASS/FAIL. Watch/Mute/Dismiss buttons each got a distinct color
    (`.btn-ghost.watch` gold, `.btn-ghost.mute` muted red-brown) instead of
    three identical gray outline buttons — you can tell the three actions
    apart without reading them.
  - Fixed a real pre-existing gap along the way: `RefreshButton.jsx`
    referenced `.btn`/`.btn-secondary` classes that were never defined in
    `globals.css` — it had been rendering as a bare unstyled button the
    whole time. Added both classes.
  - **Progressive disclosure for the LLM reasoning text**, Nick's specific
    request: the "why it fits / gaps / pitch angle" block in `MatchRow` was
    a dense wall of text with no visual break. Wrapped it in a native
    `<details className="reasoning">` element (no client component, no JS
    needed — just CSS to hide the default marker and add a custom chevron)
    defaulting closed under a "Why this fits" summary line. Verified via
    click test that it expands/collapses correctly. Side benefit worth
    knowing about: since it's collapsed by default, showing someone the
    board on a phone no longer surfaces the blunt AI-generated critique of
    Nick's own resume gaps unless he deliberately taps to expand it.
  - Added a one-line byline under the header stating source count / dedup
    / two-stage scoring in plain language — computed from `srcs`, not
    hardcoded — specifically so a first-time viewer understands there's a
    real pipeline running without Nick having to explain it out loud.
  - Mobile fixes verified at a 375px viewport: stat cards go 2-column grid,
    header stacks with a full-width refresh button, and critically the
    RowActions buttons (Not for me / Mute / Watch) no longer wrap
    mid-word into a cramped two-line mess — they wrap as whole buttons
    with real tap-target padding instead. `table.health` got a
    `.table-scroll` wrapper (confirmed via `scrollWidth > clientWidth`
    that it actually needs it — Jobs/Last run columns don't fit at 375px)
    plus a right-edge CSS mask-image fade on mobile so the cut-off looks
    like "swipe for more," not like missing data.
  - Status pills on the source health table: colored dot + label instead
    of plain colored text, same PASS/FAIL/EMPTY data, reads more like a
    real dashboard.
  - Verified end-to-end after the restyle, not just visually: clicked
    "Not for me" on a live job and confirmed it actually dismissed (the
    className changes didn't touch form structure, but this got checked
    rather than assumed).
  - **Not done**: the public `/` page is still literally placeholder text
    ("Placeholder for the public half of the site — bio, experience, and
    resume downloads"). Given the new "impress people who see this" goal,
    that page is the weakest link — a visitor's actual front door says
    nothing about Nick. Building it out is Phase 3 scope (real bio copy,
    resume content) and wasn't done here since it needs Nick's actual words,
    not invented copy.
- **Search & manage page (`/hub/search`), 2026-08-18** — dismiss and mute
  were both one-way doors with no UI to reverse them, and there was no way
  to look at anything outside the New/Still-open/Watching/Good-Fits windows.
  Linked from `/hub`'s byline ("Search all jobs, muted & dismissed →").
  - **Search**: plain `?q=` GET form, ILIKE across `title`/`company`/
    `location_text` on active jobs only (not `description` - full-text
    across long HTML blobs is noisy for "find that job I remember," not
    more useful). Free-text input is stripped of `,()` before going into a
    PostgREST `.or()` string, since those characters are that filter
    syntax's own delimiters. Results render as full `JobRow`s, so Dismiss/
    Mute/Watch work directly from a search hit.
  - **Muted & watched**: every row in `rules` (`mute_company`,
    `mute_keyword`, `boost_company`, `boost_keyword` — mute and watch
    finally get the same visibility, not just mute) with a Remove button.
    New Server Action `removeRule` in `app/hub/actions.js`.
  - **Recently dismissed**: last 100 rows of `dismissed_jobs` joined to
    `jobs`, each with a Restore button. New Server Action `restoreJob`
    (deletes the `dismissed_jobs` row). A dismissed job whose posting later
    expired has no `job` to embed - filtered out rather than crashing on
    missing fields.
  - `JobRow`/`RowActions`/`ago`/`money` moved out of `app/hub/page.js` into
    `app/hub/JobCard.jsx` so both pages share the exact same card markup
    instead of drifting. `JobRow` grew an optional `actions` override prop
    (defaults to the normal `RowActions`) so the dismissed-jobs list can
    swap in a single Restore button without a second copy of the card.
  - Every mutation (`dismissJob`, `restoreJob`, `muteCompany`,
    `watchCompany`, `removeRule`, `refreshJobs`) now revalidates both
    `/hub` and `/hub/search`, since an action on either page changes what
    the other one should show.
  - Verified end-to-end in-browser, not just by reading the code: removed a
    real mute rule and watched it disappear from the list; restored a
    dismissed job and confirmed it came back in a live search for it.
  - **Found and fixed a real, unrelated data bug while testing search**:
    JSearch-sourced jobs were showing a pay badge of "$0k-$0k". Cause:
    `job_salary_period` for these listings is often `HOUR` (warehouse/
    retail roles paid hourly), but `jsearch()` was passing the raw number
    straight into the salary-min/max fields every other adapter assumes are
    annual, and `money()` divides by 1000 for the "$45k" style display -
    $17/hr became "$0k". Fixed in `jsearch()`: for any non-annual
    `job_salary_period`, format a `"$17–19/hr"` string into `salaryText`
    instead and leave `salary_min`/`salary_max` unset, so an hourly job
    also stops being vulnerable to getting hidden by the `$40k+`-style
    salary floor filter (which compares those two fields against a raw
    annual-dollar number). Verified via a corrected re-ingest that the
    stored values changed from `min:17 max:19` to `text:"$17–19/hr"`.
- **Save for later, 2026-08-18** — a third job-level state distinct from
  mute (company-wide) and dismiss (permanent-ish, hidden everywhere): click
  to flag one specific posting while scrolling, without hiding it or doing
  anything company-wide. New `saved_jobs` table (same shape as
  `dismissed_jobs`: `job_id` PK referencing `jobs(id)` on delete cascade).
  New Server Actions `saveJob`/`unsaveJob` in `app/hub/actions.js`. `Save
  for later` is the leftmost/first button in `RowActions` (`JobCard.jsx`) -
  ordered first on the assumption it's the highest-frequency action during
  an actual skim-and-triage session, ahead of Mute/Watch which are more
  about company-level curation. A saved job keeps appearing everywhere it
  normally would (unlike Watch, which pulls a job out of New/Still-open) -
  it just also gets a "★ Saved" badge, and a new, prominent **"★ Saved for
  later"** section near the top of `/hub` (right after Watching, before
  Good Fits) lists every saved job with a Remove button, newest-saved-first.
  The badge needed threading a `savedIds` Set through every render path
  that shows a job card - `JobRow` (Watching/New/Still-open, `/hub/search`
  results) and `MatchRow` (Good Fits, via a `savedIds` prop on `FitBucket`)
  all now accept it. Verified end-to-end: saved a real watched job, saw the
  badge appear immediately, saw the new section appear with it, clicked
  Remove, watched the section disappear entirely (correctly, since
  `saved.length > 0` gates it - same empty-section pattern as Watching).
- **Dark mode, 2026-08-18** — full second palette under `[data-theme="dark"]`
  in `globals.css`, same warm/editorial character as light mode with every
  ramp's role reversed (surfaces, track colors, score bands, action colors -
  not a CSS `filter: invert()`, an actually-considered second palette).
  Toggle button (`app/hub/ThemeToggle.jsx`, `'use client'`) sits next to
  Refresh on `/hub` and next to the back-link on `/hub/search`, flips
  `document.documentElement`'s `data-theme` attribute and persists the
  choice to `localStorage`. No app state or route involved, so it's the same
  everywhere the CSS is loaded - didn't need wiring into every page
  separately beyond adding the button itself.
  - **Flash-free on load**: a plain inline `<script>` in `app/layout.js`'s
    `<head>` (not a React effect, which would only run after the first
    paint) reads `localStorage` and falls back to
    `prefers-color-scheme: dark` if there's no stored choice yet, setting
    `data-theme` before anything renders. An explicit prior choice always
    wins over the OS setting; OS preference is only the *default* on a
    first-ever visit, not something that keeps overriding a saved choice.
  - This is the standard reason `<html suppressHydrationWarning>` is
    present: the server-rendered HTML never has `data-theme` (it can't know
    a client's localStorage), so React logs a hydration-mismatch warning
    for that one attribute unless told to expect it. Purely cosmetic and
    dev-only either way - production React strips hydration warnings
    entirely, so this doesn't exist in what Vercel actually serves.
  - Verified via computed styles rather than only visually (a Browser-pane
    display hiccup broke screenshots mid-check): confirmed
    `getComputedStyle(document.body).backgroundColor` flips between the
    light and dark `--color-bg` values on toggle, confirmed
    `data-theme`/`localStorage` both update together, confirmed the choice
    survives a reload. Also checked visually (before the pane hiccup) across
    Watching, Good Fits (track-colored cards, score badges, the reasoning
    disclosure), the source health status pills, `/hub/search`, and mobile
    (375px) - all read cleanly with no low-contrast or invisible elements.

**A single malformed row from any one source could crash the entire ingest,
discarding all 16 sources' data for that run - found live in production,
2026-08-18.** Nick clicked "Refresh now" on the deployed site and got a raw
Next.js error page. Real cause, from Vercel's runtime logs (`vercel logs
<url>`, not `vercel inspect --logs` - that one's build logs only): a Walmart
Workday posting (req R-2542634) came back from Workday's own API with no
`title` and no `externalPath` — some kind of withdrawn/placeholder listing
that still surfaces in search results, `raw: {"bulletFields":["R-2542634"]}`
and nothing else. `jobs.title` and `jobs.apply_url` are both NOT NULL
(confirmed via `information_schema.columns`), so upserting that row threw a
Postgres `23502` (not-null violation) — and since `lib/ingest.mjs` upserts
*all* sources' merged/deduped rows in one shared batch after every adapter
has already run, one bad row from Walmart took down the write for
Ashby/Greenhouse/CSU/PSD/everything else in that run too, not just Walmart's
own data. Fixed at two levels: `workday()` now skips any posting missing
`title`/`externalPath` at the source; `ingest()` also filters `rows` for
`title && apply_url` right before the upsert as a general backstop, since
any future adapter could produce a row missing a required field the same
way — logged as `droppedInvalid` in the summary so a drop is visible, not
silent. Verified three ways before considering this closed: a full local
ingest completed clean; the actual production endpoint
(`/api/ingest?secret=...`) was hit directly and completed in 46.7s; the real
"Refresh now" button was clicked on the live deployed site (via
`nick:<pass>@` in the URL once, then a second plain-URL navigation so the
browser's cached Basic Auth credential carries over without embedding it in
`window.location` — embedded credentials break Server Actions client-side,
already documented above) and it completed with no error.

**While investigating, confirmed Vercel Hobby's 60s function-duration cap is
NOT currently a real risk despite `maxDuration: 300` being set in
`app/api/ingest/route.js`** (Hobby silently clamps a requested value like
that down to 60s rather than honoring it - decoding the `VERCEL_OIDC_TOKEN`
JWT in `.env.local` confirms `"plan":"hobby"`). Every *local* ingest this
session took 68-225s, well past 60s, which looked alarming - but the same
ingest actually run on Vercel's own infrastructure (both via the direct
`/api/ingest` hit and via the real "Refresh now" Server Action) completed in
under 50s both times. Production is simply faster than this dev machine at
reaching the same external APIs. Worth re-checking if source count or data
volume grows further - the margin under 60s isn't huge - but not a problem
today, and no `maxDuration` tuning was needed on `app/hub/page.js` (the
Server Action's file) to fix anything real.

- **Four smaller `/hub` refinements, 2026-08-18**:
  - **Exact refresh time** replaces "last refreshed 2h ago" with "last
    refreshed Aug 18, 10:43 AM" (`exactTime()` in `page.js`, hardcoded
    `America/Denver` since Nick's timezone is fixed and Vercel renders in
    UTC - computing this client-side to pick up the browser's real
    timezone would've been the other valid option, but wasn't needed here).
  - **Company filter**: a job's company name is now a link to
    `/hub/search?q=<company>` whenever that company currently has more than
    one active listing (`CompanyName` in `JobCard.jsx`, backed by
    `computeMultiCompanies()` in the new `app/hub/multiCompanies.mjs` -
    shared between `page.js` and `search/page.js` rather than duplicated).
    Single-listing companies render as plain text, matching what was asked
    for - a filter link only pays for itself once there's more than one
    result behind it.
  - **"New since your last refresh"**: a distinct, more precise signal than
    the existing "New today" (rolling 24h). There's no stored history of
    past ingest-run boundaries, so this leans on how `ingest.mjs` actually
    writes data - `first_seen_at` is a DB default that fires once, at
    first-insert time, so every job from the same run lands within seconds
    of each other. Cutoff is `max(sources.last_run_at) - 10min`. A
    clickable count near the top links to a dedicated section
    (`#since-refresh`) showing just those jobs.
  - **Saved jobs are now fully exclusive to "Saved for later"** - originally
    they stayed visible everywhere else too with just a badge; Nick asked
    for real separation instead. `savedIds` now excludes from Watching,
    New, Still-open, Good Fits, and the since-refresh section, the same
    pattern `watchingIds` already used to keep Watching out of New/Still-open.
  - Verified via direct HTML inspection rather than trusting a first grep
    result: an initial check made it look like a saved job was still
    showing in "New since your last refresh" (grep matched the job's title
    string without regard for *which* section it was in - the exact same
    false-positive shape as the "Optician" incident earlier in this file).
    Tracing the actual surrounding HTML showed the title only appears in
    the Saved for later section's markup, plus once more in the React
    hydration payload script (expected, not a duplicate render) - and the
    "N new since your last refresh" count had correctly dropped by one.

- **"★ Saved for later" also lives on `/hub/search` now, 2026-08-18** — Nick
  asked "provide a way to view the saved jobs on the site" even though the
  section already existed on `/hub` itself. Given the same section already
  requires scrolling past Watching to find and only renders at all when
  non-empty, the more likely read was "give me a stable, always-reachable
  place to check," not "build this from scratch" - so it was added
  alongside Muted & watched / Recently dismissed on `/hub/search`, which
  already serves exactly that purpose, rather than duplicated as a new page.
  Byline link on `/hub` updated to say "saved, muted & dismissed" so it's
  advertised. Uses its own local `UnsaveAction` (mirrors `RestoreAction` in
  the same file) rather than importing `page.js`'s copy, matching how
  action-wrapper components in this codebase stay page-local.
  Every row currently in `saved_jobs` at the time (7, all from this
  session's own feature testing, none from Nick actually using it) was
  cleared before shipping so the first real use of the feature doesn't open
  on a list of jobs he never actually saved.

- **8 more direct-employer sources seeded, 2026-08-20** — this session's
  outbound network access is restricted to an allowlist (GitHub, npm, the
  Anthropic API); `fetch`/`curl`/`WebFetch` to arbitrary hosts like
  `boards-api.greenhouse.io` all came back `EGRESS_BLOCKED`, the same
  no-network situation Phase 1 was originally authored under. So these were
  identified via `WebSearch` (which does work — routed differently) rather
  than a live Network-tab check, then seeded straight into the `sources`
  table on the real `xkfuoqhvfkjyausukscx` project via the Supabase MCP
  tools (`supabase/migrations/0002_more_sources.sql`) since that tool talks
  to Supabase's API directly, not through this session's blocked egress.
  All `workday`, all `locationTerm: "Colorado"`, tenant+site taken from an
  exact slug seen in a real job URL or login-page link (not just "they use
  Workday" prose) to keep the guess quality in line with this file's own
  wd5/wd504-dead and Costco-isn't-Workday history: **Woodward** (Fort
  Collins HQ — `woodward.wd5.myworkdayjobs.com/woodward`), **Banner
  Health** (`bannerhealth.wd5.myworkdayjobs.com/Careers` — a second tenant
  `wd108` also showed up in search results and wasn't seeded; if `wd5`
  comes back FAIL, that's the one to try), **Target**
  (`target.wd5.myworkdayjobs.com/targetcareers` — this one was already a
  probe-only entry in `scripts/probe-sources.mjs`, never actually a seeded
  source until now), **Home Depot**
  (`homedepot.wd5.myworkdayjobs.com/CareerDepot`), **Lowe's**
  (`lowes.wd5.myworkdayjobs.com/LWS_External_CS`), **Sysco**
  (`sysco.wd5.myworkdayjobs.com/syscocareers`), **US Foods**
  (`usfoods.wd1.myworkdayjobs.com/usfoodscareersExternal`), **FedEx**
  (`fedex.wd1.myworkdayjobs.com/FXE-US_External_Career_Site` — FedEx runs
  several regional Workday sites off the same `wd1` tenant, e.g.
  `FXE_APAC_External`; this is specifically the US one). Companies
  researched but deliberately *not* seeded, and why, are listed under
  "Adding a source" below.
  **None of this is verified against live data yet** — added to the seed
  table, not proven to return real jobs. Correct behavior either way: a
  wrong guess shows up as `FAIL` on the source-health table without
  affecting any other source (per the "a broken adapter must never wipe the
  board" design), it doesn't silently corrupt anything. The real
  confirmation is the next scheduled ingest (daily cron, 09:45 UTC) or a
  manual "Refresh now" click — check source health after either and fix any
  `FAIL` the same way past ones were fixed (open the real careers page,
  watch the Network tab for the `/wday/cxs/.../jobs` POST, copy the real
  tenant/site). Also added matching probes to `scripts/probe-sources.mjs`
  for a faster check than a full ingest.
  **Also found and fixed a real, pre-existing bug while in the sources
  table**: `gov-fortcollins` still pointed at the `govjobs_rss` adapter,
  which was fully removed from the `ADAPTERS` registry back on 2026-08-17
  when NeoGov's RSS retirement was confirmed (replaced by the `govjobs`
  organization-search adapter for the sources that could move to it). That
  rename was never applied to this one row, so every ingest since then threw
  `unknown adapter: govjobs_rss` for it — caught by `Promise.allSettled` into
  a silent per-source `FAIL` rather than surfacing anywhere. Not repointed at
  `govjobs`: this file already established Fort Collins isn't on
  governmentjobs.com at all (Cornerstone OnDemand, auth-walled, covered via
  the `quicklaunch.js` deep link instead). Disabled via
  `0003_disable_stale_govjobs_rss.sql` (`enabled = false`, matching how the
  dead wd5 Walmart row was handled) rather than deleted.

### Not done
- ~~Migration has not been applied~~ — **done 2026-08-17**, against the
  corrected project (`xkfuoqhvfkjyausukscx`). The earlier password failure
  wasn't a stale credential on a valid project — this file pointed at a
  project that was never actually provisioned for jobhub. See the note under
  Stack above.
- **No API keys yet.** Nick deferred them. CareerOneStop, JSearch, USAJOBS and
  Adzuna adapters will throw until `.env.local` is filled. Everything else
  (Walmart, Sam's Club, Costco, Greenhouse, Lever, Ashby, SmartRecruiters,
  Remotive, GovernmentJobs RSS) runs keyless.
- ~~No auth on `/hub`~~ — **partially done 2026-08-17.** Full Supabase Auth
  (real accounts/sessions) is still not built - what exists now is a much
  lighter gate: `middleware.js` does HTTP Basic Auth on `/hub` specifically,
  driven by `BASIC_AUTH_USER`/`BASIC_AUTH_PASS` (unset = no gate, so local
  dev is unaffected). Deliberately scoped to just `/hub` — `/` stays public
  (it's meant to be, per the build plan) and `/api/ingest` is untouched
  (it already has its own `CRON_SECRET` check; layering Basic Auth on top
  would break Vercel Cron's own auth header). Verified locally: right
  creds → 200, wrong creds → 401, `/` and `/api/ingest` unaffected. Good
  enough for a single-user personal deploy; real Auth is still the answer
  if this ever needs more than one person to log in.
  **`BASIC_AUTH_USER`/`PASS` are commented out of local `.env.local` as of
  2026-08-18** (still set in Vercel's dashboard for prod — this only affects
  local dev). Embedding credentials in a `localhost` URL to get past the
  gate during browser-based testing breaks Server Actions client-side: the
  Fetch spec refuses to construct a `Request` from a URL containing
  userinfo, and Next's `fetchServerAction` hits that directly. The native
  browser auth-prompt dialog doesn't have this problem, but isn't easily
  automatable either, so leaving local dev gate-free (which the original
  comment here already called the intended behavior) is simplest.
- Email digest, pipeline tracker (Phase 4).
- ~~Scoring~~ — **done 2026-08-17.** Two stages, both wired into `ingest()`
  automatically, no separate step to remember to run:
  1. `lib/scoring.mjs` — free deterministic prefilter (title/keyword/location
     match against both resumes), runs for every active job every ingest.
  2. `lib/llm-score.mjs` — real model read (Claude Haiku) on whatever
     cleared the prefilter (score>=40), capped at 30/run for cost control.
     Needs its own `ANTHROPIC_API_KEY` in `.env.local` — get one at
     console.anthropic.com, **don't reuse apexload's** (separate project,
     separate billing visibility, same lesson as the Supabase mixup above).
     Skips itself cleanly (just the free prefilter runs) until that key is
     set — nothing breaks, it just doesn't do stage 2 yet.
  Both resumes' full text live in `resumes.extracted_text` now (plain text,
  pulled from `assets/Nick_Graziano_Resume_{HR,AI}_1.pdf`) — no PDF parsing
  needed at runtime.
  `/hub` has a "Refresh now" button (Server Action, not a client-exposed
  secret) and a "Good Fits for You" section at the top of the page reading
  from `scores`, showing the richer LLM fields (why it fits, gaps, pitch
  angle) once `scoring_method = 'llm'`, plain keyword tags until then.
- ~~Fort Collins + Remote filter~~ — **superseded 2026-08-18** by the fuller
  filter/sort/triage system below. `lib/filters.mjs` now centralizes all of
  it, replacing the old `NEAR_FC_OR`/`isNearFortCollinsOrRemote()` pair:
  - **Location**: full town checklist (`?near=`, comma-joined) — Fort
    Collins, Loveland, Greeley, Longmont, Windsor, Timnath, Remote. Text-match
    against `city`/`location_text` per town (handles Larimer County's `FC `/
    `LV ` abbreviations same as before); empty selection = no filter.
  - **Salary floor**: `?pay=40000|60000|80000|100000`. Unknown salary always
    passes through rather than being hidden — most sources don't post pay.
  - **Sort**: `?sort=salary|distance`, default (no param) is score-desc as
    fetched. `sortJobs()` in `lib/filters.mjs`.
  - **Dismiss ("Not for me")**: `dismissed_jobs` table, one row per job id,
    excluded from every query via `.not('id', 'in', (...))`. Permanent — no
    undo in the UI yet, just a straight delete from the table if one needs
    to come back.
  - **Mute / Watch a company or keyword**: reuses the existing `rules` table
    (`mute_company` / `mute_keyword` / `boost_company` / `boost_keyword`).
    Muted jobs are filtered out everywhere via `isMuted()`. A boost rule adds
    the job to a dedicated **"🎯 Watching"** section at the top of `/hub` —
    every open posting from that company/keyword regardless of score, still
    subject to the location/salary filters and mute rules. Both actions are
    one-click buttons (`RowActions` in `app/hub/page.js`) on every job row,
    wired to Server Actions in `app/hub/actions.js` (`dismissJob`,
    `muteCompany`, `watchCompany`), each ending in `revalidatePath('/hub')`.
  - **Good Fits track/bucket split**: no longer one blended list. Grouped
    first by resume (`AI Operations` vs the People/HR resume — whichever
    `resumes.label` values exist), then within each track by
    `score >= 60` ("Realistic — apply now") vs `40-59` ("Worth a stretch").
    An empty bucket or empty track section renders nothing (no "0 results"
    clutter) — as of 2026-08-18 only AI Operations has scored candidates at
    all (13 jobs, all 40-52, so only that track's "stretch" bucket has ever
    had real content to render; the other three combinations are verified
    correct by code inspection — `FitBucket` is one generic component with
    no per-track logic — not by seeing them populated live).

  Tested end-to-end via a real browser (not just curl): watch/dismiss verified
  by clicking the actual buttons and confirming the DB + rendered page both
  updated; mute shares `watchCompany`'s exact code path (same Server Action
  shape, different `rules.kind`) so wasn't separately re-tested, and wasn't
  tried against `walmart` specifically since that would've hidden Nick's
  actual target postings.

---

## Immediate next steps — all done, kept for history

1. ~~Apply `supabase/migrations/0001_init.sql`~~ — done 2026-08-17.
2. ~~Fill `.env.local`~~ — done. Project `xkfuoqhvfkjyausukscx`, dedicated to
   jobhub (not shared with apexload — see the Stack note above for why that
   distinction mattered).
3. ~~Probe sources~~ — done, 18/27 passing (rest are optional keys or two
   documented hard blocks — Fort Collins auth, UCHealth Cloudflare).
4. ~~Fix failing adapters~~ — done (Costco/Jibe, CSU/Workday tenant, PSD/
   SchoolSpring, governmentjobs.com's post-RSS endpoint).
5. ~~First real ingest~~ — done, 1993 active jobs as of last deploy.
6. ~~`npm run dev` → localhost:3000/hub~~ — done, plus the Good Fits section,
   Refresh now button, and Fort Collins/Remote filter that weren't in the
   original plan.
7. ~~Add auth, then deploy to Vercel~~ — **done 2026-08-17.** Live at
   **https://jobhub-pi.vercel.app**, project `graz-ly/jobhub` (separate from
   `graz-ly/apexload` — confirmed via `vercel project ls` before linking,
   confirmed again via each project's own ID after). Basic Auth on `/hub`
   only (user `nick`, password in `.env.local` / Vercel's env var dashboard
   under `BASIC_AUTH_PASS`), `/` public, `/api/ingest` on its own
   `CRON_SECRET`. All 9 required env vars set on Production + Preview.
   Verified live: `/` → 200, `/hub` no auth → 401, `/hub` with auth → 200
   with real data, `/api/ingest` no secret → 401. Vercel Cron will start
   firing daily at 09:45 UTC per `vercel.json` — that's real, ongoing
   `ANTHROPIC_API_KEY` spend now (~$1-3/mo), not just a local dev cost.

**What's left, not urgent:**
- Fort Collins (Cornerstone auth) and a real look at whether UCHealth's
  Cloudflare gate is worth revisiting.
- Full Supabase Auth if this ever needs more than one person logged in —
  Basic Auth is deliberately the minimum viable gate, not the end state.
- Phase 4 (application pipeline tracker, 10-day-silence nudges, weekly
  summary) and the email digest, per the original build plan.

## Then Phase 3

- Resume upload + text extraction into `resumes` (two profiles: People/HR, and
  AI Operations — they should score separately)
- Two-stage scoring: cheap keyword/distance/salary prefilter, then LLM scoring
  on survivors only (~30/day, pennies)
- Daily 4:15am MT email digest (Resend free tier)
- Push alerts for score > 85 only

## Then Phase 4

Application pipeline (saved → applied → screened → interview → offer),
10-day-silence nudges, cover letter drafting, Sunday summary.

---

## Adding a source

It's a database row, not a code change:

```sql
insert into sources (slug, label, adapter, tier, config) values
  ('gh-scale', 'Greenhouse — Scale AI', 'greenhouse', 1, '{"company":"scaleai"}');
```

Adapters: `workday` (needs `host`, `tenant`, `site`, optional `searchText` /
`locationTerm`), `jibe` (needs `domain`, optional `location`), `schoolspring`
(needs `refererUrl`, `employerLabel`), `greenhouse` / `lever` / `ashby` /
`smartrecruiters` (need `company`), `govjobs` (needs `organization`, optional
`location`), `careeronestop`, `jsearch`, `usajobs`, `adzuna`, `remotive`.
(`govjobs_rss` in the list this replaced is dead — the adapter itself was
removed 2026-08-17 when NeoGov's RSS feeds were confirmed retired; don't seed
a new row with it. `gov-fortcollins` still had the stale value until
2026-08-20 and was silently `FAIL`ing every run — see below.)

Still worth seeding: Otter Products (iCIMS — `careers-otterproducts.icims.com`,
no adapter written for that platform yet), Advanced Energy, Water Pik/Church &
Dwight, Hach/Veralto, Madwire (on Workable — `apply.workable.com/madwire-1`,
also no adapter yet), Vestas (multiple regional Workday tenants, none
confirmed US-specific), Kroger/King Soopers (Oracle Cloud HCM, not Workday),
Safeway/Albertsons (ATS unconfirmed), Amazon (no public jobs API — same
category as the Tier 3 sites, not worth scraping), UPS (Taleo), Broadcom
(ATS unconfirmed), McLane (not investigated).

---

## Working style

Nick prefers that you (a) offer a sharper rephrasing of an ambiguous question
before answering it, and (b) break a hard question into sub-questions and
combine the answers. He responds well to being told directly when a prior
recommendation was wrong — the Indeed/JSearch correction above came from him
pushing back, and that was the right call.
