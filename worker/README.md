# Sonnier OS — push notification backend

A small Cloudflare Worker that stores your push subscription + today's mission
state, and sends a personalized reminder a few times a day ("2 of 5 missions
left today: Career Growth, Family Experiences"). GitHub Pages is static-only
and can't do this itself, so this piece runs separately.

## One-time setup

1. **Install the Cloudflare CLI and log in** (needs a free Cloudflare account):
   ```
   cd worker
   npm install
   npx wrangler login
   ```

2. **Create the KV namespace** that stores subscriptions + today's state:
   ```
   npx wrangler kv namespace create PUSH_KV
   ```
   Copy the `id` it prints into `wrangler.toml` under `[[kv_namespaces]]`.

3. **Generate VAPID keys** (identifies this server to push services — one-time,
   reusable forever):
   ```
   npx web-push generate-vapid-keys
   ```
   This prints a public and private key.

4. **Pick an app secret** — any random string. It's sent from the frontend as
   a header so randoms can't spam your `/subscribe` and `/sync` endpoints.
   It's visible in the page source (it's a client-side app), so treat it as a
   light deterrent, not real security.

5. **Set the secrets** (never put these in `wrangler.toml`):
   ```
   npx wrangler secret put VAPID_PUBLIC_KEY
   npx wrangler secret put VAPID_PRIVATE_KEY
   npx wrangler secret put APP_SECRET
   ```

6. **Edit `wrangler.toml`**:
   - `VAPID_SUBJECT` → `mailto:your-real-email@example.com` (push services
     may contact this if something's wrong).
   - `APP_URL` → your GitHub Pages URL (already set to
     `https://cloudwithtony.github.io/Family-Kitchen-OS/`).
   - `[triggers].crons` → the UTC times you want reminders sent. The default
     is 9am / 1pm / 5pm / 9pm US Central — cron is always UTC and does **not**
     shift with daylight saving, so revisit this twice a year or pick times
     with slack built in.

7. **Deploy**:
   ```
   npx wrangler deploy
   ```
   It prints your Worker URL, like `https://sonnier-os-push.YOUR-SUBDOMAIN.workers.dev`.

8. **Wire up the frontend** — in `index.html`, fill in the three constants near
   the top of the `<script>` block:
   ```js
   const PUSH_WORKER_URL='https://sonnier-os-push.YOUR-SUBDOMAIN.workers.dev';
   const VAPID_PUBLIC_KEY='<the public key from step 3>';
   const PUSH_APP_SECRET='<the secret from step 4>';
   ```
   Commit and push — GitHub Pages redeploys automatically.

9. On your phone: add the site to your Home Screen (Share → Add to Home
   Screen on iOS), open it from there, go to Home → tap **Daily reminders**,
   and allow notifications when prompted. iOS requires 16.4+ and requires the
   app to be launched from the home screen icon, not Safari, for push to work.

## Endpoints

- `POST /subscribe` — body: the browser's `PushSubscription` JSON. Stores it.
- `POST /unsubscribe` — body: `{endpoint}`. Removes it.
- `POST /sync` — body: `{date, missions:{sec,wlth,biz,car,exp}, locked, score}`.
  Overwrites the single stored "today" state (called automatically whenever
  you check off a mission, while reminders are enabled).

All three require an `x-app-secret` header matching `APP_SECRET`.

## How the reminder decides what to say

On each cron fire, the Worker reads the last-synced state:
- No sync yet today → "You haven't checked in yet today."
- Missions still open and the day isn't locked → lists which ones are left.
- All 5 done, or the day is locked in → sends nothing (no nag).

## Local dev

```
npx wrangler dev
```
Runs the Worker locally; point `PUSH_WORKER_URL` at the printed `localhost`
URL temporarily to test end-to-end without deploying.
