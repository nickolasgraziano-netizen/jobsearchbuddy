/**
 * Tier 3 — the walled gardens.
 *
 * LinkedIn, Indeed, ZipRecruiter and Glassdoor block automation and scraping
 * them violates their terms. JSearch covers them indirectly via Google for
 * Jobs, but its free tier is shallow, so these pre-filled deep links are the
 * backstop: one click each, filters already applied.
 */

const ZIP = '80524';
const CITY = 'Fort Collins, CO';
const RADIUS = 25;

export const QUICK_LAUNCH = [
  {
    site: 'Indeed',
    note: 'Publisher API retired 2024 — deep link only',
    searches: [
      { label: 'All jobs near 80524', url: `https://www.indeed.com/jobs?l=${ZIP}&radius=${RADIUS}&fromage=1&sort=date` },
      { label: 'Walmart DC / supply chain', url: `https://www.indeed.com/jobs?q=walmart+distribution+center&l=${ZIP}&radius=${RADIUS}&fromage=3&sort=date` },
      { label: 'People Partner / HR', url: `https://www.indeed.com/jobs?q=%22people+partner%22+OR+%22people+lead%22+OR+%22HR+manager%22&l=${ZIP}&radius=${RADIUS}&fromage=7&sort=date` },
      { label: 'AI / ML remote', url: `https://www.indeed.com/jobs?q=AI+OR+%22machine+learning%22&l=Remote&fromage=3&sort=date` },
    ],
  },
  {
    site: 'LinkedIn',
    note: 'No public API — recruiter messages live here, worth the daily click',
    searches: [
      { label: 'Past 24h near Fort Collins', url: `https://www.linkedin.com/jobs/search/?keywords=&location=${encodeURIComponent(CITY)}&distance=${RADIUS}&f_TPR=r86400&sortBy=DD` },
      { label: 'Walmart / Sam\'s Club', url: `https://www.linkedin.com/jobs/search/?keywords=Walmart%20OR%20%22Sam%27s%20Club%22&location=${encodeURIComponent('Colorado, United States')}&f_TPR=r604800&sortBy=DD` },
      { label: 'AI roles, remote', url: `https://www.linkedin.com/jobs/search/?keywords=AI%20OR%20%22machine%20learning%22&f_WT=2&f_TPR=r86400&sortBy=DD` },
    ],
  },
  {
    site: 'ZipRecruiter',
    searches: [
      { label: 'Near 80524, newest', url: `https://www.ziprecruiter.com/jobs-search?search=&location=${ZIP}&radius=${RADIUS}&days=1` },
      { label: 'Warehouse / logistics', url: `https://www.ziprecruiter.com/jobs-search?search=warehouse+OR+distribution&location=${ZIP}&radius=${RADIUS}&days=3` },
    ],
  },
  {
    site: 'Glassdoor',
    note: 'Use for company research before applying, not for finding jobs',
    searches: [
      { label: 'Walmart DC reviews', url: 'https://www.glassdoor.com/Reviews/Walmart-Reviews-E715.htm' },
      { label: 'Jobs near Fort Collins', url: `https://www.glassdoor.com/Job/fort-collins-co-us-jobs-SRCH_IL.0,18_IC1148170.htm` },
    ],
  },
  {
    site: 'City of Fort Collins',
    note: 'Cornerstone OnDemand career site - the actual job-search API needs a session token the SPA sets up client-side, not a simple public call. Deep link only.',
    searches: [
      { label: 'All current openings (39 as of last check)', url: 'https://fcgov.csod.com/ux/ats/careersite/12/home?c=fcgov' },
    ],
  },
  {
    site: 'UCHealth',
    note: 'Real data, but the site is behind an active Cloudflare bot challenge (confirmed 403 on a plain fetch) — same call as Tier 3, deep link rather than fight it',
    searches: [
      { label: 'All Colorado jobs (filter by location in-page)', url: 'https://careers.uchealth.org/search/colorado/jobs' },
    ],
  },
  {
    site: 'Walmart internal',
    note: 'Reqs often post here days before the external mirror — your biggest edge',
    searches: [
      { label: 'Internal board (login required)', url: 'https://walmart.wd5.myworkdayjobs.com/en-US/Non-WorkdayInternal' },
    ],
  },
];
