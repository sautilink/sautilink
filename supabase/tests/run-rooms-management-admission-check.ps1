param([string]$Database='sautilink_rooms_test_management_final3_20261016',[switch]$Baseline)
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

 foreach($kind in @('open','request','block')){
  $number=@{open='4';request='5';block='6'}[$kind]
  $room='d2000000-0000-4000-8000-'+$number.PadLeft(12,'0')
  $initial=if($kind -eq 'request'){'approval'}else{'open'}
  Query "select set_config('request.jwt.claim.sub','',false); insert into public.social_circles(id,owner_id,name,slug,join_policy) values('$room','d1000000-0000-4000-8000-000000000001','Admission state QA $number','admission-state-qa-$number','$initial') on conflict do nothing; delete from private.room_management_receipts where room_id='$room'; delete from public.social_circle_join_requests where circle_id='$room'; delete from public.social_circle_members where circle_id='$room' and member_role<>'owner'; delete from private.room_membership_answers where room_id='$room'; update public.social_circles set join_policy='$initial' where id='$room'; delete from public.social_blocks where blocker_id='d1000000-0000-4000-8000-000000000001' and blocked_id='d1000000-0000-4000-8000-000000000007';" | Out-Null
  $change=if($kind -eq 'block'){"insert into public.social_blocks(blocker_id,blocked_id) values('d1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000007');"}else{"update public.social_circles set join_policy='private' where id='$room';"}
  $aName='rooms-admission-'+$kind+'-a';$bName='rooms-admission-'+$kind+'-b'
  # SessionA is a trusted fixture writer; only SessionB is the real caller RPC.
  $a=StartClient $aName @"
begin; select pg_advisory_xact_lock(hashtextextended('room-management:'||'$room',0)); select pg_sleep(2); $change commit;
"@
  WaitState $aName "wait_event='PgSleep'"
  $intent=if($kind -eq 'request'){'request'}else{'join'}
  $b=StartClient $bName @"
begin; select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000007',true); set local role authenticated;
select public.room_submit_membership_request('$room',1,gen_random_uuid(),'[]','$intent'); commit;
"@
  WaitState $bName "wait_event_type='Lock'"
  $aResult=@(FinishClient $a $aName)[-1];$bResult=@(FinishClient $b $bName)[-1]
  $rows=Query "select (select count(*) from public.social_circle_members where circle_id='$room' and member_id='d1000000-0000-4000-8000-000000000007')+(select count(*) from public.social_circle_join_requests where circle_id='$room' and requester_id='d1000000-0000-4000-8000-000000000007');"
  if($aResult.exit -ne 0){throw 'Trusted concurrent fixture change failed.'}
  if($Baseline){
   if($bResult.exit -ne 0 -or $rows -ne '1'){throw 'Expected stale-state baseline was not reproduced.'}
   Write-Output "REPRODUCED application FAIL: $kind intent used pre-wait Room state after concurrent committed change."
  }else{
   if($bResult.exit -eq 0 -or $rows -ne '0' -or $bResult.output -notmatch 'MEMBERSHIP_STATE_CHANGED|ROOM_UNAVAILABLE'){throw 'Current Room state was not enforced after waiting.'}
   Write-Output "PASS: $kind admission rejects changed state after observed lock wait; no member/request committed."
  }
 }
 Write-Output $(if($Baseline){'REPRODUCED3/3 stale-state baseline failures.'}else{'PASS3/3 bounded current-Room admission checks.'})
}finally{Remove-Item Env:PGPASSWORD}
