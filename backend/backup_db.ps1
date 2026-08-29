# backup_db.ps1
#
# Daily Postgres backup with 14-day rotation. This exists because running
# the whole app off ONE laptop's disk means the database has no redundancy
# at all — if the SSD/HDD fails, everything (every student's account and
# progress) goes with it unless a copy exists somewhere else. This script
# only writes the copy locally (backend/backups/); see
# ALWAYS_ON_DEPLOYMENT.md for syncing that folder off this machine too
# (e.g. into a OneDrive/Google Drive folder), which is the part that
# actually protects against a dead disk.
#
# Meant to be run once a day by a Task Scheduler entry (see
# ALWAYS_ON_DEPLOYMENT.md) — safe to also run by hand any time.

$ErrorActionPreference = "Stop"

$backendDir = "D:\platform\backend"
$backupDir = Join-Path $backendDir "backups"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

# --- Parse DATABASE_URL out of .env instead of hardcoding credentials here ---
$envFile = Join-Path $backendDir ".env"
$line = Get-Content $envFile | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
if (-not $line) { throw "DATABASE_URL not found in $envFile" }
$url = $line -replace '^DATABASE_URL=', ''

if ($url -notmatch 'postgresql(\+\w+)?://([^:]+):([^@]+)@([^:/]+):?(\d*)/(\w+)') {
    throw "Could not parse DATABASE_URL from .env: $url"
}
$dbUser = $Matches[2]
$dbPass = $Matches[3]
$dbHost = $Matches[4]
$dbPort = if ($Matches[5]) { $Matches[5] } else { "5432" }
$dbName = $Matches[6]

# --- Locate pg_dump.exe ---
$pgDump = (Get-Command pg_dump -ErrorAction SilentlyContinue).Source
if (-not $pgDump) {
    $candidate = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\pg_dump.exe" -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending | Select-Object -First 1
    if ($candidate) { $pgDump = $candidate.FullName }
}
if (-not $pgDump) {
    throw "pg_dump.exe not found (not on PATH, not under C:\Program Files\PostgreSQL\*). Edit this script to set `$pgDump directly."
}

$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$sqlFile = Join-Path $backupDir "physics_db_$timestamp.sql"
$zipFile = Join-Path $backupDir "physics_db_$timestamp.zip"

$env:PGPASSWORD = $dbPass
try {
    & $pgDump -h $dbHost -p $dbPort -U $dbUser -d $dbName -f $sqlFile
    if ($LASTEXITCODE -ne 0) { throw "pg_dump exited with code $LASTEXITCODE" }
} finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

Compress-Archive -Path $sqlFile -DestinationPath $zipFile -Force
Remove-Item $sqlFile

# --- Rotation: keep the last 14 days only, so backups/ can't quietly eat the
# limited SSD space on this machine. ---
Get-ChildItem $backupDir -Filter "physics_db_*.zip" |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } |
    Remove-Item -Force

Write-Output "$(Get-Date): backup complete -> $zipFile"
