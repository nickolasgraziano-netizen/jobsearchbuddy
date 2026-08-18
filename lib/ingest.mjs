import { createClient } from '@supabase/supabase-js';
import { runAdapter } from './adapters/index.mjs';
import { scoreActiveJobs } from './scoring.mjs';
import { llmScoreTopCandidates } from './llm-score.mjs';

export function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

/**
 * Rank apply URLs so that when the same req arrives from several sources we
 * keep the most direct one. Applying on the employer's own site has a
 * materially better response rate than applying through an aggregator.
 */
function urlDirectness(url = '') {
  if (/myworkdayjobs|greenhouse\.io|lever\.co|ashbyhq|smartrecruiters|icims|taleo|careers\./i.test(url)) return 3;
  if (/governmentjobs|usajobs/i.test(url)) return 2;
  return 1;
}

export async function ingest({ log = console.log } = {}) {
  const db = admin();
  const env = process.env;
  const started = Date.now();

  const { data: sources, error } = await db.from('sources').select('*').eq('enabled', true);
  if (error) throw error;

  const report = [];

  // Run every source concurrently — one slow board shouldn't hold up the rest.
  const results = await Promise.allSettled(sources.map(async s => {
    const jobs = await runAdapter(s, env);
    return { source: s, jobs };
  }));

  // Collect everything first so dedup can see across sources in one pass.
  const bySource = [];
  for (let i = 0; i < results.length; i++) {
    const s = sources[i], r = results[i];
    if (r.status === 'rejected') {
      report.push({ source: s.slug, status: 'FAIL', count: 0, error: String(r.reason?.message || r.reason) });
      await db.from('sources').update({
        last_run_at: new Date().toISOString(),
        last_status: 'FAIL', last_count: 0,
      }).eq('id', s.id);
      continue;
    }
    const jobs = r.value.jobs || [];
    bySource.push({ source: s, jobs });
    report.push({ source: s.slug, status: jobs.length ? 'PASS' : 'EMPTY', count: jobs.length });

    // Silent-failure detector: a source that returns nothing several runs in
    // a row is almost certainly broken, not just quiet.
    const consecutiveEmpty = jobs.length ? 0 : (s.consecutive_empty || 0) + 1;
    await db.from('sources').update({
      last_run_at: new Date().toISOString(),
      last_status: jobs.length ? 'PASS' : 'EMPTY',
      last_count: jobs.length,
      consecutive_empty: consecutiveEmpty,
    }).eq('id', s.id);
  }

  // ── dedup across all sources by fingerprint ──────────────────────────
  const merged = new Map();
  for (const { source, jobs } of bySource) {
    for (const j of jobs) {
      const existing = merged.get(j.fingerprint);
      if (!existing) {
        merged.set(j.fingerprint, { ...j, source_id: source.id, also_seen_on: [] });
        continue;
      }
      existing.also_seen_on = [...new Set([...existing.also_seen_on, source.label])];
      // Keep the earliest posted_at and the most direct apply URL.
      if (j.posted_at && (!existing.posted_at || j.posted_at < existing.posted_at)) existing.posted_at = j.posted_at;
      if (urlDirectness(j.apply_url) > urlDirectness(existing.apply_url)) {
        existing.apply_url = j.apply_url;
        existing.source_id = source.id;
      }
      if (!existing.description && j.description) existing.description = j.description;
      if (existing.salary_min == null && j.salary_min != null) {
        existing.salary_min = j.salary_min; existing.salary_max = j.salary_max;
      }
    }
  }

  const rows = [...merged.values()];
  const now = new Date().toISOString();

  // ── upsert ────────────────────────────────────────────────────────────
  // ON CONFLICT on fingerprint updates last_seen_at but NEVER first_seen_at.
  // That is what makes "new since yesterday" trustworthy.
  let inserted = 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map(r => ({ ...r, last_seen_at: now, is_active: true }));
    const { error: upErr } = await db.from('jobs').upsert(chunk, {
      onConflict: 'fingerprint',
      ignoreDuplicates: false,
    });
    if (upErr) throw upErr;
    inserted += chunk.length;
  }

  // Mark anything we didn't see this run as inactive — but only for sources
  // that actually returned data, so a broken adapter can't wipe the board.
  const healthySourceIds = bySource.filter(b => b.jobs.length).map(b => b.source.id);
  if (healthySourceIds.length) {
    await db.from('jobs')
      .update({ is_active: false })
      .in('source_id', healthySourceIds)
      .lt('last_seen_at', now);
  }

  const newCount = await db.from('jobs')
    .select('id', { count: 'exact', head: true })
    .gt('first_seen_at', new Date(Date.now() - 864e5).toISOString());

  // Cheap prefilter scoring against every resume - keeps "good fits" current
  // the moment new jobs land, no separate step to remember to run.
  const scoring = await scoreActiveJobs(db);

  // Real model read on whatever cleared the prefilter, capped per run for
  // cost/time. No-ops cleanly if ANTHROPIC_API_KEY isn't set.
  const llmScoring = await llmScoreTopCandidates(db, process.env.ANTHROPIC_API_KEY);

  const summary = {
    ranAt: now,
    durationMs: Date.now() - started,
    sourcesRun: sources.length,
    rawJobs: bySource.reduce((n, b) => n + b.jobs.length, 0),
    afterDedup: rows.length,
    upserted: inserted,
    newInLast24h: newCount.count ?? 0,
    scored: scoring.scored,
    llmScored: llmScoring.scored,
    llmSkipped: llmScoring.skipped,
    report,
  };
  log(JSON.stringify(summary, null, 2));
  return summary;
}
