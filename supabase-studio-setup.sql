-- =====================================================================
-- Tuttle Kids Studio — episode concepting app schema
-- =====================================================================
-- Run ONCE in the SQL Editor of the "Tuttle Kids - Will It Sell"
-- Supabase project (ukeqcxdpzkhwlibabawg) — the same project that
-- already holds `applications` and `moderators` from
-- supabase-setup.sql. RUN supabase-setup.sql FIRST if this is a fresh
-- project: the studio reuses its `moderators` table + is_moderator().
--
-- Everything here is moderator-only: no anon access at all. Re-running
-- this file is safe (IF NOT EXISTS / ON CONFLICT / drop+recreate).
-- =====================================================================


-- ---------- 1. Episodes ----------------------------------------------
create table if not exists public.episodes (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  number      int         not null unique,
  title       text        not null,
  status      text        not null default 'script',
                -- 'script' | 'concepted' | 'shooting' | 'rough_cut' | 'released'
  script_text text        not null default '',
  notes       text        not null default ''
);

-- ---------- 2. Shots ---------------------------------------------------
-- One row per shot/beat on the concept board.
-- category: 'live' | 'animated'
-- subtype (live, 3x3 source x format):
--   crew_dtc  crew_story  crew_broll
--   kid_dtc   kid_story   kid_broll
--   adult_dtc adult_story adult_broll
-- subtype (animated):
--   anim_fully_scripted | anim_reactive_scripted | anim_short_term | anim_live
create table if not exists public.shots (
  id             uuid        primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  episode_id     uuid        not null references public.episodes(id) on delete cascade,
  position       int         not null default 0,
  title          text        not null default '',
  description    text        not null default '',
  category       text        not null default 'live',
  subtype        text        not null default 'crew_broll',
  script_text    text        not null default '',
  character_ids  uuid[]      not null default '{}',
  duration_secs  int         not null default 6,
  prompt_override text,
  status         text        not null default 'idea'
                   -- 'idea' | 'concepted' | 'approved' | 'shot'
);
create index if not exists shots_episode_idx on public.shots (episode_id, position);

-- ---------- 3. Characters (animated cast, real people, kid personas) --
create table if not exists public.characters (
  id              uuid        primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  name            text        not null unique,
  kind            text        not null default 'animated',
                    -- 'animated' | 'real' | 'persona'
  description     text        not null default '',
  -- persona-only fields (kid entrepreneurs for coach practice calls)
  persona_age     text,
  persona_business text,
  persona_personality text,
  briefing_prompt text
);

-- ---------- 4. Reference assets (character refs + global style refs) --
-- owner is 'character:<uuid>' or 'style' (the global animation-style set
-- that auto-attaches to every animated shot).
create table if not exists public.assets (
  id           uuid        primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  owner        text        not null,
  storage_path text        not null,
  media_type   text        not null default 'image'   -- 'image' | 'video'
);
create index if not exists assets_owner_idx on public.assets (owner);

-- ---------- 5. Generations (every AI frame/video run) -----------------
create table if not exists public.generations (
  id            uuid        primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  shot_id       uuid        not null references public.shots(id) on delete cascade,
  kind          text        not null default 'video',   -- 'frame' | 'video'
  model         text        not null,
  prompt        text        not null default '',
  params        jsonb       not null default '{}'::jsonb,
  prediction_id text,
  status        text        not null default 'pending',
                  -- 'pending' | 'running' | 'completed' | 'failed'
  output_url    text,
  output_path   text,   -- copy of the output inside studio-assets (outlives the gateway's signed URL)
  error         text,
  cost_usd      numeric(8,3),
  created_by    text
);
create index if not exists generations_shot_idx on public.generations (shot_id, created_at desc);

-- ---------- 6. Shoots + checklists -------------------------------------
-- items: [{ "section": "Gear", "text": "...", "done": false }, ...]
create table if not exists public.shoots (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  title       text        not null,
  shoot_date  date,
  episode_id  uuid        references public.episodes(id) on delete set null,
  kid_family  text        not null default '',
  items       jsonb       not null default '[]'::jsonb
);

-- ---------- 7. Ideas parking lot ---------------------------------------
create table if not exists public.ideas (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  text        text        not null,
  episode_id  uuid        references public.episodes(id) on delete set null,
  done        boolean     not null default false,
  created_by  text
);

-- ---------- 8. Cast & crew directory -----------------------------------
create table if not exists public.contacts (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text        not null,
  role        text        not null default '',
  email       text        not null default '',
  phone       text        not null default '',
  status      text        not null default '',
  notes       text        not null default ''
);

-- ---------- 9. Settings (templates, key dates) --------------------------
create table if not exists public.settings (
  key        text  primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------- 10. RLS: moderator-only on every studio table ---------------
do $$
declare t text;
begin
  foreach t in array array['episodes','shots','characters','assets',
                           'generations','shoots','ideas','contacts','settings']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "moderators all" on public.%I', t);
    execute format(
      'create policy "moderators all" on public.%I for all to authenticated
         using (public.is_moderator()) with check (public.is_moderator())', t);
    execute format('drop policy if exists "service role all" on public.%I', t);
    execute format(
      'create policy "service role all" on public.%I for all to service_role
         using (true) with check (true)', t);
  end loop;
end $$;

-- ---------- 11. Storage bucket for reference assets ---------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'studio-assets', 'studio-assets', false,
    262144000,   -- 250 MB
    ARRAY['image/jpeg','image/png','image/webp',
          'video/mp4','video/quicktime','video/webm']
  )
  on conflict (id) do update
    set file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "moderators manage studio assets" on storage.objects;
create policy "moderators manage studio assets"
  on storage.objects for all to authenticated
  using (bucket_id = 'studio-assets' and public.is_moderator())
  with check (bucket_id = 'studio-assets' and public.is_moderator());

drop policy if exists "service role studio assets" on storage.objects;
create policy "service role studio assets"
  on storage.objects for all to service_role
  using (bucket_id = 'studio-assets')
  with check (bucket_id = 'studio-assets');

-- =====================================================================
-- SEED DATA (all ON CONFLICT DO NOTHING — safe to re-run, and safe to
-- edit rows in the app afterwards; re-running won't clobber your edits)
-- =====================================================================

-- Episodes 1-6 from the IRL Overview (+ optional E7 blooper reel).
insert into public.episodes (number, title, notes) values
  (1, 'Shark Tank',        'Coaches review the top 8 audition tapes and pick 3 kids.'),
  (2, 'Product',           'Reveal all kids. Overview the path to the market. Onboarding.'),
  (3, 'Testing',           'Kids test their products in the real world.'),
  (4, 'Promotion',         'Kids learn to promote before the market.'),
  (5, 'Kids Fair',         'Market day — Children''s Entrepreneur Market. Will it sell?'),
  (6, 'Where Are They Now','Follow-up visits. What did they learn, what''s next.'),
  (7, 'Kids Being Kids',   'OPTIONAL bonus: blooper reel with kid commentary/reacts.')
  on conflict (number) do nothing;

-- Episode 1 script (from the "Tuttle Kids: Will it Sell? - Script" doc).
update public.episodes set script_text = $ep1$Intro music

Animated intro sequence. (Storyboarded)

Embedded into this we see videos of kids fairs.

NARRATOR
Every year, hundreds of kids come together in kids markets across the country to see if their product has what it takes.

There are 10 auditions and we'll be selecting 3.

This Summer, from the hundreds of auditions, we're selecting 3 budding entrepreneurs to follow as they create, test, and take their product to market to answer capitalism's greatest question, WILL IT SELL?

It's time to meet our business coaches who will be guiding our 3 winners on their way to the kids market.

He built a lemonade stand at just 11. And opened a corn dog stand the same year. And also a window washing business. Please welcome, Ethan Tuttle!

Ethan spins around at a newscasters desk and the light lands on him.

NARRATOR
Our second coach's father is a successful businessman and also funded this whole thing. Put your hands together for… Karinne Carmichel!

Karinne also spins around at a newscasters desk and the desk lights up.

NARRATOR
Should these kids successfully make it to the kid's market, they'll earn the grand prize: a 2 foot chocolate trophy of glo…

Curtain raise as the camera pans up from the ground to reveal on a pedestal… Derek who is just sticking the last of the trophy into his mouth.

NARRATOR
Well that's a month's worth of work down the drain.

ETHAN
Copernicus, what did we tell you about going off script?

Cut over to Copernicus who's running the soundboard and narrating into a microphone.

COPERNICUS
I'm so sorry I'm crying.

He presses a button on his mixer and sobbing sound effects.

NARRATOR (in a high pitched voice)
Let's welcome our first

ETHAN
Copernicus!

Copernicus puts it back to epic narrator voice.

NARRATOR
Let's welcome our first applicant.

30 Second Submission VIDEO 1
30 Second Commentary COMMENTARY
30 Second Submission VIDEO 2
30 Second Commentary COMMENTARY
30 Second Submission VIDEO 3
30 Second Commentary COMMENTARY
30 Second Submission VIDEO 4
30 Second Commentary COMMENTARY
30 Second Submission VIDEO 5
30 Second Commentary COMMENTARY
30 Second Submission VIDEO 6
30 Second Commentary COMMENTARY
30 Second Submission VIDEO 7
30 Second Commentary COMMENTARY
30 Second Submission VIDEO 8
30 Second Commentary COMMENTARY

Ethan and Karinne are arguing over who to pick.

They're about to reveal.

Episode Ends

On the next episode…
Copernicus accidentally teasing something.$ep1$
  where number = 1 and script_text = '';

-- Animated cast.
insert into public.characters (name, kind, description) values
  ('Ethan Tuttle', 'animated',
   'Co-host and business coach. Animated Tuttle Twins character, a boy who built a lemonade stand, corn dog stand, and window washing business at 11. Encouraging, earnest, practical. Sits at a newscaster desk on the show.'),
  ('Karinne Carmichel', 'animated',
   'Co-host and business coach. Animated character; her father is a successful businessman who funded the show. The skeptical Simon Cowell of the panel — sharp, dry, hard to impress, but fair. Sits at a newscaster desk.'),
  ('Copernicus', 'animated',
   'Animated character who runs the soundboard and does the show''s narration, sound effects, and music from a mixing desk with a microphone. Dramatic movie-trailer narrator voice; keeps going off script and getting emotional.'),
  ('Derek', 'animated',
   'Animated chaotic wildcard character. Ate the 2-foot chocolate trophy in Episode 1. Appears for gags.')
  on conflict (name) do nothing;

-- 3 placeholder kid personas for coach practice phone calls.
-- Replace with the real kids'' info after selection on July 17.
insert into public.characters
  (name, kind, description, persona_age, persona_business, persona_personality, briefing_prompt) values
  ('Maya (persona)', 'persona',
   'Placeholder practice kid #1 — update with a real kid after July 17.',
   '10', 'Friendship bracelet stand ("Braid Brigade")',
   'Bubbly, talks fast, tons of ideas at once. Loves the creative side, avoids the math. Gets quiet and deflated for a bit when feedback feels like criticism, then bounces back if the coach frames it as making the business better.',
   'You are Maya, a 10-year-old entrepreneur selling friendship bracelets at a kids market. You call your stand "Braid Brigade." You are bubbly and talk fast, jumping between ideas mid-sentence. You love designing bracelets but change the subject when asked about prices or costs (you honestly do not know your numbers — beads were "maybe twenty dollars?"). If the coach criticizes your idea directly, go quiet and give short sad answers for a couple of turns; if they encourage you or frame feedback as a way to sell more bracelets, get excited and build on it. You think like a real 10-year-old: concrete, literal, easily excited, occasionally off-topic (your dog, your best friend Ellie). Never break character, never use adult business vocabulary, and never acknowledge being an AI. This is a phone call with your business coach from the show.'),
  ('Deacon (persona)', 'persona',
   'Placeholder practice kid #2 — update with a real kid after July 17.',
   '12', 'Homemade dog treat bakery ("Good Boy Bakery")',
   'Confident bordering on cocky. Quotes big made-up numbers ("I''ll probably make like $500"). Resists changing his recipe or price because "it already works." Comes around if the coach asks questions that let him discover the problem himself instead of telling him.',
   'You are Deacon, a 12-year-old entrepreneur who bakes dog treats and calls his business "Good Boy Bakery." You are confident, borderline cocky, and quote big optimistic numbers you made up ("I''ll probably clear five hundred bucks easy"). You resist direct suggestions — if the coach tells you to change your recipe, packaging, or price, push back with "yeah but it already works." However, if the coach asks you good questions (how many did you actually sell? what did the customer say?), you slowly realize the problem yourself and come around, acting like the new idea was partly yours. You think like a real 12-year-old boy: competitive, a little impatient, loves your dog Biscuit who is your official taste tester. Never break character, never use adult business vocabulary, and never acknowledge being an AI. This is a phone call with your business coach from the show.'),
  ('Sofie (persona)', 'persona',
   'Placeholder practice kid #3 — update with a real kid after July 17.',
   '9', 'DIY slime kits ("Slime Time")',
   'Shy, gives one-word answers at first, warms up when the coach shows genuine interest in the details of her slime recipes. Secretly very detail-oriented — knows her exact costs. Needs drawing out, wilts under rapid-fire questions.',
   'You are Sofie, a shy 9-year-old entrepreneur who makes DIY slime kits called "Slime Time." At the start of the call, give short one- or two-word answers ("yeah", "I dunno", "kinda"). If the coach is patient and asks about the details of your slime — colors, glitter, the crunchy kind — you warm up and talk more, and it turns out you secretly know your numbers exactly (each kit costs $2.35 to make and you sell them for $6). If the coach fires too many questions too fast, get overwhelmed and go quiet again. You think like a real 9-year-old: literal, sweet, easily embarrassed, very proud of your glitter organization system. Never break character, never use adult business vocabulary, and never acknowledge being an AI. This is a phone call with your business coach from the show.')
  on conflict (name) do nothing;

-- Prompt templates per shot type + key dates + static checklist template.
insert into public.settings (key, value) values
('prompt_templates', jsonb_build_object(
  'anim_fully_scripted',   'Animated scene in the show''s 2D cartoon style (match the animation style of the reference videos exactly). {characters}. Scene: {description}. The dialogue/action follows this script: {script}. Bright colors, expressive cartoon acting, TV-quality kids animation.',
  'anim_reactive_scripted','Animated scene in the show''s 2D cartoon style (match the animation style reference videos exactly). {characters}. The characters are reacting live to something they''re watching on a screen: {description}. Loose, reactive comedic energy. Script beats: {script}',
  'anim_short_term',       'Short animated insert in the show''s 2D cartoon style (match the animation style reference videos exactly). {characters}. Quick beat: {description}. Script: {script}. Punchy, fast, comedic timing.',
  'anim_live',             'Animated scene in the show''s 2D cartoon style (match the animation style reference videos exactly). {characters}. Unscripted, improvisational feel: {description}. Natural overlapping conversational energy.',
  'crew_dtc',              'Documentary-style interview shot by a professional film crew. {characters}. Subject speaks directly to camera: {description}. Says roughly: {script}. Shallow depth of field, soft key light, clean home or office background, 4k documentary look.',
  'crew_story',            'Documentary-style scene shot by a professional film crew following the action. {description}. {characters}. Handheld but stable, natural light, observational documentary style like a premium unscripted series.',
  'crew_broll',            'Cinematic b-roll shot by a professional film crew. {description}. Shallow depth of field, motivated natural light, slow deliberate camera movement, premium documentary texture.',
  'kid_dtc',               'Self-filmed phone video by a kid (age 9-14) talking directly into their phone camera, selfie style. {description}. Says roughly: {script}. Slightly shaky handheld phone footage, natural window light, authentic and unpolished, real home in the background.',
  'kid_story',             'Self-filmed phone video by a kid (age 9-14) documenting what they''re doing. {description}. Handheld phone footage, real home setting, authentic kid energy, imperfect framing, natural sound feel.',
  'kid_broll',             'Phone-filmed b-roll captured by a kid or their family at home. {description}. Casual handheld phone video, natural light, authentic and unpolished, like real family footage.',
  'adult_dtc',             'Self-filmed phone video by a parent talking directly into their phone camera. {description}. Says roughly: {script}. Handheld phone footage, natural light, real home in the background, sincere and unpolished.',
  'adult_story',           'Phone video filmed by a parent documenting their kid''s business activity. {description}. Handheld phone footage, real home or neighborhood setting, warm and authentic.',
  'adult_broll',           'Phone-filmed b-roll captured by a parent. {description}. Casual handheld footage, natural light, authentic family-video feel.'
)) on conflict (key) do nothing;

insert into public.settings (key, value) values
('key_dates', jsonb_build_array(
  jsonb_build_object('date','2026-07-13','label','Casting deadline'),
  jsonb_build_object('date','2026-07-17','label','Selected families notified'),
  jsonb_build_object('date','2026-07-20','label','Production window opens (home visits)'),
  jsonb_build_object('date','2026-08-07','label','Children''s Entrepreneur Market (fair day)'),
  jsonb_build_object('date','2026-09-02','label','Episode 1 release'),
  jsonb_build_object('date','2026-10-02','label','Episode 6 + trailer release')
)) on conflict (key) do nothing;

insert into public.settings (key, value) values
('checklist_template', jsonb_build_array(
  jsonb_build_object('section','Gear','items',jsonb_build_array(
    'Camera body + charged batteries + empty cards',
    'Lav mics + recorder (audio decision: Steve + lav kit)',
    'Tripod / monopod',
    'Phone gimbal (if using)',
    'Backup phone for kid-filmed angles')),
  jsonb_build_object('section','Paperwork','items',jsonb_build_array(
    'Family participation agreement signed',
    'Media release on file',
    'Payment / kid business funding tracked')),
  jsonb_build_object('section','At the house','items',jsonb_build_array(
    'Establishing exteriors of the house',
    'Room tone (30s)',
    'Kid workspace / product close-ups',
    'Remind family what to self-film before next visit')),
  jsonb_build_object('section','After','items',jsonb_build_array(
    'Upload + tag footage in Drive (by episode and kid)',
    'Note best moments / conflicts for story review',
    'Confirm next visit date with family'))
)) on conflict (key) do nothing;
