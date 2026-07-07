import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { probe } from './media.js';
import { launchProfile, getPage } from '../uploaders/baseUploader.js';

const execFileAsync = promisify(execFile);

// Homebrew paths first: a GUI-launched Node process may not have brew on PATH.
const YTDLP_CANDIDATES = ['/opt/homebrew/bin/yt-dlp', '/usr/local/bin/yt-dlp'];
function ytdlpPath() {
  return YTDLP_CANDIDATES.find((p) => fs.existsSync(p)) || 'yt-dlp';
}

const cookiesFile = path.join(config.dataDir, 'cookies-instagram.txt');

const TIKTOK_HOSTS = new Set(['tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com']);
const INSTAGRAM_HOSTS = new Set(['instagram.com', 'instagr.am']);

// Normalize a pasted URL for dedup: https, canonical host, no query/hash.
// Short links (vm.tiktok.com) stay as-is; the canonical webpage_url from
// yt-dlp resolves them for the second dedup pass.
export function normalizeUrl(raw) {
  let u;
  try {
    u = new URL(String(raw || '').trim());
  } catch {
    throw new Error('That does not look like a valid URL.');
  }
  let host = u.hostname.toLowerCase().replace(/^(www|m)\./, '');
  if (!TIKTOK_HOSTS.has(host) && !INSTAGRAM_HOSTS.has(host)) {
    throw new Error('Only TikTok and Instagram URLs are supported.');
  }
  let pathname = u.pathname.replace(/\/+$/, '');
  if (INSTAGRAM_HOSTS.has(host)) {
    host = 'instagram.com';
    pathname = pathname.replace(/^\/reels\//, '/reel/');
    const m = pathname.match(/^\/[^/]+(\/(?:reel|p|tv)\/.+)$/);
    if (m) pathname = m[1];
  }
  return `https://${host}${pathname}`;
}

// Instagram path segments that are pages, not usernames.
const INSTAGRAM_RESERVED = new Set(['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'direct']);

// Parse a pasted profile URL into { platform, username, url } with a
// canonical url. Rejects post URLs so the two paste boxes stay unambiguous.
export function parseProfileUrl(raw) {
  let u;
  try {
    u = new URL(String(raw || '').trim());
  } catch {
    throw new Error('That does not look like a valid URL.');
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, '');
  const segments = u.pathname.split('/').filter(Boolean);

  if (INSTAGRAM_HOSTS.has(host)) {
    const username = (segments[0] || '').toLowerCase();
    if (!username || segments.length > 1 || INSTAGRAM_RESERVED.has(username)) {
      throw new Error('That looks like a post URL — paste a profile URL like instagram.com/username.');
    }
    return { platform: 'instagram', username, url: `https://www.instagram.com/${username}/` };
  }
  if (TIKTOK_HOSTS.has(host)) {
    if (segments.length !== 1 || !segments[0].startsWith('@') || segments[0].length < 2) {
      throw new Error('That looks like a post URL — paste a profile URL like tiktok.com/@username.');
    }
    const username = segments[0].slice(1);
    return { platform: 'tiktok', username, url: `https://www.tiktok.com/@${username}` };
  }
  throw new Error('Only TikTok and Instagram profile URLs are supported.');
}

function firstErrorLine(err) {
  const line = String(err.stderr || '')
    .split('\n')
    .find((l) => l.startsWith('ERROR:'));
  return line ? line.replace(/^ERROR:\s*/, '').slice(0, 300) : String(err.message || err).slice(0, 300);
}

// Fetch title/description without downloading. On an auth-walled Instagram
// post, export cookies from the account's logged-in Playwright profile and retry.
export async function fetchMetadata(url, accountId = 'frenchtouch') {
  const baseArgs = ['--dump-single-json', '--no-download', '--no-playlist', '--socket-timeout', '15'];
  const opts = { timeout: 60000, maxBuffer: 20 * 1024 * 1024 };
  let usedCookies = false;
  let stdout;
  try {
    ({ stdout } = await execFileAsync(ytdlpPath(), [...baseArgs, url], opts));
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error('yt-dlp is not installed — run: brew install yt-dlp');
    }
    const authWalled = /login|cookie|authentication|not available|rate.?limit|restricted/i.test(err.stderr || '');
    if (!(authWalled && url.includes('instagram.com'))) {
      throw new Error(firstErrorLine(err));
    }
    await exportInstagramCookies(accountId);
    usedCookies = true;
    try {
      ({ stdout } = await execFileAsync(ytdlpPath(), [...baseArgs, '--cookies', cookiesFile, url], opts));
    } catch (err2) {
      throw new Error(firstErrorLine(err2));
    }
  }

  const info = JSON.parse(stdout);
  const description = (info.description || '').trim();
  let title = (info.title || '').trim();
  if (!title) {
    const firstLine = description.split('\n')[0].trim();
    title = firstLine && firstLine.length <= 60 ? firstLine : `${info.extractor_key || 'Video'} ${info.id || ''}`.trim();
  }
  if (title.length > 120) title = title.slice(0, 120);

  let canonicalUrl;
  try {
    canonicalUrl = normalizeUrl(info.webpage_url || url);
  } catch {
    canonicalUrl = url;
  }
  return { title, description, canonicalUrl, usedCookies, uploader: pickHandle(info), uploadDate: pickDate(info) };
}

// The @handle, wherever this platform's extractor put it. Numeric ids
// (TikTok's uploader_id) lose to actual handles.
function pickHandle(info) {
  const candidates = [info.uploader_id, info.channel, info.uploader].filter(Boolean).map(String);
  return candidates.find((c) => !/^\d+$/.test(c)) || candidates[0] || null;
}

function pickDate(info) {
  if (/^\d{8}$/.test(info.upload_date || '')) {
    return `${info.upload_date.slice(0, 4)}-${info.upload_date.slice(4, 6)}-${info.upload_date.slice(6, 8)}`;
  }
  if (info.timestamp) return new Date(info.timestamp * 1000).toISOString().slice(0, 10);
  return null;
}

// One folder per imported post under ~/Downloads:
// "<platform> - <handle> - <video|image> - <title> - <YYYY-MM-DD>".
// '%' is stripped along with filesystem-hostile chars because the folder
// ends up inside a yt-dlp -o template, where '%' sequences are expanded.
function cleanPart(s) {
  return String(s || '').replace(/[%/\\:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
}

export function downloadFolder({ platform, username, kind, title, date }) {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const parts = [platform, username, kind, cleanPart(title).slice(0, 60), date || today];
  return path.join(os.homedir(), 'Downloads', parts.map(cleanPart).filter(Boolean).join(' - '));
}

// Write the Playwright profile's Instagram cookies as a Netscape cookies.txt
// that yt-dlp can read. --cookies-from-browser can't be used: Playwright's
// Chromium encrypts its cookie store with a mock keychain on macOS.
async function exportInstagramCookies(accountId) {
  const ctx = await launchProfile('instagram', accountId);
  const cookies = await ctx.cookies(['https://www.instagram.com', 'https://instagram.com']);
  if (!cookies.some((c) => c.name === 'sessionid' && c.value)) {
    const page = await getPage(ctx);
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});
    throw new Error('Instagram requires login — log in in the browser window that just opened, then retry the import.');
  }
  const lines = ['# Netscape HTTP Cookie File'];
  for (const c of cookies) {
    lines.push(
      [
        c.domain,
        c.domain.startsWith('.') ? 'TRUE' : 'FALSE',
        c.path,
        c.secure ? 'TRUE' : 'FALSE',
        c.expires && c.expires > 0 ? Math.floor(c.expires) : 0,
        c.name,
        c.value,
      ].join('\t')
    );
  }
  fs.writeFileSync(cookiesFile, lines.join('\n') + '\n');
}

// In-memory download state, polled by the piece page.
// pieceId -> { state: 'running'|'done'|'error', message, filePath }
export const importStatus = new Map();

export function getImportStatus(pieceId) {
  return importStatus.get(Number(pieceId)) || null;
}

// Guards double-submits of the same URL while its metadata fetch is running.
const inFlightUrls = new Set();
export function isImporting(url) {
  return inFlightUrls.has(url);
}
export function markImporting(url) {
  inFlightUrls.add(url);
}
export function unmarkImporting(url) {
  inFlightUrls.delete(url);
}

// Download the video to a per-post folder in ~/Downloads in the background
// and attach it to the piece as a media asset. Fire-and-forget; the UI polls
// importStatus.
export function startDownload(pieceId, url, { usedCookies = false, title = '', uploader = null, uploadDate = null } = {}) {
  const id = Number(pieceId);
  const folder = downloadFolder({
    platform: url.includes('tiktok') ? 'tiktok' : 'instagram',
    username: uploader,
    kind: 'video',
    title,
    date: uploadDate,
  });
  importStatus.set(id, { state: 'running', message: 'Downloading video to ~/Downloads…' });
  runDownload(id, url, usedCookies, folder).catch((err) => {
    importStatus.set(id, {
      state: 'error',
      message: `Download failed (${firstErrorLine(err)}). You can add the file manually with the form below.`,
    });
  });
}

async function runDownload(id, url, usedCookies, folder) {
  const outTemplate = path.join(folder, '%(title).60B [%(id)s].%(ext)s');
  const args = [
    '--no-playlist',
    '-f', 'b[ext=mp4]/b', // best pre-merged single file: no ffmpeg merge needed
    '-o', outTemplate,
    '--no-overwrites',
    '--no-simulate',
    '--print', 'after_move:filepath',
  ];
  if (usedCookies) args.push('--cookies', cookiesFile);
  args.push(url);

  const { stdout } = await execFileAsync(ytdlpPath(), args, { timeout: 600000, maxBuffer: 20 * 1024 * 1024 });
  const filePath = stdout.trim().split('\n').pop();
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('yt-dlp finished but did not report a downloaded file');
  }

  const meta = await probe(filePath);
  db.prepare(
    `INSERT INTO media_assets (content_piece_id, file_path, kind, width, height, duration_sec, size_bytes, role)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, filePath, meta.kind, meta.width, meta.height, meta.duration_sec, meta.size_bytes, 'primary');
  importStatus.set(id, { state: 'done', message: `Video saved to ${filePath} and attached.`, filePath });
}
