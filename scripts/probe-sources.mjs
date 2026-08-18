#!/usr/bin/env node
/**
 * probe-sources.mjs — Job Search Hub source verification
 *
 * Proves which job-board adapters actually work from a machine with
 * unrestricted network access. Run this on your laptop, or deploy it as a
 * Vercel function. Node 18+ only, zero dependencies.
 *
 *   node probe-sources.mjs
 *   node probe-sources.mjs --zip 80524 --radius 25
 *   node probe-sources.mjs --json > probe-results.json
 *
 * Every probe prints: PASS / EMPTY / FAIL, the HTTP status, how many jobs
 * came back, and up to 3 real job titles so you can eyeball that the data
 * is genuinely what we want.
 */

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i > -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const JSON_OUT = args.includes('--json');
const ZIP = flag('zip', '80524');
const RADIUS = parseInt(flag('radius', '25'), 10);
const LOCATION_TERMS = ['Fort Collins', 'Loveland', 'Greeley', 'Longmont', 'Windsor', 'Timnath'];

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const results = [];

const log = (...a) => { if (!JSON_OUT) console.log(...a); };

function record(name, status, detail, sample = [], meta = {}) {
  results.push({ name, status, detail, sample, ...meta });
  if (JSON_OUT) return;
  const icon = status === 'PASS' ? '\x1b[32m✔ PASS \x1b[0m'
    : status === 'EMPTY' ? '\x1b[33m~ EMPTY\x1b[0m'
    : '\x1b[31m✖ FAIL \x1b[0m';
  console.log(`${icon} ${name.padEnd(34)} ${detail}`);
  sample.slice(0, 3).forEach(s => console.log(`         · ${s}`));
}

async function req(url, opts = {}, timeoutMs = 25000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: ctl.signal,
      headers: { 'User-Agent': UA, Accept: 'application/json,text/plain,*/*', ...(opts.headers || {}) },
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { ok: res.ok, status: res.status, json, text };
  } catch (e) {
    return { ok: false, status: 0, json: null, text: '', error: e.message };
  } finally {
    clearTimeout(t);
  }
}

/* ── Workday (Walmart, Sam's Club, and ~40% of the Fortune 500) ───────── */

async function workday(label, host, site, searchText = '', locationTerm = '') {
  const url = `https://${host}/wday/cxs/${host.split('.')[0]}/${site}/jobs`;
  const body = { appliedFacets: {}, limit: 20, offset: 0, searchText: [searchText, locationTerm].filter(Boolean).join(' ') };
  const r = await req(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  if (!r.json) return record(label, 'FAIL', `HTTP ${r.status}${r.error ? ' — ' + r.error : ''} — no JSON`, [], { url });
  const posts = r.json.jobPostings || [];
  const total = r.json.total ?? posts.length;
  const sample = posts.map(p => `${p.title} — ${p.locationsText || '?'} (${p.bulletFields?.[0] || p.externalPath || ''})`);
  return record(label, posts.length ? 'PASS' : 'EMPTY', `HTTP ${r.status} · total=${total} · returned=${posts.length}`, sample, { url, total });
}

/* ── Jibe — Costco's careers site (confirmed via Network tab; it's NOT
      Workday despite the costco.wd1.myworkdayjobs.com guess this used to
      test). `location` is the only filter param that narrows results. ──── */

async function jibe(label, domain, location = '') {
  const url = `https://careers.costco.com/api/jobs?page=1&sortBy=relevance&descending=false&internal=false&domain=${domain}` +
    (location ? `&location=${encodeURIComponent(location)}` : '');
  const r = await req(url);
  if (!r.json) return record(label, 'FAIL', `HTTP ${r.status}${r.error ? ' — ' + r.error : ''} — no JSON`, [], { url });
  const jobs = (r.json.jobs || []).map(e => e?.data).filter(Boolean);
  const total = r.json.totalCount ?? jobs.length;
  return record(label, jobs.length ? 'PASS' : 'EMPTY', `HTTP ${r.status} · total=${total} · returned=${jobs.length}`,
    jobs.map(j => `${j.title} — ${j.full_location} (${j.req_id})`), { url, total });
}

/* ── SchoolSpring — K-12 district boards, scoped by Referer not a query
      param. Confirmed: domainName= empty + Referer set to the district's
      board URL returns that district's jobs. ────────────────────────────── */

async function schoolspring(label, refererUrl) {
  const headers = { Referer: refererUrl, Origin: new URL(refererUrl).origin };
  const url = `https://api.schoolspring.com/api/Jobs/GetPagedJobsWithSearch?domainName=&keyword=&location=&category=&gradelevel=&jobtype=&organization=&swLat=&swLon=&neLat=&neLon=&page=1&size=10&sortDateAscending=false`;
  const r = await req(url, { headers });
  if (!r.json?.success) return record(label, 'FAIL', `HTTP ${r.status}${r.error ? ' — ' + r.error : ''}`, [], { url });
  const jobs = r.json.value?.jobsList || [];
  return record(label, jobs.length ? 'PASS' : 'EMPTY', `HTTP ${r.status} · ${jobs.length} returned`,
    jobs.map(j => `${j.title} — ${j.location}`), { url });
}

/* ── Greenhouse / Lever / Ashby / SmartRecruiters ─────────────────────── */

async function greenhouse(co) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${co}/jobs`;
  const r = await req(url);
  if (!r.json?.jobs) return record(`Greenhouse: ${co}`, 'FAIL', `HTTP ${r.status}`, [], { url });
  const j = r.json.jobs;
  return record(`Greenhouse: ${co}`, j.length ? 'PASS' : 'EMPTY', `HTTP ${r.status} · ${j.length} jobs`,
    j.slice(0, 3).map(x => `${x.title} — ${x.location?.name || '?'}`), { url, total: j.length });
}

async function lever(co) {
  const url = `https://api.lever.co/v0/postings/${co}?mode=json`;
  const r = await req(url);
  if (!Array.isArray(r.json)) return record(`Lever: ${co}`, 'FAIL', `HTTP ${r.status}`, [], { url });
  return record(`Lever: ${co}`, r.json.length ? 'PASS' : 'EMPTY', `HTTP ${r.status} · ${r.json.length} jobs`,
    r.json.slice(0, 3).map(x => `${x.text} — ${x.categories?.location || '?'}`), { url, total: r.json.length });
}

async function ashby(co) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${co}`;
  const r = await req(url);
  if (!r.json?.jobs) return record(`Ashby: ${co}`, 'FAIL', `HTTP ${r.status}`, [], { url });
  const j = r.json.jobs;
  return record(`Ashby: ${co}`, j.length ? 'PASS' : 'EMPTY', `HTTP ${r.status} · ${j.length} jobs`,
    j.slice(0, 3).map(x => `${x.title} — ${x.location || '?'}`), { url, total: j.length });
}

async function smartrecruiters(co) {
  const url = `https://api.smartrecruiters.com/v1/companies/${co}/postings?limit=20`;
  const r = await req(url);
  if (!r.json?.content) return record(`SmartRecruiters: ${co}`, 'FAIL', `HTTP ${r.status}`, [], { url });
  const c = r.json.content;
  return record(`SmartRecruiters: ${co}`, c.length ? 'PASS' : 'EMPTY',
    `HTTP ${r.status} · totalFound=${r.json.totalFound} · returned=${c.length}`,
    c.slice(0, 3).map(x => `${x.name} — ${x.location?.city || '?'}, ${x.location?.region || ''}`),
    { url, total: r.json.totalFound });
}

/* ── Aggregators ──────────────────────────────────────────────────────── */

async function usajobs() {
  const key = process.env.USAJOBS_API_KEY, email = process.env.USAJOBS_EMAIL;
  const url = `https://data.usajobs.gov/api/search?LocationName=Fort%20Collins,%20Colorado&Radius=${RADIUS}&ResultsPerPage=10`;
  if (!key || !email) return record('USAJOBS', 'EMPTY', 'no USAJOBS_API_KEY / USAJOBS_EMAIL set — free key at developer.usajobs.gov', [], { url });
  const r = await req(url, { headers: { 'Authorization-Key': key, 'User-Agent': email, Host: 'data.usajobs.gov' } });
  const items = r.json?.SearchResult?.SearchResultItems || [];
  return record('USAJOBS', items.length ? 'PASS' : 'EMPTY',
    `HTTP ${r.status} · ${r.json?.SearchResult?.SearchResultCount ?? 0} results`,
    items.slice(0, 3).map(x => `${x.MatchedObjectDescriptor?.PositionTitle} — ${x.MatchedObjectDescriptor?.PositionLocationDisplay}`),
    { url });
}

async function adzuna() {
  const id = process.env.ADZUNA_APP_ID, key = process.env.ADZUNA_APP_KEY;
  const url = `https://api.adzuna.com/v1/api/jobs/us/search/1?app_id=${id}&app_key=${key}&where=Fort%20Collins%2C%20CO&distance=${RADIUS}&results_per_page=10`;
  if (!id || !key) return record('Adzuna', 'EMPTY', 'no ADZUNA_APP_ID / ADZUNA_APP_KEY set — free key at developer.adzuna.com', [], { url: url.replace(/app_(id|key)=[^&]*/g, 'app_$1=…') });
  const r = await req(url);
  const rs = r.json?.results || [];
  return record('Adzuna', rs.length ? 'PASS' : 'EMPTY', `HTTP ${r.status} · count=${r.json?.count ?? 0}`,
    rs.slice(0, 3).map(x => `${x.title} — ${x.location?.display_name} (${x.company?.display_name})`));
}

async function remotive() {
  const url = 'https://remotive.com/api/remote-jobs?limit=10';
  const r = await req(url);
  const j = r.json?.jobs || [];
  return record('Remotive (remote)', j.length ? 'PASS' : 'EMPTY', `HTTP ${r.status} · ${r.json?.['job-count'] ?? j.length} jobs`,
    j.slice(0, 3).map(x => `${x.title} — ${x.company_name}`), { url });
}

async function remoteok() {
  const url = 'https://remoteok.com/api';
  const r = await req(url);
  const j = Array.isArray(r.json) ? r.json.slice(1) : [];
  return record('RemoteOK (remote)', j.length ? 'PASS' : 'EMPTY', `HTTP ${r.status} · ${j.length} jobs`,
    j.slice(0, 3).map(x => `${x.position} — ${x.company}`), { url });
}

// CareerOneStop — US Dept of Labor. Free key, and it aggregates the STATE
// job banks (incl. Connecting Colorado) plus NLx employer feeds. This is the
// single best free source for hourly / warehouse / retail roles.
async function careeronestop() {
  const key = process.env.COS_API_KEY, uid = process.env.COS_USER_ID;
  const url = `https://api.careeronestop.org/v1/jobsearch/${uid}/${encodeURIComponent('')}/${ZIP}/${RADIUS}/0/0/50/0/false`;
  if (!key || !uid) return record('CareerOneStop (US DOL)', 'EMPTY', 'no COS_API_KEY / COS_USER_ID — free key at careeronestop.org/Developers', [], { url });
  const r = await req(url, { headers: { Authorization: `Bearer ${key}` } });
  const j = r.json?.Jobs || [];
  return record('CareerOneStop (US DOL)', j.length ? 'PASS' : 'EMPTY',
    `HTTP ${r.status} · ${r.json?.RecordCount ?? j.length} jobs`,
    j.slice(0, 3).map(x => `${x.JobTitle} — ${x.Location} (${x.Company})`), { url });
}

// JSearch — the ONLY legitimate route to Indeed / LinkedIn / ZipRecruiter /
// Glassdoor data. Reads Google for Jobs rather than scraping those sites.
async function jsearch() {
  const key = process.env.RAPIDAPI_KEY;
  const url = `https://jsearch.p.rapidapi.com/search?query=${encodeURIComponent('jobs in Fort Collins, CO')}&page=1&num_pages=1&country=us`;
  if (!key) return record('JSearch → Indeed/LinkedIn/ZR', 'EMPTY', 'no RAPIDAPI_KEY set — free tier at rapidapi.com/letscrape/api/jsearch', [], { url });
  const r = await req(url, { headers: { 'x-rapidapi-key': key, 'x-rapidapi-host': 'jsearch.p.rapidapi.com' } });
  const d = r.json?.data || [];
  return record('JSearch → Indeed/LinkedIn/ZR', d.length ? 'PASS' : 'EMPTY', `HTTP ${r.status} · ${d.length} jobs`,
    d.slice(0, 3).map(x => `${x.job_title} — ${x.employer_name} [via ${x.job_publisher}]`), { url });
}

async function themuse() {
  const url = 'https://www.themuse.com/api/public/jobs?page=1&location=Denver%2C%20CO';
  const r = await req(url);
  const j = r.json?.results || [];
  return record('The Muse', j.length ? 'PASS' : 'EMPTY', `HTTP ${r.status} · ${j.length} jobs`,
    j.slice(0, 3).map(x => `${x.name} — ${x.company?.name}`), { url });
}

async function arbeitnow() {
  const url = 'https://www.arbeitnow.com/api/job-board-api';
  const r = await req(url);
  const j = r.json?.data || [];
  return record('Arbeitnow', j.length ? 'PASS' : 'EMPTY', `HTTP ${r.status} · ${j.length} jobs`,
    j.slice(0, 3).map(x => `${x.title} — ${x.company_name}`), { url });
}

async function findwork() {
  const key = process.env.FINDWORK_KEY;
  const url = 'https://findwork.dev/api/jobs/?location=colorado';
  if (!key) return record('Findwork', 'EMPTY', 'no FINDWORK_KEY set — free key at findwork.dev/developers', [], { url });
  const r = await req(url, { headers: { Authorization: `Token ${key}` } });
  const j = r.json?.results || [];
  return record('Findwork', j.length ? 'PASS' : 'EMPTY', `HTTP ${r.status} · ${r.json?.count ?? j.length} jobs`,
    j.slice(0, 3).map(x => `${x.role} — ${x.company_name}`), { url });
}

async function jooble() {
  const key = process.env.JOOBLE_KEY;
  const url = `https://jooble.org/api/${key || 'KEY'}`;
  if (!key) return record('Jooble', 'EMPTY', 'no JOOBLE_KEY set — free key at jooble.org/api/about', [], { url: 'https://jooble.org/api/…' });
  const r = await req(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keywords: '', location: `Fort Collins, CO`, radius: String(RADIUS) }) });
  const j = r.json?.jobs || [];
  return record('Jooble', j.length ? 'PASS' : 'EMPTY', `HTTP ${r.status} · totalCount=${r.json?.totalCount ?? 0}`,
    j.slice(0, 3).map(x => `${x.title} — ${x.location} (${x.company})`), { url: 'https://jooble.org/api/…' });
}

async function careerjet() {
  const aff = process.env.CAREERJET_AFFID;
  const url = `https://public.api.careerjet.net/search?locale_code=en_US&location=Fort+Collins%2C+CO&radius=${RADIUS}&pagesize=20&affid=${aff || 'AFFID'}&user_ip=1.2.3.4&user_agent=Mozilla`;
  if (!aff) return record('Careerjet', 'EMPTY', 'no CAREERJET_AFFID set — free affid at partners.careerjet.com', [], { url: 'https://public.api.careerjet.net/search?…' });
  const r = await req(url);
  const j = r.json?.jobs || [];
  return record('Careerjet', j.length ? 'PASS' : 'EMPTY', `HTTP ${r.status} · hits=${r.json?.hits ?? 0}`,
    j.slice(0, 3).map(x => `${x.title} — ${x.locations} (${x.company})`));
}

// RSS retired 2026-08-17 (every /careers/{agency}/rss now 404s or returns
// zero items). This scrapes the same governmentjobs.com/jobs search a human
// sees, by organization name rather than a per-agency slug.
async function govjobs(label, organization, location = 'Colorado') {
  const url = `https://www.governmentjobs.com/jobs?location=${encodeURIComponent(location)}` +
    `&organization%5B0%5D=${encodeURIComponent(organization)}&sort=date&isDescendingSort=True`;
  const r = await req(url);
  const items = r.text.split('<li class="job-item"').slice(1);
  const sample = items.slice(0, 3).map(chunk => {
    const title = (chunk.match(/class="job-details-link"[^>]*>([^<]+)</) || [])[1];
    const loc = (chunk.match(/class="job-location">([^<]+)</) || [])[1];
    return `${title || '?'} — ${loc || '?'}`;
  });
  return record(label, items.length ? 'PASS' : 'EMPTY', `HTTP ${r.status} · ${items.length} items`, sample, { url });
}

/* ── Run ──────────────────────────────────────────────────────────────── */

(async () => {
  log('\n\x1b[1mJob Search Hub — source probe\x1b[0m');
  log(`ZIP ${ZIP} · radius ${RADIUS}mi · ${new Date().toLocaleString()}\n`);

  log('\x1b[1m── Tier 1: Walmart / Sam\'s Club / Costco ─────────────────────\x1b[0m');
  // wd5 confirmed dead 2026-08-17 (HTTP 200, no JSON, every site tried) —
  // wd504 is the live tenant. If one FAILs again, open the careers page,
  // watch the Network tab for a /wday/cxs/.../jobs POST, and copy the site
  // name from the URL.
  await workday('Walmart — external (wd504)', 'walmart.wd504.myworkdayjobs.com', 'WalmartExternal', '', 'Colorado');
  await workday('Walmart — DC/supply chain', 'walmart.wd504.myworkdayjobs.com', 'WalmartExternal', 'distribution center', 'Loveland');
  await workday('Walmart — People Partner', 'walmart.wd504.myworkdayjobs.com', 'WalmartExternal', 'People Partner', 'Colorado');
  await workday('Sam\'s Club', 'walmart.wd504.myworkdayjobs.com', 'WalmartExternal', 'Sams Club', 'Colorado');
  await jibe('Costco', 'costco.jibeapply.com', 'Colorado');

  log('\n\x1b[1m── Tier 1: ATS platforms (AI + corporate sourcing) ───────────\x1b[0m');
  await greenhouse('anthropic');
  await ashby('openai');
  await lever('gopuff');
  await smartrecruiters('Bosch');

  log('\n\x1b[1m── Tier 1: Northern Colorado employers ───────────────────────\x1b[0m');
  await workday('UCHealth', 'uchealth.wd1.myworkdayjobs.com', 'UCHealth', '', 'Fort Collins');
  await workday('Colorado State University', 'csusystem.wd12.myworkdayjobs.com', 'fortcollins_careers', '', '');
  await workday('Target', 'target.wd5.myworkdayjobs.com', 'targetcareers', '', 'Colorado');

  log('\n\x1b[1m── Tier 2: Aggregators ───────────────────────────────────────\x1b[0m');
  await careeronestop();   // best free source for hourly/warehouse
  await jsearch();         // the legitimate Indeed / LinkedIn / ZipRecruiter route
  await usajobs();
  await adzuna();
  await jooble();
  await careerjet();
  await themuse();
  await findwork();
  await remotive();
  await remoteok();
  await arbeitnow();

  log('\n\x1b[1m── Tier 2: Local public sector ────────────────────────────────\x1b[0m');
  await govjobs('Larimer County', 'Larimer County');
  await govjobs('City of Loveland', 'City of Loveland');
  await govjobs('State of Colorado', 'State of Colorado');
  await schoolspring('Poudre School District', 'https://psdschools.schoolspring.com/');
  // Fort Collins runs Cornerstone OnDemand (fcgov.csod.com), not
  // governmentjobs.com — the job-search API needs a session token the SPA
  // sets up client-side (confirmed 401 on a plain call even to a plausible
  // endpoint), unlike everything else here. Deep link in quicklaunch.js
  // instead — see CLAUDE.md for the full finding.

  if (JSON_OUT) { console.log(JSON.stringify({ zip: ZIP, radius: RADIUS, ranAt: new Date().toISOString(), results }, null, 2)); return; }

  const pass = results.filter(r => r.status === 'PASS').length;
  const empty = results.filter(r => r.status === 'EMPTY').length;
  const fail = results.filter(r => r.status === 'FAIL').length;
  console.log(`\n\x1b[1mSummary:\x1b[0m ${pass} PASS · ${empty} EMPTY · ${fail} FAIL   (of ${results.length} probes)`);
  console.log('\nEMPTY usually means a wrong company slug or a missing API key, not a dead source.');
  console.log('FAIL means the endpoint or site name has moved — check the careers page Network tab.');
  console.log('\nSend me the output (or `--json` and paste the file) and I\'ll build the adapters that passed.\n');
})();
