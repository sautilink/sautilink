param([string]$Database='sautilink_rooms_test_review_final_20261015')
$ErrorActionPreference='Stop'
if($Database -notmatch '^sautilink_rooms_test_[a-zA-Z0-9_]+$'){throw 'Isolated local test database required.'}
$repository=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$work=Split-Path $repository -Parent
$runtime=Join-Path $work 'postgres-local/runtime/pgsql/bin/psql.exe'
$env:PGPASSWORD=[IO.File]::ReadAllText((Join-Path $work 'postgres-local/local-test-password')).Trim()
try {
  $connection=@('-h','127.0.0.1','-p','55435','-U','roomsqa','-d',$Database,'-X','-v','ON_ERROR_STOP=1')
  & $runtime @connection -f (Join-Path $PSScriptRoot 'rooms-approval-authority-contract.sql')
  if($LASTEXITCODE -ne 0){throw 'Production authority checks failed.'}
  $start=[Diagnostics.ProcessStartInfo]::new();$start.FileName=$runtime;$start.UseShellExecute=$false;$start.CreateNoWindow=$true
  $start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
  $sql="set application_name='rooms-production-delete-lock'; begin; select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true); select (private.room_approval_room('a2000000-0000-4000-8000-000000000001')).id; select pg_sleep(3); rollback;"
  foreach($argument in ($connection+@('-c',$sql))){$start.ArgumentList.Add($argument)}
  $locker=[Diagnostics.Process]::new();$locker.StartInfo=$start
  if(-not $locker.Start()){throw 'Could not start isolated Room lock check.'}
  $ready=$false
  for($attempt=0;$attempt -lt 40;$attempt++){
    $state=& $runtime @connection -tA -c "select count(*) from pg_stat_activity where application_name='rooms-production-delete-lock' and wait_event='PgSleep'"
    if($state.Trim() -eq '1'){$ready=$true;break};Start-Sleep -Milliseconds 50
  }
  if(-not $ready){throw 'Actual Room lock was not observed.'}
  # Always roll back, even if the DELETE unexpectedly succeeds. A psql error also
  # closes its connection and rolls the transaction back; no fixture is removed.
  $deletion=& $runtime @connection -c "begin; set local lock_timeout='250ms'; delete from public.social_circles where id='a2000000-0000-4000-8000-000000000001'; rollback;" 2>&1
  $deletionExit=$LASTEXITCODE
  if(-not $locker.WaitForExit(10000)){throw 'Room lock check timed out.'}
  $lockOutput=$locker.StandardOutput.ReadToEnd()+$locker.StandardError.ReadToEnd()
  Write-Output $lockOutput;Write-Output $deletion
  if($locker.ExitCode -ne 0 -or $deletionExit -eq 0 -or ($deletion -join "`n") -notmatch 'lock timeout'){
    throw 'Room KEY SHARE failed to serialize actual concurrent deletion.'
  }
  $remaining=& $runtime @connection -tA -c "select count(*) from public.social_circles where id='a2000000-0000-4000-8000-000000000001'"
  if($remaining.Trim() -ne '1'){throw 'Synthetic Room was unexpectedly removed.'}
  Write-Output 'PASS: actual concurrent Room DELETE waits for approval KEY SHARE; timeout rolls back and Room remains.'
} finally {Remove-Item Env:PGPASSWORD}
