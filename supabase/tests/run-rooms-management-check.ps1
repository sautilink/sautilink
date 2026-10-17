param([string]$Database='sautilink_rooms_test_management_20261016',[switch]$Prepare,[switch]$BaselineOnly)
$ErrorActionPreference='Stop'
if($Database -notmatch '^sautilink_rooms_test_[a-zA-Z0-9_]+$'){throw 'Isolated local test database required.'}
$repository=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$work=Split-Path $repository -Parent
$runtime=Join-Path $work 'postgres-local/runtime/pgsql/bin/psql.exe'
$generated=Join-Path $work 'generatedtestscope/rooms-management'
New-Item -ItemType Directory -Path $generated -Force | Out-Null
function ExactSql([string]$File,[string]$Pattern){
 $source=[IO.File]::ReadAllText((Join-Path $repository $File))
 $match=[regex]::Match($source,$Pattern,[Text.RegularExpressions.RegexOptions]::Singleline -bor [Text.RegularExpressions.RegexOptions]::Multiline)
 if(-not $match.Success){throw "Canonical SQL not found in $File"};return $match.Value
}
if($Prepare){
 & (Join-Path $PSScriptRoot 'run-rooms-production-contract-check.ps1') -Database $Database -Prepare
 if($LASTEXITCODE -ne 0){throw 'Production post contract fixture failed.'}
}
$env:PGPASSWORD=[IO.File]::ReadAllText((Join-Path $work 'postgres-local/local-test-password')).Trim()
try{
 $connection=@('-h','127.0.0.1','-p','55435','-U','roomsqa','-d',$Database,'-X','-v','ON_ERROR_STOP=1')
 if($Prepare){
  & $runtime @connection -f (Join-Path $PSScriptRoot 'rooms-management-production-fixture.sql')
  if($LASTEXITCODE -ne 0){throw 'Could not extend production fixture.'}
  foreach($file in @('20260909034500_enable_rooms_platform.sql','20260909035500_refine_room_discovery_and_requests.sql','20260909040000_enable_room_invitations.sql','20260909040500_allow_room_reinvites.sql','20260910062500_fix_room_owner_membership_rls.sql')){
   & $runtime @connection -f (Join-Path $repository ('supabase/migrations/'+$file))
   if($LASTEXITCODE -ne 0){throw "Canonical Rooms migration failed: $file"}
  }
  $canonical=@(
   (ExactSql 'supabase/migrations/20260901161000_enable_phase20_circles_mvp.sql' 'create policy social_circle_join_requests_insert_phase20\b.*?;')
   (ExactSql 'supabase/migrations/20260901164000_allow_phase20_circle_request_reentry.sql' 'create policy social_circle_join_requests_delete_phase20\b.*?;')
   (ExactSql 'supabase/migrations/20260901161000_enable_phase20_circles_mvp.sql' 'create or replace function private\.normalize_phase20_circle_join_request\(\).*?\$phase20_request\$;')
   (ExactSql 'supabase/migrations/20260901163000_fix_phase20_circle_approval_security.sql' 'create or replace function private\.apply_phase20_circle_join_approval\(\).*?\$phase20_approval_fix\$;')
   (ExactSql 'supabase/migrations/20260901164000_allow_phase20_circle_request_reentry.sql' 'create or replace function private\.cleanup_phase20_circle_request_after_leave\(\).*?\$phase20_leave_cleanup\$;')
   'revoke all on function private.normalize_phase20_circle_join_request(),private.apply_phase20_circle_join_approval(),private.cleanup_phase20_circle_request_after_leave() from public,anon,authenticated;'
   'create trigger normalize_phase20_circle_join_request before update of status on public.social_circle_join_requests for each row when(old.status is distinct from new.status) execute function private.normalize_phase20_circle_join_request();'
   'create trigger apply_phase20_circle_join_approval after update of status on public.social_circle_join_requests for each row when(old.status is distinct from new.status) execute function private.apply_phase20_circle_join_approval();'
   'create trigger cleanup_phase20_circle_request_after_leave after delete on public.social_circle_members for each row execute function private.cleanup_phase20_circle_request_after_leave();'
   'create trigger ensure_phase20_circle_owner_membership after insert on public.social_circles for each row execute function private.ensure_phase20_circle_owner_membership();'
  )
  $canonicalPath=Join-Path $generated 'canonical-rooms-join-contracts.sql'
  $canonical -join "`n" | Set-Content -LiteralPath $canonicalPath -Encoding utf8
  & $runtime @connection -f $canonicalPath
  if($LASTEXITCODE -ne 0){throw 'Canonical admission contracts failed.'}
  & $runtime @connection -f (Join-Path $PSScriptRoot 'rooms-management-owner-only-baseline.sql')
  if($LASTEXITCODE -ne 0){throw 'Owner-only mismatch was not reproduced.'}
  & $runtime @connection -f (Join-Path $PSScriptRoot 'rooms-management-invitation-baseline.sql')
  if($LASTEXITCODE -ne 0){throw 'Legacy invitation mismatch was not reproduced.'}
 }
 if($BaselineOnly){return}
 & $runtime @connection -f (Join-Path $repository 'supabase/migrations/20261015214652_room_management_completion.sql')
 if($LASTEXITCODE -ne 0){throw 'Management migration failed.'}
 & $runtime @connection -f (Join-Path $PSScriptRoot 'rooms-management-behavior.sql')
 if($LASTEXITCODE -ne 0){throw 'Management behavior checks failed.'}
 & $runtime @connection -f (Join-Path $PSScriptRoot 'rooms-management-authority-limits.sql')
 if($LASTEXITCODE -ne 0){throw 'Management authority/limit checks failed.'}
}finally{Remove-Item Env:PGPASSWORD}
