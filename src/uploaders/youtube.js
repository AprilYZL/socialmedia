import { attachFile, firstVisible } from './baseUploader.js';

// Verified: unverified — YouTube Studio's upload dialog is the most stable of
// the international platforms. www.youtube.com/upload redirects into Studio.
const SELECTORS = {
  title: ['ytcp-social-suggestions-textbox#title-textarea #textbox', '#title-textarea #textbox', 'div#textbox[aria-label*="title" i]'],
  description: ['ytcp-social-suggestions-textbox#description-textarea #textbox', '#description-textarea #textbox', 'div#textbox[aria-label*="Tell viewers" i]'],
};

export default {
  id: 'youtube',
  async stage(page, { uploadUrl, variant, videoPath, hashtags }) {
    await page.goto(uploadUrl, { waitUntil: 'domcontentloaded' });
    await attachFile(page, videoPath, { timeoutMs: 20000 });
    await page.waitForTimeout(5000);

    const title = await firstVisible(page, SELECTORS.title, 15000);
    if (!title) throw new Error('could not find the title field');
    await title.click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type((variant.title || '').slice(0, 100), { delay: 15 });

    const desc = await firstVisible(page, SELECTORS.description, 6000);
    if (desc) {
      await desc.click();
      const tagLine = hashtags.length ? `\n\n${hashtags.map((t) => `#${t}`).join(' ')}` : '';
      await page.keyboard.type(`${variant.caption || ''}${tagLine}`, { delay: 10 });
    }
    // Stop here — the user walks through Details/Checks/Visibility and publishes.
  },
};
