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
$runtimeJars = @(
    $compiler
    $standardLibrary
    (CachedJar 'org.jetbrains.kotlin' 'kotlin-script-runtime' '2.2.20')
    (CachedJar 'org.jetbrains.kotlin' 'kotlin-reflect' '1.6.10')
    (CachedJar 'org.jetbrains.kotlin' 'kotlin-daemon-embeddable' '2.2.20')
    (CachedJar 'org.jetbrains.kotlinx' 'kotlinx-coroutines-core-jvm' '1.8.0')
    (CachedJar 'org.jetbrains' 'annotations' '23.0.0')
)
$nativeRoot = Split-Path $PSScriptRoot -Parent
$validationCore = Join-Path $nativeRoot 'app/src/main/java/com/sautilink/nativeapp/feature/auth/AuthInputValidation.kt'
$checks = Join-Path $PSScriptRoot 'AuthInputValidationCheck.kt'
$compiledDirectory = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $compiledDirectory -Force | Out-Null

& $JavaPath -cp ($runtimeJars -join [IO.Path]::PathSeparator) org.jetbrains.kotlin.cli.jvm.K2JVMCompiler `
    -no-stdlib -no-reflect -jvm-target 17 -classpath $standardLibrary `
    -d $compiledDirectory $validationCore $checks
if ($LASTEXITCODE -ne 0) { throw "Kotlin validation compilation failed ($LASTEXITCODE)." }
& $JavaPath -cp ($compiledDirectory + [IO.Path]::PathSeparator + $standardLibrary) `
    com.sautilink.nativeapp.feature.auth.AuthInputValidationCheckKt
if ($LASTEXITCODE -ne 0) { throw "Auth input behavior checks failed ($LASTEXITCODE)." }
