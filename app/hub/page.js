import '../globals.css';
import { serverClient } from '../../lib/supabase';
import { QUICK_LAUNCH } from '../../lib/quicklaunch';
import { roughMilesFromHome } from '../../lib/normalize.mjs';
import { TARGET_TOWNS, SALARY_FLOORS, matchesLocation, matchesSalaryFloor, isMuted, passesAllFilters, sortJobs } from '../../lib/filters.mjs';
import { refreshJobs, unsaveJob } from './actions.js';
import { ago, money, RowActions, JobRow, CompanyName } from './JobCard.jsx';
import { computeMultiCompanies } from './multiCompanies.mjs';
import RefreshButton from './RefreshButton.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import Logo from '../Logo';

export const dynamic = 'force-dynamic';

const DAY = 864e5;

// Nick's fixed timezone, not the server's - Vercel runs in UTC and "just
// now"-style relative time is what he asked to move away from, so this
// needs to be unambiguous regardless of where it renders.
function exactTime(ts) {
  if (!ts) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }).format(new Date(ts));
}

function hrefFor(locationSet, salaryFloor, sortBy) {
  const params = new URLSearchParams();
  if (locationSet.size) params.set('near', [...locationSet].join(','));
  if (salaryFloor) params.set('pay', String(salaryFloor));
  if (sortBy && sortBy !== 'score') params.set('sort', sortBy);
  const qs = params.toString();
  return '/hub' + (qs ? `?${qs}` : '');
}

const TRACK_CLASS = { 'AI Operations': 'track-ai', 'People Lead / HR': 'track-corp' };

function MatchRow({ s, saved, multiCompanies }) {
  const j = s.job;
  const miles = roughMilesFromHome(j.city);
  const pay = money(j.salary_min, j.salary_max, j.salary_text);
  const trackClass = TRACK_CLASS[s.resume?.label] || '';
  return (
    <div className={`job ${trackClass}`}>
      <div className={`score ${s.score >= 70 ? 'hi' : s.score >= 50 ? 'mid' : ''}`}>{s.score}</div>
      <div className="body">
        {trackClass && <div className={`track-label ${trackClass}`}>{s.resume.label}</div>}
        <div className="title">
          <a href={j.apply_url} target="_blank" rel="noreferrer">{j.title}</a>
        </div>
        <div className="meta">
          <CompanyName company={j.company} multiCompanies={multiCompanies} />
          {j.location_text ? ` · ${j.location_text}` : ''}
          {miles != null ? ` · ~${miles} mi` : ''}
          {j.source?.label ? ` · via ${j.source.label}` : ''}
        </div>
        <div className="tags">
          {saved && <span className="badge saved">★ Saved</span>}
          {s.scoring_method === 'llm' && <span className="badge" style={{ color: 'var(--color-accent)' }}>model-reviewed</span>}
          {j.is_remote && <span className="badge remote">Remote</span>}
          {pay && <span className="badge pay">{pay}</span>}
          {s.scoring_method !== 'llm' && (s.matched_keywords || []).slice(0, 4).map(k => <span key={k} className="badge">{k}</span>)}
        </div>
        {s.scoring_method === 'llm' && (s.reasoning || s.suggested_tweak || (s.missing_keywords || []).length > 0) && (
          <details className="reasoning">
            <summary>Why this fits</summary>
            <div className="text">
              {s.reasoning && <div>{s.reasoning}</div>}
              {(s.missing_keywords || []).length > 0 && (
                <div style={{ marginTop: 4 }}><strong>Gaps:</strong> {s.missing_keywords.join(', ')}</div>
              )}
              {s.suggested_tweak && (
                <div style={{ marginTop: 4 }}><strong>Pitch angle:</strong> {s.suggested_tweak}</div>
              )}
            </div>
          </details>
        )}
        <RowActions job={j} />
      </div>
    </div>
  );
}

function FitBucket({ title, items, savedIds, multiCompanies }) {
  if (!items.length) return null;
  return (
    <>
      <h4 style={{ margin: '14px 0 8px', fontSize: 13, color: 'var(--color-neutral-600)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</h4>
      {items.map(s => <MatchRow key={s.job.id} s={s} saved={savedIds.has(s.job.id)} multiCompanies={multiCompanies} />)}
    </>
  );
}

function UnsaveAction({ job }) {
  return (
    <div className="actions">
      <form action={unsaveJob}>
        <input type="hidden" name="jobId" value={job.id} />
        <button type="submit" className="btn-ghost mute">Remove</button>
      </form>
    </div>
  );
}

export default async function Hub({ searchParams }) {
  const db = serverClient();
  const locationSet = new Set((searchParams?.near || '').split(',').filter(Boolean));
  const salaryFloor = Number(searchParams?.pay || 0);
  const sortBy = searchParams?.sort || 'score';

  const since = new Date(Date.now() - DAY).toISOString();

  // Phase 1: dismissed ids + rules first - later queries/filters depend on them.
  const [{ data: dismissedRows }, { data: rulesData }, { data: savedRows }] = await Promise.all([
    db.from('dismissed_jobs').select('job_id'),
    db.from('rules').select('*'),
    db.from('saved_jobs').select('job_id, saved_at, job:jobs(*, source:sources(label))').order('saved_at', { ascending: false }),
  ]);
  const dismissedIds = new Set((dismissedRows || []).map(r => r.job_id));
  const saved = (savedRows || []).filter(r => r.job);
  const savedIds = new Set(saved.map(r => r.job_id));
  const dismissedArr = [...dismissedIds];
  const rules = rulesData || [];
  const boostRules = rules.filter(r => r.kind === 'boost_company' || r.kind === 'boost_keyword');
  const watchOr = boostRules.map(r =>
    r.kind === 'boost_company' ? `company.ilike.%${r.value}%` : `title.ilike.%${r.value}%`
  ).join(',');

  const excludeDismissed = (q, col) => dismissedArr.length ? q.not(col, 'in', `(${dismissedArr.join(',')})`) : q;

  const [{ data: fresh }, { data: recent }, { data: sourcesData }, totals, { data: scored }, watchResult] = await Promise.all([
    excludeDismissed(db.from('jobs').select('*, source:sources(label)').eq('is_active', true).gt('first_seen_at', since), 'id')
      .order('first_seen_at', { ascending: false }).limit(120),
    excludeDismissed(db.from('jobs').select('*, source:sources(label)').eq('is_active', true).lte('first_seen_at', since), 'id')
      .order('first_seen_at', { ascending: false }).limit(70),
    db.from('sources').select('*').order('tier').order('label'),
    db.from('jobs').select('id', { count: 'exact', head: true }).eq('is_active', true),
    excludeDismissed(
      db.from('scores').select('score, matched_keywords, missing_keywords, reasoning, suggested_tweak, scoring_method, resume:resumes(label), job:jobs(*, source:sources(label))'),
      'job_id'
    ).gte('score', 40).order('score', { ascending: false }).limit(150),
    watchOr
      ? excludeDismissed(db.from('jobs').select('*, source:sources(label)').eq('is_active', true), 'id').or(watchOr).order('first_seen_at', { ascending: false }).limit(20)
      : Promise.resolve({ data: [] }),
  ]);

  const filterOpts = { dismissedIds, rules, locationSet, salaryFloor };
  let newJobs = sortJobs((fresh || []).filter(j => passesAllFilters(j, filterOpts)), sortBy);
  let older = sortJobs((recent || []).filter(j => passesAllFilters(j, filterOpts)), sortBy);
  let watching = (watchResult.data || []).filter(j =>
    !isMuted(j, rules) && matchesLocation(j, locationSet) && matchesSalaryFloor(j, salaryFloor));
  // A saved job gets its own section and shouldn't also clutter Watching,
  // New, or Still-open - same idea as Watching already being pulled out of
  // New/Still-open below, just one more state that claims a job exclusively.
  watching = watching.filter(j => !savedIds.has(j.id));
  const watchingIds = new Set(watching.map(j => j.id));
  newJobs = newJobs.filter(j => !watchingIds.has(j.id) && !savedIds.has(j.id));
  older = older.filter(j => !watchingIds.has(j.id) && !savedIds.has(j.id));

  const srcs = sourcesData || [];
  const failing = srcs.filter(s => s.last_status === 'FAIL' || (s.consecutive_empty || 0) >= 3);
  const lastRun = srcs.map(s => s.last_run_at).filter(Boolean).sort().pop();

  // "New since your last refresh" is a different, more precise question than
  // "New today" (a rolling 24h window) - it's specifically what the most
  // recent ingest run itself surfaced. There's no stored history of past
  // run boundaries, so this leans on a fact about how ingest.mjs writes
  // data: first_seen_at only gets set (via DB default) at the moment a row
  // is first inserted, and every job from the same run lands within
  // seconds of each other. A 10-minute buffer before the max last_run_at
  // comfortably covers that write window (a full run takes under a minute
  // in production) while staying far shorter than the hours/a day between
  // separate real refreshes, so it can't bleed into the previous run.
  const sinceRefreshCutoff = lastRun ? new Date(new Date(lastRun).getTime() - 10 * 60e3).toISOString() : null;
  const [{ data: sinceRefreshRows }, { data: allCompanyRows }] = await Promise.all([
    sinceRefreshCutoff
      ? db.from('jobs').select('*, source:sources(label)').eq('is_active', true).gte('first_seen_at', sinceRefreshCutoff)
          .order('first_seen_at', { ascending: false })
      : Promise.resolve({ data: [] }),
    db.from('jobs').select('company').eq('is_active', true),
  ]);
  const sinceRefresh = sortJobs((sinceRefreshRows || []).filter(j => passesAllFilters(j, filterOpts) && !savedIds.has(j.id)), sortBy);
  const multiCompanies = computeMultiCompanies(allCompanyRows);

  // Best score per job, deduped, filtered, grouped by resume track then by
  // realistic (60+) vs stretch (40-59) - scored is already score-desc so
  // first occurrence per job wins and buckets stay internally sorted.
  const seenJobIds = new Set();
  const byTrack = {};
  for (const s of scored || []) {
    if (!s.job || !s.job.is_active || seenJobIds.has(s.job.id) || savedIds.has(s.job.id)) continue;
    if (!passesAllFilters(s.job, filterOpts)) continue;
    seenJobIds.add(s.job.id);
    const track = s.resume?.label || 'Other';
    byTrack[track] = byTrack[track] || { realistic: [], stretch: [] };
    byTrack[track][s.score >= 60 ? 'realistic' : 'stretch'].push(s);
  }
  const trackNames = Object.keys(byTrack).sort();

  return (
    <div className="wrap">
      <header className="top">
        <div className="brand">
          <Logo />
          <h1>Job Hub</h1>
        </div>
        <span className="sub">
          80524 · {lastRun ? `last refreshed ${exactTime(lastRun)}` : 'never run'}
        </span>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <ThemeToggle />
          <form action={refreshJobs}>
            <RefreshButton />
          </form>
        </div>
      </header>
      <div className="byline">
        {srcs.filter(s => s.enabled).length} live source adapters · deduped by fingerprint · scored twice — a free keyword pass, then Claude — refreshed on demand
        {' · '}<a href="/hub/search">Search all jobs, saved, muted &amp; dismissed →</a>
      </div>

      {sinceRefresh.length > 0 && (
        <p style={{ margin: '0 0 16px' }}>
          <a href="#since-refresh" style={{ fontWeight: 600 }}>
            {sinceRefresh.length} new since your last refresh →
          </a>
        </p>
      )}

      <div className="stats">
        <div className="stat"><div className="n">{newJobs.length}</div><div className="l">New today</div></div>
        <div className="stat"><div className="n">{totals.count ?? 0}</div><div className="l">Active total</div></div>
        <div className="stat"><div className="n">{srcs.filter(s => s.enabled).length}</div><div className="l">Sources on</div></div>
        <div className="stat"><div className="n" style={{ color: failing.length ? 'var(--color-accent-2-700)' : 'var(--color-accent-700)' }}>
          {failing.length}</div><div className="l">Needs attention</div></div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', margin: '4px 0 24px' }}>
        <span className="badge remote" style={locationSet.has('remote') ? {} : { background: 'transparent' }}>
          <a href={hrefFor(new Set(locationSet.has('remote') ? [...locationSet].filter(k => k !== 'remote') : [...locationSet, 'remote']), salaryFloor, sortBy)}>Remote</a>
        </span>
        {TARGET_TOWNS.map(t => (
          <span key={t.key} className="badge remote" style={locationSet.has(t.key) ? {} : { background: 'transparent' }}>
            <a href={hrefFor(new Set(locationSet.has(t.key) ? [...locationSet].filter(k => k !== t.key) : [...locationSet, t.key]), salaryFloor, sortBy)}>{t.label}</a>
          </span>
        ))}
        {locationSet.size > 0 && <a href={hrefFor(new Set(), salaryFloor, sortBy)} style={{ fontSize: 12 }}>clear locations</a>}

        <span style={{ width: 1, height: 16, background: 'var(--color-divider)', margin: '0 4px' }} />

        {SALARY_FLOORS.map(f => (
          <span key={f.key} className="badge pay" style={salaryFloor === f.value ? {} : { background: 'transparent' }}>
            <a href={hrefFor(locationSet, f.value, sortBy)}>{f.label}</a>
          </span>
        ))}

        <span style={{ width: 1, height: 16, background: 'var(--color-divider)', margin: '0 4px' }} />

        {[{ k: 'score', l: 'Best fit' }, { k: 'salary', l: 'Highest pay' }, { k: 'distance', l: 'Closest' }].map(o => (
          <span key={o.k} className="badge" style={sortBy === o.k ? { background: 'var(--color-accent-100)', color: 'var(--color-accent-700)' } : { background: 'transparent' }}>
            <a href={hrefFor(locationSet, salaryFloor, o.k)}>{o.l}</a>
          </span>
        ))}
      </div>

      {sinceRefresh.length > 0 && (
        <>
          <h2 className="section" id="since-refresh">🆕 New since your last refresh</h2>
          <p style={{ color: 'var(--color-neutral-600)', fontSize: 13, margin: '-6px 0 12px' }}>
            What this specific refresh surfaced — narrower than "New since yesterday" below, which is a rolling 24h window.
          </p>
          {sinceRefresh.map(j => <JobRow key={j.id} j={j} isNew multiCompanies={multiCompanies} />)}
        </>
      )}

      {watching.length > 0 && (
        <>
          <h2 className="section">🎯 Watching</h2>
          <p style={{ color: 'var(--color-neutral-600)', fontSize: 13, margin: '-6px 0 12px' }}>
            Every open posting from a company you've flagged, regardless of score.
          </p>
          {watching.map(j => <JobRow key={j.id} j={j} watched multiCompanies={multiCompanies} />)}
        </>
      )}

      {saved.length > 0 && (
        <>
          <h2 className="section">★ Saved for later</h2>
          <p style={{ color: 'var(--color-neutral-600)', fontSize: 13, margin: '-6px 0 12px' }}>
            Flagged for a closer look — clicked from anywhere on the board, newest first.
          </p>
          {saved.map(r => <JobRow key={r.job_id} j={r.job} actions={<UnsaveAction job={r.job} />} multiCompanies={multiCompanies} />)}
        </>
      )}

      <h2 className="section">Good fits for you</h2>
      <p style={{ color: 'var(--color-neutral-600)', fontSize: 13, margin: '-6px 0 12px' }}>
        Split by resume, then by realistic (60+) vs. a real stretch (40-59) — not one blended list.
      </p>
      {trackNames.length === 0 ? (
        <div className="empty">Nothing scoring 40+ yet under the current filters.</div>
      ) : trackNames.map(track => (
        <div key={track} style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, margin: '0 0 4px' }}>{track}</h3>
          <FitBucket title="Realistic — apply now" items={byTrack[track].realistic} savedIds={savedIds} multiCompanies={multiCompanies} />
          <FitBucket title="Worth a stretch" items={byTrack[track].stretch} savedIds={savedIds} multiCompanies={multiCompanies} />
        </div>
      ))}

      <h2 className="section">New since yesterday</h2>
      {newJobs.length === 0 ? (
        <div className="empty">
          Nothing new under the current filters. If the ingest has never run, hit{' '}
          <code>/api/ingest?secret=…</code> once to seed the board.
        </div>
      ) : newJobs.map(j => <JobRow key={j.id} j={j} isNew multiCompanies={multiCompanies} />)}

      <h2 className="section">Still open (seen before today)</h2>
      {older.map(j => <JobRow key={j.id} j={j} multiCompanies={multiCompanies} />)}

      <h2 className="section">Quick launch — the sites that can&apos;t be automated</h2>
      <div className="ql">
        {QUICK_LAUNCH.map(g => (
          <div className="ql-card" key={g.site}>
            <h3>{g.site}</h3>
            {g.note && <div className="note">{g.note}</div>}
            {g.searches.map(s => (
              <a key={s.label} href={s.url} target="_blank" rel="noreferrer">→ {s.label}</a>
            ))}
          </div>
        ))}
      </div>

      <h2 className="section">Source health</h2>
      <div className="table-scroll">
        <table className="health">
          <thead>
            <tr><th>Source</th><th>Adapter</th><th>Status</th><th>Jobs</th><th>Last run</th></tr>
          </thead>
          <tbody>
            {srcs.map(s => {
              const status = s.last_status || 'EMPTY';
              return (
                <tr key={s.id}>
                  <td>{s.label}</td>
                  <td style={{ color: 'var(--color-neutral-600)' }}>{s.adapter}</td>
                  <td>
                    <span className={`status-pill s-${status}`}>
                      <span className="dot" />
                      {status}
                      {(s.consecutive_empty || 0) >= 3 && ' ⚠'}
                    </span>
                  </td>
                  <td>{s.last_count ?? 0}</td>
                  <td style={{ color: 'var(--color-neutral-600)' }}>{s.last_run_at ? ago(s.last_run_at) : 'never'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
