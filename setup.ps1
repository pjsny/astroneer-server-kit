# Astroneer Dedicated Server — Windows Setup Script
# Runs automatically via cloud-init on first boot.
# Can also be run manually: powershell -ExecutionPolicy Bypass -File setup.ps1

$ErrorActionPreference = "Stop"
$ProgressPreference    = "SilentlyContinue"

$SERVER_DIR    = "C:\astro-server"
$STEAMCMD_DIR  = "C:\steamcmd"
$SAVES_DIR     = "D:\SaveGames"
$SETTINGS_FILE = "D:\AstroServerSettings.ini"
$CONFIG_DIR    = "$SERVER_DIR\Astro\Saved\Config\WindowsServer"
$NSSM          = "C:\nssm\win64\nssm.exe"

function Log($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

# ── Persistent saves volume ────────────────────────────────────────────────────
Log "Initializing saves volume..."
$rawDisk = Get-Disk | Where-Object { $_.PartitionStyle -eq 'RAW' } | Select-Object -First 1
if ($rawDisk) {
    Initialize-Disk -Number $rawDisk.Number -PartitionStyle GPT -PassThru |
        New-Partition -UseMaximumSize -DriveLetter D |
        Format-Volume -FileSystem NTFS -NewFileSystemLabel "saves" -Confirm:$false | Out-Null
    Log "Volume formatted as D:"
} else {
    # Volume already initialized (server restart after a stop/start cycle)
    $offlineDisk = Get-Disk | Where-Object { $_.OperationalStatus -eq 'Offline' } | Select-Object -First 1
    if ($offlineDisk) {
        Set-Disk -Number $offlineDisk.Number -IsOffline $false
        Log "Saves volume brought online (D:)"
    } else {
        Log "Saves volume already mounted"
    }
}
New-Item -ItemType Directory -Force -Path $SAVES_DIR | Out-Null

# ── SteamCMD ──────────────────────────────────────────────────────────────────
Log "Downloading SteamCMD..."
New-Item -ItemType Directory -Force -Path $STEAMCMD_DIR | Out-Null
Invoke-WebRequest -Uri "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip" `
    -OutFile "$STEAMCMD_DIR\steamcmd.zip"
Expand-Archive -Path "$STEAMCMD_DIR\steamcmd.zip" -DestinationPath $STEAMCMD_DIR -Force
Remove-Item "$STEAMCMD_DIR\steamcmd.zip"

# ── Astroneer Dedicated Server ─────────────────────────────────────────────────
Log "Downloading Astroneer Dedicated Server (Steam app 728470)..."
New-Item -ItemType Directory -Force -Path $SERVER_DIR | Out-Null
& "$STEAMCMD_DIR\steamcmd.exe" `
    '+@sSteamCmdForcePlatformType' `
    'windows' `
    '+@sSteamCmdForcePlatformBitness' `
    '64' `
    '+force_install_dir' `
    $SERVER_DIR `
    '+login' `
    'anonymous' `
    '+app_update' `
    '728470' `
    'validate' `
    '+quit'

# ── Config ─────────────────────────────────────────────────────────────────────
Log "Writing server config..."
$PUBLIC_IP = (Invoke-WebRequest -Uri "https://api.ipify.org" -UseBasicParsing).Content.Trim()
New-Item -ItemType Directory -Force -Path $CONFIG_DIR | Out-Null

# Engine.ini — port setting
@"
[URL]
Port=8777
"@ | Set-Content "$CONFIG_DIR\Engine.ini" -Encoding UTF8

# AstroServerSettings.ini — lives on the persistent volume so it survives rebuilds
if (-not (Test-Path $SETTINGS_FILE)) {
    @"
[/Script/Astro.AstroServerSettings]
PublicIP=$PUBLIC_IP
OwnerName=YOUR_STEAM_NAME
OwnerGuid=0
ServerName=My Astroneer Server
ServerPassword=
MaxPlayers=8
"@ | Set-Content $SETTINGS_FILE -Encoding UTF8
}

# Symlink settings from persistent volume into config dir
$settingsLink = "$CONFIG_DIR\AstroServerSettings.ini"
if (Test-Path $settingsLink) { Remove-Item $settingsLink -Force }
New-Item -ItemType SymbolicLink -Path $settingsLink -Target $SETTINGS_FILE | Out-Null

# Symlink SaveGames into persistent volume
$savesLink = "$SERVER_DIR\Astro\Saved\SaveGames"
if (Test-Path $savesLink) { Remove-Item $savesLink -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Split-Path $savesLink) | Out-Null
New-Item -ItemType SymbolicLink -Path $savesLink -Target $SAVES_DIR | Out-Null

# ── NSSM (Windows service manager) ────────────────────────────────────────────
Log "Installing NSSM..."
Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-2.24.zip" `
    -OutFile "C:\nssm.zip"
Expand-Archive -Path "C:\nssm.zip" -DestinationPath "C:\nssm-extract" -Force
Move-Item "C:\nssm-extract\nssm-2.24\win64" "C:\nssm\win64"
Remove-Item "C:\nssm-extract", "C:\nssm.zip" -Recurse -Force

Log "Registering Astroneer Windows service..."
& $NSSM install astroneer "$SERVER_DIR\AstroServer.exe"
& $NSSM set astroneer AppDirectory $SERVER_DIR
& $NSSM set astroneer DisplayName "Astroneer Dedicated Server"
& $NSSM set astroneer Description "Astroneer Dedicated Server — managed by astro-server-kit"
& $NSSM set astroneer Start SERVICE_AUTO_START
& $NSSM set astroneer AppStdout "$SERVER_DIR\Astro\Saved\Logs\service.log"
& $NSSM set astroneer AppStderr "$SERVER_DIR\Astro\Saved\Logs\service-err.log"

# ── Firewall ───────────────────────────────────────────────────────────────────
Log "Opening Astroneer ports in Windows Firewall..."
New-NetFirewallRule -DisplayName "Astroneer TCP 8777" -Direction Inbound `
    -Protocol TCP -LocalPort 8777 -Action Allow | Out-Null
New-NetFirewallRule -DisplayName "Astroneer UDP 8777" -Direction Inbound `
    -Protocol UDP -LocalPort 8777 -Action Allow | Out-Null

# ── Start ──────────────────────────────────────────────────────────────────────
Log "Starting Astroneer server..."
Start-Service astroneer

Write-Host ""
Write-Host "Done! Server is running at $PUBLIC_IP:8777" -ForegroundColor Green
