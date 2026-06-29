-- =====================================================================
-- Tuttle Kids · Will It Sell — Supabase schema
-- =====================================================================
-- Run this ONCE in the SQL Editor of the new "Tuttle Kids - Will It Sell"
-- Supabase project. It creates:
--
--   1. The `applications` table for every kid's pitch submission.
--   2. The `application-videos` Storage bucket for the three video files
--      (pitch / introduction / parent).
--   3. RLS policies so:
--        - Anyone (anon, no login) can INSERT a new application + upload
--          videos. That's the public form.
--        - Nobody anon can SELECT, UPDATE, or DELETE — submissions are
--          private once they land.
--        - The service_role key (used by the admin page) can read/write
--          everything for moderator review.
--
-- Re-running this file is safe — every CREATE uses IF NOT EXISTS and
-- every policy is dropped+recreated.
-- =====================================================================


-- ---------- 1. Applications table -------------------------------------
create table if not exists public.applications (
  id                       uuid          primary key default gen_random_uuid(),
  created_at               timestamptz   not null    default now(),

  -- About the applicant(s)
  applicant_names          text          not null,
  applicant_ages           text          not null,
  city                     text          not null,

  -- Parent / guardian
  guardian_name            text          not null,
  guardian_email           text          not null,
  guardian_phone           text          not null,

  -- Availability
  can_attend_market        text          not null,   -- 'yes' | 'no'
  weekly_availability      text          not null,   -- 'yes' | 'mostly'
  unavailable_dates        jsonb         not null    default '[]'::jsonb,

  -- Business
  business_pitch           text          not null,
  previous_market_history  text,

  -- Video paths inside the application-videos Storage bucket.
  -- (Files are stored at "<application-id>/pitch.mp4" etc.)
  pitch_video_path         text          not null,
  intro_video_path         text          not null,
  parent_video_path        text          not null,

  -- Consent + signature
  signature                text          not null,
  consent_acknowledged     boolean       not null    default false,
  media_use_acknowledged   boolean       not null    default false,

  -- Moderator workflow
  status                   text          not null    default 'pending',
                              -- 'pending' | 'reviewed' | 'accepted' | 'rejected'
  reviewer_notes           text
);

-- Backfill for tables created before media_use_acknowledged existed.
alter table public.applications
  add column if not exists media_use_acknowledged boolean not null default false;

-- Survey: how much of the Tuttle Twins Cartoon the applicant has seen
-- ("Haven't seen it" | "One or less" | "2-3" | "All of it").
alter table public.applications
  add column if not exists seen_show text;

-- Soft-delete support: deleted_at is null for active rows, set to a
-- timestamp when a moderator deletes one. Rows stay recoverable for 30
-- days (the admin purges anything older). null = active / visible.
alter table public.applications
  add column if not exists deleted_at timestamptz;
create index if not exists applications_deleted_at_idx
  on public.applications (deleted_at);

-- Lightweight indexes for the admin list view.
create index if not exists applications_created_at_idx
  on public.applications (created_at desc);
create index if not exists applications_status_idx
  on public.applications (status);
create index if not exists applications_email_idx
  on public.applications (guardian_email);


-- ---------- 2. RLS on the applications table -------------------------
alter table public.applications enable row level security;

-- Reset policies so re-runs are clean.
drop policy if exists "anon can insert applications" on public.applications;
drop policy if exists "service role full access"      on public.applications;

-- Anyone can submit a new application from the public form.
create policy "anon can insert applications"
  on public.applications
  for insert
  to anon
  with check (true);

-- Service role (used by the admin page with the secret key) has full
-- read/write access. No anon SELECT/UPDATE/DELETE policy — those are
-- locked off by default once RLS is on.
create policy "service role full access"
  on public.applications
  for all
  to service_role
  using (true)
  with check (true);


-- ---------- 3. Storage bucket for the videos --------------------------
-- Create the bucket if it isn't there. Public = false so links are
-- signed (admin generates short-lived URLs to play back videos).
--
-- file_size_limit is 2GB so a long, high-res iPhone video can still
-- upload without manual compression. (Pro tier caps at 5GB; we leave
-- headroom under that.) allowed_mime_types is constrained to video/*
-- so a misclicked .jpg can't fill the bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'application-videos',
    'application-videos',
    false,
    2147483648,                       -- 2 GiB
    ARRAY['video/mp4','video/quicktime','video/x-m4v','video/webm','video/*']
  )
  on conflict (id) do update
    set file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

-- Reset policies so re-runs are clean.
drop policy if exists "anon can upload application videos" on storage.objects;
drop policy if exists "service role full access to videos" on storage.objects;

-- Anon may upload to the bucket (the public form does this). We scope
-- the policy by bucket name so anon can't write to any OTHER bucket
-- you create later.
create policy "anon can upload application videos"
  on storage.objects
  for insert
  to anon
  with check (bucket_id = 'application-videos');

-- Service role can read / overwrite / delete anything in the bucket
-- (admin page review + cleanup).
create policy "service role full access to videos"
  on storage.objects
  for all
  to service_role
  using (bucket_id = 'application-videos')
  with check (bucket_id = 'application-videos');


-- ---------- 4. Moderator whitelist + policies -------------------------
-- Moderators sign in with Supabase Auth (magic link). Their email is
-- checked against the moderators table; RLS grants SELECT + UPDATE on
-- applications and SELECT on the videos bucket only to whitelisted
-- emails. The service_role key still has full access — moderators
-- don't need it.
create table if not exists public.moderators (
  email      text         primary key,
  added_at   timestamptz  not null default now(),
  note       text
);

-- Helper: returns true when the currently-authenticated user's email
-- (from their JWT) is in the moderators table.
create or replace function public.is_moderator() returns boolean
  language sql stable security definer set search_path = public as $$
    select exists (
      select 1 from public.moderators
      where lower(email) = lower((auth.jwt() ->> 'email'))
    );
  $$;

drop policy if exists "moderators can read applications"   on public.applications;
drop policy if exists "moderators can update applications" on public.applications;

create policy "moderators can read applications"
  on public.applications for select
  to authenticated
  using (public.is_moderator());

create policy "moderators can update applications"
  on public.applications for update
  to authenticated
  using (public.is_moderator())
  with check (public.is_moderator());

-- Moderators can also fetch / play back the videos.
drop policy if exists "moderators can read application videos" on storage.objects;
create policy "moderators can read application videos"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'application-videos' and public.is_moderator());

-- Moderators can permanently delete an application (used by the admin's
-- "delete permanently" action and the 30-day purge of soft-deleted rows).
drop policy if exists "moderators can delete applications" on public.applications;
create policy "moderators can delete applications"
  on public.applications for delete
  to authenticated
  using (public.is_moderator());

-- ...and remove its videos from storage when permanently deleting.
drop policy if exists "moderators can delete application videos" on storage.objects;
create policy "moderators can delete application videos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'application-videos' and public.is_moderator());

-- Seed the initial moderator so the admin page is usable immediately.
-- Add more emails later with:
--   insert into public.moderators (email) values ('someone@example.com');
insert into public.moderators (email, note)
  values ('nelson@tuttletwins.tv', 'Seeded by supabase-setup.sql')
  on conflict (email) do nothing;


-- ---------- Done ------------------------------------------------------
-- Verify with:
--   select count(*) from public.applications;
--   select id, name, public from storage.buckets where id = 'application-videos';
--   select email from public.moderators;
