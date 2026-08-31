@echo off
powershell -NoProfile -Command "$b = Get-CimInstance -ClassName Win32_Battery; if ($b) { \"Battery: $($b.EstimatedChargeRemaining)%% (status code $($b.BatteryStatus))\" } else { 'No battery reported on this machine (likely a desktop, not a laptop).' }" > "%~dp0battery_status.txt"
echo Done. Result saved to battery_status.txt next to this file.
pause
