import { createHash } from 'node:crypto';

/**
 * Every adapter returns this shape. Nothing downstream knows or cares which
 * board a job came from.
 */
export function makeJob({
  externalId, title, company, locationText, isRemote = false,
  employmentType, salaryMin, salaryMax, salaryText, description,
  applyUrl, postedAt, raw,
}) {
  const { city, state, postalCode } = parseLocation(locationText);
  return {
    external_id: externalId ? String(externalId) : null,
    title: clean(title),
    company: clean(company),
    location_text: clean(locationText),
    city, state, postal_code: postalCode,
    is_remote: isRemote || /\bremote\b/i.test(locationText || '') || /\bremote\b/i.test(title || ''),
    employment_type: employmentType || null,
    salary_min: salaryMin ?? null,
    salary_max: salaryMax ?? null,
    salary_text: salaryText || null,
    description: description || null,
    apply_url: applyUrl,
    posted_at: postedAt ? new Date(postedAt).toISOString() : null,
    fingerprint: fingerprint(title, company, city, state),
    raw: raw ?? null,
  };
}

const clean = s => (s || '').replace(/\s+/g, ' ').trim() || null;

/**
 * The dedup key. Deliberately coarse: the same req posted to six aggregators
 * has six different IDs and six slightly different descriptions, but the
 * title, company, and city are stable.
 */
export function fingerprint(title, company, city, state) {
  const norm = s => (s || '')
    .toLowerCase()
    .replace(/\(usa\)|\(us\)/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(senior|sr|junior|jr|i{1,3}|iv|v)\b/g, '')
    .trim();
  return createHash('sha1')
    .update([norm(title), norm(company), norm(city), norm(state)].join('|'))
    .digest('hex');
}

const STATES = { colorado: 'CO', wyoming: 'WY', nebraska: 'NE', kansas: 'KS', utah: 'UT', 'new mexico': 'NM', arizona: 'AZ', texas: 'TX', arkansas: 'AR' };

export function parseLocation(text) {
  if (!text) return { city: null, state: null, postalCode: null };
  const t = text.replace(/\s+/g, ' ').trim();
  const zip = (t.match(/\b(\d{5})(?:-\d{4})?\b/) || [])[1] || null;

  // "Fort Collins, CO"  |  "Loveland, Colorado"  |  "Fort Collins, CO, USA"
  const m = t.match(/([A-Za-z .'-]+),\s*([A-Za-z]{2}|[A-Za-z ]{4,})\b/);
  if (m) {
    let city = m[1].trim();
    let state = m[2].trim();
    if (state.length > 2) state = STATES[state.toLowerCase()] || state.slice(0, 2).toUpperCase();
    return { city, state: state.toUpperCase(), postalCode: zip };
  }
  return { city: null, state: null, postalCode: zip };
}

/** Rough distance so we can rank by proximity without a geocoding bill. */
const KNOWN = {
  '80524': [40.6255, -105.0844], // Fort Collins
  'fort collins': [40.5853, -105.0844],
  'loveland': [40.3978, -105.0750],
  'greeley': [40.4233, -104.7091],
  'windsor': [40.4775, -104.9014],
  'timnath': [40.5300, -104.9880],
  'longmont': [40.1672, -105.1019],
  'denver': [39.7392, -104.9903],
  'boulder': [40.0150, -105.2705],
  'cheyenne': [41.1400, -104.8202],
};

export function roughMilesFromHome(city, homeKey = '80524') {
  const a = KNOWN[homeKey], b = KNOWN[(city || '').toLowerCase()];
  if (!a || !b) return null;
  const [lat1, lon1] = a, [lat2, lon2] = b;
  const R = 3958.8, toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
