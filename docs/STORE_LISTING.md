# App Store Listing — bibliophil

Copy-paste source for App Store Connect. Character limits noted; all drafts are
within limits.

## App name (max 30)
`bibliophil`

> Note: the name must be globally unique in the App Store. If "bibliophil" is
> taken, fallbacks: `bibliophil — reading log`, `bibliophil: book tracker`.

## Subtitle (max 30)
`Track every book, by the minute`

## Promotional text (max 170, editable any time without review)
`Reading more this year? Set a daily minutes goal, run the timer, and watch your streak grow. Import your history from another app in seconds.`

## Keywords (max 100, comma-separated, no spaces)
`reading tracker,book log,reading goal,reading timer,books,ISBN,reading stats,bookshelf,streak,TBR,habit`

## Description (max 4000)
```
bibliophil is a calm, private reading tracker for people who read more than one
book at a time and want to build a daily habit.

TRACK MANY BOOKS AT ONCE
Add as many titles as you like and read them in parallel. Each book keeps its own
progress, history, and notes.

TIME YOUR READING
Start the built-in timer when you sit down to read, or log a past session by hand
with the exact date and duration. Backfilling old sessions rebuilds your stats and
streak.

BRING YOUR HISTORY WITH YOU
Switching from another app? Import your reading history from a CSV file. Sessions
with a date and duration restore your streak and charts — so you don't start from
zero.

SET A DAILY GOAL
Choose a target of minutes per day. A home-screen widget and a progress ring show
how close you are, and your streak counts every day you hit it.

SEE YOUR PROGRESS
Daily, weekly, monthly, and yearly statistics show total time, average per day,
days read, and a clear chart with your goal line.

FIND ANY BOOK
Search by ISBN, title, or author. Covers and details come from Google Books and
Open Library.

PRIVATE BY DESIGN
No account, no ads, no tracking. Your reading data stays on your device.
```

## What's New (version 1.0)
```
First release of bibliophil:
• Track unlimited books at once
• Reading timer + manual past-session logging
• Import your reading history from CSV
• Daily / weekly / monthly / yearly stats
• Daily minutes goal with home-screen widget
• Search by ISBN, title, or author
```

## App information
- **Category (primary):** Lifestyle (matches `LSApplicationCategoryType` in project.yml)
- **Category (secondary, optional):** Productivity
- **Content rating:** 4+ (no objectionable content)
- **Price:** Free
- **Bundle ID:** `com.ymga.bibliophil`
- **SKU:** `bibliophil-001` (any unique string)

## URLs
- **Support URL:** required — e.g. a GitHub repo README or a simple page. Placeholder: `https://github.com/<you>/bibliophil`
- **Marketing URL:** optional
- **Privacy Policy URL:** required — host `docs/PRIVACY_POLICY.md` somewhere public (GitHub Pages, gist, or any static host) and paste that URL.

## App Privacy answers (App Store Connect → App Privacy)
Answer the questionnaire as **"Data Not Collected."**
- Data collected: **No.** The app has no account and no server.
- Note for review: book searches send only the typed query to Google Books /
  Open Library and are not linked to any identifier. This is a third-party API
  call, not data collection by the app, so "Data Not Collected" is correct.

## Screenshots
Provided at App Store size **1290 × 2796 (6.7")** in `docs/screenshots/`:
1. `01-library.png` — Library with multiple books in progress
2. `02-stats.png` — Weekly stats chart + streak
3. `03-goal.png` — Daily goal ring ("Goal hit")

6.7" screenshots satisfy the current iPhone requirement. (Optional: add 6.5"
1284×2778 by re-running on an iPhone 14 Plus simulator if you want both sets.)
