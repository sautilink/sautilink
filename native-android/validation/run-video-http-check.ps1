param(
    [Parameter(Mandatory=$true)][string]$JavaPath,
    [Parameter(Mandatory=$true)][string]$AndroidJar,
    [Parameter(Mandatory=$true)][string]$OutputDirectory,
    [string]$GradleModuleCache=(Join-Path $env:USERPROFILE '.gradle/caches/modules-2/files-2.1')
)
$ErrorActionPreference='Stop'
function Cached([string]$Group,[string]$Artifact,[string]$Version,[string]$Extension='jar') {
    $files=@(Get-ChildItem -LiteralPath (Join-Path $GradleModuleCache "$Group/$Artifact/$Version") -Recurse -File -Filter "$Artifact-$Version.$Extension")
    if ($files.Count -ne 1) { throw "Expected one cached $Artifact-$Version.$Extension" }
    return $files[0].FullName
}
$out=[IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path "$out/classes" -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
$libraries=@()
foreach($item in @(@('androidx.media3','media3-common','1.11.1'),@('androidx.media3','media3-datasource','1.11.1'),@('androidx.annotation','annotation-experimental','1.4.1'))) {
    $archive=[IO.Compression.ZipFile]::OpenRead((Cached $item[0] $item[1] $item[2] 'aar'))
    try {
        $destination=Join-Path $out ($item[1]+'.jar')
        [IO.Compression.ZipFileExtensions]::ExtractToFile($archive.GetEntry('classes.jar'),$destination,$true)
        $libraries+=$destination
    } finally { $archive.Dispose() }
}
$stdlib=Cached 'org.jetbrains.kotlin' 'kotlin-stdlib' '2.2.20'
$compiler=@((Cached 'org.jetbrains.kotlin' 'kotlin-compiler-embeddable' '2.2.20'),$stdlib,
    (Cached 'org.jetbrains.kotlin' 'kotlin-script-runtime' '2.2.20'),
    (Cached 'org.jetbrains.kotlin' 'kotlin-reflect' '1.6.10'),
    (Cached 'org.jetbrains.kotlin' 'kotlin-daemon-embeddable' '2.2.20'),
    (Cached 'org.jetbrains.kotlinx' 'kotlinx-coroutines-core-jvm' '1.8.0'),
    (Cached 'org.jetbrains' 'annotations' '23.0.0'))
$fixture=Join-Path $PSScriptRoot 'video-http'
$javac=Join-Path (Split-Path $JavaPath -Parent) 'javac.exe'
& $javac -d "$out/classes" "$fixture/Uri.java" "$fixture/TextUtils.java"
if ($LASTEXITCODE -ne 0) { throw 'Fixture compilation failed' }
$classpath=@("$out/classes",$stdlib,$AndroidJar,(Cached 'com.google.guava' 'guava' '33.3.1-android'))+$libraries
$source=Join-Path (Split-Path $PSScriptRoot -Parent) 'app/src/main/java/com/sautilink/nativeapp/ui/components/NativeVideoDataSource.kt'
& $JavaPath -cp ($compiler -join ';') org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -jvm-target 17 `
    -classpath ($classpath -join ';') -d "$out/classes" $source "$fixture/VideoDataSourceCheck.kt"
if ($LASTEXITCODE -ne 0) { throw 'Video transport compilation failed' }
& $JavaPath -cp ($classpath -join ';') com.sautilink.nativeapp.ui.components.VideoDataSourceCheckKt
if ($LASTEXITCODE -ne 0) { throw 'Video transport checks failed' }
