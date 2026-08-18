-- Job Search Hub — initial schema
-- The design centers on one idea: this is a CHANGE DETECTOR, not a search
-- engine. first_seen_at is the most important column in the database.

create extension if not exists "pgcrypto";

-- ── sources ──────────────────────────────────────────────────────────
-- Adding an employer is a row here, not a code change.
create table if not exists sources (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,
  label         text not null,
  adapter       text not null,           -- workday | greenhouse | lever | ashby |
                                         -- smartrecruiters | careeronestop | jsearch |
                                         -- usajobs | adzuna | govjobs_rss | remotive
  config        jsonb not null default '{}'::jsonb,
  tier          smallint not null default 1,
  enabled       boolean not null default true,
  last_run_at   timestamptz,
  last_status   text,                    -- PASS | EMPTY | FAIL
  last_count    integer default 0,
  consecutive_empty integer not null default 0,   -- silent-failure detector
  created_at    timestamptz not null default now()
);

-- ── jobs ─────────────────────────────────────────────────────────────
create table if not exists jobs (
  id            uuid primary key default gen_random_uuid(),
  fingerprint   text unique not null,    -- hash(title + company + city/state)
  source_id     uuid references sources(id) on delete set null,
  external_id   text,
  title         text not null,
  company       text,
  location_text text,
  city          text,
  state         text,
  postal_code   text,
  is_remote     boolean default false,
  employment_type text,
  salary_min    numeric,
  salary_max    numeric,
  salary_text   text,
  description   text,
  apply_url     text not null,
  posted_at     timestamptz,

  -- The heart of the system.
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  is_active     boolean not null default true,

  -- When the same req arrives from six aggregators we keep one row and
  -- record where else it showed up.
  also_seen_on  text[] default '{}',
  raw           jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists jobs_first_seen_idx on jobs (first_seen_at desc);
create index if not exists jobs_active_idx     on jobs (is_active, first_seen_at desc);
create index if not exists jobs_company_idx    on jobs (company);
create index if not exists jobs_state_idx      on jobs (state);
create index if not exists jobs_remote_idx     on jobs (is_remote);

-- ── resumes ──────────────────────────────────────────────────────────
create table if not exists resumes (
  id            uuid primary key default gen_random_uuid(),
  label         text not null,           -- "People Lead / HR"  |  "AI Operations"
  file_path     text,
  extracted_text text,
  keywords      text[] default '{}',
  target_titles text[] default '{}',
  is_default    boolean default false,
  created_at    timestamptz not null default now()
);

-- ── scores ───────────────────────────────────────────────────────────
create table if not exists scores (
  job_id        uuid references jobs(id) on delete cascade,
  resume_id     uuid references resumes(id) on delete cascade,
  score         smallint not null,       -- 0-100
  matched_keywords text[] default '{}',
  missing_keywords text[] default '{}',
  reasoning     text,
  scored_at     timestamptz not null default now(),
  primary key (job_id, resume_id)
);

create index if not exists scores_score_idx on scores (score desc);

-- ── applications ─────────────────────────────────────────────────────
create table if not exists applications (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid references jobs(id) on delete cascade,
  resume_id     uuid references resumes(id) on delete set null,
  status        text not null default 'saved',
                -- saved | applied | screened | interview | offer | closed
  applied_at    timestamptz,
  last_activity_at timestamptz default now(),
  next_action_date date,
  notes         text,
  created_at    timestamptz not null default now()
);

create index if not exists applications_status_idx on applications (status, last_activity_at desc);

-- ── rules ────────────────────────────────────────────────────────────
-- Mute staffing agencies, MLM reposts, companies you've ruled out.
create table if not exists rules (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,           -- mute_company | mute_keyword | boost_company | boost_keyword
  value         text not null,
  weight        smallint default 0,
  note          text,
  created_at    timestamptz not null default now()
);

-- ── helper view: what's new since yesterday ──────────────────────────
create or replace view v_new_today as
select j.*, s.label as source_label,
       coalesce(max(sc.score), 0) as best_score
from jobs j
left join sources s on s.id = j.source_id
left join scores sc on sc.job_id = j.id
where j.is_active
  and j.first_seen_at > (now() - interval '24 hours')
group by j.id, s.label
order by best_score desc, j.first_seen_at desc;

-- ── seed the source registry ─────────────────────────────────────────
insert into sources (slug, label, adapter, tier, config) values
  ('walmart-external',   'Walmart — external',        'workday', 1,
     '{"host":"walmart.wd5.myworkdayjobs.com","tenant":"walmart","site":"WalmartExternal","locationTerm":"Colorado"}'),
  ('walmart-external-504','Walmart — external (wd504)','workday', 1,
     '{"host":"walmart.wd504.myworkdayjobs.com","tenant":"walmart","site":"WalmartExternal","locationTerm":"Colorado"}'),
  ('walmart-dc',         'Walmart — DC / supply chain','workday', 1,
     '{"host":"walmart.wd5.myworkdayjobs.com","tenant":"walmart","site":"WalmartExternal","searchText":"distribution center","locationTerm":"Loveland"}'),
  ('sams-club',          'Sam''s Club',                'workday', 1,
     '{"host":"walmart.wd5.myworkdayjobs.com","tenant":"walmart","site":"WalmartExternal","searchText":"Sams Club","locationTerm":"Colorado"}'),
  ('costco',             'Costco',                     'workday', 1,
     '{"host":"costco.wd1.myworkdayjobs.com","tenant":"costco","site":"costcocareers","locationTerm":"Colorado"}'),
  ('careeronestop',      'CareerOneStop (US DOL)',     'careeronestop', 2, '{}'),
  ('jsearch',            'JSearch → Indeed/LinkedIn/ZR','jsearch', 2,
     '{"query":"jobs in Fort Collins, CO"}'),
  ('usajobs',            'USAJOBS (federal)',          'usajobs', 2, '{}'),
  ('adzuna',             'Adzuna',                     'adzuna', 2, '{}'),
  ('remotive',           'Remotive (remote)',          'remotive', 2, '{}'),
  ('gh-anthropic',       'Greenhouse — Anthropic',     'greenhouse', 1, '{"company":"anthropic"}'),
  ('ashby-openai',       'Ashby — OpenAI',             'ashby', 1, '{"company":"openai"}'),
  ('gov-fortcollins',    'City of Fort Collins',       'govjobs_rss', 2, '{"agency":"fortcollins"}'),
  ('gov-larimer',        'Larimer County',             'govjobs_rss', 2, '{"agency":"larimercounty"}'),
  ('gov-loveland',       'City of Loveland',           'govjobs_rss', 2, '{"agency":"loveland"}'),
  ('gov-colorado',       'State of Colorado',          'govjobs_rss', 2, '{"agency":"colorado"}')
on conflict (slug) do nothing;
