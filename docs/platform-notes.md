# Platform notes

Living document for per-platform upload flows, selectors, and limits.
When a platform redesigns its upload page, fix the `SELECTORS` object at the
top of the matching file in `src/uploaders/` and update the "last verified"
date here. Until a driver is verified, expect the clipboard fallback to fire —
that is by design: staging never dead-ends, worst case you paste manually.

| Platform | Driver | Upload URL | Last verified | Notes |
|---|---|---|---|---|
| Bilibili | `bilibili.js` | member.bilibili.com/platform/upload/video/frame | ⚠️ unverified | Most automation-tolerant. Tags entered one-by-one with Enter. |
| Douyin | `douyin.js` | creator.douyin.com/creator-micro/content/upload | ⚠️ unverified | Caption is contenteditable; hashtags typed as `#tag` + Escape to commit chip. |
| Xiaohongshu | `xiaohongshu.js` | creator.xiaohongshu.com/publish/publish | ⚠️ unverified | Fussiest editor + strictest bot detection. Title hard-capped at 20 chars. |
| Instagram | `instagram.js` | instagram.com (New post dialog) | ⚠️ unverified | Multi-step dialog (crop → edit → caption). Changes often. |
| TikTok | `tiktok.js` | tiktok.com/tiktokstudio/upload | ⚠️ unverified | Upload form sometimes inside an iframe; driver checks both. |
| YouTube | `youtube.js` | youtube.com/upload → Studio dialog | ⚠️ unverified | Most stable flow. Draft is auto-saved; user completes Details → Visibility. |

## Approximate platform limits (encoded in `src/db/seed.js`)

| Platform | Preferred ratio | Video size | Duration | Title limit |
|---|---|---|---|---|
| Bilibili | 16:9 (vertical ok) | ~8 GB | long-form ok | 80 chars |
| Xiaohongshu | 3:4 / 9:16 | ~2 GB | ≤ ~15 min | 20 chars |
| Douyin | 9:16 | ~4 GB | short preferred | 30 chars |
| Instagram Reels | 9:16 | ~4 GB | ≤ ~3 min | caption only |
| TikTok | 9:16 | ~4 GB | ≤ ~10 min (web) | caption only |
| YouTube | 16:9 (Shorts 9:16 ≤ 3 min) | effectively none | none | 100 chars |

Verify these against current platform docs — they change.

## Anti-detection posture

- Real persistent Chromium profile per platform (`data/profiles/<id>`) — real
  cookies, real fingerprint, logins survive restarts.
- Headed browser; a human always clicks the final Publish button.
- ≥60s throttle between stagings (Settings); one platform at a time.
- If a session expires, staging reports "not logged in" and leaves the login
  page open — scan the QR / sign in, then stage again.
