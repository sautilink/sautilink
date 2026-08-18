create policy "waitlist_members_deny_anon"
on public.waitlist_members
for all
to anon
using (false)
with check (false);

create policy "waitlist_members_deny_authenticated"
on public.waitlist_members
for all
to authenticated
using (false)
with check (false);

