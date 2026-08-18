import { roughMilesFromHome } from './normalize.mjs';

/**
 * Cheap prefilter only — title/keyword overlap + distance/remote, all
 * deterministic, no API calls. This is stage 1 from build-plan.md ("kills
 * 90% of noise for free"). Stage 2 (real LLM scoring, reading full
 * descriptions and judging genuine fit) is NOT built - that needs its own
 * API key decision. Don't oversell this score as equivalent to that.
 */
export function prefilterScore(job, resume) {
  const title = (job.title || '').toLowerCase();
  const haystack = `${job.title || ''} ${job.description || ''}`.toLowerCase();
  const matched = [];
  let score = 0;

  for (const t of resume.target_titles || []) {
    if (title.includes(t.toLowerCase())) {
      score += 25;
      matched.push(t);
    }
  }
  for (const k of resume.keywords || []) {
    if (haystack.includes(k.toLowerCase())) {
      score += 5;
      matched.push(k);
    }
  }

  if (job.is_remote) {
    score += 10;
  } else {
    const miles = roughMilesFromHome(job.city);
    if (miles != null && miles <= 30) score += 15;
    else if (miles != null && miles <= 60) score += 5;
  }

  return { score: Math.min(100, score), matched: [...new Set(matched)] };
}

/**
 * Scores every active job against every resume and upserts into `scores`.
 * Cheap and deterministic, so it just recomputes for everything active each
 * run rather than tracking what's new - at ~2k rows x 2 resumes this is
 * trivial. Runs at the end of ingest() so scores are always current the
 * moment new jobs land.
 */
export async function scoreActiveJobs(db) {
  const [{ data: jobs, error: jobsErr }, { data: resumes, error: resumesErr }] = await Promise.all([
    db.from('jobs').select('id, title, description, city, is_remote').eq('is_active', true),
    db.from('resumes').select('id, target_titles, keywords'),
  ]);
  if (jobsErr) throw jobsErr;
  if (resumesErr) throw resumesErr;
  if (!resumes?.length || !jobs?.length) return { scored: 0 };

  const rows = [];
  for (const job of jobs) {
    for (const resume of resumes) {
      const { score, matched } = prefilterScore(job, resume);
      if (score === 0) continue; // no signal at all - don't bother storing a zero row
      rows.push({
        job_id: job.id,
        resume_id: resume.id,
        score,
        matched_keywords: matched,
        missing_keywords: [],
        reasoning: 'Deterministic prefilter: title/keyword overlap + location. Not a full read of the posting.',
        scored_at: new Date().toISOString(),
      });
    }
  }

  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db.from('scores').upsert(rows.slice(i, i + CHUNK), { onConflict: 'job_id,resume_id' });
    if (error) throw error;
  }
  return { scored: rows.length };
}
