'use server';

import { revalidatePath } from 'next/cache';
import { ingest } from '../../lib/ingest.mjs';

export async function refreshJobs() {
  await ingest();
  revalidatePath('/hub');
}
