# 🎧 Promoter

Local publishing assistant for promoting French touch music across
**Bilibili, Xiaohongshu (Red Note), Douyin, Instagram, TikTok, and YouTube**.

Draft once → get six platform-tuned titles/captions/hashtags (AI, zh + en,
with a sensitive-word check for the Chinese platforms) → semi-automated
uploads (Playwright fills each platform's upload form in a logged-in browser;
**you** click Publish) → track status and schedule everything in one dashboard.

## Setup (once)

```bash
npm install
npm run install-browsers   # downloads Chromium for Playwright
npm start                  # opens http://localhost:4321
```

Then in the app:

1. **Settings** → paste your Anthropic API key (for AI caption drafting).
2. **Settings** → "Open login window" for each platform → scan QR / sign in →
   close the window. Logins persist in `data/profiles/`.

## Daily workflow

1. **Library** → new content piece: working title + master description, attach
   media by absolute file path (Finder: right-click with ⌥ Option → "Copy as
   Pathname").
2. Fill the six variant cards your way — mix and match per platform:
   - **⇩ Fill from master**: copies your master title/description straight into
     the draft, optionally shaped by a per-platform template from Settings
     (e.g. Bilibili title template `【法式电音】{title}` — `{title}` and
     `{description}` are substituted). No AI involved.
   - **Hashtag chips**: click `+ <platform> defaults` or any named group
     (managed in Settings → Hashtag library) to append its tags — no AI.
   - **Generate drafts (AI)**: optional, drafts all selected platforms at once.
   Review/edit, fix any 🚩 sensitive-word flags, set status to `ready`.
3. **🚀 Stage upload** per platform → a browser window opens with the form
   pre-filled → review and click **Publish** yourself → set status `posted`
   and paste the live URL.
4. **Calendar** to plan ahead; **Tracker** (home page) shows every piece ×
   platform at a glance plus today's queue.

If auto-fill breaks after a platform redesign, staging falls back gracefully:
the upload page stays open and the full composed caption is on your clipboard.
Selector fixes live in `src/uploaders/<platform>.js` (see
`docs/platform-notes.md`).

## Notes

- All data is local: SQLite at `data/app.db`, browser profiles at
  `data/profiles/` (both gitignored). Media files are referenced by path,
  never copied.
- Keep the app running while you publish — closing it closes the staged
  browser windows.
- Throttle between stagings is configurable in Settings (default 60s).
