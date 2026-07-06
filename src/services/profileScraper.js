import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { launchProfile } from '../uploaders/baseUploader.js';
import { LOGIN_URL_HINTS } from '../uploaders/index.js';

// In-memory scrape state, polled by the source page.
// profileId -> { state: 'running'|'done'|'error', message }
export const scrapeStatus = new Map();

export function getScrapeStatus(profileId) {
  return scrapeStatus.get(Number(profileId)) || null;
}

// Kick off a background scrape of a tracked profile. Fire-and-forget; the UI
// polls scrapeStatus. Throws synchronously if one is already running.
export function startScrape(profileId) {
  const id = Number(profileId);
  if (scrapeStatus.get(id)?.state === 'running') {
    throw new Error('A scrape for this profile is already running — give it a moment.');
  }
  const profile = db
    .prepare(
      `SELECT tp.*, a.display_name AS account_name
       FROM tracked_profiles tp JOIN accounts a ON a.id = tp.account_id
       WHERE tp.id = ?`
    )
    .get(id);
  if (!profile) throw new Error('tracked profile not found');

  scrapeStatus.set(id, { state: 'running', message: `Opening ${profile.url}…` });
  runScrape(id, profile).catch((err) => {
    scrapeStatus.set(id, { state: 'error', message: String(err.message || err) });
  });
}

async function runScrape(id, profile) {
  const ctx = await launchProfile(profile.platform, profile.account_id);
  // Dedicated tab: getPage() would hijack a staging/login page in this context.
  const page = await ctx.newPage();
  let keepPageOpen = false;
  try {
    // Post payloads arrive with the initial page load too, so listen first.
    const collected = new Map(); // externalId -> { ...item, fromApi }
    installResponseListener(page, profile, collected);

    await page.goto(profile.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // The grid renders client-side; give it up to 15s before assuming the worst.
    scrapeStatus.set(id, { state: 'running', message: 'Waiting for the post grid…' });
    const gridSelector =
      profile.platform === 'instagram' ? 'a[href*="/p/"], a[href*="/reel/"]' : '[data-e2e="user-post-item"]';
    await page.waitForSelector(gridSelector, { timeout: 15000 }).catch(() => {});
    if (LOGIN_URL_HINTS.test(page.url())) {
      scrapeStatus.set(id, {
        state: 'error',
        message: `Not logged in on ${profile.platform} for ${profile.account_name} — open Settings, click Log in, then Refresh again.`,
      });
      return;
    }

    scrapeStatus.set(id, { state: 'running', message: 'Scrolling through the post grid…' });
    // Slow batches can leave the count unchanged for one round even though
    // more posts are coming — only stop after two stable checks in a row.
    let prevCount = -1;
    let stableRounds = 0;
    for (let i = 0; i < 10; i++) {
      await collectDomItems(page, profile, collected);
      if (collected.size === prevCount) {
        stableRounds += 1;
        if (stableRounds >= 2 && collected.size > 0) break;
      } else {
        stableRounds = 0;
        prevCount = collected.size;
      }
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2)).catch(() => {});
      await page.waitForTimeout(2000);
    }
    // Let in-flight API responses land before finalizing.
    await page.waitForTimeout(1000);
    await collectDomItems(page, profile, collected);

    const items = [...collected.values()];
    const existingCount = db
      .prepare('SELECT COUNT(*) AS n FROM profile_posts WHERE tracked_profile_id = ?')
      .get(id).n;

    if (!items.length) {
      // Merge-only policy: a failed scrape must never wipe what we have.
      // Leave the tab open so the user can see what the page actually showed
      // (captcha, consent dialog, private profile, …).
      keepPageOpen = true;
      await page.bringToFront().catch(() => {});
      if (existingCount > 0) {
        scrapeStatus.set(id, {
          state: 'done',
          message: `Scrape found 0 posts — kept the existing ${existingCount}. The tab was left open so you can see what the page showed.`,
        });
      } else {
        scrapeStatus.set(id, {
          state: 'error',
          message:
            'Scrape found 0 posts — the tab was left open so you can see what the page showed (captcha? private profile?). Fix it there, then Refresh again.',
        });
      }
      return;
    }

    scrapeStatus.set(id, { state: 'running', message: `Found ${items.length} posts — saving thumbnails…` });
    for (const item of items) {
      item.thumbPath = await downloadThumbnail(ctx, profile, item);
    }

    const existingIds = new Set(
      db
        .prepare('SELECT external_id FROM profile_posts WHERE tracked_profile_id = ?')
        .all(id)
        .map((r) => r.external_id)
    );
    const upsert = db.prepare(
      `INSERT INTO profile_posts (tracked_profile_id, external_id, post_url, caption, is_video, posted_at, thumb_path)
       VALUES (@profileId, @externalId, @postUrl, @caption, @isVideo, @postedAt, @thumbPath)
       ON CONFLICT(tracked_profile_id, external_id) DO UPDATE SET
         post_url   = excluded.post_url,
         caption    = CASE WHEN excluded.caption != '' THEN excluded.caption ELSE profile_posts.caption END,
         is_video   = MAX(profile_posts.is_video, excluded.is_video),
         posted_at  = COALESCE(excluded.posted_at, profile_posts.posted_at),
         thumb_path = COALESCE(excluded.thumb_path, profile_posts.thumb_path)`
    );
    db.transaction(() => {
      for (const item of items) {
        upsert.run({
          profileId: id,
          externalId: item.externalId,
          postUrl: item.postUrl,
          caption: item.caption || '',
          isVideo: item.isVideo ? 1 : 0,
          postedAt: item.postedAt || null,
          thumbPath: item.thumbPath || null,
        });
      }
      db.prepare("UPDATE tracked_profiles SET last_scraped_at = datetime('now') WHERE id = ?").run(id);
    })();

    const added = items.filter((i) => !existingIds.has(i.externalId)).length;
    scrapeStatus.set(id, { state: 'done', message: `Found ${items.length} posts (${added} new).` });
  } finally {
    if (!keepPageOpen) await page.close().catch(() => {});
  }
}

// Prefer API payloads over the DOM grid: they carry captions, dates and video
// flags that the grid lacks, and they don't break under UI localization.
function addItem(collected, item, fromApi) {
  if (!item?.externalId) return;
  const existing = collected.get(item.externalId);
  if (existing?.fromApi && !fromApi) return;
  collected.set(item.externalId, { ...item, fromApi });
}

function installResponseListener(page, profile, collected) {
  page.on('response', async (resp) => {
    try {
      const url = resp.url();
      if (profile.platform === 'instagram') {
        if (!/\/graphql\/query|\/api\/graphql/.test(url)) return;
        const json = await resp.json();
        scanInstagramJson(json, profile.username, (item) => addItem(collected, item, true));
      } else {
        if (!url.includes('/api/post/item_list')) return;
        const json = await resp.json();
        for (const item of json?.itemList || []) {
          // Only this profile's posts — related/recommended items ride along too
          const author = item.author?.uniqueId;
          if (author && author.toLowerCase() !== profile.username.toLowerCase()) continue;
          const isVideo = !item.imagePost;
          addItem(
            collected,
            {
              externalId: String(item.id),
              postUrl: `https://www.tiktok.com/@${profile.username}/${isVideo ? 'video' : 'photo'}/${item.id}`,
              caption: item.desc || '',
              isVideo,
              postedAt: item.createTime ? new Date(item.createTime * 1000).toISOString() : null,
              thumbUrl: item.video?.cover || item.video?.originCover || null,
            },
            true
          );
        }
      }
    } catch {
      // non-JSON or truncated response — the DOM fallback still applies
    }
  });
}

// Instagram renames its GraphQL wrappers often, so instead of hardcoding the
// envelope we walk the whole payload for anything shaped like a media node.
// The profile page also prefetches suggested posts/reels from OTHER accounts
// through the same GraphQL channel, so a node only counts when its owner is
// the tracked profile; nodes without an owner are left to the DOM fallback.
// Matched nodes are not recursed into: carousel children carry their own
// shortcodes and would otherwise show up as extra posts.
function scanInstagramJson(value, username, emit) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const v of value) scanInstagramJson(v, username, emit);
    return;
  }
  const shortcode = value.shortcode || value.code;
  if (typeof shortcode === 'string' && (value.is_video !== undefined || value.media_type !== undefined)) {
    const owner = value.owner?.username || value.user?.username;
    if (!owner || owner.toLowerCase() !== username.toLowerCase()) return;
    const isVideo = value.is_video ?? (value.media_type === 2 || value.product_type === 'clips');
    const ts = value.taken_at_timestamp || value.taken_at;
    emit({
      externalId: shortcode,
      postUrl: `https://www.instagram.com/${isVideo ? 'reel' : 'p'}/${shortcode}/`,
      caption: value.edge_media_to_caption?.edges?.[0]?.node?.text || value.caption?.text || '',
      isVideo: Boolean(isVideo),
      postedAt: ts ? new Date(ts * 1000).toISOString() : null,
      thumbUrl: value.thumbnail_src || value.display_url || smallestCandidate(value.image_versions2?.candidates),
    });
    return;
  }
  for (const v of Object.values(value)) scanInstagramJson(v, username, emit);
}

function smallestCandidate(candidates) {
  if (!Array.isArray(candidates) || !candidates.length) return null;
  return [...candidates].sort((a, b) => (a.width || 0) - (b.width || 0))[0]?.url || null;
}

// DOM fallback for anything the response listener missed (e.g. the
// server-rendered first batch). Href-based, so localization-proof.
async function collectDomItems(page, profile, collected) {
  const selector =
    profile.platform === 'instagram' ? 'a[href*="/p/"], a[href*="/reel/"]' : '[data-e2e="user-post-item"] a';
  const domItems = await page
    .$$eval(selector, (links) =>
      links
        .map((a) => {
          const href = a.getAttribute('href') || '';
          const img = a.querySelector('img');
          return { href, thumbUrl: img?.src || null, caption: img?.alt || '' };
        })
        .filter((x) => x.href)
    )
    .catch(() => []);

  for (const { href, thumbUrl, caption } of domItems) {
    if (profile.platform === 'instagram') {
      // Grid hrefs are '/p/CODE/' or '/<username>/p/CODE/' — skip links
      // prefixed with someone else's username (suggested content).
      const m = href.match(/^(?:https?:\/\/[^/]+)?\/(?:([^/]+)\/)?(p|reel)\/([^/?#]+)/);
      if (!m) continue;
      if (m[1] && m[1].toLowerCase() !== profile.username.toLowerCase()) continue;
      addItem(
        collected,
        {
          externalId: m[3],
          postUrl: `https://www.instagram.com/${m[2]}/${m[3]}/`,
          caption,
          isVideo: m[2] === 'reel',
          postedAt: null,
          thumbUrl,
        },
        false
      );
    } else {
      const m = href.match(/\/(video|photo)\/(\d+)/);
      if (!m) continue;
      addItem(
        collected,
        {
          externalId: m[2],
          postUrl: `https://www.tiktok.com/@${profile.username}/${m[1]}/${m[2]}`,
          caption,
          isVideo: m[1] === 'video',
          postedAt: null,
          thumbUrl,
        },
        false
      );
    }
  }
}

// Save a low-res thumbnail to data/thumbnails/<profileId>/<externalId>.jpg.
// Fetched through the browser context's request client so the CDN sees the
// logged-in cookies and a plausible Referer. Returns the relative path, or
// null on failure (the view shows a placeholder and a later refresh retries).
async function downloadThumbnail(ctx, profile, item) {
  const rel = path.join(String(profile.id), `${item.externalId}.jpg`);
  const abs = path.join(config.thumbnailsDir, rel);
  if (fs.existsSync(abs)) return rel;
  if (!item.thumbUrl) return null;
  try {
    const resp = await ctx.request.get(item.thumbUrl, {
      headers: { Referer: profile.url },
      timeout: 15000,
    });
    if (!resp.ok()) return null;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, await resp.body());
    return rel;
  } catch {
    return null;
  }
}
