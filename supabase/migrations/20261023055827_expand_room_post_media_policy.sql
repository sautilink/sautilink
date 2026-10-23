-- Align the existing private Room approval queue with the ten-attachment post
-- contract. No new privilege, publication path, media ownership or Room rule.
begin;

-- Fail closed if the reviewed live RPC has changed. Recreate only its existing
-- definition with two numeric bounds changed; CREATE OR REPLACE preserves its
-- owner, grants, defaults, security-definer behavior and empty search_path.
do $$
declare
  target oid := 'public.room_submit_post_for_review(uuid,uuid,text,text,uuid,jsonb)'::regprocedure;
  definition text;
  definition_md5 text;
  queue_check text;
  position_check text;
begin
  select md5(pg_get_functiondef(oid)), pg_get_functiondef(oid) into definition_md5, definition
    from pg_proc where oid = target and prosecdef
      and proconfig = array['search_path=""'];
  if definition_md5 is distinct from '44e6612d77c8264038f5013014442825' then
    raise exception 'ROOM_POST_MEDIA_FUNCTION_DRIFT';
  end if;
  select pg_get_constraintdef(oid) into queue_check from pg_constraint
    where conrelid = 'private.room_post_submissions'::regclass
      and conname = 'room_post_submissions_media_count_check' and contype = 'c' and convalidated;
  select pg_get_constraintdef(oid) into position_check from pg_constraint
    where conrelid = 'private.room_post_submission_media'::regclass
      and conname = 'room_post_submission_media_position_check' and contype = 'c' and convalidated;
  if queue_check is distinct from 'CHECK (((media_count >= 0) AND (media_count <= 5)))'
      or position_check is distinct from 'CHECK ((("position" >= 0) AND ("position" <= 4)))' then
    raise exception 'ROOM_POST_MEDIA_CONSTRAINT_DRIFT';
  end if;
  definition := replace(definition, 'jsonb_array_length(p_media)>5', 'jsonb_array_length(p_media)>10');
  definition := replace(definition, 'if n>4 and exists', 'if n>10 and exists');
  execute definition;
end;
$$;

alter table private.room_post_submissions
  drop constraint room_post_submissions_media_count_check,
  add constraint room_post_submissions_media_count_check check (media_count between 0 and 10);
alter table private.room_post_submission_media
  drop constraint room_post_submission_media_position_check,
  add constraint room_post_submission_media_position_check check (position between 0 and 9);

commit;
