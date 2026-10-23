-- Typed verification requests use server-derived badge classes, never staff roles.
begin;
-- Preserve the established lifecycle/consent/cooldown implementation privately.
-- There is one public RPC signature, with defaults for all legacy callers.
alter function public.submit_verification_case(text,text,text,text,jsonb,jsonb,text,boolean,boolean)
  set schema private;
alter function private.submit_verification_case(text,text,text,text,jsonb,jsonb,text,boolean,boolean)
  rename to submit_verification_case_legacy_v1;
revoke all on function private.submit_verification_case_legacy_v1(text,text,text,text,jsonb,jsonb,text,boolean,boolean)
  from public, anon, authenticated;
-- An older eight-argument overload must not compete with the new defaults.
drop function if exists public.submit_verification_case(text,text,text,text,jsonb,jsonb,text,boolean);

create function private.submit_verification_case_typed_v1(
  p_legal_name text, p_public_name text, p_account_category text, p_country text,
  p_social_links jsonb, p_article_links jsonb, p_reason text, p_terms_accepted boolean,
  p_social_proof_confirmed boolean default false, p_account_type text default 'individual'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  current_uid uuid := auth.uid();
  account_type text := lower(btrim(coalesce(p_account_type,'')));
  result jsonb;
begin
  if current_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if account_type not in ('individual','business','brand','entity','organisation') then
    raise exception 'VERIFICATION_ACCOUNT_TYPE_INVALID' using errcode = '22023';
  end if;
  if account_type <> 'individual' and (p_article_links is null or jsonb_typeof(p_article_links) <> 'array') then
    raise exception 'VERIFICATION_ARTICLE_REQUIRED' using errcode = '22023';
  end if;
  if account_type <> 'individual' and jsonb_array_length(p_article_links) = 0 then
    raise exception 'VERIFICATION_ARTICLE_REQUIRED' using errcode = '22023';
  end if;
  -- URL syntax/count, legal name, consent, evidence and cooldown remain enforced
  -- by the original owner-bound lifecycle helper before anything is stored.
  result := private.submit_verification_case_legacy_v1(p_legal_name,p_public_name,p_account_category,p_country,
    p_social_links,p_article_links,p_reason,p_terms_accepted,p_social_proof_confirmed);
  if result ->> 'status' in ('submitted','resubmitted') then
    update public.case_records set metadata = metadata || jsonb_build_object(
      'account_type',account_type,'requested_badge_type',case when account_type='individual' then 'standard' else 'team' end)
    where id = (result ->> 'case_id')::uuid and subject_user_id = current_uid and category='verification';
  end if;
  return result;
end $$;
revoke all on function private.submit_verification_case_typed_v1(text,text,text,text,jsonb,jsonb,text,boolean,boolean,text)
  from public, anon, authenticated;
grant execute on function private.submit_verification_case_typed_v1(text,text,text,text,jsonb,jsonb,text,boolean,boolean,text) to authenticated;

create function public.submit_verification_case(
  p_legal_name text, p_public_name text, p_account_category text, p_country text,
  p_social_links jsonb, p_article_links jsonb, p_reason text, p_terms_accepted boolean,
  p_social_proof_confirmed boolean default false, p_account_type text default 'individual'
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.submit_verification_case_typed_v1(p_legal_name,p_public_name,p_account_category,p_country,
    p_social_links,p_article_links,p_reason,p_terms_accepted,p_social_proof_confirmed,p_account_type);
$$;
revoke all on function public.submit_verification_case(text,text,text,text,jsonb,jsonb,text,boolean,boolean,text) from public, anon, authenticated;
grant execute on function public.submit_verification_case(text,text,text,text,jsonb,jsonb,text,boolean,boolean,text) to authenticated;

CREATE OR REPLACE FUNCTION private.set_social_verification_privileged_v2(p_username text, p_verified boolean, p_badge_type text DEFAULT NULL::text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  current_uid uuid := auth.uid();
  staff_role text := private.phase29_staff_role();
  normalized_username text := lower(btrim(coalesce(p_username, '')));
  requested_badge_type text := nullif(lower(btrim(coalesce(p_badge_type, ''))), '');
  reason text := nullif(btrim(coalesce(p_reason, '')), '');
  profile_row public.social_profiles%rowtype;
  next_badge_type text;
  application_type text;
begin
  if current_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if staff_role is distinct from 'senior_reviewer' then
    raise exception 'VERIFICATION_ADMIN_REQUIRED' using errcode = '42501';
  end if;

  if p_verified is null then
    raise exception 'VERIFICATION_STATE_REQUIRED' using errcode = '22023';
  end if;

  if normalized_username !~ '^[a-z0-9][a-z0-9._]{2,29}$' then
    raise exception 'USERNAME_INVALID' using errcode = '22023';
  end if;

  if reason is not null and char_length(reason) > 500 then
    raise exception 'VERIFICATION_REASON_TOO_LONG' using errcode = '22023';
  end if;

  select *
  into profile_row
  from public.social_profiles
  where username = normalized_username
  for update;

  if not found then
    raise exception 'PROFILE_UNAVAILABLE' using errcode = 'P0002';
  end if;

  if p_verified then
    next_badge_type := coalesce(
      requested_badge_type,
      case when profile_row.is_verified then profile_row.verification_badge_type else 'standard' end
    );
  else
    next_badge_type := 'standard';
  end if;

  if next_badge_type <> all (array['standard'::text, 'team'::text]) then
    raise exception 'VERIFICATION_BADGE_TYPE_INVALID' using errcode = '22023';
  end if;

  -- Only a new typed application determines a new grant's badge. Legacy cases
  -- and already verified accounts retain the existing staff review behavior.
  if p_verified and not profile_row.is_verified then
    select item.metadata ->> 'account_type' into application_type
    from public.case_records item
    where item.category = 'verification' and item.subject_user_id = profile_row.id
      and item.status in ('submitted', 'reviewing', 'action_required', 'approved')
      and not exists (select 1 from private.social_verification_removal_receipts receipt
        where receipt.user_id = profile_row.id and receipt.completed_at is not null
          and item.id = any(receipt.retired_case_ids))
    order by item.created_at desc, item.id desc limit 1;
    if application_type = 'individual' then next_badge_type := 'standard';
    elsif application_type in ('business','brand','entity','organisation') then next_badge_type := 'team';
    end if;
  end if;

  if profile_row.is_verified = p_verified
     and profile_row.verification_badge_type = next_badge_type then
    return jsonb_build_object(
      'status', 'unchanged',
      'user_id', profile_row.id,
      'username', profile_row.username,
      'is_verified', profile_row.is_verified,
      'badge_type', profile_row.verification_badge_type
    );
  end if;

  update public.social_profiles
  set
    is_verified = p_verified,
    verification_badge_type = next_badge_type,
    updated_at = now()
  where id = profile_row.id;

  insert into private.social_verification_events (
    user_id,
    username_snapshot,
    previous_verified,
    new_verified,
    previous_badge_type,
    new_badge_type,
    source,
    actor_id,
    actor_role,
    reason
  )
  values (
    profile_row.id,
    profile_row.username,
    profile_row.is_verified,
    p_verified,
    profile_row.verification_badge_type,
    next_badge_type,
    'staff',
    current_uid,
    staff_role,
    reason
  );

  return jsonb_build_object(
    'status', case
      when not p_verified then 'unverified'
      when next_badge_type = 'team' then 'verified_team'
      else 'verified'
    end,
    'user_id', profile_row.id,
    'username', profile_row.username,
    'is_verified', p_verified,
    'badge_type', next_badge_type
  );
end;
$function$;


commit;
