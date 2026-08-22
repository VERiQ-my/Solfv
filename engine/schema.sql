-- SOLFV — Supabase schema.
--
-- Run this once in the Supabase SQL editor.
--
-- This table is an AUDIT HISTORY of reconciled results, not a document store.
-- It holds canonical financial figures from published annual reports, the
-- check outcomes, and our derived ratios. It deliberately holds no uploaded
-- file, no rendered page, and no personal data — only the two PII counts,
-- because the count is the compliance claim and the value is the exposure.
--
-- Keeping documents out of here is what lets the product keep saying
-- "processed in memory, purged on a timer, nothing stored".

create table if not exists public.analyses (
  id                   uuid primary key default gen_random_uuid(),
  created_at           timestamptz not null default now(),

  -- Provenance of the run
  session_id           text,
  document_name        text,
  source               text,          -- 'upload' | 'demo:clean' | 'demo:doctored'
  pages_total          integer,

  -- What was analysed
  entity               text,
  period               text,
  prior_period         text,
  ticker               text,
  currency             text,
  unit                 text,

  -- Reconciliation outcome
  checks_passed        integer,
  checks_failed        integer,
  checks_unverifiable  integer,
  line_item_count      integer,
  trust_verified       integer,
  trust_derived        integer,
  trust_unverified     integer,
  quarantined          text[] default '{}',

  -- Risk
  risk_score           double precision,
  risk_zone            text,
  risk_variant         text,

  -- Full detail, for reopening a past run
  ratios               jsonb default '{}'::jsonb,
  prior_ratios         jsonb default '{}'::jsonb,
  checks               jsonb default '[]'::jsonb,
  line_items           jsonb default '[]'::jsonb,
  say_do_gap           jsonb default '[]'::jsonb,
  benchmark            jsonb default '[]'::jsonb,

  -- Counts only. Never a matched value.
  pii_detected         integer,
  pii_transmitted      integer,
  pages_transmitted    integer
);

create index if not exists analyses_created_at_idx on public.analyses (created_at desc);
create index if not exists analyses_entity_idx     on public.analyses (entity);
create index if not exists analyses_failed_idx     on public.analyses (checks_failed)
  where checks_failed > 0;

-- Row Level Security ---------------------------------------------------------
--
-- RLS is enabled and the policies below are permissive for the anon key, which
-- is appropriate for a single-tenant prototype and NOT for production. Before
-- this is exposed to more than one organisation, replace these with policies
-- keyed on auth.uid() or an org_id column.

alter table public.analyses enable row level security;

drop policy if exists "anon can read analyses"   on public.analyses;
drop policy if exists "anon can insert analyses" on public.analyses;

create policy "anon can read analyses"
  on public.analyses for select
  to anon, authenticated
  using (true);

create policy "anon can insert analyses"
  on public.analyses for insert
  to anon, authenticated
  with check (true);

-- Deliberately no update or delete policy: an audit history that callers can
-- rewrite is not an audit history.
