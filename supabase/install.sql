-- Good Ideas: install into the shared Thrivn Supabase project.
-- Additive + idempotent. Everything lives in schema good_ideas, plus one private
-- storage bucket "good-ideas" with per-user folder policies. Nothing in public.

create schema if not exists good_ideas;

-- A capture = one thing Joe saved (typed text, a screenshot/photo, pasted email).
-- The original is kept forever, even after it is split into ideas.
create table if not exists good_ideas.captures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('text','image')),
  storage_path text,                       -- <user_id>/<capture_id>.<ext> in bucket good-ideas
  raw_text text,                           -- typed text or OCR output
  ocr_status text not null default 'none' check (ocr_status in ('none','pending','done','failed')),
  source_date date,                        -- date found in the source (email/photo), not proof of idea date
  created_at timestamptz not null default now()
);

create table if not exists good_ideas.ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  capture_id uuid references good_ideas.captures(id) on delete set null,
  title text not null check (char_length(title) between 1 and 200),
  body text not null default '' check (char_length(body) <= 200000),
  idea_date date,                          -- when Joe had the idea (nullable = unknown)
  idea_date_origin text not null default 'captured' check (idea_date_origin in ('captured','user','extracted','unknown')),
  captured_at timestamptz not null default now(),  -- immutable save time
  starred boolean not null default false,
  tags text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create index if not exists ideas_user_date on good_ideas.ideas (user_id, idea_date desc, captured_at desc);
create index if not exists captures_user on good_ideas.captures (user_id, created_at desc);

alter table good_ideas.captures enable row level security;
alter table good_ideas.ideas enable row level security;

drop policy if exists own_rows on good_ideas.captures;
create policy own_rows on good_ideas.captures for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists own_rows on good_ideas.ideas;
create policy own_rows on good_ideas.ideas for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (capture_id is null or exists (
      select 1 from good_ideas.captures c where c.id = capture_id and c.user_id = auth.uid()))
  );

-- captured_at is immutable; updated_at is maintained by the server.
create or replace function good_ideas.touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.captured_at := old.captured_at;
  new.user_id := old.user_id;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists ideas_touch on good_ideas.ideas;
create trigger ideas_touch before update on good_ideas.ideas
  for each row execute function good_ideas.touch();

-- Grants: signed-in users only. anon gets nothing.
revoke all on schema good_ideas from public, anon;
revoke all on all tables in schema good_ideas from public, anon;
revoke all on all functions in schema good_ideas from public, anon;
grant usage on schema good_ideas to authenticated;
grant select, insert, update, delete on good_ideas.captures, good_ideas.ideas to authenticated;

-- Private storage bucket for original screenshots/photos (10 MB, images only).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('good-ideas', 'good-ideas', false, 10485760,
        array['image/png','image/jpeg','image/webp','image/heic','image/heif','image/gif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists good_ideas_own_read on storage.objects;
create policy good_ideas_own_read on storage.objects for select to authenticated
  using (bucket_id = 'good-ideas' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists good_ideas_own_insert on storage.objects;
create policy good_ideas_own_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'good-ideas' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists good_ideas_own_delete on storage.objects;
create policy good_ideas_own_delete on storage.objects for delete to authenticated
  using (bucket_id = 'good-ideas' and (storage.foldername(name))[1] = auth.uid()::text);

-- v0.1.1: body limit raised to 200k (client never truncates).
alter table good_ideas.ideas drop constraint if exists ideas_body_check;
alter table good_ideas.ideas add constraint ideas_body_check check (char_length(body) <= 200000);
