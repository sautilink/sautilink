-- Phase 25 follow-up: make the reply-permission policy the sole
-- authenticated INSERT policy for comments.
--
-- Phase 18 had left a broader permissive INSERT policy. PostgreSQL combines
-- permissive policies with OR, so that older policy would bypass the new reply
-- controls unless removed.

drop policy if exists social_post_comments_insert_phase18
  on public.social_post_comments;

comment on policy social_post_comments_insert_phase25_own
  on public.social_post_comments is
  'Phase 25 sole authenticated comment INSERT policy. Enforces visible-post access plus Sauti reply permissions.';
