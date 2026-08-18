import { makeJob } from '../normalize.mjs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function req(url, opts = {}, timeoutMs = 25000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...opts, signal: ctl.signal,
      headers: { 'User-Agent': UA, Accept: 'application/json,text/xml,*/*', ...(opts.headers || {}) },
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { ok: res.ok, status: res.status, json, text };
  } finally { clearTimeout(t); }
}

/* ── Workday — Walmart, Sam's Club, Costco, Target, ~40% of the F500 ──── */

async function workday(cfg) {
  const { host, tenant, site, searchText = '', locationTerm = '' } = cfg;
  const url = `https://${host}/wday/cxs/${tenant}/${site}/jobs`;
  const out = [];

  // Workday pages 20 at a time; walk up to 200 so a big DC drop isn't truncated.
  for (let offset = 0; offset < 200; offset += 20) {
    const r = await req(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appliedFacets: {}, limit: 20, offset,
        searchText: [searchText, locationTerm].filter(Boolean).join(' '),
      }),
    });
    const posts = r.json?.jobPostings || [];
    if (!posts.length) break;

    for (const p of posts) {
      out.push(makeJob({
        externalId: p.bulletFields?.[0] || p.externalPath,
        title: p.title,
        company: cfg.companyLabel || tenant,
        locationText: p.locationsText,
        applyUrl: `https://${host}/en-US/${site}${p.externalPath}`,
        postedAt: parsePostedOn(p.postedOn),
        raw: p,
      }));
    }
    if (posts.length < 20) break;
  }
  return out;
}

// Workday returns "Posted 3 Days Ago" / "Posted Today" rather than a date.
function parsePostedOn(s) {
  if (!s) return null;
  const now = Date.now();
  if (/today/i.test(s)) return new Date(now);
  if (/yesterday/i.test(s)) return new Date(now - 864e5);
  const d = (s.match(/(\d+)\+?\s*day/i) || [])[1];
  if (d) return new Date(now - Number(d) * 864e5);
  const m = (s.match(/(\d+)\+?\s*month/i) || [])[1];
  if (m) return new Date(now - Number(m) * 30 * 864e5);
  return null;
}

/* ── Jibe — Costco's careers site search API (iCIMS-backed under the hood,
      ats_code on each posting confirms it). NOT Workday, despite the 422
      the old costco.wd1.myworkdayjobs.com guess produced. Confirmed live by
      watching careers.costco.com's Network tab: it calls this endpoint
      directly, no auth. `location` is the only filter param that actually
      narrows results (postalCode/radius/keyword are silently ignored) and
      page size is fixed at 10 regardless of a pageSize param. ─────────── */

async function jibe(cfg) {
  const { domain, location = '' } = cfg;
  const out = [];

  // Fixed at 10/page server-side — walk up to 200 so we don't miss a drop.
  for (let page = 1; page <= 20; page++) {
    const url = `https://careers.costco.com/api/jobs?page=${page}&sortBy=relevance&descending=false&internal=false&domain=${domain}` +
      (location ? `&location=${encodeURIComponent(location)}` : '');
    const r = await req(url);
    const jobs = r.json?.jobs || [];
    if (!jobs.length) break;

    for (const entry of jobs) {
      const j = entry?.data;
      if (!j) continue;
      out.push(makeJob({
        externalId: j.req_id,
        title: j.title,
        company: cfg.companyLabel || 'Costco',
        locationText: j.full_location,
        description: j.description,
        applyUrl: j.apply_url,
        postedAt: j.posted_date,
        raw: j,
      }));
    }
    if (jobs.length < 10) break;
  }
  return out;
}

/* ── Greenhouse / Lever / Ashby / SmartRecruiters ─────────────────────── */

async function greenhouse({ company }) {
  const r = await req(`https://boards-api.greenhouse.io/v1/boards/${company}/jobs?content=true`);
  return (r.json?.jobs || []).map(j => makeJob({
    externalId: j.id, title: j.title, company,
    locationText: j.location?.name,
    description: j.content, applyUrl: j.absolute_url,
    postedAt: j.updated_at, raw: j,
  }));
}

async function lever({ company }) {
  const r = await req(`https://api.lever.co/v0/postings/${company}?mode=json`);
  return (Array.isArray(r.json) ? r.json : []).map(j => makeJob({
    externalId: j.id, title: j.text, company,
    locationText: j.categories?.location,
    employmentType: j.categories?.commitment,
    description: j.descriptionPlain, applyUrl: j.hostedUrl,
    postedAt: j.createdAt, raw: j,
  }));
}

async function ashby({ company }) {
  const r = await req(`https://api.ashbyhq.com/posting-api/job-board/${company}?includeCompensation=true`);
  return (r.json?.jobs || []).map(j => makeJob({
    externalId: j.id, title: j.title, company,
    locationText: j.location, isRemote: j.isRemote,
    employmentType: j.employmentType,
    salaryText: j.compensation?.summary,
    description: j.descriptionPlain, applyUrl: j.jobUrl,
    postedAt: j.publishedAt, raw: j,
  }));
}

async function smartrecruiters({ company }) {
  const r = await req(`https://api.smartrecruiters.com/v1/companies/${company}/postings?limit=100`);
  return (r.json?.content || []).map(j => makeJob({
    externalId: j.id, title: j.name, company,
    locationText: [j.location?.city, j.location?.region].filter(Boolean).join(', '),
    isRemote: j.location?.remote,
    applyUrl: `https://jobs.smartrecruiters.com/${company}/${j.id}`,
    postedAt: j.releasedDate, raw: j,
  }));
}

/* ── CareerOneStop — US DOL. Aggregates the state job banks (incl.
      Connecting Colorado) + NLx employer feeds. Best free hourly source. ── */

async function careeronestop(cfg, env) {
  const { COS_API_KEY: key, COS_USER_ID: uid, HOME_ZIP = '80524', SEARCH_RADIUS_MILES = '25' } = env;
  if (!key || !uid) throw new Error('COS_API_KEY / COS_USER_ID not set');
  const kw = cfg.keyword || '0';
  const url = `https://api.careeronestop.org/v1/jobsearch/${uid}/${encodeURIComponent(kw)}/${HOME_ZIP}/${SEARCH_RADIUS_MILES}/0/0/100/0/false`;
  const r = await req(url, { headers: { Authorization: `Bearer ${key}` } });
  return (r.json?.Jobs || []).map(j => makeJob({
    externalId: j.JvId, title: j.JobTitle, company: j.Company,
    locationText: j.Location, applyUrl: j.URL,
    postedAt: j.DatePosted, raw: j,
  }));
}

/* ── JSearch — reads Google for Jobs, which indexes Indeed, LinkedIn,
      ZipRecruiter and Glassdoor. The legitimate route to those four. ────── */

async function jsearch(cfg, env) {
  const key = env.RAPIDAPI_KEY;
  if (!key) throw new Error('RAPIDAPI_KEY not set');
  const q = cfg.query || `jobs in Fort Collins, CO`;
  const pages = cfg.pages || 2;
  const out = [];
  for (let page = 1; page <= pages; page++) {
    const r = await req(
      `https://jsearch.p.rapidapi.com/search?query=${encodeURIComponent(q)}&page=${page}&num_pages=1&country=us&date_posted=week`,
      { headers: { 'x-rapidapi-key': key, 'x-rapidapi-host': 'jsearch.p.rapidapi.com' } });
    const data = r.json?.data || [];
    if (!data.length) break;
    for (const j of data) {
      out.push(makeJob({
        externalId: j.job_id, title: j.job_title, company: j.employer_name,
        locationText: [j.job_city, j.job_state].filter(Boolean).join(', '),
        isRemote: j.job_is_remote,
        employmentType: j.job_employment_type,
        salaryMin: j.job_min_salary, salaryMax: j.job_max_salary,
        description: j.job_description,
        // Prefer the employer's own apply link over the aggregator's.
        applyUrl: j.job_apply_link,
        postedAt: j.job_posted_at_datetime_utc,
        raw: { ...j, _publisher: j.job_publisher },
      }));
    }
  }
  return out;
}

/* ── USAJOBS / Adzuna / Remotive ──────────────────────────────────────── */

async function usajobs(cfg, env) {
  const { USAJOBS_API_KEY: key, USAJOBS_EMAIL: email, SEARCH_RADIUS_MILES = '25' } = env;
  if (!key || !email) throw new Error('USAJOBS_API_KEY / USAJOBS_EMAIL not set');
  const r = await req(
    `https://data.usajobs.gov/api/search?LocationName=${encodeURIComponent(cfg.location || 'Fort Collins, Colorado')}&Radius=${SEARCH_RADIUS_MILES}&ResultsPerPage=100`,
    { headers: { 'Authorization-Key': key, 'User-Agent': email, Host: 'data.usajobs.gov' } });
  return (r.json?.SearchResult?.SearchResultItems || []).map(i => {
    const d = i.MatchedObjectDescriptor;
    const pay = d.PositionRemuneration?.[0];
    return makeJob({
      externalId: d.PositionID, title: d.PositionTitle,
      company: d.OrganizationName,
      locationText: d.PositionLocationDisplay,
      salaryMin: pay ? Number(pay.MinimumRange) : null,
      salaryMax: pay ? Number(pay.MaximumRange) : null,
      description: d.UserArea?.Details?.JobSummary,
      applyUrl: d.PositionURI, postedAt: d.PublicationStartDate, raw: d,
    });
  });
}

async function adzuna(cfg, env) {
  const { ADZUNA_APP_ID: id, ADZUNA_APP_KEY: key, SEARCH_RADIUS_MILES = '25' } = env;
  if (!id || !key) throw new Error('ADZUNA_APP_ID / ADZUNA_APP_KEY not set');
  const r = await req(`https://api.adzuna.com/v1/api/jobs/us/search/1?app_id=${id}&app_key=${key}&where=${encodeURIComponent(cfg.where || 'Fort Collins, CO')}&distance=${SEARCH_RADIUS_MILES}&results_per_page=50&content-type=application/json`);
  return (r.json?.results || []).map(j => makeJob({
    externalId: j.id, title: j.title, company: j.company?.display_name,
    locationText: j.location?.display_name,
    salaryMin: j.salary_min, salaryMax: j.salary_max,
    description: j.description, applyUrl: j.redirect_url,
    postedAt: j.created, raw: j,
  }));
}

async function remotive() {
  const r = await req('https://remotive.com/api/remote-jobs?limit=100');
  return (r.json?.jobs || []).map(j => makeJob({
    externalId: j.id, title: j.title, company: j.company_name,
    locationText: j.candidate_required_location, isRemote: true,
    employmentType: j.job_type, salaryText: j.salary,
    description: j.description, applyUrl: j.url,
    postedAt: j.publication_date, raw: j,
  }));
}

/* ── SchoolSpring (api.schoolspring.com) — K-12 district job boards, incl.
      Poudre School District. Public and keyless, but scoped by the calling
      Referer/Origin rather than a domainName query param (confirmed:
      domainName= empty + Referer set to the district's board URL returns
      that district's jobs; a guessed domainName value returns nothing).
      Two calls per job (list, then detail) since the list view has no
      description or real apply URL - detail's `infoURL` is the actual
      third-party ATS link (tedk12.com for PSD, varies by district). ────── */

function stripHtml(html) {
  if (!html) return null;
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

async function schoolspring(cfg) {
  const { refererUrl, employerLabel } = cfg;
  const headers = { Referer: refererUrl, Origin: new URL(refererUrl).origin };
  const out = [];

  for (let page = 1; page <= 5; page++) {
    const listUrl = `https://api.schoolspring.com/api/Jobs/GetPagedJobsWithSearch?domainName=&keyword=&location=&category=&gradelevel=&jobtype=&organization=&swLat=&swLon=&neLat=&neLon=&page=${page}&size=25&sortDateAscending=false`;
    const r = await req(listUrl, { headers });
    const jobs = r.json?.value?.jobsList || [];
    if (!jobs.length) break;

    for (const j of jobs) {
      const d = await req(`https://api.schoolspring.com/api/Jobs/${j.jobId}?domainName=`, { headers });
      const info = d.json?.value?.jobInfo;
      out.push(makeJob({
        externalId: j.jobId,
        title: j.title,
        company: j.employer || employerLabel,
        locationText: j.location,
        salaryMin: info?.payMin || null,
        salaryMax: info?.payMax || null,
        description: stripHtml(info?.jobDescription),
        applyUrl: info?.infoURL || refererUrl,
        postedAt: j.displayDate,
        raw: j,
      }));
    }
    if (jobs.length < 25) break;
  }
  return out;
}

/* ── GovernmentJobs.com / NeoGov — unified job search by organization name.
      RSS was retired (confirmed dead 2026-08-17 — every /careers/{agency}/rss
      URL either 404s or silently returns zero items now). This scrapes the
      same search results a human sees at governmentjobs.com/jobs, keyless,
      and doesn't require guessing a per-agency "career page" slug — several
      agencies confirmed here don't even have one (Fort Collins and Poudre
      School District aren't on this platform at all; see CLAUDE.md). ────── */

const decodeEntities = s => (s || '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'");

async function govjobs({ organization, location = 'Colorado' }) {
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const url = `https://www.governmentjobs.com/jobs?location=${encodeURIComponent(location)}` +
      `&organization%5B0%5D=${encodeURIComponent(organization)}&sort=date&isDescendingSort=True&page=${page}`;
    const r = await req(url);
    const items = r.text.split('<li class="job-item"').slice(1);
    if (!items.length) break;

    for (const chunk of items) {
      const title = (chunk.match(/class="job-details-link"[^>]*>([^<]+)</) || [])[1];
      const href = (chunk.match(/class="job-details-link" href="([^"]+)"/) || [])[1];
      const locationText = (chunk.match(/class="job-location">([^<]+)</) || [])[1];
      if (!title || !href) continue;
      out.push(makeJob({
        externalId: (chunk.match(/data-job-id="([^"]+)"/) || [])[1],
        title: decodeEntities(title.trim()), company: organization,
        locationText: decodeEntities(locationText), applyUrl: `https://www.governmentjobs.com${href}`,
        raw: { organization },
      }));
    }
    if (items.length < 10) break;
  }
  return out;
}

/* ── registry ─────────────────────────────────────────────────────────── */

export const ADAPTERS = {
  workday, jibe, schoolspring, greenhouse, lever, ashby, smartrecruiters,
  careeronestop, jsearch, usajobs, adzuna, remotive, govjobs,
};

export async function runAdapter(source, env) {
  const fn = ADAPTERS[source.adapter];
  if (!fn) throw new Error(`unknown adapter: ${source.adapter}`);
  return fn(source.config || {}, env);
}
