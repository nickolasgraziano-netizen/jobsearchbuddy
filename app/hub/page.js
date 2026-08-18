import '../globals.css';
import { serverClient } from '../../lib/supabase';
import { QUICK_LAUNCH } from '../../lib/quicklaunch';
import { roughMilesFromHome } from '../../lib/normalize.mjs';
import { refreshJobs } from './actions.js';
import RefreshButton from './RefreshButton.jsx';

export const dynamic = 'force-dynamic';

const DAY = 864e5;

function ago(ts) {
  if (!ts) return '';
  const h = Math.floor((Date.now() - new Date(ts)) / 36e5);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function money(min, max, text) {
  if (text) return text;
  if (!min && !max) return null;
  const f = n => `$${Math.round(n / 1000)}k`;
  return min && max ? `${f(min)}–${f(max)}` : f(min || max);
}

function MatchRow({ s }) {
  const j = s.job;
  const miles = roughMilesFromHome(j.city);
  const pay = money(j.salary_min, j.salary_max, j.salary_text);
  return (
    <div className="job">
      <div className={`score ${s.score >= 70 ? 'hi' : s.score >= 50 ? 'mid' : ''}`}>{s.score}</div>
      <div className="body">
        <div className="title">
          <a href={j.apply_url} target="_blank" rel="noreferrer">{j.title}</a>
        </div>
        <div className="meta">
          {j.company}
          {j.location_text ? ` · ${j.location_text}` : ''}
          {miles != null ? ` · ~${miles} mi` : ''}
        </div>
        <div className="tags">
          <span className="badge new">{s.resume?.label || 'match'}</span>
          {s.scoring_method === 'llm' && <span className="badge" style={{ color: 'var(--color-accent)' }}>model-reviewed</span>}
          {j.is_remote && <span className="badge remote">Remote</span>}
          {pay && <span className="badge pay">{pay}</span>}
          {s.scoring_method !== 'llm' && (s.matched_keywords || []).slice(0, 4).map(k => <span key={k} className="badge">{k}</span>)}
        </div>
        {s.scoring_method === 'llm' && (
          <div style={{ marginTop: 8, fontSize: 13, color: 'var(--color-neutral-600)' }}>
            {s.reasoning && <div>{s.reasoning}</div>}
            {(s.missing_keywords || []).length > 0 && (
              <div style={{ marginTop: 4 }}><strong style={{ color: 'var(--color-text)' }}>Gaps:</strong> {s.missing_keywords.join(', ')}</div>
            )}
            {s.suggested_tweak && (
              <div style={{ marginTop: 4 }}><strong style={{ color: 'var(--color-text)' }}>Pitch angle:</strong> {s.suggested_tweak}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// "FC " is Larimer County's own abbreviation for Fort Collins in
// location_text (e.g. "FC 1501 Blue Spruce, CO") - doesn't parse as a clean
// city in normalize.mjs, so it needs its own check alongside the obvious
// city match. Shared between the SQL filter (jobs table) and the JS filter
// (good fits, already fetched via the scores join).
const NEAR_FC_OR = 'city.ilike.Fort Collins,location_text.ilike.%fort collins%,location_text.imatch.^FC ,is_remote.eq.true';

function isNearFortCollinsOrRemote(j) {
  if (j.is_remote) return true;
  const city = (j.city || '').toLowerCase();
  const loc = (j.location_text || '').toLowerCase();
  return city === 'fort collins' || loc.includes('fort collins') || /^fc\s/.test(loc);
}

export default async function Hub({ searchParams }) {
  const db = serverClient();
  const nearOnly = searchParams?.near === 'fortcollins';

  const since = new Date(Date.now() - DAY).toISOString();

  const freshQuery = db.from('jobs').select('*').eq('is_active', true).gt('first_seen_at', since);
  const recentQuery = db.from('jobs').select('*').eq('is_active', true).lte('first_seen_at', since);
  if (nearOnly) { freshQuery.or(NEAR_FC_OR); recentQuery.or(NEAR_FC_OR); }

  const [{ data: fresh }, { data: recent }, { data: sources }, totals, { data: scored }] = await Promise.all([
    freshQuery.order('first_seen_at', { ascending: false }).limit(100),
    recentQuery.order('first_seen_at', { ascending: false }).limit(50),
    db.from('sources').select('*').order('tier').order('label'),
    db.from('jobs').select('id', { count: 'exact', head: true }).eq('is_active', true),
    db.from('scores').select('score, matched_keywords, missing_keywords, reasoning, suggested_tweak, scoring_method, resume:resumes(label), job:jobs(*)')
      .gte('score', 40).order('score', { ascending: false }).limit(150),
  ]);

  const newJobs = fresh || [];
  const older = recent || [];
  const srcs = sources || [];
  const failing = srcs.filter(s => s.last_status === 'FAIL' || (s.consecutive_empty || 0) >= 3);
  const lastRun = srcs.map(s => s.last_run_at).filter(Boolean).sort().pop();

  // Best score per job (a job can be scored against more than one resume) -
  // scored is already sorted by score desc, so first occurrence wins.
  const seenJobIds = new Set();
  const goodFits = [];
  for (const s of scored || []) {
    if (!s.job || !s.job.is_active || seenJobIds.has(s.job.id)) continue;
    if (nearOnly && !isNearFortCollinsOrRemote(s.job)) continue;
    seenJobIds.add(s.job.id);
    goodFits.push(s);
    if (goodFits.length >= 30) break;
  }

  return (
    <div className="wrap">
      <header className="top">
        <h1>Job Hub</h1>
        <span className="sub">
          80524 · {lastRun ? `last refreshed ${ago(lastRun)}` : 'never run'}
        </span>
        <form action={refreshJobs} style={{ marginLeft: 'auto' }}>
          <RefreshButton />
        </form>
      </header>

      <div className="stats">
        <div className="stat"><div className="n">{newJobs.length}</div><div className="l">New today</div></div>
        <div className="stat"><div className="n">{totals.count ?? 0}</div><div className="l">Active total</div></div>
        <div className="stat"><div className="n">{srcs.filter(s => s.enabled).length}</div><div className="l">Sources on</div></div>
        <div className="stat"><div className="n" style={{ color: failing.length ? 'var(--color-accent-2-700)' : 'var(--color-accent-700)' }}>
          {failing.length}</div><div className="l">Needs attention</div></div>
      </div>

      <div style={{ margin: '4px 0 24px' }}>
        {nearOnly ? (
          <>
            <span className="badge remote" style={{ marginRight: 10 }}>📍 Fort Collins + Remote only</span>
            <a href="/hub" style={{ fontSize: 12 }}>Show all locations</a>
          </>
        ) : (
          <a href="/hub?near=fortcollins" className="btn btn-secondary" style={{ height: 30, fontSize: 12, padding: '0 12px' }}>
            Show only Fort Collins + Remote
          </a>
        )}
      </div>

      <h2 className="section">Good fits for you</h2>
      <p style={{ color: 'var(--color-neutral-600)', fontSize: 13, margin: '-6px 0 12px' }}>
        Title/keyword/location match against your two resumes — a cheap prefilter, not a full read of each posting.
      </p>
      {goodFits.length === 0 ? (
        <div className="empty">Nothing scoring 40+ yet. Click "Refresh now" after new jobs land, or the threshold may just be genuinely unmet right now.</div>
      ) : goodFits.map(s => <MatchRow key={`${s.job.id}`} s={s} />)}

      <h2 className="section">New since yesterday</h2>
      {newJobs.length === 0 ? (
        <div className="empty">
          Nothing new yet. If the ingest has never run, hit{' '}
          <code>/api/ingest?secret=…</code> once to seed the board.
        </div>
      ) : newJobs.map(j => <JobRow key={j.id} j={j} isNew />)}

      <h2 className="section">Still open (seen before today)</h2>
      {older.map(j => <JobRow key={j.id} j={j} />)}

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
      <table className="health">
        <thead>
          <tr><th>Source</th><th>Adapter</th><th>Status</th><th>Jobs</th><th>Last run</th></tr>
        </thead>
        <tbody>
          {srcs.map(s => (
            <tr key={s.id}>
              <td>{s.label}</td>
              <td style={{ color: 'var(--color-neutral-600)' }}>{s.adapter}</td>
              <td className={`s-${s.last_status || 'EMPTY'}`}>
                {s.last_status || '—'}
                {(s.consecutive_empty || 0) >= 3 && ' ⚠'}
              </td>
              <td>{s.last_count ?? 0}</td>
              <td style={{ color: 'var(--color-neutral-600)' }}>{s.last_run_at ? ago(s.last_run_at) : 'never'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JobRow({ j, isNew }) {
  const miles = roughMilesFromHome(j.city);
  const pay = money(j.salary_min, j.salary_max, j.salary_text);
  return (
    <div className="job">
      <div className="score">—</div>
      <div className="body">
        <div className="title">
          <a href={j.apply_url} target="_blank" rel="noreferrer">{j.title}</a>
        </div>
        <div className="meta">
          {j.company}
          {j.location_text ? ` · ${j.location_text}` : ''}
          {miles != null ? ` · ~${miles} mi` : ''}
          {` · ${ago(j.first_seen_at)}`}
        </div>
        <div className="tags">
          {isNew && <span className="badge new">NEW</span>}
          {j.is_remote && <span className="badge remote">Remote</span>}
          {pay && <span className="badge pay">{pay}</span>}
          {j.employment_type && <span className="badge">{j.employment_type}</span>}
          {(j.also_seen_on || []).length > 0 &&
            <span className="badge">also on {j.also_seen_on.length}</span>}
        </div>
      </div>
    </div>
  );
}
