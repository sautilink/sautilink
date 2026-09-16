-- Use a portable JSONB object-key count for verification evidence validation.

begin;

create or replace function public.submit_verification_case(
  p_legal_name text,
  p_public_name text,
  p_account_category text,
  p_country text,
  p_social_links jsonb,
  p_article_links jsonb,
  p_reason text,
  p_terms_accepted boolean,
  p_social_proof_confirmed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $verification$
declare
  current_uid uuid := auth.uid();
  profile_row public.social_profiles%rowtype;
  existing_case public.case_records%rowtype;
  latest_rejected public.case_records%rowtype;
  created_case public.case_records%rowtype;
  legal_name text := btrim(coalesce(p_legal_name, ''));
  public_name text := nullif(btrim(coalesce(p_public_name, '')), '');
  account_category text := btrim(coalesce(p_account_category, ''));
  country text := btrim(coalesce(p_country, ''));
  reason text := btrim(coalesce(p_reason, ''));
  social_links jsonb := coalesce(p_social_links, '{}'::jsonb);
  article_links jsonb := coalesce(p_article_links, '[]'::jsonb);
  member_email text;
  applicant_metadata jsonb;
  social_proof_confirmed boolean := false;
  reapply_at timestamptz;
  requested_priority text := 'normal';
begin
  if current_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select * into profile_row
  from public.social_profiles
  where id = current_uid;

  if not found then
    raise exception 'PROFILE_UNAVAILABLE' using errcode = 'P0002';
  end if;

  if profile_row.is_verified then
    raise exception 'ALREADY_VERIFIED' using errcode = '22023';
  end if;

  if char_length(legal_name) not between 2 and 120 then
    raise exception 'LEGAL_NAME_INVALID' using errcode = '22023';
  end if;
  if public_name is not null and char_length(public_name) > 120 then
    raise exception 'PUBLIC_NAME_INVALID' using errcode = '22023';
  end if;
  if char_length(account_category) not between 2 and 100 then
    raise exception 'CATEGORY_INVALID' using errcode = '22023';
  end if;
  if char_length(country) not between 2 and 100 then
    raise exception 'COUNTRY_INVALID' using errcode = '22023';
  end if;
  if char_length(reason) not between 20 and 2000 then
    raise exception 'VERIFICATION_REASON_INVALID' using errcode = '22023';
  end if;
  if p_terms_accepted is distinct from true then
    raise exception 'VERIFICATION_CONSENT_REQUIRED' using errcode = '22023';
  end if;

  if jsonb_typeof(social_links) <> 'object'
     or (select count(*) from jsonb_object_keys(social_links)) > 4 then
    raise exception 'SOCIAL_LINKS_INVALID' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_each_text(social_links) item(key, value)
    where item.key not in ('facebook', 'instagram', 'tiktok', 'youtube')
       or item.value !~* '^https://[^[:space:]]+$'
       or char_length(item.value) > 500
  ) then
    raise exception 'SOCIAL_LINKS_INVALID' using errcode = '22023';
  end if;

  if jsonb_typeof(article_links) <> 'array'
     or jsonb_array_length(article_links) > 5 then
    raise exception 'ARTICLE_LINKS_INVALID' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements_text(article_links) link(value)
    where link.value !~* '^https?://[^[:space:]]+$'
       or char_length(link.value) > 1000
  ) then
    raise exception 'ARTICLE_LINKS_INVALID' using errcode = '22023';
  end if;

  if social_links = '{}'::jsonb and jsonb_array_length(article_links) = 0 then
    raise exception 'VERIFICATION_EVIDENCE_REQUIRED' using errcode = '22023';
  end if;

  social_proof_confirmed := p_social_proof_confirmed is true
    and social_links <> '{}'::jsonb;
  requested_priority := case when social_proof_confirmed then 'high' else 'normal' end;

  select * into existing_case
  from public.case_records
  where category = 'verification'
    and subject_user_id = current_uid
    and status in ('submitted', 'reviewing', 'action_required')
  order by created_at desc
  limit 1
  for update;

  if found then
    if existing_case.status = 'action_required' then
      select email into member_email from auth.users where id = current_uid;

      applicant_metadata := jsonb_build_object(
        'legal_name', legal_name,
        'public_name', public_name,
        'account_category', account_category,
        'country', country,
        'email_snapshot', member_email,
        'username_snapshot', profile_row.username,
        'social_links', social_links,
        'article_links', article_links,
        'verification_reason', reason,
        'terms_accepted', true,
        'privacy_policy_version', '2026-09',
        'terms_version', '2026-09',
        'government_id_requested', false,
        'member_submitted_at', now(),
        'social_proof_link_placed', social_proof_confirmed,
        'social_proof_url', case when social_proof_confirmed then 'https://sautilink.com/verify' else null end,
        'social_proof_claimed_at', case when social_proof_confirmed then now() else null end
      );

      update public.case_records
      set status = 'submitted',
          priority = case when social_proof_confirmed then 'high' else priority end,
          summary = left(reason, 240),
          metadata = (coalesce(existing_case.metadata, '{}'::jsonb) - 'staff_message') || applicant_metadata,
          resolved_at = null,
          updated_at = now()
      where id = existing_case.id
      returning * into existing_case;

      insert into public.case_events (
        case_key, actor_user_id, actor_role, event_type, note, event_payload
      ) values (
        'case:' || existing_case.id::text,
        current_uid,
        'member',
        'verification_information_resubmitted',
        null,
        jsonb_build_object(
          'member_visible', true,
          'social_proof_link_placed', social_proof_confirmed
        )
      );

      return jsonb_build_object(
        'status', 'resubmitted',
        'case_id', existing_case.id,
        'case_number', 'SL-' || to_char(existing_case.created_at at time zone 'UTC', 'YYYY') || '-' || lpad(existing_case.sequence_no::text, 6, '0'),
        'case_status', existing_case.status,
        'priority', existing_case.priority
      );
    end if;

    return jsonb_build_object(
      'status', 'existing',
      'case_id', existing_case.id,
      'case_number', 'SL-' || to_char(existing_case.created_at at time zone 'UTC', 'YYYY') || '-' || lpad(existing_case.sequence_no::text, 6, '0'),
      'case_status', existing_case.status,
      'priority', existing_case.priority
    );
  end if;

  select * into latest_rejected
  from public.case_records
  where category = 'verification'
    and subject_user_id = current_uid
    and status = 'rejected'
  order by coalesce(resolved_at, updated_at) desc, created_at desc
  limit 1
  for update;

  if found then
    reapply_at := coalesce(latest_rejected.resolved_at, latest_rejected.updated_at) + interval '30 days';
    if now() < reapply_at then
      raise exception 'VERIFICATION_REAPPLY_COOLDOWN'
        using errcode = '22023', detail = reapply_at::text;
    end if;
  end if;

  select email into member_email from auth.users where id = current_uid;

  applicant_metadata := jsonb_build_object(
    'legal_name', legal_name,
    'public_name', public_name,
    'account_category', account_category,
    'country', country,
    'email_snapshot', member_email,
    'username_snapshot', profile_row.username,
    'social_links', social_links,
    'article_links', article_links,
    'verification_reason', reason,
    'terms_accepted', true,
    'privacy_policy_version', '2026-09',
    'terms_version', '2026-09',
    'government_id_requested', false,
    'member_submitted_at', now(),
    'social_proof_link_placed', social_proof_confirmed,
    'social_proof_url', case when social_proof_confirmed then 'https://sautilink.com/verify' else null end,
    'social_proof_claimed_at', case when social_proof_confirmed then now() else null end
  );

  insert into public.case_records (
    category,
    status,
    priority,
    submitter_id,
    subject_user_id,
    title,
    summary,
    metadata
  ) values (
    'verification',
    'submitted',
    requested_priority,
    current_uid,
    current_uid,
    'Verification request',
    left(reason, 240),
    applicant_metadata
  )
  returning * into created_case;

  insert into public.case_events (
    case_key, actor_user_id, actor_role, event_type, note, event_payload
  ) values (
    'case:' || created_case.id::text,
    current_uid,
    'member',
    'verification_request_submitted',
    null,
    jsonb_build_object(
      'member_visible', true,
      'social_proof_link_placed', social_proof_confirmed
    )
  );

  return jsonb_build_object(
    'status', 'submitted',
    'case_id', created_case.id,
    'case_number', 'SL-' || to_char(created_case.created_at at time zone 'UTC', 'YYYY') || '-' || lpad(created_case.sequence_no::text, 6, '0'),
    'case_status', created_case.status,
    'priority', created_case.priority
  );
exception
  when unique_violation then
    select * into existing_case
    from public.case_records
    where category = 'verification'
      and subject_user_id = current_uid
      and status in ('submitted', 'reviewing', 'action_required')
    order by created_at desc
    limit 1;

    if not found then
      raise;
    end if;

    return jsonb_build_object(
      'status', 'existing',
      'case_id', existing_case.id,
      'case_number', 'SL-' || to_char(existing_case.created_at at time zone 'UTC', 'YYYY') || '-' || lpad(existing_case.sequence_no::text, 6, '0'),
      'case_status', existing_case.status,
      'priority', existing_case.priority
    );
end;
$verification$;

revoke all on function public.submit_verification_case(
  text, text, text, text, jsonb, jsonb, text, boolean, boolean
) from public, anon, authenticated;
grant execute on function public.submit_verification_case(
  text, text, text, text, jsonb, jsonb, text, boolean, boolean
) to authenticated;

commit;
