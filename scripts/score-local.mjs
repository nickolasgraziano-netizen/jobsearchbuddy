import { admin } from '../lib/ingest.mjs';
import { scoreActiveJobs } from '../lib/scoring.mjs';

const result = await scoreActiveJobs(admin());
console.log(JSON.stringify(result, null, 2));
