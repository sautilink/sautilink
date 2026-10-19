param([string]$Database='sautilink_rooms_test_conflicts_20261016')
$ErrorActionPreference='Stop'
$PSNativeCommandUseErrorActionPreference=$false
if($Database -notmatch '^sautilink_rooms_test_conflicts_[a-zA-Z0-9_]+$'){throw 'Isolated conflict-test database required.'}
$repository=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$work=Split-Path $repository -Parent
$cluster=(Resolve-Path (Join-Path $work 'postgres-local/data')).Path
$bin=(Resolve-Path (Join-Path $work 'postgres-local/runtime/pgsql/bin')).Path
if($cluster -ne (Join-Path $work 'postgres-local/data') -or $bin -ne (Join-Path $work 'postgres-local/runtime/pgsql/bin')){throw 'Unexpected local runtime path.'}
$output=Join-Path $work ('generatedtestscope/rooms-business-conflicts/'+$Database)
New-Item -ItemType Directory -Path $output -Force | Out-Null
$psql=Join-Path $bin 'psql.exe'
$ctl=Join-Path $bin 'pg_ctl.exe'
$started=$false
$result=[ordered]@{database=$Database;host='127.0.0.1';port=55435;sourceTemplate='sautilink_rooms_test_delete_cascade_20261016';hostedActions=$false;status='RUNNING';output=$output}
try{
 if(@(Get-Process -Name postgres -ErrorAction SilentlyContinue).Count -ne 0 -or @([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()|Where-Object{$_.Port -eq 55435}).Count -ne 0){throw 'Local cluster/port already in use; coordinate before running.'}
 $helper=Start-Process -FilePath $ctl -ArgumentList @('-D',('"'+$cluster+'"'),'-l',('"'+(Join-Path $output 'server.log')+'"'),'-o','"-h 127.0.0.1 -p 55435"','-w','start') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $output 'startup.log') -RedirectStandardError (Join-Path $output 'startup-error.log')
 $started=$true
 if(-not $helper.WaitForExit(15000) -or $helper.ExitCode -ne 0){throw 'Bounded local Postgres startup failed.'}
 $env:PGPASSWORD=[IO.File]::ReadAllText((Join-Path $work 'postgres-local/local-test-password')).Trim()
 try{
  $connection=@('-h','127.0.0.1','-p','55435','-U','roomsqa','-X','-v','ON_ERROR_STOP=1','-v','expect_bug=false')
  $identity=& $psql @connection -d postgres -tA -c "select host(inet_server_addr())||':'||inet_server_port()::text||':'||current_setting('server_version')"
  $result.serverObserved=[string]$identity
  if($LASTEXITCODE -ne 0 -or $identity -notmatch '^127\.0\.0\.1:55435:17\.11'){throw 'Unexpected test server identity.'}
  $result.server=$identity.Trim()
  $exists=& $psql @connection -d postgres -tA -c "select count(*) from pg_database where datname='$Database'"
  if($LASTEXITCODE -ne 0 -or $exists.Trim() -ne '0'){throw 'Refusing to overwrite an existing test database.'}
  & $psql @connection -d postgres -c "create database $Database template sautilink_rooms_test_delete_cascade_20261016" *> (Join-Path $output 'clone.log')
  if($LASTEXITCODE -ne 0){throw 'Isolated clone failed.'}
  $targets="'public.room_decide_post_submission(uuid,uuid,uuid,integer,text,text)'::regprocedure,'public.room_withdraw_post_submission(uuid,uuid,uuid,integer)'::regprocedure,'public.room_update_management(uuid,integer,uuid,jsonb,jsonb)'::regprocedure,'private.enforce_room_membership_questions()'::regprocedure,'public.room_submit_membership_request(uuid,integer,uuid,jsonb,text)'::regprocedure,'public.room_set_post_pin(uuid,uuid,boolean,uuid)'::regprocedure"
  & $psql @connection -d $Database -tA -o (Join-Path $output 'functions-before.sql') -c "select string_agg(pg_get_functiondef(oid),E'\n' order by oid) from pg_proc where oid in($targets)"
  if($LASTEXITCODE -ne 0){throw 'Local function backup failed.'}
  & $psql @connection -d $Database -tA -o (Join-Path $output 'function-metadata-before.json') -c "select jsonb_agg(jsonb_build_object('signature',oid::regprocedure::text,'owner',proowner::regrole::text,'acl',proacl,'security_definer',prosecdef,'config',proconfig,'body_md5',md5(replace(prosrc,E'\r\n',E'\n')))) from pg_proc where oid in($targets)"
  if($LASTEXITCODE -ne 0){throw 'Local metadata backup failed.'}
  $behavior=Join-Path $PSScriptRoot 'rooms-business-conflict-behavior.sql'
  & $psql @connection -d $Database -f $behavior *> (Join-Path $output 'baseline.log')
  if($LASTEXITCODE -eq 0 -or [IO.File]::ReadAllText((Join-Path $output 'baseline.log')) -notmatch 'EXPECTED_SQLSTATE_PT409_GOT_40001'){throw 'Expected unchanged baseline SQLSTATE40001 failure was not reproduced.'}
  $result.baseline='EXPECTED_RED_40001'
  Write-Output 'EXPECTED RED: unchanged stale settings raises40001, notPT409.'
  foreach($test in @('rooms-business-conflict-patch-contract.sql','rooms-business-conflict-behavior.sql','rooms-management-behavior.sql','rooms-management-authority-limits.sql','rooms-approval-quote-contract.sql')){
   & $psql @connection -d $Database -f (Join-Path $PSScriptRoot $test) *> (Join-Path $output ($test+'.log'))
   if($LASTEXITCODE -ne 0){Get-Content -LiteralPath (Join-Path $output ($test+'.log')) -Tail 24;throw "Local check failed: $test"}
   Get-Content -LiteralPath (Join-Path $output ($test+'.log')) | Select-String 'PASS:' | ForEach-Object {$_.Line}
  }
  & $psql @connection -d $Database -f (Join-Path $repository 'docs/operations/sql-drafts/rooms-business-conflicts-http409-rollback.sql') *> (Join-Path $output 'rollback.log')
  if($LASTEXITCODE -ne 0){throw 'Guarded rollback failed.'}
  foreach($test in @('rooms-business-conflict-patch-contract.sql','rooms-business-conflict-behavior.sql')){
   & $psql @connection -d $Database -f (Join-Path $PSScriptRoot $test) *> (Join-Path $output ('reapply-'+$test+'.log'))
   if($LASTEXITCODE -ne 0){Get-Content -LiteralPath (Join-Path $output ('reapply-'+$test+'.log')) -Tail 24;throw "Rollback/reapply check failed: $test"}
  }
  $result.guardedRollbackAndReapply='PASS'
  $result.localBeforeBackupSha256=(Get-FileHash -LiteralPath (Join-Path $output 'functions-before.sql') -Algorithm SHA256).Hash
  $result.migrationSha256=(Get-FileHash -LiteralPath (Join-Path $repository 'supabase/migrations/20261016022505_rooms_business_conflicts_http409.sql') -Algorithm SHA256).Hash
  $result.rollbackSha256=(Get-FileHash -LiteralPath (Join-Path $repository 'docs/operations/sql-drafts/rooms-business-conflicts-http409-rollback.sql') -Algorithm SHA256).Hash
  $result.status='PASS'
 }finally{Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue}
}catch{$result.status='FAIL';$result.failure=$_.Exception.Message;throw}
finally{
 if($started){& $ctl -D $cluster -m fast -w stop *> (Join-Path $output 'stop.log');$result.clusterStopExit=$LASTEXITCODE}
 $result.psqlClients=@(Get-Process -Name psql -ErrorAction SilentlyContinue).Count
 $result.postgresProcesses=@(Get-Process -Name postgres -ErrorAction SilentlyContinue).Count
 $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $output 'result.json') -Encoding utf8
}
$result | ConvertTo-Json -Depth 8
