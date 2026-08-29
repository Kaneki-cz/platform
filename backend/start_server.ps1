# start_server.ps1
#
# Keeps the FastAPI backend running forever on this machine: launches
# run_prod.py, and if it ever crashes (or is killed), waits 5 seconds and
# starts it right back up — instead of the server just staying down until
# someone notices. Meant to be launched once by a Task Scheduler entry with
# an "At system startup" trigger (see ALWAYS_ON_DEPLOYMENT.md), so the
# server also comes back automatically after a reboot with zero manual steps.
#
# Logs go to backend/logs/, one file per run, so a crash can be diagnosed
# after the fact instead of just seeing "it restarted".

$ErrorActionPreference = "Continue"

$backendDir = "D:\platform\backend"
$venvPython = Join-Path $backendDir ".venv\Scripts\python.exe"
$logDir = Join-Path $backendDir "logs"

Set-Location $backendDir
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

if (-not (Test-Path $venvPython)) {
    throw "Python venv not found at $venvPython — has the venv been created here (python -m venv .venv)?"
}

while ($true) {
    $timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
    $logFile = Join-Path $logDir "server_$timestamp.log"

    "$(Get-Date): starting server (log: $logFile)" | Out-File -FilePath $logFile -Append
    & $venvPython run_prod.py *>> $logFile

    "$(Get-Date): server process exited — restarting in 5 seconds..." | Out-File -FilePath $logFile -Append
    Start-Sleep -Seconds 5
}
