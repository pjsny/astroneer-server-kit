# Update Astroneer Dedicated Server to the latest version.
# Run via SSH: powershell -ExecutionPolicy Bypass -File C:\astro-setup\update.ps1

$ErrorActionPreference = "Stop"
$ProgressPreference    = "SilentlyContinue"

Write-Host "==> Stopping server..." -ForegroundColor Cyan
Stop-Service astroneer

Write-Host "==> Updating server files via SteamCMD..." -ForegroundColor Cyan
& "C:\steamcmd\steamcmd.exe" `
    '+@sSteamCmdForcePlatformType' `
    'windows' `
    '+@sSteamCmdForcePlatformBitness' `
    '64' `
    '+force_install_dir' `
    'C:\astro-server' `
    '+login' `
    'anonymous' `
    '+app_update' `
    '728470' `
    'validate' `
    '+quit'

Write-Host "==> Starting server..." -ForegroundColor Cyan
Start-Service astroneer

Write-Host "Done! Server updated and running." -ForegroundColor Green
