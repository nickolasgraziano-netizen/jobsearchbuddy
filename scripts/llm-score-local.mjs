import { admin } from '../lib/ingest.mjs';
import { llmScoreTopCandidates } from '../lib/llm-score.mjs';

const result = await llmScoreTopCandidates(admin(), process.env.ANTHROPIC_API_KEY);
console.log(JSON.stringify(result, null, 2));
