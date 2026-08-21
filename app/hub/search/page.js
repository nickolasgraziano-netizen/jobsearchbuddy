import '../../globals.css';
import { serverClient } from '../../../lib/supabase';
import { restoreJob, removeRule, unsaveJob } from '../actions.js';
import { ago, JobRow } from '../JobCard.jsx';
import { computeMultiCompanies } from '../multiCompanies.mjs';
import { SelectModeProvider, SelectModeToggle, SelectModeBar } from '../SelectMode.jsx';
import ThemeToggle from '../ThemeToggle.jsx';
import Logo from '../../Logo';

export const dynamic = 'force-dynamic';

const KIND_LABEL = {
  mute_company: 'Muted company',
  mute_keyword: 'Muted keyword',
  boost_company: 'Watched company',
  boost_keyword: 'Watched keyword',
};

function RestoreAction({ job }) {
  return (
    <div className="actions">
      <form action={restoreJob}>
        <input type="hidden" name="jobId" value={job.id} />
        <button type="submit" className="btn-ghost watch">Restore</button>
      </form>
    </div>
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

function SectionNav({ items }) {
  const visible = items.filter(i => i.show);
  if (!visible.length) return null;
  return (
    <nav className="section-nav" aria-label="Jump to section">
      {visible.map(i => (
        <a key={i.id} href={`#${i.id}`} className="section-nav-chip">
          {i.label}{i.count != null ? ` (${i.count})` : ''}
        </a>
      ))}
    </nav>
  );
}

function RuleRow({ rule }) {
  const isWatch = rule.kind.startsWith('boost');
  return (
    <div className="rule-row">
      <div>
        <span className={`badge ${isWatch ? 'watch-label' : 'mute-label'}`}>{KIND_LABEL[rule.kind] || rule.kind}</span>
        <strong style={{ marginLeft: 8 }}>{rule.value}</strong>
        <span style={{ color: 'var(--color-neutral-600)', fontSize: 12, marginLeft: 8 }}>{ago(rule.created_at)}</span>
      </div>
      <form action={removeRule}>
        <input type="hidden" name="ruleId" value={rule.id} />
        <button type="submit" className="btn-ghost mute">Remove</button>
      </form>
    </div>
  );
}

export default async function SearchAndManage({ searchParams }) {
  const db = serverClient();
  const q = (searchParams?.q || '').trim();
  // PostgREST's .or() filter string is comma/paren-delimited - strip those
  // out of free-text input rather than trying to escape them correctly.
  const safeQ = q.replace(/[,()]/g, ' ').trim();

  const [{ data: rulesData }, dismissedResult, searchResult, { data: savedRows }, { data: allCompanyRows }] = await Promise.all([
    db.from('rules').select('*').order('created_at', { ascending: false }),
    db.from('dismissed_jobs').select('job_id, dismissed_at, job:jobs(*)')
      .order('dismissed_at', { ascending: false }).limit(100),
    safeQ
      ? db.from('jobs').select('*').eq('is_active', true)
          .or(`title.ilike.%${safeQ}%,company.ilike.%${safeQ}%,location_text.ilike.%${safeQ}%`)
          .order('first_seen_at', { ascending: false }).limit(50)
      : Promise.resolve({ data: null }),
    db.from('saved_jobs').select('job_id, saved_at, job:jobs(*)').order('saved_at', { ascending: false }),
    db.from('jobs').select('company').eq('is_active', true),
  ]);

  const rules = rulesData || [];
  // A dismissed job whose posting later expired/was removed has no job
  // embed to render - drop it rather than crash on missing fields.
  const dismissed = (dismissedResult.data || []).filter(d => d.job);
  const results = searchResult.data;
  const saved = (savedRows || []).filter(r => r.job);
  const savedIds = new Set(saved.map(r => r.job_id));
  const multiCompanies = computeMultiCompanies(allCompanyRows);

  const navItems = [
    { id: 'search-results', label: `Results for "${q}"`, count: results?.length, show: !!q },
    { id: 'saved', label: '★ Saved', count: saved.length, show: true },
    { id: 'muted-watched', label: 'Muted & watched', count: rules.length, show: true },
    { id: 'dismissed', label: 'Dismissed', count: dismissed.length, show: true },
  ];

  return (
    <SelectModeProvider>
    <div className="wrap">
      <header className="top">
        <div className="brand">
          <Logo />
          <h1>Search &amp; manage</h1>
        </div>
        <span className="sub"><a href="/hub">← Back to Job Hub</a></span>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <ThemeToggle />
          <SelectModeToggle />
        </div>
      </header>
      <div className="sticky-nav">
        <SectionNav items={navItems} />
        <SelectModeBar />
      </div>

      <form method="GET" className="search-form">
        <input
          type="text" name="q" defaultValue={q}
          placeholder="Search title, company, or location — active jobs only"
          className="search-input"
        />
        <button type="submit" className="btn btn-secondary">Search</button>
        {q && <a href="/hub/search" className="btn-ghost" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>Clear</a>}
      </form>

      {q && (
        <>
          <h2 className="section" id="search-results">Results for &quot;{q}&quot;</h2>
          {results.length === 0 ? (
            <div className="empty">No active jobs match &quot;{q}&quot;.</div>
          ) : results.map(j => <JobRow key={j.id} j={j} saved={savedIds.has(j.id)} multiCompanies={multiCompanies} />)}
        </>
      )}

      <h2 className="section" id="saved">★ Saved for later</h2>
      {saved.length === 0 ? (
        <div className="empty">Nothing saved yet — click "Save for later" on any job.</div>
      ) : saved.map(r => <JobRow key={r.job_id} j={r.job} actions={<UnsaveAction job={r.job} />} multiCompanies={multiCompanies} />)}

      <h2 className="section" id="muted-watched">Muted &amp; watched</h2>
      {rules.length === 0 ? (
        <div className="empty">Nothing muted or watched yet.</div>
      ) : rules.map(r => <RuleRow key={r.id} rule={r} />)}

      <h2 className="section" id="dismissed">Recently dismissed</h2>
      <p style={{ color: 'var(--color-neutral-600)', fontSize: 13, margin: '-6px 0 12px' }}>
        Last 100 — restore any of these to see them again on the main board.
      </p>
      {dismissed.length === 0 ? (
        <div className="empty">Nothing dismissed yet.</div>
      ) : dismissed.map(d => <JobRow key={d.job_id} j={d.job} actions={<RestoreAction job={d.job} />} multiCompanies={multiCompanies} />)}
    </div>
    </SelectModeProvider>
  );
}
