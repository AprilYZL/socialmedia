import { attachFile, tryFill, firstVisible, typeHashtags } from './baseUploader.js';

// Verified: unverified — see docs/platform-notes.md.
const SELECTORS = {
  title: ['input[placeholder*="作品标题"]', 'input[placeholder*="标题"]'],
  caption: ['.zone-container', 'div[data-placeholder*="简介"]', '.editor-kit-container [contenteditable="true"]'],
};

export default {
  id: 'douyin',
  async stage(page, { uploadUrl, variant, videoPath, hashtags }) {
    await page.goto(uploadUrl, { waitUntil: 'domcontentloaded' });
    await attachFile(page, videoPath, { timeoutMs: 20000 });

    // Douyin routes to the edit page after the file is picked
    await page.waitForTimeout(4000);

    await tryFill(page, SELECTORS.title, variant.title || '');

    const captionLoc = await firstVisible(page, SELECTORS.caption, 8000);
    if (!captionLoc) throw new Error('could not find the caption editor');
    await captionLoc.click();
    if (variant.caption) {
      await page.keyboard.type(variant.caption, { delay: 20 });
    }
    await typeHashtags(page, hashtags.slice(0, 5));
  },
};
