/** Set of company names with more than one active listing right now - only
 *  worth offering a "filter to just this company" link when there's
 *  actually more than one result behind it. */
export function computeMultiCompanies(rows) {
  const counts = new Map();
  for (const { company } of rows || []) {
    if (company) counts.set(company, (counts.get(company) || 0) + 1);
  }
  return new Set([...counts].filter(([, n]) => n > 1).map(([c]) => c));
}
