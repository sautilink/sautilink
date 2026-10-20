-- Room metadata must never grant access to another object namespace in the
-- shared media bucket. The Worker enforces the same gate before delivery and
-- cleanup; this constraint also protects direct authenticated Data API writes.
begin;

alter table public.social_circles
  add constraint social_circles_cover_key_scope
  check (
    cover_key is null
    or cover_key ~ (
      '^rooms/' || id::text ||
      '/cover/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
    )
  ) not valid;

-- Repair only invalid metadata pointers. Never delete or rename the referenced
-- R2 object: it may belong to another Room, profile, post or private message.
-- Canonical existing uploads are preserved byte-for-byte and are not updated.
update public.social_circles
set cover_key = null
where cover_key is not null
  and cover_key !~ (
    '^rooms/' || id::text ||
    '/cover/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
  );

alter table public.social_circles
  validate constraint social_circles_cover_key_scope;

comment on constraint social_circles_cover_key_scope on public.social_circles is
  'A cover key must be a canonical JPEG, PNG or WebP object inside this exact Room UUID namespace; null means no cover.';

commit;
