-- Count one meaningful authenticated viewer per post while keeping metrics private to the creator.

begin;

create table if not exists public.social_post_views (
  post_id uuid not null references public.social_posts(id) on delete cascade,
  viewer_id uuid not null references public.social_profiles(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (post_id, viewer_id)
);

create index if not exists social_post_views_viewer_idx
  on public.social_post_views (viewer_id, viewed_at desc);

alter table public.social_post_views enable row level security;
alter table public.social_post_views force row level security;

revoke all on table public.social_post_views from public, anon, authenticated;
grant insert on table public.social_post_views to authenticated;
grant select, insert, update, delete on table public.social_post_views to service_role;

drop policy if exists social_post_views_insert_meaningful on public.social_post_views;
create policy social_post_views_insert_meaningful
  on public.social_post_views for insert to authenticated
  with check (
    viewer_id = (select auth.uid())
    and exists (
      select 1
      from public.social_posts post
      where post.id = post_id
        and post.author_id <> (select auth.uid())
    )
  );

create table if not exists public.social_post_metrics (
  post_id uuid primary key references public.social_posts(id) on delete cascade,
  view_count bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint social_post_metrics_view_count_nonnegative check (view_count >= 0)
);

alter table public.social_post_metrics enable row level security;
alter table public.social_post_metrics force row level security;

revoke all on table public.social_post_metrics from public, anon, authenticated;
grant select on table public.social_post_metrics to authenticated;
grant select, insert, update, delete on table public.social_post_metrics to service_role;

drop policy if exists social_post_metrics_select_creator on public.social_post_metrics;
create policy social_post_metrics_select_creator
  on public.social_post_metrics for select to authenticated
  using (
    exists (
      select 1
      from public.social_posts post
      where post.id = post_id
        and post.author_id = (select auth.uid())
    )
  );

create or replace function private.increment_social_post_view_metric()
returns trigger
language plpgsql
security definer
set search_path = ''
as $post_view_metric$
begin
  insert into public.social_post_metrics (post_id, view_count, updated_at)
  values (new.post_id, 1, now())
  on conflict (post_id) do update
    set view_count = public.social_post_metrics.view_count + 1,
        updated_at = now();
  return new;
end;
$post_view_metric$;

revoke all on function private.increment_social_post_view_metric() from public, anon, authenticated;

drop trigger if exists increment_social_post_view_metric on public.social_post_views;
create trigger increment_social_post_view_metric
after insert on public.social_post_views
for each row execute function private.increment_social_post_view_metric();

create or replace function public.record_social_post_view(target_post_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $record_post_view$
declare
  inserted_rows integer := 0;
begin
  if (select auth.uid()) is null then
    return false;
  end if;

  insert into public.social_post_views (post_id, viewer_id)
  values (target_post_id, (select auth.uid()))
  on conflict (post_id, viewer_id) do nothing;

  get diagnostics inserted_rows = row_count;
  return inserted_rows > 0;
end;
$record_post_view$;

revoke all on function public.record_social_post_view(uuid) from public, anon;
grant execute on function public.record_social_post_view(uuid) to authenticated, service_role;

comment on table public.social_post_views is
  'Unique authenticated member views of social posts. One member can count at most once per post.';
comment on table public.social_post_metrics is
  'Creator-only post metrics derived from unique social_post_views rows.';
comment on function public.record_social_post_view(uuid) is
  'Records one unique authenticated non-author view when RLS confirms the viewer can access the post.';

commit;
