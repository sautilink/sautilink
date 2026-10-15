$ErrorActionPreference='Stop'
$repository=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$work=Split-Path $repository -Parent
$runtime=Join-Path $work 'postgres-local/runtime/pgsql/bin/psql.exe'
$generated=Join-Path $work 'generatedtestscope/rooms-delete-cascade'
$database='sautilink_rooms_test_delete_cascade_20261016'
New-Item -ItemType Directory -Path $generated -Force | Out-Null
$clients=[Collections.Generic.List[Diagnostics.Process]]::new()
$env:PGPASSWORD=[IO.File]::ReadAllText((Join-Path $work 'postgres-local/local-test-password')).Trim()
try{
 $connection=@('-h','127.0.0.1','-p','55435','-U','roomsqa','-d',$database,'-X','-v','ON_ERROR_STOP=1')
 function Query([string]$Sql){
  $value=& $runtime @connection -tA -c $Sql
  if($LASTEXITCODE -ne 0){throw 'Isolated cascade query failed.'};return ($value -join "`n").Trim()
 }
 function StartClient([string]$Name,[string]$Sql){
  $file=Join-Path $generated ($Name+'.sql')
  [IO.File]::WriteAllText($file,"set application_name='$Name'; set statement_timeout='12s'; set lock_timeout='10s';`n"+$Sql,[Text.UTF8Encoding]::new($false))
  $start=[Diagnostics.ProcessStartInfo]::new();$start.FileName=$runtime;$start.UseShellExecute=$false;$start.CreateNoWindow=$true
  $start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
  foreach($argument in ($connection+@('-f',$file))){$start.ArgumentList.Add($argument)}
  $process=[Diagnostics.Process]::new();$process.StartInfo=$start
  if(-not $process.Start()){throw 'Could not start bounded isolated client.'};$clients.Add($process);return $process
 }
 function WaitState([string]$Name,[string]$Predicate){
  for($attempt=0;$attempt -lt 80;$attempt++){
   if((Query "select count(*) from pg_stat_activity where application_name='$Name' and $Predicate") -eq '1'){return}
   Start-Sleep -Milliseconds 30
  };throw "Actual SQL state not observed: $Name $Predicate"
 }
 function FinishClient($Process,[string]$Name){
  if(-not $Process.WaitForExit(15000)){throw "Bounded client timed out: $Name"}
  $output=$Process.StandardOutput.ReadToEnd()+$Process.StandardError.ReadToEnd()
  [IO.File]::WriteAllText((Join-Path $generated ($Name+'.log')),$output,[Text.UTF8Encoding]::new($false))
  return @{exit=$Process.ExitCode;output=$output}
 }
 Query @'
begin;
select set_config('request.jwt.claim.sub','',true);
do $$ begin if not exists(select from pg_policies where schemaname='public' and tablename='social_circles' and policyname='social_circles_delete_phase20') then
 execute 'create policy social_circles_delete_phase20 on public.social_circles for delete to authenticated using ((select auth.uid()) = owner_id)'; end if; end $$;
insert into public.social_profiles(id,username) select ('9e100000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'delete_cascade_race_'||i from generate_series(1,3)i;
insert into public.social_circles(id,owner_id,name,slug,join_policy) values('9e200000-0000-4000-8000-000000000001','9e100000-0000-4000-8000-000000000001','Delete cascade race','delete-cascade-race','open');
insert into public.social_circle_members(circle_id,member_id,member_role) select '9e200000-0000-4000-8000-000000000001',('9e100000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'admin' from generate_series(2,3)i;
commit;
'@ | Out-Null
 $a=StartClient 'rooms-delete-admin-a' @'
begin;
select set_config('request.jwt.claim.sub','9e100000-0000-4000-8000-000000000002',true);
set local role authenticated;
select member_id from public.social_circle_members where circle_id='9e200000-0000-4000-8000-000000000001' and member_id='9e100000-0000-4000-8000-000000000003' for update;
select pg_sleep(3);
delete from public.social_circle_members where circle_id='9e200000-0000-4000-8000-000000000001' and member_id='9e100000-0000-4000-8000-000000000003';
commit;
'@
 WaitState 'rooms-delete-admin-a' "wait_event='PgSleep'"
 $b=StartClient 'rooms-delete-owner-b' @'
begin;
select set_config('request.jwt.claim.sub','9e100000-0000-4000-8000-000000000001',true);
set local role authenticated;
with removed as(delete from public.social_circles where id='9e200000-0000-4000-8000-000000000001' returning id)
 select 'owner_deleted='||count(*) from removed;
rollback;
'@
 WaitState 'rooms-delete-owner-b' "wait_event_type='Lock'"
 $ar=FinishClient $a 'rooms-delete-admin-a';$br=FinishClient $b 'rooms-delete-owner-b'
 Write-Output $ar.output;Write-Output $br.output
 if($ar.exit -eq 0 -or $ar.output -notmatch 'ROOM_MEMBER_REMOVAL_FORBIDDEN' -or $br.exit -ne 0 -or
  $br.output -notmatch 'owner_deleted=1' -or ($ar.output+$br.output) -match 'deadlock detected'){throw 'Concurrent hierarchy/cascade regression.'}
 if((Query "select count(*) from public.social_circles where id='9e200000-0000-4000-8000-000000000001'") -ne '1' -or
  (Query "select count(*) from public.social_circle_members where circle_id='9e200000-0000-4000-8000-000000000001'") -ne '3'){throw 'Race rollback did not restore exact fixture.'}
 Write-Output 'PASS: actual waiting owner Room DELETE does not authorize concurrent peer-admin removal; normal guard denies, then owner cascade succeeds and rolls back without deadlock.'
}finally{
 foreach($client in $clients){if(-not $client.HasExited){$client.Kill();$client.WaitForExit(5000)|Out-Null}}
 try{
  & $runtime -h 127.0.0.1 -p 55435 -U roomsqa -d $database -X -v ON_ERROR_STOP=1 -c "begin; select set_config('request.jwt.claim.sub','',true); delete from public.social_circles where id='9e200000-0000-4000-8000-000000000001'; delete from public.social_profiles where id in('9e100000-0000-4000-8000-000000000001','9e100000-0000-4000-8000-000000000002','9e100000-0000-4000-8000-000000000003'); commit;" | Out-Null
  if($LASTEXITCODE -ne 0){throw 'Exact isolated race fixture cleanup failed.'}
 }finally{Remove-Item Env:PGPASSWORD}
}
