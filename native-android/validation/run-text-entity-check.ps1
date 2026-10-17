param(
    [Parameter(Mandatory = $true)][string]$JavaPath,
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [string]$GradleModuleCache = (Join-Path $env:USERPROFILE '.gradle/caches/modules-2/files-2.1')
)
$ErrorActionPreference = 'Stop'
function CachedJar([string]$Group, [string]$Artifact, [string]$Version) {
    $jars = @(Get-ChildItem -LiteralPath (Join-Path $GradleModuleCache "$Group/$Artifact/$Version") -Recurse -File -Filter "$Artifact-$Version.jar")
    if ($jars.Count -ne 1) { throw "Expected one cached $Artifact-$Version.jar" }
    return $jars[0].FullName
}
$stdlib = CachedJar 'org.jetbrains.kotlin' 'kotlin-stdlib' '2.2.20'
$runtime = @((CachedJar 'org.jetbrains.kotlin' 'kotlin-compiler-embeddable' '2.2.20'), $stdlib,
    (CachedJar 'org.jetbrains.kotlin' 'kotlin-script-runtime' '2.2.20'),
    (CachedJar 'org.jetbrains.kotlin' 'kotlin-reflect' '1.6.10'),
    (CachedJar 'org.jetbrains.kotlin' 'kotlin-daemon-embeddable' '2.2.20'),
    (CachedJar 'org.jetbrains.kotlinx' 'kotlinx-coroutines-core-jvm' '1.8.0'),
    (CachedJar 'org.jetbrains' 'annotations' '23.0.0'))
$app = Join-Path (Split-Path $PSScriptRoot -Parent) 'app/src/main/java/com/sautilink/nativeapp'
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$main = [IO.File]::ReadAllText((Join-Path $app 'MainActivity.kt'))
function ActualRoute([string]$Name) {
    $start = $main.IndexOf("    fun $Name(", [StringComparison]::Ordinal)
    if ($start -lt 0) { throw 'Missing actual route closure.' }
    $body = $main.IndexOf('{', $start)
    $depth = 1; $end = $body + 1
    while ($end -lt $main.Length -and $depth -gt 0) {
        if ($main[$end] -eq '{') { $depth++ }
        if ($main[$end] -eq '}') { $depth-- }
        $end++
    }
    if ($depth -ne 0) { throw 'Unbalanced actual route closure.' }
    return $main.Substring($start, $end - $start)
}
$fixture = @'
package com.sautilink.nativeapp.ui.text
class EntityRoutesFixture {
 var detail: String? = null
 var memberProfileReturn: String? = null
 var viewedProfileHandle = ""
 var notificationPostId = ""
 var postReturn: String? = null
 var entityExploreActive = false
 var entityExploreQuery = ""
 var entityExploreReturn: String? = null
 var entityExploreProfile = ""
 var entityExploreMemberReturn: String? = null
 var entityExplorePostId = ""
 var entityExplorePostReturn: String? = null
 var entityExploreAccount: String? = null
 val activeAccountId: String? = "public-qa-fixture"
'@
$fixture += "`n" + (ActualRoute 'openEntityProfile') + "`n" + (ActualRoute 'openEntityHashtag') + "`n" + (ActualRoute 'closeEntityExplore') + "`n}`n"
$effectStart = $main.IndexOf('    LaunchedEffect(detail) {', [StringComparison]::Ordinal)
if ($effectStart -lt 0) { throw 'Missing actual detail-context effect.' }
$effectBody = $main.IndexOf('{', $effectStart); $effectEnd = $effectBody + 1; $depth = 1
while ($effectEnd -lt $main.Length -and $depth -gt 0) {
    if ($main[$effectEnd] -eq '{') { $depth++ }
    if ($main[$effectEnd] -eq '}') { $depth-- }
    $effectEnd++
}
if ($depth -ne 0) { throw 'Unbalanced actual detail-context effect.' }
$effect = $main.Substring($effectBody + 1, $effectEnd - $effectBody - 2)
$fixture = $fixture.Substring(0, $fixture.LastIndexOf('}')) + "fun synchronizeDetail() {`n$effect`n}`n}`n"
$fixturePath = Join-Path $OutputDirectory 'EntityRoutesFixture.kt'
[IO.File]::WriteAllText($fixturePath, $fixture)
$classes = Join-Path $OutputDirectory 'classes'
& $JavaPath -cp ($runtime -join [IO.Path]::PathSeparator) org.jetbrains.kotlin.cli.jvm.K2JVMCompiler `
    -no-stdlib -no-reflect -jvm-target 17 -classpath $stdlib -d $classes `
    (Join-Path $app 'ui/text/TextEntities.kt') (Join-Path $app 'ui/text/PostTextFormatting.kt') `
    $fixturePath (Join-Path $PSScriptRoot 'TextEntitiesCheck.kt')
if ($LASTEXITCODE -ne 0) { throw 'Text entity validation compilation failed.' }
& $JavaPath -cp ($classes + [IO.Path]::PathSeparator + $stdlib) com.sautilink.nativeapp.ui.text.TextEntitiesCheckKt
if ($LASTEXITCODE -ne 0) { throw 'Text entity behavior checks failed.' }
