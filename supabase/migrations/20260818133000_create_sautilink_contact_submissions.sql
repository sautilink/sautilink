create table if not exists public.contact_submissions (
    id bigint generated always as identity primary key,
    name text not null check (char_length(btrim(name)) between 2 and 100),
    email text not null check (char_length(email) between 5 and 254),
    topic text not null check (topic in ('general', 'support', 'privacy', 'partnership', 'media')),
    subject text check (subject is null or char_length(subject) <= 140),
    message text not null check (char_length(btrim(message)) between 10 and 3000),
    status text not null default 'new' check (status in ('new', 'reviewing', 'resolved', 'spam')),
    source text not null default 'sautilink.com/contact' check (char_length(source) between 1 and 80),
    request_fingerprint text not null check (char_length(request_fingerprint) = 64),
    created_at timestamptz not null default now()
);

comment on table public.contact_submissions is
    'Messages submitted through the SautiLink-managed contact form. Server-side access only.';
comment on column public.contact_submissions.request_fingerprint is
    'HMAC-SHA256 network fingerprint used only for abuse-rate limiting; raw IP addresses are not stored.';

create index if not exists contact_submissions_created_at_idx
    on public.contact_submissions (created_at desc);
create index if not exists contact_submissions_rate_limit_idx
    on public.contact_submissions (request_fingerprint, created_at desc);

alter table public.contact_submissions enable row level security;
alter table public.contact_submissions force row level security;

revoke all on table public.contact_submissions from anon, authenticated;
revoke all on sequence public.contact_submissions_id_seq from anon, authenticated;
grant all on table public.contact_submissions to service_role;
grant usage, select on sequence public.contact_submissions_id_seq to service_role;

create policy "deny public contact reads"
    on public.contact_submissions for select to anon, authenticated using (false);
create policy "deny public contact inserts"
    on public.contact_submissions for insert to anon, authenticated with check (false);
create policy "deny public contact updates"
    on public.contact_submissions for update to anon, authenticated using (false) with check (false);
create policy "deny public contact deletes"
    on public.contact_submissions for delete to anon, authenticated using (false);
