import { attachFile, tryFill, firstVisible, typeHashtags } from './baseUploader.js';

// Verified: unverified — Xiaohongshu has the fussiest editor and strictest
// bot detection; expect to lean on the clipboard fallback until selectors
// are tuned. See docs/platform-notes.md.
const SELECTORS = {
  videoTab: ['text=上传视频', 'div[role="tab"]:has-text("视频")'],
  imageTab: ['text=上传图文', 'div[role="tab"]:has-text("图文")'],
  title: ['input[placeholder*="标题"]', 'input.d-text'],
  caption: ['#post-textarea', '.ql-editor', 'div[contenteditable="true"]'],
};

export default {
  id: 'xiaohongshu',
  async stage(page, { uploadUrl, variant, videoPath, imagePaths, hashtags }) {
    await page.goto(uploadUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    if (videoPath) {
      const tab = await firstVisible(page, SELECTORS.videoTab, 4000);
      if (tab) await tab.click();
      await attachFile(page, videoPath, { timeoutMs: 20000 });
    } else if (imagePaths?.length) {
      const tab = await firstVisible(page, SELECTORS.imageTab, 4000);
      if (tab) await tab.click();
      await attachFile(page, imagePaths, { timeoutMs: 20000 });
    } else {
      throw new Error('no media to upload');
    }

    await page.waitForTimeout(4000);

    const titleOk = await tryFill(page, SELECTORS.title, (variant.title || '').slice(0, 20));
    if (!titleOk) throw new Error('could not find the title field');

    const captionLoc = await firstVisible(page, SELECTORS.caption, 8000);
    if (captionLoc) {
      await captionLoc.click();
      if (variant.caption) await page.keyboard.type(variant.caption, { delay: 25 });
      await typeHashtags(page, hashtags.slice(0, 10));
    }
  },
};
