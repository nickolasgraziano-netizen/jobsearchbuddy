import { createClient } from '@supabase/supabase-js';

export function browserClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

// no-store is explicit here rather than relying on route-level force-dynamic:
// a parameterless query like `rules.select('*')` is the same URL on every
// request, and it got cached by Next's fetch Data Cache and stuck stale
// (proven by pulling a row that had been inserted via direct SQL, outside
// any revalidatePath) even with force-dynamic set on the page.
let _serverClient;
export function serverClient() {
  if (!_serverClient) {
    _serverClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: { persistSession: false },
        global: { fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' }) },
      }
    );
  }
  return _serverClient;
}
