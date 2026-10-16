param(
 [Parameter(Mandatory=$true)][string]$JavaPath,
 [Parameter(Mandatory=$true)][string]$OutputDirectory,
 [string]$GradleModuleCache=(Join-Path $env:USERPROFILE '.gradle/caches/modules-2/files-2.1'),
 [string]$BaselineSourceBlob='3e0d27c46cbff67093966215dcf9cca084cdda0a'
)
$ErrorActionPreference='Stop'
$nativeRoot=Split-Path $PSScriptRoot -Parent
$repository=Split-Path $nativeRoot -Parent
$work=Split-Path $repository -Parent
$generatedRoot=[IO.Path]::GetFullPath((Join-Path $work 'generatedtestscope'))
$output=[IO.Path]::GetFullPath($OutputDirectory)
if(-not $output.StartsWith($generatedRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){
 throw 'Observer classes/generated baseline must stay below work/generatedtestscope, outside product source.'
}
if(-not(Test-Path -LiteralPath $JavaPath -PathType Leaf)){throw 'Java executable was not found.'}
if($BaselineSourceBlob -notmatch '^[0-9a-f]{40}$'){throw 'An exact existing Git source blob is required.'}
New-Item -ItemType Directory -Path $output -Force | Out-Null
function CachedJar([string]$Group,[string]$Artifact,[string]$Version){
 $files=@(Get-ChildItem (Join-Path $GradleModuleCache "$Group/$Artifact/$Version") -Recurse -Filter "$Artifact-$Version.jar" -File)
 if($files.Count -ne 1){throw "Expected one cached $Artifact jar"};return $files[0].FullName
}
$stdlib=CachedJar 'org.jetbrains.kotlin' 'kotlin-stdlib' '2.2.20'
$coroutines=CachedJar 'org.jetbrains.kotlinx' 'kotlinx-coroutines-core-jvm' '1.8.0'
$annotations=CachedJar 'org.jetbrains' 'annotations' '23.0.0'
$compiler=@((CachedJar 'org.jetbrains.kotlin' 'kotlin-compiler-embeddable' '2.2.20'),$stdlib,
 (CachedJar 'org.jetbrains.kotlin' 'kotlin-script-runtime' '2.2.20'),
 (CachedJar 'org.jetbrains.kotlin' 'kotlin-reflect' '1.6.10'),
 (CachedJar 'org.jetbrains.kotlin' 'kotlin-daemon-embeddable' '2.2.20'),$coroutines,$annotations)
$aar=@(Get-ChildItem (Join-Path $GradleModuleCache 'androidx.compose.runtime/runtime-android/1.10.0') -Recurse -Filter runtime.aar -File)
if($aar.Count -ne 1){throw 'Expected one cached production Compose runtime AAR.'}
$runtime=Join-Path $output 'compose-runtime-1.10.0.jar'
$archive=[IO.Compression.ZipFile]::OpenRead($aar[0].FullName)
try{[IO.Compression.ZipFileExtensions]::ExtractToFile($archive.GetEntry('classes.jar'),$runtime,$true)}finally{$archive.Dispose()}
$collection=CachedJar 'androidx.collection' 'collection-jvm' '1.5.0'
$classpath=@($stdlib,$coroutines,$annotations,$runtime,$collection) -join [IO.Path]::PathSeparator
$rooms=Join-Path $nativeRoot 'app/src/main/java/com/sautilink/nativeapp/feature/rooms'
$fixtures=Join-Path $PSScriptRoot 'rooms-readiness'
$sharedSources=@((Join-Path $rooms 'NativeRoomModels.kt'),(Join-Path $rooms 'NativeRoomManagementModels.kt'),
 (Join-Path $fixtures 'AuthFixture.kt'),(Join-Path $fixtures 'FeedFixture.kt'),(Join-Path $fixtures 'AndroidClassLoadingFixture.kt'),
 (Join-Path $fixtures 'ManagementClientFixture.kt'),(Join-Path $fixtures 'RoomReadinessObserverCheck.kt'))
$baseline=@(& git -C $repository show $BaselineSourceBlob)
if($LASTEXITCODE -ne 0){throw 'Tracked baseline blob is not available in this checkout.'}
$baselinePath=Join-Path $output 'RoomManagementState.baseline.kt'
[IO.File]::WriteAllText($baselinePath,($baseline -join "`n")+"`n",[Text.UTF8Encoding]::new($false))
function RunCase([string]$Label,[string]$StateSource){
 $classes=Join-Path $output ($Label+'-classes')
 New-Item -ItemType Directory -Path $classes -Force | Out-Null
 $sources=@($StateSource)+$sharedSources
 & $JavaPath '-Dfile.encoding=UTF-8' -cp ($compiler -join [IO.Path]::PathSeparator) org.jetbrains.kotlin.cli.jvm.K2JVMCompiler `
  -nowarn -no-stdlib -no-reflect -jvm-target 17 -classpath $classpath -d $classes @sources *> (Join-Path $output ($Label+'-compile.log'))
 if($LASTEXITCODE -ne 0){Get-Content (Join-Path $output ($Label+'-compile.log'));throw 'Actual state observer compilation failed.'}
 & $JavaPath '-Dfile.encoding=UTF-8' -cp ($classes+[IO.Path]::PathSeparator+$classpath) com.sautilink.nativeapp.feature.rooms.RoomReadinessObserverCheckKt *> (Join-Path $output ($Label+'-result.log'))
 $code=$LASTEXITCODE
 $result=Get-Content (Join-Path $output ($Label+'-result.log')) -Raw
 Write-Output $result
 if($Label -eq 'baseline'){
  if($code -eq 0 -or $result -notmatch 'opening the Room invalidates initial readiness read before capability response'){throw 'Expected baseline observer failure not reproduced.'}
  Write-Output 'EXPECTED RED: actual tracked baseline did not invalidate initial readiness read.'
 }elseif($code -ne 0){throw 'Patched actual state observer regression failed.'}
}
RunCase 'baseline' $baselinePath
RunCase 'fixed' (Join-Path $rooms 'RoomManagementState.kt')
