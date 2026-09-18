param(
    [string]$Target1 = "C:\code\Chat-Codex\sub-instance-1",
    [int]$Port1 = 9222,
    [string]$Target2 = "C:\code\Chat-Codex\sub-instance-2",
    [int]$Port2 = 9223
)

Write-Host "=== STEP 1: Creating VSS snapshot of Master Seed ==="
$s = (Get-WmiObject -List Win32_ShadowCopy).Create("C:\", "ClientAccessible")
$shadow = Get-WmiObject Win32_ShadowCopy | Where-Object { $_.ID -eq $s.ShadowID }
$vol = $shadow.DeviceObject + "\"

$link = "C:\vss_dual_link"
if (Test-Path $link) { cmd.exe /c "rmdir $link" }
cmd.exe /c "mklink /d $link `"$vol`""

$src = "$link\GPT-Chat-codex-handoff\master-seed-profile"

function Clone-Profile($destDir) {
    Write-Host "Cloning into $destDir..."
    if (Test-Path $destDir) { Remove-Item $destDir -Recurse -Force -ErrorAction SilentlyContinue }
    New-Item -ItemType Directory -Path "$destDir\Default\Network" -Force | Out-Null
    
    Copy-Item "$src\Local State" "$destDir\Local State" -Force
    Copy-Item "$src\Default\Network\Cookies" "$destDir\Default\Network\Cookies" -Force
    if (Test-Path "$src\Default\Preferences") {
        Copy-Item "$src\Default\Preferences" "$destDir\Default\Preferences" -Force
    }
    if (Test-Path "$src\Default\Network\Network Persistent State") {
        Copy-Item "$src\Default\Network\Network Persistent State" "$destDir\Default\Network\Network Persistent State" -Force
    }
    if (Test-Path "$src\Default\Local Storage") {
        robocopy "$src\Default\Local Storage" "$destDir\Default\Local Storage" /E /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
    }
    if (Test-Path "$src\Default\IndexedDB") {
        robocopy "$src\Default\IndexedDB" "$destDir\Default\IndexedDB" /E /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
    }
    $size = (Get-ChildItem -Path $destDir -Recurse | Measure-Object -Property Length -Sum).Sum
    Write-Host "Clone to $destDir finished! Total size: $([math]::Round($size / 1MB, 2)) MB"
}

Clone-Profile $Target1
Clone-Profile $Target2

cmd.exe /c "rmdir $link"
$shadow.Delete()
Write-Host "VSS snapshot deleted."

Write-Host "=== STEP 2: Creating launcher batch scripts ==="
$bat1 = "C:\code\Chat-Codex\start_sub1.bat"
$batContent1 = @"
@echo off
title Sub-Instance 1 (Port $Port1)
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=$Port1 --user-data-dir="$Target1" --disable-component-update --disable-features=OptimizationGuideModelDownloading,OnDeviceTailModel,OptimizationHints --disable-background-networking --disk-cache-size=10485760 --no-first-run --no-default-browser-check --hide-crash-restore-bubble "https://chatgpt.com"
"@
Set-Content -Path $bat1 -Value $batContent1 -Encoding OEM

$bat2 = "C:\code\Chat-Codex\start_sub2.bat"
$batContent2 = @"
@echo off
title Sub-Instance 2 (Port $Port2)
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=$Port2 --user-data-dir="$Target2" --disable-component-update --disable-features=OptimizationGuideModelDownloading,OnDeviceTailModel,OptimizationHints --disable-background-networking --disk-cache-size=10485760 --no-first-run --no-default-browser-check --hide-crash-restore-bubble "https://chatgpt.com"
"@
Set-Content -Path $bat2 -Value $batContent2 -Encoding OEM

# Also put desktop shortcuts for user convenience
Copy-Item $bat1 "$env:USERPROFILE\Desktop\Sub-Instance-1 (Port 9222).bat" -Force
Copy-Item $bat2 "$env:USERPROFILE\Desktop\Sub-Instance-2 (Port 9223).bat" -Force

Write-Host "=== STEP 3: Launching both sub-instances via Task Scheduler to WinSta0\Default ==="
schtasks /create /tn "LaunchSub1" /tr "$bat1" /sc once /st "00:00" /it /f | Out-Null
schtasks /run /tn "LaunchSub1" | Out-Null
Start-Sleep -Seconds 2
schtasks /delete /tn "LaunchSub1" /f | Out-Null

schtasks /create /tn "LaunchSub2" /tr "$bat2" /sc once /st "00:00" /it /f | Out-Null
schtasks /run /tn "LaunchSub2" | Out-Null
Start-Sleep -Seconds 3
schtasks /delete /tn "LaunchSub2" /f | Out-Null

Write-Host "Both instances launched successfully!"
