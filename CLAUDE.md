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
- **Fort Collins + Remote filter**, added 2026-08-17: `?near=fortcollins` on
  `/hub` (plain link toggle, no client JS) filters all three job sections to
  `city/location_text` matching Fort Collins (including Larimer County's
  `FC ` abbreviation) OR `is_remote = true`. Shared logic lives twice on
  purpose — `NEAR_FC_OR` (PostgREST `.or()` string) for the two direct
  `jobs` queries, `isNearFortCollinsOrRemote()` (JS predicate) for Good
  Fits, since that one's already fetched via the `scores` embed and easier
  to filter client-side than fight PostgREST's embedded-resource filtering.

---

## Immediate next steps

1. ~~Apply `supabase/migrations/0001_init.sql`~~ — done 2026-08-17.
2. Fill `.env.local` — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   and `CRON_SECRET` are already set (project `xkfuoqhvfkjyausukscx`). Still
   need `SUPABASE_SERVICE_ROLE_KEY` from that project's dashboard (Settings ->
   API -> service_role) to start.
3. `node --env-file=.env.local scripts/probe-sources.mjs` — find which adapters
   actually work. Expect some FAILs; Workday site names drift.
4. Fix failing adapters. **To find a Workday site name:** open the careers page,
   watch the Network tab for a `POST /wday/cxs/{tenant}/{site}/jobs`, copy
   `tenant` and `site` from the URL into that source's `config` JSON.
5. `node --env-file=.env.local scripts/ingest-local.mjs` — first real ingest.
6. `npm run dev` → `localhost:3000/hub`.
7. Add auth, then deploy to Vercel with all env vars set.

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
`locationTerm`), `greenhouse` / `lever` / `ashby` / `smartrecruiters` (need
`company`), `govjobs_rss` (needs `agency`), `careeronestop`, `jsearch`,
`usajobs`, `adzuna`, `remotive`.

Worth seeding once the basics work — Northern Colorado: UCHealth, CSU, Banner
Health, Otter Products, Woodward, Advanced Energy, Broadcom Fort Collins, Water
Pik, Hach, Madwire, Vestas. Retail/logistics peers: Target, Kroger/King
Soopers, Safeway/Albertsons, Amazon, UPS, FedEx, Home Depot, Lowe's, Sysco, US
Foods, McLane.

---

## Working style

Nick prefers that you (a) offer a sharper rephrasing of an ambiguous question
before answering it, and (b) break a hard question into sub-questions and
combine the answers. He responds well to being told directly when a prior
recommendation was wrong — the Indeed/JSearch correction above came from him
pushing back, and that was the right call.
