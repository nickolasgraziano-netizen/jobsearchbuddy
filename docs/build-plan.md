# Job Search Hub — Build Plan

**Owner:** Nick · **Base location:** Fort Collins / Loveland, CO (80524)
**Stack decision:** Next.js + Supabase + Vercel
**Scope:** corporate/salaried · hourly/retail/warehouse · remote-first · government
**Delivery:** dashboard + daily email digest + high-match push + weekly summary

---

## 1. The core insight

Don't build a search engine. Build a **change detector**.

Searching is the wrong mental model — it means you do work every day and mostly see the same 400 jobs you saw yesterday. The valuable thing is knowing what is *new since the last time you looked*, ranked by how well it fits you. Everything below is built around that.

Practical consequence: the database stores every posting it has ever seen, with a `first_seen_at` timestamp. Your 4:15am digest is a query for `first_seen_at > yesterday`. Brand-new listings get a visual NEW badge that persists for 24 hours so you physically cannot miss them.

---

## 2. Source strategy — three tiers

### Tier 1 — Direct employer feeds (the backbone)

Most large employers run their careers site on an ATS platform with a public, structured JSON endpoint. This is legal, clean, fast, and shows postings *before* they syndicate to aggregators. This tier is where Walmart, Sam's Club, and Costco live.

| Platform | How it works | Notable employers |
|---|---|---|
| Workday (`/wday/cxs/{tenant}/{site}/jobs`) | POST with search + location facets, returns JSON | Walmart, Sam's Club, Target, Kroger, Salesforce, Nvidia, and hundreds more |
| Greenhouse (`boards-api.greenhouse.io/v1/boards/{co}/jobs`) | Public GET, no key | Most tech/AI startups — key for your AI-certification angle |
| Lever (`api.lever.co/v0/postings/{co}?mode=json`) | Public GET, no key | Mid-size tech |
| Ashby (`api.ashbyhq.com/posting-api/job-board/{co}`) | Public GET | Newer AI companies |
| SmartRecruiters (`api.smartrecruiters.com/v1/companies/{co}/postings`) | Public GET | Large enterprise, retail |
| iCIMS / Taleo / SuccessFactors | Varies, some JSON, some need HTML parse | Older enterprise, some grocery/logistics |

**Walmart / Sam's Club specifics.** Walmart runs several distinct pipelines and you need all of them, because a DC role and a corporate role live in different systems:

- `careers.walmart.com` — corporate, tech, and management roles
- Walmart's hourly/store application system — store and club associate roles
- Supply chain / distribution center postings — your Loveland DC target (7500 E Crossroads Blvd) surfaces here
- `careers.samsclub.com` — Sam's Club, which posts under the Walmart umbrella but with its own facets

Since you already work at Walmart as a people lead, also wire in the **internal jobs board** if it's reachable — internal reqs frequently post days before the external mirror, and that lead time is the single biggest edge you have. Worst case it needs a manual login and you just deep-link it.

**Costco** — `costco.com/careers` runs its own system; warehouse and depot roles are geo-filtered. Add Fort Collins, Loveland, Longmont, and Greeley locations.

**Build a target-company list, not a target-site list.** This tier scales to 150+ employers with the same six adapters. Seed it with: Walmart, Sam's Club, Costco, Target, King Soopers/Kroger, Amazon, UPS, FedEx, Home Depot, Lowe's, Safeway/Albertsons, Sysco, US Foods, plus your Front Range employers (CSU, UCHealth, Otter Products, Woodward, Broadcom Fort Collins, Advanced Energy, Water Pik) and an AI-company list on Greenhouse/Lever/Ashby.

### Tier 2 — Aggregators with real APIs

Covers the long tail — small employers you'd never think to list.

- **USAJOBS** — free official API, just needs an email + key. Covers your government/public-sector interest.
- **Adzuna** — free tier, good US coverage, includes salary estimates
- **Jooble / Careerjet / JSearch (RapidAPI)** — broad aggregation
- **The Muse** — free, corporate roles
- **Remotive / RemoteOK / WeWorkRemotely** — remote-first, free JSON or RSS
- **Colorado state job board + City of Fort Collins + Larimer County** — public sector, usually RSS

### Tier 3 — The walled gardens

LinkedIn, Indeed, ZipRecruiter, Glassdoor. These actively block automation and scraping violates their terms of service. **Do not scrape them.** The site should not be the thing that gets you into a dispute while you're job hunting.

The honest, effective workaround: a **Quick Launch panel** on your dashboard — a row of buttons that open your saved searches with all filters pre-encoded in the URL. One click each, four sites, fifteen seconds a day. You keep full coverage without the legal exposure, and in practice Tier 1 already caught most of it a day earlier anyway.

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────┐
│  Vercel Cron (03:45 MT daily)                       │
│     ↓                                               │
│  /api/ingest  → runs all source adapters in parallel│
│     ↓                                               │
│  Normalize → Dedupe (fingerprint) → Score (vs resume)│
│     ↓                                               │
│  Supabase: jobs · sources · resumes · applications  │
│     ↓                                               │
│  ┌──────────┬───────────┬──────────┬──────────────┐ │
│  │Dashboard │Daily email│Push if   │Weekly Sunday │ │
│  │(Next.js) │(04:15 MT) │score>85  │summary       │ │
│  └──────────┴───────────┴──────────┴──────────────┘ │
└─────────────────────────────────────────────────────┘
```

**Why this shape:** the ingest is one scheduled serverless function, so nothing runs when you're not using it and the whole thing sits inside Vercel and Supabase free tiers. Adapters are independent modules — adding a new employer is a config row, not a code change.

### Database sketch

- **`sources`** — id, name, adapter type, config JSON (tenant, company slug, facets), enabled, last_run_at, last_status
- **`jobs`** — id, fingerprint (unique), source_id, external_id, title, company, location, lat/lng, remote_flag, salary_min/max, description, apply_url, posted_at, **first_seen_at**, last_seen_at, is_active, raw JSON
- **`resumes`** — id, label, file_path, extracted_text, keywords, target_titles
- **`scores`** — job_id, resume_id, score, matched_keywords, missing_keywords, reasoning
- **`applications`** — job_id, resume_used, status, applied_at, last_activity_at, notes, next_action_date
- **`rules`** — mute filters (companies, keywords, staffing agencies), boost rules

### Deduplication

Fingerprint = hash of `normalize(title) + normalize(company) + normalize(city/state)`. The same Walmart req appears on six aggregators; you should see it once, with a little "also on: Indeed, Adzuna, Jooble" line. When a duplicate arrives, keep the record with the **earliest** `posted_at` and the **most direct** apply URL (employer site beats aggregator, always — applying direct has a materially better response rate than applying through an aggregator).

### Scoring

Two-stage, because it's cheap and it's better:

1. **Cheap prefilter** — keyword and title overlap against your resume(s), distance from 80524, salary floor, remote flag. Kills 90% of noise for free.
2. **LLM scoring on the survivors** — an API call that reads the posting against your resume text and returns `{score, why_it_fits, gaps, which_resume_to_use, suggested_bullet_tweaks}`. At ~30 survivors a day this costs pennies.

Feed it your Walmart people-lead experience and your AI certifications as two separate resume profiles, so a DC people-partner role and an AI-ops role each score against the right document.

---

## 4. The site itself

**Public half** (`/`) — clean personal site: who you are, experience summary, downloadable resume(s), contact. This is the URL you put on applications and in your email signature. Costs you nothing extra and makes the whole project double as a credibility asset.

**Private half** (`/hub`, behind Supabase Auth):

- **Today** — new since yesterday, NEW badges, sorted by score. The 4:15am screen.
- **Board** — full searchable/filterable archive with saved views (e.g. "DC within 25mi", "AI remote", "Fort Collins gov")
- **Pipeline** — kanban: Saved → Applied → Screened → Interview → Offer / Closed. Auto-nudge on 10-day silence.
- **Resumes** — upload, version, tag by target role; the scorer uses these
- **Quick Launch** — the Tier 3 deep-link buttons
- **Sources** — health dashboard showing which adapters ran, which failed, when. *(Silent adapter failure is the #1 way tools like this quietly stop working — a source that returns zero results for 3 days should raise a flag, not just show you fewer jobs.)*

---

## 5. Features worth having that most people skip

- **Application deadline + repost detection.** If a req disappears and reappears, that often means the first search failed — a genuinely good moment to apply.
- **Company watch.** Pin an employer; get told about *any* new posting there regardless of score. Obvious pick: the Loveland DC.
- **Commute-aware ranking.** Score by drive time from 80524, not straight-line miles. I-25 corridor distances lie.
- **Cover letter draft on demand.** One button on a job → drafted letter using that posting's language and the resume you picked.
- **Rejection memory.** Mark a company or listing as rejected; never see reposts of it again.
- **Salary sanity band.** Where a posting hides pay, show the Adzuna/BLS estimate for that title in Larimer County so you're not negotiating blind.
- **Export.** One click → spreadsheet of everything applied to, for your own records.

---

## 6. Phased build

**Phase 1 — Skeleton (get value on day one)**
Next.js scaffold, Supabase schema, auth, Vercel deploy. Three adapters: Walmart (Workday), Sam's Club, Costco. Dashboard showing new-today. *You are already better off than manual searching at the end of this phase.*

**Phase 2 — Breadth**
Remaining Tier 1 adapters (Greenhouse, Lever, Ashby, SmartRecruiters) + target company list. Tier 2 APIs: USAJOBS, Adzuna, Remotive. Dedup engine. Quick Launch panel.

**Phase 3 — Intelligence**
Resume upload + parsing. Two-stage scoring. Daily 4:15am email digest. High-match push alerts.

**Phase 4 — Pipeline**
Application tracker, nudges, cover letter drafting, weekly Sunday summary, source health monitoring.

**Phase 5 — Public face**
Portfolio/resume front end, custom domain, polish.

---

## 7. Costs

| Item | Cost |
|---|---|
| Vercel Hobby | $0 |
| Supabase free tier | $0 |
| Domain | ~$12/yr |
| Email sending (Resend free tier, 3k/mo) | $0 |
| LLM scoring (~30 jobs/day) | ~$1–3/mo |
| Adzuna / USAJOBS / Greenhouse / Lever | $0 |
| **Total** | **~$2–4/mo + domain** |

---

## 8. Risks and honest caveats

- **Adapters break.** Employers change their careers platform without warning. Mitigation: source health dashboard, and adapters that fail loudly rather than silently returning zero.
- **Tier 3 stays manual.** This is a deliberate constraint, not a gap to be engineered around later.
- **Rate limits.** Space requests, cache aggressively, run once daily rather than hourly. Nothing here needs real-time.
- **Scoring is a filter, not a judge.** A 62 might be the job you should take. The dashboard should always let you see everything, with score as a sort — never as a hard hide.
- **Internal Walmart postings** may need manual login. Treat the internal board as a deep-link at first; only automate it if it's clearly permitted.

---

## 9. Open decisions

1. Custom domain name?
2. Email digest at 4:15am to match your existing alarm, or slightly earlier so it's waiting when you wake?
3. Push alerts via text (Twilio, small cost) or push notification (free)?
4. Do you want the public portfolio half live immediately, or private-only until the hub works?
5. How wide is the geographic net — strictly 15–25mi from 80524, all of Northern Colorado, or Denver metro too for the right role?
