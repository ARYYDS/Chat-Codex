$s = (Get-WmiObject -List Win32_ShadowCopy).Create("C:\", "ClientAccessible")
$shadow = Get-WmiObject Win32_ShadowCopy | Where-Object { $_.ID -eq $s.ShadowID }
$vol = $shadow.DeviceObject + "\"

Write-Host "Shadow Volume: $vol"

$link = "C:\vss_tmp_link"
if (Test-Path $link) { cmd.exe /c "rmdir $link" }
cmd.exe /c "mklink /d $link `"$vol`""

$username = if ($env:USERNAME) { $env:USERNAME } else { "User" }
$src = "$link\Users\$username\AppData\Local\Google\Chrome\User Data"
$dst = "C:\code\Chat-Codex\cloned-profile-slim"

Write-Host "Copying Local Storage via Robocopy..."
robocopy "$src\Default\Local Storage" "$dst\Default\Local Storage" /E /R:1 /W:1 /NFL /NDL /NJH /NJS

Write-Host "Copying IndexedDB via Robocopy..."
robocopy "$src\Default\IndexedDB" "$dst\Default\IndexedDB" /E /R:1 /W:1 /NFL /NDL /NJH /NJS

cmd.exe /c "rmdir $link"
$shadow.Delete()
Write-Host "Done copying Local Storage & IndexedDB!"
