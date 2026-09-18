param(
    [string]$TargetDir = "C:\code\Chat-Codex\cloned-profile-slim",
    [int]$Port = 9222
)

$seedDir = "C:\GPT-Chat-codex-handoff\master-seed-profile"

if (-not (Test-Path "$seedDir\Local State")) {
    Write-Error "Seed profile not initialized yet. Please launch master seed first and log in!"
    exit 1
}

Write-Host "Cloning from $seedDir to $TargetDir..."
if (Test-Path $TargetDir) {
    Remove-Item -Path $TargetDir -Recurse -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Path "$TargetDir\Default\Network" -Force | Out-Null

Copy-Item "$seedDir\Local State" "$TargetDir\Local State" -Force
if (Test-Path "$seedDir\Default\Network\Cookies") {
    Copy-Item "$seedDir\Default\Network\Cookies" "$TargetDir\Default\Network\Cookies" -Force
}
if (Test-Path "$seedDir\Default\Preferences") {
    Copy-Item "$seedDir\Default\Preferences" "$TargetDir\Default\Preferences" -Force
}
if (Test-Path "$seedDir\Default\Local Storage") {
    robocopy "$seedDir\Default\Local Storage" "$TargetDir\Default\Local Storage" /E /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
}
if (Test-Path "$seedDir\Default\IndexedDB") {
    robocopy "$seedDir\Default\IndexedDB" "$TargetDir\Default\IndexedDB" /E /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
}

$bytes = (Get-ChildItem -Path $TargetDir -Recurse | Measure-Object -Property Length -Sum).Sum
Write-Host "Cloned successfully! Total size: $([math]::Round($bytes / 1MB, 2)) MB"

# Generate launcher for this project
$batFile = "$TargetDir\start_project_chrome.bat"
$batContent = @"
@echo off
title Chrome Project Instance (Port $Port)
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=$Port --user-data-dir="$TargetDir" --disable-component-update --disable-features=OptimizationGuideModelDownloading,OnDeviceTailModel,OptimizationHints --disable-background-networking --disk-cache-size=10485760 --no-first-run --no-default-browser-check --hide-crash-restore-bubble "https://chatgpt.com"
"@
Set-Content -Path $batFile -Value $batContent -Encoding OEM
Write-Host "Launcher generated at: $batFile"
