-- gov-fortcollins still points at the 'govjobs_rss' adapter, which was
-- replaced by 'govjobs' (governmentjobs.com search by org name) back on
-- 2026-08-17 when NeoGov's RSS feeds were confirmed retired. That rename
-- was never applied to this row, and 'govjobs_rss' isn't in the ADAPTERS
-- registry at all anymore — every ingest run throws "unknown adapter:
-- govjobs_rss" for this source, which Promise.allSettled swallows into a
-- silent per-source FAIL rather than crashing the run (per the "a broken
-- adapter must never wipe the board" design), so nothing surfaced this
-- until someone actually looked. Not simply repointed at 'govjobs': CLAUDE.md
-- already confirmed (2026-08-17) that Fort Collins isn't on
-- governmentjobs.com at all — it runs Cornerstone OnDemand behind an auth
-- wall, already covered via the quicklaunch.js deep link. Disabling rather
-- than deleting, matching how the dead wd5 Walmart tenant row was handled.

update sources set enabled = false
where slug = 'gov-fortcollins' and adapter = 'govjobs_rss';
