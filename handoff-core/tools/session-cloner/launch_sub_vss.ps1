# Compatibility entry: never replaces an existing profile.
param([string]$TargetDir='', [int]$Port=9231, [string]$ConfigPath=$env:HANDOFF_CONFIG, [switch]$DryRun, [switch]$Visible)
& (Join-Path $PSScriptRoot 'reproduce_profile_capsule.ps1') @PSBoundParameters
