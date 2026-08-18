import { roughMilesFromHome } from './normalize.mjs';

/**
 * Nick's actual target towns (build-plan.md's named area), not a generic
 * radius - some Larimer County postings abbreviate the city in
 * location_text ("FC 1501 Blue Spruce, CO", "LV 5280 Arena, CO") in a way
 * that doesn't parse into a clean `city` value, so text-matching handles
 * real data better than a pure lat/lng radius would here.
 */
export const TARGET_TOWNS = [
  { key: 'fortcollins', label: 'Fort Collins', abbr: 'FC' },
  { key: 'loveland', label: 'Loveland', abbr: 'LV' },
  { key: 'greeley', label: 'Greeley' },
  { key: 'longmont', label: 'Longmont' },
  { key: 'windsor', label: 'Windsor' },
  { key: 'timnath', label: 'Timnath' },
];

export const SALARY_FLOORS = [
  { key: '0', label: 'Any pay', value: 0 },
  { key: '40000', label: '$40k+', value: 40000 },
  { key: '60000', label: '$60k+', value: 60000 },
  { key: '80000', label: '$80k+', value: 80000 },
  { key: '100000', label: '$100k+', value: 100000 },
];

function matchesTown(job, town) {
  const loc = (job.location_text || '').toLowerCase();
  const city = (job.city || '').toLowerCase();
  const label = town.label.toLowerCase();
  if (city === label || loc.includes(label)) return true;
  if (town.abbr && new RegExp(`^${town.abbr}\\s`, 'i').test(job.location_text || '')) return true;
  return false;
}

/** locationSet: Set of 'remote' and/or TARGET_TOWNS keys. Empty set = no filter (match everything). */
export function matchesLocation(job, locationSet) {
  if (!locationSet || locationSet.size === 0) return true;
  if (locationSet.has('remote') && job.is_remote) return true;
  for (const town of TARGET_TOWNS) {
    if (locationSet.has(town.key) && matchesTown(job, town)) return true;
  }
  return false;
}

/** floor: number, 0 = no filter. Unknown salary passes through rather than being hidden. */
export function matchesSalaryFloor(job, floor) {
  if (!floor) return true;
  if (job.salary_max != null) return job.salary_max >= floor;
  if (job.salary_min != null) return job.salary_min >= floor;
  return true;
}

function ruleMatchesCompany(rule, job) {
  return job.company && job.company.toLowerCase().includes(rule.value.toLowerCase());
}

function ruleMatchesKeyword(rule, job) {
  const haystack = `${job.title || ''} ${job.description || ''}`.toLowerCase();
  return haystack.includes(rule.value.toLowerCase());
}

export function isMuted(job, rules) {
  return rules.some(r =>
    (r.kind === 'mute_company' && ruleMatchesCompany(r, job)) ||
    (r.kind === 'mute_keyword' && ruleMatchesKeyword(r, job)));
}

export function isWatched(job, rules) {
  return rules.some(r =>
    (r.kind === 'boost_company' && ruleMatchesCompany(r, job)) ||
    (r.kind === 'boost_keyword' && ruleMatchesKeyword(r, job)));
}

/** Applies dismiss + mute + location + salary together - the one filter every job list should share. */
export function passesAllFilters(job, { dismissedIds, rules, locationSet, salaryFloor }) {
  if (dismissedIds.has(job.id)) return false;
  if (isMuted(job, rules)) return false;
  if (!matchesLocation(job, locationSet)) return false;
  if (!matchesSalaryFloor(job, salaryFloor)) return false;
  return true;
}

export function sortJobs(jobs, sortBy) {
  const arr = [...jobs];
  if (sortBy === 'salary') {
    arr.sort((a, b) => (b.job?.salary_max ?? b.salary_max ?? -1) - (a.job?.salary_max ?? a.salary_max ?? -1));
  } else if (sortBy === 'distance') {
    const miles = j => { const m = roughMilesFromHome(j.city); return m == null ? Infinity : m; };
    arr.sort((a, b) => miles(a.job ?? a) - miles(b.job ?? b));
  }
  // 'score' (default) - callers already fetch pre-sorted by score, or by
  // first_seen_at for the non-scored lists; nothing to do here.
  return arr;
}
