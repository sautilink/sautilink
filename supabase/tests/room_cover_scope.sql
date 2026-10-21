-- Local-only synthetic constraint regression. No rows are copied from the
-- source table and all fixtures roll back. LIKE copies the actual deployed
-- CHECK constraints, rather than restating their implementation in this test.
begin;

create temporary table room_cover_scope_fixture
  (like public.social_circles including defaults including constraints);

create function pg_temp.expect_room_cover_scope_check(statement text)
returns void language plpgsql security invoker as $$
declare denied boolean := false; failed_constraint text;
begin
  begin
    execute statement;
  exception when check_violation then
    get stacked diagnostics failed_constraint = constraint_name;
    if failed_constraint <> 'social_circles_cover_key_scope' then raise; end if;
    denied := true;
  end;
  if not denied then raise exception 'EXPECTED_ROOM_COVER_SCOPE_CHECK'; end if;
end;
$$;

insert into room_cover_scope_fixture (id, owner_id, slug, name, cover_key)
values (
  '71000000-0000-4000-8000-000000000002',
  '71000000-0000-4000-8000-000000000001',
  'cover-scope-fixture', 'Cover Scope Fixture', null
);

do $$
declare
  own_room uuid := '71000000-0000-4000-8000-000000000002';
  other_room uuid := '71000000-0000-4000-8000-000000000003';
  object_id uuid := '71000000-0000-4000-8000-000000000004';
  key text;
  extension text;
  new_room uuid;
begin
  -- Existing real upload formats and an empty cover remain accepted on both
  -- INSERT and UPDATE. The ownership/path UUID must agree with the row.
  foreach extension in array array['jpg', 'png', 'webp'] loop
    key := 'rooms/' || own_room::text || '/cover/' || object_id::text || '.' || extension;
    update room_cover_scope_fixture set cover_key = key where id = own_room;

    new_room := gen_random_uuid();
    insert into room_cover_scope_fixture (id, owner_id, slug, name, cover_key)
    values (new_room, '71000000-0000-4000-8000-000000000001',
            'cover-insert-' || extension, 'Cover Insert Fixture',
            'rooms/' || new_room::text || '/cover/' || object_id::text || '.' || extension);
  end loop;
  update room_cover_scope_fixture set cover_key = null where id = own_room;

  foreach key in array array[
    'profiles/71000000-0000-4000-8000-000000000001/avatar/' || object_id::text || '.jpg',
    'dm/' || own_room::text || '/71000000-0000-4000-8000-000000000001/' || object_id::text || '.jpg',
    'sauti/71000000-0000-4000-8000-000000000001/' || object_id::text || '.jpg',
    'rooms/' || other_room::text || '/cover/' || object_id::text || '.jpg',
    'rooms/' || own_room::text || '/cover/../' || object_id::text || '.jpg',
    'rooms/' || own_room::text || '/cover/' || object_id::text || '.svg',
    'rooms/' || own_room::text || '/cover/' || object_id::text || '.jpg?extra=1',
    'rooms/' || own_room::text || '/cover/' || object_id::text || '.jpg' || chr(10),
    'rooms/' || own_room::text || '/cover/not-a-uuid.jpg'
  ] loop
    perform pg_temp.expect_room_cover_scope_check(format(
      'update room_cover_scope_fixture set cover_key = %L where id = %L::uuid', key, own_room
    ));
    perform pg_temp.expect_room_cover_scope_check(format(
      'insert into room_cover_scope_fixture (id, owner_id, slug, name, cover_key) values (%L::uuid, %L::uuid, %L, %L, %L)',
      own_room, '71000000-0000-4000-8000-000000000001', 'invalid-cover-fixture', 'Invalid Cover Fixture', key
    ));
  end loop;

  if (select count(*) from room_cover_scope_fixture) <> 4 then
    raise exception 'ROOM_COVER_SCOPE_REJECTED_INSERT_PERSISTED';
  end if;
end;
$$;

rollback;
