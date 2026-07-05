import { attachFile, firstVisible } from './baseUploader.js';

// Verified: unverified — Instagram's create flow is a multi-step dialog and
// changes often; the clipboard fallback is the expected safety net here.
const SELECTORS = {
  newPost: ['svg[aria-label="New post"]', 'a[href="#"] svg[aria-label="新帖子"]', 'div[role="button"]:has(svg[aria-label="New post"])'],
  createOption: ['text=Post', 'text=帖子'],
  next: ['div[role="button"]:has-text("Next")', 'div[role="button"]:has-text("下一步")'],
  caption: ['div[aria-label="Write a caption..."]', 'div[aria-label*="caption"]', 'div[contenteditable="true"]'],
};

export default {
  id: 'instagram',
  async stage(page, { uploadUrl, composed, videoPath, imagePaths }) {
    await page.goto(uploadUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const newPost = await firstVisible(page, SELECTORS.newPost, 8000);
    if (!newPost) throw new Error('could not find the New post button');
    await newPost.click();
    await page.waitForTimeout(1000);
    const option = await firstVisible(page, SELECTORS.createOption, 2000);
    if (option) await option.click().catch(() => {});

    await attachFile(page, videoPath || imagePaths, { timeoutMs: 15000 });
    await page.waitForTimeout(3000);

    // Crop step -> (edit step) -> caption step
    for (let i = 0; i < 2; i++) {
      const next = await firstVisible(page, SELECTORS.next, 10000);
      if (!next) break;
      await next.click();
      await page.waitForTimeout(1500);
    }

    const caption = await firstVisible(page, SELECTORS.caption, 8000);
    if (!caption) throw new Error('could not find the caption field');
    await caption.click();
    await page.keyboard.type(composed, { delay: 15 });
    // Stop here — the user clicks Share.
  },
};
