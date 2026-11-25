# Prediction Lab v3 — Pocket Taps + Instagram Bio Bridge

This is an independent magic prediction app. It keeps the original live reveal page and all-tap pocket controls, and **adds a local worker that attempts to update your real Instagram bio**.

**Important:** We built and tested the app/bridge protocols, but have NOT tested an actual Instagram edit, because that requires your Instagram session. The browser interface may change, and an Instagram security checkpoint can stop automation. Instagram's public API does not offer supported biography editing. This browser-automation integration is unofficial and could cause Instagram to limit your account. Use a dedicated test account.

## What is included

- `server.js` — same Render-hosted Node server as v2, plus authenticated Instagram job/status endpoints
- `public/pocket` route — 1–4 taps for suit, pause about 0.95s, 1–13 taps for rank, pause to send; hold 1.5s to arm and 2.5s to undo
- `public/perform` route — manual card, number, word predictions and status check
- `public/reveal` route — working public prediction page (independent of Instagram)
- `instagram-worker/` — a separate **Windows/macOS/Linux** program that controls a normal Chromium browser using Playwright and its own locally saved login session. It never asks for or sends your Instagram password to Render.
- `test/` — 60 passing automated tests for card capture, web app, and bridge job lifecycle
- `render.yaml` — Render configuration

## How it works

```
Your iPhone /pocket → Render /api/publish → website /reveal updates
                                   |
                                   └→ queued bio-change job
                                            |
             Windows PC instagram-worker polls Render using a separate secret
                                            |
             Logged-in Chromium opens your Instagram Edit Profile and saves bio
                                            |
             Worker checks readback; tries verifying as a logged-out spectator
                                            |
             Render reports status to /perform and /pocket
```

The Render app DOES NOT store your Instagram password, cookies, or browser profile. Browser login and session are saved only in `instagram-worker/.instagram-session` on your local computer. Do not share that folder.

## Update your existing Render deployment

Your current website is `https://prediction-lab-pocket.onrender.com`.

1. Extract `prediction-lab-instagram-bridge.zip` into a folder on your Windows computer.
2. On GitHub, open the repository connected to your existing Render service. Upload/replace the files from **inside** the extracted folder. Make sure `server.js`, `package.json`, `render.yaml`, `public/`, `test/`, and `instagram-worker/` appear at the **repository root**. Do not upload a surrounding extra folder. Do not upload `instagram-worker/.env` or `.instagram-session`.
3. Generate a separate strong shared secret in PowerShell (Node.js installed):

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

4. In **Render Dashboard → your existing web service → Environment**, add `INSTAGRAM_BRIDGE_KEY` with that exact secret as the value. Leave the existing `PERFORMER_PIN` unchanged.
5. Save the new environment variable and deploy the latest GitHub commit (Render may deploy automatically).
6. Open `https://prediction-lab-pocket.onrender.com/healthz`. It should return `{"ok":true,"bridgeConfigured":true}`. If it says `false`, the new secret has not been set on the deployed service. If it says File not found, check the GitHub root folder structure.

**Do not put passwords, Instagram cookies, your PIN, or your bridge secret in GitHub.** Your PIN and bridge key must be DIFFERENT.

## Start the Instagram worker on your Windows PC

The worker runs **on your computer**, not on the Render free web service. Keep the computer awake and the worker terminal open during a performance.

1. Open Windows Explorer in the extracted folder, go inside `instagram-worker`, click the address bar, type `powershell`, and press Enter.
2. Install the worker software and browser:

   ```powershell
   npm install
   npx playwright install chromium
   ```

3. Make your private configuration file:

   ```powershell
   Copy-Item .env.example .env
   notepad .env
   ```

4. In Notepad, edit the three lines and save:

   ```text
   LAB_SERVER_URL=https://prediction-lab-pocket.onrender.com
   INSTAGRAM_BRIDGE_KEY=PASTE_THE_SAME_RANDOM_KEY_YOU_SET_IN_RENDER
   INSTAGRAM_USERNAME=YOUR_INSTAGRAM_TEST_ACCOUNT_USERNAME
   ```

   Do not include an `@` before the username. Use a dedicated test Instagram account, and do not upload `.env` anywhere.

5. Run the one-time interactive login:

   ```powershell
   npm run login
   ```

   Chromium opens instagram.com. **Log into your own test account in the browser**, complete any two-factor check normally, visit your profile to confirm the username, then return to PowerShell and press Enter. Your browser session stays in the local `.instagram-session` folder. We never ask for a password in our app.

6. Start the worker:

   ```powershell
   npm run worker
   ```

   Keep this PowerShell window open. It polls the Render server every ~2.5 seconds for new predictions. Leave the separate browser window open. If Windows sleeps or this process closes, Instagram updates stop. You can close the worker with Ctrl+C.

7. On your iPhone open `https://prediction-lab-pocket.onrender.com/pocket`, enter the Render performer PIN and choose Enter pocket mode. On your computer open `/perform`, enter the PIN, and click **Check Instagram connection**. You should see **Worker online**.

## Try an actual Instagram update

1. In `/perform` choose the Queen of Hearts, or use `/pocket`: hold 1.5s, tap 3 times (Hearts), pause ~1s, tap 12 times (Queen), pause ~1s.
2. `/reveal` should display the prediction immediately.
3. `/perform` and `/pocket` status progresses through **QUEUED**, **WORKING**, then:
   - **VERIFIED PUBLIC** — worker found exact bio on the public profile from a separately logged-out browser.
   - **SAVED UNVERIFIED** — bio was read back from Instagram's Edit Profile screen, but a logged-out view was unavailable or didn't show the prediction. **Check it manually on a separate phone before performing.**
   - **LOGIN REQUIRED** — sign in again with `npm run login`, then republish the card.
   - **FAILED** — the editor could not be found, Instagram rejected the edit, or readback did not match. Check the worker console.
   - **WORKER OFFLINE** — computer/terminal is off or cannot reach Render.
4. Have a friend visit your **real Instagram profile** on their phone and refresh. The bio may take extra time to propagate or Instagram may reject repeated changes.

## What this does not guarantee

- **No official Instagram integration.** This uses visible browser clicks with Playwright, and Instagram can change the layout, require challenges, block automation, or limit profile editing. No attempt is made to bypass those protections. Instagram's terms restrict unauthorized automation.
- **No unattended cloud worker.** Your PC must stay on, awake, connected, and running the browser worker. For a future fully cloud-hosted version, a separately secured worker with persistent browser-session storage would be needed; Render Free is not suitable for it.
- **No guaranteed live success.** The public prediction page updates independently, even if Instagram fails. The server never reports VERIFIED PUBLIC unless the worker observes the exact bio in the logged-out profile header.
- **No automatic restoration.** Clearing the prediction from `/perform` does not restore the Instagram bio. You can manually edit your original bio after performing.
- **No permanent queue on free Render.** Pending jobs and reveal text live in memory. Render restarts will erase them. The worker must be online during the trick.
- **Touch still requires an unlocked phone.** Web apps cannot collect pocket taps while the phone is locked or Safari is backgrounded.

## Troubleshooting

- `/healthz` returns `bridgeConfigured:false`: add `INSTAGRAM_BRIDGE_KEY` to Render and redeploy.
- **Worker offline**: check `npm run worker` stays running; ensure `.env` has matching key and URL.
- **Bridge authentication failed (401)**: check key exactly matches Render Environment, restart worker after changing it.
- **No Edit Profile button**: you likely signed in as a different account, Instagram requires a login check, or its interface changed. Run `npm run login` again (after stopping the worker); inspect the visible browser.
- **Bio saved but not verified publicly**: Instagram may block anonymous browsers. Open the real Instagram profile from a different phone yourself to confirm.
- **Editor cannot find Save/Submit**: Instagram changed the edit layout. You may need to adjust selectors in `instagram-worker/instagram.js`.
- **Error File not found**: verify `public/pocket.html` etc. reside directly under `public/` in GitHub, alongside `server.js` at root.
- **Playwright missing browser**: run `npx playwright install chromium` inside `instagram-worker`.
- **Instagram flagged activity**: stop the worker and follow Instagram's normal account recovery/security instructions. Do not repeatedly attempt to bypass restrictions.

## Test without Instagram

From the project root, run:

```powershell
$env:PERFORMER_PIN="test-pin-123456"
$env:INSTAGRAM_BRIDGE_KEY="another-independent-long-test-secret"
npm test
npm start
```

Then visit `http://localhost:3000/perform`. Tests cover the job/status bridge without accessing Instagram. The real Instagram editing flow requires interactive testing with your own test account, and the project has not performed such a test for you.

## Security recommendations

Use a strong unique performer PIN and bridge key. Keep `.env`, `.instagram-session`, and `node_modules` private. Do not share screenshots containing secrets. Run a dedicated Instagram account. For public production use, add durable storage and stronger authentication; this is a personal experimental performance app, not a hardened multi-user service.
