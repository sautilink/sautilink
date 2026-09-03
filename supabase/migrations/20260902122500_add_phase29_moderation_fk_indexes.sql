-- Phase 29 follow-up — cover moderation foreign keys flagged by the staging advisor.
-- Keeps report/appeal/audit cleanup and joins efficient as moderation volume grows.

create index if not exists social_reports_phase29_target_owner_idx
  on public.social_reports (target_owner_id)
  where target_owner_id is not null;

create index if not exists social_moderation_actions_phase29_appeal_idx
  on public.social_moderation_actions (appeal_id)
  where appeal_id is not null;

create index if not exists social_moderation_appeals_phase29_appellant_idx
  on public.social_moderation_appeals (appellant_id, created_at desc, id desc);

create index if not exists social_moderation_appeals_phase29_assigned_idx
  on public.social_moderation_appeals (assigned_to, appeal_status, created_at, id)
  where assigned_to is not null;

create index if not exists social_moderation_audit_phase29_report_idx
  on public.social_moderation_audit (report_id)
  where report_id is not null;

create index if not exists social_moderation_audit_phase29_action_idx
  on public.social_moderation_audit (action_id)
  where action_id is not null;

create index if not exists social_moderation_audit_phase29_appeal_idx
  on public.social_moderation_audit (appeal_id)
  where appeal_id is not null;

create index if not exists social_moderation_audit_phase29_actor_idx
  on public.social_moderation_audit (actor_id, created_at desc, id desc)
  where actor_id is not null;
