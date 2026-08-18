/**
 * Stage 2 scoring: an actual model reads the full posting against the full
 * resume and judges fit, the way a person would - not just keyword overlap.
 * Only runs on jobs that already cleared the free prefilter (scoring.mjs),
 * so this is maybe 20-80 calls a day, not one per job. Costs real money
 * (~$1-3/month per build-plan.md's own estimate) - requires ANTHROPIC_API_KEY
 * in .env.local. Skips itself cleanly if that's not set; never throws and
 * takes down the rest of ingest over it.
 */

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_PER_RUN = 30; // cost/time ceiling per ingest run, independent of how many qualify

const PROMPT = (resumeText, job) => `You are a candid, discerning technical recruiter. Judge how well this candidate genuinely fits this specific job - not just keyword overlap, but whether they'd realistically clear the bar this posting sets.

CANDIDATE RESUME:
${resumeText}

JOB POSTING:
Title: ${job.title}
Company: ${job.company}
Location: ${job.location_text || (job.is_remote ? 'Remote' : 'unspecified')}
Description:
${(job.description || '(no description provided)').slice(0, 6000)}

Score 0-100:
- 80-100: strong fit, apply now
- 60-79: good fit, worth applying
- 40-59: real stretch - possible but the posting sets a bar the resume doesn't clearly clear
- 0-39: not a fit, don't recommend applying

Be honest about stretches - a posting demanding "5+ years production ML engineering" is not a 70+ for someone whose engineering experience is one shipped internal tool, however impressive that tool is. Say so in why_it_fits rather than inflating the score.

Reply with ONLY this JSON, no other text, no markdown fences:
{"score": <int 0-100>, "why_it_fits": "<1-2 sentences, specific to this posting>", "gaps": ["<short gap>", "..."], "suggested_tweak": "<one specific, actionable way to frame this candidate's pitch for this exact role>"}`;

function parseModelJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  return JSON.parse(cleaned);
}

async function callModel(apiKey, resumeText, job) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      messages: [{ role: 'user', content: PROMPT(resumeText, job) }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  const parsed = parseModelJson(text);
  if (typeof parsed.score !== 'number') throw new Error('model response missing numeric score');
  return parsed;
}

/**
 * Finds (job, resume) pairs that cleared the prefilter but haven't had a
 * real model read yet, scores up to MAX_PER_RUN of them, updates in place.
 */
export async function llmScoreTopCandidates(db, apiKey) {
  if (!apiKey) return { skipped: 'no ANTHROPIC_API_KEY set', scored: 0 };

  const { data: candidates, error } = await db
    .from('scores')
    .select('job_id, resume_id, score, job:jobs(id, title, company, location_text, is_remote, description, is_active), resume:resumes(id, extracted_text)')
    .eq('scoring_method', 'prefilter')
    .gte('score', 40)
    .order('score', { ascending: false })
    .limit(MAX_PER_RUN);
  if (error) throw error;

  let scored = 0;
  let failed = 0;
  for (const c of candidates || []) {
    if (!c.job?.is_active || !c.resume?.extracted_text) continue;
    try {
      const result = await callModel(apiKey, c.resume.extracted_text, c.job);
      const { error: upErr } = await db.from('scores').update({
        score: Math.max(0, Math.min(100, Math.round(result.score))),
        matched_keywords: [],
        missing_keywords: Array.isArray(result.gaps) ? result.gaps.slice(0, 6) : [],
        reasoning: String(result.why_it_fits || '').slice(0, 500),
        suggested_tweak: String(result.suggested_tweak || '').slice(0, 500),
        scoring_method: 'llm',
        scored_at: new Date().toISOString(),
      }).eq('job_id', c.job_id).eq('resume_id', c.resume_id);
      if (upErr) throw upErr;
      scored++;
    } catch (e) {
      failed++;
      // One bad model response shouldn't sink the batch - leave that pair
      // as 'prefilter' so it's picked up and retried next run.
    }
  }
  return { scored, failed, candidates: (candidates || []).length };
}
