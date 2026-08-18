# Job Hub — Phase 1

A job **change detector** for Northern Colorado. Pulls postings from employer
ATS feeds and aggregators once a day, deduplicates them, and shows you only
what's new since yesterday.

Built for 80524. Walmart, Sam's Club, and Costco are first-class sources;
Indeed / LinkedIn / ZipRecruiter / Glassdoor come in through JSearch (which
reads Google for Jobs) with pre-filled deep links as the backstop.

---

## Setup (about 30 minutes)

### 1. Get the free API keys

| Source | Where | Env vars | Why it matters |
|---|---|---|---|
| **CareerOneStop** | [careeronestop.org/Developers](https://www.careeronestop.org/Developers/WebAPI/web-api.aspx) | `COS_API_KEY`, `COS_USER_ID` | US DOL. Aggregates state job banks incl. Connecting Colorado. Best free source for hourly/warehouse. |
| **JSearch** | [rapidapi.com](https://rapidapi.com) → search "JSearch" → free tier | `RAPIDAPI_KEY` | The legitimate route to Indeed, LinkedIn, ZipRecruiter, Glassdoor. |
| **USAJOBS** | [developer.usajobs.gov](https://developer.usajobs.gov) | `USAJOBS_API_KEY`, `USAJOBS_EMAIL` | Federal roles. |
| **Adzuna** | [developer.adzuna.com](https://developer.adzuna.com) | `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` | Broad aggregation + salary estimates. |

Greenhouse, Lever, Ashby, SmartRecruiters, Remotive, and the GovernmentJobs
RSS feeds need no key at all.

### 2. Probe the sources first

```bash
cp .env.example .env.local     # fill in the keys
node --env-file=.env.local scripts/probe-sources.mjs
```

33 probes, each reporting PASS / EMPTY / FAIL with real job titles.

- **EMPTY** usually means a wrong company slug or a missing key, not a dead source.
- **FAIL** means the endpoint moved — open that careers page, watch the Network
  tab for a `/wday/cxs/.../jobs` POST, and copy the site name out of the URL.

### 3. Create the Supabase project

```bash
npx supabase link --project-ref <your-ref>
npx supabase db push
```

Or just paste `supabase/migrations/0001_init.sql` into the Supabase SQL editor.
It creates the tables and seeds 16 sources.

### 4. Run locally

```bash
npm install
node --env-file=.env.local scripts/ingest-local.mjs   # first fetch
npm run dev                                            # → localhost:3000/hub
```

### 5. Deploy

```bash
npx vercel
```

Add every env var in the Vercel dashboard. `vercel.json` already schedules the
cron for **09:45 UTC = 3:45am Mountain**, so the board is fresh before your
4:15am check-in.

---

## How it works

```
Vercel Cron 3:45am MT
   ↓
/api/ingest  →  all sources in parallel (Promise.allSettled)
   ↓
normalize → fingerprint → dedup across sources → upsert
   ↓
Supabase.  first_seen_at is NEVER updated on conflict.
   ↓
/hub — "new since yesterday" with NEW badges
```

**The one design rule:** `first_seen_at` is set on insert and never touched
again. `last_seen_at` updates every run. That single distinction is what makes
"new since yesterday" trustworthy, and it's why this is a change detector
rather than a search box.

### Dedup

The same Walmart req shows up on six aggregators with six different IDs. The
fingerprint is `sha1(title + company + city + state)` after aggressive
normalization — lowercased, punctuation stripped, `(USA)` and seniority
suffixes removed. Verified: `(USA) People Partner - Transportation` at Walmart
in Loveland CO and `People Partner  Transportation` at `walmart` in
`loveland, co` produce the same fingerprint.

When duplicates merge, the row keeps the **earliest** `posted_at` and the
**most direct** apply URL — employer ATS beats government portal beats
aggregator, because applying direct has a materially better response rate.

### Silent-failure protection

Two safeguards, because a scraper that quietly returns zero looks identical to
"a slow hiring week":

1. `sources.consecutive_empty` increments on every empty run; the dashboard
   flags anything at 3+.
2. The deactivation sweep only touches sources that returned data this run, so
   a broken adapter can never wipe your board.

---

## Adding a source

It's a database row, not a code change:

```sql
insert into sources (slug, label, adapter, tier, config) values
  ('gh-scale', 'Greenhouse — Scale AI', 'greenhouse', 1, '{"company":"scaleai"}');
```

Available adapters: `workday`, `greenhouse`, `lever`, `ashby`,
`smartrecruiters`, `careeronestop`, `jsearch`, `usajobs`, `adzuna`,
`remotive`, `govjobs_rss`.

For Workday, `config` needs `host`, `tenant`, `site`, and optionally
`searchText` / `locationTerm`. For GovernmentJobs RSS it's just `agency` —
the slug from `governmentjobs.com/careers/<agency>`.

---

## What's not built yet

Phase 1 is the ingest + dedup + Today board. Still to come:

- **Phase 3** — resume upload, two-stage scoring (cheap keyword prefilter →
  LLM scoring on survivors), the 4:15am email digest, high-match push
- **Phase 4** — application pipeline tracker, 10-day silence nudges, cover
  letter drafting, Sunday summary
- **Phase 5** — the public portfolio half, custom domain

The `resumes`, `scores`, `applications`, and `rules` tables already exist in
the schema, so Phase 3 and 4 are additive — no migration rewrite.

---

## Running cost

Vercel Hobby $0 · Supabase free tier $0 · APIs $0 · domain ~$12/yr.
LLM scoring in Phase 3 adds roughly $1–3/month.
