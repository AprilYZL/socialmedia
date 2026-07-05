import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { config } from '../config.js';

// One persistent Chromium profile per platform so QR-code / password logins
// survive app restarts. Contexts are kept open after staging so the user can
// review and click Publish; closeAllProfiles() closes them cleanly on server
// shutdown — Chromium only reliably flushes cookies to disk on a clean close,
// so killing the browsers would lose any login done during the session.
const contexts = new Map();

// Belt and suspenders for logins: the profile dir only gets cookies on a
// clean close, so we also snapshot cookies to JSON while the browser is open
// and restore them on the next launch. Survives crashes and force-kills.
const SNAPSHOT_INTERVAL_MS = 45000;

function cookieSnapshotPath(platformId) {
  return path.join(config.profilesDir, `${platformId}.cookies.json`);
}

export async function snapshotCookies(platformId) {
  const ctx = contexts.get(platformId);
  if (!ctx || ctx._closed) return;
  try {
    const cookies = await ctx.cookies();
    if (cookies.length) fs.writeFileSync(cookieSnapshotPath(platformId), JSON.stringify(cookies));
  } catch {
    // context closed mid-snapshot — the previous snapshot still applies
  }
}

async function restoreCookies(platformId, ctx) {
  const file = cookieSnapshotPath(platformId);
  if (!fs.existsSync(file)) return;
  try {
    const cookies = JSON.parse(fs.readFileSync(file, 'utf8'));
    const now = Date.now() / 1000;
    const fresh = cookies.filter((c) => !c.expires || c.expires === -1 || c.expires > now);
    if (fresh.length) await ctx.addCookies(fresh);
  } catch {
    // corrupt snapshot — whatever the profile dir has still applies
  }
}

export async function launchProfile(platformId) {
  const existing = contexts.get(platformId);
  if (existing) {
    try {
      // Throws if the user closed the window since last use
      existing.pages();
      if (existing.pages() !== null && !existing._closed) return existing;
    } catch {
      contexts.delete(platformId);
    }
  }
  const dir = path.join(config.profilesDir, platformId);
  const ctx = await chromium.launchPersistentContext(dir, {
    headless: false,
    viewport: null,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  await restoreCookies(platformId, ctx);
  const snapshotTimer = setInterval(() => snapshotCookies(platformId), SNAPSHOT_INTERVAL_MS);
  ctx.on('close', () => {
    clearInterval(snapshotTimer);
    ctx._closed = true;
    contexts.delete(platformId);
  });
  contexts.set(platformId, ctx);
  return ctx;
}

// Snapshot cookies, then close every open context cleanly so Chromium
// flushes logins to the profile dirs. Called from the server's shutdown hook.
export async function closeAllProfiles() {
  const entries = [...contexts.entries()];
  await Promise.allSettled(
    entries.map(async ([platformId, ctx]) => {
      await snapshotCookies(platformId);
      await ctx.close();
    })
  );
}

export async function getPage(ctx) {
  const pages = ctx.pages();
  const page = pages.length ? pages[0] : await ctx.newPage();
  await page.bringToFront().catch(() => {});
  return page;
}

// Try a list of candidate selectors until one is visible; returns the locator
// or null. Keeps drivers resilient to minor page changes.
export async function firstVisible(page, selectors, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      const loc = page.locator(sel).first();
      if (await loc.isVisible().catch(() => false)) return loc;
    }
    await page.waitForTimeout(300);
  }
  return null;
}

export async function tryFill(page, selectors, text, { clear = true } = {}) {
  const loc = await firstVisible(page, selectors);
  if (!loc) return false;
  await loc.click();
  if (clear) {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.press('Backspace');
  }
  await loc.type(text, { delay: 20 });
  return true;
}

// Attach a file to the page's <input type="file">, visible or not.
export async function attachFile(page, filePath, { timeoutMs = 15000, frame = null } = {}) {
  const scope = frame ?? page;
  const input = scope.locator('input[type="file"]').first();
  await input.waitFor({ state: 'attached', timeout: timeoutMs });
  await input.setInputFiles(filePath);
}

// Type hashtags into a contenteditable caption editor the way CN platforms
// expect: '#tag' then a space/Escape to commit the topic chip.
export async function typeHashtags(page, tags, { escapeAfterEach = true } = {}) {
  for (const tag of tags) {
    await page.keyboard.type(` #${tag}`, { delay: 40 });
    await page.waitForTimeout(600); // let the topic-suggestion popup appear
    if (escapeAfterEach) {
      await page.keyboard.press('Escape').catch(() => {});
    }
  }
}
