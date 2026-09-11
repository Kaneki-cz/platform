"""One-time helper: get a Gmail API OAuth2 refresh token for
send_verification_email()'s Gmail API path (see app/services/email_service.py
and app/core/config.py's GMAIL_OAUTH_* settings).

Run this ONCE per Google account (whichever address you want verification
emails to come from) — from a machine with a real web browser, since it
needs to pop one open for you to sign in and approve. Your Windows machine,
not the headless Hetzner server.

--- Setup (one-time, ~5 minutes) ---

1. Go to https://console.cloud.google.com/apis/credentials — any Google
   Cloud project works, e.g. the same one your Gemini API key already lives
   in. No billing/Cloud Billing needed for this at all.

2. If this project has never had an "OAuth consent screen" configured, it
   will ask you to set one up first:
     - User type: "External"
     - Fill in just the required fields (app name — anything, e.g. "Omega
       Backend" — and your own email for "User support email" and
       "Developer contact").
     - Under "Test users", add the Gmail address you're sending FROM (the
       one you want in SMTP_FROM_EMAIL) — e.g. zzzq0681@gmail.com.
     - Leave the app in "Testing" publishing status — do NOT submit it for
       Google's verification review. Testing mode works forever for this
       use case (an app only you sign into), it just shows an "unverified
       app" warning screen when you authorize below, which is expected and
       safe to click through (it's your own app, on your own project).

3. Back on the Credentials page: "+ Create Credentials" -> "OAuth client
   ID" -> Application type: "Desktop app" -> any name -> Create. Copy the
   Client ID and Client Secret it shows you.

4. Install the one extra package this script needs (already in
   requirements.txt, but in case you haven't run pip install since it was
   added):
     .venv\\Scripts\\pip install google-auth-oauthlib

5. Run this script with those two values:
     .venv\\Scripts\\python get_gmail_refresh_token.py <CLIENT_ID> <CLIENT_SECRET>

   A browser window will open — sign in with the Gmail address you added
   as a test user in step 2, click through the "Google hasn't verified this
   app" warning (Advanced -> Go to <app name> (unsafe) — this is your own
   app, that warning is just because it's not submitted for public review),
   and approve the "Send email on your behalf" permission.

6. The script prints three lines at the end — put all three in BOTH your
   local .env (D:\\platform\\backend\\.env) and the server's .env
   (/home/platform/backend/.env), then restart the backend in each place.
   The refresh token does not expire from just sitting unused, and works
   from any machine — it's tied to the Google account + this OAuth client,
   not to the machine that ran this script.
"""
import sys

from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/gmail.send"]


def main() -> None:
    if len(sys.argv) != 3:
        print("Usage: python get_gmail_refresh_token.py <CLIENT_ID> <CLIENT_SECRET>")
        print("See this file's own docstring for where to get those two values.")
        sys.exit(1)

    client_id, client_secret = sys.argv[1], sys.argv[2]
    client_config = {
        "installed": {
            "client_id": client_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": ["http://localhost"],
        }
    }
    flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
    # access_type="offline" + prompt="consent" forces Google to actually
    # hand back a refresh_token — it silently omits one on a repeat
    # authorization otherwise (e.g. if you'd already approved this app
    # before without these two flags).
    creds = flow.run_local_server(port=0, access_type="offline", prompt="consent")

    if not creds.refresh_token:
        print(
            "\nNo refresh_token came back — this usually means you'd already "
            "authorized this exact app before. Go to "
            "https://myaccount.google.com/permissions, remove this app's access, "
            "and run this script again."
        )
        sys.exit(1)

    print("\n--- Success — put these three lines in BOTH .env files, then restart ---")
    print(f"GMAIL_OAUTH_CLIENT_ID={client_id}")
    print(f"GMAIL_OAUTH_CLIENT_SECRET={client_secret}")
    print(f"GMAIL_OAUTH_REFRESH_TOKEN={creds.refresh_token}")


if __name__ == "__main__":
    main()
