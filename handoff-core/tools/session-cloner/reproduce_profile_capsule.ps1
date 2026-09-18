param([int]$Port = 9231, [string]$ConfigPath = $env:HANDOFF_CONFIG, [string]$TargetDir = '', [switch]$DryRun, [switch]$Visible)
$ErrorActionPreference = 'Stop'
if (-not $ConfigPath) { $ConfigPath = 'C:\GPT-Chat-codex-handoff\runtime.local.json' }
$config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$root = [IO.Path]::GetFullPath($config.runtimeRoot)
$workersRoot = [IO.Path]::GetFullPath($config.workersRoot).TrimEnd('\')
$seedDir = [IO.Path]::GetFullPath($config.masterProfile)
$volume = [IO.Path]::GetPathRoot($seedDir)
$runId = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8)
$runDir = Join-Path $config.runsRoot "profile-repro-$runId"
$target = if ($TargetDir) { [IO.Path]::GetFullPath($TargetDir) } else { Join-Path $workersRoot "profile-repro-$runId" }
if (-not $target.StartsWith($workersRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Target must be a new child of workersRoot' }
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Invalid port' }
$link = Join-Path $root "vss-repro-$runId"
if ((Test-Path -LiteralPath $target) -or (Test-Path -LiteralPath $link)) { throw 'Target already exists' }
if ($DryRun) { [ordered]@{seed=$seedDir;volume=$volume;target=$target;runDir=$runDir;port=$Port;dryRun=$true} | ConvertTo-Json; exit 0 }
if ([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | Where-Object Port -eq $Port) { throw "Port $Port is already in use" }
New-Item -ItemType Directory -Path $runDir -ErrorAction Stop | Out-Null
$overall = [Diagnostics.Stopwatch]::StartNew()
$shadow = $null
try {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $created = ([wmiclass]'Win32_ShadowCopy').Create($volume, 'ClientAccessible')
    if ($created.ReturnValue -ne 0 -or -not $created.ShadowID) { throw "VSS failed: $($created.ReturnValue)" }
    $shadow = Get-WmiObject Win32_ShadowCopy | Where-Object ID -eq $created.ShadowID
    if (-not $shadow) { throw 'Created VSS snapshot not found' }
    $snapshotMs = $timer.ElapsedMilliseconds
    $snapshotTarget = $shadow.DeviceObject + '\'
    & cmd.exe /d /c mklink /d $link $snapshotTarget | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Snapshot link creation failed' }
    $src = Join-Path $link $seedDir.Substring($volume.Length)
    $sourceBytes = (Get-ChildItem -LiteralPath $src -Recurse -File | Measure-Object Length -Sum).Sum
    $timer.Restart()
    New-Item -ItemType Directory -Path "$target\Default\Network" | Out-Null
    $required = @('Local State', 'Default\Preferences', 'Default\Network\Cookies')
    $optional = @('Default\Network\Cookies-wal', 'Default\Network\Cookies-journal', 'Default\Network\Network Persistent State')
    foreach ($relative in $required) { Copy-Item -LiteralPath (Join-Path $src $relative) -Destination (Join-Path $target $relative) }
    foreach ($relative in $optional) {
        if (Test-Path -LiteralPath (Join-Path $src $relative)) { Copy-Item -LiteralPath (Join-Path $src $relative) -Destination (Join-Path $target $relative) }
    }
    $ls = Join-Path $src 'Default\Local Storage\leveldb'
    if (-not (Test-Path -LiteralPath $ls)) { throw 'Required Local Storage directory absent' }
    robocopy $ls "$target\Default\Local Storage\leveldb" /E /R:0 /W:0 /XF LOCK /NFL /NDL /NJH /NJS | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Local Storage copy failed: $LASTEXITCODE" }
    $copyMs = $timer.ElapsedMilliseconds
    $files = @(Get-ChildItem -LiteralPath $target -Recurse -File | ForEach-Object { [pscustomobject]@{path=$_.FullName.Substring($target.Length+1);bytes=$_.Length} })
    $receipt = [ordered]@{runId=$runId;target=$target;port=$Port;sourceBytes=$sourceBytes;snapshotMs=$snapshotMs;copyMs=$copyMs;capsuleBytes=($files | Measure-Object bytes -Sum).Sum;files=$files;indexedDBIncluded=$false}
} finally {
    try {
        if (Test-Path -LiteralPath $link) {
            $entry = Get-Item -LiteralPath $link -Force
            if ($entry.FullName -ne $link -or -not ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unexpected snapshot link; refusing removal' }
            [IO.Directory]::Delete($link, $false)
        }
    } finally {
        if ($shadow) { $shadow.Delete() | Out-Null }
    }
}
$receipt['cloneTotalMs'] = $overall.ElapsedMilliseconds
$receipt | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath "$runDir\clone-receipt.json" -Encoding UTF8
$chromeArgs = @("--remote-debugging-address=127.0.0.1", "--remote-debugging-port=$Port", "--user-data-dir=`"$target`"", '--no-first-run', '--no-default-browser-check', '--hide-crash-restore-bubble', '--disable-component-update', '--disable-features=OptimizationGuideModelDownloading,OnDeviceTailModel,OptimizationHints', '--disable-background-networking', '--disk-cache-size=10485760', 'https://chatgpt.com/')
$launchStyle = if ($Visible) { 'Normal' } else { 'Hidden' }
$startup = [Diagnostics.Stopwatch]::StartNew()
$worker = Start-Process -FilePath $config.chromePath -ArgumentList $chromeArgs -WindowStyle $launchStyle -PassThru
$receipt['launcherPid'] = $worker.Id
$ready = $null
for ($i = 0; $i -lt 20; $i++) {
    try { $ready = Invoke-RestMethod "http://127.0.0.1:$Port/json/version" -TimeoutSec 1; if ($ready.Browser) { break } } catch { }
    Start-Sleep -Milliseconds 500
}
$receipt['startupMs'] = $startup.ElapsedMilliseconds
$receipt['browser'] = if ($ready) { $ready.Browser } else { $null }
$receipt['loginVerified'] = $false
$receipt | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath "$runDir\clone-receipt.json" -Encoding UTF8
if (-not $ready.Browser) { throw "Worker did not expose CDP; receipt: $runDir" }
Write-Output ($receipt | ConvertTo-Json -Depth 6)
