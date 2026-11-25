# Prediction Lab — Pocket Edition

An independent, non-Instagram prediction app with a secret, tap-only card input. The public `/reveal` page updates as soon as the card is published. **This does not edit an actual Instagram bio.**

## What's new

- `/pocket`: full-screen, blind tap entry for any of 52 playing cards
- **Hold 1.5 seconds** to arm. Suit: **1=Clubs, 2=Diamonds, 3=Hearts, 4=Spades.**
- **Pause ~0.95 seconds** to lock suit. Rank: **1=Ace, 2–10=number, 11=Jack, 12=Queen, 13=King.**
- **Pause ~0.95 seconds** after rank to automatically publish the card to `/reveal`.
- **Hold 2.5 seconds** while armed to undo the *current input* and return to suit entry (it **does not** erase an already-published prediction).
- Input pauses its countdown while your finger is down, so an Undo hold cannot accidentally finalize a card.
- PIN is verified before entering pocket mode. A failed publication retains the card and offers a Retry button.
- `/perform`: original controls for cards, words, numbers and template customization.
- `/healthz` and `render.yaml` for Render deployment; no third-party npm dependencies.

## Run on Windows locally

1. Install Node.js v20 or newer: https://nodejs.org/en/download
2. Extract this ZIP. Open PowerShell in the `prediction-lab-pocket` directory.
3. Run:

   ```powershell
   $env:PERFORMER_PIN="demo-password-123"
   npm start
   ```

4. Open http://localhost:3000/pocket and enter the same PIN, then select **Enter pocket mode**.
5. In another browser tab, open http://localhost:3000/reveal and watch it change.
6. For the Queen of Hearts: hold 1.5s, tap **three** times, pause ~1s, tap **twelve** times, pause ~1s. Look for **Q of Hearts**.

**Important:** `localhost` works only on the computer running the server. Use the deployment instructions below to access the pages on your phone and another person's phone.

## Deploy online — Render + GitHub (step-by-step)

### A. Upload code to GitHub

1. Sign in at https://github.com . Create a repository called `prediction-lab-pocket`. A **private** repository is fine if you connect GitHub to Render.
2. In the repository, choose **Add file → Upload files**.
3. Open the extracted `prediction-lab-pocket` folder on your computer, select **all files inside** (including the `public` folder) and upload them to the **root of the repository**. The key files `server.js`, `package.json`, and `render.yaml` must be at the repository root.
4. Click **Commit changes**. Do not commit passwords or `.env` files.

**Alternative with Git command line** (in the extracted folder):

```bash
git init
git add .
git commit -m "Add pocket tap prediction app"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/prediction-lab-pocket.git
git push -u origin main
```

### B. Create your Render service

1. Sign in at https://dashboard.render.com and connect your GitHub account.
2. Choose **New → Blueprint**, then select your `prediction-lab-pocket` repository. Render reads the included `render.yaml` file.
3. Choose **Apply** / **Deploy Blueprint**. When Render requests `PERFORMER_PIN`, set a unique random secret at least **12 characters long**; do not paste it into GitHub. You will type the same secret in your phone's `/pocket` screen.
4. The blueprint uses a **Free** Node web service. Once deployed, Render provides a URL such as `https://prediction-lab-pocket-xxxx.onrender.com` (your URL will differ).
5. Open `https://YOUR-RENDER-HOST/pocket` on your own phone and `https://YOUR-RENDER-HOST/reveal` on the spectator's phone. Bookmark the pocket URL.

### C. Performance checklist

- Open both URLs before the show. Send a test card and verify that the spectator page changes.
- Keep the phone **unlocked** and keep the browser page foregrounded while entering taps. The web app cannot receive taps when the screen is locked, and iPhone Safari does not provide reliable haptics here.
- Phone touch recognition through pockets varies by fabric, case, and orientation. Practice with your actual clothing; consider a thin pocket and the screen facing your tapping finger.
- The current server keeps only **one shared prediction** in memory. Restarting or redeploying resets the public prediction. A Free Render instance can spin down after inactivity (15 minutes) and take time to wake on the first request. **For performances, consider an always-on paid instance** and open both pages in advance.
- The existing prediction remains visible if you undo after publication. To clear it, use `/perform` → **Clear prediction**.
- When you leave `/pocket` or switch tabs while entering a partial card, the browser can suspend input; resume carefully or restart capture. The page attempts to request screen wake lock where supported; it is not a guarantee against the phone locking.
- The secret PIN protects writes, but the reveal page is intentionally public; don't put sensitive information in predictions.

## Testing

```bash
npm test
```

Includes automated tests for all 52 cards, invalid tap counts, undo timing, authentication, and publishing.

## Scope and limitations

This independent prototype does **not** connect to Instagram, replace Instagram biographies, provide an App Store iPhone application, provide vibrations on iPhone, guarantee cross-fabric pocket touch recognition, or store predictions durably. A stable paid-instance deployment and a native iOS interface would be the next steps for use in professional performances.
