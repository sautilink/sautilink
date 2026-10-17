param(
 [Parameter(Mandatory=$true)][string]$JavaPath,
 [Parameter(Mandatory=$true)][string]$OutputDirectory,
 [string]$GradleModuleCache=(Join-Path $env:USERPROFILE '.gradle/caches/modules-2/files-2.1')
)
$ErrorActionPreference='Stop'
$nativeRoot=Split-Path $PSScriptRoot -Parent
$repository=Split-Path $nativeRoot -Parent
$generatedRoot=[IO.Path]::GetFullPath((Join-Path (Split-Path $repository -Parent) 'generatedtestscope'))
$output=[IO.Path]::GetFullPath($OutputDirectory)
if(-not $output.StartsWith($generatedRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){
 throw 'Milestone check output must stay below work/generatedtestscope, outside product source.'
}
if(-not(Test-Path -LiteralPath $JavaPath -PathType Leaf)){throw 'Java executable was not found.'}
function CachedJar([string]$Group,[string]$Artifact,[string]$Version){
 $files=@(Get-ChildItem (Join-Path $GradleModuleCache "$Group/$Artifact/$Version") -Recurse -Filter "$Artifact-$Version.jar" -File)
 if($files.Count -ne 1){throw "Expected one cached $Artifact jar"};return $files[0].FullName
}
$stdlib=CachedJar 'org.jetbrains.kotlin' 'kotlin-stdlib' '2.2.20'
$annotations=CachedJar 'org.jetbrains' 'annotations' '23.0.0'
$compiler=@((CachedJar 'org.jetbrains.kotlin' 'kotlin-compiler-embeddable' '2.2.20'),$stdlib,
 (CachedJar 'org.jetbrains.kotlin' 'kotlin-script-runtime' '2.2.20'),
 (CachedJar 'org.jetbrains.kotlin' 'kotlin-reflect' '1.6.10'),
 (CachedJar 'org.jetbrains.kotlin' 'kotlin-daemon-embeddable' '2.2.20'),
 (CachedJar 'org.jetbrains.kotlinx' 'kotlinx-coroutines-core-jvm' '1.8.0'),$annotations)
$classpath=@($stdlib,$annotations,(CachedJar 'com.squareup.okhttp3' 'okhttp' '4.12.0'),(CachedJar 'com.squareup.okio' 'okio-jvm' '3.6.0')) -join [IO.Path]::PathSeparator
$classes=Join-Path $output 'classes'
New-Item -ItemType Directory -Path $classes -Force|Out-Null
$network=Join-Path $nativeRoot 'app/src/main/java/com/sautilink/nativeapp/network'
& $JavaPath '-Dfile.encoding=UTF-8' -cp ($compiler -join [IO.Path]::PathSeparator) org.jetbrains.kotlin.cli.jvm.K2JVMCompiler `
 -nowarn -no-stdlib -no-reflect -jvm-target 17 -classpath $classpath -d $classes `
 (Join-Path $network 'RoomNetworkMilestones.kt') (Join-Path $network 'SautiNetworkFailureDiagnostic.kt') `
 (Join-Path $PSScriptRoot 'RoomNetworkMilestonesCheck.kt') (Join-Path $PSScriptRoot 'SautiNetworkFailureDiagnosticCheck.kt') *> (Join-Path $output 'compile.log')
if($LASTEXITCODE -ne 0){Get-Content (Join-Path $output 'compile.log');throw 'Actual callback compilation failed.'}
foreach($main in @('RoomNetworkMilestonesCheckKt','SautiNetworkFailureDiagnosticCheckKt')){
 $log=Join-Path $output ($main+'.log')
 & $JavaPath '-Dfile.encoding=UTF-8' -cp ($classes+[IO.Path]::PathSeparator+$classpath) ('com.sautilink.nativeapp.network.'+$main) *> $log
 $code=$LASTEXITCODE
 Get-Content $log
 if($code -ne 0){throw 'Actual callback/formatter regression failed.'}
}
