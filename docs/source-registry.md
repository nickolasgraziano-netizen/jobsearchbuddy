# Job Source Registry

Every source evaluated for the hub, with current-as-of-August-2026 access status.
**33 probes** in `probe-sources.mjs`.

---

## The Indeed question — answered properly

I had Indeed in the plan only as a manual deep-link. That was based on the assumption that there's no legitimate API. Checking it now, the picture is more specific and slightly better than I said:

- **Indeed deprecated its Publisher API in 2024.** The XML feed was retired.
- **The Indeed Apply API still exists but is partner-gated** — approval runs a multi-month sales process, granted mainly to large recruiting platforms and ATS vendors. Not realistically available to an individual.
- **Scraping Indeed remains off the table** — legally contested and actively bot-blocked.
- **But there is a legitimate indirect route: JSearch.** It reads **Google for Jobs**, which itself indexes Indeed, LinkedIn, ZipRecruiter, and Glassdoor postings. You're consuming Google's public index rather than scraping those four sites. Free tier on RapidAPI is prototype-sized but real, and each result carries a `job_publisher` field so you can see which board it came from.

**Revised position:** Indeed, LinkedIn, ZipRecruiter and Glassdoor move from "manual only" to **"automated via JSearch, with manual deep-links as backup for anything JSearch's free tier misses."** That's a meaningful upgrade to the original plan and worth the probe.

The one caveat: JSearch is reading search-results pages, so coverage is broad but shallow, and dedup is on you. It complements Tier 1, it doesn't replace it.

---

## Tier 1 — Direct employer feeds

No key, structured JSON, and postings appear here *before* they syndicate anywhere else.

| Source | Endpoint pattern | Key? | Status |
|---|---|---|---|
| **Walmart** (corporate + DC) | `walmart.wd5.myworkdayjobs.com/wday/cxs/walmart/WalmartExternal/jobs` (POST) | No | Tenant confirmed |
| **Walmart internal** | same tenant, site `Non-WorkdayInternal` | Login | Confirmed to exist — your lead-time edge |
| **Walmart (alt tenant)** | `walmart.wd504.myworkdayjobs.com/...` | No | Confirmed, probe both |
| **Sam's Club** | Walmart pipeline, `careers.walmart.com/us/en/sams-home` | No | Confirmed same system |
| **Costco** | Workday / SmartRecruiters — probe both | No | Unconfirmed, probed |
| **Greenhouse** | `boards-api.greenhouse.io/v1/boards/{co}/jobs` | No | **✔ VERIFIED LIVE** |
| **Ashby** | `api.ashbyhq.com/posting-api/job-board/{co}` | No | **✔ VERIFIED LIVE** |
| **Lever** | `api.lever.co/v0/postings/{co}?mode=json` | No | Format confirmed |
| **SmartRecruiters** | `api.smartrecruiters.com/v1/companies/{co}/postings` | No | Probed |
| **iCIMS / Taleo / SuccessFactors** | varies | No | Fallback for older enterprise |

**Northern Colorado employers to seed:** UCHealth, Colorado State University, Banner Health, Otter Products, Woodward, Advanced Energy, Broadcom Fort Collins, Water Pik, In-Situ, Encompass Technologies, Madwire, Intel Fort Collins, Hach (Loveland), Lightning eMotors, Vestas (Windsor/Brighton).

**Retail/logistics peers worth the same treatment:** Target, Kroger/King Soopers, Safeway/Albertsons, Amazon, UPS, FedEx, Home Depot, Lowe's, Sysco, US Foods, McLane, Sprouts, Natural Grocers, Walgreens, CVS, Dollar General, Tractor Supply.

---

## Tier 2 — Aggregators (new sources in bold)

| Source | Free tier | Covers | Key |
|---|---|---|---|
| **CareerOneStop (US DOL)** | **Free, generous** | **Aggregates STATE job banks incl. Connecting Colorado, plus NLx employer feeds. Best free source for hourly/warehouse/retail.** | Free |
| **JSearch (RapidAPI)** | **Capped monthly** | **Google for Jobs → Indeed, LinkedIn, ZipRecruiter, Glassdoor** | Free tier |
| USAJOBS | Unlimited | US federal | Free |
| Adzuna | 1,000 calls/mo | Broad US aggregation + salary estimates | Free |
| **Jooble** | Free API | Broad aggregation, good US coverage | Free |
| **Careerjet** | Free affiliate ID | Broad aggregation | Free |
| The Muse | Free | Corporate roles + company profiles | No |
| **Findwork** | Free tier | Tech-leaning | Free |
| Remotive | Full feed | Remote tech | No |
| RemoteOK | Full feed | Remote (attribution link required by terms) | No |
| **Arbeitnow** | Public feed | Europe-leaning — low priority for you | No |
| **JobsPipe** | 1,000 jobs/mo | 30+ ATS + boards, pre-deduplicated, incl. Indeed index | Free tier |
| **Fantastic.jobs** | Usage-based | 8M+ jobs/mo from ATS + LinkedIn | Paid |
| **SerpApi** | ~$75/mo | Google for Jobs — the paid, higher-volume JSearch alternative | Paid |

---

## Tier 2b — Local public sector (new)

Most Colorado municipalities run on **GovernmentJobs/NeoGov**, which exposes RSS at a predictable URL — trivial adapters, high relevance for a local search:

- City of Fort Collins · Larimer County · City of Loveland · City of Greeley
- State of Colorado · Poudre School District · Thompson School District
- Colorado State University · Front Range Community College
- Platte River Power Authority · Northern Water

---

## Tier 3 — Still manual (shrunk considerably)

With JSearch covering the big four indirectly, the manual list is now much smaller:

- **Glassdoor company reviews** (not the postings — the *reviews*, for researching an employer before you apply)
- **LinkedIn recruiter messages and network signals** — no API, and honestly the most valuable part of LinkedIn for you anyway
- **Handshake / niche boards** where relevant

Keep the Quick Launch panel regardless — it costs nothing and covers whatever JSearch's free tier misses.

---

## Recommended priority for Phase 1

1. **CareerOneStop** — free, no gatekeeping, and directly aimed at your hourly/warehouse half. Probably the highest value-per-hour source on this whole list.
2. **Walmart Workday** (all sites incl. Sam's Club) — your core target.
3. **JSearch** — one adapter, four big boards, answers the Indeed question.
4. **Greenhouse + Ashby + Lever** — already verified, covers your AI-certification half.
5. **GovernmentJobs RSS** — five-line adapter, five local employers each.

---

## Sources

- [Indeed API status 2026 — JobsPipe](https://jobspipe.dev/sources/indeed)
- [Best jobs APIs 2026 compared — JobsPipe](https://jobspipe.dev/blog/best-jobs-api-2026)
- [Free jobs APIs compared — JobsPipe](https://jobspipe.dev/free-jobs-api)
- [Jobs APIs directory — PublicAPIs.io](https://publicapis.io/category/jobs)
- [CareerOneStop Web API](https://www.careeronestop.org/Developers/WebAPI/web-api.aspx)
- [CareerOneStop List Jobs API](https://www.careeronestop.org/Developers/WebAPI/Jobs/list-jobs.aspx)
- [JSearch — OpenWeb Ninja](https://www.openwebninja.com/api/jsearch)
- [Best Job APIs 2026 — Bright Data](https://brightdata.com/blog/web-data/best-job-apis)
- [Walmart Workday careers](https://walmart.wd5.myworkdayjobs.com/WalmartExternal)
- [Sam's Club Careers](https://careers.walmart.com/us/en/sams-home)
