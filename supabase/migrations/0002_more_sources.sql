-- More employer sources, 2026-08-20 — all from CLAUDE.md's "worth seeding"
-- wishlist under Northern Colorado / retail-logistics peers. All confirmed
-- via web research (exact Workday tenant+site slug visible in search
-- results/job URLs) but NOT yet verified against live data in this
-- session — outbound network access to arbitrary hosts was blocked, so
-- no probe/ingest could be run. Each will show PASS/EMPTY/FAIL on the
-- source health dashboard after the next real ingest; anything that
-- comes back FAIL needs a fresh Network-tab check like the existing
-- adapters' history in CLAUDE.md, not a resubmit of the same guess.

insert into sources (slug, label, adapter, tier, config) values
  ('woodward',      'Woodward (Fort Collins HQ)', 'workday', 1,
     '{"host":"woodward.wd5.myworkdayjobs.com","tenant":"woodward","site":"woodward","locationTerm":"Colorado"}'),
  ('banner-health',  'Banner Health',              'workday', 1,
     '{"host":"bannerhealth.wd5.myworkdayjobs.com","tenant":"bannerhealth","site":"Careers","locationTerm":"Colorado"}'),
  ('target',         'Target',                     'workday', 1,
     '{"host":"target.wd5.myworkdayjobs.com","tenant":"target","site":"targetcareers","locationTerm":"Colorado"}'),
  ('home-depot',     'Home Depot',                 'workday', 1,
     '{"host":"homedepot.wd5.myworkdayjobs.com","tenant":"homedepot","site":"CareerDepot","locationTerm":"Colorado"}'),
  ('lowes',          'Lowe''s',                    'workday', 1,
     '{"host":"lowes.wd5.myworkdayjobs.com","tenant":"lowes","site":"LWS_External_CS","locationTerm":"Colorado"}'),
  ('sysco',          'Sysco',                      'workday', 1,
     '{"host":"sysco.wd5.myworkdayjobs.com","tenant":"sysco","site":"syscocareers","locationTerm":"Colorado"}'),
  ('us-foods',       'US Foods',                   'workday', 1,
     '{"host":"usfoods.wd1.myworkdayjobs.com","tenant":"usfoods","site":"usfoodscareersExternal","locationTerm":"Colorado"}'),
  ('fedex',          'FedEx',                      'workday', 1,
     '{"host":"fedex.wd1.myworkdayjobs.com","tenant":"fedex","site":"FXE-US_External_Career_Site","locationTerm":"Colorado"}')
on conflict (slug) do nothing;
