param([string]$Database='sautilink_rooms_test_review_fixed_20261015')
$ErrorActionPreference='Stop'
if($Database -notmatch '^sautilink_rooms_test_[a-zA-Z0-9_]+$'){throw 'Isolated test database required.'}
$repository=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$work=Split-Path $repository -Parent
$runtime=Join-Path $work 'postgres-local/runtime/pgsql/bin/psql.exe'
$env:PGPASSWORD=[IO.File]::ReadAllText((Join-Path $work 'postgres-local/local-test-password')).Trim()
try {
 $connection=@('-h','127.0.0.1','-p','55435','-U','roomsqa','-d',$Database,'-X','-v','ON_ERROR_STOP=1')
 & $runtime @connection -c 'grant update(post_permission) on public.social_circles to authenticated'
 & $runtime @connection -f (Join-Path $PSScriptRoot 'rooms-approval-membership-race-setup.sql')
 if($LASTEXITCODE -ne 0){throw 'Could not prepare policy race.'}
 function BeginPsql([string]$File){
  $start=[Diagnostics.ProcessStartInfo]::new();$start.FileName=$runtime;$start.UseShellExecute=$false;$start.CreateNoWindow=$true
  $start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
  foreach($argument in ($connection+@('-f',(Join-Path $PSScriptRoot $File)))){$start.ArgumentList.Add($argument)}
  $process=[Diagnostics.Process]::new();$process.StartInfo=$start
  if(-not $process.Start()){throw 'Could not start isolated SQL process.'};return $process
 }
 function WaitState([string]$Name,[string]$Predicate){
  for($attempt=0;$attempt -lt 40;$attempt++){
   $state=& $runtime @connection -tA -c "select count(*) from pg_stat_activity where application_name='$Name' and $Predicate"
   if($state.Trim() -eq '1'){return};Start-Sleep -Milliseconds 50
  };throw "SQL session did not reach expected state: $Name"
 }
 $locker=BeginPsql 'rooms-approval-policy-race-locker.sql'
 WaitState 'rooms-production-policy-locker' "wait_event='PgSleep'"
 $approval=BeginPsql 'rooms-approval-policy-race-a.sql'
 WaitState 'rooms-production-policy-approval' "wait_event_type='Lock'"
 & $runtime @connection -f (Join-Path $PSScriptRoot 'rooms-approval-policy-race-b.sql')
 if($LASTEXITCODE -ne 0){throw 'Owner metadata change did not commit.'}
 if(-not $locker.WaitForExit(15000) -or -not $approval.WaitForExit(15000)){throw 'Policy race timed out.'}
 $lockOutput=$locker.StandardOutput.ReadToEnd()+$locker.StandardError.ReadToEnd()
 $approvalOutput=$approval.StandardOutput.ReadToEnd()+$approval.StandardError.ReadToEnd()
 Write-Output $lockOutput;Write-Output $approvalOutput
 if($locker.ExitCode -ne 0 -or $approval.ExitCode -eq 0 -or $approvalOutput -notmatch 'ROOM_POSTING_RESTRICTED' -or
   ($lockOutput+$approvalOutput) -match 'deadlock detected'){throw 'Canonical posting-permission trigger did not reject stale policy snapshot.'}
 $state=& $runtime @connection -tA -c "select (select count(*) from public.social_posts where body='Membership race fixture')::text||':'||(select state from private.room_post_submissions where client_request_id='a4000000-0000-4000-8000-000000000001')"
 if($state.Trim() -ne '0:pending'){throw "Unexpected policy race outcome: $state"}
 Write-Output 'PASS: concurrent staff-only setting commits; canonical insert trigger rejects stale approval; pending/no post preserved.'
} finally {Remove-Item Env:PGPASSWORD}
