import path from 'node:path';
import { chromium } from 'playwright';
import { config } from '../config.js';

// One persistent Chromium profile per platform so QR-code / password logins
// survive app restarts. Contexts are kept open after staging so the user can
// review and click Publish; quitting the app closes them.
const contexts = new Map();

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
  ctx.on('close', () => {
    ctx._closed = true;
    contexts.delete(platformId);
  });
  contexts.set(platformId, ctx);
  return ctx;
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
