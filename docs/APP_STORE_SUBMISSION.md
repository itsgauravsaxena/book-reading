# App Store Submission Checklist — bibliophil

Your 2015 Mac can't run the Xcode version Apple requires for uploads, so builds go
through **GitHub Actions** (a cloud Mac). This is already configured
(`.github/workflows/ios-release.yml` + `fastlane/`). The steps below are the ones
only you can do, because they need your Apple account and your GitHub account.

Do them in order. Steps 1–4 are one-time setup; step 5 ships the build.

---

## 1. Apple Developer portal — Identifiers
https://developer.apple.com/account → Certificates, Identifiers & Profiles → Identifiers

- [ ] **App Group:** create `group.com.ymga.bibliophil`
- [ ] **App ID** `com.ymga.bibliophil` → enable **App Groups**, assign the group above
- [ ] **App ID** `com.ymga.bibliophil.widget` → enable **App Groups**, assign the same group

(Sign in with Apple is NOT needed — the app has no accounts yet.)

## 2. App Store Connect — app record + API key
https://appstoreconnect.apple.com

- [ ] **My Apps → + → New App**
  - Platform: iOS
  - Name: `bibliophil` (must be globally unique — see fallbacks in STORE_LISTING.md)
  - Primary language: English
  - Bundle ID: `com.ymga.bibliophil`
  - SKU: `bibliophil-001`
- [ ] **Users and Access → Integrations → App Store Connect API → Team Keys → +**
  - Access: **App Manager**
  - Download the `.p8` file (you can only download it ONCE)
  - Note the **Key ID** and the **Issuer ID** (shown above the key list)
- [ ] Note your **Team ID**: App Store Connect → top-right → Membership, or the
  developer portal Membership page (10 characters)

## 3. Two GitHub repositories
- [ ] **App repo** — push this project to it:
  ```bash
  cd /Users/gsa/projects/ai/book-reading
  git remote add origin https://github.com/<you>/bibliophil.git
  git push -u origin main
  ```
- [ ] **Certificates repo** — create a **separate, private, empty** repo, e.g.
  `bibliophil-certs`. fastlane **match** stores your signing certificate and
  provisioning profiles here (encrypted). Do not put anything in it yourself.

## 4. GitHub Actions secrets (App repo → Settings → Secrets and variables → Actions)

Add these **Repository secrets**:

| Secret | Value |
|---|---|
| `ASC_KEY_ID` | Key ID from step 2 |
| `ASC_ISSUER_ID` | Issuer ID from step 2 |
| `ASC_KEY_P8` | base64 of the `.p8`: `base64 -i AuthKey_XXXXXX.p8 \| pbcopy` |
| `TEAM_ID` | your 10-char Team ID |
| `MATCH_GIT_URL` | HTTPS URL of the **certificates** repo |
| `MATCH_PASSWORD` | a passphrase you invent (remember it — it encrypts the certs) |
| `MATCH_GIT_BASIC_AUTHORIZATION` | base64 of `githubusername:PAT` where PAT is a GitHub Personal Access Token with `repo` scope: `echo -n 'user:ghp_xxx' \| base64` |

Add this **Repository variable** (Variables tab, not Secrets):

| Variable | Value |
|---|---|
| `MATCH_READONLY` | `false` ← for the FIRST run only, so match can create the cert. After the first successful run, set it to `true` (or delete it). |

## 5. Run the release

- [ ] App repo → **Actions** tab → **iOS Release** workflow → **Run workflow**
  - lane: **beta** (uploads to TestFlight first — recommended) or **release**
- [ ] First run will: generate the signing cert into your certs repo, build the
  `.ipa` on the cloud Mac, and upload to App Store Connect.
- [ ] After it succeeds, set `MATCH_READONLY` variable to `true`.

## 6. Finish the listing in App Store Connect
Use `docs/STORE_LISTING.md` for the copy and `docs/screenshots/` for images.

- [ ] Description, subtitle, promotional text, keywords, What's New
- [ ] Upload the three screenshots (1290×2796)
- [ ] Support URL + **Privacy Policy URL** (host `docs/PRIVACY_POLICY.md` publicly first)
- [ ] App Privacy: answer **"Data Not Collected"** (see STORE_LISTING.md)
- [ ] Pricing: Free
- [ ] Select the build that appears (from step 5), then **Add for Review →
  Submit**

---

## Notes / troubleshooting
- **Why cloud builds?** This Mac (Monterey 12) can't run the Xcode that App Store
  uploads now require. The CI runner uses a current macOS + Xcode. Nothing about
  the app forces this — it's purely the build machine.
- **First match run fails with "no certificate"** → confirm `MATCH_READONLY` is
  `false` for that first run.
- **Upload rejected "bundle ID doesn't match"** → the App Store Connect app record
  bundle ID must be exactly `com.ymga.bibliophil`.
- **Re-running builds:** the build number auto-increments from the GitHub run
  number (see `fastlane/Fastfile`), so you won't hit "build already exists."
- **Local build/run (for development only):** see the project memory / `project.yml`;
  `xcodegen generate` then build the `Paged` scheme. The CLI Mac can run the app in
  the Simulator, just not upload to the store.
