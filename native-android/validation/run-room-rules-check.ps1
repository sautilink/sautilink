param(
    [Parameter(Mandatory = $true)][string]$JavaPath,
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [string]$GradleModuleCache = (Join-Path $env:USERPROFILE '.gradle/caches/modules-2/files-2.1')
)

$ErrorActionPreference = 'Stop'
function CachedJar([string]$Group, [string]$Artifact, [string]$Version) {
    $artifactDirectory = Join-Path $GradleModuleCache "$Group/$Artifact/$Version"
    $jars = @(Get-ChildItem -LiteralPath $artifactDirectory -Recurse -File -Filter "$Artifact-$Version.jar")
    if ($jars.Count -ne 1) { throw "Expected exactly one cached $Artifact-$Version.jar" }
    return $jars[0].FullName
}

if (-not (Test-Path -LiteralPath $JavaPath -PathType Leaf)) { throw 'Java executable was not found.' }
$compiler = CachedJar 'org.jetbrains.kotlin' 'kotlin-compiler-embeddable' '2.2.20'
$standardLibrary = CachedJar 'org.jetbrains.kotlin' 'kotlin-stdlib' '2.2.20'
$annotations = CachedJar 'org.jetbrains' 'annotations' '23.0.0'
$runtimeJars = @(
    $compiler
    $standardLibrary
    (CachedJar 'org.jetbrains.kotlin' 'kotlin-script-runtime' '2.2.20')
    (CachedJar 'org.jetbrains.kotlin' 'kotlin-reflect' '1.6.10')
    (CachedJar 'org.jetbrains.kotlin' 'kotlin-daemon-embeddable' '2.2.20')
    (CachedJar 'org.jetbrains.kotlinx' 'kotlinx-coroutines-core-jvm' '1.8.0')
    $annotations
)
$nativeRoot = Split-Path $PSScriptRoot -Parent
$repositoryRoot = Split-Path $nativeRoot -Parent
$workspaceWork = Split-Path $repositoryRoot -Parent
$generatedRoot = [IO.Path]::GetFullPath((Join-Path $workspaceWork 'generatedtestscope'))
$generatedDirectory = [IO.Path]::GetFullPath($OutputDirectory)
if ($generatedDirectory -ne $generatedRoot -and
    -not $generatedDirectory.StartsWith($generatedRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Room rule test stubs/classes must remain under work/generatedtestscope, outside product source.'
}
New-Item -ItemType Directory -Path $generatedDirectory -Force | Out-Null
$stubPath = Join-Path $generatedDirectory 'FeedTypeStubs.kt'
@'
package com.sautilink.nativeapp.feature.home

// Test-only type signatures. The Room model implementation is the actual production source.
data class FeedMedia(val id: String, val kind: String, val position: Int, val width: Int = 0, val height: Int = 0)
data class StagingFeedPost(val id: String, val authorId: String, val authorName: String,
    val authorHandle: String, val verified: Boolean, val badgeType: String, val body: String,
    val createdAt: String, val likes: Int, val comments: Int, val reposts: Int, val mediaCount: Int,
    val media: List<FeedMedia>, val hasAvatar: Boolean)
'@ | Set-Content -LiteralPath $stubPath -Encoding utf8
$compiledDirectory = Join-Path $generatedDirectory 'classes'
New-Item -ItemType Directory -Path $compiledDirectory -Force | Out-Null
$modelSource = Join-Path $nativeRoot 'app/src/main/java/com/sautilink/nativeapp/feature/rooms/NativeRoomModels.kt'
$mediaPathSource = Join-Path $nativeRoot 'app/src/main/java/com/sautilink/nativeapp/feature/home/PostMediaAccessPath.kt'
$checks = Join-Path $PSScriptRoot 'NativeRoomRulesCheck.kt'
$classPath = $standardLibrary + [IO.Path]::PathSeparator + $annotations
& $JavaPath '-Dfile.encoding=UTF-8' -cp ($runtimeJars -join [IO.Path]::PathSeparator) org.jetbrains.kotlin.cli.jvm.K2JVMCompiler `
    -no-stdlib -no-reflect -jvm-target 17 -classpath $classPath `
    -d $compiledDirectory $modelSource $mediaPathSource $stubPath $checks
if ($LASTEXITCODE -ne 0) { throw "Room rule validation compilation failed ($LASTEXITCODE)." }
& $JavaPath '-Dfile.encoding=UTF-8' -cp ($compiledDirectory + [IO.Path]::PathSeparator + $standardLibrary) `
    com.sautilink.nativeapp.feature.rooms.NativeRoomRulesCheckKt
if ($LASTEXITCODE -ne 0) { throw "Room behavior checks failed ($LASTEXITCODE)." }
