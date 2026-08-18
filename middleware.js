import { NextResponse } from 'next/server';

/**
 * /hub is unauthenticated at the app level (CLAUDE.md flags this explicitly
 * as a pre-deploy blocker) and now has a "Refresh now" button that costs
 * real money per click (LLM scoring). This is a deliberately lightweight
 * gate - HTTP Basic Auth via env vars - not full Supabase Auth, which is
 * a bigger feature than "deploy this." Only gates /hub; "/" (the intended-
 * public bio page) and /api/ingest (its own CRON_SECRET auth, would
 * conflict with Basic Auth) are untouched.
 */
export function middleware(request) {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASS;
  if (!user || !pass) return NextResponse.next(); // unset locally - no gate in dev

  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Basic ')) {
    const [u, p] = atob(auth.slice(6)).split(':');
    if (u === user && p === pass) return NextResponse.next();
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Job Hub"' },
  });
}

export const config = {
  matcher: ['/hub', '/hub/:path*'],
};
