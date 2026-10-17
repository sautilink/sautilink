param([string]$Database = 'sautilink_rooms_test_review_20261015', [switch]$Prepare, [switch]$ExpectBug)
$ErrorActionPreference = 'Stop'
if ($Database -notmatch '^sautilink_rooms_test_[a-zA-Z0-9_]+$') { throw 'Isolated local test database required.' }
$repository = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$work = Split-Path $repository -Parent
$runtime = Join-Path $work 'postgres-local/runtime/pgsql/bin/psql.exe'
$generated = Join-Path $work 'generatedtestscope/rooms-sql-review'
New-Item -ItemType Directory -Path $generated -Force | Out-Null
function ExactSql([string]$File, [string]$Pattern) {
    $source = [IO.File]::ReadAllText((Join-Path $repository $File))
    $match = [regex]::Match($source, $Pattern, [Text.RegularExpressions.RegexOptions]::Singleline -bor [Text.RegularExpressions.RegexOptions]::Multiline)
    if (-not $match.Success) { throw "Canonical SQL definition was not found in $File" }
    return $match.Value
}
$canonical = @(
    (ExactSql 'supabase/migrations/20260909034500_enable_rooms_platform.sql' 'create or replace function policy_private\.room_member_role\(.*?\$rooms_role\$;')
    (ExactSql 'supabase/migrations/20260909034500_enable_rooms_platform.sql' 'create or replace function policy_private\.is_room_staff\(.*?\$rooms_staff\$;')
    'revoke all on function policy_private.room_member_role(uuid,uuid),policy_private.is_room_staff(uuid,uuid) from public,anon,authenticated; grant execute on function policy_private.room_member_role(uuid,uuid),policy_private.is_room_staff(uuid,uuid) to authenticated;'
    (ExactSql 'supabase/migrations/20260902112000_enable_phase29_moderation_admin_appeals.sql' 'create or replace function private\.phase29_staff_role\(\).*?\$\$;')
    'revoke all on function private.phase29_staff_role() from public,anon,authenticated; grant execute on function private.phase29_staff_role() to authenticated;'
    (ExactSql 'supabase/migrations/20260901212500_enable_phase26_conversations_threaded_replies.sql' 'create or replace function private\.enforce_phase26_post_insert\(\).*?\$phase26_insert\$;')
    'create trigger enforce_phase26_post_insert before insert on public.social_posts for each row execute function private.enforce_phase26_post_insert();'
    (ExactSql 'supabase/migrations/20260909034500_enable_rooms_platform.sql' 'create or replace function private\.enforce_room_post_permission\(\).*?\$rooms_post_guard\$;')
    'create trigger enforce_room_post_permission before insert or update of circle_id,visibility,author_id on public.social_posts for each row execute function private.enforce_room_post_permission();'
    (ExactSql 'supabase/migrations/20260902112000_enable_phase29_moderation_admin_appeals.sql' 'create policy social_posts_select_phase29_authenticated\b.*?^  \);')
    (ExactSql 'supabase/migrations/20260909034500_enable_rooms_platform.sql' 'create or replace function policy_private\.is_room_member\(.*?\$rooms_member\$;')
    'revoke all on function policy_private.is_room_member(uuid,uuid) from public,anon,authenticated; grant execute on function policy_private.is_room_member(uuid,uuid) to authenticated;'
    (ExactSql 'supabase/migrations/20260909034500_enable_rooms_platform.sql' 'create policy social_circle_members_select_rooms\b.*?;')
    (ExactSql 'supabase/migrations/20260909034500_enable_rooms_platform.sql' 'create policy social_circle_members_delete_rooms\b.*?;')
    (ExactSql 'supabase/migrations/20260909034500_enable_rooms_platform.sql' 'create or replace function private\.enforce_room_member_removal\(\).*?\$rooms_remove_guard\$;')
    'create trigger enforce_room_member_removal before delete on public.social_circle_members for each row execute function private.enforce_room_member_removal();'
)
$canonicalPath = Join-Path $generated 'canonical-production-contracts.sql'
$canonical -join "`n" | Set-Content -LiteralPath $canonicalPath -Encoding utf8
$env:PGPASSWORD = [IO.File]::ReadAllText((Join-Path $work 'postgres-local/local-test-password')).Trim()
try {
    $connection = @('-h','127.0.0.1','-p','55435','-U','roomsqa','-X','-v','ON_ERROR_STOP=1')
    if ($Prepare) {
        & $runtime @connection -d postgres -c "CREATE DATABASE $Database"
        if ($LASTEXITCODE -ne 0) { throw 'Could not create isolated review database.' }
        foreach ($file in @('supabase/tests/rooms-approval-local-bootstrap.sql',
            'supabase/migrations/20261015031151_room_post_approval.sql',
            'supabase/tests/rooms-approval-production-contract-fixture.sql')) {
            & $runtime @connection -d $Database -f (Join-Path $repository $file)
            if ($LASTEXITCODE -ne 0) { throw "Could not load $file" }
        }
        & $runtime @connection -d $Database -f $canonicalPath
        if ($LASTEXITCODE -ne 0) { throw 'Could not load canonical production contracts.' }
        & $runtime @connection -d $Database -f (Join-Path $repository 'supabase/migrations/20260909035000_add_room_member_counts.sql')
        if ($LASTEXITCODE -ne 0) { throw 'Could not load canonical membership count trigger.' }
    }
    & $runtime @connection -d $Database -v ("expect_bug=" + $ExpectBug.IsPresent.ToString().ToLowerInvariant()) `
        -f (Join-Path $PSScriptRoot 'rooms-approval-quote-contract.sql')
    if ($LASTEXITCODE -ne 0) { throw 'Production quote contract checks failed.' }
} finally { Remove-Item Env:PGPASSWORD }
