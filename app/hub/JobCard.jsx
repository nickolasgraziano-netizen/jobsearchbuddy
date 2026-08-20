import { roughMilesFromHome } from '../../lib/normalize.mjs';
import { dismissJob, muteCompany, watchCompany, saveJob } from './actions.js';

export function ago(ts) {
  if (!ts) return '';
  const h = Math.floor((Date.now() - new Date(ts)) / 36e5);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function money(min, max, text) {
  if (text) return text;
  if (!min && !max) return null;
  const f = n => `$${Math.round(n / 1000)}k`;
  return min && max ? `${f(min)}–${f(max)}` : f(min || max);
}

/** Only worth linking when there's actually more than one listing to filter down to. */
export function CompanyName({ company, multiCompanies }) {
  if (!company) return null;
  if (!multiCompanies?.has(company)) return company;
  return <a href={`/hub/search?q=${encodeURIComponent(company)}`}>{company}</a>;
}

export function RowActions({ job }) {
  return (
    <div className="actions">
      <form action={saveJob}>
        <input type="hidden" name="jobId" value={job.id} />
        <button type="submit" className="btn-ghost save">Save for later</button>
      </form>
      <form action={dismissJob}>
        <input type="hidden" name="jobId" value={job.id} />
        <button type="submit" className="btn-ghost">Not for me</button>
      </form>
      {job.company && (
        <>
          <form action={muteCompany}>
            <input type="hidden" name="company" value={job.company} />
            <button type="submit" className="btn-ghost mute">Mute {job.company}</button>
          </form>
          <form action={watchCompany}>
            <input type="hidden" name="company" value={job.company} />
            <button type="submit" className="btn-ghost watch">Watch {job.company}</button>
          </form>
        </>
      )}
    </div>
  );
}

/** actions: override the default dismiss/mute/watch row - e.g. a single Restore button for a dismissed-jobs list. */
export function JobRow({ j, isNew, watched, saved, actions, multiCompanies }) {
  const miles = roughMilesFromHome(j.city);
  const pay = money(j.salary_min, j.salary_max, j.salary_text);
  return (
    <div className="job">
      <div className="score">{watched ? '🎯' : '—'}</div>
      <div className="body">
        <div className="title">
          <a href={j.apply_url} target="_blank" rel="noreferrer">{j.title}</a>
        </div>
        <div className="meta">
          <CompanyName company={j.company} multiCompanies={multiCompanies} />
          {j.location_text ? ` · ${j.location_text}` : ''}
          {miles != null ? ` · ~${miles} mi` : ''}
          {j.source?.label ? ` · via ${j.source.label}` : ''}
          {` · ${ago(j.first_seen_at)}`}
        </div>
        <div className="tags">
          {saved && <span className="badge saved">★ Saved</span>}
          {isNew && <span className="badge new">NEW</span>}
          {j.is_remote && <span className="badge remote">Remote</span>}
          {pay && <span className="badge pay">{pay}</span>}
          {j.employment_type && <span className="badge">{j.employment_type}</span>}
          {(j.also_seen_on || []).length > 0 &&
            <span className="badge">also on {j.also_seen_on.length}</span>}
        </div>
        {actions ?? <RowActions job={j} />}
      </div>
    </div>
  );
}
