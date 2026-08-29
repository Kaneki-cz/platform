# Running this backend permanently off this laptop

This turns the laptop into a (mostly) always-on server for the Physics
Platform backend, without paying for hosting: the FastAPI app + Postgres
stay running locally, [Tailscale Funnel](https://tailscale.com/) gives it a
real public HTTPS URL without opening any port on the router, Task Scheduler
brings the server back automatically after any reboot/crash, and a daily
backup script protects the database against a dead disk.

**Honest limitation, read this first:** this is a laptop on home power/internet,
not a datacenter. A power cut, an ISP outage, or a forced Windows Update
restart will take the app down until the laptop is back online — Task
Scheduler brings the *server* back automatically once Windows boots, but it
can't bring the *electricity or internet* back. Treat this as a good, free
way to run the app for real use at small scale (a class, a small team), not
as something with uptime guarantees.

Run every command below in **PowerShell as Administrator** unless said
otherwise (right-click the Start button → "Terminal (Admin)" or search
"PowerShell" → right-click → "Run as administrator").

---

## 1. Stop the laptop from sleeping

The server is only "always on" if the laptop itself never sleeps.

- **Settings → System → Power & battery → Screen and sleep** → set both
  "On battery, put my device to sleep" and "When plugged in, put my device
  to sleep" to **Never**. (Keep the *screen* turning off is fine and saves
  power — it's *sleep* that must be off.)
- **Control Panel → Hardware and Sound → Power Options → "Choose what
  closing the lid does"** → set "When I close the lid: Plugged in" to
  **Do nothing**. This only matters if you'll actually close the lid while
  it's running as a server — leave it plugged in either way.
- Keep the charger connected permanently. If your laptop brand has a
  battery-care / battery-conservation setting in its own app (common on
  Lenovo/ASUS/Dell/HP), turn it on — it caps charging around 60-80% to
  protect battery health when a laptop stays plugged in 24/7 for a long time.

## 2. Confirm Postgres survives a reboot on its own

Postgres needs to already be up before the backend tries to connect —
independent of anyone logging into Windows.

1. Press `Win+R`, type `services.msc`, Enter.
2. Find the service named like `postgresql-x64-<version>`.
3. Right-click → Properties → **Startup type: Automatic** (not "Automatic
   (Delayed Start)" or "Manual"). Click OK.

If it's already set to Automatic, nothing to do here.

## 3. The always-on server scripts

Three new files were added to `backend/`:

- **`run_prod.py`** — same as `run_dev.py` but without `--reload` (a
  long-running server shouldn't be watching files for changes).
- **`start_server.ps1`** — runs `run_prod.py` in a loop: if it ever crashes,
  it restarts it 5 seconds later automatically, and logs each run to
  `backend/logs/`.
- **`backup_db.ps1`** — daily database backup (see step 6).

Register `start_server.ps1` to launch at every Windows startup, run as
SYSTEM so it doesn't need anyone logged in:

```powershell
schtasks /create /tn "PhysicsPlatformServer" /tr "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"D:\platform\backend\start_server.ps1\"" /sc onstart /ru SYSTEM /rl HIGHEST /f
```

Start it right now, without rebooting, to test it:

```powershell
schtasks /run /tn "PhysicsPlatformServer"
```

Check it's actually up:

```powershell
curl http://localhost:8000/health
```

You should get back `{"status":"ok","environment":"development"}`. If not,
check the newest file in `backend\logs\` for the error.

To stop it (e.g. before restarting it manually while debugging):

```powershell
schtasks /end /tn "PhysicsPlatformServer"
```

(That kills the current `python.exe run_prod.py` process; since the task
itself already returned, it will NOT auto-restart — the restart loop only
applies to the process *inside* one run of start_server.ps1, not the
scheduled task itself.)

## 4. Install Tailscale and turn on Funnel

This gives the laptop a stable public HTTPS address
(`https://<name>.<tailnet>.ts.net`) without touching the router at all —
no port forwarding, no dealing with your ISP's dynamic IP or CGNAT.

1. Download and install Tailscale for Windows: https://tailscale.com/download
2. Sign in when prompted (free personal plan — no credit card, no domain
   needed). This can be your personal Google/Microsoft/GitHub account; it
   just identifies your laptop as a device on your own private "tailnet".
3. In PowerShell:
   ```powershell
   tailscale up
   ```
   (Opens a browser tab to confirm login, if not already signed in from
   step 2.)
4. Turn on Funnel for the backend's port 8000, running in the background
   so it survives reboots:
   ```powershell
   tailscale funnel --bg --https=443 localhost:8000
   ```
   The first time you run this it may open a browser tab asking you to
   approve enabling Funnel for your tailnet — approve it, that's a one-time
   step.
5. Check the public URL it assigned:
   ```powershell
   tailscale funnel status
   ```
   It'll look like `https://your-laptop-name.tailXXXXX.ts.net` — that's
   the real public HTTPS address for the backend now. Test it:
   ```powershell
   curl https://your-laptop-name.tailXXXXX.ts.net/health
   ```

No backend code changes were needed for this — `app/main.py` already
allows all origins (`allow_origins=["*"]`) and there's no restriction on
the `Host` header, so requests arriving via the Funnel URL work exactly
like requests to `localhost:8000`.

## 5. Point the mobile app at the new URL

The app already has exactly the screen built for this — no rebuild needed:

1. Open the app → **Profile → Server Settings** (the screen added earlier
   in this project specifically for pointing the app at a different backend
   URL without rebuilding).
2. Paste the Tailscale Funnel URL from step 4
   (`https://your-laptop-name.tailXXXXX.ts.net`).
3. Save. The app now talks to the laptop over the internet instead of your
   local Wi-Fi — this works from anywhere, not just on the same network.

This has to be set once per phone/install that uses the app (each install
remembers its own override).

## 6. Daily database backups

Register the backup script to run every night at 3 AM:

```powershell
schtasks /create /tn "PhysicsPlatformBackup" /tr "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"D:\platform\backend\backup_db.ps1\"" /sc daily /st 03:00 /ru SYSTEM /rl HIGHEST /f
```

Run it once by hand now to make sure it works:

```powershell
schtasks /run /tn "PhysicsPlatformBackup"
```

Then check `backend\backups\` for a new `physics_db_<timestamp>.zip` file.

**This alone is not a real backup** — it's a second copy on the *same*
disk. If the SSD dies, this folder dies with it. Point your existing
OneDrive (comes with Windows) or Google Drive desktop app at this folder
so copies leave the machine automatically:

- Easiest: move the `backend\backups` folder to be *inside* your OneDrive
  folder (e.g. `C:\Users\<you>\OneDrive\physics-platform-backups`), then
  edit `$backupDir` at the top of `backup_db.ps1` to that new path. OneDrive
  syncs it to the cloud automatically from then on.

## 7. What's still a real risk

- **Windows Update forced restarts**: the scheduled task brings the server
  back up automatically after any restart, but there will be a gap (usually
  a few minutes) while it's rebooting. Set **Settings → Windows Update →
  Pause updates** for a week at a time if you want tighter control over
  when restarts happen, or set active hours to a time nobody's using the
  app.
- **Uploaded lecture videos live on this disk** (`backend/media/`, per
  `app/main.py`) and are NOT covered by `backup_db.ps1` (that's the
  database only — accounts, progress, chat history). If you upload videos
  through the admin panel, back that folder up separately (same
  OneDrive-folder trick works for it too) — a 256GB SSD also fills up
  faster than you'd expect once a few lecture videos are on it, so keep an
  eye on free space.
- **Upload bandwidth**: home internet is usually much slower uploading than
  downloading. If several students use the AI photo-question feature at
  the same time, that's what will bottleneck first — not the laptop's CPU
  or RAM.
