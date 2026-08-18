import { ingest } from '../../../lib/ingest.mjs';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function GET(request) {
  // Vercel Cron sends this header; a manual call needs ?secret=
  const auth = request.headers.get('authorization');
  const url = new URL(request.url);
  const secret = process.env.CRON_SECRET;

  const authorized =
    auth === `Bearer ${secret}` || url.searchParams.get('secret') === secret;

  if (!authorized) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const summary = await ingest();
    return Response.json(summary);
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
}
