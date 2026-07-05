import { attachFile, firstVisible } from './baseUploader.js';

// Verified: unverified — TikTok Studio sometimes renders the upload form
// inside an iframe; we check both. See docs/platform-notes.md.
const SELECTORS = {
  caption: ['.public-DraftEditor-content', 'div[contenteditable="true"]'],
};

export default {
  id: 'tiktok',
  async stage(page, { uploadUrl, composed, videoPath }) {
    await page.goto(uploadUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    let frame = null;
    const iframeEl = page.locator('iframe[src*="upload"]').first();
    if (await iframeEl.isVisible().catch(() => false)) {
      frame = page.frameLocator('iframe[src*="upload"]');
    }

    await attachFile(page, videoPath, { timeoutMs: 20000, frame: frame ? page.frame({ url: /upload/ }) : null });
    await page.waitForTimeout(5000);

    const scope = frame ?? page;
    let captionLoc = null;
    for (const sel of SELECTORS.caption) {
      const loc = scope.locator(sel).first();
      if (await loc.isVisible().catch(() => false)) {
        captionLoc = loc;
        break;
      }
    }
    if (!captionLoc) throw new Error('could not find the caption editor');

    await captionLoc.click();
    // Clear the auto-filled filename caption
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(composed, { delay: 20 });
  },
};
