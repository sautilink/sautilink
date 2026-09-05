begin;

create table if not exists public.social_post_polls (
  post_id uuid primary key references public.social_posts(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  total_votes integer not null default 0 check (total_votes >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.social_post_poll_options (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_post_polls(post_id) on delete cascade,
  position smallint not null check (position between 0 and 3),
  label text not null check (char_length(btrim(label)) between 1 and 80),
  vote_count integer not null default 0 check (vote_count >= 0),
  created_at timestamptz not null default now(),
  unique (post_id, position),
  unique (id, post_id)
);

create unique index if not exists social_post_poll_options_post_label_uidx
  on public.social_post_poll_options (post_id, lower(btrim(label)));

create table if not exists public.social_post_poll_votes (
  post_id uuid not null references public.social_post_polls(post_id) on delete cascade,
  option_id uuid not null,
  voter_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, voter_id),
  constraint social_post_poll_votes_option_post_fk
    foreign key (option_id, post_id)
    references public.social_post_poll_options(id, post_id)
    on delete cascade
);

create index if not exists social_post_poll_options_post_idx
  on public.social_post_poll_options(post_id, position);
create index if not exists social_post_poll_votes_option_idx
  on public.social_post_poll_votes(option_id);
create index if not exists social_post_poll_votes_voter_idx
  on public.social_post_poll_votes(voter_id, created_at desc);

alter table public.social_post_polls enable row level security;
alter table public.social_post_poll_options enable row level security;
alter table public.social_post_poll_votes enable row level security;

revoke all on table public.social_post_polls from anon, authenticated;
revoke all on table public.social_post_poll_options from anon, authenticated;
revoke all on table public.social_post_poll_votes from anon, authenticated;

grant select on table public.social_post_polls to anon, authenticated;
grant insert, delete on table public.social_post_polls to authenticated;
grant select on table public.social_post_poll_options to anon, authenticated;
grant insert on table public.social_post_poll_options to authenticated;
grant select, insert on table public.social_post_poll_votes to authenticated;

drop policy if exists social_post_polls_select_anon on public.social_post_polls;
create policy social_post_polls_select_anon
on public.social_post_polls for select
to anon
using (
  exists (
    select 1
    from public.social_posts post
    where post.id = social_post_polls.post_id
  )
);

drop policy if exists social_post_polls_select_authenticated on public.social_post_polls;
create policy social_post_polls_select_authenticated
on public.social_post_polls for select
to authenticated
using (
  exists (
    select 1
    from public.social_posts post
    where post.id = social_post_polls.post_id
  )
);

drop policy if exists social_post_polls_insert_authenticated on public.social_post_polls;
create policy social_post_polls_insert_authenticated
on public.social_post_polls for insert
to authenticated
with check (
  author_id = (select auth.uid())
  and exists (
    select 1
    from public.social_posts post
    where post.id = social_post_polls.post_id
      and post.author_id = (select auth.uid())
  )
);

drop policy if exists social_post_polls_delete_authenticated on public.social_post_polls;
create policy social_post_polls_delete_authenticated
on public.social_post_polls for delete
to authenticated
using (author_id = (select auth.uid()));

drop policy if exists social_post_poll_options_select_anon on public.social_post_poll_options;
create policy social_post_poll_options_select_anon
on public.social_post_poll_options for select
to anon
using (
  exists (
    select 1
    from public.social_posts post
    where post.id = social_post_poll_options.post_id
  )
);

drop policy if exists social_post_poll_options_select_authenticated on public.social_post_poll_options;
create policy social_post_poll_options_select_authenticated
on public.social_post_poll_options for select
to authenticated
using (
  exists (
    select 1
    from public.social_posts post
    where post.id = social_post_poll_options.post_id
  )
);

drop policy if exists social_post_poll_options_insert_authenticated on public.social_post_poll_options;
create policy social_post_poll_options_insert_authenticated
on public.social_post_poll_options for insert
to authenticated
with check (
  position between 0 and 3
  and exists (
    select 1
    from public.social_post_polls poll
    where poll.post_id = social_post_poll_options.post_id
      and poll.author_id = (select auth.uid())
      and poll.total_votes = 0
  )
);

drop policy if exists social_post_poll_votes_select_authenticated on public.social_post_poll_votes;
create policy social_post_poll_votes_select_authenticated
on public.social_post_poll_votes for select
to authenticated
using (voter_id = (select auth.uid()));

drop policy if exists social_post_poll_votes_insert_authenticated on public.social_post_poll_votes;
create policy social_post_poll_votes_insert_authenticated
on public.social_post_poll_votes for insert
to authenticated
with check (
  voter_id = (select auth.uid())
  and exists (
    select 1
    from public.social_posts post
    where post.id = social_post_poll_votes.post_id
  )
  and exists (
    select 1
    from public.social_post_poll_options option
    where option.id = social_post_poll_votes.option_id
      and option.post_id = social_post_poll_votes.post_id
  )
);

create schema if not exists private;

create or replace function private.increment_social_poll_vote_counts()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.social_post_poll_options
  set vote_count = vote_count + 1
  where id = new.option_id
    and post_id = new.post_id;

  update public.social_post_polls
  set total_votes = total_votes + 1
  where post_id = new.post_id;

  return new;
end;
$$;

revoke all on function private.increment_social_poll_vote_counts() from public, anon, authenticated;

drop trigger if exists social_post_poll_votes_increment_counts on public.social_post_poll_votes;
create trigger social_post_poll_votes_increment_counts
after insert on public.social_post_poll_votes
for each row execute function private.increment_social_poll_vote_counts();

commit;
