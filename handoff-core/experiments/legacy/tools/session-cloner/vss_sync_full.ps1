$s = (Get-WmiObject -List Win32_ShadowCopy).Create("C:\", "ClientAccessible")
$shadow = Get-WmiObject Win32_ShadowCopy | Where-Object { $_.ID -eq $s.ShadowID }
$vol = $shadow.DeviceObject + "\"

Write-Host "Shadow Volume: $vol"

$username = if ($env:USERNAME) { $env:USERNAME } else { "User" }
$src = "$vol\Users\$username\AppData\Local\Google\Chrome\User Data"
$dst = "C:\code\Chat-Codex\cloned-profile-slim"

# Ensure destination exists
if (Test-Path $dst) {
    # Remove old profile contents
    Remove-Item -Path "$dst\*" -Recurse -Force -ErrorAction SilentlyContinue
} else {
    New-Item -ItemType Directory -Path $dst -Force | Out-Null
}

New-Item -ItemType Directory -Path "$dst\Default\Network" -Force | Out-Null

Write-Host "Copying Local State..."
cmd.exe /c "copy /y `"$src\Local State`" `"$dst\Local State`""

Write-Host "Copying Cookies..."
cmd.exe /c "copy /y `"$src\Default\Network\Cookies`" `"$dst\Default\Network\Cookies`""

Write-Host "Copying Preferences & Login Data & Web Data..."
cmd.exe /c "copy /y `"$src\Default\Preferences`" `"$dst\Default\Preferences`""
cmd.exe /c "copy /y `"$src\Default\Login Data`" `"$dst\Default\Login Data`""
cmd.exe /c "copy /y `"$src\Default\Web Data`" `"$dst\Default\Web Data`""

Write-Host "Copying Local Storage..."
cmd.exe /c "xcopy /e /i /y /q `"$src\Default\Local Storage`" `"$dst\Default\Local Storage`""

Write-Host "Copying IndexedDB..."
cmd.exe /c "xcopy /e /i /y /q `"$src\Default\IndexedDB`" `"$dst\Default\IndexedDB`""

# Delete shadow copy
$shadow.Delete()
Write-Host "Shadow copy deleted. VSS sync complete!"
