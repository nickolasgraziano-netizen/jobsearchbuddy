#!/usr/bin/env node
/**
 * Run the full ingest from your laptop — same code path the cron uses.
 * Useful for testing before you deploy, and as a manual "refresh now".
 *
 *   node --env-file=.env.local scripts/ingest-local.mjs
 */
import { ingest } from '../lib/ingest.mjs';

ingest().then(
  s => { console.log(`\n✔ ${s.afterDedup} jobs after dedup · ${s.newInLast24h} new in last 24h`); process.exit(0); },
  e => { console.error('✖ ingest failed:', e); process.exit(1); }
);
