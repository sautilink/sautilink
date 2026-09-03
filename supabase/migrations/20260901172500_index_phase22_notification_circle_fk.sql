-- Phase 22 performance follow-up: cover the Circle notification foreign key.
create index if not exists social_notifications_circle_id_idx
  on public.social_notifications (circle_id)
  where circle_id is not null;
