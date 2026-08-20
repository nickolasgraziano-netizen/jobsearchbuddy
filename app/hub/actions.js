'use server';

import { revalidatePath } from 'next/cache';
import { ingest } from '../../lib/ingest.mjs';
import { admin } from '../../lib/ingest.mjs';

// Every mutation touches state both /hub and /hub/search read, regardless of
// which page the action was submitted from.
function revalidateBoth() {
  revalidatePath('/hub');
  revalidatePath('/hub/search');
}

export async function refreshJobs() {
  await ingest();
  revalidateBoth();
}

export async function dismissJob(formData) {
  const jobId = formData.get('jobId');
  await admin().from('dismissed_jobs').upsert({ job_id: jobId }, { onConflict: 'job_id' });
  revalidateBoth();
}

export async function dismissJobs(jobIds) {
  const ids = [...new Set((jobIds || []).filter(Boolean))];
  if (!ids.length) return;
  await admin().from('dismissed_jobs').upsert(ids.map(job_id => ({ job_id })), { onConflict: 'job_id' });
  revalidateBoth();
}

export async function restoreJob(formData) {
  const jobId = formData.get('jobId');
  await admin().from('dismissed_jobs').delete().eq('job_id', jobId);
  revalidateBoth();
}

export async function muteCompany(formData) {
  const company = formData.get('company');
  if (!company) return;
  await admin().from('rules').insert({ kind: 'mute_company', value: company, note: 'muted from /hub' });
  revalidateBoth();
}

export async function watchCompany(formData) {
  const company = formData.get('company');
  if (!company) return;
  await admin().from('rules').insert({ kind: 'boost_company', value: company, note: 'watched from /hub' });
  revalidateBoth();
}

export async function removeRule(formData) {
  const ruleId = formData.get('ruleId');
  await admin().from('rules').delete().eq('id', ruleId);
  revalidateBoth();
}

export async function saveJob(formData) {
  const jobId = formData.get('jobId');
  await admin().from('saved_jobs').upsert({ job_id: jobId }, { onConflict: 'job_id' });
  revalidateBoth();
}

export async function unsaveJob(formData) {
  const jobId = formData.get('jobId');
  await admin().from('saved_jobs').delete().eq('job_id', jobId);
  revalidateBoth();
}
