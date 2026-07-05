import { attachFile, tryFill, firstVisible, typeHashtags } from './baseUploader.js';

// Verified: unverified — selectors are best-effort; the runner's clipboard
// fallback covers any breakage. See docs/platform-notes.md.
const SELECTORS = {
  title: ['input.video-title-input', 'div.video-title input', 'input[placeholder*="标题"]'],
  desc: ['.archive-info-editor .ql-editor', '.desc-container .ql-editor', 'div[data-placeholder*="简介"]'],
  tagInput: ['.tag-input-wrp input', 'input[placeholder*="标签"]', '.label-area-container input'],
  uploadDone: ['text=上传完成', '.success', 'text=上传成功'],
};

export default {
  id: 'bilibili',
  async stage(page, { uploadUrl, variant, videoPath, hashtags }) {
    await page.goto(uploadUrl, { waitUntil: 'domcontentloaded' });
    await attachFile(page, videoPath, { timeoutMs: 20000 });

    // Bilibili processes the upload while the form is editable; wait briefly
    // for the form to render, then fill. Upload continues in background.
    await page.waitForTimeout(3000);

    const titleOk = await tryFill(page, SELECTORS.title, variant.title || '');
    if (!titleOk) throw new Error('could not find the title field');

    if (variant.caption) {
      await tryFill(page, SELECTORS.desc, variant.caption);
    }

    const tagLoc = await firstVisible(page, SELECTORS.tagInput, 4000);
    if (tagLoc && hashtags.length) {
      await tagLoc.click();
      for (const tag of hashtags.slice(0, 10)) {
        await page.keyboard.type(tag, { delay: 30 });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(300);
      }
    }
  },
};
