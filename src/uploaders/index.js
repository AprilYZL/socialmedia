import { db, getSetting } from '../db/index.js';
import { config } from '../config.js';
import { composeText, parseHashtags } from '../services/compose.js';
import { pbcopy } from '../services/clipboard.js';
import { launchProfile, getPage } from './baseUploader.js';
import bilibili from './bilibili.js';
import douyin from './douyin.js';
import xiaohongshu from './xiaohongshu.js';
import instagram from './instagram.js';
import tiktok from './tiktok.js';
import youtube from './youtube.js';

const drivers = { bilibili, douyin, xiaohongshu, instagram, tiktok, youtube };

// In-memory staging state, polled by the piece page.
// variantId -> { state: 'running'|'done'|'fallback'|'error', message }
export const stagingStatus = new Map();

let lastStageAt = 0;

const LOGIN_URL_HINTS = /login|passport|sso|accounts\.google|signin/i;

export function getStagingStatus(variantId) {
  return stagingStatus.get(Number(variantId)) || null;
}

// Open the platform's home page in its persistent profile so the user can
// log in (QR code for CN platforms). Fire-and-forget.
export async function openLoginWindow(platformId) {
  const platform = db.prepare('SELECT * FROM platforms WHERE id = ?').get(platformId);
  if (!platform) throw new Error(`unknown platform: ${platformId}`);
  const ctx = await launchProfile(platformId);
  const page = await getPage(ctx);
  await page.goto(platform.home_url, { waitUntil: 'domcontentloaded' }).catch(() => {});
}

// Semi-automated staging: fill the platform's upload form, stop before
// Publish. On any driver failure, fall back to opening the upload page with
// the composed caption on the clipboard.
export function stageVariant(variantId) {
  const id = Number(variantId);
  const throttle = Number(getSetting('throttle_seconds') || config.defaultThrottleSeconds);
  const waitLeft = Math.ceil((lastStageAt + throttle * 1000 - Date.now()) / 1000);
  if (waitLeft > 0) {
    throw new Error(`Throttled: wait ${waitLeft}s between stagings (configurable in Settings).`);
  }

  const variant = db
    .prepare(
      `SELECT v.*, p.upload_url, p.display_name AS platform_name
       FROM platform_variants v JOIN platforms p ON p.id = v.platform_id
       WHERE v.id = ?`
    )
    .get(id);
  if (!variant) throw new Error('variant not found');

  const assets = db
    .prepare('SELECT * FROM media_assets WHERE content_piece_id = ? ORDER BY id')
    .all(variant.content_piece_id);
  const videoPath = assets.find((a) => a.kind === 'video')?.file_path || null;
  const imagePaths = assets.filter((a) => a.kind === 'image').map((a) => a.file_path);
  if (!videoPath && !imagePaths.length) {
    throw new Error('This content piece has no media files attached.');
  }

  lastStageAt = Date.now();
  stagingStatus.set(id, { state: 'running', message: `Opening ${variant.platform_name}…` });

  // Run in the background; the UI polls stagingStatus.
  runStage(id, variant, { videoPath, imagePaths }).catch((err) => {
    stagingStatus.set(id, { state: 'error', message: String(err.message || err) });
  });
}

async function runStage(id, variant, { videoPath, imagePaths }) {
  const driver = drivers[variant.platform_id];
  if (!driver) throw new Error(`no driver for platform ${variant.platform_id}`);

  const hashtags = parseHashtags(variant.hashtags);
  const composed = composeText(variant);

  const ctx = await launchProfile(variant.platform_id);
  const page = await getPage(ctx);

  try {
    await page.goto(variant.upload_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    if (LOGIN_URL_HINTS.test(page.url())) {
      stagingStatus.set(id, {
        state: 'error',
        message: 'Not logged in — log in using the window that just opened, then stage again.',
      });
      return;
    }

    stagingStatus.set(id, { state: 'running', message: 'Filling in the upload form…' });
    await driver.stage(page, {
      uploadUrl: variant.upload_url,
      variant,
      videoPath,
      imagePaths,
      hashtags,
      composed,
    });

    db.prepare(
      "UPDATE platform_variants SET status = 'staged', updated_at = datetime('now') WHERE id = ?"
    ).run(id);
    stagingStatus.set(id, {
      state: 'done',
      message: 'Staged. Review the browser window, wait for the upload to finish, and click Publish yourself.',
    });
  } catch (err) {
    // Graceful degradation: leave the upload page open, put the composed
    // caption on the clipboard, and tell the user to paste manually.
    await pbcopy(composed).catch(() => {});
    await page.bringToFront().catch(() => {});
    stagingStatus.set(id, {
      state: 'fallback',
      message: `Auto-fill failed (${err.message}). The upload page is open and your caption is on the clipboard — attach the file and paste manually.`,
    });
  }
}
