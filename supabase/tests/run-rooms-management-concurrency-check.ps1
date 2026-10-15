param([string]$Database='sautilink_rooms_test_management_final3_20261016')
$ErrorActionPreference='Stop'
if($Database -notmatch '^sautilink_rooms_test_[a-zA-Z0-9_]+$'){throw 'Isolated local test database required.'}
$repository=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$work=Split-Path $repository -Parent
$runtime=Join-Path $work 'postgres-local/runtime/pgsql/bin/psql.exe'
$generated=Join-Path $work 'generatedtestscope/rooms-management'
New-Item -ItemType Directory -Path $generated -Force | Out-Null
$env:PGPASSWORD=[IO.File]::ReadAllText((Join-Path $work 'postgres-local/local-test-password')).Trim()
try{
 $connection=@('-h','127.0.0.1','-p','55435','-U','roomsqa','-d',$Database,'-X','-v','ON_ERROR_STOP=1')
 function Query([string]$Sql){
  $value=& $runtime @connection -tA -c $Sql
  if($LASTEXITCODE -ne 0){throw 'Isolated state query failed.'};return ($value -join "`n").Trim()
 }
 function StartClient([string]$Name,[string]$Sql){
  $file=Join-Path $generated ($Name+'.sql')
  [IO.File]::WriteAllText($file,"set application_name='$Name'; set statement_timeout='12s'; set lock_timeout='10s';`n"+$Sql,[Text.UTF8Encoding]::new($false))
  $start=[Diagnostics.ProcessStartInfo]::new();$start.FileName=$runtime;$start.UseShellExecute=$false;$start.CreateNoWindow=$true
  $start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
  foreach($argument in ($connection+@('-f',$file))){$start.ArgumentList.Add($argument)}
  $process=[Diagnostics.Process]::new();$process.StartInfo=$start
  if(-not $process.Start()){throw 'Could not start bounded isolated SQL client.'};return $process
 }
 function WaitState([string]$Name,[string]$Predicate){
  for($attempt=0;$attempt -lt 60;$attempt++){
   if((Query "select count(*) from pg_stat_activity where application_name='$Name' and $Predicate") -eq '1'){return}
   Start-Sleep -Milliseconds 30
  };throw "Actual SQL state not observed: $Name $Predicate"
 }
 function FinishClient($Process,[string]$Name){
  if(-not $Process.WaitForExit(15000)){throw "Bounded SQL client timed out: $Name"}
  $output=$Process.StandardOutput.ReadToEnd()+$Process.StandardError.ReadToEnd()
  [IO.File]::WriteAllText((Join-Path $generated ($Name+'.log')),$output,[Text.UTF8Encoding]::new($false))
  Write-Output $output
  return @{exit=$Process.ExitCode;output=$output}
 }
 & $runtime @connection -f (Join-Path $PSScriptRoot 'rooms-management-concurrency-setup.sql')
 if($LASTEXITCODE -ne 0){throw 'Concurrency fixture setup failed.'}
 $a=StartClient 'rooms-mgmt-pin-a' @"
begin; select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000002',true); set local role authenticated;
select public.room_set_post_pin('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000003',true,'d4000000-0000-4000-8000-000000000003');
select pg_sleep(2); commit;
"@
 WaitState 'rooms-mgmt-pin-a' "wait_event='PgSleep'"
 $b=StartClient 'rooms-mgmt-pin-b' @"
begin; select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000002',true); set local role authenticated;
select public.room_set_post_pin('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000004',true,'d4000000-0000-4000-8000-000000000004'); commit;
"@
 WaitState 'rooms-mgmt-pin-b' "wait_event_type='Lock'"
 $aResult=@(FinishClient $a 'rooms-mgmt-pin-a')[-1];$bResult=@(FinishClient $b 'rooms-mgmt-pin-b')[-1]
 if($aResult.exit -ne 0 -or $bResult.exit -eq 0 -or $bResult.output -notmatch 'ROOM_PIN_LIMIT' -or
   (Query "select count(*) from public.social_room_pinned_posts where room_id='d2000000-0000-4000-8000-000000000001'") -ne '3'){throw 'Concurrent pin limit failed.'}
 Write-Output 'PASS: actual concurrent fourth pin waits, then ROOM_PIN_LIMIT; exactly3 pins committed.'

 foreach($kind in @('open','request')){
  $roomSuffix=if($kind -eq 'open'){'2'}else{'3'}
  $room='d2000000-0000-4000-8000-'+$roomSuffix.PadLeft(12,'0')
  $insert=if($kind -eq 'open'){"insert into public.social_circle_members(circle_id,member_id,member_role) values('$room',auth.uid(),'member');"}else{"insert into public.social_circle_join_requests(circle_id,requester_id) values('$room',auth.uid());"}
  $aName='rooms-mgmt-'+$kind+'-a';$bName='rooms-mgmt-'+$kind+'-b'
  $a=StartClient $aName @"
begin; select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000005',true); set local role authenticated;
$insert select pg_sleep(2); commit;
"@
  WaitState $aName "wait_event='PgSleep'"
  $b=StartClient $bName @"
begin; select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true); set local role authenticated;
select public.room_update_management('$room',1,gen_random_uuid(),'[]','[{"id":"d6000000-0000-4000-8000-000000000001","prompt":"Why join?","required":true}]'); commit;
"@
  WaitState $bName "wait_event_type='Lock'"
  $aResult=@(FinishClient $a $aName)[-1];$bResult=@(FinishClient $b $bName)[-1]
  if($aResult.exit -ne 0 -or $bResult.exit -ne 0 -or ($aResult.output+$bResult.output) -match 'deadlock detected'){throw 'Question enable/admission serialization failed.'}
  if((Query "select version from private.room_management_config where room_id='$room'") -ne '2'){throw 'Question config did not commit.'}
  if($kind -eq 'request'){
   if((Query "select source||':'||config_version::text from private.room_membership_answers where room_id='$room' and requester_id='d1000000-0000-4000-8000-000000000005'") -ne 'legacy:1'){throw 'Concurrent pre-enable request was not snapshotted truthfully.'}
   Query "begin; select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true); set local role authenticated; update public.social_circle_join_requests set status='approved' where circle_id='$room' and requester_id='d1000000-0000-4000-8000-000000000005'; commit;" | Out-Null
  }
  if((Query "select count(*) from public.social_circle_members where circle_id='$room' and member_id='d1000000-0000-4000-8000-000000000005'") -ne '1'){throw 'Valid pre-enable admission/request approval was not preserved.'}
  $probe=StartClient ('rooms-mgmt-'+$kind+'-old-probe') @"
begin; select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000006',true); set local role authenticated;
$(if($kind -eq 'open'){"insert into public.social_circle_members(circle_id,member_id,member_role) values('$room',auth.uid(),'member');"}else{"insert into public.social_circle_join_requests(circle_id,requester_id) values('$room',auth.uid());"}) commit;
"@
  $probeResult=@(FinishClient $probe ('rooms-mgmt-'+$kind+'-old-probe'))[-1]
  if($probeResult.exit -eq 0 -or $probeResult.output -notmatch 'ROOM_QUESTIONS_REQUIRED'){throw 'Old direct admission after enablement bypassed questions.'}
  Write-Output "PASS: actual concurrent $kind admission finishes before question enablement; legacy state preserved; later direct bypass denied."
 }

 $a=StartClient 'rooms-mgmt-demote-a' @"
begin; select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true); set local role authenticated;
update public.social_circle_members set member_role='member' where circle_id='d2000000-0000-4000-8000-000000000001' and member_id='d1000000-0000-4000-8000-000000000002';
select pg_sleep(2); commit;
"@
 WaitState 'rooms-mgmt-demote-a' "wait_event='PgSleep'"
 $b=StartClient 'rooms-mgmt-demote-b' @"
begin; select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000002',true); set local role authenticated;
select public.room_set_post_pin('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000004',true,'d4000000-0000-4000-8000-000000000014'); commit;
"@
 WaitState 'rooms-mgmt-demote-b' "wait_event_type='Lock'"
 $aResult=@(FinishClient $a 'rooms-mgmt-demote-a')[-1];$bResult=@(FinishClient $b 'rooms-mgmt-demote-b')[-1]
 if($aResult.exit -ne 0 -or $bResult.exit -eq 0 -or $bResult.output -notmatch 'ROOM_STAFF_REQUIRED' -or
   (Query "select count(*) from public.social_room_pinned_posts where post_id='d3000000-0000-4000-8000-000000000004'") -ne '0'){throw 'Current role revocation did not protect mutation.'}
 Write-Output 'PASS: actual concurrent demotion commits; waiting pin checks current role and rejects without mutation.'
 Write-Output 'PASS: all4 actual bounded two-session management races completed without deadlock.'
}finally{Remove-Item Env:PGPASSWORD}
