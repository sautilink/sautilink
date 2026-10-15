param([string]$Database='sautilink_rooms_test_review_20261015', [switch]$ExpectBug,
  [ValidateSet('author','staff')][string]$Subject='author')
$ErrorActionPreference='Stop'
if($Database -notmatch '^sautilink_rooms_test_[a-zA-Z0-9_]+$'){throw 'Isolated test database required.'}
$repository=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$work=Split-Path $repository -Parent
$runtime=Join-Path $work 'postgres-local/runtime/pgsql/bin/psql.exe'
$env:PGPASSWORD=[IO.File]::ReadAllText((Join-Path $work 'postgres-local/local-test-password')).Trim()
try {
  $connection=@('-h','127.0.0.1','-p','55435','-U','roomsqa','-d',$Database,'-X','-v','ON_ERROR_STOP=1')
  & $runtime @connection -f (Join-Path $PSScriptRoot 'rooms-approval-membership-race-setup.sql')
  if($LASTEXITCODE -ne 0){throw 'Could not prepare membership race.'}
  function BeginPsql([string]$File) {
    $start=[Diagnostics.ProcessStartInfo]::new()
    $start.FileName=$runtime; $start.UseShellExecute=$false; $start.CreateNoWindow=$true
    $start.RedirectStandardOutput=$true; $start.RedirectStandardError=$true
    foreach($argument in ($connection + @('-f',(Join-Path $PSScriptRoot $File)))){$start.ArgumentList.Add($argument)}
    $process=[Diagnostics.Process]::new();$process.StartInfo=$start
    if(-not $process.Start()){throw 'Could not start isolated SQL race process.'}
    return $process
  }
  $processA=BeginPsql 'rooms-approval-membership-race-a.sql'
  $sleeping=$false
  for($attempt=0;$attempt -lt 30;$attempt++) {
    $state=& $runtime @connection -tA -c "select count(*) from pg_stat_activity where application_name='rooms-production-contract-race-a' and wait_event='PgSleep'"
    if($state.Trim() -eq '1'){$sleeping=$true;break}
    Start-Sleep -Milliseconds 50
  }
  if(-not $sleeping){throw 'Race A never reached its actual Room-lock pause.'}
  $processB=BeginPsql $(if($Subject -eq 'staff'){'rooms-approval-membership-race-staff-b.sql'}else{'rooms-approval-membership-race-b.sql'})
  if(-not $processA.WaitForExit(15000) -or -not $processB.WaitForExit(15000)){throw 'Bounded local SQL race timed out.'}
  $aOut=$processA.StandardOutput.ReadToEnd()+$processA.StandardError.ReadToEnd()
  $bOut=$processB.StandardOutput.ReadToEnd()+$processB.StandardError.ReadToEnd()
  Write-Output $aOut;Write-Output $bOut
  $deadlock=($aOut+$bOut) -match 'deadlock detected'
  if($ExpectBug) {
    if(-not $deadlock){throw 'Expected full-schema member-count deadlock was not reproduced.'}
    Write-Output 'REPRODUCED: existing member-count trigger and approval Room lock form a deadlock.'
  } else {
    if($deadlock -or $processB.ExitCode -ne 0){throw 'Membership removal must commit without deadlock.'}
    $expectedError=if($Subject -eq 'staff'){'ROOM_STAFF_REQUIRED'}else{'AUTHOR_NO_LONGER_ALLOWED'}
    if($processA.ExitCode -eq 0 -or $aOut -notmatch $expectedError){throw 'Approval after committed removal was not rejected truthfully.'}
    $removedId=if($Subject -eq 'staff'){'a1000000-0000-4000-8000-000000000002'}else{'a1000000-0000-4000-8000-000000000003'}
    $check=& $runtime @connection -tA -c "select (select count(*) from public.social_circle_members where circle_id='a2000000-0000-4000-8000-000000000001' and member_id='$removedId')::text || ':' || (select count(*) from public.social_posts where body='Membership race fixture')::text || ':' || (select state from private.room_post_submissions where client_request_id='a4000000-0000-4000-8000-000000000001')"
    if($check.Trim() -ne '0:0:pending'){throw "Unexpected membership race outcome: $check"}
    Write-Output "PASS: $Subject membership removal commits; stale approval rejects; no post/deadlock and pending state preserved."
  }
} finally {Remove-Item Env:PGPASSWORD}
