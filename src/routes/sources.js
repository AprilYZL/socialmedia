import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db/index.js';
import { config } from '../config.js';
import {
  parseProfileUrl,
  normalizeUrl,
  fetchMetadata,
  startDownload,
  getImportStatus,
  isImporting,
  markImporting,
  unmarkImporting,
} from '../services/importer.js';
import { startScrape, getScrapeStatus, startImageImport } from '../services/profileScraper.js';
import { getActiveAccount, isAccountId, getEnabledPlatforms, getEnabledMap } from '../services/accounts.js';

export const sourcesRouter = Router();

// Short labels that fit on the per-post toggle buttons.
const SHORT_LABELS = {
  bilibili: 'B站',
  xiaohongshu: '小红书',
  douyin: '抖音',
  instagram: 'IG',
  tiktok: 'TT',
  youtube: 'YT',
};

// Account a new tracked profile belongs to: the form's choice, else the
// switcher's. The account owns the Playwright session used to scrape it.
function resolveAccountId(requested) {
  if (requested && isAccountId(requested)) return requested;
  const active = getActiveAccount();
  return active !== 'all' ? active : 'frenchtouch';
}

sourcesRouter.get('/sources', (req, res) => {
  const active = getActiveAccount();
  const profiles = db
    .prepare(
      `SELECT tp.*,
              (SELECT COUNT(*) FROM profile_posts pp WHERE pp.tracked_profile_id = tp.id) AS post_count
       FROM tracked_profiles tp
       ${active === 'all' ? '' : 'WHERE tp.account_id = @account'}
       ORDER BY tp.created_at DESC`
    )
    .all(active === 'all' ? {} : { account: active });
  res.render('sources.njk', { profiles, msg: req.query.msg, err: req.query.err });
});

sourcesRouter.post('/sources', (req, res) => {
  let parsed;
  try {
    parsed = parseProfileUrl(req.body.url);
  } catch (err) {
    return res.redirect('/sources?err=' + encodeURIComponent(err.message));
  }

  const existing = db
    .prepare('SELECT id FROM tracked_profiles WHERE platform = ? AND username = ?')
    .get(parsed.platform, parsed.username);
  if (existing) {
    return res.redirect(`/sources/${existing.id}?msg=` + encodeURIComponent('Already tracked — here it is.'));
  }

  const info = db
    .prepare('INSERT INTO tracked_profiles (platform, username, url, account_id) VALUES (?, ?, ?, ?)')
    .run(parsed.platform, parsed.username, parsed.url, resolveAccountId(req.body.account_id));
  const id = info.lastInsertRowid;
  try {
    startScrape(id);
  } catch (err) {
    return res.redirect(`/sources/${id}?err=` + encodeURIComponent(err.message));
  }
  res.redirect(`/sources/${id}?msg=` + encodeURIComponent('Profile added — scraping posts…'));
});

sourcesRouter.get('/sources/:id', (req, res) => {
  const profile = db
    .prepare(
      `SELECT tp.*, a.display_name AS account_name, a.color AS account_color
       FROM tracked_profiles tp JOIN accounts a ON a.id = tp.account_id
       WHERE tp.id = ?`
    )
    .get(req.params.id);
  if (!profile) return res.status(404).send('Not found');

  const posts = db
    .prepare(
      `SELECT * FROM profile_posts WHERE tracked_profile_id = ?
       ORDER BY posted_at IS NULL, posted_at DESC, first_seen_at DESC`
    )
    .all(profile.id);

  const marks = {}; // postId -> { platformId: true }
  const markRows = db
    .prepare(
      `SELECT m.profile_post_id, m.platform_id FROM profile_post_marks m
       JOIN profile_posts pp ON pp.id = m.profile_post_id
       WHERE pp.tracked_profile_id = ?`
    )
    .all(profile.id);
  for (const r of markRows) {
    (marks[r.profile_post_id] ??= {})[r.platform_id] = true;
  }

  // One toggle per platform the profile's account is enabled on (Settings matrix).
  const markPlatforms = getEnabledPlatforms(profile.account_id).map((p) => ({
    ...p,
    short: SHORT_LABELS[p.id] || p.display_name,
  }));

  const importStates = {}; // postId -> importer status, for posts mid-download
  for (const p of posts) {
    if (p.content_piece_id) importStates[p.id] = getImportStatus(p.content_piece_id);
  }

  res.render('source.njk', {
    profile,
    posts,
    marks,
    markPlatforms,
    importStates,
    scrape: getScrapeStatus(profile.id),
    msg: req.query.msg,
    err: req.query.err,
  });
});

sourcesRouter.post('/sources/:id/refresh', (req, res) => {
  const profile = db.prepare('SELECT id FROM tracked_profiles WHERE id = ?').get(req.params.id);
  if (!profile) return res.status(404).send('Not found');
  try {
    startScrape(profile.id);
  } catch (err) {
    return res.redirect(`/sources/${profile.id}?err=` + encodeURIComponent(err.message));
  }
  res.redirect(`/sources/${profile.id}?msg=` + encodeURIComponent('Refreshing…'));
});

sourcesRouter.get('/sources/:id/scrape-status', (req, res) => {
  res.json({ scrape: getScrapeStatus(req.params.id) });
});

sourcesRouter.post('/sources/post/:postId/mark/:platformId', (req, res) => {
  const post = db.prepare('SELECT * FROM profile_posts WHERE id = ?').get(req.params.postId);
  if (!post) return res.status(404).send('Not found');
  const profile = db.prepare('SELECT account_id FROM tracked_profiles WHERE id = ?').get(post.tracked_profile_id);
  const platformId = req.params.platformId;

  const existing = db
    .prepare('SELECT 1 FROM profile_post_marks WHERE profile_post_id = ? AND platform_id = ?')
    .get(post.id, platformId);
  // Existing marks stay removable even after the platform is disabled in Settings.
  if (!existing && !getEnabledMap()[profile.account_id]?.[platformId]) {
    return res.status(400).send('That platform is disabled for this account.');
  }
  if (existing) {
    db.prepare('DELETE FROM profile_post_marks WHERE profile_post_id = ? AND platform_id = ?').run(
      post.id,
      platformId
    );
  } else {
    // localtime, not UTC: uploaded_at decides which calendar day this lands on
    db.prepare(
      "INSERT INTO profile_post_marks (profile_post_id, platform_id, uploaded_at) VALUES (?, ?, datetime('now', 'localtime'))"
    ).run(post.id, platformId);
  }
  // The calendar's ✕ buttons post here too — send those back to the calendar;
  // otherwise the anchor keeps the grid scrolled to the card that was toggled.
  const referer = req.get('referer') || '';
  if (referer.includes('/calendar')) return res.redirect(referer);
  res.redirect(`/sources/${post.tracked_profile_id}#post-${post.id}`);
});

function linkPiece(res, post, pieceId, message) {
  db.prepare('UPDATE profile_posts SET content_piece_id = ? WHERE id = ?').run(pieceId, post.id);
  res.redirect(`/sources/${post.tracked_profile_id}?msg=` + encodeURIComponent(message) + `#post-${post.id}`);
}

function findBySourceUrl(url) {
  return db.prepare('SELECT id FROM content_pieces WHERE source_url = ?').get(url);
}

// Same flow as POST /library/import, but staying on the grid so several
// posts can be imported in a row; the created piece is linked to the post.
sourcesRouter.post('/sources/post/:postId/import', async (req, res) => {
  const post = db.prepare('SELECT * FROM profile_posts WHERE id = ?').get(req.params.postId);
  if (!post) return res.status(404).send('Not found');
  const profile = db.prepare('SELECT * FROM tracked_profiles WHERE id = ?').get(post.tracked_profile_id);
  const back = (param, message) =>
    res.redirect(`/sources/${profile.id}?${param}=` + encodeURIComponent(message) + `#post-${post.id}`);

  if (post.content_piece_id) return back('msg', 'Already imported.');

  const url = normalizeUrl(post.post_url);
  const existing = findBySourceUrl(url);
  if (existing) return linkPiece(res, post, existing.id, 'Already in library — linked.');

  // Image posts skip yt-dlp (videos only): the piece is built from the
  // scraped caption and the images are fetched via the logged-in browser.
  if (!post.is_video) {
    const caption = (post.caption || '').trim();
    const firstLine = caption.split('\n')[0].trim();
    const fallback = `${profile.platform === 'instagram' ? 'Instagram' : 'TikTok'} ${post.external_id}`;
    let title = firstLine && firstLine.length <= 60 ? firstLine : fallback;
    if (title.length > 120) title = title.slice(0, 120);
    let info;
    try {
      info = db
        .prepare(
          'INSERT INTO content_pieces (title, content_type, master_description, source_url, account_id) VALUES (?, ?, ?, ?, ?)'
        )
        .run(title, 'poster', caption, url, profile.account_id);
    } catch (err) {
      if (String(err.code || '').startsWith('SQLITE_CONSTRAINT')) {
        const race = findBySourceUrl(url);
        if (race) return linkPiece(res, post, race.id, 'Already in library — linked.');
      }
      throw err;
    }
    db.prepare('UPDATE profile_posts SET content_piece_id = ? WHERE id = ?').run(info.lastInsertRowid, post.id);
    startImageImport(info.lastInsertRowid, post, profile);
    return back('msg', 'Imported — image download to ~/Downloads is running in the background.');
  }

  if (isImporting(url)) return back('err', 'That URL is already being imported — give it a moment.');

  markImporting(url);
  try {
    const meta = await fetchMetadata(url, profile.account_id);

    // Second pass: the canonical URL from yt-dlp may already be in the library
    const dup = findBySourceUrl(meta.canonicalUrl);
    if (dup) return linkPiece(res, post, dup.id, 'Already in library — linked.');

    let info;
    try {
      info = db
        .prepare(
          'INSERT INTO content_pieces (title, content_type, master_description, source_url, account_id) VALUES (?, ?, ?, ?, ?)'
        )
        .run(meta.title, 'short_video', meta.description, meta.canonicalUrl, profile.account_id);
    } catch (err) {
      if (String(err.code || '').startsWith('SQLITE_CONSTRAINT')) {
        const race = findBySourceUrl(meta.canonicalUrl);
        if (race) return linkPiece(res, post, race.id, 'Already in library — linked.');
      }
      throw err;
    }

    db.prepare('UPDATE profile_posts SET content_piece_id = ? WHERE id = ?').run(info.lastInsertRowid, post.id);
    // The tracked profile knows the real handle and post date — better folder
    // naming than yt-dlp's per-extractor guesses.
    startDownload(info.lastInsertRowid, meta.canonicalUrl, {
      ...meta,
      uploader: profile.username,
      uploadDate: meta.uploadDate || (post.posted_at || '').slice(0, 10) || null,
    });
    back('msg', 'Imported — video download to ~/Downloads is running in the background.');
  } catch (err) {
    back('err', String(err.message || err));
  } finally {
    unmarkImporting(url);
  }
});

sourcesRouter.post('/sources/:id/delete', (req, res) => {
  const profile = db.prepare('SELECT * FROM tracked_profiles WHERE id = ?').get(req.params.id);
  if (!profile) return res.status(404).send('Not found');
  db.prepare('DELETE FROM tracked_profiles WHERE id = ?').run(profile.id); // posts + marks cascade
  fs.rmSync(path.join(config.thumbnailsDir, String(profile.id)), { recursive: true, force: true });
  res.redirect('/sources?msg=' + encodeURIComponent(`Stopped tracking @${profile.username}.`));
});
