# Firebase setup — bibliophil web prototype

The web prototype (`web/`) is a static site that talks directly to Firebase
Authentication and Firestore from the browser — no backend server. These
steps only you can do, since they need your own Google account.

## 1. Create the Firebase project
https://console.firebase.google.com → **Add project**

- Name it anything (e.g. `bibliophil`)
- Google Analytics is optional — you can disable it
- Click **Create project**

## 2. Turn on Firestore
Build → **Firestore Database** → **Create database**

- Pick a region close to you
- Start in **production mode** (we'll paste rules below — don't leave it in
  test mode, which allows anyone to read/write)

Once created, go to the **Rules** tab and replace the contents with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

Click **Publish**. This scopes every signed-in user to their own
`users/{their uid}/...` documents — nobody can read or write another
user's library.

## 3. Turn on sign-in methods
Build → **Authentication** → **Get started**

- Enable **Email/Password**
- Enable **Google** (pick a support email when prompted)

Then go to **Authentication → Settings → Authorized domains** and add your
GitHub Pages domain, e.g. `yourusername.github.io` (`localhost` is already
included, so local testing works out of the box).

## 4. Register the web app and get the config
**Project settings** (gear icon, top left) → **General** tab → scroll to
**Your apps** → click the web icon `</>` → give it a nickname (e.g.
`bibliophil-web`) → **skip** "also set up Firebase Hosting" → **Register app**.

Firebase shows a `firebaseConfig` object like:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "bibliophil-xxxxx.firebaseapp.com",
  projectId: "bibliophil-xxxxx",
  storageBucket: "bibliophil-xxxxx.appspot.com",
  messagingSenderId: "...",
  appId: "..."
};
```

Copy those six values into `web/firebase-config.js` in this repo, replacing
the `"REPLACE_ME"` placeholders. This file is safe to commit — it's a
public client identifier, not a secret; your Firestore rules from step 2 are
what actually protects the data.

## 5. Turn on GitHub Pages (one-time)
Repo → **Settings → Pages → Source** → choose **GitHub Actions**.

The workflow at `.github/workflows/pages.yml` builds and deploys `web/`
automatically on every push to `main` that touches that folder. After the
first successful run, the live URL shows up on that same Settings → Pages
screen (typically `https://<you>.github.io/<repo>/`).

## 6. Try it
Open the deployed URL (or `web/index.html` via a local static server, e.g.
`python3 -m http.server` from the repo root, then visit
`http://localhost:8000/web/`) — create an account or continue with Google,
then use **Add sample books** in the sidebar to seed the three sample titles.

Every book, session, and goal you create is now a real Firestore document
under your account and will show up on any device you sign into.
